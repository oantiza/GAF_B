import { useMemo } from "react";
import { fetchEarningsCalendar, type EarningItem, type EarningsCalendarResult } from "../adapters/earningsCalendarBackend";
import { useModoCliente } from "../app/ClientModeContext";
import { codigoDeValor, faseDeAgenda, hoyIso, notaDeLaFuente, soloIbex35 } from "../core/agendaDeMercado";
import { fecha, numero } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { ColumnaDeTabla, FilaAgrupable } from "../types/tablaDeDatos";
import { FalloDeAgenda } from "./FalloDeAgenda";
import { marketCalendarSourceLabel } from "./marketCalendarSource";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { EmptyState } from "./ui/AsyncState";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Cifra } from "./ui/Cifra";
import { Esqueleto } from "./ui/Esqueleto";
import { Panel } from "./ui/Panel";
import { cabeceraDeDia, crearRanuraDeAgenda, procedenciaDelPanel, useAgendaDeMercado } from "./useAgendaDeMercado";

const RANURA = crearRanuraDeAgenda<EarningsCalendarResult>();
const cargarResultados = () => fetchEarningsCalendar();

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const num = (v?: number | null) => (v === null || v === undefined || Number.isNaN(v) ? null : v);
function whenLabel(w?: string | null): string {
  if (!w) return "";
  const s = String(w).toLowerCase();
  if (s.includes("before")) return "Antes de apertura";
  if (s.includes("after")) return "Tras el cierre";
  return String(w);
}

/** Una publicación de resultados, ya con su día leído en la hora local. */
interface FilaDeResultado extends FilaAgrupable {
  item: EarningItem;
  /** El día de la publicación, o null si la fuente no lo da. */
  dia: Date | null;
  esHoy: boolean;
  /** Cuántas publicaciones hay ese día, contando esta. */
  delDia: number;
}

/* El recuento de cada día (14-11-2026, D6 del inventario): antes del rediseño la lista iba agrupada por día y cada día
   decía «N publicaciones». La tabla no se agrupa —agrupar le quitaría ordenar por columna—, así que el recuento va en el
   apunte de la fecha: es un dato del día, y sigue siendo cierto en cualquier orden. */
const recuentoDelDia = (cuantas: number) => `${cuantas} ${cuantas === 1 ? "publicación" : "publicaciones"} ese día`;

/** El BPA, en la unidad de la fuente: tres decimales, como lo da. */
const bpa = (valor: number) => numero(valor, { decimales: 3 }) ?? "";

