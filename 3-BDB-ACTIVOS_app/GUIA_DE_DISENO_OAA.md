# Retirada, no gobierna

*Esta guía describe el sistema visual que se descartó el 2 de noviembre de 2026. Se conserva como registro de lo que
hubo. Lo que manda es `docs/rediseno-2026-11/DIRECCION_ELEGIDA_2026-11-02.md`, y cómo se trabaja con ello está en la
habilidad `diseno-pantalla`. Si algo cita esta guía, está citando un sistema descartado.*

---

# Guía de diseño OAA · v3

**Dirección visual «B″ · Institucional», ola 1 del rediseño (3 sept 2026).**
Historial: rediseño de julio de 2026 · capa de tema y contrato de agosto (olas
D1–D3) · esta v3 retira esa capa y cambia paleta y tipografía. El registro de
cada decisión, con su motivo, está en `docs/DECISIONES_OLA1.md`.

Herramienta de selección de activos, construcción de carteras y análisis para
banca privada. La usa un asesor delante del cliente: densidad profesional,
jerarquía inequívoca y cero jerga interna en pantalla.

**Dispositivos: escritorio y tablet, nunca teléfono.** El ancho mínimo es 768 px
(`--app-min-width`). La aplicación no tiene ni tendrá versión para móvil: en un
teléfono se ve con el ancho de tablet y desplazamiento lateral, y eso es lo
previsto, no un defecto. No se diseñan vistas para teléfono ni se audita por
debajo de 768 px. Decisión de Óscar, vigente desde el 25-09-2026 y confirmada
el 14-10-2026.

Este documento es **contrato**: si la aplicación y la guía discrepan, una de las
dos está mal y hay que corregirla en la misma sesión. La mecánica de las hojas
(orden de carga, qué puede vivir en cada fichero) está en `src/styles/README.md`.

---

## 1. Estado actual (cierre de la ola 3 del rediseño · 4 sept 2026)

**La identidad en pantalla es B″:** lienzo blanco, tinta casi negra, **azul de
Prusia** como color de marca, rail y barra superior en Prusia oscuro formando
una sola L alrededor del contenido, **IBM Plex** como única voz, ángulos rectos,
sin bandas, sin tarjetas y sin versalitas. La jerarquía la hacen el tamaño, el
peso y los filetes.

| | Valor |
|---|---|
| Hojas de estilo | 6 ficheros con responsabilidad explícita (la capa de tema `oaa-bands.css` se retiró) |
| CSS servido | **29,6 KiB gzip** (presupuesto 45 KiB, `scripts/checkInitialBundleBudget.mjs`) |
| JS inicial | 118,5 KiB gzip (presupuesto vigilado por `scripts/checkInitialBundleBudget.mjs`) |
| `!important` | 8, todos en `base.css`/`charts.css` (lector de pantalla, `prefers-reduced-motion`, leyenda interna de Recharts) |
| Clases muertas | 0 — purga D3 (~160 selectores legados: dash-*, home-*, fund-*, frontier-kpi*, strategy-calendar-*, oaa-chip*, .kv…) |
| Tokens huérfanos | 0 — retiradas las rampas P&L y divergente sin consumidor, `--seq-2/3/5/6/7`, sombras y radios sin uso |
| Contraste por debajo de AA | 0 en texto activo |
| Tamaños por debajo de 11 px (pantalla) | 0 |
| Tipografías | autoalojadas: IBM Plex Sans/Mono en pantalla (Fontsource); en los PDF, Newsreader + Instrument Sans (papel OAA, `pdfTheme.ts`) y Fraunces + Roboto Flex (informe Andbank y comparador de carteras, `clientReportTheme.ts`), en TTF estáticas de `src/assets/fonts/` |

---

## 2. Arquitectura de navegación

Un destino pertenece al grupo de la **entidad** sobre la que trabaja, no al de
la herramienta que usa. Diez destinos:

