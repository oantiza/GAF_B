import type { Metrica } from "./tipos";

export const aportacionesNetas: Metrica = {
  id: "aportacionesNetas",
  nombre: "Aportaciones netas",
  ayuda: "Lo que el cliente ha puesto en la cartera menos lo que ha sacado en el periodo. No es ganancia ni pérdida.",
  formato: "importe",
  conSigno: false,
  valor: (analisis) => analisis.rentabilidad?.aportacionesNetas ?? null
};
