import type { BdbAssetHoldings } from "../types/bdbAssets";

export const mockHoldingsByAssetId: Record<string, BdbAssetHoldings> = {
  "MOCK-FUND-GLOBAL-BOND": {
    asset_id: "MOCK-FUND-GLOBAL-BOND",
    storage_mode: "SINGLE_DOCUMENT",
    holdings_count: 10,
    top10_weight: 48,
    as_of_date: "2026-06-30",
    holdings: [
      { holding_id: "bond-ust-10y", name: "United States Treasury Note", isin: "US91282CGM73", weight_pct: 8, holding_type: "bond", currency: "USD", country: "US" },
      { holding_id: "bond-bund-10y", name: "Bundesrepublik Deutschland", isin: "DE0001102580", weight_pct: 7, holding_type: "bond", currency: "EUR", country: "DE" },
      { holding_id: "bond-frtr-2034", name: "France Government Bond", isin: "FR0014007L00", weight_pct: 6, holding_type: "bond", currency: "EUR", country: "FR" },
      { holding_id: "bond-ust-5y", name: "United States Treasury Note", isin: "US91282CKQ32", weight_pct: 5, holding_type: "bond", currency: "USD", country: "US" },
      { holding_id: "bond-eib", name: "European Investment Bank", isin: "XS2529348988", weight_pct: 4.5, holding_type: "bond", currency: "EUR" },
      { holding_id: "bond-jgb", name: "Japan Government Bond", isin: "JP1103721P95", weight_pct: 4, holding_type: "bond", currency: "JPY", country: "JP" },
      { holding_id: "bond-apple", name: "Apple Inc Bond", isin: "US037833DY36", ticker: "AAPL", weight_pct: 3.8, holding_type: "bond", currency: "USD", country: "US" },
      { holding_id: "bond-msft", name: "Microsoft Corp Bond", isin: "US594918CJ87", ticker: "MSFT", weight_pct: 3.5, holding_type: "bond", currency: "USD", country: "US" },
      { holding_id: "bond-world-bank", name: "International Bank for Reconstruction", isin: "US459058KM34", weight_pct: 3.2, holding_type: "bond", currency: "USD" },
      { holding_id: "bond-kfw", name: "KfW", isin: "DE000A30VQB2", weight_pct: 3, holding_type: "bond", currency: "EUR", country: "DE" }
    ]
  },
  "MOCK-FUND-MIXED": {
    asset_id: "MOCK-FUND-MIXED",
    storage_mode: "SINGLE_DOCUMENT",
    holdings_count: 10,
    top10_weight: 33,
    as_of_date: "2026-05-31",
    holdings: [
      { holding_id: "mixed-ust-10y", name: "United States Treasury Note", isin: "US91282CGM73", weight_pct: 6, holding_type: "bond", currency: "USD", country: "US" },
      { holding_id: "mixed-cash", name: "EUR Cash", ticker: "EUR", weight_pct: 5, holding_type: "cash", currency: "EUR" },
      { holding_id: "mixed-msft", name: "Microsoft Corp", isin: "US5949181045", ticker: "MSFT", weight_pct: 4, holding_type: "equity", currency: "USD", sector: "Technology", country: "US" },
      { holding_id: "mixed-nestle", name: "Nestle SA", isin: "CH0038863350", ticker: "NESN", weight_pct: 3.5, holding_type: "equity", currency: "CHF", sector: "Consumer Defensive" },
      { holding_id: "mixed-apple", name: "Apple Inc", isin: "US0378331005", ticker: "AAPL", weight_pct: 3, holding_type: "equity", currency: "USD", sector: "Technology", country: "US" },
      { holding_id: "mixed-bund", name: "Bundesrepublik Deutschland", isin: "DE0001102580", weight_pct: 2.8, holding_type: "bond", currency: "EUR", country: "DE" },
      { holding_id: "mixed-lvmh", name: "LVMH Moet Hennessy Louis Vuitton", isin: "FR0000121014", ticker: "MC", weight_pct: 2.5, holding_type: "equity", currency: "EUR", country: "FR" },
      { holding_id: "mixed-asml", name: "ASML Holding NV", isin: "NL0010273215", ticker: "ASML", weight_pct: 2.3, holding_type: "equity", currency: "EUR", sector: "Technology" },
      { holding_id: "mixed-novo", name: "Novo Nordisk A/S", isin: "DK0062498333", ticker: "NOVO B", weight_pct: 2, holding_type: "equity", currency: "DKK", sector: "Healthcare" },
      { holding_id: "mixed-shell", name: "Shell PLC", isin: "GB00BP6MXD84", ticker: "SHEL", weight_pct: 1.9, holding_type: "equity", currency: "GBP", sector: "Energy" }
    ]
  },
  "MOCK-ETF-WATER": {
    asset_id: "MOCK-ETF-WATER",
    storage_mode: "SINGLE_DOCUMENT",
    holdings_count: 10,
    top10_weight: 39.5,
    as_of_date: "2026-06-28",
    holdings: [
      { holding_id: "water-msft", name: "Microsoft Corp", isin: "US5949181045", ticker: "MSFT", weight_pct: 5.2, holding_type: "equity", currency: "USD", sector: "Technology", country: "US" },
      { holding_id: "water-xyl", name: "Xylem Inc", isin: "US98419M1009", ticker: "XYL", weight_pct: 4.8, holding_type: "equity", currency: "USD", sector: "Industrials", country: "US" },
      { holding_id: "water-dhr", name: "Danaher Corp", isin: "US2358511028", ticker: "DHR", weight_pct: 4.5, holding_type: "equity", currency: "USD", sector: "Healthcare", country: "US" },
      { holding_id: "water-ecl", name: "Ecolab Inc", isin: "US2788651006", ticker: "ECL", weight_pct: 4.1, holding_type: "equity", currency: "USD", sector: "Basic Materials", country: "US" },
      { holding_id: "water-awkk", name: "American Water Works", isin: "US0304201033", ticker: "AWK", weight_pct: 3.9, holding_type: "equity", currency: "USD", sector: "Utilities", country: "US" },
      { holding_id: "water-veolia", name: "Veolia Environnement", isin: "FR0000124141", ticker: "VIE", weight_pct: 3.8, holding_type: "equity", currency: "EUR", sector: "Utilities", country: "FR" },
      { holding_id: "water-pentair", name: "Pentair PLC", isin: "IE00BLS09M33", ticker: "PNR", weight_pct: 3.6, holding_type: "equity", currency: "USD", sector: "Industrials" },
      { holding_id: "water-idex", name: "IDEX Corp", isin: "US45167R1041", ticker: "IEX", weight_pct: 3.4, holding_type: "equity", currency: "USD", sector: "Industrials" },
      { holding_id: "water-geberit", name: "Geberit AG", isin: "CH0030170408", ticker: "GEBN", weight_pct: 3.2, holding_type: "equity", currency: "CHF", sector: "Industrials" },
      { holding_id: "water-apple", name: "Apple Inc", isin: "US0378331005", ticker: "AAPL", weight_pct: 3, holding_type: "equity", currency: "USD", sector: "Technology", country: "US" }
    ]
  },
  "MOCK-ETF-CASH": {
    asset_id: "MOCK-ETF-CASH",
    storage_mode: "SINGLE_DOCUMENT",
    holdings_count: 3,
    top10_weight: 95,
    as_of_date: "2026-07-01",
    holdings: [
      { holding_id: "cash-ust-bill", name: "United States Treasury Bill", isin: "US912797LY45", weight_pct: 70, holding_type: "bond", currency: "USD", country: "US" },
      { holding_id: "cash-eur", name: "EUR Cash", ticker: "EUR", weight_pct: 20, holding_type: "cash", currency: "EUR" },
      { holding_id: "cash-repo", name: "Reverse Repo Collateral", ticker: "REPO", weight_pct: 5, holding_type: "cash", currency: "EUR" }
    ]
  }
};
