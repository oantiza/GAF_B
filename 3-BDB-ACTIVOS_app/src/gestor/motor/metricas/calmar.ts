import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => analisis.riesgo?.calmar ?? null;

export const calmar: Metrica = {
  id: "calmar",
  nombre: "Ratio de Calmar",
  ayuda: "La rentabilidad anualizada dividida entre la caída máxima del periodo. Dice cuánta rentabilidad ha dado la cartera por cada punto de su peor bajada; cuanto más alto, mejor.",
  formato: "ratio",
  conSigno: false,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor),
  motivoSinValor: (analisis) => analisis.riesgo?.motivoSinCalmar,
  /* Cuando no hay Calmar es porque no corresponde (menos de un año, o ninguna caída): nunca le falta un dato. */
  noAplica: (analisis) => Boolean(analisis.riesgo && analisis.riesgo.calmar === null)
};
