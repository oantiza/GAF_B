/**
 * Riesgo (volatilidad, máxima caída, Sharpe) y bonos (cupón corrido, calendario), con
 * series cortas calculadas a mano.
 */
import { describe, expect, it } from "vitest";
import { calendarioDelBono, cuponCorrido, periodoDeCupon } from "../../src/gestor/motor/bonos";
import { sumarDias } from "../../src/gestor/motor/fechas";
import type { CondicionesDelBono } from "../../src/gestor/motor/modelo";
import { libreDeRiesgoMedio, maximaCaida, rentabilidadesSemanales, riesgoDeLaSerie, volatilidadAnualizada } from "../../src/gestor/motor/riesgo";
import { valorar, type Punto } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

/** Una serie diaria que solo cambia de nivel los lunes: cada semana ISO tiene un único nivel. */
function serieSemanal(inicio: string, rentabilidades: number[]): Punto[] {
  const puntos: Punto[] = [];
  let nivel = 100;
  for (let semana = 0; semana <= rentabilidades.length; semana += 1) {
    if (semana > 0) nivel *= 1 + rentabilidades[semana - 1];
    for (let dia = 0; dia < 7; dia += 1) puntos.push({ fecha: sumarDias(inicio, semana * 7 + dia), valor: nivel });
  }
  return puntos;
}

describe("volatilidad", () => {
  it("mide en semanal, con desviación muestral, y anualiza por raíz de 52", () => {
    // Veinte semanas alternando +1 % y −1 %: media 0; varianza muestral 20 × 0,0001 / 19.
    const alternas = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const s = serieSemanal("2024-01-01", alternas); // el 1 de enero de 2024 es lunes
    expect(rentabilidadesSemanales(s)).toHaveLength(20);
    /* La media no es exactamente cero (1,01 × 0,99 no es 1), así que la cifra se calcula con la definición completa. */
    const media = alternas.reduce((a, b) => a + b, 0) / 20;
    const esperada = Math.sqrt(alternas.reduce((a, r) => a + (r - media) ** 2, 0) / 19) * Math.sqrt(52);
    expect(esperada).toBeCloseTo(0.0739843, 6); // raíz(20 × 0,0001 / 19) × raíz(52) = 7,398 %
    expect(volatilidadAnualizada(rentabilidadesSemanales(s))).toBeCloseTo(esperada, 12);
    expect(riesgoDeLaSerie(s).volatilidad).toBeCloseTo(esperada, 12);
  });

  it("con menos de veinte semanas no da cifra", () => {
    const s = serieSemanal("2024-01-01", Array.from({ length: 19 }, () => 0.01));
    expect(riesgoDeLaSerie(s).volatilidad).toBeNull();
    expect(riesgoDeLaSerie(s).semanas).toBe(19);
  });
});

describe("máxima caída", () => {
  it("es la mayor bajada desde un máximo, con sus fechas y su recuperación", () => {
    const s = serie(["2024-01-01", 100], ["2024-01-02", 120], ["2024-01-03", 90], ["2024-01-04", 110], ["2024-01-05", 130]);
    // De 120 a 90: 90 / 120 − 1 = −25 %. Se recupera el día 5, al superar 120.
    expect(maximaCaida(s)).toEqual({ caida: 90 / 120 - 1, maximo: "2024-01-02", minimo: "2024-01-03", recuperacion: "2024-01-05" });
  });

  it("es cero si la serie nunca baja, y queda sin recuperar si no vuelve al máximo", () => {
    expect(maximaCaida(serie(["2024-01-01", 100], ["2024-01-02", 101])).caida).toBe(0);
    expect(maximaCaida(serie(["2024-01-01", 100], ["2024-01-02", 80], ["2024-01-03", 90])).recuperacion).toBeUndefined();
  });
});

describe("ratio de Sharpe", () => {
  // 52 semanas alternando +2 % y 0 %: 365 días, un año, los exigidos (GES-12). El martes 31-12 está en la semana ISO del
  // lunes 30 y con su mismo nivel: no añade ninguna rentabilidad semanal.
  const semanas = Array.from({ length: 52 }, (_, i) => (i % 2 === 0 ? 0.02 : 0));
  const s = serieSemanal("2024-01-01", semanas).slice(0, 52 * 7 + 2); // del lunes 1-1-2024 al martes 31-12-2024
  const estr = s.map((punto) => ({ fecha: punto.fecha, valor: 0.03 }));

  it("es (rentabilidad anualizada − libre de riesgo) / volatilidad", () => {
    const riesgo = riesgoDeLaSerie(s, estr);
    // Media semanal 1 %, desvíos de ±1 %: varianza muestral 52 × 0,0001 / 51.
    const volatilidad = Math.sqrt((52 * 0.0001) / 51) * Math.sqrt(52);
    // 1,02^26 en 365 días, anualizado por fechas.
    const anualizada = Math.pow(Math.pow(1.02, 26), 365.2425 / 365) - 1;
    expect(riesgo.volatilidad).toBeCloseTo(volatilidad, 10);
    expect(riesgo.rentabilidadAnualizada).toBeCloseTo(anualizada, 10);
    expect(riesgo.libreDeRiesgo?.tasa).toBeCloseTo(0.03, 12);
    expect(riesgo.sharpe).toBeCloseTo((anualizada - 0.03) / volatilidad, 8);
  });

  it("no se da sin un año de historia ni sin tipo libre de riesgo", () => {
    expect(riesgoDeLaSerie(s.slice(0, 300), estr).sharpe).toBeNull();
    expect(riesgoDeLaSerie(s.slice(0, 300), estr).motivoSinSharpe).toBe("Hace falta al menos un año de historia.");
    // GES-12: 364 días (hasta el lunes 30-12-2024) son un día menos que un año, y no se da; con 365, sí (la prueba de arriba).
    expect(riesgoDeLaSerie(s.slice(0, 52 * 7 + 1), estr).motivoSinSharpe).toBe("Hace falta al menos un año de historia.");
    expect(riesgoDeLaSerie(s).sharpe).toBeNull();
    expect(riesgoDeLaSerie(s).motivoSinSharpe).toBe("Falta el tipo libre de riesgo (€STR) del periodo.");
    // Un €STR que solo cubre la mitad del periodo no vale.
    expect(riesgoDeLaSerie(s, estr.slice(0, 180)).motivoSinSharpe).toBe("El tipo libre de riesgo (€STR) no cubre todo el periodo.");
  });

  it("distingue el periodo corto, donde no aplica, del dato que falta", () => {
    expect(riesgoDeLaSerie(s.slice(0, 300), estr).sharpeFaltaUnDato).toBeUndefined();
    expect(riesgoDeLaSerie(s).sharpeFaltaUnDato).toBe(true);
    expect(riesgoDeLaSerie(s, estr.slice(0, 180)).sharpeFaltaUnDato).toBe(true);
  });

  it("promedia el tipo libre de riesgo del periodo", () => {
    const puntos = serie(["2024-01-02", 0.02], ["2024-01-03", 0.04], ["2024-01-10", 0.09]);
    expect(libreDeRiesgoMedio(puntos, "2024-01-01", "2024-01-05")?.tasa).toBeCloseTo(0.03, 12);
    expect(libreDeRiesgoMedio(puntos, "2023-01-01", "2023-12-31")).toBeUndefined();
  });
});

