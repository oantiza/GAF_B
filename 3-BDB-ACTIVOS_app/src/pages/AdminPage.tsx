import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  adminIngestAsset,
  fetchAdminDbStatus,
  fetchAdminRefreshAllStale,
  refreshSampleRebuildLabel
} from "../adapters/adminBackend";
import { getSystemStatus } from "../adapters/systemStatusBackend";
import { SystemStatusContent } from "./SystemStatusPage";
import { useAsyncData } from "../core/useAsyncData";
import type { AdminDbStatus, AdminIngestAssetResult, AdminRefreshAllStaleResult } from "../types/admin";
import { AdminFundQuality } from "../components/AdminFundQuality";
import { AdminInspector } from "../components/AdminInspector";
import { AdminBackfill } from "../components/AdminBackfill";
import { AdminProgressBar, type AdminProgress } from "../components/AdminProgress";
import { AdminRetrocessions } from "../components/AdminRetrocessions";
import { LEE_LA_NUBE } from "../adapters/baseNuevaLectura";
import { AdminOperaciones } from "../components/AdminOperaciones";
import { EstadoDelCatalogoPanel } from "../components/EstadoDelCatalogoPanel";
import { useConfirm } from "../components/ui/useConfirm";
import { OPS_LOCAL_ENABLED } from "../config/runtimeConfig";
import { fecha, fechaYHora, numero } from "../core/formato";
import { readableBackendLabel, TYPE_LABELS } from "../core/labels";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { usePestanaEnLaDireccion } from "../core/usePestanaEnLaDireccion";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { Ausencia } from "../components/ui/Ausencia";
import { Aviso } from "../components/ui/Aviso";
import { Button } from "../components/ui/Button";
import { Campo } from "../components/ui/Campo";
import { Distintivo } from "../components/ui/Distintivo";
import { Esqueleto } from "../components/ui/Esqueleto";
import { PageHeader } from "../components/ui/PageHeader";
import { PanelDePestana, SegmentedTabs } from "../components/ui/SegmentedTabs";
import { Panel } from "../components/ui/Panel";

const MASTER_WRITES_ENV_LABEL = "BDB_ACTIVOS_ENABLE_MASTER_WRITES";
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const EODHD_SYMBOL_RE = /^[A-Z0-9][A-Z0-9._-]*\.[A-Z0-9][A-Z0-9_-]*$/;
/* Ola 3b (§5.4): «Estado del sistema» (antes página /sistema propia) es una
   pestaña más de esta página, que pasa a ser el único destino Sistema. */
type AdminSection =
  | "sistema"
  | "estado"
  | "calidad"
  | "historicos"
  | "inspeccion"
  | "retrocesiones"
  | "ingesta"
  | "operaciones"
  | "referencia";
type LegacyAdminTab = keyof typeof LEGACY_ADMIN_READONLY;

interface ReadOnlyPanelConfig {
  title: string;
  intro: string;
  status: { label: string; value: string }[];
  rows: { title: string; detail: string; meta?: string }[];
  loQueNoHace: string[];
}

const ADMIN_SECTIONS = [
  { id: "sistema", label: "Estado del sistema" },
  { id: "estado", label: "BBDD maestra" },
  { id: "calidad", label: "Calidad de fondos" },
  { id: "historicos", label: "Históricos" },
  { id: "inspeccion", label: "Inspección" },
  { id: "retrocesiones", label: "Retrocesiones" },
  { id: "ingesta", label: "Ingesta" },
  { id: "operaciones", label: "Operaciones" },
  { id: "referencia", label: "Referencia técnica" }
] as const;

/* «Operaciones» habla con el servicio local del extractor (loopback): solo se
   ofrece donde ese servicio puede existir (desarrollo). */
/* En la web publicada solo queda lo que lee la base nueva (Óscar, 04-11-2026). Lo demás habla con
   colecciones que allí no existen o llama a funciones que no se despliegan. */
const SECCIONES_DE_LA_NUBE = new Set(["sistema", "retrocesiones"]);
const VISIBLE_SECTIONS = ADMIN_SECTIONS.filter((s) => !LEE_LA_NUBE || SECCIONES_DE_LA_NUBE.has(s.id)).filter((s) => s.id !== "operaciones" || OPS_LOCAL_ENABLED);

const LEGACY_OPTIONS: Array<{ id: LegacyAdminTab; label: string }> = [
  { id: "parser", label: "Parser Morningstar" },
  { id: "review", label: "Cola de revisión" },
  { id: "optimizer", label: "Optimizador y restricciones" },
  { id: "artifacts", label: "Registros y artefactos" },
  { id: "settings", label: "Configuración" }
];