```
MERCADO          Mercado          (Calendario económico · Dividendos ·
                                   Resultados · Estrategia — un solo nivel)
ACTIVOS          Buscador · Comparador
CARTERA          Diseño de cartera (pasos: Componer · Comprobar · Optimizar ·
                                    Simular; guardadas)
                   Informe de cliente
                 Análisis         (X-Ray de la cartera)
                 Posiciones globales (importes acumulados por fondo, agrupados por ISIN)
                 └ La optimización tiene UNA sola puerta: Diseño de cartera ·
                   paso Optimizar → «Optimizar» → revisión → aplicar.
CARTERA REAL     Rendimiento · Extracto externo
─────────────────────────────────────────────
SISTEMA          BBDD maestra · estado del sistema     (solo administradores)
```

- **Rail izquierdo persistente** de 232 px con etiquetas siempre visibles.
  Plegable; a 1024 px se compacta solo; en tablet mantiene el rail compacto, sin cajón móvil.
- El rail y la barra superior comparten el **Prusia oscuro `#0F2D4A`** y forman
  una sola L alrededor del lienzo blanco. El ítem activo es un **bloque blanco
  a sangre** con tinta Prusia y marcador de 3 px en acero: sobre el rail, lo
  seleccionado es lo que se ilumina.
- **La sección Sistema se ancla al pie**, separada por un filete: no forma
  parte del flujo de asesoramiento.
- **Barra superior de 52 px** (en Prusia) con migas `Sección / Página`; si el
  título de la página coincide con la sección, la miga no lo repite. A su
  derecha: origen de los datos, **chip de la cartera activa con su nombre**,
  modo cliente y cuenta. El chip lleva un cuadrado de acero: mismo gesto que el
  marcador del rail.
- **«Informe de cliente» no es un módulo suelto**: es una vista de Diseño de cartera
  y así aparece, indentado.
- **El título de la página es la etiqueta del rail** (ola 3): Diseño de cartera (o el
  nombre de la cartera activa), Informe de cliente, Análisis, Extracto externo,
  Mercado. Nada de «Análisis de cartera» en dos sitios ni «Construye tu cartera».
- **El benchmark se elige donde gobierna**: en la fila de pestañas del Análisis y
  en la portada del Informe (`BenchmarkSelect`, un solo estado). Nunca escondido
  en una subvista.
- **Análisis e Informe son distintos por propósito**: Análisis es la radiografía
  de trabajo (pestañas Visión general · Analítica avanzada); Informe es la vista
  previa del documento del cliente con su portada (cliente, responsable, correo,
  benchmark). Lo interno del asesor (diagnóstico de datos, trazabilidad) va
  aparte, plegado bajo «Solo asesor», y no existe en modo cliente.

---

## 3. Patrón de página

Uno solo, para todas las pantallas:

```
Cabecera        antetítulo · H1 34 px peso 300 · descripción   [acción principal]
                ─────────────────────────────────────────────────────────────────
Pestañas        (opcional; solo subvistas de la MISMA entidad)
Tira de KPIs    4–6 cifras, nunca 7 · cifra 28/300 en Prusia, filete entre vecinas
Zona analítica  retícula de 12 columnas: 12 · 8+4 · 6+6 · 4+4+4
Nota al pie     fuente del dato, metodología, sello temporal
```

En Diseño de cartera, la cabecera la titula **el nombre de la cartera activa**
(cliente · propuesta) y la descripción resume posiciones, capital y suma de
pesos. Ese nombre viaja en `current-portfolio.v1` y lo enseña el chip de la
barra superior en todas las pantallas.

**Diseño de cartera se organiza por pasos de trabajo** (ola 2), no por
componentes: **Componer · Comprobar · Optimizar · Simular**, como texto sobre
un filete con el activo marcado por 3 px de acero. Sin posiciones solo está
activo Componer. Componer es la mesa de trabajo del prototipo B″:

