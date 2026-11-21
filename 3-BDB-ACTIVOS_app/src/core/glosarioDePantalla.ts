import { fecha as escribirFecha } from "./formato";
import { COVERAGE_LABELS, METRIC_KEY_LABELS, QUALITY_FLAG_LABELS, WARNING_CODE_LABELS, readableBackendLabel } from "./labels";

/**
 * El glosario de la pantalla: una palabra por concepto (decisión 28 de Óscar, 04-11-2026).
 *
 * | Concepto | En pantalla | Lo que deja de decirse |
 * |---|---|---|
 * | La rentabilidad media anual de un periodo | Rentabilidad anualizada | CAGR, salvo en una nota de método |
 * | La peor caída desde máximos | Caída máxima | Máx. caída, Máxima caída |
 * | El gasto anual de un producto | Coste corriente | TER, Gastos corrientes |
 * | Lo que paga un fondo al comprar y vender | Costes de operación | Costes de transacción |
 * | El índice del fondo | Índice de referencia | Benchmark oficial |
 * | Conservador, Equilibrado, Agresivo… | Cartera de referencia | Benchmark, Perfil de referencia |
 * | El del cliente | Perfil de riesgo | |
 * | Fondo, ETF, Acción | Producto | Vehículo, Tipo de instrumento |
 * | Renta variable, Renta fija… | Clase de activo | Clase económica |
 * | Lo que se mide o se elige | Activo | Instrumento |
 * | Qué campos tenemos de un activo | Datos disponibles | Cobertura |
 * | Qué parte de la cartera mide una cifra | Peso medido, parte medida | Cobertura, parte cubierta |
 * | De qué parte de la cartera se sabe el coste | Costes conocidos | Cobertura |
 *
 * «Cobertura» se queda solo para lo que de verdad lo es: la de divisa.
 *
 * **Este fichero existe porque el papel no cambia en esta tanda.** `core/labels`, `core/portfolio`,
 * `core/portfolioConstraints`, `core/portfolioImprovement` y `core/portfolioComparison` escriben textos que
 * también imprimen los PDF, y lo que firma el asesor no se mueve de rebote. Lo que esos módulos escriben se
 * deja como está y se traduce aquí, a la salida de la pantalla. Durante un tiempo pantalla y papel no dirán
 * igual, y Óscar lo sabe. El día que el papel tenga su rediseño, esto se borra.
 */

export const ETIQUETAS_DE_METRICA: Record<string, string> = {
  ...METRIC_KEY_LABELS,
  annualized_return_3y: "Rentabilidad anualizada 3 años",
  annualized_return_5y: "Rentabilidad anualizada 5 años",
  volatility_3y: "Volatilidad 3 años",
  volatility_1y: "Volatilidad 1 año",
  sharpe_3y: "Sharpe 3 años",
  max_drawdown_5y: "Caída máxima 5 años",
  max_drawdown_hist: "Caída máxima histórica",
  ytd_return: "Rentabilidad en lo que va de año",
  ter: "Coste corriente"
};

export const ETIQUETAS_DE_DATOS: Record<string, string> = {
  ...COVERAGE_LABELS,
  COMPLETE: "Datos completos",
  PARTIAL: "Datos parciales"
};

export const ETIQUETAS_DE_CALIDAD: Record<string, string> = {
  ...QUALITY_FLAG_LABELS,
  PARTIAL_COVERAGE: "Datos parciales",
  UNSUPPORTED_INSTRUMENT_TYPE: "Producto no admitido"
};

export const ETIQUETAS_DE_AVISO: Record<string, string> = {
  ...WARNING_CODE_LABELS,
  PARTIAL_COVERAGE: "Datos parciales",
  ASSET_NOT_IN_MASTER: "Activo fuera del catálogo",
  PRICE_SERIES_MISSING: "Sin serie de precios",
  PRICE_COVERAGE_NOT_CHECKED: "Precios sin comprobar"
};

