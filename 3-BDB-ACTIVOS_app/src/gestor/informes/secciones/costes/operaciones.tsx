/* eslint-disable react-refresh/only-export-components */
/**
 * «Costes de las operaciones»: cada compra, venta o cobro que llevó comisión o gastos, con la
 * suma de los dos. El total es `costesDeOperacion`: el análisis lo da como la suma de estas líneas.
 */
import { fecha, importe } from "../../../../core/formato";
import { Parrafo, Tabla } from "../../../../reports/plantilla";
import { nombreDelTipo } from "../../../motor/movimientos/registro";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { nombreDelActivo } from "./comun";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const ic = analisis.ingresosYCostes;
  const lineas = ic.costesPorOperacion;
  return (
    <>
      <Parrafo>{`${lineas.length === 1 ? "La única operación del periodo con comisión o gastos." : `Las ${lineas.length} operaciones del periodo con comisión o gastos, por fecha.`} Estos costes no se cargan aparte: van dentro del importe pagado en una compra o descontados de lo cobrado en una venta.`}</Parrafo>
      <Tabla
        columnas={[{ titulo: "Fecha", ancho: 13 }, { titulo: "Operación", ancho: 18 }, { titulo: "Activo", ancho: 45 }, { titulo: "Comisión y gastos", ancho: 24, cifra: true }]}
        filas={lineas.map((linea) => ({ celdas: [fecha(linea.fecha), nombreDelTipo(linea.tipo), nombreDelActivo(datos, linea.activoId), importe(linea.importe, { divisa })] }))}
        total={["", "", "Total de costes de las operaciones", importe(ic.costesDeOperacion, { divisa })]}
      />
    </>
  );
}

export const operaciones: SeccionDeInforme = {
  id: "operaciones",
  titulo: "Costes de las operaciones",
  procede: (datos) => hayCifras(datos) && datos.analisis.ingresosYCostes.costesPorOperacion.length > 0,
  Contenido
};
