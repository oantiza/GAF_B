import type {
  BdbOfficialMetricsEnvelope,
  BdbPmsExposure,
  BdbQualityFlag,
  EconomicAssetClass,
  InstrumentType
} from "../types/bdbAssets";

export interface BbddActivosStaticExportSampleAsset {
  asset_id: string;
  name: string;
  instrument_type: InstrumentType;
  economic_asset_class: EconomicAssetClass;
  isin?: string;
  ticker?: string;
  provider?: string;
  currency: string;
  coverage_status: "COVERED" | "UNCOVERED" | "UNKNOWN";
  region?: string;
  market?: string;
  category?: string;
  sector?: string;
  strategy?: string;
  benchmark?: string;
  product_type?: string;
  domicile?: string;
  share_class?: string;
  distribution_policy?: string;
  inception_date?: string;
  ucits?: boolean;
  replication?: string;
  legal_structure?: string;
  sustainability?: {
    sfdr?: string;
    esg_rating?: string | number;
    sustainability_rating?: string | number;
  };
  ongoing_charge?: number;
  latest_value?: number;
  ytd_return?: number;
  latest_value_date?: string;
  volatility_3y?: number;
  sharpe_3y?: number;
  annualized_return_3y?: number;
  max_drawdown_5y?: number;
  risk_score?: number;
  official_metrics_envelope?: BdbOfficialMetricsEnvelope;
  pms_exposure?: BdbPmsExposure;
  is_investable?: boolean;
  role?: "INVESTABLE" | "BENCHMARK";
  quality_flags?: BdbQualityFlag[];
  available_sections: string[];
  source_note: string;
}

export const BBDD_STATIC_EXPORT_SAMPLE_SOURCE = {
  "dataset_id": "BDB_ACL_MOCK_PREVIEW.sample",
  "version": "2026-06-20T00:00:00.000Z",
  "schema_version": "asset-for-bdb.v1",
  "source_path": "intake/static-export-sample/bdb-assets-for-bdb.preview.json",
  "source_total_assets": 16,
  "sample_size": 16,
  "sample_note": "Muestra estatica controlada preparada por intake local dry-run por defecto."
} as const;

