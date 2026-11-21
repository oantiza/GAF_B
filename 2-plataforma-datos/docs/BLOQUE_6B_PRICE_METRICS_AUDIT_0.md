# BLOQUE 6B: Price Metrics Audit

## 1. Resumen de Métricas Generadas
El dry-run de métricas ha procesado exitosamente los precios del coverage test. Las fórmulas están auditadas:
- **Rentabilidad**: `cumulative_return`, `cagr` (limitado a >365 días).
- **Riesgo/Volatilidad**: `annualized_volatility` (con factor `sqrt(252)`), `max_drawdown` (forzado como decimal <= 0).
- **Risk-Adjusted**: `sharpe_ratio` (usando una `risk_free_rate` configurable, base 0).
- **Calidad**: `observations_count`, status de calidad y chequeos contra precios nulos/negativos/cero.

## 2. Contrato Recomendado (Separación)
Actualmente, `metrics_latest_candidates.json` devuelve una estructura combinada. Sin embargo, antes del "write gate" (Ingesta), sugerimos partir la data en 3 campos conceptuales que vivirán dentro del documento maestro del activo (`Asset` en Firestore):

### A) `metrics_latest` (Rentabilidad y Retorno)
Se enfoca puramente en el desempeño positivo de precios.
```json
"metrics_latest": {
  "cumulative_return": 0.15,
  "cagr": 0.12,
  "ytd_return": null,
  "updated_at": "2026-06-04T12:00:00Z"
}
```

### B) `risk_latest` (Volatilidad y Caídas)
Agrupa las métricas relacionadas con riesgo de mercado.
```json
"risk_latest": {
  "annualized_volatility": 0.18,
  "max_drawdown": -0.25,
  "sharpe_ratio": 0.85,
  "updated_at": "2026-06-04T12:00:00Z"
}
```

### C) `history_quality` (Integridad del Dato)
Guarda la trazabilidad de qué tan fiables son estas métricas.
```json
"history_quality": {
  "status": "OK", // OK | REVIEW | BLOCKED
  "observations_count": 252,
  "missing_close_count": 0,
  "first_date": "2025-06-04",
  "last_date": "2026-06-04"
}
```

Esta separación semántica permitirá en el front-end hacer queries más limpios (ej. indexar fondos por riesgo bajo sin cargar métricas de retorno).

## 3. Issues y Controles Actuales
- Precios con valor `0` o `< 0` son ignorados y generan el issue `INVALID_PRICE`.
- Observaciones insuficientes bloquean el cálculo.
- Periodo menor a 1 año (`< 365 días`) anula el cálculo de `CAGR` (evita distorsiones anualizadas en series de semanas).

## 4. Riesgos antes de Writes
1. El `risk_free_rate` actual por defecto es `0`. Si queremos un Sharpe real para comparar activos europeos contra americanos, deberíamos inyectar un risk-free rate contextual (Euribor vs US Treasury Yield).
2. Los `daily_returns` completos (arrays) se guardan en el modelo temporal, pero **NO** deben guardarse dentro del documento de Firestore principal para no engordar el documento (max 1MB en Firestore). Se descartan en la separación final.

## 5. Confirmación de Fundamentals
Queda **confirmado** que el módulo de EODHD Fundamentals se excluye del diseño para evitar fallos de suscripción. Todas las métricas dependerán de *Price Action*.
