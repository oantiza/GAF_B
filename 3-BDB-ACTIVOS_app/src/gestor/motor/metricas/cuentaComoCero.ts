/**
 * La salvedad de las cifras que salen de la serie diaria del valor de la cartera: el resultado, las rentabilidades, el
 * riesgo y la diferencia con la referencia. En esa serie una posición sin precio vale cero cada día, así que la cifra
 * existe pero la arrastra, y lo dice junto a ella: «Cuenta Activo B como cero, porque no tiene precio.» (`sinPrecio.ts`).
 *
 * Solo cuando la cifra se da: la que no tiene valor ya explica por qué con su `motivoSinValor`.
 *
 * No la llevan el patrimonio ni el resultado latente (no la cuentan: su salvedad es «No incluye…»), ni las aportaciones,
 * el resultado realizado, los ingresos y los costes, que son dinero movido y no dependen de ningún precio.
 *
 * HASTA DÓNDE LLEGA. Mira las posiciones sin precio A LA FECHA del análisis. Una que hoy tiene precio y no lo tuvo unos
 * días del periodo contó como cero esos días —la rentabilidad y el riesgo los arrastran igual— y aquí no deja salvedad:
 * lo dice la comprobación de la cartera, como error y con sus fechas (`integridad.ts`, `SIN_PRECIO`: «no tuvo precio del …
 * al …»), que sale en el Resumen, en Comprobaciones, al generar un informe y en los avisos del informe del asesor.
 */
import type { Analisis } from "../analisis";
import { notaDeLoContadoComoCero } from "../sinPrecio";

export function salvedadDeLoContadoComoCero(valor: (analisis: Analisis) => number | null): (analisis: Analisis) => string | undefined {
  return (analisis) => (valor(analisis) === null ? undefined : notaDeLoContadoComoCero(analisis) ?? undefined);
}
