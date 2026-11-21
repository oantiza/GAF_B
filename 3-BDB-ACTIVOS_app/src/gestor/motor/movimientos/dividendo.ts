import { definirIngreso } from "./comun";

/** Dividendo cobrado en efectivo: suma el neto; la retención se anota para el bruto. */
export const dividendo = definirIngreso({
  tipo: "dividendo",
  nombre: "Dividendo",
  categoria: "dividendo",
  descripcion: "Un activo paga un dividendo en efectivo. Suma a la cuenta el importe neto; la retención se anota para conocer el bruto.",
  orden: 41
});
