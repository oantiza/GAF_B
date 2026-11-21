import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => analisis.rentabilidad?.resultado ?? null;

export const resultado: Metrica = {
  id: "resultado",
  nombre: "Resultado",
  ayuda: "Lo ganado o perdido en el periodo, en dinero: lo que vale ahora menos lo que valía al empezar y menos lo aportado por el cliente.",
  formato: "importe",
  conSigno: true,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor)
};
