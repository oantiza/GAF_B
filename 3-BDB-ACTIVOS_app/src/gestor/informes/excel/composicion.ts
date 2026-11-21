/**
 * Hoja «Composición»: los cinco repartos (valor y peso) y la concentración. Si alguna posición no tiene precio, una última
 * fila dice que el reparto no la incluye.
 */
import type { Reparto } from "../../motor/composicion";
import { notaDeLasSinPrecio } from "../../motor/sinPrecio";
import { importe, porcentaje, type Celda, type HojaDelExcel } from "./celdas";

const filasDe = (nombre: string, reparto: Reparto): Celda[][] => reparto.lineas.map((linea) => [nombre, linea.nombre, importe(linea.valor), porcentaje(linea.peso)]);

export const hojaComposicion: HojaDelExcel = {
  nombre: "Composición",
  anchos: [26, 34, 16, 10],
  filas: ({ analisis }) => {
    const c = analisis.composicion;
    const noIncluye = notaDeLasSinPrecio(analisis, "El reparto");
    return [
      ["Reparto", "Categoría", "Valor", "Peso"],
      ...filasDe("Producto", c.porTipoDeProducto),
      ...filasDe("Clase de activo", c.porClaseDeActivo),
      ...filasDe("Divisa", c.porDivisa),
      ...filasDe("Región (renta variable)", c.porRegion),
      ...filasDe("Sector (renta variable)", c.porSector),
      [],
      ["Concentración", "Mayor posición", null, porcentaje(c.mayorPosicion)],
      ["Concentración", "Cinco mayores", null, porcentaje(c.cincoMayores)],
      ["Renta variable", "Sobre el total de la cartera", null, porcentaje(c.rentaVariable)],
      ...(noIncluye ? [[], [noIncluye]] : [])
    ];
  }
};
