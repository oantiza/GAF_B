# Bloque 28A — Screener SDK/Adapter Export Contract Preview

Este documento describe la preview del contrato de exportación del SDK/Adapter para futuros consumidores externos del buscador/screener, con especial enfoque en el aislamiento de dependencias y el cumplimiento de las directrices de seguridad y costes.

## Objetivo del Bloque
El objetivo principal es definir la superficie pública de exportación (tipos, funciones del adaptador y utilidades de mock) que estará disponible para un futuro consumidor, en particular **`Screener-Buscador-MVP`**, asegurando que ningún detalle interno del repositorio base (`BBDD-ACTIVOS-FINANCIEROS`) sea expuesto ni pueda ser importado.

---

## Relación con Bloques Anteriores (27A / 27B / 27C)
* **27A (Screener Contract Preview)**: Definió la estructura básica de los requests y las respuestas de búsqueda de un screener.
* **27B (Screener Adapter Mock)**: Implementó un adaptador funcional local para simular la interceptación de búsquedas, límites obligatorios, y exclusión de arrays masivos (holdings/price series).
* **27C (Screener Integration Closeout)**: Consolidó los criterios mínimos de preparación (readiness checklist) para integraciones externas y cerró la fase documental MVP-readiness.
* **28A (Este Bloque)**: Establece formalmente el contrato de qué piezas son exportables y cuáles se mantienen privadas/bloqueadas, proporcionando una preview del SDK de integración.

---

## Qué se Exportaría (Public Surface)

### 1. Tipos Públicos de Datos
* `ScreenerSearchRequest`: Estructura del payload de búsqueda.
* `ScreenerSearchResponse`: Estructura de la respuesta de búsqueda.
* `ScreenerSearchResult`: Datos de cada activo devuelto en la búsqueda.
* `ScreenerAssetDetail`: Detalles resumidos y seguros de un activo.
* `ScreenerFilterOptions`: Listas de valores para menús desplegables (dropdowns) de filtrado.
* `ScreenerCostEstimate`: Estimaciones de coste operacional.
* `ScreenerRiskLevel`: Niveles de riesgo asignados a cada tipo de consulta.
* `ScreenerCoverageStatus`: Estado de cobertura del activo.

### 2. Funciones del Adaptador
* `searchAssetsForScreener(request)`: Búsqueda controlada de activos.
* `getScreenerAssetDetail(asset_id)`: Recuperación de la ficha de detalle (sin colecciones hijas pesadas).
* `getScreenerFilterOptions()`: Retorno de filtros válidos.
* `estimateScreenerOperationCost(operation)`: Estimación estática del riesgo de coste antes de ir a base de datos.

### 3. Helpers de Desarrollo (Dev-Only)
* `createMockScreenerDataset()`: Dataset estático de ejemplo para desarrollo local en el frontend.
* `runMockScreenerScenario(scenario)`: Simulación de ejecuciones típicas.
* `validateScreenerConsumerReadiness(config)`: Autovalidación de cumplimiento del frontend.

---

## Qué NO se Exportaría (Internal Boundaries)
Las siguientes piezas quedan bloqueadas de forma estricta:
* **Raw Firestore paths/collections**: Nombres físicos de las tablas y layouts de almacenamiento.
* **Admin SDK clients / Firebase App Instances**: Instancias que requieran privilegios de administración o acceso directo.
* **Service Account Config / .env / .env.local**: Archivos de credenciales y secretos de entorno.
* **Write Scripts**: Herramientas de ingesta y carga masiva de datos.
* **Internal Ingestion Schemas**: Estructuras específicas de proveedores externos (OpenFIGI, EODHD raw data).
* **Artifacts y reportes de Antigravity**: Ficheros markdown internos de logs y tareas.
* **imports/**: Directorios de dependencias o códigos heredados sin normalizar.

---

## Contrato de Estabilidad (Stability Contract)
Se clasifican las piezas de software según su estabilidad prometida al consumidor:

| Nivel | Descripción | Ejemplo |
|---|---|---|
| **`STABLE_PUBLIC`** | APIs y tipos totalmente garantizados para producción. Su modificación requerirá cambio de versión mayor (semantic versioning). | `ScreenerSearchRequest`, `searchAssetsForScreener` |
| **`PREVIEW_PUBLIC`** | Utilidades en evaluación o de desarrollo. Pueden cambiar sin previo aviso en parches menores. | `createMockScreenerDataset`, `validateScreenerConsumerReadiness` |
| **`INTERNAL_ONLY`** | Implementaciones internas del motor de datos. | Esquemas de ingesta de OpenFIGI, funciones de escritura. |
| **`FORBIDDEN`** | Prohibidos bajo cualquier circunstancia en el entorno de integración. | Credenciales, acceso directo a Firestore. |

---

## Reglas de Coste y Seguridad del Consumidor
El futuro consumidor frontend del Screener debe acatar:
1. **Límites obligatorios**: Cualquier búsqueda debe incluir una propiedad `limit` obligatoria no superior a `100`.
2. **Restricción de Escaneo (Scans)**: Búsquedas por nombre de texto libre en Firestore directo quedan bloqueadas (`risk_level: BLOCKED`). Deben simularse o resolverse a través de un índice externo (p. ej. Algolia).
3. **No Carga Masiva**: No se permite pedir `holdings` o históricos completos en la vista de búsqueda o primera pantalla. Deben usarse los summaries provistos por `getScreenerAssetDetail`.
4. **Exclusión de EQUITY**: El tipo de activo `EQUITY` sigue estando prohibido como parámetro directo. Se debe mapear a `STOCK` y utilizar `asset_class` en su lugar.

---

## Ejemplo Conceptual de Integración (Consumer-side)
Así se vería la integración simplificada en un componente de `Screener-Buscador-MVP`:

```typescript
// Importando el contrato público desde el SDK
import { 
  searchAssetsForScreener, 
  getScreenerAssetDetail,
  ScreenerSearchRequest,
  ScreenerAssetDetail 
} from "bbdd-activos-financieros/screener-sdk";

async function onUserSearch(queryText: string) {
  const request: ScreenerSearchRequest = {
    query: queryText,
    query_type: "ISIN",
    limit: 20
  };

  // El adaptador maneja la seguridad y los límites
  const response = await searchAssetsForScreener(request);
  if (response.blocked) {
      console.warn("Búsqueda bloqueada por seguridad:", response.forbidden_reason);
      return;
  }
  
  renderResults(response.results);
}
```

---

## Qué NO se ha hecho todavía
* Crear el paquete npm físico o exportar de forma real el package.
* Implementar el repositorio o módulo separado `Screener-Buscador-MVP`.
* Configurar servidores HTTP, endpoints REST o GraphQL.
* Configurar writes en Firestore del lado del consumidor.

## Próximos Pasos recomendados
1. **Validación del Contrato**: Evaluar el presente bloque de preview.
2. **Empaquetado Local**: Definir las directrices de empaquetado del SDK (usando `tsup`, `microbundle` o similar) si se aprueba exportar físicamente un subconjunto del código.
3. **Mocking Visual**: Desarrollar prototipos visuales en el consumidor importando este mock SDK directamente como dependencia local.
