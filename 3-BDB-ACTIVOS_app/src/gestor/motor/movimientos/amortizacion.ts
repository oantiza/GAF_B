import { definirEnajenacion } from "./comun";

/** Amortización o vencimiento de un bono: sale el nominal y entra el efectivo de la devolución. */
export const amortizacion = definirEnajenacion({
  tipo: "amortizacion",
  nombre: "Amortización o vencimiento",
  grupo: "corporativas",
  descripcion: "El emisor devuelve el nominal de un bono, al vencimiento o antes. Resta el nominal y suma el efectivo cobrado.",
  orden: 47,
  conRetencion: true,
  rotuloDeTitulos: "Nominal amortizado"
});
