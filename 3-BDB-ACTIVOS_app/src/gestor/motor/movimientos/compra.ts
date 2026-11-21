import { definirAdquisicion } from "./comun";

/** Compra de acciones, ETF o bonos: sale efectivo y entran títulos. */
export const compra = definirAdquisicion({
  tipo: "compra",
  nombre: "Compra",
  grupo: "compraventa",
  descripcion: "Se compran acciones, ETF o bonos. Resta efectivo y suma títulos; el coste incluye comisiones y gastos.",
  orden: 35,
  conCuponCorrido: true
});
