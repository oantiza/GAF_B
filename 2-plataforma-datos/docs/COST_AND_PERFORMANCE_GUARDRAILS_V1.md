# Cost & Performance Guardrails v1

Este documento establece las directrices de rendimiento y los guardrails operacionales para la base de datos de activos financieros (BBDD-ACTIVOS-FINANCIEROS), diseñados para orientar el coste de Firestore hacia un consumo cero o muy bajo en la fase actual.

---

## 1. Naturaleza de las Estimaciones

> [!NOTE]
> - **Costes Direccionales:** Los costes e indicadores de lectura detallados en este documento deben tratarse como **estimaciones direccionales e indicativas**, no como una contabilidad exacta de costes de facturación. Su propósito es guiar las decisiones de diseño arquitectónico y de consumo.
> - **Baseline Conservador:** El escenario de 1,250 activos raíz detallado a continuación representa un **baseline conservador y sobredimensionado** (tirando por arriba) para la cobertura inicial del proyecto. El volumen de activos reales probablemente será menor durante las primeras etapas.
> - **Guardrail Operativo de Fase:** El objetivo actual es mantener el consumo en niveles mínimos sin sobredimensionar la infraestructura. Si en el futuro el proyecto supera estos umbrales o escala masivamente, se contempla como parte de la estrategia técnica migrar o complementar esta base de datos hacia una solución dedicada. No se recomienda introducir tecnologías externas de búsqueda (como Algolia, Elasticsearch o Cloud Run) de forma prematura si el uso real no lo justifica.

---

## 2. Baseline Conservador de Capacidad

El sistema se evalúa técnicamente utilizando el siguiente escenario de capacidad como baseline principal:

- **Activos Raíz Totales (Upper Bound):** 1,250 activos distribuidos en:
  - **Fondos (Funds):** 800 activos.
  - **ETFs:** 150 activos.
  - **Acciones (Stocks):** 300 activos.
  
- **Histórico Evaluado:**
  - Fondos: 15 años de datos.
  - ETFs: 10 años de datos.
  - Acciones: 15 años de datos.
  - Días de negociación estimados por año: 252 días.

- **Métricas Direccionales Consolidadas:**
  - Puntos de datos históricos totales estimados: **4,536,000 puntos**
    - Fondos: \(800 \times 15 \times 252 = 3,024,000\)
    - ETFs: \(150 \times 10 \times 252 = 378,000\)
    - Acciones: \(300 \times 15 \times 252 = 1,134,000\)
  - Documentos anuales de series de precios estimados: **18,000 documentos**
    - Fondos: \(800 \times 15 = 12,000\)
    - ETFs: \(150 \times 10 = 1,500\)
    - Acciones: \(300 \times 15 = 4,500\)

---

## 3. Forma de Almacenamiento y Estructuración de Históricos

Para garantizar lecturas eficientes en Firestore, el diseño de persistencia se rige por las siguientes pautas:

- **Recomendado (Yearly):**
  `assets/{asset_id}/price_series/yearly/{YYYY}`
  Agrupa las cotizaciones de un año entero (aproximadamente 252 registros) dentro de un único documento. Leer un año completo de datos cuesta **exactamente 1 lectura**.

- **Prohibido (Daily):**
  `assets/{asset_id}/price_series/daily/{YYYY-MM-DD}`
  Un documento individual por día por activo. Esta estructura está **estrictamente prohibida** en esta fase porque multiplicaría de forma exponencial el número de lecturas para consultas simples.

---

## 4. Estimación Direccional de Lecturas para Históricos

Utilizando la forma de almacenamiento recomendada, las lecturas estimadas son:
- **1 activo / 1 año:** 1 lectura.
- **1 activo / 10 años:** 10 lecturas.
- **1 activo / 15 años:** 15 lecturas.
- **10 activos / 10 años:** 100 lecturas.
- **20 activos / 15 años:** 300 lecturas.
- **Escanear el histórico completo de todos los activos:** **BLOCKED** (Bloqueado).

---

## 5. Clasificación de Operaciones por Riesgo

### LOW RISK
Operaciones seguras y eficientes con coste constante mínimo.
- **`SEARCH_EXACT_ASSET_ID` / `SEARCH_EXACT_ISIN` / `SEARCH_EXACT_TICKER`:** Lookup directo por identificador único (1 lectura).
- **`GET_PRICE_SERIES_YEAR`:** Carga un año completo de histórico de precios (1 lectura).
- **`GET_HOLDINGS_SUMMARY`:** Lee metadatos del holdings (1 lectura).
- **`GET_FUND_OVERVIEW`:** Obtiene la ficha general del fondo sin posiciones completas (3 lecturas).
- **`SEARCH_TEXT_LOCAL_PREVIEW`:** Búsqueda textual ejecutada localmente en memoria (0 lecturas).

### MEDIUM RISK
Operaciones controladas bajo interacción del usuario.
- **`GET_MARKET_ASSET_OVERVIEW`:** Consolida información básica, listados y métricas recientes (4 lecturas).
- **`GET_FULL_HOLDINGS` (Estándar):** Carga todas las posiciones de un fondo normal (hasta 5 chunks, <1000 posiciones, típicamente 2-4 lecturas).
- **`GET_PRICE_SERIES_FULL_HISTORY` (Acotado):** Carga el histórico completo de un único activo para un periodo menor o igual a 10 años (hasta 10 lecturas).

### HIGH RISK
Operaciones costosas que deben ser monitoreadas o paginadas.
- **`GET_FULL_HOLDINGS` (Masivo):** Carga carteras con más de 1000 posiciones o 5 chunks.
- **`GET_PRICE_SERIES_FULL_HISTORY` (Largo):** Carga de histórico de 15 años (15 lecturas).
- **`SEARCH_FIRESTORE_SCAN` (Con límite):** Escaneo de colección con límite de registros.

### BLOCKED (Bloqueado)
Acciones inaceptables que lanzan un error programático.
- **`DIRECT_FIRESTORE_ACCESS_BY_CONSUMER`:** Intentos de conexión directa al SDK de Firestore por clientes externos sin pasar por los wrappers API.
- **Documento diario por activo:** Almacenamiento de un documento diario individual.
- **Carga de histórico completo en pantalla inicial:** Forzar la descarga de 10-15 años de precios de forma innecesaria al renderizar una vista inicial.
- **`SEARCH_FIRESTORE_SCAN` sin límites:** Escaneos ciegos del catálogo total.

---

## 6. Recomendaciones de Integración para Consumidores (NUVIA, BDB-FONDOS, etc.)

1. **Utilizar Wrappers Estables:** Ninguna aplicación externa debe consultar Firestore crudo. Deben utilizar exclusivamente los métodos provistos por `queryLayer` y `searchLayer`.
2. **Carga Perezosa de Históricos:** Las pantallas iniciales de detalle de activo deben cargar el último precio de cierre y las estadísticas básicas. El gráfico histórico debe cargarse de forma diferida y acotando el rango.
3. **Plan de Migración Futura:** En caso de que el volumen real de activos o la concurrencia de clientes escale por encima de los umbrales del baseline conservador provocando un aumento de facturación, se evaluará la incorporación de una base de datos de consulta dedicada (e.g. PostgreSQL, Redis) o servicios externos de indexación de búsquedas, conservando Firestore únicamente como base de datos transaccional de origen.
