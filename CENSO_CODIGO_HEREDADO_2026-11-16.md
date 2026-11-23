# Censo del código heredado (PLA-9 / A-160)

Fecha: 16-11-2026. Es el primer paso de la decisión A-160 de Óscar: el censo que él ve antes de que se borre nada.
Solo lectura sobre la rama `claude/auditoria-decisiones`: nada se ha editado, borrado ni ejecutado. Convierte la
estimación de PLA-9 («unos 80 guiones», «6.100 líneas de Functions») en una lista comprobada.

**Cómo leerlo.** Lo hizo una sesión auxiliar de solo lectura, con el grafo de quién importa a quién y una búsqueda de cada
nombre en todo el repositorio; la sesión de la auditoría lo repasó por muestreo, no pieza a pieza. Lo marcado MUERTO es
candidato a borrar, no una orden: cada tanda de borrado se da por buena con las suites en verde, no con esta lista. Las
tres decisiones que el borrado necesita de Óscar están al final.

## (a) Resumen

**Las dos cifras de PLA-9 salen bien.** En la plataforma, **80 entradas de `package.json`** apuntan a código muerto (95 ficheros de `scripts/`, porque algunos no tienen entrada). En las Functions, `portfolio_real/` (5.776 líneas) + `real_history.py` (192) + las cinco Functions sin llamador (63 líneas en `main.py`) son **6.031 líneas**, más 54 de `validate_live.py`: 6.085 con él, que es la cifra de «6.100».

Pero el tamaño real del problema es mayor que esas dos cifras, porque cada guion muerto arrastra módulos de `src/` que solo él usa (18.944 líneas) y pruebas que se van con ellos.

### Plataforma de datos (`2-plataforma-datos`)

| Pieza | Clase | Ficheros | Líneas |
|---|---|---:|---:|
| `scripts/` | VIVO | 14 | 3.327 |
| `scripts/` | SOLO BASE DE SIEMPRE | 6 (5 `.ts` + el `.bat` de copias) | 1.059 |
| `scripts/` | DUDOSO | 4 | 528 |
| `scripts/` | **MUERTO** | **95** | **18.150** |
| `src/` | VIVO | 27 | 9.975 |
| `src/` | SOLO BASE DE SIEMPRE | 28 | 7.363 |
| `src/` | DUDOSO | 1 | 306 |
| `src/` | **MUERTO** | **89** | **18.944** |
| `tests/` | se van enteras con lo muerto | 74 | 8.643 |
| `tests/` | mixtas: hay que editarlas | 10 | 1.114 |
| `docs/` | documentos `BLOQUE_*` (102) y `PROMPT_CODEX_*` (20) de lo muerto | 122 | ≈ 9.100 solo los BLOQUE |
| `data/` | 7 ficheros de muestra, usados solo por dryruns muertos | 7 | — |

Lo MUERTO de la plataforma, sin contar documentos: **95 + 89 + 74 = 258 ficheros y unas 45.700 líneas** (guiones + módulos + pruebas). Ya había 33 ficheros (8.083 líneas) apartados en `_legacy/`, que quedan fuera de este cálculo.

### Functions de `main.py` (51 en total)

| Clase | Functions | Líneas aprox. en `main.py` |
|---|---:|---:|
| VIVO (las 23 de `desplegarFunciones.mjs`, todas con llamada en la app) | 23 | 360 |
| SOLO BASE DE SIEMPRE (`get_system_status` y 10 `admin_*` que la app local llama) | 11 | 149 |
| DUDOSO (11 `scheduled_*` + `admin_reconcile_search_index`) | 12 | 223 |
| **MUERTO** (`analyze_real_portfolio`, `save_real_analysis`, `list_real_analyses`, `delete_real_analysis`, `get_portfolio`) | **5** | **63** |

### Módulos de `functions_python` (sin tests ni `scripts/`)

| Clase | Módulos | Líneas |
|---|---:|---:|
| VIVO | 49 | 15.787 |
| SOLO BASE DE SIEMPRE | 11 | 5.402 |
| DUDOSO | 4 | 921 |
| **MUERTO** (`portfolio_real/` 7 módulos, `real_history.py`, `validate_live.py`) | **9** | **6.022** |

Pruebas Python que se irían con `portfolio_real`/`real_history`: **14 ficheros, 4.539 líneas**, más 10 mixtas que hay que editar. Sumando lo muerto de las Functions: unas **10.600 líneas** entre código y pruebas.

### Otros (de paso, sin censo completo)
- `3-BDB-ACTIVOS_app/scripts/`: 5 huérfanos claros (`purgeCssD3.mjs`, `shotsD3.mjs`, `recompute_reviewed_nav_metrics.py`, `repair_holdings_schema_labels.py`, `repair_ubam_currency.py`), 354 líneas; y `capturaMaquetas.mjs` DUDOSO.
- `1-extractor/tools/`: 3 sin ninguna referencia y 1 solo con su prueba (todos DUDOSO, son herramientas manuales).

## Método y qué está comprobado y qué es suposición

**Comprobado (herramienta propia de lectura, sin ejecutar nada del proyecto):**
- Grafo de imports de los 4 grupos de TypeScript (`src`, `scripts`, `tests` de la plataforma) y de los módulos Python (`ast`), calculando qué alcanza cada punto de entrada vivo. Los puntos de entrada vivos son los de la tarea (lo que lanza `refrescar.mjs`, `baseNueva:*`, `nube:*`, `planes:*`, `carteras:*`, `audit:base-nueva`, `audit:series`, `dryrun:base-nueva`, `backup:restore-drill`, lo que nombran las habilidades, `AGENTS.md` y los README) y lo que lanza el extractor (`ops_plataforma.py`: `load:fondosdb`, `republish:fondosdb`, `audit:consistency`, `backup:export`, `archive:assets`, `reclassify:stock`).
- Para cada pieza MUERTA se buscó su nombre de fichero y su nombre de `npm run` en todos los `.md`, `.mjs`, `.json`, `.py`, `.ts`, `.tsx`, `.ps1`, `.bat`, `.yml` rastreados por Git (salvo `contracts_cache`, `artifacts`, `data` y `_legacy`), separando referencias vivas, pruebas y documentos históricos. Dio cero referencias vivas.
- Llamadas de la app a cada Function: búsqueda de su nombre en `3-BDB-ACTIVOS_app/src` (adaptadores `httpsCallable`).

**Suposiciones y límites (léanse antes de borrar):**
- Un módulo cuenta como «alcanzado» si algún vivo lo importa, aunque solo use una parte. En `functions_python` el límite es el módulo, no la función: el puente es `price_history_sync.py`, que `optimization/repository.py` importa (`adjustment_problem`) y que a su vez importa de forma perezosa `price_refresh` e `ingest_asset`. Esos imports perezosos los traté como rutas de refresco (clase SOLO BASE DE SIEMPRE), no como uso desplegado. Si se quisiera medir exacto habría que mirar qué función llama a cuál.
- No se siguen referencias dinámicas (rutas construidas con cadenas, `spawn` con nombres calculados). Se buscaron los nombres literales, pero no se han ejecutado las pruebas para confirmar que siguen pasando tras borrar.
- Las líneas son de `split` por salto de línea, ±1 por fichero. Las de cada Function en `main.py` incluyen los ayudantes privados que quedan entre una y la siguiente.
- «SOLO BASE DE SIEMPRE» para lo que lanza el extractor (`ops_plataforma.py`, Sistema > Operaciones de la app local) y para las Functions `admin_*` de la app local. Que existan llamadas desde la app no prueba que Óscar use hoy esas pantallas.

## (b) Tablas por carpeta

### 2-plataforma-datos/scripts (guiones)

