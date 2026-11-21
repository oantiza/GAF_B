# Encargo a Codex — 70B · Cablear y correr el cargador único (DRY-RUN, sin escrituras)

**Modelo:** Codex GPT-5.5 alto · **Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`

**Contexto (solo lectura):**
- `C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb` (canónico `export_bdb/`, `export/*.ndjson`).
- Diseño y contratos ya escritos por Claude: `contracts/` (7 esquemas + `validators.ts`) y `src/loader/` (cargador nuevo).

**Objetivo:** que el cargador **compile** y corra en **dry-run**. NINGUNA escritura todavía.

## Reglas
- NO `--write`. NO definir `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES`. NO deploy. NO deletes. NO tocar los ~90 scripts legacy ni `BDB-FONDOS`.
- Si algo no compila, **arregla los nits de tipo** en `src/loader/*` y `contracts/validators.ts` (el diseño es de Claude; la compilación es tuya). Reporta qué cambiaste.

## Pasos
1. **Instalar validadores:** `npm i ajv ajv-formats`
2. **Typecheck:** `npm run typecheck` (`tsc --noEmit`).
   - Ya añadidos a `tsconfig.json`: `resolveJsonModule`, `esModuleInterop`.
   - Esperables/ok: que `contracts/validators.ts` resuelva los `import ... .json`. Si `tsc` se queja del default import de ajv, usa `import Ajv2020 from 'ajv/dist/2020'` (ya está así) con `esModuleInterop`.
3. **Dry-run OFFLINE** (no toca Firestore; valida lectura + mapeo + contrato + plan):
   ```bash
   npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids quality-ok --dry-run
   ```
   - Revisa `runs/loader_<id>/plan.json` y `plan.md`.
   - **Esperado** (verificado offline por Claude sobre los 574 reales): ~573 mapean y validan `master/asset.v1`; **1** sale `BLOCKED_REJECTED`; **0** `INVALID_CONTRACT`. Si aparece algún `INVALID_CONTRACT`, **páralo y repórtalo** (sería un desajuste de contrato a corregir, no escribas nada).
4. **Dry-run contra la maestra** (solo lectura; requiere `FIREBASE_PROJECT_ID` + serviceAccount, **sin** gate de escritura):
   ```bash
   npm run load:fondosdb -- --input "<dir>" --ids missing --targets root,holdings --dry-run
   ```
   - Esto resuelve `CREATE` (los que faltan, ~90) vs `SKIP_EXISTS` (los 404 ya cargados).
   - **Chequeo de cordura:** `SKIP_EXISTS` debería rondar los **404** ya existentes, y `CREATE` los **~90** que faltan. Reporta los `counts`.

## Qué devolver
- Los `counts` de ambos dry-runs (acciones) y la ruta de `runs/<id>/`.
- Cualquier `INVALID_CONTRACT` o error de compilación + qué tocaste.
- **No** ejecutes el piloto ni `--write`: Claude revisa el plan primero y luego autoriza el piloto de 5.

## Después (no en este encargo)
- F3: diff de **regresión** del writer contra los 404 (re-map → comparar campo a campo con el doc vivo → 0 cambios).
- Piloto de 5 con gate (`--limit 5 --write`), postverify, smoke en la app.
- Luego los 90, luego re-export de los 183.
