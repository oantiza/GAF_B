# BLOQUE 25A: Cost & Performance Guardrails with Baseline Capacity Model

## Objetivo del bloque
Diseñar e implementar guardrails programáticos de coste y rendimiento para las capas de Query Layer, Search Layer y Contratos Públicos, alineándolos con un baseline conservador y estimaciones direccionales de consumo en Firestore.

## Aclaración sobre el Modelo de Capacidad
- **Naturaleza Estimativa y Direccional:** Las cifras de lecturas y escrituras presentadas son estimaciones direccionales para guiar el diseño técnico, no cálculos de facturación exactos.
- **Baseline Conservador:** El baseline de 1,250 activos raíz representa un escenario superior para cubrirse en el diseño inicial. El volumen real del proyecto probablemente sea inferior en las primeras fases.
- **Guardrail Operativo de Fase:** El fin es evitar sobrecostes innecesarios en la etapa actual sin sobredimensionar la infraestructura. Si en el futuro se superan estos umbrales, se contempla migrar o complementar con bases de datos relacionales u otros motores de búsqueda externos.

## Baseline de Capacidad Utilizado
- **Fondos (Funds):** 800 activos (15 años históricos, totalizando 3,024,000 puntos / 12,000 documentos anuales).
- **ETFs:** 150 activos (10 años históricos, totalizando 378,000 puntos / 1,500 documentos anuales).
- **Acciones (Stocks):** 300 activos (15 años históricos, totalizando 1,134,000 puntos / 4,500 documentos anuales).
- **Totales Consolidados:**
  - 1,250 activos.
  - 4,536,000 puntos históricos.
  - 18,000 documentos anuales en Firestore.
- **Formato Recomendado:** `price_series/yearly/{YYYY}` (1 documento = 252 puntos diarios = 1 lectura).
- **Formato Prohibido:** `price_series/daily/{YYYY-MM-DD}` (un documento diario por activo).

## Archivos Creados y Modificados
- **[MODIFICADO]** `src/contracts/costGuardrails.ts`: Contiene la constante `BASELINE_CAPACITY_MODEL` y comentarios sobre el carácter conservador y direccional del modelo.
- **[NUEVO]** `tests/costGuardrails.test.ts`: Pruebas de integración unitarias de aserción y cálculo de coste.
- **[NUEVO]** `scripts/runCostGuardrailsPreview.ts`: Script que valida la matriz basándose en la configuración del baseline de capacidad.
- **[MODIFICADO]** `package.json`: Script `preview:cost-guardrails` añadido.
- **[MODIFICADO]** `docs/COST_AND_PERFORMANCE_GUARDRAILS_V1.md`: Guía de arquitectura de coste de Firestore, cálculos de histórico y aclaraciones sobre estimaciones direccionales.
- **[NUEVO]** `docs/BLOQUE_25A_COST_PERFORMANCE_GUARDRAILS_0.md`: Este archivo.

## Comandos Ejecutados
- `npm run typecheck`
- `npm test`
- `npm run preview:cost-guardrails`

## Resultados de las Validaciones
- **Typecheck:** **PASS**. Cero errores detectados.
- **Tests:** **PASS** (547 tests pasados en total). Se validaron cálculos del baseline, estimación por años para series de precios, bloqueos de visualizaciones iniciales masivas y shapes diarios prohibidos.
- **Preview Output:** **PASS**. Visualización correcta del baseline de capacidad y el desglose de niveles en consola. Se escribió el reporte JSON git-ignorado en `artifacts/cost_guardrails_preview_0/preview_report.json`.

## Confirmación de Seguridad
- Firestore writes = **0**
- Firestore deletes = **0**
- FIRESTORE_REAL_WRITE_ENABLED = **NO** (inactivo).
- root assets real write ejecutado = **NO**
- holdings real write ejecutado = **NO**
- deploy = **NO**
- push = **NO**

## Próximos Pasos Recomendados
1. Monitorear el número de activos reales y los accesos de lectura para comprobar si se aproximan a los límites del baseline.
2. Si la escala del proyecto aumenta y requiere búsquedas avanzadas complejas o agregaciones en tiempo real de gran volumen, planificar la migración hacia una base de datos relacional u otra capa de almacenamiento intermedia.
