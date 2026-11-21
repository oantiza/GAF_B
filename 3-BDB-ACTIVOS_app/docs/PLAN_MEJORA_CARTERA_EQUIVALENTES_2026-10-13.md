# Plan: «Mejorar cartera» con fondos equivalentes

**Fecha:** 13-10-2026
**Estado:** propuesta de diseño y plan de trabajo. Sin código, sin commits.
**Origen:** petición de Óscar + borrador de ChatGPT (`Propuesta_mejora_carteras_BDB.md`).
**Objetivo:** a partir de una cartera cargada en el Constructor, proponer una cartera con fondos de la base de datos lo más homogéneos posible a los actuales que mejore la original en lo medible, o decir con claridad que no hay mejora.

---

## 1. Resumen

El borrador de ChatGPT es un buen marco funcional: define «mejorar» como «no empeorar ningún criterio obligatorio y mejorar al menos uno de forma relevante», no relaja restricciones por su cuenta, conserva la cartera original, distingue cuatro estados de resultado y recomienda empezar por sustituir fondos manteniendo pesos. Todo eso se mantiene.

Tiene tres carencias que hay que corregir antes de implementar:

1. **Da por hecho un motor que no existe.** El optimizador actual (`robust_engine.py`) reparte pesos entre un conjunto fijo de activos; no elige fondos. La selección de sustitutos y la evaluación de combinaciones es una pieza nueva, y los límites del backend (40 activos por llamada, 12-20 llamadas por minuto) impiden hacerla «llamando al backtest muchas veces».
2. **Da por hecho datos que la app no tiene.** Duración y calidad crediticia se ingieren pero no llegan a la app; el estilo de renta variable no se rellena; la cobertura de divisa no es un campo. La auditoría de datos de su fase 1 es imprescindible y aquí ya se concreta qué hay y qué falta.
3. **Mide la equivalencia solo por etiquetas** (categoría, región). La medida real de homogeneidad entre dos fondos es cómo se comportan sus series (correlación y tracking error sobre la misma ventana) y qué tienen dentro (solapamiento de posiciones). Ambas cosas existen ya en el código y no las usa.

Y hay cuatro elementos que no contempla y que considero necesarios: tratar las **clases del mismo fondo** como la mejora más evidente (misma estrategia, clase más barata); hacer **validación fuera de muestra** de verdad (seleccionar en una ventana y confirmar en otra) para no perseguir rentabilidades pasadas; tener en cuenta que las **series de fondos son NAV, no total return** (las clases de reparto parecen peores por construcción); y exigir que cada candidato **cubra la ventana completa** para que un fondo joven no encoja la comparación.

Orden recomendado: auditoría de datos → motor de equivalencia (puro, con tests) → evaluador conjunto en servidor → pantalla «Mejorar cartera» con pesos conservados → validación con una cartera real → optimización de pesos.

---

## 2. Lo que ya existe (verificado en el código)

