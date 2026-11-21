import { cargarSeriesDeReferencia } from "../adapters/seriesDeReferencia";
import type { SeriesBaseDeReferencia } from "./benchmarkProfiles";
import { useAsyncData } from "./useAsyncData";

export interface EstadoDeLaReferencia {
  /** «no-disponible»: se dice, no se cae a datos viejos. */
  estado: "cargando" | "lista" | "no-disponible";
  series: SeriesBaseDeReferencia | null;
  reintentar: () => void;
}

/** Las series de las carteras de referencia en una pantalla. Con `activa` a false no se piden. */
export function useSeriesDeReferencia(activa = true): EstadoDeLaReferencia {
  const { data, error, retry } = useAsyncData(() => cargarSeriesDeReferencia(), [], { enabled: activa });
  return {
    estado: data ? "lista" : error ? "no-disponible" : "cargando",
    series: data,
    reintentar: retry
  };
}
