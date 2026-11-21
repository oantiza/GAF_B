import { useModoCliente } from "../app/ClientModeContext";
import { useIsAdmin } from "../auth/useIsAdmin";
import { useEffect, useMemo, useState } from "react";
import {
  fetchWeeklyReportResult,
  publishStrategyReport,
  type StrategyPublicationResult,
  type WeeklyReportFreshness
} from "../adapters/weeklyReportBackend";
import { Aviso } from "../components/ui/Aviso";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { MarkdownView } from "../components/MarkdownView";
import { OaaDonutChart, OaaGroupedBarChart, OaaRiskMatrixChart } from "../charts/oaa";
import { appLogger } from "../core/appLogger";
import { AUTOR_DE_ESTRATEGIA, NOTA_DE_ESTRATEGIA, avisoDeAtraso, mensajeDeEstrategia } from "../core/compartirEstrategia";
import { leerIdentidad } from "../core/identidadDelAsesor";
import { fecha } from "../core/formato";
import { conTildesEnLosTitulos, regionDeEstrategia } from "../core/textoDeEstrategia";
import { Panel } from "../components/ui/Panel";
import { TablaDeDatos } from "../components/tabla/TablaDeDatos";
import {
  columnasDeSegmentos,
  filasDeClases,
  filasDeRegiones,
  filasDeSectores
} from "../adapters/tablaDeEstrategia";
import type { WeeklyReport } from "../types/weeklyReport";
import { EmptyState } from "../components/ui/AsyncState";
import { Button } from "../components/ui/Button";
import { Distintivo } from "../components/ui/Distintivo";
import { Esqueleto } from "../components/ui/Esqueleto";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useConfirm } from "../components/ui/useConfirm";

/* Ola 3b (§5.4): la pestaña «Calendario económico» que esta página duplicaba
   (mismo callable get_economic_calendar con estado y render propios) vive
   ahora una sola vez, en la pestaña Agenda de Mercado. */
type StrategyTab = "resumen" | "asignacion" | "informe";
type StrategyReportType = "DAILY_REPORT" | "WEEKLY_REPORT";
type AllocationRegion = NonNullable<WeeklyReport["assetAllocation"]>["regionsEquity"][number];

/* 09-2026: el mensual se retira y entra el diario. Los rótulos dejan de salir de
   un booleano `isMonthly` repartido por la página y el PDF: con tres textos por
   tipo, un mapa es más honesto que un ternario, y añadir un cuarto tipo ya no
   obliga a buscar condicionales sueltos. */
const REPORT_META: Record<StrategyReportType, {
  label: string;
  title: string;
  emptyTitle: string;
  driversTitle: string;
  driversHint: string;
}> = {
  DAILY_REPORT: {
    label: "Diario",
    title: "Informe diario de mercados",
    emptyTitle: "No hay informe diario disponible",
    driversTitle: "Hechos de la sesión",
    driversHint: "Sesión del"
  },
  WEEKLY_REPORT: {
    label: "Semanal",
    title: "Estrategia semanal",
    emptyTitle: "No hay estrategia semanal disponible",
    driversTitle: "Hechos de la semana",
    driversHint: "Informe del"
  }
};

const ALL_TABS: { id: StrategyTab; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "asignacion", label: "Asignación" },
  { id: "informe", label: "Informe completo" }
];
const REPORT_TYPE_OPTIONS = [
  { id: "DAILY_REPORT", label: "Diario" },
  { id: "WEEKLY_REPORT", label: "Semanal" }
] as const;

/* La flecha dice hacia dónde se ha movido, y nada más: un Brent que cae no avisa ni una TIR que sube
   afirma. Por eso no lleva color (hallazgo 130). */
const TENDENCIA = {
  up: { flecha: "↑", nombre: "Sube" },
  down: { flecha: "↓", nombre: "Baja" },
  neutral: { flecha: "—", nombre: "Sin cambios" }
} as const;

function sentimentLabel(report: WeeklyReport) {
  if (report.summary.marketTemperature === "Bullish") return "Constructivo";
  if (report.summary.marketTemperature === "Bearish") return "Defensivo";
  return "Neutral";
}

