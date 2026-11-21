# Encargo a Codex — 70H · Audit v3 (routing por población) + commit

**Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`. Lo que sigue necesita TU entorno (creds Firestore, git). El diseño/implementación ya está hecho y verificado en sandbox por Claude.

## Ya implementado + verificado por Claude (sandbox)
- `src/loader/auditConsistency.ts`: enrutado por población (acciones→`buildStockRow`, fondos→`mapFondosDbFund`), excluye `performance.valuation.*`, añade `by_population`.
- `contracts/canonical/fondosdb-stock.v1.schema.json`: **74/74** acciones validan.
- `contracts/master/asset-stock.v1.schema.json` (**NUEVO**, cierra el §6): **74/74** roots emulados (buildStockRow) validan; cross-check: una acción NO valida `master/asset.v1` (contratos separados, riesgo cero para los 573 fondos).
- `contracts/validators.ts`: cableados `canonicalStock` + `masterAssetStock`.

## Pasos (TÚ)
1. **Typecheck:** `npm run typecheck` (`tsc --noEmit`) — confirmar que compila con el import nuevo de `asset-stock.v1.schema.json`.
2. **Audit v3** (read-only, creds; **NO** definas `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES`):
   ```bash
   npm run audit:consistency -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all
   ```
   **Esperado:** `by_population.stock` ≈ todo `matched` (ya no driftan, se juzgan contra su propio oráculo); `by_population.fund` = solo el residuo de **republicar** (`portfolio_exposure`/`fixed_income_profile`, fuente 28-jun > carga vieja) + **~3 misc genuinos**. Trae `audit_summary.json` (incluido `by_population`) y los ~3 drifts de fondo no-republish.
3. **Commit** (receta Windows; NO commitees desde bash por la corrupción de índice): 
   - `src/loader/auditConsistency.ts`
   - `contracts/canonical/fondosdb-stock.v1.schema.json`
   - `contracts/master/asset-stock.v1.schema.json`
   - `contracts/validators.ts`
   - `docs/INFORME_SESION_2026-06-29_AUDIT_F3_EQUITY.md`, `docs/PROMPT_CODEX_70H_AUDIT_V3_COMMIT.md`
   - (y `package.json`/`tsconfig.json` si quedaron sin commitear del loader)

## Qué devolver
`audit_summary.json` (sobre todo `by_population` + `drift_by_top_field`) y la lista de los ~3 drifts de fondo genuinos (no republish). Con eso Claude decide el residuo (republish vs piloto de fondos).

## Después
- Residuo de fondos = **republicar** exposure/FI de los viejos con el loader (create-only no actualiza → hará falta un modo update acotado, o recarga). Claude lo dirige.
- Fleco menor: `fondosDbMapper.ts` L119 hardcodea `product.has_listing:false` (incorrecto para fondos/ETF cotizados; baja prioridad).
