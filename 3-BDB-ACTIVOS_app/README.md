# BDB-ACTIVOS

Nueva app local para construir una experiencia limpia multi-activo consumidora de BBDD-ACTIVOS.

## Objetivo

BDB-ACTIVOS es la aplicacion de trabajo sobre fondos, ETF, acciones, indices, carteras multi-activo e informes. No es una app solo de fondos. Conserva modos locales/preview y tambien tiene conexion live opcional via Firebase Auth + Cloud Functions.

**Dispositivos: escritorio y tablet. No es una aplicacion para movil.** El ancho minimo es 768 px (`--app-min-width` en `src/styles/tokens.css`) y no hay ni habra version para telefono: en un movil se ve con el ancho de tablet y desplazamiento lateral, por diseño. No es un defecto y las auditorias no deben tratarlo como tal. Decision de Oscar del 25-09-2026, confirmada el 14-10-2026; detalle en `GUIA_DE_DISENO_OAA.md`.

## Estado del código (2026-09-05)

- Consume la maestra BBDD-ACTIVOS-FINANCIEROS mediante read-models y callables autenticadas. El inventario actual se consulta en Sistema; esta revisión local no certifica el estado del despliegue.
- Las lecturas live de `price_series`, `backtest_portfolio`, `analyze_portfolio`, `weekly_report`, `dividends_calendar`, `economic_calendar` y `macro_reference` tienen guards de contrato en runtime y devuelven `AppError BACKEND` con detalle cuando la forma no cuadra.
- Los PDFs de Portfolio Report, X-Ray, Comparador y Mi Boutique usan plantillas vectoriales corporativas con `@react-pdf/renderer`. El verbo UI es `Descargar PDF`.
- La app no es el writer principal de plataforma. Las escrituras app-owned son carteras/reportes propios; las escrituras sobre maestra quedan protegidas por gates backend.
- Los schemas de plataforma se copian a `functions_python/contracts_cache/` con `npm run sync:contracts` antes de desplegar functions.

## Uso local sin deploy

```text
npm install
npm run dev
```

Para probar una build local de produccion:

```text
npm run build
npm run preview
```

Flujo recomendado para usuario interno:

1. Buscar un activo y revisar su ficha.
2. Comparar dos o mas activos.
3. Crear una cartera manual o importarla desde texto.
4. Guardar la cartera local en el navegador.
5. Abrir reporting y revisar X-Ray, diagnostico y previews.
6. Descargar el PDF del informe.

Limites del modo local/preview: las metricas locales siguen siendo `PREVIEW_ONLY`; no hay suitability real ni recomendacion personalizada. Si existe configuracion Firebase local, la app puede usar API live via Cloud Functions y la persistencia de carteras puede escribir datos app-owned en Firestore detras de Functions.

Fricciones conocidas: la limpieza de busqueda puede mejorarse con un boton dedicado.

## Frontera local/live

Fuentes visibles en la app:

- `LOCAL_MOCK`: datos mock internos, sin conexion real.
- `BBDD_STATIC_EXPORT_SAMPLE`: muestra estatica versionada, sin conexion real.
- `BBDD_LIVE_API`: API real via Cloud Functions, requiere Firebase/Auth configurados.

**Sistema › Operaciones** (05-09-2026): el proceso completo del extractor y de la plataforma de datos (alta, extracción, canónico, corrección de campos, copia, pasada en seco, escritura y comprobación) desde la app, contra el servicio local `python main.py ops` de `1-extractor` (`iniciar-operaciones.bat`). Detalle en `docs/OPERACIONES_LOCALES.md`.

En desarrollo, la fuente por defecto es `BBDD_STATIC_EXPORT_SAMPLE`; `VITE_BDB_DEFAULT_SOURCE` permite elegir otra. En producción, `runtimeConfig.ts` exige Firebase y `BBDD_LIVE_API`. El cálculo histórico se habilita con `VITE_BDB_ENABLE_REAL_FRONTIER=true`; el modo demo sin credenciales dispone de respuestas locales. Las estimaciones siguen identificadas como tales aunque los activos procedan de LIVE.

## Contrato BBDD/API y payload publico

`AssetForBdb` es el contrato de lectura que BDB-ACTIVOS consume desde BBDD-ACTIVOS-FINANCIEROS. La app normaliza `LOCAL_MOCK`, `BBDD_STATIC_EXPORT_SAMPLE` y `BBDD_LIVE_API` hacia los mismos tipos internos sin mezclar datos maestros con persistencia de carteras.

