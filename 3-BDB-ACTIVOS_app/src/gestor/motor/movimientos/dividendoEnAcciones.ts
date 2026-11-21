import { CERO, d } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { erroresDeForma, requiereActivo, requierePositivo } from "./comun";

/**
 * Dividendo en acciones (scrip dividend) o acciones liberadas: entran títulos sin coste.
 * No es una aportación: el valor ya estaba en la posición, repartido ahora entre más títulos.
 */
export const dividendoEnAcciones: DefinicionDeMovimiento = {
  tipo: "dividendoEnAcciones",
  nombre: "Dividendo en acciones",
  grupo: "valores",
  descripcion: "La empresa entrega acciones nuevas en lugar de efectivo. Suma títulos sin coste y no toca la cuenta de efectivo.",
  orden: 37,
  signoDelEfectivo: 0,
  campos: [
    { campo: "activo", obligatorio: true },
    { campo: "titulos", obligatorio: true, rotulo: "Títulos recibidos" }
  ],
  validar(movimiento, contexto) {
    const errores = erroresDeForma(movimiento);
    requiereActivo(movimiento, contexto, errores);
    requierePositivo(movimiento.titulos, "el número de títulos recibidos", errores);
    return errores;
  },
  efectos(movimiento, contexto) {
    return [{
      clase: "alta",
      activoId: movimiento.activoId!,
      titulos: d(movimiento.titulos!),
      pagado: { divisa: contexto.divisaBase, importe: CERO },
      externo: false
    }];
  }
};
