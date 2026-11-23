> **Ejecutado el 21-11-2026** (decisión C-32 de `DECISIONES_BASE_NUEVA_2026-11-01.md`): Óscar aprobó las decisiones 30 a 39 por la recomendada y el borrado entró en tres tandas; el estado anterior está en la etiqueta `referencia-base-vieja-2026-11-21`. Lo que este censo llama MUERTO ya no está en el código.

# Censo del código que solo sirve a la base vieja

Fecha: 21-11-2026. Es el primer paso de la tanda de borrado que Óscar decidió el 21-11-2026 («en dos pasos: primero este
censo, que él verá, y después el borrado de lo que dé por bueno»). Solo lectura sobre `908afe57`: nada se ha editado,
borrado ni ejecutado, no se ha abierto ningún emulador ni base, y no se ha tocado `C:\Users\oanti\Proyectos\BDB`.

**La base vieja** es el proyecto `gestor-activos-local`: el clon sembrado de la copia de la maestra de BDB, con la forma
`assets/…`, `meta/…`, `metrics/latest`, `bdb_activos/{uid}/portfolios`, en el Firestore 8082. **La base nueva**
(`bdb-gestor-de-activos`: `instruments/…`, `computed/…`, 8092 en local y la nube en producción) es la que usan producción
desde el 03-11 y el desarrollo local desde el 21-11 (`c7f43db9`). Lo que sigue es lo que **solo** tiene sentido con la
forma de la vieja.

**Cómo leerlo.** Sigue el formato de `CENSO_CODIGO_HEREDADO_2026-11-16.md`: cada pieza con su evidencia y su veredicto.

- **MUERTO**: nadie lo usa en producción ni en local desde el 21-11. Es candidato a borrar, no una orden.
- **VIVO**: se usa (se cita solo cuando se podía confundir con lo muerto).
- **DUDOSO**: depende de una decisión de Óscar o de un acoplamiento que hay que deshacer antes; el porqué está en la fila.

Las líneas son de `wc -l` o de rango de `ast`, ±1 por fichero. Una pieza «mixta» (una prueba o un fichero que mezcla lo
muerto con lo vivo) no se borra: se recorta, y se cuenta aparte.

## Método y qué está comprobado y qué es suposición

**Comprobado, sin ejecutar nada del proyecto:**

- **Functions.** Grafo de imports de los módulos de `functions_python` con `ast` (sin `tests/` ni `scripts/`), calculando
  qué módulos alcanza cada una de las 46 Functions declaradas en `main.py`, con la de `main.py` resolviendo también los
  cinco módulos que carga de forma perezosa (`weekly_report`, `admin_panel`, `history_backfill`, `ingest_asset`,
  `system_status`). Un segundo cálculo, solo con los imports de primer nivel, separó lo que alcanzan las 23 desplegadas de
  lo que solo alcanzan las 23 que no se despliegan. El puente `optimization/repository.py → price_history_sync` (una sola
  función, `adjustment_problem`) hace que el primer cálculo sobrestime lo vivo: se resolvió a mano (ver la fila).
- **Plataforma.** Grafo de imports de `src/`, `scripts/` y `tests/` con las entradas vivas (todo lo que lanzan
  `baseNueva:*`, `audit:*`, `nube:*`, `planes:*`, `carteras:write`, `dryrun:base-nueva`) frente a las entradas de la vieja;
  lo que solo alcanzan estas últimas es lo MUERTO.
- **App.** Búsqueda de cada import de `AdminPage.tsx`, de los adaptadores y componentes, de las rutas y de `LEE_LA_NUBE`
  en `src/`, `tests/` y `scripts/`. Las 23 Functions no desplegadas, contra la lista de `desplegarFunciones.mjs` y contra
  las llamadas `httpsCallable` de `src/adapters`.
- **Prueba.** Para cada prueba, qué módulos importa (y, donde se necesitó, las líneas concretas).

**Suposiciones y límites (léanse antes de borrar):**

- «Nadie lo llama en local» se apoya en que `LEE_LA_NUBE` es `true` cuando la app apunta a `bdb-gestor-de-activos` con
  emuladores (comprobado en `tests/baseNuevaCaminoDeProduccion.test.ts`, líneas 66-77), y que `AdminPage` oculta las
  secciones de la vieja con ese interruptor. Si alguien volviera a poner un `.env.local` contra `gestor-activos-local`,
  la vieja volvería a verse: es la hipótesis de que no va a pasar, y es lo que Óscar decide al aprobar el borrado.
- No se siguen referencias dinámicas (rutas construidas con cadenas, `spawn` con nombres calculados). Se buscaron los
  nombres literales. No se han ejecutado las suites: **ninguna cifra de «las pruebas se van» está medida con la suite en
  verde**, sale del grafo.
- Los documentos (`.md`, `docs/`) no se cuentan como código: los que nombran lo borrado quedarían citando ficheros que no
  existen (lista en el apartado e).
- Las 596 MB de copias de la maestra vieja están en `2-plataforma-datos/data/backups` del repositorio principal (fuera de
  Git; 8 carpetas, del 29-10 al 31-10-2026). No se han abierto.

## (a) Resumen

Piezas = filas de las tablas de (b). Líneas = aproximadas, solo de lo MUERTO (código y pruebas; los `.json`, `.bat` y las
reglas de CSS se cuentan aparte).

| Capa | MUERTO (piezas) | VIVO que se cita | DUDOSO (piezas) | Líneas MUERTAS |
|---|---:|---:|---:|---:|
| 3-BDB-ACTIVOS_app · `functions_python` (módulos, ramas, Functions, scripts, pruebas) | 52 | 3 | 7 | ≈ 16.800 |
| 3-BDB-ACTIVOS_app · app (Sistema, adaptadores, pruebas, scripts) | 25 | 3 | 9 | ≈ 11.300 |
| 2-plataforma-datos | 12 | 2 | 6 | ≈ 14.100 |
| 1-extractor | 3 | 1 | 3 | ≈ 1.900 |
| 4-base-nueva y raíz | 0 | 0 | 5 | 0 (solo documentos) |
| **Total** | **92** | **9** | **30** | **≈ 44.100** |

Lo MUERTO, por tipo: unas **16.800 líneas en las Functions** (6.470 de módulos, 275 de `main.py`, 460 de lectores y
almacén de la vieja, 2.700 de guiones y 6.850 de pruebas), unas **11.300 en la app** (6.200 de pantalla y adaptadores, 2.300
de pruebas y 2.700 de guiones Python), unas **14.100 en la plataforma** (7.240 de `src/`, 1.050 de guiones y 5.800 de
pruebas) y unas **1.900 en el extractor** (el motor y los endpoints de «Plataforma» del servicio de Operaciones, y su prueba).
Además, **20 de las 23 Functions que no se despliegan** son de la vieja; las otras tres son la automatización de informes
(DUDOSO, apartado d). En la plataforma, además, son **10 las entradas de `package.json`** que solo sirven a la vieja.

**Lo que NO se cuenta aquí y conviene tener a la vista:** DUDOSO suma unas 5.100 líneas más (las reglas y sus pruebas,
`contracts/master`, el guion de restauración, `etiquetas.ts`, el servicio de Operaciones del extractor, la rama REST de
`baseNuevaLectura.ts`, `set_admin.py`, ≈ 900 líneas de lo muerto dentro de pruebas mixtas…); si Óscar decide borrar también
eso, el total pasa de 49.000. Las cifras de las capas no suman exactamente el total por el redondeo de cada una.

## (b) Tablas por capa

### 3-BDB-ACTIVOS_app/functions_python — módulos

