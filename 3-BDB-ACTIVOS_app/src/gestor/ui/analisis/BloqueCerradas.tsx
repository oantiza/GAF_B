/**
 * Bloque 8: lo vendido en el periodo y lo que se ganó o perdió con ello, activo a activo.
 * El coste es el de los títulos vendidos, empezando por los más antiguos; no es un cálculo fiscal.
 */
import { Cifra } from "../../../components/ui/Cifra";
import { Panel } from "../../../components/ui/Panel";
import { TablaDeDatos } from "../../../components/tabla/TablaDeDatos";
import { textoDeAusencia } from "../../../core/textoDeAusencia";
import type { CeldaDeTabla, ColumnaDeTabla } from "../../../types/tablaDeDatos";
import type { Analisis, PosicionCerrada } from "../../motor/analisis";
import { escrito } from "../textos";

interface FilaDeCerrada extends PosicionCerrada {
  id: string;
  nombre: string;
}

/** Un resultado: con su signo y su color. */
function resultado(valor: number | null, tipo: "importe" | "rentabilidad", divisa: string): CeldaDeTabla {
  if (valor === null) return { texto: textoDeAusencia("falta"), ausencia: "falta" };
  const texto = tipo === "importe" ? escrito.importeConSigno(valor, divisa) : escrito.rentabilidad(valor);
  return { texto, valor, nodo: tipo === "importe" ? <Cifra colorDeSigno conSigno divisa={divisa} tipo="importe" valor={valor} /> : <Cifra tipo="rentabilidad" valor={valor} /> };
}

export function BloqueCerradas({ analisis }: { analisis: Analisis }) {
  if (analisis.cerradas.length === 0) return null;
  const divisa = analisis.cartera.divisaBase;
  const filas: FilaDeCerrada[] = analisis.cerradas.map((cerrada) => ({ ...cerrada, id: cerrada.activoId, nombre: cerrada.activo?.nombre ?? cerrada.activoId }));

  const columnas: ColumnaDeTabla<FilaDeCerrada>[] = [
    {
      id: "activo",
      titulo: "Activo",
      encabezaFila: true,
      celda: (fila) => ({ texto: fila.nombre, valor: fila.nombre.toLowerCase(), apunte: fila.cerradaDelTodo ? "Venta total" : "Venta parcial: queda una parte en cartera" })
    },
    { id: "titulos", titulo: "Títulos vendidos", cifra: true, celda: (fila) => ({ texto: escrito.titulos(fila.titulos), valor: fila.titulos }) },
    { id: "coste", titulo: "Coste", cifra: true, celda: (fila) => (fila.incompleto ? { texto: textoDeAusencia("falta"), ausencia: "falta" } : { texto: escrito.importe(fila.coste, divisa), valor: fila.coste }) },
    { id: "cobrado", titulo: "Cobrado", cifra: true, celda: (fila) => ({ texto: escrito.importe(fila.cobrado, divisa), valor: fila.cobrado }) },
    { id: "resultado", titulo: "Resultado", cifra: true, celda: (fila) => resultado(fila.incompleto ? null : fila.resultado, "importe", divisa) },
    { id: "resultadoPct", titulo: "%", cifra: true, celda: (fila) => resultado(fila.resultadoPct, "rentabilidad", divisa) },
    { id: "primeraCompra", titulo: "Primera compra", cifra: true, celda: (fila) => ({ texto: escrito.fecha(fila.primeraCompra), valor: fila.primeraCompra }) },
    { id: "ultimaVenta", titulo: "Última venta", cifra: true, celda: (fila) => ({ texto: escrito.fecha(fila.ultimaVenta), valor: fila.ultimaVenta }) }
  ];

  return (
    <Panel claseDelCuerpo="stack stack--tight" subtitulo="Ventas del periodo, con el coste de los títulos vendidos empezando por los más antiguos" titulo="Posiciones cerradas">
      <TablaDeDatos
        columnas={columnas}
        deActivos
        filas={filas}
        pie={(columna) => (columna.id === "resultado" ? resultado(analisis.realizado, "importe", divisa) : undefined)}
        rotuloDelPie="Resultado realizado"
        titulo="Posiciones vendidas en el periodo"
      />
      <p className="cmp-note">
        No es un cálculo fiscal.
        {analisis.realizado === null ? " Falta el coste de alguna venta: el resultado realizado no se puede dar." : ""}
      </p>
    </Panel>
  );
}