| Ruta | Lineas | Clase | Evidencia | Pruebas que se van con el |
|---|---:|---|---|---|
| `scripts/darAdministrador.ts` | 50 | VIVO | nube:administrador; lo cita 3-BDB-ACTIVOS_app/scripts/set_admin.py como la orden que da el claim admin |  |
| `scripts/restoreBackupToEmulator.ts` | 222 | VIVO | backup:restore-drill, nombrado en la habilidad, README raiz y README de 4-base-nueva (restaura la copia al emulador de la base de siempre) |  |
| `scripts/runBaseNuevaAudit.ts` | 390 | VIVO | npm audit:base-nueva; lo lanza 4-base-nueva/refrescar.mjs y lo nombran las dos habilidades |  |
| `scripts/runBaseNuevaBatch.ts` | 287 | VIVO | baseNueva:batch; lo lanza refrescar.mjs |  |
| `scripts/runBaseNuevaBorrados.ts` | 130 | VIVO | baseNueva:borrar; la habilidad pipeline-extractor lo nombra como paso vigente (PLA-1) |  |
| `scripts/runBaseNuevaDryRun.ts` | 329 | VIVO | dryrun:base-nueva; habilidad pipeline-extractor |  |
| `scripts/runBaseNuevaSeries.ts` | 167 | VIVO | baseNueva:series; lo lanza refrescar.mjs |  |
| `scripts/runBaseNuevaSeriesAudit.ts` | 192 | VIVO | audit:series; habilidad pipeline-extractor |  |
| `scripts/runBaseNuevaWrite.ts` | 313 | VIVO | baseNueva:write/plan; lo lanza refrescar.mjs |  |
| `scripts/runCarterasDryRun.ts` | 140 | VIVO | dryrun:carteras; habilidad pipeline-extractor |  |
| `scripts/runCarterasWrite.ts` | 201 | VIVO | carteras:plan/write; habilidad pipeline-extractor, probar-reglas.mjs |  |
| `scripts/runPlanesWrite.ts` | 98 | VIVO | planes:plan/write; AGENTS.md, habilidad pipeline-extractor, probar-reglas.mjs |  |
| `scripts/subirALaNube.ts` | 673 | VIVO | nube:plan/subir; refrescar.mjs, AGENTS.md, README de 4-base-nueva |  |
| `scripts/verReglasDesplegadas.ts` | 135 | VIVO | nube:reglas; README de 4-base-nueva y habilidad |  |
| `scripts/maintainLocalBackups.ts` | 107 | SOLO BASE DE SIEMPRE | lo importa runBackupExport; backup:retention y backup_export_daily.bat |  |
| `scripts/reconcileSearchIndexLive.ts` | 139 | SOLO BASE DE SIEMPRE | search-index:reconcile; src/loader/README.md dice que es el unico escritor de meta/search_index (base de siempre) |  |
| `scripts/restoreSriKidEvidence.ts` | 204 | SOLO BASE DE SIEMPRE | repair:sri-evidence; scripts/README.md y habilidad pipeline-extractor lo dan como reparacion vigente. Escribe risk.sri_kid_evidence en assets |  |
| `scripts/runBackupExport.ts` | 429 | SOLO BASE DE SIEMPRE | backup:export; lo llama 1-extractor/core/ops_plataforma.py y lo nombran README raiz y habilidad. Copia assets/ + meta/ (base de siempre) |  |
| `scripts/runCompactPriceSeries.ts` | 171 | SOLO BASE DE SIEMPRE | compact:price-series; lo da como comando principal 2-plataforma-datos/README.md. Opera sobre price_series de assets |  |
| `scripts/reoriginarCarteras.ts` | 198 | BORRADO el 20-11-2026 (Óscar: «Borrar migraciones usadas») | carteras:reoriginar, paso C de la migracion de carteras viejas a la nueva (solo lectura de las dos bases). Solo lo cita PLAN_INDEPENDENCIA. Mirar si queda trabajo del asesor por sacar de la base vieja |  |
| `scripts/reoriginarRetrocesiones.ts` | 91 | BORRADO el 20-11-2026 (Óscar: «Borrar migraciones usadas») | retro:reoriginar, igual para retrocesiones. Ninguna doc vigente lo cita |  |
| `scripts/runBdbDeployedFunctionsStockSmoke.ts` | 152 | DUDOSO | sin entrada en package.json; sonda de lectura de las Functions desplegadas; el README raiz la cita solo como historia; projectAllowlist.test.ts LEE su texto (fallaria si se borra) |  |
| `scripts/runRetrocesionesWrite.ts` | 87 | BORRADO el 20-11-2026 (Óscar: «Borrar migraciones usadas») | retro:plan/write; escribe retrocesiones en el emulador de la base nueva desde el fichero de reoriginar. Nadie lo cita; subirALaNube ya importa retrocesiones.ts. Mirar si se sigue usando para cargar retrocesiones |  |
| `scripts/archiveLegacyAssets.ts` | 203 | MUERTO | npm archive:legacy-assets; sin referencias vivas; 1 docs historicos |  |
| `scripts/auditAppOwnedData.ts` | 93 | MUERTO | npm audit:app-owned; sin referencias vivas | appOwnedDataInventory.test.ts |
| `scripts/cleanupAuditOrphans.ts` | 189 | MUERTO | npm cleanup:audit-orphans; sin referencias vivas | cleanupAuditOrphans.test.ts |
| `scripts/dryrunOwnershipBackup.ts` | 349 | MUERTO | npm ownership:dryrun; sin referencias vivas; 1 docs historicos | dryrunOwnershipBackup.test.ts |
| `scripts/migratePriceSeriesV12.ts` | 174 | MUERTO | npm contracts:migrate-price-series-v12; sin referencias vivas; 4 docs historicos |  |
| `scripts/runAapuPricesLiveDryRun.ts` | 509 | MUERTO | npm dryrun:aapu-prices-live; sin referencias vivas; 1 docs historicos | aapuPricesLiveDryRun.test.ts |
| `scripts/runApiContractPreview.ts` | 161 | MUERTO | sin referencias vivas |  |
| `scripts/runApiHandlerPreview.ts` | 120 | MUERTO | npm preview:api-handler; sin referencias vivas |  |
| `scripts/runBatchVanilla2CorrectedWriteGateReadinessReview.ts` | 189 | MUERTO | sin referencias vivas |  |
| `scripts/runBatchVanilla2EodhdDryRun.ts` | 160 | MUERTO | sin referencias vivas; 1 docs historicos |  |
| `scripts/runBatchVanilla2FirestoreWriteGatePrep.ts` | 167 | MUERTO | sin referencias vivas |  |
| `scripts/runBatchVanilla2FirestoreWriteGatePrepCorrection.ts` | 183 | MUERTO | sin referencias vivas |  |
| `scripts/runBatchVanilla2FirestoreWriteGateReadinessReview.ts` | 70 | MUERTO | sin referencias vivas |  |
| `scripts/runBatchVanilla2OpenFigiDisambiguationDryRun.ts` | 247 | MUERTO | sin referencias vivas; 1 docs historicos |  |
| `scripts/runBatchVanilla2OpenFigiLiveDryRun.ts` | 201 | MUERTO | sin referencias vivas |  |
| `scripts/runBatchVanilla2OpenFigiPrepareReview.ts` | 150 | MUERTO | sin referencias vivas; 1 docs historicos |  |
| `scripts/runBatchVanilla2PricesMetricsDryRun.ts` | 67 | MUERTO | npm dryrun:batch-vanilla-2-prices-metrics; sin referencias vivas; 2 docs historicos |  |
| `scripts/runBatchVanilla2PricesMetricsWriteGate.ts` | 39 | MUERTO | npm preview:batch-vanilla-2-prices-metrics-write-gate; sin referencias vivas; 1 docs historicos |  |
| `scripts/runBatchVanilla3ControlledWrite.ts` | 670 | MUERTO | npm firestore:batch-vanilla-3-controlled-write; sin referencias vivas |  |
| `scripts/runBdbAssetsStaticExportPreview.ts` | 154 | MUERTO | npm preview:bdb-assets-static-export; sin referencias vivas; 1 docs historicos |  |
| `scripts/runCleanupAwareHoldingsWritePlanPreview.ts` | 509 | MUERTO | npm preview:holdings-cleanup-plan; sin referencias vivas | cleanupAwareHoldingsWritePlanPreview.test.ts |
| `scripts/runConsumerIntegrationMockPreview.ts` | 129 | MUERTO | npm preview:consumer-integration; sin referencias vivas |  |
| `scripts/runConsumerReadinessPlanPreview.ts` | 41 | MUERTO | npm preview:consumer-readiness; sin referencias vivas |  |
| `scripts/runCostGuardrailsPreview.ts` | 143 | MUERTO | npm preview:cost-guardrails; sin referencias vivas; 1 docs historicos |  |
| `scripts/runCoverageSemanticsRefinementPreview.ts` | 169 | MUERTO | npm preview:coverage-semantics; sin referencias vivas; 1 docs historicos |  |
| `scripts/runEodhdDryRun.ts` | 70 | MUERTO | npm dryrun:eodhd; sin referencias vivas; 2 docs historicos |  |
| `scripts/runEodhdPricesCoverageDryRun.ts` | 67 | MUERTO | npm dryrun:eodhd-prices-coverage; sin referencias vivas; 1 docs historicos |  |
| `scripts/runEodhdPricesDryRun.ts` | 75 | MUERTO | npm dryrun:eodhd-prices; sin referencias vivas; 1 docs historicos |  |
| `scripts/runFirestoreCoverageAudit.ts` | 72 | MUERTO | npm audit:firestore-coverage; sin referencias vivas; 1 docs historicos |  |
| `scripts/runFirestoreWriteGateDesign.ts` | 71 | MUERTO | npm dryrun:firestore-write-gate-design; sin referencias vivas; 2 docs historicos |  |
| `scripts/runFondosDbImportDryRun.ts` | 29 | MUERTO | npm dryrun:fondosdb-import; sin referencias vivas; 1 docs historicos |  |
| `scripts/runFondosDbRootAssetsFieldDiff.ts` | 80 | MUERTO | npm diff:fondosdb-root-assets; sin referencias vivas |  |
| `scripts/runFondosDbRootAssetsReadonlySnapshot.ts` | 60 | MUERTO | npm firestore:fondosdb-root-assets-readonly-snapshot; sin referencias vivas; 3 docs historicos |  |
| `scripts/runFondosDbRootAssetsWriteAuthorizationPreview.ts` | 36 | MUERTO | npm preview:fondosdb-root-assets-write-auth; sin referencias vivas |  |
| `scripts/runFondosDbStockPilotReadiness.ts` | 18 | MUERTO | sin referencias vivas; 1 docs historicos |  |
| `scripts/runFondosDbStockPilotRealWrite.ts` | 15 | MUERTO | sin referencias vivas; 1 docs historicos |  |
| `scripts/runFondosDbStockReady64Readiness.ts` | 19 | MUERTO | sin referencias vivas; 1 docs historicos |  |
| `scripts/runFondosDbStockRootAssetsPipeline.ts` | 38 | MUERTO | npm dryrun:stocks; sin referencias vivas; 2 docs historicos |  |
| `scripts/runFondosDbWriteGatePreview.ts` | 32 | MUERTO | npm dryrun:fondosdb-write-preview; sin referencias vivas |  |
| `scripts/runFondosHoldingsPreview.ts` | 146 | MUERTO | npm preview:fondos-holdings; sin referencias vivas |  |
| `scripts/runFunctionalReadModelsPreview.ts` | 82 | MUERTO | npm preview:functional-read-models; sin referencias vivas; 1 docs historicos |  |
| `scripts/runGspcPricesLiveDryRun.ts` | 509 | MUERTO | npm dryrun:gspc-prices-live; sin referencias vivas; 1 docs historicos | gspcPricesLiveDryRun.test.ts |
| `scripts/runHistoryBackfillDryRun.ts` | 204 | MUERTO | npm coverage:backfill-dryrun; sin referencias vivas; 4 docs historicos |  |
| `scripts/runHistoryBackfillWrite.ts` | 221 | MUERTO | npm coverage:backfill-write; sin referencias vivas; 4 docs historicos |  |
| `scripts/runHistoryCoverageInventory.ts` | 150 | MUERTO | npm coverage:inventory; sin referencias vivas; 4 docs historicos |  |
| `scripts/runHoldingsLiveReadinessSnapshot.ts` | 707 | MUERTO | npm snapshot:holdings-live-readiness; sin referencias vivas; 1 docs historicos | holdingsLiveReadinessSnapshot.test.ts |
| `scripts/runHoldingsPartialWriteGatePreview.ts` | 193 | MUERTO | npm preview:holdings-partial-write-gate; sin referencias vivas; 2 docs historicos | holdingsPartialWriteGatePreview.test.ts |
| `scripts/runHoldingsPreWriteLiveSnapshot.ts` | 539 | MUERTO | npm snapshot:holdings-pre-write-live; sin referencias vivas; 3 docs historicos | holdingsPreWriteLiveSnapshot.test.ts |
| `scripts/runHoldingsSizeAudit.ts` | 332 | MUERTO | npm audit:holdings-size; sin referencias vivas; 5 docs historicos | holdingsSizeAudit.test.ts |
| `scripts/runHybridHoldingsChunkPreview.ts` | 117 | MUERTO | npm preview:holdings-chunks; sin referencias vivas |  |
| `scripts/runHybridHoldingsWritePlanPreview.ts` | 414 | MUERTO | npm preview:holdings-write-plan; sin referencias vivas | hybridHoldingsWritePlanPreview.test.ts |
| `scripts/runIwdaPricesLiveDryRun.ts` | 442 | MUERTO | npm dryrun:iwda-prices-live; sin referencias vivas; 1 docs historicos | iwdaPricesLiveDryRun.test.ts |
| `scripts/runManualCsvDryRun.ts` | 34 | MUERTO | npm dryrun:manual-csv; sin referencias vivas; 2 docs historicos |  |
| `scripts/runMorningstarHistoryBackfill.ts` | 286 | MUERTO | npm coverage:morningstar-dryrun, coverage:morningstar-write; sin referencias vivas |  |
| `scripts/runOpenFigiDryRun.ts` | 99 | MUERTO | npm dryrun:openfigi; sin referencias vivas; 2 docs historicos |  |
| `scripts/runOpenFigiLiveIdentityValidation.ts` | 54 | MUERTO | npm openfigi:live-identity-validation; sin referencias vivas; 2 docs historicos |  |
| `scripts/runOpenFigiPartialEnrichmentCloseoutAudit.ts` | 80 | MUERTO | npm firestore:openfigi-partial-enrichment-closeout-audit; sin referencias vivas; 2 docs historicos |  |
| `scripts/runOpenFigiPartialEnrichmentWritePrep.ts` | 199 | MUERTO | npm firestore:openfigi-partial-enrichment-write-gate; sin referencias vivas | openfigiPartialEnrichmentWritePrep.test.ts |
| `scripts/runOpenFigiSchemaShapeCorrectionCloseoutAudit.ts` | 70 | MUERTO | npm firestore:openfigi-schema-shape-correction-closeout-audit; sin referencias vivas; 2 docs historicos |  |
| `scripts/runOpenFigiSchemaShapeCorrectionWriteGatePrep.ts` | 119 | MUERTO | npm firestore:openfigi-schema-shape-correction-gate; sin referencias vivas; 2 docs historicos |  |
| `scripts/runOpenFigiWrittenAssetsLiveValidation.ts` | 108 | MUERTO | npm openfigi:written-assets-live-validation; sin referencias vivas; 1 docs historicos |  |
| `scripts/runParAHoldingsInventory.ts` | 264 | MUERTO | sin referencias vivas |  |
| `scripts/runParAHoldingsLoad.ts` | 386 | MUERTO | sin referencias vivas; 4 docs historicos |  |
| `scripts/runParAHoldingsReconciliationDiff.ts` | 638 | MUERTO | sin referencias vivas |  |
| `scripts/runParAHoldingsReconciliationWrite.ts` | 712 | MUERTO | sin referencias vivas |  |
| `scripts/runPortfolioReportingPreview.ts` | 192 | MUERTO | npm preview:portfolio-reporting; sin referencias vivas; 1 docs historicos |  |
| `scripts/runPriceMetricsDryRun.ts` | 21 | MUERTO | npm dryrun:price-metrics; sin referencias vivas |  |
| `scripts/runPriceSeriesExpansionPreview.ts` | 145 | MUERTO | sin referencias vivas |  |
| `scripts/runPriceSeriesNavSmallBatchWriteGate.ts` | 363 | MUERTO | sin referencias vivas; 1 docs historicos |  |
| `scripts/runPriceSeriesPilotDryRun.ts` | 38 | MUERTO | npm dryrun:price-series-pilot; sin referencias vivas; 1 docs historicos |  |
| `scripts/runPriceSeriesPilotReadiness.ts` | 20 | MUERTO | npm firestore:price-series-pilot-readiness; sin referencias vivas; 1 docs historicos |  |
| `scripts/runPublicContractsPreview.ts` | 125 | MUERTO | npm preview:public-contracts; sin referencias vivas; 1 docs historicos |  |
| `scripts/runQqqPricesLiveDryRun.ts` | 270 | MUERTO | npm dryrun:qqq-prices-live; sin referencias vivas; 1 docs historicos | qqqPricesLiveDryRun.test.ts |
| `scripts/runQueryLayerPreview.ts` | 164 | MUERTO | npm preview:query-layer; sin referencias vivas; 1 docs historicos |  |
| `scripts/runReadModelsApiContractPreview.ts` | 136 | MUERTO | npm preview:api-contract; sin referencias vivas; 1 docs historicos |  |
| `scripts/runReadModelsPreview.ts` | 208 | MUERTO | npm preview:read-models; sin referencias vivas; 1 docs historicos |  |
| `scripts/runRepresentativeEtfLiveDryRun.ts` | 453 | MUERTO | npm dryrun:representative-etf-live; sin referencias vivas; 2 docs historicos |  |
| `scripts/runReviewDecisionMatrix.ts` | 85 | MUERTO | npm review:decision-matrix; sin referencias vivas |  |
| `scripts/runScreenerAdapterMockPreview.ts` | 71 | MUERTO | npm preview:screener-adapter; sin referencias vivas; 1 docs historicos |  |
| `scripts/runScreenerContractPreview.ts` | 121 | MUERTO | npm preview:screener-contract; sin referencias vivas |  |
| `scripts/runScreenerIntegrationCloseoutPreview.ts` | 46 | MUERTO | npm preview:screener-closeout; sin referencias vivas |  |
| `scripts/runScreenerSdkExportContractPreview.ts` | 83 | MUERTO | npm preview:screener-sdk-export; sin referencias vivas |  |
| `scripts/runScreenerStaticDatasetExportPreview.ts` | 1083 | MUERTO | npm preview:screener-static-export; sin referencias vivas; 2 docs historicos |  |
| `scripts/runSearchLayerPreview.ts` | 102 | MUERTO | npm preview:search-layer; sin referencias vivas |  |
| `scripts/runSpyPricesLiveDryRun.ts` | 163 | MUERTO | npm dryrun:spy-prices-live; sin referencias vivas; 1 docs historicos | spyPricesLiveDryRun.test.ts |
| `scripts/runStockUniverseDryRun.ts` | 501 | MUERTO | npm dryrun:stock-universe; sin referencias vivas; 1 docs historicos |  |
| `scripts/runSyntheticDryRun.ts` | 30 | MUERTO | npm dryrun:synthetic; sin referencias vivas; 1 docs historicos |  |
| `scripts/runVanillaBatchCandidateSelection.ts` | 86 | MUERTO | npm dryrun:vanilla-batch-selection; sin referencias vivas |  |
| `scripts/runVanillaBatchCompletePayloads.ts` | 123 | MUERTO | npm dryrun:vanilla-batch-complete-payloads; sin referencias vivas |  |
| `scripts/runVanillaBatchGlobalCloseoutAudit.ts` | 80 | MUERTO | npm firestore:vanilla-batch-global-closeout-audit; sin referencias vivas |  |
| `scripts/runVanillaBatchPricesIdentityDryRun.ts` | 163 | MUERTO | npm dryrun:vanilla-batch-prices-identity; sin referencias vivas |  |
| `scripts/runVanillaBatchWriteGate.ts` | 55 | MUERTO | npm firestore:vanilla-batch-write-gate; sin referencias vivas |  |
| `scripts/runVanillaBatchWritePlanValidation.ts` | 41 | MUERTO | npm validate:vanilla-batch-write-plan; sin referencias vivas |  |
| `scripts/seedPriceSeriesV12Emulator.ts` | 81 | MUERTO | sin referencias vivas; 1 docs historicos |  |
| `scripts/trimPriceSeriesPoints.ts` | 228 | MUERTO | npm contracts:trim-price-series; sin referencias vivas; 2 docs historicos |  |

