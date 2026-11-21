# BLOQUE 27B: Screener Adapter Mock Implementation

Este documento describe el adaptador "mock" implementado en el bloque 27B, diseñado como el punto de entrada principal para el consumidor `screeners / Buscador-Screener`.

## Objetivo del Adaptador

En nuestra arquitectura, los repositorios consumidores no deben hablar directamente con el SDK crudo o con las interfaces Firestore si eso implica riesgo de cargar arrays masivos accidentalmente. El patrón exige una capa adaptadora (Gateway / BFF) que expone funciones semánticas seguras al front-end.

El `screenerAdapterMock` simula esta capa, demostrando las restricciones y transformaciones de datos que ocurrirán antes de que la carga útil llegue a la UI.

## Funciones Implementadas

### 1. `getScreenerFilterOptions()`
- **Responsabilidad**: Proporcionar listas estáticas para menús desplegables del buscador.
- **Seguridad**: Nunca expone "EQUITY" en `allowed_asset_types`. Fuerza el uso de "STOCK".

### 2. `searchAssetsForScreener(request)`
- **Responsabilidad**: Envolver el contrato del Bloque 27A asegurando parámetros obligatorios en el gateway (ej. `limit <= 100`).

### 3. `getScreenerAssetDetail(asset_id)`
- **Responsabilidad**: Obtener información básica de un activo para pintar la "ficha resumen" en el buscador.
- **Seguridad Vital**: **Desactiva y elimina** arrays masivos.
  - No devuelve la colección o chunks de `holdings`. Solo devuelve un `holdings_summary` con `total_positions`.
  - No devuelve arrays de `price_series`. Solo devuelve un booleano `has_history`.
- Esto garantiza que si el usuario hace clic en 10 fondos de forma rápida en el buscador, no saturemos la memoria del cliente ni disparemos picos de costes en base de datos.

### 4. `estimateScreenerOperationCost(operation)`
- **Responsabilidad**: Interceptar intenciones de navegación costosas antes de hacer peticiones de red.
- Si la UI intenta llamar a `GET_FULL_HOLDINGS` o un `SEARCH_NAME_FIRESTORE`, el adaptador rechaza la operación de forma síncrona ($O(1)$) sin llamar al backend.

## Cómo probar localmente

Se ha implementado un script interactivo de preview que simula un flujo completo del usuario en el Screener:

```bash
npm run preview:screener-adapter
```

También se ha ampliado la suite de testing para validar estas restricciones:

```bash
npm test -- screenerAdapterMock
```

## Próximos Pasos (Bloque 28+)
Con este mock local validado, el diseño del adaptador puede trasladarse como un SDK o Backend-For-Frontend a los consumidores reales (ej. infra de NUVIA o BDB-FONDOS) en el momento en que se active la red e integración real con la base de datos de producción.
