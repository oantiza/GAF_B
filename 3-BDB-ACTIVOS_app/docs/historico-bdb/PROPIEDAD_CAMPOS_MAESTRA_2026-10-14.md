> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Propiedad de los campos de `assets/{id}`: propuesta de diseño

> **Registro histórico, no se sigue.** Este documento es de BDB y manda a desplegar en su proyecto, y desde este repositorio **no se escribe nunca allí**. Para desplegar aquí: `scripts/desplegarFunciones.mjs` y `4-base-nueva/compilar-sitio.mjs`.

*14-10-2026. Óscar aprobó D1-D10 («adelante»); D4 (correcciones en origen) y D10 (fase 3 del extractor) van en una tarea posterior. Código commiteado en ramas: `propiedad-campos-v12` (plataforma) y `claude/agitated-mccarthy-a5b6af` (app). Sin merge a `master`, sin push, sin despliegue y sin escrituras en Firestore. La pasada en seco final sobre la copia nueva está en §7.*

**Datos usados**
- Copia de la maestra: `2-plataforma-datos/data/backups/2026-10-14T06-49-58-334Z`, con 1.100 raíces (765 fondos, 315 acciones, 19 ETF y 1 OTHER).
- Canónico del extractor: `1-extractor/export_bdb` y `export/fondos.ndjson`, del 13-10 a las 15:30 (847 ficheros).

**Código**
- Plataforma: preparado en un worktree desprendido de `2-plataforma-datos` (master `0fc532a`).
- App: preparado en este worktree (`claude/agitated-mccarthy-a5b6af`, base `72960fc`).
- Hay dos parches, uno por repositorio. Los dos aplican limpios sobre su `master` (comprobado con `git apply --check`).

---

## 0. Resumen

1. **Con el código actual, un republish completo perdería datos que no son de la plataforma en 139 raíces.**
   - Pasada en seco: reescribiría 221 raíces.
   - Borraría 121 `risk.sri_kid_evidence`.
   - Borraría 23 `fixed_income_profile.field_provenance` y cambiaría 40 cifras de renta fija.
   - Devolvería al valor del canónico 12 SRI verificados con KID. Ejemplo: Bestinver Tordesillas Iberia, de 4 a 6.
   - Borraría `fundamentals` de 7 ETF, aunque el contrato lo admite.
   - Además quitaría de `quality` 81 copias de flags de política.
2. **Ningún código versionado produce esos campos.** Los escribieron scripts puntuales fuera de git:
   - `output/calidad-fondos-fase2-2026-09-28`, el 28-09.
   - `output/alta-river-20260929` y `output/alta-robeco-20260929`, el 29-09.
   - `tmp/_flag4.py`, el 30-09 a las 11:36.

   Los cuatro bloqueos de acciones no se hicieron desde la consola. Los puso ese script, con `ref.update`.
3. **Dos correcciones a la premisa.**
   - El backend sí aplica `is_investable: false`: lo leen `readmodel/mappers.is_investable` y `optimization/repository._root_exclusion_reason`, este último incluso en análisis históricos.
   - El republish no toca esas cuatro acciones, porque son EODHD y están fuera del canónico. Quien las pisaría es la propia app: `functions_python/scripts/migrate_provisional_roots.py` las ve inválidas contra `asset-stock.v1`. En su pasada en seco salen como candidatas, y con `--write` las reconstruiría desde cero, sin bloqueo.
4. **La propuesta tiene cuatro piezas.**
   - **Dueño declarado en el contrato.** Cada bloque lleva `x-owner`, y el republish deja de usar listas propias.
   - **Datos del extractor.** `regulatory`, `provenance` y los costes del KID entran por la plataforma. `risk.sri_kid_evidence` se deriva de `regulatory.kid`.
   - **Datos verificados a mano.** Suben al extractor por `config/correcciones.json`, el canal que Óscar ya usa. Mientras tanto, el republish los conserva, o se para con un conflicto si el canónico los contradice.
   - **Bloqueos.** Salen de la maestra a un fichero versionado de la app, `asset_selection_controls.json`.
5. **La misma pasada en seco con el cambio no pierde ningún dato de la app.**
   - De las 846 raíces con cambios, reescribe 827 (por los bloques nuevos) y deja 19 en conflicto, sin reescribir.
   - Conserva 163 evidencias.
   - Sustituye 297 por la del KID oficial con el mismo SRI.
   - Deja 19 conflictos para decidir.
   - Las 81 copias de flags de política salen igual, pero a propósito (decisión D7).
6. **Hay una decisión de producto que no estaba en el encargo.** Al derivar la evidencia del KID oficial, 205 activos ganan la evidencia (203 fondos y 2 ETF), y en 174 fondos cambia la cifra de riesgo que ve el asesor: pasan de un SRRI distinto al SRI del KID. En 172 baja y en 2 sube. El read model solo usa la evidencia en fondos, así que en los ETF no cambia nada visible (§7.1). Ejemplos: GESTION BOUTIQUE VI pasa de SRRI 7 a SRI 4, y Acatis Value Event de 5 a 3. Es la decisión D3.
7. **Migración de las 6 raíces fuera de contrato.** En la copia, las 1.100 raíces quedan válidas después de migrar: 6 cambian y no hay errores.

---

## 1. Inventario: quién escribe cada campo

### 1.1 Escritores de la raíz `assets/{id}`

| Actor | Código | Operación | Campos |
|---|---|---|---|
| Plataforma, cargador | `src/loader/writer.ts` (`load:fondosdb`) | Crea, nunca actualiza | Raíz completa desde el canónico |
| Plataforma, republish | `src/loader/republish.ts` | Lee, modifica y escribe | Reemplaza `OWNED_FUND`/`OWNED_STOCK` enteros: `risk`, `costs`, `quality`, `fixed_income_profile`…<br>Conserva `performance.valuation`.<br>**Borra toda clave raíz fuera de `ALLOWED_*`**, entre ellas `fundamentals` de ETF y `currency`/`economic_asset_class` de acciones. |
| Plataforma, otros | `reclassifyStock.ts` | `set` total | Raíz entera |
| | `archiveAssets.ts` | Archiva y borra | Raíz y subcolecciones |
| | `scripts/runParAHoldingsLoad.ts` (antiguo) | Escribe | `holdings_summary` |
| | `scripts/archiveLegacyAssets.ts` (antiguo) | Escribe | `quality.status` |
| App, functions | `ingest_asset.ingest_one` | Crea acción o ETF EODHD | Raíz completa, `source: EODHD` |
| | `fund_ingest.ingest_fund` | Crea fondo | Raíz completa |
| | `price_refresh`, `price_history_sync` | `update` | `performance.valuation` |
| App, scripts en git | `scripts/improve_fund_data.py` | Escribe | `identity.name`, `holdings_summary`.<br>**`quality` con los flags de `fund_history_policies.json` y `status: REVIEW`**. |
| | `scripts/migrate_provisional_roots.py` | `set` total | Acciones y ETF EODHD que no validan. **Pisaría las 4 acciones bloqueadas.** |
| | `scripts/ingest_requested_equity_universes.py`, `scripts/ingest_dow_msci_world_top100.py` | Crea | Raíz de acciones |
| App, fuera de git (`output/`, `tmp/`) | `calidad-fondos-fase2-2026-09-28` (`prepare_risk.py`, `prepare_refresh.py`, `apply_*.py`) | Escribe | `risk.sri_kid_1a7` y `risk.sri_kid_evidence` (481).<br>Cifras de `fixed_income_profile` y `field_provenance` (23).<br>`fund_profile/latest`. |
| | `alta-river-20260929`, `alta-robeco-20260929` | Crea | Las dos raíces enteras, con `costs` ampliado y `source` propio |
| | `cierre-sin-eodhd-2026-09-28`, `completar-resto-20260929` | Escribe | `reported_yield_pct`, `field_provenance` |
| | `carteras-prioritarias-2026-09-28` | Escribe | `DEREGISTERED_MERGER_VERIFIED`. Hoy no está en ninguna raíz viva: esos activos están en `_archived`. |
| | `tmp/_flag4.py` (30-09 11:36) | Escribe | `is_investable: false`, `quality.review_note` y el flag `PRICE_HISTORY_ARTIFACT_UNRESOLVED`, en 4 acciones |
| Sin escritor encontrado | ninguno | — | `fundamentals` de 10 ETF FondosDB (`endpoint_version`, `raw_payload_sha256`).<br>`risk.max_drawdown_hist` en 3 EODHD, con la forma antigua. |

