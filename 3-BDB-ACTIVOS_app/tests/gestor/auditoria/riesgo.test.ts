/**
 * Auditoría · máxima caída y volatilidad.
 *
 * Convención (cabecera de `riesgo.ts`): volatilidad con rentabilidades SEMANALES (última
 * observación de cada semana ISO), desviación típica muestral (n − 1) × √52, y solo con 20
 * semanas o más; máxima caída sobre la serie diaria. Las cifras esperadas salen de una cuenta
 * a mano o, donde se dice, de una implementación independiente escrita aquí.
 */
import { describe, expect, it } from "vitest";
import { analizar, preparar } from "../../../src/gestor/motor/analisis";
import { sumarDias } from "../../../src/gestor/motor/fechas";
import { maximaCaida, riesgoDeLaSerie } from "../../../src/gestor/motor/riesgo";
import { activo, cartera, mov, serie } from "../ayudas";
import { TODO, mercado } from "./ayudasAuditoria";

describe("máxima caída", () => {
  /*
   *   01-01 100   01-02 110 (pico)   01-03 99 (−10 %)   01-04 112 (recupera y nuevo pico)
   *   01-05 105   01-06  84 (84 / 112 − 1 = −25 %)      01-07 100
   */
  const camino = serie(["2025-01-01", 100], ["2025-01-02", 110], ["2025-01-03", 99], ["2025-01-04", 112], ["2025-01-05", 105], ["2025-01-06", 84], ["2025-01-07", 100]);

  it("es la del segundo valle, más profundo, medida desde el pico que lo precede", () => {
    const caida = maximaCaida(camino);
    expect(caida.caida).toBeCloseTo(-0.25, 12);
    expect([caida.maximo, caida.minimo, caida.recuperacion]).toEqual(["2025-01-04", "2025-01-06", undefined]); // 100 < 112: sin recuperar
  });

  it("da el día en que se recupera el pico, cuando ocurre", () => {
    const caida = maximaCaida([...camino, { fecha: "2025-01-08", valor: 113 }]);
    expect(caida.recuperacion).toBe("2025-01-08"); // 113 ≥ 112
  });

  it("una serie que solo sube no tiene caída", () => {
    expect(maximaCaida(serie(["2025-01-01", 100], ["2025-01-02", 101], ["2025-01-03", 105])).caida).toBe(0);
  });
});

/*
 * Una serie semanal hecha a mano: cada viernes, el nivel se mueve con el ciclo
 * +2 %, −1 %, +1,5 %, −3 %, +0,5 %, repetido. De lunes a jueves hay valores sin sentido
 * (× 1,5) que no deben contar: solo vale la última observación de cada semana ISO.
 */
const CICLO = [0.02, -0.01, 0.015, -0.03, 0.005];
const PRIMER_VIERNES = "2025-01-03";

function serieSemanal(semanas: number, conRuidoEntreSemana: boolean): Array<{ fecha: string; valor: number }> {
  const puntos: Array<{ fecha: string; valor: number }> = [];
  let nivel = 100;
  for (let i = 0; i <= semanas; i += 1) {
    if (i > 0) nivel *= 1 + CICLO[(i - 1) % CICLO.length];
    const viernes = sumarDias(PRIMER_VIERNES, 7 * i);
    if (conRuidoEntreSemana) for (let k = 4; k >= 1; k -= 1) puntos.push({ fecha: sumarDias(viernes, -k), valor: nivel * 1.5 });
    puntos.push({ fecha: viernes, valor: nivel });
  }
  return puntos;
}

/** Implementación independiente: desviación muestral (n − 1) de las rentabilidades semanales, × √52. */
function volatilidadIndependiente(rentabilidades: number[]): number {
  const n = rentabilidades.length;
  const media = rentabilidades.reduce((s, r) => s + r, 0) / n;
  const suma = rentabilidades.reduce((s, r) => s + (r - media) * (r - media), 0);
  return Math.sqrt(suma / (n - 1)) * Math.sqrt(52);
}

