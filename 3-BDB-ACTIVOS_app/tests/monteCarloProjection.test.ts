import { describe, expect, test } from "vitest";
import {
  buildMonteCarloProjection,
  monteCarloAvailability,
  monteCarloMinObservations
} from "../src/core/monteCarloProjection";

/** Fechas semanales consecutivas desde 2022-01-03 (lunes). */
function weeklyDate(index: number): string {
  const base = Date.UTC(2022, 0, 3);
  return new Date(base + index * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** Fechas diarias consecutivas desde 2022-01-03. */
function dailyDate(index: number): string {
  const base = Date.UTC(2022, 0, 3);
  return new Date(base + index * 86_400_000).toISOString().slice(0, 10);
}

// 3 años semanales exigen 156 rentabilidades: 157 observaciones.
const weekly3y = Array.from({ length: 161 }, (_, index) => ({
  date: weeklyDate(index),
  value: 100 * 1.001 ** index
}));

// 1 año diario exige 252 rentabilidades: 253 observaciones.
const daily1y = Array.from({ length: 260 }, (_, index) => ({
  date: dailyDate(index),
  value: 100 * 1.0004 ** index
}));

describe("Monte Carlo projection", () => {
  test("construye un cono semanal de tres años desde el último nivel", () => {
    const result = buildMonteCarloProjection(weekly3y, "WEEKLY", 3);
    expect(result).not.toBeNull();
    expect(result?.points).toHaveLength(157);
    expect(result?.points[0].p50).toBeCloseTo(weekly3y[weekly3y.length - 1].value);
    expect(result?.points.at(-1)?.p50).toBeGreaterThan(result?.points[0].p50 ?? 0);
  });

  test("mantiene los percentiles ordenados y rechaza series insuficientes", () => {
    const result = buildMonteCarloProjection(daily1y, "DAILY", 1);
    expect(result).not.toBeNull();
    const terminal = result?.points.at(-1);
    expect(terminal?.p5).toBeLessThanOrEqual(terminal?.p25 ?? 0);
    expect(terminal?.p25).toBeLessThanOrEqual(terminal?.p50 ?? 0);
    expect(terminal?.p50).toBeLessThanOrEqual(terminal?.p75 ?? 0);
    expect(terminal?.p75).toBeLessThanOrEqual(terminal?.p95 ?? 0);
    expect(buildMonteCarloProjection(weekly3y.slice(0, 7), "WEEKLY", 3)).toBeNull();
  });

  test("Ola 1.1: la ventana de estimación tiene que cubrir el horizonte proyectado", () => {
    // Con 52 semanas de historia se puede proyectar un año, no tres: proyectar
    // tres años con un año de datos es extrapolar el triple de lo observado.
    expect(monteCarloMinObservations("WEEKLY", 3)).toBe(156);
    expect(monteCarloMinObservations("WEEKLY", 1)).toBe(52);
    expect(monteCarloMinObservations("DAILY", 1)).toBe(252);
    const oneYearOfWeeks = weekly3y.slice(0, 60);
    expect(buildMonteCarloProjection(oneYearOfWeeks, "WEEKLY", 1)).not.toBeNull();
    expect(buildMonteCarloProjection(oneYearOfWeeks, "WEEKLY", 3)).toBeNull();
    // La misma historia medida a diario no llega ni a un año de horizonte.
    expect(buildMonteCarloProjection(oneYearOfWeeks, "DAILY", 1)).toBeNull();
  });

  test("A3.5: un hueco no se cose — el tramo que lo cruza no cuenta como rentabilidad", () => {
    // Serie plana con un salto ×2 escondido tras un hueco: si el hueco se
    // cosiera, ese tramo doble entraría como una rentabilidad enorme y el
    // cono se abriría. Sin coserlo, todas las rentabilidades válidas son 0.
    const flat = Array.from({ length: 60 }, (_, index) => ({
      date: weeklyDate(index),
      value: index < 30 ? 100 : 200
    }));
    flat[30] = { ...flat[30], value: Number.NaN }; // hueco entre 100 y 200
    // 29 + 28 = 57 rentabilidades válidas, por encima de las 52 de un año.
    const result = buildMonteCarloProjection(flat, "WEEKLY", 1);
    expect(result).not.toBeNull();
    const terminal = result?.points.at(-1);
    // Deriva y sigma nulas ⇒ el cono queda plano en el último valor válido.
    expect(terminal?.p5).toBeCloseTo(200, 6);
    expect(terminal?.p95).toBeCloseTo(200, 6);
  });

  test("A3.5: la varianza es muestral (n−1), no poblacional", () => {
    // Rentabilidades log alternas ±r: media 0. Con n−1 la sigma por paso es
    // r·√(n/(n−1)) y el p95 terminal queda por ENCIMA del que daría dividir por n.
    const alternating: { date: string; value: number }[] = [];
    let level = 100;
    for (let index = 0; index < 53; index += 1) {
      alternating.push({ date: weeklyDate(index), value: level });
      level = index % 2 === 0 ? level * 1.02 : level / 1.02;
    }
    const result = buildMonteCarloProjection(alternating, "WEEKLY", 1);
    expect(result).not.toBeNull();
    const r = Math.log(1.02);
    const n = 52; // rentabilidades
    const sampleSigma = Math.sqrt((n * r * r) / (n - 1));
    const lastValue = result!.lastValue;
    const steps = result!.points.length - 1;
    const expectedP95 = lastValue * Math.exp(1.645 * sampleSigma * Math.sqrt(steps));
    expect(result!.points.at(-1)!.p95).toBeCloseTo(expectedP95, 6);
  });
});

/**
 * Revisión de Astra (06-09-2026), punto 2: el umbral es de VARIACIONES, no de precios: de 156 precios semanales salen
 * 155 variaciones. El aviso que lo explicaba en el informe de cliente se fue con la proyección (decisión 3).
 */
describe("disponibilidad de la proyección: precios frente a variaciones", () => {
  const precios = (n: number) => Array.from({ length: n }, (_, index) => ({
    date: weeklyDate(index),
    value: 100 * 1.001 ** index
  }));

  test("el límite exacto: 156 precios no llegan, 157 sí", () => {
    const justoPorDebajo = monteCarloAvailability(precios(156), "WEEKLY", 3);
    expect(justoPorDebajo.usableReturns).toBe(155);
    expect(justoPorDebajo.requiredReturns).toBe(156);
    expect(justoPorDebajo.available).toBe(false);
    expect(buildMonteCarloProjection(precios(156), "WEEKLY", 3)).toBeNull();

    const justo = monteCarloAvailability(precios(157), "WEEKLY", 3);
    expect(justo.usableReturns).toBe(156);
    expect(justo.available).toBe(true);
    expect(buildMonteCarloProjection(precios(157), "WEEKLY", 3)).not.toBeNull();
  });

  test("la disponibilidad y la proyección nunca se contradicen", () => {
    for (const n of [0, 1, 8, 100, 156, 157, 200]) {
      const serie = precios(n);
      expect(monteCarloAvailability(serie, "WEEKLY", 3).available)
        .toBe(buildMonteCarloProjection(serie, "WEEKLY", 3) !== null);
    }
  });

  test("un hueco resta variaciones aunque los precios sigan ahí", () => {
    const conHueco = precios(160);
    conHueco[80] = { ...conHueco[80], value: Number.NaN };
    const estado = monteCarloAvailability(conHueco, "WEEKLY", 3);
    // 159 precios válidos, pero el hueco rompe dos pares: 157 variaciones.
    expect(estado.usableReturns).toBe(157);
    expect(estado.available).toBe(true);

    const alLimite = precios(158);
    alLimite[80] = { ...alLimite[80], value: Number.NaN };
    const bloqueado = monteCarloAvailability(alLimite, "WEEKLY", 3);
    expect(bloqueado.usableReturns).toBe(155);
    expect(bloqueado.available).toBe(false);
    expect(buildMonteCarloProjection(alLimite, "WEEKLY", 3)).toBeNull();
  });
});