```
Nombre · capital · suma de pesos · modo de ajuste · normalizar · vaciar
Frontera eficiente (8)                    Métricas clave (4): seis cifras
Posiciones (8)                            Reparto por clase — aro con el capital
  tabla sin caja, filetes horizontales      Renta variable por región — mapa + 3 barras
  Aportación de capital                     Estado — punto de color por línea
```

El bloque **Estado** es el semáforo de la mesa (pesos, perfil, concentración,
datos) y remite a Comprobar; reutiliza `PORTFOLIO_HEALTH_RULES`, no inventa
umbrales.

**Una acción primaria por contexto.** Dos o tres secundarias visibles y el resto
en un menú «Más acciones».

**Un solo nivel de pestañas por página.** Si una subvista necesita cabecera con
acciones propias (Estrategia semanal/mensual), usa `PageHeader level="section"`:
título 15/600 en Prusia con marcador, nunca un segundo H1. Las vistas internas
de una subvista (Resumen · Asignación · Informe en Estrategia) son un
`SegmentedControl` de vista (grupo con `aria-pressed`), no un segundo tablist.

**Jerarquía de encabezados (ola 4, 30 sept 2026).** El título de página
(`PageHeader`) es el **único `h1`** del documento; la cabecera de subvista
(`level="section"`) es `h2`; los títulos de panel (`.panel__title`, cabeceras
de módulo heredadas) son `h3`. El tamaño lo da la clase, no la etiqueta.

**Nada de cajas.** Desde la ola 1, el panel **no** es una superficie con borde:
es una sección sobre el lienzo blanco, separada por espacio, con su título en
Prusia y su filete (§4). El borde se reserva a tres sitios: **campos**,
**tablas** (solo filetes horizontales) y **diálogos**. Los KPI tampoco van en
tarjeta: son cifras separadas por un filete.

- **Nunca tarjeta dentro de tarjeta** — con el panel sin caja, la regla se
  cumple sola.
- Para jerarquía interna, un filete y un título de 15/600, no una caja anidada.
- **Los avisos tampoco son cajas** (ola 2): un filete de 3 px a la izquierda y
  texto en tinta secundaria. El color del filete dice el tipo — acero informa,
  ocre avisa, rojo bloquea, verde confirma — y nunca hay relleno tintado.
- **El estado de salud es una sección**, no una tarjeta de color: título con
  marcador, punto de 10 px en el color del estado, titular 22/300 en Prusia y
  los hallazgos bajo un filete.
- **El estado vacío** es texto centrado entre dos filetes; el punteado queda
  solo para la zona de soltar un fichero.

La sombra se reserva a lo que flota: menús, tooltips y diálogos.

---

## 4. Cabeceras de sección

**No hay bandas.** La capa de tema `oaa-bands.css` (fondo pizarra `#5D7280` y
filete de acento por familia) se retiró en la ola 1: ocho bandas por pantalla
leían como ocho mini-rails del mismo peso y su color codificaba una familia que
nadie podía decodificar.

Toda cabecera —`.panel__head` y las 21 cabeceras de módulo heredadas— se pinta
igual:

```
Título de sección   15 / 20 · 600 · Prusia #143D66
─────────────────────────────────────────────────  filete 1 px #DDE3E9
▁▁▁▁                                               marcador 36 × 2 px #4F86B8
```

- El marcador de acero es el **mismo gesto** que la pestaña activa y la barra de
  peso de la tabla: en toda la aplicación, acero = «esto es el marcador del
  sistema».
- El subtítulo va debajo del título, en tinta secundaria de 12 px.
- Sin fondo, sin sangrado negativo y sin acento por familia: **un solo
  tratamiento** para todas las secciones.
- La lista de cabeceras de módulo (final de `components.css`) es herencia
  cerrada y **no crece**: un módulo nuevo usa `.panel__head`.

---

## 5. Color

### Lienzo y neutros