/** Lo que el papel dice en estas cadenas, y lo que dice la pantalla. El orden importa: primero lo más concreto. */
const SUSTITUCIONES: ReadonlyArray<readonly [RegExp, string]> = [
  /* Índices y activos no invertibles. */
  [/ es benchmark\/no invertible y no contribuye a métricas ni allocation invertible\./g, " es un índice o no es invertible, y no entra en las métricas ni en el reparto."],
  [/ es INDEX\/benchmark y no puede optimizarse como posición invertible\./g, " es un índice y no se puede optimizar como posición invertible."],
  [/ no es invertible según el contrato local\./g, " no es invertible."],
  [/ no existe en la fuente de datos activa\./g, " no está en el catálogo."],
  [/\bAlta de benchmark\/serie comparativa\b/g, "Alta del índice de referencia"],
  [/\bAlta de raiz en la maestra y carga de price_series EUR\./g, "Alta en el catálogo y carga de su serie de precios en euros."],

  /* De dónde sale un dato: es cocina. */
  [/\ben la fuente (?:de datos )?(?:activa|local)\b/g, "en el catálogo"],
  [/\bActivo no incluido en la base maestra\b/g, "Activo fuera del catálogo"],
  [/\bSin serie de precios en la maestra\b/g, "Sin serie de precios"],
  [/\bRevisar cobertura de precios en la maestra\b/g, "Revisar los precios en el catálogo"],
  [/\ben la maestra\b/g, "en el catálogo"],
  [/\bBackend anterior\b/g, "Versión anterior del servidor"],

  /* El glosario. «Cobertura de divisa» no entra: esa sí lo es. */
  [/\bCobertura parcial\b/g, "Datos parciales"],
  [/\bCobertura completa\b/g, "Datos completos"],
  [/\bCobertura de precios sin comprobar\b/g, "Precios sin comprobar"],
  [/\bdel peso representado\b/g, "de peso medido"],
  [/\bMáxima caída\b/g, "Caída máxima"],
  [/\bmáxima caída\b/g, "caída máxima"],
  [/\bMáx\. caída\b/g, "Caída máxima"],
  [/\bmáx\. caída\b/g, "caída máxima"],
  [/\bLa tasa sin riesgo utiliza cobertura parcial o una tasa de respaldo\b/g, "El tipo sin riesgo solo se conoce en parte de la ventana o es uno de respaldo"],
  [/\buna tasa sin riesgo\b/g, "un tipo sin riesgo"],
  [/\bLa tasa libre de riesgo\b/g, "El tipo sin riesgo"],
  [/\bLa tasa sin riesgo\b/g, "El tipo sin riesgo"],
  [/\btasa libre de riesgo\b/g, "tipo sin riesgo"],
  [/\btasa sin riesgo\b/g, "tipo sin riesgo"],
  [/\bVehículo\b/g, "Producto"],
  [/\bvehículo\b/g, "producto"],
  [/\bTipo de instrumento\b/g, "Producto"],
  /* Una media por peso se llama «media»; el servidor escribe «ponderado» en el rótulo de esta comprobación. */
  [/\bCoste corriente ponderado\b/g, "Coste corriente medio"],
  [/\bcoste corriente ponderado\b/g, "coste corriente medio"],

  /* Concordancia de lo que el papel escribe con un número delante. */
  [/\b1 posiciones invertibles\b/g, "1 posición invertible"],
  [/\b1 posiciones\b/g, "1 posición"],

  /* Ortografía de lo que el papel imprime sin tilde. */
  [/\bMetricas\b/g, "Métricas"],
  [/\blimites\b/g, "límites"],
  [/\bminimos\b/g, "mínimos"],
  [/\bmaximos\b/g, "máximos"],
  [/\bestan\b/g, "están"],
  [/\bsharpe\b/g, "Sharpe"],
  [/\bpor debajo de 100\b/g, "por debajo del 100"],
  [/\bsupera 100\b/g, "supera el 100"],
  /* Con un espacio que no parte la línea, como `cifrasEnPantalla` y como el `%` de `Intl` (MAR-26). */
  [/(\d)%/g, "$1 %"]
];

const FECHA_ISO = /\b\d{4}-\d{2}-\d{2}\b/g;

/**
 * Un texto de un módulo compartido con el papel, en palabras de la pantalla. Lo que no conoce lo deja igual: un
 * aviso del servidor con otra forma se lee tal cual, y no pasa nada.
 */
export function textoEnPantalla(texto: string): string {
  const traducido = SUSTITUCIONES.reduce((actual, [patron, cambio]) => actual.replace(patron, cambio), texto);
  return traducido.replace(FECHA_ISO, (fecha) => escribirFecha(fecha) ?? fecha);
}

/**
 * Las cifras de un texto que llega tal cual del servidor, como las escribe la pantalla: coma decimal, signo menos
 * tipográfico y espacio antes de «%» y de «pp». El servidor no se toca: esto es solo cómo se enseña.
 */
