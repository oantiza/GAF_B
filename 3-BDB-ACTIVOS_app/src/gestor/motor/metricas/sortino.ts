import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => analisis.riesgo?.sortino ?? null;

export const sortino: Metrica = {
  id: "sortino",
  nombre: "Ratio de Sortino",
  ayuda: "Como el ratio de Sharpe, pero contando solo las semanas malas: la rentabilidad por encima del tipo sin riesgo por cada unidad de oscilación a la baja. No penaliza las subidas; cuanto más alto, mejor.",
  formato: "ratio",
  conSigno: false,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor),
  motivoSinValor: (analisis) => analisis.riesgo?.motivoSinSortino,
  noAplica: (analisis) => Boolean(analisis.riesgo && analisis.riesgo.sortino === null && !analisis.riesgo.sortinoFaltaUnDato)
};
