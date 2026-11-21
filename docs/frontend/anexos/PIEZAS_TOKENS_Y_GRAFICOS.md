# Inventario de piezas comunes, tokens, estilos en línea y gráficos

*Anexo de la auditoría del 13-11-2026: qué piezas comunes existen y cuánto se usan, cuáles faltan y las pantallas escriben a mano, qué tokens hay y cuáles sobran, y todos los gráficos. Rutas relativas a `3-BDB-ACTIVOS_app`.*

## Piezas comunes

Recuento: ficheros que importan la pieza (sin contar el suyo). Búsqueda `import … <Pieza> … from` en `src/**/*.{ts,tsx}`.

| Pieza | Para qué | Ficheros que la usan | Defectos |
|---|---|---|---|
| `Button` | Botón con variantes `primary/secondary/quiet/danger`, `sm/md`, `icon`, `busy` | 81 (309 usos) | Sin `size="lg"` en el tipo aunque hay CSS `.ui-button--lg`; `busy` desactiva y pone `aria-busy` pero no anuncia; aún hay 38 `<button>` nativos en 23 ficheros (acceso, menú, `AsyncErrorBanner`, `PortfolioPositionsTable`…) |
| `Panel` | Sección con título h3/h4, procedencia, estado y acciones | 75 | Sin modo plegable; el nivel solo 3/4. Todavía 21 selectores de cabecera escritos a mano en `components.css:1931-1947` y otras 19 clases `*-head/-header` en las hojas |
| `PageHeader` | Cabecera de página con h1 (o h2 de subvista) | 23 | Ninguno grave. El estado vacío de debajo salta de h1 a h3 |
| `ModalDialog` + `DialogHeader/Body/Footer` | Diálogo modal en portal | 26 | MAR-03 (Mayús+Tab, sin `inert`); sin `aria-describedby`; título en h3 sans 20 px aunque el token de diálogo es `--fs-4xl` 22 |
| `ConfirmDialog` / `useConfirm` | Pregunta sí/no que sustituye a `window.confirm` | 1 / 12 | Bien. Escape resuelto dentro |
| `MenuButton` | Menú de acciones secundarias | 2 | MAR-16 |
| `SegmentedControl` | Elegir un modo | 20 | MAR-15 |
| `SegmentedTabs` | Pestañas con panel | 11 | MAR-14 (usado como filtro en 3); sin `tabpanel` propio: cada pantalla escribe el suyo |
| `KpiStrip` | Tira de cifras destacadas | 17 | `tone` es `string` libre (debería ser `"warn" \| "afirma"`); la clave usa `String(label)` de un `ReactNode` |
| `LoadingState` / `EmptyState` | Carga y vacío | 20 / 19 | Vacío con `h3` fijo; carga sin esqueleto. 44 líneas con «Cargando» fuera de la pieza (botones incluidos), 5 `loading-note` a mano, y 24 clases `*-empty*` en las hojas |
| `AsyncErrorBanner` | Error de una petición con reintento | 34 | `<button>` nativo; MAR-21 |
| `Ausencia` / `CifraOAusencia` | Escribir que un dato no está | 27 / 2 | `CifraOAusencia` casi sin usar: las pantallas comprueban `Number.isFinite` a mano |
| `EuroAmountInput` | Importe en euros con formato español | 6 | MAR-05; sin etiqueta propia (depende de `ariaLabel` o de un `label` externo) |
| `FileUploadField` | Carga de fichero con control propio | 4 | Sin zona de arrastre; el nombre no se limpia si el padre reinicia el `input`; sin error |
| `EnlaceAFicha` | Nombre que lleva a la ficha | 6 (más los adaptadores de tabla) | Bien |
| `TablaDeDatos` | Tabla de cifras con orden, grupos, pie y páginas | 22 | MAR-01; reinicia la página si cambia la identidad de `filas` (todas las llamadas actuales memorizan, pero no está escrito como contrato); sin modo simple (MAR-13) |
| `TablaComparativa` | Activos en columnas, campos en filas | 2 | MAR-25 |
| `PlanoRiesgoRetorno` | Plano volatilidad-rentabilidad por método | 1 | Filtra `undefined` pero no `NaN` (un `NaN` del adaptador llegaría a las coordenadas) — sospecha |
| `MesaDeTrabajo` | Barra de comparar / cartera del Buscador | 1 | Bien |

