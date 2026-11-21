/**
 * Ratio de Sortino, ratio de Calmar y rentabilidad de los últimos 1, 3 y 5 años, en el motor del gestor.
 *
 * Cada cifra esperada sale de una cuenta a mano escrita junto a la prueba (las cifras con muchos decimales se han
 * calculado con una calculadora a partir de esa misma cuenta, nunca con la salida del motor). Las definiciones son las del
 * servidor: `ex_post_sortino` de `functions_python/weekly_sampling.py`, y Calmar y `_rolling_return` de
 * `functions_python/portfolio_real/engine.py` (en la etiqueta de Git `referencia-portfolio-real-2026-11-17`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analizar, periodosHabituales, preparar } from "../../src/gestor/motor/analisis";
import { sumarDias } from "../../src/gestor/motor/fechas";
import { metrica } from "../../src/gestor/motor/metricas/registro";
import { MIN_SEMANAS_PARA_SORTINO, desviacionBajista, rentabilidadesSemanales, riesgoDeLaSerie } from "../../src/gestor/motor/riesgo";
import { rentabilidadDeLosUltimosAnios, rentabilidadesDeLosUltimosAnios } from "../../src/gestor/motor/ultimosAnios";
import type { DatosDeMercado, Punto } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

/** Una serie diaria que solo cambia de nivel los lunes: cada semana ISO tiene un único nivel (la de `riesgoYBonos`). */
function serieSemanal(inicio: string, rentabilidades: number[]): Punto[] {
  const puntos: Punto[] = [];
  let nivel = 100;
  for (let semana = 0; semana <= rentabilidades.length; semana += 1) {
    if (semana > 0) nivel *= 1 + rentabilidades[semana - 1];
    for (let dia = 0; dia < 7; dia += 1) puntos.push({ fecha: sumarDias(inicio, semana * 7 + dia), valor: nivel });
  }
  return puntos;
}

/**
 * 52 semanas que se repiten de dos en dos, del lunes 1-1-2024 al martes 31-12-2024: 365 días, un año (GES-12), y 52
 * rentabilidades semanales. El martes 31 está en la misma semana ISO que el lunes 30 y con su mismo nivel: no añade ninguna.
 */
function cincuentaYDosSemanas(a: number, b: number): Punto[] {
  return serieSemanal("2024-01-01", Array.from({ length: 52 }, (_, i) => (i % 2 === 0 ? a : b))).slice(0, 52 * 7 + 2);
}

/** Un €STR constante, un punto cada día natural de la serie: cubre todo el periodo. */
function estrConstante(s: Punto[], tasa: number): Punto[] {
  return s.map((punto) => ({ fecha: punto.fecha, valor: tasa }));
}

/** Una serie con un punto cada catorce días, alternando +2 % y −1 %: cada punto cae en una semana ISO distinta. */
function cadaCatorceDias(puntos: number): Punto[] {
  const s: Punto[] = [];
  let nivel = 100;
  for (let i = 0; i < puntos; i += 1) {
    if (i > 0) nivel *= i % 2 === 1 ? 1.02 : 0.99;
    s.push({ fecha: sumarDias("2024-01-01", i * 14), valor: nivel });
  }
  return s;
}

function diarioConstante(desde: string, dias: number, tasa: number): Punto[] {
  return Array.from({ length: dias + 1 }, (_, i) => ({ fecha: sumarDias(desde, i), valor: tasa }));
}

/*
 * La serie de casi todas las pruebas: +2 % y −1 % alternos, 26 veces cada uno.
 *   Acumulada: (1,02 × 0,99)^26 − 1 = 1,0098^26 − 1 = 28,8604 %.
 *   Anualizada por fechas, 365 días: 1,0098^(26 × 365,2425 / 365) − 1 = 0,288821246616.
 *   Volatilidad: media semanal 0,5 %, desvíos de ±1,5 %: raíz(52 × 0,015² / 51) × raíz(52) = 0,109221846554.
 *   Caída máxima: cada −1 % sale de un máximo nuevo; la mayor es −1 %.
 */