| Pieza | Qué hace hoy | Para qué sirve en esta funcionalidad |
|---|---|---|
| `src/core/fundSwapper.ts` | Alternativas por posición: mismo vehículo y clase económica (obligatorio), niveles 1-3 por categoría y región, orden por `candidateRanking` (Sharpe 3A solo si todos comparten frecuencia y método; si no, rentabilidad 3A/1A). Tope 8. | Primer filtro de candidatos. Hay que ampliarlo con exposiciones y series (ver §5.2). |
| `src/core/swapUniverse.ts` | Recorre todas las páginas del catálogo (200 por página). | Universo completo de candidatos. Válido tal cual. |
| `src/components/FundSwapModal.tsx` | Sustitución manual de UNA posición, con «Mantener %/€», retro (oculta en modo cliente) y aviso de divergencias. | Patrón de tabla de alternativas y de confirmación. No sirve para proponer la cartera completa. |
| `src/core/metricsFrequency.ts` | Control de comparabilidad: la maestra mide en semanal; quedan documentos antiguos en diario. | Obligatorio para no ordenar por Sharpes no comparables. |
| `functions_python/optimization/robust_engine.py` + `OptimizerPanel.tsx` | Frontera robusta (Ledoit-Wolf, James-Stein) sobre un conjunto FIJO de activos. Soporta pesos bloqueados, máximo por activo y `group_constraints` por divisa, clase, región, subtipo y vehículo. Tope 10 activos (v1) / 40 (`TARGET_RISK`, v2). 12 llamadas/min. | Modalidad 2 (ajustar pesos) una vez elegidos los fondos. No elige fondos. No tiene límite de rotación (turnover). |
| `backtest_portfolio` (`repository.py`) | Serie de cartera en EUR con fechas comunes, dibuja en diario y mide en semanal: CAGR, volatilidad, Sharpe (ESTR medio de la ventana), máxima caída, correlaciones, escenarios de estrés (COVID, tipos 2022). Política `min_history: ENFORCE` para apartar activos que no cubren la ventana. Tope 40 posiciones, 20 llamadas/min. | Es la cifra oficial de cartera. La propuesta final debe medirse con esto, nunca con otra fórmula. |
| `portfolio_horizon` (`analysis_bundle`) | Mismo backtest con históricos ampliados por referencia (3A/5A) y frontera. | Útil si se quiere evaluar a 5A con fondos jóvenes; las extensiones se declaran. |
| `src/core/portfolioComparison.ts` + `PortfolioComparator.tsx` | Alinea dos backtests a fechas comunes, misma base 100, misma tasa sin riesgo; CAGR, vol, Sharpe, MDD; reparto por categoría/clase/región; PDF. | **Es exactamente la comparativa «original frente a propuesta»**. Reutilizar entero. |
| `src/core/portfolioOptimizationDiff.ts` + `OptimizationReviewDialog.tsx` | Diff por posición antes/después con Δ TER ponderado, Δ retro, Δ métricas. | Tabla de sustituciones y KPI de la propuesta. |
| `src/core/portfolioCosts.ts` | Coste corriente ponderado; una tasa ausente no es cero; el agregado solo con cobertura completa. | Criterio de costes. Mantener su regla. |
| `src/core/portfolioConstraints.ts` | Límites por activo, por vehículo y por exposición (RV, RF, liquidez, alternativos…), candados. | Validación de la propuesta (pesos, límites). |
| `src/core/overlap.ts` + `get_asset_holdings_batch` | Solapamiento de posiciones entre dos fondos (Σ mín. pesos). | Segunda capa de equivalencia: «qué tienen dentro». |
| `src/core/correlation.ts` + `get_price_series` | Correlación alineada por fecha; series rebasadas, hasta 40 activos por llamada. | Tercera capa de equivalencia: «cómo se comportan». |
| Guardado de carteras (`localPortfolioStorage.ts`, `save_portfolio`) | Carteras guardadas en local y en backend. | Guardar la propuesta. Falta un campo «derivada de». |
| Modo cliente (`ClientModeContext`) | Oculta retrocesiones. | Las retros nunca entran en los criterios de mejora para el inversor; solo se muestran aparte y fuera de modo cliente. |

### Datos por fondo que llegan a la app hoy

Disponibles en la ficha (`BdbAssetDetail`): vehículo, clase económica, categoría Morningstar, región, texto de estrategia, rating, divisa, métricas 1/3/5/10A (frecuencia y método declarados), costes (`ongoing_charge`, `management_fee`), mezcla de activos (`pms_exposure`), `exposure_detail` con sectores, regiones RV y tamaños de empresa, `product_profile` (clase, política de distribución, domicilio, fecha de lanzamiento, UCITS), sostenibilidad (SFDR), `fund_metrics` (patrimonio, yield).

**Ingerido pero NO expuesto:** `fixed_income_profile` (duración efectiva y modificada, vencimiento medio, calidad crediticia media, TIR). `fund_ingest.py` lo escribe en la raíz; `readmodel/mappers.map_asset_detail` no lo mapea. Es un cambio pequeño de readmodel + contrato + tipo.

**No existe como campo:** cobertura de divisa (solo se puede inferir del nombre de la clase: «Hedged», «H», «EUR H»); estilo RV (`equity_styles` se mapea pero el ingest no lo rellena); identificador de «familia» de fondo (el `sec_id` de Morningstar está en los alias de la raíz, no en la ficha de la app).

