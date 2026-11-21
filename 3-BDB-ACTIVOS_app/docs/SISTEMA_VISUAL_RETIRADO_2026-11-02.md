---
name: diseno-oaa
description: Sistema de diseño de BDB-ACTIVOS (OAA / Andbank Private Bankers). Úsalo SIEMPRE que se toque cualquier cosa visible de la aplicación web - componentes React, CSS, tokens, layout de una página, tablas, gráficos, KPIs, formularios, diálogos, navegación, textos de interfaz, estados vacíos o de error - y también antes de proponer un rediseño, de crear un componente nuevo o de cambiar un color, un tamaño o un espaciado. Incluye las reglas de las hojas de estilo, la paleta, la tipografía, el formato numérico en español, las primitivas obligatorias, la arquitectura de navegación vigente y la verificación (lint, tests, audit:ui, smoke) que todo cambio de interfaz debe pasar. Si dudas de si aplica, aplica.
---

# Sistema de diseño OAA — BDB-ACTIVOS

Herramienta de asesoramiento de banca privada. La usa un asesor **delante del cliente**: densidad profesional, jerarquía inequívoca, cero jerga interna en pantalla.

**Solo escritorio y tablet (ancho mínimo 768 px). No es una aplicación para móvil**: no propongas vistas para teléfono, no lo marques como defecto en una auditoría y no compruebes por debajo de 768 px. En un teléfono se ve con el ancho de tablet y desplazamiento lateral, y es lo previsto (decisión de Óscar, 25-09-2026, confirmada el 14-10-2026).

Documentos canónicos en el repo (léelos si necesitas detalle que aquí no esté):
- `GUIA_DE_DISENO_OAA.md` — la guía completa (color, dataviz, tipografía, tablas, accesibilidad).
- `src/styles/README.md` — las seis hojas y sus reglas.

**Ojo con las fechas:** la guía vigente es la **v3** (dirección «B″ · Institucional», ola 1 del rediseño, 03-09-2026). Cualquier referencia en pantalla a bandas de cabecera, a Newsreader/serif, al cobre o al lienzo `#E8EEF2` es de la versión anterior: ya no aplica (los PDF OAA sí conservan Newsreader, ver §6). El porqué de cada cambio está en `docs/DECISIONES_OLA1.md`.

---

## 1. Las ocho reglas que no se negocian

1. **Ningún valor en crudo fuera de `tokens.css`.** Ni un `#hex`, ni un `14px`, ni una sombra. Si falta un valor, se añade como token. Ángulos rectos: `--radius-*` valen 0 (salvo `--radius-pill` de los interruptores).
2. **`modules.css` solo compone** (grid, flex, gap, padding). No reinventa botones, focos, pestañas ni diálogos.
3. **Un control = una primitiva.** Todo sale de `src/components/ui/`: `Button`, `ModalDialog`, `SegmentedControl` (grupo/pressed), `SegmentedTabs` (tablist con paneles), `KpiStrip`, `PageHeader`, `EuroAmountInput`, `FileUploadField`, `MenuButton`, `AsyncState`.
   **Nada de cajas:** el panel no tiene borde, fondo ni radio; separan el espacio, su título en Prusia y un filete con marcador corto de acero. El borde vive en campos, tablas (filetes horizontales) y diálogos, y en ningún sitio más. Los KPI son cifras separadas por un filete, no tarjetas.
4. **Cero `!important`.** Si una regla necesita ganar por la fuerza, el problema es la estructura.
5. **Estilos en línea solo para valores calculados en tiempo de ejecución** (ancho de una barra, color de una serie). Nunca color, tipografía ni espaciado. Excepción: `src/reports/*` son documentos `@react-pdf`.
6. **Ningún componente ensancha el documento.** Las tablas anchas se desplazan dentro de `.table-wrap`; jamás `overflow-x: hidden` global.
7. **Cifras tabulares siempre**, y todo importe de una misma columna con el mismo número de decimales (`fmtEur(value, digits)`).
8. **Nada por debajo de 11 px** y ninguna tinta informativa por debajo de 4,5:1.

Espejo obligado: Recharts no resuelve `var(--token)` en todos los atributos, así que `src/core/theme.ts` copia la paleta. **Cualquier cambio de color se hace en los dos sitios a la vez.**

---

## 2. Navegación vigente (10 destinos)

