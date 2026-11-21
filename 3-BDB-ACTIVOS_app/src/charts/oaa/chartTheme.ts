import { CATEGORICAL_SERIES, CHART_PALETTE, CHART_REFERENCE_COLOR, OAA_COLORS, OAA_TYPOGRAPHY, UNCLASSIFIED_COLOR } from "../../core/theme";

export const OAA_CHART_COLORS = {
  ...OAA_COLORS,
  grid: OAA_COLORS.chartGrid,
  axis: OAA_COLORS.chartAxis,
  zero: OAA_COLORS.chartZero,
  crosshair: OAA_COLORS.chartCrosshair,
  tooltipBorder: OAA_COLORS.borderStrong,
  /* Con el canal de la tinta (28, 26, 23), como las sombras de tokens.css. */
  tooltipShadow: "0 8px 24px rgba(28, 26, 23, 0.10), 0 1px 3px rgba(28, 26, 23, 0.06)"
} as const;

const OAA_CHART_FONT = OAA_TYPOGRAPHY.sans;

/**
 * Ejes: sin marcas de tick, sin línea de eje Y, etiquetas en 12 px (`--texto-xxs`: ningún texto de un gráfico va más
 * pequeño) con cifras tabulares. Tipografía de interfaz — la monoespaciada se reserva a códigos.
 */
export const OAA_AXIS_STYLE = {
  fill: OAA_COLORS.textSecondary,
  fontFamily: OAA_CHART_FONT,
  fontSize: 12
} as const;

/**
 * Grosor de trazo: 2,25 px la línea principal (la cartera), 1,5 px las demás, 1,25 px la referencia y 1 px el contexto.
 * Desde la dirección A (18-11-2026) la cartera va un punto más firme y la referencia, que es gris y a trazos, algo más
 * fina, para que no ensucie la línea marina cuando van pegadas.
 */
export const OAA_STROKE = {
  lead: 2.25,
  compare: 1.5,
  reference: 1.25,
  context: 1
} as const;

/* ---------------------------------------------------------------- el papel de una serie */

/**
 * El papel que hace una serie en un gráfico, y de él sale su color (apartado 7 de `docs/frontend/SISTEMA_DISENO.md`):
 *
 * - `"cartera"`: la propuesta, la cartera del cliente o el activo principal de la ficha. `--serie-1`, marino, siempre;
 *   continuo y de 2,25 px. En un gráfico de líneas lleva debajo un relleno muy suave de su color (OaaLineChart).
 * - `"referencia"`: el índice o la cartera con que se compara, el dinero aportado, la asignación estratégica.
 *   `--serie-referencia`, un gris cálido propio, siempre; a trazos y de 1,25 px. Desde la dirección A (18-11-2026) no es
 *   un puesto de la paleta de series: hasta entonces era la segunda, en tostado.
 * - `"serie"`: las demás, en el orden en que llegan: `--serie-2` a `--serie-6` (azul, verde salvia, latón, violeta, cacao),
 *   sin reciclar. Un segundo activo junto a la cartera va, pues, en el azul. Una sexta usa el marino si el gráfico no
 *   tiene cartera y, si la tiene, un gris continuo.
 *
 * El RESTO de un reparto («Otros», «No declarado», «Sin clasificar», lo que no entra) no es una serie: va en el gris
 * claro de `--clase-resto` (`COLOR_DEL_RESTO`). Tampoco es el contexto de un gráfico (la curva de la frontera, los
 * activos sueltos de un mapa), que va en tinta apagada.
 *
 * La paleta de la dirección A se pasó por el validador de `dataviz` el 18-11-2026: tres de las quince parejas de series
 * quedan bajo algún listón (lo medido, pareja a pareja, en tokens.css §5), y por eso cada serie lleva su nombre al lado.
 *
 * El verde de la paleta no es el del signo. Verde y rojo del signo (`--sube`, `--baja`) los lleva solo una marca que ES
 * un resultado (una barra de contribución, una casilla de rentabilidad mensual, la caída de una sola serie), nunca una
 * serie.
 */
