# Bloque 26C — Consumer Integration Handoff & First Consumer Readiness Plan

Este documento actúa como el **Handoff Manual** para la integración de los consumidores reales de la base de datos de activos financieros, proporcionando guías prácticas, restricciones operativas de costes, patrones recomendados y prohibidos, y el plan de preparación para el primer consumidor real.

---

## 1. Estado Actual de la Plataforma de Consumo

La base de datos de activos financieros cuenta con una interfaz de consulta y protección robusta lista para la integración:

*   **Public Contracts v1 ([publicContracts.ts](file:///C:/Users/oanti/Documents/BBDD-ACTIVOS-FINANCIEROS/src/contracts/publicContracts.ts)):** Define las interfaces públicas estrictamente tipadas y de solo lectura (`PublicAssetOverview`, `PublicFundOverview`, `PublicMarketAssetOverview`, `PublicSearchResponse`) que aíslan el esquema físico de Firestore de los consumidores.
*   **Query Layer ([queryLayer.ts](file:///C:/Users/oanti/Documents/BBDD-ACTIVOS-FINANCIEROS/src/readModels/queryLayer.ts)):** Resuelve de forma agregada las entidades complejas (combinando documentos raíz, subcolecciones de listings, métricas recientes y estado de cobertura) en un único contrato limpio.
*   **Search Layer ([searchLayer.ts](file:///C:/Users/oanti/Documents/BBDD-ACTIVOS-FINANCIEROS/src/readModels/searchLayer.ts)):** Permite búsquedas rápidas por ISIN y Ticker en $O(1)$ y maneja de forma controlada las búsquedas por texto libre.
*   **Cost Guardrails ([costGuardrails.ts](file:///C:/Users/oanti/Documents/BBDD-ACTIVOS-FINANCIEROS/src/contracts/costGuardrails.ts)):** Intercepta e identifica el nivel de riesgo de coste de las consultas (`LOW`, `MEDIUM`, `HIGH`, `BLOCKED`), impidiendo operaciones destructivas de coste en producción.
*   **Consumer Integration Mock Preview ([consumerIntegrationPreview.ts](file:///C:/Users/oanti/Documents/BBDD-ACTIVOS-FINANCIEROS/src/consumerPreview/consumerIntegrationPreview.ts)):** Simulación local en memoria que valida la ergonomía y seguridad de las capas de consumo antes de realizar integraciones reales.

---

## 2. Evaluación de Consumidores Candidatos

| Consumidor | Complejidad de Integración | Impacto Operativo | Riesgo de Regresión | Recomendación |
| :--- | :--- | :--- | :--- | :--- |
| **NUVIA** | Alta (Core de trading/saldos) | Crítico (Operaciones reales) | Alto (Regresiones transaccionales) | Segunda Fase |
| **BDB-FONDOS** | Alta (Esquema legacy complejo) | Alto (Fichas públicas de fondos) | Medio-Alto (Mezcla con código antiguo) | Tercera Fase (Requiere ACL) |
| **reporting** | Media (Generación asíncrona) | Bajo (Procesos en segundo plano) | Bajo (No afecta UI en vivo) | Segunda Fase (Diferente patrón de acceso) |
| **screeners** | **Baja (Buscador/Screener lectura)** | **Medio-Alto (Alta visibilidad de UI)** | **Muy Bajo (Sólo lectura sin flujos transaccionales)** | **Primer Candidato Recomendado** |

### Recomendación del Primer Candidato: `screeners (Buscador/Screener)`
Se recomienda iniciar con el módulo de **screeners / buscadores**. Al ser una funcionalidad puramente informativa de solo lectura, minimiza el riesgo transaccional mientras permite validar en producción el comportamiento del motor de búsqueda (exacta por ISIN/Ticker vs text scan con límites), el estado de cobertura del catálogo y la efectividad de los límites de costes.

---

## 3. Guía de Integración para NUVIA

NUVIA se integrará en una fase posterior. A continuación, se detallan las directrices técnicas:

*   **Pantallas Candidatas:**
    *   Fichas de Detalle de Acciones (e.g., AAPL).
    *   Fichas de Detalle de ETFs (e.g., SPY).
*   **Datos que PUEDE Consumir:**
    *   Identificadores normalizados (Ticker, ISIN, Exchange).
    *   Métricas agregadas recientes (`pe_ratio`, `price_close` de cierre).
    *   Series históricas agregadas anualmente.
*   **Datos que NO Debe Leer Directamente:**
    *   Documentos raíz sin normalizar de Firestore.
    *   Cuentas de comisiones brutas internas del backend.
*   **Patrón Frontend Delgado / Backend Fuerte:**
    *   El frontend de NUVIA no se conecta a Firestore. Llama al backend de NUVIA, el cual utiliza la librería cliente autorizada que expone `Query Layer` y los contratos públicos tipados.
*   **Coste Estimado por Pantalla:**
    *   Carga de detalle de mercado: **4 reads de Firestore** (`MEDIUM` risk). Es seguro para carga de ficha detallada.

---

## 4. Guía de Integración para BDB-FONDOS

*   **Alcance Futuro:** Integrar la ficha de Fondos Mutuos con su sumario de Holdings.
*   **Qué NO tocar todavía:** No conectar flujos transaccionales legacy de suscripción o reembolso de fondos con el nuevo catálogo.
*   **Patrón de Aislamiento (Anti-Corruption Layer):**
    *   Evitar inyectar los tipos crudos de la base de datos de activos directamente en el modelo de dominio legacy de BDB-FONDOS.
    *   Implementar un adaptador intermedio que consuma `PublicFundOverview` y traduzca la estructura de holdings y clasificación al formato esperado por el código antiguo, permitiendo un desacoplamiento limpio.

---

## 5. Patrones Permitidos (Recomendados)

1.  **Consumo a través de Contratos Públicos:** Usar exclusivamente las interfaces exportadas por `publicContracts.ts`.
2.  **Lookup Exacto $O(1)$:** Consultar por `asset_id` exacto o mediante índices de ISIN y Ticker.
3.  **Holdings Summary:** Leer únicamente el resumen (`PublicHoldingsSummary`) en la carga de vistas generales de cartera para evitar leer cientos de posiciones de forma innecesaria.
4.  **Uso de Series de Precios Anuales:** Cargar datos históricos año a año usando `price_series/yearly/{YYYY}` en lugar de históricos completos de golpe.

---

## 6. Patrones Prohibidos (Bloqueados)

1.  **Acceso Firestore Directo:** Conectar clientes web/móviles directamente a colecciones de Firestore sin pasar por las capas de abstracción.
2.  **Scans por Texto en Producción sin Límites:** Ejecutar búsquedas con texto libre que requieran escanear toda la colección Firestore.
3.  **Esquema de Precios por Día:** Buscar o depender de una estructura de un documento de precios por día y por activo.
4.  **Carga de Histórico Completo en Pantalla Inicial:** Descargar 15 años de historial de precios en la primera interacción visual de una pantalla.
5.  **Carga Incondicional de Holdings de Fondos Grandes:** Leer todas las posiciones individuales de fondos grandes (>1000 posiciones) en la primera carga de la página (usar paginación o carga diferida).

---

## 7. Plan de Verificación de Integración (Readiness Checklist)

Antes de autorizar la modificación de código en cualquier repositorio consumidor, el pipeline local del catálogo debe cumplir los siguientes criterios de preparación:

*   `[✓] Typecheck PASS:` El compilador de TypeScript finaliza sin errores (`npm run typecheck`).
*   `[✓] Tests PASS:` El 100% de la suite de pruebas unitarias pasa con éxito (`npm test`).
*   `[✓] Contratos Documentados:` Las interfaces públicas v1 están firmadas y estables.
*   `[✓] Coste por Pantalla Estimado:` Todos los flujos simulados tienen asignado su riesgo y límite de reads.
*   `[✓] Fallbacks Activos:` La aplicación soporta estados de cobertura `PARTIAL` o `MISSING` de forma resiliente.
*   `[✓] Write Safety:` `FIRESTORE_REAL_WRITE_ENABLED` desactivado y se comprueba que no existan escrituras físicas en los scripts locales.
*   `[✓] No Secrets:` Exclusión absoluta de credenciales privadas en el repositorio.

---

## 8. Confirmación de Seguridad Operativa

*   **Firestore Writes Ejecutados:** `0`
*   **Firestore Deletes Ejecutados:** `0`
*   **FIRESTORE_REAL_WRITE_ENABLED:** `false` (No activo en entorno)
*   **Archivos .env / .env.local:** Intactos
*   **Directorio imports/:** Intacto
*   **Repositorios NUVIA / BDB-FONDOS:** No modificados
*   **Despliegue / Commit / Push:** Ninguno ejecutado de forma automática.
