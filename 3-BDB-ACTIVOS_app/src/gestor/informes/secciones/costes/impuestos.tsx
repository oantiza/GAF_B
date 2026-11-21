/* eslint-disable react-refresh/only-export-components */
/**
 * «Impuestos retenidos»: aparte de los costes, porque no son un coste del servicio ni de los
 * productos. Las retenciones sobre dividendos, cupones e intereses y los impuestos apuntados en la
 * cuenta, por su origen; el total es `ingresosYCostes.impuestos`.
 */
import { importe } from "../../../../core/formato";
import { Parrafo, Tabla } from "../../../../reports/plantilla";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { Pequena } from "../piezas";
import { algo } from "./comun";

function lineas(datos: DatosDelInforme): Array<{ origen: string; importe: number }> {
  const ic = datos.analisis.ingresosYCostes;
  return [
    { origen: "Retenciones sobre dividendos", importe: ic.dividendos.retencion },
    { origen: "Retenciones sobre cupones", importe: ic.cupones.retencion },
    { origen: "Retenciones sobre intereses", importe: ic.intereses.retencion },
    { origen: "Otros impuestos y retenciones apuntados en la cuenta", importe: ic.impuestosApuntados }
  ].filter((linea) => algo(linea.importe));
}

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  return (
    <>
      <Parrafo>Los impuestos no son un coste de la cartera y no están sumados en los costes de este informe. Se dan aquí, aparte, para que vea todo lo que se ha descontado de su cartera en el periodo.</Parrafo>
      <Tabla
        columnas={[{ titulo: "Origen", ancho: 72 }, { titulo: "Importe", ancho: 28, cifra: true }]}
        filas={lineas(datos).map((linea) => ({ celdas: [linea.origen, importe(linea.importe, { divisa })] }))}
        total={["Total de impuestos retenidos", importe(analisis.ingresosYCostes.impuestos, { divisa })]}
      />
      <Pequena separada>Los dividendos, cupones e intereses del informe de su cartera ya son netos de estas retenciones. Esto no es un documento fiscal: para su declaración valen los certificados de su entidad.</Pequena>
    </>
  );
}

export const impuestos: SeccionDeInforme = {
  id: "impuestos",
  titulo: "Impuestos retenidos",
  juntoAlTitulo: 150,
  procede: (datos) => hayCifras(datos) && lineas(datos).length > 0,
  Contenido
};
