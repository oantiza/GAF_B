# BLOQUE 7I FONDOSDB 2 - SCHEMA EXTENSION AND WRITE GATE DESIGN 0

Fecha: 2026-06-12

## Resumen ejecutivo

Este bloque disena la extension versionada de schema para fondos importados desde FondosDB y define un write gate futuro solo en modo diseno/preview. No se ejecuta ningun write real.

Decision principal: mantener estable el schema base actual de `Asset` y modelar fondos mediante una extension versionada. El root futuro de `assets/{asset_id}` podra alojar bloques de fondo normalizados, pero solo tras snapshot readonly, diff campo a campo y write gate explicito.

Estado resultante:

- Listos para preparar un write gate preview concreto.
- No listos para ejecutar write real.
- Holdings deben tener gate separado del root.
- `REVIEW` debe quedar fuera del primer plan de escritura salvo decision explicita.

## Archivos y artefactos revisados

- `src/types/assets.ts`
- `src/validators/assetValidator.ts`
- `src/normalizers/assetNormalizer.ts`
- `src/quality/assetQuality.ts`
- `src/ingestion/fondosdb/`
- `docs/BLOQUE_7I_FONDOSDB_1_DRYRUN_CONTRACT_AUDIT_0.md`
- `artifacts/fondosdb_import_dryrun_0/field_mapping_report.md`
- `artifacts/fondosdb_import_dryrun_0/firestore_paths_preview.json`
- `artifacts/fondosdb_import_dryrun_0/quality_summary.json`

## Situacion del schema actual

`Asset` actual admite:

- `asset_id`
- `asset_type`
- `identity`
- `identifiers`
- `listings`
- `classification`
- `retrocession`

Tipos actuales:

```ts
type AssetType = 'FUND' | 'ETF' | 'STOCK' | 'INDEX' | 'OTHER' | 'UNKNOWN';
```

Implicacion:

- RF no debe convertirse en nuevo `asset_type`; debe representarse como `asset_type = FUND` y detalle en `classification`/`fixed_income_profile`.
- Monetario no debe convertirse en nuevo `asset_type`; debe representarse como `asset_type = FUND` y `product.product_type = money_market_fund`.
- ETC puede quedar como `asset_type = OTHER` y `product.product_type = ETC`.
- No conviene ampliar `AssetType` en este bloque porque afectaria validadores globales y pipelines no relacionados.

## Schema extension propuesta

Archivo preliminar creado:

```text
src/types/fundAssets.ts
```

Version:

```ts
schema_version: 'fund_asset_v1_preview'
```

Root futuro propuesto para `assets/{asset_id}`:

```ts
FundAssetExtension extends Asset {
  product: FundProduct;
  fund_profile?: FundProfile;
  fund_metrics?: FundMetrics;
  sustainability?: FundSustainability;
  portfolio_exposure?: FundPortfolioExposure;
  fixed_income_profile?: FundFixedIncomeProfile;
  quality: FundQuality;
  source_metadata: FundSourceMetadata;
  schema_version: 'fund_asset_v1_preview';
  updated_at: string;
}
```

## Campos aceptados en root

Campos base:

- `asset_id`
- `asset_type`
- `identity`
- `identifiers`
- `listings`
- `classification`

Campos extendidos versionados:

- `product`
- `fund_profile`
- `fund_metrics`
- `sustainability`
- `portfolio_exposure`
- `fixed_income_profile`
- `quality`
- `source_metadata`
- `schema_version`
- `updated_at`

Condiciones:

- `asset_id = identifiers.isin` para FondosDB.
- `listings` puede ser `[]` si no hay listing real.
- `asset_type` debe seguir dentro del schema actual: `FUND`, `ETF`, `OTHER` para fondos/ETC de FondosDB.
- Campos enriquecidos solo se escribiran tras schema gate y diff.

## Campos excluidos del root

No incluir:

