import { readFileSync } from "node:fs";
import type { SeriesBaseDeReferencia } from "../../src/core/benchmarkProfiles";

/**
 * Lo que hacía la aplicación antes de calcular la mezcla en el momento, guardado antes de borrar
 * `src/core/benchmarkDataset.ts`, y las series reales de los dos fondos hasta ese mismo día.
 */
interface RegistroDeLaReferencia {
  fichero: {
    first_date: string;
    last_date: string;
    points: number;
    profiles: Array<{
      id: string;
      name: string;
      weights: { rf: number; rv: number };
      vol: number;
      ret: number;
      volFull: number;
      retFull: number;
      maxDrawdown: number;
      maxDrawdown3y: number;
      cumulativeReturn: number;
    }>;
    muestra: { dates: string[]; rf: number[]; rv: number[] };
  };
  series: { dates: string[]; rf: number[]; rv: number[] };
  /** Decisión 39: por primer día y por perfil, calculado aparte en Python a partir de `series`. */
  pesosFijados: Record<string, Record<string, { final: number; ret: number; caida: number; volSemanal: number }>>;
}

export const REGISTRO: RegistroDeLaReferencia = JSON.parse(
  readFileSync(new URL("../fixtures/referenciaHasta20260928.json", import.meta.url), "utf8")
);

/** Los dos fondos base entre el 10-07-2015 y el 28-09-2026, valores liquidativos reales. */
export const SERIES_HASTA_20260928: SeriesBaseDeReferencia = {
  rf: REGISTRO.series.dates.map((date, indice) => ({ date, value: REGISTRO.series.rf[indice] })),
  rv: REGISTRO.series.dates.map((date, indice) => ({ date, value: REGISTRO.series.rv[indice] }))
};

/** Días laborables entre dos fechas, ambas incluidas: la rejilla de la serie de una cartera. */
export function diasLaborables(desde: string, hasta: string): string[] {
  const fechas: string[] = [];
  const dia = new Date(`${desde}T00:00:00Z`);
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  while (dia.getTime() <= fin) {
    if (dia.getUTCDay() !== 0 && dia.getUTCDay() !== 6) fechas.push(dia.toISOString().slice(0, 10));
    dia.setUTCDate(dia.getUTCDate() + 1);
  }
  return fechas;
}
