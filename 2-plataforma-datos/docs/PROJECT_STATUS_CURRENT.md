# Estado Actual del Proyecto (Project Status)

> **Documento unico de estado vivo. Ultima actualizacion: 2026-07-02.**
> Este documento sustituye a fotos operativas antiguas. El Manual Maestro y los informes historicos
> siguen siendo utiles como contexto, pero la foto vigente del proyecto vive aqui.

## 1. Foto Operativa

`BBDD-ACTIVOS-FINANCIEROS` es la maestra Firestore de activos financieros para BDB y futuros consumidores.
La plataforma actual mantiene **752 activos** y separa tres responsabilidades:

- `1-extractor`: obtiene y exporta datos fuente.
- `2-plataforma-datos`: valida, carga, republish, audita y hace backup de la maestra.
- `3-BDB-ACTIVOS_app`: consume la maestra via contratos/read-models y Cloud Functions.

La maestra de esta copia vive en el emulador de Firestore, proyecto `gestor-activos-local`, principalmente en `assets/{asset_id}`. Esta foto es del 02-07-2026, cuando el proyecto aun era BDB: la vigente esta en `AGENTS.md`, en la raiz.

## 2. Modelo Firestore Vigente

- `assets/{asset_id}`: documento raiz del activo.
- `assets/{asset_id}/listings/{listing_id}`: cotizacion/mercado.
- `assets/{asset_id}/price_series/{series_id}`: buckets de observaciones de precio, contrato `price-series.v1.1`.
- `assets/{asset_id}/metrics/latest`: metricas normalizadas, contrato `metrics.v1.1`.
- `assets/{asset_id}/holdings/latest`: holdings en documento unico.
- `assets/{asset_id}/holdings/manifest` + `assets/{asset_id}/holdings/manifest/chunks/{chunk_id}`: holdings troceados.
- `meta/search_index`: indice denormalizado para busqueda, contrato `search-index.v1`.

Regla de ownership: el cargador de plataforma puede escribir raiz, holdings, `metrics/latest` y
`meta/search_index` solo por rutas autorizadas. Los escritores de holdings no tocan `metrics`,
`listings` ni `price_series`.

## 3. Contratos Activos

La fuente de verdad de esquema esta en `contracts/`.

- Canónico extractor: `canonical/fondosdb-fund.v1`, `canonical/fondosdb-stock.v1`,
  `canonical/fondosdb-holdings.v1`.
- Maestra: `master/asset.v1.1`, `master/asset-stock.v1`, `master/holdings.v1.1`,
  `master/price-series.v1.1`, `master/metrics.v1.1`, `master/listing.v1`,
  `master/search-index.v1`.
- Lectura app: `read/asset-for-bdb.v1`.

Los validadores de escritura viven en la plataforma; la app mantiene una cache de contratos para
functions mediante `npm run sync:contracts` desde `3-BDB-ACTIVOS_app`.

## 4. Operativa de Plataforma

Comandos principales, siempre desde `2-plataforma-datos` y pasando el extractor con
`--input "..\1-extractor"`:

```text
npm run load:fondosdb -- --input <extractor> --ids <quality-ok|missing|all> --dry-run
npm run load:fondosdb -- --input <extractor> --ids <quality-ok|missing|all> --write
npm run republish:fondosdb -- --input <extractor> --ids all --dry-run
npm run republish:fondosdb -- --input <extractor> --ids all --write
npm run audit:consistency -- --input <extractor> --ids all
npm run archive:assets -- --ids <isin,isin> --out runs --dry-run
npm run archive:assets -- --ids <isin,isin> --out runs --write --reason "alta erronea"
npm run compact:price-series -- --dry-run
npm run backup:export
```

`load:fondosdb` crea nuevos activos de forma controlada. `republish:fondosdb` refresca campos
data-platform-owned de activos existentes, incluyendo `metrics/latest` y `meta/search_index`.
`archive:assets` (05-09-2026) archiva activos: copia restaurable local (`backup_<id>.json` en la
corrida), copia a `_archived_assets/{id}` con `quality.status=ARCHIVED_LEGACY`, retirada de
`assets/{id}` (raiz y subcolecciones) y de `meta/search_index`, postverify. Sin borrado fisico
sin copia. Lo lanza tambien el servicio de operaciones del extractor (Sistema > Operaciones de la app).
`audit:consistency` y los previews son solo lectura.

## 5. Gates y Seguridad

El gate unico para escrituras de plataforma en la maestra es:

```text
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES
```

Sin ese valor, cualquier `--write` de plataforma debe abortar. No se usan gates legacy de Firestore
para la plataforma. Las reglas permanentes siguen siendo:

- dry-run primero;
- postverify despues de escribir;
- sin deletes salvo script y autorizacion especificos;
- no versionar `.env`, `.env.local`, service accounts ni tokens;
- la app no ejecuta ingesta de plataforma.

## 6. Artefactos del Extractor

El extractor publica dos familias de artefactos y no son intercambiables:

- `export_bdb/{ISIN}.json`: canónico BDB, con campos `ms.*`, normalizacion y calidad. Es el input
  principal del loader, republish y audit de plataforma para raiz, holdings y mapping maestro.
- `export/*.ndjson`, especialmente `export/fondos.ndjson`: export universal en español, con bloques
  como `riesgo` y `rentabilidad`. Se usa como apoyo cuando el mapper necesita passthrough universal
  de performance/riesgo; la app no lo consume directamente.

## 7. Schedulers, Backups y Runbook

- Schedulers live de la app:
  - precios: `scheduled_refresh_prices`, protegido por `BDB_ACTIVOS_ENABLE_MASTER_WRITES` y
    `PRICES_WRITE_ENABLED`;
  - metricas: `scheduled_refresh_metrics`, protegido por `BDB_ACTIVOS_ENABLE_MASTER_WRITES` y
    `METRICS_WRITE_ENABLED`.
- Backup de plataforma: `npm run backup:export`.
- Antes de cualquier escritura: backup reciente, dry-run guardado, gate solo en la consola/entorno de
  ese comando, ejecucion con `--write`, postverify y audit.

## 8. Verificacion Recomendada

```text
npm test
npm run typecheck
npm run audit:consistency -- --input "..\1-extractor" --ids all
```