Lienzo **`#FFFFFF`**: la pantalla es blanca y lo que separa es el espacio, no un
gris de fondo. Filete `#DDE3E9`, filete fuerte `#C3CCD5`. El espejo TypeScript
(`theme.ts`) usa los mismos valores.

Neutros, catorce pasos, uno por función:
`#FFFFFF · #FBFCFD · #F2F5F8 · #E9EEF3 · #DDE3E9 · #D0D8E0 · #C3CCD5 · #A3AFBA · #55636F · #3F4C58 · #26303A · #0F1720 · #0A1018`

### Tinta

| Rol | Valor | Contraste sobre blanco |
|---|---|---|
| Primaria | `#0F1720` | 18,1:1 |
| Secundaria | `#55636F` | 6,6:1 |
| Terciaria (rótulos, notas) | `#5E6C78` | 5,7:1 |
| Desactivada | `#65727E` | 4,9:1 sobre su relleno |

`#A3AFBA` y por debajo quedan reservados a iconos, líneas y decoración.

### Marca y acento

- **Azul de Prusia `#143D66`** (10,9:1): acción primaria, selección, foco,
  serie 1, título de sección y **cifra grande neutra**.
- **Acero `#4F86B8`**: marcador del sistema — pestaña activa, filete corto bajo
  el título de sección, marcador del rail, barra de peso de la tabla.
- **Prusia oscuro `#0F2D4A`**: rail y barra superior (la L oscura). El ítem
  activo del rail es un bloque **blanco** con tinta Prusia.
- **Ocre `#B9862F`**: benchmark, aviso y serie 2. **Nunca como llamada a la
  acción.** Para texto en ocre, `#8F6A22` (5,0:1); `#B9862F` (3,4:1) solo en
  rellenos, trazos y filetes.

### Estado

`positivo #1F6F4A` · `negativo #B23A2E` · `aviso #8F6A22` · `informativo #143D66`.
**Aviso ≠ pérdida.** El rojo se reserva a pérdida confirmada y acción
destructiva; el dato desactualizado o el límite cercano van en ocre.

### Geometría

`--radius-*` valen **0**: ángulos rectos en paneles, campos, botones y
distintivos. La única excepción es `--radius-pill`, que sigue en los
interruptores. Los tokens existen para que un solo cambio recupere el radio.

---

## 6. Ganancia y pérdida: sistema de dos vías

**Vía A — texto, deltas, KPIs, celdas.** Verde/rojo, porque el signo `+`/`−`
ya aporta redundancia. Signo positivo explícito; el negativo usa el menos
tipográfico `−` (U+2212). Nunca se colorea el fondo completo de una celda por
su signo: solo el texto. El dato neutro (patrimonio, peso, TER) va en **Prusia**
si es una cifra grande y en tinta neutra si es una celda de tabla.

**Vía B — cuando el color es el único canal** (cascadas de atribución, barras
de contribución, mapas sin cifra impresa): **Prusia para positivo, ocre para
negativo**. Par azul/dorado, seguro para daltonismo.

---

## 7. Dataviz

### Paleta categórica (la de `tokens.css` §12 y `theme.ts`, únicos orígenes)

| # | Valor | Papel |
|---|---|---|
| 1 | `#143D66` Prusia | **cartera del cliente, siempre** |
| 2 | `#B9862F` ocre | **benchmark, siempre** |
| 3 | `#4F86B8` acero | tercera serie |
| 4 | `#2F7D6D` teal | cuarta serie |
| 5 | `#6B7480` gris | quinta serie |
| 6 | `#6B4A72` ciruela | sexta serie |
| 7 | `#A8563F` terracota | séptima serie |
| 8 | `#7E8E9B` gris claro | **«Otros»** |