Las 18 piezas siguientes **solo las alcanzan Functions que la base nueva no despliega** (sus lectores y escritores trabajan
con `assets`, `metrics/latest`, `meta/*`). Evidencia común: cálculo de alcanzabilidad desde las 23 desplegadas (no llega a
ninguno) y `grep -rn "^\s*\(from\|import\) <módulo>"` sobre el paquete (los importadores son todos de esta lista).

| Ruta | Líneas | Qué hace | Quién la llama hoy | Pruebas | Veredicto |
|---|---:|---|---|---|---|
| `admin_panel.py` | 590 | Lectura de `assets`/`meta` para el panel «BBDD maestra», «Calidad de fondos», «Inspección» | `main.py`: `admin_db_status`, `admin_list_assets`, `admin_asset_detail`, `admin_fund_quality` (ninguna desplegada, ninguna con pantalla visible) | `test_admin_*` (4), `test_clock`, `test_clients_and_timeouts` | MUERTO |
| `history_backfill.py` | 492 | Carga de históricos faltantes en `assets/…/price_series` | `main.py`: `admin_backfill_candidates`, `admin_backfill_history`; `scripts/improve_fund_data.py` | `test_history_backfill*` (2) | MUERTO |
| `system_status.py` | 39 | Semáforo (`meta/integrity_status`) para «Estado del sistema» | `main.py`: `get_system_status` | `test_system_status` | MUERTO |
| `integrity_check.py` | 356 | Escribe `meta/integrity_status` | `scheduled_integrity_check`; `master_write_client.py` (comentario) | `test_integrity_check`, `test_env_example` | MUERTO |
| `metrics_refresh.py` | 911 | Recalcula `metrics/latest` de `assets` | `scheduled_refresh_metrics*` (4), `admin_recompute_metric`; lo importan `ingest_asset`, `price_history_sync` | `test_metrics_refresh` y otras 8 | MUERTO |
| `price_refresh.py` | 884 | Refresca precios EODHD sobre `assets` y repara series | `scheduled_refresh_prices`, `admin_refresh_all_stale`, `admin_refresh_prices`; importado por `fund_ingest`, `ingest_asset`, `history_backfill`, `reviewed_nav_*`, `price_history_sync` (perezoso) | `test_price_refresh_fx`, `test_price_scheduler_gate`, `test_admin_manual_refresh`, `test_admin_read_budget` | MUERTO |
| `ingest_asset.py` | 831 | Alta de un activo en `assets` (EODHD, Finnhub, Morningstar) | `admin_ingest_asset`; `history_backfill`, `metrics_refresh`, `price_history_sync` (perezosos) | `test_ingest_asset` (1.032 líneas) y otras 6 que lo citan | MUERTO (pero ver `build_metrics_latest` en el apartado d) |
| `fund_ingest.py` | 1.128 | Ficha, métricas y cartera de un fondo para `assets` | solo `ingest_asset` | `test_fund_resolution`, `test_fund_return_basis`, `test_ytd_return`, `test_verified_kid_risk` | MUERTO |
| `search_index.py` | 285 | Escribe `meta/search_index` | `scheduled_reconcile_search_index`, `admin_reconcile_search_index`; `ingest_asset`, `fund_ingest` | `test_search_index`, `test_meta_size` | MUERTO |
| `write_governance.py` | 63 | Gate maestro `BDB_ACTIVOS_ENABLE_MASTER_WRITES` | `main.py` (solo `admin_*` y `get_system_status`), los módulos de arriba, `scripts/set_admin.py` | `test_write_governance`, `test_env_example` | MUERTO (con la salvedad de `set_admin.py`, DUDOSO) |
| `master_write_client.py` | 31 | Cliente de escritura de la maestra | `integrity_check`, `metrics_refresh`, `price_refresh`, `reviewed_nav_refresh`, `search_index` | `test_clients_and_timeouts` | MUERTO |
| `contract_validation.py` | 39 | Valida documentos de `assets` contra `contracts_cache` | solo los escritores de arriba y `price_history_sync` | `test_verified_kid_risk`, `test_ownership_v12` (parcial) | MUERTO |
| `fx_currency.py` | 160 | Divisa de un activo al escribir precios | solo `price_refresh` | `test_fx_currency_resolution` | MUERTO |
| `fund_return_basis.py` | 51 | Base de rentabilidad al ingestar | solo `fund_ingest` | `test_fund_return_basis` | MUERTO |
| `reviewed_nav_refresh.py` | 171 | Refresco de VL revisados en `assets` | `scheduled_refresh_reviewed_navs` | `test_reviewed_nav_refresh` | MUERTO |
| `reviewed_nav_sources.py` + `reviewed_nav_sources.json` | 251 | Fuentes de esos VL | `reviewed_nav_refresh`, `integrity_check` | `test_reviewed_nav_sources` | MUERTO |
| `capitalgroup_nav.py` | 143 | Descarga de VL de Capital Group | `reviewed_nav_refresh`, `reviewed_nav_sources` | `test_capitalgroup_refresh_plan` | MUERTO |
| `optimization/firestore_reader.py` | 43 | Lector de series de la vieja | solo `lector_de_optimizacion()` (rama vieja) | `test_analysis_read_deadlines` | MUERTO |

**Subtotal MUERTO de módulos: 6.468 líneas** (los 18 ficheros Python, con el lector de optimización; el `.json` de fuentes es de 5 KB).

| Ruta | Líneas | Qué hace | Quién la llama hoy | Pruebas | Veredicto |
|---|---:|---|---|---|---|
| `readmodel/firestore_client.py`: clase `FirestoreReader` (líneas 144-503) | ≈ 360 | Lector de `assets` (raíz, métricas, cartera, índice) | solo la rama vieja de `lector_de_activos()` (`lector_base_nueva.py:807`) y `FirestoreOptimizationReader` | `test_firestore_client_chunked` (309), parte de `test_a2_hardening`, `test_asset_eligibility`, `test_lector_base_nueva` | MUERTO (la clase; `get_master_db`, `_valid_asset_id` y las cachés son VIVOS: los usan `LectorBaseNueva`, `main.py` y `almacen_base_nueva`) |
| `portfolios/store.py`: `FirestorePortfolioStore` (líneas 21-67) | ≈ 55 | Almacén de carteras por UID en `bdb_activos/{uid}/portfolios` de la vieja | rama vieja de `almacen_de_carteras()` (`store.py:73`) | `test_portfolios` (parte), `test_guardado_condicionado_emulador` (parte) | MUERTO (el `AlmacenCarterasBaseNueva` es VIVO) |
| `readmodel/lector_base_nueva.py:776-807` | ≈ 12 | Las tres ramas `master_project_id() != PROYECTO_BASE_NUEVA`: `resolver_tipo_libre`, `lector_de_optimizacion`, `lector_de_activos` | las tres funciones, de `main.py` | `test_lector_base_nueva` (la línea 342 sustituye `FirestoreReader`) | MUERTO (las ramas; el resto del módulo es VIVO) |
| `main.py:579-591` | ≈ 4 | Guarda de `generate_portfolio_draft`: «el generador necesita la base nueva» | `generate_portfolio_draft`, desplegada | `test_generador_de_carteras` | DUDOSO (sin la vieja el `if` es siempre falso, pero es también una defensa si `MASTER_PROJECT_ID` se pone mal; ver apartado d) |
| `price_history_sync.py` salvo `adjustment_problem` | ≈ 250 de 294 | Reparación de series (`prepare_repair`, `apply_repair`, `mark_repair_*`, `build_repair_plan`) | `price_refresh`, `ingest_asset`, `metrics_refresh` | `test_price_history_sync` (507) | MUERTO |
| `price_history_sync.py::adjustment_problem` + `price_repair_release.py` + `verified_price_repair_releases.json` | 18+45 | Cuarentena de series con ajuste dudoso, leída al optimizar | `optimization/repository.py` (3 sitios), VIVO en las desplegadas | `test_price_repair_releases`, `test_price_history_sync` (parte) | DUDOSO (sigue activa para las dos bases; la lista de ISIN de la vieja es la que `desplegarFunciones.mjs` exige llevar; ver apartado d) |
| `price_series_cache.py` | 74 | Caché de series para optimización y backtest | `optimization/repository.py` | `test_price_series_cache` | VIVO |

