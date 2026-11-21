import { d } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { divisaDelEfectivo } from "../modelo";
import { erroresDeForma, requiereImporte } from "./comun";

/**
 * Una retención o un impuesto que el banco apunta suelto en la cuenta (no dentro de un
 * dividendo o un reembolso). Negativo si se carga; positivo si es una devolución.
 * El gestor no calcula impuestos: solo registra el movimiento de efectivo.
 */
export const retencion: DefinicionDeMovimiento = {
  tipo: "retencion",
  nombre: "Retención o impuesto",
  grupo: "efectivo",
  descripcion: "Una retención fiscal o un impuesto apuntado en la cuenta. Negativo si se carga, positivo si se devuelve. Solo se registra: el gestor no calcula impuestos.",
  orden: 61,
  signoDelEfectivo: "libre",
  campos: [
    { campo: "importe", obligatorio: true, rotulo: "Importe" },
    { campo: "activo", obligatorio: false, ayuda: "Solo si la retención es de un activo concreto." },
    { campo: "fechaValor", obligatorio: false },
    { campo: "divisa", obligatorio: false }
  ],
  validar(movimiento, contexto) {
    const errores = erroresDeForma(movimiento);
    requiereImporte(movimiento, "libre", errores);
    if (movimiento.activoId && !contexto.activo(movimiento.activoId)) errores.push("El activo del movimiento no está en la cartera.");
    return errores;
  },
  efectos(movimiento, contexto) {
    const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
    const importe = d(movimiento.importe!);
    return [
      { clase: "efectivo", divisa, importe },
      /* El coste lleva el signo contrario al del efectivo: una devolución es un coste negativo. */
      { clase: "coste", categoria: "impuesto", activoId: movimiento.activoId, divisa, importe: importe.times(-1), yaDescontado: false }
    ];
  }
};