El frontend no escribe en `assets` (`firestore.rules`).

### 1.2 Campo a campo, con el dueño propuesto

| Campo raíz | En la copia | Quién lo escribe hoy | Dueño propuesto |
|---|---|---|---|
| `asset_id`, `schema_version`, `updated_at` | todas | quien escribe | metadatos |
| `asset_type`, `identity`, `identifiers`, `listings`, `classification`, `product`, `sustainability`, `portfolio_exposure` | todas | plataforma (FondosDB) / app (EODHD, altas) | **plataforma**. Si `source` es EODHD o `MANUAL_DOCUMENTARY`, todo el documento es de la app. |
| `costs` (gestión, TER, MiFID) | 765 fondos | plataforma | plataforma |
| `costs` con evidencia (`entry_fee_max_pct`, `evidence`, `kid_evidence`…) | 2 | alta documental | plataforma: del KID del canónico (§2). Las dos altas, de la app. |
| `performance.returns`, `performance.distributions` | 763 | plataforma | plataforma |
| `performance.valuation` | 763 | app (`price_refresh`) | **app**, como excepción declarada dentro de un bloque de la plataforma |
| `risk.*` (el bloque riesgo del canónico) | 765 | plataforma | plataforma |
| `risk.sri_kid_1a7` | 763 | plataforma; la fase 2 cambió 12 | plataforma; la corrección va al extractor |
| `risk.sri_kid_evidence` | **481** | scripts de la fase 2 y altas | **plataforma**, derivada de `regulatory.kid`. Las 163 que no puede derivar se conservan de forma transitoria. |
| `risk.kid_periodo_mantenimiento_anos` | 501 | plataforma (extractor) | plataforma |
| `risk.max_drawdown_hist` | 3 | nadie (forma antigua) | legado |
| `fixed_income_profile` | 761 | plataforma; la fase 2 cambió valores | plataforma |
| `fixed_income_profile.field_provenance`, `reported_*` | 23 | scripts de la fase 2 | se conservan de forma transitoria y suben al extractor |
| `quality` | todas | plataforma (FondosDB); app (EODHD); `improve_fund_data` le añade los flags de política | plataforma (FondosDB) / app (EODHD). **Los flags de política no se copian a la raíz.** |
| `quality.review_note` | 4 | `tmp/_flag4.py` | **fuera de la maestra**: pasa a `asset_selection_controls.json` |
| `is_investable` | 4 | `tmp/_flag4.py` | **fuera de la maestra**: pasa a `asset_selection_controls.json` |
| `source_metadata` | todas | plataforma; las dos altas usan `Andbank/CNMV` y `Robeco` | plataforma; las altas pasan a `MANUAL_DOCUMENTARY` (app) |
| `holdings_summary` | 770 | app (`fund_ingest`, `improve_fund_data`) | **app** (el republish ya lo conserva). Pendiente: que lo derive `holdingsRepublish`. |
| `fundamentals` en fondos y ETF | 12 | 2 altas; 10 sin escritor | legado; el republish deja de borrarlo |
| `fundamentals` en acciones | 310 | plataforma (FondosDB) / app (EODHD) | plataforma / app según `source` |
| `regulatory`, `provenance` | 0 en la raíz | hoy solo existen en `fund_profile/latest` (752, escrito por `improve_fund_data` desde el canónico) | **plataforma, en la raíz** (nuevo) |
| `currency`, `economic_asset_class` en acciones | 0 | — | legado; el contrato v1 ya los admitía y el republish actual los borraría |
| `retrocession` | 0 | — | legado; la retrocesión vive en `commercial_retro/{isin}` |

Hay un hallazgo lateral sobre `fund_profile/latest`. Ese documento mezcla dos dueños:
- **Extractor:** `regulatory`, `provenance`, `identity`, `management`, `fund_size`.
- **App:** `documentation_audit`, `holdings_review`, `risk_reconciliation`, `commercial_availability`.

`improve_fund_data.put()` lo sobrescribe entero. Si se volviera a ejecutar, perdería las revisiones de la app. Queda fuera de este cambio y está en §6.

---

## 2. Contrato propuesto

Son tres contratos nuevos, generados por código a partir de los vigentes. Lo que no cambia es copia exacta.

- `master/asset.v1.2` (fondos y ETF)
- `master/asset-stock.v1.1` (acciones)
- `master/metrics.v1.3` (métricas)

**Compatibilidad.** Los tres son superconjuntos: todo documento válido en v1.1, v1 o v1.2 sigue siéndolo.

- Verificado contra la copia: de las 1.100 raíces, solo no validan las 6 que ya estaban fuera de contrato.
- Las 481 evidencias SRI y las 23 `field_provenance` validan tal cual.

El diff semántico completo está en `diff_semantico_contratos_v12.txt`.

### 2.1 Anotaciones de propiedad

**`x-owner` en cada propiedad raíz:**

| Valor | Significado |
|---|---|
| `plataforma` | El republish la reescribe desde el canónico |
| `app` | La escribe `3-BDB-ACTIVOS_app`. El republish la conserva. |
| `legado` | No tiene escritor vigente. Se conserva y solo cambia por migración. |
| `metadatos` | `asset_id`, `schema_version`, `updated_at` |

**Otras tres anotaciones:**
- **`x-owner-exceptions`:** una sub-ruta de otro dueño dentro de un bloque. Hoy solo hay una: `performance.valuation`, que es de la app.
- **`x-owner-by-source`:**
  - Con `source` EODHD, en acciones y ETF, el documento entero es de la app.
  - Con `source` `MANUAL_DOCUMENTARY`, en altas documentales, también.
  - El republish nunca los toca, salvo que Óscar acepte el traspaso.
- **`x-obsolete-root-keys`:** las claves retiradas que el republish puede borrar. Hoy son `currency` y `source_mode` en fondos, de la limpieza del 02-07 que fija el test existente.

El republish lee estas anotaciones (`src/loader/ownership.ts`). Desaparecen las listas `OWNED_*` y `ALLOWED_*_ROOT_KEYS`, que se habían desalineado del contrato.

