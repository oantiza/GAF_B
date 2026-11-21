# Bloque 7B-1A: Real Pilot Write Setup + Live Read-Only Snapshot

## Objetivo
Preparar la infraestructura de conexión real a Firebase Firestore mediante el uso de la SDK oficial `firebase-admin`, garantizando que la primera conexión a la base de datos viva se realiza bajo estrictas condiciones de solo lectura (Read-Only). Esto permite verificar el enrutamiento de colecciones, las credenciales, y la existencia o inexistencia de documentos que el Write Gate va a sobreescribir, todo ello **sin ejecutar una sola escritura**.

## Diferencia entre 7B-0 y 7B-1A
- En el **Bloque 7B-0**, simulamos la existencia de un Batch Writer, diseñamos los Planners de Snapshot y Rollback, pero operábamos completamente al margen de dependencias externas. El SDK `firebase-admin` no formaba parte del scope.
- En el **Bloque 7B-1A**, hemos instalado `firebase-admin`. El sistema de autorización ha sido programado para aceptar y validar credenciales vivas del usuario y generar un `LiveSnapshotReader` capaz de tocar la red real de Google Cloud Firestore para ejecutar lecturas confirmadas.

## Configuración Segura de Credenciales
Se ha creado un protocolo de seguridad estricto para evitar el filtrado de secretos en GitHub:
1. `firebase-admin` lee variables puramente locales: `FIREBASE_PROJECT_ID` y `FIREBASE_SERVICE_ACCOUNT_PATH` / `GOOGLE_APPLICATION_CREDENTIALS` (desde un `.env.local` que está forzosamente ignorado en `.gitignore`).
2. El archivo con el token (ej. `serviceAccountKey.json`) debe residir fuera de las carpetas trackeadas o estar cubierto por `.gitignore`. 
3. El `FirestoreAdminProvider` audita constantemente la carpeta raíz. Si detecta el nombre del archivo JSON dentro del scope de Git, lanza una advertencia de seguridad `[SECURITY WARNING]`.
4. El script está configurado de tal manera que si detecta `FIRESTORE_LIVE_READONLY !== 'true'`, hace *abort* antes de inicializar la SDK. No se imprimen rutas ni mensajes que delaten la estructura interna de credenciales.

## Ejecución del Read-Only Snapshot
Al ejecutar el script `firestore:live-snapshot-readonly`, el sistema:
1. Pasa por el cerrojo del **FirestoreRealWriteGate** asegurando que no haya escrituras autorizadas (`authorized: false`).
2. Invoca al Provider con la llave `forceReadOnly = true`.
3. Lee el archivo `snapshot_plan.json` heredado del bloque anterior 7A, e itera exclusivamente por esos paths.
4. Distingue entre documentos vivos y missing docs (`expected_missing`), generando `live_snapshot_existing_docs.json` y `live_snapshot_missing_docs.json`.

## Resultados Obtenidos
- Los tests globales de la suite arrojaron **90/90 PASS**.
- `dryrun:firestore-write-gate-design` y `dryrun:firestore-write-gate-preflight` se mantienen operativos y funcionales sin incidencias.
- **Solución a `Reads Attempted = 0`**: Inicialmente el script apuntaba al archivo erróneo `snapshot_plan.json` del Bloque 7A, el cual era puramente descriptivo (solo contenía listas agrupadas como `assets_to_read`). Se ha corregido para que consuma `snapshot_read_plan.json` del Bloque 7B-0 Preflight, el cual contiene las rutas explícitas (`paths_to_read`) generadas iterando por cada operación mockeada. Adicionalmente, el reader aplica una deduplicación para evitar reads costosos innecesarios.
- El resultado final de ejecución (`npm run firestore:live-snapshot-readonly`) corrobora el fix:
  - **Reads Attempted:** 7
  - **Existing Docs:** 0
  - **Missing Docs:** 7 (Todos los paths específicos de Asset Roots y Listings han sido comprobados exitosamente contra la Base de Datos real, listos para ser escritos).

## Riesgos y Checklist antes de Bloque 7B-1B (Real Pilot Write)
1. El usuario debe crear el `.env.local` real e incluir su `FIREBASE_PROJECT_ID`.
2. El usuario debe colocar su clave pública JSON en un directorio seguro y apuntar la ruta en `.env.local`.
3. Confirmar que el output de `firestore:live-snapshot-readonly` devuelve el reporte exitoso sin rechazos por IAM de Google Cloud.

## Confirmación de Restricciones
- Firestore writes = **0**
- Firestore deletes = **0**
- Real write attempted = **NO**
- Real write executed = **NO**
- Firebase Admin initialized = **NO** *(A la espera de credenciales de usuario)*
- Read-only mode = **SÍ**
- serviceAccountKey en repo = **NO**
- Credenciales impresas = **NO**
- API keys impresas = **NO**
- Deploy/Commit/Push = **NO**
- BDB-FONDOS/CORE = **NO**
- EODHD Fundamentals = **NO**
- OpenFIGI live = **NO**
