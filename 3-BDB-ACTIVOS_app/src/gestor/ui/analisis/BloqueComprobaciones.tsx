/**
 * Bloque 10: lo que hay que mirar antes de fiarse de las cifras. Todos los avisos del motor y
 * de la carga de precios, y la conciliación de la cartera con cada extracto del banco.
 */
import { Aviso } from "../../../components/ui/Aviso";
import { Panel } from "../../../components/ui/Panel";
import { TablaDeDatos } from "../../../components/tabla/TablaDeDatos";
import type { ColumnaDeTabla } from "../../../types/tablaDeDatos";
import type { Analisis } from "../../motor/analisis";
import { aNumero, type Decimal } from "../../motor/decimal";
import type { Conciliacion, DiferenciaDeConciliacion } from "../../motor/integridad";
import { LineaDeAviso } from "../piezas";
import { escrito } from "../textos";

interface FilaDeDiferencia extends DiferenciaDeConciliacion {
  id: string;
}

function cantidad(valor: Decimal, diferencia: DiferenciaDeConciliacion, conciliacion: Conciliacion): string {
  if (diferencia.clase === "titulos") return escrito.titulos(valor);
  const divisa = conciliacion.extracto.efectivo.find((linea) => `Efectivo en ${linea.divisa}` === diferencia.concepto)?.divisa;
  return escrito.importe(aNumero(valor), divisa);
}

function columnas(conciliacion: Conciliacion): ColumnaDeTabla<FilaDeDiferencia>[] {
  return [
    { id: "concepto", titulo: "Concepto", encabezaFila: true, celda: (fila) => ({ texto: `${fila.concepto}${fila.clase === "titulos" ? " (títulos)" : ""}` }) },
    { id: "libro", titulo: "En el libro", cifra: true, sinOrden: true, celda: (fila) => ({ texto: cantidad(fila.enElLibro, fila, conciliacion) }) },
    { id: "extracto", titulo: "En el extracto", cifra: true, sinOrden: true, celda: (fila) => ({ texto: cantidad(fila.enElExtracto, fila, conciliacion) }) },
    { id: "diferencia", titulo: "Diferencia", cifra: true, sinOrden: true, celda: (fila) => ({ texto: cantidad(fila.diferencia, fila, conciliacion) }) }
  ];
}

function ConciliacionDeUnExtracto({ conciliacion }: { conciliacion: Conciliacion }) {
  const { extracto } = conciliacion;
  const lineas = conciliacion.comprobadas === 1 ? "1 línea comprobada" : `${conciliacion.comprobadas} líneas comprobadas`;
  const titulo = `Extracto del ${escrito.fecha(extracto.fecha)}${extracto.entidad ? ` · ${extracto.entidad}` : ""}`;
  return (
    <div className="stack stack--tight">
      <h3 className="gestor-subtitulo">{titulo}</h3>
      {conciliacion.cuadra ? (
        <Aviso titulo="Cuadra." tono="nota">{lineas}.</Aviso>
      ) : (
        <>
          <Aviso titulo="No cuadra.">
            {conciliacion.diferencias.length === 1 ? "Hay una diferencia" : `Hay ${conciliacion.diferencias.length} diferencias`} en {lineas}.
          </Aviso>
          <TablaDeDatos
            columnas={columnas(conciliacion)}
            filas={conciliacion.diferencias.map((diferencia) => ({ ...diferencia, id: `${diferencia.clase}-${diferencia.concepto}` }))}
            titulo={`Diferencias con el ${titulo.toLowerCase()}`}
          />
        </>
      )}
    </div>
  );
}

export function BloqueComprobaciones({ analisis, avisosDeMercado }: { analisis: Analisis; avisosDeMercado: readonly string[] }) {
  const { avisos, conciliaciones } = analisis.integridad;
  const todoBien = avisos.length === 0 && avisosDeMercado.length === 0 && conciliaciones.every((conciliacion) => conciliacion.cuadra);
  return (
    <Panel claseDelCuerpo="stack stack--tight" subtitulo={`Del libro de movimientos y de los precios, a ${escrito.fecha(analisis.fecha)}`} titulo="Comprobaciones">
      {todoBien ? <p className="cmp-note">Todo en orden: no hay nada que revisar.</p> : null}
      {avisos.length > 0 || avisosDeMercado.length > 0 ? (
        <ul className="gestor-avisos">
          {avisos.map((aviso, indice) => (
            <LineaDeAviso gravedad={aviso.gravedad} key={`${aviso.codigo}-${indice}`}>{aviso.mensaje}</LineaDeAviso>
          ))}
          {avisosDeMercado.map((aviso) => (
            <LineaDeAviso gravedad="aviso" key={aviso}>{aviso}</LineaDeAviso>
          ))}
        </ul>
      ) : null}
      <h3 className="gestor-subtitulo">Conciliación con los extractos del banco</h3>
      {conciliaciones.length === 0 ? (
        <p className="cmp-note">
          No hay ningún extracto importado. Al importar los extractos del banco, aquí se comprueba que la cartera cuadra con ellos, título a título y saldo a saldo.
        </p>
      ) : (
        conciliaciones.map((conciliacion) => <ConciliacionDeUnExtracto conciliacion={conciliacion} key={conciliacion.extracto.id} />)
      )}
    </Panel>
  );
}
