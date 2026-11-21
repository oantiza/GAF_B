# BLOQUE 6: Cálculo de Métricas (Price Metrics Dry-Run)

## 1. Objetivo
Tomar las series temporales mapeadas previamente (en nuestro caso, desde el EODHD Prices Coverage Dry-Run) y calcular un subconjunto de métricas de desempeño in-house. Estas métricas luego se incrustarán en Firestore en el propio documento del activo (`Asset.metrics_latest`).

## 2. Fuente de Precios Usada
El script lee la salida limpia generada en el Bloque 4G:
`artifacts/eodhd_prices_coverage_dryrun_0/mapped_price_years.json`

## 3. Métricas Calculadas y Fórmulas
1. **Cumulative Return**: `(Last Price - First Price) / First Price`.
2. **Annualized Volatility**: Volatilidad diaria (desviación estándar de rendimientos diarios) multiplicada por `sqrt(252)`.
3. **Max Drawdown**: La caída máxima histórica porcentual desde un pico hasta un valle. Presentada como número negativo decimal.
4. **Sharpe Ratio**: `(Annualized Return - Risk Free Rate) / Annualized Volatility`. (Tasa libre de riesgo por defecto a 0).
5. **CAGR**: Tasa de Crecimiento Anual Compuesto. No se calcula si el rango de fechas de observaciones válidas es inferior a 365 días.

## 4. Limitaciones y Calidad del Histórico
Cada serie temporal procesada recibe un `history_quality_status`:
- **OK**: >= 20 observaciones.
- **REVIEW**: < 20 observaciones. El análisis estadístico (Sharpe, Volatilidad) pierde robustez.
- **BLOCKED**: < 2 observaciones. Imposible calcular métricas.

## 5. Artifacts Generados
En `artifacts/price_metrics_dryrun_0/`:
- `input_summary.json`
- `metrics_latest_candidates.json` (El payload final a inyectar en `Asset.metrics_latest`).
- `metrics_issues.json` (Ej. periodos cortos, precios faltantes).
- `history_quality_report.json`
- `run_summary.json`

## 6. Integración Futura
El `metrics_latest_candidates.json` generará objetos compatibles con nuestra interfaz `Asset.metrics_latest` en Firestore. De esta manera, el Front-End podrá mostrar KPIs básicos de cada fondo/activo sin necesidad de descargar miles de precios.

## 7. Confirmación y Próximos Pasos
- **Writes en Firestore**: 0 (Dry-Run completo en local).
- **Próximos pasos**: El siguiente paso lógico, una vez mapeados los activos y las métricas, es empezar la fase de escritura (Ingesta a Firestore).
