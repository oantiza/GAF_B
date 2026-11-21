# Encargo para Gemini 3.1 Pro (Antigravity): construir el PANEL ADMIN de la BBDD

Trabajas en el repo `C:\Users\oanti\Documents\BDB-ACTIVOS` (React 19 + TypeScript + Vite +
Firebase; functions en Python 2ª gen, región `europe-west1`). Vas a construir, de principio a
fin, un **Panel de Administración de la base de datos** dentro de la app. Trabaja de forma
incremental y deja el build **siempre en verde**. NO toques IAM, secretos ni hagas deploy (de
eso se encarga el usuario). NO commitees desde bash/WSL (el mount trunca ficheros): usa los
ficheros directamente y deja que el usuario commitee en PowerShell.

## Contexto de arquitectura (IMPORTANTE, respétalo)

- **BBDD maestra**: proyecto Firestore `bbdd-activos-financieros`, colección `assets` (doc id =
  ISIN o `EODHD_<symbol>`), con subcolección `price_series` (docs por año
  `EODHD_<symbol>_YEAR_<año>` y `..._REFRESH_<año>`; cada doc tiene `points:[{date,value,...}]`,
  `first_date`, `last_date`, `source_listing_id="EODHD:<symbol>"`, `source_currency`, etc.).
  Cada asset tiene además `risk` (incluye `max_drawdown` 5a + `max_drawdown_hist {pct,fecha}`),
  `performance`, `classification`, `identifiers`, `costs`.
- **Backend** (`functions_python/`): callables `@https_fn.on_call()` en `main.py`, todas con
  `_require_auth(req)` (devuelve uid). Leen la maestra CROSS-PROJECT en SOLO LECTURA vía
  `readmodel/firestore_client.py` (`gcf.Client(project=MASTER_PROJECT_ID)`), mapean con
  `readmodel/mappers.py` a contratos `asset-for-bdb.v1`. El SA de las functions tiene
  `datastore.viewer` sobre la maestra; para ESCRIBIR (rellenos del panel) hará falta
  `datastore.user` — **eso lo concede el usuario**; tú solo escribe el código que lo usaría.
- **Frontend**: kit de gráficos SVG PROPIO en `src/charts/` (`RiskReturnMap`, `GroupedBars`,
  `Donut`, `StyleBox`, `CorrelationHeatmap`) — **NO uses Chart.js/Recharts ni librerías de
  gráficos**. Estética oscura navy/teal/gold (usa las variables CSS existentes). Tipos en
  `src/types/`, adaptadores en `src/adapters/`, páginas en `src/pages/`, componentes en
  `src/components/`.
- **Scripts ya existentes** cuya lógica debes REUTILIZAR/portar (no reinventar): `scripts/
  probe_eodhd_coverage.py` (resolución de símbolo + cobertura EODHD), `scripts/reload_from_eodhd.py`
  (recarga/reemplazo desde EODHD con backup), `scripts/backfill_max_drawdown.py` y
  `functions_python/metrics_refresh.py` (cálculo de caída 5a + histórica), `functions_python/
  price_refresh.py` (refresco incremental). Comparten el patrón EODHD HTTP + conversión a EUR.

## Objetivo: Panel Admin (3 bloques)

### 1) Estado / salud (dashboard de solo lectura)
- Resumen: nº de activos por tipo (FUND/ETF/STOCK), cuántos con histórico, cuántos sin.
- Cobertura histórica: primera/última fecha y nº de años por activo; cuántos llegan a 2011 y
  cuántos no (histograma por año de inicio con `GroupedBars`/`Donut`).
- Frescura: cuántos desactualizados (último punto > X días); fecha del último refresco
  (lee `meta/price_refresh.last_run_date`).
