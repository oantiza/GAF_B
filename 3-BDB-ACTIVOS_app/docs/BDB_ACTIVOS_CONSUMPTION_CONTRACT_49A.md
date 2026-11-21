# BDB-ACTIVOS consumption contract 49A

## Objetivo

Definir el contrato definitivo de consumo entre BDB-ACTIVOS y BBDD-ACTIVOS para la primera version de la app multi-activo.

BBDD-ACTIVOS es la base maestra. BDB-ACTIVOS debe consumir contratos publicos/adapters y no estructuras internas, rutas de almacenamiento, payloads raw ni logica legacy.

## Estado actual

| Bloque | Estado |
| --- | --- |
| Fuentes locales | `LOCAL_MOCK`, `BBDD_CONTRACT_FIXTURE`, `BBDD_STATIC_EXPORT_SAMPLE` |
| Intake estatico | Local, dry-run por defecto |
| Tipos soportados | `FUND`, `ETF`, `STOCK`, `INDEX` |
| Flujo UI | Busqueda, ficha, comparador, cartera manual y reporting local |
| Frontera actual | `AssetDataSource` + adapters locales |

## Decision de contrato

La primera version debe formalizar un contrato de consumo BDB con cinco superficies:

| Superficie | Contrato recomendado | Uso BDB |
| --- | --- | --- |
| Search | `AssetSearchResultForBdb` | Buscador, filtros, seleccion |
| Detail | `AssetDetailForBdb` | Ficha, comparador, cartera |
| History | `AssetHistoryForBdb` | Graficas y metricas futuras, carga lazy |
| Portfolio input | `PortfolioInputForBdb` | Cartera app-owned, optimizacion futura |
| Report input | `PortfolioReportInputForBdb` | Reporting local y futuro reporte |

Los nombres futuros deberian usar `Asset*ForBdb`, no `Fund*ForBdb`, aunque los contratos ACL actuales de BBDD aun conservan nombres historicos como `FundSearchResultForBdb`.

## Contrato recomendado

### Asset identity

| Campo BDB-ACTIVOS | Obligatorio | Fuente BBDD-ACTIVOS | Derivado en adapter | Opcional | Notas |
| --- | --- | --- | --- | --- | --- |
| `asset_id` | Si | `asset_id` | No | No | Identificador estable de activo maestro. |
| `display_name` | Si | `identity.display_name`, `display_name`, `product.fund_name` | Fallback de nombre | No | Texto principal de UI. |
| `isin` | No | `identity.isin`, `isin`, `identifiers.isin` | No | Si | Comun en fondos/ETF; puede faltar en indices o acciones. |
| `ticker` | No | `identity.ticker`, `ticker`, `identifiers.ticker`, listing principal | No | Si | Importante en STOCK/ETF/INDEX. |
| `provider` | No | `product.provider`, `provider`, exchange/listing | No | Si | Gestora, proveedor o mercado segun tipo. |

### Classification and role

| Campo BDB-ACTIVOS | Obligatorio | Fuente BBDD-ACTIVOS | Derivado en adapter | Opcional | Notas |
| --- | --- | --- | --- | --- | --- |
| `instrument_type` | Si | `instrument_type` o `asset_type` | Mapping `asset_type -> instrument_type` | No | Solo `FUND`, `ETF`, `STOCK`, `INDEX`. Nunca `EQUITY`. |
| `economic_asset_class` | Si | `economic_asset_class` o `classification.asset_class` | Mapping `REAL_ASSET/UNKNOWN -> OTHER` si BDB no lo soporta | No | Debe seguir separado del tipo instrumental. |
| `is_investable` | Si | Futuro flag publico si existe | Si | No | `INDEX` y benchmarks son no invertibles. |
| `role` | Si | Futuro role publico si existe | Si | No | `INVESTABLE` o `BENCHMARK`. |
| `coverage_status` | Si | `coverage_status` | Mapping a estados BDB | No | BDB usa `COMPLETE`, `PARTIAL`, `ROOT_ONLY`, `MISSING`. |

### Descriptive fields

| Campo BDB-ACTIVOS | Obligatorio | Fuente BBDD-ACTIVOS | Derivado en adapter | Opcional | Notas |
| --- | --- | --- | --- | --- | --- |
| `currency` | Si | `identity.currency`, listing, classification currency | Fallback controlado y warning si falta | No para UI | BDB necesita divisa para ficha, cartera y reporting. |
| `region` | No | `classification.region` | No | Si | Filtro/lectura descriptiva. |
| `category` | No | `classification.category` | No | Si | Categoria Morningstar/sector/benchmark group. |
| `description` | No | Resumen publico futuro | Si | Si | BDB puede generar texto corto desde campos seguros. |

### Metrics, costs and quality

| Campo BDB-ACTIVOS | Obligatorio | Fuente BBDD-ACTIVOS | Derivado en adapter | Opcional | Notas |
| --- | --- | --- | --- | --- | --- |
| `metrics.risk_score` | No | `quant_metrics.risk_score`, `metrics_latest` | Si hay reglas cuant | Si | No bloquear UI si falta. |
| `metrics.volatility_3y` | No | `quant_metrics.volatility_3y`, `metrics_latest` | No | Si | Comparador y reporting ponderado. |
| `metrics.annualized_return_3y` | No | `quant_metrics.annualized_return_3y` | No | Si | Puede faltar en fase inicial. |
| `metrics.sharpe_3y` | No | `quant_metrics.sharpe_3y` | No | Si | Opcional. |
| `metrics.max_drawdown_3y` | No | `quant_metrics.max_drawdown_3y` | No | Si | Opcional. |
| `costs.ongoing_charge` | No | `costs.ongoing_charge`, TER normalizado | No | Si | Aplica a FUND/ETF. STOCK no debe exigirlo. |
| `costs.management_fee` | No | `costs.management_fee` | No | Si | Aplica a fondos si existe. |
| `quality_flags` | Si | `quality_flags` | Si | No | Lista vacia permitida. |
| `warnings` | Si | `warnings` | Si | No | Lista vacia permitida. |

