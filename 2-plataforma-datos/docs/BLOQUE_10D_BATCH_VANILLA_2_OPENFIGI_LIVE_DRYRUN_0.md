# Bloque 10D — Batch Vanilla 2 OpenFIGI Live Dry-Run Validation

## Contexto y Objetivo
En el bloque 10C elaboramos un plan de petición a OpenFIGI (request plan) utilizando fixtures sintéticos.
El presente bloque 10D ejecuta finalmente ese plan contra la **API Live de OpenFIGI**, de forma estrictamente limitada a los **4 identificadores ISIN** del Batch Vanilla 2 (VTI, AGG, ACWI, GLD).

El objetivo es obtener los identificadores reales de OpenFIGI sin realizar escrituras a la base de datos Firestore (dry-run).

## Ejecución del Request Plan Live
El payload fue limitado rigurosamente a las 4 peticiones:
1. `{ "idType": "ID_ISIN", "idValue": "US9229087690" }` (VTI.US)
2. `{ "idType": "ID_ISIN", "idValue": "US4642872265" }` (AGG.US)
3. `{ "idType": "ID_ISIN", "idValue": "US4642882579" }` (ACWI.US)
4. `{ "idType": "ID_ISIN", "idValue": "US78463V1070" }` (GLD.US)

## Resultados Obtenidos
Dado que se buscó exclusivamente por `ID_ISIN` sin forzar la resolución cruzada con `micCode` o `exchCode` (respetando la prohibición de resolver ambigüedades de forma automática en este paso), la API de OpenFIGI devolvió todos los listados globales existentes para cada ISIN:

| Ticker | ISIN | Matches Totales | Estado Final |
|---|---|---|---|
| **VTI.US** | US9229087690 | 101 | **AMBIGUOUS_MATCHES** |
| **AGG.US** | US4642872265 | 101 | **AMBIGUOUS_MATCHES** |
| **ACWI.US**| US4642882579 | 99 | **AMBIGUOUS_MATCHES** |
| **GLD.US** | US78463V1070 | 235 | **AMBIGUOUS_MATCHES** |

Los 4 candidatos se catalogan correctamente como **AMBIGUOUS_MATCHES** (`REVIEW_REQUIRED`) debido a la multiplicidad de plazas bursátiles devueltas por OpenFIGI. La decisión de cuál listing específico elegir (ej. XNYS vs ARCX vs XNAS) queda diferida para el proceso de depuración (deduplication/review).

## Artefactos Generados
Ruta: `artifacts/batch_vanilla_2_openfigi_live_dryrun_0/`
* `input_request_plan.json`: Solicitudes base provenientes de 10C.
* `openfigi_live_request_payload_redacted.json`: El payload exacto sin exponer el token.
* `openfigi_live_response_summary.json`: El recuento de matches.
* `confirmed_identity_candidates.json`: (Vacío, dado que todos son ambiguos).
* `ambiguous_candidates.json`: Los 4 candidatos marcados por multiplicidad de listings.
* `review_candidates.json`: (Vacío).
* `rejected_candidates.json`: (Vacío).
* `duplicate_groups.json`: (Vacío).
* `safety_check_summary.json`: Registro del cumplimiento de las barreras de protección.
* `dryrun_summary.json`: Estado de la ejecución.

## Validación de Seguridad
- **Firestore Writes / Deletes:** 0.
- **FIRESTORE_REAL_WRITE_ENABLED:** No activado.
- **API Keys / Tokens Impresos:** NO. El payload está redactado.
- **Modificación de Assets o `asset_id`:** NO.
- **Flat `identifiers.figi`:** NO.
- **BDB-FONDOS/CORE tocados:** NO.
- **Deploy / Commit / Push:** NO.

## Siguiente Paso Recomendado
Se recomienda avanzar al **Bloque 10E — Batch Vanilla 2 Firestore Write Gate Prep**, donde tomaremos los candidatos (actualmente en estado ambiguo) y los pasaremos por la lógica de deduplicación interna o revisión manual para consolidar la estructura final de identidades (seleccionando el primary listing de EE.UU.), preparando los objetos de escritura de Firestore, pero manteniendo un modo dry-run / de preparación (todavía sin escrituras reales).
