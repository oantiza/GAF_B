# Encargo a Codex — 70I · Republish DRY-RUN (refresca la población vieja) + commit del código

**Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`. Implementado por Claude: `src/loader/republish.ts` (modo update/upsert controlado) + script `republish:fondosdb`. **Verificado offline** (lógica `ownedDrift`/`mergeOwned` sobre docs sintéticos): refresca campos data-platform-owned y PRESERVA `listings` de fondos / `metrics` / `price_series` / `performance.valuation` (refresh diario); re-diff tras merge = 0. Guarda de **reclasificación** (fund↔stock) que aparta esos casos en vez de mezclarlos.

## Pasos
1. **Typecheck:** `npm run typecheck` (`tsc --noEmit`).
2. **Dry-run (READ-ONLY, NO definas el gate):**
   ```bash
   npm run republish:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all --dry-run
   ```
   - **Esperado:** `to_republish` ≈ **218** (fund ~204 / stock ~15), `reclassified` ≈ **1** (`NL0011821202` ING, fund→stock), `skipped_invalid` **0**, resto `matched`. 0 escrituras.
   - Trae `runs/republish_<id>/republish_summary.json`, `republish_plan.json` (qué activos + qué campos) y `reclassified.json`.
3. **Commit del CÓDIGO** (no toca la maestra): `src/loader/republish.ts` + `package.json` (script `republish:fondosdb`). (Receta Windows, no bash.)
4. **PARA aquí.** No `--write`. Claude revisa el plan antes de autorizar el write gated (será el 70J).

## Qué devolver
`republish_summary.json` (sobre todo `to_republish`, `by_population`, `reclassified`, `skipped_invalid`) + `reclassified.json`. Con eso Claude valida que el plan es sano y prepara el 70J (write gated + re-audit + commit).

## Reglas
Dry-run read-only; **no** definas `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES`; no deletes/deploy; no imprimir secretos.

## Después (70J, tras revisión de Claude)
Write gated (`--write` + gate) → republica los ~218 con postverify (re-diff=0) → re-audit (`audit:consistency --ids all`) esperando `matched`≈744, drift≈solo los 14 missing + ING → commit. ING (reclasificado) se trata aparte (limpieza de campos fund-only al pasar a stock).
