/**
 * Aritmética decimal del gestor de carteras.
 *
 * Importes, títulos, precios y cambios se guardan como texto decimal («1234.56») y se
 * operan con `big.js`: 0,1 + 0,2 es 0,3 y un saldo de cien apuntes cuadra al céntimo.
 * Solo se redondea al mostrar. Nada de este módulo conoce React, la red ni el disco.
 */
import Big from "big.js";

/* Decimales de una división. Veinte bastan para encadenar precios, títulos y cambios sin
   que el error llegue al céntimo en ninguna cartera real. */
Big.DP = 20;
/* Redondeo comercial: la mitad se aleja del cero (0,005 → 0,01; −0,005 → −0,01). */
Big.RM = Big.roundHalfUp;
/* Nunca notación exponencial al escribir: un fichero de cartera no lleva «1e-7». */
Big.NE = -30;
Big.PE = 40;

/** Un número decimal en memoria. */
export type Decimal = Big;

/** Un número decimal guardado: texto con punto decimal y sin separador de miles. */
export type Dec = string;

export const CERO: Decimal = new Big(0);
export const UNO: Decimal = new Big(1);

const FORMA_DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Si un texto es un decimal bien formado («12», «-0.5», «3.»). No admite exponentes ni comas. */
export function esDecimal(valor: unknown): valor is Dec {
  return typeof valor === "string" && FORMA_DECIMAL.test(valor.trim());
}

/**
 * Convierte a decimal. Un `number` entra por su escritura más corta, que es la que el usuario
 * vio: `d(0.1)` es exactamente 0,1. Lanza si el valor no es un número finito.
 */
export function d(valor: Dec | number | Decimal): Decimal {
  if (valor instanceof Big) return valor;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) throw new Error(`No es un número finito: ${valor}`);
    return new Big(valor);
  }
  const texto = valor.trim();
  if (!FORMA_DECIMAL.test(texto)) throw new Error(`No es un decimal válido: «${valor}»`);
  return new Big(texto);
}

/** Como `d`, pero un hueco (undefined, null o cadena vacía) es cero. */
export function dOCero(valor: Dec | number | Decimal | null | undefined): Decimal {
  if (valor === null || valor === undefined || valor === "") return CERO;
  return d(valor);
}

/** Como `d`, pero un hueco es `undefined` en lugar de un error. */
export function dOpcional(valor: Dec | number | Decimal | null | undefined): Decimal | undefined {
  if (valor === null || valor === undefined || valor === "") return undefined;
  return d(valor);
}

/** El texto que se guarda: sin exponente y sin ceros de relleno («1234.5», «0», «-0.25»). */
export function aTexto(valor: Decimal): Dec {
  const texto = valor.toFixed();
  return texto === "-0" ? "0" : texto;
}

/** A coma flotante, para valorar y dibujar. Los saldos y los costes no pasan por aquí. */
export function aNumero(valor: Decimal): number {
  return valor.toNumber();
}

export function sumar(valores: Iterable<Decimal>): Decimal {
  let total = CERO;
  for (const valor of valores) total = total.plus(valor);
  return total;
}

/** Redondeo comercial a `decimales` (por defecto, céntimos). */
export function redondear(valor: Decimal, decimales = 2): Decimal {
  return valor.round(decimales, Big.roundHalfUp);
}

export function esCero(valor: Decimal): boolean {
  return valor.eq(0);
}

export function abs(valor: Decimal): Decimal {
  return valor.abs();
}

export function negar(valor: Decimal): Decimal {
  return valor.times(-1);
}

export function minimo(a: Decimal, b: Decimal): Decimal {
  return a.lt(b) ? a : b;
}

/** Si dos importes coinciden dentro de una tolerancia (por defecto, medio céntimo). */
export function casiIgual(a: Decimal, b: Decimal, tolerancia: Dec | number = "0.005"): boolean {
  return a.minus(b).abs().lte(d(tolerancia));
}

/**
 * Lee una cifra tecleada o importada en formato español o anglosajón: «1.234,56», «1234,56»,
 * «1,234.56», «1234.56», «-12,5», «12 %». Devuelve `undefined` si no es una cifra.
 *
 * La ambigüedad de un solo separador se resuelve así: una coma es siempre decimal; un punto
 * seguido de exactamente tres cifras, con más cifras delante y sin otro separador, es de
 * millares («1.234»), y en cualquier otro caso es decimal («12.5», «0.125», «1234.5678»).
 */
