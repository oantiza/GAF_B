# BLOQUE 4D: EODHD LIVE DRY-RUN (Controlado)

Este documento registra los resultados de la primera ejecución *live* del conector EODHD, diseñada como un dry-run mínimo y controlado para validar la conectividad sin riesgo de afectar la base de datos o incurrir en sobrecostes.

## 1. Resumen de la Ejecución

- **Modo ejecutado**: LIVE DRY-RUN (Token detectado correctamente y configuración `EODHD_LIVE_DRYRUN=true`).
- **Endpoint utilizado**: `/exchange-symbol-list/US` (sin token impreso).
- **Número de requests (HTTP)**: 1
- **Número de items recibidos**: 51683 (Truncado a **3** por seguridad `maxRequests`).
- **Número de assets mapeados**: 3

## 2. Resultados del Mapeo e Ingestión

| Categoría | Cantidad |
| :--- | :--- |
| **OK** | 0 |
| **REVIEW** | 3 |
| **BLOCKED** | 0 |

### Principales Issues Observados
- Los 3 activos procesados cayeron en estado **REVIEW**. 
- Revisando la muestra generada (`provider_raw_sample.json`), los 3 activos correspondieron a índices (`Type: "INDEX"`) que no poseen ISIN (ej. `^MGTN`, `^TNX`, `^W5000`).
- Dado que carecen de un ISIN válido, nuestro validador los marca adecuadamente para revisión. Esto confirma que el pipeline de calidad funciona tal y como se diseñó.

### Errores y Limitaciones
- **Errores HTTP**: Ninguno.
- **Rate Limits**: Ninguno. La limitación por seguridad local previno posibles bloqueos o cobro masivo de créditos.
- **Campos inesperados**: Ninguno. El JSON de respuesta coincide perfectamente con nuestra interfaz `EodhdTickerListItem`.

## 3. Comparación con BLOQUE 4C (OpenAPI Map)
- **Volumen de Datos**: En nuestro mapeo previo (Bloque 4C) indicamos para este endpoint: *"Gran volumen de datos"*. Esto se confirmó de inmediato, ya que una sola llamada devolvió **51,683** items solo para el mercado de US.
- **Categorización Genérica**: Como se anticipó en el mapa de endpoints, el campo `Type` puede ser muy amplio (los primeros 3 items fueron "INDEX").

## 4. Recomendaciones para Bloque 4E (Precios EOD)
Para el siguiente bloque, donde abordaremos los precios de fin de día (`/eod/{ticker}` o `/eod-bulk-last-day/{exchange}`):
1. **Paginación y Estrangulamiento**: Deberemos tener especial cuidado si utilizamos el endpoint masivo `eod-bulk-last-day`, dado el volumen masivo de datos observado (51k items = 51k precios diarios). Será imperativo procesarlos por lotes.
2. **Cruce Previo**: Antes de pedir precios individuales (o fundamentales), deberíamos filtrar los 51k activos para solicitar solo aquellos que de verdad nos interesen o ya estén en nuestra base de datos.
3. **Manejo de Errores Live**: Implementar lógica de reintentos (Exponential Backoff) en `eodhdClient.ts` antes de lanzar procesos que tarden horas.
