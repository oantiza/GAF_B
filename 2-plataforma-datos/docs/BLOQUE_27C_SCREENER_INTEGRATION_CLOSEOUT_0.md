# BLOQUE 27C: Screener Integration Closeout & Real Consumer Entry Criteria

Este documento formaliza el cierre de la fase de diseño mock del "Screener" (Bloques 27A y 27B) y define el checklist obligatorio para iniciar la integración en un entorno consumidor real.

## 1. Estado de la Simulación Cerrada (27A & 27B)

Se ha validado satisfactoriamente el diseño "Thin Frontend / Thick Adapter" para el consumidor tipo Buscador/Screener.
Están operativos en el entorno local (mock):
- **Contrato Screener (`screenerContractPreview`)**: Define peticiones seguras, forzando un `limit` y bloqueando explícitamente búsquedas lineales `O(N)` por nombre directamente en Firestore.
- **Screener Adapter Mock (`screenerAdapterMock`)**: Simula el gateway real que se colocaría en el lado del consumidor.
- **Protección de Datos Masivos**: Garantizado que un listado de activos en el buscador *nunca* devolverá el array de `holdings` completo de un fondo ni la `price_series` completa de una acción. Retorna resúmenes ($O(1)$).
- **Control de Tipos**: Prohibido explícitamente el uso de "EQUITY" como `asset_type`. Debe usarse "STOCK" o "ETF" y filtrar por `classification.asset_class = 'EQUITY'`.

## 2. Lo que queda "Ready for Integration"

Cuando un consumidor real esté preparado, podrá clonar estos patrones para disponer de:
1. Peticiones/Respuestas tipadas (`ScreenerSearchRequest`, `ScreenerSearchResult`).
2. Funciones de búsqueda exacta garantizada en eficiencia ($O(1)$) por ID, ISIN y Ticker.
3. Componente estático de opciones de filtro seguras (`getScreenerFilterOptions`).
4. Función asíncrona de obtención de Ficha Resumida (`getScreenerAssetDetail`).
5. Evaluador síncrono de coste de operación (`estimateScreenerOperationCost`) para pintar advertencias en la UI.

## 3. Criterios de Entrada (Entry Criteria) para el Consumidor Real

**Antes** de poder tocar un repositorio cliente real y escribir la integración, el equipo consumidor debe asegurar:

- [ ] **Selección de Repo Base**: El repositorio anfitrión está decidido y aprovisionado.
- [ ] **Zero Firestore Raw Access**: El frontend (ej. un componente React o Vue) NO debe importar `firebase/firestore`. Debe comunicarse contra el SDK / Backend-For-Frontend que actúe de Adapter.
- [ ] **Límite Explícito Obligatorio**: Todas las peticiones al adapter desde el cliente deben proveer un valor entero explícito `limit <= 100`.
- [ ] **No Secrets en Cliente**: El entorno cliente no debe tener acceso a credenciales de Firebase Admin o tokens privilegiados de lectura total.
- [ ] **Fallback de Búsqueda de Nombre**: Dado que el query por nombre nativo está prohibido por seguridad, el cliente debe estar de acuerdo en que buscar por nombre usará un índice externo simulado (o devolverá error hasta que se active Algolia/Elasticsearch).
- [ ] **Protección de Array Masivo**: La UI no debe ni esperar ni solicitar pintar gráficos completos de 10 años en los resultados crudos de una tabla del buscador.

## 4. Decisión Pendiente: Ubicación del Consumidor Real

Se analizan tres opciones para albergar el MVP del screener:
1. **Inyectarlo en el Monorepo `NUVIA`**.
2. **Inyectarlo en el repositorio legacy `BDB-FONDOS`**.
3. **Crear un Repositorio Nuevo (ej. `Screener-Buscador-MVP`)**.

### Recomendación para MVP: **Opción 3 (Repositorio Nuevo / Módulo Aislado)**
**Motivo:** 
Inyectar el screener directamente en NUVIA o BDB-FONDOS en este momento introduciría dependencias de compilación y fricciones con código legacy no testeado. 
Recomendamos construir un `Screener-Buscador-MVP` de forma aislada, validando que el SDK se consume correctamente, y posteriormente publicar ese buscador como un Micro-Frontend o paquete NPM importable en NUVIA.

## 5. Próximos Pasos

1. **Mantener Seguridad**: Mientras no se inicie el desarrollo consumidor, este repositorio `BBDD-ACTIVOS-FINANCIEROS` sigue sellado. No se crearán endpoints HTTP crudos ni se activará red en producción.
2. **Ejecutar Configuración del Consumidor**: En bloques posteriores, crear el esqueleto del consumidor aislado e importar los contratos.
3. **Pausar Operaciones de Búsqueda Externa**: El setup de Algolia (o similar) queda como tarea futura. El MVP funcionará solo con búsquedas de ISIN, Ticker o ID exacto.
