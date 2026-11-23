import { useMemo, useState } from "react";

import { fetchEconomicCalendar, type EconomicCalendarResult, type EconomicEvent } from "../adapters/economicCalendarBackend";
import { useModoCliente } from "../app/ClientModeContext";
import { faseDeAgenda, notaDeLaFuente } from "../core/agendaDeMercado";
import { FalloDeAgenda } from "./FalloDeAgenda";
import { EmptyState } from "./ui/AsyncState";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Distintivo, type TonoDeDistintivo } from "./ui/Distintivo";
import { Esqueleto } from "./ui/Esqueleto";
import { Panel } from "./ui/Panel";
import { SegmentedControl } from "./ui/SegmentedControl";
import { marketCalendarSourceLabel } from "./marketCalendarSource";
import { cabeceraDeDia, crearRanuraDeAgenda, procedenciaDelPanel, useAgendaDeMercado } from "./useAgendaDeMercado";
import { cifrasEnPantalla } from "../core/glosarioDePantalla";
import { fecha, numero } from "../core/formato";

const RANURA = crearRanuraDeAgenda<EconomicCalendarResult>();
const cargarCalendario = () => fetchEconomicCalendar();

type Impact = "high" | "medium" | "low" | "holiday" | "none";
type Filter = "all" | "high" | "medium";

/* Auditoría 14-10 (MEDIA-21): el filtro es la primitiva SegmentedControl, no
   un grupo de botones con aria-pressed montado a mano. */
const FILTER_OPTIONS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "high", label: "Alto" },
  { id: "medium", label: "Medio o alto" }
];

/* El tono de cada nivel (14-11-2026, Óscar: «le faltan colores en general»; G6 del inventario). El impacto no es bueno
   ni malo, así que no lleva verde ni rojo: «Alto» va en ocre, el color de lo que pide atención; «Medio», en el azul de
   enlace de la marca; «Bajo», «Festivo» y «Sin nivel», en gris. La palabra va siempre escrita. */
const IMPACT: Record<Impact, { label: string; tono: TonoDeDistintivo }> = {
  high: { label: "Alto", tono: "aviso" },
  medium: { label: "Medio", tono: "marca" },
  low: { label: "Bajo", tono: "neutro" },
  holiday: { label: "Festivo", tono: "neutro" },
  none: { label: "Sin nivel", tono: "neutro" }
};

function impactLevel(imp: unknown): Impact {
  if (imp === null || imp === undefined || imp === "") return "none";
  const s = String(imp).toLowerCase();
  if (s.includes("hol")) return "holiday";
  if (s.includes("high") || s === "3") return "high";
  if (s.includes("med") || s === "2") return "medium";
  if (s.includes("low") || s === "1") return "low";
  return "none";
}

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/* ACT-06: los hechos que salen del informe de estrategia solo traen el día, y el servidor les pone
   las 09:00 de Madrid. Esa hora no es la de publicación del dato: se enseñan sin hora. Una fecha
   sin hora («2026-11-13») tampoco la lleva. */
function tieneHora(e: EconomicEvent): boolean {
  if (e.source === "STRATEGY_REPORT") return false;
  return !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date ?? ""));
}

/* El día tal como lo escribe la fuente, sin pasarlo por la zona horaria del navegador. */
function diaSinHora(fecha: string): Date | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  return partes ? new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])) : null;
}

const fmtVal = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/* DIR-09: la fuente abrevia en inglés (K de miles, M de millones, B de miles de millones). En pantalla
   se escriben a la española: «80B» es «80.000 M» y «227K» es «227.000». Entre la cifra y la «M», el espacio
   duro del módulo único: no se separan al partir la línea. La T es el «trillion» inglés, un billón español: 1 T =
   1.000.000 de millones, así que «-0.90T» es −0,90 × 1.000.000 M = −900.000 M. */