```
Mercado        /mercado          (pestañas Calendario económico · Dividendos · Resultados · Estrategia, un solo nivel)
Activos        /buscador · /comparador   (Activos · Carteras · Patrimonial)
Cartera        /cartera (Diseño de cartera) · /cartera/informes (Informe) · /analisis · /posiciones-globales (Posiciones globales)
Cartera real   /cartera-real (Rendimiento) · /posiciones (Extracto externo)
Sistema        /sistema          (solo admin, guard isAdmin de ruta)
```

- **«Diseño de cartera» se llamaba «Constructor»** hasta el 21-10-2026. En pantalla y en los PDF ya solo existe el nombre nuevo; el código (`PortfolioBuilder`, `builder-*`, `BUILDER_STEPS`) y sus comentarios conservan el antiguo. No lo devuelvas a la interfaz.
- El enrutado vive en el shell (`BdbActivosApp` + `appRoutes.resolveRoute`). **AssetSearch ya no hace de router**: no le devuelvas ese papel.
- **Diseño de cartera va por pasos de trabajo** (ola 2): **Componer · Comprobar · Optimizar · Simular** (`BUILDER_STEPS` en `PortfolioBuilder.tsx`; `/cartera/optimizacion` abre Optimizar). Componer es la mesa de trabajo del prototipo B″: fila de capital, frontera (8) + métricas clave (4), tabla (8) + lateral (4) con aro de reparto, renta variable por región y **Estado** (`PortfolioStatusPanel`). No vuelvas a pestañas por componente.
- **La optimización tiene UNA puerta**: Diseño de cartera · paso Optimizar → «Optimizar» → diálogo de revisión → aplicar. No añadas atajos que apliquen pesos por otro camino (el maximizador local se retiró en la ola 1 por eso).
- El chip de la barra superior lleva el **nombre de la cartera activa**: la cartera se llama de algún modo en todas las pantallas.
- **El título de la página es la etiqueta del rail** (ola 3): Diseño de cartera (o el nombre de la cartera), Informe de cliente, Análisis, Extracto externo, Mercado. No inventes títulos («Construye tu cartera», «Análisis de cartera»).
- **El benchmark se elige a la vista** con `BenchmarkSelect` (fila de pestañas del Análisis y portada del Informe). No lo devuelvas a Analítica avanzada ni crees un segundo estado.
- **Informe de cliente = documento + «Solo asesor»**: lo que ve el cliente va en `.report-document`; diagnóstico de datos y trazabilidad, en `<details class="report-internal">`, que no existe en modo cliente. Sin «Volver a…».
- Todas las URLs del mapa viejo redirigen con intención (`/`, `/inicio` → Diseño de cartera; `/dashboard`, `/xray` → Análisis; `/admin` → Sistema…). Si añades o mueves un destino, mantén el redirect y su test en `appRoutes.test.ts`.
- La página «Resumen» no existe: salud, monitor de riesgo y composición viven en **Análisis**; la edición proporcional con candados y los súper-sectores, en **Diseño de cartera**.
- Rail izquierdo persistente (232 px, plegado a 56 px desde 1024 px; sin cajón: la app es de escritorio/tablet, ancho mínimo 768 px `--app-min-width` desde el 25-09, sin versión para teléfono). **Rail y barra superior en Prusia oscuro `#0F2D4A`: una sola L oscura** alrededor del lienzo blanco; el ítem activo es un bloque blanco con tinta Prusia y marcador de 3 px en acero. Sistema anclado al pie. Barra superior de 52 px con migas `Sección / Página`, origen de datos, cartera activa, modo cliente y cuenta.

---

## 3. Patrón de página

```
Cabecera (PageHeader)  antetítulo · H1 34 px peso 300 · descripción  [1 acción primaria]
Pestañas               solo subvistas de la MISMA entidad
Tira de KPIs           KpiStrip, 4-6 cifras, nunca 7 (cifra 28/300 en Prusia)
Zona analítica         retícula de 12 col: solo 12 · 8+4 · 6+6 · 4+4+4
Nota al pie            fuente, metodología, sello temporal
```

