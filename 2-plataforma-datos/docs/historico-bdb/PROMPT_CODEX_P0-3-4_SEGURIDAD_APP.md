> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo a ejecutor — P0-3/P0-4 · Endurecer la app antes de abrir (caps server-side + registro)

**Ejecutor sugerido:** Codex (edita `functions_python/main.py` en producción + deploy + test en vivo → fiabilidad). Si no está disponible: Antigravity + **Gemini 3.1 pro**. NO flash.

**Repo:** `C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app` (functions_python). Firebase `bbdd-activos-financieros` (europe-west1).
**Decisión del usuario:** la app se abrirá a terceros con modelo **registro abierto + caps** (rol único autenticado; roles viewer/analyst se dejan para después).

## Estado verificado (no hace falta tocar)
La auth ya es correcta: toda callable llama `_require_auth`; el admin es server-side (`_require_admin` por custom claim `admin` o `ADMIN_UIDS`); escrituras a la maestra gated; carteras por UID. **Solo falta poner topes de tamaño (P0-4)** porque hoy el cliente manda `limit`/listas sin tope.

## Cambios en `functions_python/main.py`

### 1. Constantes + helper (añadir tras `_require_admin`, ~línea 66)
```python
# Caps server-side (P0-4): topes de tamaño para abrir a terceros sin abuso.
CAP_SEARCH_LIMIT = 50
CAP_COMPARE_IDS = 20
CAP_OPTIMIZE_ASSETS = 10
CAP_BACKTEST_ASSETS = 8
CAP_POSITIONS = 200

def _cap_list(data, field, cap, label):
    """Rechaza si data[field] es una lista que excede el cap."""
    items = (data or {}).get(field)
    if isinstance(items, list) and len(items) > cap:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                  "Maximo %d %s por peticion." % (cap, label))
```

### 2. search_assets (truncar limit a [1,50])
Sustituir el cálculo del limit:
```python
limit = min(max(int((data.get("limit") or 20)), 1), CAP_SEARCH_LIMIT)
results = repo.search_assets(reader, data.get("query", ""), data.get("types"), limit)
```

### 3. compare_assets (truncar a 20)
```python
ids = list((req.data or {}).get("asset_ids", []))[:CAP_COMPARE_IDS]
return {"assets": repo.compare_assets(FirestoreReader(), ids)}
```

### 4. optimize_portfolio / backtest_portfolio (rechazar si exceden)
Tras `_require_auth(req)` y antes de llamar al servicio:
- optimize: `_cap_list(req.data, "asset_ids", CAP_OPTIMIZE_ASSETS, "activos")`
- backtest: `_cap_list(req.data, "asset_ids", CAP_BACKTEST_ASSETS, "activos")`
  (Verifica el nombre del campo de backtest; si no es `asset_ids`, ajústalo al que use su servicio.)

### 5. resolve_portfolio / analyze_portfolio (cap de posiciones)
Tras `_require_auth(req)`:
- resolve: `_cap_list(req.data, "positions", CAP_POSITIONS, "posiciones")`
- analyze: `_cap_list(req.data, "positions", CAP_POSITIONS, "posiciones")`

### 6. (Recomendado) email verificado en `_require_auth`
Registro abierto, pero exige email verificado para cortar altas basura. En `_require_auth`, antes del `return`:
```python
token = getattr(req.auth, "token", None) or {}
if token.get("email_verified") is False:
    raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                              "Verifica tu email para usar la app.")
```
(Usa `is False` para no romper providers que no incluyan el claim. Tu cuenta Google ya está verificada.)

## Verificación
```
cd C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app\functions_python
python -m pytest -q            REM si hay tests de callables; PARA si fallan
firebase deploy --only functions
```
Pruebas en vivo (con tu sesión):
- `search` con `limit: 9999` → devuelve ≤ 50.
- `compare` con 50 ISINs → procesa 20.
- `optimize`/`backtest` con 11 activos → error INVALID_ARGUMENT "Maximo 10/8 activos".
- Un caso normal (search corto, optimize de 3-5 activos) sigue funcionando.

## Reglas
- No tocar la auth existente salvo el añadido de email verificado. Admin sigue server-side.
- Deploy es el único paso gated; no toca la maestra. Nunca `--force`.

## Devolver
Diff aplicado a `main.py`, salida del deploy y resultado de las 4 pruebas en vivo (caps efectivos + caso normal OK).
