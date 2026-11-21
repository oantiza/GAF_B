import { signoDe } from "./formato";

/**
 * Qué es mejor en cada cifra cuando se comparan dos alternativas (14-11-2026, Óscar: «le faltan colores en general»):
 *
 * - `mas`: más es mejor. La rentabilidad, el Sharpe.
 * - `menos`: menos es mejor. La volatilidad, el coste.
 * - `menosProfunda`: la caída máxima. Mejor la que se queda más cerca de cero, se escriba con signo o sin él: se comparan
 *   las dos en valor absoluto, así que una caída de −12 % frente a una de −18 % mejora aunque la resta dé +6 pp.
 */
export type SentidoDeLaCifra = "mas" | "menos" | "menosProfunda";

/** El veredicto de una diferencia: mejora, empeora o ninguno de los dos (nula, o no se puede calcular). */
export type VeredictoDeLaDiferencia = "mejora" | "empeora" | null;

/**
 * Si pasar de `antes` a `despues` mejora o empeora, según el sentido de la cifra. `decimales`: los de la diferencia tal
 * como se escribe, en la unidad en que llega (una diferencia de porcentajes en fracción, que se escribe en puntos con dos
 * decimales, son cuatro; un Sharpe, dos). Lo que se escribe como cero no mejora ni empeora, y lo que no es una cifra
 * tampoco: sin color.
 */
export function veredictoDeLaDiferencia(
  antes: number | null | undefined,
  despues: number | null | undefined,
  sentido: SentidoDeLaCifra,
  decimales: number
): VeredictoDeLaDiferencia {
  if (typeof antes !== "number" || typeof despues !== "number" || !Number.isFinite(antes) || !Number.isFinite(despues)) return null;
  const signo = signoDe(despues - antes, decimales);
  if (signo === null || signo === "neutro") return null;
  if (sentido === "menosProfunda") {
    const signoDeLaProfundidad = signoDe(Math.abs(despues) - Math.abs(antes), decimales);
    if (signoDeLaProfundidad === null || signoDeLaProfundidad === "neutro") return null;
    return signoDeLaProfundidad === "baja" ? "mejora" : "empeora";
  }
  const sube = signo === "sube";
  return (sentido === "mas") === sube ? "mejora" : "empeora";
}

/**
 * La clase que pinta la diferencia de pasar de `antes` a `despues`: verde si mejora, rojo si empeora, nada si no. Son las de la pieza
 * `Cifra`, el verde y el rojo del signo, escritas enteras para que el censo de CSS vea su uso.
 */
export function claseDeLaDiferencia(
  antes: number | null | undefined,
  despues: number | null | undefined,
  sentido: SentidoDeLaCifra,
  decimales: number
): string {
  const veredicto = veredictoDeLaDiferencia(antes, despues, sentido, decimales);
  return veredicto === "mejora" ? "cifra--sube" : veredicto === "empeora" ? "cifra--baja" : "";
}

/** La nota que va bajo cada tabla que colorea así sus diferencias: el color refuerza, y se dice qué significa. */
export const NOTA_DEL_COLOR_DE_LA_DIFERENCIA = "En verde, lo que mejora; en rojo, lo que empeora.";