### 3-BDB-ACTIVOS_app/functions_python — las 46 Functions declaradas

`desplegarFunciones.mjs` despliega 23; **las 23 restantes**, en `main.py`, con su veredicto. Evidencia: ninguna de las 23 está
en `FUNCIONES`; la columna «Llamada en la app» es `grep -rlw <nombre> src` (adaptadores).

| Function | Tipo | Líneas | Llamada en la app | Qué escribe o lee | Veredicto |
|---|---|---:|---|---|---|
| `get_system_status` | call | 3+deco | `systemStatusBackend.ts` (solo en `SystemStatusTab`, oculta) y `demoBackend.ts` | `meta/integrity_status`, `meta/*` | MUERTO |
| `admin_db_status` | call | 16 | `adminBackend.ts` (`AdminStatus`, oculta) | cuenta `assets` | MUERTO |
| `admin_list_assets` | call | 11 | `adminBackend.ts` (`AdminInspector`) | `assets` | MUERTO |
| `admin_asset_detail` | call | 9 | `adminBackend.ts` (`AdminInspector`) | `assets`, subcolecciones | MUERTO |
| `admin_fund_quality` | call | 7 | `fundQualityBackend.ts` (`AdminFundQuality`) | `assets` | MUERTO |
| `admin_backfill_candidates` | call | 4 | `adminBackend.ts` (`AdminBackfill`) | `assets` | MUERTO |
| `admin_backfill_history` | call, escribe | 11 | `adminBackend.ts` (`AdminBackfill`) | `assets/…/price_series` | MUERTO |
| `admin_ingest_asset` | call, escribe | 14 | `adminBackend.ts` (`AdminIngestPanel`) | alta en `assets` | MUERTO |
| `admin_refresh_all_stale` | call, escribe | 6 + 10 de ayudante | `adminBackend.ts` (`ManualRefreshPanel`) | precios en `assets` | MUERTO |
| `admin_refresh_prices` | call, escribe | 14 | `adminBackend.ts` | precios de un activo | MUERTO |
| `admin_recompute_metric` | call, escribe | 14 | `adminBackend.ts` | `metrics/latest` | MUERTO |
| `admin_reconcile_search_index` | call, escribe | 8 | ninguna | `meta/search_index` | MUERTO |
| `scheduled_refresh_prices` | programada | 15 | — | precios en `assets` | MUERTO |
| `scheduled_refresh_metrics` | programada | 2 + 48 del ayudante `_run_scheduled_metrics` | — | `metrics/latest` | MUERTO |
| `scheduled_refresh_metrics_0900` | programada | 2 | — | `metrics/latest` | MUERTO |
| `scheduled_refresh_metrics_0930` | programada | 2 | — | `metrics/latest` | MUERTO |
| `scheduled_refresh_metrics_1000` | programada | 2 | — | `metrics/latest` | MUERTO |
| `scheduled_integrity_check` | programada | 14 | — | `meta/integrity_status` | MUERTO |
| `scheduled_reconcile_search_index` | programada | 8 | — | `meta/search_index` | MUERTO |
| `scheduled_refresh_reviewed_navs` | programada | 6 | — | VL revisados en `assets` | MUERTO |
| `scheduled_publish_weekly_report` | programada | 9 | — | informe semanal (`weekly_report`, vivo, y el mismo que escribe `admin_publish_report`, desplegada) | DUDOSO |
| `scheduled_publish_daily_report` | programada | 9 | — | informe diario, igual | DUDOSO |
| `scheduled_recover_strategy_reports` | programada | 7 | — | reintenta informes pendientes (`report_publication`, vivo) | DUDOSO |

**Suma: 20 MUERTAS (en `main.py`, ≈ 275 líneas con sus decoradores y ayudantes: `_run_scheduled_metrics`,
`_refresh_max_reads`, `_run_admin_refresh_all_stale`) y 3 DUDOSAS (≈ 54 líneas).** Las tres DUDOSAS **no son de la vieja**: publican por el mismo `weekly_report` que la desplegada
`admin_publish_report`, así que trabajarían contra la base que declare `MASTER_PROJECT_ID`. No se despliegan porque piden
la clave de Gemini y las programaciones no están decididas (AGENTS.md, «Los datos no se refrescan solos»). Las 11
programadas de la lista (`scheduled_refresh_*`, `integrity`, `reconcile`, `reviewed_navs` y las tres de informes) salen
«ignored» en el emulador, sin Pub/Sub.

**Sobre el refresco automático** (que la auditoría anterior dejó como «DUDOSA, cierra la opción»): las `scheduled_refresh_*`
actualizan **documentos de la forma vieja** (`assets`, `metrics/latest`). En la base nueva no existen esas colecciones, así
que borrarlas no cierra la opción de refrescar de forma automática: esa opción, el día que se pida, se escribe de nuevo
sobre `instruments`/`computed` (hoy lo hace `4-base-nueva/refrescar.mjs`, a mano por decisión del 03-11).

### 3-BDB-ACTIVOS_app/functions_python — guiones y pruebas

| Ruta | Líneas | Qué hace | Quién la llama hoy | Pruebas | Veredicto |
|---|---:|---|---|---|---|
| `scripts/audit_cobertura_equivalencia.py` | 423 | Cobertura de datos de «Mejorar cartera» sobre la copia local `assets.ndjson.gz` | nadie (README de scripts) | `test_audit_cobertura_hedge` | MUERTO |
| `scripts/dryrun_mejorar_cartera.py` | 236 | «Mejorar cartera» sobre la copia local de la maestra | nadie | — | MUERTO |
| `scripts/dryrun_metrics_fondos.py` | 212 | Pasada en seco de métricas, sobre la copia local | nadie | — | MUERTO |
| `scripts/dryrun_metrics_refresh_backup.py` | 376 | Idem, contra un backup | nadie | — | MUERTO |
| `scripts/improve_fund_data.py` | 385 | Escribe mejoras de fondos en `assets` | nadie | `test_improve_fund_data_contracts`, `test_operational_scripts` | MUERTO |
| `scripts/migrate_metrics_latest.py` | 555 | Migra `metrics/latest` | nadie | `test_migrate_metrics_selection`, `test_migrate_fund_payload` | MUERTO |
| `scripts/migrate_ownership_v12.py` | 303 | Migración de propiedad de campos en `assets` (v1.2) | nadie | `test_ownership_v12` (parcial) | MUERTO |
| `scripts/migrate_provisional_roots.py` | 117 | Normaliza raíces provisionales EODHD | nadie | — | MUERTO |
| `scripts/run_metrics_refresh.py` | 107 | Ciclos del refresco de `metrics/latest` | nadie | — | MUERTO |
| `scripts/migrate_portfolios_uid.py` | 166 | Migra carteras de un UID antiguo a otro (julio 2026) | nadie | `test_migrate_portfolios_uid` | DUDOSO (una migración de una sola vez; sirve a las dos bases si el almacén tiene la misma ruta; ver apartado d) |
| `scripts/appcheck_report.py` | 267 | Informe de App Check desde los registros, con `PROYECTO_BASE_NUEVA` | `scripts/README.md` | `test_appcheck_observation` | VIVO |
| `scripts/medir_tope_simulacion.py` | 233 | Medición sobre `instruments` de la base nueva | `test_tope_simulacion` | idem | VIVO |

