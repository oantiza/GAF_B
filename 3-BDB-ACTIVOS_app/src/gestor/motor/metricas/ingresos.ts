import type { Metrica } from "./tipos";

export const ingresos: Metrica = {
  id: "ingresos",
  nombre: "Dividendos y cupones cobrados",
  ayuda: "Dividendos y cupones cobrados en el periodo, ya netos de retención. No incluye los intereses de la cuenta.",
  formato: "importe",
  conSigno: false,
  valor: (analisis) => (analisis.rentabilidad ? analisis.ingresosYCostes.ingresosNetos : null)
};
