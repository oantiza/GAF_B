# Encargo a Codex — 70F · Cargar los 171 nuevos (144 limpios + 27 RF)

**Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS` · **Política ya aprobada por el usuario:** CREATE limpios + RF con `--include-review`; retener el resto. Escrituras create-only, gate de plataforma. La maestra pasa de **573 → 717 → 744**.

Triage (Claude) de los 185 nuevos: 144 CREATE · 27 RF incompleta (cargar) · 7 calidad BAJO (retener `loader_lists/retener_nuevos.txt`) · 7 sin nombre (BLOCKED, no cargables).

## Paso 1 — los 144 limpios
```bash
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
  npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" \
  --ids missing --targets root,holdings --write
```
- Crea los **144 CREATE** (los 34 REVIEW y 7 BLOCKED quedan fuera sin `--include-review`).
- **Esperado:** `postverify_ok` **144/144**, `errors` 0 (algún `CHUNK_REQUIRED` en carteras grandes es ok: root sí se crea, repórtalo).
- **REGLA DE PARADA:** si `postverify_failed > 0` o hay errores no-CHUNK, **para y reporta**. No sigas al Paso 2.

## Paso 2 — los 27 de RF (solo si el Paso 1 fue limpio)
```bash
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
  npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" \
  --ids loader_lists/cargar_nuevos_rf.txt --include-review --targets root,holdings --write
```
- **Esperado:** `postverify_ok` 27/27.

## Confirmación final (read-only)
```bash
npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all
```
- Esperado: `SKIP_EXISTS ≈ 744`, `REVIEW_HOLD 7` (calidad BAJO retenidos), `BLOCKED_REJECTED 7` (sin nombre), `CREATE 0`.

## Reglas
Gate solo en las dos órdenes de escritura. Create-only, sin deletes/deploy, no imprimir secretos.

## Devolver
`write_summary.json` de cada paso (`writes_executed / postverify_ok / errors`) y el `counts` del `--ids all` final.

## Pendiente menor (fondosdb, aparte)
Los 7 BLOCKED no tienen `identity.name` en el canónico: `ES0127097030, ES0133593030, ES0141116030, IE00B4XYLM55, LU0049842692, LU0188151095, LU0564184074`. Cuando fondosdb les resuelva el nombre, entran solos en el siguiente `--ids missing`.