- **Una acción primaria por contexto**; dos o tres secundarias visibles, el resto en «Más acciones».
- **Un solo nivel de pestañas por página.** Una subvista con acciones propias usa `PageHeader level="section"` (título 15/600 Prusia con marcador), nunca un segundo H1. Vistas internas de una subvista → `SegmentedControl` (aria-pressed), no otro tablist.
- **Encabezados (ola 4):** `PageHeader` de página = único `h1`; `level="section"` = `h2`; `.panel__title` y cabeceras de módulo = `h3`. El tamaño lo da la clase.
- **Sin cajas**: toda sección va sobre el lienzo blanco con su título de 15/600 en Prusia, filete de 1 px y marcador de 36×2 px en acero. **Nunca tarjeta dentro de tarjeta** (con el panel sin caja, la regla se cumple sola). La sombra se reserva a lo que flota (menús, tooltips, diálogos).
- En Diseño de cartera: **frontera eficiente (8) + métricas clave (4) encima de la tabla de posiciones**; la frontera va en modo `compact` (solo el gráfico, cartera actual en ocre con etiqueta directa, activos en `--brand-40`), porque las tarjetas de propuesta pertenecen al optimizador. Las seis métricas son Rent. 3A · Vol. 3A · Sharpe · Máx. caída · TER medio · Rent. 5A.
- **Los avisos no llevan banda** (ola 2): `.notice` y sus alias son un filete de 3 px a la izquierda + texto en tinta secundaria (acero informa, ocre avisa, rojo bloquea, verde confirma). Ningún relleno tintado. La salud de la cartera es una sección (punto de estado + titular 22/300 en Prusia), no una tarjeta verde. El estado vacío es texto entre dos filetes; el punteado solo en la zona de soltar fichero.
- **No repitas un dato en la misma página.** Si la cabecera ya pinta Clase/Divisa/Región, la Radiografía las omite (`hideDuplicateBuckets`). El informe de cliente sí conserva el bloque completo.
- Fuera los «Volver a…» dentro del flujo (el rail ya navega); los empty states sí ofrecen su CTA («Ir al buscador»). *(La ficha lleva su vuelta desde el 04-11-2026, y lo confirma la decisión 35 del 05-11-2026.)*

---

## 4. Color

- Lienzo **`#FFFFFF`**; filete `#DDE3E9`, filete fuerte `#C3CCD5`.
- Tinta: primaria `#0F1720` · secundaria `#55636F` · terciaria `#5E6C78` · desactivada `#65727E`.
- **Azul de Prusia `#143D66`**: acción primaria, selección, foco, serie 1, título de sección y **cifra grande**.
- **Acero `#4F86B8`**: el marcador del sistema — pestaña activa, filete corto bajo el título, marcador del rail, barra de peso de la tabla.
- **Prusia oscuro `#0F2D4A`**: rail y barra superior.
- **Ocre `#B9862F`**: benchmark, aviso, serie 2. **Nunca como CTA**; para texto en ocre, `#8F6A22`.
- Estado: positivo `#1F6F4A` · negativo `#B23A2E` · aviso `#8F6A22` · informativo `#143D66`.
- **Aviso ≠ pérdida.** El rojo es pérdida confirmada o acción destructiva; el dato viejo o el límite cercano van en ocre.

**Ganancia/pérdida en dos vías:** en texto, deltas y KPIs se mantiene verde/rojo con el signo explícito (`+`, y `−` U+2212); nunca se colorea el fondo de la celda, solo el texto; el dato sin signo (patrimonio, peso, TER, volatilidad) va en **Prusia** si es cifra grande y en tinta neutra si es de tabla. Cuando **el color es el único canal** (cascadas, barras de contribución, mapas sin cifra): **Prusia = positivo, ocre = negativo**.

---

## 5. Dataviz

Paleta categórica, y **el orden es contrato**: 1 `#143D66` Prusia = cartera del cliente · 2 `#B9862F` ocre = benchmark · 3 `#4F86B8` acero · 4 `#2F7D6D` teal · 5 `#6B7480` gris · 6 `#6B4A72` ciruela · 7 `#A8563F` terracota · 8 `#7E8E9B` = «Otros». A partir de la sexta serie, agrega en «Otros».

El **mapa geográfico** va por macro-zona: América Prusia · Europa/O. Medio/África ocre · Asia teal, con la intensidad según el peso; sus barras repiten el color de su zona.

