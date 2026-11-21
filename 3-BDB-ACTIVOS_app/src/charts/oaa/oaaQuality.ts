import type { OaaDataQuality } from "./OaaChartFrame";

export type OaaBreakdownQuality = "lookthrough" | "none";

export interface OaaQualityMeta {
  dataQuality: OaaDataQuality;
  dataQualityLabel: string;
  dataQualityNote: string;
}

/** Ni sectores ni regiones se estiman (decisión 11): o hay algo publicado, o no hay dato. */
export function breakdownQualityProps(quality: OaaBreakdownQuality): OaaQualityMeta {
  if (quality === "lookthrough") {
    return {
      dataQuality: "real",
      dataQualityLabel: "Subyacente",
      dataQualityNote: "Dato agregado desde la composición subyacente disponible."
    };
  }
  return {
    dataQuality: "none",
    dataQualityLabel: "Sin dato",
    dataQualityNote: "No hay datos suficientes para este desglose."
  };
}

export function exposureQualityProps(lookthroughCoverage: number): OaaQualityMeta {
  if (lookthroughCoverage >= 99) {
    return {
      dataQuality: "real",
      dataQualityLabel: "Subyacente",
      dataQualityNote: "Exposición agregada desde composición interna de los fondos."
    };
  }
  if (lookthroughCoverage > 0) {
    return {
      dataQuality: "mixed",
      dataQualityLabel: "Mixto",
      dataQualityNote: "Mezcla exposición de ficha y composición interna disponible."
    };
  }
  return {
    dataQuality: "estimated",
    dataQualityLabel: "Ficha",
    dataQualityNote: "Exposición por ficha del activo; sin desglose interno de posiciones."
  };
}
