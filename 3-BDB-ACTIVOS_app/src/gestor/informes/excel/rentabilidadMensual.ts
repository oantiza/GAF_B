/**
 * Hoja «Rentabilidad mensual»: años en filas, meses en columnas y el total del año (TWR, toda la historia). Si alguna
 * posición no tiene precio, una última fila, fuera del filtro, dice que estas cifras la cuentan como cero.
 */
import { notaDeLasCifrasQueLasCuentanComoCero } from "../../motor/sinPrecio";
import { MESES_CORTOS } from "../formato";
import { porcentaje, type Celda, type HojaDelExcel } from "./celdas";

export const hojaRentabilidadMensual: HojaDelExcel = {
  nombre: "Rentabilidad mensual",
  anchos: [8, ...MESES_CORTOS.map(() => 9), 10, 14],
  /* El filtro, solo sobre la tabla de los años: la nota de debajo no es una fila suya. */
  filasDelFiltro: ({ analisis }) => analisis.porMeses.length + 1,
  filas: ({ analisis }) => {
    const comoCero = notaDeLasCifrasQueLasCuentanComoCero(analisis);
    return [
      ["Año", ...MESES_CORTOS, "Total", "Año incompleto"],
      ...analisis.porMeses.map((anio): Celda[] => [anio.anio, ...anio.meses.map((mes) => (mes ? porcentaje(mes.rentabilidad) : null)), porcentaje(anio.total), anio.parcial ? "Sí" : "No"]),
      ...(comoCero ? [[], [comoCero]] : [])
    ];
  }
};
