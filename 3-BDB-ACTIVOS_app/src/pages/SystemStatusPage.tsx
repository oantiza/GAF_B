import type {
  IntegrityStatusDocument,
  IntegrityStatusProblem,
  SystemStatusJsonValue,
  SystemStatusResponse
} from "../adapters/systemStatusBackend";
import { TablaDeDatos } from "../components/tabla/TablaDeDatos";
import { Distintivo, type TonoDeDistintivo } from "../components/ui/Distintivo";
import { Panel } from "../components/ui/Panel";
import { fecha, fechaYHora, numero } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { ColumnaDeTabla } from "../types/tablaDeDatos";

interface FilaDeConteo {
  id: string;
  rotulo: string;
  cifra: string;
  valor: number;
}

const COLUMNAS_DE_CONTEOS: ColumnaDeTabla<FilaDeConteo>[] = [
  { id: "rotulo", titulo: "Qué se cuenta", encabezaFila: true, sinOrden: true, celda: (fila) => ({ texto: fila.rotulo }) },
  { id: "cifra", titulo: "Cuántos", cifra: true, sinOrden: true, celda: (fila) => ({ texto: fila.cifra, valor: fila.valor }) }
];

/*
 * PLA-22: aquí vivía también `SystemStatusPage`, la página entera de cuando el estado del sistema era un destino propio
 * (`/sistema` antes de la ola 3b). Ya no la montaba ninguna ruta —Sistema monta `SystemStatusContent` dentro de su
 * pestaña, con su propio ciclo de carga (`SystemStatusTab`, en `AdminPage`)—, y solo la usaban sus pruebas. Se retiró
 * el 14-11-2026; las pruebas prueban el contenido directamente.
 */

type HealthState = "OK" | "WARN" | "FAIL" | "UNKNOWN";
type ProblemSeverity = "FAIL" | "WARN" | "INFO" | "UNKNOWN";

const FALTA = textoDeAusencia("falta");

interface SystemStatusContentProps {
  now?: Date;
  snapshot: SystemStatusResponse;
}

const STATUS_COPY: Record<HealthState, { label: string; title: string; description: string }> = {
  OK: {
    label: "Correcto",
    title: "Sistema operativo",
    description: "La última comprobación publicada no detectó incidencias."
  },
  WARN: {
    label: "Aviso",
    title: "Requiere atención",
    description: "Hay avisos operativos que conviene revisar."
  },
  FAIL: {
    label: "Fallo",
    title: "Incidencia crítica",
    description: "La comprobación diaria ha detectado al menos un fallo."
  },
  UNKNOWN: {
    label: "Sin datos",
    title: "Estado no disponible",
    description: "Todavía no hay un semáforo de integridad publicado."
  }
};

const COUNT_LABELS: Record<string, string> = {
  assets_total: "Documentos en assets",
  assets_isin_active: "Activos ISIN activos",
  archived: "Activos archivados",
  archived_overlap: "Solapamientos con archivo",
  search_index_entries: "Entradas del buscador",
  search_index_missing: "Activos fuera del buscador",
  search_index_orphans: "Entradas huérfanas del buscador",
  commercial_retro: "Retrocesiones comerciales",
  commercial_retro_orphans: "Retrocesiones huérfanas",
  portfolio_owners: "Titulares con carteras",
  portfolios: "Carteras guardadas",
  assets: "Activos en la maestra",
  assets_with_isin: "Activos con ISIN",
  price_series: "Series de precios",
  metrics_latest: "Métricas calculadas",
  holdings: "Activos con posiciones subyacentes",
  admin_inventory_rows: "Filas del inventario de administración",
  admin_inventory_rebuilt: "Inventario de administración reconstruido",
  fund_quality_rebuilt: "Inventario de calidad de fondos reconstruido"
};

/** Estos dos no son recuentos: el servidor apunta si en esa pasada se reconstruyó o no. */
const COUNTS_QUE_SON_SI_O_NO = new Set(["admin_inventory_rebuilt", "fund_quality_rebuilt"]);

/** Cómo se llama cada comprobación del semáforo. Lo que venga sin nombre se escribe a partir de su código. */
const CHECK_LABELS: Record<string, string> = {
  search_index_missing: "Activos fuera del buscador",
  search_index_orphans: "Entradas huérfanas del buscador",
  archived_overlap: "Solapamientos con archivo",
  commercial_retro_orphans: "Retrocesiones huérfanas",
  price_refresh_freshness: "Antigüedad de los precios",
  metrics_refresh_freshness: "Antigüedad de las métricas",
  backup_freshness: "Antigüedad de la copia de seguridad",
  metrics_cycle_partial: "Ciclo de métricas parcial",
  strategy_report_publication: "Publicación del informe de estrategia",
  reviewed_nav_refresh_freshness: "Antigüedad de los valores liquidativos revisados",
  reviewed_nav_sources: "Fuentes de valor liquidativo por revisar",
  upstream_nav_stale: "Valor liquidativo sin actualizar en el proveedor",
  admin_inventory_truncated: "Inventario de administración recortado",
  fund_quality_inventory: "Inventario de calidad de fondos",
  meta_document_size: "Tamaño de los documentos de control"
};

