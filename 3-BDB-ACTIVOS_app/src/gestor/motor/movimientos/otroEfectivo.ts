import { CERO, d } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { divisaDelEfectivo } from "../modelo";
import { erroresDeForma, requiereImporte } from "./comun";

/**
 * Un apunte de efectivo que no encaja en ningún otro tipo: una regularización, una
 * bonificación, un cargo sin clasificar de un extracto. Cuenta como resultado (no como
 * aportación ni retirada) y la importación lo deja marcado para que el asesor lo revise.
 */
export const otroEfectivo: DefinicionDeMovimiento = {
  tipo: "otroEfectivo",
  nombre: "Otro cargo o abono",
  grupo: "efectivo",
  descripcion: "Un apunte de efectivo que no es ninguno de los demás: una regularización, una bonificación. Cuenta como resultado, no como aportación.",
  orden: 62,
  signoDelEfectivo: "libre",
  campos: [
    { campo: "importe", obligatorio: true, rotulo: "Importe" },
    { campo: "fechaValor", obligatorio: false },
    { campo: "divisa", obligatorio: false }
  ],
  validar(movimiento) {
    const errores = erroresDeForma(movimiento);
    requiereImporte(movimiento, "libre", errores);
    return errores;
  },
  efectos(movimiento, contexto) {
    const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
    const importe = d(movimiento.importe!);
    return [
      { clase: "efectivo", divisa, importe },
      importe.gt(0)
        ? { clase: "ingreso", categoria: "otro", divisa, bruto: importe, retencion: CERO, neto: importe }
        : { clase: "coste", categoria: "gasto", divisa, importe: importe.abs(), yaDescontado: false }
    ];
  }
};
