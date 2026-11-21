import { leerCifra } from "../gestor/motor/decimal";
import { numero } from "./formato";

/**
 * FMT-20: el lector único de una cifra **tecleada** por una persona en un campo de la pantalla.
 *
 * La regla aprobada: coma decimal, punto de millar opcional, y se enseña cómo se ha leído. Acepta y rechaza exactamente
 * lo mismo que `leerCifra` (`src/gestor/motor/decimal.ts`), el lector del Gestor de carteras, porque lo llama: así no
 * hay dos reglas para teclear una cifra. Lo único que hace es devolver un número en vez de un decimal exacto.
 *
 * - «12,5» → 12,5; «1.234,56» → 1234,56; «1.234» → 1234 (un punto con tres cifras detrás es de millares);
 *   «12.5» → 12,5 y «0.125» → 0,125 (un punto que no puede ser de millares es decimal); «12 %», «25.000 €» → la cifra.
 * - No es una cifra: «1,234,567» (dos comas), «1.500 EUR» (letras), «25k», «1'234», «(5)».
 *
 * `parseEuropeanNumber` (`numberFormat.ts`) **no** es este lector: es el de los ficheros que importan los extractos del
 * banco, que no son tecleo y aceptan más («1,234,567», «1.500 EUR»). Las diferencias están escritas en
 * `tests/cifraTecleada.test.ts`.
 */
export function leerCifraTecleada(texto: string): number | undefined {
  const cifra = leerCifra(texto);
  if (cifra === undefined) return undefined;
  const valor = Number(cifra.toString());
  return Number.isFinite(valor) ? valor : undefined;
}

/**
 * Cómo se ha leído una cifra, escrita en español para enseñarla junto al campo: punto de millar y coma decimal, con
 * los decimales que tenga y sin ceros de relleno («1.234,5», «12,5», «−3»). Sale del módulo común de formato.
 */
export function cifraLeida(valor: number): string {
  const decimales = Math.min(10, (/\.(\d+)$/.exec(String(valor))?.[1] ?? "").length);
  return numero(valor, { decimales }) ?? String(valor);
}
