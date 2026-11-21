# Schema Canónico de BBDD Activos Financieros (V0.1)

> **Revisado el 18 de junio de 2026** para alinear el contrato documental con el código real
> (`src/types/assets.ts`, `src/ingestion/firestorePathContract.ts`) y con las reglas operativas.
> Cambios frente a V0: se elimina `retrocession`, `Fundamentals` y `economic_exposure` (prohibidos);
> `asset_type` pasa al enum real (`STOCK`, no `EQUITY`); métricas en `metrics/latest`;
> holdings documentados según la implementación real (SINGLE/CHUNKED); se documenta el perfil
> enriquecido de fondos FondosDB.

## 0. Principios del modelo
- El **documento raíz** `assets/{asset_id}` contiene datos maestros (y, para fondos, el perfil enriquecido).
- **Nunca** se embeben en el root: `holdings`, `listings`, `price_series` ni `metrics`. Van como **subcolecciones**.
- Identificador de documento (`asset_id`): se usa el **ISIN** cuando existe (p. ej. `assets/IE00B4L5Y983`).

## 1. Enumeraciones canónicas
- **`asset_type`** (validado en `assetValidator`): `"FUND" | "ETF" | "STOCK" | "INDEX" | "OTHER" | "UNKNOWN"`.
  - Nota: no existe `"EQUITY"`; las acciones se modelan como `"STOCK"`. Cualquier doc heredado con
    `"EQUITY"` debe normalizarse a `"STOCK"`. `"OTHER"`/`"UNKNOWN"` son estados de cola de revisión,
    no deberían persistirse como estado final.
- **`quality.status`**: `"ACCEPTED" | "REVIEW" | "BLOCKED"` (en FondosDB; equivalente a OK/REVIEW/BLOCKED).

## 2. Documento raíz — envelope común (`assets/{asset_id}`)
Campos comunes a todos los tipos:
- `asset_id`: String (normalmente el ISIN)
- `asset_type`: AssetType (ver §1)
- `identity`: { `name`: String, `currency?`: String }
- `identifiers`: { `isin?`: String }
- `classification`: { `asset_class?`: String, ... } (campos adicionales según fuente; ver §4)
- `source_metadata`: { `source`, `source_file?`, `generated_at`, `report_date?`, ... }

> **Campos prohibidos en el root** (reglas operativas): `retrocession`, `manual_costs_retrocession`,
> `economic_exposure`, y cualquier dato de holdings/listings/price_series/metrics.
> (El tipo TS `Asset` aún declara `retrocession?` y `listings[]` por herencia del modelo antiguo:
> deben retirarse del tipo para que coincida con esta regla.)

## 3. Variante "Activo de mercado" (STOCK / ETF / INDEX)
Root mínimo + subcolecciones de mercado:
- `identity`: { `name`, `currency` }
- `identifiers`: { `isin` }
- `classification`: { `asset_class` } (p. ej. `"EQUITY"` como clase, distinto de `asset_type`)
- Subcolecciones: `listings/{listing_id}`, `price_series/{series_id}`, `metrics/latest`.

## 4. Variante "Fondo" (FUND) — perfil enriquecido FondosDB
Root enriquecido (sin listings/price_series/metrics; holdings en subcolección). Secciones reales:
- `identity`: { `name`, `currency` }
- `identifiers`: { `isin` }
- `classification`: { `asset_class`, `fondosdb_asset_class`, `fondosdb_asset_type`, `asset_subtype`, `region_primary`, `strategy_tags[]`, `confidence` }
- `product`: { `product_type`, `commercial_type`, `vehicle_complexity`, `fund_name`, `has_listing` }
- `costs`: { `management_fee_pct`, `ter_pct`, `mifid_ongoing_pct` }  *(sin retrocession)*
- `performance`: { `returns` { `trailing_pct`, `por_año_natural`, `fecha_dato` }, `valuation` { `vl`, `patrimonio_*` }, `distributions` { `yield_12m_pct` } }
- `risk`: { `volatilidad_pct`, `sharpe`, `alpha`, `beta`, `r2`, `tracking_error_pct`, `information_ratio`, `sri_kid_1a7`, `srri_1a7`, ... }
- `sustainability`: { `morningstar_sustainability_rating`, `esg` { ... }, `sfdr` }
- `portfolio_exposure`: { `version`, `asset_mix`, `equity_regions`, `sectors`, `equity_styles`, `market_caps`, `bond_types`, `credit`, `duration`, `exposure_confidence`, `warnings[]` }
  - Nota: `portfolio_exposure` (desglose Morningstar) **sí** se incluye; lo que está **prohibido** es `economic_exposure`.
- `fixed_income_profile`: { `effective_duration`, `credit_quality{}`, `maturity_allocation{}`, `yield_to_maturity`, `yield_to_worst`, ... }
- `quality`: { `fondosdb_bucket`, `fondosdb_ok`, `warnings[]`, `validation_errors[]`, `review_flags[]`, `status` }
- `source_metadata`: { `source: "FondosDB"`, `source_file`, `generated_at`, `report_date`, `universal_export_present` }

## 5. Subcolección Listings — `assets/{asset_id}/listings/{listing_id}`
- `listing_id`: String
- `ticker`: String
- `exchange`: String
- `currency?`: String
- `eodhd_code?`: String
- `figi?`: String
- `is_primary`: Boolean
- `data_sources`: String[]

## 6. Subcolección Price Series — `assets/{asset_id}/price_series/{series_id}`
- `asset_id`: String
- `price_date`: "YYYY-MM-DD"
- `close`: Number
- `adjusted_close?`: Number
- `volume?`: Number

## 7. Métricas — `assets/{asset_id}/metrics/latest`
Documento único `latest` (no `{metrics_id}`). Métricas derivadas de precio/listing
(rentabilidad acumulada, volatilidad anualizada, Sharpe, etc.). Solo para activos con price_series.

## 8. Holdings (composición de fondos)
Dos modos físicos, **abstraídos** por el read model `getFundHoldings` (el consumidor no sabe cuál es):
- `SINGLE_DOCUMENT`: `assets/{fund_asset_id}/holdings/latest` con el payload completo.
- `CHUNKED_DOCUMENTS`: `assets/{fund_asset_id}/holdings/manifest` (metadatos) +
  `assets/{fund_asset_id}/holdings/manifest/chunks/{chunk_id}` (fragmentos ordenados, `chunk_NNNN`).

Cada posición de holding contiene, como mínimo: identificador del subyacente, peso (`weight`) y fecha.
El path `holdings/chunks/{chunk_id}` (sin `manifest`) es **inválido** y está vetado por el contrato.

## 9. Quality Report (embebido en el root como `quality`)
- `status`: "ACCEPTED" | "REVIEW" | "BLOCKED"
- `warnings`: String[]
- `validation_errors`: String[]
- `review_flags`: String[]
- (FondosDB) `fondosdb_bucket`: "ALTO" | "MEDIO" | "BAJO" | "BLOQUEADO", `fondosdb_ok`: Boolean

## 10. Ingestion Runs (artefactos de dry-run, fuera de Firestore)
- `run_id`: String
- `timestamp`: DateTime
- `source`: "EODHD" | "OpenFIGI" | "FondosDB" | "Manual"
- `summary`: { `total_processed`, `total_ok`, `total_review`, `total_blocked`, `execution_time_ms` }

---
### Fuera de alcance (prohibido por reglas vigentes)
- **Fundamentals de EODHD** (market_cap, pe_ratio, dividend_yield, ...): no se usan.
- **`retrocession` / `manual_costs_retrocession`** y **`economic_exposure`**: excluidos del modelo.
