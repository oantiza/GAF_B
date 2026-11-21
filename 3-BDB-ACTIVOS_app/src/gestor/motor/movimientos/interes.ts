import { d, dOCero } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { divisaDelEfectivo } from "../modelo";
import { erroresDeForma, requiereImporte } from "./comun";

/** Intereses de la cuenta de efectivo: a favor (positivo) o en contra (negativo). */
export const interes: DefinicionDeMovimiento = {
  tipo: "interes",
  nombre: "Intereses de la cuenta",
  grupo: "efectivo",
  descripcion: "Intereses que paga o cobra la cuenta de efectivo. Positivo si se abonan, negativo si se cargan.",
  orden: 40,
  signoDelEfectivo: "libre",
  campos: [
    { campo: "importe", obligatorio: true, rotulo: "Importe neto" },
    { campo: "retencion", obligatorio: false },
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
    const neto = d(movimiento.importe!);
    const retencion = dOCero(movimiento.retencion);
    return [
      { clase: "efectivo", divisa, importe: neto },
      { clase: "ingreso", categoria: "interes", divisa, bruto: neto.plus(retencion), retencion, neto }
    ];
  }
};
