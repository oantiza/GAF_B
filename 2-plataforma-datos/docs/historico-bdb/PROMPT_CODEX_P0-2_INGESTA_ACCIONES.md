> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo a ejecutor — P0-2 · Terminar la ingesta de acciones con histórico (app)

**Ejecutor sugerido:** Codex (deploy de Cloud Functions + secreto + test en vivo → fiabilidad). Si Codex no está disponible: Antigravity + **Gemini 3.1 pro**. NO flash (hay deploy, verificación en vivo y escritura gated).

**Repo:** `C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app` (React + functions_python). Firebase `bbdd-activos-financieros` (europe-west1).

## Contexto (verificado en el código; el repo va por delante del informe de situación)
La ingesta de acciones por ISIN desde el panel Admin ya está IMPLEMENTADA y commiteada — **F2.5 de "deps + secrets en código" ya hecha**:
- `functions_python/ingest_asset.py`: ISIN→símbolo (EODHD `/search`), fundamentales Finnhub (`/stock/profile2`+`/stock/metric`) con backup Yahoo (yfinance), histórico vía `price_refresh` con **fix FX pre-euro** (`_fetch_fx`/`_convert_eur`), métricas. Gated, root create-only, solo STOCK.
- Callable `admin_ingest_asset` (main.py:267) ya declara `secrets=["EODHD_API_KEY","FINNHUB_API_KEY"]`, timeout 540s.
- `requirements.txt` ya trae `yfinance>=0.2.65`; Finnhub se llama por urllib (sin paquete).

**Lo único pendiente es de tu entorno:** crear el secreto `FINNHUB_API_KEY`, redeploy (el fix FX está escrito SIN desplegar) y re-test (hoy el preview CON histórico falla con INTERNAL).

## Pasos

### 1. Secretos (gated; NUNCA pegues el valor en chat — solo en el prompt oculto)
```
cd C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app\functions_python
firebase functions:secrets:set FINNHUB_API_KEY
firebase functions:secrets:access EODHD_API_KEY   REM confirmar que la v2 rotada existe y es válida
```
Necesitas una API key de Finnhub (el free tier cubre profile2 + metric). Si no la tienes, créala en finnhub.io.

### 2. Tests locales (no gated)
```
python -m pytest tests/test_ingest_asset.py -q
```
PARA si fallan.

### 3. Redeploy (incluye el fix FX + el callable con secrets)
```
firebase deploy --only functions
```
Esperado: `admin_ingest_asset` desplegada con los dos secrets.

### 4. Re-test del preview CON histórico (read-only, sin gate)
Panel Admin → ingesta, ISIN de prueba **US4581401001 (Intel)**:
- Antes daba INTERNAL; ahora el preview debe salir **CREATE** con `price_series` no vacío + fundamentales (Finnhub o Yahoo).
- PARA y reporta si sigue INTERNAL → `firebase functions:log --only admin_ingest_asset`.

### 5. Ingesta REAL gated + smoke en la app
Con el gate de escritura ON, aplica la ingesta de 1 acción de prueba con histórico:
- Postverify: `assets/{ISIN}` STOCK + `price_series` poblado + `metrics/latest`.
- Smoke: abre esa acción en la app (Buscador / X-Ray) y confirma que **renderiza** (forma `asset-stock.v1`) con su gráfico de histórico.

## Reglas
- Secretos solo por `firebase functions:secrets:set` (prompt oculto); nunca en chat ni en código.
- Escritura a la maestra solo con gate ON, create-only, nunca borrar.
- Si el preview falla, depura por logs antes de cualquier escritura real.

## Devolver
Salida del `deploy`, resultado del preview de Intel (CREATE + ¿histórico cargado?), y del smoke (¿la app muestra la acción con gráfico?). Si algo falla, los logs relevantes (sin secretos).