**Hechos que condicionan la comparación:** las series de fondos son `series_type: NAV` (sin reinvertir reparto), así que una clase de distribución rinde menos por construcción; la maestra mide en semanal con restos en diario (A1); hay fondos con `usable_from` por cambio de vocación CNMV (memoria del proyecto) cuya serie anterior no debe usarse.

---

## 3. Revisión del borrador de ChatGPT

### Aciertos (se mantienen)
- Regla de mejora: ningún criterio obligatorio empeora y al menos uno mejora de forma relevante, con umbrales y tolerancias explícitos.
- No relajar restricciones automáticamente; si no hay propuesta válida, decirlo.
- Conservar siempre la opción «mantener el fondo original» por posición.
- Cuatro estados de salida (propuesta válida / sin mejora / datos insuficientes / restricciones incompatibles).
- «Mejor propuesta encontrada», nunca «óptimo de toda la base de datos».
- Retrocesiones fuera de los criterios del inversor.
- Misma moneda, mismas fechas, misma metodología para ambas carteras.
- Empezar por sustituir manteniendo pesos; después optimizar pesos.
- Lista de casos de prueba del §10, correcta y completa.

### Correcciones
| Punto del borrador | Problema | Corrección |
|---|---|---|
| §3: `robust_engine.py` para «optimización de pesos y restricciones» como pieza de la búsqueda | Optimiza pesos de un conjunto fijo. No selecciona activos. Tope 10/40 activos, 12 llamadas/min. | Separar dos motores: **selección** (nuevo) y **pesos** (existente, solo en modalidad 2). |
| §6.5: «Evaluar combinaciones completas» | Con los endpoints actuales no es viable: 9 posiciones × 5 candidatos → decenas o cientos de evaluaciones; el backtest admite 20/min y tarda segundos. | Evaluador en servidor que carga las series **una vez** y evalúa combinaciones en memoria (ver §5.3). |
| §4: criterios por familia (duración, crédito, estilo, cobertura de divisa) | Duración/crédito no llegan a la app; estilo no se rellena; cobertura no es campo. | Fase 0 concreta la cobertura real. Exponer `fixed_income_profile`. Lo que no exista se declara «sin dato», nunca se infiere como coincidencia. |
| §2: «Rentabilidad igual o superior» como criterio obligatorio sobre el histórico | Elegir el fondo con mejor rentabilidad pasada en la misma ventana en la que se evalúa es perseguir rentabilidades: sesgo de selección garantizado. | Rentabilidad como criterio **con validación fuera de muestra** (§5.4): se selecciona en una ventana y se confirma en otra que no ha intervenido en la selección, más consistencia en ventanas móviles. |
| §4: equivalencia por etiquetas | Dos fondos «RV Global» pueden comportarse de forma muy distinta; dos clases del mismo fondo son idénticas aunque la categoría difiera por error de carga. | Tres capas: etiquetas → exposiciones → series (correlación, tracking error) y solapamiento de posiciones. La capa de series es la que manda. |
| §7: «misma política de rebalanceo» | Cierto, pero no basta con enunciarlo: la cifra de búsqueda y la cifra final deben salir del **mismo código**. | El evaluador reutiliza las funciones de `repository.py` (`build_rebased_series`, medición semanal); la propuesta final se re-mide con `backtest_portfolio` y se presenta con `PortfolioComparator`. |
| §8: «guardar como nueva cartera vinculada» | No existe el vínculo. | Campo opcional `derived_from` (id + fecha + parámetros) en la cartera guardada. |
| §10: «cartera Fineco de nueve fondos» | No está en el repositorio. | Hay que cargarla y guardarla en la app antes de usarla como caso de validación. |

