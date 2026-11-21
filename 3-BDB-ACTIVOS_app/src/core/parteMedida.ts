import type { BacktestResponse } from "../adapters/backtestPortfolioBackend";
import { backtestExclusionLabel } from "./backtestCoverage";
import { fecha as fechaConBarras, oFalta, peso, porcentaje } from "./formato";
import { hayCifraDeCartera, PESO_MINIMO_MEDIDO_PCT } from "./riesgoMedido";

/**
 * Qué parte de la cartera mide la simulación, y cómo se le dice al cliente (decisión 4, hallazgo 28).
 *
 * Las cifras, la curva y el mapa salen de una simulación con los pesos de hoy sobre las posiciones que tienen serie;
 * lo que se queda fuera no cuenta, y el resto se lleva al 100 % (`functions_python/portfolio_horizon.py`). El peso se
 * calcula siempre sobre la cartera original, nunca sobre los pesos ya normalizados.
 */

export interface PosicionFuera {
  assetId: string;
  /** Su peso en la cartera original, de 0 a 100. */
  weightPercent: number;
  /** El código del servidor, o null si no lo dio. */
  reason: string | null;
  /** El motivo como lo escribe el resto del programa. */
  reasonLabel: string;
}

export interface ParteMedida {
  requested: number;
  included: number;
  /** De 0 a 100, sobre la cartera original. */
  weightPercent: number;
  excluded: PosicionFuera[];
}

/** Null si no hay simulación o si mide posiciones que la cartera no tiene: no sería de esta cartera. */
export function parteMedidaDeLaSimulacion(
  backtest: Pick<BacktestResponse, "asset_ids" | "excluded_assets"> | null | undefined,
  positions: readonly { asset_id: string; weight_percent: number }[]
): ParteMedida | null {
  if (!backtest) return null;
  const weights = new Map<string, number>();
  for (const position of positions) {
    if (Number.isFinite(position.weight_percent) && position.weight_percent > 0) {
      weights.set(position.asset_id, (weights.get(position.asset_id) ?? 0) + position.weight_percent);
    }
  }
  const included = new Set(backtest.asset_ids);
  if (!included.size || [...included].some((id) => !weights.has(id))) return null;
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  const reasons = new Map((backtest.excluded_assets ?? []).map((item) => [item.asset_id, item.reason]));
  const excluded = [...weights]
    .filter(([id]) => !included.has(id))
    .map(([assetId, weight]) => {
      const reason = reasons.get(assetId) ?? null;
      return {
        assetId,
        weightPercent: weight / total * 100,
        reason,
        reasonLabel: reason ? backtestExclusionLabel(reason) : "Fuera del histórico disponible"
      };
    });
  const includedWeight = [...weights].filter(([id]) => included.has(id)).reduce((sum, [, weight]) => sum + weight, 0);
  return { requested: weights.size, included: included.size, weightPercent: includedWeight / total * 100, excluded };
}

/**
 * Por qué se queda fuera, en palabras de cliente: «bloqueado por calidad del dato» no le explica nada. Va detrás de
 * «por»: «queda fuera X por una incidencia en su serie de precios». La pantalla dice lo mismo con otra gramática, detrás
 * de «Fuera del cálculo:», en `motivoDeFueraParaElCliente`: si cambia un motivo, cambian los dos.
 */
const MOTIVOS_PARA_EL_CLIENTE: Record<string, string> = {
  QUALITY_BLOCKED: "una incidencia en su serie de precios",
  PRICE_SERIES_MISSING: "no tener serie de precios",
  INSUFFICIENT_HISTORY: "no tener historia suficiente en este periodo",
  REFERENCE_LINK_FAILED: "no tener historia suficiente en este periodo y no poder completarla con su referencia",
  SERIES_ENDS_EARLY: "no tener precios hasta el final del periodo",
  FX_SERIES_MISSING: "no tener conversión a euros",
  FX_QUARANTINE: "no tener una conversión a euros fiable",
  NON_INVESTABLE: "no ser un activo invertible",
  DISTRIBUTES_WITHOUT_PAYMENTS: "repartir dividendos de los que no tenemos todos los pagos",
  ASSET_CAP_EXCEEDED: "superar el máximo de activos del cálculo"
};

export function motivoParaElCliente(reason: string | null | undefined): string {
  return (reason && MOTIVOS_PARA_EL_CLIENTE[reason]) || "falta de datos en este periodo";
}

/**
 * Un peso en el papel, con una décima. Lo que no llega nunca se escribe como si llegara, ni al 100 % ni al mínimo para dar una
 * cifra de la cartera: un 99,96 % sale «99,96 %» y no «100,0 %», que diría que no falta nada mientras la frase nombra lo que falta,
 * y un 79,99 % sale «79,99 %» y no «80,0 %», al lado de «Falta el dato». Un 80 % que llega como 79,99999999999999 es un 80.
 */
