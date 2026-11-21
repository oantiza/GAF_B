import { d } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { divisaDelEfectivo } from "../modelo";
import { erroresDeForma, requiereImporte } from "./comun";

/** Una comisión o un gasto cargado en la cuenta: custodia, asesoramiento, mantenimiento. */
export const comision: DefinicionDeMovimiento = {
  tipo: "comision",
  nombre: "Comisión o gasto",
  grupo: "efectivo",
  descripcion: "Un cargo de la entidad: custodia, asesoramiento, mantenimiento. Resta rentabilidad. Se puede asociar a un activo.",
  orden: 60,
  signoDelEfectivo: -1,
  campos: [
    { campo: "importe", obligatorio: true, rotulo: "Importe cargado" },
    { campo: "activo", obligatorio: false, ayuda: "Solo si el cargo es de un activo concreto." },
    { campo: "fechaValor", obligatorio: false },
    { campo: "divisa", obligatorio: false }
  ],
  validar(movimiento, contexto) {
    const errores = erroresDeForma(movimiento);
    requiereImporte(movimiento, -1, errores);
    if (movimiento.activoId && !contexto.activo(movimiento.activoId)) errores.push("El activo del movimiento no está en la cartera.");
    return errores;
  },
  efectos(movimiento, contexto) {
    const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
    const importe = d(movimiento.importe!);
    return [
      { clase: "efectivo", divisa, importe },
      { clase: "coste", categoria: "comision", activoId: movimiento.activoId, divisa, importe: importe.abs(), yaDescontado: false }
    ];
  }
};
