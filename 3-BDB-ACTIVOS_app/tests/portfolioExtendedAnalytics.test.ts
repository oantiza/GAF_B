import { describe, expect, test } from "vitest";
import {
  benchmarkRelativeStats,
  calendarYearReturns,
  calmarRatio,
  concentrationStats,
  drawdownEpisodes,
  historicalTailRisk,
  periodExtremes,
  rollingStats,
  sortinoRatio
} from "../src/core/portfolioExtendedAnalytics";
import { compararEnMismasFechas, mezclaDeReferencia, referenciaEnFechas } from "../src/core/benchmarkProfiles";
import { diasLaborables, SERIES_HASTA_20260928 } from "./support/referenciaDePrueba";

/** Serie diaria de días laborables con un rendimiento diario por día. */
function dailySeries(start: string, days: number, dailyReturn: (i: number) => number, base = 100) {
  const out: Array<{ date: string; value: number }> = [];
  const d = new Date(`${start}T00:00:00Z`);
  let value = base;
  let i = 0;
  while (out.length < days) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      if (out.length > 0) value *= 1 + dailyReturn(i++);
      out.push({ date: d.toISOString().slice(0, 10), value });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("rentabilidad por años naturales", () => {
  test("años completos con base en el cierre anterior y parciales marcados", () => {
    const series = [
      { date: "2023-06-30", value: 100 },
      { date: "2023-12-29", value: 110 },
      { date: "2024-06-28", value: 99 },
      { date: "2024-12-31", value: 121 },
      { date: "2025-03-31", value: 133.1 }
    ];
    const bench = [100, 105, 100, 110, null];
    const rows = calendarYearReturns(series, bench);
    expect(rows.map((r) => r.year)).toEqual([2023, 2024, 2025]);
    expect(rows[0]).toMatchObject({ partial: true, from: "2023-06-30", to: "2023-12-29" });
    expect(rows[0].portfolio).toBeCloseTo(0.1, 10);
    expect(rows[1]).toMatchObject({ partial: false, from: "2023-12-29", to: "2024-12-31" });
    expect(rows[1].portfolio).toBeCloseTo(0.1, 10);
    expect(rows[1].benchmark).toBeCloseTo(110 / 105 - 1, 10);
    expect(rows[2].partial).toBe(true);
    expect(rows[2].benchmark).toBeNull();
  });

  test("sin datos suficientes no inventa años", () => {
    expect(calendarYearReturns([{ date: "2024-01-02", value: 100 }])).toEqual([]);
  });
});

describe("relativo al benchmark", () => {
  test("una cartera que es 2× el benchmark tiene beta 2, correlación 1 y captura 2", () => {
    const bench = dailySeries("2023-01-02", 520, (i) => (i % 7 === 0 ? -0.004 : 0.0015) + Math.sin(i) * 0.002);
    const port = bench.map((p, i) => ({ date: p.date, value: i === 0 ? 100 : 0 }));
    for (let i = 1; i < bench.length; i++) port[i].value = port[i - 1].value * (1 + 2 * (bench[i].value / bench[i - 1].value - 1));
    // la beta se mide en semanal: con rendimientos diarios 2× la semanal no es exactamente 2×
    const stats = benchmarkRelativeStats(port, bench.map((p) => p.value), 0.02)!;
    expect(stats).not.toBeNull();
    expect(stats.correlation).toBeGreaterThan(0.99);
    expect(stats.beta).toBeGreaterThan(1.9);
    expect(stats.beta).toBeLessThan(2.1);
    expect(stats.upCapture!).toBeGreaterThan(1.8);
    expect(stats.downCapture!).toBeGreaterThan(1.8);
    expect(stats.trackingError).toBeGreaterThan(0);
  });

  test("la misma serie: beta 1, tracking error 0, sin ratio de información", () => {
    const s = dailySeries("2023-01-02", 400, (i) => Math.sin(i / 3) * 0.004);
    const stats = benchmarkRelativeStats(s, s.map((p) => p.value), 0.02)!;
    expect(stats.beta).toBeCloseTo(1, 10);
    expect(stats.trackingError).toBeCloseTo(0, 12);
    expect(stats.informationRatio).toBeNull();
    expect(stats.activeReturn).toBeCloseTo(0, 12);
    expect(stats.jensenAlpha).toBeCloseTo(0, 10);
  });

  test("sin benchmark o con poca historia devuelve null", () => {
    const s = dailySeries("2024-01-01", 60, () => 0.001);
    expect(benchmarkRelativeStats(s, null, 0.02)).toBeNull();
    expect(benchmarkRelativeStats(s, s.map((p) => p.value), 0.02)).toBeNull();
  });
});

/**
 * Decisión 1 de Óscar: cartera y benchmark en las mismas fechas. Con el benchmark arrastrado desde una muestra de
 * lunes, la semana de la cartera iba de viernes a viernes y la suya de lunes a lunes, y el papel decía beta 0,25,
 * correlación 0,24, tracking error 9,4 % y captura bajista 0 % de una cartera que se mueve con él.
 */
describe("cartera y benchmark en las mismas fechas (decisión 1)", () => {
  /* La rejilla de la cartera son todos los días laborables, festivos incluidos: `portfolio_horizon._backtest`. */
  const fechasDeLaCartera = diasLaborables("2023-09-29", "2026-09-25");
  const MITAD = { rf: 0.5, rv: 0.5 };
  const mezcla = mezclaDeReferencia(SERIES_HASTA_20260928.rf, SERIES_HASTA_20260928.rv, MITAD, fechasDeLaCartera[0]);
  const porFecha = new Map(mezcla.map((p) => [p.date, p.value]));

  /** Una cartera igual a su benchmark: los festivos repiten el valor anterior, como en la rejilla de la cartera. */
  function carteraIgualAlBenchmark() {
    let ultimo = 0;
    return fechasDeLaCartera.map((date) => {
      ultimo = porFecha.get(date) ?? ultimo;
      return { date, value: ultimo };
    });
  }

  test("una cartera igual a su referencia da beta 1, correlación 1 y tracking error 0, con sus series reales", () => {
    const cartera = carteraIgualAlBenchmark();
    const stats = benchmarkRelativeStats(cartera, referenciaEnFechas(fechasDeLaCartera, mezcla), 0.02)!;
    expect(stats.beta).toBeCloseTo(1, 10);
    expect(stats.correlation).toBeCloseTo(1, 10);
    expect(stats.trackingError).toBeCloseTo(0, 10);
    expect(stats.activeReturn).toBeCloseTo(0, 10);
    expect(stats.jensenAlpha).toBeCloseTo(0, 10);
    expect(stats.upCapture).toBeCloseTo(1, 10);
    expect(stats.downCapture).toBeCloseTo(1, 10);
    expect(stats.informationRatio).toBeNull();
  });

  test("con el benchmark a un dato por semana arrastrado salía lo que decía el papel; en las mismas fechas, no", () => {
    /* Lo que hacía el fichero: un dato cada lunes y, para el resto de la semana, ese mismo valor. */
    const cartera = carteraIgualAlBenchmark();
    const lunes = mezcla.filter((p) => new Date(`${p.date}T00:00:00Z`).getUTCDay() === 1);
    let j = 0;
    const arrastrado = fechasDeLaCartera.map((fecha) => {
      while (j + 1 < lunes.length && lunes[j + 1].date <= fecha) j += 1;
      return lunes[j].date <= fecha ? lunes[j].value : null;
    });
    const mal = benchmarkRelativeStats(cartera, arrastrado, 0.02)!;
    /* Es la misma serie, y aun así ni se parece: es el error antiguo. */
    expect(mal.correlation).toBeLessThan(0.5);
    expect(mal.beta).toBeLessThan(0.5);
    expect(mal.trackingError).toBeGreaterThan(0.05);

    /* Con esa misma muestra de lunes, pero sin arrastrar: las dos se miden de lunes a lunes. */
    const bien = benchmarkRelativeStats(cartera, referenciaEnFechas(fechasDeLaCartera, lunes), 0.02)!;
    expect(bien.correlation).toBeCloseTo(1, 10);
    expect(bien.beta).toBeCloseTo(1, 10);
    expect(bien.trackingError).toBeCloseTo(0, 10);
  });

  test("dos series conocidas: beta, correlación, tracking error, capturas y alfa, calculados a mano", () => {
    /* 28 semanas: el benchmark +2 % y −1 % alternos; la cartera, 0,5 × benchmark + 0,1 %. O sea +1,1 % y −0,4 %.
       Beta 0,5 y correlación 1 por construcción. La diferencia semanal es −0,9 % y +0,6 %: media −0,15 %, cada
       semana a 0,75 % de la media, varianza muestral 0,0075² × 28 / 27. Capturas: 1,1 / 2 = 0,55 y 0,4 / 1 = 0,4. */
    const fechas = Array.from({ length: 29 }, (_, i) => {
      const d = new Date("2025-01-03T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 7 * i);
      return d.toISOString().slice(0, 10);
    });
    let b = 100;
    let p = 100;
    const bench: number[] = [];
    const cartera = fechas.map((date, i) => {
      if (i > 0) {
        const rb = i % 2 === 1 ? 0.02 : -0.01;
        b *= 1 + rb;
        p *= 1 + 0.5 * rb + 0.001;
      }
      bench.push(b);
      return { date, value: p };
    });
    const stats = benchmarkRelativeStats(cartera, bench, 0.02)!;
    expect(stats.observations).toBe(28);
    expect(stats.beta).toBeCloseTo(0.5, 10);
    expect(stats.correlation).toBeCloseTo(1, 10);
    expect(stats.trackingError).toBeCloseTo(0.0075 * Math.sqrt(28 / 27) * Math.sqrt(52), 10);
    expect(stats.upCapture).toBeCloseTo(0.55, 10);
    expect(stats.downCapture).toBeCloseTo(0.4, 10);
    /* 14 semanas de cada: 28 semanas son 196 días. */
    const anual = 365.2425 / 196;
    const rbAnual = (1.02 * 0.99) ** (14 * anual) - 1;
    const rpAnual = (1.011 * 0.996) ** (14 * anual) - 1;
    expect(stats.benchmarkReturn).toBeCloseTo(rbAnual, 10);
    expect(stats.portfolioReturn).toBeCloseTo(rpAnual, 10);
    expect(stats.activeReturn).toBeCloseTo(rpAnual - rbAnual, 10);
    expect(stats.jensenAlpha).toBeCloseTo(rpAnual - (0.02 + 0.5 * (rbAnual - 0.02)), 10);
  });

  test("en una semana con festivo las dos se miden en la misma última fecha, no el viernes una y el jueves la otra", () => {
    /* El viernes 18-04-2025 no tiene dato de los fondos: las dos cierran esa semana el jueves. */
    const cartera = carteraIgualAlBenchmark();
    expect(porFecha.has("2025-04-18")).toBe(false);
    const stats = benchmarkRelativeStats(cartera, referenciaEnFechas(fechasDeLaCartera, mezcla), 0.02)!;
    expect(stats.trackingError).toBeCloseTo(0, 10);
  });

  test("la comparación corta en la última fecha común y las medidas no pasan de ahí", () => {
    const cartera = carteraIgualAlBenchmark();
    const hasta = "2026-03-27";
    const hastaEsaFecha = (serie: typeof SERIES_HASTA_20260928.rf) => serie.filter((p) => p.date <= hasta);
    const c = compararEnMismasFechas(fechasDeLaCartera, cartera.map((p) => p.value), MITAD, { rf: hastaEsaFecha(SERIES_HASTA_20260928.rf), rv: hastaEsaFecha(SERIES_HASTA_20260928.rv) })!;
    expect(c.ultimaComun).toBe(hasta);
    expect(c.cortadaAlFinal).toBe(true);
    const stats = benchmarkRelativeStats(cartera, c.referenciaEnLaSerie, 0.02, { portfolioCagr: 0.9 })!;
    /* No cubre la serie entera: el CAGR del periodo no vale, y se mide en el tramo común. */
    expect(stats.portfolioReturn).not.toBe(0.9);
    expect(stats.activeReturn).toBeCloseTo(0, 10);
  });

  test("por años naturales, cartera y benchmark entre las mismas dos fechas", () => {
    /* El benchmark no tiene dato el último día de 2024: las dos cierran el año el día anterior común. */
    const series = [
      { date: "2023-12-29", value: 100 },
      { date: "2024-12-30", value: 110 },
      { date: "2024-12-31", value: 120 },
      { date: "2025-12-31", value: 132 }
    ];
    const rows = calendarYearReturns(series, [50, 55, null, 66]);
    const de2024 = rows.find((r) => r.year === 2024)!;
    expect(de2024.to).toBe("2024-12-30");
    expect(de2024.portfolio).toBeCloseTo(0.1, 10);
    expect(de2024.benchmark).toBeCloseTo(0.1, 10);
    const de2025 = rows.find((r) => r.year === 2025)!;
    expect(de2025.from).toBe("2024-12-30");
    expect(de2025.portfolio).toBeCloseTo(132 / 110 - 1, 10);
    expect(de2025.benchmark).toBeCloseTo(66 / 55 - 1, 10);
  });

  test("un año sin ninguna fecha común: la cartera sola y el benchmark sin dato, sin inventarlo", () => {
    const series = [
      { date: "2024-12-30", value: 100 },
      { date: "2025-12-30", value: 110 },
      { date: "2026-06-30", value: 121 }
    ];
    const rows = calendarYearReturns(series, [50, 55, null]);
    const de2026 = rows.find((r) => r.year === 2026)!;
    expect(de2026.benchmark).toBeNull();
    expect(de2026.portfolio).toBeCloseTo(0.1, 10);
  });
});

describe("riesgo de cola y ratios", () => {
  test("VaR 95 y CVaR sobre rendimientos semanales; CVaR ≤ VaR", () => {
    const s = dailySeries("2022-01-03", 800, (i) => Math.sin(i * 1.7) * 0.01);
    const [var95, var99] = historicalTailRisk(s);
    expect(var95.level).toBe(0.95);
    expect(var95.valueAtRisk).toBeLessThan(0);
    expect(var95.conditionalValueAtRisk).toBeLessThanOrEqual(var95.valueAtRisk);
    expect(var99.valueAtRisk).toBeLessThanOrEqual(var95.valueAtRisk);
  });

  test("menos de un año de semanas no da VaR", () => {
    expect(historicalTailRisk(dailySeries("2024-01-01", 200, () => 0.001))).toEqual([]);
  });

  test("Sortino usa la rentabilidad del backend y no existe sin caídas", () => {
    const up = dailySeries("2023-01-02", 400, () => 0.0005);
    expect(sortinoRatio(up, 0.12, 0.02)).toBeNull();
    const wavy = dailySeries("2023-01-02", 400, (i) => Math.sin(i / 2) * 0.006);
    expect(sortinoRatio(wavy, 0.05, 0.02)).not.toBeNull();
  });

  test("Calmar con la caída del backend; sin caída no hay ratio", () => {
    expect(calmarRatio(0.06, -0.12)).toBeCloseTo(0.5, 12);
    expect(calmarRatio(0.06, 0)).toBeNull();
  });
});

describe("episodios de caída", () => {
  test("ordena por profundidad, separa episodios y marca el no recuperado", () => {
    const s = [
      { date: "2024-01-01", value: 100 }, { date: "2024-02-01", value: 90 }, { date: "2024-03-01", value: 101 },
      { date: "2024-04-01", value: 80.8 }, { date: "2024-05-01", value: 102 }, { date: "2024-06-01", value: 96.9 }
    ];
    const ep = drawdownEpisodes(s);
    expect(ep).toHaveLength(3);
    expect(ep[0]).toMatchObject({ peakDate: "2024-03-01", troughDate: "2024-04-01", recoveryDate: "2024-05-01" });
    expect(ep[0].depth).toBeCloseTo(-0.2, 10);
    expect(ep[1]).toMatchObject({ peakDate: "2024-01-01", troughDate: "2024-02-01", recoveryDate: "2024-03-01" });
    expect(ep[2]).toMatchObject({ peakDate: "2024-05-01", recoveryDate: null, recoveryDays: null });
  });
});

describe("móviles, extremos y concentración", () => {
  test("ventana móvil de un año: crecimiento constante da su rentabilidad anual y volatilidad ~0", () => {
    const weekly = Array.from({ length: 80 }, (_, i) => ({
      date: new Date(Date.UTC(2023, 0, 6 + i * 7)).toISOString().slice(0, 10), value: 100 * 1.002 ** i }));
    const rolling = rollingStats(weekly);
    expect(rolling).toHaveLength(80 - 52);
    expect(rolling[0].return).toBeCloseTo(1.002 ** 52 - 1, 10);
    expect(rolling[0].volatility).toBeCloseTo(0, 10);
  });

  test("mejor y peor semana y mes", () => {
    const s = dailySeries("2024-01-01", 130, (i) => (i === 40 ? -0.05 : i === 80 ? 0.04 : 0.0003));
    const ext = periodExtremes(s);
    expect(ext.worstWeek!.value).toBeLessThan(-0.04);
    expect(ext.bestWeek!.value).toBeGreaterThan(0.035);
    expect(ext.positiveWeeksShare).toBeGreaterThan(0.8);
    expect(ext.months).toBeGreaterThan(4);
  });

  test("HHI y número efectivo de posiciones", () => {
    const c = concentrationStats([25, 25, 25, 25])!;
    expect(c.hhi).toBeCloseTo(0.25, 12);
    expect(c.effectivePositions).toBeCloseTo(4, 12);
    expect(c.top1).toBeCloseTo(0.25, 12);
    const skew = concentrationStats([70, 10, 10, 10, 0])!;
    expect(skew.positions).toBe(4);
    expect(skew.effectivePositions).toBeLessThan(2);
    expect(concentrationStats([])).toBeNull();
  });
});

/** Serie semanal de viernes a partir de `start` (un viernes); `skip` quita semanas (huecos). */
function fridays(start: string, count: number, value: (i: number) => number, skip: (i: number) => boolean = () => false) {
  const out: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < count; i++) {
    if (skip(i)) continue;
    out.push({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10), value: value(i) });
  }
  return out;
}

