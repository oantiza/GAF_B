# Brief — Snapshot read-only FondosDB (tarea acotada para agente local o ejecución manual)

> Tarea **estrictamente de solo lectura**. No escribe nada en Firestore.
> Sirve para confirmar si los 404 root assets existen o faltan (resuelve la contradicción C1).

## Tarea
1. `cd C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`
2. `npm ci`
3. Verificar que **`FIRESTORE_REAL_WRITE_ENABLED` NO está a `true`** (ausente o `false`).
4. Ejecutar (PowerShell):
   ```powershell
   $env:FIRESTORE_LIVE_READONLY="true"
   npm run firestore:fondosdb-root-assets-readonly-snapshot
   ```
5. Confirmar en la salida: `firestore_writes=0` y `firestore_deletes=0`.
6. Devolver el contenido de:
   - `artifacts/fondosdb_root_assets_readonly_snapshot_0/readonly_snapshot_summary.json`
   - `artifacts/fondosdb_root_assets_readonly_snapshot_0/conflict_detection_report.json`

## Prohibido (no hacer bajo ningún concepto)
- Activar `FIRESTORE_REAL_WRITE_ENABLED` o ejecutar cualquier script `*real-write*`.
- `git commit`, `git push`, deploy.
- Modificar `imports/` (paquete de entrada).
- Tocar `BDB-FONDOS` / `BDB-FONDOS-CORE`.
- Imprimir, copiar o compartir credenciales (`.env`, `.env.local`, `serviceAccountKey`).

## Resultado esperado
Un resumen con `existing_assets` y `missing_assets`. La **interpretación** (create-only vs no-op vs
update controlado, y verificación de phantom parents) se hace por separado con el contexto completo del proyecto.
