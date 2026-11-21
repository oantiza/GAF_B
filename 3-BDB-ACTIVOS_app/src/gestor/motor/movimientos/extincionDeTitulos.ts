import { CERO, d } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { erroresDeForma, requiereActivo, requierePositivo } from "./comun";

/**
 * Títulos que dejan de existir sin cobrar nada: derechos de suscripción que se ejercen o
 * caducan, un warrant que vence sin valor. No es una retirada —nada sale de la cartera hacia
 * el cliente— ni una venta con efectivo: los títulos se dan de baja y lo que costaron queda
 * como resultado. En unos derechos ejercidos, su valor pasa a las acciones nuevas, que entran
 * con su propio movimiento.
 */
export const extincionDeTitulos: DefinicionDeMovimiento = {
  tipo: "extincionDeTitulos",
  nombre: "Títulos ejercidos o caducados",
  grupo: "valores",
  descripcion: "Derechos que se ejercen o caducan, o títulos que vencen sin valor. Resta títulos sin tocar el efectivo y no cuenta como retirada.",
  orden: 90,
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
      externo: false,
      realiza: true
    }];
  }
};
