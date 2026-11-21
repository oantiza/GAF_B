# Diff campo a campo de canónicos

Antes: `reports/baseline/export_bdb_20260903` (763 canónicos) · Después: `../1-extractor-B0/export_bdb` (763 canónicos) · comunes: 763

| Categoría | Hojas | % |
|---|---:|---:|
| identico | 122366 | 93.50 % |
| cambia | 1725 | 1.32 % |
| aparece | 2476 | 1.89 % |
| desaparece | 4312 | 3.29 % |

## Campos que desaparecen (regresión salvo justificación): 4312 hojas en 195 rutas

| Ruta | Hojas | ISINs | Ejemplo (antes → después) |
|---|---:|---|---|
| `ms.stock.fundamentals.fetched_at` | 74 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+68) | DE0005140008: "2026-07-18T16:47:11+00:00" → null |
| `ms.stock.fundamentals.quality.coverage_status` | 74 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+68) | DE0005140008: "COMPLETE" → null |
| `ms.stock.fundamentals.source` | 74 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+68) | DE0005140008: "eodhd" → null |
| `ms.stock.fundamentals.analyst.eps_current_year` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 3.3215 → null |
| `ms.stock.fundamentals.analyst.eps_next_quarter` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.7823 → null |
| `ms.stock.fundamentals.analyst.eps_next_year` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 3.8827 → null |
| `ms.stock.fundamentals.as_of_date` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "2026-03-31" → null |
| `ms.stock.fundamentals.capital.insiders_ratio` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 8.527 → null |
| `ms.stock.fundamentals.capital.institutions_ratio` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 53.059 → null |
| `ms.stock.fundamentals.capital.shares_float` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 1801251046.0 → null |
| `ms.stock.fundamentals.capital.shares_outstanding` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 1913163641.0 → null |
| `ms.stock.fundamentals.currency` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "EUR" → null |
| `ms.stock.fundamentals.dividends.forward_annual_rate` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 1.0 → null |
| `ms.stock.fundamentals.dividends.forward_yield_ratio` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.0316 → null |
| `ms.stock.fundamentals.dividends.payout_ratio` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.3067 → null |
| `ms.stock.fundamentals.endpoint_version` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "v1.1" → null |
| `ms.stock.fundamentals.growth.quarterly_earnings_yoy` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.071 → null |
| `ms.stock.fundamentals.growth.quarterly_revenue_yoy` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.012 → null |
| `ms.stock.fundamentals.instrument_type` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "STOCK" → null |
| `ms.stock.fundamentals.per_share.book_value` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 41.466 → null |
| `ms.stock.fundamentals.per_share.eps` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 3.16 → null |
| `ms.stock.fundamentals.per_share.revenue_ttm` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 15.306 → null |
| `ms.stock.fundamentals.profile.country` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "DE" → null |
| `ms.stock.fundamentals.profile.employees` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 90067 → null |
| `ms.stock.fundamentals.profile.fiscal_year_end` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "December" → null |
| `ms.stock.fundamentals.profile.gics_group` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "Banks" → null |
| `ms.stock.fundamentals.profile.gics_industry` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "Banks" → null |
| `ms.stock.fundamentals.profile.gics_sector` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "Financials" → null |
| `ms.stock.fundamentals.profile.gics_sub_industry` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "Regional Banks" → null |
| `ms.stock.fundamentals.profile.industry` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "Banks - Regional" → null |
| `ms.stock.fundamentals.profile.sector` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "Financial Services" → null |
| `ms.stock.fundamentals.profitability.operating_margin_ttm` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.373 → null |
| `ms.stock.fundamentals.profitability.profit_margin` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.2265 → null |
| `ms.stock.fundamentals.profitability.return_on_assets_ttm` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.0048 → null |
| `ms.stock.fundamentals.profitability.return_on_equity_ttm` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.0865 → null |
| `ms.stock.fundamentals.quality.coverage_ratio` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 1.0 → null |
| `ms.stock.fundamentals.raw_payload_sha256` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "36573c6a49120f6585663065cc7d5ce56976e45593aebd3abc148f8f... → null |
| `ms.stock.fundamentals.schema_version` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "bdb.fundamentals-summary.v1" → null |
| `ms.stock.fundamentals.source_updated_at` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "2026-07-17" → null |
| `ms.stock.fundamentals.symbol` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: "DBK.XETRA" → null |
| `ms.stock.fundamentals.technicals.beta` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.982 → null |
| `ms.stock.fundamentals.technicals.high_52w` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 33.0537 → null |
| `ms.stock.fundamentals.technicals.low_52w` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 22.9764 → null |
| `ms.stock.fundamentals.technicals.moving_average_200d` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 29.7898 → null |
| `ms.stock.fundamentals.technicals.moving_average_50d` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 29.1936 → null |
| `ms.stock.fundamentals.valuation.enterprise_value` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: -43408678912.0 → null |
| `ms.stock.fundamentals.valuation.ev_ebitda` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.0 → null |
| `ms.stock.fundamentals.valuation.ev_revenue` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 6.1461 → null |
| `ms.stock.fundamentals.valuation.market_cap` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 58992398336.0 → null |
| `ms.stock.fundamentals.valuation.pe_forward` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 9.5694 → null |
| `ms.stock.fundamentals.valuation.price_book_mrq` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 0.7769 → null |
| `ms.stock.fundamentals.valuation.price_sales_ttm` | 71 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+65) | DE0005140008: 1.978 → null |
| `ms.stock.fundamentals.dividends.yield_ratio` | 68 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+62) | DE0005140008: 0.0316 → null |
| `ms.stock.fundamentals.per_share.dividend` | 68 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+62) | DE0005140008: 1.0 → null |
| `ms.stock.fundamentals.analyst.target_price` | 67 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+61) | DE0005140008: 31.995 → null |
| `ms.stock.fundamentals.dividends.ex_dividend_date` | 66 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+60) | DE0005140008: "2026-05-29" → null |
| `ms.stock.fundamentals.valuation.pe_trailing` | 62 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+56) | DE0005140008: 9.7579 → null |
| `ms.stock.fundamentals.valuation.peg` | 62 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+56) | DE0005140008: 1.7724 → null |
| `ms.holdings_top10[].name` | 20 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "NVIDIA Corp" → null |
| `ms.holdings_top10[].weight` | 20 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: 5.66573 → null |
| `classification_v2.sources_used[]` | 14 | BE0946564383, BE0947853660, BE6213829094, ES0114673033, IE00B03HCZ61, IE00B18GC888 (+8) | BE0946564383: "fondosdb:morningstar_lt" → null |
| `ms.holdings_top10[].sector` | 10 | IE00B03HCZ61 | IE00B03HCZ61: "technology" → null |
| `ms.stock.fundamentals.eps` | 3 | IT0003128367, IT0003132476, IT0005239360 | IT0003128367: 0.0 → null |
| `ms.stock.fundamentals.dividends.dividend_date` | 3 | DE0005190003, NL0011585146, NL00150001Q9 | DE0005190003: "2024-05-21" → null |
| `ms.stock.fundamentals.quality.warnings[]` | 3 | ES0105046009, ES0105394003, ES0118900010 | ES0105046009: "fallback_source:yahoo" → null |
| `classification_v2.commercial_type` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "EAA Fund Global Large-Cap Blend Equity" → null |
| `classification_v2.region_primary` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "Global" → null |
| `currency` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "EUR" → null |
| `derived.primary_region` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "Global" → null |
| `ms.category_morningstar` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "EAA Fund Global Large-Cap Blend Equity" → null |
| `ms.costs.management_fee` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: 0.18 → null |
| `ms.costs.mifid_ongoing` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: 0.1813 → null |
| `ms.costs.ter` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: 0.18 → null |
| `ms.medalist_rating` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "Gold" → null |
| `ms.objective` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "The Fund seeks to provide long-term growth of capital by... → null |
| `ms.portfolio.as_of` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "2026-05-31" → null |
| `ms.rating_stars` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: 4 → null |
| `ms.sustainability_rating` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: 3 → null |
| `name` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "Vanguard Global Stock Index Fund Investor EUR Accumulation" → null |
| `ms.stock.fundamentals.capital.short_percent_float` | 2 | NL0011585146, NL00150001Q9 | NL0011585146: 0.0305 → null |
| `ms.fixed_income.avg_credit_quality` | 1 | IE00B18GC888 | IE00B18GC888: "A+" → null |
| `ms.fixed_income.bond_sectors.cash` | 1 | IE00B18GC888 | IE00B18GC888: 0.006432 → null |
| `ms.fixed_income.bond_sectors.government` | 1 | IE00B18GC888 | IE00B18GC888: 64.819148 → null |
| `ms.fixed_income.ytw_distribution.1_3` | 1 | IE00B18GC888 | IE00B18GC888: 19.021 → null |
| `ms.fixed_income.ytw_distribution.3_5` | 1 | IE00B18GC888 | IE00B18GC888: 60.618 → null |
| `ms.fixed_income.ytw_distribution.5_7` | 1 | IE00B18GC888 | IE00B18GC888: 18.022 → null |
| `ms.fixed_income.ytw_distribution.negativo` | 1 | IE00B18GC888 | IE00B18GC888: 0.015 → null |
| `ms.holdings_stats.holdings_count_bond` | 1 | IE00B18GC888 | IE00B18GC888: 16654 → null |
| `portfolio_exposure_v2.bond_types.cash` | 1 | IE00B18GC888 | IE00B18GC888: 6.4e-05 → null |
| `portfolio_exposure_v2.bond_types.government` | 1 | IE00B18GC888 | IE00B18GC888: 0.648191 → null |
| `portfolio_exposure_v2.duration.1_3` | 1 | IE00B18GC888 | IE00B18GC888: 0.222425 → null |
| `portfolio_exposure_v2.duration.3_5` | 1 | IE00B18GC888 | IE00B18GC888: 0.19146 → null |
| `portfolio_exposure_v2.duration.5_7` | 1 | IE00B18GC888 | IE00B18GC888: 0.131135 → null |
| `portfolio_exposure_v2.duration.7_10` | 1 | IE00B18GC888 | IE00B18GC888: 0.137898 → null |
| `portfolio_exposure_v2.duration.over_10` | 1 | IE00B18GC888 | IE00B18GC888: 0.312972 → null |
| `classification_v2.market_cap_bias` | 1 | IE00B03HCZ61 | IE00B03HCZ61: "large" → null |
| `derived.portfolio_exposure.equity_regions_total.asia` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 8.3981 → null |
| `derived.portfolio_exposure.equity_regions_total.asia_emerging` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.1207 → null |
| `derived.portfolio_exposure.equity_regions_total.europe_ex_euro` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.9907 → null |
| `derived.portfolio_exposure.equity_regions_total.eurozone` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 8.2125 → null |
| `derived.portfolio_exposure.equity_regions_total.latin_america` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.1581 → null |
| `derived.portfolio_exposure.equity_regions_total.middle_east` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.2646 → null |
| `derived.portfolio_exposure.equity_regions_total.other` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.6837 → null |
| `derived.portfolio_exposure.equity_regions_total.united_kingdom` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.4041 → null |
| `derived.portfolio_exposure.equity_regions_total.united_states` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 72.1671 → null |
| `derived.portfolio_exposure.equity_sectors_total.basic_materials` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.254145 → null |
| `derived.portfolio_exposure.equity_sectors_total.communication_services` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 8.974838 → null |
| `derived.portfolio_exposure.equity_sectors_total.consumer_cyclical` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 9.195791 → null |
| `derived.portfolio_exposure.equity_sectors_total.consumer_defensive` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 4.92946 → null |
| `derived.portfolio_exposure.equity_sectors_total.financial_services` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 14.796968 → null |
| `derived.portfolio_exposure.equity_sectors_total.healthcare` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 8.585657 → null |
| `derived.portfolio_exposure.equity_sectors_total.industrials` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 10.9105 → null |
| `derived.portfolio_exposure.equity_sectors_total.real_estate` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 1.743304 → null |
| `derived.portfolio_exposure.equity_sectors_total.technology` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 31.396083 → null |
| `derived.portfolio_exposure.equity_sectors_total.utilities` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 2.407115 → null |
| `derived.style_bias.equity.size_bucket` | 1 | IE00B03HCZ61 | IE00B03HCZ61: "large" → null |
| `derived.style_bias.equity.style` | 1 | IE00B03HCZ61 | IE00B03HCZ61: "blend" → null |
| `derived.style_bias.equity.style_weights_total.blend` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 45.6533 → null |
| `derived.style_bias.equity.style_weights_total.growth` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 26.5501 → null |
| `derived.style_bias.equity.style_weights_total.value` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 27.7967 → null |
| `derived.top_sector` | 1 | IE00B03HCZ61 | IE00B03HCZ61: "technology" → null |
| `derived.top_sector_weight` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 31.396083 → null |
| `ms.holdings_stats.holdings_count_equity` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 1317 → null |
| `ms.regions.detail.asia` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 8.3981 → null |
| `ms.regions.detail.asia_emerging` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.1207 → null |
| `ms.regions.detail.europe_ex_euro` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.9907 → null |
| `ms.regions.detail.eurozone` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 8.2125 → null |
| `ms.regions.detail.latin_america` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.1581 → null |
| `ms.regions.detail.middle_east` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.2646 → null |
| `ms.regions.detail.other` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.6837 → null |
| `ms.regions.detail.united_kingdom` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.4041 → null |
| `ms.regions.detail.united_states` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 72.1671 → null |
| `ms.sectors.basic_materials` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.254145 → null |
| `ms.sectors.communication_services` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 8.974838 → null |
| `ms.sectors.consumer_cyclical` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 9.195791 → null |
| `ms.sectors.consumer_defensive` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 4.92946 → null |
| `ms.sectors.financial_services` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 14.796968 → null |
| `ms.sectors.healthcare` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 8.585657 → null |
| `ms.sectors.industrials` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 10.9105 → null |
| `ms.sectors.real_estate` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 1.743304 → null |
| `ms.sectors.technology` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 31.396083 → null |
| `ms.sectors.utilities` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 2.407115 → null |
| `portfolio_exposure_v2.equity_regions.asia` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.083981 → null |
| `portfolio_exposure_v2.equity_regions.asia_emerging` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.001207 → null |
| `portfolio_exposure_v2.equity_regions.europe_ex_euro` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.039907 → null |
| `portfolio_exposure_v2.equity_regions.eurozone` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.082125 → null |
| `portfolio_exposure_v2.equity_regions.latin_america` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.001581 → null |
| `portfolio_exposure_v2.equity_regions.middle_east` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.002646 → null |
| `portfolio_exposure_v2.equity_regions.other` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.036837 → null |
| `portfolio_exposure_v2.equity_regions.united_kingdom` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.034041 → null |
| `portfolio_exposure_v2.equity_regions.united_states` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.721671 → null |
| `portfolio_exposure_v2.equity_styles.blend` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.456533 → null |
| `portfolio_exposure_v2.equity_styles.growth` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.265501 → null |
| `portfolio_exposure_v2.equity_styles.value` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.277967 → null |
| `portfolio_exposure_v2.market_caps.large` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.823506 → null |
| `portfolio_exposure_v2.market_caps.mid` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.170161 → null |
| `portfolio_exposure_v2.market_caps.small` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.006333 → null |
| `portfolio_exposure_v2.sectors.basic_materials` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.032541 → null |
| `portfolio_exposure_v2.sectors.communication_services` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.089748 → null |
| `portfolio_exposure_v2.sectors.consumer_cyclical` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.091958 → null |
| `portfolio_exposure_v2.sectors.consumer_defensive` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.049295 → null |
| `portfolio_exposure_v2.sectors.financial_services` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.14797 → null |
| `portfolio_exposure_v2.sectors.healthcare` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.085857 → null |
| `portfolio_exposure_v2.sectors.industrials` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.109105 → null |
| `portfolio_exposure_v2.sectors.real_estate` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.017433 → null |
| `portfolio_exposure_v2.sectors.technology` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.313961 → null |
| `portfolio_exposure_v2.sectors.utilities` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.024071 → null |
| `derived.portfolio_exposure.equity_sectors_total.energy` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.806138 → null |
| `ms.fixed_income.bond_sectors.corporate` | 1 | IE00B18GC888 | IE00B18GC888: 23.367421 → null |
| `ms.fixed_income.bond_sectors.securitized` | 1 | IE00B18GC888 | IE00B18GC888: 11.627243 → null |
| `ms.fixed_income.ytw_distribution.0_1` | 1 | IE00B18GC888 | IE00B18GC888: 0.562 → null |
| `ms.fixed_income.ytw_distribution.7_10` | 1 | IE00B18GC888 | IE00B18GC888: 0.579 → null |
| `ms.fixed_income.ytw_distribution.desconocido` | 1 | IE00B18GC888 | IE00B18GC888: 1.183 → null |
| `ms.fixed_income.ytw_distribution.mas_20` | 1 | IE00B18GC888 | IE00B18GC888: 0.0 → null |
| `ms.sectors.energy` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 3.806138 → null |
| `portfolio_exposure_v2.bond_types.corporate` | 1 | IE00B18GC888 | IE00B18GC888: 0.233674 → null |
| `portfolio_exposure_v2.bond_types.securitized` | 1 | IE00B18GC888 | IE00B18GC888: 0.116272 → null |
| `portfolio_exposure_v2.sectors.energy` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.038061 → null |
| `ms.fixed_income.effective_duration` | 1 | IE00B18GC888 | IE00B18GC888: 6.14379 → null |
| `ms.fixed_income.effective_maturity` | 1 | IE00B18GC888 | IE00B18GC888: 8.19802 → null |
| `ms.fixed_income.high_yield_pct` | 1 | IE00B18GC888 | IE00B18GC888: 0.0 → null |
| `ms.fixed_income.investment_grade_pct` | 1 | IE00B18GC888 | IE00B18GC888: 98.9 → null |
| `ms.fixed_income.modified_duration` | 1 | IE00B18GC888 | IE00B18GC888: 6.14845 → null |
| `ms.fixed_income.yield_to_maturity` | 1 | IE00B18GC888 | IE00B18GC888: 4.16024 → null |
| `portfolio_exposure_v2.credit.a` | 1 | IE00B18GC888 | IE00B18GC888: 0.253473 → null |
| `portfolio_exposure_v2.credit.aa` | 1 | IE00B18GC888 | IE00B18GC888: 0.437568 → null |
| `portfolio_exposure_v2.credit.aaa` | 1 | IE00B18GC888 | IE00B18GC888: 0.137665 → null |
| `portfolio_exposure_v2.credit.b` | 1 | IE00B18GC888 | IE00B18GC888: 0.0 → null |
| `portfolio_exposure_v2.credit.bb` | 1 | IE00B18GC888 | IE00B18GC888: 0.0 → null |
| `portfolio_exposure_v2.credit.bbb` | 1 | IE00B18GC888 | IE00B18GC888: 0.160267 → null |
| `portfolio_exposure_v2.credit.below_b` | 1 | IE00B18GC888 | IE00B18GC888: 0.0 → null |
| `portfolio_exposure_v2.credit.not_rated` | 1 | IE00B18GC888 | IE00B18GC888: 0.011027 → null |
| `derived.portfolio_exposure.equity_regions_total.europe_emerging` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.0095 → null |
| `ms.regions.detail.europe_emerging` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.0095 → null |
| `portfolio_exposure_v2.equity_regions.europe_emerging` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 9.5e-05 → null |

