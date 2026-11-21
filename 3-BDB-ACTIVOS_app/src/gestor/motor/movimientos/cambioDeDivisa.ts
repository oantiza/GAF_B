import { d, esDecimal } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { divisaDelEfectivo } from "../modelo";
import { erroresDeForma, requiereImporte } from "./comun";

/**
 * Cambio de divisa dentro de la cuenta de efectivo: sale un importe en una divisa y entra
 * otro en otra. No hay resultado declarado: la diferencia con el cambio de mercado del día
 * aparece sola en el efecto divisa.
 */
export const cambioDeDivisa: DefinicionDeMovimiento = {
  tipo: "cambioDeDivisa",
  nombre: "Cambio de divisa",
  grupo: "efectivo",
  descripcion: "Se convierte efectivo de una divisa a otra dentro de la cuenta. Sale un importe en una divisa y entra el contravalor en la otra.",
  orden: 30,
  signoDelEfectivo: -1,
  cambiaDeDivisa: true,
  campos: [
    { campo: "divisa", obligatorio: true, rotulo: "Divisa que sale" },
    { campo: "importe", obligatorio: true, rotulo: "Importe que sale" },
    { campo: "destinoDivisa", obligatorio: true, rotulo: "Divisa que entra" },
    { campo: "destinoImporte", obligatorio: true, rotulo: "Importe que entra" },
    { campo: "fechaValor", obligatorio: false }
  ],
  validar(movimiento, contexto) {
    const errores = erroresDeForma(movimiento);
    requiereImporte(movimiento, -1, errores);
    const origen = divisaDelEfectivo(movimiento, contexto.divisaBase);
    const destino = movimiento.destino?.divisa;
    if (!destino) errores.push("Falta la divisa que entra.");
    else if (destino === origen) errores.push("La divisa que entra tiene que ser distinta de la que sale.");
    const entra = movimiento.destino?.importe;
    if (entra === undefined || entra === "") errores.push("Falta el importe que entra.");
    else if (esDecimal(entra) && d(entra).lte(0)) errores.push("El importe que entra tiene que ser mayor que cero.");
    return errores;
  },
  efectos(movimiento, contexto) {
    return [
      { clase: "efectivo", divisa: divisaDelEfectivo(movimiento, contexto.divisaBase), importe: d(movimiento.importe!) },
      { clase: "efectivo", divisa: movimiento.destino!.divisa!, importe: d(movimiento.destino!.importe!) }
    ];
  }
};
