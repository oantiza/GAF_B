import { textoEnPantalla } from "./glosarioDePantalla";

/**
 * Los avisos que el servidor manda con la frontera (`optimization/repository.py` y `robust_engine.py`), en palabras.
 * Llegan como códigos: sin esta lista, «RETURN_SIGNAL_WEAK» saldría tal cual en Optimizar, también en Modo cliente.
 */
const AVISOS: Record<string, string> = {
  RETURN_SIGNAL_WEAK: "Diferencias de rentabilidad esperada reducidas tras el ajuste robusto: priorizamos diversificación y estabilidad.",
  FRONTIER_RISK_RANGE_NARROW: "La frontera disponible tiene un rango de riesgo estrecho; el nivel se aplica de forma relativa dentro del universo factible.",
  COVERAGE_LOSS_ABOVE_10PCT: "Se han excluido posiciones que suman más del 10 % de la cartera: la frontera es parcial.",
  MAX_SHARPE_UNDEFINED_FALLBACK: "Ningún activo supera el tipo sin riesgo tras el ajuste; el máximo Sharpe se muestra como referencia aproximada.",
  MAX_SHARPE_FROM_FRONTIER: "El máximo Sharpe se ha tomado del mejor punto de la frontera, porque con estos límites no se resuelve directamente: es aproximado.",
  CURRENT_WEIGHTS_NORMALIZED_TO_INCLUDED_ASSETS: "Los pesos de tu cartera se han renormalizado sobre los activos incluidos.",
  CURRENT_WEIGHTS_EMPTY_FOR_INCLUDED_ASSETS: "Tu cartera no tiene peso en los activos incluidos: no se puede situar en la frontera.",
  GROUP_CONSTRAINTS_INFEASIBLE: "Los límites por grupo eran incompatibles entre sí o con el universo disponible: se han ignorado y la frontera se calculó sin ellos.",
  TARGET_ABSOLUTE_VOL_CLIPPED_LOW: "La volatilidad pedida está por debajo de la mínima posible: se usa la cartera de mínima volatilidad.",
  TARGET_ABSOLUTE_VOL_CLIPPED_HIGH: "La volatilidad pedida está por encima de la máxima posible: se usa la más alta de la frontera.",
  TURNOVER_BASE_OUTSIDE_BOUNDS: "La cartera de partida ya está fuera de los límites de peso: el límite de rotación se mide desde ella.",
  RISK_FREE_RATE_PARTIAL_COVERAGE: "El tipo sin riesgo €STR solo cubre parte de la ventana: el Sharpe es aproximado.",
  RISK_FREE_RATE_STATIC_FALLBACK: "No se pudo leer el €STR de la ventana: el Sharpe usa un tipo fijo de respaldo.",
  PERIOD_END_STALE: "El periodo medido acaba hace más de un mes: ninguna serie de la cartera llega más allá, y las cifras no recogen lo ocurrido desde entonces.",
  WINDOW_COLLAPSED: "El histórico común es más corto que la ventana pedida: las cifras describen ese periodo.",
  PERIOD_TOO_SHORT_TO_ANNUALIZE: "El histórico común no llega a un año: no se anualiza. Se da la rentabilidad del periodo, y la rentabilidad anualizada y el Sharpe no aplican."
};

const ES_UN_CODIGO = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

/**
 * El aviso en palabras. Un código que esta lista aún no conoce no se le enseña al cliente; el asesor lo ve, dicho
 * como lo que es, para que no se pierda un aviso del cálculo.
 */
export function avisoDeLaFrontera(aviso: string, modoCliente: boolean): string | null {
  const conocido = AVISOS[aviso];
  if (conocido) return conocido;
  if (ES_UN_CODIGO.test(aviso)) return modoCliente ? null : `Aviso del cálculo sin traducir: ${aviso}.`;
  return textoEnPantalla(aviso);
}