**Subtotal MUERTO de guiones: 2.714 líneas, 9 piezas.** Las pruebas que se van enteras con lo anterior son **32 ficheros y unas
6.850 líneas**: `test_admin_callable_errors`, `test_admin_drawdown_contract`, `test_admin_manual_refresh`,
`test_admin_read_budget`, `test_audit_cobertura_hedge`, `test_capitalgroup_refresh_plan`, `test_fund_resolution`,
`test_fund_return_basis`, `test_fx_currency_resolution`, `test_history_backfill`, `test_history_backfill_metrics`,
`test_improve_fund_data_contracts`, `test_ingest_asset`, `test_integrity_check`, `test_metrics_refresh`,
`test_metrics_window_coverage`, `test_migrate_fund_payload`, `test_migrate_metrics_selection`, `test_migrate_portfolios_uid`
(DUDOSA), `test_operational_scripts`, `test_price_refresh_fx`, `test_price_scheduler_gate`, `test_reviewed_nav_refresh`,
`test_reviewed_nav_sources`, `test_search_index`, `test_system_status`, `test_verified_kid_risk`, `test_verify_price_currency`,
`test_write_governance`, `test_ytd_return`, `test_analysis_read_deadlines` y `test_firestore_client_chunked`.

| Pruebas de Python | Ficheros | Líneas | Veredicto |
|---|---:|---:|---|
| Se van enteras (lista de arriba, sin la DUDOSA) | 31 | ≈ 6.680 | MUERTO |
| **Mixtas: se recortan, no se borran** (una parte prueba lo muerto): `test_a1_metricas_semanales`, `test_a2_hardening`, `test_appcheck_observation`, `test_asset_eligibility`, `test_auth_gates`, `test_clients_and_timeouts`, `test_clock`, `test_ecb_rates`, `test_entrada_robusta_servidor`, `test_env_example`, `test_ex_post_sharpe_parity`, `test_function_secrets`, `test_guardado_condicionado_emulador`, `test_lector_base_nueva`, `test_optimization_loading`, `test_ownership_v12`, `test_portfolios`, `test_price_history_sync`, `test_price_repair_releases`, `test_rendimiento_fondos_bloqueados`, `test_report_publication_force` | 21 | ≈ 6.400 (de las que ≈ 900 son de lo muerto) | DUDOSO (trabajo de recorte, pieza a pieza) |

### 3-BDB-ACTIVOS_app — la app: «Sistema» y sus adaptadores

**Por qué está muerto.** `AdminPage.tsx:78-79` deja visibles `sistema` y `retrocesiones` cuando `LEE_LA_NUBE` es `true`, y en
la vieja `LEE_LA_NUBE` era `false`; desde `c7f43db9` el desarrollo local lo pone a `true`. El resto de secciones
(`estado`, `calidad`, `historicos`, `inspeccion`, `ingesta`, `operaciones`, `referencia`) no sale en ningún sitio. Búsqueda
que lo demuestra: `grep -rln "AdminFundQuality\|AdminInspector\|AdminBackfill\|AdminOperaciones" src` → solo `AdminPage.tsx`
(y ellos entre sí); `grep -rln adminBackend src` → `AdminBackfill`, `AdminInspector`, `AdminPage`.

| Ruta | Líneas | Qué hace | Quién la llama hoy | Pruebas | Veredicto |
|---|---:|---|---|---|---|
| `src/pages/AdminPage.tsx`: el cuerpo de `AdminStatus` (723-875), `ManualRefreshPanel`, `AdminIngestPanel`, «Referencia técnica» (`LEGACY_ADMIN_READONLY`), `SystemStatusTab`, `Card`, `Recuento`, `Bars`, `ReadOnlyAdminPanel` y el resto de ayudantes | ≈ 860 de 984 | Siete de las nueve pestañas de Sistema | solo `AdminPage()`, que las oculta | `adminIngestPanel`, `adminLoopsUnmount`, `adminPantallasLocales`, `mercadoYDatosRediseno` (parte) | MUERTO (quedan: la cabecera, `sistema`→`EstadoDelCatalogoPanel` y `retrocesiones`, unas 120 líneas) |
| `src/components/AdminFundQuality.tsx` | 183 | «Calidad de fondos» | `AdminPage` | `adminPantallasLocales` | MUERTO |
| `src/components/AdminInspector.tsx` | 509 | «Inspección» por activo | `AdminPage` | `adminPantallasLocales`, `focoBajoColumnaFija`, `cajasDesplazablesConTeclado` | MUERTO |
| `src/components/AdminBackfill.tsx` + `AdminProgress.tsx` | 344 + 71 | «Históricos» | `AdminPage` (`AdminProgress` también la usa solo `AdminBackfill` y `AdminPage`) | `adminLoopsUnmount`, `adminIngestPanel` | MUERTO |
| `src/components/AdminOperaciones.tsx` | 1.483 | «Operaciones»: servicio local del extractor | `AdminPage`, solo con `OPS_LOCAL_ENABLED` y `!LEE_LA_NUBE` | `adminOperaciones` (550) | MUERTO (con el matiz de apartado d: es la única pantalla del servicio del extractor) |
| `src/pages/SystemStatusPage.tsx` (`SystemStatusContent`) | 381 | Semáforo de integridad | `AdminPage` (`SystemStatusTab`) | `systemStatusPage`, `nivelesDeEncabezado` (parte), `modoCliente` (lista) | MUERTO |
| `src/adapters/adminBackend.ts` + `src/types/admin.ts` | 727 + 254 | 12 `httpsCallable` de `admin_*` y sus tipos | `AdminBackfill`, `AdminInspector`, `AdminPage` | `adminBackend` (429) y 5 más con `vi.mock` | MUERTO |
| `src/adapters/fundQualityBackend.ts` | 75 | `admin_fund_quality` | `AdminFundQuality` | `adminPantallasLocales` | MUERTO |
| `src/adapters/systemStatusBackend.ts` | 264 | `get_system_status` | `AdminPage`, `SystemStatusPage` | `systemStatusBackend` (134) | MUERTO |
| `src/adapters/opsLocalBackend.ts` + `src/core/opsLocal.ts` | 744 + 225 | Cliente del servicio local (`127.0.0.1:8766`) | `AdminOperaciones`; la clave `bdb.ops.last-task` la borra `AuthGate.tsx` | `opsLocalBackend` (289), `opsLocal` (100), `authGateSessionCleanup` (parte) | MUERTO |
| `src/config/runtimeConfig.ts` (`OPS_LOCAL_*`, 97-104) | ≈ 8 | URL, interruptor y token de Operaciones | `opsLocalBackend`, `AdminPage` | `runtimeConfig` (parte) | MUERTO |
| `src/adapters/demoBackend.ts`: `systemStatus`, `adminDbStatus` y sus tres entradas de `HANDLERS` | ≈ 115 | Respuestas de demostración de las dos pantallas | `callableBackend` en modo demo | — | DUDOSO (el modo demo es otro asunto; si cae `adminBackend` cae esto) |
| Pruebas de la app que se van enteras: `adminIngestPanel` 164, `adminLoopsUnmount` 222, `adminPantallasLocales` 243, `adminBackend` 429, `adminOperaciones` 550, `opsLocal` 100, `opsLocalBackend` 289, `systemStatusBackend` 134, `systemStatusPage` 189 | 2.320 (9 ficheros) | — | — | — | MUERTO |
| Pruebas **mixtas**: `mercadoYDatosRediseno` (los mocks y el bloque «Sistema · pestañas»), `nivelesDeEncabezado`, `modoCliente` (cuatro rutas de la lista), `cajasDesplazablesConTeclado` (entradas `inspector-result-json`, `ops-log__body`, 6 tablas), `focoBajoColumnaFija`, `authGateSessionCleanup`, `runtimeConfig`, `desplegarFunciones`, `baseNuevaCaminoDeProduccion` | 9 ficheros | — | — | — | DUDOSO (recorte) |
| Reglas de CSS de esas pantallas en `src/styles/modules.css`: 31 selectores `.ops-*` y unos 60 más `.admin-*`, `.inspector-*`, `.backfill-*` (los de retrocesiones y catálogo son vivos) | ≈ 90 reglas | — | — | `clasesSinReglaPermitidas` las detectará al borrar | MUERTO |
| `src/pages/AdminPage.tsx` + `EstadoDelCatalogoPanel.tsx` + `AdminRetrocessions.tsx` (1.095) | — | Lo que queda de Sistema | rutas de la app | `adminRetrocessions`, `retrocesionesPaginadas`, … | VIVO |