### Omisiones que se incorporan
1. **Clases del mismo fondo.** Misma estrategia con TER inferior (clase limpia frente a minorista, o clase EUR frente a USD sin cobertura) es la mejora más segura y la primera que un asesor espera ver. Hay que agrupar por familia (nombre normalizado sin sufijos de clase; mejor aún, exponer el identificador de fondo de Morningstar) y presentarla como categoría propia: «misma estrategia, clase más eficiente».
2. **Validación fuera de muestra** y consistencia en ventanas móviles (§5.4).
3. **NAV frente a total return.** Por defecto, candidato con la misma política de distribución que el original; si difiere, se avisa y se explica el sesgo. No se compara una clase de reparto con una de acumulación como si fueran equivalentes.
4. **Cobertura de ventana obligatoria.** El candidato debe tener serie propia en toda la ventana de evaluación (mínimo 3A, `MIN_COMMON_OBSERVATIONS`). Si no, queda fuera con motivo «histórico insuficiente», y nunca encoge la ventana de los demás. Respetar `usable_from`.
5. **Tamaño y antigüedad** como guardas (patrimonio mínimo, lanzamiento anterior a la ventana), informativos en v1, configurables.
6. **Límite de rotación** en modalidad 2: exige una restricción nueva en el motor (distancia L1 a los pesos actuales), no existe hoy.
7. **Coste del cambio.** El borrador lo menciona; se concreta: no hay datos de comisión de suscripción/reembolso fiables en la ficha, así que se presenta como «no evaluado» y se deja un campo manual opcional.

---

## 4. Definición de mejora (propuesta concreta)

Todas las cifras se miden sobre la **misma ventana común** (por defecto 3A, semanal, EUR, misma tasa sin riesgo), con el backtest oficial. Umbrales por defecto, editables en la pantalla:

### Criterios obligatorios (la propuesta no puede empeorarlos más allá de la tolerancia)
| Criterio | Tolerancia por defecto | Nota |
|---|---|---|
| Volatilidad anual | ≤ original + 0,30 pp | |
| Máxima caída | ≥ original − 1,0 pp (no más pérdida) | medida en diario, como el backtest |
| Sharpe | ≥ original − 0,02 | misma tasa sin riesgo |
| Coste corriente ponderado | ≤ original | solo con cobertura completa de TER en ambas; si falta algún TER, el criterio queda «no evaluable» y la propuesta no puede declararse válida por costes |
| Rentabilidad anualizada | ≥ original − 0,25 pp **en la ventana de confirmación** | ver §5.4 |
| Exposiciones | desviación ≤ 3 pp por clase económica y por región; ≤ 5 pp por divisa | sobre `pms_exposure` / región / divisa de denominación, declarando que la divisa de denominación no es exposición real |
| Límites de cartera | los de `portfolioConstraints` | pesos suman 100, máximos por activo, candados |

### Mejora relevante (al menos una)
| Criterio | Mínimo |
|---|---|
| Rentabilidad anualizada (ventana de confirmación) | +0,50 pp |
| Sharpe | +0,10 |
| Coste corriente ponderado | −0,15 pp |
| Máxima caída | +2,0 pp (menos pérdida) |
| Volatilidad | −0,50 pp con rentabilidad no inferior |

### Orden de las propuestas válidas
1. Menor número de sustituciones.
2. Mayor equivalencia media (§5.2).
3. Mayor mejora de Sharpe en la ventana de confirmación.

Las retrocesiones se muestran aparte (fuera de modo cliente) y **no** intervienen ni en la validez ni en el orden.

---

## 5. Diseño

### 5.1 Entrada
Cartera activa del Constructor (posiciones, pesos, capital si existe, nombre), fuente de datos, ventana (3A por defecto; 5A opcional con extensiones declaradas), modalidad, umbrales, posiciones a mantener, número máximo de sustituciones, candidatos por posición (por defecto 5).

### 5.2 Equivalencia: tres capas con explicación

**Capa 1, etiquetas (filtro, sin coste):** mismo vehículo (fondo con fondo), misma clase económica, categoría igual o región+clase iguales, misma política de distribución (o aviso). Reutiliza `fundSwapper`. Para renta fija, una vez expuesto `fixed_income_profile`: duración ±1,5 años, misma banda de calidad crediticia (IG / HY), mismo tipo (gobierno / corporativo).

**Capa 2, exposiciones (fichas ya cargadas):** distancia entre vectores de `pms_exposure` (mezcla), `exposure_detail.sectors`, `equity_regions`, `market_caps`. Distancia L1 normalizada; se puntúa solo lo que ambos tienen y se declara lo que falta («sin desglose sectorial en el candidato»).

