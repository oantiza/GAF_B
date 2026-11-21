import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => analisis.rentabilidad?.twr ?? null;

export const rentabilidad: Metrica = {
  id: "rentabilidad",
  nombre: "Rentabilidad",
  ayuda: "Lo que ha rendido la cartera en el periodo, sin que influya cuándo aportó o retiró dinero el cliente. Es la cifra para comparar con un índice o con otra cartera. Ya descuenta las comisiones.",
  formato: "porcentaje",
  conSigno: true,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor)
};
