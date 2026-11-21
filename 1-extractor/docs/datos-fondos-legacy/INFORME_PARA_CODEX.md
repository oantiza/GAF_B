# Informe para Codex — Capa de datos FondosDB y contexto de traspaso

**Fecha:** 2026-06-18
**Autor:** sesión Cowork (lado FondosDB / datos)
**Para:** Codex, trabajando en `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`

Resumen: este documento recoge el estado real de la **capa de datos** (FondosDB) de la que depende BBDD-ACTIVOS-FINANCIEROS, sus rutas exactas, el estado de la migración y los avisos de entorno, para que Codex lo tenga en cuenta. Lo verificado en disco va marcado; lo que proviene de la revisión de Oscar va indicado como tal.

---

## 1. Mapa de proyectos y flujo

- **FondosDB** (motor de datos, Python): `C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb`
  Extrae fundamentales de fondos/ETFs y genera la base de datos + los exports.
- **BBDD-ACTIVOS-FINANCIEROS** (proyecto de Codex, TypeScript): `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`
  Consume los exports de FondosDB; contiene el Screener.
- **Screener-Buscador-MVP** (consumidor final): `C:\Users\oanti\Documents\Screener-Buscador-MVP`
  Recibe el dataset estático del Screener.
- **BDB-FONDOS** (Firebase, proyecto `bdb-fondos`): proveedor de históricos de VL (colección Firestore `historico_vl_v2`).

Flujo de datos: **FondosDB → exports → BBDD-ACTIVOS-FINANCIEROS (Screener export) → Screener-Buscador-MVP**.

---

## 2. Ubicaciones exactas (capa de datos FondosDB) — verificado en disco

- **Base de datos (núcleo):** `…\fondosdb\data\funds\` → **499 JSON, uno por ISIN**.
- **Índice:** `…\fondosdb\data\index.json`.
- **Históricos de VL a 5 años (cache local):** `…\fondosdb\data\history_vl\` → 472 fondos.
- **Exports que consume BBDD:**
  - `…\fondosdb\export\fondos_plano.csv`
  - `…\fondosdb\export\fondos.ndjson` (+ `posiciones.ndjson`, `series.ndjson`, `manifest.json`)
  - `…\fondosdb\export_bdb\` → canónicos con esquema BDB (497 JSON).
- **Config:** `…\fondosdb\config\fondos.csv` (universo), `settings.json`, `secrets.json` (local, NO a git).
- **Credencial Firestore:** `C:\Users\oanti\Documents\_SECRETS\bdb-fondos-service-account.json` (carpeta local, no sincroniza).

---

## 3. Estado de la migración — IMPORTANTE

- La copia **canónica** de FondosDB es la **LOCAL**: `C:\Users\oanti\Proyectos\DATOS FONDOS` (fuera de OneDrive).
- Sigue existiendo un **duplicado en OneDrive**: `C:\Users\oanti\OneDrive\Documentos\Claude\Projects\DATOS FONDOS` — **pendiente de borrar; no usar.**
- El 2026-06-18 se añadieron a la copia local 3 fondos que faltaban: `ES0113211835` (BBVA, JSON "fuera de lista"/huérfano), `IE000DR59CI3`, `IE00B3Q19T94`. Total actual: **499 fondos**.
- ⚠️ **Los exports están desactualizados:** `fondos_plano.csv` y `export_bdb\` reflejan ~496-497 fondos, **no** los 499. Antes de que BBDD/Screener los consuma hay que **regenerarlos**: `python main.py export` (+ la export BDB) desde la copia local.

---

## 4. Esquema y convenciones clave

- **`asset_type` ∈ {STOCK, FUND, ETF, INDEX}.** NO usar `EQUITY` como `asset_type`.
  En paralelo, **`classification.asset_class: EQUITY` SÍ es válido** (renta variable interna). El script Screener lo usa correctamente: `asset_type = STOCK` con `asset_class = EQUITY`. No confundir ambos campos.
- **`historico_vl_v2` (Firestore):** doc `id = ISIN`; campos `{ isin, currency, last_updated, source: "EODHD Auto", updatedAt, range: {from,to}, history: [{date: "YYYY-MM-DD", nav: float}] }`; ~2.986 puntos diarios desde 2015.
- **JSON por fondo de FondosDB** (bloques): `identificacion`, `valoracion`, `costes`, `rentabilidad`, `riesgo`, `rating`, `cartera` (con `asignacion_activos`, `sectores_pct`, `regiones_pct`, `capitalizacion_pct`, `style_box_rv`, `renta_fija`, `posiciones`, `divisas_pct`), `esg`, `gestion`, `distribuciones`, `meta`.

---

## 5. Screener — según la revisión de Oscar (referencia)

- Script: `scripts/runScreenerStaticDatasetExportPreview.ts`.
- Contrato: `SCREENER_STATIC_DATASET_EXPORT_CONTRACT_V0.md`.
- Artifact actual: **50 activos** → 37 FUND, 7 ETF, 4 STOCK, 2 INDEX. La carpeta `artifacts` **no** está trackeada por git.
- Destino del dataset: `C:\Users\oanti\Documents\Screener-Buscador-MVP\public\data\screener-assets.mock.json`.
- Dependencias presentes: `dotenv`, `firebase-admin`, `typescript`, `tsx`, `vitest`.
- Git: rama `master`, remoto `origin` en GitHub, sincronizado.

---

## 6. Avisos de entorno (para no perder tiempo)

- **OneDrive trunca lecturas:** cuando un proyecto vive en OneDrive, la sincronización sirve copias a medio escribir/truncadas de archivos recién editados, lo que rompe lecturas e imports de forma intermitente. Por eso FondosDB se migró a local. **Trabajar siempre en la copia de `Proyectos` / `Documents`, nunca en OneDrive.**
- **Git nativo desde PowerShell** funciona bien; hacer los commits desde ahí.
- **Secretos** (`secrets.json`, `serviceAccount.json`): nunca a git; van en `.gitignore` / carpeta `_SECRETS`.
- **FondosDB app:** usa `BASE = carpeta del app.py`; el `.bat` hace `cd /d "%~dp0"`. Lanzar siempre desde la copia local para que escriba en la carpeta correcta.

---

## 7. Ajustes pendientes del informe técnico (validados por Oscar)

1. Añadir la **ruta de destino completa** del Screener: `C:\Users\oanti\Documents\Screener-Buscador-MVP\public\data\screener-assets.mock.json`.
2. Aclarar la distinción **`asset_type` vs `classification.asset_class`** (ver §4).
3. En "Testing y Validación", cambiar "Typecheck OK / Tests OK" por **"validaciones recientes OK"**, o re-ejecutar las validaciones justo antes de fechar el documento.

---

## 8. Acción inmediata sugerida para Codex

1. Regenerar los exports de FondosDB (499 fondos) antes de consumirlos en BBDD/Screener.
2. Confirmar que el Screener sigue mapeando `asset_type`/`asset_class` según §4 tras el refresco de datos.
3. Aplicar los 3 ajustes del §7 al informe técnico.
