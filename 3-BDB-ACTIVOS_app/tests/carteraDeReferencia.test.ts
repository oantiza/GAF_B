/**
 * Decisión 2 de Óscar (04-11-2026): las carteras de referencia se calculan en el momento con las series de
 * sus dos fondos, y cartera y referencia se comparan en las mismas fechas y hasta la última común.
 * Decisión 39 (05-11-2026): con los pesos fijados el primer día de cada ventana, como la cartera, sin reequilibrar.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  BENCHMARK_PROFILES,
  MIN_SEMANAS_COMUNES,
  compararEnMismasFechas,
  composicionConFondos,
  composicionDeLaReferencia,
  isExcludedBenchmarkIsin,
  mezclaDeReferencia,
  otraSerieEnLaComparacion,
  perfilCalculable,
  perfilesATresAnos,
  pesoDeLaReferenciaAlFinal,
  pesoDeLaReferenciaPorVentanas,
  referenceProfilesForDates,
  referenciaEnFechas,
  referenciaEnSemanas,
  rentaVariableAlFinal,
  tampocoSeReequilibra,
  type SeriesBaseDeReferencia
} from "../src/core/benchmarkProfiles";
import type { DatedValue } from "../src/core/seriesFrequency";
import { diasLaborables, REGISTRO, SERIES_HASTA_20260928 } from "./support/referenciaDePrueba";

const mocks = vi.hoisted(() => ({ rebased: vi.fn() }));
vi.mock("../src/adapters/priceSeriesBackend", () => ({ fetchRebasedSeries: mocks.rebased }));

import { cargarSeriesDeReferencia, seriesBaseDeLaRespuesta, seriesDeReferenciaOAusencia } from "../src/adapters/seriesDeReferencia";
import { clearSessionCaches } from "../src/core/sessionCaches";

const puntos = (filas: Array<[string, number]>): DatedValue[] => filas.map(([date, value]) => ({ date, value }));
const MITAD = { rf: 0.5, rv: 0.5 };

describe("la mezcla con los pesos fijados el primer día: resultado conocido, calculado a mano", () => {
  const rf = puntos([["2026-01-05", 100], ["2026-01-06", 101], ["2026-01-07", 102.01], ["2026-01-08", 103.0301]]);
  const rv = puntos([["2026-01-05", 200], ["2026-01-06", 220], ["2026-01-07", 198], ["2026-01-08", 217.8]]);
  const SESENTA_CUARENTA = { rf: 0.6, rv: 0.4 };

  test("60/40: cada fondo sobre su primer día, por su peso", () => {
    /* El 06: 0,6 × 1,01 + 0,4 × 1,10 = 1,046. El 07: 0,6 × 1,0201 + 0,4 × 0,99 = 1,00806. El 08: 0,6 × 1,030301 + 0,4 × 1,089 = 1,0537806. */
    const mezcla = mezclaDeReferencia(rf, rv, SESENTA_CUARENTA, "2026-01-05");
    expect(mezcla.map((p) => p.date)).toEqual(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]);
    expect(mezcla[0].value).toBe(100);
    expect(mezcla[1].value).toBeCloseTo(104.6, 10);
    expect(mezcla[2].value).toBeCloseTo(100.806, 10);
    expect(mezcla[3].value).toBeCloseTo(105.37806, 10);
  });

  test("reequilibrado frente a fijo: es lo que distingue la regla", () => {
    /* Reequilibrando cada día, el 07 sería 104,6 × (1 + 0,6 × 1 % − 0,4 × 10 %) = 104,6 × 0,966 = 101,0436. Con pesos fijados, 100,806. */
    const mezcla = mezclaDeReferencia(rf, rv, SESENTA_CUARENTA, "2026-01-05");
    const reequilibrada = 104.6 * (1 + 0.6 * 0.01 + 0.4 * -0.1);
    expect(reequilibrada).toBeCloseTo(101.0436, 10);
    expect(reequilibrada - mezcla[2].value).toBeCloseTo(0.2376, 10);
  });

  test("dos ventanas de la misma historia no dan lo mismo: la serie larga no se puede cortar", () => {
    /* Desde el 06, los pesos son 60/40 ese día. El 07: 0,6 × 1,01 + 0,4 × 0,90 = 0,966. El 08: 0,6 × 1,0201 + 0,4 × 0,99 = 1,00806.
       La que empezó el 05, cortada el 06: 100,806 / 104,6 = 96,3728… Sus pesos del 06 ya no son 60/40: 0,606 / 1,046 = 57,9 %. */
    const desdeEl06 = mezclaDeReferencia(rf, rv, SESENTA_CUARENTA, "2026-01-06");
    expect(desdeEl06.map((p) => p.date)).toEqual(["2026-01-06", "2026-01-07", "2026-01-08"]);
    expect(desdeEl06[0].value).toBe(100);
    expect(desdeEl06[1].value).toBeCloseTo(96.6, 10);
    expect(desdeEl06[2].value).toBeCloseTo(100.806, 10);
    const larga = mezclaDeReferencia(rf, rv, SESENTA_CUARENTA, "2026-01-05");
    const cortada = (larga[2].value / larga[1].value) * 100;
    expect(cortada).toBeCloseTo(96.37285, 4);
    expect(desdeEl06[1].value - cortada).toBeGreaterThan(0.2);
  });

  test("con peso 0, la mezcla es el otro fondo con base 100", () => {
    expect(mezclaDeReferencia(rf, rv, { rf: 1, rv: 0 }, "2026-01-05").map((p) => p.value)).toEqual([100, expect.closeTo(101, 10), expect.closeTo(102.01, 10), expect.closeTo(103.0301, 10)]);
    expect(mezclaDeReferencia(rf, rv, { rf: 0, rv: 1 }, "2026-01-05").map((p) => p.value)).toEqual([100, expect.closeTo(110, 10), expect.closeTo(99, 10), expect.closeTo(108.9, 10)]);
  });

  test("después del primer día solo cuentan las fechas con dato de los dos, y un hueco no cambia ningún otro valor", () => {
    /* El 06 solo publica la renta fija. El 07: 0,5 × 1,02 + 0,5 × 0,99 = 1,005. El 08: 0,5 × 1,03 + 0,5 × 1,10 = 1,065. */
    const a = puntos([["2026-01-05", 100], ["2026-01-06", 101], ["2026-01-07", 102], ["2026-01-08", 103]]);
    const b = puntos([["2026-01-05", 100], ["2026-01-07", 99], ["2026-01-08", 110]]);
    const mezcla = mezclaDeReferencia(a, b, MITAD, "2026-01-05");
    expect(mezcla.map((p) => p.date)).toEqual(["2026-01-05", "2026-01-07", "2026-01-08"]);
    expect(mezcla[1].value).toBeCloseTo(100.5, 10);
    expect(mezcla[2].value).toBeCloseTo(106.5, 10);
  });

  test("el primer día es el de la simulación: si ese día no publican, su último dato conocido, y solo ese día", () => {
    /* El viernes 18-04-2025 no publica ninguno: se fijan los pesos con el dato del 17. El 21: 0,5 × 1,01 + 0,5 × 1,05 = 1,03. El 22: 0,5 × 1,02 + 0,5 × 1,10 = 1,06. */
    const a = puntos([["2025-04-17", 100], ["2025-04-21", 101], ["2025-04-22", 102]]);
    const b = puntos([["2025-04-17", 200], ["2025-04-21", 210], ["2025-04-22", 220]]);
    const mezcla = mezclaDeReferencia(a, b, MITAD, "2025-04-18");
    expect(mezcla.map((p) => p.date)).toEqual(["2025-04-18", "2025-04-21", "2025-04-22"]);
    expect(mezcla[0].value).toBe(100);
    expect(mezcla[1].value).toBeCloseTo(103, 10);
    expect(mezcla[2].value).toBeCloseTo(106, 10);
  });

  test("ese último dato vale hasta 14 días, como en la simulación; a los 15 empieza en la siguiente fecha con dato", () => {
    const a = puntos([["2025-01-01", 100], ["2025-02-03", 110], ["2025-02-04", 121]]);
    const b = puntos([["2025-01-01", 100], ["2025-02-03", 120], ["2025-02-04", 132]]);
    /* Del 01-01 al 15-01 son 14 días. El 03-02: 0,5 × 1,10 + 0,5 × 1,20 = 1,15. */
    const a14 = mezclaDeReferencia(a, b, MITAD, "2025-01-15");
    expect(a14.map((p) => p.date)).toEqual(["2025-01-15", "2025-02-03", "2025-02-04"]);
    expect(a14[1].value).toBeCloseTo(115, 10);
    /* A los 15 no hay primer día ese día: los pesos se fijan el 03-02, y el 04: 0,5 × 1,10 + 0,5 × 1,10 = 1,10. */
    const a15 = mezclaDeReferencia(a, b, MITAD, "2025-01-16");
    expect(a15.map((p) => p.date)).toEqual(["2025-02-03", "2025-02-04"]);
    expect(a15[1].value).toBeCloseTo(110, 10);
  });

  test("si uno solo publica ese día, cada fondo con su último dato", () => {
    /* El 18 solo publica la renta variable: 100 y 210 son la base. El 21: 0,5 × 1,01 + 0,5 × 1,10 = 1,055. */
    const a = puntos([["2025-04-17", 100], ["2025-04-21", 101], ["2025-04-22", 102]]);
    const b = puntos([["2025-04-17", 200], ["2025-04-18", 210], ["2025-04-21", 231], ["2025-04-22", 231]]);
    const mezcla = mezclaDeReferencia(a, b, MITAD, "2025-04-18");
    expect(mezcla.map((p) => p.date)).toEqual(["2025-04-18", "2025-04-21", "2025-04-22"]);
    expect(mezcla[1].value).toBeCloseTo(105.5, 10);
  });

  test("si el día pedido es anterior a sus datos, empieza en la primera fecha común", () => {
    expect(mezclaDeReferencia(rf, rv, SESENTA_CUARENTA, "2020-01-01")).toEqual(mezclaDeReferencia(rf, rv, SESENTA_CUARENTA, "2026-01-05"));
  });

  test("unos pesos que no suman 100 %, o negativos, no se normalizan en silencio", () => {
    expect(mezclaDeReferencia(rf, rv, { rf: 0.5, rv: 0.4 }, "2026-01-05")).toEqual([]);
    expect(mezclaDeReferencia(rf, rv, { rf: 1.2, rv: -0.2 }, "2026-01-05")).toEqual([]);
    expect(mezclaDeReferencia(rf, rv, { rf: Number.NaN, rv: 1 }, "2026-01-05")).toEqual([]);
  });

  test("sin dos fechas no hay serie; un valor no positivo no cuenta como dato; una serie corta tampoco alcanza", () => {
    expect(mezclaDeReferencia([], rv, MITAD, "2026-01-05")).toEqual([]);
    expect(mezclaDeReferencia(rf.slice(0, 1), rv, MITAD, "2026-01-05")).toEqual([]);
    expect(mezclaDeReferencia(puntos([["2020-01-01", 100], ["2020-01-02", 101]]), rv, MITAD, "2020-01-01")).toEqual([]);
    /* El último día no tiene un día siguiente con el que dar una serie. */
    expect(mezclaDeReferencia(rf, rv, MITAD, "2026-01-08")).toEqual([]);
    const conCero = puntos([["2026-01-05", 100], ["2026-01-06", 0], ["2026-01-07", 102.01]]);
    expect(mezclaDeReferencia(conCero, rv, { rf: 1, rv: 0 }, "2026-01-05").map((p) => p.date)).toEqual(["2026-01-05", "2026-01-07"]);
  });

  test("el orden de llegada no cambia el resultado", () => {
    expect(mezclaDeReferencia([...rf].reverse(), [...rv].reverse(), MITAD, "2026-01-05")).toEqual(mezclaDeReferencia(rf, rv, MITAD, "2026-01-05"));
  });

  test("un perfil desconocido, o sin dos fechas en común, no se puede calcular", () => {
    expect(perfilCalculable("no-existe", SERIES_HASTA_20260928)).toBeNull();
    expect(perfilCalculable("equilibrado", { rf: [], rv: [] })).toBeNull();
    expect(perfilCalculable("equilibrado", null)).toBeNull();
    expect(perfilCalculable("equilibrado", SERIES_HASTA_20260928)?.name).toBe("Equilibrado");
  });
});

