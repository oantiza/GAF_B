# Bloque 7J-1B - IWDA Price Series Closeout Read-Only Audit

## Objetivo

Ejecutar un closeout read-only independiente del ciclo IWDA price_series + metrics, confirmando que el estado live de Firestore coincide exactamente con el write autorizado de 7J-1.

## Alcance read-only

- Firestore writes nuevos en 7J-1B: `0`.
- Firestore deletes nuevos en 7J-1B: `0`.
- Rollback ejecutado: `NO`.
- EODHD live usado: `NO`.
- EODHD fundamentals usado: `NO`.
- OpenFIGI live usado: `NO`.

## Paths verificados

- `assets/IE00B4L5Y983`
- `assets/IE00B4L5Y983/listings/EODHD_IWDA.LSE`
- `assets/IE00B4L5Y983/price_series/EODHD_IWDA.LSE_YEAR_2026`
- `assets/IE00B4L5Y983/metrics/EODHD_IWDA.LSE_LATEST`

## Comparacion payload/hash

- Required IWDA paths existing: `4/4`.
- Payload mismatches: `0`.
- Relationship mismatches: `0`.
- Los hashes y payloads live coinciden con los payloads autorizados de:
  - `artifacts/firestore_iwda_ucits_pilot_write_0/real_write_plan.json`
  - `artifacts/firestore_iwda_price_series_write_0/real_write_plan.json`

## Recalculo de metricas

- Metrics recalculation match: `true`.
- Observations: `107`.
- First date: `2026-01-02`.
- Last date: `2026-06-05`.
- Invalid prices: `0`.
- Duplicate dates: `0`.
- Sorted ascending: `true`.
- History quality status: `OK`.

Metricas principales validadas:

- Cumulative return: `0.0885659656`.
- Annualized volatility: `0.1407388991`.
- Max drawdown: `-0.0830864929`.
- Sharpe ratio: `1.2191726177`.
- CAGR: `null`.

## Relationships

- `asset_id`: `IE00B4L5Y983`.
- `listing_id`: `EODHD_IWDA.LSE`.
- `source_price_id`: `EODHD_IWDA.LSE_YEAR_2026`.
- `metrics.price_series_path`: `assets/IE00B4L5Y983/price_series/EODHD_IWDA.LSE_YEAR_2026`.
- IWDA root y listing existen y coinciden con los payloads previos autorizados.
- Listing currency preservada: `USD`.

## Currency/unit check

- Status: `PASS`.
- `currency_unit_review_status`: `READY_WITH_NOTE` preservado en price_series y metrics.
- Listing validado en 7G: `USD`.
- Rango observado: `123.82` a `144.62`.
- No parece GBX/pence.
- Conversion automatica aplicada: `NO`.
- Listing currency modificada en este bloque: `NO`.

## Paths inesperados

- Status: `PASS`.
- Price series docs encontrados bajo IWDA:
  - `assets/IE00B4L5Y983/price_series/EODHD_IWDA.LSE_YEAR_2026`
- Metrics docs encontrados bajo IWDA:
  - `assets/IE00B4L5Y983/metrics/EODHD_IWDA.LSE_LATEST`
- Price series inesperadas: `0`.
- Metrics inesperadas: `0`.

## Activos untouched

- Status: `PASS`.
- AAPL untouched: `PASS`.
- AAPU untouched: `PASS`.
- GSPC untouched: `PASS`.
- SPY untouched: `PASS`.
- QQQ untouched: `PASS`.

## Tests

- `npm test`: `259/259 PASS`.
- `npm run firestore:iwda-price-series-closeout-audit`: `PASS`.

## Auditorias read-only

- `npm run firestore:post-write-closeout-audit`: `PASS`.
- `npm run firestore:aapl-enriched-closeout-audit`: `PASS`.
- `npm run firestore:diversified-closeout-audit`: `PASS`.
- `npm run firestore:representative-etf-closeout-audit`: `PASS`.
- `npm run firestore:iwda-ucits-closeout-audit`: `PASS`.
- `npm run firestore:spy-price-series-closeout-audit`: `PASS`.
- `npm run firestore:qqq-price-series-closeout-audit`: `PASS`.

## Artifacts

Directorio:

- `artifacts/firestore_iwda_price_series_closeout_audit_0/`

Archivos:

- `closeout_readonly_snapshot.json`
- `closeout_verification_result.json`
- `metrics_recalculation_check.json`
- `currency_unit_check.json`
- `untouched_assets_check.json`
- `unexpected_paths_check.json`
- `safety_check_summary.json`
- `repo_status_summary.json`
- `changed_files_manifest.json`
- `test_and_audit_results.json`
- `final_closeout_summary.json`

## Confirmaciones de seguridad

- `FIRESTORE_REAL_WRITE_ENABLED` activado: `NO`.
- EODHD live usado: `NO`.
- EODHD fundamentals usado: `NO`.
- OpenFIGI live usado: `NO`.
- API keys impresas: `NO`.
- Credenciales Firebase impresas: `NO`.
- Rollback ejecutado: `NO`.
- Deploy: `NO`.
- Push: `NO`.
- Commit: `NO`.
- BDB-FONDOS tocado: `NO`.
- BDB-FONDOS-CORE tocado: `NO`.

## Estado final

`PASS`.

## Siguiente paso recomendado

`7J-2 - Safe Commit IWDA Price Series Cycle`.