Todas superan 3:1 sobre blanco y tienen luminancias separadas (distinguibles en
escala de grises y bajo deuteranopia). **El orden es contrato.** A partir de la
sexta serie, el resto se agrega en «Otros». Recharts no resuelve `var()` en
todos los atributos SVG, así que las series toman el literal de `theme.ts`;
`--series-1..8` siguen en `tokens.css` como definición canónica y cualquier
cambio se hace en los dos sitios a la vez.

Rampa **secuencial de Prusia** para magnitud (correlación, solapamiento,
exposición); su leyenda usa `--seq-1/4/8`. El **mapa geográfico** pinta una
macro-zona por color —América Prusia, Europa/O. Medio/África ocre, Asia teal—
mezclado con blanco al 75/50/25/0 % según el peso, y sus barras repiten ese
color. La mediana de Montecarlo va en Prusia discontinuo; la línea de
benchmark, en ocre.

### Reglas de trazado

- Sin línea de eje Y, sin marcas de tick, `tickMargin: 8`.
- Rejilla **solo horizontal**, 1 px `#E8EDF0`, sólida. Punteada exclusivamente
  para proyecciones y escenarios.
- Grosor por papel (`OAA_STROKE`): protagonista 1,75 px · comparación 1,25 px ·
  contexto 1 px.
- Relleno de área al 12 %, **solo en la serie protagonista y solo una**.
- Leyenda en fila de texto sin caja, muestra cuadrada de 8 px.
- Ticks y rótulos de eje a **11 px o más** y contraste ≥ 4,5:1 (`textSecondary`).
- Cero animación al actualizar datos.
- Estado vacío: rectángulo del alto del gráfico con causa y acción.
- **Un solo gráfico protagonista por pantalla.**
- **Frontera de Diseño de cartera** (ola 2): la frontera aproximada es la única
  línea Prusia y va **continua** (ola 3, decisión de Oscar: que es aproximada
  lo dicen el distintivo y el subtítulo, no el trazo); la **cartera actual en
  ocre con etiqueta directa** («Cartera
  actual», sin leyenda que buscar) y los activos en acero claro `--brand-40`.
  Las carteras de máximo Sharpe y mínima volatilidad pertenecen al paso
  Optimizar y a Análisis · avanzada, donde la cartera sigue en Prusia.
- **Aro con cifra en el hueco** (`OaaDonutChart center`): capital en Prusia
  22/300 y «N posiciones · K clases»; leyenda debajo (`layout="stack"`) cuando
  el aro va en columna lateral.
- **Mapa apilado** (`GeoDistributionMap layout="stacked"`) en columna: mapa y
  tres barras por macro-zona en el color de la zona; el desglose completo por
  regiones se queda en Análisis.

---

## 8. Tipografía

**Una sola voz en pantalla: IBM Plex.** `IBM Plex Sans` (300/400/500/600) para
todo e `IBM Plex Mono` para códigos. Autoalojadas mediante Fontsource. **No hay
serif**: se retiró con sus 18 usos en la ola 1 (el énfasis lo dan el tamaño y el
peso 300, no un cambio de familia). Los PDF conservan su propia voz (§14).

| Papel | Tamaño / interlineado | Peso |
|---|---|---|
| H1 de página y display | 34 / 36 | 300 · `ls -.015em` |
| Valor KPI | 28 / 28 | 300 · `ls -.02em` · Prusia |
| Título de diálogo y estado vacío | 20 / 24 | 500 |
| Métrica secundaria | 18 / 22 | 500 |
| Título de sección | 15 / 20 | 600 · Prusia |
| Cuerpo y celda | 13,5 / 19 | 400 |
| Secundario y rótulo | 12 / 17 | 400 · rótulos 500 |
| Código (ISIN, ticker) | 11–12 | IBM Plex Mono |

**Nada por debajo de 11 px** en pantalla. **Ninguna versalita**: no queda una
sola declaración `text-transform: uppercase` en las hojas, y los rótulos se
distinguen por tinta y peso, no por caja. La monoespaciada se reserva a ISIN,
tickers e identificadores; los números de tabla van en proporcional con
`font-variant-numeric: tabular-nums`.

