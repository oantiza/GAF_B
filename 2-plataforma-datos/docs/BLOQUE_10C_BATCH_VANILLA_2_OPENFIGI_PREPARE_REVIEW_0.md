# Bloque 10C — Batch Vanilla 2 OpenFIGI Fixture/Prepare Review

## Contexto y Objetivo
A partir de los 4 candidatos adquiridos vía EODHD en el bloque 10B (VTI.US, AGG.US, ACWI.US, GLD.US), este bloque prepara la fase de revisión y enriquecimiento de identidades mediante OpenFIGI.

Dado que este bloque exige no contactar todavía de forma real a la API OpenFIGI (Live = NO), y no se contaba con fixtures reales pre-cacheados de estos tickers específicos del Batch 2, se ha generado un **Fixture Sintético** (`synthetic_fixture`). 
El objetivo es planificar las peticiones (request plan) que se enviarán en el siguiente bloque 10D, y validar la correcta anidación y esquema de datos (identifiers.figi, identifiers.composite_figi, etc.) sin impactar bases reales.

## Estrategia de Request Plan
Para maximizar la precisión, las llamadas planificadas siguen la regla de oro: **Priorizar ISIN**. Dado que los 4 activos (provenientes de EODHD) poseen ISIN válido, todas las requests se configuraron con `idType: ID_ISIN` y su respectivo valor, apoyándose en el `micCode: XNAS` sintético/por defecto para los fines del fixture.

## Resultados del Dry-Run y Fixture
Se ejecutó el script planificador `runBatchVanilla2OpenFigiPrepareReview.ts`.

| Ticker | ISIN Detectado | ID_TYPE Planificado | Estado Resultante | Identificadores Sintéticos (Muestra) |
|---|---|---|---|---|
| **VTI.US** | US9229087690 | ID_ISIN | **PREPARED_FOR_REVIEW** | FIGI: `BBG000922908` |
| **AGG.US** | US4642872265 | ID_ISIN | **PREPARED_FOR_REVIEW** | FIGI: `BBG000464287` |
| **ACWI.US**| US4642882579 | ID_ISIN | **PREPARED_FOR_REVIEW** | FIGI: `BBG000464288` |
| **GLD.US** | US78463V1070 | ID_ISIN | **PREPARED_FOR_REVIEW** | FIGI: `BBG00078463V` |

No existieron matches ambiguos ni duplicados entre las respuestas generadas en el Fixture Plan.

## Artefactos Generados
Ruta: `artifacts/batch_vanilla_2_openfigi_prepare_review_0/`
* `input_acquired_candidates.json`: Candidatos provenientes de 10B.
* `openfigi_request_plan.json`: El plan de request a OpenFIGI (basado en ISIN).
* `fixture_mode_plan.json`: Fixture sintético marcando `_is_synthetic_fixture: true`.
* `fixture_response_summary.json`: Resumen de matches encontrados en el fixture.
* `prepared_identity_candidates.json`: Candidatos enriquecidos con la estructura `identifiers` anidada correcta (sin claves planas prohibidas).
* `ambiguous_candidates.json`: (Vacío)
* `review_candidates.json`: (Vacío)
* `rejected_candidates.json`: (Vacío)
* `duplicate_groups.json`: (Vacío)
* `safety_check_summary.json`: Control de seguridad riguroso.
* `dryrun_summary.json`: PASS global.

## Validación de Seguridad
- **Firestore Writes/Deletes:** 0
- **OpenFIGI Live:** NO invocado.
- **EODHD Fundamentals:** NO.
- **Claves planas `identifiers.*` creadas:** NO.
- **BDB-FONDOS/CORE modificados:** NO.
- **Commits / Push:** NO.

## Siguiente Paso Recomendado
**10D — Batch Vanilla 2 OpenFIGI Live Dry-Run Validation**. En este bloque enviaremos el request plan generado aquí (`openfigi_request_plan.json`) a la API de OpenFIGI real en modo dry-run (limitado a 4 identificadores) para capturar los identificadores globales auténticos y mapearlos sin escribir a Firestore.