### 2-plataforma-datos/src (modulos)

| Ruta | Lineas | Clase | Evidencia | Pruebas que se van con el |
|---|---:|---|---|---|
| `src/config/baseNueva/aptitudes.ts` | 315 | VIVO | lo importan: src/ingestion/baseNueva/calidadYTarjeta.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/config/baseNueva/asesores.ts` | 44 | VIVO | lo importan: scripts/darAdministrador.ts, src/ingestion/baseNueva/carteras.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/config/baseNueva/esquemas.ts` | 282 | VIVO | lo importan: scripts/runBaseNuevaAudit.ts, scripts/subirALaNube.ts, src/config/baseNueva/validadores.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/config/baseNueva/validadores.ts` | 275 | VIVO | lo importan: scripts/runBaseNuevaAudit.ts, scripts/runBaseNuevaDryRun.ts, scripts/runCarterasDryRun.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/config/baseNueva/vocabulario.ts` | 583 | VIVO | lo importan: scripts/runBaseNuevaAudit.ts, src/config/baseNueva/aptitudes.ts, src/config/baseNueva/esquemas.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/config/projectAllowlist.ts` | 109 | VIVO | lo importan: scripts/archiveLegacyAssets.ts, scripts/auditAppOwnedData.ts, scripts/cleanupAuditOrphans.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/aplicabilidad.ts` | 77 | VIVO | lo importan: src/ingestion/baseNueva/calidadYTarjeta.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/borradosAprobados.ts` | 415 | VIVO | lo importan: scripts/runBaseNuevaBorrados.ts, scripts/subirALaNube.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/calidadYTarjeta.ts` | 1091 | VIVO | lo importan: scripts/runBaseNuevaBatch.ts, src/ingestion/baseNueva/indiceDeBusqueda.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/carteraDelEmisor.ts` | 225 | VIVO | lo importan: scripts/runBaseNuevaWrite.ts, scripts/subirALaNube.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/carteras.ts` | 278 | VIVO | lo importan: scripts/reoriginarCarteras.ts, scripts/runCarterasDryRun.ts, scripts/runCarterasWrite.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/correccionDeBajas.ts` | 72 | VIVO | lo importan: scripts/subirALaNube.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/distribucion.ts` | 142 | VIVO | lo importan: src/ingestion/baseNueva/mapper.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/emisorDeEtf.ts` | 562 | VIVO | lo importan: scripts/runBaseNuevaDryRun.ts, scripts/runBaseNuevaWrite.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/emisores.ts` | 220 | VIVO | lo importan: scripts/runBaseNuevaBorrados.ts, scripts/runBaseNuevaDryRun.ts, scripts/runBaseNuevaWrite.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/indice.ts` | 116 | VIVO | lo importan: src/ingestion/baseNueva/mapper.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/indiceDeBusqueda.ts` | 135 | VIVO | lo importan: scripts/runBaseNuevaBatch.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/mapper.ts` | 2987 | VIVO | lo importan: scripts/runBaseNuevaAudit.ts, scripts/runBaseNuevaBatch.ts, scripts/runBaseNuevaBorrados.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/mercadoObjetivo.ts` | 276 | VIVO | lo importan: scripts/runBaseNuevaDryRun.ts, scripts/runBaseNuevaWrite.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/partesDeLaSubida.ts` | 91 | VIVO | lo importan: scripts/subirALaNube.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/planes.ts` | 346 | VIVO | lo importan: scripts/runPlanesWrite.ts, src/ingestion/baseNueva/partesDeLaSubida.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/posiciones.ts` | 134 | VIVO | lo importan: src/ingestion/baseNueva/carteraDelEmisor.ts, src/ingestion/baseNueva/mapper.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/retrocesiones.ts` | 89 | VIVO | lo importan: scripts/reoriginarRetrocesiones.ts, scripts/runRetrocesionesWrite.ts, scripts/subirALaNube.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/series.ts` | 226 | VIVO | lo importan: scripts/runBaseNuevaSeries.ts, src/ingestion/baseNueva/emisorDeEtf.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/soloEstos.ts` | 61 | VIVO | lo importan: scripts/runBaseNuevaBatch.ts, scripts/runBaseNuevaSeries.ts, scripts/runBaseNuevaWrite.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/ingestion/baseNueva/traducciones.ts` | 435 | VIVO | lo importan: scripts/runBaseNuevaDryRun.ts, src/ingestion/baseNueva/carteraDelEmisor.ts, src/ingestion/baseNueva/emisorDeEtf.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/loader/baseNuevaWriter.ts` | 389 | VIVO | lo importan: scripts/runBaseNuevaAudit.ts, scripts/runBaseNuevaBatch.ts, scripts/runBaseNuevaBorrados.ts (alcanzable desde el flujo de la base nueva) |  |
| `src/holdings/holdingsStorage.ts` | 16 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/runHybridHoldingsChunkPreview.ts, scripts/runParAHoldingsInventory.ts, src/loader/writer.ts |  |
| `src/ingestion/firestorePathContract.ts` | 46 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/runCleanupAwareHoldingsWritePlanPreview.ts, scripts/runHoldingsLiveReadinessSnapshot.ts, scripts/runHybridHoldingsChunkPreview.ts |  |
| `src/ingestion/fondosdb/fondosDbMapper.ts` | 612 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/dryrunOwnershipBackup.ts, src/ingestion/fondosdb/fondosDbDryRun.ts, src/ingestion/fondosdbStockAssets.ts |  |
| `src/ingestion/fondosdb/fondosDbReader.ts` | 347 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: src/ingestion/fondosdb/fondosDbDryRun.ts, src/loader/packageReader.ts |  |
| `src/ingestion/fondosdb/fondosDbTypes.ts` | 242 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: src/ingestion/fondosdb/fondosDbDryRun.ts, src/ingestion/fondosdb/fondosDbMapper.ts, src/ingestion/fondosdb/fondosDbQuality.ts |  |
| `src/ingestion/fondosdbStockAssets.ts` | 445 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/dryrunOwnershipBackup.ts, scripts/runFondosDbStockRootAssetsPipeline.ts, src/ingestion/fondosdbStockPilotReadiness.ts |  |
| `src/loader/archiveAssets.ts` | 378 | SOLO BASE DE SIEMPRE | archive:assets; lo lanza ops_plataforma.py |  |
| `src/loader/auditConsistency.ts` | 270 | SOLO BASE DE SIEMPRE | audit:consistency; lo lanza ops_plataforma.py |  |
| `src/loader/cli.ts` | 179 | SOLO BASE DE SIEMPRE | load:fondosdb; lo lanza ops_plataforma.py (extractor, Sistema > Operaciones) |  |
| `src/loader/driftCriteria.ts` | 79 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/dryrunOwnershipBackup.ts, src/loader/auditConsistency.ts, src/loader/republish.ts |  |
| `src/loader/holdingsProvenance.ts` | 77 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: src/loader/holdingsRepublish.ts, src/loader/writer.ts |  |
| `src/loader/holdingsRepublish.ts` | 543 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: src/loader/auditConsistency.ts, src/loader/holdingsRepair.ts, src/loader/republish.ts |  |
| `src/loader/ingestionRun.ts` | 25 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/runParAHoldingsLoad.ts, scripts/runParAHoldingsReconciliationWrite.ts, src/loader/reclassifyStock.ts |  |
| `src/loader/metricsLatest.ts` | 179 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/dryrunOwnershipBackup.ts, src/loader/republish.ts, src/loader/writer.ts |  |
| `src/loader/ownership.ts` | 83 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/dryrunOwnershipBackup.ts, src/loader/driftCriteria.ts, src/loader/planner.ts |  |
| `src/loader/packageReader.ts` | 443 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/dryrunOwnershipBackup.ts, scripts/runParAHoldingsInventory.ts, scripts/runParAHoldingsLoad.ts |  |
| `src/loader/planner.ts` | 271 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/runParAHoldingsInventory.ts, scripts/runParAHoldingsLoad.ts, scripts/runParAHoldingsReconciliationWrite.ts |  |
| `src/loader/reclassifyStock.ts` | 539 | SOLO BASE DE SIEMPRE | reclassify:stock; lo lanza ops_plataforma.py y lo cita AdminOperaciones.tsx |  |
| `src/loader/republish.ts` | 1279 | SOLO BASE DE SIEMPRE | republish:fondosdb; lo lanzan ops_plataforma.py y ops_server.py y lo nombran ambas habilidades |  |
| `src/loader/searchIndex.ts` | 169 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/reconcileSearchIndexLive.ts, src/loader/archiveAssets.ts, src/loader/reclassifyStock.ts |  |
| `src/loader/searchIndexWrite.ts` | 114 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/reconcileSearchIndexLive.ts, src/loader/archiveAssets.ts, src/loader/reclassifyStock.ts |  |
| `src/loader/types.ts` | 121 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: src/loader/cli.ts, src/loader/holdingsRepublish.ts, src/loader/planner.ts |  |
| `src/loader/writer.ts` | 458 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/restoreSriKidEvidence.ts, scripts/runParAHoldingsInventory.ts, scripts/runParAHoldingsLoad.ts |  |
| `src/mappers/fondosHoldingsMapper.ts` | 174 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/runCleanupAwareHoldingsWritePlanPreview.ts, scripts/runFondosHoldingsPreview.ts, scripts/runHoldingsSizeAudit.ts |  |
| `src/schemas/fondosHoldingsSchema.ts` | 114 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/runFondosHoldingsPreview.ts, scripts/runHoldingsSizeAudit.ts, src/mappers/fondosHoldingsChunkMapper.ts |  |
| `src/types/assets.ts` | 46 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: scripts/runOpenFigiDryRun.ts, src/ingestion/assetIngestionDryRun.ts, src/ingestion/firestoreWriteGatePlanner.ts |  |
| `src/utils/utcDates.ts` | 17 | SOLO BASE DE SIEMPRE | solo lo alcanzan los comandos de la base de siempre: src/ingestion/fondosdb/fondosDbMapper.ts, src/ingestion/fondosdbStockAssets.ts, src/loader/metricsLatest.ts |  |
| `src/config/baseNueva/etiquetas.ts` | 306 | DUDOSO | ningun codigo no-test la importa; solo baseNuevaEtiquetas.test.ts y baseNuevaRazonDeAusencia.test.ts. Se escribio para que el frontend lo lea (02-11-2026) pero el frontend no lo importa. Decidir si es vocabulario que se quiere conservar |  |
| `src/api/contracts/portfolioReporting.ts` | 68 | MUERTO | solo lo importan piezas muertas (scripts/runApiContractPreview.ts, scripts/runApiHandlerPreview.ts, src/api/handlers/portfolioReportingHandler.ts ...) | portfolioReportingContract.test.ts, portfolioReportingHandler.test.ts |
| `src/api/handlers/portfolioReportingHandler.ts` | 46 | MUERTO | solo lo importan piezas muertas (scripts/runApiHandlerPreview.ts) | portfolioReportingHandler.test.ts |
| `src/api/mappers/portfolioReportingContractMapper.ts` | 121 | MUERTO | solo lo importan piezas muertas (scripts/runApiContractPreview.ts, src/api/handlers/portfolioReportingHandler.ts) | portfolioReportingContract.test.ts |
| `src/consumerPreview/consumerIntegrationPreview.ts` | 244 | MUERTO | solo lo importan piezas muertas (scripts/runConsumerIntegrationMockPreview.ts, src/consumerPreview/consumerReadinessPlan.ts, src/consumerPreview/screenerAdapterMock.ts ...) | consumerIntegrationPreview.test.ts |
| `src/consumerPreview/consumerReadinessPlan.ts` | 190 | MUERTO | solo lo importan piezas muertas (scripts/runConsumerReadinessPlanPreview.ts) | consumerReadinessPlan.test.ts |
| `src/consumerPreview/screenerAdapterMock.ts` | 143 | MUERTO | solo lo importan piezas muertas (scripts/runScreenerAdapterMockPreview.ts, src/consumerPreview/screenerSdkExportContract.ts) | screenerAdapterMock.test.ts |
| `src/consumerPreview/screenerContractPreview.ts` | 221 | MUERTO | solo lo importan piezas muertas (scripts/runScreenerContractPreview.ts, src/consumerPreview/screenerAdapterMock.ts, src/consumerPreview/screenerSdkExportContract.ts) | screenerContractPreview.test.ts |
| `src/consumerPreview/screenerIntegrationCloseout.ts` | 60 | MUERTO | solo lo importan piezas muertas (scripts/runScreenerIntegrationCloseoutPreview.ts) | screenerIntegrationCloseout.test.ts |
| `src/consumerPreview/screenerSdkExportContract.ts` | 324 | MUERTO | solo lo importan piezas muertas (scripts/runScreenerSdkExportContractPreview.ts) | screenerSdkExportContract.test.ts |
| `src/contracts/bdbAclContracts.ts` | 339 | MUERTO | solo lo importan piezas muertas (scripts/runBdbAssetsStaticExportPreview.ts, src/readModels/bdbAclReadModels.ts) | bdbAclContracts.test.ts |
| `src/contracts/costGuardrails.ts` | 337 | MUERTO | solo lo importan piezas muertas (scripts/runCostGuardrailsPreview.ts, src/consumerPreview/consumerIntegrationPreview.ts, src/consumerPreview/consumerReadinessPlan.ts) | costGuardrails.test.ts |
| `src/contracts/publicContracts.ts` | 103 | MUERTO | solo lo importan piezas muertas (scripts/runPublicContractsPreview.ts, src/consumerPreview/consumerIntegrationPreview.ts, src/consumerPreview/screenerAdapterMock.ts ...) | publicContracts.test.ts |
| `src/coverage/eodhdHistory.ts` | 83 | MUERTO | solo lo importan piezas muertas (scripts/runHistoryBackfillDryRun.ts, scripts/runHistoryBackfillWrite.ts) |  |
| `src/coverage/morningstarHistory.ts` | 201 | MUERTO | solo lo importan piezas muertas (scripts/runMorningstarHistoryBackfill.ts) |  |
| `src/coverage/seriesBuilder.ts` | 238 | MUERTO | solo lo importan piezas muertas (scripts/runHistoryBackfillDryRun.ts, scripts/runHistoryBackfillWrite.ts, scripts/runHistoryCoverageInventory.ts ...) | historyBackfillSeriesBuilder.test.ts |
| `src/coverage/types.ts` | 120 | MUERTO | solo lo importan piezas muertas (scripts/runHistoryBackfillDryRun.ts, scripts/runHistoryBackfillWrite.ts, scripts/runHistoryCoverageInventory.ts ...) |  |
| `src/ingestion/assetIngestionDryRun.ts` | 119 | MUERTO | solo lo importan piezas muertas (scripts/runEodhdDryRun.ts, scripts/runManualCsvDryRun.ts, scripts/runRepresentativeEtfLiveDryRun.ts ...) | assetIngestionDryRun.test.ts, eodhdDryRun.test.ts, manualCsvDryRun.test.ts |
| `src/ingestion/batchVanilla2PricesMetricsDryRun.ts` | 395 | MUERTO | solo lo importan piezas muertas (scripts/runBatchVanilla2PricesMetricsDryRun.ts) | batchVanilla2PricesMetricsDryRun.test.ts |
| `src/ingestion/batchVanilla2PricesMetricsWriteGate.ts` | 400 | MUERTO | solo lo importan piezas muertas (scripts/runBatchVanilla2PricesMetricsWriteGate.ts) | batchVanilla2PricesMetricsWriteGate.test.ts |
| `src/ingestion/csvManualReader.ts` | 31 | MUERTO | solo lo importan piezas muertas (scripts/runManualCsvDryRun.ts) | csvManualReader.test.ts, manualCsvDryRun.test.ts |
| `src/ingestion/firestoreAdminProvider.ts` | 103 | MUERTO | solo lo importan piezas muertas (scripts/runApiContractPreview.ts, scripts/runApiHandlerPreview.ts, scripts/runBatchVanilla3ControlledWrite.ts ...) | firestoreAdminProvider.test.ts |
| `src/ingestion/firestoreAdminTypes.ts` | 49 | MUERTO | solo lo importan piezas muertas (src/ingestion/firestoreAdminProvider.ts, src/ingestion/firestoreBatchWriter.ts) |  |
| `src/ingestion/firestoreBatchWriter.ts` | 46 | MUERTO | solo lo importan piezas muertas (nadie) | firestoreBatchWriter.test.ts |
| `src/ingestion/firestoreLiveSnapshotReader.ts` | 68 | MUERTO | solo lo importan piezas muertas (src/ingestion/vanillaBatchWriteGate.ts) | firestoreLiveSnapshotReader.test.ts, vanillaBatchWriteGate.test.ts |
| `src/ingestion/firestoreMockWriter.ts` | 34 | MUERTO | solo lo importan piezas muertas (scripts/runFirestoreWriteGateDesign.ts) | firestoreMockWriter.test.ts |
| `src/ingestion/firestoreRollbackPlanner.ts` | 45 | MUERTO | solo lo importan piezas muertas (nadie) | firestoreSnapshotAndRollback.test.ts |
| `src/ingestion/firestoreSnapshotPlanner.ts` | 41 | MUERTO | solo lo importan piezas muertas (src/ingestion/firestoreLiveSnapshotReader.ts) | firestoreLiveSnapshotReader.test.ts, firestoreSnapshotAndRollback.test.ts |
| `src/ingestion/firestoreWriteGatePlanner.ts` | 199 | MUERTO | solo lo importan piezas muertas (scripts/runFirestoreWriteGateDesign.ts) | firestoreWriteGatePlanner.test.ts |
| `src/ingestion/firestoreWriteGateTypes.ts` | 73 | MUERTO | solo lo importan piezas muertas (scripts/runFirestoreWriteGateDesign.ts, src/ingestion/firestoreBatchWriter.ts, src/ingestion/firestoreMockWriter.ts ...) | firestoreBatchWriter.test.ts, firestoreMockWriter.test.ts, firestoreSnapshotAndRollback.test.ts |
| `src/ingestion/fondosdb/fondosDbDryRun.ts` | 284 | MUERTO | solo lo importan piezas muertas (scripts/runFondosDbImportDryRun.ts) | fondosDbDryRun.test.ts |
| `src/ingestion/fondosdb/fondosDbQuality.ts` | 50 | MUERTO | solo lo importan piezas muertas (src/ingestion/fondosdb/fondosDbDryRun.ts) |  |
| `src/ingestion/fondosdb/fondosDbRootAssetsFieldDiff.ts` | 677 | MUERTO | solo lo importan piezas muertas (scripts/runFondosDbRootAssetsFieldDiff.ts) | fondosDbRootAssetsFieldDiff.test.ts |
| `src/ingestion/fondosdb/fondosDbRootAssetsReadonlySnapshot.ts` | 507 | MUERTO | solo lo importan piezas muertas (scripts/runFondosDbRootAssetsFieldDiff.ts, scripts/runFondosDbRootAssetsReadonlySnapshot.ts, src/ingestion/fondosdb/fondosDbRootAssetsFieldDiff.ts) | fondosDbRootAssetsReadonlySnapshot.test.ts |
| `src/ingestion/fondosdb/fondosDbRootAssetsWriteAuthorizationPreview.ts` | 244 | MUERTO | solo lo importan piezas muertas (scripts/runFondosDbRootAssetsWriteAuthorizationPreview.ts) | fondosDbRootAssetsWriteAuthorizationPreview.test.ts |
| `src/ingestion/fondosdb/fondosDbWriteGatePreview.ts` | 182 | MUERTO | solo lo importan piezas muertas (scripts/runFondosDbWriteGatePreview.ts) | fondosDbWriteGatePreview.test.ts |
| `src/ingestion/fondosdbPriceSeriesExpansionPreview.ts` | 466 | MUERTO | solo lo importan piezas muertas (scripts/runPriceSeriesExpansionPreview.ts, scripts/runPriceSeriesNavSmallBatchWriteGate.ts, src/ingestion/priceSeriesNavSmallBatchWriteGate.ts) | fondosdbPriceSeriesExpansionPreview.test.ts |
| `src/ingestion/fondosdbPriceSeriesPilot.ts` | 811 | MUERTO | solo lo importan piezas muertas (scripts/runPriceSeriesPilotDryRun.ts, src/ingestion/fondosdbPriceSeriesExpansionPreview.ts, src/ingestion/priceSeriesPilotReadiness.ts) | fondosdbPriceSeriesPilot.test.ts, priceSeriesPilotReadiness.test.ts |
| `src/ingestion/fondosdbStockPilotReadiness.ts` | 384 | MUERTO | solo lo importan piezas muertas (scripts/runFondosDbStockPilotReadiness.ts) |  |
| `src/ingestion/fondosdbStockPilotRealWrite.ts` | 188 | MUERTO | solo lo importan piezas muertas (scripts/runFondosDbStockPilotRealWrite.ts) |  |
| `src/ingestion/fondosdbStockReady64Readiness.ts` | 323 | MUERTO | solo lo importan piezas muertas (scripts/runFondosDbStockReady64Readiness.ts) |  |
| `src/ingestion/manualCsvMapper.ts` | 71 | MUERTO | solo lo importan piezas muertas (scripts/runManualCsvDryRun.ts) | manualCsvDryRun.test.ts, manualCsvMapper.test.ts |
| `src/ingestion/priceSeriesNavSmallBatchWriteGate.ts` | 881 | MUERTO | solo lo importan piezas muertas (scripts/runPriceSeriesNavSmallBatchWriteGate.ts) | priceSeriesNavSmallBatchWriteGate.test.ts |
| `src/ingestion/priceSeriesPilotReadiness.ts` | 823 | MUERTO | solo lo importan piezas muertas (scripts/runPriceSeriesPilotReadiness.ts) | priceSeriesPilotReadiness.test.ts |
| `src/ingestion/reviewDecisionMatrix.ts` | 97 | MUERTO | solo lo importan piezas muertas (scripts/runReviewDecisionMatrix.ts) | reviewDecisionMatrix.test.ts |
| `src/ingestion/types.ts` | 41 | MUERTO | solo lo importan piezas muertas (src/ingestion/assetIngestionDryRun.ts, src/ingestion/manualCsvMapper.ts, src/ingestion/writeArtifacts.ts) | writeArtifacts.test.ts |
| `src/ingestion/vanillaBatchCandidateSelection.ts` | 76 | MUERTO | solo lo importan piezas muertas (scripts/runVanillaBatchCandidateSelection.ts, scripts/runVanillaBatchPricesIdentityDryRun.ts, src/ingestion/vanillaBatchPricesIdentityDryRun.ts) | vanillaBatchCandidateSelection.test.ts, vanillaBatchPricesIdentityDryRun.test.ts |
| `src/ingestion/vanillaBatchCompletePayloads.ts` | 443 | MUERTO | solo lo importan piezas muertas (scripts/runVanillaBatchCompletePayloads.ts) | vanillaBatchCompletePayloads.test.ts |
| `src/ingestion/vanillaBatchGlobalCloseoutAudit.ts` | 114 | MUERTO | solo lo importan piezas muertas (scripts/runVanillaBatchGlobalCloseoutAudit.ts) | vanillaBatchGlobalCloseoutAudit.test.ts |
| `src/ingestion/vanillaBatchPricesIdentityDryRun.ts` | 143 | MUERTO | solo lo importan piezas muertas (scripts/runVanillaBatchPricesIdentityDryRun.ts) | vanillaBatchPricesIdentityDryRun.test.ts |
| `src/ingestion/vanillaBatchWriteGate.ts` | 361 | MUERTO | solo lo importan piezas muertas (scripts/runVanillaBatchWriteGate.ts) | vanillaBatchWriteGate.test.ts |
| `src/ingestion/vanillaBatchWritePlanValidation.ts` | 443 | MUERTO | solo lo importan piezas muertas (scripts/runVanillaBatchWriteGate.ts, scripts/runVanillaBatchWritePlanValidation.ts, src/ingestion/vanillaBatchWriteGate.ts) | vanillaBatchWriteGate.test.ts, vanillaBatchWritePlanValidation.test.ts |
| `src/ingestion/writeArtifacts.ts` | 44 | MUERTO | solo lo importan piezas muertas (scripts/runEodhdDryRun.ts, scripts/runManualCsvDryRun.ts, scripts/runSyntheticDryRun.ts) | manualCsvDryRun.test.ts, writeArtifacts.test.ts |
| `src/loader/backupReader.ts` | 28 | MUERTO | solo lo importan piezas muertas (scripts/dryrunOwnershipBackup.ts, src/loader/restoreRoots.ts) |  |
| `src/loader/holdingsRepair.ts` | 389 | MUERTO | npm holdings:repair, holdings:restore; solo lo importan piezas muertas (nadie); 1 docs historicos | holdingsRepair.test.ts |
| `src/loader/restoreRoots.ts` | 152 | MUERTO | npm restore:roots; solo lo importan piezas muertas (nadie); 4 docs historicos | restoreRoots.test.ts |
| `src/mappers/fondosHoldingsChunkMapper.ts` | 119 | MUERTO | solo lo importan piezas muertas (scripts/runCleanupAwareHoldingsWritePlanPreview.ts, scripts/runHybridHoldingsChunkPreview.ts, scripts/runHybridHoldingsWritePlanPreview.ts ...) | fondosHoldingsChunkMapper.test.ts |
| `src/metrics/metricsDryRun.ts` | 68 | MUERTO | solo lo importan piezas muertas (scripts/runPriceMetricsDryRun.ts) | priceMetricsDryRun.test.ts |
| `src/metrics/priceMetricsCalculator.ts` | 136 | MUERTO | solo lo importan piezas muertas (scripts/runAapuPricesLiveDryRun.ts, scripts/runBatchVanilla3ControlledWrite.ts, scripts/runGspcPricesLiveDryRun.ts ...) | priceMetricsCalculator.test.ts |
| `src/metrics/priceMetricsTypes.ts` | 47 | MUERTO | solo lo importan piezas muertas (src/ingestion/vanillaBatchCompletePayloads.ts, src/metrics/metricsDryRun.ts, src/metrics/priceMetricsCalculator.ts) |  |
| `src/migrations/trimPriceSeriesPoints.ts` | 199 | MUERTO | solo lo importan piezas muertas (scripts/trimPriceSeriesPoints.ts) | trimPriceSeriesPoints.test.ts |
| `src/normalizers/assetNormalizer.ts` | 52 | MUERTO | solo lo importan piezas muertas (src/ingestion/assetIngestionDryRun.ts) | assetNormalizer.test.ts |
| `src/providers/eodhd/eodhdClient.ts` | 54 | MUERTO | solo lo importan piezas muertas (scripts/runAapuPricesLiveDryRun.ts, scripts/runBatchVanilla2EodhdDryRun.ts, scripts/runBatchVanilla2PricesMetricsDryRun.ts ...) | eodhdDryRun.test.ts, eodhdPricesCoverageDryRun.test.ts, eodhdPricesDryRun.test.ts |
| `src/providers/eodhd/eodhdDryRun.ts` | 111 | MUERTO | solo lo importan piezas muertas (scripts/runEodhdDryRun.ts) | eodhdDryRun.test.ts |
| `src/providers/eodhd/eodhdMapper.ts` | 67 | MUERTO | solo lo importan piezas muertas (scripts/runEodhdDryRun.ts, scripts/runRepresentativeEtfLiveDryRun.ts) | eodhdDryRun.test.ts, eodhdMapper.test.ts |
| `src/providers/eodhd/eodhdPricesCoverageDryRun.ts` | 92 | MUERTO | solo lo importan piezas muertas (scripts/runEodhdPricesCoverageDryRun.ts) | eodhdPricesCoverageDryRun.test.ts |
| `src/providers/eodhd/eodhdPricesDryRun.ts` | 67 | MUERTO | solo lo importan piezas muertas (scripts/runEodhdPricesDryRun.ts) | eodhdPricesDryRun.test.ts |
| `src/providers/eodhd/eodhdPricesMapper.ts` | 73 | MUERTO | solo lo importan piezas muertas (scripts/runAapuPricesLiveDryRun.ts, scripts/runBatchVanilla3ControlledWrite.ts, scripts/runEodhdPricesCoverageDryRun.ts ...) | eodhdPricesMapper.test.ts |
| `src/providers/eodhd/eodhdPriceTypes.ts` | 59 | MUERTO | solo lo importan piezas muertas (scripts/runAapuPricesLiveDryRun.ts, scripts/runBatchVanilla3ControlledWrite.ts, scripts/runEodhdPricesCoverageDryRun.ts ...) | vanillaBatchCompletePayloads.test.ts |
| `src/providers/eodhd/eodhdTypes.ts` | 41 | MUERTO | solo lo importan piezas muertas (scripts/runBatchVanilla2EodhdDryRun.ts, scripts/runRepresentativeEtfLiveDryRun.ts, src/coverage/eodhdHistory.ts ...) | eodhdMapper.test.ts, historyBackfillSeriesBuilder.test.ts |
| `src/providers/openfigi/openfigiDedup.ts` | 131 | MUERTO | solo lo importan piezas muertas (scripts/runOpenFigiDryRun.ts) | openfigiDedup.test.ts |
| `src/providers/openfigi/openfigiDryRun.ts` | 128 | MUERTO | solo lo importan piezas muertas (scripts/runOpenFigiDryRun.ts) | openfigiDryRun.test.ts |
| `src/providers/openfigi/openfigiLiveIdentityValidation.ts` | 532 | MUERTO | solo lo importan piezas muertas (scripts/runOpenFigiLiveIdentityValidation.ts) | openfigiLiveIdentityValidation.test.ts |
| `src/providers/openfigi/openfigiMapper.ts` | 83 | MUERTO | solo lo importan piezas muertas (scripts/runOpenFigiDryRun.ts, src/providers/openfigi/openfigiDryRun.ts) | openfigiDryRun.test.ts, openfigiMapper.test.ts |
| `src/providers/openfigi/openfigiPartialEnrichmentCloseoutAudit.ts` | 159 | MUERTO | solo lo importan piezas muertas (scripts/runOpenFigiPartialEnrichmentCloseoutAudit.ts) | openfigiPartialEnrichmentCloseoutAudit.test.ts |
| `src/providers/openfigi/openfigiSchemaShapeCorrectionCloseoutAudit.ts` | 104 | MUERTO | solo lo importan piezas muertas (scripts/runOpenFigiSchemaShapeCorrectionCloseoutAudit.ts) | openfigiSchemaShapeCorrectionCloseoutAudit.test.ts |
| `src/providers/openfigi/openfigiSchemaShapeCorrectionWriteGatePrep.ts` | 149 | MUERTO | solo lo importan piezas muertas (scripts/runOpenFigiSchemaShapeCorrectionWriteGatePrep.ts) | openfigiSchemaShapeCorrectionWriteGatePrep.test.ts |
| `src/providers/openfigi/openfigiTypes.ts` | 63 | MUERTO | solo lo importan piezas muertas (src/ingestion/firestoreWriteGatePlanner.ts, src/providers/openfigi/openfigiDedup.ts, src/providers/openfigi/openfigiDryRun.ts ...) | firestoreWriteGatePlanner.test.ts, openfigiDedup.test.ts |
| `src/providers/openfigi/openfigiWrittenAssetsLiveValidation.ts` | 433 | MUERTO | solo lo importan piezas muertas (scripts/runOpenFigiWrittenAssetsLiveValidation.ts) | openfigiWrittenAssetsLiveValidation.test.ts |
| `src/quality/assetQuality.ts` | 97 | MUERTO | solo lo importan piezas muertas (src/ingestion/assetIngestionDryRun.ts, src/ingestion/types.ts) | assetQuality.test.ts |
| `src/readModels/bdbAclReadModels.ts` | 1398 | MUERTO | solo lo importan piezas muertas (scripts/runBdbAssetsStaticExportPreview.ts) | bdbAclContracts.test.ts |
| `src/readModels/coverageRefinement.ts` | 205 | MUERTO | solo lo importan piezas muertas (scripts/runCoverageSemanticsRefinementPreview.ts, src/readModels/queryLayer.ts) | coverageSemanticsRefinement.test.ts |
| `src/readModels/firestoreCoverageAudit.ts` | 413 | MUERTO | solo lo importan piezas muertas (scripts/runCoverageSemanticsRefinementPreview.ts, scripts/runFirestoreCoverageAudit.ts) | readModels.test.ts |
| `src/readModels/holdingsReadModels.ts` | 123 | MUERTO | solo lo importan piezas muertas (scripts/runReadModelsApiContractPreview.ts) | holdingsReadModels.test.ts |
| `src/readModels/queryLayer.ts` | 330 | MUERTO | solo lo importan piezas muertas (scripts/runQueryLayerPreview.ts, src/consumerPreview/consumerIntegrationPreview.ts, src/consumerPreview/consumerReadinessPlan.ts) | queryLayer.test.ts |
| `src/readModels/readModels.ts` | 309 | MUERTO | solo lo importan piezas muertas (scripts/runCoverageSemanticsRefinementPreview.ts, scripts/runFunctionalReadModelsPreview.ts, scripts/runReadModelsApiContractPreview.ts ...) | readModels.test.ts |
| `src/readModels/searchLayer.ts` | 200 | MUERTO | solo lo importan piezas muertas (scripts/runSearchLayerPreview.ts, src/consumerPreview/consumerIntegrationPreview.ts) | searchLayer.test.ts |
| `src/reporting/portfolioReportingPreview.ts` | 151 | MUERTO | solo lo importan piezas muertas (scripts/runApiContractPreview.ts, scripts/runPortfolioReportingPreview.ts, src/api/handlers/portfolioReportingHandler.ts ...) | portfolioReportingContract.test.ts, portfolioReportingPreview.test.ts |
| `src/types/assetPriceSeries.ts` | 37 | MUERTO | solo lo importan piezas muertas (src/ingestion/fondosdbPriceSeriesExpansionPreview.ts, src/ingestion/fondosdbPriceSeriesPilot.ts, src/ingestion/priceSeriesNavSmallBatchWriteGate.ts ...) | fondosdbPriceSeriesPilot.test.ts |
| `src/validators/assetValidator.ts` | 51 | MUERTO | solo lo importan piezas muertas (src/ingestion/assetIngestionDryRun.ts, src/ingestion/types.ts, src/quality/assetQuality.ts) | assetValidator.test.ts |