describe("volatilidad", () => {
  it("25 semanas: a mano, √(Σr² / 24 × 52) = √0,017875", () => {
    /*
     * 25 rentabilidades = el ciclo cinco veces. Media: (0,02 − 0,01 + 0,015 − 0,03 + 0,005) / 5 = 0.
     * Σr² por ciclo: 0,0004 + 0,0001 + 0,000225 + 0,0009 + 0,000025 = 0,00165; × 5 = 0,00825.
     * Varianza muestral: 0,00825 / 24 = 0,00034375. Anualizada: × 52 = 0,017875. Volatilidad = √0,017875 ≈ 13,37 %.
     */
    const riesgo = riesgoDeLaSerie(serieSemanal(25, true));
    expect(riesgo.semanas).toBe(25);
    expect(riesgo.volatilidad).toBeCloseTo(Math.sqrt(0.017875), 12);
  });

  it("coincide con una implementación independiente de la fórmula (cálculo independiente, no a mano)", () => {
    const rentabilidades = Array.from({ length: 25 }, (_, i) => CICLO[i % CICLO.length]);
    expect(riesgoDeLaSerie(serieSemanal(25, true)).volatilidad).toBeCloseTo(volatilidadIndependiente(rentabilidades), 12);
  });

  it("con 19 semanas no se da; con 20, sí", () => {
    const corta = riesgoDeLaSerie(serieSemanal(19, false));
    expect([corta.semanas, corta.volatilidad]).toEqual([19, null]);
    const justa = riesgoDeLaSerie(serieSemanal(20, false));
    expect(justa.semanas).toBe(20);
    expect(justa.volatilidad).toBeCloseTo(volatilidadIndependiente(Array.from({ length: 20 }, (_, i) => CICLO[i % CICLO.length])), 12);
  });

  it("con menos de 330 días no hay Sharpe, y lo dice", () => {
    const riesgo = riesgoDeLaSerie(serieSemanal(25, false));
    expect(riesgo.sharpe).toBeNull();
    expect(riesgo.motivoSinSharpe).toBe("Hace falta al menos un año de historia.");
  });
});

describe("riesgo de una cartera, de punta a punta", () => {
  /* 10 participaciones compradas el primer viernes a 100; precios solo los viernes (el resto de días, el último conocido). */
  const precios = serieSemanal(25, false).map((p): [string, number] => [p.fecha, p.valor]);
  const c = cartera([activo("FON", "FONDO")], [
    mov("aportacion", PRIMER_VIERNES, { importe: "1000" }),
    mov("suscripcion", PRIMER_VIERNES, { activoId: "FON", titulos: "10", precio: "100", importe: "-1000" })
  ]);
  const ultimoViernes = sumarDias(PRIMER_VIERNES, 7 * 25);
  const a = analizar(preparar(c, mercado({ FON: precios }), new Map(), ultimoViernes), TODO);

  it("la volatilidad de la cartera es la de su fondo: √0,017875", () => {
    expect(a.riesgo!.semanas).toBe(25);
    expect(a.riesgo!.volatilidad).toBeCloseTo(Math.sqrt(0.017875), 12);
  });

  it("la máxima caída va del pico del primer ciclo al −3 % del último", () => {
    /*
     * Un ciclo entero multiplica por c = 1,02 × 0,99 × 1,015 × 0,97 × 1,005 ≈ 0,99917: cada pico es más bajo que el anterior.
     * Pico: semana 3 (100 × 1,02 × 0,99 × 1,015). Valle: semana 24, tras cuatro ciclos enteros y los cuatro primeros pasos
     * del quinto: 100 × c⁴ × 1,02 × 0,99 × 1,015 × 0,97. Caída = valle / pico − 1 = 0,97 × c⁴ − 1 ≈ −3,32 %.
     */
    const ciclo = 1.02 * 0.99 * 1.015 * 0.97 * 1.005;
    expect(a.riesgo!.maximaCaida.caida).toBeCloseTo(0.97 * Math.pow(ciclo, 4) - 1, 12);
    expect(a.riesgo!.maximaCaida.maximo).toBe(sumarDias(PRIMER_VIERNES, 7 * 3));
    expect(a.riesgo!.maximaCaida.minimo).toBe(sumarDias(PRIMER_VIERNES, 7 * 24));
  });

  it("con menos de 20 semanas de cartera, la volatilidad no se da", () => {
    const corto = analizar(preparar(c, mercado({ FON: precios }), new Map(), sumarDias(PRIMER_VIERNES, 7 * 19)), TODO);
    expect(corto.riesgo!.volatilidad).toBeNull();
  });
});
