/* eslint-disable react-refresh/only-export-components */
/**
 * «Costes del servicio»: cada cargo de la cuenta del periodo (custodia, administración,
 * asesoramiento, otros cargos), con su fecha, su concepto y su importe. Con muchos, agrupados por
 * concepto. El total es el del resumen: el análisis lo da como la suma de estas mismas líneas.
 */
import { fecha, importe, numero } from "../../../../core/formato";
import { Parrafo, Tabla } from "../../../../reports/plantilla";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { conceptoDelCargo } from "./comun";

/** A partir de cuántos cargos se agrupan por concepto. */
export const CARGOS_SIN_AGRUPAR = 15;

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const ic = analisis.ingresosYCostes;
  const cargos = ic.cargosDelServicio;
  if (cargos.length > CARGOS_SIN_AGRUPAR) {
    const grupos = new Map<string, { cargos: number; importe: number }>();
    for (const cargo of cargos) {
      const concepto = conceptoDelCargo(cargo);
      const grupo = grupos.get(concepto) ?? { cargos: 0, importe: 0 };
      grupo.cargos += 1;
      grupo.importe += cargo.importe;
      grupos.set(concepto, grupo);
    }
    const filas = [...grupos.entries()]
      .sort((a, b) => b[1].importe - a[1].importe)
      .map(([concepto, grupo]) => ({ celdas: [concepto, numero(grupo.cargos), importe(grupo.importe, { divisa })] }));
    return (
      <>
        <Parrafo>{`Lo cargado en su cuenta por el servicio en el periodo: ${cargos.length} cargos, agrupados por concepto.`}</Parrafo>
        <Tabla
          columnas={[{ titulo: "Concepto", ancho: 58 }, { titulo: "Cargos", ancho: 16, cifra: true }, { titulo: "Importe", ancho: 26, cifra: true }]}
          filas={filas}
          total={["Total de costes del servicio", numero(cargos.length), importe(ic.costesDelServicio, { divisa })]}
        />
      </>
    );
  }
  return (
    <>
      <Parrafo>{cargos.length === 1 ? "El único cargo del servicio en su cuenta en el periodo." : `Los ${cargos.length} cargos del servicio en su cuenta en el periodo, por fecha.`}</Parrafo>
      <Tabla
        columnas={[{ titulo: "Fecha", ancho: 16 }, { titulo: "Concepto", ancho: 58 }, { titulo: "Importe", ancho: 26, cifra: true }]}
        filas={cargos.map((cargo) => ({ celdas: [fecha(cargo.fecha), conceptoDelCargo(cargo), importe(cargo.importe, { divisa })] }))}
        total={["", "Total de costes del servicio", importe(ic.costesDelServicio, { divisa })]}
      />
    </>
  );
}

export const servicio: SeccionDeInforme = {
  id: "servicio",
  titulo: "Costes del servicio",
  procede: (datos) => hayCifras(datos) && datos.analisis.ingresosYCostes.cargosDelServicio.length > 0,
  Contenido
};