### 2-plataforma-datos/tests

**Se van enteras (74 ficheros)**: todo lo que importan es MUERTO. aapuPricesLiveDryRun, appOwnedDataInventory, assetIngestionDryRun, assetNormalizer, assetQuality, assetValidator, batchVanilla2PricesMetricsDryRun, batchVanilla2PricesMetricsWriteGate, bdbAclContracts, cleanupAuditOrphans, consumerIntegrationPreview, consumerReadinessPlan, costGuardrails, coverageSemanticsRefinement, csvManualReader, dryrunOwnershipBackup, eodhdDryRun, eodhdMapper, eodhdPricesCoverageDryRun, eodhdPricesDryRun, eodhdPricesMapper, firestoreBatchWriter, firestoreLiveSnapshotReader, firestoreMockWriter, firestoreSnapshotAndRollback, fondosDbRootAssetsFieldDiff, fondosDbRootAssetsReadonlySnapshot, fondosDbRootAssetsWriteAuthorizationPreview, fondosDbWriteGatePreview, fondosdbPriceSeriesExpansionPreview, fondosdbPriceSeriesPilot, gspcPricesLiveDryRun, historyBackfillSeriesBuilder, holdingsPartialWriteGatePreview, holdingsPreWriteLiveSnapshot, holdingsReadModels, holdingsRepair, iwdaPricesLiveDryRun, manualCsvDryRun, manualCsvMapper, openfigiDedup, openfigiDryRun, openfigiLiveIdentityValidation, openfigiPartialEnrichmentCloseoutAudit, openfigiPartialEnrichmentWritePrep, openfigiSchemaShapeCorrectionCloseoutAudit, openfigiSchemaShapeCorrectionWriteGatePrep, openfigiWrittenAssetsLiveValidation, portfolioReportingContract, portfolioReportingHandler, portfolioReportingPreview, priceMetricsCalculator, priceMetricsDryRun, priceSeriesNavSmallBatchWriteGate, priceSeriesPilotReadiness, publicContracts, qqqPricesLiveDryRun, queryLayer, readModels, reviewDecisionMatrix, screenerAdapterMock, screenerContractPreview, screenerIntegrationCloseout, screenerSdkExportContract, searchLayer, spyPricesLiveDryRun, trimPriceSeriesPoints, vanillaBatchCandidateSelection, vanillaBatchCompletePayloads, vanillaBatchGlobalCloseoutAudit, vanillaBatchPricesIdentityDryRun, vanillaBatchWriteGate, vanillaBatchWritePlanValidation, writeArtifacts.

