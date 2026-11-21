# Bloque 7G-1 - IWDA.LSE UCITS/Europe Pilot Write

## Objetivo

Ejecutar un pilot write real altamente controlado para `IWDA.LSE`, usando solo
artifacts locales existentes y la autorizacion explicita del operador.

Estado actual: `EXECUTED_VERIFIED`.

El write real se ejecuto con 2 operaciones CREATE_ONLY y verificacion
post-write `PASS`.

## Aprendizaje incremental

IWDA aporta aprendizaje incremental porque es:

- Primer ETF UCITS/Europa preparado para write.
- Primera cotizacion `LSE` preparada.
- Primer ETF no-USA preparado despues de SPY/QQQ.
- Un caso de 1 asset root + 1 listing, con rollback y verificacion simples.

## Datos identificativos IWDA

- Requested ticker: `IWDA.LSE`
- Asset ID / ISIN: `IE00B4L5Y983`
- Asset type: `ETF`
- Name: `iShares Core MSCI World UCITS ETF USD (Acc)`
- Exchange: `LSE`
- Listing ID: `EODHD_IWDA.LSE`
- Currency: `USD`
- Source artifact: `artifacts/representative_etf_live_dryrun_0/mapped_assets.json`

No se uso EODHD live, OpenFIGI live ni EODHD fundamentals en este bloque.

## Paths previstos

1. `assets/IE00B4L5Y983`
2. `assets/IE00B4L5Y983/listings/EODHD_IWDA.LSE`

Alcance:

- Selected asset roots: `1`
- Selected operations: `2`
- Price series: `0`
- Metrics: `0`

## Pre-write snapshot

Resultado:

- `assets/IE00B4L5Y983` missing: `SI`
- `assets/IE00B4L5Y983/listings/EODHD_IWDA.LSE` missing: `SI`
- Existing docs en selected paths: `0`
- Read errors: `0`
- Matches expected state: `SI`

## Write approval manifest

Estado:

- Gate ID: `firestore_iwda_ucits_pilot_write_0`
- `authorized`: `true`
- `can_write`: `true`
- `firestore_writes_allowed`: `true`
- `prepare_only`: `false`
- `max_asset_roots`: `1`
- `max_operations`: `2`
- Operator confirmation required: `true`
- Operator confirmation received: `true`

Todas las validaciones pre-write pasaron antes de abrir el gate real.

## Rollback manifest

Rollback manifest generado antes del write:

1. `assets/IE00B4L5Y983/listings/EODHD_IWDA.LSE`
2. `assets/IE00B4L5Y983`

Estado:

- Generated before write: `SI`
- Rollback authorization required: `SI`
- Rollback executed: `NO`
- Firestore deletes: `0`

## Protected assets precheck

AAPL/AAPU/GSPC/SPY/QQQ comprobados por readback contra artifacts previos:

- AAPL modified: `NO`
- AAPU modified: `NO`
- GSPC modified: `NO`
- SPY modified: `NO`
- QQQ modified: `NO`
- Status: `PASS`

## Resultado del write real

Ejecutado con la frase exacta:

`CONFIRMO EL WRITE REAL firestore_iwda_ucits_pilot_write_0 DE 2 OPERACIONES`

- Firestore writes: `2`
- Firestore deletes: `0`
- Real write attempted: `SI`
- Real write executed: `SI`
- Batch count: `1`

Paths escritos:

1. `assets/IE00B4L5Y983`
2. `assets/IE00B4L5Y983/listings/EODHD_IWDA.LSE`

## Post-write verification

Estado: `PASS`

- Readback de los 2 selected paths.
- Exact match contra payload escrito.
- `asset_type=ETF`.
- ISIN `IE00B4L5Y983`.
- Listing `IWDA.LSE` / `EODHD_IWDA.LSE`.
- No `price_series`.
- No `metrics`.
- No paths fuera de seleccion.
- Deletes `0`.
- Rollback manifest disponible.
- AAPL/AAPU/GSPC/SPY/QQQ intactos.

Resultado:

- Existing paths: `2/2`
- Missing paths: `0`
- Payload mismatches: `0`
- Type or identifier mismatches: `0`
- Paths fuera de seleccion: `0`
- Price series written: `0`
- Metrics written: `0`
- Firestore deletes: `0`
- Protected assets untouched: `SI`

## Tests y auditorias

- `npm test`: `197/197 PASS`
- `npm run firestore:post-write-closeout-audit`: `PASS`
- `npm run firestore:aapl-enriched-closeout-audit`: `PASS`
- `npm run firestore:diversified-closeout-audit`: `PASS`
- `npm run firestore:representative-etf-closeout-audit`: `FAIL_EXPECTED_AFTER_7G1`

La auditoria historica 7F-1B exige que IWDA no exista. Tras este bloque,
IWDA existe por autorizacion explicita, por lo que esa auditoria deja de ser
aplicable como closeout del estado vivo actual. No indica mismatch en SPY/QQQ.

## Artifacts generados

Carpeta: `artifacts/firestore_iwda_ucits_pilot_write_0/`

- `pilot_selection.json`
- `pre_write_snapshot.json`
- `real_write_plan.json`
- `write_approval_manifest.json`
- `rollback_manifest_real_0.json`
- `post_write_verification_plan.json`
- `existing_assets_untouched_precheck.json`
- `write_execution_result.json`
- `post_write_verification_result.json`
- `final_write_summary.json`
- `existing_assets_untouched_postcheck.json`

## Confirmacion final

- Firestore writes = `2`
- Firestore deletes = `0`
- Real write attempted = `SI`
- Real write executed = `SI`
- Selected asset roots <= 1: `SI`
- Selected operations <= 2: `SI`
- Price series written = `0`
- Metrics written = `0`
- AAPL/AAPU/GSPC/SPY/QQQ modified = `NO`
- Post-write verification = `PASS`
- Payload mismatches = `0`
- Paths fuera de seleccion = `0`
- Rollback manifest generated = `SI`
- Rollback executed = `NO`
- `FIRESTORE_REAL_WRITE_ENABLED` activo al final = `NO`
- Credenciales impresas = `NO`
- EODHD_API_TOKEN impreso = `NO`
- serviceAccountKey en repo = `NO`
- Deploy = `NO`
- Commit = `NO`
- Push = `NO`
- BDB-FONDOS = `NO`
- BDB-FONDOS-CORE = `NO`
- EODHD Fundamentals = `NO`
- EODHD live = `NO`
- OpenFIGI live = `NO`

## Siguiente paso recomendado

Abrir un bloque 7G-1B de closeout read-only especifico para IWDA UCITS, para
reemplazar la expectativa historica 7F de "IWDA no escrito" por una verificacion
actual de "IWDA escrito exactamente y sin price_series/metrics".
