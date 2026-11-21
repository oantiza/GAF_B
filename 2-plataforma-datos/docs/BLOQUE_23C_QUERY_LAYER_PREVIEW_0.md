# BLOQUE 23C: Query Layer Preview

## Problema que resuelve
Actualmente, los proyectos consumidores (como NUVIA, BDB-FONDOS, reporting y screeners) tendrían que acceder directamente a las colecciones crudas de Firestore y conocer los detalles de cómo se estructuran los activos, los holdings (single document vs chunked documents), y cómo interpretar la completitud de los datos.

## Por qué los consumidores no deben leer Firestore directo
Si los consumidores leen Firestore directamente:
1. Quedan fuertemente acoplados a la estructura física de los datos (e.g. `assets/{id}/holdings/manifest/chunks/{chunk_id}`).
2. Podrían realizar consultas costosas, ineficientes o redundantes.
3. Cualquier evolución en el modelo de datos requeriría actualizar múltiples proyectos.
4. Es más difícil aplicar lógicas unificadas (como la semántica de coverage o remoción de retrocesiones en costes).

## Contratos propuestos
La nueva capa de consultas (`src/readModels/queryLayer.ts`) expone los siguientes contratos read-only, inyectables y agnósticos:
- `getFundOverview(assetId, deps)`: Devuelve la visión agregada de un fondo sin traer sus posiciones, pero con el recuento y modo de almacenamiento, filtrando costes privados e inyectando `coverage_status`.
- `getMarketAssetOverview(assetId, deps)`: Visión agregada de un Market Asset, con listing primario, métricas recientes, un resumen de la series de precios y estado de cobertura.
- `getAssetOverview(assetId, deps)`: Agregador general rápido.
- `getHoldingsSummary(assetId, deps)`: Extractor exclusivo de resumen de cartera sin resolver todas las posiciones.
- `getCoverageStatus(assetId, deps)`: Reutiliza la lógica de coverages refinados sobre una abstracción de db-agnostic dependencies.

## Estrategia de coste
Cada contrato devuelve un objeto `read_cost_estimate` que indica al consumidor el coste en operaciones de lectura subyacentes. La capa está diseñada para:
- No leer `price_series` completas al listar un market asset.
- No leer todos los chunks de un fondo sólo para saber el número de posiciones.

## Funciones implementadas
1. `getHoldingsSummary`
2. `getCoverageStatus`
3. `getFundOverview`
4. `getMarketAssetOverview`
5. `getAssetOverview`

## Preview ejecutado
El script `scripts/runQueryLayerPreview.ts` se implementó para ejecutar pruebas locales con datos simulados (o modo live en read-only si las variables de entorno están activas).
- Valida la carga limpia de diferentes casuísticas.
- Funciona correctamente y reporta `firestore_writes=0`.

## Tests y Typecheck
- **Tests**: Se crearon casos de prueba unitarios robustos con Vitest y mocks de inyección, evaluando completitud de `FUND` (con holdings documentados o justificados como `IE00B4ND3602`), `MARKET_ASSET`, e items tipo `COMPLETE_LATER`.
- **Typecheck**: `npm run typecheck` devuelve PASS completo.
- **Test suite**: `npm test` devuelve PASS.

## Confirmaciones de seguridad
- Firestore writes: 0
- Firestore deletes: 0
- FIRESTORE_REAL_WRITE_ENABLED no se activó.

## Próximos pasos
El paso propuesto natural después de asentar el Query Layer es el **Bloque 23D (Search Layer)** para exponer búsquedas o listados generales unificados, o **Bloque 24A Public Contracts v1** si se decide que la Query Layer actual será la versión estable V1 a exportar a otros microservicios o repositorios.
