import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => (analisis.riesgo ? analisis.riesgo.maximaCaida.caida : null);

export const maximaCaida: Metrica = {
  id: "maximaCaida",
  nombre: "Máxima caída",
  ayuda: "La mayor bajada desde un máximo hasta el mínimo siguiente dentro del periodo. Dice cuánto habría llegado a perder quien entró en el peor momento.",
  formato: "porcentaje",
  conSigno: true,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor)
};