---

## 9. Tablas

- Filas de **40 px**, cabecera de 36 px.
- **Solo filetes horizontales** de 1 px. Sin bordes verticales.
- Cabecera en 12 px peso 500 sobre fondo blanco con filete inferior. **Sin
  versalitas.**
- **Texto a la izquierda, cifras a la derecha**, con cifras tabulares y la
  cabecera alineada igual que su contenido. Las celdas numéricas (`td.num`)
  llevan `white-space: nowrap`: un porcentaje nunca se parte de su signo.
- Nombre + código en dos líneas (`.cell-entity`), código en monoespaciada 11 px.
- En la tabla de posiciones, el peso lleva **barra de 72 × 6 px en acero** a la
  izquierda de la cifra, escalada al mayor peso de la cartera (se retira por
  debajo de 1180 px, y por debajo de 1600 px cuando la tabla convive con la
  columna lateral: el dato es la cifra, la barra es ayuda y el aro está al lado).
- La tabla de posiciones **no va en caja** y va a ras del bloque (primera y
  última columna sin sangrado). Para caber en 8 columnas: vehículo y clase
  apilados en una columna, retrocesión como segunda línea bajo el importe,
  las tres acciones de fila en una sola celda y nombre en dos líneas como máximo.
- Cabecera fija, fila de totales con filete superior de 2 px.
- Estado vacío con altura de tres filas, causa y acción.
- **Ninguna tabla ensancha el documento**: se desplaza dentro de su panel.

---

## 10. Formato numérico y datos ausentes

| Caso | Formato |
|---|---|
| Porcentaje | `+6,42 %` — coma decimal, espacio antes del `%` |
| Importe | `12.842.507 €` — punto de millares, símbolo detrás |
| Ratio | `0,39` |
| Fecha en cabecera | `25 ago 2026` |
| Fecha en tabla | `25/08/2026` |
| Fecha en exportación | `2026-08-25` |
| Negativo | `−13,7 %` con menos tipográfico |

Todo pasa por `src/core/format.ts` (`fmtEur`, `fmtPct`, `fmtNum`, `fmtDate*`);
`toFixed()` no llega a pantalla y **ningún `Intl.NumberFormat` local** para
importes (`fmtEur` agrupa siempre los millares: «5.000 €»). Los porcentajes
nunca se componen a mano (`{x}%`): `fmtPct`. **Dentro de una misma columna, siempre el
mismo número de decimales.** Las fechas se interpretan en UTC: una fecha-solo
jamás retrocede un día por el huso.

**Convención de ausencia — dos símbolos, dos significados:**

- **`N/D`** («no disponible»): el dato debería existir y no ha llegado
  (constante `ND` de `format.ts`).
- **`—`** (raya): el dato **no aplica** a esa fila o celda (un fondo sin
  ex-date, un benchmark sin TER).

No se intercambian: `—` donde falta un dato esconde un problema de datos;
`N/D` donde no aplica sugiere un fallo que no existe.

---

## 11. Lenguaje

Ningún código interno llega a pantalla. `EQUITY` → «Renta variable», `FUND` →
«Fondo», `MISSING_HOLDINGS` → «Sin cartera publicada», `VALID` → «Correcto».

Las traducciones viven en `src/core/labels.ts` (`TYPE_LABELS`, `CLASS_LABELS`,
`QUALITY_FLAG_LABELS`, `VALIDATION_STATUS_LABELS`, `SOURCE_KIND_LABELS`,
`METRIC_KEY_LABELS`) con `readableBackendLabel()` como red de seguridad. Sin
anglicismos: *suitability* → idoneidad, *warnings* → avisos, *preview* → vista
previa, *import* → importación, *holdings* → posiciones subyacentes,
*backtest* → simulación histórica, *drawdown* → máxima caída, *yield* →
rentabilidad por dividendo, *look-through* → composición subyacente, *X-Ray* →
Análisis. Los errores del SDK (Firebase) se traducen por código en
`toAppError` (`appError.ts`); el mensaje original queda plegado como «Detalle
técnico». Textos con tilde y ñ también en los generados
(vista previa del contrato, avisos de datos).

