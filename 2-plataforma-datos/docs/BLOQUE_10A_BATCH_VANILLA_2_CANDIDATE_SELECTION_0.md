# Bloque 10A — Batch Vanilla 2 Candidate Selection

## Contexto y Objetivo
El objetivo de este bloque ha sido seleccionar un segundo batch pequeño y equilibrado de activos financieros "vanilla" para ampliar la base de datos de BBDD-ACTIVOS-FINANCIEROS. Este batch busca mantener la cobertura de activos amplios, líquidos y representativos, diversificando con renta fija, renta variable global y commodities estándar (oro).

La ejecución de este bloque ha sido estrictamente en modo de planificación (dry-run/selección) **sin ninguna escritura a Firestore ni llamadas a APIs externas**.

## Criterios de Selección Aplicados
1. Activos vanilla, amplios, líquidos y representativos.
2. Inclusión de renta fija, renta variable global y commodities no apalancadas.
3. Exclusión de activos complejos (apalancados, inversos, single-stock ETFs).
4. Prevención de redundancias en este batch de tamaño reducido.

## Matriz de Decisión y Resultados

Se evaluaron 5 candidatos iniciales y se seleccionaron 4 para formar el "Batch Vanilla 2":

| Ticker | Exposición | Clase | Tipo | Decisión | Motivo |
|---|---|---|---|---|---|
| **VTI.US** | Total US Stock Market | Equity | ETF | **SELECT** | Amplia cobertura del mercado total estadounidense, ETF vanilla de Vanguard altamente líquido. |
| **AGG.US** | Core US Aggregate Bond | Fixed Income | ETF | **SELECT** | Proporciona exposición a renta fija diversificada estadounidense. |
| **ACWI.US** | Global Broad Market Equity | Equity | ETF | **SELECT** | Incorpora diversificación global en renta variable dentro de un solo activo vanilla. |
| **GLD.US** | Physical Gold | Commodity | ETF | **SELECT** | Añade una commodity estructuralmente simple y ampliamente negociada, sin apalancamiento. |
| **BND.US** | Total US Bond Market | Fixed Income | ETF | **DEFER** | Diferido por ser casi idéntico en exposición a AGG.US. Se prioriza mantener el batch pequeño. |

## Artefactos Generados
Todos los artefactos se han generado en `artifacts/batch_vanilla_2_candidate_selection_0/`:
* `decision_matrix.json`: Lista detallada de la evaluación de candidatos.
* `candidate_manifest.json`: Manifiesto limpio de los 4 candidatos seleccionados.
* `exclusions_manifest.json`: Manifiesto de exclusiones (BND.US diferido).
* `selection_summary.json`: Resumen estadístico del proceso.
* `safety_check_summary.json`: Validación de cumplimiento de restricciones de seguridad del bloque.
* `next_step_recommendation.json`: Recomendación para el Bloque 10B.

## Validación de Seguridad
Se confirman los siguientes puntos críticos:
- **Firestore Writes**: 0
- **Firestore Deletes**: 0
- **FIRESTORE_REAL_WRITE_ENABLED**: inactivo/falso
- **Llamadas OpenFIGI / EODHD / Fundamentals**: NO realizadas
- **Alteración de bases ajenas (BDB-FONDOS)**: NO
- **Exposición de Credenciales**: NO

## Siguiente Paso Recomendado
Se recomienda proceder al bloque **10B — Batch Vanilla 2 EODHD Live Dry-Run Candidate Acquisition**. Este bloque consistirá en la captura de metadatos básicos y creación de las identidades provisionales de estos 4 activos en memoria, utilizando EODHD (dry-run), simulando el paso inicial de ingesta sin modificar la base de datos real.
