import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => (analisis.rentabilidad?.anualiza ? analisis.rentabilidad.tirAnualizada : analisis.rentabilidad?.tir) ?? null;

export const rentabilidadDelCliente: Metrica = {
  id: "rentabilidadDelCliente",
  nombre: "Rentabilidad del cliente",
  ayuda: "Lo que le ha rendido su dinero al cliente, teniendo en cuenta cuándo lo aportó y cuándo lo retiró. Difiere de la rentabilidad de la cartera cuando ha habido aportaciones o retiradas: si entró más dinero antes de una subida, es mayor; si entró antes de una caída, menor.",
  formato: "porcentaje",
  conSigno: true,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor),
  motivoSinValor: (analisis) => (analisis.rentabilidad && analisis.rentabilidad.tir === null ? "No se puede calcular con estos flujos." : undefined)
};