export type PapelDeSerie = "cartera" | "referencia" | "serie";

/** Lo que una pieza de gráfico sabe de una serie para decidir su estilo. */
export interface SerieConPapel {
  papel?: PapelDeSerie;
  /**
   * EN RETIRADA: el color pasado a mano. Se acepta para no romper a quien lo pasa, pero el papel manda sobre él y no se
   * pinta nunca. Solo se mira para una cosa: un gris (`--clase-resto`, `--serie-referencia`, `--borde-control`) sin
   * papel declarado se entiende como `"referencia"`, que es lo que quería decir quien lo pasó cuando la referencia era
   * gris; y se pinta como la referencia de hoy, a trazos (`grisPideReferencia`).
   */
  color?: string;
  /**
   * El puesto de una `"serie"` entre las suyas, contando desde cero: decide cuál de los colores `--serie-2` a `--serie-6`
   * lleva. Sin él, el orden de llegada. Lo declara quien pinta la misma serie en varios bloques y a veces no la dibuja
   * en alguno: el color sigue a la serie y no a cuántas se han dibujado (en el Comparador, el tercer activo era rosa en
   * su ficha y cian en el gráfico cuando el segundo no tenía serie).
   */
  puesto?: number;
}

export interface EstiloDeSerie {
  papel: PapelDeSerie;
  color: string;
  grosor: number;
  /** El `strokeDasharray` de la referencia; las demás, continuas. */
  trazos?: string;
}

/** La cartera: marino, `--serie-1`. */
export const COLOR_DE_LA_CARTERA = CHART_PALETTE[0];
/** La referencia: gris cálido, `--serie-referencia`, siempre a trazos (`TRAZOS_DE_LA_REFERENCIA`). */
export const COLOR_DE_LA_REFERENCIA = CHART_REFERENCE_COLOR;
/** El resto de un reparto («Otros», «No declarado», «Sin clasificar», lo que no entra): el gris claro de `--clase-resto`. */
export const COLOR_DEL_RESTO = UNCLASSIFIED_COLOR;
/**
 * Una serie que ya no tiene color propio (de la sexta «demás» en adelante): continua y en el gris del cursor y los puntos
 * de contexto (3,52:1). No en el del resto, que es un relleno de 2,26:1 y como línea casi no se vería.
 */
export const COLOR_DE_LA_SERIE_SIN_COLOR = OAA_COLORS.textMuted;
/** Las demás series: `--serie-2` a `--serie-6` (azul, verde salvia, latón, violeta, cacao), en orden. */
export const SERIES_EN_ORDEN: readonly string[] = CHART_PALETTE.slice(1, 6);
export const TRAZOS_DE_LA_REFERENCIA = "5 4";
/** El contexto de un gráfico (la curva de la frontera, los activos sueltos de un mapa): tinta apagada, no una serie. */
export const COLOR_DEL_CONTEXTO = OAA_COLORS.textTertiary;
/** El gris de los puntos de contexto (activos sueltos de un mapa): el de `--chart-reference`, 3,52:1. */
export const COLOR_DEL_PUNTO_DE_CONTEXTO = OAA_COLORS.textMuted;

/**
 * Los grises que alguien puede pasar a mano: el del resto, el de la referencia, el de los puntos de contexto
 * (`--chart-reference`) y el del borde de control, en literal o en `var()`, sin distinguir mayúsculas. Un gris a mano
 * dice dos cosas distintas según dónde llegue, y cada una tiene su función.
 */
const GRISES_A_MANO = new Set(
  [
    COLOR_DEL_RESTO,
    COLOR_DE_LA_REFERENCIA,
    OAA_COLORS.textMuted,
    "var(--clase-resto)",
    "var(--serie-referencia)",
    "var(--borde-control)",
    "var(--chart-reference)"
  ].map((color) => color.toLowerCase())
);

function esGrisAMano(color: string | undefined): boolean {
  return typeof color === "string" && GRISES_A_MANO.has(color.trim().toLowerCase());
}

