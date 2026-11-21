// Tipos del Panel Admin (mapean la salida de functions_python/admin_panel.py).

export interface AdminMetricsPresent {
  vol: number;
  sharpe: number;
  srri: number;
  mdd: number;
  mdd_hist: number;
}

export interface AdminAnomalies {
  sin_historico: number;
  desactualizados: number;
  no_llega_2011: number;
  valle_reciente: number;
  total_flagged: number;
}

export interface AdminLaggedAsset {
  asset_id: string;
  name: string;
  type: string;
  last_date: string | null;
}

export interface AdminDbStatus {
  generated_at: string;
  total_assets: number;
  by_type: Record<string, number>;
  with_history: number;
  without_history: number;
  reach_2011: number;
  not_reach_2011: number;
  stale: number;
  stale_days_threshold: number;
  last_refresh_date: string | null;
  latest_data_date?: string | null;
  latest_by_type?: Record<string, string>;
  most_lagged?: AdminLaggedAsset[];
  master_writes_enabled?: boolean;
  master_writes_env?: string;
  master_writes_mode?: "disabled" | "enabled";
  app_check_enforced?: boolean;
  metrics_present: AdminMetricsPresent;
  start_year_histogram: Record<string, number>;
  anomalies: AdminAnomalies;
}

export interface AdminAssetRow {
  asset_id: string;
  name: string;
  type: string;
  symbol: string | null;
  currency: string | null;
  first_date: string | null;
  last_date: string | null;
  points: number;
  year_docs: number;
  years: number | null;
  has_vol: boolean;
  has_sharpe: boolean;
  has_srri: boolean;
  has_mdd: boolean;
  has_mdd_hist: boolean;
  flags: string[];
}

export interface AdminAssetsPage {
  total: number;
  offset: number;
  limit: number;
  items: AdminAssetRow[];
}

export interface AdminSeriesAnalysis {
  points: number;
  first_date: string | null;
  last_date: string | null;
  duplicates: number;
  non_positive: number;
  big_gaps: { from: string; to: string; days: number }[];
  big_gaps_count: number;
}

/** Máxima caída como en metrics.v1.2/1.3: `value` decimal (≤ 0) y fecha del valle. */
export interface AdminDrawdown {
  value: number;
  date?: string;
}

export interface AdminAssetDetail {
  meta: AdminAssetRow;
  identifiers: Record<string, unknown>;
  classification: Record<string, unknown>;
  max_drawdown_5y: AdminDrawdown | null;
  max_drawdown_hist: AdminDrawdown | null;
  series: AdminSeriesAnalysis;
}

export interface AdminRefreshSampleItem {
  asset_id: string;
  last_date?: string | null;
  new_last?: string | null;
  new_points?: number;
  /** El proveedor revisó precios ya guardados y se reconstruyó el histórico entero. */
  history_rebuilt?: boolean;
}

export interface AdminRefreshAllStaleResult {
  processed: number;
  updated: number;
  would_update: number;
  applied: boolean;
  skipped: number;
  errors: number;
  error_sample?: { asset_id: string; error: string }[];
  sample?: AdminRefreshSampleItem[];
  ran_date: string;
  read_budget_max?: number;
  read_budget_used?: number;
  write_count?: number;
  next_cursor?: string | null;
  cycle_completed?: boolean;
}

export interface AdminRecomputeMetricResult {
  asset_id: string;
  found: boolean;
  enough_data?: boolean;
  points?: number;
  applied?: boolean;
  error?: string;
  max_drawdown_hist?: { value: number; date: string | null };
}

export interface AdminRefreshAssetPricesResult {
  asset_id: string;
  found: boolean;
  has_series?: boolean;
  skipped?: string;
  note?: string;
  up_to_date?: boolean;
  applied?: boolean;
  new_points?: number;
  last_date?: string;
  new_first?: string;
  new_last?: string;
  eodhd_symbol?: string;
  /** Reconstrucción del histórico entero (el proveedor revisó precios ya guardados). */
  history_rebuilt?: boolean;
  first_date?: string;
  points?: number;
  history_documents?: number;
  revision?: string;
  write_count?: number;
}

// --- Backfill de históricos (activos sin price_series) ---

export interface AdminBackfillCandidate {
  asset_id: string;
  name: string;
  type: string;
  eodhd_hint: string | null;
  currency_hint: string | null;
}

export interface AdminBackfillCandidatesResult {
  generated_at: string;
  total_roots: number;
  excluded: number;
  with_series: number;
  candidates: AdminBackfillCandidate[];
  by_type: Record<string, number>;
}

export interface AdminBackfillAssetResult {
  asset_id: string;
  ok: boolean;
  applied: boolean;
  skipped: string | null;
  reason: string | null;
  resolution: string | null;
  symbol: string | null;
  currency: string | null;
  points: number;
  first_date: string | null;
  last_date: string | null;
  years: number;
  docs_created: number;
  error: string | null;
}

export interface AdminBackfillBatchResult {
  applied: boolean;
  requested: number;
  processed: number;
  loadable: number;
  loaded: number;
  skipped: number;
  review: number;
  errors: number;
  results: AdminBackfillAssetResult[];
  ran_date: string;
}

export interface AdminIngestAssetHistory {
  loaded?: boolean;
  reason?: string;
  error?: string;
  symbol?: string;
  points?: number;
  first_date?: string;
  last_date?: string;
  years?: number;
  applied?: boolean;
  interval?: string;
  representation?: string;
  metrics?: {
    available?: boolean;
    windows?: string[];
    observations_count?: number;
    last_date?: string;
    applied?: boolean;
  };
}

export interface AdminIngestAssetResult {
  asset_id: string;
  ok: boolean;
  applied?: boolean;
  preview?: boolean;
  resolved?: boolean;
  symbol?: string;
  name?: string;
  asset_type?: string;
  provider?: string;
  quality_status?: string;
  quality_score?: number;
  quality_warnings?: string[];
  fundamentals_source?: string | null;
  exists_in_master?: boolean;
  root_action?: "CREATE" | "SKIP_EXISTS" | string;
  with_history?: boolean;
  history?: AdminIngestAssetHistory;
  root_preview?: Record<string, unknown>;
  error?: string;
  unsupported_type?: string;
  note?: string;
  root_written?: boolean;
  search_index_updated?: boolean;
  search_index_warning?: string;
  metrics?: unknown;
}