- Sin eje Y ni ticks, `tickMargin: 8`; rejilla solo horizontal 1 px `#E8EDF0` (punteada solo para proyecciones).
- Grosores: protagonista 1,75 · comparación 1,25 · contexto 1. Relleno de área 12 %, solo en la protagonista.
- Tooltip con cabecera de 12/500 (sin versalitas) y cifras tabulares a la derecha; leyenda en fila sin caja.
- **Cero animación al actualizar datos.** Estado vacío = rectángulo con causa y acción, nunca un spinner dentro del área de trazado.
- **Un solo gráfico protagonista por pantalla.**
- **Donut con una sola categoría ⇒ cifra grande con etiqueta, no un aro** (ya resuelto en `OaaDonutChart`; no lo reimplementes en el consumidor). En columna lateral, `OaaDonutChart` con `center` (capital + «N posiciones · K clases») y `layout="stack"`; el mapa en columna, `GeoDistributionMap layout="stacked"` (mapa + tres barras por macro-zona).

---

## 6. Tipografía

**Una sola voz: IBM Plex Sans** (300/400/500/600) + **IBM Plex Mono** (ISIN, tickers). Autoalojadas. **No hay serif en pantalla**: `--font-serif` se retiró en la ola 1 con sus 18 usos.

H1 y display 34/300 · valor KPI 28/300 en Prusia · título de diálogo y estado vacío 20/500 · métrica secundaria 18/500 · título de sección 15/600 en Prusia · cuerpo 13,5 · secundario y rótulo 12 (rótulos 500).

**Ninguna versalita**: no queda una sola `text-transform: uppercase` en las hojas, y tampoco se escriben literales en mayúsculas en el JSX. Los rótulos se distinguen por tinta y peso.

Los números de tabla van en proporcional con `tabular-nums`, no en monoespaciada.

**Los PDF conservan su propia voz**, y son dos: el papel OAA (estrategia semanal y diaria, comparador de activos, costes, Análisis, cartera real, propuesta de mejora e informe completo interno) va en **Newsreader + Instrument Sans** (`src/reports/pdfTheme.ts`); el informe de cliente Andbank (y su versión limpia) y el comparador de carteras, en **Fraunces + Roboto Flex** sobre papel crema (`src/reports/clientReportTheme.ts`). Las fuentes van subconjuntadas: el texto que no se escribe en el propio documento (narrativa, nombres, motivos del backend) pasa por `safeText` de `pdfTheme`. No los alinees con la pantalla sin decisión explícita.

---

## 7. Tablas

Filas de 40 px (32 compacta, 48 cómoda), cabecera 36 px sobre fondo **blanco** con filete inferior, en 12 px peso 500 (sin versalitas). En la tabla de posiciones, el peso lleva **barra de 72×6 px en acero** junto a la cifra (oculta por debajo de 1180 px y, junto a la columna lateral, por debajo de 1600 px); la tabla no va en caja y va a ras del bloque, con vehículo·clase apilados, la retrocesión bajo el importe y las tres acciones en una celda — así cabe en 8 columnas sin desplazamiento. **Solo filetes horizontales**; sin bordes verticales (es el marcador nº 1 de «esto parece Excel»). Texto a la izquierda, cifras a la derecha, cabecera alineada como su contenido. Nombre + código en dos líneas (`.cell-entity`). Cabecera fija; totales con filete superior de 2 px. Acciones de fila al hover y siempre visibles en táctil, como botones de icono con `aria-label` + tooltip. Estado vacío con altura de tres filas, causa y acción.

En anchuras reducidas se retiran columnas de menos a más informativa; ningún dato se pierde (la ficha expandida los mantiene). **La estructura de columnas no cambia según los datos**: una columna que aparece y desaparece entre carteras hace la tabla inestable.

Campos dentro de celda: unidad (`%`, `€`) **dentro del borde** del campo, patrón input-group, altura táctil ≥ 30 px.

---

## 8. Formato numérico y lenguaje

| Caso | Formato |
|---|---|
| Porcentaje | `+6,42 %` (coma decimal, espacio antes del %) |
| Importe | `12.842.507 €` |
| Ratio | `0,39` |
| Fecha en cabecera / tabla / exportación | `25 jul 2026` / `25/07/2026` / `2026-07-25` |
| Negativo | `−13,7 %` con menos tipográfico |