### 2.2 Qué entra (`asset.v1.2`)

**`regulatory` (plataforma).** Es el bloque del canónico, con sus 19 claves tipadas: `sri`, `srri`, `kid`, `mifid_ex_ante_costs`, `ucits`, `sfdr_article`, `domicile`, gestora, LEI, depositario, fechas, `registers` y `periodic_report`. Los tres últimos objetos, sin tipar.

`regulatory.kid` es un `kidDocument` estricto:
- `url`, `source`, `sha256`, `date`, `language`, `recommended_holding_years`, `manufacturer`.
- `costs`: `entry_pct`, `exit_pct`, `management_and_other_pct`, `transaction_pct`, `performance_fee_pct`.
- Además admite la atestación que se propone al extractor: `sri`, `verified_isin`, `document_type` y `checked_at`.

**`provenance` (plataforma).** Versión compacta: `version`, `acquired_at` y `fields`, que va de la ruta canónica a `fuente:endpoint`. `endpoints`, `plan`, `sources` y `dependency` se quedan en el canónico.

**`costs` con evidencia (plataforma).**

| Campo | Contenido |
|---|---|
| `entry_fee_max_pct`, `exit_fee_max_pct`, `transaction_costs_pct`, `ongoing_costs_kid_pct` | Costes del KID |
| `performance_fee_pct` | **Impacto anual** según el KID |
| `performance_fee_rate_pct` | **Tipo contractual** de la comisión de éxito (nuevo) |
| `performance_fee_basis` | Base de la comisión de éxito |
| `depositary_fee_pct`, `service_fee_pct`, `as_of_date`, `note`, `source` | Del folleto o la ficha |
| `kid_evidence`, `evidence` | Documento que respalda las cifras (`documentEvidence`) |

**`risk.sri_kid_evidence` tipada (`sriKidEvidence`).** Lleva los campos que exige el read model (`readmodel/mappers.py`, líneas 329-339):
- Obligatorios: `sri`, `date`, `url`, `sha256`, `document_type` (fijo `PRIIPS_KID`), `verified_isin`, `source`, `verified_at`.
- Opcionales: `verification_run`, `evidence`, `language`, `recommended_holding_years`.

**`source_metadata.source`.** Pasa a ser un enum `FondosDB | MANUAL_DOCUMENTARY`, y se añaden `source_detail` y `registered_by`.

**Coste en tamaño.** La raíz mediana de un fondo pasa de 6,8 KB a unos 10 KB (`regulatory` p50 1,4 KB y `provenance.fields` unos 2 KB). Las listas usan proyección de campos, así que solo pesa en las lecturas de ficha.

### 2.3 Acciones (`asset-stock.v1.1`)

- `x-owner` por bloque.
- `provenance`, que ya existe en el canónico de acciones.
- `quality.review_flags` tipado como lista de textos.
- **No** admite `is_investable` ni `quality.review_note`.

### 2.4 Bloqueos operativos: dónde viven

| Opción | A favor | En contra |
|---|---|---|
| **A. `quality.review_flags` + `is_investable` en la raíz** (como hoy) | No hay estructura nueva | `quality` es de la plataforma (el republish la reemplaza entera) en FondosDB, y la reconstruye `migrate_provisional_roots` en EODHD. Mezcla calidad del dato con decisiones del equipo. Se ha escrito con scripts sueltos, sin historial. Haría falta fusionar flags de dos dueños en un mismo array. |
| B. Bloque `controls` de la app en la raíz | Una sola lectura | Sigue escribiendo la app dentro de documentos de la plataforma. Necesita su propio escritor con puerta. |
| C. Colección `asset_controls/{isin}` (como `commercial_retro`) | Separación total; reglas e historial propios | Una lectura más (o caché) en cada ruta de elegibilidad. Necesita una callable de administración para no editar a mano. |
| **D. Fichero versionado `functions_python/asset_selection_controls.json`** (patrón de `fund_history_policies.json`) | No escribe nada en Firestore (respeta «nunca editar a mano»). Tiene revisión de código, tests e historial git (quién, cuándo, por qué). Revertir es un commit. No hay lecturas extra. Es el mismo mecanismo que ya bloquea fondos por política. | Cambiarlo exige desplegar. No se edita desde la interfaz. |

**Recomendación: D.**

`fund_history_policies.json` no sirve para esto. Sus políticas cambian la firma de las métricas (`FUND_QUALITY_REVIEW_V1`), que fue el problema de NH Hoteles.

Si algún día hace falta bloquear desde la interfaz sin desplegar, el paso natural es C, con una callable `admin_set_selection_control` que deje rastro.

Cómo funciona:
- `asset_eligibility.operator_blocks_selection(root, allow_historical=…)` lee el fichero.
- `exclude_from_history: true` reproduce exactamente lo que hacía `is_investable: false`: fuera del optimizador y también de los análisis históricos.
- Durante la transición, el código sigue respetando un `is_investable: false` que quede en la raíz.
- No hay flag público nuevo. El frontend filtra los flags por lista blanca, así que el asesor ve lo mismo que hoy (`is_investable: false`).

### 2.5 `SRI_KID` en métricas (`metrics.v1.3`): procede

El enum de `risk_score_source` pasa a `SRRI | SRI_KID | VOL_BUCKET`.

**Por qué procede.** El productor puente (`metricsLatest.ts`) pone `srri = srri_1a7 ?? sri_kid_1a7` y siempre etiqueta `SRRI`. Hoy hay 2 documentos `FONDOSDB_ROOT_ES` con el SRI del KID etiquetado como SRRI. Con el cambio se etiquetan `SRI_KID`. El contrato de lectura `asset-for-bdb.v1` ya admitía `SRI_KID`.

**Condición.** La app tiene que validar con v1.3 **antes** de que la plataforma escriba esa etiqueta. Si no, `metrics_refresh` rechaza el documento al fusionarlo, porque valida contra v1.2.

---

## 3. Cambios de código propuestos

### 3.1 Plataforma: `plataforma-propiedad-v12.patch`

Son 16 ficheros.

**`src/loader/ownership.ts` (nuevo).** Lee `x-owner`, las excepciones y las claves obsoletas del contrato, y valida con el contrato vigente de cada población.

**`src/loader/republish.ts`. `mergeOwned` pasa a `mergeOwnedDetailed`:**
- Reemplaza solo los bloques `plataforma` y restaura las sub-rutas de la app (`performance.valuation`).
- Borra solo las claves de `x-obsolete-root-keys`.
- **Si la raíz trae una clave que el contrato no declara, no reescribe.** Lanza `OwnershipConflictError` (`REPUBLISH_UNKNOWN_ROOT_KEYS`). Antes la borraba en silencio, y así se habría perdido un `is_investable`.
- Si la raíz es `MANUAL_DOCUMENTARY`, no la reescribe sin `--accept-canonical`.
- **Regla transitoria, solo para el legado de la fase 2:**
  - `risk.sri_kid_evidence`: se conserva si el canónico trae el mismo SRI y no produce la suya. Si el canónico dice otro SRI, hay conflicto y no se reescribe.
  - `fixed_income_profile.field_provenance`: rellena los huecos del canónico con el valor documentado. Si el canónico trae otro valor no nulo, hay conflicto.
  - Cuando el canónico sí produce evidencia y el SRI coincide, gana la del canónico (un solo escritor).
