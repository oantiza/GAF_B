/**
 * Espejo en TypeScript de `src/styles/tokens.css`.
 *
 * Recharts pinta en SVG y no resuelve `var(--token)` en todos los atributos,
 * así que las series y los ejes necesitan valores literales. Esta es la ÚNICA
 * copia autorizada: cualquier cambio de color se hace aquí y en tokens.css a la vez.
 * `tests/themeTokensMirror.test.ts` comprueba que ambos lados siguen iguales.
 */

/**
 * Paleta de series (espejo de `--serie-1..6`, tokens.css §5), la de la dirección A (18-11-2026). Todas las entradas
 * superan 3:1 sobre el papel (umbral WCAG para elementos gráficos). Sin carmesí: se leería como pérdida. Pasada por el
 * validador de `dataviz` el 18-11-2026; lo medido, pareja a pareja, está en tokens.css §5, y cada serie lleva siempre su
 * nombre al lado.
 *
 * EL COLOR LO DECIDE EL PAPEL DE LA SERIE, no su posición, y se decide en un solo
 * sitio: `estilosPorPapel` en `src/charts/oaa/chartTheme.ts`. La 1 es la cartera, en
 * marino, siempre; de la 2 a la 6, las demás series en el orden en que llegan, sin
 * reciclar. La referencia NO está en esta lista: tiene su color propio,
 * `CHART_REFERENCE_COLOR`, siempre a trazos. Hasta la dirección A era la segunda de la
 * paleta, y un segundo activo empezaba en la tercera.
 *
 * En un reparto sin papeles (un aro, unas barras de identidad), las categorías con nombre
 * siguen `CATEGORICAL_SERIES` (`coloresDelReparto`), salvo las que traen el color fijo de
 * su clase de activo (`colorDeLaClase`).
 */
export const CHART_PALETTE = [
  "#0F1E33", // 1 · marino        — la cartera     (--serie-1)
  "#2F5D8A", // 2 · azul          — primera serie  (--serie-2)
  "#4E7D6A", // 3 · verde salvia                   (--serie-3)
  "#A8824A", // 4 · latón                          (--serie-4)
  "#8365B3", // 5 · violeta                        (--serie-5)
  "#553230" //  6 · cacao                          (--serie-6)
];

/** La referencia (el índice, la cartera con que se compara, el dinero aportado): gris cálido, a trazos, 4,44:1. Espejo de `--serie-referencia`. */
export const CHART_REFERENCE_COLOR = "#7D776C";

/**
 * El color de cada clase de activo (espejo de `--clase-*`, tokens.css §5). Es de la clase, no de un puesto de la
 * paleta de series: lo reparte `colorDeLaClase` (core/coloresDeClase.ts). Cada token, su entrada:
 * `--clase-renta-variable`, `--clase-renta-fija`, `--clase-liquidez`, `--clase-alternativos`, `--clase-mixto`,
 * `--clase-activos-reales` y `--clase-resto`.
 */
export const CLASS_COLORS = {
  rentaVariable: "#2F5D8A",
  rentaFija: "#4E7D6A",
  /* Monetario y liquidez: un gris frío (3,25:1), distinto del gris cálido del resto. */
  liquidez: "#8A8F98",
  alternativos: "#A8824A",
  mixto: "#8365B3",
  /* Inmobiliario y materias primas. */
  activosReales: "#553230",
  /* «Otros», «sin clasificar», lo que no entra: 2,26:1, solo relleno con su nombre al lado. */
  resto: "#B3AC9E"
} as const;

