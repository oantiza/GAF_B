> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Prompt para el agente (Gemini / Antigravity / Codex) — encender backend y publicar informe

Dale este encargo a tu agente. Le indica que use Secret Manager para las claves que el backend ya entiende.

---

Tarea: enciende el backend de la app **BDB-ACTIVOS** y publica el informe semanal, en el proyecto Firebase/GCP **bbdd-activos-financieros** (región **europe-west1**). Trabaja en `C:\Users\oanti\Documents\BDB-ACTIVOS`.

Usa EXACTAMENTE estos nombres de secreto; NO imprimas valores ni los subas a git:
- **GEMINI_API_KEY** -> análisis IA y generación del informe.
- **EODHD_API_KEY** -> calendario económico.

Pasos:
1. Carga o rota los secretos con el flujo interactivo:
   ```powershell
   firebase functions:secrets:set GEMINI_API_KEY --project bbdd-activos-financieros
   firebase functions:secrets:set EODHD_API_KEY --project bbdd-activos-financieros
   ```
2. Despliega (la barrera del repo exige la variable de aprobación):
   ```powershell
   $env:BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY="YES_I_UNDERSTAND_SHARED_PROJECT"
   firebase deploy --only functions
   ```
3. Permite invocación de las 4 callables nuevas si dan `internal`/CORS (nombre de servicio = función con guiones):
   ```powershell
   gcloud run services add-iam-policy-binding backtest-portfolio     --region=europe-west1 --member=allUsers --role=roles/run.invoker --project=bbdd-activos-financieros
   gcloud run services add-iam-policy-binding get-weekly-report      --region=europe-west1 --member=allUsers --role=roles/run.invoker --project=bbdd-activos-financieros
   gcloud run services add-iam-policy-binding analyze-portfolio      --region=europe-west1 --member=allUsers --role=roles/run.invoker --project=bbdd-activos-financieros
   gcloud run services add-iam-policy-binding get-economic-calendar  --region=europe-west1 --member=allUsers --role=roles/run.invoker --project=bbdd-activos-financieros
   ```
4. Genera y publica el informe semanal (lee `GEMINI_API_KEY` desde un entorno local efimero o Secret Manager; escribe en Firestore `bdb_activos_reports`):
   ```powershell
   pip install firebase-admin
   gcloud auth application-default login
   python scripts\publish_weekly_report.py
   ```
5. Verifica en la app (fuente «BBDD en vivo (API)»): Cartera → Backtest y Análisis IA; Macro → Calendario; Macro y estrategia → informe real.

Restricciones: usa esos nombres de secreto EXACTOS; no expongas valores de claves; no hagas commit/push del `.env`.

---

Nota: el backend ya lee `GEMINI_API_KEY` y `EODHD_API_KEY`, así que con esos nombres encaja sin tocar código.