- La resolución se calcula en la fase de plan, así que la pasada en seco ya muestra los conflictos.
- Flag nuevo `--accept-canonical ISIN,…|all`, que es una decisión explícita.
- Contadores nuevos `ownership_conflicts` y `legacy_kept`, y un artefacto nuevo, `ownership_conflicts.json`.

**`src/ingestion/fondosdb/fondosDbMapper.ts`.**
- `mapRegulatory` copia solo las claves declaradas. Si el extractor añade una, no rompe la validación.
- `mapProvenance` deja `provenance` en su versión compacta.
- Costes del KID: entrada, salida, operación y «gestión y otros», con su `kid_evidence`. La comisión de rendimiento no se copia; ver D5.
- **`risk.sri_kid_evidence` derivada de `regulatory.kid`.** Se emite solo si se cumple todo esto:
  1. El KID tiene `url`, `sha256` y `date`.
  2. `regulatory.sri` es un entero de 1 a 7.
  3. El SRI sale del KID, por una de dos vías: procedencia oficial (`kid_gestora:*`, `cnmv_ficha:kid` o `amf_geco:kid`) o un `kid.sri` explícito.
  4. Coincide con `risk.sri_kid_1a7`.
  5. El KID está atestado para ese ISIN: `kid.verified_isin`, o una procedencia oficial, porque esos adaptadores comprueban el ISIN.

  `verified_at` es la fecha de descarga del endpoint en el extractor, no la del republish, así que no genera deriva perpetua. `manual:` no basta por sí solo.

**`src/ingestion/fondosdbStockAssets.ts`.** Añade `provenance` a las acciones.

**`planner.ts`, `writer.ts`, `reclassifyStock.ts`.** Validan y sellan con `asset.v1.2` o `asset-stock.v1.1`, y las métricas con v1.3.

**`metricsLatest.ts`.** Etiqueta `SRI_KID` cuando solo hay SRI PRIIPs.

**`scripts/dryrunOwnershipBackup.ts` (nuevo).** Es la pasada en seco del republish contra una copia local, sin red, con el mismo código del republish. Funciona tanto con el código actual como con el nuevo.

**Tests.**
- Nuevos: `tests/ownershipContract.test.ts` y `tests/fondosDbMapperRegulatory.test.ts`, 18 en total.
- `npm run typecheck`: OK.
- `npx vitest run` en la rama: 106 ficheros y 560/560 tests (535 previos, 5 del parche de métricas, 18 de propiedad y 2 de `restore:roots`).

**Coordinación con la sesión de métricas (hecho).** Su parche de `republish.ts` (republish puente: `ownsMetrics` con el `metrics/latest` vivo y `metrics_app_owned`) va como primer commit de `propiedad-campos-v12`, sin cambios. Encima, este. Se resolvieron a mano tres zonas de `main()`: el validador de métricas (v1.3 con `metricsOwned`), la fusión con conflictos sin redeclarar `metricsLive` y la línea de log con los dos contadores.

### 3.2 App: `app-propiedad-v12.patch` (este worktree)

Son 19 ficheros.

**Bloqueos.**
- `functions_python/asset_selection_controls.json` (nuevo), con las 4 acciones: motivo, nota, `decided_at` 30-09 y origen.
- `asset_eligibility.py` gana `operator_blocks_selection`.
- `readmodel/mappers.py`, `optimization/repository.py` y `scripts/dryrun_mejorar_cartera.py` pasan a usarlo.

**Contratos.**
- `contracts_cache/`: se añaden los 3 contratos nuevos y el manifiesto (`node scripts/syncContractsCache.mjs` con `BDB_CONTRACTS_ROOT` apuntando a la plataforma parcheada).
- Las métricas se validan con v1.3 en 10 puntos: `fund_ingest`, `ingest_asset`, `metrics_refresh`, `price_history_sync`, `improve_fund_data` y `migrate_metrics_latest`.

**`scripts/improve_fund_data.py`.**
- Deja de copiar los flags de política y `status: REVIEW` a la raíz. El read model (`public_flags`) y el inventario ya los leen del fichero de políticas.
- Valida con `asset.v1.2`. Hoy su `--prepare` falla con las 2 altas documentales.

**`scripts/migrate_provisional_roots.py`.** Valida con los contratos vigentes. Así no reconstruye raíces válidas que traigan `provenance`.

**`scripts/migrate_ownership_v12.py` (nuevo).** Es la migración de §4.3. Tiene tres modos:
- `--backup`: en seco, sin red.
- En seco contra Firestore.
- `--write --approval YES_I_UNDERSTAND_MASTER_DB_WRITES`: con precondición `update_time`, re-verificación y negativa si el documento vivo cambió desde la pasada en seco.

**Tests.**
- Nuevo: `tests/test_ownership_v12.py`, con 13 tests.
- Ajustado: un mensaje de `test_metrics_refresh.py`.
- Suite: 781 passed, 5 skipped.
- ruff (F, E9) sobre lo tocado: sin avisos nuevos. Los 6 que salen en `optimization/repository.py` son importaciones sin usar que ya existían.

---

## 4. Migración y pasada en seco (copia del 14-10 y canónico del 13-10)

### 4.1 Republish completo: hoy frente a la propuesta

| | Código actual | Con el cambio |
|---|---|---|
| Raíces del canónico presentes en la maestra | 846 | 846 |
| Con cambios respecto al canónico | 221 | 846 |
| Se reescriben | 221 | 827: todas las que cambian salvo los 19 conflictos (por `regulatory`/`provenance`; `costs` en 557) |
| **Pierden datos de la app o de legado** | **139** | **0** |
| — `risk.sri_kid_evidence` borrada | 121 | 0 |
| — SRI verificado devuelto al canónico | 12 | 0: son conflicto |
| — `field_provenance` borrada | 23 | 0 |
| — `fundamentals` de ETF borrado | 7 | 0 |
| Copias de flags de política retiradas de `quality` | 81 | 78 (decisión D7) |
| Conflictos: no se reescriben y esperan decisión | — | 19 |
| Legado conservado | — | 163 evidencias y 16 `field_provenance` |
| Evidencia SRI nueva, derivada del KID oficial | — | 205 (D3) |
| `costs` con costes del KID | — | 555 |
| Raíces inválidas tras la fusión | 0 | 0 |
| Cambios propios de la plataforma (el canónico se movió) | — | 3 SRI sin evidencia de la app (MAGALLANES EUROPEAN EQUITY, Edmond de Rothschild Patrimoine, Schroder ISF Em…); 8 `kid_periodo_mantenimiento_anos`; flags del extractor |

Fuera del canónico quedan 253 raíces, que el republish no toca:
- 241 acciones y 8 ETF EODHD.
- Las 2 altas documentales.
- LU0683600562 (AB Select US Equity, con evidencia).
- LU1493953001 (T. Rowe Price, NAV propio).

### 4.2 Qué pasa con las 481 `risk.sri_kid_evidence`

