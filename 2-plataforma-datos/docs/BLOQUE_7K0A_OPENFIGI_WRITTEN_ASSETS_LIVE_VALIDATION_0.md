# Bloque 7K-0A - OpenFIGI Written Assets Live Validation Read-Only

## Objetivo

Preparar y ejecutar una validacion OpenFIGI live read-only, limitada a los activos ya escritos, para contrastar identificadores antes de escalar la base.

## Alcance read-only

- Firestore writes nuevos: `0`.
- Firestore deletes nuevos: `0`.
- Firestore real write gate: `NO`.
- EODHD live usado: `NO`.
- EODHD fundamentals usado: `NO`.
- OpenFIGI live ejecutado: `NO`.

## Activos seleccionados

Limite maximo confirmado: `6` activos.

- AAPL: `US0378331005`, listing `EODHD_AAPL.US`, request `ID_ISIN`.
- SPY: `US78462F1030`, listing `EODHD_SPY.US`, request `ID_ISIN`.
- QQQ: `US46090E1038`, listing `EODHD_QQQ.US`, request `ID_ISIN`.
- IWDA: `IE00B4L5Y983`, listing `EODHD_IWDA.LSE`, request `ID_ISIN`.
- AAPU: `US25461A8743`, listing `EODHD_AAPU.US`, request `ID_ISIN`.
- GSPC.INDX: `EODHD:GSPC.INDX`, listing `EODHD_GSPC.INDX`, request `TICKER` con `marketSecDes=Index`, sin forzar match automatico.

## Resultado

Estado final: `BLOCKED_SAFE`.

Motivo:

- Falta configuracion live requerida: `OPENFIGI_API_KEY` y `OPENFIGI_LIVE_DRYRUN=true`.
- No se llamo a OpenFIGI live.
- No se generaron matches, ambiguos, unmatched ni conflicts porque el bloque se detuvo antes de la llamada externa.

## Resultado por activo

Como OpenFIGI live no se ejecuto, todos los activos quedan `SKIPPED_BY_BLOCKED_SAFE` para este bloque:

- AAPL: skipped.
- SPY: skipped.
- QQQ: skipped.
- IWDA: skipped.
- AAPU: skipped.
- GSPC.INDX: skipped/review; no se forzo match por ticker/index.

## GSPC.INDX

GSPC se mantiene como caso especial:

- `asset_id`: `EODHD:GSPC.INDX`.
- ISIN: `null`.
- No se hizo match automatico.
- Estado en este bloque: `SKIPPED`, por bloqueo seguro previo a OpenFIGI live.
- Recomendacion: mantener en `REVIEW` hasta que exista una validacion fuerte.

## Artifacts

Directorio:

- `artifacts/openfigi_written_assets_live_validation_0/`

Archivos:

- `run_summary.json`
- `selected_assets.json`
- `openfigi_requests_sanitized.json`
- `openfigi_responses_sanitized.json`
- `validation_results.json`
- `confirmed_matches.json`
- `ambiguous_matches.json`
- `unmatched_assets.json`
- `conflict_candidates.json`
- `duplicate_groups.json`
- `gspc_index_review.json`
- `safety_check_summary.json`
- `repo_status_summary.json`
- `changed_files_manifest.json`
- `test_and_audit_results.json`
- `next_step_recommendation.json`

## Tests

- `npm test`: `265/265 PASS`.
- `npm run openfigi:written-assets-live-validation`: `BLOCKED_SAFE`, sin fallo destructivo.

## Confirmaciones de seguridad

- Firestore writes nuevos: `0`.
- Firestore deletes nuevos: `0`.
- `FIRESTORE_REAL_WRITE_ENABLED` activado: `NO`.
- EODHD live usado: `NO`.
- EODHD fundamentals usado: `NO`.
- OpenFIGI API key impresa: `NO`.
- EODHD API token impreso: `NO`.
- Credenciales Firebase impresas: `NO`.
- Rollback ejecutado: `NO`.
- Deploy: `NO`.
- Push: `NO`.
- Commit: `NO`.
- BDB-FONDOS tocado: `NO`.
- BDB-FONDOS-CORE tocado: `NO`.

## Siguiente recomendacion

Configurar `OPENFIGI_API_KEY` y `OPENFIGI_LIVE_DRYRUN=true` solo durante una ventana read-only controlada, y reejecutar `npm run openfigi:written-assets-live-validation`.