---

## 12. Accesibilidad

- Toda tinta informativa supera **4,5:1**; los elementos gráficos, 3:1.
- **Foco visible sin excepción**: doble anillo (`--focus-ring`, 2 px de la
  superficie + 4 px de acero al 60 %) en controles; los campos de texto usan el
  halo suave único `--focus-glow` (borde acero + 3 px al 18 %). Ninguno se
  copia en crudo: ambos son tokens.
- Objetivos táctiles de **32 px o más** en tablet táctil.
- Pestañas con flechas, Inicio y Fin; diálogos con trampa de foco, Escape y
  restauración; menús con flechas y Escape.
- **Ningún `window.confirm`/`alert`**: toda confirmación pasa por
  `ConfirmDialog`/`useConfirm` (sobre `ModalDialog`), con título en forma de
  pregunta, la acción nombrada («Eliminar», «Cargar») y tono `danger` en
  escrituras irreversibles.
- **Tablas**: todo `th` lleva `scope="col"`/`"row"` y toda tabla tiene nombre
  accesible (`aria-label` o `<caption>`).
- `prefers-reduced-motion` desactiva toda animación.
- **Cero desbordamiento horizontal** del documento entre 768 y 1920 px (escritorio y tablet; sin versión para teléfono).

---

## 13. Modo de demostración

Sin Firebase configurado y en desarrollo, `src/adapters/demoBackend.ts`
responde a las funciones invocables **respetando los mismos contratos** que el
backend real. La aplicación se recorre entera sin conexión y la barra superior
lo señala con «Datos de muestra». En producción se exige fuente en vivo.

---

## 14. PDFs: dos voces, una casa

Los documentos `@react-pdf` no comparten hoja con la web, pero desde la ola D3
comparten **paleta y tipografía** a través de `src/reports/pdfTheme.ts`:

**Decisión de la ola 1 (03-09-2026): el papel conserva su voz.** La pantalla es
la herramienta (Prusia, IBM Plex, ángulos rectos); el PDF es el documento que el
cliente se lleva (papel, serif, filetes cálidos). La divergencia deja de ser un
accidente y pasa a ser deliberada; se revisa al cerrar la ola 2 con un informe
generado desde la aplicación ya rediseñada.

- **Voz OAA** (`pdfTheme.ts`: `weeklyReportPdf`, `assetComparePdf`,
  `costsPdf`, `xrayPdf`, `realPortfolioPdf`, `improvementProposalPdf` e
  `internalPortfolioReportPdf`): Newsreader para titulares y valores, Instrument
  Sans para el cuerpo (instancias TTF estáticas en `src/assets/fonts/`, ya
  **independientes** de los paquetes Fontsource de la web, que ahora sirven IBM
  Plex). Paleta `PDF_COLORS`. Nada de Helvetica, Times ni cremas fuera de
  paleta. Las fuentes van subconjuntadas: todo texto que no se escribe en el
  propio documento (narrativa del modelo, nombres, motivos del backend, plan de
  ejecución) pasa por `safeText` (`pdfTheme.ts`), que cambia los signos sin
  glifo por su lectura y las letras fuera del subconjunto por su letra base
  (16-10-2026).
- **Voz Andbank** (`clientReportTheme.ts`: `andbankPortfolioReportPdf`, su
  versión limpia y `comparePdf`): identidad propia del informe
  de cliente — Fraunces y Roboto Flex — con **escala tipográfica cerrada de 16
  tamaños** (documentada en el propio fichero) y la misma convención de
  porcentaje que la web (espacio antes del `%`).

Regla común: los importes, porcentajes y fechas de los PDF pasan por
`format.ts` exactamente igual que la pantalla.

