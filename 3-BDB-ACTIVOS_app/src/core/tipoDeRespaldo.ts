import { oFalta, porcentaje } from "./formato";

/**
 * El tipo sin riesgo de respaldo (decisión 89 de Óscar, 05-11-2026). Si no se puede leer el €STR del periodo, el servidor calcula el Sharpe con un
 * tipo fijo (`functions_python/optimization/repository.py`), y lo marca de dos formas: la política `STATIC_FALLBACK` y el aviso
 * `RISK_FREE_RATE_STATIC_FALLBACK`. Cualquiera de las dos basta. La cifra sale de la respuesta: no se escribe a mano.
 *
 * No es el 1,9 % de la frontera estimada del navegador (`quantConfig.ts`), que no sale de ninguna respuesta y no pasa por aquí.
 */
export interface RespuestaConTipo {
  risk_free?: { risk_free_rate: number; risk_free_rate_policy: string } | null;
  warnings?: readonly string[] | null;
  metrics?: { rf_rate?: number } | null;
}

/** La cifra del respaldo, en tanto por uno. Null si el tipo se ha podido leer, o si dice que es de respaldo y no dice cuál. */
export function tipoDeRespaldo(respuesta: RespuestaConTipo | null | undefined): number | null {
  if (!respuesta) return null;
  const marcado = respuesta.risk_free?.risk_free_rate_policy === "STATIC_FALLBACK" || (respuesta.warnings ?? []).includes("RISK_FREE_RATE_STATIC_FALLBACK");
  if (!marcado) return null;
  const tipo = respuesta.risk_free?.risk_free_rate ?? respuesta.metrics?.rf_rate;
  return typeof tipo === "number" && Number.isFinite(tipo) ? tipo : null;
}

/** La misma línea en los tres papeles. Con dos decimales: es la cifra con que se ha calculado, y con uno se confundiría con la de la frontera estimada. */
export function fraseDelTipoDeRespaldo(tipo: number): string {
  return `Sharpe con un tipo fijo de respaldo (${oFalta(porcentaje(tipo))}): no se pudo leer el €STR del periodo.`;
}
