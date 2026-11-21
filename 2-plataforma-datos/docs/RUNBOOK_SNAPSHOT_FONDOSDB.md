# Runbook — Snapshot read-only FondosDB (lo ejecutas tú)

Objetivo: establecer la **única fuente de verdad** sobre si los 404 root assets existen o faltan
en Firestore (resuelve C1), de forma **solo lectura** y sin riesgo de escritura.

Este paso requiere tus credenciales locales y conexión a Firestore, por eso lo ejecutas tú en tu
máquina. No activa ninguna escritura.

---

## 1. Precondiciones (verifícalas antes)
- Estás en `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`.
- `.env.local` existe y contiene (sin compartirlo conmigo):
  - `FIREBASE_PROJECT_ID=...`
  - `GOOGLE_APPLICATION_CREDENTIALS=...` **o** `FIREBASE_SERVICE_ACCOUNT_PATH=...` (ruta al serviceAccountKey).
- **`FIRESTORE_REAL_WRITE_ENABLED` NO debe estar a `true`** (debe estar ausente o `false`).
- Dependencias instaladas de forma reproducible:
  ```bash
  npm ci
  ```

## 2. Activar solo-lectura y ejecutar el snapshot
El script solo abre conexión si `FIRESTORE_LIVE_READONLY=true` **y** `FIRESTORE_REAL_WRITE_ENABLED`
no es `true`. Solo hace `.get()` (lecturas); fuerza `firestore_writes=0`.

PowerShell (Windows):
```powershell
$env:FIRESTORE_LIVE_READONLY="true"
npm run firestore:fondosdb-root-assets-readonly-snapshot
```

Verás un resumen en consola: `readonly_snapshot_executed`, `existing_assets`, `missing_assets`,
`read_errors`, y `firestore_writes=0 firestore_deletes=0`.

> Si imprime `[BLOCKED_SAFE] Safe readonly environment not available`, falta alguna variable
> (project id / credenciales) o `FIRESTORE_LIVE_READONLY` no está a `true`. No es un error de datos.

## 3. Comprobación de seguridad (rápida)
- La salida debe decir `firestore_writes=0` y `firestore_deletes=0`.
- No debes haber tocado `FIRESTORE_REAL_WRITE_ENABLED`.
- `git status` no debería mostrar nada fuera de `artifacts/fondosdb_root_assets_readonly_snapshot_0/`.

## 4. Qué me envías (o me dejas leer)
Generado en `artifacts/fondosdb_root_assets_readonly_snapshot_0/`. Lo más útil:
- `readonly_snapshot_summary.json` (las cifras clave)
- `conflict_detection_report.json` (existentes vs faltantes, por path)
- `missing_assets_manifest.json` y `existing_assets_manifest.json`

Con eso te digo: cuántos existen / faltan de verdad, y qué semántica de escritura corresponde.

## 5. Interpretación (lo hago yo, offline)
Según el resultado:
- **missing = 404** → camino limpio: `create-only` sobre los 404 (IWDA fuera). Procede pedir autorización de write.
- **missing = 0 (todos existen)** → **no** ejecutar create-only (fallaría "already exists"). Decidir entre
  no-op o `update` controlado por campo (con BLOCK por defecto, como el field-diff de IWDA).
- **mixto (p. ej. 380 missing / 24 existen)** → write **solo** sobre los missing confirmados + reanudación
  idempotente que omita existentes.

## 6. (Opcional) Phantom parents
Para confirmar C3: de los root que aparezcan como **missing**, comprobar si aun así tienen subcolección
`holdings` (holdings escritos sin documento raíz). Si los hay, la prioridad es crear/normalizar esos roots.
El snapshot ya dice qué roots existen; el cruce con los paths de holdings conocidos cierra la comprobación.

## 7. Después (write real) — recordatorio
Cuando el estado esté confirmado y tú lo autorices: alcance = 404 paths `assets/{asset_id}`,
IWDA excluido, deletes=0, sin holdings/listings/price_series/metrics, rollback manifest y post-verify.
La calidad de contenido de los 404 ya está auditada en
`docs/AUDITORIA_CALIDAD_404_CANDIDATOS_FONDOSDB.md` (sin bloqueos).