### 3-BDB-ACTIVOS_app — guiones, reglas y configuración

| Ruta | Líneas | Qué hace | Quién la llama hoy | Pruebas | Veredicto |
|---|---:|---|---|---|---|
| `scripts/delete_asset.py` | 181 | Borra un activo de `assets` | nadie (README de scripts) | `test_operational_scripts` | MUERTO |
| `scripts/ingest_dow_msci_world_top100.py` | 293 | Ingesta de un universo en `assets` | nadie | — | MUERTO |
| `scripts/ingest_requested_equity_universes.py` | 262 | Ídem | nadie | — | MUERTO |
| `scripts/load_missing_price_series.py` | 572 | Series que faltan en `assets` | nadie | `test_operational_scripts` | MUERTO |
| `scripts/reload_from_eodhd.py` | 209 | Recarga EODHD en `assets` | nadie | `test_operational_scripts` | MUERTO |
| `scripts/extend_history_to_15y.py` | 186 | Alarga series de `assets` | nadie | — | MUERTO |
| `scripts/repair_price_series.py` | 200 | Reparación de series | nadie | — | MUERTO |
| `scripts/verify_price_currency.py` | 659 | Verifica divisa de series de `assets` | nadie | `test_verify_price_currency` | MUERTO |
| `scripts/plan_capitalgroup_refresh.py` | 64 | Plan de refresco de VL | nadie | `test_capitalgroup_refresh_plan` | MUERTO |
| `scripts/plan_price_history_repair.py` | 102 | Plan de reparación de series | nadie | — | MUERTO |
| `scripts/set_admin.py` | 70 | Pone el claim `admin` en Auth | citado en `useIsAdmin.ts` y en `desplegarFunciones` | `barreraDeBdb` (marca), `test_operational_scripts` | DUDOSO (importa `write_governance`, que se va; la vía viva es `npm run nube:administrador`; ver apartado d) |
| `firestore.rules` (250) + `firestore.indexes.json` (29) | 279 | Reglas de la vieja; «las de la web son las de `4-base-nueva`» | `firebase.json` (puerta cerrada), `tests/firestoreCommercialRetroRules.test.ts` | idem | DUDOSO |
| `scripts/smokeCommercialRetroRules.mjs` + `testCommercialRetroEmulators.mjs` + `tests/commercialRetroEmulator.test.ts` | 349 + 12 | Humo de las reglas de retrocesiones sobre un proyecto `demo-` | CI `firestore-rules` (`.github/workflows/ci.yml:24`) | `firestoreCommercialRetroRules` | DUDOSO (prueba **estas** reglas, no las de producción) |
| `scripts/smokeFirestoreRulesNoAuth.mjs` | 54 | Sonda de que `assets/` niega sin sesión | `npm run smoke:firestore-rules` | — | DUDOSO (mira `assets/`, que la base nueva no tiene) |
| `iniciar-operaciones.bat` | 30 | Arranca el servicio de Operaciones | nadie | — | MUERTO |
| `iniciar-dev.bat` (el bloque del token de Operaciones, líneas 14-22) | ≈ 9 | Pide el token del servicio al extractor | cada arranque | — | MUERTO (recorte) |
| `firebase.json`: `emulators.firestore.port 8082`; `.firebaserc` (`default: gestor-activos-local`); `firebaseEnv.ts:67` (default `127.0.0.1:8082`); `.env.example` (bloque «Clon», 8082 y `gestor-activos-local`) | — | Valores por defecto de la vieja | CLI de Firebase, `firebase.ts` | `desplegarFunciones.test.ts`, `firebaseHostingSecurity.test.ts` | DUDOSO (ver «el defecto seguro», apartado d) |
| `src/adapters/baseNuevaLectura.ts`: camino REST con `Bearer owner` (líneas 82-349, ≈ 200) | ≈ 200 | Lectura contra el 8092 cuando la app está configurada contra otro proyecto o sin emuladores | `USAR_SDK === false` en desarrollo | `baseNuevaCaminoDeProduccion`, `baseNueva*` | DUDOSO (es también la barrera «sin emuladores no hay SDK»; ver apartado d) |
| `functions_python/contracts_cache/` (21 JSON) + `scripts/syncContractsCache.mjs` (118) + `check:contracts` (CI) + `functions_python/contract_validation.py` | 118 + 39 | Copia de los contratos `master`/`read` para validar escrituras de la vieja | `firebase.json` `predeploy`, CI | `syncContractsCache` | DUDOSO (solo lo usan los escritores muertos; cae con los contratos de `master`; ver plataforma) |
| `scripts/capturaMaquetas.mjs`, `anchosDeCaptura`, `capturaInterfaz`… (los de diseño y humo) | — | Capturas y humo de la interfaz | habilidades `diseno-pantalla`, CI | — | VIVO |
| `scripts/seedEmulatorUser.mjs` (81) | 81 | Siembra el usuario local en el proyecto `bdb-gestor-de-activos` | `npm run seed:emulator-user`, habilidad `arrancar-entorno` | — | VIVO (ya no es de la vieja) |

### 2-plataforma-datos

La plataforma ya no tiene `scripts/` de la era BDB (se borraron el 17-11, A-160) ni la migración de carteras (borrada el 20-11).
Lo que queda de la vieja es **el camino de escritura heredado** y sus guiones de mantenimiento. Evidencia: grafo de imports
(lo vivo son las 13 entradas `baseNueva:*`, `audit:*`, `nube:*`, `planes:*`, `carteras:write`, `dryrun:base-nueva`; el
cálculo no encuentra ningún camino hasta los 27 ficheros de `src/` de abajo) y `grep` de cada orden `npm`.

