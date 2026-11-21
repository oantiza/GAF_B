> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo para Gemini 3.1 Pro (Antigravity): COMMIT + PUSH + DESPLIEGUE de BDB-ACTIVOS

> **Registro histórico, no se sigue.** Este documento es de BDB y manda a desplegar en su proyecto, y desde este repositorio **no se escribe nunca allí**. Para desplegar aquí: `scripts/desplegarFunciones.mjs` y `4-base-nueva/compilar-sitio.mjs`.

Objetivo: hacer lo que el otro agente (Claude) no puede hacer por sí mismo en el repo
`C:\Users\oanti\Documents\BDB-ACTIVOS`: **(A) commit + push** del trabajo acumulado y
**(B) desplegar las Cloud Functions** (Python, región europe-west1, carpeta `functions_python/`).
**NO toques el frontend (`src/`): se está editando en paralelo (el panel admin).**

## PARTE A — Commit + push

El trabajo ya está en el árbol y hay un mensaje preparado en la raíz: `commit-msg.txt`. Ejecuta:

```
git add -A
git reset -- commit-msg.txt        # que el propio fichero de mensaje no entre en el commit
git commit -F commit-msg.txt
git push
```

- Si `git add`/`commit` falla por **índice corrupto** (le pasa a este repo en Windows): borra
  `.git\index.lock` y `.git\index`, luego `git reset` y reintenta.
- Si el árbol tuviera cambios del frontend a medio hacer (panel admin) que NO quieras incluir,
  PARA y pregunta al usuario antes del `git add -A`. En condiciones normales el frontend está
  limpio y compilando, así que se puede incluir.
- Tras el push, borra el fichero de mensaje: `Remove-Item commit-msg.txt`.

## PARTE B — Despliegue (Cloud Functions)

### Qué se despliega
- `functions_python/readmodel/mappers.py` — ahora mapea la máxima caída: `risk.max_drawdown`
  (ventana 5 años) + `risk.max_drawdown_hist` (peor caída histórica + fecha). Lo usan las
  callables `get_asset_detail`, `compare_assets`, `search_assets`.
- `functions_python/main.py` — además de las callables existentes, registra **dos funciones
  programadas nuevas**: `scheduled_refresh_prices` (lun-vie 06:00 Madrid, refresco diario de
  precios desde EODHD) y `scheduled_refresh_metrics` (sáb 07:00 Madrid, recálculo semanal de la
  caída).
- `functions_python/price_refresh.py` y `functions_python/metrics_refresh.py` — la lógica de
  esas dos programadas. Escriben en la BBDD MAESTRA `bbdd-activos-financieros` (cross-project).

## Contexto importante
- Hay DOS proyectos: el de las functions (Auth/app) y la BBDD MAESTRA `bbdd-activos-financieros`.
  Las functions leen la maestra cross-project; las 2 programadas además **escriben**, así que el
  service account de las functions necesita `roles/datastore.user` SOBRE la maestra (hoy solo
  tiene `datastore.viewer`).
- El refresco diario usa EODHD: requiere el secreto `EODHD_API_KEY`.

## Pasos (en orden). Los marcados [USUARIO] los hace o confirma el usuario — NO inventes valores.

0. **Pre-checks**: `firebase projects:list` y `gcloud config list` para confirmar el proyecto de
   las functions y que hay sesión iniciada. Identifica el **service account de runtime** de las
   functions (normalmente `<project-id>@appspot.gserviceaccount.com` o el compute por defecto
   `<project-number>-compute@developer.gserviceaccount.com`).

1. **[USUARIO] Secreto EODHD**: pídele que ejecute y pegue su token (NO manejes tú el valor):
   `firebase functions:secrets:set EODHD_API_KEY`

2. **Permiso de escritura cross-project** (lo necesitan las 2 programadas). Muestra el comando y
   pide OK antes de ejecutarlo (sustituye `<SA>` por el de runtime del paso 0):
   `gcloud projects add-iam-policy-binding bbdd-activos-financieros --member="serviceAccount:<SA>" --role="roles/datastore.user"`

3. **Habilita Cloud Scheduler**:
   `gcloud services enable cloudscheduler.googleapis.com`

4. **(Recomendado) Prueba local** antes de desplegar, desde `functions_python/` con ADC:
   `python -c "import price_refresh as r; print(r.refresh_stale_prices(limit=5))"`
   `python -c "import metrics_refresh as m; print(m.refresh_max_drawdown(limit=5))"`
   Si fallan por permisos de escritura, falta el paso 2.

5. **Deploy**: sigue `docs/RUNBOOK_DEPLOY.md` («Despliegue controlado»): pide OK explícito,
   fija `BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY=YES_I_UNDERSTAND_SHARED_PROJECT` solo para esa
   ejecución y despliega **siempre** con `--project bbdd-activos-financieros`:
   `npx firebase deploy --only functions --project bbdd-activos-financieros`.
   Si pregunta por BORRAR funciones, responde que NO. Retira la variable al terminar.

6. **Verificación**:
   - `firebase functions:list` (o consola): confirma `get_asset_detail`, `compare_assets`,
     `search_assets` (mapper nuevo) y las 2 programadas con su cron.
   - Dispara manualmente una de las programadas desde Cloud Scheduler (o espera su hora) y mira
     los logs: debe verse `updated/written > 0` sin errores.
   - En la app, abre un fondo y confirma que sale la **Máx. caída** (la etiqueta 5A y, donde
     proceda, la nota de máxima histórica las añade el frontend, que se despliega aparte).

7. **Reporta**: qué se desplegó, resultado de la verificación, y cualquier secreto/permiso que el
   usuario aún deba fijar.

## Restricciones
- NO edites `src/` (frontend en uso en paralelo). El deploy de **hosting/frontend lo hacemos
  nosotros** cuando esté listo el panel admin.
- NO borres funciones. NO hardcodees el token EODHD. Si falta algún secreto/IAM, PARA y pídeselo
  al usuario.
