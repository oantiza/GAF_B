/* eslint-disable react-refresh/only-export-components */
/**
 * «Cómo se han calculado»: notas cortas sobre el periodo, la base de los porcentajes, la
 * estimación del coste corriente y lo que este informe no es.
 */
import { fechaLarga, importe } from "../../../../core/formato";
import { esDemostracion } from "../../../demo/carteraDemo";
import { periodoEnPalabras } from "../../formato";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { Vinetas } from "../piezas";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const ic = analisis.ingresosYCostes;
  const divisa = analisis.cartera.divisaBase;
  return (
    <Vinetas
      puntos={[
        `Periodo: ${periodoEnPalabras(analisis).replace(/^Del/, "del")}, ambos incluidos. Cuenta lo apuntado en la cartera en esos días.`,
        `Patrimonio medio: la media de lo que ha valido la cartera al cierre de cada día del periodo, ${importe(ic.patrimonioMedio, { divisa }) ?? ""}. Es la base de los porcentajes.`,
        "Costes del servicio y de las operaciones: los que constan en los movimientos de la cartera, tal como se han apuntado o importado de los extractos de su entidad.",
        "Coste corriente de los fondos y ETF: es una estimación. Se toma el porcentaje anual publicado por cada fondo y se aplica a lo que ha valido de media en el periodo, en proporción a los días del periodo sobre un año. El coste real puede ser algo distinto.",
        "No incluye los costes que no pasan por la cuenta ni por los fondos, como los que se pagan aparte con otra factura.",
        "Las cifras van redondeadas al céntimo: la suma de las líneas de una tabla puede diferir en un céntimo de su total.",
        "Este informe no es un documento fiscal ni asesoramiento fiscal.",
        `Datos a ${fechaLarga(analisis.fecha) ?? analisis.fecha}. Informe generado el ${fechaLarga(datos.generado) ?? datos.generado}.`,
        ...(esDemostracion(datos.cartera) ? ["Cartera de demostración: sus activos, precios y movimientos son inventados."] : [])
      ]}
    />
  );
}

export const metodo: SeccionDeInforme = {
  id: "metodo",
  titulo: "Cómo se han calculado",
  juntoAlTitulo: 200,
  procede: hayCifras,
  Contenido
};
