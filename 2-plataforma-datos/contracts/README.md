# `contracts/` - Fuente de verdad del esquema BDB

*Creado 2026-06-28. Actualizado 2026-07-02.*

Este directorio es la **fuente de verdad** de la forma de datos en BDB. La plataforma escribe
Firestore validando contra `master/`; la app consume read-models validados y mantiene una cache de
schemas en `functions_python/contracts_cache/`.

## Capas

```text
contracts/
├── canonical/   salida del extractor = entrada del loader
├── master/      forma persistida en Firestore
├── read/        contratos de read-model para consumidores internos
└── public/      payloads publicos futuros, diferidos hasta segundo consumidor real
```

## Catálogo Vigente

| Contrato | Ruta / uso | Estado |
|---|---|---|
| `canonical/fondosdb-fund.v1` | `export_bdb/{ISIN}.json` para fondos | activo |
| `canonical/fondosdb-stock.v1` | `export_bdb/{ISIN}.json` para acciones | activo |
| `canonical/fondosdb-holdings.v1` | holdings del extractor (`procedencia` opcional por linea desde el 14-10-2026) | activo |
| `master/asset.v1.3` | `assets/{asset_id}` para fondo/ETF/indice maestro (anade `classification.official_benchmark`) | activo |
| `master/asset.v1.2` | forma anterior; todo documento v1.2 valida en v1.3 | historico |
| `master/asset.v1.1` | forma anterior; valida en v1.2 | historico |
| `master/asset-stock.v1.1` | `assets/{asset_id}` para acciones (dueno por bloque, provenance) | activo |
| `master/asset-stock.v1` | forma anterior; valida en v1.1 | historico |
| `master/holdings.v1.2` | `holdings/latest` y modo CHUNKED, con `provenance` opcional (fuente, fecha de obtencion, cobertura) | activo |
| `master/holdings.v1.1` | forma anterior; todo documento v1.1 valida en v1.2 | historico |
| `master/price-series.v1.1` | `assets/{id}/price_series/{series_id}` | activo |
| `master/metrics.v1.3` | `assets/{id}/metrics/latest` (risk_score_source admite SRI_KID) | activo |
| `master/metrics.v1.1`, `v1.2` | formas anteriores; validan en v1.3 | historico |
| `master/listing.v1` | `assets/{id}/listings/{listing_id}` | activo |
| `master/search-index.v1` | `meta/search_index` | activo |
| `read/asset-for-bdb.v1` | payload de lectura consumido por BDB-ACTIVOS | activo |

Se conservan versiones `v1` anteriores cuando documentan forma ya producida; los flujos nuevos deben
preferir las versiones `v1.1` cuando existan.

## Dueno de cada bloque (`x-owner`)

Desde `asset.v1.2` (hoy `v1.3`) y `asset-stock.v1.1` cada propiedad raiz declara su dueno, y el republish lo lee del
contrato (`src/loader/ownership.ts`) en vez de llevar listas propias:

- `plataforma`: lo reescribe el republish desde el canonico.
- `app`: lo escribe 3-BDB-ACTIVOS_app; el republish lo conserva (`holdings_summary`, `performance.valuation`
  via `x-owner-exceptions`).
- `legado`: sin escritor vigente; se conserva y solo cambia por migracion.
- `metadatos`: `asset_id`, `schema_version`, `updated_at`.

`x-owner-by-source` declara documentos enteros de la app (acciones/ETF `EODHD`, altas `MANUAL_DOCUMENTARY`).
`x-obsolete-root-keys` lista las unicas claves raiz que el republish puede borrar; cualquier otra clave no
declarada bloquea la reescritura de ese documento (conflicto de dueno) en vez de borrarse en silencio.
Los bloqueos de seleccion del equipo no viven en la maestra: estan en la app (`asset_selection_controls.json`).

## Dos Artefactos de Export del Extractor

El extractor produce dos familias de salida. Importa no mezclarlas:

- **Canónico BDB:** `export_bdb/{ISIN}.json`.
  Contiene la forma normalizada para BDB, campos `ms.*`, señales de calidad y datos preparados para el
  mapper. Es el input principal de `load:fondosdb`, `republish:fondosdb` y `audit:consistency`.
  La plataforma lo usa para construir raiz, holdings, `metrics/latest` y `meta/search_index`.
- **Universal ES:** `export/*.ndjson`, especialmente `export/fondos.ndjson`.
  Mantiene la salida universal en español con bloques como `riesgo`, `rentabilidad` y otros passthroughs.
  El loader puede consultarlo como apoyo de mapping cuando necesita esos campos universales; la app no lo
  consume directamente.

## Política de Versionado

- `v1` describe forma existente; `v1.1` añade campos compatibles.
- Un cambio incompatible exige `v2`, nunca editar silenciosamente un contrato vigente.
- `schema_version` y `updated_at` son metadata de contrato cuando el schema los define.
- Fechas/hora persistidas como string: ISO-8601 UTC con sufijo `Z`.
- Fechas puras: `YYYY-MM-DD`.

## Política de Validación

- Nadie escribe maestra sin validar contra `master/`.
- Nadie consume payload live sin validar forma minima en su frontera.
- `canonical/` es permisivo con campos adicionales porque el upstream puede crecer.
- `master/` es estricto en bloques bajo control de plataforma.
- Los bloques passthrough se mantienen abiertos solo donde el contrato lo explicita.

## Invariantes Relevantes

- `metrics/latest` es el documento vivo de metricas normalizadas, no un array embebido en root.
- `price_series` se lee concatenando buckets y deduplicando por `points[].date`.
- `meta/search_index` se reconstruye desde plataforma y valida con `search-index.v1`.
- Holdings pueden vivir como `SINGLE_DOCUMENT` o como manifest + chunks.
- No se escriben claves `null` cuando el contrato espera omision; esto evita drift y fallos de
  herramientas que no serializan bien `nullValue`.

## Gate de Escritura

Los writers de plataforma solo pueden escribir con:

```text
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES
```

Sin ese gate, cualquier `--write` debe abortar. `audit:consistency`, previews y validaciones son
read-only y no deben ejecutarse con el gate activo.
