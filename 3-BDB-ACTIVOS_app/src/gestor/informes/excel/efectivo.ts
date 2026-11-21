/** Hoja «Efectivo»: saldo por divisa, lo que está en tránsito y su valor en la divisa base. */
import { aNumero } from "../../motor/decimal";
import { importe, porcentaje, type Celda, type HojaDelExcel } from "./celdas";

export const hojaEfectivo: HojaDelExcel = {
  nombre: "Efectivo",
  anchos: [14, 16, 16, 18, 10],
  filas: ({ analisis }) => [
    ["Divisa", "Saldo", "En tránsito", `Valor (${analisis.cartera.divisaBase})`, "Peso"],
    ...analisis.efectivo.porDivisa.map((linea): Celda[] => [linea.divisa, importe(aNumero(linea.saldo)), importe(aNumero(linea.enTransito)), importe(linea.valor), null]),
    ["Total", null, importe(analisis.efectivo.enTransito), importe(analisis.efectivo.total), porcentaje(analisis.efectivo.peso)]
  ]
};