const LEGACY_ADMIN_READONLY: Record<"parser" | "review" | "optimizer" | "artifacts" | "settings", ReadOnlyPanelConfig> = {
  parser: {
    title: "Parser Morningstar",
    intro: "Estado informativo de la cadena del parser. No ejecuta el parser, no sube PDF y no llama a servicios externos.",
    status: [
      { label: "Modo", value: "Solo lectura" },
      { label: "Procesado PDF", value: "Deshabilitado" },
      { label: "Acciones en ejecución", value: "Ninguna" },
      { label: "Protección de escritura", value: "Fuera de la interfaz" }
    ],
    rows: [
      { title: "PDF de origen", detail: "Documento Morningstar original en formato PDF.", meta: "informativo" },
      { title: "Ejecución del parser", detail: "Ejecución controlada fuera del panel Admin.", meta: "bloqueado en la interfaz" },
      { title: "Resultado JSON", detail: "Datos extraídos y validados antes de revisión.", meta: "referencia" },
      { title: "Revisión", detail: "Revisión manual o automática previa a cualquier escritura.", meta: "solo seguimiento" },
      { title: "Protección de escritura", detail: "Copia previa, plan y verificación quedan fuera de esta pantalla.", meta: "sin acción" }
    ],
    loQueNoHace: [
      "No llama a Gemini ni a otras API desde aquí",
      "No ejecuta el parser",
      "No sube ni lee PDF",
      "Sin escrituras en la base"
    ]
  },
  review: {
    title: "Cola de revisión",
    intro: "Cola de supervisión heredada para incidencias de datos, parser, retrocesiones y optimizador.",
    status: [
      { label: "Modo", value: "Solo lectura" },
      { label: "Acciones", value: "Sin aprobar/resolver" },
      { label: "Origen", value: "Catálogo auditado" },
      { label: "Mutaciones", value: "Cero" }
    ],
    rows: [
      { title: "Retrocesiones excluidas de la protección de escritura", detail: "Casos donde el CSV no debía sobrescribir la BBDD comercial.", meta: "alta/media" },
      { title: "ISIN no encontrados", detail: "ISIN del CSV comercial sin correspondencia en la maestra.", meta: "datos" },
      { title: "Mixtos sin composición subyacente", detail: "Fondos mixtos sin desglose interno suficiente para el Análisis.", meta: "mixtos" },
      { title: "Avisos de volatilidad estimada", detail: "Casos donde el motor usa volatilidad estimada con aviso visible.", meta: "optimizador" },
      { title: "Parser REVIEW/BLOCKED", detail: "Estados del parser pendientes de integración dinámica segura.", meta: "parser" }
    ],
    loQueNoHace: [
      "No resuelve incidencias",
      "No aprueba cambios",
      "Sin llamadas que cambien datos",
      "Sin escrituras en la base"
    ]
  },
  optimizer: {
    title: "Optimizador / restricciones",
    intro: "Vista informativa de contratos, decisiones canónicas y duplicidades pendientes del optimizador.",
    status: [
      { label: "Optimizador", value: "Composición subyacente" },
      { label: "Mixtos", value: "Solo en informes" },
      { label: "Respaldo en pantalla", value: "Auditado" },
      { label: "Ejecución", value: "Ninguna" }
    ],
    rows: [
      { title: "Mixto no es una restricción dura", detail: "La clasificación MIXTO es un metadato de informe, no una restricción dura.", meta: "decisión" },
      { title: "asset_mix como fuente económica", detail: "El desglose RV/RF procede de portfolio_exposure (composición subyacente).", meta: "contrato" },
      { title: "Reparto 50/50 por defecto", detail: "Si falta desglose en fondos mixtos, se informa como aproximación auditable.", meta: "aviso" },
      { title: "locked_weights canónico", detail: "El contrato activo usa locked_weights; fixed_weights y locked_positions quedan fuera del request público.", meta: "cerrado" }
    ],
    loQueNoHace: [
      "No llama al optimizador",
      "No modifica restricciones",
      "No limpia ni corrige desde aquí",
      "Sin escrituras en la base"
    ]
  },
  artifacts: {
    title: "Registros / artefactos",
    intro: "Catálogo informativo de entregables heredados y artefactos de auditoría. No abre ficheros locales ni descarga nada.",
    status: [
      { label: "Índice", value: "Estático" },
      { label: "Ficheros locales", value: "Sin acceso" },
      { label: "Descargas", value: "Deshabilitadas" },
      { label: "Uso", value: "Auditoría" }
    ],
    rows: [
      { title: "Protección de retrocesiones", detail: "Copias previas, planes y verificaciones de la carga de retrocesiones.", meta: "cerrado" },
      { title: "Diseño de la consola Admin", detail: "Diseño heredado de la consola de solo lectura.", meta: "referencia" },
      { title: "Comprobación de despliegue", detail: "Verificación documental de funciones y reglas.", meta: "posterior al despliegue" },
      { title: "Limpieza de restricciones", detail: "Plan y pruebas de limpieza contractual del optimizador.", meta: "plan" },
      { title: "Estado del parser", detail: "Estado informativo del parser pendiente de integración dinámica.", meta: "parser" }
    ],
    loQueNoHace: [
      "No abre ficheros locales",
      "Sin descargas",
      "Sin acciones sobre los artefactos",
      "Catálogo solo informativo"
    ]
  },
  settings: {
    title: "Configuración",
    intro: "Resumen de solo lectura de la configuración y las protecciones. Las acciones reales siguen en el servidor.",
    status: [
      { label: "Escrituras maestras", value: "Protegidas" },
      { label: "Autorización admin", value: "Permiso específico" },
      { label: "Fuente de datos", value: "Configurada al arrancar" },
      { label: "Cambios", value: "No desde esta pestaña" }
    ],
    rows: [
      { title: "Indicadores de funcionalidad", detail: "Los indicadores productivos se gobiernan fuera del panel de solo lectura.", meta: "ejecución" },
      { title: "Perfiles de riesgo", detail: "Lectura canónica o de prueba según la configuración.", meta: "datos" },
      { title: "Reglas de seguridad", detail: "Desplegar reglas requiere autorización expresa.", meta: "seguridad" },
      { title: "Política de despliegue", detail: "Hosting, funciones y reglas se despliegan por encargos separados.", meta: "operación" }
    ],
    loQueNoHace: [
      "No edita la configuración",
      "No cambia indicadores",
      "No despliega desde aquí",
      "No cambia la seguridad"
    ]
  }
};

