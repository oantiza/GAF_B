# BLOQUE 7O-PAYLOADS-0A: Vanilla Batch Complete Payloads

## 1. Objetivo
Generar payloads locales completos para los 5 `price_series` y 5 `metrics` del batch vanilla, sin escribir en Firestore.

## 2. Resultado
- Estado: `READY_FOR_BATCH_WRITE_GATE_RETRY`
- Fuente: `EODHD_LIVE_EOD`
- EODHD live usado: `YES_EOD_ONLY`
- Firestore writes: `0`
- Firestore deletes: `0`

## 3. Activos
- `MSFT.US`: 107 obs, 2026-01-02 a 2026-06-05, validation `PASS`
- `GOOGL.US`: 107 obs, 2026-01-02 a 2026-06-05, validation `PASS`
- `AMZN.US`: 107 obs, 2026-01-02 a 2026-06-05, validation `PASS`
- `EFA.US`: 107 obs, 2026-01-02 a 2026-06-05, validation `PASS`
- `EEM.US`: 107 obs, 2026-01-02 a 2026-06-05, validation `PASS`

## 4. Validaciones
- Cada `price_series` contiene array completo `prices`.
- Ningun `price_series` es solo conteo.
- `observations_count === prices.length`.
- Metricas recalculadas desde la serie completa.
- No se usaron fundamentals ni OpenFIGI live.

## 5. Siguiente Paso
`Reintentar write gate con snapshot fresco y estos payloads completos.`
