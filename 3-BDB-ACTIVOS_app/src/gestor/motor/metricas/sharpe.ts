import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => analisis.riesgo?.sharpe ?? null;

export const sharpe: Metrica = {
  id: "sharpe",
  nombre: "Ratio de Sharpe",
  ayuda: "Rentabilidad obtenida por encima del tipo sin riesgo, por cada unidad de volatilidad. Sirve para comparar carteras de distinto riesgo: por encima de 1 es bueno; por debajo de 0, la cartera ha rendido menos que el dinero sin riesgo.",
  formato: "ratio",
  conSigno: false,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor),
  motivoSinValor: (analisis) => analisis.riesgo?.motivoSinSharpe,
  noAplica: (analisis) => Boolean(analisis.riesgo && analisis.riesgo.sharpe === null && !analisis.riesgo.sharpeFaltaUnDato)
};
