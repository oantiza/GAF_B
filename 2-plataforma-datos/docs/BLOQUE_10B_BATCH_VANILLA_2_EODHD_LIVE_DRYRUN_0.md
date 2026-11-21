# Bloque 10B — Batch Vanilla 2 EODHD Live Dry-Run Candidate Acquisition

## Contexto y Objetivo
Tras la selección del "Batch Vanilla 2" (VTI.US, AGG.US, ACWI.US, GLD.US) en el Bloque 10A, este Bloque 10B ejecuta una adquisición (dry-run) controlada conectando con la API de EODHD. 

El objetivo ha sido validar las identidades básicas y capturar la metadata de estos 4 activos provisionales, determinando los `listing_id` y `asset_id` preliminares.

Se ha operado con estricto apego a las restricciones de seguridad: sin escrituras a Firestore, sin usar /fundamentals, y sin invocar a OpenFIGI.

## Ejecución del Dry-Run

Se desarrolló y ejecutó el script `scripts/runBatchVanilla2EodhdDryRun.ts`. 
Los 4 candidatos se buscaron vía el endpoint de EODHD `/search/{ticker}`.

| Ticker Solicitado | EODHD Code Encontrado | Nombre (Name) | Exchange | Type / Asset Class | Asset ID Propuesto | Decisión |
|---|---|---|---|---|---|---|
| **VTI.US** | VTI.US | Vanguard Total Stock Market Index Fund | US | ETF | eodhd_vti_us | **ACQUIRED_CANDIDATE** |
| **AGG.US** | AGG.US | iShares Core US Aggregate Bond ETF | US | ETF | eodhd_agg_us | **ACQUIRED_CANDIDATE** |
| **ACWI.US** | ACWI.US | iShares MSCI ACWI ETF | US | ETF | eodhd_acwi_us | **ACQUIRED_CANDIDATE** |
| **GLD.US** | GLD.US | SPDR Gold Shares | US | ETF | eodhd_gld_us | **ACQUIRED_CANDIDATE** |

Los 4 candidatos fueron encontrados e identificados exitosamente sin ambigüedades. No hay candidatos diferidos, en revisión, ni bloqueados.

## Artefactos Generados
En `artifacts/batch_vanilla_2_eodhd_live_dryrun_0/`:
* `input_candidate_manifest.json`: Manifiesto original desde el Bloque 10A.
* `eodhd_request_plan.json`: Endpoints solicitados a la API.
* `eodhd_response_summary.json`: Resumen general de los aciertos y resultados de cada petición.
* `acquired_candidates.json`: Los 4 activos con su payload base provisional generado.
* `review_candidates.json`: Vacío.
* `rejected_candidates.json`: Vacío.
* `dryrun_summary.json`: Resultados de la corrida (`PASS`).
* `safety_check_summary.json`: Certificación del cumplimiento de bloqueos.
* `next_step_recommendation.json`: Siguiente acción.

## Validación de Seguridad
- **Firestore Writes / Deletes**: 0
- **FIRESTORE_REAL_WRITE_ENABLED**: INACTIVO
- **EODHD Fundamentals (Llamadas)**: NO (Prohibido)
- **OpenFIGI Live**: NO (Prohibido)
- **BDB-FONDOS/CORE Tocado**: NO
- **Keys Expuestas**: NO
- **Commits/Push**: NO

## Siguiente Paso Recomendado
Se recomienda proceder al **Bloque 10C — Batch Vanilla 2 OpenFIGI Fixture/Prepare Review**, en el cual se validarán las identidades provisionales generadas aquí contra OpenFIGI y se prepararán las estructuras de identifiers anidadas para estos 4 activos.