**Mixtas (hay que EDITARLAS, no borrarlas)**: cleanupAwareHoldingsWritePlanPreview.test.ts (importa muerto: runCleanupAwareHoldingsWritePlanPreview.ts); firestoreAdminProvider.test.ts (importa muerto: firestoreAdminProvider.ts); firestoreWriteGatePlanner.test.ts (importa muerto: firestoreWriteGatePlanner.ts/openfigiTypes.ts); fondosDbDryRun.test.ts (importa muerto: fondosDbDryRun.ts); fondosHoldingsChunkMapper.test.ts (importa muerto: fondosHoldingsChunkMapper.ts); holdingsLiveReadinessSnapshot.test.ts (importa muerto: runHoldingsLiveReadinessSnapshot.ts); holdingsSizeAudit.test.ts (importa muerto: runHoldingsSizeAudit.ts); hybridHoldingsWritePlanPreview.test.ts (importa muerto: runHybridHoldingsWritePlanPreview.ts); openfigiMapper.test.ts (importa muerto: openfigiMapper.ts); restoreRoots.test.ts (importa muerto: restoreRoots.ts).

**Sin import detectable (8)**: batchVanilla2PricesMetricsRealWrite.test.ts, batchVanilla3ControlledWrite.test.ts, fakeMasterDb.ts, fakeSearchIndexRef.ts, strictFirestoreValue.ts, holdingsRealWriteGatePreparation.test.ts, openfigiPartialEnrichmentRealWrite.test.ts, openfigiSchemaShapeCorrectionRealWrite.test.ts. `batchVanilla3ControlledWrite.test.ts` lee package.json y el texto de runBatchVanilla3ControlledWrite.ts: se va con el. Los cuatro `*RealWrite*` (con `holdingsRealWriteGatePreparation`) prueban codigo ya archivado en `_legacy/` (no entran en el calculo). Los tres `helpers/` se quedan mientras los use otra prueba.

