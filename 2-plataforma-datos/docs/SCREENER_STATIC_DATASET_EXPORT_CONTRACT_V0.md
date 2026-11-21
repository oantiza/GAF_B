# Screener Static Dataset Export Contract v0

Documento ligero para definir el futuro JSON publico que podra consumir
`Screener-Buscador-MVP` como dataset estatico local. Este contrato no ejecuta
exportaciones reales todavia y no habilita lecturas raw de Firestore desde el
frontend.

## Objetivo

Generar en el futuro un archivo publico compatible con:

```text
public/data/screener-assets.mock.json
```

El archivo debe servir como snapshot de lectura para demos, previews y
prototipos de screener sin backend propio, sin credenciales y sin SDK de
Firebase en el consumidor.

## Shape esperado

```json
{
  "dataset_id": "screener-assets.mock",
  "version": "YYYY-MM-DD",
  "mode": "LOCAL_MOCK_ONLY",
  "notice": "Dataset estatico local para demo del Screener-Buscador MVP.",
  "assets": [
    {
      "asset_id": "stock_mock_001",
      "name": "[MOCK LOCAL] Apple Inc.",
      "asset_type": "STOCK",
      "isin": "US0378331005",
      "ticker": "AAPL.US",
      "coverage_status": "COVERED",
      "classification": {
        "asset_class": "EQUITY",
        "region": "US",
        "currency": "USD",
        "market": "US"
      },
      "available_sections": ["summary", "profile"],
      "mock_metrics": {
        "price_today": 189.45,
        "ytd_return": 8.3
      }
    }
  ]
}
```

## Campos publicos del dataset

| Campo JSON | Origen publico actual | Regla |
| --- | --- | --- |
| `dataset_id` | Nuevo metadato de export | Identificador estable del snapshot. |
| `version` | Nuevo metadato de export | Fecha o version semantica del snapshot. |
| `mode` | `PublicReadCostEstimate.mode` / preview screener | Para MVP debe ser `LOCAL_MOCK_ONLY` o equivalente futuro de snapshot publico. |
| `notice` | Nuevo metadato de export | Texto visible para aclarar que no es acceso productivo directo. |
| `assets[].asset_id` | `PublicAssetOverview.asset_id` / `ScreenerSearchResult.asset_id` | Publico y estable. |
| `assets[].name` | `PublicAssetOverview.identity.name` o `ScreenerSearchResult.display_name` | Publico, normalizado para UI. |
| `assets[].asset_type` | `PublicAssetType` | Solo `FUND`, `ETF`, `STOCK`, `INDEX`, `OTHER` o `UNKNOWN`; nunca `EQUITY`. |
| `assets[].isin` | `PublicAssetOverview.identifiers.isin` | Publico si existe. |
| `assets[].ticker` | `PublicAssetOverview.identifiers.ticker` | Publico si existe; debe incluir mercado si evita ambiguedad. |
| `assets[].coverage_status` | `PublicCoverageStatus` o mapping MVP | Publico; puede mapearse a `COVERED`, `UNCOVERED`, `UNKNOWN` para MVP. |
| `assets[].classification.asset_class` | `PublicAssetOverview.classification.asset_class` | Publico; aqui si puede aparecer `EQUITY`. |
| `assets[].classification.region` | Read model publico o enrichment normalizado | Publico si esta normalizado. |
| `assets[].classification.currency` | Read model publico o listing/price summary | Publico si esta normalizado. |
| `assets[].classification.market` | `primary_listing.exchange` o listing summary | Publico si esta normalizado. |
| `assets[].available_sections` | `ScreenerSearchResult.available_sections` | Publico, pero solo secciones resumen. |
| `assets[].mock_metrics.price_today` | `metrics_latest` reducido | Publico si es snapshot resumido; no serie completa. |
| `assets[].mock_metrics.ytd_return` | `metrics_latest` reducido | Publico si es snapshot resumido; no calculo raw pesado. |

## Campos no publicos

No deben aparecer en el JSON:

- Credenciales, `.env`, service accounts, tokens o claves.
- Paths raw de Firestore, nombres internos de colecciones o subcolecciones.
- Objetos raw completos de proveedores como EODHD, OpenFIGI o imports heredados.
- Historicos completos de precios, `price_series`, arrays diarios o intradiarios.
- Holdings completos, chunks de holdings o posiciones linea a linea.
- Payloads de escritura, write gates, rollback plans o artifacts internos.
- Rutas locales absolutas del equipo de desarrollo.

## Mapping desde contratos actuales

### Desde `PublicAssetOverview`

- `asset_id` -> `assets[].asset_id`
- `asset_type` -> `assets[].asset_type`
- `identity.name` -> `assets[].name`
- `identifiers.isin` -> `assets[].isin`
- `identifiers.ticker` -> `assets[].ticker`
- `classification.asset_class` -> `assets[].classification.asset_class`
- `coverage_status` -> `assets[].coverage_status` mediante mapping de MVP
- `read_cost_estimate` -> no se exporta por activo; queda como metadato o warning de adapter

### Desde `PublicFundOverview`

- `product.fund_name` puede alimentar `assets[].name` si `identity.name` falta.
- `product.provider` no es obligatorio; si se publica, debe ser campo de resumen futuro.
- `holdings_summary` puede alimentar `available_sections`, pero no holdings completos.

### Desde `PublicMarketAssetOverview`

- `primary_listing.exchange` -> `assets[].classification.market`
- `primary_listing.ticker` o `identifiers.ticker` -> `assets[].ticker`
- `metrics_latest` -> `mock_metrics` solo con valores resumidos seguros.
- `price_series_summary.available_series` puede alimentar `available_sections`, pero no series completas.

### Desde `ScreenerSearchResult`

- `display_name` -> `assets[].name`
- `identifiers` -> `isin` / `ticker`
- `summary.asset_class` -> `classification.asset_class`
- `summary.provider_or_exchange` -> posible `classification.market` o proveedor futuro
- `available_sections` -> `available_sections`

## Reglas obligatorias

- No credenciales en el JSON ni en el frontend.
- No raw Firestore en el frontend.
- No Firebase SDK ni Admin SDK en `Screener-Buscador-MVP`.
- No historicos completos.
- No holdings completos.
- No `asset_type: "EQUITY"`; para acciones usar `asset_type: "STOCK"` y
  `classification.asset_class: "EQUITY"`.
- `limit > 100` debe seguir bloqueado por el adapter consumidor.
- La busqueda por nombre en el MVP solo puede ser `mock/local`; produccion
  requerira indice externo o snapshot preindexado, nunca collection scan.

## Decision de contrato

El contrato v0 sera un snapshot estatico y publico, pensado para UI y demos.
No sustituye el Query Layer/Search Layer productivo y no expone Firestore. El
export real queda pospuesto hasta que exista una tarea explicita de generacion,
validacion y publicacion del archivo.

