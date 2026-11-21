/* eslint-disable react-refresh/only-export-components */
/**
 * «Lo que ha costado su cartera», al estilo de la información de costes de MiFID II: lo que
 * cuesta el servicio, lo que cuestan las operaciones y lo que cuestan los productos, en dinero y
 * sobre el patrimonio medio. Los porcentajes son los del análisis: donde no da uno, no se escribe.
 */
import { importe, numero, porcentaje } from "../../../../core/formato";
import { Parrafo, Tabla, type FilaDeTabla } from "../../../../reports/plantilla";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";
import { Pequena } from "../piezas";
import { gastosCorrientesCompletos } from "./comun";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const euros = (valor: number | null) => importe(valor, { divisa });
  const ic = analisis.ingresosYCostes;
  const conocidos = ic.gastosCorrientes !== null;
  const completa = gastosCorrientesCompletos(datos);
  const apunteDeProductos = !conocidos
    ? "Coste corriente de los fondos y ETF. No se conoce el de ninguno de sus fondos, así que no se incluye."
    : completa
      ? "Coste corriente de los fondos y ETF, estimado con su porcentaje anual sobre lo invertido. No se cobra aparte: ya va descontado en el valor de cada fondo."
      : `Coste corriente de los fondos y ETF, estimado. Se conoce el de la parte de la cartera que supone un ${porcentaje(ic.coberturaDeGastosCorrientes, { decimales: 0 }) ?? ""} de lo invertido; el del resto no se incluye. Ya va descontado en el valor de cada fondo.`;
  /* La tabla de la plantilla tiene un solo total, al final: el subtotal de lo pagado directamente es una fila más, con
     su porcentaje, y el total de costes es el total de la tabla. */
  const filas: FilaDeTabla[] = [
    { celdas: [{ texto: "Costes del servicio", apunte: "Custodia, administración y, si los hay, asesoramiento: lo cargado en su cuenta." }, euros(ic.costesDelServicio), ""] },
    { celdas: [{ texto: "Costes de las operaciones", apunte: "Comisiones y gastos de las compras y ventas. Van dentro del precio pagado o cobrado." }, euros(ic.costesDeOperacion), ""] },
    { celdas: ["Costes pagados directamente", euros(ic.costesExplicitos), porcentaje(ic.costesExplicitosPct)] },
    { celdas: [{ texto: "Costes de los productos", apunte: apunteDeProductos }, conocidos ? euros(ic.gastosCorrientes) : null, ""] }
  ];
  const hayDetalle = ic.cargosDelServicio.length > 0 || ic.costesPorOperacion.length > 0 || ic.porProducto.length > 0 || ic.productosSinGastosCorrientes.length > 0;
  const impacto = completa && ic.costesTotalesPct !== null && ic.costesTotalesPct > 0;
  return (
    <>
      <Parrafo>{`Lo que ha costado la cartera en el periodo, separado por su origen. El porcentaje se mide sobre el patrimonio medio del periodo.${hayDetalle ? " A continuación va el detalle de cada línea." : ""}`}</Parrafo>
      <Tabla
        columnas={[{ titulo: "Concepto", ancho: 56 }, { titulo: "Importe", ancho: 22, cifra: true }, { titulo: "Sobre el patrimonio", ancho: 22, cifra: true }]}
        filas={filas}
        total={[completa ? "Total de costes" : "Total de costes conocidos", euros(ic.costesTotales), porcentaje(ic.costesTotalesPct)]}
      />
      <Pequena separada>{`Patrimonio medio del periodo: ${euros(ic.patrimonioMedio) ?? ""}.`}</Pequena>
      {impacto ? <Parrafo>{`Sin estos costes, la rentabilidad del periodo habría sido aproximadamente ${numero((ic.costesTotalesPct ?? 0) * 100, { decimales: 2 }) ?? ""} puntos porcentuales mayor.`}</Parrafo> : null}
    </>
  );
}

export const resumen: SeccionDeInforme = {
  id: "resumen",
  titulo: "Lo que ha costado su cartera",
  juntoAlTitulo: 260,
  procede: hayCifras,
  Contenido
};
