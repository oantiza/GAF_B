import { CLASS_COLORS, UNCLASSIFIED_COLOR } from "./theme";

/**
 * El color de cada clase de activo, el mismo en toda la aplicación (14-11-2026, Óscar: «le faltan colores en general»):
 * en el aro del reparto por clase, en las barras de «En qué está invertida» y en el punto que acompaña a la clase en una
 * tabla. El color sigue a la clase, nunca al puesto que ocupa en un reparto: la renta variable es azul aunque sea la
 * tercera por peso, y lo es en todas las pantallas.
 *
 * Desde la dirección A (18-11-2026) cada clase tiene su color propio (`CLASS_COLORS`, espejo de los tokens `--clase-*`)
 * y ya no lo toma de la paleta de series por posición: la renta variable no es la cartera, ni la renta fija la
 * referencia. Pasados por el validador de `dataviz` el 18-11-2026 (distancia OKLab ×100, simulación Machado 2009, fondo
 * blanco; listones: 15 en visión normal, 8 con daltonismo, 6-8 solo con rótulo), de las 21 parejas de los siete colores
 * (las seis clases y el resto) 8 quedan bajo algún listón, ninguna grave: están entre 10,3 y 13,9 en visión normal y no
 * bajan de 7,4 con daltonismo. Por eso cada color lleva siempre su nombre al lado.
 *
 * Dos colores cambiaron ese mismo día, por decisión de Óscar (los valores, en tokens.css). El mixto pasó de un malva a
 * un violeta: el malva quedaba a 10,6 de la renta variable y a 2,6 con protanopía, y el violeta queda a 13,9 y a 8,0. Y
 * los activos reales, de una teja a un cacao: la teja quedaba a 6,4 del latón de los alternativos y a 4,0 con
 * deuteranopía, y el cacao queda a 28,0. Es oscuro a propósito: los tonos de tierra de luz media los ocupan el ocre de
 * aviso y su énfasis, y una teja más oscura, que fue la primera propuesta, quedaba a 3,3 del aviso y un punto de clase se
 * habría leído como tal. El cacao queda a 13,9 del aviso (12,5 con daltonismo) y a 22,1 del rojo de pérdida (10,8); a
 * cambio sale de la banda de luz que el validador recomienda para un reparto (0,36 frente a 0,43) y pesa más en un aro.
 * Los candidatos descartados y lo medido, en docs/frontend/SISTEMA_DISENO.md, apartado 14.
 *
 * La liquidez va en un gris frío (3,25:1) y el resto, en uno cálido y claro (2,26:1): el del resto es solo relleno de una
 * barra o una porción con su rótulo, nunca una línea ni un texto.
 *
 * Los activos reales comparten color: «Inmobiliario» (REAL_ASSET) y «Materias primas» (COMMODITIES, y REAL_ASSETS en la
 * base nueva) van los dos en cacao.
 */
const COLOR_POR_CLASE: Record<string, string> = {
  EQUITY: CLASS_COLORS.rentaVariable,
  FIXED_INCOME: CLASS_COLORS.rentaFija,
  MONEY_MARKET: CLASS_COLORS.liquidez,
  CASH: CLASS_COLORS.liquidez,
  ALTERNATIVE: CLASS_COLORS.alternativos,
  MIXED: CLASS_COLORS.mixto,
  REAL_ASSET: CLASS_COLORS.activosReales,
  REAL_ASSETS: CLASS_COLORS.activosReales,
  COMMODITIES: CLASS_COLORS.activosReales
};

/** El color de una clase por su clave (`EQUITY`, `fixed_income`, `cash`…). Lo que no es una clase con nombre, gris. */
export function colorDeLaClase(clave: string | null | undefined): string {
  if (typeof clave !== "string") return UNCLASSIFIED_COLOR;
  return COLOR_POR_CLASE[clave.trim().toUpperCase()] ?? UNCLASSIFIED_COLOR;
}

const CLAVE_POR_NOMBRE: Array<[RegExp, string]> = [
  [/^renta variable\b|^acciones\b/i, "EQUITY"],
  [/^renta fija\b|^bonos\b/i, "FIXED_INCOME"],
  [/^monetari|^liquidez\b|^efectivo\b|^tesorer/i, "MONEY_MARKET"],
  [/^alternativ/i, "ALTERNATIVE"],
  [/^mixt/i, "MIXED"],
  [/^inmobiliari|^materias primas\b|^activos reales\b|^oro\b/i, "COMMODITIES"]
];

/**
 * El color de una clase por su nombre en pantalla («Renta variable», «Liquidez»…), para quien solo tiene el rótulo.
 * Quien tenga la clave, que use `colorDeLaClase`: un rótulo puede cambiar; la clave, no.
 */
export function colorDeLaClasePorNombre(nombre: string | null | undefined): string {
  if (typeof nombre !== "string") return UNCLASSIFIED_COLOR;
  const clave = CLAVE_POR_NOMBRE.find(([patron]) => patron.test(nombre.trim()))?.[1];
  return colorDeLaClase(clave);
}
