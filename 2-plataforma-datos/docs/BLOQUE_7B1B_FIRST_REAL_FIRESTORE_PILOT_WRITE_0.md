# Bloque 7B-1B: First Real Firestore Pilot Write

## Objetivo del bloque

Ejecutar el primer write real piloto en Firestore con una seleccion minima, verificable y
reversible solo mediante autorizacion posterior. El runner genera todos los artifacts
preventivos, relee Firestore inmediatamente antes del posible commit y mantiene el write
bloqueado hasta recibir una confirmacion de operador independiente.

## Seleccion piloto final

Se selecciona un solo asset root con cuatro listings ya leidos en el snapshot 7B-1A:

1. `assets/US0378331005`
2. `assets/US0378331005/listings/EODHD_AAPL.US`
3. `assets/US0378331005/listings/EODHD_AAPL.BA`
4. `assets/US0378331005/listings/EODHD_AAPL.NEO`
5. `assets/US0378331005/listings/EODHD_AAPL.MX`

La seleccion tiene `1` asset root y `5` operaciones `CREATE_ONLY`. No incluye
`price_series`, `metrics`, ingestion masiva, duplicate group merges, BLOCKED candidates
ni el asset canadiense `CA03785Y1007`, que permanece fuera del piloto por estar en
`REVIEW`.

## Por que se limita a maximo 2 asset roots

El limite reduce el radio de impacto del primer write real y permite comprobar
manualmente cada path y payload. Aunque el gate permite como maximo `2` roots y `20`
operaciones, este piloto usa solo `1` root y `5` operaciones.

## Pre-write snapshot

El snapshot live read-only obligatorio se ejecuto antes de preparar el piloto:

- Reads attempted: `7`
- Existing docs: `0`
- Missing docs: `7`
- Firestore writes: `0`
- Firestore deletes: `0`

El runner 7B-1B releyo despues los `5` selected paths:

- Reads attempted: `5`
- Reads successful: `5`
- Existing docs: `0`
- Missing docs: `5`
- Read errors: `0`
- Matches expected state: `true`

Tras finalizar `PREPARE_ONLY`, un nuevo snapshot live read-only confirmo otra vez
`0 existing / 7 missing`, demostrando que la preparacion no escribio nada.

Inmediatamente antes del write real, el runner releyo los `5` selected paths y confirmo:

- Existing docs: `0`
- Missing docs: `5`
- Read errors: `0`
- Matches expected state: `true`

Despues del write, una lectura live read-only independiente sobre los `7` paths
originales confirmo:

- Existing docs: `5`, exactamente los selected paths
- Missing docs: `2`, exactamente los paths canadienses no seleccionados
- Firestore writes durante la lectura: `0`
- Firestore deletes durante la lectura: `0`

## Write approval manifest

`write_approval_manifest.json` fue generado con:

- `gate_id`: `firestore_first_pilot_write_0`
- `authorized`: `true`
- `can_write`: `true`
- `firestore_writes_allowed`: `true`
- `max_asset_roots`: `2`
- `max_operations`: `20`
- `operator_confirmation_required`: `true`
- `operator_confirmation_received`: `true`

Todas las validaciones preventivas pasaron. Tras recibir la confirmacion explicita,
`real_write_lock_verification.json` registro:

- `prepare_only`: `false`
- `write_lock_enforced`: `false`
- `real_write_permitted`: `true`

## Real write plan

El plan usa un unico batch atomico y exclusivamente operaciones `CREATE`. El writer usa
`batch.create`, que rechaza el commit si cualquiera de los documentos aparece entre el
snapshot y el commit. No existe ninguna llamada a `delete` ni una ruta ejecutable de
rollback.

Todos los payloads incluyen:

- `write_gate_id: firestore_first_pilot_write_0`
- `write_gate_status: OK`

Los selected paths coinciden exactamente y en el mismo orden con `real_write_plan.json`.

## Rollback manifest generado

