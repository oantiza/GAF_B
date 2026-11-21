# BLOQUE 7I-FONDOSDB-7 — Real Write 404 Root Assets

## Resumen ejecutivo
Bloque autorizado para crear en Firestore SOLO los 404 root assets nuevos de
FondosDB (assets/{asset_id}), excluyendo IWDA (assets/IE00B4L5Y983). Las
precondiciones de **datos** se validaron y son correctas, pero el **write real
NO se ejecutó**: el entorno de ejecución actual no dispone de credenciales, ni
del flag de escritura, ni de red a Firestore, ni de un toolchain TypeScript
ejecutable. Estado final: **BLOCKED_SAFE**. No se escribió ni borró nada.

## 404 root assets a crear
- selected_create_count = 404 (exacto, único, todos con forma assets/{asset_id}).
- Fuente: artifacts/fondosdb_root_assets_write_authorization_preview_0.
- Manifest de ejecución preparado: artifacts/fondosdb_root_assets_real_write_0/pre_write_manifest.json
- Operación: create only (doc.create(), falla si el documento ya existe; nunca set/merge).

## IWDA excluido
- assets/IE00B4L5Y983 excluido y **ausente** del set de creates (verificado).
- IWDA modificado: NO.

## Firestore writes ejecutados
- Firestore writes: 0 (BLOCKED_SAFE, write no ejecutado).
- created paths: 0 / 404 · failed paths: 0.

## Firestore deletes = 0
- Firestore deletes ejecutados: 0. El runner nunca invoca delete().

## Rollback disponible
- artifacts/fondosdb_root_assets_real_write_0/rollback_manifest.json
- Como no hubo creates, el set de rollback está vacío. Plantilla por path para un
  write real: { rollback_action: "delete_if_created", previous_document_existed: false }.

## Post-write verification
- artifacts/fondosdb_root_assets_real_write_0/post_write_verification.json
- verification_executed = false (no hubo write; tampoco hay creds/red para leer).
- En un write real el runner lee de vuelta los 404 docs y compara hash payload.

## Confirmación de seguridad
- holdings incluidos: NO · listings en root: NO · price_series: NO · metrics precio/listing: NO.
- BDB-FONDOS tocado: NO · BDB-FONDOS-CORE tocado: NO.
- Paquete input modificado: NO · credenciales impresas/creadas: NO.
- .env / .env.local / serviceAccountKey: NO tocados.

## Motivo del BLOCKED_SAFE (entorno)
1. Fichero de credenciales ausente (cred file exists: false).
2. FIRESTORE_REAL_WRITE_ENABLED != 'true'; FIRESTORE_LIVE_READONLY = 'true'.
3. Sin red a firestore.googleapis.com (DNS EAI_AGAIN).
4. tsx/vitest no ejecutables: node_modules para win32, faltan binarios nativos linux-x64.

## Artefactos generados
- artifacts/fondosdb_root_assets_real_write_0/pre_write_manifest.json
- artifacts/fondosdb_root_assets_real_write_0/write_result_summary.json
- artifacts/fondosdb_root_assets_real_write_0/rollback_manifest.json
- artifacts/fondosdb_root_assets_real_write_0/post_write_verification.json
- artifacts/fondosdb_root_assets_real_write_0/safety_check_summary.json
- artifacts/fondosdb_root_assets_real_write_0/real_write_summary.md
- scripts/runFondosDbRootAssetsRealWrite.ts (runner create-only, gated)
- package.json: script "firestore:fondosdb-root-assets-real-write"

## Ejecución del write real (cuando haya entorno autorizado)
1. `npm ci`  2. credenciales + `FIRESTORE_REAL_WRITE_ENABLED=true`
3. `npm run firestore:fondosdb-root-assets-real-write`

## No commit / No push / No deploy
- commit = NO · push = NO · deploy = NO.

---

## Actualización 7I-FONDOSDB-7B — Chunking fix + imports/ gitignore

**Qué pasó en el primer intento real:**

- El primer intento real de write de los 404 root assets **no escribió nada**. Firestore lo rechazó con `3 INVALID_ARGUMENT: Transaction too big. Decrease transaction size.` (el batch único era demasiado grande). Resultado: created=0, failed=404, deletes=0.
- El snapshot readonly posterior confirmó: total_paths=405, existing_assets=1 (IWDA), missing_assets=404, writes=0, deletes=0.

**Correcciones de este bloque (sin write real):**

