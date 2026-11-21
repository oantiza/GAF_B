# Bloque 7I-0A - QQQ Prices Live Dry-Run & Metrics Preparation

## Objetivo

Crear un dry-run live controlado para obtener precios historicos de `QQQ.US`
desde EODHD, normalizar una candidata `price_series`, calcular metricas locales
y generar artifacts seguros para preparar un posible write controlado 7I-1.

Este bloque no escribio en Firestore.

## Relacion con SPY 7H-0A

Se reutilizo el patron del dry-run de SPY 7H-0A:

- Una sola request principal EODHD `/eod/{ticker}`.
- Rango YTD 2026.
- Mapper EODHD existente para price_series anual.
- Calculador local de metricas.
- Artifacts locales como unica salida.

QQQ usa los identificadores ya escritos previamente:

- Ticker: `QQQ.US`
- Asset ID: `US46090E1038`
- Listing ID: `EODHD_QQQ.US`
- Source price ID previsto: `EODHD_QQQ.US_YEAR_2026`

## Endpoint EODHD

- Endpoint: `/eod/QQQ.US`
- From: `2026-01-01`
- To: `2026-06-06`
- Max tickers: `1`
- Max primary requests: `1`
- Fundamentals: `NO`
- API key: redacted, no impresa

## Observaciones obtenidas

- Observations count: `107`
- First date: `2026-01-02`
- Last date: `2026-06-05`
- Sorted ascending: `true`
- Duplicate date count: `0`
- Invalid price count: `0`
- Missing close count: `0`

## Validacion de precios

Resultado: `PASS`

- `observations_count >= 20`: `SI`
- `source_price_id = EODHD_QQQ.US_YEAR_2026`: `SI`
- `listing_id = EODHD_QQQ.US`: `SI`
- `asset_id = US46090E1038`: `SI`
- Fechas ordenadas ascendentemente: `SI`
- Duplicados: `0`
- Precios invalidos: `0`
- Mapping issues: `0`

Se usa `adjusted_close` cuando esta disponible; si no, `close`.

## Metricas calculadas

Resultado: `OK`

- Daily returns: calculados y materializados en `metrics_payload_candidate.json`
- Cumulative return: `0.1514039155`
- Annualized volatility: `0.1935841386`
- Max drawdown: `-0.1172361275`
- Sharpe ratio: `1.6220686389`
- CAGR: `null`
- Observations count: `107`
- First date: `2026-01-02`
- Last date: `2026-06-05`
- History quality status: `OK`

Nota: CAGR queda `null` porque el periodo YTD disponible es de 154 dias, menor
que 365 dias. Esto no bloquea 7I-1.

## Artifacts generados

Carpeta: `artifacts/qqq_prices_live_dryrun_0/`

- `price_request.json`
- `raw_price_response.json`
- `normalized_price_series.json`
- `price_series_payload_candidate.json`
- `metrics_payload_candidate.json`
- `metrics_calculation_report.json`
- `validation_report.json`
- `dryrun_summary.json`
- `next_step_recommendation.json`

## Tests y auditorias

- `npm test`: `241/241 PASS`
- `npm run firestore:post-write-closeout-audit`: `PASS`
- `npm run firestore:aapl-enriched-closeout-audit`: `PASS`
- `npm run firestore:diversified-closeout-audit`: `PASS`
- `npm run firestore:representative-etf-closeout-audit`: `PASS`
- `npm run firestore:iwda-ucits-closeout-audit`: `PASS`
- `npm run firestore:spy-price-series-closeout-audit`: `PASS`
- `npm run dryrun:qqq-prices-live`: `PASS`

## Seguridad

- Firestore writes: `0`
- Firestore deletes: `0`
- EODHD live: `SI`, solo precios `QQQ.US`
- EODHD fundamentals: `NO`
- OpenFIGI live: `NO`
- API key impresa: `NO`
- Credenciales Firebase impresas: `NO`
- serviceAccountKey en repo: `NO`
- Deploy: `NO`
- Commit: `NO`
- Push: `NO`
- BDB-FONDOS: `NO`
- BDB-FONDOS-CORE: `NO`

## Recomendacion

`candidate_ready_for_7I1 = true`.

Se recomienda abrir 7I-1 como pilot write controlado para QQQ price_series +
metrics, con alcance maximo:

- `assets/US46090E1038/price_series/EODHD_QQQ.US_YEAR_2026`
- `assets/US46090E1038/metrics/EODHD_QQQ.US_LATEST`

El write real debe quedar bloqueado por gate especifico, limites exactos,
snapshot read-only, rollback manifest previo y post-write verification exacta.
