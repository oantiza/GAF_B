# BLOQUE 7H-0A — SPY Prices Live Dry-Run & Metrics Preparation

## Objetivo del bloque
Crear un live dry-run controlado para obtener precios históricos exclusivos de `SPY.US` desde la API de EODHD en modo real. Tras la descarga, calcular las métricas financieras básicas localmente y generar artifacts de carga (candidatos) seguros. Todo esto con la meta de subsanar la ausencia de datos locales que impidió la finalización del Bloque 7H-1 previamente, manteniendo una estricta política de "cero escrituras" en Firestore.

## Motivo del bloqueo del Bloque 7H-1
El bloque `7H-1` (SPY Price Series & Metrics Pilot Write) quedó correctamente bloqueado y abortado por la seguridad local (`SECURITY FAULT: Local SPY price series candidate is unavailable`), dado que no existían archivos con precios descargados previamente en la base de datos de desarrollo para este ETF.

## Detalles de Extracción
- **Endpoint usado:** `/eod/SPY.US`
- **Ticker Limitado a:** 1 (SPY.US)
- **Rango de Fechas:** `2026-01-01` hasta `2026-12-31`
- **Observaciones obtenidas:** 106 (Cumple con el umbral > 20)

## Validación de Precios (Year 2026)
- **observations_count:** 106
- **first_date:** `2026-01-02`
- **last_date:** `2026-06-04`
- **invalid_price_count:** 0
- **duplicate_date_count:** 0
- **Status de Calidad:** `OK`

## Métricas Calculadas Localmente
Se han derivado exitosamente desde la serie de precios con `risk_free_rate = 0.04`:
- **cumulative_return:** `~11.12%`
- **annualized_volatility:** `~13.27%`
- **max_drawdown:** `-8.88%`
- **sharpe_ratio:** `~1.67`
- **cagr:** N/A (el periodo es < 365 días)

## Artifacts Generados
Los resultados están preservados en el directorio `artifacts/spy_prices_live_dryrun_0/`, listos para ser consumidos en 7H-1:
- `price_request.json`
- `raw_price_response.json`
- `normalized_price_series.json`
- `price_series_payload_candidate.json`
- `metrics_payload_candidate.json`
- `metrics_calculation_report.json`
- `validation_report.json`
- `dryrun_summary.json`
- `next_step_recommendation.json`

## Confirmaciones de Seguridad
- ✅ **Firestore Writes:** 0 (Este proceso no afectó a la BD).
- ✅ **EODHD fundamentals:** NO se usaron (bloqueado).
- ✅ **OpenFIGI live:** NO se usó.
- ✅ **Existing Assets:** SPY, QQQ, IWDA, AAPL, AAPU y GSPC permanecen intactos.

## Recomendación para Reabrir 7H-1
Puesto que `candidate_ready_for_7H1 = true` y no hay errores de validación, el candidato es **completamente viable**. Se recomienda proceder a reabrir y ejecutar el Bloque 7H-1 (`npm run firestore:spy-price-series-pilot-write`), pero esta vez validando previamente un plan de escritura real mediante el paso de los argumentos correspondientes que levanten el bloqueo `FIRESTORE_REAL_WRITE_ENABLED`.