**Piezas que faltan y las pantallas escriben a mano** (recuento en `src/**/*.tsx`):

| Falta | Lo que hay hoy | Cuánto |
|---|---|---|
| **Campo** (rótulo + control + pista + error) | `label.field > span.field__label` | 87 `field` en 23 ficheros; 93 `field__label`; 31 pistas y 14 errores con solo 10 `aria-describedby` (MAR-10) |
| **Selector** | `<select>` nativo con el chevron de `components.css` | 56 en 29 ficheros |
| **Casilla / radio** | `input[type=checkbox]` + `.check` o `label` suelto | 23 casillas |
| **Aviso** | `.notice` + 35 clases propias | 167 usos en 36 ficheros (MAR-21) |
| **Distintivo** | `.badge` + `.cmp-chip`, `.f5-coverage-pill`, `.frontier-card-tag`, `.economic-impact-badge`… | 26 usos de `badge` en 16 ficheros; 19 clases de la familia |
| **Tabla simple** | `<table>` con clase propia | 45 en 28 ficheros (MAR-13) |
| **Nota emergente** | `title=` nativo (no existe en tableta ni con teclado) | 125 `title="…"` y 71 `title={…}` |
| **Mensaje efímero (toast)** | estado + `setTimeout` en cada sitio (p. ej. el aviso de pestaña, 6 s) | 9 ficheros con `setTimeout` |
| **Paginación** | solo dentro de `TablaDeDatos` | — |
| **Esqueleto de carga** | ninguno (`@keyframes oaa-shimmer` existe y no se usa) | — |
| **Tarjeta** | `.frontier-card`, `.auth-card`, `.f5-stress-card`, `.asset-card-*` | 16 clases |
| **Marca de serie** (punto/trazo de leyenda) | `style={{ background: color }}` | 7 sitios |
| **Barra de proporción** | `.bar-cell__fill`, `.pcmp-bar--a/b`, `.f5-risk-bar` | 4 variantes |

## Tokens

190 propiedades en `tokens.css`. «Usos» = `var(--x)` en `src/**/*.{css,ts,tsx}`.