/* ACT-13: la fecha del informe, con el formato común de toda la aplicación («13/11/2026»). Un día ISO se lee de su
   texto, sin huso, como hacía antes. */
function formatDate(value: string) {
  return fecha(value) ?? value;
}

function EmptyStrategyReport({ title }: { title: string }) {
  return (
    <EmptyState
      className="strategy-empty-report"
      description="No se ha publicado un informe para este periodo. Cuando esté disponible, aparecerá aquí y se podrá descargar y compartir."
      nivel={3}
      title={title}
    />
  );
}

/* ACT-20: las claves llevan el índice (dos riesgos con el mismo texto no se pisan), y se quitó todo lo de
   «Muestra», que colgaba de un `isSample` que siempre valía `false`. */
function TailRiskMatrix({ risks }: { risks: NonNullable<WeeklyReport["summary"]["tailRisks"]> }) {
  return (
    <div className="strategy-risk-matrix">
      <OaaRiskMatrixChart
        points={risks.map((risk, index) => ({
          id: `${index}-${risk.risk}`,
          label: risk.risk,
          probability: risk.probability,
          impact: risk.impact
        }))}
        height={260}
      />
      {/* El número es el que lleva cada punto de la matriz: sin él no se casa un punto con su texto. */}
      <ol>
        {risks.map((risk, index) => (
          <li key={`${index}-${risk.risk}`}>
            <span>{index + 1}</span>
            <p>{risk.risk}</p>
            <em>P: {risk.probability} · I: {risk.impact}</em>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RegionTable({ title, rows }: { title: string; rows: AllocationRegion[] }) {
  if (!rows.length) return null;
  const filas = filasDeRegiones(rows);
  return (
    <Panel className="strategy-span-2" estado={`${rows.length} segmentos`} nivel={3} titulo={title}>
      <TablaDeDatos
        columnas={columnasDeSegmentos(filas, {
          columnaDelNombre: "Zona",
          columnaDelPeso: "Peso",
          columnaDeLaJustificacion: "Racional"
        })}
        filas={filas}
        titulo={title}
      />
    </Panel>
  );
}

/**
 * El comité escribe los KPI como texto libre («2,6% interanual al 2026-06-30»).
 * No se reescribe el contenido: solo se le aplica el idioma numérico del resto
 * de la app — fecha en español, espacio antes del %, raya en los rangos.
 */
function normalizeCommitteeValue(value: string): string {
  return value
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (iso) => fecha(iso) ?? iso)
    .replace(/(\d)\s*%/g, "$1 %")
    .replace(/(\d)\s+-\s+(\d)/g, "$1 – $2");
}

function SummaryTab({ report, meta }: {
  report: WeeklyReport;
  meta: (typeof REPORT_META)[StrategyReportType];
}) {
  const kpis = report.summary.kpis?.slice(0, 8) ?? [];
  const risks = report.summary.tailRisks ?? [];

  return (
    <div className="strategy-grid">
      {kpis.length ? (
        <Panel className="strategy-kpis" nivel={3} subtitulo="Del texto del informe, de fuentes web" titulo="Cifras de mercado">
          {/* DIR-10: en una lista de definiciones cada grupo lleva solo su término y su definición. La flecha va dentro
              de la definición, con su nombre para el lector de pantalla. */}
          <dl>
            {kpis.map((kpi, index) => (
              <div key={`${index}-${kpi.label}`} className="strategy-kpi">
                <dt>{kpi.label}</dt>
                <dd>
                  {normalizeCommitteeValue(kpi.value)}
                  <span aria-label={TENDENCIA[kpi.trend].nombre} className="mercado-tendencia" role="img">
                    {TENDENCIA[kpi.trend].flecha}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      ) : null}

      {/* La fecha del informe, no «últimas 24 h»: un informe atrasado no habla de las últimas 24 horas. */}
      <Panel className="strategy-drivers" nivel={3} subtitulo={`${meta.driversHint} ${formatDate(report.date)}`} titulo={meta.driversTitle}>
        <ol>
          {report.summary.keyEvents.map((event, index) => (
            <li key={`${index}-${event}`}>
              <span>{index + 1}</span>
              <p>{event}</p>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel className="strategy-risk" estado={risks.length ? `${risks.length} escenarios` : "Sin señal"} nivel={3} titulo="Riesgos de cola">
        {risks.length ? (
          <TailRiskMatrix risks={risks} />
        ) : (
          <p className="asset-detail-muted">Sin riesgos destacados para esta lectura.</p>
        )}
      </Panel>
    </div>
  );
}

function AllocationTab({ report }: { report: WeeklyReport }) {
  // El informe diario no lleva asignación por contrato (ver REPORT_CONFIG en el
  // backend). La pestaña no se ofrece para ese tipo, pero el tipo es opcional y
  // esta guarda evita depender solo de que el selector haga lo correcto.
  const allocation = report.assetAllocation;
  if (!allocation) return null;
  const rows = allocation.classes;
  const equity = allocation.regionsEquity;
  const fixedIncome = allocation.regionsFixedIncome ?? [];
  const sectors = allocation.sectors ?? [];
  /* Los decimales los marca la columna, no la fila (revisión 16-10). */
  /* Los decimales por columna los decide ahora el adaptador, que es quien ve todas
     las filas de una tabla a la vez. */
  const filasDeClase = filasDeClases(rows);
  const filasDeSector = filasDeSectores(sectors);

  return (
    <div className="strategy-grid">
      {/* Un solo rótulo para toda la pestaña, también en Modo cliente (15-11-2026, Óscar): los pesos los escribe el modelo y no
          salen de un cálculo ni de una decisión de la casa; por eso tampoco entran en el PDF. */}
      <Aviso className="strategy-span-2" tono="nota" titulo="Escenario del modelo, no una recomendación.">
        Estos pesos los propone el modelo de IA que redacta el informe. No salen de un cálculo ni de una decisión de la casa.
      </Aviso>

      <Panel className="strategy-span-2" nivel={3} titulo="Visión de asignación">
        <p className="strategy-card-copy">{allocation.overview}</p>
      </Panel>

      {/* El peso estratégico es la referencia (gris, a trazos) y el táctico, lo que el comité propone (marino): el color
          sale del papel de cada serie, no de un color a mano. */}
      <Panel className="strategy-span-2" nivel={3} subtitulo="Estratégica frente a táctica" titulo="Matriz de asignación táctica">
        <OaaGroupedBarChart
          rows={rows.map((row) => ({
            key: row.assetClass,
            label: row.assetClass,
            a: row.strategicWeight,
            b: row.tacticalWeight
          }))}
          aLabel="Peso estratégico"
          aPapel="referencia"
          bLabel="Peso táctico"
          bPapel="cartera"
        />
      </Panel>

      {/* Los dos aros vuelven (14-11-2026, Óscar: «le faltan colores en general»; G2 del inventario): el reparto de la
          renta variable por región y el de la renta fija por segmento, como antes del rediseño. Las cifras siguen
          escritas en la leyenda de cada aro, y el aro lleva su tabla alternativa para el lector de pantalla. El color de
          cada porción lo decide el orden: las regiones y los segmentos del comité no son categorías con color propio. La
          leyenda va debajo del aro (`stack`): al lado, en una columna de 280 px, se salía del bloque. */}
      <Panel estado={`${equity.length} regiones`} nivel={3} titulo="Renta variable">
        <OaaDonutChart
          ariaLabel="Renta variable por región"
          data={equity.map((row) => ({ key: regionDeEstrategia(row.region), label: regionDeEstrategia(row.region), value: row.weight }))}
          height={220}
          innerRadius={48}
          outerRadius={66}
          layout="stack"
        />
      </Panel>

      <Panel estado={fixedIncome.length ? `${fixedIncome.length} segmentos` : "Sin desglose"} nivel={3} titulo="Renta fija">
        {fixedIncome.length ? (
          <OaaDonutChart
            ariaLabel="Renta fija por segmento"
            data={fixedIncome.map((row) => ({ key: row.region, label: row.region, value: row.weight }))}
            height={220}
            innerRadius={48}
            outerRadius={66}
            layout="stack"
          />
        ) : (
          <p className="asset-detail-muted">Sin desglose de renta fija disponible.</p>
        )}
      </Panel>

      <Panel className="strategy-span-2" nivel={3} subtitulo="Estratégica / táctica / visión" titulo="Clases de activo">
        <TablaDeDatos
          columnas={columnasDeSegmentos(filasDeClase, {
            columnaDelNombre: "Clase",
            columnaDelPeso: "Estratégica",
            columnaDelPesoTactico: "Táctica",
            columnaDeLaJustificacion: "Justificación",
            justificacionPorDefecto: allocation.overview
          })}
          filas={filasDeClase}
          titulo="Clases de activo: estratégica, táctica y visión"
        />
      </Panel>

      <RegionTable title="Renta Variable por región" rows={equity} />
      <RegionTable title="Renta Fija por segmento" rows={fixedIncome} />

      {sectors.length ? (
        <Panel className="strategy-span-2" estado={`${sectors.length} sectores`} nivel={3} titulo="Sectores">
          <TablaDeDatos
            columnas={columnasDeSegmentos(filasDeSector, {
              columnaDelNombre: "Sector",
              columnaDelPeso: "Peso"
            })}
            filas={filasDeSector}
            titulo="Asignación por sector"
          />
        </Panel>
      ) : null}
    </div>
  );
}

function ReportTab({ report }: { report: WeeklyReport }) {
  return (
    <section className="strategy-document">
      {/* El resumen del informe ya va arriba, sobre el selector de vista, en las tres vistas: aquí no se repite. */}
      {report.fullReport?.narrative ? (
        <MarkdownView nivel={3}>{conTildesEnLosTitulos(report.fullReport.narrative)}</MarkdownView>
      ) : (
        <p className="asset-detail-muted">Sin informe completo disponible.</p>
      )}
      {report.summary.tailRisks?.length ? (
        <div className="strategy-tail-risk">
          <h3>Riesgos de cola</h3>
          <div>
            {report.summary.tailRisks.map((risk, index) => (
              <article key={`${index}-${risk.risk}`}>
                <strong>{risk.risk}</strong>
                <span>Prob. {risk.probability} · Impacto {risk.impact}</span>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {report.sources?.length ? (
        <section className="strategy-sources" aria-labelledby="strategy-sources-title">
          <div>
            <p>Documentación</p>
            <h3 id="strategy-sources-title">Fuentes consultadas</h3>
          </div>
          <ul>
            {report.sources.slice(0, 12).map((source, index) => (
              <li key={`${index}-${source.url}`}>
                <a href={source.url} rel="noreferrer" target="_blank">{source.title}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

interface StrategyPageProps {
  /**
   * Dentro de Mercado (ola 3). Desde el rediseño el informe es siempre un bloque de Mercado, con la cabecera de un
   * `Panel` y no un título de página, así que ya no cambia nada; se acepta para no romper a quien lo pasa.
   */
  embedded?: boolean;
}

/**
 * Lo que contestó el servidor al publicar a mano (15-11-2026), con su texto. Solo `PUBLISHED` es un informe nuevo; el
 * forzado se ofrece donde tiene sentido —ya había uno de hoy, o se agotaron los intentos—, como acción aparte que dice
 * lo que hace. Con otra publicación en curso no se ofrece: el servidor no fuerza contra un cerrojo vivo.
 */
const MENSAJE_DE_PUBLICACION: Record<
  StrategyPublicationResult["status"],
  { tono: "nota" | "aviso"; titulo: string; texto: string; forzar?: string }
> = {
  PUBLISHED: { tono: "nota", titulo: "Informe publicado.", texto: "Ya se ve abajo el informe de hoy." },
  ALREADY_PUBLISHED: {
    tono: "aviso",
    titulo: "Ya había un informe de hoy.",
    texto: "No se ha generado otro: sigue el que estaba publicado.",
    forzar: "Regenerar el informe de hoy"
  },
  IN_PROGRESS: {
    tono: "aviso",
    titulo: "Hay otra publicación en curso.",
    texto: "No se ha lanzado una segunda. Espera unos minutos a que termine y vuelve a cargar la página."
  },
  ATTEMPTS_EXHAUSTED: {
    tono: "aviso",
    titulo: "Intentos agotados.",
    texto: "Los intentos de hoy fallaron y no hay informe publicado. Puedes hacer un intento más.",
    forzar: "Reintentar"
  }
};

const CONFIRMACION_FORZADA = {
  regenerar: {
    title: "¿Regenerar el informe de hoy?",
    message: "Se redacta de nuevo con búsquedas web y sustituye al que está publicado hoy. Puede tardar varios minutos y tiene coste.",
    confirmLabel: "Regenerar"
  },
  reintentar: {
    title: "¿Hacer un intento más?",
    message: "Se redacta de nuevo con búsquedas web: puede tardar varios minutos y tiene coste.",
    confirmLabel: "Reintentar"
  }
};

function AvisoDePublicacion({ resultado, busy, onForzar }: { resultado: StrategyPublicationResult; busy: boolean; onForzar: () => void }) {
  const mensaje = MENSAJE_DE_PUBLICACION[resultado.status];
  const regenerado = resultado.status === "PUBLISHED" && resultado.replacedDate !== null;
  return (
    <Aviso
      accion={mensaje.forzar ? <Button busy={busy} onClick={onForzar} size="sm" variant="secondary">{mensaje.forzar}</Button> : undefined}
      anunciar
      titulo={regenerado ? "Informe regenerado." : mensaje.titulo}
      tono={mensaje.tono}
    >
      {regenerado ? "Sustituye al que estaba publicado hoy." : mensaje.texto}
    </Aviso>
  );
}

/**
 * El informe de estrategia: un informe editorial dentro de Mercado, que no repite un título de página. Su cabecera es
 * la de un bloque, con sus acciones (descargar el informe, compartirlo y, para un administrador, publicar el de hoy, que
 * es interno), el selector Diario o Semanal y sus tres vistas: Resumen, Asignación e Informe completo.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `embedded` se acepta y ya no decide nada (ver arriba).
export function StrategyPage(_props: StrategyPageProps = {}) {
  const [activeTab, setActiveTab] = useState<StrategyTab>("resumen");
  const [reportType, setReportType] = useState<StrategyReportType>("DAILY_REPORT");
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [freshness, setFreshness] = useState<WeeklyReportFreshness>("EMPTY");
  const [reportAgeDays, setReportAgeDays] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pdfError, setPdfError] = useState<unknown>(null);
  /* Reintento del banner de error: vuelve a pedir el informe (auditoría 16-10). */
  const [reloadToken, setReloadToken] = useState(0);
  const isAdmin = useIsAdmin();
  const modoCliente = useModoCliente();
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<unknown>(null);
  const [publishOutcome, setPublishOutcome] = useState<StrategyPublicationResult | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    let mounted = true;
    setError(null);
    setLoading(true);
    /* ACT-03: el informe anterior se vacía al empezar la carga. Si no, mientras llega el semanal se
       veía el diario bajo el título nuevo, y «Descargar PDF» lo exportaba con el tipo del otro. */
    setReport(null);
    fetchWeeklyReportResult(reportType)
      .then((result) => {
        if (!mounted) return;
        setReport(result.report);
        setFreshness(result.freshness);
        setReportAgeDays(result.age_days);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (!mounted) return;
        setReport(null);
        setFreshness("ERROR");
        setReportAgeDays(null);
        setError(nextError);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reportType, reloadToken]);

  const sentiment = report ? sentimentLabel(report) : null;
  const hasPdf = Boolean(report);
  const meta = REPORT_META[reportType];
  /* El diario no tiene asignación de activos, así que su pestaña no se ofrece.
     Si el usuario estaba en ella y cambia a diario, la vista cae a «resumen» sin
     necesidad de un efecto que reescriba el estado. */
  const tabs = useMemo(
    () => (reportType === "DAILY_REPORT" ? ALL_TABS.filter((tab) => tab.id !== "asignacion") : ALL_TABS),
    [reportType]
  );
  const visibleTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : "resumen";
  const summaryDate = useMemo(() => (report ? formatDate(report.date) : "Pendiente"), [report]);
  /* ACT-15: la vigencia, con un distintivo de su tono (antes `is-current` no tenía regla y «vigente» salía gris). */
  const vigencia = freshness === "CURRENT"
    ? <Distintivo tono="marca">Informe vigente</Distintivo>
    : freshness === "STALE"
      ? <Distintivo tono="aviso">{`Informe atrasado${reportAgeDays === null ? "" : ` · ${reportAgeDays} ${reportAgeDays === 1 ? "día" : "días"}`}`}</Distintivo>
      : null;

  async function publishToday(force = false) {
    /* ACT-20: la redacción tarda minutos y tiene coste; no se lanza de un clic sin querer. */
    const seguro = await confirm(force ? CONFIRMACION_FORZADA[publishOutcome?.status === "ALREADY_PUBLISHED" ? "regenerar" : "reintentar"] : {
      title: "¿Publicar el informe de hoy?",
      message: "Se redacta de nuevo con búsquedas web: puede tardar varios minutos y tiene coste.",
      confirmLabel: "Publicar"
    });
    if (!seguro) return;
    setPublishing(true);
    setPublishError(null);
    setPublishOutcome(null);
    try {
      const resultado = await publishStrategyReport(reportType, force ? { force: true } : {});
      setPublishOutcome(resultado);
      /* Solo un informe recién publicado cambia lo que hay que enseñar. */
      if (resultado.status === "PUBLISHED") setReloadToken((token) => token + 1);
    } catch (cause) {
      setPublishError(cause);
    } finally {
      setPublishing(false);
    }
  }

  async function downloadPdf() {
    if (!report) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { downloadWeeklyReportPdf } = await import("../reports/weeklyReportPdf");
      await downloadWeeklyReportPdf(report, reportType, { atrasado: freshness === "STALE", diasDeAtraso: reportAgeDays }, modoCliente.seEnsena("proveedorDeEstrategia"));
    } catch (downloadError) {
      appLogger.error("weekly report pdf failed", downloadError);
      setPdfError(downloadError);
    } finally {
      setPdfBusy(false);
    }
  }

  async function shareWithClient() {
    if (!report) return;
    /* Hay que leerlo antes de compartirlo con un cliente (decisión 22 del proyecto): lo redacta un
       modelo y nadie lo ha revisado. Lo que faltaba es que la pantalla lo hiciera cumplir. */
    const atrasado = freshness === "STALE";
    const leido = await confirm({
      title: "¿Has leído este informe?",
      message: [
        "Hay que leerlo antes de compartirlo con un cliente: lo redacta una IA con búsquedas web y nadie lo ha revisado.",
        avisoDeAtraso(atrasado, reportAgeDays)
      ]
        .filter(Boolean)
        .join("\n"),
      confirmLabel: "Lo he leído: compartir"
    });
    if (!leido) return;
    const { asunto, cuerpo } = mensajeDeEstrategia({
      titulo: meta.title,
      fecha: summaryDate,
      informe: report,
      atrasado,
      diasDeAtraso: reportAgeDays,
      /* INF-05: lo firma el asesor, con lo que escribió en «Tus datos en los informes», leído al compartir. */
      firma: leerIdentidad()
    });
    if (navigator.share) {
      try {
        await navigator.share({ title: asunto, text: cuerpo });
        return;
      } catch (cause) {
        /* Ola A2 (A2.8): cancelar el diálogo de compartir NO debe abrir el
           correo — solo caemos al mailto si el share falló de verdad. */
        if (cause instanceof DOMException && cause.name === "AbortError") {
          return;
        }
      }
    }
    window.location.href = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  }

  const puedePublicar = isAdmin && modoCliente.seEnsena("publicarEstrategia");

  return (
    <article className="strategy-page">
      <Panel
        acciones={
          <div className="mercado-estrategia__acciones">
            <SegmentedControl
              className="strategy-switch"
              label="Tipo de informe"
              onChange={(tipo) => {
                /* El resultado de publicar es del tipo que se publicó: al cambiar de tipo, se va. */
                setPublishOutcome(null);
                setReportType(tipo);
              }}
              options={REPORT_TYPE_OPTIONS}
              value={reportType}
            />
            {/* Publicar es del administrador y no se ofrece en Modo cliente: lleva su «Interno». */}
            {puedePublicar ? (
              <span className="mercado-estrategia__interno">
                <Distintivo tono="interno">Interno</Distintivo>
                <Button busy={publishing} onClick={() => void publishToday()} size="sm" variant="secondary">
                  {publishing ? "Redactando, puede tardar minutos…" : "Publicar el de hoy"}
                </Button>
              </span>
            ) : null}
            <Button disabled={!hasPdf} onClick={shareWithClient} size="sm" variant="secondary">
              Compartir con cliente
            </Button>
            <Button busy={pdfBusy} disabled={!hasPdf} onClick={downloadPdf} size="sm" variant="primary">
              {pdfBusy ? "Preparando…" : "Descargar el informe"}
            </Button>
          </div>
        }
        claseDelCuerpo="stack stack--bloques"
        estado={report ? vigencia : null}
        rotulo="Informe de estrategia"
        subtitulo={
          report
            ? `${summaryDate} · ${AUTOR_DE_ESTRATEGIA}${report.provider && modoCliente.seEnsena("proveedorDeEstrategia") ? ` · ${report.provider}` : ""}. ${NOTA_DE_ESTRATEGIA}.`
            : summaryDate
        }
        titulo={meta.title}
      >
        {error ? <AsyncErrorBanner error={error} onRetry={() => setReloadToken((value) => value + 1)} /> : null}
        {publishError ? <AsyncErrorBanner error={publishError} onRetry={() => void publishToday()} /> : null}
        {puedePublicar && publishOutcome ? (
          <AvisoDePublicacion busy={publishing} onForzar={() => void publishToday(true)} resultado={publishOutcome} />
        ) : null}
        {pdfError ? <AsyncErrorBanner error={pdfError} onRetry={() => void downloadPdf()} /> : null}

        {loading ? (
          <div className="strategy-loading">
            <p className="sr-only">Cargando el informe de estrategia…</p>
            <Esqueleto lineas={4} />
          </div>
        ) : report ? (
          <section aria-label="Resumen ejecutivo estratégico" className="strategy-hero">
            <div>
              <p>Resumen ejecutivo estratégico</p>
              {/* El titular del informe, no un encabezado de la página: el esquema lo marcan el título del bloque y sus
                  secciones. */}
              <p className="strategy-headline">{report.summary.headline}</p>
              <div className="strategy-lead">{report.summary.narrative}</div>
            </div>
            {sentiment ? (
              <aside>
                <span>Tono de mercado</span>
                <strong>{sentiment}</strong>
              </aside>
            ) : null}
          </section>
        ) : (
          <EmptyStrategyReport title={meta.emptyTitle} />
        )}

        {/* U-14: un solo nivel de pestañas por página (Mercado ya tiene el suyo).
            Resumen / Asignación / Informe son vistas del mismo informe: selector
            de vista (`SegmentedControl`, grupo con aria-pressed), no un tablist. */}
        <SegmentedControl
          className="strategy-tabs"
          label="Vista del informe de estrategia"
          onChange={setActiveTab}
          options={tabs}
          value={visibleTab}
        />

        <div className="strategy-view">
          {report && visibleTab === "resumen" ? <SummaryTab report={report} meta={meta} /> : null}
          {report && visibleTab === "asignacion" ? <AllocationTab report={report} /> : null}
          {report && visibleTab === "informe" ? <ReportTab report={report} /> : null}
        </div>
      </Panel>
      {confirmDialog}
    </article>
  );
}

export default StrategyPage;