| Ruta | Líneas | Qué hace | Quién la llama hoy | Pruebas | Veredicto |
|---|---:|---|---|---|---|
| `src/loader/republish.ts` | 1.278 | Republica activos existentes de `assets` | `republish:fondosdb` (`ops_plataforma.py`) | `republishTransactional` (1.011), `republishEmptiedGuard`, `republishStockPopulation`, `metricsOwnership`, `ownershipContract`, `driftCriteria`, `loaderStockWithoutRow` | MUERTO |
| `src/loader/cli.ts` + `writer.ts` + `planner.ts` + `packageReader.ts` + `types.ts` + `ingestionRun.ts` | 178 + 457 + 270 + 442 + 120 + 24 | `load:fondosdb`: carga de canónicos a `assets` | `load:fondosdb` (`ops_plataforma.py`) | `loaderPlanDocuments`, `loaderPackageReaderManifest`, `loaderSearchIndexAndChunkedHoldings`, `ingestionRun` | MUERTO |
| `src/loader/auditConsistency.ts` | 269 | Auditoría de `assets` | `audit:consistency` | `auditConsistencyStock` | MUERTO |
| `src/loader/reclassifyStock.ts` | 538 | Reclasifica fondo→acción en `assets` | `reclassify:stock` | `reclassifyStock` | MUERTO |
| `src/loader/archiveAssets.ts` | 377 | Archiva activos de `assets` | `archive:assets` | `archiveAssets` | MUERTO |
| `src/loader/holdingsRepublish.ts` + `holdingsProvenance.ts` | 542 + 76 | Carteras de fondos en `assets` | `republish`, `writer` | `holdingsProvenance`, `republishTransactional` | MUERTO |
| `src/loader/metricsLatest.ts` + `ownership.ts` + `driftCriteria.ts` + `searchIndex.ts` + `searchIndexWrite.ts` | 178 + 82 + 78 + 168 + 113 | `metrics/latest`, propiedad de campos, deriva, `meta/search_index` | el camino de arriba | `metricsLatestMethodDeclaration`, `fondosDbMapperRegulatory`, `searchIndexWrite*` | MUERTO |
| `src/ingestion/fondosdb/` (3 ficheros) + `fondosdbStockAssets.ts` + `firestorePathContract.ts` | 611 + 346 + 241 + 444 + 45 | Mapea el canónico al esquema de `assets` | el camino de arriba | `fondosDbMapper`, `fondosdbStockAssets`, `fondosDbDryRun` | MUERTO |
| `src/mappers/fondosHoldingsMapper.ts` + `src/schemas/fondosHoldingsSchema.ts` + `src/types/assets.ts` + `src/utils/utcDates.ts` + `src/holdings/holdingsStorage.ts` | 173 + 113 + 45 + 16 + 15 | Mapeo, esquema y tipos de `assets` | el camino de arriba | `fondosHoldingsMapper`, `fondosHoldingsSchema`, `assetSchema`, `utcDates`, `fundHoldingsIdentity` | MUERTO |
| `scripts/runBackupExport.ts` + `maintainLocalBackups.ts` + `backup_export_daily.bat` | 428 + 106 + 8 | Copia diaria de `assets/`+`meta/` del 8082 y su retención | `backup:export` (`ops_plataforma.py`), `backup:retention`, tarea programada de Windows | `backupPagination`, `backupRetention` | MUERTO |
| `scripts/reconcileSearchIndexLive.ts`, `restoreSriKidEvidence.ts`, `runCompactPriceSeries.ts` | 138 + 203 + 170 | Reparaciones sobre `assets` (`search-index:reconcile`, `repair:sri-evidence`, `compact:price-series`) | solo su `npm run` | `searchIndexReconcileRegression`, `searchIndexWriteGate`, `restoreSriKidEvidence` | MUERTO |
| `tests/helpers/fakeMasterDb.ts`, `fakeSearchIndexRef.ts`, `stockPackage.ts`, `strictFirestoreValue.ts` | 280 | Dobles de Firestore de la vieja | solo las pruebas de arriba | — | MUERTO |
| `scripts/restoreBackupToEmulator.ts` (`backup:restore-drill`) | 240 | Restaura una copia de la maestra en el 8082 | habilidad `arrancar-entorno` §5, README raíz, `4-base-nueva/README.md` | `resolveLatestBackup`, `restoreNoSiembraEnLaBaseNueva` | DUDOSO (es la única forma de leer las 596 MB de copias; ver apartado d) |
| `scripts/runCarterasDryRun.ts` (`dryrun:carteras`) | 140 | Lee `bdb_activos/{uid}/portfolios` **de la vieja** y cuenta lo que mapearía | habilidad `pipeline-extractor` (paso previo a `carteras:write`) | — | DUDOSO (la migración de carteras ya está hecha; el paso lee de la vieja) |
| `contracts/master/` (19 JSON), `contracts/read/` (1) y `contracts/validators.ts` | 96 + 20 JSON | Contratos de `assets` y su validador | `loader/*` (muerto), `syncContractsCache.mjs`, `runBaseNuevaAudit.ts:203` (solo en un texto) | `priceSeriesV12Contract`, `rootContractCorrections` (147) | DUDOSO (cae con el `loader/`; `contracts/canonical` y `contracts/base-nueva` son VIVOS) |
| `src/config/projectAllowlist.ts`: `ALLOWED_PROJECT_ID(S)`, `isAllowedProjectId`, `HOST_EMULADOR_BASE_DE_SIEMPRE` | ≈ 35 | El id y el puerto de la vieja | los 6 consumidores de `ALLOWED_PROJECT_IDS` (`auditConsistency`, `reclassifyStock`, `republish`, `writer`, `runCompactPriceSeries`, `runCarterasDryRun`) y el guion de restauración | `projectAllowlist.test.ts` (se escribió con esta constante: falla si se juntan los dos ids) | DUDOSO (sin consumidores se quedan sin uso; la barrera de que el id real no entre se conserva) |
| `src/config/baseNueva/etiquetas.ts` | 305 | Etiquetas en español de los códigos del vocabulario | solo sus pruebas (`baseNuevaEtiquetas`, `baseNuevaRazonDeAusencia`) | idem | DUDOSO (no es de la vieja: lo dejó sin importador el borrado; ver el censo del 16-11) |
| `scripts/runBdbDeployedFunctionsStockSmoke.ts` | 151 | Sonda de lectura a cuatro Functions **desplegadas en el proyecto nuevo** | nadie con `npm`; `projectAllowlist.test.ts:77` lee su texto | `projectAllowlist` | VIVO (mira la base nueva, no la vieja) |
| `scripts/darAdministrador.ts`, `runBaseNueva*`, `runCarterasWrite`, `runPlanesWrite`, `subirALaNube`, `verReglasDesplegadas` | — | La plataforma de la base nueva | `refrescar.mjs`, habilidades | decenas de `baseNueva*.test.ts` | VIVO |
| `docs/` (149 ficheros: `BLOQUE_*`, `PROMPT_CODEX_*`, auditorías de la maestra) y `_legacy/` (2 ficheros, 105 líneas) | — | Registro | — | — | DUDOSO (registro, no código; su borrado baja la cuenta de `barreraDeBdb`, ver e) |

**Subtotal MUERTO: 70 ficheros y unas 14.100 líneas** (7.240 de `src/`, 1.050 de guiones y 5.800 de pruebas y dobles). **10
entradas de `package.json`**: `load:fondosdb`, `audit:consistency`, `republish:fondosdb`, `reclassify:stock`, `archive:assets`,
`compact:price-series`, `backup:export`, `backup:retention`, `repair:sri-evidence`, `search-index:reconcile`; y el script
`test:artifact-fixtures` nombra una prueba (`fondosDbDryRun`) que se va.

### 1-extractor

Lo que hace el extractor para la base nueva (canónicos, series, planes, `adaptador_bdb`, `exporta`) **no se toca**. Lo único
suyo que habla con la vieja es el servicio de Operaciones, en el tramo «Plataforma».

