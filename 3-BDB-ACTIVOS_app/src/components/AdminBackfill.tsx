/**
 * AdminBackfill — pestaña "Históricos" del panel Admin: gestiona la carga inicial de
 * price_series para los activos sin histórico. Flujo gated: inventario (read-only) →
 * previsualizar (EODHD, sin escrituras) → cargar (create-only, requiere master writes).
 * El cliente trocea los lotes y pinta progreso con cancelación (mismo patrón que el
 * refresco manual). Nunca toca series existentes.
 */
import { Aviso } from "./ui/Aviso";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/Button";
import { useConfirm } from "./ui/useConfirm";
import { backfillCodeLabel, readableBackendLabel, TYPE_LABELS } from "../core/labels";
import { fecha, numero } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import {
  fetchAdminBackfillCandidates,
  fetchAdminDbStatus,
  runAdminBackfillHistory
} from "../adapters/adminBackend";
import type {
  AdminBackfillAssetResult,
  AdminBackfillCandidatesResult,
  AdminDbStatus
} from "../types/admin";
import { AdminProgressBar, type AdminProgress } from "./AdminProgress";
import { Panel } from "./ui/Panel";

/* PLA-12: fechas y recuentos con el formato común de la aplicación («13/11/2026», «13/11/2026 10:30», «1.097»), y lo
   que no llega se dice con su palabra: nunca una raya ni «N/D», que se leen como un dato. */
const FALTA = textoDeAusencia("falta");
const diaDe = (iso?: string | null) => (iso ? (fecha(iso) ?? iso) : FALTA);
const recuento = (valor: number) => numero(valor) ?? FALTA;

const CHUNK = 10; // activos por llamada (cada uno = 1-2 peticiones EODHD en el backend)

const TITLES = { preview: "Previsualizando carga", apply: "Cargando históricos" };
const HITS_LABELS = { preview: "cargables", apply: "cargados" };

type RunSummary = {
  applied: boolean;
  processed: number;
  loadable: number;
  loaded: number;
  skipped: number;
  review: number;
  errors: number;
};

function outcomeLabel(r: AdminBackfillAssetResult): { text: string; tone: "ok" | "warn" | "err" | "done" } {
  /* Auditoría 16-10: «CARGADO», «ERROR» y «REVIEW» salían en mayúsculas y en inglés. */
  if (r.applied) return { text: `Cargado (${r.docs_created} ${r.docs_created === 1 ? "documento" : "documentos"})`, tone: "done" };
  if (r.error) return { text: "Error", tone: "err" };
  // skipped y reason llegan como códigos del backend: se traducen al leerlos.
  if (r.skipped) return { text: backfillCodeLabel(r.skipped), tone: "warn" };
  if (!r.ok) return { text: r.reason ? backfillCodeLabel(r.reason) : "Revisar", tone: "warn" };
  return { text: "OK · cargable", tone: "ok" };
}

