import { useMemo } from "react";
import { fetchDividendsCalendar, type DividendsCalendarResult } from "../adapters/dividendsCalendarBackend";
import { useModoCliente } from "../app/ClientModeContext";
import {
  escribirImporte,
  faseDeAgenda,
  filasDeDividendos,
  hoyIso,
  importeEsDelUltimoPago,
  notaDeLaFuente,
  notaDelImporte,
  type FilaDeDividendo
} from "../core/agendaDeMercado";
import { fecha } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { ColumnaDeTabla } from "../types/tablaDeDatos";
import { FalloDeAgenda } from "./FalloDeAgenda";
import { marketCalendarSourceLabel } from "./marketCalendarSource";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { EmptyState } from "./ui/AsyncState";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Esqueleto } from "./ui/Esqueleto";
import { Panel } from "./ui/Panel";
import { crearRanuraDeAgenda, procedenciaDelPanel, useAgendaDeMercado } from "./useAgendaDeMercado";

const dia = (iso: string) => fecha(iso) ?? iso;

const RANURA = crearRanuraDeAgenda<DividendsCalendarResult>();
const cargarDividendos = () => fetchDividendsCalendar();

/**
 * Dos datos por fila, y lo que la fuente da de verdad: la próxima fecha ex y el último dividendo,
 * rotulado como pasado. La cifra no es el próximo pago aunque esté al lado de la próxima fecha.
 */
function columnasDeDividendos(rotuloDelImporte: string): ColumnaDeTabla<FilaDeDividendo>[] {
  return [
    {
      id: "fecha",
      titulo: "Fecha ex",
      celda: (fila) =>
        fila.fechaEx
          ? {
              texto: dia(fila.fechaEx),
              valor: fila.fechaEx,
              apunte:
                [fila.esHoy ? "Hoy" : null, fila.fechaDePago ? `pago ${dia(fila.fechaDePago)}` : null]
                  .filter(Boolean)
                  .join(" · ") || undefined
            }
          : { texto: textoDeAusencia("falta"), ausencia: "falta" }
    },
    {
      id: "valor",
      titulo: "Valor",
      encabezaFila: true,
      celda: (fila) =>
        fila.nombre
          ? { texto: fila.nombre, valor: fila.nombre, apunte: fila.codigo }
          : { texto: fila.codigo, valor: fila.codigo }
    },
    {
      id: "importe",
      titulo: rotuloDelImporte,
      cifra: true,
      celda: (fila) =>
        fila.importe === null
          ? { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" }
          : {
              texto: escribirImporte(fila.importe, fila.divisa),
              valor: fila.importe,
              apunte: fila.fechaDelImporte ? `fecha ex ${dia(fila.fechaDelImporte)}` : undefined
            }
    }
  ];
}

export function DividendsPanel() {
  const { seEnsena } = useModoCliente();
  const { resultado, cargando, error, recargar } = useAgendaDeMercado(RANURA, cargarDividendos);
  const origen = resultado?.source ?? null;
  const filas = useMemo(() => filasDeDividendos(resultado?.items ?? [], hoyIso()), [resultado]);
  const fase = faseDeAgenda({ cargando, error, origen, cuantos: filas.length });
  const tipoDeImporte = useMemo(() => resultado?.items.find((it) => it.amount_kind)?.amount_kind ?? null, [resultado]);
  const columnas = useMemo(
    () => columnasDeDividendos(importeEsDelUltimoPago(origen, tipoDeImporte) ? "Último dividendo" : "Importe anunciado"),
    [origen, tipoDeImporte]
  );
  const nota = notaDeLaFuente(resultado?.note, seEnsena("fuenteDeDatos"));

  return (
    <Panel
      acciones={
        <Button busy={cargando} onClick={recargar} size="sm">
          {cargando ? "Cargando…" : "Recargar"}
        </Button>
      }
      claseDelCuerpo="stack stack--tight"
      className="market-agenda-panel"
      estado={fase === "datos" ? `${filas.length} ${filas.length === 1 ? "valor" : "valores"}` : null}
      subtitulo={
        (fase === "fallo"
          ? null
          : procedenciaDelPanel(["IBEX 35", seEnsena("fuenteDeDatos") ? marketCalendarSourceLabel(origen) : null], resultado?.from, resultado?.to)) ??
        "Fecha ex y último dividendo de los valores del IBEX 35."
      }
      titulo="Próximas fechas ex-dividendo · IBEX 35"
    >
      {fase === "cargando" ? (
        <>
          <p className="sr-only">Cargando dividendos…</p>
          <Esqueleto lineas={4} />
        </>
      ) : null}
      {fase === "fallo" ? (
        <FalloDeAgenda detalle={error ? null : nota} mensaje="No se han podido cargar los dividendos." onRetry={recargar} />
      ) : null}
      {fase === "vacia" ? (
        <EmptyState
          description={`No hay dividendos previstos en este periodo.${nota ? ` ${nota}` : ""}`}
          nivel={3}
          title="Sin fechas ex-dividendo"
        />
      ) : null}
      {fase === "datos" ? (
        <>
          <p className="macro-sub">{notaDelImporte(filas, origen, tipoDeImporte)}</p>
          {nota ? <Aviso tono="nota">{nota}</Aviso> : null}
          <TablaDeDatos columnas={columnas} filas={filas} porPagina titulo="Próximas fechas ex-dividendo del IBEX 35" />
        </>
      ) : null}
    </Panel>
  );
}