const MAGNITUD = /^\s*(-?\d+(?:\.(\d+))?)\s*([KMBT])\s*$/i;
const MILLONES = "\u00a0M";
function magnitudEnEspanol(texto: string): string | null {
  const partes = MAGNITUD.exec(texto);
  if (!partes) return null;
  const valor = Number(partes[1]);
  const decimales = partes[2]?.length ?? 0;
  const letra = partes[3].toUpperCase();
  const miles = numero(valor * 1e3, { decimales: Math.max(0, decimales - 3) });
  if (letra === "K") return miles;
  if (letra === "M") {
    const millones = numero(valor, { decimales });
    return millones === null ? null : `${millones}${MILLONES}`;
  }
  if (letra === "T") {
    const enMillones = numero(valor * 1e6, { decimales: Math.max(0, decimales - 6) });
    return enMillones === null ? null : `${enMillones}${MILLONES}`;
  }
  return miles === null ? null : `${miles}${MILLONES}`;
}

/* Una cifra de la fuente, en el idioma de la pantalla: «-10.6%» se escribe «−10,6 %». */
const fmtCifra = (v: unknown): string | null => {
  const texto = fmtVal(v);
  return texto === null ? null : magnitudEnEspanol(texto) ?? cifrasEnPantalla(texto);
};

/* ACT-15: el impacto es cuánto puede mover el mercado, no si es bueno o malo. Va en un distintivo sin color de
   signo, con su palabra: el rojo de «negativo» decía «importante» aquí y «malo» en la pestaña de al lado. Desde el
   14-11-2026 el nivel lleva el tono de la tabla `IMPACT` (ocre el alto, azul el medio), nunca verde ni rojo. */
function ImpactBadge({ level }: { level: Impact }) {
  return <Distintivo tono={IMPACT[level].tono}>{IMPACT[level].label}</Distintivo>;
}

interface DayGroup {
  key: string;
  label: string;
  isToday: boolean;
  sort: number;
  items: { e: EconomicEvent; lvl: Impact; t: number; time: string }[];
}

