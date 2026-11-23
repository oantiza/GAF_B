/**
 * Lo que se dice de las posiciones sin precio junto a una cifra (decisión de Óscar del 20-11-2026). Una posición sin ningún
 * precio a la fecha no tiene valor que dar (`PosicionAnalizada`, en `analisis.ts`), y cada cifra de la cartera lo dice de
 * una de dos maneras, y solo de dos:
 *
 *  - «No incluye X, que no tiene precio.» — junto a un total que la deja fuera: el patrimonio, lo invertido, el resultado
 *    latente, un reparto.
 *  - «Cuenta X como cero, porque no tiene precio.» — junto a una cifra que sale de la serie diaria del valor, donde la
 *    posición vale cero (`valoracion.ts`): el resultado del periodo, las rentabilidades, el riesgo y la comparación con la
 *    referencia. La cifra existe, pero la arrastra.
 *
 * Cada una tiene su forma sin nombres, para donde el nombre ya está escrito cerca, y su forma con sujeto, para un bloque
 * entero o para varias cifras a la vez. Son las mismas frases en la pantalla, en el Excel y en el informe del asesor.
 * Cálculo puro: no lee nada.
 *
 * Mira solo la fecha del análisis. Una posición que hoy tiene precio y no lo tuvo unos días del periodo contó como cero
 * esos días, y aquí no consta: lo dice la comprobación de la cartera, con sus fechas (`integridad.ts`, `SIN_PRECIO`).
 */
import type { Analisis } from "./analisis";

type ConSinPrecio = Pick<Analisis, "sinPrecio">;

/** Cuántos nombres se escriben antes de contar el resto. Con uno solo de más se escribe también: «y otra» no ahorra nada. */
const NOMBRES_ANTES_DE_CONTAR = 3;

const tienen = (cuantas: number) => (cuantas === 1 ? "tiene" : "tienen");

/** Los nombres de las posiciones que no tienen precio a la fecha del análisis, en el orden de `posiciones`. */
export function nombresDeLasSinPrecio(analisis: ConSinPrecio): string[] {
  return analisis.sinPrecio.map((posicion) => posicion.activo.nombre);
}

/**
 * Esos nombres, para dentro de una frase: «A», «A y B», «A, B, C y D», y con cinco o más, las tres primeras y cuántas más:
 * «A, B, C y otras 2». Con `ni`, la misma lista para una frase en negativo: «A ni B».
 */
export function listaDeLasSinPrecio(analisis: ConSinPrecio, nexo: "y" | "ni" = "y"): string {
  return unirNombres(nombresDeLasSinPrecio(analisis), nexo);
}

function unirNombres(nombres: string[], nexo: "y" | "ni"): string {
  if (nombres.length <= 1) return nombres[0] ?? "";
  if (nombres.length <= NOMBRES_ANTES_DE_CONTAR + 1) return `${nombres.slice(0, -1).join(", ")} ${nexo} ${nombres[nombres.length - 1]}`;
  return `${nombres.slice(0, NOMBRES_ANTES_DE_CONTAR).join(", ")} ${nexo} otras ${nombres.length - NOMBRES_ANTES_DE_CONTAR}`;
}

/** «una posición sin precio», «3 posiciones sin precio»: cuántas son, para donde no caben sus nombres. */
export function cuantasSinPrecio(cuantas: number): string {
  return cuantas === 1 ? "una posición sin precio" : `${cuantas} posiciones sin precio`;
}

/* ------------------------------------------------------------------------------------------------ no las incluye */

/**
 * Junto a un total que no las cuenta: «No incluye Activo B, que no tiene precio.»; con dos, «No incluye Activo B ni Activo
 * C, que no tienen precio.». Con `sujeto`, la frase entera para un bloque: «La composición no incluye Activo B, que no
 * tiene precio.». `null` si todas tienen precio.
 */
export function notaDeLasSinPrecio(analisis: ConSinPrecio, sujeto?: string): string | null {
  const cuantas = analisis.sinPrecio.length;
  if (cuantas === 0) return null;
  return `${sujeto ? `${sujeto} no` : "No"} incluye ${listaDeLasSinPrecio(analisis, "ni")}, que no ${tienen(cuantas)} precio.`;
}

/** Lo mismo sin nombres: «No incluye una posición sin precio.», «No incluye 3 posiciones sin precio.». */
export function notaCortaDeLasSinPrecio(analisis: ConSinPrecio): string | null {
  const cuantas = analisis.sinPrecio.length;
  return cuantas === 0 ? null : `No incluye ${cuantasSinPrecio(cuantas)}.`;
}

/* ------------------------------------------------------------------------------------------- las cuenta como cero */

/** Quién las cuenta como cero, cuando la frase no va pegada a su cifra: «Estas cifras», «El patrimonio medio». */
export interface QuienCuenta {
  quien: string;
  plural?: boolean;
}