`rollback_manifest_real_0.json` fue generado antes de cualquier posible write. Documenta
los paths nuevos que se borrarian solo con autorizacion posterior y ordena primero los
listings y al final el asset root.

- Rollback manifest generated: `SI`
- Rollback authorization required: `SI`
- Rollback executed: `NO`
- Firestore deletes: `0`

## Resultado del write real

Estado actual: `EXECUTED_AND_VERIFIED`.

- Real write attempted: `SI`
- Real write executed: `SI`
- Firestore writes: `5`
- Firestore deletes: `0`
- Batch count: `1`

Artifacts generados despues del write:

- `write_execution_result.json`: generado
- `post_write_verification_result.json`: generado
- `final_write_summary.json`: generado

## Resultado de post-write verification

Estado actual: `PASS`.

- Existing selected paths: `5`
- Missing selected paths: `0`
- Payload mismatches: `0`
- Status mismatches: `0`
- Paths written outside selection: `0`
- Expected write count: `5`
- Actual write count: `5`
- Firestore deletes: `0`
- Rollback manifest available: `true`

## Conteo exacto y paths escritos

- Documentos escritos: `5`
- Paths fuera de seleccion escritos: ninguno

Paths exactos escritos:

1. `assets/US0378331005`
2. `assets/US0378331005/listings/EODHD_AAPL.US`
3. `assets/US0378331005/listings/EODHD_AAPL.BA`
4. `assets/US0378331005/listings/EODHD_AAPL.NEO`
5. `assets/US0378331005/listings/EODHD_AAPL.MX`

## Verificaciones ejecutadas

- `npm test`: `106/106 PASS`
- `npm run dryrun:firestore-write-gate-design`: `PASS`
- `npm run dryrun:firestore-write-gate-preflight`: `PASS` (comando retirado el 17-10-2026, decisión 6.8: el script está en `_legacy/scripts/`)
- `npm run firestore:live-snapshot-readonly`: `PASS` (comando retirado el 17-10-2026, decisión 6.8: el script está en `_legacy/scripts/`)
- `npm run firestore:first-pilot-write` con `PREPARE_ONLY=true`: `PASS`, write bloqueado
- Snapshot read-only posterior a preparacion: `PASS`, `0 existing / 7 missing`
- `npm run firestore:first-pilot-write` con confirmacion explicita: `PASS`, `5 writes`
- Post-write verification integrada: `PASS`
- Snapshot read-only independiente posterior al write: `PASS`, `5 existing / 2 missing`
- `npm test` posterior al write: `106/106 PASS`

El chequeo TypeScript aislado de los archivos nuevos pasa. El chequeo TypeScript global
continua bloqueado por errores de configuracion y tipado heredados fuera de este bloque.

## Riesgos pendientes

1. Los cinco documentos piloto permanecen en Firestore; no se ha autorizado ni ejecutado
   rollback.
2. El post-write verifier confirma lo escrito por este runner mediante su ledger exacto;
   no intenta atribuir writes concurrentes de otros actores.
3. El asset canadiense en `REVIEW` sigue excluido y requiere una decision separada.

## Siguiente paso recomendado

Mantener el piloto sin cambios y revisar sus documentos antes de autorizar cualquier
ampliacion de seleccion, escritura de `price_series`/`metrics` o rollback.

## Confirmacion final actual

- Firestore writes = `5`
- Firestore deletes = `0`
- Real write attempted = `SI`
- Real write executed = `SI`
- Selected asset roots <= 2 = `SI` (`1`)
- Selected operations <= 20 = `SI` (`5`)
- Post-write verification = `PASS`
- Rollback manifest generated = `SI`
- Rollback executed = `NO`
- Credenciales impresas = `NO`
- serviceAccountKey en repo = `NO`
- Deploy = `NO`
- Commit = `NO`
- Push = `NO`
- BDB-FONDOS = `NO`
- BDB-FONDOS-CORE = `NO`
- EODHD Fundamentals = `NO`
- OpenFIGI live = `NO`