export function AdminBackfill() {
  const { confirm, confirmDialog } = useConfirm();
  const [status, setStatus] = useState<AdminDbStatus | null>(null);
  const [inventory, setInventory] = useState<AdminBackfillCandidatesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AdminProgress | null>(null);
  const [results, setResults] = useState<AdminBackfillAssetResult[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const cancelRef = useRef(false);
  const [loadableIds, setLoadableIds] = useState<string[] | null>(null);

  const masterWritesEnabled = status?.master_writes_enabled === true || status?.master_writes_mode === "enabled";

  const loadInventory = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchAdminBackfillCandidates(), fetchAdminDbStatus()])
      .then(([inv, st]) => {
        setInventory(inv);
        setStatus(st);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(loadInventory, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  // Cambiar de pestaña desmonta el panel: el bucle de lotes se corta tras el
  // lote en curso en vez de seguir cargando sin progreso visible (ALTA-12).
  useEffect(() => () => {
    cancelRef.current = true;
  }, []);

  const runBatch = async (write: boolean, idsOverride?: string[]) => {
    const ids = idsOverride ?? (write ? loadableIds ?? [] : inventory?.candidates.map((c) => c.asset_id) ?? []);
    if (ids.length === 0) return;
    if (
      write &&
      !(await confirm({
        title: `¿Cargar el histórico completo de ${ids.length} activo(s) en la BBDD maestra?`,
        message: "EODHD desde 1990, normalizado a EUR. Solo se escriben series vacías; nunca se sobreescribe.",
        confirmLabel: "Cargar",
        tone: "danger"
      }))
    ) {
      return;
    }
    setBusy(true);
    setRunError(null);
    setCancelled(false);
    setCancelRequested(false);
    cancelRef.current = false;
    /* PLA-15: cargar una sola fila no tira el detalle de la vista previa de las demás: se funde por activo. */
    const deUnaFila = write && idsOverride !== undefined;
    if (!deUnaFila) setResults([]);
    setSummary(null);
    if (!write) setLoadableIds(null);
    const phase: AdminProgress["phase"] = write ? "apply" : "preview";
    const agg: RunSummary = { applied: write, processed: 0, loadable: 0, loaded: 0, skipped: 0, review: 0, errors: 0 };
    const allResults: AdminBackfillAssetResult[] = [];
    setProgress({ phase, done: 0, total: ids.length, hits: 0, skipped: 0, errors: 0 });
    let wrote = false;
    try {
      for (let offset = 0; offset < ids.length; offset += CHUNK) {
        const r = await runAdminBackfillHistory(ids.slice(offset, offset + CHUNK), write);
        wrote = wrote || (write && r.loaded > 0);
        agg.processed += r.processed;
        agg.loadable += r.loadable;
        agg.loaded += r.loaded;
        agg.skipped += r.skipped;
        agg.review += r.review;
        agg.errors += r.errors;
        allResults.push(...r.results);
        if (deUnaFila) {
          const lote = [...allResults];
          const nuevos = new Map(lote.map((res) => [res.asset_id, res]));
          setResults((actuales) => [
            ...actuales.map((res) => nuevos.get(res.asset_id) ?? res),
            ...lote.filter((res) => !actuales.some((otro) => otro.asset_id === res.asset_id))
          ]);
        } else {
          setResults([...allResults]);
        }
        setProgress({
          phase,
          done: agg.processed,
          total: ids.length,
          hits: write ? agg.loaded : agg.loadable,
          skipped: agg.skipped + agg.review,
          errors: agg.errors
        });
        if (cancelRef.current) {
          setCancelled(true);
          break;
        }
      }
      setSummary(agg);
      if (!write) {
        setLoadableIds(allResults.filter((r) => r.ok && !r.applied).map((r) => r.asset_id));
      } else {
        /* Lo ya cargado deja de contar en «Cargar históricos (N)». */
        const cargados = new Set(allResults.filter((r) => r.applied).map((r) => r.asset_id));
        setLoadableIds((actuales) => (actuales ? actuales.filter((id) => !cargados.has(id)) : actuales));
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Error");
      if (agg.processed > 0) setSummary(agg);
    } finally {
      setProgress(null);
      setBusy(false);
      setCancelRequested(false);
      if (wrote) loadInventory(); // los cargados salen del inventario; re-ejecutar es seguro
    }
  };

  const loadOne = (assetId: string) => runBatch(true, [assetId]);

  const candidateCount = inventory?.candidates.length ?? 0;
  const applying = progress?.phase === "apply";

  return (
    <div className="backfill">
      <Panel
        claseDelCuerpo="stack stack--tight"
        subtitulo="Carga inicial completa desde EODHD (desde 1990, normalizada a EUR) para los activos de la maestra sin ningún dato en su serie de precios. Previsualiza primero: resuelve el símbolo y descarga la serie sin escribir. Cargar escribe solo series vacías, nunca sobreescribe, y requiere permisos de administrador y escrituras maestras habilitadas."
        titulo="Carga de históricos (activos sin serie)"
      >
        {!masterWritesEnabled && !loading ? (
          <Aviso titulo="Escrituras maestras bloqueadas.">
            Puedes previsualizar; Cargar queda deshabilitado hasta activar la protección en el servidor.
          </Aviso>
        ) : null}

        {inventory ? (
          <div className="metric-grid">
            <div className="metric">
              <span className="metric__label">Sin histórico</span>
              <span className="metric__value">{candidateCount}</span>
              <span className="metric__note">de {inventory.total_roots} activos raíz · {inventory.excluded} excluidos</span>
            </div>
            <div className="metric">
              <span className="metric__label">Por producto</span>
              <div className="metric__note backfill-type-list">
                {Object.entries(inventory.by_type).map(([t, n]) => (
                  <span key={t}>
                    {TYPE_LABELS[t] ?? readableBackendLabel(t)}: <strong>{n}</strong>
                  </span>
                ))}
              </div>
            </div>
            <div className="metric">
              <span className="metric__label">Con pista EODHD</span>
              <span className="metric__value">{inventory.candidates.filter((c) => c.eodhd_hint).length}</span>
              <span className="metric__note">el resto se resuelve por ISIN (/search)</span>
            </div>
          </div>
        ) : null}

        <div className="backfill-actions">
          <Button disabled={busy || loading} onClick={loadInventory}>
            {loading ? "Buscando candidatos…" : "Recargar candidatos"}
          </Button>
          <Button
            disabled={busy || loading || candidateCount === 0}
            onClick={() => runBatch(false)}
          >
            {busy && !applying ? "Previsualizando…" : `Previsualizar carga (${candidateCount})`}
          </Button>
          <Button
            variant="primary"
            disabled={busy || loading || !masterWritesEnabled || !loadableIds || loadableIds.length === 0}
            onClick={() => runBatch(true)}
          >
            {applying ? "Cargando…" : `Cargar históricos${loadableIds ? ` (${loadableIds.length})` : ""}`}
          </Button>
          {busy ? (
            <Button
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

        {progress ? (
          <AdminProgressBar progress={progress} cancelRequested={cancelRequested} titles={TITLES} hitsLabels={HITS_LABELS} />
        ) : null}
        {cancelled ? (
          <p className="admin-panel__note">Cancelado: los resultados reflejan solo los lotes completados. Re-ejecutar es seguro.</p>
        ) : null}
        {loadError ? (
          <Aviso tono="error">No se pudo cargar el inventario: {loadError}</Aviso>
        ) : null}
        {runError ? (
          <Aviso tono="error">No se pudo completar la operación: {runError}</Aviso>
        ) : null}

        {summary ? (
          <div className="admin-result">
            {summary.applied ? (
              <span>
                Cargados <strong>{summary.loaded}</strong> de {summary.processed} procesados · omitidos {summary.skipped} ·
                revisar {summary.review} · errores {summary.errors}
              </span>
            ) : (
              <span>
                Previsualizado: <strong>{summary.loadable}</strong> cargables de {summary.processed} procesados · omitidos{" "}
                {summary.skipped} · revisar {summary.review} · errores {summary.errors}
              </span>
            )}
          </div>
        ) : null}
      </Panel>

      {results.length > 0 ? (
        <Panel
          claseDelCuerpo="stack stack--tight"
          titulo="Detalle por activo"
        >
          <div aria-label="Activos sin histórico (tabla desplazable)" className="report-table-wrapper backfill-table-wrapper" role="group" tabIndex={0}>
            <table className="report-table backfill-table" aria-label="Activos sin histórico">
              <thead>
                <tr>
                  <th scope="col">ISIN</th>
                  <th scope="col">Resolución</th>
                  <th scope="col">Símbolo</th>
                  <th scope="col">Divisa</th>
                  <th scope="col" className="num">Puntos</th>
                  <th scope="col">Rango</th>
                  <th scope="col">Estado</th>
                  <th scope="col"><span className="ui-visually-hidden">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const o = outcomeLabel(r);
                  return (
                    <tr key={r.asset_id}>
                      <td>{r.asset_id}</td>
                      <td>{r.resolution ? backfillCodeLabel(r.resolution) : FALTA}</td>
                      <td>{r.symbol ?? FALTA}</td>
                      <td>{r.currency ?? FALTA}</td>
                      <td className="num">{r.points ? recuento(r.points) : FALTA}</td>
                      <td>
                        {r.first_date ? `${diaDe(r.first_date)} → ${r.last_date ? diaDe(r.last_date) : FALTA}` : FALTA}
                      </td>
                      <td>
                        <span className={`backfill-outcome backfill-outcome--${o.tone}`}>{o.text}</span>
                        {r.error ? <span className="backfill-error-detail"> · {r.error}</span> : null}
                      </td>
                      <td>
                        {r.ok && !r.applied && masterWritesEnabled ? (
                          <Button size="sm" disabled={busy} onClick={() => loadOne(r.asset_id)}>
                            Cargar
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="admin-panel__note">
            Los REVIEW (sin símbolo EODHD, sin datos, sin divisa) no se escriben nunca: decidir fuente alternativa o
            dejarlos documentados. Tras una carga, las métricas las rellena el refresco diario.
          </p>
        </Panel>
      ) : null}
      {confirmDialog}
    </div>
  );
}
