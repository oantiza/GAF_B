# Encargo a Codex/Gemini — 70L · Propagar fix `has_listing` + activar `ingestion_runs/` + re-audit + commit

**Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`
**Contexto:** Claude ya implementó estos cambios EN EL REPO (sin commitear). Tu trabajo es compilar, propagar a la maestra (gated), verificar y commitear. NO reescribas el diseño.

### Cambios ya hechos por Claude
1. `src/ingestion/fondosdb/fondosDbMapper.ts` — `product.has_listing` deja de ser `false` hardcodeado; ahora `productType === 'ETF' || productType === 'ETC'` (ETF/ETC cotizan; fondos mutuos no).
2. `src/loader/ingestionRun.ts` (**nuevo**) — `writeIngestionRun(db, {run_id, kind, summary})` escribe `ingestion_runs/{run_id}` (traza de cada escritura).
3. Cableado de `writeIngestionRun` (tras `--write`) en `src/loader/republish.ts`, `reclassifyStock.ts` y `writer.ts` (loader).

### Pasos
1. **Typecheck:** `npm run typecheck` (`tsc --noEmit`). Si hay nits de tipo en esos 5 ficheros, arréglalos y di qué tocaste.
2. **Republish DRY-RUN** (read-only, sin gate) — propagará el nuevo `has_listing` a los ETF/ETC:
   ```bash
   npm run republish:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all --dry-run
   ```
   - **Esperado:** `to_republish` = los **ETF/ETC** cuyo `has_listing` pasa de false→true (el campo dominante en `republish_plan.json` será `product`). `reclassified 0` (ING ya está hecho). Trae el `to_republish` y los campos.
3. **Republish WRITE (gate)** — propaga `has_listing` y, de paso, escribe `ingestion_runs/{run_id}`:
   ```bash
   BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
     npm run republish:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all --write
   ```
   - **Esperado:** `republished` = (lo del dry-run), `postverify_ok` = igual, `errors 0`.
   - **Verifica `ingestion_runs`:** que exista `ingestion_runs/<run_id>` con `kind:"republish"` (lee ese doc con el Admin SDK; debe traer `summary`).
4. **Re-audit** (read-only, sin gate):
   ```bash
   npm run audit:consistency -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all
   ```
   - **Esperado:** vuelve a **`matched 744 / drifted 0 / live_missing 14`** (el `has_listing` ya consistente).
5. **Commit:** `fondosDbMapper.ts`, `src/loader/ingestionRun.ts`, `republish.ts`, `reclassifyStock.ts`, `writer.ts` (+ artefactos `runs/` si los rastreas). Mensaje sugerido: `Fix has_listing for ETF/ETC + ingestion_runs audit trail`.

### Reglas
Gate SOLO en el Paso 3. Read-modify-write (sin deletes). Sin deploy. No imprimir secretos/credenciales. No commitear desde bash si el índice se corrompe (receta Windows: borrar `.git/index.lock`+`.git/index` + `git reset`).

### Qué devolver
- `tsc` verde (o qué arreglaste).
- `to_republish` del dry-run + `republished/postverify_ok/errors` del write.
- Confirmación de que existe `ingestion_runs/<run_id>`.
- El `audit_summary.json` final (esperado 744/0/14).
