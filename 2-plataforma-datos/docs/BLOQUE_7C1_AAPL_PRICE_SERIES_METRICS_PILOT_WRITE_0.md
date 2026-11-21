# Bloque 7C-1: AAPL Price Series & Metrics Pilot Write

## Objetivo del bloque

Añadir una primera serie de precios minima y un documento de metricas derivadas al AAPL
ya verificado, manteniendo un unico asset root, un unico listing y verificacion exacta.

Estado actual: `EXECUTED_AND_VERIFIED`.

## Asset root y listing seleccionados

- Asset root: `assets/US0378331005`
- Listing: `assets/US0378331005/listings/EODHD_AAPL.US`
- Asset roots seleccionados: `1`
- Operaciones propuestas: `2`

Paths nuevos propuestos:

1. `assets/US0378331005/price_series/EODHD_AAPL.US_YEAR_2026`
2. `assets/US0378331005/metrics/EODHD_AAPL.US_LATEST`

No se propone modificar el asset root, el listing existente ni ningun otro asset.

## Fuente local de precios y metricas

La serie se toma exclusivamente del artifact local:

`artifacts/eodhd_prices_dryrun_0/mapped_price_years.json`

No se realizo ninguna llamada EODHD live en este bloque. El artifact local fue generado
en un bloque anterior y su `input_config.json` registra `useLiveApi=true`; 7C-1 solo lee
el JSON ya existente.

El artifact previo `price_metrics_dryrun_0/metrics_latest_candidates.json` contiene una
referencia AAPL basada en `42` observaciones, mientras la serie minima seleccionada
contiene `21`. Para evitar una relacion inconsistente, el payload de metrics se recalcula
localmente con el calculador existente sobre exactamente las mismas `21` observaciones.
La referencia previa queda documentada, pero no se copia como payload.

## Payload de price_series

- `source_price_id`: `EODHD_AAPL.US_YEAR_2026`
- `listing_id`: `EODHD_AAPL.US`
- Año: `2026`
- Observaciones: `21`
- Primera fecha: `2026-05-05`
- Ultima fecha: `2026-06-03`
- Source mode: `LOCAL_ARTIFACT_ONLY`
- Write gate status: `OK`

Payload completo: `artifacts/firestore_aapl_price_series_pilot_write_0/price_series_payload.json`

## Payload de metrics

Las metricas se derivan de la serie propuesta y apuntan explicitamente a:

- `source_price_id`: `EODHD_AAPL.US_YEAR_2026`
- `price_series_path`: `assets/US0378331005/price_series/EODHD_AAPL.US_YEAR_2026`
- `listing_id`: `EODHD_AAPL.US`
- Observaciones: `21`
- History quality status: `OK`
- Write gate status: `OK`

`cagr` permanece `null` y el payload documenta `INSUFFICIENT_PERIOD_FOR_CAGR` porque el
periodo seleccionado es de 29 dias.

Payload completo: `artifacts/firestore_aapl_price_series_pilot_write_0/metrics_payload.json`

## Pre-write snapshot

El runner ejecuto una lectura real read-only de cuatro paths:

- Asset root existe: `true`
- Listing existe: `true`
- Root y listing coinciden con el primer write: `true`
- Price series propuesta missing: `true`
- Metrics propuesta missing: `true`
- Read errors: `0`

Antes de esta preparacion tambien pasaron:

- `npm run firestore:post-write-closeout-audit`: `PASS`, `5/5` existentes y `2/2` no seleccionados missing
- `npm run firestore:live-snapshot-readonly`: `PASS`, `5` existentes y `2` missing (comando retirado el 17-10-2026, decisión 6.8: el script está en `_legacy/scripts/`)

## Write approval manifest

Todas las validaciones preventivas pasan:

- `authorized`: `true`
- `can_write`: `true`
- `firestore_writes_allowed`: `true`
- `operator_confirmation_required`: `true`
- `operator_confirmation_received`: `true`
- `prepare_only`: `false`
- Max asset roots: `1`
- Max operations: `5`
- Operaciones seleccionadas: `2`

Antes del commit, el runner releyo los cuatro paths y confirmo de nuevo que root y
listing existian, coincidian con el primer write y los dos paths propuestos seguian
missing.

## Real write plan

