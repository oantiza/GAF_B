/** Hoja «Posiciones»: las posiciones abiertas a la fecha, con todos sus campos. */
import { aNumero } from "../../motor/decimal";
import { NOMBRE_DEL_TIPO_DE_ACTIVO } from "../../motor/modelo";
import { fuenteDelPrecio } from "../formato";
import { entero, fecha, importe, porcentaje, precio, titulos, type Celda, type HojaDelExcel } from "./celdas";

export const hojaPosiciones: HojaDelExcel = {
  nombre: "Posiciones",
  anchos: [42, 15, 10, 7, 14, 12, 16, 10, 14, 9, 14, 13, 14, 10, 14, 14, 12, 12],
  filas: ({ analisis }) => [
    /* «Producto»: fondo, ETF, acción o bono, como en la pantalla (apartado 6 del sistema). */
    ["Activo", "ISIN", "Producto", "Divisa", "Títulos", "Precio", "Fuente del precio", "Antigüedad (días)", "Valor", "Peso", "Coste", "Precio medio", "Latente", "Latente %", "Resultado del periodo", "Ingresos del periodo", "Contribución", "Desde"],
    ...analisis.posiciones.map((p): Celda[] => [
      p.activo.nombre,
      p.activo.isin ?? "",
      NOMBRE_DEL_TIPO_DE_ACTIVO[p.activo.tipo],
      p.activo.divisa,
      titulos(aNumero(p.titulos)),
      /*
       * Una posición sin precio (20-11-2026): su precio, su valor, su peso, su latente, su resultado del periodo y su
       * contribución no se conocen, y sus celdas van VACÍAS, que es como dice este libro que una cifra falta (`celdas.ts`):
       * antes llevaban 0, 0, 0, −coste, −100 %, −lo pagado y sus puntos. El texto «Falta el dato» es de la pantalla y del
       * papel; aquí lo dice la columna de la fuente, «Sin precio». La antigüedad de un precio que no hay también va vacía, y
       * los ingresos del periodo, que son dinero cobrado, se dan.
       */
      precio(p.precio),
      fuenteDelPrecio(p.fuente),
      entero(p.precio === null ? null : p.antiguedad),
      importe(p.valor),
      porcentaje(p.peso),
      importe(p.coste),
      precio(p.precioMedio),
      importe(p.latente),
      porcentaje(p.latentePct),
      importe(p.resultadoDelPeriodo),
      importe(p.ingresosDelPeriodo),
      porcentaje(p.contribucion),
      fecha(p.desde)
    ])
  ]
};