- Holdings masivos.
- `price_series` inventadas.
- `metrics_latest` o metricas calculadas desde precios si no hay listing/price series.
- Listings inventados.
- `raw universal.cartera` completo.
- `economic_exposure` legacy de BDB-FONDOS.
- Credenciales, tokens, `.env`, service accounts.
- Payloads provider sin tamano ni contrato.

## Contrato `fund_profile`

Destino de datos descriptivos y estables del fondo:

```ts
interface FundProfile {
  provider_category?: string | null;
  morningstar_category?: string | null;
  benchmark?: string | null;
  objective?: string | null;
  share_class?: string | null;
  distribution_policy?: string | null;
  inception_date?: string | null;
  domicile?: string | null;
  legal_structure?: string | null;
  ucits?: boolean | null;
  replication?: string | null;
  style_bias?: Record<string, unknown> | null;
}
```

Decision:

- `ms.objective` puede ir aqui si se limita como texto descriptivo.
- `derived.style_bias` puede ir aqui como `style_bias`, pero requiere contrato de claves antes de write real.
- `replication` solo aplica si ETF/ETC trae dato real; no inventar.

## Contrato `fund_metrics`

Destino de metricas propias de fondo o proveedor, no calculadas desde price series:

```ts
interface FundMetrics {
  returns?: Record<string, unknown> | null;
  volatility?: Record<string, unknown> | null;
  sharpe?: Record<string, unknown> | null;
  drawdown?: Record<string, unknown> | null;
  rating?: Record<string, unknown> | null;
  risk_score?: number | null;
  source_periods?: string[];
}
```

Reglas:

- No mezclar con `assets/{asset_id}/metrics/{metrics_id}` calculadas desde precios.
- No aceptar `price`, `close`, `open`, `high`, `low`, `volume`, `price_series`, `metrics_latest` ni `listing_metrics`.
- Si una metrica viene de Morningstar/FondosDB, registrar source en `source_metadata`.

## Contrato `fixed_income_profile`

Destino de perfil de renta fija:

```ts
interface FundFixedIncomeProfile {
  duration?: number | null;
  modified_duration?: number | null;
  yield_to_maturity?: number | null;
  yield_to_worst?: number | null;
  ytw_distribution?: Record<string, number | null> | null;
  maturity_buckets?: Record<string, number | null> | null;
  credit_quality_distribution?: Record<string, number | null> | null;
  average_credit_quality?: string | null;
  coupon?: Record<string, unknown> | number | null;
  spread?: number | null;
  missing_critical_fields?: string[];
  incomplete_rf_profile?: boolean;
}
```

Regla de calidad:

- RF critica sin duracion/yield/calidad crediticia completa debe quedar `quality.review_level = HIGH`.
- Esta regla queda cubierta por test preliminar en `tests/fundAssets.test.ts`.

## Contrato `portfolio_exposure`

Destino de exposiciones agregadas:

```ts
interface FundPortfolioExposure {
  asset_allocation?: Record<string, number | null> | null;
  region_exposure?: Record<string, number | null> | null;
  sector_exposure?: Record<string, number | null> | null;
  currency_exposure?: Record<string, number | null> | null;
  top_countries?: Array<Record<string, unknown>> | null;
  top_sectors?: Array<Record<string, unknown>> | null;
  bond_exposure?: Record<string, unknown> | null;
}
```

Reglas:

- No confundir con `economic_exposure` legacy.
- Si `economic_exposure` esta ausente, no inventarlo.
- No meter holdings individuales aqui.

## Contrato `sustainability`

Destino de SFDR y datos ESG:

```ts
interface FundSustainability {
  sfdr?: string | null;
  esg_rating?: string | number | null;
  sustainability_rating?: number | null;
  indicators?: Record<string, unknown> | null;
  descriptive_text?: string | null;
}
```

Reglas:

- SFDR null/blanco no bloquea.
- Texto ESG que contenga la palabra `credentials` no es credencial tecnica.
- No usar el bloque ESG para almacenar secretos ni tokens.