/**
 * En una serie sin papel declarado, un gris a mano pide ser la referencia: era el color de la referencia hasta el
 * 14-11-2026, y quien lo pasaba quería decir eso. Se pinta como la referencia de hoy, a trazos.
 */
export function grisPideReferencia(color: string | undefined): boolean {
  return esGrisAMano(color);
}

/** En un reparto, un gris a mano marca un resto («Otros», «No declarado»…), y se pinta en gris. */
export function grisMarcaResto(color: string | undefined): boolean {
  return esGrisAMano(color);
}

/**
 * El papel de cada serie. Si ninguna lo declara, la primera es la cartera y el resto, series en orden, como antes; una
 * serie sin papel cuyo color a mano es un gris, referencia (`grisPideReferencia`). Si alguna lo declara, las que no lo
 * declaran son series.
 */
export function papelesDe(series: readonly SerieConPapel[]): PapelDeSerie[] {
  const algunaLoDeclara = series.some((serie) => serie.papel);
  return series.map((serie, indice) => {
    if (serie.papel) return serie.papel;
    if (grisPideReferencia(serie.color)) return "referencia";
    return !algunaLoDeclara && indice === 0 ? "cartera" : "serie";
  });
}

/**
 * El color de la serie «demás» que hace `orden` (desde cero): azul, verde salvia, latón, violeta y cacao. La sexta, en un
 * gráfico que no tiene cartera, lleva el marino, que ahí está libre: un activo de verdad no se pinta en gris. Con
 * cartera en el gráfico, o de la séptima en adelante, gris continuo (`COLOR_DE_LA_SERIE_SIN_COLOR`). Las cinco primeras
 * no dependen de lo que haya alrededor: el color sigue a la serie de un bloque a otro (el Comparador de activos, con sus
 * cinco activos como mucho, los pinta siempre con ellas).
 */
export function colorDeLaSerie(orden: number, hayCartera = true): string {
  if (orden === SERIES_EN_ORDEN.length && !hayCartera) return COLOR_DE_LA_CARTERA;
  return SERIES_EN_ORDEN[orden] ?? COLOR_DE_LA_SERIE_SIN_COLOR;
}

/** El color, el grosor y el trazo de cada serie, por su papel: el único sitio que lo decide. */
export function estilosPorPapel(series: readonly SerieConPapel[]): EstiloDeSerie[] {
  let orden = 0;
  const papeles = papelesDe(series);
  const hayCartera = papeles.includes("cartera");
  return papeles.map((papel, indice) => {
    if (papel === "cartera") return { papel, color: COLOR_DE_LA_CARTERA, grosor: OAA_STROKE.lead };
    if (papel === "referencia") return { papel, color: COLOR_DE_LA_REFERENCIA, grosor: OAA_STROKE.reference, trazos: TRAZOS_DE_LA_REFERENCIA };
    const puesto = series[indice].puesto;
    const color = colorDeLaSerie(typeof puesto === "number" && puesto >= 0 ? puesto : orden, hayCartera);
    orden += 1;
    return { papel, color, grosor: OAA_STROKE.compare };
  });
}

/* ---------------------------------------------------------------- repartos */

/** Un reparto (aro, barras) pinta como mucho seis categorías con color; de ahí en adelante, «Otros» en gris. */
export const CATEGORIAS_CON_COLOR = 6;
export const ROTULO_OTROS = "Otros";

const ROTULOS_DE_RESTO = /^(otros|otras|resto|no declarado|sin clasificar|sin asignar|sin situar)\b/i;

/** «Otros», «Resto», «No declarado»: lo que no es una categoría con nombre propio, y se pinta en gris. */
export function esResto(rotulo: string, color?: string): boolean {
  return ROTULOS_DE_RESTO.test(rotulo.trim()) || grisMarcaResto(color);
}