const COUNT_ORDER = Object.keys(COUNT_LABELS);
/* PLA-12: un recuento lleva siempre su punto de millar («1.097», no «1097»), por el módulo común. */
const recuento = (valor: number) => numero(valor) ?? FALTA;

function healthState(value: unknown): HealthState {
  return value === "OK" || value === "WARN" || value === "FAIL" ? value : "UNKNOWN";
}

function problemSeverity(value: unknown): ProblemSeverity {
  return value === "FAIL" || value === "WARN" || value === "INFO" ? value : "UNKNOWN";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* PLA-12: una fecha con el formato común («13/11/2026»), y con su hora local si es un instante («13/11/2026 10:30»).
   Un día sin hora se escribe sin hora: no se inventa. */
function formatDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return fecha(value) ?? FALTA;
  const parsed = parseDate(value);
  return parsed ? (fechaYHora(parsed) ?? FALTA) : FALTA;
}

function systemStatusAgeDays(value: unknown, now: Date): number | null {
  const parsed = parseDate(value);
  if (!parsed || Number.isNaN(now.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000));
}

function ageLabel(value: unknown, now: Date): string {
  const days = systemStatusAgeDays(value, now);
  if (days === null) return `Antigüedad: ${FALTA.toLocaleLowerCase("es")}`;
  return `Antigüedad: ${recuento(days)} ${days === 1 ? "día" : "días"}`;
}

function countValue(value: SystemStatusJsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readableKey(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (letter) => letter.toLocaleUpperCase("es"));
}