| Ruta | Líneas | Qué hace | Quién la llama hoy | Pruebas | Veredicto |
|---|---:|---|---|---|---|
| `core/ops_plataforma.py` | 801 | Lanza por subproceso `load:fondosdb`, `republish:fondosdb`, `audit:consistency`, `backup:export`, `archive:assets`, `reclassify:stock` y resume sus artefactos | `ops_server.py:85` (endpoints `/api/ops/plataforma/*`) | `test_ops_plataforma` (825) | MUERTO |
| `ops_server.py`: los métodos y rutas de «plataforma», «reclasificar» y «archivar» (224-372, 416-471 y sus rutas) | ≈ 270 de 691 | Endpoints de esas órdenes | `AdminOperaciones` (oculta) | `test_ops_plataforma` | MUERTO |
| `ops_server.py` (el resto: alta, extraer, canónico, correcciones, universo) y `core/ops.py` (662) | ≈ 420 + 662 | El servicio de Operaciones del extractor | `python main.py ops`; `core.ops.anade_a_universo` lo usa también `main.py:248` | `test_ops`, `test_ops_token`, `test_ops_origenes` (517) | DUDOSO (la única pantalla que lo llamaba es la sección «Operaciones», oculta; el CLI sigue) |
| `main.py`: subcomandos `ops` y `ops-token` | ≈ 40 | Arrancan el servicio y dan su token | `iniciar-operaciones.bat`, `iniciar-dev.bat` | `test_ops_token` | DUDOSO (con lo anterior) |
| `_legacy/sube_firestore.py` | 137 | Subida a Firestore, archivada (`raise SystemExit`) | nadie; declarado en `barreraDeBdb` | — | MUERTO (ya apartado; es de la era BDB) |
| `adaptador_bdb.py`, `exporta.py`, `pasada.py`, `serie_de_respaldo.py`, `export_series.py`… | — | La salida que consume la plataforma de la base nueva | `main.py`, plataforma | decenas | VIVO |
| `tools/anota_indice_kid.py`, `rellena_nombres_universo.py`, `simula_regeneracion_a1.py`, `backfill_asset_types.py` | 100+116+226+73 | Herramientas manuales (ya DUDOSAS el 16-11) | nadie | `test_backfill_asset_types` | DUDOSO (no son de la vieja; se dejan al censo anterior) |

### 4-base-nueva y raíz

No hay código de la vieja en `4-base-nueva`: los `.mjs` ya hablan solo de la nueva. Quedan **textos**.

| Ruta | Qué dice de la vieja | Veredicto |
|---|---|---|
| `4-base-nueva/README.md` (líneas 18, 33-34, 47, 128, 201), `puerta-despliegue.mjs:7`, `arrancar.mjs:73` | Comparan con el 8082, `backup:restore-drill` y el Auth «de siempre» | DUDOSO (texto: se reescribe al borrar) |
| `README.md` de la raíz (líneas 36-75, 116-206) | Describe `gestor-activos-local` como la base de datos del proyecto, los puertos 8082 y la copia de seguridad | DUDOSO (texto; la mitad está obsoleta desde el 21-11) |
| `.claude/skills/arrancar-entorno/SKILL.md` §5-§6 y `pipeline-extractor/SKILL.md` | Cómo levantar y repoblar la vieja; los pasos `load:fondosdb`/`republish`/`audit:consistency` | DUDOSO (texto; se actualizan con el borrado) |
| `consultas_backup_duckdb.py` | 133 líneas de consultas SQL sobre las copias de la maestra | DUDOSO (registro; lee las 596 MB de copias, sin Firebase) |
| `AGENTS.md` (apartado «Bases de datos: son dos…», «Cómo trabajar aquí»), `INDICE_DE_DECISIONES.md`, `DEFINICION_DEL_SISTEMA` | Citan la vieja como una de las dos bases | DUDOSO (texto) |

## (c) Lo que parece de la vieja y no lo es, o la vieja todavía sirve

- **`master_project.py` y su lista de proyectos permitidos** (decisión 106): admite los dos ids **a propósito**, para que un
  script de Python lanzado a mano contra `MASTER_PROJECT_ID=gestor-activos-local` falle al conectar (ese proyecto no existe
  en la nube) y no escriba en la base nueva real. No es código de la vieja: es el defecto seguro. No se toca.
- **`tests/barreraDeBdb.test.ts` y su lista**, y los ficheros de `docs/historico-bdb/`: nada de esto es de la vieja.
- **El camino REST de `baseNuevaLectura.ts`**: además de servir a una configuración contra otro proyecto, es la lectura
  «sin emuladores en desarrollo nunca el SDK» (leería la nube). No se borra sin pensarlo (apartado d).
- **`adjustment_problem`**, la cuarentena de series, se lee al optimizar con las dos bases.
- **Pruebas con dobles en memoria de la forma de la vieja que sirven a lo vivo**: `test_repository` (usa un lector falso con
  la forma de `assets`: `readmodel/repository.py` es compartido), `test_busqueda_de_activos`, `test_read_contract` y
  `test_mappers` (mappers compartidos con `instruments`). Aunque trabajen con documentos `assets/…`, prueban código vivo.
- **Estimador semanal de la vieja.** `ingest_asset.build_metrics_latest` y `_window_metrics` son hoy el único sitio de
  Python que calcula el estimador `GEOMETRIC_CAGR/WEEKLY` que declaran 1.090 de los 1.097 activos de la vieja
  (`INFORME_TERCER_ESTIMADOR_2026-11-03.md`); tres pruebas lo fijan (`test_ex_post_sharpe_parity`,
  `test_a1_metricas_semanales`, `test_metrics_window_coverage`). No lo usa ninguna Function desplegada.
- **Guiones de restauración y las 596 MB de copias.** `backup:restore-drill` es la única vía para leer en un Firestore las
  copias verificadas de la maestra (son el registro de la que se clonó); `consultas_backup_duckdb.py` las lee sin Firebase.
- **`seedEmulatorUser.mjs`** ya no es de la vieja (siembra en `bdb-gestor-de-activos`).
- **`runBdbDeployedFunctionsStockSmoke.ts`** apunta a las Functions de la base nueva.

## (d) Qué hay que decidir antes de borrar

Una recomendación por punto.

1. **Alcance: ¿se retira la vieja entera o solo lo que ya no se ve?** Recomiendo **entera, en tres tandas**: (1) las
   Functions muertas con sus módulos, la pantalla de Sistema y sus pruebas (lo que no tiene dependencias fuera de su lista);
   (2) la plataforma (`loader/`, guiones, pruebas y dobles); (3) los textos. Es la que cumple «lo MUERTO se borra con las
   suites en verde, no con esta lista», y deja el rastro en una etiqueta de Git (`referencia-base-vieja-2026-11-21`),
   como se hizo con `portfolio_real`.

2. **Las 20 Functions declaradas de la vieja (y las tres DUDOSAS de informes).** Recomiendo **borrar las 20 de `main.py`**
   (su sentido era la forma de la vieja y no se pueden desplegar contra la nueva; el refresco automático se vuelve a
   escribir sobre `instruments` el día que se pida). **Las tres de informes se quedan**: son la automatización que Óscar
   dejó apagada el 03-11 y funcionarían con la base nueva. Al borrarlas: recortar las listas fijas de nombres de
   `test_function_secrets` y `test_auth_gates`, quitar del `.env.example` los `*_WRITE_ENABLED` que ya nadie lee
   (`PRICES`, `METRICS`, `SEARCH_INDEX`, `INTEGRITY`, `METRICS_REFRESH_*`) y revisar el comentario de cabecera de
   `desplegarFunciones.mjs`, que explica por qué no entran. Ninguna de las 20 está en la nube (no se despliegan), así que no
   hay `firebase functions:delete` que lanzar; Óscar lo confirma con `firebase functions:list` si quiere comprobarlo.

3. **El `.env` de `functions_python` que dice `MASTER_PROJECT_ID=gestor-activos-local` a propósito.** Recomiendo
   **conservarlo y conservar el id en `master_project.py`** (decisión 106): sirve de defecto seguro (un script manual falla
   al conectar). Lo que se quita es su otro uso (las Functions locales contra el 8082). Si algún día se retira el id de la
   lista de permitidos, el `.env` tiene que cambiar a la vez y entonces un script manual quedaría apuntando a un proyecto
   real: por eso no lo recomiendo. Idem `.firebaserc` y `firebase.json emulators.firestore.port 8082`, que solo se
   cambian cuando el CLI deje de usarlos como valor por defecto.

