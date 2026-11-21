# Las hojas de estilo

**Lo que gobierna el aspecto no está aquí.** Está en
[`docs/frontend/SISTEMA_DISENO.md`](../../../docs/frontend/SISTEMA_DISENO.md), el sistema de diseño aprobado el
13-11-2026 («Informe vivo»): la dirección, la arquitectura de información, los tokens (apartado 4), las piezas
comunes, el formato y el vocabulario. El aspecto es el de la dirección A, «Banca privada, puesta al día», que eligió
Óscar el 17-11-2026 (apartado 14, que en aspecto manda sobre los anteriores):
los valores de tokens.css mandan sobre los del bloque `:root` de
[`docs/frontend/maquetas/sistema.css`](../../../docs/frontend/maquetas/sistema.css) y sobre el aspecto de las maquetas,
que siguen valiendo por la estructura. Cómo se trabaja con ello —piezas, trampas y puertas— está en la
habilidad `diseno-pantalla`, en `.claude/skills/` de la raíz del proyecto. Si algo de aquí chocara con esos, mandan
ellos.

Esta página solo dice qué fichero es cada cosa y qué token se usa para qué.

## Qué hay

| Fichero | Qué lleva | Quién la carga |
|---|---|---|
| `tokens.css` | Los valores: color, tipografía, espaciado, radios, sombras, movimiento y marco. Espejo probado en `src/core/theme.ts` | `main.tsx` |
| `base.css` | Reset, documento, foco (también con contraste forzado), utilidades | `main.tsx` |
| `layout.css` | El marco: menú, barra superior, página, `.row` y `.stack` | `BdbActivosApp.tsx` |
| `components.css` | Botones, paneles, cifras, campos, avisos, diálogos | `BdbActivosApp.tsx` y `AuthGate.tsx` |
| `charts.css` | Lo común de los gráficos | `BdbActivosApp.tsx` |
| `modules.css` | Lo propio de cada pantalla. Se vacía al rehacer cada una, no como tarea aparte | `BdbActivosApp.tsx` y `AuthGate.tsx` |
| `impresion.css` | Lo que cambia al imprimir una pantalla con Ctrl+P. Los PDF no pasan por aquí | `BdbActivosApp.tsx` |
| `tabla.css` | La tabla y el plano, más las pantallas que nacieron con ellos | Las piezas de `components/tabla/` |
| `ficha.css` | La ficha de un activo | `FichaInstrumento.tsx` y `AssetHistoryChart.tsx` |
| `analisis.css` | Análisis e Informes de una propuesta: la rejilla del Resumen, las filas de datos, la lista de documentos y la firma | `XrayPage.tsx`, `PortfolioReportPage.tsx`, `CostsModal.tsx` y `DialogoDelInformeDeCliente.tsx` |
| `comparador.css` | El Comparador, pestañas «Propuestas» y «Patrimonial»: lo que añade el rediseño | `PortfolioComparator.tsx` y `WealthComparator.tsx` |
| `diseno.css` | Diseño de una propuesta y Carteras guardadas: la banda de datos y la rejilla de cada paso | `PortfolioBuilder.tsx` y `CarterasGuardadasPage.tsx` |
| `posiciones.css` | Posiciones: la fila de filtros | `PositionsWorkbench.tsx` |
| `mercado.css` | Mercado: cómo se apilan sus bloques y lo poco que es suyo | `MercadoPage.tsx` |
| `datos.css` | Datos (Salud del catálogo y Sistema), solo para administración | `SaludDelCatalogoPage.tsx` |
| `gestor.css`, `gestor-analisis.css`, `gestor-dialogos.css` | Carteras de clientes (el gestor de carteras): la base, el análisis y los diálogos | Las pantallas de `src/gestor/ui/` |
| `jubilacion.css` | Jubilación: la mesa de dos columnas, los saldos, la respuesta con su cifra, las frases de los escenarios y los carriles del método | `JubilacionPage.tsx`, que se carga a petición |
| `planes.css` | Planes y EPSV: solo cómo fluyen en columnas los bloques de la ficha. La lista usa los mandos y la tabla del Buscador tal cual | `PlanesPage.tsx`, que se carga a petición |