export const OAA_COLORS = {
  /* Superficies y líneas */
  background: "#FFFFFF" /* espejo de --papel */,
  rail: "#0F1E33" /* --marco */,
  surface: "#FFFFFF",
  surfaceMuted: "#F7F4EC" /* --banda */,
  border: "#E4DDCF" /* --filete */,
  borderStrong: "#D9D2C3" /* --filete-fuerte */,

  /* Tinta */
  text: "#1C1A17",
  textSecondary: "#57524A",
  /* Espejo de --tinta-3 (5,70:1): rótulos y notas. Es el tono más claro
     admitido para TEXTO. */
  textTertiary: "#6B665D",
  /* Espejo de --chart-reference. 3,52:1 sobre el papel: solo trazos, líneas de
     referencia y decoración. Nunca texto (no llega a 4,5:1); para texto,
     `textTertiary`. */
  textMuted: "#8F887A",

  /* Marca — el marino; `spruceHover` es el azul de enlace y de foco. El azul claro de --brand-50 (`steel`) se retiró
     con el menú marino de la dirección A: era el marcador del menú, y ahora lo es el latón claro. */
  spruce: "#0F1E33" /* --marca */,
  spruceHover: "#1F4470" /* --marca-fuerte */,

  /* Signo y atención: verde si gana, rojo si pierde (y el error); ocre, el aviso. */
  sube: "#0A7A53",
  baja: "#C2261B",
  aviso: "#8A4B14",
  /* El latón (--laton, y --ochre-50 que lo nombra como marca de serie, 3,53:1): solo trazo o marca en un gráfico.
     Nunca texto, y nunca aviso: el aviso va en --aviso y con su palabra. */
  gold: "#A8824A",

  /* Dataviz — las series salen de CHART_PALETTE, sin literales repetidos */
  slate: CLASS_COLORS.resto,
  series3: CHART_PALETTE[2],
  series4: CHART_PALETTE[3],
  series5: CHART_PALETTE[4],
  chartGrid: "#ECE7DB",
  /* Espejo de --chart-axis: el eje, un punto más oscuro que el filete fuerte. */
  chartAxis: "#CFC7B6",
  /* Espejo de --chart-zero: la línea de base (el 100, el cero), 2,73:1, solo decoración. */
  chartZero: "#A39C8D",
  /* --chart-crosshair es --chart-reference. */
  chartCrosshair: "#8F887A",
  /* Espejo de --chart-cursor-fill: banda del cursor de un tooltip de barras (la marca al 6 %). */
  chartCursorFill: "rgba(15, 30, 51, 0.06)"
} as const;

export const OAA_TYPOGRAPHY = {
  /* Una sola voz en los gráficos: `serif` apunta a la misma sans para que
     ningún consumidor tenga que cambiar de contrato. La serifa de la dirección A
     (--fuente-serifa) es solo de lo que titula o contesta una pantalla (el título
     de pantalla, la cifra de un indicador o de la respuesta, el título del acceso,
     el nombre de la casa en el menú), no de un gráfico. */
  serif: '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  sans: '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  baseScale: "100%"
} as const;

/** Máximo de series simultáneas antes de agregar en «Otros». */
export const CHART_MAX_SERIES = 6;

/**
 * Secuencia para un reparto SIN clases (los sectores de la renta variable, unos productos): empieza por el azul y deja el
 * marino de la cartera para el final, de modo que dos vecinos del aro no se parecen y ninguno cae en un gris (el gris
 * frío es la liquidez; el cálido, el resto). Seis: CHART_MAX_SERIES - 1 porciones con nombre, y la siguiente para el
 * resto agregado. La usa `coloresDelReparto` (chartTheme.ts).
 */
export const CATEGORICAL_SERIES = [
  CHART_PALETTE[1], // azul
  CHART_PALETTE[2], // verde salvia
  CHART_PALETTE[3], // latón
  CHART_PALETTE[4], // violeta
  CHART_PALETTE[5], // cacao
  CHART_PALETTE[0] // marino
];

/** «Sin clasificar» (ausencia de dato) y «Otros»: el gris del resto (`--clase-resto`, `COLOR_DEL_RESTO`). */
export const UNCLASSIFIED_COLOR = CLASS_COLORS.resto;

/**
 * Rampa secuencial, espejo de `--rampa-0..7`: claro = poco, oscuro = mucho. De un marfil apenas tostado al marino del
 * marco, pasando por la piedra. Las matrices se saltan el paso 4 y cambian a tinta de papel desde el 5 (chartTheme.ts).
 */
export const SEQUENTIAL_RAMP = [
  "#F3EEE4",
  "#E8E2D8",
  "#D4CFC3",
  "#BEB8AA",
  "#A39C8D",
  "#5A5F63",
  "#464D57",
  "#0F1E33"
];
