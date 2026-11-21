# BLOQUE 23D: Search Layer Preview

## Problema que resuelve
Actualmente, no hay una forma centralizada y agnóstica para que los consumidores (como NUVIA o screeners) realicen búsquedas de activos en la base de datos de manera uniforme. Realizar búsquedas directas en Firestore obligaría a cada consumidor a implementar su propia lógica de normalización de cadenas y conocer las convenciones estructurales, además de requerir múltiples lecturas o índices complejos.

## Por qué no usar motores externos ahora
Herramientas como Algolia, Elasticsearch o Meilisearch requieren infraestructuras adicionales, costes mensuales, y sincronizaciones continuas de datos. Para la escala actual, una aproximación **Firestore-friendly** o de índices in-memory/in-database es mucho más adecuada, barata y fácil de mantener.

## Contratos implementados
- `normalizeSearchText(input)`: Estandariza strings (lowercase, quita acentos y espacios extra) para búsquedas robustas.
- `buildSearchTokens(asset)`: Extrae tokens locales desde el root (ISIN, ticker, nombre, clases, proveedor, etc.).
- `searchAssets(query, deps, options)`: Interfaz principal para la búsqueda unificada y flexible con opciones como `asset_type`, `limit`, etc.
- `searchFunds(query, deps, options)`: Wrapper específico de búsqueda que solo retorna fondos.
- `searchMarketAssets(query, deps, options)`: Wrapper que retorna acciones, índices y ETFs.

## Estrategia Firestore-friendly
La Search Layer está diseñada pensando en un uso optimizado de la base de datos:
- **Modo actual (preview)**: Se carga un dataset en memoria para resolver búsquedas lógicas mediante tokens sin costes operativos reales.
- **Modo futuro**: Podría apoyarse en una consulta exacta (`==`) por ISIN/asset_id (1 lectura) o en consultas de arreglos pre-calculados (`array-contains`) integrados directamente en el documento root mediante un *Write Gate*.

## Limitaciones
- La búsqueda tipo "prefijo" estricta o "fuzzy match" es compleja nativamente en Firestore sin arreglos expansivos de tokens (n-gramas) que inflan el tamaño del documento.
- Actual preview asume que los clientes traerán todo un set en memoria si deciden no usar índices o, de lo contrario, delega al backend la resolución indexada.

## Coste estimado
Todas las respuestas incorporan una métrica `read_cost_estimate` que provee a los consumidores una expectativa clara sobre la pesadez de la solicitud:
- `mode`: El modo de la consulta (`MOCK_PREVIEW`, `FIRESTORE_SCAN`, etc.).
- `actual_firestore_reads`: 0 en esta preview local.
- `estimated_firestore_reads`: `N_DOCUMENT_READS` si se implementara como un scan (O(N)), o `1` si fuera un lookup por índice exacto en el futuro.
- `warning`: Advertencias explícitas de que los naive scans no son aptos para producción en clientes sensibles al coste.

## Tests y Typecheck
Se implementaron casos unitarios estrictos validando la funcionalidad sobre un dataset artificial:
- Búsquedas por ISIN, Ticker y Nombre parcial.
- Filtros por `asset_type` (`FUND` vs `STOCK`).
- Todos los tests (`npm test`) y la compilación de tipos (`npm run typecheck`) han arrojado PASS.

## Confirmación de Seguridad
- Firestore writes: 0
- Firestore deletes: 0
- FIRESTORE_REAL_WRITE_ENABLED: False

## Próximos pasos
1. **Public Contracts v1**: Exponer `QueryLayer` y `SearchLayer` en un paquete NPM interno o exportar los tipos para consumición estable.
2. Integración en **NUVIA / BDB-FONDOS** para sustituir llamadas viejas o directas a Firestore.