Las callables live no confian en casts ciegos: cada adaptador valida campos y tipos minimos en la frontera. Si el backend responde con una forma inesperada, la UI recibe un `AppError BACKEND` trazable.

Payload publico permitido:

- identidad basica, vehiculo, clase economica, divisa, proveedor, cobertura, flags de calidad no sensibles y warnings;
- metricas agregadas publicas (`annualized_return_1y/3y/5y/10y`, `volatility_1y/3y`, Sharpe, drawdown, risk score);
- `performance_preview`, `available_sections`, resumen de calidad y exposicion PMS resumida;
- series rebasadas/agregadas para comparacion cuando llegan por API, nunca series crudas en carteras.

Interno/controlado:

- `official_metrics_envelope` puede existir en detalle/export controlado, pero no entra en cards, search, report publico, optimizacion preview ni carteras;
- `suitability_allowed`, `optimization_allowed` y `recommendation_allowed` se mantienen siempre `false` en el envelope de muestra y no habilitan suitability/recomendacion real;
- Firestore, credenciales, inputs de suitability/recomendacion y snapshots completos de activo no son payload publico.

App-owned persistido:

- carteras guardan solo `portfolio_id`, nombre/fechas, `sourceKind`, `positions.asset_id`, pesos, etiquetas y metadatos minimos;
- nunca se persiste la ficha completa del activo, metricas oficiales, holdings, exposicion ni datos maestros.

## Arquitectura inicial

```text
BDB-ACTIVOS app -> adapter local -> BBDD-ACTIVOS contracts
```

En este bloque el adapter es mock/read-only y no consulta ninguna base real.

## 47B - Adapter local multi-activo

El adapter local queda endurecido como frontera de consumo inicial:

- `searchAssets()` busca FUND, ETF, STOCK e INDEX sin excluir acciones o ETF por defecto.
- `getAssetDetail()` resuelve cualquier tipo instrumental mock.
- `getComparableAssets()` admite comparaciones multi-activo.
- `getPortfolioInputs()` trabaja con posiciones app-owned multi-activo.
- `buildOptimizationInput()` prepara inputs mock para optimizacion futura sin filtrar ETF ni STOCK.
- Los INDEX pueden usarse como benchmark/reference y se marcan como no invertibles.
- `instrument_type` y `economic_asset_class` se mantienen separados.

## 47C - Buscador universal local

La pantalla principal incorpora un buscador universal multi-activo conectado solo al adapter local:

- busqueda por texto sobre activos mock;
- filtros por Todos, FUND, ETF, STOCK e INDEX;
- cards con vehiculo, clase economica, divisa, coverage, flags y warnings;
- indices visibles como benchmark/no invertibles cuando aplica.

## 47D - Ficha de activo local

El buscador abre una ficha multi-activo usando `getAssetDetail()` del adapter local. La ficha muestra identidad, vehiculo, clase economica, coverage, metricas, costes opcionales, exposicion PMS mock, flags y warnings. STOCK no requiere costes y los INDEX se muestran como benchmark/no invertibles.

## 47E - Comparador multi-activo local

El buscador permite seleccionar entre 2 y 5 activos para compararlos con `getComparableAssets()` del adapter local. La tabla mantiene FUND, ETF, STOCK e INDEX en el mismo flujo, separa vehiculo de clase economica y muestra costes como opcionales para no excluir acciones ni indices.

## 47F - Carteras multi-activo locales

El buscador permite anadir FUND, ETF y STOCK invertibles a una cartera local con guardado app-owned en el navegador. La cartera trabaja con pesos manuales en porcentaje, valida suma 100, resume distribucion por vehiculo y clase economica, y prepara un preview de `buildOptimizationInput()` para optimizacion futura. Los INDEX no invertibles se tratan como benchmark/reference y no se anaden como posicion invertible.

## 47G - Reporting local basico

La cartera abre un reporting visual local/mock con resumen ejecutivo, composicion por vehiculo y clase economica, tabla de posiciones, metricas ponderadas mock y warnings de pesos/calidad. Puede descargar un PDF vectorial del informe y no necesita backend en modo local.

## 47H - Revision visual/UX local

