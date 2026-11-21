# Bloque 7M-0A - AAPU Prices Live Dry-Run & Leveraged ETF Review

## Objetivo

Preparar en modo live dry-run controlado el candidato local de precios historicos y metricas para `AAPU.US`, sin escribir en Firestore, y con revision explicita de producto ETF single-stock apalancado.

## Restricciones aplicadas

- Firestore writes: `0`.
- Firestore deletes: `0`.
- `FIRESTORE_REAL_WRITE_ENABLED` activado: `NO`.
- EODHD Fundamentals usado: `NO`.
- Llamada a `/fundamentals`: `NO`.
- OpenFIGI live usado: `NO`.
- Deploy, push, commit: `NO`.
- BDB-FONDOS y BDB-FONDOS-CORE tocados: `NO`.

## Inputs

- Ticker procesado: `AAPU.US`.
- Numero de tickers procesados: `1`.
- Asset esperado: `US25461A8743`.
- Listing esperado: `EODHD_AAPU.US`.
- Endpoint usado: `/eod/AAPU.US`.
- Rango solicitado: `2026-01-01` a `2026-06-06`.
- API token: no impreso y no guardado en artifacts.

## Candidatos locales

Paths futuros propuestos solo como candidatos, sin write:

- `assets/US25461A8743/price_series/EODHD_AAPU.US_YEAR_2026`
- `assets/US25461A8743/metrics/EODHD_AAPU.US_LATEST`

Artifacts principales:

- `artifacts/aapu_prices_live_dryrun_0/aapu_price_series_candidate.json`
- `artifacts/aapu_prices_live_dryrun_0/aapu_metrics_candidate.json`

## Observaciones

- Observations count: `107`.
- First date: `2026-01-02`.
- Last date: `2026-06-05`.
- Invalid prices: `0`.
- Duplicate dates: `0`.
- Sorted ascending: `true`.
- `adjusted_close` usado si existe: `true`.
- Mapping issues: `0`.

## Metricas

- Daily returns: calculados.
- Cumulative return: `0.2138492872`.
- Annualized volatility: `0.4825578904`.
- Max drawdown: `-0.2282114462`.
- Sharpe ratio: `1.1119163272`.
- CAGR: `null`, periodo inferior a 365 dias.
- Observations count: `107`.
- History quality status: `OK`.

## Revision ETF single-stock apalancado

Estado: `REVIEW_FOR_7M_1`.

Resultado:

- `leveraged_single_stock_etf`: `true`.
- `representative_diversified_etf`: `false`.
- `status_recommended`: `REVIEW_FOR_7M_1`.
- `write_recommendation`: `DO_NOT_WRITE_UNTIL_APPROVED`.
- Las metricas son tecnicamente calculables.
- Las metricas no implican idoneidad.
- Puede requerir reglas especiales de suitability/risk bucket.
- No se cambio status en Firestore.
- No se normalizo como ETF representativo/diversificado.

Motivo:

- AAPU es Direxion Daily AAPL Bull 1.5X Shares segun artifact local 7D.
- Es un ETF single-stock apalancado.
- No es comparable a SPY/QQQ/IWDA.
- Cualquier write futuro debe ser autorizado explicitamente.

## Tests

- `npm test`: `281/281 PASS`.
- `npm run dryrun:aapu-prices-live`: `REVIEW_FOR_7M_1`.

## Artifacts

Directorio:

- `artifacts/aapu_prices_live_dryrun_0/`

Archivos:

- `dryrun_summary.json`
- `aapu_price_series_candidate.json`
- `aapu_metrics_candidate.json`
- `validation_report.json`
- `leveraged_etf_review.json`
- `safety_check_summary.json`
- `changed_files_manifest.json`
- `repo_status_summary.json`
- `test_and_audit_results.json`
- `next_step_recommendation.json`
- `price_request.json`
- `raw_price_response.json`
- `normalized_price_series.json`
- `metrics_calculation_report.json`

## Estado final

`REVIEW_FOR_7M_1`.

El candidato esta preparado localmente y pasa las validaciones de serie/metricas, pero AAPU debe permanecer en review por la naturaleza del producto.

## Proximo bloque recomendado

No escribir automaticamente. `7M-1` solo si el usuario autoriza expresamente el write de este producto en review.