| Resultado | Docs |
|---|---|
| La sustituye la del KID oficial del canónico, con el mismo SRI | 297 |
| Se conserva tal cual (regla transitoria: el canónico no la produce y no la contradice) | 163 |
| Conflicto (12 por SRI y 6 por renta fija en el mismo documento): no se reescribe | 18 |
| Fuera del canónico: no se toca | 3 |
| **Perdidas** | **0** |

De las 297 sustituidas, en 76 el KID del extractor tiene **fecha anterior** al que encontró la fase 2. El SRI es el mismo, pero la evidencia «retrocede» de documento. Se arregla refrescando la familia KID del extractor antes del republish.

El `sha256` nunca coincide entre extractor y fase 2, ni siquiera con la misma URL y la misma fecha. El extractor hace hash del texto; el espejo de Deutsche Bank sirve PDF con marcas de tiempo.

### 4.3 Las 6 raíces fuera de contrato (`migrate_ownership_v12.py --backup`)

Resultado: `roots 1100 · invalid_before 6 · to_migrate 6 · invalid_after 0 · errors 0`.

| ISIN | Nombre | Cambios |
|---|---|---|
| ES0105513008 | SOLTEC POWER | Borra `is_investable=false` y `quality.review_note` (el bloqueo va a `asset_selection_controls.json`). El flag `PRICE_HISTORY_ARTIFACT_UNRESOLVED` se queda. |
| ES0110047919 | DEOLEO | Igual |
| ES0162600003 | DURO FELGUERA | Igual |
| ES0183304080 | SQUIRREL MEDIA | Igual |
| ES0173985005 | RIVER PATRIMONIO, FI | `source` pasa de `Andbank/CNMV` a `MANUAL_DOCUMENTARY` (más `source_detail` y `registered_by`).<br>`costs.evidence{ongoing_and_transaction, management_and_depositary}` se separa: el KID va a `kid_evidence` y el folleto de la CNMV a `evidence`.<br>`schema_version` pasa de `null` a `master.asset.v1.2`. |
| LU0591059224 | Robeco Asian Stars Equities D EUR | `source` pasa de `Robeco` a `MANUAL_DOCUMENTARY`.<br>`performance_fee_pct: 15` pasa a `performance_fee_rate_pct: 15`: es el tipo contractual del 15 % sobre el exceso; el KID da un impacto de 7 EUR por cada 10.000.<br>`schema_version` pasa a v1.2. |

Las 481 evidencias no necesitan una migración aparte: las asume el republish (§4.2).

### 4.4 Muestra antes y después

**BE0946564383, DPAM B Equities NewGems Sustainable.** El canónico sustituye la evidencia y el SRI sigue igual.
- `risk`: SRI 4 / SRRI 6 antes y después.
- Evidencia antes: `deutsche_bank_es` del 2026-09-07, corrida `fund-quality-phase2-2026-09-28`.
- Evidencia después: `deutsche_bank_es` del 2026-02-19, `extractor:kid_gestora:deutsche_bank_es`.
- Gana `regulatory` (19 claves, KID `deutsche_bank_es` del 2026-02-19).
- Gana en `costs`: entrada 2, salida 0, operación 0,7, gestión y otros 1,73, y `kid_evidence`.

**FR0000174310.** El canónico no tiene KID y el SRI que trae es el de Morningstar, igual al verificado. La evidencia de la app (`morningstar_via_finect`, 2026-02-11, fase 2) **se conserva**. Gana `regulatory` sin KID y `provenance`.

**LU0563745743, Bestinver Tordesillas SICAV Iberia A.** Hoy el republish lo devolvería de SRI 4 a 6 y borraría la evidencia. Con el cambio **no se reescribe**: `REPUBLISH_LEGACY_CONFLICT: risk.sri_kid_1a7 (canonico 6, KID verificado 4)`.

**ES0105513008, SOLTEC POWER.**
- Antes: `is_investable: false`, `quality.review_note: "A4 (auditoria 29-09, 30-09)…"`, `review_flags: [PRICE_HISTORY_ARTIFACT_UNRESOLVED]`.
- Después: sin `is_investable` ni `review_note`, con el mismo `review_flags`.
- En la app sigue `is_investable: false` y el optimizador la excluye, también en históricos, porque la entrada de `asset_selection_controls.json` lo dice.

**LU0591059224, Robeco.**
- Antes: `costs.performance_fee_pct: 15`, `performance_fee_basis: "15% de la rentabilidad superior al indice…"`, `source_metadata.source: "Robeco"`.
- Después: `costs.performance_fee_rate_pct: 15` con la misma base, y `source_metadata` con `source: MANUAL_DOCUMENTARY` y `source_detail: Robeco`.

### 4.5 Los 19 conflictos (`conflictos_republish_2026-10-14.csv`)

**SRI (12).** El KID verificado por la app frente al canónico. En 10 casos el canónico trae el SRI de Morningstar; en 2, el de otro KID.

| ISIN | Nombre | Canónico | KID verificado |
|---|---|---|---|
| FR0010286013 | Sextant Grand Large | 3 | 2 |
| LU0252970834 | BGF European Equity | 4 | 5 |
| LU0270905242 | Pictet-Security | 4 | 5 |
| LU0284394821 | DNCA Evolutif | 3 | 4 |
| LU0331286574 | BGF Sustainable Energy | 5 | 4 |
| LU0469270010 | AB Asia ex-Japan | 4 | 5 |
| LU0563745743 | Bestinver Tordesillas Iberia | 6 | 4 |
| LU0769137737 | BGF Continental European | 4 | 5 |
| LU0861897477 | Abante Spanish Opportunities | 5 | 4 |
| LU1080015693 | EdR Emerging Credit | 3 | 2 |
| LU1899018870 | Sigma Best M&G | 2 | 3 |
| LU2240056445 | Lonvia Mid-Cap Euro | 4 | 5 |

**Renta fija (7).** El valor documentado frente al canónico.

| ISIN | Campo | Canónico | Documentado |
|---|---|---|---|
| ES0125240038 | `avg_credit_quality` | BBB | BBB+ |
| LU0438336694 | `avg_credit_quality` | BBB+ | A- |
| LU0546917344 | `avg_credit_quality` | AA | AA- |
| LU1706854152 | `avg_credit_quality` | BBB- | BBB |
| LU1254412460 | `effective_duration` | 6,797 | 6,84 |
| LU1919971074 | `effective_duration` | 3,881 | 3,761 |
| LU0102737904 | `credit_quality` | todo a 0 | reparto completo |

`propuesta_correcciones_extractor_2026-10-14.json` las tiene ya en el formato de `config/correcciones.json` (rutas v2 `riesgo.sri_kid_1a7`, `documentos_oficiales.kid_*` y `cartera.renta_fija.*`). **No está aplicada.**

### 4.6 Orden de ejecución propuesto (sin ejecutar)

1. **Plataforma.**
   - Hecho en la rama `propiedad-campos-v12` (ver §7 para el orden final).
   - Comprobar con `npm run typecheck` y `npx vitest run`.
   - Commit.
2. **App.**
   - Aplicar `app-propiedad-v12.patch` y comprobar con `node scripts/syncContractsCache.mjs --check` (ya contra la plataforma commiteada) y `npm run test:functions`.
   - Commit y despliegue de functions.
   - **Esto tiene que ir antes de cualquier escritura.** Lleva el fichero de bloqueos y las validaciones v1.2 y v1.3.
