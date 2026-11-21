> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo a Codex — 70M · Cerrar live_missing: cargar el Grupo A (7 multiactivo calidad BAJO)

**Repo:** `C:\Users\oanti\Proyectos\BDB\2-plataforma-datos` · **Extractor:** `C:\Users\oanti\Proyectos\BDB\1-extractor`
**Auditoría previa (Claude):** `docs/INFORME_2026-06-30_AUDIT_14_LIVE_MISSING.md`.

## Contexto
Los 14 `live_missing` del audit F3 = **7 cargables (Grupo A)** + **7 bloqueados aguas arriba (Grupo B)**.
El **Grupo A** son 7 fondos multiactivo (`mixed`) con `calidad_fondosdb=BAJO` — que en el mapper es **REVIEW, no rechazo** — listados en `loader_lists/retener_nuevos.txt`. Es el **mismo patrón** que los 13 retenidos que ya se cargaron en 70D (falsos positivos de calidad por multiactivo/apalancamiento). Verificado offline: tienen nombre, ISIN válido, `validation.ok=true`; el mapper los emite como REVIEW y validan `master/asset.v1` (precedente: los 13 de 70D, `postverify_ok 13/13`).

ISIN (los 7): DE0005318406, ES0116848005, FR0010041822, LU0119195963, LU0121216526, LU1883327816, LU1883340322.

## Pasos

1. **Typecheck:** `npm run typecheck` (o `tsc -b`). Incluye el audit instrumentado nuevo (volcado de `live_missing_ids` + allowlist). Debe dar 0 errores.

2. **Dry-run (READ-ONLY, NO definas el gate):**
   ```bash
   npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\BDB\1-extractor" \
     --ids loader_lists/retener_nuevos.txt --include-review --targets root,holdings --dry-run
   ```
   - **Esperado:** 7 en el plan, todos CREATE (REVIEW promovidos por `--include-review`), 0 escrituras. Revisa `runs/<id>/plan.json`.
   - **REGLA DE PARADA:** si el plan no son exactamente esos 7, **para y reporta**.

3. **Write gated:**
   ```bash
   BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
     npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\BDB\1-extractor" \
     --ids loader_lists/retener_nuevos.txt --include-review --targets root,holdings --write
   ```
   - **Esperado:** 7 CREATE (root [+holdings donde aplique]), `postverify_ok 7/7`, `errors 0`. Maestra **744 -> 751**.
   - **REGLA DE PARADA:** si `postverify_failed > 0` o hay errores no-CHUNK, **para y reporta**.

4. **Confirmación (read-only):**
   ```bash
   npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\BDB\1-extractor" --ids all
   ```
   - **Esperado:** `SKIP_EXISTS 751`, `REVIEW_HOLD 0`, `BLOCKED_REJECTED 7` (Grupo B, sin nombre), `CREATE 0`.

5. **Re-audit (read-only):**
   ```bash
   npm run audit:consistency -- --input "C:\Users\oanti\Proyectos\BDB\1-extractor" --ids all
   ```
   - **Esperado:** `matched 751`, `drifted 0`, `live_missing 7`, y **`live_missing_unexpected 0`** (los 7 restantes = allowlist Grupo B). Esa es la señal de F3 totalmente cerrada por el lado de la plataforma.

## Reglas
Gate solo en la orden de escritura del Paso 3. Create-only, idempotente. Sin deletes/deploy. No imprimir secretos. No commitear desde bash (corrupción de índice en Windows).

## Commit (lo necesario)
- `src/loader/auditConsistency.ts` — instrumentación: `live_missing_ids` / `live_missing_unexpected` / `no_canonical_ids` + allowlist `EXPECTED_LIVE_MISSING` (7 del Grupo B).
- `docs/INFORME_2026-06-30_AUDIT_14_LIVE_MISSING.md` y `docs/PROMPT_CODEX_70M_CARGAR_GRUPO_A.md`.
- Mensaje sugerido: `feat(audit): volcar live_missing_ids + allowlist Grupo B; cargar Grupo A (744->751)`.

## Devolver
`runs/<id>/write_summary.json` (writes_executed / postverify_ok / errors), el `counts` del `--ids all`, y el `audit_summary.json` del re-audit.

## Grupo B (NO en este encargo)
Los 7 sin `identity.name` (`ES0127097030, ES0133593030, ES0141116030, IE00B4XYLM55, LU0049842692, LU0188151095, LU0564184074`) NO son cargables: el fetch de fondosdb está vacío (score 0/10, BLOQUEADO). Frente del extractor (re-export / corregir ISIN / sustituir clase). Ya están en la allowlist del audit como exclusión esperada.
