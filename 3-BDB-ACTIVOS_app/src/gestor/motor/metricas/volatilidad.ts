import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => analisis.riesgo?.volatilidad ?? null;

export const volatilidad: Metrica = {
  id: "volatilidad",
  nombre: "Volatilidad",
  ayuda: "Cuánto se mueve el valor de la cartera, en términos anuales. Cuanto más alta, más sube y baja por el camino. Una cartera de bolsa suele estar entre el 12 % y el 20 %; una conservadora, por debajo del 5 %.",
  formato: "porcentaje",
  conSigno: false,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor),
  motivoSinValor: (analisis) => (analisis.riesgo && analisis.riesgo.volatilidad === null ? "Hacen falta al menos veinte semanas de historia." : undefined),
  noAplica: (analisis) => Boolean(analisis.riesgo && analisis.riesgo.volatilidad === null)
};
