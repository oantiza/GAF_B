import type { Analisis } from "../analisis";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

const valor = (analisis: Analisis) => analisis.rentabilidad?.twrAnualizada ?? null;

export const rentabilidadAnualizada: Metrica = {
  id: "rentabilidadAnualizada",
  nombre: "Rentabilidad anual",
  ayuda: "La rentabilidad del periodo expresada como media por año. Solo se da en periodos de un año o más: anualizar unos meses da cifras que no significan nada.",
  formato: "porcentaje",
  conSigno: true,
  valor,
  salvedad: salvedadDeLoContadoComoCero(valor),
  motivoSinValor: (analisis) => (analisis.rentabilidad && !analisis.rentabilidad.anualiza ? "El periodo no llega a un año." : undefined),
  noAplica: (analisis) => Boolean(analisis.rentabilidad && !analisis.rentabilidad.anualiza)
};
