import { d } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { divisaDelEfectivo } from "../modelo";
import { erroresDeForma, requiereImporte } from "./comun";

/** El cliente saca dinero de la cuenta de efectivo. Es un flujo externo, no una pérdida. */
export const retirada: DefinicionDeMovimiento = {
  tipo: "retirada",
  nombre: "Retirada",
  grupo: "efectivo",
  descripcion: "El cliente saca dinero de la cuenta de efectivo. Reduce el patrimonio, pero no es una pérdida.",
  orden: 90,
  signoDelEfectivo: -1,
  campos: [
    { campo: "importe", obligatorio: true, rotulo: "Importe retirado" },
    { campo: "fechaValor", obligatorio: false },
    { campo: "divisa", obligatorio: false }
  ],
  validar(movimiento) {
    const errores = erroresDeForma(movimiento);
    requiereImporte(movimiento, -1, errores);
    return errores;
  },
  efectos(movimiento, contexto) {
    const divisa = divisaDelEfectivo(movimiento, contexto.divisaBase);
    const importe = d(movimiento.importe!);
    return [
      { clase: "efectivo", divisa, importe },
      { clase: "flujoExterno", divisa, importe }
    ];
  }
};
