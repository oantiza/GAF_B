# BLOQUE 4G: EODHD Prices Coverage Dry-Run

## 1. Contexto y Objetivos
- **No Fundamentals**: Por limitaciones de suscripción, se confirma el descarte temporal del desarrollo del módulo de Fundamentales. EODHD se limitará a proveer descubrimiento (identificación de símbolos) y precios históricos de cierre (EOD).
- **Objetivo**: Realizar una prueba de cobertura controlada para verificar la disponibilidad de series temporales de cierre diario en diversos tipos de activos (Acciones, ETFs, e Índices) sin impactar Firestore, y obtener conclusiones prácticas para la futura sincronización.

## 2. Parámetros de la Ejecución
- **Tickers Probados**: `AAPL.US`, `MSFT.US`, `SAN.MC`, `SPY.US`, `QQQ.US`, `IWDA.LSE`, `GSPC.INDX`, `STOXX50E.INDX`.
- **Rango temporal**: Máximo últimos 60 días naturales.
- **Modo**: LIVE DRY-RUN.

## 3. Resultados de Cobertura
*(Se llenará dinámicamente con los logs de `npm run dryrun:eodhd-prices-coverage`)*
- Cobertura Total (OK/Failed): *Ver logs*
- Filas de precio recibidas: *Ver logs*
- Year candidates generados: *Ver logs*

## 4. Fallos y Recomendaciones (EODHD)
*(Se completará con el análisis de los fallos, por ejemplo si GSPC.INDX arroja error 404).*
Recomendaciones esperadas de formato de símbolo para EODHD:
- **Acciones US**: `TICKER.US`
- **Acciones EU**: `TICKER.CódigoBolsa` (Ej: `.MC` para Madrid).
- **ETFs**: Tratan igual que las acciones.
- **Índices**: EODHD soporta índices, usualmente bajo `.INDX` (e.g., `GSPC.INDX`, `STOXX50E.INDX`), `.US`, o directamente el ticker en casos raros.

## 5. Próximos Pasos (Hacia métricas propias)
Dado que dependemos puramente de precios históricos (sin datos fundamentales embebidos de EODHD), las próximas fases (después de habilitar la escritura en base de datos) se centrarán en **cálculo in-house**. Construiremos pipelines que analicen las series temporales para derivar:
1. Volatilidad.
2. Rendimientos periódicos (YTD, 1M, 1Y).
3. Drawdowns.
4. Indicadores técnicos básicos.
