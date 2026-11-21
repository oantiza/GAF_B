/**
 * El registro de métricas.
 *
 * AÑADIR UNA MÉTRICA: crea su módulo en esta carpeta (nombre, ayuda en lenguaje llano,
 * formato y cómo se lee del análisis) y añádela a `METRICAS`. La pantalla y los informes
 * la piden por su `id`; si la cifra no existe aún en el análisis, se añade allí primero.
 */
import { aportacionesNetas } from "./aportacionesNetas";
import { calmar } from "./calmar";
import { costes } from "./costes";
import { diferenciaConLaReferencia } from "./diferenciaConLaReferencia";
import { ingresos } from "./ingresos";
import { maximaCaida } from "./maximaCaida";
import { patrimonio } from "./patrimonio";
import { rentabilidad } from "./rentabilidad";
import { rentabilidadAnualizada } from "./rentabilidadAnualizada";
import { rentabilidadDelCliente } from "./rentabilidadDelCliente";
import { rentabilidadUltimoAnio, rentabilidadUltimos3Anios, rentabilidadUltimos5Anios } from "./rentabilidadUltimosAnios";
import { resultado } from "./resultado";
import { resultadoLatente } from "./resultadoLatente";
import { resultadoRealizado } from "./resultadoRealizado";
import { sharpe } from "./sharpe";
import { sortino } from "./sortino";
import { volatilidad } from "./volatilidad";
import type { Metrica } from "./tipos";

export const METRICAS: readonly Metrica[] = [
  patrimonio,
  resultado,
  rentabilidad,
  rentabilidadAnualizada,
  rentabilidadDelCliente,
  aportacionesNetas,
  resultadoRealizado,
  resultadoLatente,
  ingresos,
  costes,
  volatilidad,
  maximaCaida,
  sharpe,
  sortino,
  calmar,
  diferenciaConLaReferencia,
  rentabilidadUltimoAnio,
  rentabilidadUltimos3Anios,
  rentabilidadUltimos5Anios
];

const POR_ID: ReadonlyMap<string, Metrica> = new Map(METRICAS.map((metrica) => [metrica.id, metrica]));

if (POR_ID.size !== METRICAS.length) throw new Error("Hay dos métricas registradas con el mismo identificador.");

export function metrica(id: string): Metrica {
  const encontrada = POR_ID.get(id);
  if (!encontrada) throw new Error(`No existe la métrica «${id}».`);
  return encontrada;
}

export type { FormatoDeMetrica, Metrica } from "./tipos";