/**
 * Junto a una cifra que sí las cuenta, y como cero: «Cuenta Activo B como cero, porque no tiene precio.»; con dos, «Cuenta
 * Activo B y Activo C como cero, porque no tienen precio.». Con `sujeto`, la frase entera: «El patrimonio medio cuenta
 * Activo B como cero, porque no tiene precio.». `null` si todas tienen precio.
 */
export function notaDeLoContadoComoCero(analisis: ConSinPrecio, sujeto?: QuienCuenta): string | null {
  const cuantas = analisis.sinPrecio.length;
  if (cuantas === 0) return null;
  const cuenta = sujeto ? `${sujeto.quien} ${sujeto.plural ? "cuentan" : "cuenta"}` : "Cuenta";
  return `${cuenta} ${listaDeLasSinPrecio(analisis)} como cero, porque no ${tienen(cuantas)} precio.`;
}

/** Lo mismo sin nombres: «La posición sin precio cuenta como cero.», «Las 2 posiciones sin precio cuentan como cero.». */
export function notaCortaDeLoContadoComoCero(analisis: ConSinPrecio): string | null {
  const cuantas = analisis.sinPrecio.length;
  if (cuantas === 0) return null;
  return cuantas === 1 ? "La posición sin precio cuenta como cero." : `Las ${cuantas} posiciones sin precio cuentan como cero.`;
}

/**
 * Para un bloque entero —un gráfico, una tabla, una sección de un informe— cuyas cifras salen todas de la serie del valor:
 * «Estas cifras cuentan Activo B como cero, porque no tiene precio.».
 */
export function notaDeLasCifrasQueLasCuentanComoCero(analisis: ConSinPrecio): string | null {
  return notaDeLoContadoComoCero(analisis, { quien: "Estas cifras", plural: true });
}

/* ------------------------------------------------------------------------------- varias cifras, la misma salvedad */

/**
 * Lo que sigue a los dos puntos cuando una salvedad se escribe una vez para varias cifras («Patrimonio y Resultado latente:
 * ninguna incluye Activo B, que no tiene precio.»; «Resultado y Rentabilidad: cada una cuenta Activo B como cero, porque no
 * tiene precio.»). El «No incluye» pasa a «ninguna incluye»; cualquier otra frase, a «cada una …».
 */
export function salvedadParaVariasCifras(salvedad: string, analisis: ConSinPrecio): string {
  const cuantas = analisis.sinPrecio.length;
  if (cuantas > 0 && salvedad === notaDeLasSinPrecio(analisis)) return `ninguna incluye ${listaDeLasSinPrecio(analisis, "ni")}, que no ${tienen(cuantas)} precio.`;
  return `cada una ${salvedad.charAt(0).toLowerCase()}${salvedad.slice(1)}`;
}

/* ------------------------------------------------------------------------------------- el coste corriente de los fondos */

/**
 * Junto a la cobertura del coste corriente estimado: los fondos sin precio no valieron nada en el periodo, no entran en la
 * estimación ni en su cobertura, y esa cobertura no los cuenta como cero —no sabe lo que valen—: «No entra el coste corriente de
 * Fondo B, que no tiene precio: no se conoce su valor, y la cobertura no lo cuenta.». `null` si no falta ninguno.
 */
export function notaDelCosteCorrienteSinPrecio(analisis: Pick<Analisis, "ingresosYCostes">): string | null {
  const nombres = analisis.ingresosYCostes.sinPrecioFueraDeLosGastosCorrientes;
  const parte = notaDelCosteCorrienteDeParteDelPeriodo(analisis);
  if (nombres.length === 0) return parte;
  const uno = nombres.length === 1;
  const sinPrecio = `No entra el coste corriente de ${unirNombres(nombres, "ni")}, que no ${uno ? "tiene" : "tienen"} precio: no se conoce su valor, y la cobertura no ${uno ? "lo" : "los"} cuenta.`;
  return parte ? `${sinPrecio} ${parte}` : sinPrecio;
}

/**
 * Los fondos que tuvieron títulos sin valor —sin precio o sin cambio— solo una parte del periodo (H2-02, 22-11-2026): su coste
 * corriente se estima con los días en que valieron, y la cifra es parcial: «El coste corriente de Fondo B solo cuenta los días
 * en que tuvo valor: los días sin precio o sin tipo de cambio no entran.». `null` si no hay ninguno.
 */
export function notaDelCosteCorrienteDeParteDelPeriodo(analisis: Pick<Analisis, "ingresosYCostes">): string | null {
  const nombres = analisis.ingresosYCostes.valoradosSoloParteDelPeriodo;
  if (nombres.length === 0) return null;
  return `El coste corriente de ${unirNombres(nombres, "y")} solo cuenta los días en que ${nombres.length === 1 ? "tuvo" : "tuvieron"} valor: los días sin precio o sin tipo de cambio no entran.`;
}