---

## 15. Historial y referencias

- Las decisiones y verificaciones de cada ola están en el proyecto de Claude:
  auditorías del 25-08, plan de acción y cierres de olas A1/D1, A2, D2 y D3.
- Capturas de referencia en `docs/screenshots/`: serie `f3–f5` (hitos
  funcionales), `interfaz-v2-*` (rediseño de julio) e `interfaz-v4-*` (estado
  al cierre de D3, 25-08-2026). La referencia visual vigente es el **prototipo
  de la Fase 2 del rediseño** (cuatro direcciones; elegida la B″) y las capturas
  `interfaz-v6-*` (cierre de la ola 2); los registros de decisiones,
  `docs/DECISIONES_OLA1.md`, `docs/DECISIONES_OLA2.md` y `docs/DECISIONES_OLA3.md`.

## 16. Verificación

Cada bloque lleva su fecha: las cifras de una ola no se mezclan con las de otra.

**4 sept 2026 · ola 3 del rediseño**

```
npm run typecheck   ✓
npm run lint        ✓  0 errores, 0 avisos
npm test            ✓  552 pruebas
npm run build       ✓  JS inicial 118,5 KiB gzip · CSS 29,6 KiB gzip (tope 45)
npm run audit:ui    ✓  EN CERO × 3 anchos (desbordamiento, contraste medido en
                       ejecución, tamaño mínimo, a11y, consola)
npm run smoke:informe ✓ flujo Construir → Informe, 11 comprobaciones
npm run smoke:pdf   ✓  Fraunces+Roboto Flex incrustadas; sin Helvetica/Times
```

**16 oct 2026 · auditoría de interfaz**

```
npm run typecheck   ✓
npm run lint        ✓  0 errores, 0 avisos
npm test            ✓  todo en verde (incluye deadCssD3 y dupSelectors --max-intra 0)
npm run build       ✓  JS inicial 122,4 KiB gzip · CSS 28,4 KiB gzip (tope 45)
npm run audit:ui    ✓  EN CERO · 17 vistas × 3 anchos (lo de arriba y, en modo
                       cliente, nada reservado al asesor)
npm run smoke:informe ✓ flujo Construir → Informe, 13 comprobaciones
npm run smoke:pdf   ✓  Fraunces + Roboto Flex en el comparador de carteras;
                       Instrument Sans + Newsreader en el semanal y la
                       Radiografía (papel OAA); sin Helvetica/Times
```

`audit:ui` sale con código 1 con **un solo** hallazgo: no se da por bueno porque
el log no grite. Desde el 14-10-2026 mide las 12 rutas más las pestañas
Dividendos, Resultados y Estrategia de Mercado, que abre pulsándolas y mide
cuando su panel ya tiene contenido; desde el 16-10, **17 vistas**: también el
Informe de cliente y Optimizar **en modo cliente**, donde comprueba que el
interruptor está activo y que no aparece nada reservado al asesor («Solo
asesor», señales y calidad de datos, avisos de calidad, «lectura local»,
retrocesiones).

**El censo de CSS muerto forma parte de `npm test`** (14-10-2026):
`tests/deadCssCensus.test.ts` ejecuta `scripts/deadCssD3.mjs`, que sale con
código 1 —y la suite falla— ante cualquier clase definida en las hojas sin
referencia en `src/**` o cualquier token sin consumidor. Excepciones anotadas en
el script: las `.recharts-*` (las genera la librería), las clases que el código
construye con un prefijo dinámico (`is-*`, `ui-button--*`…; el censo las lista
como ⚠ DYN para revisarlas a mano) y `--series-1..8`, vivas mientras su valor
siga en el espejo `CHART_PALETTE` de `theme.ts`. Revisión visual por capturas antes/después de las 12 rutas a
1440 y 1024 px, y Diseño de cartera comparado con el prototipo de la dirección B″.