**Capa 3, series y posiciones (la que manda):** correlación semanal y tracking error entre el candidato y el fondo original sobre la ventana común (`get_price_series`, lotes de hasta 40); solapamiento de posiciones (`overlap.ts`, `get_asset_holdings_batch`) cuando hay holdings. Umbrales por defecto (recalibrados con la maestra real el 13-10-2026, ver `docs/VALIDACION_MEJORA_CARTERA_2026-10-13.md`): correlación ≥ 0,75 en RV, ≥ 0,60 en RF, ≥ 0,65 en mixtos, sin exigencia en monetarios ni cuando el original tiene menos de un 2 % de volatilidad anual; tracking error ≤ 8 % RV, ≤ 4 % RF, ≤ 6 % mixtos, ≤ 1,5 % monetarios. Los valores iniciales del borrador (0,85 y 4 %) solo admitían fondos casi indexados. Por debajo de los umbrales, el candidato no es equivalente aunque comparta etiquetas.

Cada candidato lleva: lo que comparte, lo que difiere, lo que falta, y el motivo de aceptación o descarte. Es la «ficha de equivalencia» que se enseña en pantalla.

**Clases del mismo fondo:** detección por familia (nombre normalizado sin sufijos de clase; correlación ≈ 1 confirma). Se presentan como grupo aparte, antes que cualquier otro candidato, con Δ TER y diferencia de clase (divisa, cobertura inferida del nombre marcada como «inferida», distribución, mínimo si existe).

### 5.3 Dónde corre la evaluación: servidor

Nuevo callable `improve_portfolio` (solo lectura) en `functions_python`:
1. Recibe cartera, pool de candidatos por posición (ya filtrado por capas 1-2 en el cliente), ventana, umbrales, modalidad.
2. Carga **una vez** las series semanales de original + candidatos con las mismas funciones que el backtest (`_load_asset_returns`, ventana común, `ENFORCE`, EUR). Tope nuevo: 80 activos (9 posiciones × 5 candidatos + original), con memoria y tiempo acotados (300 s).
3. Calcula capa 3 (correlación, tracking error) por par original-candidato.
4. Búsqueda con pesos conservados: por posición, el mejor candidato que supere las puertas individuales; después búsqueda coordinada (greedy con mejora por pasos y vuelta atrás, o beam con anchura 3) sobre la cartera completa evaluando cada combinación como producto matriz-pesos en memoria. Siempre con la opción «mantener» por posición y límite de sustituciones.
5. Validación de cada propuesta con todas las puertas; ventana de confirmación (§5.4).
6. Devuelve hasta 3 propuestas válidas ordenadas, con métricas de selección y de confirmación, ficha de equivalencia por sustitución, motivos de descarte de los candidatos no elegidos, cobertura y parámetros. O el estado «sin mejora / datos insuficientes / restricciones incompatibles» con el detalle.

El cliente re-mide la propuesta elegida con `backtest_portfolio` y la enseña con `PortfolioComparator` (original frente a propuesta), de modo que la cifra que ve el asesor es siempre la oficial.

Alternativa descartada: evaluar en cliente con `get_price_series`. Es viable para un prototipo, pero duplica la lógica de medición en TypeScript y obliga a garantizar paridad con el backtest; no compensa.

### 5.4 Ventanas y validación fuera de muestra
- **Ventana de selección:** los dos primeros tercios de la ventana (en 3A, los 2 primeros años). Aquí se filtran candidatos y se eligen combinaciones.
- **Ventana de confirmación:** el último tercio (último año). Aquí se comprueban las puertas de rentabilidad y Sharpe y se mide la mejora relevante. Una propuesta que gana en selección y pierde en confirmación no es válida.
- **Consistencia:** en ventanas móviles de 1 año (paso mensual) dentro de la ventana completa, la propuesta debe igualar o superar a la original en al menos el 60 % de ellas.
- Se informan siempre las dos cifras (selección y confirmación) por separado, y el periodo exacto de cada una.

### 5.5 Modalidades
- **M1, conservar estructura (primera versión):** sustituciones 1 a 1 con el mismo peso. Sin optimizador.
- **M2, ajustar pesos (después):** sobre el conjunto resultante de M1, frontera robusta con candados, máximo por activo, `group_constraints` por clase/región/divisa (existe) y **límite de rotación** respecto a la original (nuevo en `robust_engine.py`: restricción Σ|w − w₀| ≤ τ). Tope 40 activos (v2). Reutiliza `OptimizerPanel` y `OptimizationReviewDialog`.