export function leerCifra(crudo: string): Decimal | undefined {
  let texto = crudo.replace(/[\s\u00a0€$%]/g, "").replace(/\u2212/g, "-");
  if (texto === "") return undefined;
  let signo = "";
  if (texto.startsWith("-") || texto.startsWith("+")) {
    signo = texto[0] === "-" ? "-" : "";
    texto = texto.slice(1);
  }
  if (!/^[\d.,]+$/.test(texto) || !/\d/.test(texto)) return undefined;
  const comas = (texto.match(/,/g) ?? []).length;
  const puntos = (texto.match(/\./g) ?? []).length;
  let normal: string;
  if (comas > 0 && puntos > 0) {
    /* El último separador es el decimal; el otro, de millares. */
    normal = texto.lastIndexOf(",") > texto.lastIndexOf(".")
      ? texto.replace(/\./g, "").replace(",", ".")
      : texto.replace(/,/g, "");
    if ((normal.match(/\./g) ?? []).length > 1) return undefined;
  } else if (comas > 0) {
    if (comas > 1) return undefined;
    normal = texto.replace(",", ".");
  } else if (puntos > 1) {
    /* Varios puntos solo pueden ser millares: «1.234.567». */
    if (!/^\d{1,3}(\.\d{3})+$/.test(texto)) return undefined;
    normal = texto.replace(/\./g, "");
  } else if (puntos === 1) {
    normal = /^\d{1,3}\.\d{3}$/.test(texto) && !texto.startsWith("0") ? texto.replace(".", "") : texto;
  } else {
    normal = texto;
  }
  if (!FORMA_DECIMAL.test(normal)) return undefined;
  return new Big(signo + normal);
}

/**
 * Una cifra escrita en español para los mensajes del motor: punto de millar, coma decimal y
 * signo menos tipográfico («−1.250,40»). Con `decimales`, redondeada a ellos; sin ellos, con los
 * que tenga («12,5»). Un cero redondeado no lleva signo. El motor no importa el formato de la
 * pantalla, así que escribe sus avisos con esto.
 */
export function cifraEnTexto(valor: Decimal | number, decimales?: number): string {
  const numero = d(valor);
  const texto = decimales === undefined ? numero.abs().toFixed() : numero.abs().toFixed(decimales);
  const [entera, fraccion] = texto.split(".");
  const conMillares = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const escrito = fraccion ? `${conMillares},${fraccion}` : conMillares;
  return numero.lt(0) && /[1-9]/.test(texto) ? `−${escrito}` : escrito;
}

/** Un importe para un mensaje del motor: «−1.250,40 EUR». */
export function importeEnTexto(valor: Decimal | number, divisa: string): string {
  return `${cifraEnTexto(valor, 2)} ${divisa}`;
}

/**
 * Reparte un total en partes redondeadas a `decimales` de modo que las partes sumen
 * exactamente el total redondeado (método del mayor resto). Sirve para que un desglose
 * presentado en céntimos cuadre con su total, sin un céntimo suelto.
 */
export function cuadrar(partes: number[], decimales = 2): number[] {
  const factor = 10 ** decimales;
  const total = Math.round(partes.reduce((suma, parte) => suma + parte, 0) * factor);
  const enteras = partes.map((parte) => Math.round(parte * factor));
  let resto = total - enteras.reduce((suma, parte) => suma + parte, 0);
  if (resto !== 0) {
    /* El ajuste va a las partes cuyo redondeo se alejó más en el sentido contrario. */
    const orden = partes
      .map((parte, indice) => ({ indice, desvio: parte * factor - enteras[indice] }))
      .sort((a, b) => (resto > 0 ? b.desvio - a.desvio : a.desvio - b.desvio));
    for (let i = 0; resto !== 0 && i < orden.length; i += 1) {
      enteras[orden[i].indice] += Math.sign(resto);
      resto -= Math.sign(resto);
    }
  }
  /* «+ 0» convierte el cero negativo en cero: un desglose no enseña «−0,00». */
  return enteras.map((parte) => parte / factor + 0);
}
