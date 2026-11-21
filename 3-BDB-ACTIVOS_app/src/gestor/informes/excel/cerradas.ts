/** Hoja «Posiciones cerradas»: los tramos vendidos en el periodo, por activo, y el resultado realizado. */
import { fecha, importe, porcentaje, titulos, type Celda, type HojaDelExcel } from "./celdas";

export const hojaCerradas: HojaDelExcel = {
  nombre: "Posiciones cerradas",
  anchos: [42, 15, 13, 15, 15, 15, 11, 13, 13, 14, 14],
  filas: ({ analisis }) => [
    ["Activo", "ISIN", "Títulos", "Coste", "Cobrado", "Resultado", "Resultado %", "Primera compra", "Última venta", "Cerrada del todo", "Coste incompleto"],
    ...analisis.cerradas.map((c): Celda[] => [
      c.activo?.nombre ?? c.activoId,
      c.activo?.isin ?? "",
      titulos(c.titulos),
      importe(c.incompleto ? null : c.coste),
      importe(c.cobrado),
      importe(c.incompleto ? null : c.resultado),
      porcentaje(c.resultadoPct),
      fecha(c.primeraCompra),
      fecha(c.ultimaVenta),
      c.cerradaDelTodo ? "Sí" : "No",
      c.incompleto ? "Sí" : "No"
    ]),
    ["Resultado realizado", null, null, null, null, importe(analisis.realizado)]
  ]
};
