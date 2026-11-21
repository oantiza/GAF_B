import { d } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { divisaDelEfectivo } from "../modelo";
import { erroresDeForma, requiereImporte } from "./comun";

/** El cliente ingresa dinero en la cuenta de efectivo. Es un flujo externo, no resultado. */
export const aportacion: DefinicionDeMovimiento = {
  tipo: "aportacion",
  nombre: "Aportación",
  grupo: "efectivo",
  descripcion: "El cliente ingresa dinero en la cuenta de efectivo. Aumenta el patrimonio, pero no es una ganancia.",
  orden: 10,
  signoDelEfectivo: 1,
  campos: [
    { campo: "importe", obligatorio: true, rotulo: "Importe aportado" },
    { campo: "fechaValor", obligatorio: false },
    { campo: "divisa", obligatorio: false }
  ],
  validar(movimiento) {
    const errores = erroresDeForma(movimiento);
    requiereImporte(movimiento, 1, errores);
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