### 5.6 Salida y estados
Contrato `portfolio-improvement.v1` con: estado (`PROPOSAL` / `NO_IMPROVEMENT` / `INSUFFICIENT_DATA` / `INFEASIBLE`), propuestas, parámetros, ventanas, versión de datos (fecha de la serie más reciente), avisos. Guardado por el cliente para el informe.

### 5.7 Pantalla «Mejorar cartera»
Nueva sección en el Constructor, junto a «Optimizar cartera» (no dentro del modal de sustitución). Flujo: configurar condiciones → calcular → resultado → comparar → guardar propuesta.

Bloques del resultado (siguiendo `diseno-oaa`):
- Estado en cabecera (uno de los cuatro) con una frase.
- Tabla de sustituciones: original → candidato, peso, Δ TER, equivalencia (nivel y resumen), motivo.
- KPI antes/después: rentabilidad (selección y confirmación), volatilidad, Sharpe, máxima caída, coste ponderado; Δ con signo y color.
- Reparto por clase/región/divisa antes/después (reutiliza `comparisonAllocations`).
- Validación: lista de criterios con cumple/no cumple/no evaluable.
- Cobertura: ventana, fechas, activos apartados y por qué, extensiones si las hay.
- Candidatos descartados por posición, plegados, con motivo.
- Acciones: «Comparar en detalle» (abre `PortfolioComparator` con original y propuesta), «Guardar como propuesta» (cartera nueva con `derived_from`; nunca sobrescribe la original), «Aplicar al Constructor» (con confirmación, como hoy el optimizador).
- Modo cliente: sin retros, sin candidatos descartados por retro.

---

## 6. Fases

| Fase | Trabajo | Archivos previstos | Resultado verificable |
|---|---|---|---|
| **0. Auditoría de datos** (lectura, sin escrituras) | Script en `ops` que cuenta, sobre la maestra: fondos con serie semanal ≥ 3A; con TER; con categoría/región; con `exposure_detail`; con `fixed_income_profile`; con `distribution_policy`; con patrimonio; con `usable_from`; familias con más de una clase. | `ops/` (script nuevo), `docs/` (tabla de cobertura) | Tabla de cobertura real por campo y por clase económica. Decide qué criterios de §5.2 son evaluables hoy. |
| **1. Datos de RF en la app** | Mapear `fixed_income_profile` en `readmodel/mappers.py`, contrato, `bdbLiveApiContracts.ts`, `BdbAssetDetail`. Opcional: exponer identificador de familia. | `functions_python/readmodel/mappers.py`, `contracts_cache`, `src/adapters/bdbLiveApiContracts.ts`, `src/types/bdbAssets.ts` | Ficha de un fondo de RF enseña duración y calidad; tests de contrato. |
| **2. Motor de equivalencia** (puro, TS) | `fundEquivalence.ts`: capas 1-2, ficha de equivalencia con compartido/diferente/ausente/motivo; detección de familia; filtro de distribución y cobertura de ventana. Ampliar `fundSwapper` para usarlo. | `src/core/fundEquivalence.ts`, `src/core/fundSwapper.ts`, `tests/fundEquivalence.test.ts` | Tests con los casos de §10 del borrador que sean de etiquetas/exposiciones. |
| **3. Evaluador en servidor** | Callable `improve_portfolio`: carga única de series, capa 3, búsqueda M1, puertas, ventanas de selección/confirmación, consistencia móvil, contrato de salida. Tope y límite de llamadas propios. | `functions_python/optimization/improvement_engine.py` (puro), `functions_python/main.py`, `contracts_cache/portfolio-improvement.v1.json`, `functions_python/tests/` | Pytest con series sintéticas: encuentra mejora cuando existe; devuelve `NO_IMPROVEMENT` con original superior; `INSUFFICIENT_DATA` con histórico corto; respeta candados y máximo de cambios; no empeora ningún criterio. |
| **4. Pantalla M1** | Adaptador `improvePortfolioBackend.ts`, núcleo `portfolioImprovement.ts` (estados, orden, texto), componente `PortfolioImprovementPanel.tsx`, integración en Constructor, guardado con `derived_from`, enlace a `PortfolioComparator`. | `src/adapters/`, `src/core/`, `src/components/`, `src/pages/PortfolioBuilderPage.tsx`, `src/core/localPortfolioStorage.ts`, CSS según `diseno-oaa` | Flujo completo desde una cartera cargada; `npm test`, `lint`, `typecheck`, `audit:ui`, `smoke:informe`. |
| **5. Validación con cartera real** | Cargar y guardar la cartera de 9 fondos; comprobar cobertura; ejecutar; revisar a mano cada sustitución propuesta; medir tiempos. | — | Informe corto en `docs/` con el resultado, tiempos y ajustes de umbrales. |
| **6. Modalidad M2** | Límite de rotación en `robust_engine.py`; desviaciones por grupo; encadenar M1 → M2 en la pantalla. | `functions_python/optimization/robust_engine.py`, `OptimizerPanel.tsx`, panel nuevo | Propuestas que respetan rotación máxima y desviaciones; tests. |
| **7. Informe** | Sección «Propuesta de mejora» en el informe interno (no en el de cliente hasta decidirlo). | `src/core/internalPortfolioReport.ts`, `src/reports/` | PDF con sustituciones, KPI y cobertura. |

