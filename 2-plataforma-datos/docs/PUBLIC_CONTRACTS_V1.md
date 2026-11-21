# Public Contracts v1

Esta documentación define los contratos públicos de consumo para interactuar con la Base de Datos de Activos Financieros (BBDD-ACTIVOS-FINANCIEROS).

## Qué es un contrato público
Un contrato público es una interfaz estable y versionada que abstrae la complejidad subyacente de cómo se almacenan o agrupan los datos internamente en Firestore (por ejemplo, fragmentación de holdings, subcolecciones de series de precios o métricas). Estos contratos garantizan compatibilidad hacia atrás en los tipos principales de modo que consumidores como NUVIA, BDB-FONDOS, screeners o herramientas de reporting no se rompan ante rediseños internos de la base de datos de origen.

## Reglas para los consumidores externos
- **NO leer Firestore directamente:** Está estrictamente prohibido que aplicaciones externas consulten las colecciones crudas de `fondosdb` en Firestore. La estructura de Firestore es agil, de uso interno, y está sujeta a rediseños sin previo aviso.
- **Usar los wrappers (Query Layer / Search Layer):** Las llamadas a la base de datos deben realizarse por las capas de abstracción estables provistas por el paquete centralizado o API Gateway.

## Contratos disponibles (v1 preview)

- `PublicAssetType`: Enumeración estricta de clases maestras de activos (`FUND`, `ETF`, `STOCK`, `INDEX`, `OTHER`, `UNKNOWN`).
- `PublicCoverageStatus`: Indica el nivel de madurez o hidratación del activo (`COMPLETE_FUND`, `PARTIAL_MARKET_ASSET`, `MISSING`, etc.).
- `PublicReadCostEstimate`: Reporte detallado del costo de la consulta ejecutada, fundamental para consumers que necesiten ser cost-aware.
- `PublicFundOverview`: Contrato que encapsula la metadata y holdings de un fondo.
- `PublicMarketAssetOverview`: Contrato que encapsula acciones, ETFs o índices, junto con sus métricas y listados.
- `PublicSearchResponse`: Contrato estandarizado de la capa de búsqueda con scoring y soporte de warning.

## Coste y lecturas (Read Cost Semantics)
La estructura `PublicReadCostEstimate` se inyecta en cada respuesta para hacer transparente a los consumidores de BDB-FONDOS los costos Firestore por debajo del motor.
- **`MOCK_PREVIEW`**: Se ejecutó en entorno mock. 0 reads de Firestore reales.
- **`EXACT_LOOKUP`**: Consultas puntuales por ID principal (generalmente con un costo estimado de `1` a pequeña escala, pero varía según componentes solicitados).
- **`FIRESTORE_SCAN`**: Operación naive sobre colecciones enteras (`O(N)` u `N_DOCUMENT_READS`). **No recomendada** para entornos productivos.

## Compatibilidad y Versionado
Actualmente en fase **v1 preview**. Las interfaces `PublicFundOverview` y `PublicMarketAssetOverview` permiten adiciones no destructivas de nuevas propiedades sin invalidar las actuales (por diseño en TypeScript permitiendo `[key: string]: any` en los objetos para flexibilizar la hidratación parcial temporal, pero los contratos fijos expuestos en esta documentación son el standard mínimo inamovible).