/**
 * Agrupa un reparto para que ningún color se recicle: si hay más de seis categorías con nombre, las cinco primeras
 * conservan el suyo y de la sexta en adelante se suman en «Otros» (en el «Otros» que ya hubiera, si lo hay). Las
 * categorías de resto («No declarado»…) siguen aparte, al final y en gris. No reordena ni recalcula nada más: suma.
 */
export function repartoConOtros<T extends { key: string; label: string; color?: string }>(
  filas: readonly T[],
  sumar: (grupo: readonly T[], otros: { key: string; label: string }) => T
): Array<T & { resto: boolean }> {
  const conNombre = filas.filter((fila) => !esResto(fila.label, fila.color));
  const restos = filas.filter((fila) => esResto(fila.label, fila.color));
  if (conNombre.length <= CATEGORIAS_CON_COLOR) {
    return [...conNombre.map((fila) => ({ ...fila, resto: false })), ...restos.map((fila) => ({ ...fila, resto: true }))];
  }
  const quedan = conNombre.slice(0, CATEGORIAS_CON_COLOR - 1);
  const sobran = conNombre.slice(CATEGORIAS_CON_COLOR - 1);
  const otrosDeAntes = restos.find((fila) => /^(otros|otras)\b/i.test(fila.label.trim()));
  const otros = sumar(otrosDeAntes ? [otrosDeAntes, ...sobran] : sobran, {
    key: otrosDeAntes?.key ?? "otros",
    label: otrosDeAntes?.label ?? ROTULO_OTROS
  });
  return [
    ...quedan.map((fila) => ({ ...fila, resto: false })),
    { ...otros, resto: true },
    ...restos.filter((fila) => fila !== otrosDeAntes).map((fila) => ({ ...fila, resto: true }))
  ];
}

/**
 * El color de cada categoría de un reparto ya agrupado. El resto, gris (`COLOR_DEL_RESTO`). Una categoría con nombre
 * propio que trae `colorDeCategoria` (el color fijo de su clase de activo, `colorDeLaClase`), ese. Las demás, por su
 * orden entre las que no lo traen, con `CATEGORICAL_SERIES` y sin repetir un color que ya lleve una categoría fija; si se
 * acaba, gris. Sin ningún color fijo: azul, verde salvia, latón, violeta, cacao y marino.
 */
export function coloresDelReparto(filas: ReadonlyArray<{ resto: boolean; colorDeCategoria?: string }>): string[] {
  const fijos = new Set(filas.flatMap((fila) => (!fila.resto && fila.colorDeCategoria ? [fila.colorDeCategoria.toLowerCase()] : [])));
  const libres = CATEGORICAL_SERIES.filter((color) => !fijos.has(color.toLowerCase()));
  let orden = 0;
  return filas.map((fila) => {
    if (fila.resto) return COLOR_DEL_RESTO;
    if (fila.colorDeCategoria) return fila.colorDeCategoria;
    const color = libres[orden] ?? COLOR_DEL_RESTO;
    orden += 1;
    return color;
  });
}

/**
 * Un color de la paleta (`#RRGGBB` de theme.ts) con opacidad, para fondos
 * tintados de SVG. Evita reescribir a mano `rgba(…)` con los canales de una
 * paleta que ya no existe (los literales v2 de acero y cobre, 14-10-2026).
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Las siete clases de las matrices (correlación y solapamiento) sobre la rampa
 * secuencial de 8 pasos (SEQUENTIAL_RAMP).
 *
 * Auditoría 16-10: los dos mapas de calor y el PDF copiaban a mano la misma
 * cascada de umbrales, que devolvía 0, 1, 2, 3, 5, 6 y 7 sin decir que el paso
 * 4 se saltaba (entonces #6A96BA; hoy #A39C8D). Ahora es explícito y está en un
 * solo sitio: el 4 se salta a propósito en las siete clases de las matrices
 * (tokens.css §5), y la cifra impresa cambia a tinta de papel desde el paso 5
 * (ver inkOnSequentialStep).
 */
export const SEQUENTIAL_CLASS_STEPS = [0, 1, 2, 3, 5, 6, 7] as const;