const ALTERNA = cincuentaYDosSemanas(0.02, -0.01);
const ANUALIZADA = 0.288821246616;

describe("ratio de Sortino", () => {
  it("con el €STR en el 0 %: la desviación bajista cuenta solo las semanas de −1 %, y la media es sobre todas", () => {
    /*
     * rf = 0 → rf semanal = 0. min(0, r − 0): −0,01 en 26 semanas y 0 en las otras 26.
     *   Media de los cuadrados sobre las 52: 26 × 0,0001 / 52 = 0,00005.
     *   DD = raíz(0,00005) × raíz(52) = raíz(0,0026) = 0,050990195136.
     *   Sortino = (0,288821246616 − 0) / 0,050990195136 = 5,664250663.
     *   (El Sharpe, con la volatilidad de arriba: 0,288821246616 / 0,109221846554 = 2,644354181.)
     */
    const riesgo = riesgoDeLaSerie(ALTERNA, estrConstante(ALTERNA, 0));
    expect(riesgo.semanas).toBe(52);
    expect(desviacionBajista(rentabilidadesSemanales(ALTERNA), 0)).toBeCloseTo(0.050990195136, 10);
    expect(riesgo.rentabilidadAnualizada).toBeCloseTo(ANUALIZADA, 10);
    expect(riesgo.sharpe).toBeCloseTo(2.644354181, 7);
    expect(riesgo.sortino).toBeCloseTo(5.664250663, 7);
    expect(riesgo.motivoSinSortino).toBeUndefined();
  });

  it("con el €STR en el 3 %: la comparación es contra el tipo sin riesgo semanal equivalente", () => {
    /*
     * rf = 3 % → rf semanal = 1,03^(1/52) − 1 = 0,000568600096.
     *   Semanas de +2 %: 0,02 − 0,000569 > 0 → cuentan 0. Semanas de −1 %: −0,01 − 0,000569 = −0,010568600096.
     *   Media de los cuadrados: 26 × 0,010568600096² / 52 = 0,010568600096² / 2.
     *   DD = 0,010568600096 × raíz(1/2) × raíz(52) = 0,010568600096 × raíz(26) = 0,053889498123.
     *   Sortino = (0,288821246616 − 0,03) / 0,053889498123 = 4,802814196.
     *   Sharpe  = (0,288821246616 − 0,03) / 0,109221846554 = 2,369683857.
     */
    const riesgo = riesgoDeLaSerie(ALTERNA, estrConstante(ALTERNA, 0.03));
    expect(desviacionBajista(rentabilidadesSemanales(ALTERNA), 0.03)).toBeCloseTo(0.053889498123, 10);
    expect(riesgo.sharpe).toBeCloseTo(2.369683857, 7);
    expect(riesgo.sortino).toBeCloseTo(4.802814196, 7);
  });

  it("si la cartera rinde menos que el €STR, Sharpe y Sortino salen los dos negativos: el numerador es el mismo", () => {
    /*
     * +1 % y −1 % alternos: (1,01 × 0,99)^(26 × 365,2425 / 365) − 1 = 0,9999^26,0173 − 1 = −0,259848 %.
     *   Volatilidad: media 0, desvíos de ±1 %: raíz(52 × 0,0001 / 51) × raíz(52) = 0,072814564369.
     *   rf = 3 %: las de −1 % quedan en −0,010568600096; DD = 0,010568600096 × raíz(26) = 0,053889498123.
     *   Sortino = (−0,002598475595 − 0,03) / 0,053889498123 = −0,604913327.
     *   Sharpe  = (−0,002598475595 − 0,03) / 0,072814564369 = −0,447691693.
     */
    const s = cincuentaYDosSemanas(0.01, -0.01);
    const riesgo = riesgoDeLaSerie(s, estrConstante(s, 0.03));
    expect(riesgo.rentabilidadAnualizada).toBeCloseTo(-0.002598475595, 10);
    expect(riesgo.sharpe).toBeCloseTo(-0.447691693, 7);
    expect(riesgo.sortino).toBeCloseTo(-0.604913327, 7);
    expect(Math.sign(riesgo.sortino!)).toBe(Math.sign(riesgo.sharpe!));
  });

  it("si ninguna semana queda por debajo del tipo sin riesgo, no hay desviación a la baja: no se da, y no aplica", () => {
    /* +2 % y +1 % alternos con un €STR del 3 % (0,0569 % a la semana): todas las semanas lo superan, DD = 0. El Sharpe sí sale. */
    const s = cincuentaYDosSemanas(0.02, 0.01);
    const riesgo = riesgoDeLaSerie(s, estrConstante(s, 0.03));
    expect(riesgo.sharpe).not.toBeNull();
    expect(riesgo.sortino).toBeNull();
    expect(riesgo.motivoSinSortino).toBe("Ninguna semana ha quedado por debajo del tipo sin riesgo: no hay desviación a la baja que medir.");
    expect(riesgo.sortinoFaltaUnDato).toBeUndefined();
  });

  it(`con menos de ${MIN_SEMANAS_PARA_SORTINO} rentabilidades semanales no se da, aunque haya Sharpe; con ${MIN_SEMANAS_PARA_SORTINO}, sí`, () => {
    /*
     * 25 puntos cada catorce días, hasta el 02-12-2024, y uno más el 31-12-2024 al mismo nivel: 365 días (un año) y 25
     * rentabilidades (pasan de las 20 de la volatilidad), así que hay Sharpe; pero 25 < 26, y no hay Sortino.
     */
    const corta = [...cadaCatorceDias(25)];
    corta.push({ fecha: "2024-12-31", valor: corta[corta.length - 1].valor });
    const riesgoCorto = riesgoDeLaSerie(corta, diarioConstante("2024-01-01", 365, 0));
    expect(riesgoCorto.semanas).toBe(25);
    expect(riesgoCorto.sharpe).not.toBeNull();
    expect(riesgoCorto.sortino).toBeNull();
    expect(riesgoCorto.motivoSinSortino).toBe("Hacen falta al menos 26 semanas de historia.");
    /*
     * 27 puntos, hasta el lunes 30-12-2024, y el martes 31 al mismo nivel, en la misma semana ISO: 365 días y 26
     * rentabilidades, 13 de +2 % y 13 de −1 %. Con rf = 0:
     *   DD = raíz(13 × 0,0001 / 26) × raíz(52) = raíz(0,0026) = 0,050990195136.
     *   Anualizada: 1,0098^(13 × 365,2425 / 365) − 1 = 0,135262633321.
     *   Sortino = 0,135262633321 / 0,050990195136 = 2,652718488.
     */
    const justa = [...cadaCatorceDias(27)];
    justa.push({ fecha: "2024-12-31", valor: justa[justa.length - 1].valor });
    const riesgoJusto = riesgoDeLaSerie(justa, diarioConstante("2024-01-01", 365, 0));
    expect(riesgoJusto.semanas).toBe(26);
    expect(riesgoJusto.sortino).toBeCloseTo(2.652718488, 7);
  });

  it("sin Sharpe no hay Sortino, con el mismo motivo y la misma clase de ausencia", () => {
    /* Menos de un año (365 días): no aplica. */
    const corta = riesgoDeLaSerie(ALTERNA.slice(0, 300), estrConstante(ALTERNA, 0.03));
    expect(corta.sharpe).toBeNull();
    expect(corta.sortino).toBeNull();
    expect(corta.motivoSinSortino).toBe("Hace falta al menos un año de historia.");
    expect(corta.motivoSinSortino).toBe(corta.motivoSinSharpe);
    expect(corta.sortinoFaltaUnDato).toBeUndefined();
    /* Sin €STR, o con un €STR que no cubre el periodo: falta un dato. */
    for (const estr of [undefined, estrConstante(ALTERNA, 0.03).slice(0, 180)]) {
      const sinTipo = riesgoDeLaSerie(ALTERNA, estr);
      expect(sinTipo.sharpe).toBeNull();
      expect(sinTipo.sortino).toBeNull();
      expect(sinTipo.motivoSinSortino).toBe(sinTipo.motivoSinSharpe);
      expect(sinTipo.sortinoFaltaUnDato).toBe(true);
    }
  });
});