3. **Copia.** `npm run backup:export` en `2-plataforma-datos`.
4. **Migración de las 6.**
   - Pasada en seco: `python scripts/migrate_ownership_v12.py --backup ../../2-plataforma-datos/data/backups/<marca> --json migracion_<fecha>.json`. Tiene que dar 6, 0 inválidas y 0 errores.
   - Aprobación.
   - Escritura: `--write --approval YES_I_UNDERSTAND_MASTER_DB_WRITES`.
   - Repetir la pasada en seco: debe dar `to_migrate 0`.
5. **Decisiones.**
   - Resolver los 19 conflictos (D4). Las correcciones van a `config/correcciones.json` y se ejecuta `python main.py update <ISIN…> --sin-caducidad`; lo que se acepte del canónico va con `--accept-canonical`.
   - Opcional y recomendado: refrescar la familia KID del extractor, por las 76 evidencias de fecha anterior.
6. **Republish.**
   - Pasada en seco: `npx tsx scripts/dryrunOwnershipBackup.ts --backup data/backups/<marca> --input ../1-extractor` y `npm run republish:fondosdb -- --input ../1-extractor --ids all --dry-run`.
   - Aprobación de los números: raíces, 205 SRI_KID nuevos y conflictos.
   - Escritura: `--write` con la puerta.
   - Repetir la pasada en seco: 0 cambios salvo los conflictos que se dejen abiertos.
7. **Fase 3, en el extractor.**
   - Emitir `regulatory.kid.sri`, `verified_isin` y `checked_at`.
   - Separar en el KID el impacto y el tipo de la comisión de rendimiento.
   - Subir las 163 evidencias conservadas (grupo C de la propuesta).
   - Después, retirar la regla transitoria del republish.

---

## 5. Decisiones que necesita Óscar

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | Dónde viven los bloqueos de selección | A raíz y `quality` · B bloque raíz de la app · C colección propia · D fichero versionado | **D**, con C como paso futuro si se quiere bloquear desde la interfaz |
| D2 | Dónde viven `regulatory` y `provenance` | En la raíz, como pide el encargo y recoge este diseño · formalizar `fund_profile/latest` como documento de la plataforma | **En la raíz, en versión compacta.** `fund_profile/latest` se queda para las revisiones de la app y, en otra tarea, deja de copiar `regulatory` del canónico |
| D3 | Evidencia SRI derivada del KID oficial: 205 activos con evidencia nueva; 174 fondos con cifra visible distinta (`sri_visible.csv` de la pasada en seco, §7.1) | Aceptar · derivar solo donde ya había evidencia | **Aceptar.** Es el indicador PRIIPs del KID oficial de la clase, el que exige la normativa vigente. Conviene revisar la lista antes de escribir, porque el asesor verá cambiar 174 cifras de riesgo |
| D4 | Los 19 conflictos | Corrección en origen (KID o documento verificado) · `--accept-canonical` | **SRI (12): corrección en origen** (los KID son de clase, recientes y con la frase explícita). **Renta fija (7): caso a caso.** Las diferencias son pequeñas; aceptar el canónico salvo que el documento sea posterior |
| D5 | Comisión de rendimiento del KID: en 76 KID del canónico la fila trae el tipo (5-20 %), no el impacto | No copiarla a `costs` hasta que el extractor la separe · heurística por umbral | **No copiarla.** Así está en el código; el arreglo va en el extractor |
| D6 | Las 2 altas documentales | Mantenerlas como `MANUAL_DOCUMENTARY` (app) · darlas de alta en el extractor | **Primero migrar a `MANUAL_DOCUMENTARY`; después, alta en el extractor.** River sale de la CNMV; Robeco necesita correcciones. El traspaso exige `--accept-canonical` |
| D7 | Copias en la raíz de los flags de política (78 documentos; 57 pasan de REVIEW a ACCEPTED) | Dejar que el republish las retire · conservarlas | **Retirarlas.** Son redundantes (el read model y el inventario leen el fichero) e `improve_fund_data` deja de escribirlas |
| D8 | `SRI_KID` en `metrics.v1.3` | Incluir · no | **Incluir**, desplegando primero la app con v1.3 |
| D9 | LU0683600562 (AB Select US Equity): está en la maestra con evidencia, pero ya no en el canónico; nadie lo refresca | Archivar · volver a darlo de alta en el extractor | Decide Óscar. No se toca en esta propuesta |
| D10 | Fase 3 en el extractor (atestación del KID y comisión de rendimiento) | Hacerla · dejar la regla transitoria | **Hacerla.** Es lo que permite retirar la regla transitoria |

---

## 6. Fuera de alcance: seguimiento

- **`holdings_summary` en la raíz.** Lo escriben `fund_ingest` e `improve_fund_data`. `holdingsRepublish` refresca `holdings/` pero no este resumen, así que puede quedar desfasado.
- **`fund_profile/latest` tiene dos dueños.** `improve_fund_data.put()` lo sobrescribe entero y perdería `documentation_audit`, `holdings_review` y `risk_reconciliation`.
- **`admin_panel` muestra en blanco el máximo drawdown histórico.**
  - `asset_detail` devuelve `{value, date}` y el frontend (`adminBackend.ts`) espera `{pct, periodo, fecha}`.
  - `_row` lee `max_drawdown_hist.fecha`, pero metrics.v1.2 usa `date`.
  - Lo encontró el inventario y no se ha tocado.
- **Búsqueda degradada sin `meta/search_index`.** La proyección de `firestore_client` no incluía `is_investable`. Con el fichero de controles deja de importar para los bloqueos.
- **Scripts de escritura fuera de git.** `output/` y `tmp/` están en `.gitignore` y desde ahí se escribió en la maestra. Si se mantienen, conviene que cualquier escritura pase por scripts versionados con puerta y pasada en seco, como `migrate_ownership_v12.py`.

## Anexos