- El runner `scripts/runFondosDbRootAssetsRealWrite.ts` ahora escribe **por chunks pequeños** en lugar de un único batch:
  - chunk size por defecto **25**, configurable con `FONDOSDB_ROOT_ASSETS_WRITE_CHUNK_SIZE` (válido 1–50; fuera de rango → BLOCKED_SAFE).
  - 404 documentos ⇒ **17 chunks** con tamaño 25.
  - cada documento se escribe con `doc.create()` (create-only; nunca set/merge).
  - **si un chunk falla, se para inmediatamente** (no se intentan chunks posteriores).
  - el `rollback_manifest` contiene **solo** los paths realmente creados; deletes siempre 0.
  - summaries añaden: `chunk_size`, `total_chunks`, `chunks_attempted`, `chunks_succeeded`, `chunks_failed`, `created_paths_count`, `failed_paths_count`, `status`.
- `imports/` queda **protegido en `.gitignore`** para no subir el paquete FondosDB (~20 MB) a GitHub.

**Estado:** el runner queda preparado para el reintento real por chunks. En este bloque **no se ejecutó write real** (FIRESTORE_REAL_WRITE_ENABLED no activado): status BLOCKED_SAFE, created=0, failed=0, deletes=0, base_real_writes=0.

---

## Actualización 7I-FONDOSDB-7C — Carga de entorno antes de Firebase Admin

**Síntoma:** al ejecutar el runner con `FIRESTORE_REAL_WRITE_ENABLED=true` fallaba con `SECURITY FAULT: Failed to initialize Firebase Admin`. El script readonly sí cargaba `.env.local`; el real-write no lo hacía igual.

**Cambio:** `scripts/runFondosDbRootAssetsRealWrite.ts` carga ahora `.env.local` y `.env` **a nivel de módulo**, idéntico a `runFondosDbRootAssetsReadonlySnapshot.ts`, **antes** de inicializar Firebase Admin. Orden seguro: cargar env → validar flags → validar manifest → inicializar Firebase Admin **solo** si `FIRESTORE_REAL_WRITE_ENABLED === 'true'`.

**Diagnóstico de entorno seguro** (solo booleanos; nunca se imprime la ruta ni secretos): `env_loaded`, `firebase_project_id_present`, `firebase_service_account_path_present`, `google_application_credentials_present`, `service_account_path_exists`. Se vuelca en `artifacts/fondosdb_root_assets_real_write_0/env_diagnostics.json` y en los summaries.

**Mejora de visibilidad:** si la ruta de credenciales no existe, el runner ahora corta con un mensaje claro (`service account path does not exist`) **antes** de la inicialización opaca de Firebase Admin.

**Nota técnica:** el mensaje original «Failed to initialize Firebase Admin» se produce en `firestoreAdminProvider.initialize()` *después* de validar projectId, ruta de credenciales y existencia del fichero. Si tras este fix el error persiste con el flag activado, el `env_diagnostics` confirmará que el entorno carga bien y el foco pasará al **contenido/formato del service account JSON** o al proyecto Firebase, no a la carga de `.env.local`.

**Estado:** no se ejecutó write real (flag desactivado): BLOCKED_SAFE, created=0, failed=0, deletes=0, chunk_size=25, total_chunks=17.

---

## Cierre 7I-FONDOSDB-7D — Post-Write Closeout (readonly)

**El snapshot readonly (entorno real) confirma:** `total_paths=405`, `existing_assets=405`, `missing_assets=0`, `read_errors=0`, `blocked_paths=0`, `create_candidate_count=0`, `firestore_writes=0`, `firestore_deletes=0`.

**Estado operativo:** los **404 root assets FondosDB están presentes en Firestore** (además de IWDA `assets/IE00B4L5Y983`, preexistente e intacto). Verificación de forma por muestra: el documento `assets/BE0946564383` en Firestore tiene el mismo hash que el payload sanitizado del preview (14 campos) → **MATCH**. Sin holdings / listings root / price_series / metrics de precio.

**No reintentar write real:** `create_candidate_count=0`; los documentos ya existen y un `create-only` fallaría con *already exists*.

**Artefactos de cierre:** `artifacts/fondosdb_root_assets_post_write_closeout_0/` (`closeout_summary.json`, `existing_paths_verification.json`, `safety_check_summary.json`, `payload_shape_verification.json`, `rollback_status.json`, `closeout_summary.md`). Rollback disponible (404 creados, `delete_if_created`), **no ejecutado**; IWDA excluido del rollback.

**Pendiente:**
- Commit agrupado **selectivo**, excluyendo `imports/` (ya en `.gitignore`).
- En bloques separados y posteriores: decidir **holdings** (94.993) y los **91 fondos REVIEW**.

**Este bloque:** read-only. Firestore writes = 0, deletes = 0, base_real_writes = 0. commit/push/deploy = NO.
