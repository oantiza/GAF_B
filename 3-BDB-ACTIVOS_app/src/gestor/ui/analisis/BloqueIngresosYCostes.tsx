/**
 * Bloque 7: lo cobrado y lo pagado en el periodo. Los ingresos con su retención; los costes
 * separados por su origen, con el coste corriente de los fondos aparte porque es una
 * estimación y ya va descontado en su valor; y los impuestos fuera de los costes.
 *
 * Un coste y un ingreso van en tinta: no dicen si la cartera gana o pierde.
 */
import { Ausencia } from "../../../components/ui/Ausencia";
import { Panel } from "../../../components/ui/Panel";
import { TablaDeDatos } from "../../../components/tabla/TablaDeDatos";
import type { ColumnaDeTabla } from "../../../types/tablaDeDatos";
import type { Analisis, LineaDeIngreso } from "../../motor/analisis";
import { notaDeLoContadoComoCero } from "../../motor/sinPrecio";
import { FilaDeDato } from "../piezas";
import { escrito } from "../textos";

interface FilaDeIngreso extends LineaDeIngreso {
  id: string;
  concepto: string;
}

function sobreElMedio(valor: number | null): string | undefined {
  return valor === null ? undefined : `${escrito.porcentaje(valor)} del patrimonio medio`;
}

function columnasDeIngresos(divisa: string): ColumnaDeTabla<FilaDeIngreso>[] {
  return [
    { id: "concepto", titulo: "Concepto", encabezaFila: true, sinOrden: true, celda: (fila) => ({ texto: fila.concepto }) },
    { id: "bruto", titulo: "Bruto", cifra: true, sinOrden: true, celda: (fila) => ({ texto: escrito.importe(fila.bruto, divisa), valor: fila.bruto }) },
    { id: "retencion", titulo: "Retención", cifra: true, sinOrden: true, celda: (fila) => ({ texto: escrito.importe(fila.retencion, divisa), valor: fila.retencion }) },
    { id: "neto", titulo: "Neto", cifra: true, sinOrden: true, celda: (fila) => ({ texto: escrito.importe(fila.neto, divisa), valor: fila.neto }) }
  ];
}

export function BloqueIngresosYCostes({ analisis }: { analisis: Analisis }) {
  if (!analisis.rentabilidad) return null;
  const divisa = analisis.cartera.divisaBase;
  const ic = analisis.ingresosYCostes;
  const ingresos: FilaDeIngreso[] = [
    { id: "dividendos", concepto: "Dividendos", ...ic.dividendos },
    { id: "cupones", concepto: "Cupones", ...ic.cupones },
    { id: "intereses", concepto: "Intereses de la cuenta", ...ic.intereses }
  ];
  if (ic.otros.bruto !== 0 || ic.otros.neto !== 0) ingresos.push({ id: "otros", concepto: "Otros abonos", ...ic.otros });

  const notaDeGastos =
    ic.gastosCorrientes === null
      ? "No se conoce el coste corriente de los fondos de la cartera."
      : ic.coberturaDeGastosCorrientes < 1
        ? `Estimación: ya va descontado en el valor de los fondos. Solo se conoce para el ${escrito.porcentaje(ic.coberturaDeGastosCorrientes, 0)} de lo invertido.`
        : "Estimación: ya va descontado en el valor de los fondos.";

  const sinPrecio = notaDeLoContadoComoCero(analisis, { quien: "El patrimonio medio" });

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      subtitulo={`Del periodo · los porcentajes son sobre el patrimonio medio, ${escrito.importeTitular(ic.patrimonioMedio, divisa)}`}
      titulo="Ingresos y costes del periodo"
    >
      <div className="gestor-columnas">
        <div className="stack stack--tight">
          <h3 className="gestor-subtitulo">Ingresos</h3>
          <TablaDeDatos columnas={columnasDeIngresos(divisa)} filas={ingresos} titulo="Ingresos del periodo, con su retención" />
          <div className="rows">
            <FilaDeDato nota={["Sin los intereses de la cuenta", sobreElMedio(ic.ingresosPct)].filter(Boolean).join(" · ")} rotulo="Dividendos y cupones cobrados, netos de retención" total>
              {escrito.importe(ic.ingresosNetos, divisa)}
            </FilaDeDato>
          </div>
        </div>
        <div>
          <h3 className="gestor-subtitulo">Costes</h3>
          <div className="rows">
            <FilaDeDato nota="Comisiones y gastos de compras y ventas, dentro de su precio" rotulo="De las operaciones">{escrito.importe(ic.costesDeOperacion, divisa)}</FilaDeDato>
            <FilaDeDato nota="Custodia, asesoramiento y mantenimiento cargados en la cuenta" rotulo="De la cuenta">{escrito.importe(ic.costesDelServicio, divisa)}</FilaDeDato>
            <FilaDeDato nota={sobreElMedio(ic.costesExplicitosPct)} rotulo="Costes pagados, sin impuestos" total>
              {escrito.importe(ic.costesExplicitos, divisa)}
            </FilaDeDato>
            <FilaDeDato nota={notaDeGastos} rotulo="Coste corriente de los fondos">
              {ic.gastosCorrientes === null ? <Ausencia clase="falta" /> : escrito.importe(ic.gastosCorrientes, divisa)}
            </FilaDeDato>
            <FilaDeDato
              nota={
                ic.gastosCorrientes === null
                  ? "Sin el coste corriente de los fondos no se puede dar el total."
                  : [sobreElMedio(ic.costesTotalesPct), ic.coberturaDeGastosCorrientes < 1 ? "parcial: falta el coste corriente de parte de los fondos" : undefined].filter(Boolean).join(" · ")
              }
              rotulo="Costes totales, con el coste corriente"
              total
            >
              {ic.gastosCorrientes === null ? <Ausencia clase="falta" /> : escrito.importe(ic.costesTotales, divisa)}
            </FilaDeDato>
          </div>
          <h3 className="gestor-subtitulo">Aparte</h3>
          <div className="rows">
            <FilaDeDato nota="Retenciones de dividendos, cupones e intereses, e impuestos apuntados en la cuenta. No son un coste de la gestión." rotulo="Impuestos y retenciones">
              {escrito.importe(ic.impuestos, divisa)}
            </FilaDeDato>
          </div>
        </div>
      </div>
      {/* Los euros son dinero movido y no cambian; los porcentajes, sí: su base es la media de la serie del valor. */}
      {sinPrecio ? <p className="cmp-note">{sinPrecio} Los porcentajes de este bloque son sobre ese patrimonio.</p> : null}
    </Panel>
  );
}