describe("huecos semanales y la rentabilidad del bloque relativo (ALTA-14)", () => {
  const wave = (i: number) => 100 * 1.002 ** i * (1 + 0.01 * Math.sin(i / 2));

  test("un salto de varias semanas no cuenta como una semana: beta 1 y tracking error 0 si solo difiere en el hueco", () => {
    // La cartera replica al benchmark salvo en el hueco (semanas 30-33), donde gana un 10 %.
    const gap = (i: number) => i >= 30 && i <= 33;
    const bench = fridays("2024-01-05", 80, wave, gap);
    const port = bench.map((p) => ({ date: p.date, value: p.value * (Date.parse(p.date) > Date.parse("2024-08-02") ? 1.1 : 1) }));
    const stats = benchmarkRelativeStats(port, bench.map((p) => p.value), 0.02)!;
    expect(stats).not.toBeNull();
    expect(stats.beta).toBeCloseTo(1, 10);
    expect(stats.trackingError).toBeCloseTo(0, 12);
    // 76 observaciones → 75 saltos, de los que uno (el hueco de 5 semanas) no es semanal.
    expect(stats.observations).toBe(74);
    // Anualizada por el tiempo transcurrido (79 semanas = 553 días), no por 75 «semanas» contadas.
    const first = port[0].value;
    const last = port[port.length - 1].value;
    expect(stats.portfolioReturn).toBeCloseTo((last / first) ** (365.2425 / 553) - 1, 12);
    expect(Math.abs(stats.portfolioReturn - ((last / first) ** (52 / 75) - 1))).toBeGreaterThan(1e-3);
    expect(stats.activeReturn).toBeCloseTo(stats.portfolioReturn - stats.benchmarkReturn, 12);
  });

  test("la anualización es la del CAGR del backtest del periodo: días / 365,2425 entre los extremos", () => {
    // Serie diaria: el remuestreo semanal empieza el viernes, pero la rentabilidad se mide desde el primer día.
    const bench = dailySeries("2023-01-04", 400, (i) => Math.sin(i / 5) * 0.004 + 0.0003);
    const port = bench.map((p, i) => ({ date: p.date, value: p.value * (1 + 0.0002 * i) }));
    const stats = benchmarkRelativeStats(port, bench.map((p) => p.value), 0.02)!;
    const days = (Date.parse(port[399].date) - Date.parse(port[0].date)) / 86_400_000;
    expect(stats.portfolioReturn).toBeCloseTo((port[399].value / port[0].value) ** (365.2425 / days) - 1, 12);
    expect(stats.benchmarkReturn).toBeCloseTo((bench[399].value / bench[0].value) ** (365.2425 / days) - 1, 12);
  });

  test("con la misma ventana, la rentabilidad de la cartera es el CAGR del backtest; si no, se mide", () => {
    const bench = fridays("2024-01-05", 60, wave);
    const port = bench.map((p, i) => ({ date: p.date, value: p.value * (1 + 0.0005 * i) }));
    const benchValues = bench.map((p) => p.value);
    const same = benchmarkRelativeStats(port, benchValues, 0.02, { portfolioCagr: 0.0123 })!;
    expect(same.portfolioReturn).toBe(0.0123);
    expect(same.activeReturn).toBeCloseTo(0.0123 - same.benchmarkReturn, 12);
    // El benchmark empieza más tarde: la ventana común ya no es la del backtest y se mide sobre ella.
    const late = benchmarkRelativeStats(port, benchValues.map((v, i) => (i < 4 ? null : v)), 0.02, { portfolioCagr: 0.0123 })!;
    expect(late.portfolioReturn).not.toBe(0.0123);
    expect(late.portfolioReturn).toBeCloseTo((port[59].value / port[4].value) ** (365.2425 / (55 * 7)) - 1, 12);
    // Un hueco intermedio no cambia los extremos: el CAGR (por tiempo transcurrido) sigue valiendo.
    const keep = port.map((_, i) => i !== 20);
    const holedStats = benchmarkRelativeStats(port.filter((_, i) => keep[i]), benchValues.filter((_, i) => keep[i]), 0.02, { portfolioCagr: 0.0123 })!;
    expect(holedStats.portfolioReturn).toBe(0.0123);
    expect(holedStats.observations).toBe(57);
  });

  test("VaR, Sortino, extremos y móviles ignoran el salto de un hueco", () => {
    // Serie suave con un hueco de 6 semanas en el que el valor sube un 30 %.
    const gap = (i: number) => i >= 40 && i <= 45;
    const smooth = fridays("2023-01-06", 140, (i) => 100 * (1 + 0.003 * Math.sin(i)) * (i > 45 ? 1.3 : 1), gap);
    const ext = periodExtremes(smooth);
    expect(ext.bestWeek!.value).toBeLessThan(0.05);
    expect(ext.weeks).toBe(smooth.length - 2);
    const [var95] = historicalTailRisk(smooth);
    expect(var95.valueAtRisk).toBeGreaterThan(-0.05);
    // Móvil de un año: solo hay punto cuando existe la observación de exactamente 52 semanas antes.
    const week = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / (7 * 86_400_000));
    const weeks = new Set(smooth.map((p) => week(p.date)));
    const rolling = rollingStats(smooth);
    expect(rolling.length).toBe(smooth.filter((p) => weeks.has(week(p.date) - 52)).length);
    expect(rolling.every((r) => weeks.has(week(r.date) - 52))).toBe(true);
    expect(rolling.every((r) => r.volatility < 0.1)).toBe(true);
    expect(sortinoRatio(smooth, 0.05, 0.02)).not.toBeNull();
  });

  test("el mejor mes no puede ser un salto de varios meses", () => {
    const s = [
      { date: "2024-01-31", value: 100 }, { date: "2024-02-29", value: 101 }, { date: "2024-03-29", value: 102 },
      { date: "2024-07-31", value: 140 }, { date: "2024-08-30", value: 141 }
    ];
    const ext = periodExtremes(s);
    expect(ext.months).toBe(3);
    expect(ext.bestMonth!.month).not.toBe("2024-07");
  });
});