/** Umbrales inferiores de las clases 1-6 (la 0 es todo lo que queda por debajo). */
export type SequentialThresholds = readonly [number, number, number, number, number, number];

/**
 * Paso de SEQUENTIAL_RAMP para un valor, o -1 si no hay dato. `thresholds` son
 * los límites inferiores, ascendentes, de las clases 1 a 6; cada uno es
 * inclusivo salvo el primero si `exclusiveFirst` (el solapamiento: 0 % es la
 * clase 0 y cualquier valor positivo, la 1).
 */
export function sequentialStep(
  value: number | null | undefined,
  thresholds: SequentialThresholds,
  options: { exclusiveFirst?: boolean } = {}
): number {
  if (value == null || !Number.isFinite(value)) return -1;
  let sequentialClass = 0;
  thresholds.forEach((limit, index) => {
    const reached = index === 0 && options.exclusiveFirst ? value > limit : value >= limit;
    if (reached) sequentialClass = index + 1;
  });
  return SEQUENTIAL_CLASS_STEPS[sequentialClass];
}

/** Correlación (−1 a 1): baja por debajo de 0,1; idéntica desde 0,999. */
export const CORRELATION_THRESHOLDS: SequentialThresholds = [0.1, 0.25, 0.45, 0.65, 0.85, 0.999];
/** Solapamiento: nada visto en 0; lo más alto desde el 99 %, también lo que pasa de 100 con derivados. */
export const OVERLAP_THRESHOLDS: SequentialThresholds = [0, 20, 40, 60, 80, 99];

/**
 * Tinta legible sobre un paso de la rampa secuencial (`--rampa-0..7`), del marfil al marino.
 *
 * El corte está en el paso 5 y no es una preferencia: la rampa se construyó
 * (03-11-2026) dejando un HUECO de luminancia entre el 4 y el 5, porque entre
 * 0,178 y 0,232 no hay sitio —ni la tinta ni el papel alcanzan 4,5:1—. La
 * anterior caía justo ahí en dos pasos: 4,07:1 con tinta y 4,17:1 con papel.
 * Con la rampa de la dirección A (18-11-2026): del 0 al 4, tinta (6,36:1 en el peor); del 5 al 7, papel (6,46:1 en el
 * peor). El paso 7 es el marino del marco: 16,75:1.
 */
export function inkOnSequentialStep(step: number): string {
  return step >= 5 ? OAA_COLORS.surface : OAA_COLORS.text;
}

/** Si la cifra impresa sobre un paso de la rampa va en tinta de papel (desde el paso 5). */
export function tintaClaraSobre(step: number): boolean {
  return step >= 5;
}

export interface ClaseDeLaRampa {
  /** El paso de SEQUENTIAL_RAMP que pinta la clase. */
  paso: number;
  rotulo: string;
}

/**
 * Las siete clases de una matriz, con sus límites de verdad, para su leyenda (ANA-24): las mismas que decide
 * `sequentialStep` con los mismos umbrales, escritas con `escribir`. Con `exclusiveFirst`, la clase 0 es el valor del
 * primer umbral, exacto («0 %»), y la 1 empieza justo por encima.
 */
export function clasesDeLaRampa(
  thresholds: SequentialThresholds,
  escribir: (valor: number) => string,
  options: { exclusiveFirst?: boolean } = {}
): ClaseDeLaRampa[] {
  const limites = [...thresholds];
  return SEQUENTIAL_CLASS_STEPS.map((paso, clase) => {
    if (clase === 0) {
      return { paso, rotulo: options.exclusiveFirst ? escribir(limites[0]) : `Menos de ${escribir(limites[0])}` };
    }
    if (clase === limites.length) return { paso, rotulo: `Desde ${escribir(limites[clase - 1])}` };
    const hasta = escribir(limites[clase]);
    return clase === 1 && options.exclusiveFirst
      ? { paso, rotulo: `Más de ${escribir(limites[0])} y menos de ${hasta}` }
      : { paso, rotulo: `De ${escribir(limites[clase - 1])} a menos de ${hasta}` };
  });
}
