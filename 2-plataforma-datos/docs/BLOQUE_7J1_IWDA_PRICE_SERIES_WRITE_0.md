# Bloque 7J-1 - IWDA Price Series + Metrics Pilot Write

## Objetivo

Ejecutar un write real controlado para `IWDA.LSE`, limitado a los documentos candidatos de `price_series` y `metrics` generados en el dry-run 7J-0A, sin tocar el asset root, el listing ni otros activos.

## Paths escritos

- `assets/IE00B4L5Y983/price_series/EODHD_IWDA.LSE_YEAR_2026`
- `assets/IE00B4L5Y983/metrics/EODHD_IWDA.LSE_LATEST`

## Snapshot previo

Paths leidos antes del write:

- `assets/IE00B4L5Y983`
- `assets/IE00B4L5Y983/listings/EODHD_IWDA.LSE`
- `assets/IE00B4L5Y983/price_series/EODHD_IWDA.LSE_YEAR_2026`
- `assets/IE00B4L5Y983/metrics/EODHD_IWDA.LSE_LATEST`

Resultado:

- IWDA asset root: existente.
- IWDA listing: existente.
- Target price_series: missing.
- Target metrics: missing.
- Root/listing coinciden con el write 7G.
- `blocked_safe`: `false`.

## Rollback manifest

Rollback manifest generado antes del write:

- `rollback_manifest.json`
- Rollback ejecutado: `NO`.
- Paths a borrar solo si se autoriza rollback futuro:
  - `assets/IE00B4L5Y983/metrics/EODHD_IWDA.LSE_LATEST`
  - `assets/IE00B4L5Y983/price_series/EODHD_IWDA.LSE_YEAR_2026`

## Write gate

- Gate id: `firestore_iwda_price_series_write_0`.
- Max asset roots: `1`.
- Max operations: `2`.
- Operation mode: `CREATE`.
- Selected asset id: `IE00B4L5Y983`.
- Selected paths: exactamente los 2 paths indicados.
- Forbidden paths incluyen IWDA root/listing y activos protegidos AAPL/AAPU/GSPC/SPY/QQQ.
- Operator confirmation: recibida via variable de proceso temporal.

## Resultado real write

- Estado: `PASS`.
- Firestore writes nuevos: `2`.
- Firestore writes acumulados estimados: `23`.
- Firestore deletes nuevos: `0`.
- Paths fuera de seleccion: `0`.
- Payload mismatches: `0`.
- Relationship mismatches: `0`.

## Post-write verification

- Required paths existing: `2/2`.
- Observations: `107`.
- First date: `2026-01-02`.
- Last date: `2026-06-05`.
- Invalid prices: `0`.
- Duplicate dates: `0`.
- Sorted ascending: `true`.
- Metrics recalculation match: `true`.
- Currency/unit note preserved: `true`.
- Protected assets untouched: `true`.

## Metricas principales

- Cumulative return: `0.0885659656`.
- Annualized volatility: `0.1407388991`.
- Max drawdown: `-0.0830864929`.
- Sharpe ratio: `1.2191726177`.
- CAGR: `null`, periodo inferior a 365 dias.
- History quality status: `OK`.

## Currency/unit note

La nota `READY_WITH_NOTE` de 7J-0A se preservo en los payloads escritos.

- `/eod/IWDA.LSE` no traia divisa/unidad explicita.
- Listing validado en 7G: `USD`.
- Rango observado: `123.82` a `144.62`.
- No parecia GBX/pence.
- No se aplico conversion automatica.

## Tests y auditorias

- `npm test`: `255/255 PASS`.
- `npm run firestore:post-write-closeout-audit`: `PASS`.
- `npm run firestore:aapl-enriched-closeout-audit`: `PASS`.
- `npm run firestore:diversified-closeout-audit`: `PASS`.
- `npm run firestore:representative-etf-closeout-audit`: `PASS`.
- `npm run firestore:iwda-ucits-closeout-audit`: `PASS`.
- `npm run firestore:spy-price-series-closeout-audit`: `PASS`.
- `npm run firestore:qqq-price-series-closeout-audit`: `PASS`.

## Artifacts

Directorio:

- `artifacts/firestore_iwda_price_series_write_0/`

Archivos:

- `pre_write_snapshot.json`
- `rollback_manifest.json`
- `write_approval_manifest.json`
- `real_write_plan.json`
- `real_write_result.json`
- `post_write_verification_0.json`
- `safety_check_summary.json`
- `changed_files_manifest.json`
- `repo_status_summary.json`
- `test_and_audit_results.json`
- `final_write_summary.json`
- `price_series_payload.json`
- `metrics_payload.json`

## Confirmaciones de seguridad

- Firestore writes nuevos: `2`.
- Firestore deletes nuevos: `0`.
- `FIRESTORE_REAL_WRITE_ENABLED` activo al final: `NO`.
- EODHD live usado en 7J-1: `NO`.
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

## Siguiente paso recomendado

`7J-1B - IWDA Price Series Closeout Read-Only Audit`, si se quiere un closeout especifico e independiente equivalente a SPY/QQQ. Si se considera suficiente la verificacion post-write + auditorias read-only, el siguiente paso puede ser `7J-2 - Safe Commit for IWDA Price Series Cycle`.
