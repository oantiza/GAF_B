export interface MonteCarloSourcePoint {
  date: string;
  value: number;
}

export interface MonteCarloProjectionPoint {
  step: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface MonteCarloProjection {
  lastValue: number;
  stepsPerYear: number;
  horizonYears: number;
  points: MonteCarloProjectionPoint[];
}

const Z = { p5: -1.645, p25: -0.674, p50: 0, p75: 0.674, p95: 1.645 } as const;

/**
 * Proyección lognormal determinista a partir de la deriva y volatilidad de los
 * rendimientos logarítmicos observados. Comparte la mecánica entre pantalla y PDF.
 * Es un cono estadístico, no una predicción de mercado.
 */
/** Observaciones que exige proyectar `horizonYears` con esa frecuencia de medición. */
export function monteCarloMinObservations(frequency: "WEEKLY" | "DAILY", horizonYears = 3): number {
  return Math.round(horizonYears * (frequency === "DAILY" ? 252 : 52));
}

/** Rentabilidades logarítmicas entre observaciones CONSECUTIVAS válidas. */
function usableLogReturns(series: MonteCarloSourcePoint[]): { returns: number[]; lastValue: number | null } {
  // A3.5: las rentabilidades solo se calculan entre observaciones CONSECUTIVAS
  // válidas. Antes se filtraban los huecos y se cosían los extremos, con lo que
  // un tramo de dos o más periodos contaba como uno y la volatilidad se inflaba.
  const isValid = (value: number | undefined): value is number => Number.isFinite(value) && (value as number) > 0;
  const returns: number[] = [];
  let lastValue: number | null = null;
  for (let index = 0; index < series.length; index += 1) {
    const cur = series[index]?.value;
    if (!isValid(cur)) continue;
    const prev = series[index - 1]?.value;
    if (index > 0 && isValid(prev)) {
      returns.push(Math.log(cur / prev));
    }
    lastValue = cur;
  }
  return { returns, lastValue };
}

/** Umbral mínimo de la proyección: 8 valores ⇒ 7 rentabilidades. */
const MIN_RETURNS = 7;

export interface MonteCarloAvailability {
  available: boolean;
  /** Variaciones utilizables: pares de observaciones CONSECUTIVAS válidas. */
  usableReturns: number;
  /** Variaciones que exige el horizonte. */
  requiredReturns: number;
}

/**
 * Revisión de Astra (06-09-2026): el umbral es de RENTABILIDADES, no de precios: de 156
 * precios semanales salen 155 variaciones, y eso no llega a 3 años.
 */
export function monteCarloAvailability(
  series: MonteCarloSourcePoint[],
  frequency: "WEEKLY" | "DAILY",
  horizonYears = 3
): MonteCarloAvailability {
  const requiredReturns = monteCarloMinObservations(frequency, horizonYears);
  const { returns } = usableLogReturns(series);
  return {
    available: returns.length >= MIN_RETURNS && returns.length >= requiredReturns,
    usableReturns: returns.length,
    requiredReturns
  };
}

/**
 * El mismo cono, con la mediana creciendo al tipo sin riesgo en vez de a la deriva observada: P50 = último valor × (1 + tipo)^años, y cada
 * percentil guarda con ella la misma proporción, en cada fecha. Es del informe interno (Óscar, 11-11-2026): con la deriva del periodo, hasta
 * el percentil 5 ganaba, y se leía como una previsión. No modifica `buildMonteCarloProjection`, que usa también la pantalla.
 * Sin un tipo válido no hay centro: `null`, y nunca se vuelve a la deriva.
 */
export function centrarEnElTipoSinRiesgo(proyeccion: MonteCarloProjection, tipoAnual: number | null | undefined): MonteCarloProjection | null {
  if (typeof tipoAnual !== "number" || !Number.isFinite(tipoAnual) || tipoAnual <= -1) return null;
  return {
    ...proyeccion,
    points: proyeccion.points.map((punto) => {
      const factor = (proyeccion.lastValue * (1 + tipoAnual) ** (punto.step / proyeccion.stepsPerYear)) / punto.p50;
      return { step: punto.step, p5: punto.p5 * factor, p25: punto.p25 * factor, p50: punto.p50 * factor, p75: punto.p75 * factor, p95: punto.p95 * factor };
    })
  };
}

export function buildMonteCarloProjection(
  series: MonteCarloSourcePoint[],
  frequency: "WEEKLY" | "DAILY",
  horizonYears = 3
): MonteCarloProjection | null {
  if (!Number.isFinite(horizonYears) || horizonYears <= 0) return null;

  const { returns, lastValue } = usableLogReturns(series);
  if (lastValue == null) return null;
  /* Revisión 06-09-2026: con siete rentabilidades se podía proyectar tres años, es
     decir extrapolar más de veinte veces la historia observada, y el informe lo
     imprimía como «lo más probable». La ventana de estimación tiene que cubrir al
     menos el horizonte que se proyecta; si no, no hay proyección que presentar.
     La condición vive en `monteCarloAvailability`, que es también quien la explica. */
  if (!monteCarloAvailability(series, frequency, horizonYears).available) return null;
  const last: number = lastValue;

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  // Varianza muestral (n−1): la serie es una muestra, no la población.
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const sigma = Math.sqrt(variance);
  const stepsPerYear = frequency === "DAILY" ? 252 : 52;
  const steps = Math.max(8, Math.round(horizonYears * stepsPerYear));
  const projected = (step: number, z: number) => last * Math.exp(mean * step + z * sigma * Math.sqrt(step));

  return {
    lastValue: last,
    stepsPerYear,
    horizonYears,
    points: Array.from({ length: steps + 1 }, (_, step) => ({
      step,
      p5: projected(step, Z.p5),
      p25: projected(step, Z.p25),
      p50: projected(step, Z.p50),
      p75: projected(step, Z.p75),
      p95: projected(step, Z.p95)
    }))
  };
}