## Campos que cambian de valor: 1725 hojas en 73 rutas

| Ruta | Hojas | ISINs | Ejemplo (antes → después) |
|---|---:|---|---|
| `classification_v2.sources_used[]` | 770 | BE0943877671, BE0946564383, BE0947853660, BE6213829094, DE0005140008, DE0005190003 (+751) | BE0943877671: "fondosdb:eodhd" → "fondosdb:config_csv" |
| `ms.holdings_top10[].weight` | 90 | IE0002PG6CA6, IE000DR59CI3, IE000M7V94E1, IE000X59ZHE2, IE00B0M62Q58, IE00B3XXRP09 (+3) | IE0002PG6CA6: 8.37 → 8.17 |
| `ms.stock.fundamentals.beta` | 69 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+63) | DE0005140008: 0.982 → 0.99 |
| `ms.stock.fundamentals.market_cap` | 69 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+63) | DE0005140008: 58992398336.0 → 66798452736.0 |
| `ms.stock.fundamentals.precio_valor_contable` | 69 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+63) | DE0005140008: 0.7769 → 0.8226 |
| `ms.stock.fundamentals.profit_margin_pct` | 69 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+63) | DE0005140008: 22.65 → 22.72 |
| `ms.stock.fundamentals.roe_pct` | 69 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+63) | DE0005140008: 8.65 → 8.89 |
| `ms.holdings_top10[].name` | 63 | IE0002PG6CA6, IE000DR59CI3, IE000M7V94E1, IE000X59ZHE2, IE00B0M62Q58, IE00B3XXRP09 (+3) | IE0002PG6CA6: "PLS Group" → "Albemarle" |
| `ms.stock.fundamentals.per` | 63 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+57) | DE0005140008: 9.7579 → 10.8055 |
| `ms.stock.fundamentals.dividend_yield_pct` | 62 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+56) | DE0005140008: 3.16 → 2.87 |
| `ms.stock.fundamentals.eps` | 62 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0007100000, DE0007164600 (+56) | DE0005140008: 3.16 → 3.29 |
| `ms.stock.fundamentals.per_adelantado` | 62 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+56) | DE0005140008: 9.5694 → 9.009 |
| `ms.stock.fundamentals.max_52s` | 47 | DE0005140008, DE0005552004, DE0005810055, DE0007164600, DE0007236101, DE0008430026 (+41) | DE0005140008: 33.0537 → 35.72 |
| `ms.stock.fundamentals.min_52s` | 46 | DE0005190003, DE0006231004, DE0007164600, DE000A1ML7J1, DE000BAY0017, ES0105025003 (+40) | DE0005190003: 56.7 → 56.4 |
| `ms.holdings_stats.top10_weight` | 9 | IE0002PG6CA6, IE000DR59CI3, IE000M7V94E1, IE000X59ZHE2, IE00B0M62Q58, IE00B3XXRP09 (+3) | IE0002PG6CA6: 61.58 → 60.85 |
| `ms.report_date` | 8 | ES0105046009, ES0105394003, ES0118900010, ES0127097030, IE00B03HCZ61, IE00B18GC888 (+2) | ES0105046009: "2026-07-17" → "2026-09-04" |
| `report_date` | 8 | ES0105046009, ES0105394003, ES0118900010, ES0127097030, IE00B03HCZ61, IE00B18GC888 (+2) | ES0105046009: "2026-07-17" → "2026-09-04" |
| `ms.objective` | 5 | DE000BAY0017, ES0105025003, FR0000052292, FR0000120271, IT0005239360 | DE000BAY0017: "Bayer Aktiengesellschaft operates as a life science comp... → "Bayer Aktiengesellschaft operates as a life science comp... |
| `quality.ok` | 4 | ES0105394003, ES0127097030, IE00B03HCZ61, IE00B18GC888 | ES0105394003: true → false |
| `routing.status` | 4 | ES0105394003, ES0127097030, IE00B03HCZ61, IE00B18GC888 | ES0105394003: "ok" → "blocked" |
| `validation.ok` | 4 | ES0105394003, ES0127097030, IE00B03HCZ61, IE00B18GC888 | ES0105394003: true → false |
| `ms.portfolio.as_of` | 3 | ES0105046009, ES0105394003, ES0118900010 | ES0105046009: "2026-07-17" → "2026-09-04" |
| `ms.stock.history_trace.last_date` | 3 | ES0105046009, ES0105394003, ES0118900010 | ES0105046009: "2026-07-17" → "2026-09-04" |
| `ms.stock.history_trace.observations_count` | 3 | ES0105046009, ES0105394003, ES0118900010 | ES0105046009: 2924 → 2959 |
| `ms.stock.valuation.vl_fecha` | 3 | ES0105046009, ES0105394003, ES0118900010 | ES0105046009: "2026-07-17" → "2026-09-04" |
| `classification_v2.asset_type` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "equity" → "other" |
| `classification_v2.region_primary_confidence` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "HIGH" → "MISSING" |
| `classification_v2.vehicle_complexity` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "index" → "standard" |
| `classification_v2.warnings[]` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "coupon_allocation_unavailable" → "asset_allocation_unavailable" |
| `derived.asset_class` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "RV" → "Otros" |
| `derived.is_index_like` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: true → false |
| `derived.portfolio_exposure.asset_allocation_total.other` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: 0.0329 → 0 |
| `ms.portfolio.asset_allocation.other` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: 0.0329 → 0 |
| `portfolio_exposure_v2.asset_mix.other` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: 0.000329 → 0.0 |
| `quality.warnings[]` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "coupon_allocation_unavailable" → "asset_allocation_unavailable" |
| `validation.diagnostics.calidad_fondosdb` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "ALTO" → "BLOQUEADO" |
| `validation.warnings[]` | 2 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: "coupon_allocation_unavailable" → "asset_allocation_unavailable" |
| `ms.stock.valuation.vl` | 2 | ES0105046009, ES0105394003 | ES0105046009: 26.16 → 25.82 |
| `derived.portfolio_exposure.asset_allocation_total.bond` | 1 | IE00B18GC888 | IE00B18GC888: 99.99166 → 0 |
| `derived.portfolio_exposure.asset_allocation_total.cash` | 1 | IE00B18GC888 | IE00B18GC888: 0.00726 → 0 |
| `derived.portfolio_exposure.asset_allocation_total.equity` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 99.9671 → 0 |
| `derived.style_bias.equity.size_weights_total.large` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 82.3506 → 0 |
| `derived.style_bias.equity.size_weights_total.mid` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 17.0161 → 0 |
| `derived.style_bias.equity.size_weights_total.small` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.6333 → 0 |
| `derived.style_bias.equity.weight_total` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 99.9671 → 0 |
| `ms.costs.ter` | 1 | LU0835722488 | LU0835722488: 2.38 → 2.49 |
| `ms.equity_style.market_cap.giant` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 47.46974 → 0 |
| `ms.equity_style.market_cap.large` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 34.69596 → 0 |
| `ms.equity_style.market_cap.mid` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 17.014997 → 0 |
| `ms.equity_style.market_cap.small` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.63184 → 0 |
| `ms.equity_style.style.blend` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 45.6533 → 0 |
| `ms.equity_style.style.growth` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 26.5501 → 0 |
| `ms.equity_style.style.value` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 27.7967 → 0 |
| `ms.fixed_income.credit_quality.a` | 1 | IE00B18GC888 | IE00B18GC888: 25.34731 → 0 |
| `ms.fixed_income.credit_quality.aa` | 1 | IE00B18GC888 | IE00B18GC888: 43.75677 → 0 |
| `ms.fixed_income.credit_quality.aaa` | 1 | IE00B18GC888 | IE00B18GC888: 13.76652 → 0 |
| `ms.fixed_income.credit_quality.bbb` | 1 | IE00B18GC888 | IE00B18GC888: 16.02666 → 0 |
| `ms.fixed_income.credit_quality.not_rated` | 1 | IE00B18GC888 | IE00B18GC888: 1.10271 → 0 |
| `ms.fixed_income.maturity_allocation.1_3` | 1 | IE00B18GC888 | IE00B18GC888: 22.24249 → 0 |
| `ms.fixed_income.maturity_allocation.3_5` | 1 | IE00B18GC888 | IE00B18GC888: 19.14598 → 0 |
| `ms.fixed_income.maturity_allocation.5_7` | 1 | IE00B18GC888 | IE00B18GC888: 13.11349 → 0 |
| `ms.fixed_income.maturity_allocation.7_10` | 1 | IE00B18GC888 | IE00B18GC888: 13.78978 → 0 |
| `ms.fixed_income.maturity_allocation.over_10` | 1 | IE00B18GC888 | IE00B18GC888: 31.2972 → 0 |
| `ms.portfolio.asset_allocation.bond` | 1 | IE00B18GC888 | IE00B18GC888: 99.99166 → 0 |
| `ms.portfolio.asset_allocation.cash` | 1 | IE00B18GC888 | IE00B18GC888: 0.00726 → 0 |
| `ms.portfolio.asset_allocation.equity` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 99.9671 → 0 |
| `ms.regions.macro.americas` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 75.72 → 0.0 |
| `ms.regions.macro.asia` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 8.4 → 0.0 |
| `ms.regions.macro.europe_me_africa` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 15.88 → 0.0 |
| `name` | 1 | ES0105394003 | ES0105394003: "TSK ELECTRONICA Y ELECTRICIDAD," → "TSK Electrónica y Electricidad, S.A." |
| `portfolio_exposure_v2.asset_mix.bond` | 1 | IE00B18GC888 | IE00B18GC888: 0.999917 → 0.0 |
| `portfolio_exposure_v2.asset_mix.cash` | 1 | IE00B18GC888 | IE00B18GC888: 7.3e-05 → 0.0 |
| `portfolio_exposure_v2.asset_mix.equity` | 1 | IE00B03HCZ61 | IE00B03HCZ61: 0.999671 → 0.0 |