Las fases 0 a 5 son la primera entrega. 6 y 7 van después de ver resultados reales.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Sesgo de selección (perseguir rentabilidad pasada) | Ventana de confirmación separada y consistencia móvil (§5.4). Rentabilidad nunca como único criterio. |
| Cifras de búsqueda ≠ cifras finales | El evaluador reutiliza el código del backtest; la propuesta se re-mide con `backtest_portfolio` antes de mostrarse. |
| Tiempo y límites del backend | Pool acotado (5 candidatos por posición), carga única de series, evaluación en memoria, tope de 80 activos, timeout 300 s, estado `INCOMPLETE` si se agota. |
| Clases de reparto penalizadas por NAV | Misma política de distribución por defecto; aviso explícito si se mezcla. |
| Datos ausentes tratados como coincidencia | La ficha de equivalencia declara «sin dato»; un criterio sin dato es «no evaluable», nunca «cumple». |
| Fondos con cambio de vocación | Respetar `usable_from`; serie anterior fuera. |
| Métricas de distinta frecuencia (A1) | `candidateRanking` ya lo controla; el evaluador mide siempre en semanal sobre series propias. |
| Retrocesiones contaminando la propuesta | Fuera de validez y orden; solo informativas y ocultas en modo cliente. |

---

## 8. Decisiones pendientes de Óscar

Todas decididas por Óscar el 13-10-2026 (opción recomendada en cada caso):

1. **Dónde corre la evaluación:** servidor (§5.3). Hecho.
2. **Umbrales por defecto:** los recalibrados con la maestra real (§5.2 y `docs/VALIDACION_MEJORA_CARTERA_2026-10-13.md`); la pantalla permite endurecerlos caso a caso.
3. **Clases del mismo fondo:** bloque aparte, siempre visible y antes que cualquier otra propuesta; no consumen una de las «máximo N» sustituciones aunque pasan las mismas puertas. Hecho: `same_fund_class` en la petición, `free_candidates` en el motor, marca en cada sustitución y bloque «Misma estrategia, otra clase» en el panel.
4. **Vehículo:** **decidido por Óscar (13-10-2026): solo fondos.** Se sustituyen fondos por fondos; los ETF y las acciones de la cartera se conservan tal cual y no se buscan alternativas para ellos. Sin interruptor.
5. **Ventana:** 3A por defecto; 5A disponible con un clic (sin extensiones de histórico: el candidato debe cubrir la ventana con serie propia).
6. **Informe de cliente:** solo interno por ahora. PDF propio de la propuesta (`src/reports/improvementProposalPdf.tsx`); se fundirá en el informe interno cuando quede libre. Al cliente no se le enseña hasta validar en vivo.

---

## 9. Próximo paso

Fase 0: script de auditoría de cobertura sobre la maestra (solo lectura) y tabla en `docs/`. Con esa tabla se cierran los criterios evaluables de §5.2 y se arranca la fase 2 (motor de equivalencia en TypeScript, con tests), que no depende de ningún cambio de backend.

---

## 10. Estado de ejecución (13-10-2026, misma sesión)

