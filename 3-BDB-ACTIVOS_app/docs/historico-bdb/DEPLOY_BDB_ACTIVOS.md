> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Desplegar el backend de BDB-ACTIVOS (paso a paso)

> **Registro histórico, no se sigue.** Este documento es de BDB y manda a desplegar en su proyecto, y desde este repositorio **no se escribe nunca allí**. Para desplegar aquí: `scripts/desplegarFunciones.mjs` y `4-base-nueva/compilar-sitio.mjs`.

Proyecto: **bbdd-activos-financieros** · región **europe-west1** · 4 callables nuevas
(`backtest_portfolio`, `get_weekly_report`, `analyze_portfolio`, `get_economic_calendar`).

## 0. Requisitos (una sola vez)
- Firebase CLI logueado: `firebase login`
- gcloud SDK logueado y con proyecto: `gcloud auth login` y `gcloud config set project bbdd-activos-financieros`

## 1. (Para IA y Calendario) secretos - opcional pero necesario para esas 2
- `analyze_portfolio` necesita **GEMINI_API_KEY**; el calendario necesita **EODHD_API_KEY**.
- Ambos deben ir en Secret Manager, no en `functions_python\.env` ni como env vars planas.
- Para cargar o rotar un secreto, usa el flujo interactivo del CLI y no pegues valores en chats/logs:
  ```powershell
  firebase functions:secrets:set GEMINI_API_KEY --project bbdd-activos-financieros
  firebase functions:secrets:set EODHD_API_KEY --project bbdd-activos-financieros
  ```

## 2. Desplegar

El procedimiento canónico es `docs/RUNBOOK_DEPLOY.md` («Despliegue controlado»): solo
tras autorización explícita, con el gate `BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY` activo únicamente
durante la ejecución y **siempre** con `--project bbdd-activos-financieros`.

```powershell
$env:BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY="YES_I_UNDERSTAND_SHARED_PROJECT"
npx firebase deploy --only functions --project bbdd-activos-financieros
Remove-Item Env:\BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY
```
Esa variable es la **barrera de seguridad** del repo (predeploy): sin ella, no despliega.

## 3. Permitir invocación (binding allUsers → run.invoker)
Cada callable 2ª gen NUEVA puede necesitar este binding la primera vez; si no, da `internal`/CORS.
Nombre del servicio Cloud Run = la función con **guiones** en vez de guiones bajos. PowerShell, una línea cada uno:
```powershell
gcloud run services add-iam-policy-binding backtest-portfolio     --region=europe-west1 --member=allUsers --role=roles/run.invoker --project=bbdd-activos-financieros
gcloud run services add-iam-policy-binding get-weekly-report      --region=europe-west1 --member=allUsers --role=roles/run.invoker --project=bbdd-activos-financieros
gcloud run services add-iam-policy-binding analyze-portfolio      --region=europe-west1 --member=allUsers --role=roles/run.invoker --project=bbdd-activos-financieros
gcloud run services add-iam-policy-binding get-economic-calendar  --region=europe-west1 --member=allUsers --role=roles/run.invoker --project=bbdd-activos-financieros
```

## 4. Activar en la app
Abre la app (local o desplegada), arriba a la derecha elige la fuente **«BBDD en vivo (API)»** e inicia sesión. Prueba: **Backtest** y **Análisis IA** en Cartera, **Calendario** en Macro.

## 5. Informe real de «Macro y estrategia»
`get_weekly_report` lee la colección Firestore **`bdb_activos_reports`**. Tu job LLM debe ESCRIBIR ahí un documento con `type: "WEEKLY_REPORT"`, `date`, y la forma de `WeeklyReport` (ver `src/types/weeklyReport.ts`). Hasta entonces, sale el informe de muestra. Si el job usa Gemini, carga `GEMINI_API_KEY` desde Secret Manager o desde una variable local efimera fuera del repo.

## Diagnóstico
Si una callable da `internal`/CORS sin traceback en los logs → le falta el binding del paso 3.
Compara con una que sí funciona: `gcloud run services get-iam-policy <svc> --region=europe-west1 --project=bbdd-activos-financieros`.