describe("año natural completo con series semanales y festivos", () => {
  test("el último cierre del 23-12 seguido del 2-1 no hace parcial el año", () => {
    const series = [
      { date: "2024-12-27", value: 100 }, { date: "2025-06-27", value: 104 }, { date: "2025-12-23", value: 110 },
      { date: "2026-01-02", value: 111 }, { date: "2026-03-27", value: 115 }
    ];
    const rows = calendarYearReturns(series);
    expect(rows.find((r) => r.year === 2025)).toMatchObject({ partial: false, from: "2024-12-27", to: "2025-12-23" });
    expect(rows.find((r) => r.year === 2026)?.partial).toBe(true);
  });

  test("si la serie se corta a mitad de diciembre, el año sí es parcial", () => {
    const series = [{ date: "2024-12-27", value: 100 }, { date: "2025-12-12", value: 105 }];
    expect(calendarYearReturns(series).find((r) => r.year === 2025)?.partial).toBe(true);
  });

  test("la base del año anterior también tiene que estar cerca del 31-12: lejos y con hueco, parcial", () => {
    // Base 28-06-2024 y primera observación de 2025 en marzo: el tramo no es el año 2025.
    const holed = [
      { date: "2024-06-28", value: 100 }, { date: "2025-03-07", value: 104 }, { date: "2025-12-31", value: 110 }, { date: "2026-01-02", value: 111 }
    ];
    expect(calendarYearReturns(holed).find((r) => r.year === 2025)).toMatchObject({ partial: true, from: "2024-06-28" });
    // Base 23-12 sin hueco hasta el 2-1 (semanas ISO seguidas) y cierre 31-12: completo.
    const contiguous = [
      { date: "2024-12-27", value: 100 }, { date: "2025-12-23", value: 104 }, { date: "2026-01-02", value: 105 },
      { date: "2026-12-31", value: 110 }, { date: "2027-01-08", value: 111 }
    ];
    expect(calendarYearReturns(contiguous).find((r) => r.year === 2026)).toMatchObject({ partial: false, from: "2025-12-23" });
    // Base 12-12 con cuatro semanas de hueco hasta el 9-1: parcial.
    const lateStart = [
      { date: "2025-12-12", value: 100 }, { date: "2026-01-09", value: 101 }, { date: "2026-12-31", value: 108 }
    ];
    expect(calendarYearReturns(lateStart).find((r) => r.year === 2026)?.partial).toBe(true);
  });
});