## Contrato `quality`

Destino de decision y explicabilidad:

```ts
interface FundQuality {
  source_quality_level: 'ALTO' | 'MEDIO' | 'BAJO' | 'BLOQUEADO';
  import_status: 'ACCEPTED' | 'REVIEW' | 'REJECTED';
  review_level: 'NONE' | 'LOW' | 'HIGH';
  review_reasons: string[];
  problematic_flags: string[];
  suspicious_allocation: boolean;
  missing_critical_fields: string[];
  last_quality_check_at: string;
}
```

Reglas:

- `ACCEPTED` debe tener `review_level = NONE`.
- `REVIEW` leve puede usar `LOW`.
- RF critica, calidad BAJO o asignacion sospechosa fuerte debe usar `HIGH`.
- `REJECTED` queda para JSON invalido, ISIN invalido, asset_id ausente o tipo no clasificable.

## Contrato `source_metadata`

Destino de trazabilidad:

```ts
interface FundSourceMetadata {
  source_system: 'FondosDB';
  source_package: string;
  source_file: string;
  source_hash?: string | null;
  imported_at_preview?: string | null;
  generated_at?: string | null;
  parser_version?: string | null;
  source_quality_summary?: Record<string, unknown> | null;
}
```

Reglas:

- `source_hash` debe calcularse localmente o venir de manifest.
- `imported_at_preview` no significa escritura real.
- `source_quality_summary` puede resumir ALTO/MEDIO/BAJO y warnings.

## Contrato holdings

Ruta:

```text
assets/{asset_id}/holdings/{holding_id}
```

Tipo preliminar creado:

```ts
interface FundHoldingDocument {
  holding_id: string;
  parent_asset_id: string;
  source_system: 'FondosDB';
  source_file: string;
  as_of_date?: string | null;
  rank?: number | null;
  name?: string | null;
  identifiers?: {
    isin?: string | null;
    ticker?: string | null;
  };
  isin?: string | null;
  ticker?: string | null;
  weight?: number | null;
  weight_unit: 'pct' | 'decimal' | 'unknown';
  asset_type?: string | null;
  classification?: Record<string, unknown> | null;
  sector?: string | null;
  region?: string | null;
  country?: string | null;
  currency?: string | null;
  maturity?: number | null;
  duration?: number | null;
  rating?: string | null;
  raw_provider_fields?: Record<string, unknown> | null;
  quality_flags: string[];
}
```

Reglas:

- Holdings nunca en root.
- No write masivo sin gate separado.
- Holdings gate separado del assets root gate.
- `holding_id` debe ser estable: propuesta `{parent_asset_id}:{holding_isin_or_ticker_or_name_hash}:{rank_or_index}`.
- Si no hay ISIN/ticker, usar hash determinista de nombre normalizado, fecha, peso y posicion.
- `raw_provider_fields` debe ser minimo/controlado.

## Contratos opcionales futuros

### `assets/{asset_id}/fund_snapshots/{snapshot_id}`

Encaja si se quiere conservar una foto completa por `report_date`:

- `snapshot_id`: `{source_system}_{report_date}`
- `source_file`
- `fund_profile`
- `fund_metrics`
- `portfolio_exposure`
- `fixed_income_profile`
- `quality`

Decision: no implementarlo ahora. Puede ser util tras primer write gate.

### `assets/{asset_id}/fund_reports/{report_id}`

Encaja si se quieren guardar informes narrativos o markdown/PDF derivados:

- `report_id`
- `source_system`
- `report_type`
- `generated_at`
- `content_ref`

Decision: no implementarlo ahora. Complica el primer gate y no es necesario para importar datos estructurados.

## Estrategia write gate assets root

Solo diseno/preview.

Input inicial:

- 405 `ACCEPTED` como candidatos.
- 91 `REVIEW` excluidos del primer write plan.
- 0 `REJECTED`.

