# Bloque 7D-1B - Diversified ETF + Index Closeout Read-Only Audit

## Objetivo y relacion con 7D-1

Cerrar de forma independiente y exclusivamente read-only el piloto 7D-1, confirmando
los cuatro documentos ETF/indice escritos, la ausencia de `price_series` y `metrics`,
la integridad de AAPL, el rollback disponible y el entorno seguro.

Este bloque no realizo writes, updates, deletes, rollback, llamadas EODHD live ni
llamadas OpenFIGI live.

## Paths diversificados auditados

1. `assets/US25461A8743`
2. `assets/US25461A8743/listings/EODHD_AAPU.US`
3. `assets/EODHD:GSPC.INDX`
4. `assets/EODHD:GSPC.INDX/listings/EODHD_GSPC.INDX`

Resultado readback:

- Required paths existing: `4/4`
- Required paths missing: `0`
- Payload hash mismatches: `0`
- Relationship mismatches: `0`
- Estado: `PASS`

## Validacion ETF e indice

- ETF asset type: `ETF`
- ETF listing ID: `EODHD_AAPU.US`
- ETF ISIN: `US25461A8743`
- Index/proxy asset type: `INDEX`
- Index/proxy listing ID: `EODHD_GSPC.INDX`
- Index/proxy fallback: `EODHD:GSPC.INDX`
- Estado `REVIEW` preservado en los cuatro documentos

Warnings pendientes:

- `AAPU.US` es un ETF single-stock apalancado y puede requerir una clasificacion mas
  especifica antes de usarlo como ETF representativo.
- `GSPC.INDX` mantiene un identificador EODHD provisional y debe continuar en `REVIEW`.

## Ausencia de price series y metrics

Se consultaron directamente las subcolecciones `price_series` y `metrics` bajo ambos
asset roots.

- Price series docs found: `0`
- Metrics docs found: `0`
- Read errors: `0`
- Estado: `PASS`

## AAPL intacto

Paths comprobados por hash exacto:

1. `assets/US0378331005`
2. `assets/US0378331005/listings/EODHD_AAPL.US`
3. `assets/US0378331005/price_series/EODHD_AAPL.US_YEAR_2026`
4. `assets/US0378331005/metrics/EODHD_AAPL.US_LATEST`

- Existing: `4/4`
- Hash matches: `4/4`
- AAPL modified by this block: `NO`
- Estado: `PASS`

## Rollback manifest

- Manifest found: `SI`
- Paths covered: `4/4`
- Missing paths: `0`
- Listings before asset roots: `SI`
- Warnings criticos: `0`
- Rollback executed: `NO`
- Estado: `PASS`

## Estado seguro

- `FIRESTORE_LIVE_READONLY=true`: `SI`
- `FIRESTORE_REAL_WRITE_ENABLED` activo: `NO`
- `FIRESTORE_REAL_WRITE_GATE_ID` activo: `NO`
- Token de operador diversificado activo: `NO`
- Flags de write activos: `NO`
- serviceAccountKey en repo: `NO`
- Credenciales impresas: `NO`
- Firestore writes/deletes nuevos: `0/0`
- Deploy/Commit/Push: `NO / NO / NO`

## Tests y auditorias

- `npm test`: `164/164 PASS`
- `firestore:post-write-closeout-audit`: `PASS`
- `firestore:aapl-enriched-closeout-audit`: `PASS`
- `firestore:diversified-closeout-audit`: `PASS`
- TypeScript aislado para archivos nuevos: `PASS`

## Artifacts generados

Carpeta: `artifacts/firestore_diversified_closeout_0/`

- `closeout_summary.json`
- `diversified_readback_result.json`
- `asset_type_and_listing_check.json`
- `no_price_series_metrics_check.json`
- `aapl_untouched_check.json`
- `rollback_manifest_review.json`
- `env_safety_status.json`
- `next_step_recommendation.json`

## Riesgos pendientes y siguiente paso

No escalar masivamente todavia. Alternativas:

- A: usar posteriormente un ETF amplio y representativo como SPY, QQQ o IWDA.
- B: preparar un piloto limitado de 10-25 asset roots mas listings, sin historicos ni
  metricas y con batch estrictamente limitado.
- C: ampliar primero la historia de AAPL para robustecer `price_series` y `metrics`.