| Grupo | Cuántos | Observaciones |
|---|---|---|
| Neutros `--steel-00…95` | 13 | Usados poco y directamente (`--steel-50`, `-70`, `-90`, `-02`: 1 uso cada uno); deberían ir solo a través de los roles. `--steel-40` (2,51:1) es solo trazo |
| Marca `--brand-05…80` | 8 | `--brand-60` 1 uso directo (es `--accent`); `--brand-50` es a la vez marcador del menú (3,01:1 sobre la barra, justo en el límite) e icono activo |
| Ocre `--ochre-50` | 1 | Solo serie de gráfico; 3,14:1 |
| Estado `--positive*`, `--negative*`, `--warning`, `--info`, `--neutral-soft` | 10 | **Solapes**: `--positive` = `--info` = `--accent` = `--brand-60`; `--warning` = `--negative` (a propósito). `--neutral-soft #f2f5f8` es el gris azulado retirado (1 uso). `--positive-line` 1 uso |
| Signo del Gestor `--cifra-sube/baja` | 2 | Contradicen la dirección fuera del Gestor y el rojo queda a 1,17:1 de la terracota (MAR-06) |
| Roles `--canvas`, `--surface*`, `--line*`, `--ink*`, `--accent*` | 24 | El núcleo sano. **Solapes**: `--canvas` = `--surface`; `--ink-secondary` y `--chart-ink` repiten en literal `#56564f` en vez de `var(--steel-60)`; `--chart-reference` repite `--steel-50` |
| Barra oscura `--rail-*` | 16 | `--rail-ink #c6d5e2` y `--rail-ink-label #7f9ab3` son azules de la paleta Prusia sobre el índigo nuevo; funcionan (9,18 y 4,70:1) pero no son de la familia. Seis blancos translúcidos (`--rail-chip-*`, `--rail-line*`, `--rail-hover`, `--rail-switch-track`) con un uso cada uno |
| Ficha `--ficha-*` | 10 | **Sobran los diez**: copias literales de neutros, marca y terracota (MAR-18); 159 usos |
| Tipografía `--font-*`, `--fs-*`, `--fw-*`, `--lh-*` | 25 | 19 tamaños: demasiados pasos de 0,5 px (`--fs-micro` 11, `--fs-apunte` 11,5, `--fs-xs` 12, `--fs-nota` 12,5, `--fs-sm` 13, `--fs-ficha-cifra` 13,5). `--fs-plano-eje` 10 px contra el «nada por debajo de 11». `--fs-kpi-compact`, `--fs-respuesta`, `--fw-light`: 1 uso cada uno |
| Espaciado `--s-1…12` | 12 | Bien usados (`--s-3`…`--s-5` > 170 usos cada uno), pero 421 px sueltos conviven con ellos |
| Geometría `--radius-*`, `--control-*`, `--row-*`, `--cell-*`, `--columna-nombre-min` | 16 | **Cuatro radios valen 0** (`--radius-xs/sm/-/md`, 63 usos): son un interruptor, no cuatro valores; basta uno. `--control-tactil`, `--row-head-h`, `--cell-fs`: 1 uso |
| Elevación y velo `--shadow-*`, `--backdrop` | 10 | Las cuatro sombras de columna fija y las dos de punto hueco tienen 1 uso cada una (son de una pantalla, no del sistema) |
| Foco `--focus-ring*` | 4 | Bien medidos; solo sombra (MAR-11) |
| Marco `--rail-w*`, `--topbar-*`, `--page-*`, `--carril-w`, `--filas-max-w`, `--calendario-cifra-w`, `--grafico-frontera-max`, `--app-min-width` | 13 | `--calendario-cifra-w` y `--grafico-frontera-max` son de una pantalla, no del marco |
| Gráficos `--series-1…8`, `--chart-*`, `--seq-*` | 18 | `--series-4…7` y `--chart-reference` **sin ningún `var()`**: viven por el espejo de `theme.ts` (documentado). `--seq-*` solo 3 de 8 pasos (el resto en `theme.ts`) |
| Movimiento y capas `--ease`, `--dur*`, `--z-*` | 10 | Escala `--z-*` coherente; 5 `z-index` numéricos fuera de ella (MAR-19) |

**Para el sistema nuevo:** quedarse con roles (`--surface`, `--ink-1/2/3`, `--line-1/2`, `--accent`, `--alerta`) y una escala de neutros privada; borrar `--ficha-*` y los radios repetidos; reducir los tamaños a 7-8 pasos con suelo de 11,5; dejar en su hoja los tokens de una sola pantalla; y decidir el color del signo de las cifras una vez para toda la aplicación.

## Estilos en línea

**195 en 41 ficheros.** De ellos, **143 en `src/reports/`** y **28 en `src/gestor/informes/`**: son PDF de `@react-pdf/renderer`, donde el estilo se pasa así; quedan fuera del rediseño de pantalla y no se cuentan como defecto (sí llama la atención que mezclen `StyleSheet.create` con objetos sueltos con tamaños como `fontSize: 5.8`). **En pantalla quedan 24**, casi todos legítimos porque dependen del dato.

