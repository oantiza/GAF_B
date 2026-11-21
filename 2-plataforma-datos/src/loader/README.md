# `src/loader/` — Cargador único canónico → maestra

Reemplaza los ~90 scripts de un solo uso por **un comando parametrizado**. Lee el canónico de
fondosdb, reusa el **mapper V1 probado** (el que produjo los 404), **valida contra los contratos**
(`contracts/master/*`) y escribe **create-only, gated, con postverify**.

## Piezas

| Archivo | Rol |
|---|---|
| `packageReader.ts` | Lector **agnóstico de fecha/recuento** (sin el manifiesto hardcodeado `2026-06-12` ni el `!== 496`). Holdings construidos verbatim respecto al reader legacy → paridad con los 404. |
| `planner.ts` | **Puro** (sin I/O). Mapea, valida contra `master/asset.v1` y decide acción. |
| `writer.ts` | Gated, create-only, postverify. Gate **propio de plataforma**. |
| `ingestionRun.ts` | Auditoria de corridas de escritura en `ingestion_runs/{run_id}` con `created_at` ISO UTC y `created_at_ts` Timestamp servidor para TTL. |
| `cli.ts` | Orquesta y escribe artefactos en `runs/<run_id>/`. |
| `types.ts` | Tipos del cargador. |

## Acciones del planner

`CREATE` · `SKIP_EXISTS` (ya en la maestra) · `REVIEW_HOLD` (mapper REVIEW, requiere visto bueno) ·
`BLOCKED_REJECTED` (mapper rechaza) · `REEXPORT_REQUIRED` (sin canónico → fondosdb debe re-exportar) ·
`INVALID_CONTRACT` (no valida `master/asset.v1` → bug, bloqueado).

## Uso

```bash
# requisito (una vez): validadores de contrato
npm i ajv ajv-formats
# tsconfig: "resolveJsonModule": true, "esModuleInterop": true

# DRY-RUN offline (no toca Firestore): plan de los 'quality-ok'
npx tsx src/loader/cli.ts --input "C:/Users/oanti/Proyectos/DATOS FONDOS/fondosdb" --ids quality-ok --dry-run

# DRY-RUN de los que faltan en la maestra (requiere credenciales de solo lectura)
npx tsx src/loader/cli.ts --input "<dir>" --ids missing --targets root,holdings --dry-run

# PILOTO de 5, escritura real (requiere el gate de plataforma)
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
  npx tsx src/loader/cli.ts --input "<dir>" --ids quality-ok --limit 5 --write

# Solo meta/search_index. En seco compara el índice del paquete con el vivo y planifica
# search_index:set solo si hay deriva. Con --write (que, como todo --write del republish, exige
# --input y la población stock) escribe únicamente reconcileSearchIndexLive, desde las raíces vivas.
npm run republish:fondosdb -- --input "<dir>" --only-search-index --dry-run
```

### Flags

`--input <dir>` (raíz fondosdb) · `--export-bdb`/`--fondos`/`--posiciones` (overrides) ·
`--ids quality-ok|missing|all|<fichero>|<ISIN,ISIN>` · `--targets root[,holdings]` (def. `root`) ·
`--include-review` · `--limit N` · `--write` (def. dry-run) · `--out <dir_runs>`.

## Seguridad (writer)

- **Gate propio:** `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES`. Sin él, `--write` aborta.
- **Allowlist** de `FIREBASE_PROJECT_ID`: la de `src/config/projectAllowlist.ts`, que dice `gestor-activos-local`.
- **Create-only** (`doc.create()`): nunca sobrescribe; re-ejecutar omite lo existente. **Sin deletes.**
- **Validación de contrato** de cada documento antes de escribir.
- **Índice de búsqueda**: `meta/search_index` lo escribe solo `reconcileSearchIndexLive`, desde las raíces
  vivas tras las escrituras; si falla, la corrida sale con código 1.
- **Postverify**: re-lee cada root creado, y `meta/search_index` si la reconciliación lo escribió.
- Un canónico de acción sin fila en la población stock queda `BLOCKED_REJECTED`: nunca se carga como fondo.
- Artefactos por corrida en `runs/<run_id>/`: `plan.json`, `plan.md`, `write_summary.json`.

## Pendiente

- Diff de **regresión** del writer contra los 404 (F3): demostrar que reproduce los existentes sin cambios.
- `price_series`/`metrics`/`listings`: fuera del cargador de fondos (los lleva el flujo EODHD).
