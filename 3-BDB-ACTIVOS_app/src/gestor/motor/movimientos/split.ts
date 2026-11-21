import { d } from "../decimal";
import type { DefinicionDeMovimiento } from "../efectos";
import { erroresDeForma, requiereActivo, requierePositivo } from "./comun";

/**
 * Split o contrasplit: cada título pasa a ser `razon` títulos. El coste total no cambia.
 *
 * `serieAjustada` (sí por defecto): la serie de precios de la plataforma ya viene dividida
 * por el split hacia atrás, como hacen casi todos los proveedores. En ese caso la
 * valoración anterior al split usa los títulos ya multiplicados, para que títulos × precio
 * dé el valor que había de verdad.
 */
export const split: DefinicionDeMovimiento = {
  tipo: "split",
  nombre: "Split o contrasplit",
  grupo: "corporativas",
  descripcion: "La empresa divide o agrupa sus acciones. Cambia el número de títulos y no el valor: 2 es un split de 2 por 1; 0,1 es un contrasplit de 1 por 10.",
  orden: 5,
  signoDelEfectivo: 0,
  campos: [
    { campo: "activo", obligatorio: true },
    { campo: "razon", obligatorio: true, rotulo: "Títulos nuevos por cada antiguo", ayuda: "2 en un split de 2 por 1; 0,1 en un contrasplit de 1 por 10." }
  ],
  validar(movimiento, contexto) {
    const errores = erroresDeForma(movimiento);
    requiereActivo(movimiento, contexto, errores);
    requierePositivo(movimiento.razon, "la proporción del split", errores);
    return errores;
  },
  efectos(movimiento) {
    return [{ clase: "ajusteDeTitulos", activoId: movimiento.activoId!, factor: d(movimiento.razon!), serieAjustada: movimiento.serieAjustada ?? true }];
  }
};
