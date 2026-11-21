# Encargo a Codex — 70E · Re-export de fondosdb (mete los 185) → dry-run del loader

**Repos:** fondosdb en `C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb` · loader en `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`.

**Diagnóstico (Claude):** los 185 "sin canónico" SÍ tienen Morningstar completo en `data/funds/` (esquema universal: `categoria_morningstar`, `clase_activo`, `cartera.asignacion_activos/posiciones`…). Fueron fetcheados el 27-jun, posteriores al último `export_bdb` (22-jun, 573). **Solo hay que re-generar el export.** No hace falta código nuevo.

## Paso 1 — Re-generar el export de fondosdb (en `DATOS FONDOS\fondosdb`)
```bash
python main.py bdb       # regenera export_bdb/ (canónico) para los 758 de data/funds
python main.py export    # regenera export/fondos.ndjson + posiciones.ndjson
```
- **Verifica:** `export_bdb/*.json` debe pasar de **573** a ~**750** (758 menos los ~8 sin Morningstar). Mira `export_bdb/_resumen.json` (`ok`, `errores`).
- Es regeneración de exports derivados; no toca `data/funds/` (la fuente). No subas nada a Firestore en este paso.

## Paso 2 — Dry-run del loader (en `BBDD-ACTIVOS-FINANCIEROS`, SIN escribir)
```bash
npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids missing --targets root,holdings --dry-run
```
- Ahora `missing` debería dar ~**177 nuevos** repartidos en `CREATE` / `REVIEW_HOLD` (como pasó con los 78: muchos RF saldrán REVIEW por duración/yield incompletos — es normal).
- **PARA aquí y devuélveme:** el `counts` del plan, la ruta `runs/<id>/plan.json`, y confirma `INVALID_CONTRACT = 0`. **No escribas todavía** — Claude revisa el plan y define el triage (CREATE limpios + RF con `--include-review` + retener asignación sospechosa), igual que con los 78.

## Reglas
Pasos 1-2 **sin** `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES`, sin `--write`, sin deletes/deploy. No imprimir secretos.

## Qué devolver
- `export_bdb` nuevo recuento + `_resumen.json` (ok/errores).
- `counts` del dry-run `--ids missing` + ruta del plan + `INVALID_CONTRACT`.
