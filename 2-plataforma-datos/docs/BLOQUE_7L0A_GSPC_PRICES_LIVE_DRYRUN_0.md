# Bloque 7L-0A - GSPC.INDX Prices Live Dry-Run & Metrics Preparation

## Objetivo

Preparar en modo live dry-run controlado el candidato local de precios historicos y metricas para `GSPC.INDX`, sin escribir en Firestore y sin resolver el identificador provisional del indice/proxy.

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

- Ticker procesado: `GSPC.INDX`.
- Numero de tickers procesados: `1`.
- Asset esperado: `EODHD:GSPC.INDX`.
- Listing esperado: `EODHD_GSPC.INDX`.
- Endpoint usado: `/eod/GSPC.INDX`.
- Rango solicitado: `2026-01-01` a `2026-06-06`.
- API token: no impreso y no guardado en artifacts.

## Candidatos locales

Paths futuros propuestos solo como candidatos, sin write:

- `assets/EODHD:GSPC.INDX/price_series/EODHD_GSPC.INDX_YEAR_2026`
- `assets/EODHD:GSPC.INDX/metrics/EODHD_GSPC.INDX_LATEST`

Artifacts principales:

- `artifacts/gspc_prices_live_dryrun_0/gspc_price_series_candidate.json`
- `artifacts/gspc_prices_live_dryrun_0/gspc_metrics_candidate.json`

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
- Cumulative return: `0.0765870208`.
- Annualized volatility: `0.1400338573`.
- Max drawdown: `-0.0909752516`.
- Sharpe ratio: `1.0369878659`.
- CAGR: `null`, periodo inferior a 365 dias.
- Observations count: `107`.
- History quality status: `OK`.

## Revision indice/proxy

Estado: `REVIEW_FOR_7L_1`.

Motivo:

- La serie de precios y metricas es localmente valida.
- `GSPC.INDX` sigue siendo un asset provisional/proxy de EODHD.
- No tiene ISIN validado.
- No se intento resolver por OpenFIGI.
- No se infirio ISIN.
- No se creo un nuevo asset_id.
- No se intento fusionar con otro indice.
- No se intento resolver por nombre.

El candidato debe tratarse como metricas del proxy `EODHD:GSPC.INDX`.

## Tests

- `npm test`: `273/273 PASS`.
- `npm run dryrun:gspc-prices-live`: `REVIEW_FOR_7L_1`.

## Artifacts

Directorio:

- `artifacts/gspc_prices_live_dryrun_0/`

Archivos:

- `dryrun_summary.json`
- `gspc_price_series_candidate.json`
- `gspc_metrics_candidate.json`
- `validation_report.json`
- `index_proxy_review.json`
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

`REVIEW_FOR_7L_1`.

El candidato esta preparado localmente y pasa las validaciones de serie/metricas, pero requiere aceptacion explicita de la condicion proxy/provisional antes de cualquier write.

## Proximo bloque recomendado

`7L-1 - GSPC.INDX Price Series & Metrics Pilot Write`, solo con autorizacion explicita y manteniendo el alcance de proxy provisional.
