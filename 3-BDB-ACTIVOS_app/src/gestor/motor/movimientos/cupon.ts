import { definirIngreso } from "./comun";

/** Cupón de un bono cobrado en efectivo. */
export const cupon = definirIngreso({
  tipo: "cupon",
  nombre: "Cupón",
  categoria: "cupon",
  descripcion: "Un bono paga su cupón. Suma a la cuenta el importe neto; la retención se anota para conocer el bruto.",
  orden: 42
});