**Una pieza trae su hoja.** Una pantalla que usa `TablaDeDatos`, `TablaComparativa` o `PlanoRiesgoRetorno` no pide
`tabla.css`: si la pidiera cada pantalla, una que la olvide pinta la pieza sin estilo, y ya pasó. Solo la piden las
que escriben a mano clases suyas de esa hoja.

## Los tokens, en una tabla

Los nombres son los del sistema aprobado. Ningún otro fichero declara un color, una sombra, un tamaño de letra o un
radio en crudo: si falta un token, se añade aquí, no en la hoja de una pantalla.

| Grupo | Tokens | Para qué |
|---|---|---|
| Papel y tinta | `--lienzo`, `--papel`, `--banda`, `--banda-fuerte`, `--filete`, `--filete-fuerte`, `--filete-fila`, `--pista`, `--borde-control`, `--tinta`, `--tinta-2`, `--tinta-3`, `--tinta-inversa` | Superficies, filetes y texto. `--filete` es el borde de una tarjeta; `--filete-fila`, la línea entre las filas de dentro; `--filete-fuerte`, la de bajo las pestañas; `--pista`, la de una barra. `--borde-control` es el borde de un campo o un selector (3,04:1), no texto |
| Marca | `--marca`, `--marca-encima`, `--marca-pulsada`, `--marca-fuerte`, `--marca-tenue`, `--marca-linea`, `--marco`, `--laton`, `--laton-claro` | El marino: el botón principal (con sus dos estados), lo activo y lo elegido. `--marca-fuerte`, el azul del enlace y del anillo de foco. `--marco`, el menú. El latón, el filete de lo activo y el segundo trazo del doble filete de cabecera: nunca texto sobre el papel |
| Signo | `--sube`, `--baja`, `--baja-suave`, `--baja-linea`, `--baja-enfasis` | Verde si gana, rojo si pierde, siempre con su `+` o su `−`. El rojo es también el error, la validación que falla, la acción destructiva y el fallo del sistema |
| Atención | `--aviso`, `--aviso-suave`, `--aviso-linea`, `--aviso-enfasis` | Ocre: lo que pide la atención del asesor (aviso, dato que falta, cobertura parcial). Siempre con su palabra. `--aviso-enfasis`, el título de un aviso y la palabra de un distintivo de atención |
| Gráficos | `--serie-1` … `--serie-6`, `--serie-referencia`, `--chart-*`, `--rampa-0` … `--rampa-7` | El color lo decide el papel de la serie: 1 = la cartera, marino, siempre; la referencia (el índice, la cartera con que se compara), en su propio gris cálido y a trazos; las demás, de la 2 a la 6 (azul, verde salvia, latón, violeta, cacao) en el orden en que llegan. La rampa, del marfil al marino, para una magnitud (matrices, caja de estilo). El mapa no la usa: cada zona tiene su color (`ZONE_RAMPS` de `core/regionTaxonomy.ts`) |
| Clases | `--clase-renta-variable`, `--clase-renta-fija`, `--clase-liquidez`, `--clase-alternativos`, `--clase-mixto`, `--clase-activos-reales`, `--clase-resto` | El color de cada clase de activo (`coloresDeClase.ts`, espejo `CLASS_COLORS`), propio y distinto del puesto de una serie. `--clase-resto` es «Otros» y «sin clasificar»: solo relleno, nunca línea ni texto |
| Tipografía | `--fuente`, `--fuente-titulos`, `--fuente-serifa`, `--fuente-codigo`; `--texto-xxs` (12) · `--texto-xs` (13) · `--texto-sm` y `--texto-md` (14) · `--texto-ml` (15) · `--texto-lg` (17) · `--titulo-sm` (18) · `--titulo-md` (22) · `--cifra-lg` (30) · `--cifra-indicador` (32) · `--titulo-lg` (40) · `--cifra-xl` (44) | Once tamaños. Nada que lleve información por debajo de 12 px, tampoco en el menú (`--rail-texto-rotulo` es `--texto-xxs` desde el 19-11-2026; apartado 14.4 de SISTEMA_DISENO.md). La serifa, solo en lo que titula o contesta una pantalla (la lista entera, en la fila «Letra» del apartado 14): el título de pantalla (40/46), la cifra de un indicador y la fecha de cada proceso en Sistema (32/36), la cifra que contesta (44), el título de la tarjeta de acceso y, en el menú, el nombre de la casa y su monograma; el título de una tarjeta, en Plex a 15/20, y su procedencia, a 12/16 |
| Espaciado | `--s-1` … `--s-12` | La escala de siempre: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48 y 64 px |
| Geometría | `--radio-control` (5 px), `--radio-flotante` (8 px), `--radio-bloque` (6 px), `--radio-pieza` (5 px), `--radio-distintivo` (3 px), `--radius-pill`, `--radius-round`, `--control-*`, `--row-*`, `--cell-*` | Controles con 5 px; una tarjeta, 6; lo de dentro de una tarjeta, 5; un distintivo, 3; diálogos y menús, 8. Filas, barras y filetes, rectos |
| Elevación | `--sombra-flotante`, `--sombra-dialogo`, `--sombra-tarjeta` | Solo lo que flota; la de tarjeta, mínima, la despega del marfil del lienzo |
| Movimiento | `--dur-rapida`, `--dur`, `--dur-slow`, `--curva` | Solo en lo que aparece o cambia de estado; los datos no se animan |
| Marco | `--rail-*`, `--focus-ring*`, `--topbar-*`, `--page-*`, `--z-*` | Menú, barra superior, foco, anchos y capas. Ningún `z-index` con número: `--z-pegado` y `--z-sello` ordenan dentro de una zona, y de `--z-sticky` a `--z-pop`, el marco |

