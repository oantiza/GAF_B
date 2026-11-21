/**
 * El eje horizontal del cono estadístico: cómo se rotula cada año del horizonte y cuánto sitio hay que dejarle a la
 * última marca. Aparte del gráfico para que se pueda probar sin dibujarlo.
 */

/** El rótulo de un año del horizonte en el eje: «a 1 año», «a 3 años» (nunca «+1A»). */
export function aNAnios(anios: number): string {
  return `a ${anios} ${anios === 1 ? "año" : "años"}`;
}

/**
 * El margen derecho del dibujo. La última marca del eje va centrada en el último punto, así que media etiqueta cae fuera
 * del plano: con 18 px, «a 3 años» se quedaba en «a 3 año». Deja sitio a media etiqueta del horizonte más largo que se
 * enseña («a 10 años», unos 58 px a 12 px de letra).
 */
export const MARGEN_DERECHO_DEL_CONO = 32;
