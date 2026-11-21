import { definirAdquisicion } from "./comun";

/** Suscripción de un fondo: sale efectivo y entran participaciones. */
export const suscripcion = definirAdquisicion({
  tipo: "suscripcion",
  nombre: "Suscripción de fondo",
  grupo: "compraventa",
  descripcion: "Se suscriben participaciones de un fondo. Resta efectivo y suma participaciones.",
  orden: 36,
  rotuloDeTitulos: "Participaciones",
  rotuloDePrecio: "Valor liquidativo"
});