Queda un paso de la escala privada porque define un token: `--ochre-50` (el latón de serie de dos gráficos, que no
es el del aviso). `--brand-50`, el marcador del menú claro, se retiró con el menú marino de la dirección A: el
marcador es ahora `--laton-claro`.

## Las reglas que más se rompen

- **El signo de un resultado lleva color.** Una rentabilidad, un resultado, una diferencia con la referencia o una
  contribución van en verde (`--sube`) si ganan y en rojo (`--baja`) si pierden, siempre con su `+` o su `−` escrito: el
  color refuerza el signo, no lo sustituye. Lo pinta la pieza `Cifra`, no una clase escrita a mano. Un peso, una
  volatilidad, una caída máxima, un coste o el importe de un movimiento van en tinta, y un cero no lleva ni color ni
  signo. El ocre (`--aviso`) es otra cosa: lo que pide la atención del asesor, siempre con su palabra.
- **Los cortes de ancho son una lista cerrada** (MAR-12, `tests/cortesDeAncho.test.ts`). Un corte «por debajo de N» se
  escribe `max-width: (N − 0,02)px` y uno «desde N», `min-width: Npx`, para que dos hojas que hablan del mismo corte no
  discrepen en un píxel. Los cortes son 768 (ancho mínimo), 860, 900, 1.000, 1.025 (tableta: hasta 1.024 inclusive),
  1.100, 1.180, 1.240, 1.380, 1.440 (portátil por debajo, escritorio desde), 1.800 y 2.200; y de alto, 1.000. La
  prueba dice para qué sirve cada uno. Un corte nuevo se añade allí con su motivo, o se usa uno de los que hay: lo
  segundo es casi siempre lo correcto.

## Tres reglas que no están en otro sitio

- **Los PDF no pasan por estas hojas.** Viven en `src/reports/` y salen todos de la plantilla única
  (`src/reports/plantilla/`), con sus colores en `tema.ts` y sus dos letras, Fraunces y Roboto Flex, en `fuentes.ts`.
  Las letras de pantalla son otras y se sirven desde `src/assets/fuentes-de-pantalla/` (`@font-face` en `base.css`,
  licencias en `LICENCIAS.md`): IBM Plex Sans y Plex Mono, y desde la dirección A (18-11-2026) Source Serif 4 en
  seminegrita, solo latina y latina extendida.
- **Si cambias un color, cámbialo también en `src/core/theme.ts`.** Recharts no resuelve `var(--token)` en todos los
  atributos; `tests/themeTokensMirror.test.ts` falla si las dos copias se separan, y `tests/contrastePaleta.test.ts`
  mide cada par que lleva texto.
- **Lo que tu cambio deja muerto se borra en el mismo commit.** `scripts/deadCssD3.mjs` nombra las clases sin uso, los
  tokens sin uso y, al revés, las clases que una pantalla escribe sin regla en ninguna hoja. Corre dentro de
  `npm test`. Un token del sistema que aún no usa ninguna hoja pero mide una prueba va en su lista `TOKENS_RESERVADOS`,
  con su razón.