| Fase | Estado | Dónde |
|---|---|---|
| 0. Auditoría de datos | **Hecha.** Script de solo lectura sobre la copia local y tabla de cobertura. | `functions_python/scripts/audit_cobertura_equivalencia.py` · `docs/COBERTURA_DATOS_MEJORA_CARTERA_2026-10-13.md` |
| 1. Datos de RF en la app | **Pendiente de decisión.** El contrato `asset-for-bdb.v1` es `additionalProperties: false` y su fuente única vive en `2-plataforma-datos/contracts` (sincronizado por hash con `check:contracts`): exponer `fixed_income_profile` exige cambiar el contrato allí. El tipo `BdbFixedIncomeProfile` ya está declarado (opcional) y el motor de equivalencia lo usa cuando llega. | `src/types/bdbAssets.ts` |
| 2. Motor de equivalencia | **Hecho**, con 13 tests. Capas 1 y 2, clases del mismo fondo, distribución y cobertura inferidas del nombre (la maestra no las trae como campo). | `src/core/fundEquivalence.ts` · `tests/fundEquivalence.test.ts` |
| 3. Evaluador en servidor | **Hecho**, con 15 tests. Motor puro + servicio + callable `improve_portfolio` (6 llamadas/min, tope 80 activos, 300 s). | `functions_python/optimization/improvement_engine.py` · `improvement_service.py` · `main.py` |
| 4. Pantalla M1 | **Hecha**, con tests de núcleo, contrato y componente. Panel «Mejorar cartera» en Constructor › Optimizar; revisión antes de aplicar; guardar como propuesta; handler demo. | `src/components/PortfolioImprovementPanel.tsx` · `src/core/portfolioImprovement.ts` · `src/adapters/improvePortfolioBackend.ts` |
| 5. Validación con cartera real | **Hecha en seco** sobre la copia local con nueve fondos reales (1,4 s por cálculo): los umbrales de series del borrador descartaban 39 de 45 candidatos; recalibrados y documentados. Queda repetirla con la cartera del cliente y la callable desplegada. | `functions_python/scripts/dryrun_mejorar_cartera.py` · `docs/VALIDACION_MEJORA_CARTERA_2026-10-13.md` |
| 6. Modalidad M2 | **Hecha** la pieza que faltaba: límite de rotación Σ\|w − w₀\| ≤ τ en el motor robusto (camino QP, solo objetivo «Nivel de riesgo»), validado en la petición, expuesto en el optimizador como «Rotación máx. (%)» y en el handler demo; tests en ambos lados. El encadenado M1 → M2 es: aplicar las sustituciones y optimizar después con rotación limitada; la pantalla lo indica al aplicar. | `functions_python/optimization/robust_engine.py` · `repository.py` · `src/components/OptimizerPanel.tsx` · `src/adapters/portfolioFrontierAdapter.ts` |
| 7. Informe | **Aplazada a propósito.** Otra sesión está editando a la vez `internalPortfolioReport.ts`, `internalPortfolioReportPdf.tsx` y `PortfolioRiskMonitor.tsx` en este mismo checkout; tocar el informe ahora pisaría ese trabajo. | — |

Hallazgos de la auditoría de datos que cambian el diseño inicial:
- Equivalencia por series **viable hoy**: 718 de 756 fondos (95 %) tienen serie EUR que cubre 3A; 703 cubren 5A; TER, categoría y región al 100 %.
- El **estilo RV sí está** (`equity_styles`, 75 %); lo que **no existe** es la política de distribución, la clase y la fecha de lanzamiento como campo (0 %): se infieren del nombre (44 % con token Acc/Dist/Inc/Cap; 7 % con token de cobertura) y se marcan como inferidas.
- Renta fija: la duración solo está en el 29 % y la calidad media en el 47 % de los fondos; el reparto por tipo de emisor (`bond_types`) en el 98 %.
- 74 familias con más de una clase (152 activos) detectadas por nombre; con falsos positivos (fondos distintos de una misma gestora): el servidor las confirma por correlación.
- 31 de 122 categorías tienen un solo fondo utilizable: en ellas no habrá sustituto dentro de la categoría y el motor recurre a región + clase.

Sin commit, sin deploy. La ejecución real contra la base de datos exige desplegar `improve_portfolio` (runbook de despliegue vigente) y no se ha hecho.
