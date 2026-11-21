/**
 * Cuándo la cartera de referencia no se parece en riesgo a la composición (decisión de Óscar del 10-11-2026, la cuarta de «Sí, con las
 * cinco»). Se compara la volatilidad de la composición con la de la referencia elegida, medidas en el mismo periodo: las del mapa de riesgo
 * y rentabilidad. Si el cociente composición/referencia pasa de 1,25 o baja de 0,80 (un 25 % relativo, en un sentido o en el otro:
 * 1/1,25 = 0,80), se dice junto al diferencial. En el límite justo no se dice. Es una regla de lectura, no un cálculo: no cambia ninguna cifra.
 *
 * Vivía en el informe de cliente (`reports/informeDeCliente/datos.ts`); aquí tiene una sola definición, pura (INF-20).
 */
import { porcentaje } from "./formato";

export const COCIENTE_DE_RIESGO_MAXIMO = 1.25;
export const COCIENTE_DE_RIESGO_MINIMO = 0.8;

function safeNumber(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** La frase de la regla de arriba, o null si no se escribe: las dos se parecen, o falta alguna de las dos volatilidades. */
export function fraseDelRiesgoDeLaReferencia(volatilidadDeLaComposicion: number | null | undefined, volatilidadDeLaReferencia: number | null | undefined): string | null {
  const composicion = safeNumber(volatilidadDeLaComposicion);
  const referencia = safeNumber(volatilidadDeLaReferencia);
  if (composicion === null || referencia === null || composicion <= 0 || referencia <= 0) return null;
  /* A nueve decimales: 8 % frente a 10 % es 0,8 justo, y en coma flotante sale 0,7999…, que pasaría el límite sin pasarlo. */
  const cociente = Math.round((composicion / referencia) * 1e9) / 1e9;
  const cifras = `(${porcentaje(referencia)} frente a ${porcentaje(composicion)})`;
  if (cociente > COCIENTE_DE_RIESGO_MAXIMO) return `La referencia elegida oscila menos que esta composición ${cifras}: parte de la diferencia es riesgo, no acierto.`;
  if (cociente < COCIENTE_DE_RIESGO_MINIMO) return `La referencia elegida oscila más que esta composición ${cifras}: parte de la diferencia es el riesgo que esta composición no toma.`;
  return null;
}