| Fichero | `style={{` |
|---|---|
| `src/reports/internalPortfolioReportPdf.tsx` | 57 |
| `src/reports/informeDeClientePdf.tsx` | 39 |
| `src/reports/comparePdf.tsx` | 22 |
| `src/reports/propuestaDeCambioPdf.tsx` | 6 |
| `src/reports/improvementProposalPdf.tsx` | 5 |
| `src/gestor/informes/papel/cliente.tsx` | 5 |
| `src/reports/fichaDeActivoPdf.tsx` | 4 |
| `src/gestor/informes/secciones/asesor/resumen.tsx` | 3 |
| `src/components/AssetComparison.tsx` | 3 |
| `src/charts/oaa/OaaOverlapHeatmap.tsx` | 3 |
| `src/charts/GeoDistributionMap.tsx` | 3 |
| `src/charts/EuroYieldCurveChart.tsx` | 3 |
| `src/reports/realPortfolioPdf.tsx` | 2 |
| `src/reports/papelDeCliente.tsx` | 2 |
| `src/gestor/informes/secciones/costes/servicio.tsx` | 2 |

Los de pantalla que deberían ser pieza o variable CSS:
- **El punto de color de un tooltip o una leyenda**, repetido igual en 6 gráficos: `<span className="oaa-chart-tooltip-dot" style={{ background: entry.color }} />` (`EuroYieldCurveChart.tsx:33`, `UnderwaterChart.tsx:50`, `OaaStyleBoxChart.tsx:60`, `OaaOverlapHeatmap.tsx:113`, `OaaTooltip.tsx:46`, `AssetComparison.tsx:187`/`:804`). Una pieza `MarcaDeSerie color=…` que escriba `--serie-color` y no `background`.
- **Barras de proporción**: `style={{ width: \`${pct}%\` }}` en `AdminProgress.tsx:58`, `PortfolioComparator.tsx:45-46`, `RiskContributionChart.tsx:98/107`, `AdminPage.tsx:239`. Es dinámico y está bien en línea, pero son cuatro barras distintas para lo mismo (`.bar-cell__fill`, `.pcmp-bar--a`, `.f5-risk-bar`…): una pieza `BarraDeProporcion`.
- **Colores de tabla de constantes TS**: `GeoDistributionMap.tsx:73` mezcla `ZONE_CHIP[...]` con `"var(--ink-secondary)"` en el mismo `style`.
- **Bien resuelto, para copiar**: `OaaCorrelationHeatmap.tsx:67` pasa `--corr-n` como variable CSS y deja el aspecto en la hoja.

## Gráficos