export function EconomicCalendarPanel() {
  const { seEnsena } = useModoCliente();
  const { resultado, cargando, error, recargar } = useAgendaDeMercado(RANURA, cargarCalendario);
  const events = resultado?.events ?? null;
  const origen = resultado?.source ?? null;
  /* La nota de la fuente puede nombrar al proveedor: en Modo cliente se escribe sin nombrarlo, como en Dividendos y Resultados. */
  const note = notaDeLaFuente(resultado?.note, seEnsena("fuenteDeDatos")) ?? undefined;
  const fase = faseDeAgenda({ cargando, error, origen, cuantos: events?.length ?? 0 });
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo<DayGroup[]>(() => {
    if (!events) return [];
    const todayKey = dayKeyOf(new Date());
    const pass = (lvl: Impact) =>
      filter === "all" ? true : filter === "high" ? lvl === "high" : lvl === "high" || lvl === "medium";
    const map = new Map<string, DayGroup>();
    for (const e of events) {
      const lvl = impactLevel(e.importance);
      if (!pass(lvl)) continue;
      const conHora = tieneHora(e);
      const parsed = !e.date ? null : conHora ? new Date(e.date) : diaSinHora(e.date);
      const d = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
      const key = d ? dayKeyOf(d) : "zzzz-sin-fecha";
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          label: d ? cabeceraDeDia(d) : "Sin fecha",
          isToday: key === todayKey,
          sort: d ? d.getTime() : Number.MAX_SAFE_INTEGER,
          items: []
        };
        map.set(key, group);
      }
      group.items.push({
        e,
        lvl,
        /* Sin hora, al final de su día: después de cualquier hora de verdad de ese día. */
        t: !d ? Number.MAX_SAFE_INTEGER : conHora ? d.getTime() : d.getTime() + UN_DIA_MS - 1,
        time: !d ? "Sin hora" : conHora ? d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "Sin hora"
      });
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => a.sort - b.sort);
    for (const g of arr) g.items.sort((a, b) => a.t - b.t);
    return arr;
  }, [events, filter]);

  const totalShown = groups.reduce((s, g) => s + g.items.length, 0);
  const highCount = (events ?? []).filter((event) => impactLevel(event.importance) === "high").length;
  const mediumPlusCount = (events ?? []).filter((event) => {
    const level = impactLevel(event.importance);
    return level === "high" || level === "medium";
  }).length;
  const nextLabel = groups[0]?.label ?? "Sin fecha";
  const alcance = resultado?.covers_to ? `La fuente cubre hasta el ${fecha(resultado.covers_to) ?? resultado.covers_to}.` : null;
  const procedencia =
    fase === "fallo"
      ? null
      : procedenciaDelPanel([seEnsena("fuenteDeDatos") ? marketCalendarSourceLabel(origen) : null], resultado?.from, resultado?.to);

  return (
    <Panel
      acciones={
        <Button busy={cargando} onClick={recargar} size="sm">
          {cargando ? "Cargando…" : "Recargar"}
        </Button>
      }
      className="economic-calendar-panel market-agenda-panel"
      estado={fase === "datos" ? `${totalShown} ${totalShown === 1 ? "evento" : "eventos"}` : null}
      subtitulo={`${procedencia ? `${procedencia}. ` : ""}${alcance ? `${alcance} ` : ""}Eventos macro ordenados por día e impacto. Los nombres de los eventos son los que da la fuente.`}
      titulo="Calendario económico"
    >

      {fase === "datos" && note ? <Aviso tono="nota">{note}</Aviso> : null}

      {fase === "datos" ? (
        <div className="market-agenda-toolbar">
          <SegmentedControl label="Filtro de calendario económico" onChange={setFilter} options={FILTER_OPTIONS} value={filter} />
          {/* Lo que antes eran cuatro mini-cifras, en una línea: los recuentos son del periodo entero; los visibles, del filtro. */}
          <p className="mercado-recuento">
            {totalShown} {totalShown === 1 ? "evento visible" : "eventos visibles"} · {highCount} de impacto alto · {mediumPlusCount} de impacto medio o alto ·
            próximo día: {nextLabel}
          </p>
        </div>
      ) : null}

      {fase === "fallo" ? (
        <FalloDeAgenda detalle={error ? null : note} mensaje="No se ha podido cargar el calendario." onRetry={recargar} />
      ) : fase === "cargando" ? (
        <>
          <p className="sr-only">Cargando el calendario económico…</p>
          <Esqueleto lineas={5} />
        </>
      ) : fase === "fuera" ? (
        /* La fuente respondió pero no llega a ese rango: no es «no hay eventos». */
        <EmptyState
          description={note ?? "El rango pedido cae fuera de lo que cubre la fuente."}
          nivel={3}
          title="Fuera del alcance de la fuente"
        />
      ) : fase === "vacia" ? (
        <EmptyState
          description={resultado?.status === "NO_EVENTS_IN_COVERAGE" && note ? note : "No hay eventos previstos en este periodo."}
          nivel={3}
          title="Sin eventos"
        />
      ) : groups.length === 0 ? (
        <EmptyState
          action={
            <Button onClick={() => setFilter("all")} size="sm">
              Ver todos
            </Button>
          }
          description="No hay eventos con este impacto en este periodo."
          nivel={3}
          title="Sin eventos con este impacto"
        />
      ) : (
        <div className="market-agenda-list">
          {groups.map((g) => (
            <div key={g.key} className="market-day-group">
              <div className="market-day-heading">
                <h3>{g.label}</h3>
                {g.isToday ? <Distintivo tono="marca">Hoy</Distintivo> : null}
                <em>{g.items.length} {g.items.length === 1 ? "evento" : "eventos"}</em>
              </div>
              <ul className="market-event-list">
                {g.items.map((it, i) => {
                  const real = fmtCifra(it.e.actual);
                  const est = fmtCifra(it.e.estimate);
                  const prev = fmtCifra(it.e.previous);
                  return (
                    <li key={`${g.key}-${it.time}-${i}`} className={`market-event-row economic-event-row ${it.lvl}`}>
                      <span className="economic-event-time">{it.time}</span>
                      <ImpactBadge level={it.lvl} />
                      <span className="economic-event-name">
                        {fmtVal(it.e.country) ? <em>{fmtVal(it.e.country)}</em> : null}
                        {fmtVal(it.e.type) ?? "Sin nombre"}
                      </span>
                      <span className="economic-event-values">
                        {real != null ? <span className="actual economic-event-actual">Real <strong>{real}</strong></span> : null}
                        {est != null ? <span className="economic-event-estimate">Previsión {est}</span> : null}
                        {prev != null ? <span className="economic-event-previous">Anterior {prev}</span> : null}
                        {real == null && est == null && prev == null ? <span className="economic-event-vacio">Sin cifras</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