export function cifrasEnPantalla(texto: string): string {
  return texto
    .replace(/(^|[\s(])-(?=\d)/g, "$1\u2212")
    .replace(/\d+(?:[.,]\d+)*/g, cifraALaEspanola)
    .replace(/(\d)\s?(%|pp\b)/g, "$1\u00a0$2");
}

/**
 * Una cifra del texto, a la espa\u00f1ola, sin tomar un punto de millar por decimal (FMT-02): \u00ab1.500 \u20ac\u00bb se convert\u00eda en
 * \u00ab1,500 \u20ac\u00bb, que se lee uno y medio.
 *
 * - Varios puntos (\u00ab1.234.567\u00bb, \u00ab2.3.1\u00bb, \u00ab13.11.2026\u00bb): millares, una versi\u00f3n o una fecha. Se queda.
 * - Un punto con tres cifras detr\u00e1s y de una a tres delante que no empiezan por cero (\u00ab1.500\u00bb): millar. Se queda,
 *   salvo que vaya con \u00ab%\u00bb o \u00abpp\u00bb, que es un decimal (\u00ab1.375 %\u00bb).
 * - Cualquier otro punto solo: decimal. \u00ab12.5\u00bb pasa a \u00ab12,5\u00bb.
 * - A la inglesa con millares (\u00ab1,234.5\u00bb): las comas son millares y el punto el decimal: \u00ab1.234,5\u00bb.
 * - Con coma y sin esa forma (\u00ab1.234,5\u00bb, \u00ab1,5\u00bb): ya est\u00e1 en espa\u00f1ol, o no se sabe. Se queda.
 */
function cifraALaEspanola(cifra: string, posicion: number, texto: string): string {
  const puntos = cifra.split(".").length - 1;
  if (puntos !== 1) return cifra;
  if (cifra.includes(",")) {
    if (!/^\d{1,3}(?:,\d{3})+\.\d+$/.test(cifra)) return cifra;
    const [entero, decimales] = cifra.split(".");
    return `${entero.replace(/,/g, ".")},${decimales}`;
  }
  const [entero, decimales] = cifra.split(".");
  const esDeUnPorcentaje = /^\s?(?:%|pp\b)/.test(texto.slice(posicion + cifra.length));
  if (decimales.length === 3 && entero.length <= 3 && !entero.startsWith("0") && !esDeUnPorcentaje) return cifra;
  return `${entero},${decimales}`;
}

/** Un código de calidad, de aviso o de disponibilidad, en palabras de la pantalla. */
export function etiquetaDeCodigo(codigo: string): string {
  return textoEnPantalla(ETIQUETAS_DE_CALIDAD[codigo] ?? ETIQUETAS_DE_AVISO[codigo] ?? ETIQUETAS_DE_DATOS[codigo] ?? readableBackendLabel(codigo));
}

const NOMBRES_DE_REPLICA: Readonly<Record<string, string>> = {
  PHYSICAL_FULL: "Física completa",
  PHYSICAL_SAMPLING: "Física por muestreo",
  SYNTHETIC: "Sintética, con una permuta (swap)"
};

/** La réplica de la ficha (`product_profile.replication`): la base nueva la trae como código; la vieja, como literal, que se deja igual. */
export function nombreDeLaReplica(valor: string): string {
  return NOMBRES_DE_REPLICA[valor] ?? valor;
}

/** Lo mismo para un aviso, que antes busca su propio rótulo: «Histórico insuficiente» y no «Sin histórico suficiente». */
export function etiquetaDeAviso(codigo: string): string {
  return textoEnPantalla(ETIQUETAS_DE_AVISO[codigo] ?? ETIQUETAS_DE_CALIDAD[codigo] ?? readableBackendLabel(codigo));
}

/** Qué datos hay de un bloque (fundamentales, cartera publicada), o nada si no se ha dicho. */
export function estadoDeLosDatos(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.trim() === "") return null;
  return etiquetaDeCodigo(valor.trim().toUpperCase());
}

export const aniosEnPalabras = (anios: number): string => (anios === 1 ? "1 año" : `${anios} años`);

/** «3Y» → «3 años». Un valor que no sea una ventana se deja como está. */
export function ventanaEnPalabras(ventana: string): string {
  const anios = Number.parseInt(ventana, 10);
  return Number.isFinite(anios) && anios > 0 ? aniosEnPalabras(anios) : ventana;
}

/** El rótulo que `maxDrawdownMetric` escribe para el papel, en pantalla. */
export function caidaEnPantalla(rotulo: string): string {
  if (rotulo === "Máx. caída (hist.)") return "Caída máxima histórica";
  if (rotulo === "Máx. caída 5A") return "Caída máxima 5 años";
  return textoEnPantalla(rotulo);
}
