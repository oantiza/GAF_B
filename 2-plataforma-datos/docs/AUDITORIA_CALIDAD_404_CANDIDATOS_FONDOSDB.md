# Auditoría de calidad — 404 candidatos root FondosDB

_Generado: 2026-06-18 · offline, coste cero, solo lectura · sobre `selected_create_assets_manifest.json` + fuente `export_bdb/`._

> Nota: el toolchain TypeScript no se ejecuta en este entorno, así que esto audita el **manifest sanitizado** (que refleja los payloads a escribir) y la **fuente local**, no el payload mapeado byte a byte. Reconfírmalo re-ejecutando el dry-run en tu máquina.

## Estructura del plan de escritura
- Candidatos: **404** / 404 esperados — ✅ OK
- Operación: `{'create': 404}` — ✅ OK (todo create-only)
- `listings_removed_from_root` en todos — ✅ OK
- Nº de campos del root: `{14: 404}` (14 = shape completo) — ✅ OK
- Hashes de payload duplicados: **0** — ✅ OK
- `asset_id` duplicados: **0** — ✅ OK
- ISIN con checksum válido: **404/404** — ✅ OK
- IWDA (IE00B4L5Y983) en excluidos — ✅ OK

## Cruce con fuente `export_bdb/` (404/404 con fichero)
- Candidatos sin fichero fuente: **0** — ✅ OK
- Campos PROHIBIDOS (`retrocession`/`economic_exposure`/…) en fuente: **ninguno** — ✅ OK
- `quality.ok` en fuente: `{'True': 404}` — ✅ OK
- Nulos en campos clave: name=0, currency=0, classification_v2 vacío=0, portfolio_exposure_v2 vacío=0 — ✅ OK

## Clase de inversión (informativo, no es `asset_type`)
- `classification_v2.asset_type` (fuente): `{'equity': 309, 'mixed': 18, 'fixed_income': 68, 'other': 6, 'money_market': 3}`
- El `asset_type` final del root es **FUND** para todos (lo fija el mapper); estos valores (equity/fixed_income/mixed/…) aterrizan en `classification.fondosdb_asset_type`. No es un error.

## Veredicto
**La calidad de contenido de los 404 candidatos es sólida:** create-only, shape completo (14 campos), sin duplicados, ISIN válidos, sin campos prohibidos, sin nulos en campos clave, IWDA excluido. No hay bloqueos de contenido. El bloqueo restante es de **estado** (C1: ¿existen ya?), que requiere el snapshot read-only en vivo.
