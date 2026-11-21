import { definirEnajenacion } from "./comun";

/** Venta de acciones, ETF o bonos: salen títulos (los más antiguos primero) y entra efectivo. */
export const venta = definirEnajenacion({
  tipo: "venta",
  nombre: "Venta",
  grupo: "compraventa",
  descripcion: "Se venden acciones, ETF o bonos. Resta títulos, empezando por los más antiguos, y suma efectivo neto de comisiones.",
  orden: 45,
  conCuponCorrido: true
});