export function pesoEnElPapel(weightPercent: number): string {
  const redondeado = Math.round(weightPercent * 10) / 10;
  const pareceQueLlega = (weightPercent < 100 && redondeado >= 100) || (!hayCifraDeCartera(weightPercent) && redondeado >= PESO_MINIMO_MEDIDO_PCT);
  return oFalta(pareceQueLlega ? porcentaje(Math.floor(weightPercent * 100 + 1e-9) / 10000) : peso(weightPercent / 100));
}

/**
 * La versión de las referencias del histórico ampliado, por su fecha: el servidor la manda como código («eur-proxy-2026-09-06.1»). La fecha sale
 * del dato. Si el código no trae una fecha válida, se dice que no la tiene: no se pone otra.
 */
export function versionDeLaReferencia(version: string | null | undefined): string {
  const [, anio, mes, dia] = /(\d{4})-(\d{2})-(\d{2})/.exec(version ?? "") ?? [];
  const fecha = anio ? new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia))) : null;
  const valida = fecha !== null && fecha.getUTCMonth() === Number(mes) - 1 && fecha.getUTCDate() === Number(dia);
  return valida ? `Versión de la referencia ${oFalta(fechaConBarras(`${anio}-${mes}-${dia}`))}` : "Versión de la referencia sin fecha";
}

/** Lo que va siempre bajo las cifras y bajo la curva: qué son. */
export const SIMULACION_CON_LOS_PESOS_DE_HOY = "Simulación con los pesos de hoy, sin aportaciones ni retiradas.";

/**
 * Lo que cabe bajo las cifras y bajo la curva sin apretar la hoja. Con más posiciones, o con nombres muy largos, la
 * frase cuenta cuántas son y manda al anexo, que las detalla todas. Medido en el PDF: con tres nombres de 85 caracteres
 * (los más largos del catálogo llegan a 100), la hoja 4 llega hasta el pie.
 */
const MAXIMO_DE_NOMBRES = 3;
const MAXIMO_DE_CARACTERES = 330;

const posiciones = (n: number) => `${n} ${n === 1 ? "posición" : "posiciones"}`;

/** Une una lista como se escribe: «A», «A y B», «A, B y C». Con `;` si cada elemento lleva ya sus propias comas. */
function enumerar(partes: readonly string[], separador = ", "): string {
  if (partes.length <= 1) return partes.join("");
  const conjuncion = separador === ", " ? " y " : "; y ";
  return `${partes.slice(0, -1).join(separador)}${conjuncion}${partes[partes.length - 1]}`;
}

/**
 * La frase de cobertura: cuánto mide, cuántas posiciones y cuál queda fuera y por qué. Solo si baja del 100 %: con
 * toda la cartera medida no hay nada que decir, y devuelve null.
 */
export function fraseDeLaParteMedida(
  parte: ParteMedida | null,
  nombreDe: (assetId: string) => string,
  dondeSeDetallan = "detalladas en el anexo"
): string | null {
  if (!parte || parte.excluded.length === 0) return null;
  const mide = `Mide el ${pesoEnElPapel(parte.weightPercent)} de la cartera (${parte.included} de ${posiciones(parte.requested)})`;
  const fuera = [...parte.excluded].sort((a, b) => b.weightPercent - a.weightPercent);
  const peso = fuera.reduce((suma, item) => suma + item.weightPercent, 0);
  const resumen = `${mide}; quedan fuera ${posiciones(fuera.length)} (${pesoEnElPapel(peso)} del peso), ${dondeSeDetallan}.`;
  if (fuera.length > MAXIMO_DE_NOMBRES) return resumen;
  const verbo = fuera.length === 1 ? "queda" : "quedan";
  const nombreConPeso = (item: PosicionFuera) => `${nombreDe(item.assetId)} (${pesoEnElPapel(item.weightPercent)})`;
  const motivos = new Set(fuera.map((item) => motivoParaElCliente(item.reason)));
  const separacion = fuera.length === 1 ? " " : ", ";
  const frase = motivos.size === 1
    ? `${mide}; ${verbo} fuera ${enumerar(fuera.map(nombreConPeso))}${separacion}por ${motivoParaElCliente(fuera[0].reason)}.`
    : `${mide}; ${verbo} fuera ${enumerar(fuera.map((item) => `${nombreConPeso(item)}, por ${motivoParaElCliente(item.reason)}`), "; ")}.`;
  return fuera.length > 1 && frase.length > MAXIMO_DE_CARACTERES ? resumen : frase;
}
