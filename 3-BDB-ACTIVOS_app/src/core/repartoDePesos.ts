/**
 * Repartir pesos entre posiciones sin que el redondeo invente ni pierda dinero.
 *
 * El caso que lo motiva es el más simple de todos: tres posiciones a partes iguales
 * son 33,33 % cada una y suman **99,99 %**. La tolerancia del proyecto (±0,05) lo da
 * por cuadrado y hace bien, pero un reparto que el asesor pide explícitamente debería
 * cuadrar de verdad, no «dentro de tolerancia»: el céntimo que falta existe y tiene que
 * estar en algún sitio.
 *
 * Así que el resto se le da a una posición concreta —la última—, y la pantalla enseña
 * la suma siempre. Lo que no se hace nunca es escribir «100 %» encima de una suma que
 * no lo es.
 */

/**
 * Dos decimales, que es lo que el constructor deja teclear.
 *
 * Con `Math.round(valor / 0.01) * 0.01` el reparto entre siete daba
 * `14.290000000000001`, y la suma de los siete, `100.00000000000001`. No se veía en
 * pantalla, pero eso es lo que se habría guardado en la cartera y lo que habría viajado
 * al informe. `toFixed(2)` corta ahí mismo y devuelve el número que se enseña.
 */
function redondear(valor: number): number {
  return Number(valor.toFixed(2));
}

/**
 * Reparte 100 entre `cuantas` posiciones. Todas iguales salvo la última, que se queda
 * con el resto del redondeo, y la suma es exactamente 100.
 */
export function aPartesIguales(cuantas: number): number[] {
  if (cuantas <= 0) return [];
  const cada = redondear(100 / cuantas);
  const pesos = Array.from({ length: cuantas }, () => cada);
  const sobra = Number((100 - redondear(cada * cuantas)).toFixed(2));
  pesos[cuantas - 1] = Number((cada + sobra).toFixed(2));
  return pesos;
}
