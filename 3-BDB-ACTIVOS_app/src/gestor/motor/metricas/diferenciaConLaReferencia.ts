import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => analisis.referencia?.diferencia ?? null;

export const diferenciaConLaReferencia: Metrica = {
  id: "diferenciaConLaReferencia",
  nombre: "Frente a la referencia",
  ayuda: "La rentabilidad de la cartera menos la de su referencia (un índice, una cartera de referencia o la liquidez) en el mismo periodo, en puntos porcentuales. Positivo: la cartera lo ha hecho mejor.",
  formato: "puntos",
  conSigno: true,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor),
  motivoSinValor: (analisis) => (analisis.referencia ? analisis.referencia.motivo : "No se ha elegido una referencia."),
  noAplica: (analisis) => !analisis.referencia
};
