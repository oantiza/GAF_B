# Encargo a Codex — 70K · Reclasificar ING (fund→stock) + re-audit final = cerrar F3

**Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`. Implementado por Claude: `src/loader/reclassifyStock.ts` + script `reclassify:stock`. **Verificado offline:** reescribe el doc como ROOT STOCK en reemplazo total → dropea `costs`/`fixed_income_profile` (fund-only), pone identifiers/product de acción, **preserva `performance.valuation`** (refresh diario); subcolecciones (metrics/price_series) intactas. Gate propio + postverify. Único caso real: **NL0011821202 (ING Groep)**.

## Pasos
1. **Typecheck:** `npm run typecheck`.
2. **Dry-run:** `npm run reclassify:stock -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --dry-run`
   - **Esperado:** `a_reclasificar 1` → `NL0011821202 FUND->STOCK dropea=costs,fixed_income_profile`. 0 escrituras.
   - **REGLA:** si `a_reclasificar != 1` o el ISIN no es `NL0011821202`, **para y reporta** (algo cambió).
3. **Write gated:**
   ```bash
   BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
     npm run reclassify:stock -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --write
   ```
   - **Esperado:** `postverify_ok 1/1`, `errors 0`.
4. **Re-audit final (read-only, sin gate):** `npm run audit:consistency -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all`
   - **Esperado:** `matched` **744**, `drifted` **0**, `live_missing` 14. → **F3 CERRADA: maestra 744/758 consistente con la fuente.**
5. **Commit:** `src/loader/reclassifyStock.ts` + `package.json` (script `reclassify:stock`). (Receta Windows.)

## Qué devolver
`reclassify_summary.json` + el `audit_summary.json` final (esperado matched 744 / drift 0 / missing 14).

## Reglas
Gate solo en el Paso 3. Reemplazo total del doc raíz (subcolecciones intactas), sin deletes de docs, sin deploy, no imprimir secretos.

## Estado tras 70K
Maestra 744/758, **0 drift** (100% consistente con la fuente). Los 14 fuera son genuinos: 7 calidad BAJO (retenidos) + 7 sin nombre (fondosdb debe nombrarlos). Frente de datos+consistencia (F1–F3) **CERRADO**. Queda lo estructural diferido: smoke app, consolidación física, ingestion_runs/, holdings CHUNKED, Mapper V2.
