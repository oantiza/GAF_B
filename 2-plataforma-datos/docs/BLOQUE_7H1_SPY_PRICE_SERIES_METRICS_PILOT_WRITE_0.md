# BLOQUE 7H-1 — SPY Price Series & Metrics Pilot Write (Reabierto)

## Objetivo del bloque
Reanudar y preparar un "pilot write" real y controlado para añadir colecciones secundarias (`price_series` y `metrics`) al ETF representativo `SPY` (US78462F1030).
**Nota Histórica:** Este bloque había quedado en estado de bloqueo por falta de precios. Fue reabierto exitosamente tras completarse el bloque `7H-0A` (SPY Prices Live Dry-Run & Metrics Preparation), el cual suministró las dependencias locales.

## Fuente local de datos
Los payloads de precios y métricas han sido hidratados directamente desde: `artifacts/spy_prices_live_dryrun_0/`

## Pre-write Snapshot y Rollback Manifest
El sistema leyó la base de datos de manera segura y verificó que:
- El `asset_root` (US78462F1030) y el `listing` (EODHD_SPY.US) **existen**.
- Los paths previstos para `price_series` y `metrics` **no existen** (missing).
- **Rollback Manifest:** Se generó el plan de reversión segura antes de autorizar la escritura: `artifacts/firestore_spy_price_series_pilot_write_0/rollback_manifest_real_0.json` cubriendo ambos paths.

## Real Write Plan
El plan de escritura (`real_write_plan.json`) define exactamente **2 operaciones** tipo `CREATE`:
1. `assets/US78462F1030/price_series/EODHD_SPY.US_YEAR_2026`
2. `assets/US78462F1030/metrics/EODHD_SPY.US_LATEST`

### Payload de Price Series
- Observaciones: 106
- First Date: `2026-01-02`
- Last Date: `2026-06-04`

### Payload de Metrics
- Cumulative Return: `~11.12%`
- Annualized Volatility: `~13.27%`
- Max Drawdown: `-8.88%`
- Sharpe Ratio: `~1.67`

## Estado Actual: COMPLETADO (SUCCESS)
- Real write attempted: SÍ
- Real write executed: SÍ
- **Firestore Writes:** 2
- **Firestore Deletes:** 0
- El pilot write se autorizó y ejecutó exitosamente. Ambos documentos fueron creados en Firestore.

## Post-Write Verification (PASS)
Se ejecutó la verificación post-write obligatoria tras la escritura, garantizando que:
- Los 2 paths previstos existen en la base de datos de Firestore en tiempo real.
- El payload escrito coincide byte-a-byte de manera exacta con el original candidato.
- No existen discrepancias relacionales (listing_id y source_price_id).
- Ningún path fue escrito fuera de la selección autorizada.
- `FIRESTORE_REAL_WRITE_ENABLED` ya no se encuentra activo.

## Confirmación de activos existentes intactos
La suite de pruebas automatizadas y las auditorías de cierre read-only previas a la apertura determinaron fehacientemente que:
- `QQQ`, `IWDA`, `AAPL`, `AAPU`, `GSPC` permanecen intactos.

## Siguiente paso recomendado
**Recomendación:** El bloque 7H-1 se ha completado íntegra y satisfactoriamente. Se recomienda crear un Bloque de Cierre/Auditoría Read-Only (ej. Bloque 7H-1B SPY Closeout Read-Only Audit) para blindar el entorno y verificar con snapshot final que el pipeline funciona y el ETF representativo SPY.US se ha consolidado correctamente en la BD.
