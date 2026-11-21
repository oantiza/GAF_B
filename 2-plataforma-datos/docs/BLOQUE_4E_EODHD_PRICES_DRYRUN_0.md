# BLOQUE 4E: EODHD Prices Dry-Run

## 1. Objetivo
Probar la extracción y mapeo de precios históricos de fin de día (EOD) para un universo mínimo y controlado de activos, validando que el formato de salida sea el correcto para su futura inserción en la sub-colección `asset_prices/{asset_id}_{year}` en Firestore.

## 2. Configuración de Ejecución
- **Endpoint usado**: `/eod/{ticker}` (Precios EOD).
- **Modo ejecutado**: FIXTURE / LIVE (dependiendo de las variables de entorno).
- **Tickers testeados**: `AAPL.US`, `MSFT.US`, `SAN.MC`.
- **Rango de fechas**: Máximo 30 días recientes (calculado dinámicamente desde `today - 30 days` hasta `today`).
- **Requests realizados**: Máximo 3 por ejecución (1 por ticker).
- **Live Guard**: El script cuenta con un truncado de emergencia (`max 100` filas) por si el endpoint de la API devuelve el histórico de 20 años completo, para no ahogar la memoria.

## 3. Resumen de Ejecución
*(Estos datos se llenan al ejecutar `npm run dryrun:eodhd-prices`)*
- Número de requests: *Ver logs*
- Número de filas de precio recibidas: *Ver logs*
- Número de year candidates generados: *Ver logs*
- Issues detectados: *Ver logs*

## 4. Estructura de Salida y Compatibilidad Futura
El mapper `eodhdPricesMapper.ts` fue diseñado bajo las siguientes reglas críticas:
1. **Separación total**: Los precios **no** se incrustan en el documento base del activo (`Asset`).
2. **Agrupación anual**: Todos los precios de un activo para un año fiscal (ej. `2024`) se agrupan en un único documento de Firestore.
3. **Array Cronológico**: Dentro del documento anual, el campo `prices` es un array cronológico (ver `mapped_price_years.json`).
Esto minimiza escrituras (solo se hace un update (arrayUnion) o set por año) y maximiza la velocidad de lectura de gráficas anuales.

## 5. Artifacts Generados
La ejecución escribe los siguientes archivos en `artifacts/eodhd_prices_dryrun_0/`:
- `input_config.json`: Configuración utilizada.
- `provider_raw_prices_sample.json`: RAW payload desde EODHD.
- `mapped_price_years.json`: Formato listo para insertar en Firestore.
- `price_issues.json`: Entradas sueltas con problemas (sin precio de cierre, fecha inválida, etc.).
- `price_validation_report.json`: Reporte del validador.
- `run_summary.json`: Métricas de la ejecución.

## 6. Riesgos Evaluados
- **Escrituras en BBDD**: **Cero**. Este bloque es exclusivamente DRY-RUN (simulación de Ingesta a ficheros locales).
- **Sobrecostes EODHD**: Mitigados gracias a las fechas acotadas (`from`, `to`), y el límite duro de 3 tickers configurado en el script.