### Exposure, holdings and history

| Campo BDB-ACTIVOS | Obligatorio | Fuente BBDD-ACTIVOS | Derivado en adapter | Opcional | Notas |
| --- | --- | --- | --- | --- | --- |
| `pms_exposure` | Si para detail/optimization | `pms_exposure`, portfolio exposure | Fallback por clase economica | No en detail | Necesario para PMS y reporting, no debe vivir como campo comercial legacy. |
| `holdings_summary.has_holdings` | No | `holdings_summary` | Si no existe, `false` | Si | Solo resumen. |
| `holdings_summary.positions_count` | No | `holdings_summary.positions_count` | No | Si | Sin holdings completos en v1. |
| `holdings_summary.top10_weight` | No | `holdings_summary.top10_weight` | No | Si | Carga ligera. |
| `holdings_summary.full_holdings_loaded` | Si si hay summary | Adapter | Si | No si hay summary | Siempre `false` en el contrato base. |
| `history_available_years` | No | price/history summary | Si | Si | Para lazy loading posterior. |
| `history.points` | No | contrato lazy de historico | Normalizacion en adapter | Si | No se carga en search/detail por defecto. |

### Portfolio and reporting

| Campo BDB-ACTIVOS | Obligatorio | Fuente BBDD-ACTIVOS | Derivado en adapter | Opcional | Notas |
| --- | --- | --- | --- | --- | --- |
| `portfolio_id` | Si | BDB app | No | No | Carteras son app-owned. |
| `base_currency` | Si | BDB app | No | No | No es dato maestro. |
| `positions[].asset_id` | Si | BDB app | No | No | BBDD solo resuelve datos del activo. |
| `positions[].weight` | Si | BDB app | No | No | Peso fraccional para contratos BBDD. |
| `positions[].weight_percent` | Si en UI | BDB app | Conversion | No | Peso porcentual para UI. |
| `report.rows[]` | Si para reporting | BBDD asset detail + posiciones app | Si | No | Mezcla datos maestros con pesos app-owned. |
| `weighted_metrics` | No | No directo | Si | Si | Derivado por BDB, no dato maestro. |

## Campos minimos MVP

| Superficie | Campos minimos |
| --- | --- |
| Buscador | `asset_id`, `display_name`, `instrument_type`, `economic_asset_class`, `currency`, `coverage_status`, `is_investable`, `role`, `quality_flags`, `warnings`, `isin?`, `ticker?`, `provider?` |
| Ficha | Todo lo de buscador + `description`, `region?`, `category?`, `costs?`, `metrics`, `pms_exposure` |
| Comparador | `asset_id`, `display_name`, `instrument_type`, `economic_asset_class`, `currency`, `costs?`, `metrics`, `quality_flags`, `role` |
| Cartera | `asset_id`, `display_name`, `instrument_type`, `economic_asset_class`, `currency`, `is_investable`, `role`, `pms_exposure`, `metrics` |
| Reporting | Posiciones app-owned + filas enriquecidas con identidad, clasificacion, coverage, metricas, exposicion y flags |

## Reglas multi-activo

- `FUND` y `ETF` pueden tener TER/costes.
- `STOCK` no debe exigir TER/costes.
- `INDEX` puede existir en busqueda, ficha y comparador como benchmark/no invertible.
- `INDEX` no debe entrar como posicion invertible ni como asset optimizable.
- `instrument_type` y `economic_asset_class` son campos distintos.
- `EQUITY` es una clase economica, no un tipo instrumental.
- La UI no debe volver a asumir flujo fund-only.

## Fuera de primera version

| Elemento | Decision |
| --- | --- |
| Conexion real/API productiva | Fuera hasta bloque explicito de integracion |
| Lectura directa de almacenamiento interno | Prohibida en BDB |
| Persistencia real de carteras | Fuera |
| Export real de informes | Fuera |
| Optimizacion real | Fuera |
| Suitability real | Fuera |
| Retrocesiones | Fuera de datos maestros y fuera de v1 |
| Holdings completos/chunks | Lazy futuro, no en search/detail base |
| Historicos completos | Lazy futuro, acotados y normalizados |

## Riesgos

| Riesgo | Mitigacion |
| --- | --- |
| Nombres `Fund*ForBdb` arrastran deuda fund-only | Renombrar a `Asset*ForBdb` en el contrato definitivo. |
| `currency` opcional en contratos BBDD actuales | Hacerla obligatoria en payload BDB final o emitir warning si falta. |
| Metrics incompletas | Permitir metricas parciales y quality flags. |
| Holdings pesados | Mantener solo `holdings_summary` y lazy loading explicito. |
| Divergencia entre fixture local y contrato maestro | Tests de contrato y muestra estatica reducida. |

## Siguientes pasos

1. Crear en BDB-ACTIVOS tipos documentales/TS definitivos `Asset*ForBdb` si se autoriza.
2. Alinear BBDD-ACTIVOS para exponer aliases o contratos `Asset*ForBdb`.
3. Mantener `AssetDataSource` como frontera UI.
4. Preparar integracion futura con API/SDK solo cuando exista autorizacion explicita.