4. **Los guiones de restauración y siembra del 8082 (`backup:restore-drill`).** Recomiendo **conservar**
   `restoreBackupToEmulator.ts` (240 líneas) con `resolveLatestBackup` y `restoreNoSiembraEnLaBaseNueva` y mover **su
   documentación** (README y habilidad §5) a `docs/historico-bdb/`-style con la línea «no se ejecuta» arriba: es la única
   forma de abrir las 596 MB de copias. Se borran `runBackupExport`, `maintainLocalBackups`, `backup_export_daily.bat` y la
   tarea programada, que ya no tienen nada que copiar. Si Óscar prefiere conservar solo las copias en disco y leerlas con
   `consultas_backup_duckdb.py`, se borra también el guion de restauración. `HOST_EMULADOR_BASE_DE_SIEMPRE` se queda
   mientras exista el guion.

5. **El servicio de Operaciones del extractor (`ops_server.py`, `core/ops.py`, `iniciar-operaciones.bat`, `AdminOperaciones`).**
   La parte «plataforma» (801+270+825 líneas) es MUERTA. El resto (alta, extraer, canónico, correcciones) era la única
   pantalla del extractor y hoy está oculta. Recomiendo **borrar la sección «Operaciones» de la app y la parte plataforma**,
   y **dejar el servicio y el CLI del extractor** (el CLI cubre lo mismo): se decide entonces si el servicio HTTP
   (`python main.py ops`) se queda sin consumidor o se retira (otra tanda, otro censo).

6. **Las reglas de la vieja (`firestore.rules`, `firestore.indexes.json`) y el humo del emulador de retrocesiones.** CI
   ejecuta `testCommercialRetroEmulators.mjs` contra **estas** reglas; las de producción son `4-base-nueva/firestore.rules`.
   Recomiendo **antes de borrar, repuntar el humo (y `firestoreCommercialRetroRules.test.ts`) a las reglas de `4-base-nueva`**,
   y entonces borrarlas (279 líneas) junto con `smokeFirestoreRulesNoAuth.mjs` (mira `assets/`). El bloque `firestore` de
   `firebase.json` se quita cuando se quiten las reglas.

7. **`contracts/master`, `contracts/read`, `validators.ts` y `functions_python/contracts_cache` (+ `syncContractsCache.mjs`,
   `check:contracts` en CI).** Solo los usan los escritores muertos, pero el despliegue de Functions «sincroniza los
   contratos antes» (`desplegarFunciones.mjs`). Recomiendo **borrarlos en la tanda 2, tras recortar esa parte de
   `desplegarFunciones.mjs` y de la CI**; `contracts/canonical` y `contracts/base-nueva` se quedan.

8. **`ingest_asset.build_metrics_latest` y sus tres pruebas del estimador semanal.** Si se borra `ingest_asset`, desaparece el
   único cálculo en Python de `GEOMETRIC_CAGR/WEEKLY` y sus paridades con la hoja de `sortino_parity.json`. Recomiendo
   **conservar solo esas dos funciones, movidas a un módulo de referencia con sus pruebas**, o **borrar y dejar escrito en
   `METODO_PROPIO_METRICAS_2026-11-01.md` §10 que el estimador está retirado con la vieja** (es lo que dice la regla de
   retirada): decide Óscar. Mi recomendación es lo segundo: la base nueva calcula con `EXTRACTOR_MONTHLY_V1`.

9. **`adjustment_problem` + `price_repair_release` + `verified_price_repair_releases.json`.** Siguen activos al optimizar y
   `desplegarFunciones.mjs` exige llevar la lista en el entorno. Recomiendo **dejarlos** y revisar aparte si la lista de
   ISIN sigue teniendo sentido en la nueva (decisión 58).

10. **`set_admin.py`, `migrate_portfolios_uid.py`, `demoBackend` y `baseNuevaLectura` (REST).** `set_admin.py` importa
    `write_governance`: o se reescribe sin él (la vía viva es `nube:administrador`) o se borra. Recomiendo **borrarlo**.
    `migrate_portfolios_uid.py` es de julio y ya hecha: **borrar**. El `demoBackend` pierde dos pantallas: **recortar**. El
    camino REST **se queda**: es la barrera «sin emuladores no hay SDK».

11. **Las dos DUDOSAS menores:** `etiquetas.ts` (305 líneas, solo sus pruebas) y `runCarterasDryRun.ts` (lee la vieja).
    Recomiendo **`runCarterasDryRun`: borrar** (la migración de carteras está hecha) y **`etiquetas.ts`: decidirlo en el
    censo del 16-11, no aquí**.

12. **Pruebas mixtas (21 de Python, 9 de TS).** Sin decisión de Óscar; el trabajo de recorte va con la tanda y las suites en
    verde.

## (e) Riesgos concretos del borrado

1. **`tests/barreraDeBdb.test.ts` falla al borrar sin tocarlo**: las listas declaradas dan «ya no existe, quítalo de la lista»
   para `scripts/runBackupExport.ts` y (si se borra) `restoreBackupToEmulator.ts` (`ID_DECLARADO`), y las marcas de
   `scripts/set_admin.py` y `scripts/smokeCommercialRetroRules.mjs` (`CLIENTE_DECLARADO`); y los clientes Python que
   declara (`functions_python/portfolios/store.py: firestore.client()`) si cambia. Editar esas líneas **a la vez**, no
   añadir nada a ciegas.
2. **`MINIMO_VISTO`** (línea 83): la plataforma ve 392 ficheros y el mínimo es 250. Borrar 70 ficheros de código y pruebas deja
   ≈ 320; si además se borra `docs/` (149), la prueba fallaría («un barrido que no ve nada no protege»). O se deja `docs/`,
   o se baja el mínimo con la medición escrita.
3. **`2-plataforma-datos/tests/projectAllowlist.test.ts`** lee el texto de `runBdbDeployedFunctionsStockSmoke.ts` (no se
   borra) y protege que `ALLOWED_PROJECT_IDS` no incluya el id real: se queda mientras exista el conjunto.
4. **`package.json` de la plataforma**: quitar las 10 entradas y recortar `test:artifact-fixtures`; `tsconfig.json`/`tsconfig.tests.json`
   incluyen carpetas enteras (revisar).
5. **La cadena del extractor.** `1-extractor/core/ops_plataforma.py:SCRIPTS` enumera seis órdenes `npm run` de las que van a
   desaparecer: se borra el módulo antes que las órdenes, no al revés.
6. **`desplegarFunciones.test.ts`** (4 apariciones de `gestor-activos-local`) y **`baseNuevaCaminoDeProduccion.test.ts`** (3) prueban
   el comportamiento con la vieja como caso: no se borran, se actualizan.
7. **Documentos que quedan citando lo borrado**: `README.md` raíz, `4-base-nueva/README.md`, `2-plataforma-datos/README.md` y
   `scripts/README.md`, `3-BDB-ACTIVOS_app/README.md` y `scripts/README.md`, `functions_python/README.md`, las dos habilidades
   (`arrancar-entorno` §5-6, `pipeline-extractor`) y `AGENTS.md`.
8. **El semáforo `meta/integrity_status` y `get_system_status`** salen de las Functions locales: no hay otro semáforo de
   integridad en la base nueva (el de `audit:base-nueva` es de plataforma). Recomiendo comprobar que la sección «Estado del
   catálogo» (`EstadoDelCatalogoPanel`, VIVA) cubre lo que Óscar mira.
