# Bloque 27A — Screener Contract Preview & Minimal Consumer Adapter Design

Este documento especifica el diseño, los requisitos de seguridad, el análisis de costes y las reglas de negocio para el futuro buscador/screener consumidor de la base de datos de activos financieros.

---

## 1. Objetivo del Bloque
Definir un contrato público mínimo y simular de manera estricta y segura las búsquedas de activos en un entorno de solo lectura. Se busca garantizar la ergonomía y predictibilidad de los costes de Firestore antes de permitir a cualquier aplicación consumidora realizar integraciones reales.

---

## 2. Contrato Mínimo del Screener

El contrato define las interfaces de tipos en TypeScript para peticiones, resultados y respuestas:

### Petición (`ScreenerSearchRequest`)
```typescript
interface ScreenerSearchRequest {
    query: string;
    query_type: "ASSET_ID" | "ISIN" | "TICKER" | "NAME";
    asset_types?: PublicAssetType[];
    limit: number;                 // Obligatorio y positivo para evitar lecturas ilimitadas
    include_cost_estimate?: boolean;
    include_match_reason?: boolean;
    include_coverage_status?: boolean;
    simulate_external_index?: boolean; // Simulación de indexación externa (e.g., Algolia)
}
```

### Resultado Individual (`ScreenerSearchResult`)
```typescript
interface ScreenerSearchResult {
    asset_id: string;
    asset_type: PublicAssetType;    // Ej: "STOCK", "FUND", "ETF" (nunca "EQUITY")
    display_name: string;
    identifiers: {
        isin?: string;
        ticker?: string;
    };
    match_type: "ASSET_ID" | "ISIN" | "TICKER" | "NAME" | "NONE";
    match_score?: number;
    coverage_status?: PublicCoverageStatus;
    summary?: {
        asset_class?: string;
        provider_or_exchange?: string;
    };
    available_sections?: string[];
    cost_estimate?: PublicReadCostEstimate;
    warnings?: string[];
}
```

### Respuesta del Motor (`ScreenerSearchResponse`)
```typescript
interface ScreenerSearchResponse {
    results: ScreenerSearchResult[];
    total_results: number;
    query_strategy: "EXACT_LOOKUP" | "EXTERNAL_INDEX" | "FIRESTORE_COLLECTION_SCAN" | "UNKNOWN";
    estimated_reads: number | "N_DOCUMENT_READS";
    risk_level: "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
    blocked: boolean;
    warnings: string[];
    forbidden_reason?: string;
}
```

---

## 3. Estrategias y Patrones Permitidos

*   **Lookup Exacto por ID de Activo (`query_type: "ASSET_ID"`):** Consulta directa al documento raíz del activo ($O(1)$ reads). Patrón de coste muy bajo y 100% seguro.
*   **Lookup Exacto por ISIN (`query_type: "ISIN"`):** Resolución mediante un documento indexado o mapa de ISIN a ID de activo ($O(1)$ reads). Muy seguro.
*   **Lookup por Ticker (`query_type: "TICKER"`):** Consulta exacta por ticker. El contrato emite una advertencia debido a la potencial ambigüedad de tickers iguales cotizados en diferentes bolsas mundiales (se recomienda resolver listings primarios).
*   **Límites de Resultados Obligatorios:** Las peticiones deben tener asignado un límite de registros `limit` positivo para que Firestore no devuelva listas masivas innecesarias.
*   **Búsquedas de Texto en Índices Externos:** Permitir la búsqueda por nombre del activo (`NAME`) únicamente cuando se resuelve a través de una base de datos de indexación externa (como Algolia, Elasticsearch o un índice tokenizado pre-generado).

---

## 4. Estrategias y Patrones Prohibidos

> [!CAUTION]
> *   **Acceso Firestore Raw Directo:** Ningún consumidor debe conectarse de forma nativa a la base de datos de Firestore para realizar búsquedas sin pasar por las capas de Query y Search de la plataforma.
> *   **Scans Lineales por Nombre en Firestore (`FIRESTORE_COLLECTION_SCAN`):** Las búsquedas por nombre con comodines que fuercen la lectura lineal de todos los documentos están estrictamente prohibidas y bloqueadas (`risk_level: "BLOCKED"`), ya que el coste escala linealmente con el tamaño de la base de datos ($O(N)$).
> *   **Uso del tipo de activo `'EQUITY'`:** El tipo de activo para las acciones en peticiones y resultados debe ser `'STOCK'`. La clasificación o clase de activo asociada sí puede ser `'EQUITY'`.
> *   **Cargas Masivas Iniciales:** Prohibido descargar los históricos de precios o las subcolecciones de holdings de fondos en pantallas iniciales o listados generales de screener.

---

## 5. Estimación de Costes de Lectura de Firestore

| Tipo de Búsqueda | Estrategia de Consulta | Lecturas de Firestore | Nivel de Riesgo | Estado |
| :--- | :--- | :--- | :--- | :--- |
| **Por ID del Activo** | Directa al documento raíz | 1 read | `LOW` | Permitido |
| **Por ISIN** | Mapeo mediante índice ISIN | 1 read | `LOW` | Permitido |
| **Por Ticker** | Mapeo mediante índice Ticker | 1 read | `LOW` | Permitido (con advertencia de exchange) |
| **Por Nombre (con índice externo)** | Pre-búsqueda en índice externo + lookup final | 5 reads aprox. | `LOW` | Permitido |
| **Por Nombre (sin índice externo)** | Collection Scan lineal de Firestore | `N_DOCUMENT_READS` | `BLOCKED` | **Bloqueado** |

---

## 6. Próximos Pasos para la Integración del Consumidor Real

1.  **Publicación de Contratos:** Integrar las interfaces del screener en la definición de la librería pública cliente (e.g., NPM package interno o subdirectorio compartido).
2.  **Sincronización del Índice Externo:** Cuando se realicen escrituras controladas en la base de datos (con `FIRESTORE_REAL_WRITE_ENABLED=true`), se debe orquestar un trigger de Firestore Cloud Function para sincronizar los cambios de nombre del activo a Algolia o a una colección dedicada de índices.
3.  **Adaptador del Consumidor (Screener):** El componente del Buscador/Screener del consumidor debe conectarse al API Gateway del catálogo de activos, recibiendo la respuesta normalizada de `ScreenerSearchResponse` y dibujando de forma perezosa la información básica e identificadores.