Pasos:

1. Construir lista exacta de `selected_paths` para `assets/{asset_id}`.
2. Ejecutar snapshot readonly de esos paths antes de cualquier plan.
3. Calcular diff campo a campo:
   - `new_doc`
   - `existing_doc`
   - `added_fields`
   - `changed_fields`
   - `blocked_fields`
4. Bloquear si existe conflicto no resuelto con documento existente.
5. Generar `rollback_manifest` con estado previo.
6. Generar `write_plan_preview.json` sin ejecutar writes.
7. Generar `post_write_verification_plan.json`.

Reglas de inclusion primer preview:

- Incluir root minimo.
- Incluir extension versionada solo si pasa `validateFundAssetExtension`.
- Excluir holdings.
- Excluir raw payload amplio.
- Excluir `REVIEW` salvo seleccion manual explicita.

## Estrategia write gate holdings

Solo diseno/preview y en gate separado.

Input:

- 94,993 holdings.
- 495 fondos con holdings.
- Max por fondo auditado: 10,000.

Pasos:

1. Validar cada holding con `validateFundHoldingDocument`.
2. Calcular tamano por documento.
3. Generar chunks.
4. Definir limites:
   - No mezclar con root gate.
   - Chunks pequenos y reanudables.
   - Idempotencia por `holding_id`.
5. Snapshot/count preview por subcoleccion cuando sea viable.
6. Rollback plan por chunk.
7. Post-write sampling y counts por `asset_id`.

Recomendacion de chunking:

- Preview: chunks de 250 documentos.
- Real futuro: ajustar por limites de Firestore y latencia observada.
- Registrar `chunk_id`, `asset_id`, rango, count, hash combinado.

## Validadores y tests preliminares

Se anadio:

- `src/types/fundAssets.ts`
- `tests/fundAssets.test.ts`

Cobertura:

- Extension minima valida.
- SFDR null no bloquea.
- Texto ESG con `credentials` no se trata como secreto.
- Holdings y `price_series` no pueden estar en root.
- `fund_metrics` no puede mezclar price/listing metrics.
- RF critica sin campos completos requiere `REVIEW HIGH`.
- Holding document requiere subcollection contract y rechaza nesting/root bloat.

## Riesgos

- Es necesario alinear nombres definitivos antes del primer write real.
- El root extendido puede crecer si se permite provider payload sin limites.
- Holdings requieren gate propio por volumen.
- Snapshot readonly puede descubrir activos existentes y conflictos.
- `REVIEW` leve podria ser aceptable, pero no debe entrar sin decision explicita.

## Decisiones pendientes

- Confirmar si `fund_profile.objective` se escribe en root o queda en `provider_payload`.
- Confirmar contrato exacto de `style_bias`.
- Confirmar si `ms.holdings_top10` se descarta, se reconcilia o se guarda como subset.
- Confirmar limites de `raw_provider_fields`.
- Definir politica de merge si `assets/{asset_id}` ya existe.
- Definir subset piloto para primer write gate preview.

## Recomendacion siguiente bloque

Siguiente bloque recomendado:

```text
7I-FONDOSDB-3 - Root Assets Write Gate Preview
```

Alcance sugerido:

- Sin escritura real.
- Seleccionar 5-10 `ACCEPTED` representativos:
  - RV
  - RF
  - ETF
  - ETC
  - monetario
- Crear snapshot readonly plan.
- Crear diff preview.
- Crear write plan preview.
- Crear rollback manifest preview.
- Crear post-write verification plan.
- Mantener holdings fuera.

## Confirmacion de seguridad

- Firestore writes = 0
- Firestore deletes = 0
- Base real writes = 0
- BDB-FONDOS tocado = NO
- BDB-FONDOS-CORE tocado = NO
- Deploy = NO
- Push = NO
- Commit = NO
- Internet = NO
- Credenciales usadas = NO
- Paquete input modificado = NO
