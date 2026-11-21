# F3-A inventario read-only de roots legacy EODHD

Fuente: backup local `data/backups/2026-07-02/assets_roots.ndjson.gz` y `assets_subcollections.ndjson.gz`.

Resultado: el backup contiene 770 roots en `assets/`; 15 tienen id no ISIN. No aparece `EODHD:GSPC.INDX` en este snapshot. El grep exacto sobre `3-BDB-ACTIVOS_app/functions_python` y `3-BDB-ACTIVOS_app/src` no encuentra referencias vivas a estos ids; las coincidencias exactas existentes son fixtures/tests. Las funciones de optimizacion/backtest leen `price_series` por `asset_id` dinamico recibido, no por ids hardcodeados.

| id legacy | tipo | ISIN en root | subcolecciones | referencias vivas | propuesta antes de GO |
|---|---:|---|---|---|---|
| `eodhd_acwi_us` | ETF | `US4642882579` | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; crear/usar canonico ISIN antes de alias si se decide conservar cobertura ACWI. |
| `eodhd_agg_us` | ETF | `US4642872265` | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; crear/usar canonico ISIN antes de alias si se decide conservar cobertura AGG. |
| `EODHD_AMZN.US` | STOCK | - | listings:1, metrics:2, price_series:16 | Ninguna viva; solo `functions_python/tests/test_mappers.py` | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `eodhd_bnd_us` | ETF | - | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `EODHD_EEM.US` | ETF | - | listings:1, metrics:2, price_series:16 | Ninguna viva; solo tests de repository/portfolios/mappers | Archivar legacy; actualizar fixtures si esos tests pasan a usar canonico. |
| `EODHD_EFA.US` | ETF | - | listings:1, metrics:2, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `eodhd_gld_us` | ETF | `US78463V1070` | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; crear/usar canonico ISIN antes de alias si se decide conservar cobertura GLD. |
| `EODHD_GOOGL.US` | STOCK | - | listings:1, metrics:2, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `EODHD_MSFT.US` | STOCK | - | listings:1, metrics:2, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `eodhd_nvda_us` | STOCK | - | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `eodhd_tsla_us` | STOCK | - | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `eodhd_vea_us` | ETF | - | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `eodhd_voo_us` | ETF | - | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `eodhd_vti_us` | ETF | `US9229087690` | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; crear/usar canonico ISIN antes de alias si se decide conservar cobertura VTI. |
| `eodhd_vwo_us` | ETF | - | listings:1, metrics:1, price_series:16 | Ninguna exacta en callables/app | Archivar legacy; no alias hasta disponer de ISIN canonico en root. |
| `EODHD:GSPC.INDX` | INDEX | - | No presente en backup 2026-07-02 | Ninguna viva; solo fixture `functions_python/tests/test_mappers.py` | Nada que archivar en este snapshot; si reaparece, conservar solo si se confirma benchmark necesario. |

STOP: no se ha escrito en Firestore ni se ha tocado `assets/`. Para el GO del punto 1b, ejecutar archivado gated: copiar doc y subcolecciones a `_archived_assets/{id}`, marcar root original `quality.status="ARCHIVED_LEGACY"`, anadir aliases solo si existe equivalente canonico ISIN y cerrar con postverify + audit drift 0.
