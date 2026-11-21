> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Encargo a Codex/usuario — 70N · Resolver o excluir el Grupo B (7 BLOQUEADO) en el extractor

**Frente:** EXTRACTOR `C:\Users\oanti\Proyectos\BDB\1-extractor` (Python, fondosdb). Corre en TU entorno (Morningstar suele estar bloqueado en otros). Cierra el residuo del audit F3.
**Origen:** `docs/INFORME_2026-06-30_AUDIT_14_LIVE_MISSING.md` (Grupo B) y allowlist `EXPECTED_LIVE_MISSING` en `src/loader/auditConsistency.ts`.

## Qué son (verificado, no especulación)
7 ISIN que la maestra no tiene porque el **fetch de fondosdb sale vacío**: en `1-extractor/data/funds/{ISIN}.json` -> `meta.fuentes={}`, `tipo_producto=unknown`, `calidad.score=0` (BLOQUEADO). En `config/fondos.csv` están como `ISIN,,fondo` (sin nombre). **Checksum ISIN VÁLIDO en los 7** (no es ISIN mal escrito) -> el problema es cobertura de fuente, no formato. El mapper de la plataforma los rechaza por `identity.name` ausente (correcto).

Los 7: `ES0127097030, ES0133593030, ES0141116030, IE00B4XYLM55, LU0049842692, LU0188151095, LU0564184074`.
Nota previa (`data/quarantine/blocked_2026-06-11/README.md`): `ES0141116030` = "ISIN roto"; `LU0188151095` y `LU0564184074` = "sustituir por clase comercializable España". (Estos 3 se sacaron de `fondos.csv` en su día pero una regeneración posterior los volvió a meter.)

## Objetivo
Por cada ISIN: **resolver** (re-fetch con datos reales) **o excluir** limpiamente del universo. Después, cargar los resueltos en la maestra y dejar la allowlist del audit reflejando solo lo que siga legítimamente fuera (idealmente vacía).

## Paso 1 — Re-fetch forzado (extractor)
```
cd C:\Users\oanti\Proyectos\BDB\1-extractor
python main.py update ES0127097030 ES0133593030 ES0141116030 IE00B4XYLM55 LU0049842692 LU0188151095 LU0564184074 --force
python main.py cnmv            # fuente oficial ES: puede resolver los 3 ISIN ES
```
Revisa `data/funds/<ISIN>.json`: ¿pasa a `meta.fuentes != {}`, `tipo_producto != unknown`, con nombre?

## Paso 2 — Triage por ISIN (los que sigan vacíos tras el Paso 1)
- **`ES0141116030` ("ISIN roto"):** confirma en CNMV. Si está liquidado/no existe -> quítalo de `config/fondos.csv` (exclusión definitiva).
- **`LU0188151095`, `LU0564184074` (sustituir por clase ES):** identifica el ISIN de la clase equivalente comercializable en España (busca el fondo por nombre en Morningstar/justETF). Luego:
  ```
  python main.py add <ISIN_CLASE_NUEVA> --tipo fondo
  ```
  y borra la línea del ISIN viejo en `config/fondos.csv`.
- **`ES0127097030`, `ES0133593030`, `IE00B4XYLM55`, `LU0049842692`:** decisión individual -> si una fuente los resuelve, quedan; si no, sustituir (como arriba) o excluir de `config/fondos.csv`.

## Paso 3 — Regenerar export (extractor)
```
python main.py export
python main.py bdb        # regenera export_bdb/{ISIN}.json (la entrada de la plataforma)
```
> Si excluiste un ISIN de `config/fondos.csv`, confirma que **ya no aparece** en `export_bdb/` (si reaparece como BLOQUEADO, el `bdb` lo sigue emitiendo: bórralo del export o filtra los BLOQUEADO).

## Paso 4 — Cargar los resueltos (plataforma, gated)
```
cd C:\Users\oanti\Proyectos\BDB\2-plataforma-datos
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
  npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\BDB\1-extractor" \
  --ids missing --include-review --targets root,holdings --write
```
- Crea solo los que ahora tengan datos válidos. `postverify_ok` = nº cargados, `errors 0`.

## Paso 5 — Actualizar allowlist + re-audit (plataforma)
- En `src/loader/auditConsistency.ts`, quita de `EXPECTED_LIVE_MISSING` los ISIN **resueltos** (pasan a matched) y los **excluidos** de `fondos.csv` (ya no están en `checked`). Deja solo los que sigan legítimamente bloqueados (objetivo: lista vacía).
- Re-audit:
  ```
  npm run audit:consistency -- --input "C:\Users\oanti\Proyectos\BDB\1-extractor" --ids all
  ```
  **Cierre:** `live_missing_unexpected 0` y `live_missing` = solo los que queden conscientemente fuera (idealmente 0).

## Reglas
Gate solo en el Paso 4. Create-only, idempotente, nunca borrar la maestra. El fetch corre en tu entorno. No commitear desde bash (índice Windows). Commitea al final: cambios de `config/fondos.csv`, `auditConsistency.ts` (allowlist) y este doc.

## Devolver
Resumen por ISIN (resuelto / sustituido por <ISIN> / excluido), el `write_summary.json` del Paso 4 y el `audit_summary.json` del Paso 5.