/**
 * Con los dos fondos hasta el 28-09-2026. Las de un solo fondo reproducen el fichero que iba compilado, porque no tienen nada que
 * reequilibrar. Tolerancias medidas, no ajustadas:
 *  - La serie de cada fondo, 5e-5: el fichero la guardaba redondeada a 4 decimales (medido: 4,99e-5).
 *  - Rentabilidad acumulada, anualizada y caída máxima, 5e-6, o sea 0,0005 puntos (medido: 3,98e-6).
 *  - Volatilidad, 0,8 % relativo (medido: 0,36 % en toda la serie y 0,76 % a 3 años). Es la única cifra que se
 *    separa, y no por la mezcla: el fichero salió del histórico del extractor, con 19 festivos que repetían el
 *    valor anterior y que en la base no están (2.900 observaciones frente a 2.881). Con 19 rendimientos de cero
 *    más, la desviación diaria baja. La aplicación ya no usa esa cifra diaria: mide en semanal.
 *
 * Las mezclas ya no: el fichero era la regla de antes, y lo que da la de ahora es `pesosFijados`, calculado aparte en Python a
 * partir de las mismas series (su fórmula, en el `_leeme` del fixture).
 */
describe("con las series reales, hasta el 28-09-2026", () => {
  const TOLERANCIA_SERIE = 5e-5;
  const TOLERANCIA_CIFRA = 5e-6;
  const TOLERANCIA_VOLATILIDAD = 0.008;
  const fechas = REGISTRO.series.dates;
  const A_TRES_ANOS = "2023-09-28";
  const { rf, rv } = SERIES_HASTA_20260928;

  /* Las fórmulas del generador (priceMetricsCalculator de la plataforma, borrado el 17-11-2026 con el código
     heredado): diario, varianza muestral × 252, CAGR con 365,25. */
  function cifras(serie: DatedValue[]) {
    const niveles = serie.map((p) => p.value);
    const rendimientos = niveles.slice(1).map((v, i) => v / niveles[i] - 1);
    const media = rendimientos.reduce((s, r) => s + r, 0) / rendimientos.length;
    const vol = Math.sqrt((rendimientos.reduce((s, r) => s + (r - media) ** 2, 0) / (rendimientos.length - 1)) * 252);
    const dias = (Date.parse(serie.at(-1)!.date) - Date.parse(serie[0].date)) / 86_400_000;
    let pico = -Infinity;
    let caida = 0;
    for (const v of niveles) {
      pico = Math.max(pico, v);
      caida = Math.min(caida, v / pico - 1);
    }
    return { cum: niveles.at(-1)! / niveles[0] - 1, ret: (niveles.at(-1)! / niveles[0]) ** (365.25 / dias) - 1, vol, caida };
  }

  test("las series guardadas son las de la ventana del fichero", () => {
    expect(fechas[0]).toBe(REGISTRO.fichero.first_date);
    expect(fechas.at(-1)).toBe(REGISTRO.fichero.last_date);
    expect(fechas).toHaveLength(2881);
    expect(REGISTRO.fichero.points - fechas.length).toBe(19);
  });

  test("100/0 y 0/100 son los dos fondos de la muestra del fichero", () => {
    const enRf = new Map(mezclaDeReferencia(rf, rv, { rf: 1, rv: 0 }, fechas[0]).map((p) => [p.date, p.value]));
    const enRv = new Map(mezclaDeReferencia(rf, rv, { rf: 0, rv: 1 }, fechas[0]).map((p) => [p.date, p.value]));
    let comparados = 0;
    REGISTRO.fichero.muestra.dates.forEach((fecha, i) => {
      /* Un festivo de los que el fichero tenía y la base no. */
      if (!enRf.has(fecha)) return;
      comparados += 1;
      expect(Math.abs(enRf.get(fecha)! - REGISTRO.fichero.muestra.rf[i])).toBeLessThanOrEqual(TOLERANCIA_SERIE);
      expect(Math.abs(enRv.get(fecha)! - REGISTRO.fichero.muestra.rv[i])).toBeLessThanOrEqual(TOLERANCIA_SERIE);
    });
    expect(comparados).toBeGreaterThanOrEqual(REGISTRO.fichero.muestra.dates.length - 1);
  });

  test.each(REGISTRO.fichero.profiles.filter((p) => p.weights.rf === 0 || p.weights.rv === 0).map((p) => [p.id, p] as const))(
    "%s, de un solo fondo: nada que reequilibrar, y sigue dando lo del fichero",
    (id, fichero) => {
      const pesos = BENCHMARK_PROFILES.find((p) => p.id === id)!.weights;
      expect(pesos).toEqual(fichero.weights);
      const entera = cifras(mezclaDeReferencia(rf, rv, pesos, fechas[0]));
      const tres = cifras(mezclaDeReferencia(rf, rv, pesos, A_TRES_ANOS));
      expect(Math.abs(entera.cum - fichero.cumulativeReturn)).toBeLessThanOrEqual(TOLERANCIA_CIFRA);
      expect(Math.abs(entera.ret - fichero.retFull)).toBeLessThanOrEqual(TOLERANCIA_CIFRA);
      expect(Math.abs(entera.caida - fichero.maxDrawdown)).toBeLessThanOrEqual(TOLERANCIA_CIFRA);
      expect(Math.abs(tres.ret - fichero.ret)).toBeLessThanOrEqual(TOLERANCIA_CIFRA);
      expect(Math.abs(tres.caida - fichero.maxDrawdown3y)).toBeLessThanOrEqual(TOLERANCIA_CIFRA);
      expect(Math.abs(entera.vol / fichero.volFull - 1)).toBeLessThanOrEqual(TOLERANCIA_VOLATILIDAD);
      expect(Math.abs(tres.vol / fichero.vol - 1)).toBeLessThanOrEqual(TOLERANCIA_VOLATILIDAD);
    }
  );

  test.each(REGISTRO.fichero.profiles.filter((p) => p.weights.rf > 0 && p.weights.rv > 0).map((p) => [p.id, p] as const))(
    "%s: el fichero era el reequilibrio diario, con estos mismos datos; lo que cambia es la regla",
    (_id, fichero) => {
      /* La regla de antes, escrita aquí: reproduce el fichero. */
      const pesos = fichero.weights;
      let nivel = 1;
      for (let i = 1; i < fechas.length; i += 1) {
        nivel *= 1 + pesos.rf * (rf[i].value / rf[i - 1].value - 1) + pesos.rv * (rv[i].value / rv[i - 1].value - 1);
      }
      expect(Math.abs(nivel - 1 - fichero.cumulativeReturn)).toBeLessThanOrEqual(TOLERANCIA_CIFRA);
      /* Y la de ahora da otra cosa: en 11 años, más de 15 puntos de base 100 por encima. */
      const ahora = mezclaDeReferencia(rf, rv, pesos, fechas[0]).at(-1)!.value;
      expect(ahora / 100 - 1 - fichero.cumulativeReturn).toBeGreaterThan(0.15);
    }
  );

  describe.each(Object.keys(REGISTRO.pesosFijados))("con los pesos fijados el %s: lo calculado aparte", (desde) => {
    const fechasDeLaVentana = fechas.filter((fecha) => fecha >= desde);

    test.each(BENCHMARK_PROFILES.map((p) => [p.id, p] as const))("%s, serie y caída", (id, perfil) => {
      const esperado = REGISTRO.pesosFijados[desde][id];
      const serie = mezclaDeReferencia(rf, rv, perfil.weights, desde);
      expect(serie.map((p) => p.date)).toEqual(fechasDeLaVentana);
      expect(serie[0].value).toBe(100);
      expect(serie.at(-1)!.value).toBeCloseTo(esperado.final, 8);
      expect(cifras(serie).caida).toBeCloseTo(esperado.caida, 10);
    });

    test("el mapa mide lo mismo: volatilidad semanal y rentabilidad por tiempo transcurrido", () => {
      const ventana = referenceProfilesForDates(fechasDeLaVentana, fechasDeLaVentana.map((_, i) => 100 + i / 10), SERIES_HASTA_20260928)!;
      expect(ventana.firstDate).toBe(desde);
      for (const perfil of ventana.profiles) {
        const esperado = REGISTRO.pesosFijados[desde][perfil.id];
        expect(perfil.ret).toBeCloseTo(esperado.ret, 10);
        expect(perfil.vol).toBeCloseTo(esperado.volSemanal, 10);
      }
    });
  });
});

