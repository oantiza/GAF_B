# Encargo a Codex — 70J · Republish WRITE (gated) + re-audit

**Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`. Plan del 70I **revisado y aprobado por Claude**: 221 a republicar (refresh-class; 2 duros conocidos `ES0105394003`+`IE000DR59CI3` que el republish corrige desde la fuente; `skipped_invalid 0`); 1 reclasificado (ING) que se trata aparte. Esta es la escritura más consecuente (overwrite de docs existentes), pero es **read-modify-write** (preserva listings/metrics/price_series/valuation) + **postverify** por activo.

## Paso 1 — Republish con gate
```bash
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
  npm run republish:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all --write
```
- **Esperado:** `republished` **221**, `postverify_ok` **221**, `postverify_failed` 0, `errors` 0, `reclassified` 1 (ING, NO tocado).
- **REGLA DE PARADA:** si `postverify_failed > 0` o `errors` no vacío, **para y reporta** (no sigas al re-audit). El republish es idempotente (re-ejecutar solo toca lo que aún derive).

## Paso 2 — Re-audit (read-only, sin gate)
```bash
npm run audit:consistency -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all
```
- **Esperado:** `matched` **743**, `drifted` **1** (solo `NL0011821202` ING, reclasificado), `live_missing` 14. (Era 522 matched / 222 drift.)

## Qué devolver
`republish_summary.json` (Paso 1) + el `audit_summary.json` del re-audit (Paso 2: `matched`/`drifted`/`by_population`).

## Reglas
Gate solo en el Paso 1. Create/overwrite-only de campos owned (sin deletes), read-modify-write. Sin deploy. No imprimir secretos. El código ya está commiteado (a2ba570); commitea solo si quedan artefactos `runs/` que rastrees.

## Después
- **ING (`NL0011821202`)** reclasificado fund→stock: cierre aparte (70K) — escribir el root stock + limpiar los campos fund-only (`costs`, `fixed_income_profile`) con `FieldValue.delete()`. Claude lo dirige.
- Quedan los 14 fuera de la maestra: 7 calidad BAJO (retenidos) + 7 sin nombre (fondosdb).