### 3-BDB-ACTIVOS_app/functions_python/main.py: las 51 Functions

Las lineas de cada Function incluyen, hasta la siguiente, los ayudantes privados que quedan entre ellas (aproximado).

| Function | Lineas en main.py | Clase | Evidencia | Pruebas que la nombran |
|---|---|---|---|---|
| `search_assets` | 388-409 (22) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/assetDataSource.ts, adapters/bdbLiveApiAdapter.ts, adapters/bdbLiveApiContracts.ts | 8 |
| `get_asset_detail` | 410-422 (13) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/bdbLiveApiAdapter.ts, adapters/bdbLiveApiContracts.ts | 11 |
| `get_asset_holdings` | 423-432 (10) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/bdbLiveApiAdapter.ts | 4 |
| `get_asset_holdings_batch` | 433-453 (21) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/bdbLiveApiAdapter.ts | 2 |
| `compare_assets` | 454-466 (13) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/bdbLiveApiAdapter.ts, adapters/bdbLiveApiContracts.ts | 12 |
| `resolve_portfolio` | 467-478 (12) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/bdbLiveApiAdapter.ts, adapters/bdbLiveApiContracts.ts, adapters/resolvePortfolioBackend.ts | 11 |
| `optimize_portfolio` | 479-493 (15) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/demoBackend.ts, adapters/optimizePortfolioBackend.ts, types/portfolioFrontier.ts | 12 |
| `get_price_series` | 494-505 (12) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/demoBackend.ts, adapters/priceSeriesBackend.ts, adapters/seriesDeReferencia.ts | 36 |
| `backtest_portfolio` | 506-527 (22) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/backtestPortfolioBackend.ts, adapters/demoBackend.ts, adapters/portfolioHorizon.ts | 20 |
| `improve_portfolio` | 528-547 (20) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/demoBackend.ts, adapters/improvePortfolioBackend.ts | 7 |
| `generate_portfolio_draft` | 548-570 (23) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/generadorBackend.ts, components/GeneradorDeBorrador.tsx | 2 |
| `get_macro_reference` | 571-577 (7) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/macroReferenceBackend.ts | 2 |
| `get_ecb_rates` | 578-583 (6) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/demoBackend.ts, adapters/ecbRatesBackend.ts | 1 |
| `get_euro_yield_curve` | 584-589 (6) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/demoBackend.ts, adapters/ecbYieldCurveBackend.ts | 2 |
| `get_weekly_report` | 590-601 (12) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/demoBackend.ts, adapters/weeklyReportBackend.ts | 4 |
| `analyze_portfolio` | 602-616 (15) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/analyzePortfolioBackend.ts, components/PortfolioAnalysisPanel.tsx | 7 |
| `get_economic_calendar` | 667-675 (9) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/demoBackend.ts, adapters/economicCalendarBackend.ts, pages/StrategyPage.tsx | 1 |
| `get_dividends_calendar` | 676-681 (6) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/demoBackend.ts, adapters/dividendsCalendarBackend.ts | 2 |
| `get_earnings_calendar` | 682-689 (8) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/demoBackend.ts, adapters/earningsCalendarBackend.ts | 2 |
| `save_portfolio` | 690-708 (19) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/conflictoAlGuardar.ts, adapters/portfolioBackend.ts | 8 |
| `list_portfolios` | 709-719 (11) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/callableBackend.ts, adapters/demoBackend.ts, adapters/portfolioBackend.ts | 5 |
| `delete_portfolio` | 733-761 (29) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/portfolioBackend.ts | 3 |
| `admin_publish_report` | 945-993 (49) | VIVO | esta en la lista de desplegarFunciones.mjs y la llama la app: adapters/weeklyReportBackend.ts | 4 |
| `get_system_status` | 994-999 (6) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/demoBackend.ts, adapters/systemStatusBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 5 |
| `admin_fund_quality` | 1000-1009 (10) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/demoBackend.ts, adapters/fundQualityBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 2 |
| `admin_db_status` | 1010-1028 (19) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/adminBackend.ts, adapters/demoBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 3 |
| `admin_list_assets` | 1029-1042 (14) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/adminBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 2 |
| `admin_asset_detail` | 1043-1054 (12) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/adminBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 1 |
| `admin_refresh_all_stale` | 1055-1064 (10) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/adminBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 3 |
| `admin_backfill_candidates` | 1065-1071 (7) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/adminBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 1 |
| `admin_backfill_history` | 1072-1085 (14) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/adminBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 1 |
| `admin_ingest_asset` | 1086-1102 (17) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/adminBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 3 |
| `admin_recompute_metric` | 1116-1135 (20) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/adminBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 1 |
| `admin_refresh_prices` | 1136-1155 (20) | SOLO BASE DE SIEMPRE | no se despliega (lee/escribe assets y meta); la llama la app local (adapters/adminBackend.ts); la pestana esta oculta en la web publicada (SECCIONES_DE_LA_NUBE) | 3 |
| `scheduled_refresh_prices` | 762-827 (66) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 3 |
| `scheduled_refresh_metrics` | 828-832 (5) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 2 |
| `scheduled_refresh_metrics_0900` | 833-837 (5) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 1 |
| `scheduled_refresh_metrics_0930` | 838-842 (5) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 1 |
| `scheduled_refresh_metrics_1000` | 843-858 (16) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 1 |
| `scheduled_integrity_check` | 859-882 (24) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 1 |
| `scheduled_reconcile_search_index` | 883-905 (23) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 0 |
| `scheduled_publish_weekly_report` | 906-931 (26) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 1 |
| `scheduled_publish_daily_report` | 932-944 (13) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 2 |
| `admin_reconcile_search_index` | 1103-1115 (13) | DUDOSO | ninguna llamada en la app ni en docs vigentes; solo lo cita PROMPT_GEMINI_ADMIN_PANEL.md. Es la version manual de scheduled_reconcile_search_index. Mirar si Oscar la lanza a mano | 2 |
| `scheduled_refresh_reviewed_navs` | 1156-1168 (13) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 0 |
| `scheduled_recover_strategy_reports` | 1169-1182 (14) | DUDOSO | programada, no se despliega (no hay ningun job desplegado; refresco a mano por decision de Oscar 03-11-2026). Nadie la llama. Borrar es decidir que nunca habra refresco automatico | 1 |
| `analyze_real_portfolio` | 617-637 (21) | MUERTO | no se despliega; cero llamadas en src/ de la app; pantalla Analisis rapido retirada el 14-11-2026 (AGENTS.md, desplegarFunciones.mjs) | 14 |
| `save_real_analysis` | 638-648 (11) | MUERTO | no se despliega; cero llamadas en src/ de la app; pantalla Analisis rapido retirada el 14-11-2026 (AGENTS.md, desplegarFunciones.mjs) | 5 |
| `list_real_analyses` | 649-655 (7) | MUERTO | no se despliega; cero llamadas en src/ de la app; pantalla Analisis rapido retirada el 14-11-2026 (AGENTS.md, desplegarFunciones.mjs) | 3 |
| `delete_real_analysis` | 656-666 (11) | MUERTO | no se despliega; cero llamadas en src/ de la app; pantalla Analisis rapido retirada el 14-11-2026 (AGENTS.md, desplegarFunciones.mjs) | 3 |
| `get_portfolio` | 720-732 (13) | MUERTO | no se despliega y buscar su nombre en src/ de la app da cero llamadas (solo aparece como cadena en callableColdStartRetry.test.ts); la pantalla usa list_portfolios | 5 |

Totales por clase (Functions, lineas aproximadas en main.py): VIVO: 23 / 360; MUERTO: 5 / 63; DUDOSO: 12 / 223; SOLO BASE DE SIEMPRE: 11 / 149

### 3-BDB-ACTIVOS_app/functions_python (modulos Python, sin tests ni scripts/)

Clase por alcance de imports desde main.py (ver "Metodo"): los imports perezosos de `price_history_sync.py` hacia `price_refresh`/`ingest_asset` no se cuentan como uso desplegado (solo los llaman las rutas de refresco).

