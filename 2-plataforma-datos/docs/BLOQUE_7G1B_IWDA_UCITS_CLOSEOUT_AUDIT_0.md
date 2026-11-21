# BLOQUE 7G-1B — IWDA UCITS Closeout Read-Only Audit

## Objetivo del bloque
Realizar una auditoría segura de solo lectura para el activo IWDA (IE00B4L5Y983) escrito durante el piloto 7G-1, sin modificar la base de datos de producción.

## Relación con 7G-1
Este bloque valida de forma inmutable los resultados del bloque 7G-1, confirmando que la escritura de IWDA (asset root y listing) ocurrió correctamente, sin efectos secundarios, y sin afectar los activos previamente escritos (AAPL, AAPU, GSPC, SPY, QQQ).

## Actualización de auditoría Representative ETF
La expectativa histórica de la auditoría `firestore:representative-etf-closeout-audit` (7F-1B) de que IWDA no debía existir (`iwda_written = false`) ha sido actualizada a `EXPECTED_SEPARATE_CLOSEOUT` (`MAY_EXIST`). Ya no falla por la existencia del activo tras la autorización y ejecución del bloque 7G-1.

## Paths auditados
- `assets/IE00B4L5Y983` (Asset Root)
- `assets/IE00B4L5Y983/listings/EODHD_IWDA.LSE` (Listing)

## Resultado Readback
- Required IWDA paths existing: 2/2
- Required IWDA paths missing: 0
- Payload mismatches: 0
- Relationship mismatches: 0

## Validación ETF UCITS/LSE
Se comprobó que el asset raíz y el listing reflejan `asset_type = ETF`, `ISIN = IE00B4L5Y983`, `listing_id = EODHD_IWDA.LSE` y `exchange = LSE`. Todos los chequeos devolvieron `PASS`.

## Confirmación Price Series / Metrics
Se ha comprobado que, tal como se esperaba, **no existen** colecciones `price_series` ni `metrics` bajo `assets/IE00B4L5Y983`. (0 documentos nuevos).

## Confirmación de activos previos intactos
- AAPL intacto: Sí
- AAPU intacto: Sí
- GSPC intacto: Sí
- SPY intacto: Sí
- QQQ intacto: Sí

## Revisión Rollback Manifest
- Se generó el manifest correctamente.
- Cubre exactamente los 2 paths escritos.
- El orden es válido (listing eliminado antes que el asset root).
- `rollback_executed = false`.
- Status: `PASS`.

## Estado Seguro del Entorno
- Entorno validado como solo lectura (`FIRESTORE_REAL_WRITE_ENABLED = false`).
- Firestore writes nuevos en este bloque = 0.
- Firestore deletes nuevos en este bloque = 0.
- No hay credenciales (serviceAccountKey) en el repositorio.
- El token EODHD no se ha impreso en logs.

## Resultado de Tests
La suite de `npm test` se ejecutó correctamente (211/211 PASS), incluyendo las validaciones unitarias de `firestoreIwdaUcitsCloseoutAudit.test.ts`.

## Artifacts Generados
Ubicación: `artifacts/firestore_iwda_ucits_closeout_0/`
- `closeout_summary.json`
- `iwda_readback_result.json`
- `iwda_asset_type_and_listing_check.json`
- `no_price_series_metrics_check.json`
- `existing_assets_untouched_check.json`
- `rollback_manifest_review.json`
- `env_safety_status.json`
- `next_step_recommendation.json`

## Riesgos pendientes
Actualmente no se detectan riesgos inminentes relacionados con las escrituras en Firestore. La estructura base de Firestore está soportando exitosamente escrituras de acciones, índices y ETFs internacionales sin side-effects.

## Siguiente paso recomendado
**Recomendación:** `SAFE_COMMIT_7G_CYCLE` o `OpenFIGI live validation`.

El siguiente paso recomendado podría ser uno de los siguientes:
A) Commit agrupado seguro de los bloques de la serie 7G (7G-0, 7G-1, 7G-1B) para formalizar y guardar el progreso local.
B) Iniciar la validación `OpenFIGI live validation` para los activos ya escritos en la base de datos (resolviendo tickers a figis en read-only mode).
C) Obtener historiales (`price_series` y `metrics`) para `SPY` o `QQQ` siguiendo el patrón usado con `AAPL`.
D) Escalar el piloto con un "Small batch" de 10 a 25 asset roots/listings sin históricos de precios.
