> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Runbook — commit limpio (BDB, Windows) · sesión 2026-06-30

Sin commitear: `auditConsistency.ts` (reparado de corrupción NUL + allowlist vacía), enrutado stock F4 (`cli.ts`/`planner.ts`/`writer.ts`) y 3 docs. Riesgos del entorno: índice git corrupto (`improper chunk offset`) y `tsc -b` que emite ~941 artefactos in-place. Este runbook commitea limpio sin reensuciar. **Nunca borrar de la maestra Firestore.**

## A. Plataforma — `C:\Users\oanti\Proyectos\BDB\2-plataforma-datos`

### A1. Regenerar el índice git corrupto (no toca tu working tree)
```
del .git\index
git reset
git status        # ya no debe salir "improper chunk offset"
```

### A2. Typecheck SIN emitir (validado: 0 errores, 0 ficheros generados)
`tsconfig.check.json` ya está en el repo (composite:false + noEmit). Usa SIEMPRE esto en vez de `tsc -b` para validar:
```
npx tsc -p tsconfig.check.json
```
Evita `tsc -b`: emite .js/.d.ts/.map junto a las fuentes y limpiarlos sobre el mount fue lo que corrompió el índice.

### A3. Evitar el problema de raíz — ignorar el build TS
No hay `.js` fuente en el repo (verificado), así que es seguro. Añade a `.gitignore`:
```
# build emitido por tsc (no versionar)
*.js
*.d.ts
*.d.ts.map
*.js.map
*.tsbuildinfo
```

### A4. (Opcional) ¿el commit d8d94b4 capturó el fichero corrupto?
```
git show d8d94b4:src/loader/auditConsistency.ts | findstr /C:"new Set<string>([])"
```
Si no aparece limpio, no pasa nada: el working tree ya está reparado y se re-commitea en A5.

### A5. Commits (separados por tema; create-only, sin tocar la maestra)
```
git add .gitignore
git commit -m "chore: ignorar build TS emitido por tsc"

git add src/loader/auditConsistency.ts
git commit -m "fix(audit): reparar auditConsistency (NUL) + allowlist live_missing vacia"

git add src/loader/cli.ts src/loader/planner.ts src/loader/writer.ts
git commit -m "feat(loader): cargador unico enruta acciones a master/asset-stock.v1"

git add docs/INFORME_2026-06-30_AUDIT_14_LIVE_MISSING.md docs/PROMPT_CODEX_70M_CARGAR_GRUPO_A.md docs/PROMPT_CODEX_70N_GRUPO_B_EXTRACTOR.md docs/RUNBOOK_COMMIT_LIMPIO_2026-06-30.md
git commit -m "docs: auditoria 14 live_missing + encargos 70M/70N + runbook"
```
(Opcional: `git add tsconfig.check.json` para versionar la herramienta de typecheck.)

### A6. Verificación
```
git status            # limpio salvo lo ignorado
git log --oneline -6
```

## B. Extractor — `C:\Users\oanti\Proyectos\BDB\1-extractor`
El borrado de ES0141116030 cae sobre todo en rutas ya gitignored (`export_bdb/`, `data/history/`, `cache/`). Si `data/quarantine/...ES0141116030.json` estaba versionado, saldrá como deleted.
```
del .git\index & git reset     # solo si el índice da "improper chunk offset"
git status
git add -A
git commit -m "chore(extractor): eliminar ES0141116030 (fondo inexistente)"
```
Ya tenías `455219f` (CNMV + exclusiones); esto es el borrado adicional de rastros.

## Estado que deja cerrado
- F3 residuo 0: audit 752/752, drift 0, live_missing 0, allowlist vacía.
- Cargador único enruta por población (fondos→master/asset.v1, acciones→master/asset-stock.v1).
- ES0141116030 eliminado del extractor; nunca estuvo en la maestra.