describe("ratio de Calmar", () => {
  it("es la rentabilidad anualizada entre la caída máxima, en valor absoluto", () => {
    /* 0,288821246616 / |−0,01| = 28,8821246616. */
    const riesgo = riesgoDeLaSerie(ALTERNA, estrConstante(ALTERNA, 0.03));
    expect(riesgo.maximaCaida.caida).toBeCloseTo(-0.01, 12);
    expect(riesgo.calmar).toBeCloseTo(28.8821246616, 8);
  });

  it("no depende del tipo sin riesgo: se da aunque falte el €STR, y es la misma cifra", () => {
    const sinTipo = riesgoDeLaSerie(ALTERNA);
    expect(sinTipo.sharpe).toBeNull();
    expect(sinTipo.calmar).toBeCloseTo(28.8821246616, 8);
    expect(sinTipo.motivoSinCalmar).toBeUndefined();
  });

  it("si la cartera no ha bajado de ningún máximo, no hay caída con la que comparar", () => {
    /* +2 % y +1 % alternos: la serie solo sube, la caída máxima es 0. */
    const s = cincuentaYDosSemanas(0.02, 0.01);
    const riesgo = riesgoDeLaSerie(s, estrConstante(s, 0.03));
    expect(riesgo.maximaCaida.caida).toBe(0);
    expect(riesgo.calmar).toBeNull();
    expect(riesgo.motivoSinCalmar).toBe("La cartera no ha bajado de ningún máximo en el periodo: no hay caída con la que comparar.");
  });

  it("con menos de un año (365 días) no se da: no hay rentabilidad anualizada", () => {
    /* 364 días, del lunes 1-1-2024 al lunes 30-12-2024: un día menos que un año. */
    expect(riesgoDeLaSerie(ALTERNA.slice(0, 52 * 7 + 1), estrConstante(ALTERNA, 0.03)).motivoSinCalmar).toBe("Hace falta al menos un año de historia.");
    const riesgo = riesgoDeLaSerie(ALTERNA.slice(0, 300), estrConstante(ALTERNA, 0.03));
    expect(riesgo.calmar).toBeNull();
    expect(riesgo.motivoSinCalmar).toBe("Hace falta al menos un año de historia.");
  });
});