## Campos que aparecen (mejora a justificar): 2476 hojas en 20 rutas

| Ruta | Hojas | ISINs | Ejemplo (antes → después) |
|---|---:|---|---|
| `validation.diagnostics.calidad_alertas` | 763 | BE0943877671, BE0946564383, BE0947853660, BE6213829094, DE0005140008, DE0005190003 (+757) | BE0943877671: null → 3 |
| `validation.diagnostics.calidad_esenciales` | 763 | BE0943877671, BE0946564383, BE0947853660, BE6213829094, DE0005140008, DE0005190003 (+757) | BE0943877671: null → "10/10" |
| `validation.diagnostics.calidad_score` | 763 | BE0943877671, BE0946564383, BE0947853660, BE6213829094, DE0005140008, DE0005190003 (+757) | BE0943877671: null → 84 |
| `classification_v2.sources_used[]` | 106 | DE0005140008, DE0005190003, DE0005552004, DE0005810055, DE0006231004, DE0007100000 (+100) | DE0005140008: null → "fondosdb:eodhd" |
| `ms.holdings_top10[].name` | 20 | LU0251119078, LU0251131362 | LU0251119078: null → "Buy USD Sell EUR on 23/06/2026 with BBH-A Purchased" |
| `ms.holdings_top10[].weight` | 20 | LU0251119078, LU0251131362 | LU0251119078: null → 6.75312 |
| `ms.holdings_top10[].sector` | 9 | LU0251119078, LU0251131362 | LU0251119078: null → "technology" |
| `validation.warnings[]` | 6 | IE00B03HCZ61, IE00B18GC888, LU0251119078, LU0251131362 | IE00B03HCZ61: null → "coupon_allocation_unavailable" |
| `validation.errors[]` | 6 | ES0105394003, ES0127097030, IE00B03HCZ61, IE00B18GC888 | ES0105394003: null → "calidad_bloqueada(esenciales=2/10)" |
| `classification_v2.warnings[]` | 4 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: null → "coupon_allocation_unavailable" |
| `quality.warnings[]` | 4 | IE00B03HCZ61, IE00B18GC888 | IE00B03HCZ61: null → "coupon_allocation_unavailable" |
| `routing.reason` | 4 | ES0105394003, ES0127097030, IE00B03HCZ61, IE00B18GC888 | ES0105394003: null → "calidad_bloqueada(esenciales=2/10)" |
| `derived.portfolio_exposure.equity_sectors_total.industrials` | 1 | IE0002PG6CA6 | IE0002PG6CA6: null → 2.66 |
| `derived.portfolio_exposure.equity_sectors_total.utilities` | 1 | IE0002PG6CA6 | IE0002PG6CA6: null → 1.53 |
| `ms.sectors.industrials` | 1 | IE0002PG6CA6 | IE0002PG6CA6: null → 2.66 |
| `ms.sectors.utilities` | 1 | IE0002PG6CA6 | IE0002PG6CA6: null → 1.53 |
| `portfolio_exposure_v2.sectors.industrials` | 1 | IE0002PG6CA6 | IE0002PG6CA6: null → 0.0266 |
| `portfolio_exposure_v2.sectors.utilities` | 1 | IE0002PG6CA6 | IE0002PG6CA6: null → 0.0153 |
| `ms.stock.fundamentals.per` | 1 | ES0132105018 | ES0132105018: null → 82.3182 |
| `ms.holdings_stats.top10_weight` | 1 | IE00B3YCGJ38 | IE00B3YCGJ38: null → 37.2 |

## ISINs con más desapariciones/cambios

| ISIN | idéntico | cambia | aparece | desaparece |
|---|---:|---:|---:|---:|
| IE00B03HCZ61 | 34 | 35 | 12 | 123 |
| IE00B18GC888 | 35 | 34 | 12 | 72 |
| NL0011585146 | 77 | 11 | 4 | 60 |
| DE0005190003 | 77 | 11 | 4 | 59 |
| FR0000052292 | 75 | 13 | 4 | 58 |
| DE0007164600 | 76 | 12 | 4 | 58 |
| DE000A1ML7J1 | 76 | 12 | 4 | 58 |
| ES0105025003 | 76 | 12 | 4 | 58 |
| ES0113211835 | 76 | 12 | 4 | 58 |
| ES0113679I37 | 76 | 12 | 4 | 58 |
| ES0116870314 | 76 | 12 | 4 | 58 |
| ES0125220311 | 76 | 12 | 4 | 58 |
| ES0130670112 | 76 | 12 | 4 | 58 |
| ES0140609019 | 76 | 12 | 4 | 58 |
| ES0173516115 | 76 | 12 | 4 | 58 |
