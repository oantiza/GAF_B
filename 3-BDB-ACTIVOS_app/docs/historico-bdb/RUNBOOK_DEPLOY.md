> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Runbook de despliegue BDB-ACTIVOS

> **Registro histórico, no se sigue.** Este documento es de BDB y manda a desplegar en su proyecto, y desde este repositorio **no se escribe nunca allí**. Para desplegar aquí: `scripts/desplegarFunciones.mjs` y `4-base-nueva/compilar-sitio.mjs`.

Revisión documental: 2026-09-05. Los datos de IAM, App Check y tareas desplegadas requieren comprobación en cada despliegue.

## Arquitectura vigente

- Proyecto: `bbdd-activos-financieros`.
- Region: `europe-west1`.
- Runtime: Cloud Run functions de segunda generacion, Python 3.12.
- Funciones de lectura: `bdb-functions-reader@bbdd-activos-financieros.iam.gserviceaccount.com`.
- Funciones de escritura: `bdb-functions-writer@bbdd-activos-financieros.iam.gserviceaccount.com`.
- Cuenta de build: `624747123295-compute@developer.gserviceaccount.com`, solo con `roles/run.builder`.
- App Check: reCAPTCHA Enterprise registrado y observacion activa (linea `app_check_observation` por llamada, C1 auditoría 29-09); enforcement desactivado hasta que `scripts/appcheck_report.py` devuelva «Activable» y el acceso local tenga token de depuracion. Ver seccion «App Check: de observacion a enforce».
- TOTP: proveedor opcional habilitado; ninguna cuenta se inscribe automaticamente.
- Programación declarada en `functions_python/main.py`: precios martes a sábado a las 07:30; métricas diarias 08:30, 09:00, 09:30 y 10:00 (cuatro funciones, una vuelta repartida por el cursor); índice diario 03:45; integridad diaria 10:30; informe semanal lunes 07:15 y diario lunes a viernes 07:00 (Madrid).

Las cuentas por defecto no deben recuperar `roles/editor` ni acceso a Firestore. Los secretos solo se leen desde Secret Manager.

## Antes de desplegar

1. Revisar `git status` y confirmar que no se incluyen `.env`, credenciales, copias de datos ni artefactos de ejecucion.
2. Ejecutar en un entorno Python 3.12 (comprobar primero `python --version`; un entorno virtual existente puede usar otra versión):

```powershell
npm test
npm run lint
npm run build
Set-Location functions_python
python -m pytest -q
Set-Location ..
```

3. Para cambios de contratos o escrituras masivas, crear antes una copia completa y ejecutar el restore drill del repositorio `2-plataforma-datos`.
4. Confirmar que existen `EODHD_API_KEY`, `FINNHUB_API_KEY` y `GEMINI_API_KEY` en Secret Manager. No leer ni copiar sus valores.
5. Mantener fuera de Git `functions_python/.env.bbdd-activos-financieros`.

## Despliegue controlado

Solo tras autorización explícita. Los tres destinos (functions, firestore y hosting) ejecutan primero el guard de autorización; la sincronización de contratos ocurre después. Ejecutar también la integración de reglas en emuladores cuando cambien importaciones o permisos.

```powershell
$env:BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY="YES_I_UNDERSTAND_SHARED_PROJECT"
npx firebase deploy --only functions,firestore:rules,hosting --project bbdd-activos-financieros
Remove-Item Env:\BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY
```

Para un cambio exclusivo de Hosting se puede sustituir el selector por `--only hosting`.

## Verificacion obligatoria

1. Todas las funciones de BDB-ACTIVOS (48 a 14-10-2026: 39 callables + 9 programadas; contar `@https_fn.on_call` y `@scheduler_fn` en `functions_python/main.py` antes de desplegar) deben estar `ACTIVE` y usar una de las dos cuentas dedicadas. La función `api`, etiquetada con el codebase `analisis`, pertenece a Análisis de Empresas y queda fuera de este despliegue y de esta comprobación de identidad. No cambiar sus permisos desde este runbook.

```powershell
gcloud functions list --v2 --regions=europe-west1 --project=bbdd-activos-financieros `
  --filter="NOT labels.firebase-functions-codebase=analisis" `
  --format="table(name.basename(),state,serviceConfig.serviceAccountEmail)"
```

2. Las nueve tareas (indice, precios, semanal, diario, las cuatro de metricas, integridad) deben estar habilitadas y usar la cuenta escritora:

```powershell
gcloud scheduler jobs list --location=europe-west1 --project=bbdd-activos-financieros `
  --format="table(name.basename(),state,httpTarget.oidcToken.serviceAccountEmail)"
```

Si Firebase conserva una identidad antigua en precios o metricas, corregirla explicitamente:

```powershell
gcloud scheduler jobs update http firebase-schedule-scheduled_refresh_prices-europe-west1 `
  --location=europe-west1 --project=bbdd-activos-financieros `
  --oidc-service-account-email=bdb-functions-writer@bbdd-activos-financieros.iam.gserviceaccount.com `
  --oidc-token-audience=https://europe-west1-bbdd-activos-financieros.cloudfunctions.net/scheduled_refresh_prices

foreach ($job in "scheduled_refresh_metrics", "scheduled_refresh_metrics_0900", "scheduled_refresh_metrics_0930", "scheduled_refresh_metrics_1000") {
  gcloud scheduler jobs update http "firebase-schedule-$job-europe-west1" `
    --location=europe-west1 --project=bbdd-activos-financieros `
    --oidc-service-account-email=bdb-functions-writer@bbdd-activos-financieros.iam.gserviceaccount.com `
    --oidc-token-audience="https://europe-west1-bbdd-activos-financieros.cloudfunctions.net/$job"
}
```

3. Comprobar web y CORS:

- `https://bbdd-activos-financieros.web.app` responde 200.
- Las rutas de aplicacion devuelven `Cache-Control: no-store`.
- `/assets/**` devuelve caché inmutable.
- El preflight desde `http://127.0.0.1:5173` acepta `analyze_real_portfolio`.
- Una callable sin sesion responde 401.

4. Ejecutar la tarea de metricas y comprobar HTTP 200 en Cloud Run. No ejecutar manualmente precios salvo necesidad operativa, porque consume proveedores externos.
5. Ejecutar en `2-plataforma-datos`:

```powershell
npm run search-index:reconcile
npm run contracts:migrate-price-series-v12
```

Ambos comandos deben terminar sin diferencias y en modo de solo lectura.

6. Para cambios en autenticacion, ejecutar `npm run smoke:auth-totp` exclusivamente con una cuenta temporal verificada que cumpla la allowlist del script. El smoke debe completar inscripcion, reto y retirada del factor; borrar despues la cuenta temporal con Admin SDK.

## Escrituras maestras

Las escrituras administrativas y programadas exigen el gate:

```text
BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES
```

No activar el gate en una terminal o proyecto distinto. Toda migracion debe tener dry-run, limite, artefacto de resultado y verificacion posterior.

## App Check: de observación a enforce (C1, auditoría 29-09)

`_require_auth` emite una línea `app_check_observation` (jsonPayload) por llamada, con y sin token, con `operation`, `origin`, `client` y `uid_hash`. Procedimiento:

1. Desplegar Functions y esperar N días (7 recomendados) de uso normal desde producción.
2. Generar el informe: `python scripts\appcheck_report.py --days 7` (desde `functions_python`, con `gcloud` autenticado en el PATH; `--json` para salida estructurada).
3. Si el veredicto es «Activable» (100 % de las llamadas desde `https://bbdd-activos-financieros.web.app` y `.firebaseapp.com` traen token), poner `BDB_APPCHECK_ENFORCE=true` en `functions_python/.env.bbdd-activos-financieros` y redesplegar Functions.
4. El informe lista los orígenes/clientes que quedarían fuera al activar el enforce; resolverlos antes o asumirlos.
5. Reversión: quitar la variable (o `BDB_APPCHECK_ENFORCE=false`) y redesplegar Functions.

Aviso: `localhost:5173` con reCAPTCHA Enterprise no obtiene token (el dominio no está admitido), salvo que se use `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` con un token de depuración registrado en la consola de Firebase (App Check → aplicación web → tokens de depuración). Tras activar el enforce, el desarrollo local necesita ese token; sin él, todas las callables responden `unauthenticated` («Unauthenticated») antes de llegar a `_require_auth`.

## Rollback

1. Hosting: restaurar una version anterior desde Firebase Hosting.
2. Functions: desplegar el commit anterior; no cambiar las cuentas dedicadas.
3. Datos: usar el backup completo y el manifiesto SHA-256. Restaurar primero en emulador y comparar hashes antes de intervenir produccion.
4. Para bloquear escrituras, retirar el gate y volver a desplegar Functions. No borrar tareas, secretos ni cuentas manualmente.
