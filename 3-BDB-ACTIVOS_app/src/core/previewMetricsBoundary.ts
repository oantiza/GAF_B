import type { BdbPreviewMetricsBoundary } from "../types/bdbAssets";

export const PREVIEW_METRICS_BOUNDARY: BdbPreviewMetricsBoundary = {
  mode: "PREVIEW_ONLY",
  source_label: "Métricas locales aproximadas",
  limitations: [
    "No son métricas oficiales del catálogo.",
    "Volatilidad y Sharpe usan correlaciones asumidas por clase si no hay simulación histórica real.",
    "La caída máxima es la media ponderada de las caídas de los activos; no mide la caída histórica conjunta de la cartera.",
    "No sustituyen a una evaluación de idoneidad.",
    "No constituyen recomendación personalizada.",
    "No son aptas para la optimización en producción."
  ]
};

export function clonePreviewMetricsBoundary(frequencyNote?: string): BdbPreviewMetricsBoundary {
  return {
    ...PREVIEW_METRICS_BOUNDARY,
    limitations: [...(frequencyNote ? [frequencyNote] : []), ...PREVIEW_METRICS_BOUNDARY.limitations]
  };
}
