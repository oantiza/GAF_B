# Bloque 7B-0: Firestore Write Gate Readiness / Preflight

## Objetivo
Preparar toda la infraestructura necesaria para ejecutar escrituras reales en Firestore (Firebase Admin) de forma segura, transaccional (Batching) y bloqueada por seguridad. En este paso el sistema se autoevalúa en un preflight (Dry-Run de batching y planes de contingencia) **SIN enviar ningún dato real a Firebase**.

## Relación con Bloque 7A
Mientras que el **Bloque 7A** diseñó *qué* escribiríamos en Firestore y simuló su mapeo, este **Bloque 7B-0** diseña *cómo* lo escribiríamos mediante la infraestructura de red subyacente. 
Todavía no escribimos en Firestore porque el objetivo de este bloque es dejar listos los muros de contención (`authorized = false`) para evitar desastres durante la posterior inyección del SDK real `firebase-admin`.

## Diseño de la Infraestructura de Escritura Segura
1. **FirestoreBatchWriter**: Firestore tiene un límite estricto de 500 operaciones por batch. Para prevenir cuellos de botella, hemos diseñado un escritor particionado fijado en **450 operaciones por chunk**. Divide el trabajo masivo en bloques atómicos asíncronos de forma robusta. En este bloque, su método `executeBatches()` opera en dry-run puro de manera obligatoria.
2. **FirestoreRealWriteGate**: Interpreta el manifiesto de aprobación heredado de la fase 7A. Si detecta el más mínimo flag en `true` (como un intento ilegítimo de desbloqueo prematuro), lanza un error fulminante (`SECURITY FAULT`). Cuando los flags son coherentemente `false`, transita a estado `READY_BUT_LOCKED`.
3. **Planes de Contingencia**:
   - **Snapshot Planner**: Prepara la estructura de colecciones que deberán leerse por precaución antes de sobreescribir.
   - **Rollback Planner**: Establece un árbol inverso de borrado (borrando primero price_series/metrics, luego listings, y finalmente root assets) para poder desmantelar transacciones parciales.

## Resumen de Pruebas Unitarias
Se han ejecutado los tests bajo `npm test` arrojando un total de **83/83 PASS**. 
Tests destacables verifican que:
- El batching divide operaciones >450 en los chunks correctos.
- La ejecución con un `dryRun = false` arroja error forzado.
- Un estado inconsistente de las llaves booleanas de escritura arroja Security Fault.

## Resumen de Preflight Dry Run
El comando `npm run dryrun:firestore-write-gate-preflight` produjo en la carpeta `artifacts/firestore_write_gate_preflight_0` los siguientes informes de vuelo:
- `preflight_summary.json`: Resume que se han planificado las operaciones en chunks, pero confirmando `firestore_writes: 0`.
- `batch_plan.json`: Describe exactamente el indexado de qué operaciones entran en cada chunk de 450.
- `credentials_safety_check.json`: Verifica si hay claves expuestas en el repositorio y dictamina que el SDK Admin sigue sin instanciarse.
- `rollback_execution_plan.json` / `snapshot_read_plan.json`: Planos preventivos.

## Riesgos Pendientes antes del Primer Write Piloto (7B-1)
1. Inyección real del archivo de credenciales de servicio `serviceAccountKey.json`. Este archivo jamás debe subirse a Git.
2. Instalación de la dependencia `firebase-admin`.

## Checklist para el Primer Write Piloto (Bloque 7B-1)
- [ ] Instalar `firebase-admin`.
- [ ] Conectar la base de datos local / de staging inyectando el `serviceAccountKey`.
- [ ] Proveer una variable de entorno `FIREBASE_WRITE_OVERRIDE_AUTH=true` o manipular a mano el manifiesto para desbloquear el Gate.
- [ ] Ejecutar la escritura piloto con los 5 assets de este dry-run y confirmar inserción documental vía Firebase Console.

## Confirmación Explícita de Restricciones Cumplidas
- Firestore writes = **0**
- Real write attempted = **NO**
- Real write executed = **NO**
- authorized = **false**
- can_write = **false**
- firestore_writes_allowed = **false**
- serviceAccountKey en repo = **NO**
- Firebase Admin inicializado = **NO**
- Credenciales impresas = **NO**
- Deploy/Commit/Push = **NO**
- BDB-FONDOS/CORE = **NO**
- EODHD Fundamentals = **NO**
- OpenFIGI live = **NO**
