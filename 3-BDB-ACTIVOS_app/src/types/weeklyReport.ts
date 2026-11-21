// Tipo del informe semanal o diario de estrategia.
// Portado fiel del legacy BDB-FONDOS (types/WeeklyReport.ts).

export interface AssetClassWeight {
  assetClass: string;
  strategicWeight: number; // SAA %
  tacticalWeight: number; // TAA %
  view: "Positiva" | "Neutral" | "Negativa";
  rationale?: string;
}

export interface RegionWeight {
  region: string;
  weight: number;
  view: "Positiva" | "Neutral" | "Negativa";
  rationale?: string;
}

export interface SectorWeight {
  sector: string;
  weight: number;
  view: "Positiva" | "Neutral" | "Negativa";
}

export interface StrategyReportSource {
  title: string;
  url: string;
}

export interface WeeklyReport {
  schema_version?: string;
  id: string;
  date: string; // ISO
  author: string;
  provider?: string;
  sources?: StrategyReportSource[];
  generation?: {
    generated_at?: string;
    grounded?: boolean;
    research_model?: string;
    report_model?: string;
    source_count?: number;
  };
  summary: {
    headline: string;
    narrative: string;
    keyEvents: string[];
    kpis?: { label: string; value: string; trend: "up" | "down" | "neutral" }[];
    marketTemperature?: "Bullish" | "Neutral" | "Bearish";
    tailRisks?: { risk: string; probability: "Alta" | "Media" | "Baja"; impact: "Alto" | "Medio" | "Bajo" }[];
  };
  fullReport?: { narrative: string };
  /* Opcional desde strategy-report.v3: el informe diario es un brief de mercado
     y no lleva asignación. Solo el semanal la trae. */
  assetAllocation?: {
    overview: string;
    classes: AssetClassWeight[];
    regionsEquity: RegionWeight[];
    regionsFixedIncome?: RegionWeight[];
    sectors?: SectorWeight[];
  };
}
