# Bloque 10J - Batch Vanilla 2 Prices/Metrics Closeout

## Resumen ejecutivo

El ciclo 10G + 10H + 10I queda cerrado documentalmente para los activos `VTI.US`, `AGG.US`, `ACWI.US` y `GLD.US`.

- 10G preparo en dry-run 4 candidatos de `price_series` y 4 candidatos de `metrics`.
- 10H preparo el write gate preview con 8 paths seleccionados, `authorized=false`, `can_write=false` y sin writes.
- 10I ejecuto el write real autorizado de esos 8 paths, con `writes=8`, `deletes=0`, `failed_paths=0` y verificacion posterior `PASS 8/8`.
- El preview posterior queda en `REVIEW_REQUIRED` porque los 8 target paths ya existen, bloqueando una repeticion accidental.

## Paths escritos en 10I

- `assets/eodhd_vti_us/price_series/EODHD_VTI.US_YEAR_2026`
- `assets/eodhd_agg_us/price_series/EODHD_AGG.US_YEAR_2026`
- `assets/eodhd_acwi_us/price_series/EODHD_ACWI.US_YEAR_2026`
- `assets/eodhd_gld_us/price_series/EODHD_GLD.US_YEAR_2026`
- `assets/eodhd_vti_us/metrics/latest`
- `assets/eodhd_agg_us/metrics/latest`
- `assets/eodhd_acwi_us/metrics/latest`
- `assets/eodhd_gld_us/metrics/latest`

## Metricas principales

| Ticker | Observaciones | Fechas | Cumulative return | Annualized volatility | Max drawdown | Sharpe ratio |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| VTI.US | 113 | 2026-01-02 a 2026-06-15 | 0.1111694407 | 0.1448019100 | -0.0891814878 | 1.7104696248 |
| AGG.US | 113 | 2026-01-02 a 2026-06-15 | 0.0064121230 | 0.0412131423 | -0.0276418166 | 0.3693916917 |
| ACWI.US | 113 | 2026-01-02 a 2026-06-15 | 0.1163342646 | 0.1645963063 | -0.0972749130 | 1.5865866189 |
| GLD.US | 113 | 2026-01-02 a 2026-06-15 | -0.0043436778 | 0.3501891549 | -0.2446460980 | 0.1479250143 |

## Controles de seguridad

- Este bloque 10J no ejecuto writes reales en Firestore.
- Este bloque 10J no ejecuto deletes.
- No se activo `FIRESTORE_REAL_WRITE_ENABLED`.
- No se tocaron `.env` ni `.env.local`.
- No se imprimieron credenciales.
- No se tocaron `BDB-FONDOS`, `BDB-FONDOS-CORE` ni `imports/`.
- No hubo commit, push ni deploy durante este cierre.

## Estado Firestore final

- 10I escribio 8 documentos.
- La verificacion posterior confirmo `PASS 8/8`.
- El preview posterior detecta `target_paths_existing=8/8` y queda en `REVIEW_REQUIRED`, evitando una segunda escritura sobre los mismos paths.

## Tests

Resultado final de `npm test`: PASS, 75 archivos de test y 362 tests.

## Rollback

El rollback manifest esta disponible en:

- `artifacts/batch_vanilla_2_prices_metrics_real_write_0/rollback_manifest.json`

## Commit

No se hizo commit, push ni deploy. Se genero un plan de commit selectivo separado en:

- `artifacts/batch_vanilla_2_prices_metrics_closeout_0/commit_plan.md`
