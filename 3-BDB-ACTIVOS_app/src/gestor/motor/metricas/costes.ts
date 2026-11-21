import type { Metrica } from "./tipos";

export const costes: Metrica = {
  id: "costes",
  nombre: "Costes totales",
  ayuda: "Comisiones y gastos pagados en el periodo: los de comprar y vender, los de la cuenta y, cuando se conocen, los gastos corrientes de los fondos (que ya van descontados en su valor). No incluye impuestos ni retenciones.",
  formato: "importe",
  conSigno: false,
  valor: (analisis) => (analisis.rentabilidad ? analisis.ingresosYCostes.costesTotales : null)
};
