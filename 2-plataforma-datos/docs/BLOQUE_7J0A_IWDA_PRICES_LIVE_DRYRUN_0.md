# Bloque 7J-0A - IWDA Prices Live Dry-Run & Metrics Preparation

## Objetivo

Preparar en modo live dry-run controlado el candidato local de `price_series` y `metrics` para `IWDA.LSE`, reutilizando el patron validado en SPY y QQQ, sin escribir en Firestore y sin preparar un write real.

## Restricciones aplicadas

- Firestore writes: `0`.
- Firestore deletes: `0`.
- `FIRESTORE_REAL_WRITE_ENABLED`: no activado.
- EODHD live usado: si, solo dry-run de precios historicos.
- Endpoint usado: `/eod/IWDA.LSE`.
- Tickers procesados: `1`.
- Fundamentals usado: `NO`.
- Llamada `/fundamentals`: `NO`.
- OpenFIGI live: `NO`.
- API key impresa: `NO`.
- Credenciales Firebase impresas: `NO`.
- Deploy: `NO`.
- Push: `NO`.
- Commit: `NO`.

## Inputs

- Ticker: `IWDA.LSE`.
- Asset id esperado: `IE00B4L5Y983`.
- Listing id esperado: `EODHD_IWDA.LSE`.
- Source price id candidato: `EODHD_IWDA.LSE_YEAR_2026`.
- Price series path candidato: `assets/IE00B4L5Y983/price_series/EODHD_IWDA.LSE_YEAR_2026`.
- Metrics path candidato: `assets/IE00B4L5Y983/metrics/EODHD_IWDA.LSE_LATEST`.

## Artifacts

Directorio:

- `artifacts/iwda_prices_live_dryrun_0/`

Archivos principales:

- `dryrun_summary.json`
- `iwda_price_series_candidate.json`
- `iwda_metrics_candidate.json`
- `validation_report.json`
- `currency_unit_review.json`
- `safety_check_summary.json`
- `changed_files_manifest.json`
- `repo_status_summary.json`
- `test_and_audit_results.json`
- `next_step_recommendation.json`

Tambien se conservaron:

- `price_request.json`
- `raw_price_response.json`
- `normalized_price_series.json`
- `metrics_calculation_report.json`

## Resultado de precios

- Observations: `107`.
- First date: `2026-01-02`.
- Last date: `2026-06-05`.
- Invalid prices: `0`.
- Duplicate dates: `0`.
- Sorted ascending: `true`.
- Precio usado para metricas: `adjusted_close` cuando esta disponible.
- Mapping issues: `0`.

## Metricas calculadas

- Daily returns: `106`.
- Cumulative return: `0.0885659656`.
- CAGR: `null`, por periodo inferior a 365 dias.
- Annualized volatility: `0.1407388991`.
- Max drawdown: `-0.0830864929`.
- Sharpe ratio: `1.2191726177`.
- Observations count: `107`.
- History quality status: `OK`.

## Revision de divisa/unidad

El endpoint `/eod/IWDA.LSE` no incluye campos explicitos de divisa o unidad.

Resultado:

- `endpoint_provides_currency_or_unit`: `false`.
- Divisa esperada desde el listing validado en 7G: `USD`.
- Divisa mapeada en el candidato local: `USD`.
- Rango de precios seleccionados: `123.82` a `144.62`.
- `price_magnitude_looks_pence_or_gbx`: `false`.
- Conversion automatica aplicada: `false`.
- Review status: `READY_WITH_NOTE`.

Conclusion:

La unidad/divisa no queda confirmada por el endpoint de precios historicos, pero el listing validado de IWDA usa `USD` y la magnitud observada no parece GBX/pence. Las metricas de retorno son internamente consistentes. No se aplico ninguna conversion.

## Tests

- `npm test`: `255/255 PASS`.
- `npm run dryrun:iwda-prices-live`: `READY_FOR_7J_1`.

## Estado final

Estado final: `READY_FOR_7J_1`.

Motivo:

El candidato `price_series` y el candidato `metrics` para `IWDA.LSE` pasaron la validacion local, con serie ordenada, sin precios invalidos, sin duplicados, con metricas calculadas y con revision de divisa/unidad no bloqueante.

## Proximo bloque recomendado

`7J-1 - IWDA Price Series & Metrics Pilot Write`, solo con autorizacion explicita de write real.

Alcance recomendado para 7J-1:

- Max asset roots: `1`.
- Max real writes: `2`.
- Price series path: `assets/IE00B4L5Y983/price_series/EODHD_IWDA.LSE_YEAR_2026`.
- Metrics path: `assets/IE00B4L5Y983/metrics/EODHD_IWDA.LSE_LATEST`.
- Mantener sin fundamentals y sin OpenFIGI live.