| Ruta | Lineas | Clase | Evidencia | Pruebas que se van con el |
|---|---:|---|---|---|
| `analyze_portfolio.py` | 287 | VIVO | lo importan main (alcanzable desde Functions desplegadas) |  |
| `app_owned_store.py` | 30 | VIVO | lo importan portfolios.store, real_history (alcanzable desde Functions desplegadas) |  |
| `asset_aliases.py` | 112 | VIVO | lo importan optimization.improvement_service, optimization.repository, portfolio_horizon (alcanzable desde Functions desplegadas) |  |
| `asset_eligibility.py` | 100 | VIVO | lo importan optimization.repository, portfolio_horizon, readmodel.mappers (alcanzable desde Functions desplegadas) |  |
| `clock.py` | 22 | VIVO | lo importan admin_panel, metrics_refresh, price_refresh (alcanzable desde Functions desplegadas) |  |
| `contract_validation.py` | 39 | VIVO | lo importan fund_ingest, history_backfill, ingest_asset (alcanzable desde Functions desplegadas) |  |
| `ecb_rates.py` | 414 | VIVO | lo importan fund_ingest, ingest_asset, main (alcanzable desde Functions desplegadas) |  |
| `economic_calendar.py` | 358 | VIVO | lo importan main (alcanzable desde Functions desplegadas) |  |
| `fund_data_quality.py` | 219 | VIVO | lo importan integrity_check, readmodel.firestore_client, readmodel.lector_base_nueva (alcanzable desde Functions desplegadas) |  |
| `fund_distributions.py` | 130 | VIVO | lo importan optimization.repository, portfolio_horizon (alcanzable desde Functions desplegadas) |  |
| `fund_history_quality.py` | 123 | VIVO | lo importan asset_eligibility, fund_data_quality, fund_ingest (alcanzable desde Functions desplegadas) |  |
| `generador_de_carteras.py` | 516 | VIVO | lo importan main (alcanzable desde Functions desplegadas) |  |
| `macro_reference.py` | 825 | VIVO | lo importan main (alcanzable desde Functions desplegadas) |  |
| `main.py` | 1181 | VIVO | lo importan  (alcanzable desde Functions desplegadas) |  |
| `master_project.py` | 163 | VIVO | lo importan main, master_write_client, portfolios.store (alcanzable desde Functions desplegadas) |  |
| `meta_size.py` | 68 | VIVO | lo importan fund_data_quality, integrity_check, scripts.improve_fund_data (alcanzable desde Functions desplegadas) |  |
| `metrics_reconciliation.py` | 228 | VIVO | lo importan fund_distributions, metrics_refresh, scripts.dryrun_metrics_fondos (alcanzable desde Functions desplegadas) |  |
| `optimization/firestore_reader.py` | 43 | VIVO | lo importan readmodel.lector_base_nueva (alcanzable desde Functions desplegadas) |  |
| `optimization/improvement_engine.py` | 729 | VIVO | lo importan optimization.improvement_service (alcanzable desde Functions desplegadas) |  |
| `optimization/improvement_service.py` | 311 | VIVO | lo importan main, scripts.dryrun_mejorar_cartera (alcanzable desde Functions desplegadas) |  |
| `optimization/repository.py` | 1490 | VIVO | lo importan generador_de_carteras, main, metrics_refresh (alcanzable desde Functions desplegadas) |  |
| `optimization/risk_analytics.py` | 73 | VIVO | lo importan optimization.repository (alcanzable desde Functions desplegadas) |  |
| `optimization/robust_engine.py` | 700 | VIVO | lo importan optimization.repository, portfolio_horizon, scripts.medir_tope_simulacion (alcanzable desde Functions desplegadas) |  |
| `optimization/runtime.py` | 58 | VIVO | lo importan main, optimization.repository, portfolio_horizon (alcanzable desde Functions desplegadas) |  |
| `optimization/stress_analytics.py` | 450 | VIVO | lo importan optimization.repository, portfolio_horizon (alcanzable desde Functions desplegadas) |  |
| `portfolio_horizon.py` | 575 | VIVO | lo importan main, optimization.improvement_service, optimization.repository (alcanzable desde Functions desplegadas) |  |
| `portfolios/almacen_base_nueva.py` | 178 | VIVO | lo importan portfolios.store (alcanzable desde Functions desplegadas) |  |
| `portfolios/escritura_condicionada.py` | 67 | VIVO | lo importan portfolios.almacen_base_nueva, portfolios.store (alcanzable desde Functions desplegadas) |  |
| `portfolios/repository.py` | 300 | VIVO | lo importan main, portfolios.almacen_base_nueva, portfolios.escritura_condicionada (alcanzable desde Functions desplegadas) |  |
| `portfolios/store.py` | 76 | VIVO | lo importan main (alcanzable desde Functions desplegadas) |  |
| `price_history_sync.py` | 294 | VIVO | lo importan ingest_asset, metrics_refresh, optimization.repository (alcanzable desde Functions desplegadas) |  |
| `price_repair_release.py` | 18 | VIVO | lo importan optimization.repository, price_history_sync (alcanzable desde Functions desplegadas) |  |
| `price_series_cache.py` | 73 | VIVO | lo importan optimization.repository, portfolio_real.service, price_history_sync (alcanzable desde Functions desplegadas) |  |
| `quietlog.py` | 35 | VIVO | lo importan admin_panel, fund_ingest, history_backfill (alcanzable desde Functions desplegadas) |  |
| `rate_limit.py` | 56 | VIVO | lo importan main (alcanzable desde Functions desplegadas) |  |
| `readmodel/busqueda.py` | 60 | VIVO | lo importan readmodel.repository (alcanzable desde Functions desplegadas) |  |
| `readmodel/firestore_client.py` | 503 | VIVO | lo importan admin_panel, main, optimization.firestore_reader (alcanzable desde Functions desplegadas) |  |
| `readmodel/lector_base_nueva.py` | 709 | VIVO | lo importan main, portfolios.store, scripts.medir_tope_simulacion (alcanzable desde Functions desplegadas) |  |
| `readmodel/mappers.py` | 1034 | VIVO | lo importan history_backfill, optimization.improvement_service, readmodel.repository (alcanzable desde Functions desplegadas) |  |
| `readmodel/repository.py` | 600 | VIVO | lo importan main, validate_live (alcanzable desde Functions desplegadas) |  |
| `report_publication.py` | 176 | VIVO | lo importan integrity_check, main, weekly_report (alcanzable desde Functions desplegadas) |  |
| `source_links.py` | 390 | VIVO | lo importan weekly_report (alcanzable desde Functions desplegadas) |  |
| `spanish_calendar.py` | 512 | VIVO | lo importan main (alcanzable desde Functions desplegadas) |  |
| `weekly_report.py` | 1104 | VIVO | lo importan main, report_publication (alcanzable desde Functions desplegadas) |  |
| `weekly_sampling.py` | 293 | VIVO | lo importan fund_ingest, ingest_asset, optimization.improvement_engine (alcanzable desde Functions desplegadas) |  |
| `write_governance.py` | 63 | VIVO | lo importan history_backfill, ingest_asset, integrity_check (alcanzable desde Functions desplegadas) |  |
| `admin_panel.py` | 590 | SOLO BASE DE SIEMPRE | lo usan admin_db_status/admin_list_assets/admin_asset_detail/admin_fund_quality, que llama la app local (adminBackend.ts) |  |
| `fund_ingest.py` | 1128 | SOLO BASE DE SIEMPRE | lo importan ingest_asset y un script; sin camino desde las Functions desplegadas |  |
| `fund_return_basis.py` | 51 | SOLO BASE DE SIEMPRE | solo lo alcanzan rutas no desplegadas: fund_ingest |  |
| `fx_currency.py` | 160 | SOLO BASE DE SIEMPRE | solo lo alcanzan rutas no desplegadas: price_refresh |  |
| `history_backfill.py` | 492 | SOLO BASE DE SIEMPRE | admin_backfill_*; app local (adminBackend.ts, AdminBackfill.tsx) |  |
| `ingest_asset.py` | 831 | SOLO BASE DE SIEMPRE | admin_ingest_asset; app local (adminBackend.ts). Escribe assets/metrics |  |
| `master_write_client.py` | 31 | SOLO BASE DE SIEMPRE | solo lo alcanzan rutas no desplegadas: integrity_check, metrics_refresh, price_refresh |  |
| `metrics_refresh.py` | 911 | SOLO BASE DE SIEMPRE | admin_recompute_metric y los scheduled_refresh_metrics* |  |
| `price_refresh.py` | 884 | SOLO BASE DE SIEMPRE | admin_refresh_prices/admin_refresh_all_stale; solo se llega a el por imports perezosos desde price_history_sync |  |
| `search_index.py` | 285 | SOLO BASE DE SIEMPRE | admin_reconcile_search_index y scheduled_reconcile_search_index, y ingest/fund_ingest |  |
| `system_status.py` | 39 | SOLO BASE DE SIEMPRE | get_system_status, llamada por systemStatusBackend.ts de la app local; fuera de la lista de despliegue |  |
| `capitalgroup_nav.py` | 143 | DUDOSO | lo importan reviewed_nav_refresh/sources |  |
| `integrity_check.py` | 356 | DUDOSO | solo scheduled_integrity_check (no desplegada) |  |
| `reviewed_nav_refresh.py` | 171 | DUDOSO | solo scheduled_refresh_reviewed_navs (no desplegada) |  |
| `reviewed_nav_sources.py` | 251 | DUDOSO | lo importa reviewed_nav_refresh |  |
| `portfolio_real/__init__.py` | 5 | MUERTO | solo dentro de portfolio_real (motor de Analisis rapido de extractos, pantalla retirada) |  |
| `portfolio_real/configuration.py` | 34 | MUERTO | solo dentro de portfolio_real (motor de Analisis rapido de extractos, pantalla retirada) |  |
| `portfolio_real/engine.py` | 1660 | MUERTO | solo dentro de portfolio_real (motor de Analisis rapido de extractos, pantalla retirada) |  |
| `portfolio_real/estr_index.py` | 162 | MUERTO | solo dentro de portfolio_real (motor de Analisis rapido de extractos, pantalla retirada) |  |
| `portfolio_real/mapping.py` | 622 | MUERTO | solo dentro de portfolio_real (motor de Analisis rapido de extractos, pantalla retirada) |  |
| `portfolio_real/parser.py` | 861 | MUERTO | solo dentro de portfolio_real (motor de Analisis rapido de extractos, pantalla retirada) |  |
| `portfolio_real/service.py` | 2432 | MUERTO | solo lo importa portfolio_real/__init__ y analyze_real_portfolio (main.py:626), Function sin llamadas |  |
| `real_history.py` | 192 | MUERTO | solo lo usan save/list/delete_real_analysis de main.py; ya no hay pantalla. Esta declarado en barreraDeBdb.test.ts (CLIENTE_DECLARADO): hay que quitar esa linea |  |
| `validate_live.py` | 54 | MUERTO | script suelto de 54 lineas: ningun import, ninguna orden; solo lo nombra la lista de ignorados de firebase.json y firebase.funciones.json y un checklist |  |

Totales (modulos Python): SOLO BASE DE SIEMPRE: 11 modulos / 5402 lineas; VIVO: 49 modulos / 15787 lineas; DUDOSO: 4 modulos / 921 lineas; MUERTO: 9 modulos / 6022 lineas

### 3-BDB-ACTIVOS_app/functions_python/tests

**Se irian con portfolio_real/real_history (14 ficheros, 4539 lineas)**, por nombre e imports: test_estr_index, test_historical_mapping_catalog, test_historical_mapping_table, test_parser_resource_limits, test_portfolio_real, test_portfolio_real_dividendos, test_portfolio_real_identidad_por_operaciones, test_portfolio_real_lookahead, test_portfolio_real_movimientos_en_tramos, test_portfolio_real_risk_free, test_portfolio_real_todo_el_export, test_portfolio_real_traspasos_divisa, test_real_history, test_real_portfolio_configuration.

**Hay que EDITARLAS (mezclan lo muerto con lo vivo)**: test_a2_hardening, test_asset_aliases, test_fondos_que_reparten, test_fx_currency_resolution, test_price_history_sync, test_price_repair_releases, test_rendimiento_fondos_bloqueados, test_ex_post_sharpe_parity, test_ex_post_sortino_parity, test_main_cold_start. Cada una usa `portfolio_real`/`real_history` en 1-3 sitios (p. ej. `from portfolio_real import service as cartera_real`). `test_ex_post_sharpe_parity` y `test_ex_post_sortino_parity` comparan el motor de portfolio_real con weekly_sampling; ademas `tests/gestor/sortinoCalmarYUltimosAnios.test.ts` (app) cita las lineas 130-135 de la segunda y existe `tests/fixtures/sortino_parity.json`: antes de borrar hay que decidir si esa paridad la sustituye otra prueba. `test_main_cold_start.py` exige que `main.analyze_real_portfolio` sea invocable.

Fixture que se iria: `tests/fixtures/portfolio_real_expected.example.json`.

### Piezas sueltas que no salen en el grafo

| Ruta | Líneas | Clase | Evidencia |
|---|---:|---|---|
| `2-plataforma-datos/scripts/backup_export_daily.bat` | 9 | SOLO BASE DE SIEMPRE | lo da el README de la plataforma para el Programador de tareas; llama `backup:export` y `backup:retention` (copia `assets/` + `meta/`) |
| `2-plataforma-datos/package.json` (112 entradas con fichero) | — | — | 80 apuntan a ficheros MUERTOS; hay que podarlo, y el script `test:artifact-fixtures` nombra cuatro pruebas de las que se van |
| `2-plataforma-datos/_legacy/` (33 ficheros, 8.083 líneas) | 8.083 | MUERTO (ya apartado) | ya archivado y excluido de la suite (`vitest.config.ts`); se puede borrar entero, pero `barreraDeBdb.test.ts` declara dos de sus `.mjs` (ver riesgos) |
| `2-plataforma-datos/tests/` cuatro pruebas de código ya archivado | 436 | MUERTO | `batchVanilla2PricesMetricsRealWrite`, `holdingsRealWriteGatePreparation`, `openfigiPartialEnrichmentRealWrite`, `openfigiSchemaShapeCorrectionRealWrite` importan de `_legacy/scripts/`; se van con `_legacy/` |
| `2-plataforma-datos/data/` (7 ficheros de muestra) | — | MUERTO | solo los leen `runManualCsvDryRun`, `runStockUniverseDryRun`, `runFondosDbStockRootAssetsPipeline` y los pilotos de acciones/series; `actions-ready-with-warning-5.json` ni eso |

