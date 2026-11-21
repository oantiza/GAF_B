import { definirEnajenacion } from "./comun";

/** Reembolso de un fondo: salen participaciones y entra efectivo, neto de la retención si la hay. */
export const reembolso = definirEnajenacion({
  tipo: "reembolso",
  nombre: "Reembolso de fondo",
  grupo: "compraventa",
  descripcion: "Se reembolsan participaciones de un fondo. Resta participaciones y suma el efectivo cobrado; la retención, si la hay, se anota aparte.",
  orden: 46,
  conRetencion: true,
  rotuloDeTitulos: "Participaciones",
  rotuloDePrecio: "Valor liquidativo"
});