function countEntries(integrity: IntegrityStatusDocument | null) {
  const counts = integrity?.counts;
  if (!counts) return [];
  return Object.entries(counts)
    .map(([key, value]) => ({ key, value: countValue(value) }))
    .filter((entry): entry is { key: string; value: number } => entry.value !== null)
    .sort((a, b) => {
      const aIndex = COUNT_ORDER.indexOf(a.key);
      const bIndex = COUNT_ORDER.indexOf(b.key);
      if (aIndex === -1 && bIndex === -1) return a.key.localeCompare(b.key, "es");
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
}

function problemPriority(problem: IntegrityStatusProblem): number {
  return problem.severity === "FAIL" ? 0 : problem.severity === "WARN" ? 1 : 2;
}

function sortedProblems(integrity: IntegrityStatusDocument | null): IntegrityStatusProblem[] {
  return [...(integrity?.problems ?? [])].sort((a, b) => problemPriority(a) - problemPriority(b));
}

function budgetLabel(used: number | undefined, maximum: number | undefined): string | null {
  if (typeof used !== "number" && typeof maximum !== "number") return null;
  const usedLabel = typeof used === "number" ? recuento(used) : FALTA.toLocaleLowerCase("es");
  const maxLabel = typeof maximum === "number" ? recuento(maximum) : FALTA.toLocaleLowerCase("es");
  return `Lecturas: ${usedLabel} de ${maxLabel}`;
}

function verificationLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return `Verificación: ${FALTA.toLocaleLowerCase("es")}`;
  if (value === "PASS") return "Verificación: correcta";
  if (value === "FAIL") return "Verificación: fallida";
  return `Verificación: ${value}`;
}

/* El tono del distintivo: lo correcto, en azul de enlace (afirmativo); un aviso o un fallo, en ocre, que pide la atención del
   asesor; sin datos, neutro. La palabra es la señal y el color, el refuerzo. */
const TONO_DEL_ESTADO: Record<HealthState | ProblemSeverity, TonoDeDistintivo> = {
  OK: "marca",
  WARN: "aviso",
  FAIL: "aviso",
  INFO: "neutro",
  UNKNOWN: "neutro"
};

function StatusBadge({ state }: { state: HealthState }) {
  return <Distintivo tono={TONO_DEL_ESTADO[state]}>{STATUS_COPY[state].label}</Distintivo>;
}

/* U-10: nunca el código crudo del backend ni versalitas; etiqueta en castellano
   con mayúscula inicial y el punto de color del distintivo. */
const SEVERITY_LABELS: Record<ProblemSeverity, string> = {
  FAIL: "Fallo",
  WARN: "Aviso",
  INFO: "Información",
  UNKNOWN: "Sin nivel"
};

function ProblemBadge({ severity }: { severity: ProblemSeverity }) {
  return <Distintivo tono={TONO_DEL_ESTADO[severity]}>{SEVERITY_LABELS[severity] ?? "Sin nivel"}</Distintivo>;
}

function FreshnessCard({
  dateValue,
  details,
  now,
  state,
  title
}: {
  dateValue: unknown;
  details: Array<string | null>;
  now: Date;
  state: HealthState;
  title: string;
}) {
  return (
    <article className={`system-freshness-card is-${state.toLowerCase()}`}>
      <header>
        <h3>{title}</h3>
        <StatusBadge state={state} />
      </header>
      <strong className="system-freshness-date">{formatDate(dateValue)}</strong>
      <span className="system-freshness-age">{ageLabel(dateValue, now)}</span>
      {details.filter(Boolean).map((detail) => <small key={detail}>{detail}</small>)}
    </article>
  );
}

function ProblemList({ integrity }: { integrity: IntegrityStatusDocument | null }) {
  const problems = sortedProblems(integrity);
  if (problems.length === 0) {
    return (
      <div className="system-problems-empty">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>{healthState(integrity?.status) === "OK" ? "Sin incidencias publicadas" : "Sin detalle de incidencias"}</strong>
          <p>{integrity ? "El documento no contiene problemas." : "El job de integridad todavía no ha publicado un marcador."}</p>
        </div>
      </div>
    );
  }

  return (
    <ul className="system-problem-list">
      {problems.map((problem, index) => {
        const severity = problemSeverity(problem.severity);
        return (
          <li className={`is-${severity.toLowerCase()}`} key={`${problem.check ?? "problem"}-${index}`}>
            <ProblemBadge severity={severity} />
            <div>
              <strong>{problem.detail || "Incidencia sin descripción"}</strong>
              <span>{problem.check ? CHECK_LABELS[problem.check] ?? readableKey(problem.check) : "Comprobación de integridad"}</span>
              {problem.sample && problem.sample.length > 0 ? <small>Muestra: {problem.sample.join(", ")}</small> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SystemStatusContent({ snapshot, now = new Date() }: SystemStatusContentProps) {
  const { integrity, backup, prices, metrics } = snapshot;
  const globalState = healthState(integrity?.status);
  const copy = STATUS_COPY[globalState];
  const counts = countEntries(integrity);
  const freshness = integrity?.freshness;
  const priceDate = prices?.last_run ?? prices?.last_run_date;
  const priceBudget = budgetLabel(prices?.read_budget_used, prices?.read_budget_max);
  const metricsBudget = budgetLabel(metrics?.read_budget_used, metrics?.read_budget_max);
  const metricsCycle = metrics
    ? metrics.cycle_completed === true
      ? "Ciclo completado"
      : metrics.stopped_by_budget
        ? "Ciclo parcial · límite de lecturas alcanzado"
        : "Ciclo parcial"
    : "Sin marcador";

  return (
    <div className="system-status-content">
      <section className={`system-health-hero is-${globalState.toLowerCase()}`} aria-labelledby="system-health-title">
        <div className="system-health-orb" aria-hidden="true"><span /></div>
        <div className="system-health-copy">
          <StatusBadge state={globalState} />
          {/* Un veredicto, no un título: nombra la región, sin saltarse el esquema de la página. */}
          <p className="system-health-titular" id="system-health-title">{copy.title}</p>
          <p>{copy.description}</p>
          <small>Comprobación publicada: {formatDate(integrity?.checked_at)}</small>
        </div>
      </section>

      <Panel
        claseDelCuerpo="stack stack--tight"
        subtitulo="Última ejecución de cada proceso"
        titulo="Frescura"
        tituloId="system-freshness-title"
      >
        <div className="system-freshness-grid">
          <FreshnessCard
            dateValue={priceDate}
            details={["Última actualización con datos", priceBudget]}
            now={now}
            state={healthState(freshness?.price_refresh)}
            title="Precios"
          />
          <FreshnessCard
            dateValue={metrics?.last_run}
            details={[metricsCycle, metricsBudget]}
            now={now}
            state={healthState(freshness?.metrics_refresh)}
            title="Métricas"
          />
          <FreshnessCard
            dateValue={backup?.completed_at}
            details={[
              verificationLabel(backup?.verification),
              typeof backup?.firestore_records === "number"
                ? `Registros Firestore: ${recuento(backup.firestore_records)}`
                : `Registros Firestore: ${FALTA.toLocaleLowerCase("es")}`
            ]}
            now={now}
            state={healthState(freshness?.backup)}
            /* PLA-18: la misma copia se llama igual en Estado y en Operaciones. */
            title="Copia de la maestra"
          />
        </div>
      </Panel>

      <Panel
        claseDelCuerpo="stack stack--tight"
        subtitulo="Último inventario reconciliado"
        titulo="Conteos de la maestra"
        tituloId="system-counts-title"
      >
        {counts.length > 0 ? (
          /* Hasta diecinueve recuentos: una tabla de dos columnas, no una banda de cifras. */
          <TablaDeDatos
            columnas={COLUMNAS_DE_CONTEOS}
            filas={counts.map(({ key, value }) => ({
              id: key,
              rotulo: COUNT_LABELS[key] ?? readableKey(key),
              cifra: COUNTS_QUE_SON_SI_O_NO.has(key) ? (value > 0 ? "Sí" : "No") : recuento(value),
              valor: value
            }))}
            titulo="Conteos de la maestra"
          />
        ) : (
          <p className="system-data-missing">El semáforo publicado no incluye conteos.</p>
        )}
      </Panel>

      <Panel
        claseDelCuerpo="stack stack--tight"
        subtitulo="Ordenadas por severidad"
        titulo="Problemas detectados"
        tituloId="system-problems-title"
      >
        <ProblemList integrity={integrity} />
      </Panel>
    </div>
  );
}