function columnasDeResultados(conSorpresa: boolean): ColumnaDeTabla<FilaDeResultado>[] {
  const columnas: ColumnaDeTabla<FilaDeResultado>[] = [
    {
      id: "fecha",
      titulo: "Fecha",
      celda: ({ item, dia, esHoy, delDia }) =>
        dia
          ? {
              texto: fecha(dia) ?? "",
              valor: dia.getTime(),
              apunte: [esHoy ? "Hoy" : null, item.date_estimated ? "Fecha estimada" : null, cabeceraDeDia(dia).split(",")[0], recuentoDelDia(delDia)].filter(Boolean).join(" · ")
            }
          : { texto: textoDeAusencia("falta"), ausencia: "falta" }
    },
    {
      id: "valor",
      titulo: "Valor",
      encabezaFila: true,
      celda: ({ item }) => {
        const codigo = codigoDeValor(item.code);
        const apunte = [codigo, item.when ? whenLabel(item.when) : null].filter(Boolean).join(" · ") || undefined;
        return item.name ? { texto: item.name, valor: item.name, apunte } : { texto: textoDeAusencia("falta"), ausencia: "falta", apunte };
      }
    },
    {
      id: "bpa",
      titulo: "BPA",
      cifra: true,
      celda: ({ item }) => {
        const real = num(item.eps_actual);
        return real === null ? { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" } : { texto: bpa(real), valor: real };
      }
    },
    {
      id: "estimacion",
      titulo: "Estimación",
      cifra: true,
      celda: ({ item }) => {
        const est = num(item.eps_estimate);
        return est === null ? { texto: "Sin estimación" } : { texto: bpa(est), valor: est };
      }
    }
  ];
  if (conSorpresa) {
    columnas.push({
      id: "sorpresa",
      titulo: "Sorpresa",
      cifra: true,
      celda: ({ item }) => {
        const sorpresa = num(item.eps_surprise_pct);
        /* La diferencia del BPA con la estimación: un resultado frente a su referencia, con su signo y su color. */
        return sorpresa === null
          ? { texto: textoDeAusencia("falta", { estrecha: true }), ausencia: "falta" }
          : { texto: "", valor: sorpresa, nodo: <Cifra colorDeSigno conSigno tipo="porcentaje" valor={sorpresa / 100} /> };
      }
    });
  }
  return columnas;
}

export function EarningsPanel() {
  const { seEnsena } = useModoCliente();
  const { resultado, cargando, error, recargar } = useAgendaDeMercado(RANURA, cargarResultados);
  const origen = resultado?.source ?? null;
  const items = useMemo(() => soloIbex35(resultado?.items ?? []), [resultado]);
  const fase = faseDeAgenda({ cargando, error, origen, cuantos: items.length });
  const nota = notaDeLaFuente(resultado?.note, seEnsena("fuenteDeDatos"));

  const filas = useMemo<FilaDeResultado[]>(() => {
    const hoy = hoyIso();
    const leidas = items.map((item) => {
      const leido = item.report_date ? new Date(item.report_date) : null;
      return { item, dia: leido && !Number.isNaN(leido.getTime()) ? leido : null };
    });
    const porDia = new Map<string, number>();
    for (const { dia } of leidas) if (dia) porDia.set(dayKeyOf(dia), (porDia.get(dayKeyOf(dia)) ?? 0) + 1);
    return leidas
      .map(({ item, dia }, indice) => ({
        id: `${codigoDeValor(item.code)}-${item.report_date ?? "sin-fecha"}-${indice}`,
        item,
        dia,
        esHoy: dia ? dayKeyOf(dia) === hoy : false,
        delDia: dia ? porDia.get(dayKeyOf(dia)) ?? 1 : 0
      }))
      .sort(
        (a, b) =>
          (a.dia?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dia?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
          codigoDeValor(a.item.code).localeCompare(codigoDeValor(b.item.code))
      );
  }, [items]);

  /* Hoy Yahoo no da ni un BPA real ni una sorpresa: 0 de 13 en la medición del 04-11-2026. Una columna
     que sale siempre vacía no dice nada; vuelve sola el día que una fuente la traiga. */
  const conSorpresa = items.some((it) => num(it.eps_surprise_pct) != null);
  const columnas = useMemo(() => columnasDeResultados(conSorpresa), [conSorpresa]);
  const hayEstimadas = items.some((it) => it.date_estimated === true);
  const proxima = filas[0]?.dia ? cabeceraDeDia(filas[0].dia) : null;
  const procedencia =
    fase === "fallo"
      ? null
      : procedenciaDelPanel(["IBEX 35", seEnsena("fuenteDeDatos") ? marketCalendarSourceLabel(origen) : null], resultado?.from, resultado?.to);

  return (
    <Panel
      acciones={
        <Button busy={cargando} onClick={recargar} size="sm">
          {cargando ? "Cargando…" : "Recargar"}
        </Button>
      }
      claseDelCuerpo="stack stack--tight"
      className="market-agenda-panel"
      estado={fase === "datos" ? `${items.length} ${items.length === 1 ? "publicación" : "publicaciones"}` : null}
      subtitulo={procedencia ?? "Fecha de publicación y BPA de los valores del IBEX 35."}
      titulo="Próximos resultados · IBEX 35"
    >
      {fase === "cargando" ? (
        <>
          <p className="sr-only">Cargando resultados…</p>
          <Esqueleto lineas={4} />
        </>
      ) : null}
      {fase === "fallo" ? (
        <FalloDeAgenda detalle={error ? null : nota} mensaje="No se han podido cargar los resultados." onRetry={recargar} />
      ) : null}
      {fase === "vacia" ? (
        <EmptyState
          description={`No hay resultados previstos en este periodo.${nota ? ` ${nota}` : ""}`}
          nivel={3}
          title="Sin publicaciones"
        />
      ) : null}
      {fase === "datos" ? (
        <>
          {nota ? <Aviso tono="nota">{nota}</Aviso> : null}
          <p className="macro-sub">
            Fecha de publicación y BPA de los valores del IBEX 35{proxima ? `; la próxima, el ${proxima}` : ""}. La estimación es la de consenso
            que da la fuente, no un cálculo nuestro.{conSorpresa ? " La sorpresa es la diferencia del BPA con ella." : ""}
            {hayEstimadas ? " «Fecha estimada» es la primera de una ventana de fechas que da la fuente: la empresa aún no ha confirmado el día." : ""}
          </p>
          <TablaDeDatos columnas={columnas} filas={filas} porPagina titulo="Próximos resultados del IBEX 35" />
        </>
      ) : null}
    </Panel>
  );
}
