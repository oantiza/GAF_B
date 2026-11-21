# BLOQUE 4C: EODHD OpenAPI Endpoint Map

Este documento proporciona un mapa técnico de los endpoints relevantes de la API de EODHD (basado en su OpenAPI Spec) para su integración en nuestra base de datos Firestore de activos financieros.

## 1. Mapa de Endpoints EODHD

| Endpoint / Categoría | Descripción | Asset Types | Utilidad para BD | Campos Esperados | Prioridad | Tipo de Uso | Riesgos / Limitaciones | Fase Impl. |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`/search/{query}`** | Búsqueda de tickers e instrumentos financieros. | TODOS | Identificación | `Code`, `Exchange`, `Name`, `Type`, `Country`, `Currency`, `ISIN` | HIGH | Llamada individual, Búsqueda interactiva | Límite de resultados, posibles falsos positivos. | 4D |
| **`/exchange-symbol-list/{exchangeCode}`** | Lista de todos los símbolos cotizados en un exchange específico. | TODOS | Identificación, Universo | `Code`, `Name`, `Country`, `Exchange`, `Currency`, `Type`, `Isin` | HIGH | Llamada por exchange (sincronización periódica) | Gran volumen de datos. El tipo (Type) a veces es genérico. | Implementado (parcial) |
| **`/exchanges-list`** | Lista de exchanges soportados. | N/A | Identificación | `Name`, `Code`, `Country`, `Currency` | MEDIUM | Llamada única/puntual | Muy estático, no requiere actualización frecuente. | 4D |
| **`/eod/{ticker}`** | Precios históricos y EOD para un ticker. | TODOS | Precios | `date`, `open`, `high`, `low`, `close`, `adjusted_close`, `volume` | HIGH | Llamada individual o batch | Puede consumir muchos créditos si se llama por activo diariamente. | 4E |
| **`/eod-bulk-last-day/{exchange}`** | Precios EOD de todos los activos de un exchange en un día. | TODOS | Precios | `code`, `date`, `close`, `adjusted_close`, `volume` | HIGH | Llamada masiva (diaria) | Requiere gestionar gran carga de datos en memoria antes de guardar. | 4E |
| **`/fundamentals/{ticker}`** | Datos fundamentales detallados (acciones, ETFs, fondos). | STOCK, ETF, FUND | Fundamentales, Costes, Exposiciones, Quality | `General`, `Highlights`, `Valuation`, `ETF_Data` (holdings, sectors, yield, expense_ratio), `MutualFund_Data` | HIGH | Llamada individual, Enriquecimiento puntual | Endpoint costoso (suele consumir más créditos por llamada). JSON de respuesta muy grande y variable. | 4F |
| **`/div/{ticker}`** | Histórico de dividendos. | STOCK, ETF, FUND | Dividendos | `date`, `value`, `unadjustedValue`, `currency` | MEDIUM | Llamada individual | - | >4G |
| **`/splits/{ticker}`** | Histórico de splits corporativos. | STOCK, ETF | Splits | `date`, `split` (ratio) | MEDIUM | Llamada individual | - | >4G |
| **`/technical/{ticker}`** | Indicadores técnicos (SMA, EMA, RSI, etc.). | STOCK, ETF, INDEX | Momentum, Tendencia | Valores del indicador técnico por fecha | LOW | Llamada individual / Análisis | Podría calcularse in-house si ya tenemos los precios. | >4G |
| **`/macro-indicator/{country}`** | Datos macroeconómicos. | OTHER | Análisis Macro | Tipos de interés, inflación, PIB, desempleo | LOW | Llamada puntual / Enriquecimiento | No mapea directamente a un activo, sino a un mercado. | >4G |

---

## 2. Gaps Frente al Conector Actual

Analizando el código en `src/providers/eodhd/`:
- **`eodhdClient.ts`**: Contiene métodos HTTP genéricos (`buildEodhdUrl`, `eodhdFetchJson`). No está atado a ningún endpoint específico, lo cual es excelente y extensible. Sin embargo, no incluye control de retries (backoff exponencial) necesario para llamadas en masa.
- **`eodhdMapper.ts`**: Solo soporta el mapeo de la respuesta del endpoint `/exchange-symbol-list` (`EodhdTickerListItem`). Faltan mappers para precios (`/eod`), fundamentales (`/fundamentals`) o búsquedas (`/search`).
- **`eodhdDryRun.ts`**: Actualmente utiliza el endpoint `/exchange-symbol-list/US` o un archivo local (`eodhd_sample_response.json`). No hay flujos para probar la bajada de precios o fundamentales.

**Resumen de Gaps**:
1. Falta soporte (tipos, schemas y mappers) para el endpoint `/fundamentals/{ticker}`.
2. Falta soporte para los endpoints de precios (`/eod/{ticker}` y `/eod-bulk-last-day/{exchange}`).
3. Faltan mecanismos para realizar búsquedas específicas (`/search/{query}`).
4. No tenemos test local/fixtures para respuestas complejas como la de fundamentales de ETFs/Fondos.

---

## 3. Propuesta de Evolución

*   **Bloque 4D: EODHD live dry-run mínimo**
    *   Implementar llamadas live para `/search/{query}` y `/exchanges-list` de forma controlada (sin guardado).
    *   Ampliar los tipos en `eodhdTypes.ts` para soportar las respuestas de estos endpoints básicos.
*   **Bloque 4E: EODHD prices dry-run**
    *   Añadir tipos y mappers para `/eod/{ticker}` y `/eod-bulk-last-day/{exchange}`.
    *   Crear un script de dry-run que descargue los precios históricos de un pequeño set de prueba de tickers, mapeándolo a nuestro formato de series temporales.
*   **Bloque 4F: EODHD fundamentals dry-run**
    *   Implementar el mapeo complejo de `/fundamentals/{ticker}`, distinguiendo la lógica entre ETFs, Mutual Funds y Stocks (extraer el `expense_ratio`, `holdings`, `sector_weights`).
    *   Descargar un JSON de fundamentales real de un ETF y un Fondo para consolidar las fixtures de testing.
*   **Bloque 4G: EODHD ETFs/funds coverage review**
    *   Hacer un cruce con los ISINs/tickers de nuestra muestra de la base de datos para medir el nivel de cobertura (hit rate) de EODHD en la categorización e información fundamental de fondos europeos y ETFs globales.