/** PLA-12: un recuento lleva siempre su punto de millar («1.097», no «1097»). */
const recuento = (valor: number) => numero(valor) ?? textoDeAusencia("falta");

function Card({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  /* PLA-12: las fechas ISO del backend, con el formato común («13/11/2026»), y los números con su punto de millar.
     Lo que no llega se dice con la pieza `Ausencia`: nunca una raya. */
  const isDateValue = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const displayValue =
    value === null || value === undefined || value === ""
      ? <Ausencia clase="falta" />
      : typeof value === "number"
        ? recuento(value)
        : isDateValue
          ? fecha(value)
          : value;
  const displaySub = sub && /^\d{4}-\d{2}-\d{2}$/.test(sub) ? fecha(sub) : sub;

  return (
    <div className={`metric${typeof displayValue === "string" && displayValue.length > 12 ? " metric--compact" : ""}`}>
      <span className="metric__label">{label}</span>
      <span className="metric__value">{displayValue}</span>
      {displaySub ? <span className="metric__note">{displaySub}</span> : null}
    </div>
  );
}

/** Recuento por categoría: pocas filas con su número al lado, sin barra. */
function Recuento({ data, labels }: { data: Record<string, number>; labels: Record<string, string> }) {
  return (
    <ul className="admin-bars admin-bars--recuento">
      {Object.entries(data).map(([key, value]) => (
        <li key={key}>
          <span className="admin-bars__label">{labels[key] ?? key}</span>
          <span className="admin-bars__value">{recuento(value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Histograma sobre un eje ordenado: aquí la barra enseña una forma que las cifras no dicen. */
function Bars({ data, labels }: { data: Record<string, number>; labels?: Record<string, string> }) {
  const entries = Object.entries(data);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <ul className="admin-bars">
      {entries.map(([key, value]) => (
        <li key={key}>
          <span className="admin-bars__label">{labels?.[key] ?? key}</span>
          <span className="bar-cell__track">
            <span className="bar-cell__fill" style={{ width: `${Math.max(1, (value / max) * 100)}%` }} />
          </span>
          <span className="admin-bars__value">{recuento(value)}</span>
        </li>
      ))}
    </ul>
  );
}

function ReadOnlyAdminPanel({ panel }: { panel: ReadOnlyPanelConfig }) {
  return (
    <div className="stack">
      <Panel
        claseDelCuerpo="stack stack--tight"
        subtitulo={panel.intro}
        titulo={panel.title}
      >
        <div className="metric-grid">
          {panel.status.map((item) => (
            <Card key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </Panel>
      <Panel
        claseDelCuerpo="stack stack--tight"
        titulo="Elementos"
      >
        <div className="stack stack--tight">
          {panel.rows.map((row) => (
            <div key={row.title} className="admin-readonly-row">
              <div>
                <strong className="admin-readonly-row__title">{row.title}</strong>
                <span className="admin-readonly-row__detail">{row.detail}</span>
              </div>
              {row.meta ? <span className="admin-readonly-meta">{row.meta}</span> : null}
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        claseDelCuerpo="stack stack--tight"
        titulo="Lo que esta pantalla no hace"
      >
        <div className="row">
          {panel.loQueNoHace.map((limite) => (
            <Distintivo key={limite}>{limite}</Distintivo>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/** PLA-12: toda fecha ISO del backend, con el formato común de la aplicación: «24/07/2026». Lo que no es ISO se deja
    tal cual, y lo que no llega se dice: nunca una raya, que se lee como un cero. */
function fmtDate(value?: string | null) {
  if (!value) return textoDeAusencia("falta");
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? (fecha(value.slice(0, 10)) ?? value) : value;
}

function isMasterWritesEnabled(status?: AdminDbStatus | null) {
  return status?.master_writes_enabled === true || status?.master_writes_mode === "enabled";
}

function RefreshSummary({ result }: { result: AdminRefreshAllStaleResult }) {
  const count = result.applied ? result.updated : result.would_update;
  return (
    <div className="admin-result">
      <div>
        {result.applied ? "Aplicado" : "Previsualizado"}: {recuento(count)}{" "}
        {result.applied ? "activos actualizados" : "candidatos a actualizar (último dato anterior a hoy)"} · procesados{" "}
        {recuento(result.processed)} · omitidos {recuento(result.skipped)} · errores {recuento(result.errors)} · fecha {fmtDate(result.ran_date)}
      </div>
      {result.sample && result.sample.length > 0 ? (
        <ul className="admin-mini-list">
          {result.sample.slice(0, 5).map((item) => {
            const rebuilt = refreshSampleRebuildLabel(item, result.applied);
            return (
              <li key={item.asset_id}>
                {rebuilt ? (
                  `${item.asset_id}: ${rebuilt}`
                ) : (
                  <>
                    {item.asset_id}: {fmtDate(item.last_date)} → {fmtDate(item.new_last)}
                    {typeof item.new_points === "number" ? ` (${recuento(item.new_points)} puntos)` : ""}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// Tamaño de lote por fase: el preview solo lee Firestore (lotes grandes);
// Aplicar llama a EODHD por activo desactualizado (lotes cortos, lejos del timeout).
const PREVIEW_CHUNK = 150;
const APPLY_CHUNK = 40;

function ManualRefreshPanel({ status, onStatusRefresh }: { status: AdminDbStatus; onStatusRefresh: () => void }) {
  const masterWritesEnabled = isMasterWritesEnabled(status);
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AdminRefreshAllStaleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AdminProgress | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRef = useRef(false);
  const [cancelled, setCancelled] = useState(false);
  // Cambiar de pestaña desmonta el panel: el bucle de lotes se corta en el
  // siguiente lote en vez de seguir escribiendo sin progreso visible (ALTA-12).
  useEffect(() => () => {
    cancelRef.current = true;
  }, []);
  const canApplyRefresh = !busy
    && masterWritesEnabled
    && !cancelled
    && !error
    && result?.applied === false
    && result.would_update > 0;

  const run = async (write: boolean) => {
    if (
      write &&
      !(await confirm({
        title: "¿Aplicar el refresco manual en la BBDD maestra?",
        message: "Se escribirán los históricos actualizados de los activos candidatos de la vista previa.",
        confirmLabel: "Aplicar",
        tone: "danger"
      }))
    ) {
      return;
    }
    const chunkSize = write ? APPLY_CHUNK : PREVIEW_CHUNK;
    // Denominador: total exacto del último preview si aplica; si no, el total de la maestra.
    const expectedTotal = (write ? result?.processed : 0) || status.total_assets || 0;
    setBusy(true);
    setError(null);
    setCancelled(false);
    setCancelRequested(false);
    cancelRef.current = false;
    setResult(null);
    const agg: AdminRefreshAllStaleResult = {
      processed: 0,
      updated: 0,
      would_update: 0,
      applied: write,
      skipped: 0,
      errors: 0,
      error_sample: [],
      sample: [],
      ran_date: ""
    };
    const phase: AdminProgress["phase"] = write ? "apply" : "preview";
    setProgress({ phase, done: 0, total: expectedTotal, hits: 0, skipped: 0, errors: 0 });
    let cursor: string | null = null;
    let wroteSomething = false;
    try {
      for (;;) {
        const r = await fetchAdminRefreshAllStale(write, { limit: chunkSize, startAfterAssetId: cursor });
        wroteSomething = wroteSomething || (write && r.updated > 0);
        agg.processed += r.processed;
        agg.updated += r.updated;
        agg.would_update += r.would_update;
        agg.skipped += r.skipped;
        agg.errors += r.errors;
        agg.ran_date = r.ran_date || agg.ran_date;
        agg.sample = [...(agg.sample ?? []), ...(r.sample ?? [])].slice(0, 10);
        agg.error_sample = [...(agg.error_sample ?? []), ...(r.error_sample ?? [])].slice(0, 10);
        setProgress({
          phase,
          done: agg.processed,
          total: Math.max(expectedTotal, agg.processed),
          hits: write ? agg.updated : agg.would_update,
          skipped: agg.skipped,
          errors: agg.errors
        });
        if (r.cycle_completed === true || !r.next_cursor) {
          break;
        }
        if (cancelRef.current) {
          setCancelled(true);
          break;
        }
        cursor = r.next_cursor;
      }
      setResult(agg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      if (agg.processed > 0) {
        setResult(agg); // resumen parcial: re-ejecutar es seguro (los ya al día se omiten)
      }
    } finally {
      setProgress(null);
      setBusy(false);
      setCancelRequested(false);
      if (wroteSomething) {
        onStatusRefresh();
      }
    }
  };

  const applying = progress?.phase === "apply";

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      subtitulo={`Previsualiza primero. La vista previa muestra candidatos; el número realmente actualizado se ve tras Aplicar. Aplicar escribe en la BBDD maestra y requiere admin + ${MASTER_WRITES_ENV_LABEL}.`}
      titulo="Refresco manual de históricos"
    >
      {/* El aviso de escrituras bloqueadas, una sola vez en la pestaña (la tarjeta de arriba solo dice el estado). */}
      {!masterWritesEnabled ? (
        <Aviso titulo="Escrituras maestras bloqueadas.">
          Puedes previsualizar, pero Aplicar queda deshabilitado hasta activar la protección en el servidor.
        </Aviso>
      ) : null}
      <div className="row">
        <Button size="sm" disabled={busy} onClick={() => void run(false)}>
          {busy && !applying ? "Ejecutando…" : "Previsualizar actualización"}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!canApplyRefresh}
          onClick={() => void run(true)}
        >
          {applying ? "Aplicando…" : "Aplicar actualización"}
        </Button>
        {busy ? (
          <Button
            size="sm"
            disabled={cancelRequested}
            onClick={() => {
              cancelRef.current = true;
              setCancelRequested(true);
            }}
          >
            {cancelRequested ? "Cancelando…" : "Cancelar"}
          </Button>
        ) : null}
      </div>
      {progress ? <AdminProgressBar progress={progress} cancelRequested={cancelRequested} /> : null}
      {cancelled ? (
        <p className="admin-panel__note">Cancelado: el resumen refleja solo los lotes completados. Re-ejecutar es seguro.</p>
      ) : null}
      {error ? (
        <Aviso titulo="No se pudo ejecutar el refresco manual." tono="error">
          {error}
        </Aviso>
      ) : null}
      {result ? <RefreshSummary result={result} /> : null}
      {confirmDialog}
    </Panel>
  );
}

function IngestSummary({ result }: { result: AdminIngestAssetResult }) {
  const history = result.history;
  const problem = !result.ok
    ? result.unsupported_type
      ? `Producto no admitido: ${result.unsupported_type}${result.note ? ` · ${result.note}` : ""}`
      : result.error ?? "No se pudo preparar la ingesta."
    : null;

  return (
    <div className="admin-result">
      {problem ? (
        <Aviso tono="error">{problem}</Aviso>
      ) : (
        <>
          <div className="metric-grid">
            <Card label="Resuelto" value={result.resolved ? "Sí" : "No"} />
            <Card label="Producto" value={result.asset_type ?? null} />
            <Card label="Fuente" value={result.provider ?? (result.symbol ? "EODHD" : null)} />
            <Card label="Símbolo" value={result.symbol ?? null} />
            <Card label="Nombre" value={result.name ?? null} />
            <Card
              label="Calidad"
              value={result.quality_status ?? null}
              sub={typeof result.quality_score === "number" ? `${result.quality_score} de 100` : undefined}
            />
            <Card label="Documento raíz" value={result.root_action ?? null} />
            <Card label="Existe en la maestra" value={result.exists_in_master ? "Sí" : "No"} />
          </div>
          {history ? (
            <div className="admin-result">
              Histórico: {history.loaded === false ? history.error ?? history.reason ?? "sin datos" : `${recuento(history.points ?? 0)} puntos${history.interval === "1mo" ? " mensuales" : ""}`}
              {history.first_date || history.last_date ? ` · ${fmtDate(history.first_date)} → ${fmtDate(history.last_date)}` : ""}
              {history.metrics?.available ? ` · métricas ${history.metrics.windows?.join(", ") ?? "OK"}` : ""}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function AdminIngestPanel() {
  const { confirm, confirmDialog } = useConfirm();
  const [status, setStatus] = useState<AdminDbStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<unknown>(null);
  const [isin, setIsin] = useState("");
  const [preferredSymbol, setPreferredSymbol] = useState("");
  const [withHistory, setWithHistory] = useState(true);
  const [busy, setBusy] = useState(false);
  // El resultado viaja con la clave de la entrada que lo produjo (CRIT-05): una
  // vista previa solo vale para el ISIN, el símbolo y la opción de histórico que
  // Óscar vio. Si la entrada cambia, el resultado deja de mostrarse y «Aplicar»
  // se deshabilita, aunque la respuesta de la petición vieja llegue después.
  const [outcome, setOutcome] = useState<{ key: string; result: AdminIngestAssetResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Solo la última petición lanzada puede escribir estado (respuestas viejas, fuera).
  const reqIdRef = useRef(0);

  const normalizedIsin = isin.trim().toUpperCase();
  const normalizedPreferredSymbol = preferredSymbol.trim().toUpperCase();
  const inputKey = `${normalizedIsin}|${normalizedPreferredSymbol}|${withHistory ? "historico" : "sin-historico"}`;
  const result = outcome && outcome.key === inputKey ? outcome.result : null;
  const hasIsin = normalizedIsin.length > 0;
  const formatOk = !hasIsin || ISIN_RE.test(normalizedIsin);
  const symbolFormatOk = !normalizedPreferredSymbol || EODHD_SYMBOL_RE.test(normalizedPreferredSymbol);
  const masterWritesEnabled = isMasterWritesEnabled(status);
  const historyReady = !withHistory || result?.history?.loaded === true;
  const canApply = !busy
    && masterWritesEnabled
    && result?.ok === true
    && result.preview === true
    && result.applied === false
    && historyReady;

  const loadStatus = () => {
    setStatusLoading(true);
    setStatusError(null);
    fetchAdminDbStatus()
      .then((s) => setStatus(s))
      .catch((cause: unknown) => {
        setStatus(null);
        setStatusError(cause);
      })
      .finally(() => setStatusLoading(false));
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(loadStatus, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const run = async (write: boolean) => {
    if (!hasIsin || !formatOk || !symbolFormatOk) return;
    // Aplicar exige una vista previa de esta misma entrada (la del botón ya lo
    // comprueba; esto lo blinda frente a un clic programático).
    if (write && !canApply) return;
    const key = inputKey;
    const symbolDetail = normalizedPreferredSymbol ? ` con símbolo ${normalizedPreferredSymbol}` : "";
    if (
      write &&
      !(await confirm({
        title: `¿Dar de alta ${normalizedIsin} en la BBDD maestra?`,
        message: `Alta${symbolDetail}${withHistory ? ", con carga del histórico" : ", sin histórico"}. La escritura requiere permiso de administrador.`,
        confirmLabel: "Dar de alta",
        tone: "danger"
      }))
    ) {
      return;
    }
    const requestId = ++reqIdRef.current;
    setBusy(true);
    setError(null);
    adminIngestAsset(normalizedIsin, withHistory, write, normalizedPreferredSymbol || undefined)
      .then((r) => {
        if (reqIdRef.current !== requestId) return;
        setOutcome({ key, result: r });
        if (write) loadStatus();
      })
      .catch((e) => {
        if (reqIdRef.current !== requestId) return;
        setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (reqIdRef.current !== requestId) return;
        setBusy(false);
      });
  };

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      subtitulo="Introduce un ISIN y el sistema detectará automáticamente si es un fondo Morningstar o un activo cotizado EODHD. Primero previsualiza y valida; después puedes aplicar el alta y su histórico."
      titulo="Alta y actualización por ISIN"
    >
      {!statusLoading && !masterWritesEnabled ? (
        <Aviso titulo="Escrituras maestras bloqueadas.">
          Puedes previsualizar, pero Aplicar queda deshabilitado hasta activar la protección en el servidor.
        </Aviso>
      ) : null}
      <div className="admin-form-grid">
        <Campo error={formatOk ? undefined : "Formato esperado: 2 letras + 9 alfanuméricos + dígito."} rotulo="ISIN">
          <input
            value={isin}
            disabled={busy}
            onChange={(e) => {
              setIsin(e.target.value.toUpperCase());
              setOutcome(null);
            }}
            placeholder="US0378331005"
            className={formatOk ? undefined : "is-invalid"}
          />
        </Campo>
        <label className="check">
          <input
            type="checkbox"
            checked={withHistory}
            disabled={busy}
            onChange={(e) => {
              setWithHistory(e.target.checked);
              setOutcome(null);
            }}
          />
          Incluir y actualizar histórico
        </label>
        <Campo
          error={symbolFormatOk ? undefined : "Formato esperado: TICKER.EXCHANGE."}
          opcional
          pista="Solo activos cotizados."
          rotulo="Símbolo EODHD"
        >
          <input
            value={preferredSymbol}
            disabled={busy}
            onChange={(e) => {
              setPreferredSymbol(e.target.value.toUpperCase());
              setOutcome(null);
            }}
            placeholder="SGRE.MC"
            className={symbolFormatOk ? undefined : "is-invalid"}
          />
        </Campo>
        <div className="row">
          <Button size="sm" disabled={busy || !hasIsin || !formatOk || !symbolFormatOk} onClick={() => void run(false)}>
            {busy ? "Ejecutando…" : "Previsualizar alta"}
          </Button>
          <Button size="sm" variant="danger" disabled={!canApply} onClick={() => void run(true)}>
            Aplicar
          </Button>
        </div>
      </div>
      {statusLoading ? <div className="admin-panel__note">Comprobando si la maestra admite escrituras…</div> : null}
      {statusError ? <AsyncErrorBanner error={statusError} onRetry={loadStatus} /> : null}
      {error ? (
        <Aviso titulo="No se pudo ejecutar la ingesta." tono="error">
          {error}
        </Aviso>
      ) : null}
      {result ? (
        <>
          <IngestSummary result={result} />
          <pre className="code-block admin-json">{JSON.stringify(result, null, 2)}</pre>
        </>
      ) : null}
      {confirmDialog}
    </Panel>
  );
}

function AdminStatus() {
  const [status, setStatus] = useState<AdminDbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchAdminDbStatus()
      .then((s) => setStatus(s))
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(load, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <div className="admin-status-stack">
      <div className="admin-content-toolbar">
        <Button busy={loading} onClick={load} size="sm" variant="secondary">
          {loading ? "Cargando…" : "Refrescar estado"}
        </Button>
      </div>

      {loading && !status ? (
        <>
          <p className="sr-only">Cargando el estado de la base maestra…</p>
          <Esqueleto lineas={6} />
        </>
      ) : null}

      {error && (
        <Aviso titulo="No se pudo cargar el estado." tono="error">
          {error}. Requiere permisos de administrador y el servidor desplegado.
        </Aviso>
      )}

      {status && (
        <>
          <div className="metric-grid">
            {(() => {
              const masterWritesEnabled = isMasterWritesEnabled(status);

              /* Solo el estado; el aviso de lo que eso impide va una vez, en el refresco manual. */
              return (
                <Card
                  label="Escrituras maestras"
                  value={
                    <Distintivo tono={masterWritesEnabled ? "marca" : "aviso"}>{masterWritesEnabled ? "Habilitadas" : "Bloqueadas"}</Distintivo>
                  }
                  sub={`Variable: ${status.master_writes_env ?? MASTER_WRITES_ENV_LABEL}`}
                />
              );
            })()}
            <Card label="Activos" value={status.total_assets} />
            <Card label="Con histórico" value={status.with_history} sub={`${recuento(status.without_history)} sin histórico`} />
            <Card label="Llegan a 2011" value={status.reach_2011} sub={`${recuento(status.not_reach_2011)} no llegan`} />
            <Card
              label="Dato anterior al umbral"
              value={status.stale}
              sub={`último dato hace más de ${recuento(status.stale_days_threshold)} días`}
            />
            <Card label="Último refresco" value={status.last_refresh_date ?? null} />
          </div>

          {/* PLA-18: «Último refresco» salía dos veces en la pestaña; se queda en la fila de arriba. */}
          <Panel
            claseDelCuerpo="stack stack--tight"
            titulo="Fechas reales de datos"
          >
            <div className="metric-grid">
              <Card label="Dato más reciente" value={fmtDate(status.latest_data_date)} />
              <Card
                label="Activo más rezagado"
                value={status.most_lagged?.[0]?.name || status.most_lagged?.[0]?.asset_id || null}
                sub={fmtDate(status.most_lagged?.[0]?.last_date)}
              />
            </div>
            {status.latest_by_type && Object.keys(status.latest_by_type).length > 0 ? (
              <div className="admin-inline-meta">
                {Object.entries(status.latest_by_type).map(([type, date]) => (
                  <span key={type}>{TYPE_LABELS[type] ?? readableBackendLabel(type)}: {fmtDate(date)}</span>
                ))}
              </div>
            ) : null}
            {status.most_lagged && status.most_lagged.length > 0 ? (
              <ol className="admin-mini-list">
                {status.most_lagged.map((asset) => (
                  <li key={asset.asset_id}>
                    {asset.name || asset.asset_id} · {TYPE_LABELS[asset.type] ?? readableBackendLabel(asset.type)} · {fmtDate(asset.last_date)}
                  </li>
                ))}
              </ol>
            ) : null}
            <p className="admin-panel__note">
              Los desactualizados son activos con último dato anterior al umbral. No descuenta festivos ni calendarios de mercado: decides tú.
            </p>
          </Panel>

          <ManualRefreshPanel status={status} onStatusRefresh={load} />

          <Panel
            claseDelCuerpo="stack stack--tight"
            titulo="Por producto"
          >
            <Recuento data={status.by_type} labels={TYPE_LABELS} />
          </Panel>

          <Panel
            claseDelCuerpo="stack stack--tight"
            titulo="Inicio del histórico (por año)"
          >
            <Bars data={status.start_year_histogram} />
          </Panel>

          <Panel
            claseDelCuerpo="stack stack--tight"
            titulo="Métricas presentes"
          >
            <div className="metric-grid">
              <Card label="Volatilidad" value={status.metrics_present.vol} />
              <Card label="Sharpe" value={status.metrics_present.sharpe} />
              <Card label="SRRI" value={status.metrics_present.srri} />
              <Card label="Caída máxima 5 años" value={status.metrics_present.mdd} />
              <Card label="Caída máxima histórica" value={status.metrics_present.mdd_hist} />
            </div>
          </Panel>

          <Panel
            claseDelCuerpo="stack stack--tight"
            titulo="Anomalías"
          >
            <div className="metric-grid">
              <Card label="Sin histórico" value={status.anomalies.sin_historico} />
              <Card label="Desactualizados" value={status.anomalies.desactualizados} />
              <Card label="No llegan a 2011" value={status.anomalies.no_llega_2011} />
              <Card label="Valle reciente" value={status.anomalies.valle_reciente} sub="posible dato sospechoso" />
              <Card label="Total marcados" value={status.anomalies.total_flagged} />
            </div>
          </Panel>

          <p className="page-footnote">
            Generado: {fechaYHora(status.generated_at) ?? textoDeAusencia("falta")}. {/* PLA-12: el formato común */}
          </p>
        </>
      )}
    </div>
  );
}

/** Pestaña «Estado del sistema»: el semáforo de integridad que antes era la
    página /sistema, con su propio ciclo de carga y botón de actualización. */
export function SystemStatusTab({
  loadStatus = getSystemStatus,
  reloj = () => new Date()
}: {
  loadStatus?: typeof getSystemStatus;
  /** De dónde sale la hora: se inyecta en las pruebas. */
  reloj?: () => Date;
} = {}) {
  const load = useAsyncData(loadStatus, [loadStatus], { initialData: null });
  /* PLA-23: la antigüedad se mide contra la hora en que llega cada respuesta. Antes se fijaba al abrir la pestaña, y
     «Actualizar» recargaba el semáforo pero seguía contando los días desde entonces. */
  const [referenceNow, setReferenceNow] = useState(reloj);
  const [datosVistos, setDatosVistos] = useState(load.data);
  if (datosVistos !== load.data) {
    setDatosVistos(load.data);
    setReferenceNow(reloj());
  }

  return (
    <div className="system-status-page">
      <div className="admin-refresh-row">
        <Button busy={load.loading} onClick={load.retry} size="sm" variant="secondary">
          Actualizar
        </Button>
      </div>
      {load.error ? <AsyncErrorBanner error={load.error} onRetry={load.retry} /> : null}
      {!load.data && !load.error ? (
        <>
          <p className="sr-only">Cargando el estado operativo…</p>
          <Esqueleto lineas={5} />
        </>
      ) : null}
      {load.data ? <SystemStatusContent now={referenceNow} snapshot={load.data} /> : null}
    </div>
  );
}

const IDS_DE_SECCION: readonly AdminSection[] = VISIBLE_SECTIONS.map((seccion) => seccion.id);

export function AdminPage() {
  /* Las pestañas van en la dirección (`/sistema#pestana=retrocesiones`): se puede recargar, compartir y volver con
     «Atrás». Las nueve siguen, también «Referencia técnica»; en la web publicada, solo las que leen la base nueva. */
  const [section, setSection] = usePestanaEnLaDireccion<AdminSection>(IDS_DE_SECCION, "sistema");
  const [legacyTab, setLegacyTab] = useState<LegacyAdminTab>("parser");

  return (
    <section className="admin-page">
      <PageHeader
        actions={LEE_LA_NUBE ? undefined : <Distintivo>Escrituras maestras protegidas</Distintivo>}
        className="admin-page-head"
        description={
          LEE_LA_NUBE
            ? "Cómo está el catálogo, qué fondos hay que revisar y las retrocesiones."
            : "Integridad diaria, salud de la base maestra, carga de históricos, inspección por activo, ingesta EODHD, retrocesiones comerciales y operaciones del extractor."
        }
        eyebrow="Datos · solo administración"
        title="Sistema"
      />

      <SegmentedTabs
        idPrefix="admin"
        label="Áreas de administración"
        onChange={setSection}
        tabs={VISIBLE_SECTIONS}
        value={section}
      />

      <PanelDePestana className="admin-tab-panel" idPrefix="admin" pestana={section}>
        {section === "sistema" ? (
          <>
            {/* Primero el veredicto: «Requiere atención» quedaba a 1.900 px, tras 28 filas de la tabla
                de fondos para revisar. En la web publicada solo está el catálogo. */}
            {LEE_LA_NUBE ? null : <SystemStatusTab />}
            <EstadoDelCatalogoPanel />
          </>
        ) : section === "estado" ? (
          <AdminStatus />
        ) : section === "retrocesiones" ? (
          <AdminRetrocessions />
        ) : section === "calidad" ? (
          <AdminFundQuality />
        ) : section === "historicos" ? (
          <AdminBackfill />
        ) : section === "inspeccion" ? (
          <AdminInspector />
        ) : section === "ingesta" ? (
          <AdminIngestPanel />
        ) : section === "operaciones" ? (
          <AdminOperaciones onOpenIngesta={() => setSection("ingesta")} />
        ) : (
          <>
            <Campo className="admin-reference-picker" rotulo="Documento de referencia">
              <select value={legacyTab} onChange={(event) => setLegacyTab(event.target.value as LegacyAdminTab)}>
                {LEGACY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </Campo>
            <ReadOnlyAdminPanel panel={LEGACY_ADMIN_READONLY[legacyTab]} />
          </>
        )}
      </PanelDePestana>
    </section>
  );
}