- Métricas: cuántos tienen vol/sharpe/srri/max_drawdown/max_drawdown_hist; cuáles faltan.
- Anomalías: huecos largos en la serie, puntos duplicados, valores <= 0, divisa rara, y
  "caída cuyo valle es la fecha más reciente" (posible dato sospechoso, como pasó con SAP).

### 2) Inspección por activo
- Buscador/tabla filtrable (tipo, con/sin histórico, con anomalías). Columnas: tipo, símbolo,
  primera/última fecha, nº puntos, años, métricas presentes, flags de anomalía.
- Ficha por activo: metadatos + rangos y huecos de su `price_series` + métricas (incl.
  `max_drawdown` 5a y `max_drawdown_hist` con su fecha).

### 3) Rellenos manuales (TARGETED, donde el admin decida)
- Acciones por activo concreto, vía callables de ESCRITURA con **modo dry-run/preview** antes de
  aplicar: (a) recargar/extender histórico desde EODHD (reutiliza `reload_from_eodhd`), (b)
  recalcular la caída (reutiliza `metrics_refresh`), (c) forzar refresco incremental de precios
  (reutiliza `price_refresh`).
- Las operaciones MASIVAS (recargar todo) se quedan como scripts; el panel NO las expone.
- Toda escritura debe hacer backup (igual que los scripts) y devolver un resumen claro.

## Backend a crear (`functions_python/`)
- Módulo `admin_panel.py` con la lógica (reutilizando los módulos existentes). Callables nuevas
  en `main.py`, TODAS gated por admin:
  - Lectura: `admin_db_status`, `admin_list_assets`, `admin_asset_detail`.
  - Escritura (nombres REALES desplegados, corregido 2026-07-28: las callables
    `admin_reload_asset` y `admin_refresh_asset_prices` que citaba este prompt
    nunca existieron): `admin_refresh_prices`, `admin_recompute_metric`,
    `admin_ingest_asset`, `admin_refresh_all_stale`, `admin_backfill_history`,
    `admin_reconcile_search_index` (cada una con `dry_run`/preview por defecto).
- **Gate de admin**: añade un helper `_require_admin(req)` que verifique un custom claim
  (`req.auth.token.get("admin") is True`) o una allowlist de uid configurable por env
  (`ADMIN_UIDS`). Enfórzalo en TODAS las callables admin (no solo en el front). Documenta en un
  comentario que el usuario debe fijar el claim/allowlist y dar `datastore.user` al SA.
  *(Nota S-08, auditoría 29-09: la allowlist `ADMIN_UIDS` se retiró; solo vale el claim.)*

## Frontend a crear (`src/`)
- Ruta/módulo nuevo "Admin" en el shell de navegación, **oculto salvo para admins** (guard que
  consulta el claim de Firebase Auth; si no es admin, no se muestra ni la entrada de menú ni la
  página).
- Página `AdminPage` con los 3 bloques (estado/salud, tabla+ficha, formularios de relleno).
- Tipos en `src/types/` + adaptador en `src/adapters/` que llamen a las callables nuevas.
- Reutiliza el kit `src/charts/` para las visualizaciones y respeta la estética.

## Restricciones y verificación
- `npm run build` (= `tsc -b && vite build`) y `npm run lint` deben quedar en VERDE. Verifica
  tras cada bloque.
- No rompas módulos existentes ni cambies contratos ya usados; solo añade.
- Sin librerías de gráficos nuevas. Sin localStorage para datos críticos.
- Escrituras siempre dry-run por defecto + backup + resumen.
- Al final entrega: lista de ficheros añadidos/cambiados, capturas o descripción de cada vista,
  y una nota de despliegue (qué debe hacer el usuario: claim admin, `datastore.user` sobre la
  maestra, `firebase deploy --only functions`, `npm run build`).

Empieza por el backend de LECTURA + la vista de estado/salud (entrega ese vertical funcionando y
en verde), luego inspección por activo, y por último los rellenos con dry-run. Avanza en pasos
pequeños y deja el build compilando en cada paso.