describe("Sortino: paridad con el servidor", () => {
  it("da lo mismo que ex_post_sortino con las semanas de test_ex_post_sortino_y_sus_bordes", () => {
    /*
     * functions_python/tests/test_ex_post_sortino_parity.py, líneas 52-57 (130-135 hasta el 17-11-2026): semanas [0,01, −0,02, 0,015, −0,005] × 7,
     * rentabilidad anual 8 %, rf 2 %.
     *   rf semanal = 1,02^(1/52) − 1 = 0,000380892277.
     *   Por debajo: −0,02 − rf_s → cuadrado 0,000415380770; −0,005 − rf_s → cuadrado 0,000028954002.
     *   Media sobre las 28: 7 × (0,000415380770 + 0,000028954002) / 28 = 0,000111083693.
     *   DD = raíz(0,000111083693) × raíz(52) = 0,076002315965. Sortino = (0,08 − 0,02) / 0,076002315965 = 0,789449627.
     */
    const semanas = Array.from({ length: 7 }, () => [0.01, -0.02, 0.015, -0.005]).flat();
    const dd = desviacionBajista(semanas, 0.02);
    expect(dd).toBeCloseTo(0.076002315965, 10);
    expect((0.08 - 0.02) / dd).toBeCloseTo(0.789449627, 8);
  });

  it("da el Sortino del fixture que comparten el servidor y Diseño (sortino_parity.json)", () => {
    /*
     * functions_python/tests/fixtures/sortino_parity.json, que comprueba test_ex_post_sortino_parity.py (línea 48) con
     * ex_post_sortino y tests/sortinoParity.test.ts con sortinoRatio: 523 días hábiles sin huecos, 104 semanas, rf 2,1 %.
     * Aquí la serie entra entera en riesgoDeLaSerie con un €STR constante del 2,1 % cada día natural, así que el motor
     * calcula también su rentabilidad anualizada por fechas, que tiene que ser la del fixture.
     */
    const fixture = JSON.parse(readFileSync(join(process.cwd(), "functions_python", "tests", "fixtures", "sortino_parity.json"), "utf8")) as {
      risk_free_rate: number;
      annual_return: number;
      weekly_returns: number;
      expected_sortino: number;
      series: Array<{ date: string; value: number }>;
    };
    const s: Punto[] = fixture.series.map((punto) => ({ fecha: punto.date, valor: punto.value }));
    const semanales = rentabilidadesSemanales(s);
    expect(semanales).toHaveLength(fixture.weekly_returns);
    expect((fixture.annual_return - fixture.risk_free_rate) / desviacionBajista(semanales, fixture.risk_free_rate)).toBeCloseTo(fixture.expected_sortino, 12);
    const dias = (Date.parse(s[s.length - 1].fecha) - Date.parse(s[0].fecha)) / 86_400_000;
    const riesgo = riesgoDeLaSerie(s, diarioConstante(s[0].fecha, dias, fixture.risk_free_rate));
    expect(riesgo.rentabilidadAnualizada).toBeCloseTo(fixture.annual_return, 12);
    expect(riesgo.sortino).toBeCloseTo(fixture.expected_sortino, 10);
  });
});

