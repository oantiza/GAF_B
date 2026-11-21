/** Hoja «Movimientos»: todos los del periodo, con todos sus campos. */
import { movimientosDelPeriodo } from "../movimientos";
import { fecha, importe, precio, titulos, type Celda, type HojaDelExcel } from "./celdas";

export const hojaMovimientos: HojaDelExcel = {
  nombre: "Movimientos",
  anchos: [12, 12, 18, 40, 15, 13, 13, 14, 7, 11, 11, 11, 12, 10, 14, 34, 40, 12, 14],
  filas: (datos) => [
    ["Fecha operación", "Fecha valor", "Tipo", "Activo", "ISIN", "Títulos", "Precio", "Importe", "Divisa", "Comisión", "Gastos", "Retención", "Cupón corrido", "Cambio", "Valor", "Destino", "Nota", "Origen", "Id"],
    ...movimientosDelPeriodo(datos).map((m): Celda[] => [
      fecha(m.fechaOperacion),
      fecha(m.fechaValor),
      m.operacion,
      m.activo,
      m.isin ?? "",
      titulos(m.titulos),
      precio(m.precio),
      importe(m.importe),
      m.divisa,
      importe(m.comision),
      importe(m.gastos),
      importe(m.retencion),
      importe(m.cuponCorrido),
      precio(m.cambio),
      importe(m.valor),
      m.destino,
      m.nota,
      m.origen,
      m.id
    ])
  ]
};
