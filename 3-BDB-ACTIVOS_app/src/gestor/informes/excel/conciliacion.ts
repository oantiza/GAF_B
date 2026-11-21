/** Hoja «Conciliación»: cada extracto, si cuadra y, si no, cada diferencia. */
import { aNumero } from "../../motor/decimal";
import { entero, fecha, titulos, type Celda, type HojaDelExcel } from "./celdas";

export const hojaConciliacion: HojaDelExcel = {
  nombre: "Conciliación",
  anchos: [12, 22, 28, 8, 12, 40, 10, 15, 15, 15],
  filas: ({ analisis }) => [
    ["Fecha del extracto", "Entidad", "Documento", "Cuadra", "Líneas comprobadas", "Concepto", "Clase", "En el libro", "En el extracto", "Diferencia"],
    ...analisis.integridad.conciliaciones.flatMap((c): Celda[][] => {
      const cabeza: Celda[] = [fecha(c.extracto.fecha), c.extracto.entidad ?? "", c.extracto.documento ?? "", c.cuadra ? "Sí" : "No", entero(c.comprobadas)];
      if (c.diferencias.length === 0) return [[...cabeza, "Sin diferencias"]];
      return c.diferencias.map((dif) => [...cabeza, dif.concepto, dif.clase === "titulos" ? "Títulos" : "Efectivo", titulos(aNumero(dif.enElLibro)), titulos(aNumero(dif.enElExtracto)), titulos(aNumero(dif.diferencia))]);
    })
  ]
};