describe("rentabilidad de los últimos años", () => {
  it("justo N años: el ancla es el mismo día N años antes; un día menos, y no se da", () => {
    /* Del 13-11-2025 (100) al 13-11-2026 (110): 110 / 100 − 1 = 10 %. */
    const justo = serie(["2025-11-13", 100], ["2026-06-30", 104], ["2026-11-13", 110]);
    const unAnio = rentabilidadDeLosUltimosAnios(justo, 1)!;
    expect(unAnio).toMatchObject({ objetivo: "2025-11-13", desde: "2025-11-13", hasta: "2026-11-13", anualizada: null });
    expect(unAnio.acumulada).toBeCloseTo(0.1, 12);
    /* La serie empieza el 14-11-2025: ningún punto en o antes del 13-11-2025. */
    const corta = rentabilidadDeLosUltimosAnios(serie(["2025-11-14", 100], ["2026-11-13", 110]), 1)!;
    expect(corta).toMatchObject({ desde: null, acumulada: null, anualizada: null, motivo: "La cartera no tiene todavía un año de historia." });
    expect(rentabilidadDeLosUltimosAnios(justo, 3)!.motivo).toBe("La cartera no tiene todavía 3 años de historia.");
  });

  it("si el día de hace N años cae en fin de semana, el ancla es el último punto anterior: el viernes", () => {
    /* Una serie de días hábiles que acaba el lunes 9-11-2026: hace un año fue domingo 9-11-2025; el punto anterior es el viernes 7. 120 / 96 − 1 = 25 %. */
    const s = serie(["2025-11-06", 95], ["2025-11-07", 96], ["2025-11-10", 97], ["2026-11-09", 120]);
    const unAnio = rentabilidadDeLosUltimosAnios(s, 1)!;
    expect(unAnio).toMatchObject({ objetivo: "2025-11-09", desde: "2025-11-07" });
    expect(unAnio.acumulada).toBeCloseTo(0.25, 12);
  });

  it("desde un 29 de febrero, el año anterior se ancla en el 28", () => {
    /* 29-02-2024 menos un año: 28-02-2023 (nivel 100). 110 / 100 − 1 = 10 %. */
    const s = serie(["2023-02-27", 90], ["2023-02-28", 100], ["2023-03-01", 101], ["2024-02-29", 110]);
    const unAnio = rentabilidadDeLosUltimosAnios(s, 1)!;
    expect(unAnio).toMatchObject({ objetivo: "2023-02-28", desde: "2023-02-28" });
    expect(unAnio.acumulada).toBeCloseTo(0.1, 12);
  });

  it("a 3 y 5 años da también la anualizada por fechas", () => {
    /*
     * Del 13-11-2023 (100) al 13-11-2026 (133,1): acumulada 33,1 %, en 1.096 días (2024 es bisiesto).
     *   Anualizada: 1,331^(365,2425 / 1.096) − 1 = 0,099973933496 (un 10 % al año, un poco menos por el día de más).
     * A 5 años la serie no llega: no aplica.
     */
    const s = serie(["2023-11-13", 100], ["2025-01-02", 115], ["2026-11-13", 133.1]);
    const [uno, tres, cinco] = rentabilidadesDeLosUltimosAnios(s);
    expect(uno.acumulada).toBeCloseTo(133.1 / 115 - 1, 12);
    expect(uno.anualizada).toBeNull();
    expect(tres.desde).toBe("2023-11-13");
    expect(tres.acumulada).toBeCloseTo(0.331, 12);
    expect(tres.anualizada).toBeCloseTo(0.099973933496, 10);
    expect(cinco).toMatchObject({ anios: 5, desde: null, acumulada: null, anualizada: null, motivo: "La cartera no tiene todavía 5 años de historia." });
  });

  it("en el análisis: sobre toda la historia de la cartera, hasta su último día, sea cual sea el periodo elegido", () => {
    /*
     * 10.000 € en un fondo a 100 € el 2-1-2025; el fondo vale 105 el 30-6-2025 y 110 el 13-11-2026. Sin más flujos, la
     * rentabilidad de la cartera es la del fondo. El 13-11-2025 el último precio conocido es el de 105:
     *   último año: 110 / 105 − 1 = 4,7619 %. A 3 y 5 años la cartera no llega (empieza el 2-1-2025).
     */
    const c = cartera([activo("A", "FONDO")], [
      mov("aportacion", "2025-01-02", { importe: "10000" }),
      mov("suscripcion", "2025-01-02", { activoId: "A", titulos: "100", precio: "100", importe: "-10000" })
    ]);
    const mercado: DatosDeMercado = { precios: new Map([["A", serie(["2025-01-02", 100], ["2025-06-30", 105], ["2026-11-13", 110])]]), cambios: new Map() };
    const preparado = preparar(c, mercado, new Map(), "2026-11-13");
    const periodos = periodosHabituales(preparado.valoracion, "2026-11-13");
    for (const id of ["inicio", "anio"] as const) {
      const a = analizar(preparado, periodos.find((p) => p.id === id)!.periodo);
      expect(a.ultimosAnios.map((linea) => linea.anios)).toEqual([1, 3, 5]);
      expect(a.ultimosAnios[0]).toMatchObject({ desde: "2025-11-13", hasta: "2026-11-13" });
      expect(a.ultimosAnios[0].acumulada).toBeCloseTo(110 / 105 - 1, 10);
      expect(metrica("rentabilidadUltimoAnio").valor(a)).toBeCloseTo(110 / 105 - 1, 10);
      expect(metrica("rentabilidadUltimos3Anios").valor(a)).toBeNull();
      expect(metrica("rentabilidadUltimos3Anios").motivoSinValor!(a)).toBe("La cartera no tiene todavía 3 años de historia.");
      expect(metrica("rentabilidadUltimos3Anios").noAplica!(a)).toBe(true);
      expect(a.ultimosAnios[2]).toMatchObject({ acumulada: null, anualizada: null, motivo: "La cartera no tiene todavía 5 años de historia." });
    }
  });
});
