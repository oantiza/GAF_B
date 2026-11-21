import { CERO, d } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { erroresDeForma, requiereActivo, requierePositivo } from "./comun";

/**
 * Salida de títulos sin efectivo: una posición que se entrega a otra entidad. Su valor de
 * mercado de ese día cuenta como retirada. No realiza resultado: no es una venta.
 */
export const salidaDeTitulos: DefinicionDeMovimiento = {
  tipo: "salidaDeTitulos",
  nombre: "Salida de títulos",
  grupo: "valores",
  descripcion: "Se entregan títulos a otra entidad sin cobrar efectivo. Su valor cuenta como retirada y no se considera una venta.",
  orden: 89,
  signoDelEfectivo: 0,
  campos: [
    { campo: "activo", obligatorio: true },
    { campo: "titulos", obligatorio: true }
  ],
  validar(movimiento, contexto) {
    const errores = erroresDeForma(movimiento);
    requiereActivo(movimiento, contexto, errores);
    requierePositivo(movimiento.titulos, "el número de títulos", errores);
    return errores;
  },
  efectos(movimiento, contexto) {
    return [{
      clase: "baja",
      activoId: movimiento.activoId!,
      titulos: d(movimiento.titulos!),
      cobrado: { divisa: contexto.divisaBase, importe: CERO },
      externo: true,
      realiza: false
    }];
  }
};
