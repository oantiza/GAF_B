# Bloque 22A — Post-Holdings Firestore Coverage Audit

## Objetivo

Realizar una auditoría read-only post-holdings para verificar la correcta persistencia de la cartera (holdings) en Firestore, comprobar la cobertura general del proyecto, y evaluar el estado de integridad referencial.

---

## Resumen de Prechecks

Todos los prechecks locales pasaron exitosamente antes de iniciar la auditoría de cobertura:

| Precheck | Resultado |
|---|---|
| Git Status | Clean branch `master` (synchronized with `origin`) |
| npm test | ✅ PASS (91 archivos / 494 tests) |
| preview:holdings-partial-write-gate | ✅ PASS (Planned SET: 460, DELETE: 25) |
| preparation:holdings-real-write-gate | ✅ PASS (READY_FOR_REAL_WRITE_AUTHORIZATION) |

---

## Resultados de la Cobertura Global de Firestore

Se ejecutó la auditoría general de cobertura utilizando la conexión en modo **Read-Only**:

```bash
npm run audit:firestore-coverage
```

### Métricas Globales de Cobertura de Activos
- **Target Assets**: 425
- **Reviewed Assets**: 425
- **COMPLETE**: 19 (tienen root + listing + price_series + metrics_latest)
- **PARTIAL**: 2
- **ROOT_ONLY**: 404 (activos con documento root en Firestore, principalmente los 404 fondos de FondosDB)
- **MISSING**: 0
- **Listings detectados**: 24
- **Price series detectadas**: 19
- **Metrics/latest detectados**: 19

---

## Verificación Específica de Holdings

Se realizó una verificación detallada e individual (read-only) de todos los paths planificados en el Bloque 21F:

| Check / Métrica | Esperado | Verificado | Estado |
|---|---|---|---|
| **SET paths (EXISTS)** | 460 | **460 / 460** | ✅ 100% OK |
| **DELETE paths (NOT_EXISTS)** | 25 | **25 / 25** | ✅ 100% OK |
| **Root asset touches** | 0 | **0** | ✅ OK |
| **Missing root violations** | 0 | **0** | ✅ OK |
| **Paths outside scope** | 0 | **0** | ✅ OK |
| **Read errors** | 0 | **0** | ✅ OK |

---

## Desglose de FondosDB Holdings

De acuerdo con el manifiesto de entrada del plan de holdings:

* **Fondos de entrada totales (input)**: 495
* **Fondos con root asset en Firestore (procesados)**: 404
* **Fondos excluidos por falta de root asset (missing roots)**: 91
  * Estos 91 fondos fueron excluidos de forma controlada para mantener la integridad referencial y evitar carteras huérfanas.
* **Breakdown por Modo de Almacenamiento**:
  * **SINGLE_DOCUMENT**: **387 fondos** (se almacenan en un único documento `assets/{isin}/holdings/latest` debido a su tamaño pequeño/moderado).
  * **CHUNKED_DOCUMENTS**: **17 fondos** (se dividen en múltiples subdocumentos `assets/{isin}/holdings/chunk_X` + un `manifest` debido a que exceden los límites de tamaño recomendados).

---

## Análisis de Riesgos y Drift

* **Drift detectado**: **Ninguno**. La verificación lee el estado real de Firestore y confirma al 100% que los documentos SET existen y los DELETE no existen. No hay discrepancias con respecto a los manifiestos del bloque 21F.
* **Integridad**: No se detectaron escrituras bajo los 91 roots excluidos, ni alteraciones accidentales de los documentos root de los activos.

---

## Reconciliación de Discrepancias de Cobertura (Mock vs Real)

Se detectó una aparente discrepancia entre dos lecturas de cobertura de activos:
1. **Mock Audit / Dry Run**: Reportó `target_assets=414`, `complete=414`, `partial=0`, `root_only=0`.
2. **Live Audit (Real)**: Reporta `target_assets=425`, `complete=19`, `partial=2`, `root_only=404`.

### Explicación Técnica y Conciliación:

* **De dónde sale `target_assets=414` y `complete=414`**:
  * **Targets Definidos**: El conjunto base de assets en el código se compone de los **405** fondos de FondosDB + **6** activos piloto + **4** activos del Vanilla 2 Batch. Descontando el solapamiento de `IE00B4L5Y983` (IWDA) que está en ambos grupos, el total de activos objetivo predefinidos es **414**.
  * **Comportamiento Mock**: Al ejecutar la auditoría de cobertura con un cliente Firestore simulado (mock) en las pruebas automatizadas (por ejemplo, en Vitest), este mock devuelve siempre `exists: true` y simula que todas las subcolecciones (`listings`, `price_series`, `metrics/latest`) contienen datos. Por ello, en el entorno mock, los 414 activos predefinidos son evaluados como `COMPLETE`.

* **De dónde sale `target_assets=425` y `complete=19`**:
  * **Targets en Producción (Sampling)**: En la ejecución real conectada a Firestore, el script además muestrea la base de datos (con un límite de 600 documentos) y detecta **11** activos adicionales persistidos en la colección `assets` que no estaban en la lista predefinida estática de targets. Esto eleva el total evaluado a **425** ($414 + 11$).
  * **Comportamiento Real**: En la base de datos real de Firestore, solo **19** activos (los pilotos y vanilla 2) han sido completamente ingestados con sus series de precios y métricas de cierre, de ahí que `COMPLETE = 19` y `PARTIAL = 2`. Los **404** fondos ingestados en el ciclo de FondosDB solo tienen cargado su documento raíz de metadatos, por lo que figuran correctamente clasificados como `ROOT_ONLY = 404`.

Ambos resultados son correctos dentro de sus respectivos contextos (pruebas mockeadas vs. datos reales de Firestore) y confirman la coherencia absoluta de los datos.

---

## Siguiente Bloque Recomendado

Se recomienda proceder al **Bloque 22B — Read Models and API Contract Integration Preview**.
Una vez que las carteras están correctamente escritas en Firestore, el siguiente paso lógico es validar los modelos de lectura funcionales (read models), los contratos API y los handlers asociados (`preview:read-models`, `preview:functional-read-models`, `preview:portfolio-reporting`, `preview:api-contract`), asegurando que la capa de consumo pueda consultar los holdings ingestados.

---

## Confirmación de Seguridad

* **Firestore writes**: **0**
* **Firestore deletes**: **0**
* **FIRESTORE_REAL_WRITE_ENABLED**: **NO**
* **Commit**: **NO**
* **Push**: **NO**
* **Deploy**: **NO**
