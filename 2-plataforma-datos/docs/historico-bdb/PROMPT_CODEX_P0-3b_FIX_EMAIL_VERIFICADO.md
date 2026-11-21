> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo a ejecutor — FIX · Quitar el gate `email_verified` (bloquea al admin)

**Ejecutor sugerido:** Codex (edita `functions_python/main.py` + redeploy → fiabilidad). Si no está: Antigravity + **Gemini 3.1 pro**. NO flash.
**Repo:** `C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app` (functions_python). Firebase `bbdd-activos-financieros`.

## Problema (regresión introducida en P0-3/4 §6)
El añadido "email verificado" en `_require_auth` lanza `PERMISSION_DENIED "Verifica tu email para usar la app."` cuando `token.email_verified is False`. Como `_require_admin` llama a `_require_auth`, **bloquea el panel Admin entero** (y a cualquier usuario con email no verificado). Síntoma: en Admin → Estado/salud sale "No se pudo cargar el estado: Verifica tu email para usar la app.."

## Fix — quitar ese bloque de `_require_auth`
En `functions_python/main.py`, dentro de `_require_auth`, **elimina** el bloque añadido en P0-3/4 §6:
```python
token = getattr(req.auth, "token", None) or {}
if token.get("email_verified") is False:
    raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                              "Verifica tu email para usar la app.")
```
`_require_auth` debe quedar como antes: solo exige `req.auth` (UNAUTHENTICATED si falta) y devuelve `req.auth.uid`. **No toques** `_require_admin` ni los caps (P0-4 se mantienen).

## Pasos
```
cd C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app\functions_python
python -m pytest -q                  REM PARA si fallan
$env:BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY="YES_I_UNDERSTAND_SHARED_PROJECT"; firebase deploy --only functions
```
Verifica en vivo: el panel Admin → Estado/salud **carga** con tu cuenta; search/optimize normales funcionan; los caps siguen activos (optimize de 11 → INVALID_ARGUMENT).

## Nota (para cuando se abra a terceros de verdad)
Reintroducir email-verificado bien diseñado: **eximir admin** (no aplicarlo en `_require_admin`) y solo exigirlo a usuarios normales, idealmente con un flujo de verificación en la UI. No como gate global en `_require_auth`.

## Devolver
Diff aplicado, salida del deploy y confirmación de que el panel Admin vuelve a cargar.
