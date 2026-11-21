> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo a Codex — 70O · Commit limpio (plataforma + extractor) tras cierre F3/F4

**Repos:** plataforma `C:\Users\oanti\Proyectos\BDB\2-plataforma-datos` · extractor `C:\Users\oanti\Proyectos\BDB\1-extractor`.
**Contexto:** trabajo verificado SIN commitear. Detalle: `docs/RUNBOOK_COMMIT_LIMPIO_2026-06-30.md`.
**Entorno Windows (ojo):** el índice git se corrompe (`improper chunk offset`) y `tsc -b` EMITE artefactos in-place. **No uses `tsc -b`.**

## A. Plataforma

### Cambios a commitear
- `src/loader/auditConsistency.ts` — reparado (tenía 597 bytes NUL) + allowlist `EXPECTED_LIVE_MISSING` vacía + instrumentación `live_missing_ids`.
- `src/loader/cli.ts` · `planner.ts` · `writer.ts` — cargador único enruta por población (acciones→`master/asset-stock.v1`, fondos→`master/asset.v1`). Aditivo: el flujo de fondos no cambia.
- `docs/INFORME_2026-06-30_AUDIT_14_LIVE_MISSING.md`, `PROMPT_CODEX_70M_CARGAR_GRUPO_A.md`, `PROMPT_CODEX_70N_GRUPO_B_EXTRACTOR.md`, `RUNBOOK_COMMIT_LIMPIO_2026-06-30.md`.

### Pasos
1. **Regenerar índice:**
   ```
   del .git\index
   git reset
   git status
   ```
   No debe aparecer "improper chunk offset". **PARA y reporta si persiste.**
2. **Sanidad NUL** (debe decir "limpio"). **PARA si dice NUL:**
   ```
   node -e "const b=require('fs').readFileSync('src/loader/auditConsistency.ts'); console.log(b.includes(0)?'NUL!':'limpio')"
   ```
3. **Typecheck SIN emitir** (0 errores; no crea .js/.d.ts). **No `tsc -b`. PARA si hay errores:**
   ```
   npx tsc -p tsconfig.check.json
   ```
4. **Ignorar build TS** — añade a `.gitignore` (no hay .js fuente, es seguro):
   ```
   *.js
   *.d.ts
   *.d.ts.map
   *.js.map
   *.tsbuildinfo
   ```
5. **Comprobar que no se cuelan artefactos:** `git status` no debe listar `.js`/`.d.ts`. Si los lista (de un `tsc -b` previo), NO los añadas: quedan ignorados por el paso 4.
6. **Commits (separados por tema):**
   ```
   git add .gitignore && git commit -m "chore: ignorar build TS emitido por tsc"
   git add src/loader/auditConsistency.ts && git commit -m "fix(audit): reparar auditConsistency (NUL) + allowlist live_missing vacia"
   git add src/loader/cli.ts src/loader/planner.ts src/loader/writer.ts && git commit -m "feat(loader): cargador unico enruta acciones a master/asset-stock.v1"
   git add docs/INFORME_2026-06-30_AUDIT_14_LIVE_MISSING.md docs/PROMPT_CODEX_70M_CARGAR_GRUPO_A.md docs/PROMPT_CODEX_70N_GRUPO_B_EXTRACTOR.md docs/RUNBOOK_COMMIT_LIMPIO_2026-06-30.md && git commit -m "docs: auditoria live_missing + 70M/70N + runbook"
   ```
   (Opcional: `git add tsconfig.check.json && git commit -m "chore: tsconfig de typecheck sin emitir"`.)

## B. Extractor
El borrado de ES0141116030 ya está hecho; la mayoría de rutas están gitignored (`export_bdb/`, `data/history/`, `cache/`). Si `data/quarantine/...ES0141116030.json` estaba versionado, saldrá como deleted.
```
del .git\index & git reset      # solo si el índice da "improper chunk offset"
git status
git add -A
git commit -m "chore(extractor): eliminar ES0141116030 (fondo inexistente)"
```
Ya existe `455219f` (CNMV + exclusiones); esto es el borrado adicional de rastros.

## C. (Opcional) Re-verificar cierre F3 (read-only, requiere creds)
```
npm run audit:consistency -- --input "C:\Users\oanti\Proyectos\BDB\1-extractor" --ids all
```
Esperado: `matched 752`, `drifted 0`, `live_missing 0`, `live_missing_unexpected []`.

## Reglas
- No commitear con el índice corrupto (regenéralo primero).
- No `tsc -b` (emite); typecheck = `npx tsc -p tsconfig.check.json`.
- Nunca borrar de la maestra Firestore: estos borrados son SOLO ficheros del extractor.
- Create-only, sin deploy, no imprimir secretos.

## Devolver
`git log --oneline -6` de cada repo, el `git status` final (limpio salvo ignorados) y, si corriste C, el `audit_summary.json`.