El flujo queda mas claro para revisar el MVP local: buscar activos, ver ficha, comparar, anadir a cartera, guardar/cargar carteras locales y abrir reporting. La mesa de trabajo local agrupa comparador y cartera sin conexion real.

## 48A - Puente local con contratos BBDD-ACTIVOS

Se anade una capa local contract-shaped para ensayar el consumo de contratos BBDD-ACTIVOS sin conexion real, sin imports cross-repo y sin leer datos externos. Los fixtures locales cubren FUND, ETF, STOCK e INDEX y se mapean hacia los tipos internos BDB-ACTIVOS.

## 48B - Selector de fuente local

La app incorpora un selector de fuente de datos. Las fuentes validas hoy son `LOCAL_MOCK`, `BBDD_STATIC_EXPORT_SAMPLE` y `BBDD_LIVE_API` (`BBDD_CONTRACT_FIXTURE` dejo de ser seleccionable; ver `src/config/runtimeConfig.ts`). Buscador, ficha, comparador, cartera, input de optimizacion y reporting consumen una interfaz comun de fuente de datos.

## 48C - Export estatico BBDD local

Se incorpora `BBDD_STATIC_EXPORT_SAMPLE`, una muestra estatica controlada derivada read-only de:

```text
artifacts/screener-static-dataset-export-preview/screener-assets.mock.preview.json
```

El snapshot de referencia pertenece a BBDD-ACTIVOS y contiene 50 activos. BDB-ACTIVOS conserva solo una muestra pequena de 16 activos dentro de `src/data/bbddActivosStaticExportSample.ts`, con FUND, ETF, STOCK e INDEX. No hay imports runtime cross-repo, no se copia el dataset completo, no hay Firestore, no hay Firebase y no hay conexion real.

## 48F - Intake local seguro de muestra estatica

El flujo de intake parte de un JSON copiado/controlado y genera una muestra pequena en modo preview por defecto:

```text
npm run preview:static-export-sample
```

El script valida tamano maximo, estructura minima, cobertura FUND/ETF/STOCK/INDEX y mantiene INDEX como benchmark/no invertible para el adapter. Los snapshots copiados deben quedar en `intake/static-export-sample/`, donde Git ignora cualquier archivo salvo la muestra minima de ejemplo y las instrucciones. Solo se escribe un archivo generado si se usa un flag explicito `--write`.

## 50B - Flujo generated diff promote

La app consume solo la muestra estable versionada:

```text
src/data/bbddActivosStaticExportSample.ts
```

El intake seguro genera primero un artefacto paralelo ignorado por Git:

```text
npm run write:static-export-sample -- --input intake/static-export-sample/<snapshot>.json
```

Ese comando escribe `src/data/bbddActivosStaticExportSample.generated.ts` y no toca la muestra consumida. Antes de promover, se revisa el cambio:

```text
npm run diff:static-export-sample
```

Solo si el diff se acepta, se promueve de forma explicita:

```text
npm run promote:static-export-sample
```

La promocion valida que el generado existe, permanece dentro del workspace, no supera limites de intake, mantiene FUND/ETF/STOCK/INDEX e INDEX conserva forma de benchmark. Despues se ejecutan build, lint y tests, y se commitea selectivamente la muestra estable y los cambios asociados. El archivo `.generated.ts` no debe versionarse.

## 51B - Intake de export oficial AssetForBdb

BBDD-ACTIVOS-FINANCIEROS produce el export oficial `Asset*ForBdb` como JSON
estatico revisable:

```text
artifacts/bdb-assets-static-export-preview/bdb-assets-for-bdb.preview.json
```

BDB-ACTIVOS lo consume solo mediante copia controlada a
`intake/static-export-sample/`; no hay imports runtime entre repositorios, no
hay conexion real y no se versiona el snapshot completo. El intake acepta
`schema_version: "asset-for-bdb.v1"`, valida el manifest, conserva
FUND/ETF/STOCK/INDEX, mantiene los INDEX como benchmark no invertible y permite
STOCK sin TER/costes. La muestra estable solo cambia si se ejecuta el flujo
explicito `write -> diff -> promote` y se acepta el diff.

## Reglas de seguridad local