El plan usa un unico batch atomico con dos operaciones `CREATE`. El writer utiliza
`batch.create`, por lo que abortara si cualquiera de los paths aparece antes del commit.

Plan completo: `artifacts/firestore_aapl_price_series_pilot_write_0/real_write_plan.json`

## Rollback manifest

El rollback manifest fue generado antes de cualquier posible write y cubre ambos paths.
No contiene una ruta de ejecucion automatica.

Orden documentado, solo si se autoriza un rollback futuro:

1. Metrics
2. Price series

- Rollback manifest generated: `SI`
- Rollback executed: `NO`
- Firestore deletes: `0`

## Resultado del write real

Estado actual:

- Firestore writes: `2`
- Firestore deletes: `0`
- Real write attempted: `SI`
- Real write executed: `SI`
- Post-write verification: `PASS`
- Batch count: `1`

Artifacts posteriores al write:

- `write_execution_result.json`: generado
- `post_write_verification_result.json`: generado
- `final_write_summary.json`: generado

Paths exactos escritos:

1. `assets/US0378331005/price_series/EODHD_AAPL.US_YEAR_2026`
2. `assets/US0378331005/metrics/EODHD_AAPL.US_LATEST`

## Post-write verification

- Existing selected paths: `2/2`
- Missing selected paths: `0`
- Payload mismatches: `0`
- Relationship mismatches: `0`
- Paths escritos fuera de seleccion: `0`
- Expected/actual write count: `2/2`
- Firestore deletes: `0`
- Rollback manifest available: `true`

Una lectura read-only independiente posterior confirmo los cuatro paths AAPL relevantes:

- Asset root: existente
- Listing `EODHD_AAPL.US`: existente
- Price series: existente, `source_price_id=EODHD_AAPL.US_YEAR_2026`
- Metrics: existente, enlazada a la price series correcta
- Writes/deletes durante readback independiente: `0/0`

El closeout base posterior al write tambien permanece `PASS`: los cinco documentos del
primer piloto siguen exactos y los dos paths canadienses continúan missing.

## Tests y verificaciones

- `npm test`: `127/127 PASS`
- Chequeo TypeScript aislado de 7C-1: `PASS`
- `firestore:post-write-closeout-audit`: `PASS`
- `firestore:live-snapshot-readonly`: `PASS` (comando retirado el 17-10-2026, decisión 6.8: el script está en `_legacy/scripts/`)
- Preparacion `firestore:aapl-price-series-pilot-write`: `PASS`, write bloqueado
- Write real `firestore:aapl-price-series-pilot-write`: `PASS`, `2 writes / 0 deletes`
- Post-write verification integrada: `PASS`
- Readback independiente exacto: `PASS`, `4/4` existentes
- Closeout base posterior: `PASS`, `5/5` base existentes y `2/2` canadienses missing
- `npm test` posterior al write: `127/127 PASS`

## Riesgos pendientes

1. El artifact local de precios se genero previamente con EODHD live, aunque 7C-1 no
   realiza ninguna llamada live.
2. La serie minima contiene solo 21 observaciones y no permite calcular CAGR.
3. Los dos documentos nuevos permanecen en Firestore; cualquier rollback futuro requiere
   autorizacion separada.

## Siguiente paso recomendado

Crear un closeout read-only especifico para el estado AAPL enriquecido y, despues,
decidir entre ampliar la historia de precios de AAPL o preparar un segundo piloto
diversificado. No realizar ingestion masiva todavia.

## Confirmacion final actual

- Firestore writes = `2`
- Firestore deletes = `0`
- Real write attempted = `SI`
- Real write executed = `SI`
- Selected asset roots = `1`
- Selected operations <= 5 = `SI` (`2`)
- Post-write verification = `PASS`
- Payload mismatches = `0`
- Paths fuera de seleccion = `0`
- Rollback manifest generated = `SI`
- Rollback executed = `NO`
- FIRESTORE_REAL_WRITE_ENABLED quedo activo = `NO`
- Credenciales impresas = `NO`
- serviceAccountKey en repo = `NO`
- Deploy = `NO`
- Commit = `NO`
- Push = `NO`
- BDB-FONDOS = `NO`
- BDB-FONDOS-CORE = `NO`
- EODHD Fundamentals = `NO`
- OpenFIGI live = `NO`