describe("bonos", () => {
  const anual: CondicionesDelBono = { cupon: "0.035", frecuencia: 1, vencimiento: "2030-06-15", base: "ACT/ACT" };
  const semestral: CondicionesDelBono = { cupon: "0.04", frecuencia: 2, vencimiento: "2030-12-31", base: "30/360" };

  it("encuentra el periodo de cupón contando hacia atrás desde el vencimiento", () => {
    expect(periodoDeCupon(anual, "2024-08-01")).toEqual({ anterior: "2024-06-15", siguiente: "2025-06-15" });
    // Un bono que vence a fin de mes paga a fin de mes: 30 de junio y 31 de diciembre.
    expect(periodoDeCupon(semestral, "2024-09-30")).toEqual({ anterior: "2024-06-30", siguiente: "2024-12-31" });
  });

  it("calcula el cupón corrido en ACT/ACT", () => {
    // Del 15-06-2024 al 01-08-2024 van 47 días de un periodo de 365: 3,5 % × 47 / 365 = 0,450685 % del nominal.
    expect(cuponCorrido(anual, "2024-08-01")).toBeCloseTo((0.035 * 47) / 365, 12);
    expect(cuponCorrido(anual, "2024-08-01") * 10000).toBeCloseTo(45.07, 2);
  });

  it("calcula el cupón corrido en 30/360", () => {
    // Del 30-06 al 30-09 son 90 días de 30/360: 4 % × 90 / 360 = 1 % del nominal.
    expect(cuponCorrido(semestral, "2024-09-30")).toBeCloseTo(0.01, 12);
  });

  it("vale cero el día del cupón, antes de la emisión y desde el vencimiento", () => {
    expect(cuponCorrido(anual, "2025-06-15")).toBe(0);
    expect(cuponCorrido(anual, "2030-06-15")).toBe(0);
    expect(cuponCorrido({ ...anual, emision: "2024-09-01" }, "2024-08-01")).toBe(0);
    // Un primer cupón corto: emitido el 01-09-2024, el 01-10-2024 lleva 30 días de un periodo de 365.
    expect(cuponCorrido({ ...anual, emision: "2024-09-01" }, "2024-10-01")).toBeCloseTo((0.035 * 30) / 365, 12);
    expect(cuponCorrido({ ...anual, cupon: "0" }, "2024-08-01")).toBe(0);
  });

  it("da el calendario de cupones y el vencimiento", () => {
    expect(calendarioDelBono(anual, "2024-08-01", "2026-12-31")).toEqual([
      { fecha: "2025-06-15", clase: "cupon", fraccion: 0.035 },
      { fecha: "2026-06-15", clase: "cupon", fraccion: 0.035 }
    ]);
    expect(calendarioDelBono(semestral, "2030-07-01", "2031-01-01")).toEqual([
      { fecha: "2030-12-31", clase: "cupon", fraccion: 0.02 },
      { fecha: "2030-12-31", clase: "vencimiento", fraccion: 1 }
    ]);
  });

  it("un bono se valora con precio limpio más cupón corrido", () => {
    /*
     * 10.000 de nominal al 98,5 % el 01-08-2024: 9.850 € más 45,07 € de cupón corrido = 9.895,07 €,
     * que es lo que se paga. La compra no gana ni pierde nada ese día.
     */
    const bono = activo("BON", "BONO", "EUR", { multiplicador: "0.01", bono: anual });
    const c = cartera([bono], [
      mov("aportacion", "2024-08-01", { importe: "9895.07" }),
      mov("compra", "2024-08-01", { activoId: "BON", titulos: "10000", precio: "98.5", cuponCorrido: "45.07", importe: "-9895.07" })
    ]);
    const v = valorar(c, undefined, { hasta: "2024-08-02" });
    expect(v.valor[0]).toBeCloseTo(9850 + (10000 * 0.035 * 47) / 365, 9);
    expect(v.rentabilidad[0]).toBeCloseTo(0, 6);
    // Al día siguiente devenga un día más de cupón: 10.000 × 3,5 % / 365 = 0,9589 €.
    expect(v.valor[1] - v.valor[0]).toBeCloseTo((10000 * 0.035) / 365, 9);
  });
});