- No commitear `.env`, `.env.local`, credenciales, tokens ni service accounts.
- No hacer deploy, push, commits ni Firestore writes sin autorizacion explicita.
- `.firebaserc` apunta a `gestor-activos-local`, que solo existe en el emulador.
- `firebase.json` tiene una barrera `predeploy`, `scripts/requireFirebaseDeployApproval.mjs`: desde esta carpeta no se despliega a ningún proyecto. El sitio, las reglas y los índices se despliegan desde `4-base-nueva`.
- Las escrituras principales de plataforma se hacen desde `2-plataforma-datos` con `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES`.
- Las escrituras backend de esta app sobre maestra requieren ademas `BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES`; sin ella, los scheduled jobs quedan en no-op y el panel admin solo permite preview/dry-run.
- El refresco programado de precios exige ademas `PRICES_WRITE_ENABLED=true`.
- El refresco programado de metricas exige ademas `METRICS_WRITE_ENABLED=true`. Escribe por lotes en `assets/{asset_id}/metrics/latest.max_drawdown_hist`, nunca en `root.risk.max_drawdown*`, y persiste watermark parcial en `meta/metrics_refresh`.
- `firestore.rules` y `firestore.indexes.json` quedan versionados en `firebase.json`. A partir de este punto las reglas deben cambiar por repo y deploy revisado, no a mano en consola.
- `artifacts/`, `output/`, generados y PDF quedan fuera de Git salvo autorizacion expresa.
- Sin leer BDB-FONDOS legacy.
- Sin copiar estructuras legacy.
- Sin carteras ni clientes reales; solo guardado local app-owned en navegador.
- Sin optimizacion fina, suitability real ni retrocesiones.

## App Check y reglas Firestore

App Check se activa desde la consola Firebase sobre la app web del proyecto. Flujo recomendado:

1. Crear/activar proveedor reCAPTCHA Enterprise o reCAPTCHA v3 en Firebase App Check.
2. Configurar `VITE_FIREBASE_APPCHECK_PROVIDER=enterprise` o `recaptcha-v3` y `VITE_FIREBASE_APPCHECK_SITE_KEY`.
3. Dejar las callables en modo MONITOR durante 24-48h y revisar falsos positivos.
4. Si no hay ruido, activar enforcement para Cloud Functions callable desde consola.

Kill-switch frontend:

```text
VITE_FIREBASE_APPCHECK_DISABLED=true
```

Con ese valor la app no inicializa App Check aunque exista site key. En desarrollo local autorizado se puede usar `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN`, sin versionar tokens reales.

Smoke de reglas sin autenticacion:

```text
npm run smoke:firestore-rules
```

El smoke usa la config web local y debe terminar con `SMOKE_OK: assets/ deniega lectura sin auth.`. Si permite lectura, las reglas estan mal para la BBDD maestra.

Antes de desplegar functions, el predeploy ejecuta:

```text
npm run sync:contracts
```

Ese script copia los schemas SSOT de `../2-plataforma-datos/contracts/master/*.schema.json` a `functions_python/contracts_cache/`, que es la cache usada por el panel admin para validar payloads.

## Refresco de historicos

Los precios se refrescan a DIARIO por job programado (`scheduled_refresh_prices`, martes-sabado 7:30 Madrid: recoge el cierre del dia anterior; domingo y lunes no hay cierre nuevo). La via manual del panel Admin queda para REPARACIONES (recarga de historico completo de un activo, recompute de su caida) y sigue el mismo modelo supervisado:

1. Revisar fechas reales: dato mas reciente, ultimo refresco y activos mas rezagados.
2. Previsualizar. Este paso es dry-run y no escribe.
3. Aplicar solo con decision explicita y `BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES` activo en el backend.

Tras una recarga manual de historico conviene ejecutar el recompute del activo: ademas de la caida, reconstruye su estado consolidado (`metrics/drawdown_state`). El panel informa de los activos rezagados sin descontar festivos; la decision queda en el admin. Las carteras app-owned siguen separadas de las escrituras sobre la BBDD maestra.

## Scripts, Jobs y Backup

Ver `scripts/README.md` para el inventario operativo. Resumen:

- Lectura/validacion local: `npm test`, `npm run build`, `npm run smoke:firestore-rules`, `npm run preview:static-export-sample`, `npm run validate:static-export-canary`.
- Contra el servidor de desarrollo local (`AUDIT_BASE`, por defecto `http://localhost:5174`), sin escribir Firestore: `npm run shots:ui` (capturas Playwright de las rutas principales en los seis anchos de trabajo, en `output/shots/`; `npm run shots:estrecha`, en los cuatro anchos estrechos), `node scripts/auditoriaFrontend.mjs <etiqueta> d,tp` (el recorrido de la interfaz: cada pantalla con su captura, sus medidas, la accesibilidad y el Modo cliente; sustituye a `npm run audit:ui`, retirado el 19-11-2026), `npm run smoke:informe` (flujo completo del informe) y `npm run smoke:pdf` (generacion del PDF). Salvo `smoke:pdf`, entran con el usuario local del emulador (`BDB_SHOTS_EMAIL` y `BDB_SHOTS_PASSWORD`).
- Escritura local de artefactos versionables o ignorados: `npm run sync:contracts`, `npm run write:static-export-sample`, `npm run promote:static-export-sample`.
- Escrituras live app-owned: un informe se publica con el boton de la pantalla de Estrategia (`admin_publish_report`).
- Operaciones live sensibles sobre maestra o Auth: scripts Python de reparacion/refresco historico, `delete_asset.py` y `set_admin.py`; dry-run primero y aprobacion explicita.
- Backup maestro: no hay comando en este repo; se ejecuta desde el repo de la plataforma (`cd ../2-plataforma-datos` y alli `npm run backup:export`) antes de escrituras relevantes.

Jobs desplegados (9 tareas, hora de Madrid). Los que escriben en la MAESTRA exigen `BDB_ACTIVOS_ENABLE_MASTER_WRITES` MAS su gate propio; los dos informes escriben solo en datos app-owned (`bdb_activos`):

- `scheduled_reconcile_search_index` (3:45 diario): indice de busqueda vs maestra. Gate propio `SEARCH_INDEX_WRITE_ENABLED`.
- `scheduled_refresh_prices` (7:30 martes-sabado): precios EODHD. Gate propio `PRICES_WRITE_ENABLED`.
- `scheduled_refresh_metrics` (8:30 diario) y `scheduled_refresh_metrics_0900`, `_0930`, `_1000`: una vuelta diaria de metrics/latest repartida en cuatro ejecuciones con el mismo tope (`METRICS_REFRESH_MAX_READS`), que siguen el cursor; las de calculo propio se recalculan enteras sobre la serie y el resto recibe la maxima caida con estado consolidado (`metrics/drawdown_state`). Gate propio `METRICS_WRITE_ENABLED`.
- `scheduled_integrity_check` (10:30 diario): semaforo de integridad + inventario admin (reconstruccion semanal o por censo/builder). Gate propio `INTEGRITY_WRITE_ENABLED`.
- `scheduled_publish_weekly_report` (7:15 lunes): informe semanal app-owned (sin gate maestro; no toca la maestra).
- `scheduled_publish_daily_report` (7:00 lunes-viernes): informe diario app-owned (sin gate maestro; no toca la maestra).

## Estructura

```text
src/adapters    acceso a callables y fuentes de datos (guards de contrato)
src/app         shell, rutas y navegacion
src/assets      fuentes y estaticos
src/auth        puerta de acceso, MFA y seguridad de cuenta
src/charts      sistema de graficos OAA
src/components  componentes de pagina y paneles
src/config      configuracion de runtime (flags VITE_*)
src/core        logica de dominio pura (la carpeta mas grande)
src/data        mocks y fixtures locales
src/pages       paginas
src/reports     PDFs (@react-pdf/renderer)
src/styles      estilos
src/types       tipos y contratos
```

## Trabajo pendiente

El trabajo vigente y su estado se reflejan en el historial de Git y en las
incidencias activas del repositorio.
- Ampliar la cobertura de activos y series con el proceso autorizado de ingesta.
- Revisar la conveniencia de ampliar el límite de 25 activos del optimizador; las exclusiones actuales se muestran con su peso original.
- Validar y desplegar los cambios locales solo tras autorización explícita. La conexión/API real ya está implementada.

Cambios de esta revisión y pruebas: [CORRECCIONES_REVISION_2026-09-05.md](docs/CORRECCIONES_REVISION_2026-09-05.md).
Para desplegar, `scripts/desplegarFunciones.mjs` y `4-base-nueva/README.md`. Las guías vigentes son este README, [OPERACIONES_LOCALES.md](docs/OPERACIONES_LOCALES.md) y [RETROCESIONES_IMPORTACION.md](docs/RETROCESIONES_IMPORTACION.md). Los prompts y planes fechados describen etapas históricas.