export const bbddActivosStaticExportSample: BbddActivosStaticExportSampleAsset[] = [
  {
    "asset_id": "LU0996182563",
    "name": "Mock Global Aggregate Bond Fund",
    "instrument_type": "FUND",
    "economic_asset_class": "FIXED_INCOME",
    "isin": "LU0996182563",
    "provider": "Mock AM",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Global",
    "ongoing_charge": 0.008,
    "ytd_return": 0.024,
    "volatility_3y": 0.061,
    "sharpe_3y": 0.31,
    "annualized_return_3y": 0.024,
    "max_drawdown_5y": -0.092,
    "risk_score": 3,
    "official_metrics_envelope": {
      "mode": "OFFICIAL_READ_MODEL",
      "source": "BBDD_ACTIVOS",
      "as_of_date": "2026-06-20",
      "calculation_policy": "BBDD_ACTIVOS_READ_MODEL_V1_LOCAL_FIXTURE",
      "data_quality": {
        "status": "PARTIAL",
        "flags": [
          "LOCAL_FIXTURE_ONLY"
        ],
        "warnings": [
          "Muestra local de ejemplo: no válida para evaluar idoneidad, optimizar ni recomendar."
        ]
      },
      "official_metrics": {
        "risk_score": 2
      },
      "official_performance": {
        "annualized_return_3y": 0.999,
        "ytd_return": 0.888
      },
      "official_risk": {
        "volatility_3y": 0.777,
        "sharpe_3y": 0.666,
        "max_drawdown_5y": -0.555
      },
      "official_costs": {
        "ongoing_charge": 0.004,
        "management_fee": 0.003
      },
      "suitability_allowed": false,
      "optimization_allowed": false,
      "recommendation_allowed": false
    },
    "pms_exposure": {
      "equity": 0,
      "fixed_income": 0.92,
      "cash": 0.05,
      "alternative": 0,
      "other": 0.03
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA",
      "MISSING_HOLDINGS"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "LU1883318740",
    "name": "Mock European Quality Equity Fund",
    "instrument_type": "FUND",
    "economic_asset_class": "EQUITY",
    "isin": "LU1883318740",
    "provider": "Mock AM",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Europe",
    "ongoing_charge": 0.011,
    "ytd_return": 0.058,
    "volatility_3y": 0.134,
    "sharpe_3y": 0.49,
    "annualized_return_3y": 0.058,
    "max_drawdown_5y": -0.171,
    "risk_score": 5,
    "pms_exposure": {
      "equity": 0.95,
      "fixed_income": 0,
      "cash": 0.05,
      "alternative": 0,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "LU2037748774",
    "name": "Mock Balanced Allocation Fund",
    "instrument_type": "FUND",
    "economic_asset_class": "MIXED",
    "isin": "LU2037748774",
    "provider": "Mock AM",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Global",
    "ongoing_charge": 0.0125,
    "ytd_return": 0.039,
    "volatility_3y": 0.084,
    "sharpe_3y": 0.44,
    "annualized_return_3y": 0.039,
    "max_drawdown_5y": -0.121,
    "risk_score": 4,
    "pms_exposure": {
      "equity": 0.48,
      "fixed_income": 0.42,
      "cash": 0.04,
      "alternative": 0.03,
      "other": 0.03
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "LU0552385295",
    "name": "Mock Euro Liquidity Fund",
    "instrument_type": "FUND",
    "economic_asset_class": "MONEY_MARKET",
    "isin": "LU0552385295",
    "provider": "Mock AM",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Europe",
    "ongoing_charge": 0.0025,
    "ytd_return": 0.018,
    "volatility_3y": 0.006,
    "sharpe_3y": 0.81,
    "annualized_return_3y": 0.018,
    "max_drawdown_5y": -0.006,
    "risk_score": 1,
    "pms_exposure": {
      "equity": 0,
      "fixed_income": 0.12,
      "cash": 0.88,
      "alternative": 0,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA",
      "MISSING_HOLDINGS"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "LU1681048804",
    "name": "Mock Market Neutral Alternatives Fund",
    "instrument_type": "FUND",
    "economic_asset_class": "ALTERNATIVE",
    "isin": "LU1681048804",
    "provider": "Mock AM",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Global",
    "ongoing_charge": 0.014,
    "ytd_return": 0.031,
    "volatility_3y": 0.049,
    "sharpe_3y": 0.52,
    "annualized_return_3y": 0.031,
    "max_drawdown_5y": -0.064,
    "risk_score": 3,
    "pms_exposure": {
      "equity": 0.08,
      "fixed_income": 0.14,
      "cash": 0.18,
      "alternative": 0.6,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA",
      "MISSING_HOLDINGS"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "IE00B1XNHC34",
    "name": "iShares Global Water UCITS ETF",
    "instrument_type": "ETF",
    "economic_asset_class": "EQUITY",
    "isin": "IE00B1XNHC34",
    "ticker": "IH2O",
    "provider": "iShares",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Global",
    "ongoing_charge": 0.0065,
    "ytd_return": 0.061,
    "volatility_3y": 0.142,
    "sharpe_3y": 0.54,
    "annualized_return_3y": 0.061,
    "max_drawdown_5y": -0.183,
    "risk_score": 5,
    "pms_exposure": {
      "equity": 0.96,
      "fixed_income": 0,
      "cash": 0.04,
      "alternative": 0,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "IE00B4L5Y983",
    "name": "iShares Core MSCI World UCITS ETF",
    "instrument_type": "ETF",
    "economic_asset_class": "EQUITY",
    "isin": "IE00B4L5Y983",
    "ticker": "IWDA",
    "provider": "iShares",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Global",
    "ongoing_charge": 0.002,
    "ytd_return": 0.092,
    "volatility_3y": 0.151,
    "sharpe_3y": 0.66,
    "annualized_return_3y": 0.092,
    "max_drawdown_5y": -0.198,
    "risk_score": 5,
    "pms_exposure": {
      "equity": 0.98,
      "fixed_income": 0,
      "cash": 0.02,
      "alternative": 0,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "IE00B3XXRP09",
    "name": "Vanguard Global Aggregate Bond UCITS ETF",
    "instrument_type": "ETF",
    "economic_asset_class": "FIXED_INCOME",
    "isin": "IE00B3XXRP09",
    "ticker": "VAGF",
    "provider": "Vanguard",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Global",
    "ongoing_charge": 0.001,
    "ytd_return": 0.017,
    "volatility_3y": 0.055,
    "sharpe_3y": 0.24,
    "annualized_return_3y": 0.017,
    "max_drawdown_5y": -0.083,
    "risk_score": 3,
    "pms_exposure": {
      "equity": 0,
      "fixed_income": 0.96,
      "cash": 0.03,
      "alternative": 0,
      "other": 0.01
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "IE00BKM4GZ66",
    "name": "iShares Core MSCI Emerging Markets IMI UCITS ETF",
    "instrument_type": "ETF",
    "economic_asset_class": "EQUITY",
    "isin": "IE00BKM4GZ66",
    "ticker": "EIMI",
    "provider": "iShares",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Emerging Markets",
    "ongoing_charge": 0.0018,
    "ytd_return": 0.041,
    "volatility_3y": 0.187,
    "sharpe_3y": 0.28,
    "annualized_return_3y": 0.041,
    "max_drawdown_5y": -0.254,
    "risk_score": 6,
    "pms_exposure": {
      "equity": 0.99,
      "fixed_income": 0,
      "cash": 0.01,
      "alternative": 0,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "IE00B5BMR087",
    "name": "iShares Global Property Securities UCITS ETF",
    "instrument_type": "ETF",
    "economic_asset_class": "OTHER",
    "isin": "IE00B5BMR087",
    "ticker": "IWDP",
    "provider": "iShares",
    "currency": "EUR",
    "coverage_status": "COVERED",
    "region": "Global",
    "ongoing_charge": 0.0059,
    "ytd_return": 0.033,
    "volatility_3y": 0.176,
    "sharpe_3y": 0.21,
    "annualized_return_3y": 0.033,
    "max_drawdown_5y": -0.231,
    "risk_score": 5,
    "pms_exposure": {
      "equity": 0,
      "fixed_income": 0,
      "cash": 0.03,
      "alternative": 0,
      "other": 0.97
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "portfolio_summary",
      "cost_snapshot"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "US0378331005",
    "name": "Apple Inc.",
    "instrument_type": "STOCK",
    "economic_asset_class": "EQUITY",
    "isin": "US0378331005",
    "ticker": "AAPL",
    "provider": "NASDAQ",
    "currency": "USD",
    "coverage_status": "COVERED",
    "region": "United States",
    "ytd_return": 0.129,
    "volatility_3y": 0.241,
    "sharpe_3y": 0.62,
    "annualized_return_3y": 0.129,
    "max_drawdown_5y": -0.286,
    "risk_score": 6,
    "pms_exposure": {
      "equity": 1,
      "fixed_income": 0,
      "cash": 0,
      "alternative": 0,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA",
      "MISSING_HOLDINGS"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "identity",
      "listing",
      "metrics"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "US5949181045",
    "name": "Microsoft Corporation",
    "instrument_type": "STOCK",
    "economic_asset_class": "EQUITY",
    "isin": "US5949181045",
    "ticker": "MSFT",
    "provider": "NASDAQ",
    "currency": "USD",
    "coverage_status": "COVERED",
    "region": "United States",
    "ytd_return": 0.147,
    "volatility_3y": 0.221,
    "sharpe_3y": 0.73,
    "annualized_return_3y": 0.147,
    "max_drawdown_5y": -0.241,
    "risk_score": 6,
    "pms_exposure": {
      "equity": 1,
      "fixed_income": 0,
      "cash": 0,
      "alternative": 0,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA",
      "MISSING_HOLDINGS"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "identity",
      "listing",
      "metrics"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "US02079K3059",
    "name": "Alphabet Inc. Class A",
    "instrument_type": "STOCK",
    "economic_asset_class": "EQUITY",
    "isin": "US02079K3059",
    "ticker": "GOOGL",
    "provider": "NASDAQ",
    "currency": "USD",
    "coverage_status": "COVERED",
    "region": "United States",
    "ytd_return": 0.116,
    "volatility_3y": 0.258,
    "sharpe_3y": 0.58,
    "annualized_return_3y": 0.116,
    "max_drawdown_5y": -0.302,
    "risk_score": 6,
    "pms_exposure": {
      "equity": 1,
      "fixed_income": 0,
      "cash": 0,
      "alternative": 0,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA",
      "MISSING_HOLDINGS"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "identity",
      "listing",
      "metrics"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "US88160R1014",
    "name": "Tesla Inc.",
    "instrument_type": "STOCK",
    "economic_asset_class": "EQUITY",
    "isin": "US88160R1014",
    "ticker": "TSLA",
    "provider": "NASDAQ",
    "currency": "USD",
    "coverage_status": "COVERED",
    "region": "United States",
    "ytd_return": 0.071,
    "volatility_3y": 0.512,
    "sharpe_3y": 0.21,
    "annualized_return_3y": 0.071,
    "max_drawdown_5y": -0.604,
    "risk_score": 7,
    "pms_exposure": {
      "equity": 1,
      "fixed_income": 0,
      "cash": 0,
      "alternative": 0,
      "other": 0
    },
    "is_investable": true,
    "role": "INVESTABLE",
    "quality_flags": [
      "MOCK_DATA",
      "MISSING_HOLDINGS"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "identity",
      "listing",
      "metrics"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "GSPC_INDEX",
    "name": "S&P 500 Index Benchmark",
    "instrument_type": "INDEX",
    "economic_asset_class": "EQUITY",
    "ticker": "GSPC",
    "provider": "S&P Dow Jones Indices",
    "currency": "USD",
    "coverage_status": "UNCOVERED",
    "region": "United States",
    "category": "Benchmark",
    "ytd_return": 0.108,
    "volatility_3y": 0.158,
    "sharpe_3y": 0.68,
    "annualized_return_3y": 0.108,
    "max_drawdown_5y": -0.214,
    "risk_score": 5,
    "pms_exposure": {
      "equity": 1,
      "fixed_income": 0,
      "cash": 0,
      "alternative": 0,
      "other": 0
    },
    "is_investable": false,
    "role": "BENCHMARK",
    "quality_flags": [
      "MOCK_DATA",
      "NON_INVESTABLE_BENCHMARK",
      "MISSING_HOLDINGS",
      "MISSING_HISTORY",
      "PARTIAL_COVERAGE"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "proxy_note"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  },
  {
    "asset_id": "STOXX600_INDEX",
    "name": "STOXX Europe 600 Index Benchmark",
    "instrument_type": "INDEX",
    "economic_asset_class": "EQUITY",
    "ticker": "SXXP",
    "provider": "STOXX",
    "currency": "EUR",
    "coverage_status": "UNCOVERED",
    "region": "Europe",
    "category": "Benchmark",
    "ytd_return": 0.071,
    "volatility_3y": 0.139,
    "sharpe_3y": 0.51,
    "annualized_return_3y": 0.071,
    "max_drawdown_5y": -0.188,
    "risk_score": 5,
    "pms_exposure": {
      "equity": 1,
      "fixed_income": 0,
      "cash": 0,
      "alternative": 0,
      "other": 0
    },
    "is_investable": false,
    "role": "BENCHMARK",
    "quality_flags": [
      "MOCK_DATA",
      "NON_INVESTABLE_BENCHMARK",
      "MISSING_HOLDINGS",
      "MISSING_HISTORY",
      "PARTIAL_COVERAGE"
    ],
    "available_sections": [
      "summary",
      "performance_preview",
      "risk_snapshot",
      "proxy_note"
    ],
    "source_note": "asset_for_bdb_static_export_intake"
  }
];
