# BLOQUE 4E-B: EODHD Prices Audit

## Resumen del Dry-Run
El dry-run de precios (Bloque 4E) se completó con éxito.
- **Tickers procesados**: `AAPL.US`, `MSFT.US`, `SAN.MC`.
- **Rango**: Últimos 30 días (dinámico).
- **Número de rows (precios recibidos)**: 64 filas en total.
- **Year candidates generados**: 3 (los 3 tickers generaron datos para el año en curso).
- **Issues detectados**: 0 en la prueba real (la API respondió con formatos válidos y sin faltantes de precio de cierre).

## Estructura Final Propuesta para `asset_prices`
El mapper genera un payload limpio bajo la interfaz `AssetPriceYearCandidate`, compatible con inserciones en Firestore.
La colección destino recomendada (sub-colección o colección principal indexada) es:
**`asset_prices/{asset_id}_{year}`**

Estructura validada del payload:
```json
{
  "asset_id": "mock_id_AAPL.US",
  "ticker": "AAPL.US",
  "year": 2026,
  "source": "EODHD",
  "prices": [
    {
      "date": "2026-05-05",
      "close": 185.2,
      "adjusted_close": 185.2,
      "volume": 42000000
    },
    ...
  ],
  "timestamps": {
    "created_at": "...",
    "updated_at": "..."
  }
}
```

## Reglas de Auditoría Confirmadas
1. **Separación Estricta**: No se meten precios dentro del documento maestro `Asset` en la colección de activos.
2. **Agrupación Cronológica Anual**: Los precios se encapsulan en arrays de un año, optimizando los reads para gráficos y análisis.
3. **Validación de Integridad**: 
   - Filas sin fecha, sin formato `YYYY-MM-DD`, o sin valor `close` son descartadas y notificadas como *issues*.
   - Si `asset_id` está vacío, se descarta todo el batch.
4. **Campos Opcionales**: `adjusted_close` y `volume` se propagan limpiamente si el proveedor los incluye.
5. **Aislamiento de Entorno**: No existen tokens, configuraciones ni secretos volcados en `run_summary.json` o `input_config.json`.

## Riesgos antes de Escritura Real
1. **Volumen de Series Temporales**: Si tenemos miles de activos, escribir (update `arrayUnion` o `set` con merge) diariamente requiere una estrategia de _batching_ robusta (ej. Firebase Admin SDK `db.batch()`), ya que las escrituras masivas directas pueden incurrir en cuotas de throttling en Firestore (máx. 500 writes por batch, o límites de escritura por segundo por documento).
2. **Cruce de Asset ID**: Actualmente usamos un `mock_id_TICKER` en el dry-run. Para el bloque final de escritura, necesitamos resolver o consultar el `asset_id` real de Firestore asociado al ticker/ISIN consultado en la API.

## Confirmación
- **Writes en Firestore**: 0
- **Protección de Datos Sensibles**: `.env.local` completamente aislado del output.