| Fichero | Tipo | Dónde se usa | Paleta | Formato de cifras | Defectos |
|---|---|---|---|---|---|
| `charts/oaa/OaaLineChart.tsx` | Líneas (Recharts) | Análisis (evolución), Diseño (simulación, comparativa), Comparador, ficha, Gestor, Planes | `CHART_PALETTE` por índice o color pasado | Eje Y y tooltip base 100 con un decimal; eje X «mes año» | Memo inútil y O(n·m) (ANA-21); el color de la cartera depende de quién lo llame (ANA-03); tooltip sin unidad («112,4»); sin tabla alternativa |
| `charts/UnderwaterChart.tsx` | Área (Recharts) | Análisis (caída), Diseño | Color pasado: `--series-1` en Análisis, `--negative` en Diseño | Eje `fmtPct` 0 decimales; tooltip 2 decimales | Sin leyenda con dos series, eje por años (ANA-22); decimales distintos de la cabecera (ANA-10); «N/D» (ANA-11); color distinto entre pantallas (ANA-03) |
| `charts/oaa/OaaRiskReturnChart.tsx` | Dispersión + línea (Recharts) | Análisis (mapa frente a referencias), Comparador | Cartera `--accent`, referencias `--series-8`, línea `--ochre-50` | Ejes y tooltip `fmtPct` 1 decimal; «Vol / Rent» abreviados | Rombos sin rótulo, ejes sin título, tooltip solo ratón, posible fila `z` (ANA-04); colores fuera de contrato (ANA-03) |
| `charts/oaa/OaaFrontierChart.tsx` | Línea + dispersión (Recharts) | Análisis («Riesgo y rentabilidad»), Diseño, Optimizar | Frontera `--accent`; marca actual en ocre (`gold`) | `fmtPct` 1 decimal; ejes con título | Cartera en ocre (ANA-03); tooltip con «Vol / Rent» |
| `charts/oaa/OaaMonteCarloChart.tsx` | Áreas apiladas + líneas (Recharts) | Diseño (cono) | Un solo color (Prusia) con opacidades | Base 100; eje «+1A» | Tooltip con anchos de banda como niveles (ANA-02); «+1A» (ANA-16) |
| `charts/oaa/OaaCorrelationHeatmap.tsx` | Rejilla CSS | Análisis (correlación), vía `CorrelationHeatmap` en Comparador | `SEQUENTIAL_RAMP` en 7 clases | `fmtNum` 2 decimales; «N/D» | `role="img"` oculta las cifras, sin tabla (ANA-18); leyenda continua que no corresponde a las clases (ANA-24); «N/D» (ANA-11) |
| `charts/CorrelationHeatmap.tsx` | Envoltorio | Comparador de activos | Igual | Igual | Sello «histórico» en minúscula (ANA-25) |
| `charts/oaa/OaaOverlapHeatmap.tsx` | Dispersión con celdas (Recharts) | Análisis (solapamiento), vía `OverlapHeatmap` | `SEQUENTIAL_RAMP`; índice con colores categóricos | «al menos X %»; tooltip `fmtPct` 1 decimal | Cifras dentro del SVG y posiciones comunes solo en tooltip (ANA-18); índice con color, leyenda distinta de la correlación (ANA-24) |
| `charts/OverlapHeatmap.tsx` | Envoltorio + notas | Análisis | Igual | Igual | Nota larga en un solo párrafo; sello «cartera» (ANA-25) |
| `charts/oaa/OaaDonutChart.tsx` | Aro (Recharts) | Análisis (sectores), Diseño (súper-sectores), Resumen, Estrategia | Color pasado o `CHART_PALETTE`; «No declarado» en gris | `pctPoint` 1 decimal | Correcto en lo esencial (una porción → cifra); tooltip sin rótulo de cabecera (sospecha); ocre parecido al tostado (ANA-23) |
| `charts/oaa/OaaStyleBoxChart.tsx` | Rejilla 3×3 (Recharts) | Análisis (caja de estilo) | Rampa propia de `puntosDeLaCaja` | 0 decimales en celda, 1 en tooltip | Cifras solo en SVG, tooltip solo ratón; sin tabla alternativa |
| `charts/GeoDistributionMap.tsx` | Mapa coroplético SVG + tabla | Análisis, Diseño (lateral); `DesgloseDeRegiones` también en Carteras guardadas | Tono por macro-zona (`ZONE_CHIP`), intensidad por peso | 1 decimal | Paradas de teclado sin nombre (ANA-17); colores iguales a cartera y benchmark (ANA-03); interacción solo con ratón |
| `components/RiskContributionChart.tsx` | Barras HTML | Optimizar, frontera heredada (no en Análisis) | CSS propio | 1 decimal | `role="alert"` estático, «N/D» (ANA-27, ANA-11); «Peso vs riesgo» |
| `components/HistoricalStressCards.tsx` | Tarjetas | Diseño (no en Análisis) | — | 1 decimal; fechas propias | «N/D» (ANA-11); fechas «05 mar» (ANA-26); no salen en Análisis (ANA-15) |
| `charts/oaa/OaaGroupedBarChart.tsx`, `OaaRiskMatrixChart.tsx` | Barras, matriz | Estrategia | — | — | No revisados a fondo |
| `charts/EuroYieldCurveChart.tsx` | Curva | Macro | — | — | No revisado |
| `charts/oaa/OaaChartFrame.tsx`, `OaaLegend`, `OaaTooltip`, `OaaEmptyState`, `chartTheme`, `chartFormatters`, `oaaQuality` | Piezas comunes | Todos | — | `ND` en formateadores | Sellos y `title` (ANA-25); `ND` (ANA-11) |
