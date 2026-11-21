# Bloque 26B — Consumer Integration Mock Preview

Este documento describe la simulación de integración de consumidores para la base de datos de activos financieros. Se valida la ergonomía y seguridad de las interfaces antes de su integración en los repositorios reales (como NUVIA o BDB-FONDOS).

## 1. Objetivo del Bloque
Simular la forma en que los consumidores externos utilizarían la plataforma usando exclusivamente las capas de abstracción cerradas (`Public Contracts v1`, `Query Layer`, `Search Layer` y `Cost Guardrails`), sin interactuar directamente con Firestore.

## 2. Escenarios Simulados
- **Escenario 1: Ficha de Detalle de Fondo (BDB-FONDOS):** Carga metadatos y sumario de holdings usando `PublicFundOverview`. Valida fund-ok-1 (SINGLE_DOCUMENT, LOW risk) y fund-large-1 (CHUNKED, MEDIUM risk).
- **Escenario 2: Ficha de Detalle de Mercado (NUVIA):** Carga acciones/ETFs usando `PublicMarketAssetOverview`. Valida que las acciones usen tipo `STOCK` y clase `EQUITY` (sin tipo `EQUITY`).
- **Escenario 3: Búsquedas (Screener/Buscador):** Evalúa e identifica costes de búsquedas por ISIN, Ticker y Nombre.
- **Escenario 4: Resumen de Cartera:** Consulta rápida de holdings y estado de cobertura usando `getHoldingsSummary` (LOW risk).

## 3. Patrones Permitidos vs Prohibidos

### Patrones Permitidos (Recomendados)
- **Lookup Exacto (ISIN/Ticker):** Resuelto mediante Query Layer en $O(1)$ reads (LOW risk).
- **Sumario de Holdings:** Carga de datos de manifest sin descargar las posiciones completas (LOW risk).
- **Series de Precios Anuales:** Lectura del documento agregado `price_series/yearly/{YYYY}` (LOW risk).

### Patrones Prohibidos (Bloqueados por Guardrails)
- **Acceso Directo a Firestore:** Intentos de conectar directamente con el SDK de Firestore sin usar los wrappers (BLOCKED).
- **Persistencia Diaria de Precios:** Consultas que involucren leer un documento por día (BLOCKED).
- **Carga Histórica en Pantalla Inicial:** Forzar la descarga del histórico completo (e.g. 15 años) en la primera carga (BLOCKED).

## 4. Coste Estimado por Pantalla
- **Ficha de Fondo (Simple):** 3 reads (LOW risk).
- **Ficha de Acción/ETF:** 4 reads (MEDIUM risk).
- **Búsqueda Exacta (ISIN/Ticker):** 1 read (LOW risk).
- **Búsqueda por Nombre (Scan):** Scan lineal (`N_DOCUMENT_READS`) en producción (HIGH risk). Requiere advertencia o indexación futura.

## 5. Confirmación Read-Only
- **Firestore Writes:** 0
- **Firestore Deletes:** 0
- **FIRESTORE_REAL_WRITE_ENABLED:** `false` (No activo)

## 6. Próximos Pasos Sugeridos
- **26C — Public API / Package Boundary Review:** Decidir si queryLayer/searchLayer se distribuyen como módulo npm privado para que NUVIA/BDB-FONDOS lo instalen como dependencia formal.