En `%APPDATA%\Claude\side-session-notes\local_eefad96a-…\propiedad-campos-maestra\`:

- `plataforma-propiedad-v12.patch`: 16 ficheros. Se aplica desde la raíz de `2-plataforma-datos`.
- `app-propiedad-v12.patch`: 20 ficheros (19 de código más este documento). Se aplica desde la raíz de `3-BDB-ACTIVOS_app`.
- `diff_semantico_contratos_v12.txt`: diff por rutas de los tres contratos.
- `conflictos_republish_2026-10-14.csv`: los 19 conflictos.
- `sri_visible_cambia_2026-10-14.csv`: los 205 fondos con evidencia nueva, con la cifra visible antes y después.
- `propuesta_correcciones_extractor_2026-10-14.json`: correcciones propuestas, no aplicadas.
  - Grupo A: 12 SRI.
  - Grupo B: 7 de renta fija.
  - Grupo C: 163 evidencias, que necesitan rutas nuevas en el extractor.
- `dryrun_republish_actual/` y `dryrun_republish_propuesto/`: `summary.json`, `detail.json` y `samples.json` de las dos pasadas en seco.
- `migracion_dryrun_2026-10-14.json`: pasada en seco de la migración, con los documentos después del cambio.

---

## 7. Pasada en seco final y orden de ejecución (14-10-2026, tarde)

Óscar dio el visto bueno («adelante») a D1-D10. D4 y D10 quedan para una tarea posterior y D9 no se toca.

**Código commiteado** (sin merge a `master`, sin push, sin despliegue):

| Repositorio | Rama | Commits sobre `master` |
|---|---|---|
| `2-plataforma-datos` | `propiedad-campos-v12` | `7e56a86` republish puente de métricas: es el parche de la sesión de métricas del 13-10, sin cambios.<br>`3c35c9c` contratos.<br>`38c205e` mapper.<br>`b57aad9` republish con dueño por bloque.<br>`b6f5967` `restore:roots`.<br>`1bf47ee` el SRI visible solo en fondos, en la pasada en seco. |
| `3-BDB-ACTIVOS_app` | `claude/agitated-mccarthy-a5b6af` | `4ab5caa` caché de contratos.<br>`83f4f8e` código y tests.<br>`62beb04` este documento.<br>`091a0e9` `--restore-from`.<br>Un commit más con esta §7. |

**Verificación de las ramas.**
- Plataforma: `npm run typecheck` OK y `npx vitest run` 106 ficheros, 560/560 tests.
- App: pytest 782 passed / 5 skipped, `npm run typecheck` OK y `npx vitest run` 1.030 passed / 5 skipped (155 ficheros).
- La caché de contratos de la app coincide con la rama de la plataforma (`syncContractsCache.mjs --check`).

**Ajenos que no van en ningún commit.**
- En la plataforma, los cambios sin commitear de Óscar en la copia principal: `searchIndex`, `runBackupExport`, `fondosHoldingsMapper`, `package-lock.json` y los tests nuevos. No tocan ningún fichero de la rama, así que la fusión con `--ff-only` no choca con ellos.
- Un `.md` de `docs/` con ruta demasiado larga que git no puede leer en el worktree de la rama.

**La rama de la app ya contenía `master`.** Se creó en `72960fc`, con las ventanas, el YTD, la exclusión de NH y las 4 ejecuciones. No hubo que fusionar nada: los cambios de propiedad se hicieron encima, y en esos ficheros solo cambian `metrics.v1.2` por `metrics.v1.3`.

### 7.1 Números sobre la copia nueva

**Copias.** Mañana: `2026-10-14T06-49-58-334Z`. Nueva: `2026-10-14T10-52-59-364Z`, con verificación PASS y 25.073 documentos. La nueva se sacó con `BDB_BACKUP_WRITE_STATUS_DOC=false`, así que no escribió `meta/backup_status`.

**Canónico.** El mismo en las dos pasadas: `1-extractor`, 13-10 a las 15:30, 847 activos.

**Herramientas.** `npm run ownership:dryrun` en la plataforma (`1bf47ee`) y `migrate_ownership_v12.py --backup` en la app (`091a0e9`), ambas ya commiteadas.

| | Pasada anterior (mañana) | Copia nueva |
|---|---|---|
| Raíces vivas / activos del canónico | 1.100 / 847 | 1.100 / 847 |
| Raíces con cambios respecto al canónico | 846 | 846 |
| **Se reescriben** | **827** | **827** |
| **Conflictos (no se reescriben)** | **19** | **19**, los mismos ISIN |
| **Pierden datos de la app o de legado** | **0** | **0** |
| Inválidas tras la fusión | 0 | 0 |
| Legado conservado | 163 evidencias y 16 `field_provenance` | igual |
| Evidencias de la app sustituidas por la del KID oficial, con el mismo SRI | 297 | 297 |
| Evidencia SRI nueva, derivada del KID | 205 (203 fondos y 2 ETF) | igual |
| Copias de flags de política retiradas de `quality` | 78 | 78 |
| `metrics/latest` de la app, intactos | 733 | 733 |
| `metrics/latest` puente: con cambios / total | 15 / 39 | 15 / 39 |
| Puente que pasa a `SRI_KID` | 2 | 2 |
| Raíces fuera del canónico (no se tocan) | 253 | 253 |
| Migración: a migrar / inválidas después / errores | 6 / 0 / 0 | 6 / 0 / 0 |

**Cuadra con la pasada anterior.**
- Las 846 raíces con cambios eran ya 827 reescrituras más 19 conflictos; la primera versión de la tabla las contaba juntas.
- Activo a activo, ningún resultado cambia entre las dos copias.
- La copia nueva sí recoge la escritura de métricas de las 10:54: VALENTUM a 1 año tiene 21,56 %, frente a 28,45 % en la de la mañana. Eso no altera esta pasada, por dos motivos:
  - Esas métricas son de la app, y el republish puente no las toca.
  - Entre las dos copias nadie escribió raíces.

**SRI visible.** El read model solo sustituye por `SRI_KID` cuando `asset_type == "FUND"`. Archivo: `side-session-notes/local_eefad96a-…/propiedad-campos-maestra/pasada_final_2026-10-14T10-52-59/sri_visible.csv`, con 203 fondos y la cifra anterior y posterior.

| Caso | Fondos |
|---|---|
| Cambia la cifra: de un SRRI distinto al SRI del KID | **174**: 172 bajan (86 un punto, 77 dos, 7 tres y 2 cuatro) y 2 suben |
| Solo cambia la etiqueta (mismo número) | 22 |
| Antes `VOL_BUCKET`; pasa a `SRI_KID` | 4 |
| Sin `metrics/latest`; pasa a `SRI_KID` | 3 |
| ETF con evidencia nueva: sin efecto visible | 2 (no están en el CSV) |

Corrección: entre medias escribí 175. Era un error: contaba un ETF (Invesco EURO STOXX Optimised, IE00B3Q19T94, de 7 a 5) que el read model no cambia. La cifra buena es 174.

Cinco ejemplos:

| ISIN | Fondo | Antes | Después | KID |
|---|---|---|---|---|
| ES0110407006 | GESTION BOUTIQUE VI, FI | SRRI 7 | SRI 4 | CNMV, 01-01-2026 |
| DE000A0X7541 | Acatis Value Event Fonds A | SRRI 5 | SRI 3 | espejo Deutsche Bank, 16-04-2026 |
| ES0137396000 | FON FINECO INVERSION, FI | SRRI 6 | SRI 3 | CNMV, 31-12-2025 |
| ES0138382033 | FON FINECO GESTION, FI | SRRI 5 | SRI 2 | CNMV, 31-12-2025 |
| ES0165142003 | MUTUAFONDO CORTO PLAZO, FI | SRRI 1 | SRI 2 | uno de los 2 que suben |

Los artefactos completos de esta pasada están en `pasada_final_2026-10-14T10-52-59/`: `summary.json`, `detail.json`, `samples.json`, `conflictos.csv`, `sri_visible.csv` y `migracion_dryrun.json`.

### 7.2 Orden de despliegue y escritura

Todo desde la sesión principal y con la aprobación de Óscar en cada escritura.

**Franja horaria.** Nada de esto durante las métricas (08:30–10:00) ni la integridad (10:30). Lo más seguro es después de las 10:45.

**1. Plataforma: fusión en `master`.** Primero, porque el `predeploy` de functions sincroniza la caché de la app desde la copia de trabajo de `2-plataforma-datos` y aborta («Cache contiene schemas ajenos al SSOT») si allí faltan los contratos nuevos.
```powershell
cd C:\Users\oanti\Proyectos\BDB\2-plataforma-datos
git merge --ff-only propiedad-campos-v12
npm run typecheck
npx vitest run
```

**2. App: fusión, comprobaciones y despliegue de functions.** Tiene que ir antes de cualquier escritura en la maestra. Lleva el fichero de bloqueos, que sustituye a `is_investable`, y valida las métricas con v1.3; si no, el refresco rechazaría un `metrics/latest` puente con `SRI_KID`.
```powershell
cd C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app
git merge --ff-only claude/agitated-mccarthy-a5b6af
npm run check:contracts
npm test
npx eslint src tests scripts      # npm run lint recoge .claude/worktrees
npm run build
Set-Location functions_python; python -m pytest -q; Set-Location ..
$env:BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY="YES_I_UNDERSTAND_SHARED_PROJECT"
npx firebase deploy --only functions --project bbdd-activos-financieros
Remove-Item Env:\BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY
```
Después del despliegue, comprueba lo de siempre del RUNBOOK:
- 48 funciones `ACTIVE`, con las cuentas dedicadas (`gcloud functions list …`).
- Las 9 tareas de Scheduler, con `bdb-functions-writer` (`gcloud scheduler jobs list …`).

En la interfaz, comprueba los bloqueos:
- SOLTEC POWER (ES0105513008) tiene que seguir «No disponible» y fuera del optimizador.
- Cualquier fondo sin bloqueo tiene que seguir seleccionable.

**3. Copia.**
```powershell
cd C:\Users\oanti\Proyectos\BDB\2-plataforma-datos
npm run backup:export
```

**4. Migración de las 6 raíces fuera de contrato.**

Primera pasada en seco, contra la copia: debe dar `to_migrate 6 · invalid_after 0 · errors 0`.
```powershell
cd C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app\functions_python
python scripts\migrate_ownership_v12.py --backup ..\..\2-plataforma-datos\data\backups\<marca> --json migracion_<marca>.json
```

Segunda pasada en seco, contra Firestore con ADC (solo lectura): debe dar los mismos 6.
```powershell
python scripts\migrate_ownership_v12.py
```

Con la aprobación, la escritura. El script escribe con precondición `update_time` y se niega si el documento cambió desde la pasada en seco.
```powershell
python scripts\migrate_ownership_v12.py --write --approval YES_I_UNDERSTAND_MASTER_DB_WRITES
```

Después, repite la pasada en seco contra Firestore: debe dar `to_migrate 0 · invalid_after 0`.
```powershell
python scripts\migrate_ownership_v12.py
```

**5. Republish de la plataforma.**

Primero, la pasada en seco offline sobre la copia del paso 3. Tiene que cuadrar con §7.1, salvo los 6 documentos ya migrados, que el republish no toca.
```powershell
cd C:\Users\oanti\Proyectos\BDB\2-plataforma-datos
npm run ownership:dryrun -- --backup data\backups\<marca> --input ..\1-extractor --out runs\ownership_<marca>
```

Después, la pasada en seco real contra Firestore, que solo lee. Antes de seguir, revisa en `republish_summary.json`:
- `root_to_republish` y `ownership_conflicts`.
- `metrics_to_set` y `metricas_app`.
- `holdings_stale`, que la pasada offline no evalúa.
- `search_index`.
```powershell
npm run republish:fondosdb -- --input ..\1-extractor --ids all
```

Con la aprobación, la escritura:
```powershell
$env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES="YES_I_UNDERSTAND_MASTER_DB_WRITES"
npm run republish:fondosdb -- --input ..\1-extractor --ids all --write
Remove-Item Env:\BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES
```

Los 19 conflictos se quedan sin reescribir hasta la tarea de D4, sin pérdida. No uses `--accept-canonical` ahora.

### 7.3 Verificación después de escribir

1. **Repite las dos pasadas en seco sobre Firestore** (`migrate_ownership_v12.py` y `republish:fondosdb` sin `--write`).
   - Deben dar `to_migrate 0`.
   - En el republish, `root_to_republish 0` y `metrics_to_set 0`, salvo lo que haya movido el extractor entretanto.
   - Los 19 conflictos tienen que seguir apareciendo.
2. **Comprueba los conteos con una copia nueva** (`npm run backup:export` + `npm run ownership:dryrun`):
   - `root_rewrites 0`.
   - `rewrites_losing_app_data 0`.
   - 686 raíces con `risk.sri_kid_evidence`: las 481 de hoy (297 sustituidas por la del KID, 163 conservadas, 18 en conflicto y 3 fuera del canónico) más las 205 nuevas.
3. **Comprueba en la interfaz y el read model:**
   - GESTION BOUTIQUE VI (ES0110407006) muestra riesgo 4 con fuente SRI del KID.
   - Bestinver Tordesillas Iberia (LU0563745743, en conflicto) sigue con 4.
   - SOLTEC POWER sigue no invertible.
4. **Al día siguiente:**
   - Las 4 ejecuciones de métricas en INFO/ok, sin `contract_rejected`.
   - `meta/integrity_status` de las 10:30 en OK.
   - `migrate_provisional_roots.py` en seco ya no propone reconstruir las 4 acciones, porque ahora validan.

### 7.4 Reversión

**Código.**
- App: `git revert` de los 4 commits de la rama, o vuelta a `72960fc`, y despliegue de functions. La caché vuelve a sincronizarse desde la plataforma en el `predeploy`, y el código anterior no usa los contratos nuevos.
- Plataforma: `git revert` de los 6 commits. No hay nada desplegado: solo es herramienta local.

**Datos de la migración (6 raíces).** Devuelve desde la copia del paso 3 solo las claves migradas (`is_investable`, `quality`, `source_metadata`, `costs`, `schema_version`). El fichero de controles sigue bloqueando las 4 acciones aunque se revierta.
```powershell
python scripts\migrate_ownership_v12.py --restore-from ..\..\2-plataforma-datos\data\backups\<marca> --ids ES0105513008,ES0110047919,ES0162600003,ES0183304080,ES0173985005,LU0591059224
python scripts\migrate_ownership_v12.py --restore-from <misma copia> --ids <los mismos> --write --approval YES_I_UNDERSTAND_MASTER_DB_WRITES
```

**Datos del republish (raíces y métricas puente).** `restore:roots` hace dos cosas:
- Devuelve los bloques de la plataforma de la copia y borra `regulatory`/`provenance`.
- Conserva lo que la app escribió después, como `performance.valuation` o `holdings_summary`.

Toma los ISIN del plan del run. Primero en seco y después con la puerta:
```powershell
npm run restore:roots -- --backup data\backups\<marca> --ids runs\republish_<run>\republish_plan.json --metrics
$env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES="YES_I_UNDERSTAND_MASTER_DB_WRITES"
npm run restore:roots -- --backup data\backups\<marca> --ids runs\republish_<run>\republish_plan.json --metrics --write
Remove-Item Env:\BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES
```

**Qué no cubre `restore:roots`.**
- Los holdings que el republish refresque (`holdings_stale` en su pasada en seco). Si salen más de 0 y se quiere reversión completa, conviene revisarlos antes de escribir.
- `meta/search_index`, que reconstruye cada día el trabajo de las 03:45 de la app.
- Un `metrics/latest` que no existiera en la copia. Se señala como error para revisarlo a mano.