### 3-BDB-ACTIVOS_app/functions_python/scripts (12 ficheros, 3.380 líneas)

Todos están nombrados en `3-BDB-ACTIVOS_app/scripts/README.md` o en `DECISIONES_AUDITORIA_2026-11-04.md` y tienen prueba propia en su mayoría. Operan sobre `assets`/`metrics`: **SOLO BASE DE SIEMPRE** (`migrate_metrics_latest` 555, `audit_cobertura_equivalencia` 423, `improve_fund_data` 385, `dryrun_metrics_refresh_backup` 376, `migrate_ownership_v12` 303, `dryrun_mejorar_cartera` 236, `dryrun_metrics_fondos` 212, `migrate_portfolios_uid` 166, `migrate_provisional_roots` 117, `run_metrics_refresh` 107). `medir_tope_simulacion.py` (233) lo cita `main.py` y usa `lector_base_nueva`: VIVO como herramienta de medida. `appcheck_report.py` (267): DUDOSO, solo lo cita una decisión y su prueba; no depende de la base vieja.

### 3-BDB-ACTIVOS_app/scripts (de paso)

| Ruta | Líneas | Clase | Evidencia |
|---|---:|---|---|
| `purgeCssD3.mjs` | 70 | MUERTO | cero referencias en todo el repositorio |
| `shotsD3.mjs` | 44 | MUERTO | cero referencias (solo `carteraDeMuestra.mjs` es de la misma familia) |
| `recompute_reviewed_nav_metrics.py` | 61 | MUERTO | cero referencias |
| `repair_holdings_schema_labels.py` | 70 | MUERTO | solo `tests/test_audit_data_repairs.py` (se va con él) |
| `repair_ubam_currency.py` | 109 | MUERTO | solo `tests/test_audit_data_repairs.py` (se va con él) |
| `capturaMaquetas.mjs` | 36 | DUDOSO | solo `docs/frontend/PROGRESO.md` y `SISTEMA_DISENO.md`; mirar si el flujo de maquetas sigue |
| `ingest_dow_msci_world_top100.py`, `ingest_requested_equity_universes.py`, `load_missing_price_series.py`, `reload_from_eodhd.py`, `extend_history_to_15y.py`, `repair_price_series.py`, `verify_price_currency.py`, `plan_capitalgroup_refresh.py`, `plan_price_history_repair.py` | 2.556 | SOLO BASE DE SIEMPRE | documentados en `scripts/README.md`; escriben `assets`/`price_series`; no medidos uno a uno |

Los demás (`desplegarFunciones.mjs`, `puertaFunciones.mjs`, `set_admin.py`, `delete_asset.py`, los de diseño, humo y CSS) tienen referencias vivas.

### 1-extractor (de paso)

| Ruta | Líneas | Clase | Evidencia |
|---|---:|---|---|
| `tools/anota_indice_kid.py`, `rellena_nombres_universo.py`, `simula_regeneracion_a1.py` | 100 / 116 / 226 | DUDOSO | cero referencias, pero son herramientas manuales que se pueden lanzar sin que nada las cite; preguntar |
| `tools/backfill_asset_types.py` | 73 | DUDOSO | solo `tests/test_backfill_asset_types.py` |
| `_legacy/sube_firestore.py` | 137 | MUERTO (ya apartado) | `raise SystemExit(ARCHIVADO)`; declarado en `barreraDeBdb.test.ts` (CLIENTE_DECLARADO) y nombrado en `test_dependencias.py` |

## (c) Orden de borrado y riesgos

### Orden sugerido (de fuera a dentro, para que cada paso deje la suite verde)

1. **Primero lo ya apartado y sin dependientes**: `2-plataforma-datos/_legacy/` entero + sus cuatro pruebas de `tests/` + `extractor/_legacy/` si se quiere. Edita antes `barreraDeBdb.test.ts` (quitar de CLIENTE_DECLARADO los dos `.mjs` de `_legacy`; y, si cae el de extractor, `sube_firestore.py`) y la línea de `test_dependencias.py` si lo nombra.
2. **Functions muertas y su motor** (paso independiente del resto): borrar de `main.py` las cinco Functions (`analyze_real_portfolio`, `save_*`, `list_*`, `delete_real_analysis`, `get_portfolio`) y el `import real_history` de la línea 110; luego `portfolio_real/`, `real_history.py`, `validate_live.py` (quitarlo también de la lista de ignorados de `firebase.json` y `firebase.funciones.json`) y sus pruebas. Antes: quitar `real_history.py` de CLIENTE_DECLARADO en `barreraDeBdb.test.ts`, la línea `operation="analyze_real_portfolio"` de `functionsSecurityConfig.test.ts:33`, y adaptar `test_main_cold_start.py`.
3. **Pruebas mixtas de Python**: recortar los 1-3 usos de `portfolio_real` en las diez pruebas mixtas (sobre todo las de paridad ex-post, ver riesgos).
4. **Plataforma, hojas primero**: los 95 guiones muertos y sus 80 entradas de `package.json`, con las 74 pruebas que se van. Orden interno: (i) los guiones, porque nadie importa un guion; (ii) los módulos de `src/` que quedan sin importador, por capas: `consumerPreview/` → `contracts/` → `readModels/` → `api/`, `reporting/`; luego `ingestion/` (vanilla, pilotos, firestore*), `providers/eodhd`, `providers/openfigi`, `coverage/`, `metrics/`, `migrations/`; al final los tres del `loader/` (`holdingsRepair`, `restoreRoots`, `backupReader`) y el `holdings/`/`mappers/` que aún comparta lo vivo (los ficheros `holdingsStorage.ts`, `fondosHoldingsMapper.ts` y `fondosdbStockAssets.ts` los alcanzan guiones SOLO BASE: no entran). Repetir el grafo después de cada capa.
5. **Datos y documentos**: `data/` (7 ficheros) y los `docs/BLOQUE_*`/`PROMPT_CODEX_*` de lo borrado (decisión de Óscar: son registro, no código).
6. **Lo DUDOSO y lo SOLO BASE DE SIEMPRE**: solo después de decidir si se retira la base vieja y su pantalla de Operaciones (ver más abajo). Lo SOLO BASE DE SIEMPRE forma un bloque coherente: el `loader/` con `republish`, `cli`, `auditConsistency`, `reclassifyStock`, `archiveAssets` y sus módulos (28 ficheros en `src/`, 7.363 líneas), `ops_plataforma.py`/`ops_server.py` del extractor, `AdminOperaciones.tsx` de la app, las diez Functions `admin_*`/`get_system_status` y sus módulos de `functions_python` (`admin_panel`, `history_backfill`, `ingest_asset`, `metrics_refresh`, `price_refresh`, `fund_ingest`, `search_index`, `system_status`…), y los scripts de `functions_python/scripts/`. No se puede quitar una parte sin la otra.

### Riesgos concretos vistos

1. **`3-BDB-ACTIVOS_app/tests/barreraDeBdb.test.ts` falla de tres maneras si se borra sin tocarlo**:
   - Las listas declaradas dan error «ya no existe, quítalo de la lista» (línea 257): `functions_python/real_history.py` (CLIENTE_DECLARADO), `_legacy/scripts/cleanupMarketAssetsNames.mjs` y `_legacy/scripts/runFondosDbStockRootAssetsPipeline.mjs` (CLIENTE_DECLARADO), y `tests/firestoreAdminProvider.test.ts` (ID_DECLARADO) si el proveedor se va con su prueba. Hay que quitar esas líneas **a conciencia**, no a ciegas: la regla de AGENTS.md dice que no se arregla añadiendo a la lista sin mirar, y aquí es lo inverso, pero conviene confirmar que el fichero que se borra era el único sitio que nombraba el id de BDB.
   - **`MINIMO_VISTO`** (línea 78): la plataforma exige ver más de 400 ficheros en Git y hoy ve 700. Borrar 258 ficheros de código y pruebas, más ~122 documentos, la deja en ≈ 280-320: **la prueba fallaría** («un barrido que no ve nada no protege»). O se baja el mínimo (con la medición escrita) o se hace el borrado en dos tandas y se actualiza al medir. El del extractor (200 de 334) y el de la app (800 de 1.770) no se acercan.
   - `ORDEN_NEGADA` nombra documentos, no código: no se toca.
2. **`2-plataforma-datos/tests/projectAllowlist.test.ts`** lee el texto de `scripts/runBdbDeployedFunctionsStockSmoke.ts` («la sonda… mira el proyecto de aquí»): si ese guion se borra (está DUDOSO), hay que quitar ese caso. Además recorre `src/` y `scripts/` buscando el id de BDB, así que borrar no lo rompe.
3. **`package.json` de la plataforma**: `test:artifact-fixtures` nombra cuatro pruebas (`fondosDbDryRun`, `batchVanilla2PricesMetricsRealWrite`, `batchVanilla3ControlledWrite`, `openfigiPartialEnrichmentWritePrep`) que se van o son de `_legacy`: hay que recortar el script, o `vitest run` con un fichero inexistente falla. `tsconfig.json`/`tsconfig.tests.json` incluyen carpetas enteras (`src`, `scripts`, `tests`), así que no necesitan listas.
4. **Pruebas que no se pueden borrar a ojo**: diez de la plataforma importan algo muerto y algo vivo (p. ej. `firestoreWriteGatePlanner.test.ts`, `fondosDbDryRun.test.ts`, `firestoreAdminProvider.test.ts`); y diez de Python mezclan `portfolio_real` con lo vivo (`test_asset_aliases`, `test_price_history_sync`, `test_fx_currency_resolution`, `test_fondos_que_reparten`, `test_a2_hardening`, …).
5. **El motor de Python es la referencia del motor en TypeScript del Gestor.** `src/gestor/importacion/andbank/*.ts`, `src/gestor/motor/referencia.ts` y `ultimosAnios.ts` se escribieron como «traslado de `functions_python/portfolio_real/*.py`», y `tests/gestor/sortinoCalmarYUltimosAnios.test.ts` cita las líneas 130-135 de `test_ex_post_sortino_parity.py` como origen de una cuenta a mano; `tests/gestor/andbankDeMuestra.ts` cita `test_portfolio_real*.py`. Borrar `portfolio_real` pierde la comprobación cruzada contra la implementación que dio esas cifras. Recomendación: antes de borrarlo, etiquetar el commit en Git y reescribir esas citas para que digan «en el commit X», o confirmar que ya no se necesita la paridad.
6. **Las Functions DUDOSAS programadas no son basura de BDB**: `scheduled_refresh_*` son la implementación del refresco automático que Óscar decidió no activar el 03-11-2026 «a mano, no porque falte el proceso». Borrarlas cierra esa opción.
7. **Lo que parece muerto y no lo es del todo**: `etiquetas.ts` (vocabulario de la base nueva, DUDOSO), `reoriginar*`/`retro:*` (migración de carteras y retrocesiones, por si queda algo en la base vieja) y `runBdbDeployedFunctionsStockSmoke.ts` (sonda de la nube). `restoreSriKidEvidence.ts`, `runCompactPriceSeries.ts`, `reconcileSearchIndexLive.ts` y `runBackupExport.ts` están en README/habilidades como pasos vigentes: no se tocan mientras exista la base de siempre.
8. **Documentos que mencionan lo borrado**: `2-plataforma-datos/scripts/README.md`, `2-plataforma-datos/README.md` (compact, tests), `3-BDB-ACTIVOS_app/scripts/README.md`, `AGENTS.md` (línea de `portfolio_real/`), `AUDITORIA_INTEGRAL_2026-11-16.md`. Quedarían citando ficheros que no existen.
9. **La cadena del extractor**: `1-extractor/core/ops_plataforma.py` lanza exactamente seis órdenes `npm run` (las de SOLO BASE DE SIEMPRE más `backup:export`) y `tests/test_ops_plataforma.py` las cita. Ninguna está en la lista a borrar, pero `SCRIPTS` en `ops_plataforma.py:43` las enumera: no tocar sin decidir sobre Operaciones.

### Qué decide Óscar antes del borrado
- Si se retira la **base de siempre** (`gestor-activos-local`, `assets`): deja de haber un bloque entero de SOLO BASE DE SIEMPRE (unas 7.400 líneas de plataforma, 5.400 de módulos de Functions y 3.380 de scripts de Functions, más Operaciones del extractor y de la app).
- Si el refresco automático (11 `scheduled_*`) se **descarta** o se aplaza.
- Si `portfolio_real` se borra con etiqueta en Git o se conserva como referencia de paridad.