/** Una serie semanal de viernes con un valor por semana, sin festivos. */
function viernes(desde: string, semanas: number, valor: (i: number) => number): DatedValue[] {
  const fecha = new Date(`${desde}T00:00:00Z`);
  return Array.from({ length: semanas }, (_, i) => {
    const punto = { date: fecha.toISOString().slice(0, 10), value: valor(i) };
    fecha.setUTCDate(fecha.getUTCDate() + 7);
    return punto;
  });
}

const UN_FONDO = { rf: 1, rv: 0 };
/** La referencia de un solo fondo, con esa serie: da la serie con base 100 en el primer día. */
const deUnFondo = (serie: DatedValue[]): SeriesBaseDeReferencia => ({ rf: serie, rv: serie });

describe("cartera y referencia en las mismas fechas", () => {
  test("donde la referencia no tiene dato no se arrastra: null, y base 100 en su primer dato", () => {
    const mezcla = puntos([["2026-01-06", 200], ["2026-01-08", 220]]);
    expect(referenciaEnFechas(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"], mezcla)).toEqual([null, 100, null, expect.closeTo(110, 10), null]);
  });

  test("en una serie semanal del servidor, el último dato de la referencia en esa semana", () => {
    const mezcla = puntos([["2026-01-05", 100], ["2026-01-09", 110], ["2026-01-12", 111], ["2026-01-16", 121]]);
    /* Lunes 05-01 → su viernes 09-01; lunes 12-01 → su viernes 16-01; la semana del 19-01 no tiene dato. */
    expect(referenciaEnSemanas(["2026-01-05", "2026-01-12", "2026-01-19"], mezcla)).toEqual([100, expect.closeTo(110, 10), null]);
  });

  test("se corta en la última fecha común, se rebasan las dos en la primera y se dice", () => {
    const serie = viernes("2025-01-03", 40, (i) => 100 * 1.002 ** i);
    /* La referencia empieza dos semanas más tarde y acaba tres antes. */
    const mezcla = viernes("2025-01-17", 35, (i) => 50 * 1.001 ** i);
    const c = compararEnMismasFechas(serie.map((p) => p.date), serie.map((p) => p.value), UN_FONDO, deUnFondo(mezcla))!;
    expect(c.primeraComun).toBe("2025-01-17");
    expect(c.ultimaComun).toBe(serie[36].date);
    expect(c.fechas).toHaveLength(35);
    expect(c.cortadaAlFinal).toBe(true);
    expect(c.cortadaAlInicio).toBe(true);
    expect(c.valores[0]).toBeCloseTo(100, 12);
    expect(c.referencia[0]).toBeCloseTo(100, 12);
    expect(c.valores.at(-1)).toBeCloseTo(100 * 1.002 ** 34, 8);
    expect(c.referencia.at(-1)).toBeCloseTo(100 * 1.001 ** 34, 8);
    expect(c.semanasComunes).toBe(34);
    /* Y la misma referencia en las fechas de la serie, con su índice: es lo que leen las medidas relativas. */
    expect(c.referenciaEnLaSerie).toHaveLength(40);
    expect(c.referenciaEnLaSerie.slice(0, 2)).toEqual([null, null]);
    expect(c.referenciaEnLaSerie[2]).toBe(100);
    expect(c.referenciaEnLaSerie[36]).toBeCloseTo(100 * 1.001 ** 34, 8);
    expect(c.referenciaEnLaSerie.slice(37)).toEqual([null, null, null]);
  });

  test("si la referencia llega más lejos que la cartera, no hay corte", () => {
    const serie = viernes("2025-01-03", 40, (i) => 100 + i);
    const mezcla = viernes("2025-01-03", 60, (i) => 100 + i);
    const c = compararEnMismasFechas(serie.map((p) => p.date), serie.map((p) => p.value), UN_FONDO, deUnFondo(mezcla))!;
    expect(c.cortadaAlFinal).toBe(false);
    expect(c.cortadaAlInicio).toBe(false);
    expect(c.fechas).toEqual(serie.map((p) => p.date));
  });

  test("un festivo de la referencia se salta para las dos, y el dato de después no cambia", () => {
    const fechas = diasLaborables("2025-01-06", "2025-12-19");
    const valores = fechas.map((_, i) => 100 + i);
    const mezcla = fechas.filter((f) => f !== "2025-04-18").map((date, i) => ({ date, value: 100 + 2 * i }));
    const c = compararEnMismasFechas(fechas, valores, UN_FONDO, deUnFondo(mezcla))!;
    expect(c.fechas).not.toContain("2025-04-18");
    expect(c.fechas).toHaveLength(fechas.length - 1);
    expect(c.cortadaAlFinal).toBe(false);
  });

  test("si el primer día de la cartera es festivo para la referencia, los pesos se fijan ese día con su último dato", () => {
    /* La rejilla de la cartera son días laborables: empieza el viernes 18-04-2025, y los fondos no publican. Ni se corta ni se aplaza. */
    const fechas = diasLaborables("2025-04-18", "2025-12-19");
    const dias = diasLaborables("2025-04-10", "2025-12-19").filter((f) => f !== "2025-04-18");
    const rf = dias.map((date) => ({ date, value: 100 }));
    const rv = dias.map((date, i) => ({ date, value: 100 + i }));
    const c = compararEnMismasFechas(fechas, fechas.map((_, i) => 100 + i), MITAD, { rf, rv })!;
    expect(c.primeraComun).toBe("2025-04-18");
    expect(c.cortadaAlInicio).toBe(false);
    expect(c.fechas).toHaveLength(fechas.length);
    expect(c.referencia[0]).toBe(100);
    /* El jueves 17 la renta variable vale 105 y el lunes 21, 106; la renta fija no se mueve. El lunes: 100 × (0,5 + 0,5 × 106 / 105). */
    expect(rv.find((p) => p.date === "2025-04-17")?.value).toBe(105);
    expect(rv.find((p) => p.date === "2025-04-21")?.value).toBe(106);
    expect(c.referencia[1]).toBeCloseTo(100 * (0.5 + (0.5 * 106) / 105), 10);
  });

  test("cada comparación mezcla desde su primer día: una ventana más corta no es la larga cortada", () => {
    /* Renta fija plana y renta variable al +1 % semanal. Con 50/50 fijados en la semana k, en la semana i vale 100 × (0,5 + 0,5 × 1,01^(i−k)). */
    const rf = viernes("2024-01-05", 80, () => 100);
    const rv = viernes("2024-01-05", 80, (i) => 100 * 1.01 ** i);
    const series = { rf, rv };
    const larga = compararEnMismasFechas(rv.map((p) => p.date), rv.map((p) => p.value), MITAD, series)!;
    const corta = compararEnMismasFechas(rv.slice(20).map((p) => p.date), rv.slice(20).map((p) => p.value), MITAD, series)!;
    expect(larga.primeraComun).toBe(rv[0].date);
    expect(corta.primeraComun).toBe(rv[20].date);
    expect(larga.referencia.at(-1)).toBeCloseTo(100 * (0.5 + 0.5 * 1.01 ** 79), 8);
    expect(corta.referencia[0]).toBe(100);
    expect(corta.referencia.at(-1)).toBeCloseTo(100 * (0.5 + 0.5 * 1.01 ** 59), 8);
    /* La larga cortada en la semana 20 sería otra cifra: ahí su renta variable ya pesa más de la mitad. */
    const cortada = ((0.5 + 0.5 * 1.01 ** 79) / (0.5 + 0.5 * 1.01 ** 20)) * 100;
    expect(cortada - corta.referencia.at(-1)!).toBeGreaterThan(1);
  });

  test(`con menos de ${MIN_SEMANAS_COMUNES} semanas en común no se compara`, () => {
    const serie = viernes("2025-01-03", 60, (i) => 100 + i);
    const fechas = serie.map((p) => p.date);
    const valores = serie.map((p) => p.value);
    expect(compararEnMismasFechas(fechas, valores, UN_FONDO, deUnFondo(serie.slice(0, MIN_SEMANAS_COMUNES)))).toBeNull();
    expect(compararEnMismasFechas(fechas, valores, UN_FONDO, deUnFondo(serie.slice(0, MIN_SEMANAS_COMUNES + 1)))?.semanasComunes).toBe(MIN_SEMANAS_COMUNES);
  });

  test("sin ninguna fecha común, una sola, o sin valores, no se compara", () => {
    const serie = viernes("2025-01-03", 40, (i) => 100 + i);
    const otra = viernes("2010-01-01", 40, (i) => 100 + i);
    expect(compararEnMismasFechas(serie.map((p) => p.date), serie.map((p) => p.value), UN_FONDO, deUnFondo(otra))).toBeNull();
    expect(compararEnMismasFechas(serie.map((p) => p.date), serie.map((p) => p.value), UN_FONDO, deUnFondo(serie.slice(0, 1)))).toBeNull();
    expect(compararEnMismasFechas([], [], UN_FONDO, deUnFondo(serie))).toBeNull();
    expect(compararEnMismasFechas(serie.map((p) => p.date), serie.map(() => Number.NaN), UN_FONDO, deUnFondo(serie))).toBeNull();
  });

  test("en semanal, las fechas son los lunes de la serie y se rebasan igual", () => {
    const lunes = viernes("2025-01-06", 40, () => 0).map((p) => p.date);
    const valores = lunes.map((_, i) => 100 * 1.01 ** i);
    const mezcla = viernes("2025-01-10", 30, (i) => 80 * 1.02 ** i);
    const c = compararEnMismasFechas(lunes, valores, UN_FONDO, deUnFondo(mezcla), "WEEKLY")!;
    expect(c.fechas).toEqual(lunes.slice(0, 30));
    expect(c.cortadaAlFinal).toBe(true);
    expect(c.referencia.at(-1)).toBeCloseTo(100 * 1.02 ** 29, 8);
    expect(c.semanasComunes).toBe(29);
  });

  test("en semanal, los pesos se fijan en el último dato de la primera semana, que es el que se empareja", () => {
    /* El miércoles y el viernes de la primera semana, y los viernes de después. La renta variable pasa de 100 a 200 entre ese miércoles y ese viernes, y
       no cuenta: la base es el viernes. Con 50/50, la semana 1 vale 100 × (0,5 × 1 + 0,5 × 220 / 200) = 105. */
    const lunes = viernes("2025-01-06", 30, () => 0).map((p) => p.date);
    const rf = [{ date: "2025-01-08", value: 100 }, ...viernes("2025-01-10", 30, () => 100)];
    const rv = [{ date: "2025-01-08", value: 100 }, ...viernes("2025-01-10", 30, (i) => (i === 0 ? 200 : 220))];
    const c = compararEnMismasFechas(lunes, lunes.map((_, i) => 100 + i), MITAD, { rf, rv }, "WEEKLY")!;
    expect(c.referencia[0]).toBe(100);
    expect(c.referencia[1]).toBeCloseTo(105, 10);
  });

  test("los demás activos de un gráfico se llevan a las mismas fechas y a la misma base", () => {
    const c = { fechas: ["2026-01-06", "2026-01-08"] };
    expect(otraSerieEnLaComparacion(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"], [90, 100, 105, 120], c)).toEqual([100, 120]);
  });
});

describe("las carteras de referencia en el mapa", () => {
  /* Un fondo con +1 % y −1 % semanas alternas: varianza muestral conocida. */
  const fechas = viernes("2024-01-05", 53, () => 0).map((p) => p.date);
  const alterna = (i: number) => (i === 0 ? 0 : i % 2 === 1 ? 1 : -1);
  let nivel = 100;
  const rv = fechas.map((date, i) => {
    nivel *= 1 + alterna(i) * 0.01;
    return { date, value: nivel };
  });
  const rf = fechas.map((date) => ({ date, value: 100 }));
  const series: SeriesBaseDeReferencia = { rf, rv };
  const dias = (Date.parse(fechas[52]) - Date.parse(fechas[0])) / 86_400_000;

  test("volatilidad semanal × raíz de 52 y rentabilidad por tiempo transcurrido, a mano", () => {
    const ventana = referenceProfilesForDates(fechas, rv.map((p) => p.value), series)!;
    expect(ventana.observations).toBe(52);
    expect(ventana.mismaVentana).toBe(true);
    expect(ventana.profiles.map((p) => p.id)).toEqual(BENCHMARK_PROFILES.map((p) => p.id));
    /* 26 de +1 % y 26 de −1 %: media 0, varianza muestral 0,01² × 52 / 51. */
    const agresivo = ventana.profiles.find((p) => p.id === "agresivo")!;
    expect(agresivo.vol).toBeCloseTo(0.01 * Math.sqrt(52 / 51) * Math.sqrt(52), 10);
    expect(agresivo.ret).toBeCloseTo((1.01 * 0.99) ** (26 * (365.2425 / dias)) - 1, 10);
    /* La renta fija no se mueve. */
    expect(ventana.profiles.find((p) => p.id === "conservador")).toMatchObject({ vol: 0, ret: 0 });
    /* La mitad de cada una, con los pesos del primer día: 100 × (0,5 + 0,5 × RV(t) / RV(0)), y de ahí sus rendimientos semanales. */
    const equilibrado = ventana.profiles.find((p) => p.id === "equilibrado")!;
    const niveles = rv.map((p) => 100 * (0.5 + (0.5 * p.value) / rv[0].value));
    const rendimientos = niveles.slice(1).map((v, i) => v / niveles[i] - 1);
    const media = rendimientos.reduce((suma, r) => suma + r, 0) / rendimientos.length;
    expect(equilibrado.vol).toBeCloseTo(Math.sqrt(rendimientos.reduce((suma, r) => suma + (r - media) ** 2, 0) / 51) * Math.sqrt(52), 10);
    expect(equilibrado.ret).toBeCloseTo((niveles.at(-1)! / 100) ** (365.2425 / dias) - 1, 10);
    /* Y la cartera, igual a la renta variable, mide lo mismo. */
    expect(ventana.cartera.vol).toBeCloseTo(agresivo.vol, 10);
    expect(ventana.cartera.ret).toBeCloseTo(agresivo.ret, 10);
  });

  test("si la referencia acaba antes, se mide hasta ahí y la cartera también: ya no es la misma ventana", () => {
    const hasta = 40;
    const corta: SeriesBaseDeReferencia = { rf: rf.slice(0, hasta), rv: rv.slice(0, hasta) };
    const ventana = referenceProfilesForDates(fechas, rv.map((p) => p.value), corta)!;
    expect(ventana.mismaVentana).toBe(false);
    expect(ventana.lastDate).toBe(fechas[hasta - 1]);
    expect(ventana.observations).toBe(hasta - 1);
    const agresivo = ventana.profiles.find((p) => p.id === "agresivo")!;
    expect(ventana.cartera.ret).toBeCloseTo(agresivo.ret, 10);
  });

  test("sin solape suficiente no hay perfiles", () => {
    expect(referenceProfilesForDates(fechas, rv.map((p) => p.value), { rf: rf.slice(0, 10), rv: rv.slice(0, 10) })).toBeNull();
    expect(referenceProfilesForDates([], [], series)).toBeNull();
  });

  test("más renta variable, más volatilidad, con las series reales", () => {
    const fechasReales = diasLaborables("2023-09-29", "2026-09-25");
    const ventana = referenceProfilesForDates(fechasReales, fechasReales.map((_, i) => 100 + i / 10), SERIES_HASTA_20260928)!;
    const vols = ventana.profiles.map((p) => p.vol);
    expect([...vols].sort((a, b) => a - b)).toEqual(vols);
  });

  test("a 3 años hasta su último dato, para un informe sin serie de la cartera", () => {
    const a3 = perfilesATresAnos(SERIES_HASTA_20260928)!;
    expect(a3.lastDate).toBe("2026-09-28");
    expect(a3.profiles).toHaveLength(5);
    expect(perfilesATresAnos({ rf: [], rv: [] })).toBeNull();
  });
});

describe("qué se dice de cada cartera", () => {
  test("su composición, sin reequilibrio donde solo hay un fondo", () => {
    const de = (id: string) => BENCHMARK_PROFILES.find((p) => p.id === id)!;
    expect(composicionDeLaReferencia(de("equilibrado"))).toBe("50\u00a0% renta fija global y 50\u00a0% renta variable global, con los pesos fijados el primer día, sin reequilibrar");
    expect(composicionDeLaReferencia(de("dinamico"))).toBe("25\u00a0% renta fija global y 75\u00a0% renta variable global, con los pesos fijados el primer día, sin reequilibrar");
    expect(composicionDeLaReferencia(de("conservador"))).toBe("100\u00a0% renta fija global");
    expect(composicionDeLaReferencia(de("agresivo"))).toBe("100\u00a0% renta variable global");
    expect(composicionConFondos(de("equilibrado"))).toBe("50\u00a0% IE00B18GC888 + 50\u00a0% IE00B03HCZ61, con los pesos fijados el primer día, sin reequilibrar");
    expect(tampocoSeReequilibra(de("equilibrado"))).toBe("tampoco se reequilibra");
    expect(tampocoSeReequilibra(de("agresivo"))).toBe("no se reequilibra");
    expect(tampocoSeReequilibra(de("conservador"))).toBe("no se reequilibra");
  });

  test("cómo acaba sin reequilibrar (decisión 86): con sus palabras, del dato, y nada si es un solo fondo o falta el dato", () => {
    const de = (id: string) => BENCHMARK_PROFILES.find((p) => p.id === id)!;
    expect(pesoDeLaReferenciaAlFinal(de("equilibrado"), 0.778)).toBe("50/50 el primer día; al final, 78\u00a0% renta variable");
    expect(pesoDeLaReferenciaAlFinal(de("moderado"), 0.539)).toBe("75/25 el primer día; al final, 54\u00a0% renta variable");
    expect(pesoDeLaReferenciaAlFinal(de("dinamico"), 0.913)).toBe("25/75 el primer día; al final, 91\u00a0% renta variable");
    expect(pesoDeLaReferenciaAlFinal(de("conservador"), 0)).toBeNull();
    expect(pesoDeLaReferenciaAlFinal(de("agresivo"), 1)).toBeNull();
    expect(pesoDeLaReferenciaAlFinal(de("equilibrado"), null)).toBeNull();
    expect(pesoDeLaReferenciaAlFinal(de("equilibrado"), Number.NaN)).toBeNull();
    expect(pesoDeLaReferenciaPorVentanas(de("equilibrado"), [{ anos: 3, rentaVariable: 0.61 }, { anos: 5, rentaVariable: 0.649 }]))
      .toBe("50/50 el primer día; al final, 61\u00a0% renta variable a 3 años y 65\u00a0% a 5");
    expect(pesoDeLaReferenciaPorVentanas(de("equilibrado"), [{ anos: 3, rentaVariable: null }, { anos: 5, rentaVariable: 0.649 }]))
      .toBe("50/50 el primer día; al final, 65\u00a0% renta variable a 5 años");
    expect(pesoDeLaReferenciaPorVentanas(de("equilibrado"), [{ anos: 3, rentaVariable: null }])).toBeNull();
  });

  test("los dos fondos base siguen fuera del catálogo", () => {
    expect(isExcludedBenchmarkIsin("IE00B18GC888")).toBe(true);
    expect(isExcludedBenchmarkIsin("IE00B03HCZ61")).toBe(true);
    expect(isExcludedBenchmarkIsin("IE00B4L5Y983")).toBe(false);
  });
});

describe("la carga de las series", () => {
  const respuesta = () => ({
    dates: ["2026-01-05", "2026-01-06"],
    series: [
      { asset_id: "IE00B18GC888", display_name: "RF", values: [100, 101] },
      { asset_id: "IE00B03HCZ61", display_name: "RV", values: [100, 110] }
    ]
  });

  beforeEach(() => {
    mocks.rebased.mockReset();
    clearSessionCaches();
  });

  test("las pide a 10 años y en diario, y una sola vez por sesión", async () => {
    mocks.rebased.mockResolvedValue(respuesta());
    const [a, b] = await Promise.all([cargarSeriesDeReferencia(), cargarSeriesDeReferencia()]);
    await cargarSeriesDeReferencia();
    expect(mocks.rebased).toHaveBeenCalledTimes(1);
    expect(mocks.rebased).toHaveBeenCalledWith(["IE00B18GC888", "IE00B03HCZ61"], "10Y", "DAILY", "NONE");
    expect(a).toBe(b);
    expect(a.rf[1]).toEqual({ date: "2026-01-06", value: 101 });
    expect(a.rv[1]).toEqual({ date: "2026-01-06", value: 110 });
    clearSessionCaches();
    await cargarSeriesDeReferencia();
    expect(mocks.rebased).toHaveBeenCalledTimes(2);
  });

  test("un fallo no se guarda: la siguiente vez se vuelve a pedir", async () => {
    mocks.rebased.mockRejectedValueOnce(new Error("sin red"));
    await expect(cargarSeriesDeReferencia()).rejects.toThrow("sin red");
    mocks.rebased.mockResolvedValue(respuesta());
    await expect(cargarSeriesDeReferencia()).resolves.toBeTruthy();
  });

  test("para un PDF, un fallo es «no hay»: el informe sale y lo dice", async () => {
    mocks.rebased.mockRejectedValueOnce(new Error("sin red"));
    await expect(seriesDeReferenciaOAusencia()).resolves.toBeNull();
  });

  test("sin los dos fondos en la respuesta no hay series", () => {
    expect(() => seriesBaseDeLaRespuesta(null)).toThrow(/no disponible/);
    const sinUno = { ...respuesta(), series: respuesta().series.slice(0, 1) } as never;
    expect(() => seriesBaseDeLaRespuesta(sinUno)).toThrow(/no disponible/);
    const cojo = { ...respuesta(), series: [respuesta().series[0], { ...respuesta().series[1], values: [100] }] } as never;
    expect(() => seriesBaseDeLaRespuesta(cojo)).toThrow(/no disponible/);
  });
});

describe("decisión 86: lo que pesa la renta variable de la referencia al final de la ventana", () => {
  const rf = puntos([["2026-01-05", 100], ["2026-01-06", 101], ["2026-01-07", 102.01], ["2026-01-08", 103.0301]]);
  const rv = puntos([["2026-01-05", 200], ["2026-01-06", 220], ["2026-01-07", 198], ["2026-01-08", 217.8]]);
  const series = { rf, rv };
  const SESENTA_CUARENTA = { rf: 0.6, rv: 0.4 };

  test("resultado conocido, a mano: la parte de renta variable sobre el total, con los pesos fijados el primer día", () => {
    /* Desde el 05, el 08: renta fija 0,6 × 1,030301 = 0,6181806 y renta variable 0,4 × 1,089 = 0,4356; total 1,0537806. */
    expect(rentaVariableAlFinal(series, SESENTA_CUARENTA, "2026-01-05", "2026-01-08")).toBeCloseTo(0.4356 / 1.0537806, 12);
    /* El 07: 0,4 × 0,99 = 0,396 de 1,00806. El 06: 0,4 × 1,10 = 0,44 de 1,046. */
    expect(rentaVariableAlFinal(series, SESENTA_CUARENTA, "2026-01-05", "2026-01-07")).toBeCloseTo(0.396 / 1.00806, 12);
    expect(rentaVariableAlFinal(series, SESENTA_CUARENTA, "2026-01-05", "2026-01-06")).toBeCloseTo(0.44 / 1.046, 12);
  });

  test("otra ventana, otra cifra: desde el 06, el 08 pesa 0,396 de 1,00806, no 0,4356 de 1,0537806", () => {
    /* Desde el 06: renta fija 103,0301 / 101 = 1,0201 y renta variable 217,8 / 220 = 0,99. */
    expect(rentaVariableAlFinal(series, SESENTA_CUARENTA, "2026-01-06", "2026-01-08")).toBeCloseTo(0.396 / 1.00806, 12);
    expect(pesoDeLaReferenciaAlFinal({ weights: SESENTA_CUARENTA }, rentaVariableAlFinal(series, SESENTA_CUARENTA, "2026-01-05", "2026-01-08")))
      .toBe("60/40 el primer día; al final, 41\u00a0% renta variable");
    expect(pesoDeLaReferenciaAlFinal({ weights: SESENTA_CUARENTA }, rentaVariableAlFinal(series, SESENTA_CUARENTA, "2026-01-06", "2026-01-08")))
      .toBe("60/40 el primer día; al final, 39\u00a0% renta variable");
  });

  test("el final es el último día con dato de los dos que no pasa de `hasta`; sin dos fechas, nada", () => {
    const conHueco = { rf: rf.filter((p) => p.date !== "2026-01-08"), rv };
    expect(rentaVariableAlFinal(conHueco, SESENTA_CUARENTA, "2026-01-05", "2026-01-08")).toBeCloseTo(0.396 / 1.00806, 12);
    expect(rentaVariableAlFinal(series, SESENTA_CUARENTA, "2026-01-05", "2026-01-05")).toBeNull();
    expect(rentaVariableAlFinal(series, SESENTA_CUARENTA, "2026-01-05", "2026-01-04")).toBeNull();
    expect(rentaVariableAlFinal(series, { rf: 0.6, rv: 0.6 }, "2026-01-05", "2026-01-08")).toBeNull();
    expect(rentaVariableAlFinal({ rf: [], rv: [] }, MITAD, "2026-01-05", "2026-01-08")).toBeNull();
  });

  test("la mezcla no cambia ni un decimal por calcular también su renta variable", () => {
    const mezcla = mezclaDeReferencia(rf, rv, SESENTA_CUARENTA, "2026-01-05");
    expect(mezcla[3].value).toBe(100 * ((0.6 * 103.0301) / 100 + (0.4 * 217.8) / 200));
  });

  test("contra las series reales hasta el 28-09-2026: la comparación lleva la misma cifra que la fórmula, aparte, en cada ventana", () => {
    const { rf: fondoRf, rv: fondoRv } = SERIES_HASTA_20260928;
    const valorEn = (serie: DatedValue[], fecha: string) => serie.filter((p) => p.date <= fecha).at(-1)!.value;
    for (const anos of [3, 5, 10]) {
      const desde = `${2026 - anos}-09-28`;
      const fechas = fondoRf.filter((p) => p.date >= desde).map((p) => p.date);
      const valores = fechas.map((_, i) => 100 + i);
      for (const perfil of BENCHMARK_PROFILES.filter((p) => p.weights.rf > 0 && p.weights.rv > 0)) {
        const c = compararEnMismasFechas(fechas, valores, perfil.weights, SERIES_HASTA_20260928)!;
        const partRf = (perfil.weights.rf * valorEn(fondoRf, c.ultimaComun)) / valorEn(fondoRf, c.primeraComun);
        const partRv = (perfil.weights.rv * valorEn(fondoRv, c.ultimaComun)) / valorEn(fondoRv, c.primeraComun);
        expect(c.rentaVariableAlFinal).toBeCloseTo(partRv / (partRf + partRv), 12);
        /* Sin reequilibrar, la renta variable acaba por encima de la del nombre: la de estos años subió más que la renta fija. */
        expect(c.rentaVariableAlFinal!).toBeGreaterThan(perfil.weights.rv);
      }
    }
  });

  test("en semanal, el final es el último día de la referencia en la semana que se compara", () => {
    const { rf: fondoRf, rv: fondoRv } = SERIES_HASTA_20260928;
    const lunes = fondoRf.filter((p) => p.date >= "2023-09-25" && new Date(`${p.date}T00:00:00Z`).getUTCDay() === 1).map((p) => p.date);
    const c = compararEnMismasFechas(lunes, lunes.map((_, i) => 100 + i), MITAD, SERIES_HASTA_20260928, "WEEKLY")!;
    expect(c.ultimaComun).toBe("2026-09-28");
    /* A mano: el primer día de la mezcla es el último dato de la referencia en la semana del primer lunes, y el final, el último
       en la semana del último lunes, que acaba el domingo 04-10-2026. */
    const ultimoDeLaSemana = (lunesDeLaSemana: string, domingo: string) => fondoRf.filter((p) => p.date >= lunesDeLaSemana && p.date <= domingo).at(-1)!.date;
    const inicio = ultimoDeLaSemana(lunes[0], "2023-10-01");
    const fin = ultimoDeLaSemana("2026-09-28", "2026-10-04");
    const valorEn = (serie: DatedValue[], fecha: string) => serie.find((p) => p.date === fecha)!.value;
    const partRf = (0.5 * valorEn(fondoRf, fin)) / valorEn(fondoRf, inicio);
    const partRv = (0.5 * valorEn(fondoRv, fin)) / valorEn(fondoRv, inicio);
    expect(c.rentaVariableAlFinal).toBeCloseTo(partRv / (partRf + partRv), 12);
  });
});
