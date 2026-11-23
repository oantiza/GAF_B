/* eslint-disable react-refresh/only-export-components */
/**
 * Ingresos y costes del periodo: dividendos, cupones, intereses y otros (bruto, retención,
 * neto); costes de operación, del servicio, coste corriente estimado con su cobertura e
 * impuestos; y los porcentajes sobre el patrimonio medio que da el análisis.
 */
import { View } from "@react-pdf/renderer";
import { importe, porcentaje } from "../../../../core/formato";
import { Tabla, type FilaDeTabla } from "../../../../reports/plantilla";
import type { LineaDeIngreso } from "../../../motor/analisis";
import { notaDelCosteCorrienteSinPrecio, notaDeLoContadoComoCero } from "../../../motor/sinPrecio";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { Pequena, Subtitulo } from "../piezas";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const euros = (valor: number | null) => importe(valor, { divisa });
  const ic = analisis.ingresosYCostes;
  const sinPrecioEnGastos = notaDelCosteCorrienteSinPrecio(analisis);
  const comoCero = notaDeLoContadoComoCero(analisis, { quien: "El patrimonio medio" });
  const linea = (rotulo: string, l: LineaDeIngreso): FilaDeTabla => ({ celdas: [rotulo, euros(l.bruto), euros(l.retencion), euros(l.neto)] });
  const costes: FilaDeTabla[] = [
    { celdas: ["Costes de operación (compras y ventas; van en el precio)", euros(ic.costesDeOperacion), ""] },
    { celdas: ["Costes del servicio (custodia, administración, asesoramiento)", euros(ic.costesDelServicio), ""] },
    { celdas: ["Costes explícitos", euros(ic.costesExplicitos), porcentaje(ic.costesExplicitosPct)] },
    {
      celdas: [
        {
          texto: "Coste corriente de los fondos (estimado; ya descontado del valor liquidativo)",
          apunte: `Cobertura: ${porcentaje(ic.coberturaDeGastosCorrientes, { decimales: 1 }) ?? ""} del valor medio invertido en fondos y ETF tiene coste corriente conocido (las acciones y los bonos no tienen y no entran en la cuenta).${sinPrecioEnGastos ? ` ${sinPrecioEnGastos}` : ""}`
        },
        euros(ic.gastosCorrientes),
        ""
      ]
    }
  ];
  return (
    <>
      <View wrap={false}>
        <Subtitulo>Ingresos</Subtitulo>
        <Tabla
          columnas={[{ titulo: "Concepto", ancho: 235 }, { titulo: "Bruto", ancho: 93, cifra: true }, { titulo: "Retención", ancho: 93, cifra: true }, { titulo: "Neto", ancho: 94, cifra: true }]}
          filas={[linea("Dividendos", ic.dividendos), linea("Cupones", ic.cupones), linea("Intereses de la cuenta", ic.intereses), linea("Otros", ic.otros)]}
        />
        <Pequena>{`Dividendos y cupones cobrados, netos de retención: ${euros(ic.ingresosNetos) ?? ""}, un ${porcentaje(ic.ingresosPct) ?? ""} del patrimonio medio. Los intereses de la cuenta no entran en esa cifra.`}</Pequena>
      </View>
      <View wrap={false}>
        <Subtitulo>Costes</Subtitulo>
        <Tabla
          columnas={[{ titulo: "Concepto", ancho: 315 }, { titulo: "Importe", ancho: 100, cifra: true }, { titulo: "Sobre el patrimonio medio", ancho: 100, cifra: true }]}
          filas={costes}
          total={["Costes totales", euros(ic.costesTotales), porcentaje(ic.costesTotalesPct)]}
        />
        <Pequena>{`Impuestos y retenciones del periodo: ${euros(ic.impuestos) ?? ""} (los de dividendos, cupones e intereses más los apuntados sueltos); no entran en los costes. Patrimonio medio del periodo: ${euros(ic.patrimonioMedio) ?? ""}.${
          /* Los euros son dinero movido; los porcentajes, no: su base es la media de la serie del valor, donde una posición sin precio vale cero. */
          comoCero ? ` ${comoCero} Los porcentajes de esta sección son sobre ese patrimonio.` : ""
        }`}</Pequena>
      </View>
    </>
  );
}

export const ingresosYCostes: SeccionDeInforme = {
  id: "ingresosYCostes",
  titulo: "Ingresos y costes",
  procede: hayCifras,
  Contenido
};