- Entrada de importes: **siempre `EuroAmountInput`** (parser europeo — «2.000» son dos mil, no 2 —, borrador local confirmado en blur/Enter, formato es-ES al salir). Ningún parseo numérico nuevo: delega en `core/numberFormat.parseEuropeanNumber`. Un porcentaje técnico de asesor puede ser `type="number"` con `step` y `lang="es"`; todo `range` con `aria-label`; placeholders con coma («0,00»).
- Ningún `Intl.NumberFormat` local para importes ni `{x}%` a mano: `fmtEur` (agrupa siempre: «5.000 €») y `fmtPct`.
- Anglicismos prohibidos en pantalla: holdings → posiciones subyacentes · backtest → simulación histórica · drawdown → máxima caída · yield → rentabilidad por dividendo · look-through → composición subyacente · X-Ray → Análisis. Errores del SDK: `toAppError` traduce por código de Firebase; el original va plegado como «Detalle técnico».
- **Ningún código interno llega a pantalla.** Traduce con `src/core/labels.ts` (`TYPE_LABELS`, `CLASS_LABELS`, …) y `readableBackendLabel()` como red de seguridad. Sin anglicismos: idoneidad, avisos, vista previa, importación.
- **Modo cliente** (`useClientMode`): nada de retrocesiones, cesión, márgenes ni la palabra «retrocesión» — tampoco en etiquetas de menú, exportaciones CSV ni PDF. Al añadir cualquier cosa sensible, gátéala.

---

## 9. Accesibilidad

Tinta ≥ 4,5:1, gráficos ≥ 3:1. Foco visible sin excepción (doble anillo). Objetivos táctiles ≥ 32 px en tablet (768 px; se mide la caja que recibe el toque, la etiqueta, no la casilla). Pestañas con flechas/Inicio/Fin; diálogos con foco inicial, trampa, Escape y restauración (`ModalDialog`/`useAccessibleDialog` — no montes un diálogo a mano). **Ningún `window.confirm`**: `useConfirm()` + `{confirmDialog}` (`ui/useConfirm.tsx`), tono `danger` en escrituras irreversibles. Todo `th` con `scope`; toda tabla con `aria-label`. `prefers-reduced-motion` desactiva toda animación. **Cero desbordamiento horizontal entre 768 y 1920 px.**

---

## 10. Antes de dar por hecho un cambio de interfaz

```
npm run lint            0 errores, 0 avisos
npm run typecheck       0
npm test                todo en verde
npm run build           presupuesto respetado (JS inicial ~122 KiB gzip · CSS ~28,4, tope 45)
npm run audit:ui        EN CERO (17 vistas —12 rutas + Dividendos, Resultados y
                        Estrategia de Mercado + Informe y Optimizar en modo
                        cliente— × 3 anchos: overflow, contraste medido en
                        ejecución, tamaño mínimo, a11y, consola y, en modo
                        cliente, nada reservado al asesor)
npm run smoke:informe   en verde (flujo Construir → Informe)
npm run smoke:pdf       en verde (fuentes incrustadas en los PDF)
node scripts/deadCssD3.mjs   sin clases ni tokens muertos ni var(--x) sin declarar
                             (también corre en npm test y sale con código 1 ante
                             cualquiera; ⚠ DYN = a mano)
node scripts/dupSelectors.mjs --max-intra 0
                             ninguna propiedad repetida dentro de un mismo bloque
                             (también en npm test: la segunda pisa a la primera)
```

`audit:ui` sale con código 1 si hay hallazgos: no lo des por bueno solo porque el log no grite. **Mide el contraste contra el fondo pintado real**, así que caza lo que los tokens no ven (un distintivo con relleno propio sobre la barra oscura, por ejemplo). Si tocas capital, candados, foco de Diseño de cartera o el flujo del informe, el smoke es obligatorio.

---

## 11. Trampas conocidas

- Sin Firebase, `src/adapters/demoBackend.ts` responde con **los mismos contratos** que el backend real (incluidos `optimize_portfolio` y `backtest_portfolio`). Si añades una callable, añade su handler demo: la app se enseña entera sin credenciales.
- Nunca un `window.alert` ni un error crudo del backend en pantalla: banner con causa en español y acción de reintento.
- **Un cero creíble es peor que un error.** Si un dato falla, dilo; no pintes 0 %.
- Una cifra, una definición: pantalla y PDF salen del mismo feed (`reportPipeline` / `portfolioReportAnalytics`). No introduzcas un cálculo local paralelo de volatilidad, drawdown, exposición o Sharpe.
- El PDF de cliente vivo es el Andbank (`src/reports/andbankPortfolioReportPdf.tsx`); el generador OAA se borró.
- El nombre de la cartera activa vive en el **shell** (`BdbActivosApp`), viaja en `current-portfolio.v1` como campo opcional y lo hereda la cartera guardada al cargarla. No lo dupliques en estado local de Diseño de cartera.
