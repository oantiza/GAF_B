import type { BdbAssetDetail } from "../types/bdbAssets";

export const mockAssets: BdbAssetDetail[] = [
  {
    asset_id: "MOCK-FUND-GLOBAL-BOND",
    display_name: "Mock Global Bond Fund",
    instrument_type: "FUND",
    economic_asset_class: "FIXED_INCOME",
    isin: "LU0000000001",
    provider: "Mock Asset Management",
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: ["MOCK_DATA"],
    warnings: [],
    description: "Fondo mock de renta fija global para validar la nueva experiencia BDB-ACTIVOS.",
    region: "Global",
    category: "Global aggregate bonds",
    costs: {
      ongoing_charge: 0.008,
      management_fee: 0.0065
    },
    metrics: {
      risk_score: 3,
      volatility_3y: 0.061,
      annualized_return_3y: 0.024,
      sharpe_3y: 0.31,
      max_drawdown_5y: -0.092
    },
    pms_exposure: {
      equity: 0,
      fixed_income: 0.92,
      cash: 0.05,
      alternative: 0,
      other: 0.03
    },
    holdings_summary: {
      has_holdings: true,
      positions_count: 10,
      top10_weight: 48,
      as_of_date: "2026-06-30"
    }
  },
  {
    asset_id: "MOCK-FUND-MIXED",
    display_name: "Mock Balanced Allocation Fund",
    instrument_type: "FUND",
    economic_asset_class: "MIXED",
    isin: "LU0000000005",
    provider: "Mock Private Bank",
    currency: "EUR",
    coverage_status: "PARTIAL",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: ["MOCK_DATA", "PARTIAL_COVERAGE"],
    warnings: [],
    description: "Fondo mixto mock para prototipar carteras nuevas e informes.",
    region: "Europe",
    category: "Balanced allocation",
    costs: {
      ongoing_charge: 0.011,
      management_fee: 0.0085
    },
    metrics: {
      risk_score: 4,
      volatility_3y: 0.094,
      annualized_return_3y: 0.041,
      sharpe_3y: 0.42,
      max_drawdown_5y: -0.118
    },
    pms_exposure: {
      equity: 0.48,
      fixed_income: 0.42,
      cash: 0.08,
      alternative: 0,
      other: 0.02
    },
    holdings_summary: {
      has_holdings: true,
      positions_count: 10,
      top10_weight: 33,
      as_of_date: "2026-05-31"
    }
  },
  {
    asset_id: "MOCK-ETF-WATER",
    display_name: "Mock Global Water ETF",
    instrument_type: "ETF",
    economic_asset_class: "EQUITY",
    isin: "IE0000000002",
    ticker: "WATR",
    provider: "Mock ETF Provider",
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: ["MOCK_DATA"],
    warnings: [],
    description: "ETF mock tematico para probar busqueda, comparacion y ficha de activo.",
    region: "Global",
    category: "Thematic equity",
    costs: {
      ongoing_charge: 0.0065,
      management_fee: 0.006
    },
    metrics: {
      risk_score: 5,
      volatility_3y: 0.142,
      annualized_return_3y: 0.061,
      sharpe_3y: 0.54,
      max_drawdown_5y: -0.183
    },
    pms_exposure: {
      equity: 0.96,
      fixed_income: 0,
      cash: 0.04,
      alternative: 0,
      other: 0
    },
    holdings_summary: {
      has_holdings: true,
      positions_count: 10,
      top10_weight: 39.5,
      as_of_date: "2026-06-28"
    }
  },
  {
    asset_id: "MOCK-ETF-CASH",
    display_name: "Mock Treasury Bill ETF",
    instrument_type: "ETF",
    economic_asset_class: "MONEY_MARKET",
    isin: "IE0000000006",
    ticker: "CASH",
    provider: "Mock ETF Provider",
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: ["MOCK_DATA"],
    warnings: [],
    description: "ETF monetario mock para comprobar exposicion a liquidez.",
    region: "Europe",
    category: "Money market",
    costs: {
      ongoing_charge: 0.0015
    },
    metrics: {
      risk_score: 1,
      volatility_3y: 0.009,
      annualized_return_3y: 0.021,
      sharpe_3y: 0.62,
      max_drawdown_5y: -0.008
    },
    pms_exposure: {
      equity: 0,
      fixed_income: 0.12,
      cash: 0.88,
      alternative: 0,
      other: 0
    },
    holdings_summary: {
      has_holdings: true,
      positions_count: 3,
      top10_weight: 95,
      as_of_date: "2026-07-01"
    }
  },
  {
    asset_id: "MOCK-STOCK-TECH",
    display_name: "Mock Technology Company",
    instrument_type: "STOCK",
    economic_asset_class: "EQUITY",
    ticker: "MTC",
    currency: "USD",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: ["MOCK_DATA"],
    warnings: [],
    description: "Accion mock de gran capitalizacion para validar soporte multiactivo.",
    region: "United States",
    category: "Technology",
    metrics: {
      risk_score: 6,
      volatility_3y: 0.218,
      annualized_return_3y: 0.087,
      sharpe_3y: 0.39,
      max_drawdown_5y: -0.274
    },
    pms_exposure: {
      equity: 1,
      fixed_income: 0,
      cash: 0,
      alternative: 0,
      other: 0
    }
  },
  {
    asset_id: "MOCK-STOCK-HEALTH",
    display_name: "Mock Healthcare Company",
    instrument_type: "STOCK",
    economic_asset_class: "EQUITY",
    ticker: "MHC",
    currency: "USD",
    coverage_status: "PARTIAL",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: ["MOCK_DATA", "MISSING_QUANT_METRICS", "PARTIAL_COVERAGE"],
    warnings: [],
    description: "Accion mock con metricas parciales para probar warnings del adapter.",
    region: "United States",
    category: "Healthcare",
    metrics: {},
    pms_exposure: {
      equity: 1,
      fixed_income: 0,
      cash: 0,
      alternative: 0,
      other: 0
    }
  },
  {
    asset_id: "MOCK-INDEX-GLOBAL",
    display_name: "Mock Global Equity Index",
    instrument_type: "INDEX",
    economic_asset_class: "EQUITY",
    ticker: "MGXI",
    currency: "USD",
    coverage_status: "ROOT_ONLY",
    is_investable: false,
    role: "BENCHMARK",
    quality_flags: ["MOCK_DATA", "MISSING_HISTORY", "NON_INVESTABLE_BENCHMARK"],
    warnings: [],
    description: "Indice mock usado como benchmark; no debe eliminarse silenciosamente.",
    region: "Global",
    category: "Broad market index",
    metrics: {
      risk_score: 5,
      volatility_3y: 0.16,
      annualized_return_3y: 0.07,
      sharpe_3y: 0.44,
      max_drawdown_5y: -0.205
    },
    pms_exposure: {
      equity: 1,
      fixed_income: 0,
      cash: 0,
      alternative: 0,
      other: 0
    }
  }
];
