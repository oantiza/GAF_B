import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Aviso } from "./ui/Aviso";
import { Distintivo } from "./ui/Distintivo";
import { Button } from "./ui/Button";
import { EnlaceAFicha } from "./ui/EnlaceAFicha";
import { useConfirm } from "./ui/useConfirm";
import {
  canApplyRefreshAssetPrices,
  describeHistoryRebuild,
  fetchAdminAssets,
  fetchAdminAssetDetail,
  recomputeMetric,
  refreshAssetPrices
} from "../adapters/adminBackend";
import { readableBackendLabel, TYPE_LABELS } from "../core/labels";
import { fecha, numero, porcentaje } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type {
  AdminAssetDetail,
  AdminAssetRow,
  AdminRecomputeMetricResult,
  AdminRefreshAssetPricesResult
} from "../types/admin";
import { Panel } from "./ui/Panel";

/* PLA-12: fechas y recuentos con el formato común de la aplicación («13/11/2026», «13/11/2026 10:30», «1.097»), y lo
   que no llega se dice con su palabra: nunca una raya ni «N/D», que se leen como un dato. */
const FALTA = textoDeAusencia("falta");
const diaDe = (iso?: string | null) => (iso ? (fecha(iso) ?? iso) : FALTA);
const recuento = (valor: number) => numero(valor) ?? FALTA;

const PAGE = 50;
/* Salta en casi todas las filas de la base local (46 de 50 en la primera página): como aviso no avisa
   de nada. Es un dato de la serie, y va con los años. */
const FLAG_NO_LLEGA_2011 = "NO_LLEGA_2011";
const SLOW_LOADING_MS = 15_000;
const LOAD_TIMEOUT_MS = 45_000;
const SLOW_LOADING_MESSAGE =
  "El listado está tardando más de lo esperado. Puede deberse al cálculo de histórico por activo en el backend. Prueba a refrescar o aplicar filtros.";
const LOAD_TIMEOUT_MESSAGE =
  "El listado no respondió a tiempo. Puede deberse al cálculo de histórico por activo en el backend. Prueba a refrescar o aplicar filtros.";
type LastDateSort = "asc" | "desc" | null;
type ManualActionKind = "metric" | "prices";
type ManualActionResult =
  | { kind: "metric"; data: AdminRecomputeMetricResult }
  | { kind: "prices"; data: AdminRefreshAssetPricesResult }
  | { kind: ManualActionKind; failure: string };

/** Valores decimales del contrato de métricas (−0,284 → «−28,4 %»). */
function fmtDecimalPct(v?: number): string {
  return typeof v === "number" ? (porcentaje(v, { decimales: 1 }) ?? FALTA) : FALTA;
}

function canApplyManualAction(result: ManualActionResult): boolean {
  if ("failure" in result) return false;
  if (result.kind === "metric") {
    return result.data.found
      && result.data.enough_data === true
      && result.data.applied !== true
      && !result.data.error
      && result.data.max_drawdown_hist !== undefined;
  }
  return canApplyRefreshAssetPrices(result.data);
}

export function AdminInspector() {
  const [type, setType] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [rows, setRows] = useState<AdminAssetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminAssetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const [lastDateSort, setLastDateSort] = useState<LastDateSort>(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const requestedOffsetRef = useRef(0);
  const slowTimerRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);
  /* El botón «Inspeccionar» que abrió el detalle: al cerrarlo, el foco vuelve a él y no se pierde en la página. */
  const disparadorRef = useRef<HTMLButtonElement | null>(null);
  const idDelDetalle = useId();

  const clearLoadTimers = useCallback(() => {
    if (slowTimerRef.current !== null) {
      window.clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
    if (timeoutTimerRef.current !== null) {
      window.clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      detailRequestIdRef.current += 1;
      clearLoadTimers();
    };
  }, [clearLoadTimers]);

  const load = useCallback((off: number) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    requestedOffsetRef.current = off;
    let timedOut = false;
    clearLoadTimers();
    setLoading(true);
    setSlowLoading(false);
    setError(null);

    slowTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setSlowLoading(true);
      }
    }, SLOW_LOADING_MS);

    timeoutTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current && requestIdRef.current === requestId) {
        timedOut = true;
        setLoading(false);
        setSlowLoading(false);
        setError(LOAD_TIMEOUT_MESSAGE);
      }
    }, LOAD_TIMEOUT_MS);

    fetchAdminAssets({
      type: type || null,
      onlyFlagged,
      limit: PAGE,
      offset: off,
      // Auditoría 27-07 (T3): el orden por fecha lo aplica visibleRows en
      // cliente sobre la página cargada; pedirlo también al servidor hacía que
      // cada alternancia del orden refetcheara la página 0 entera.
      sortBy: null,
      sortDir: "asc"
    })
      .then((p) => {
        if (!mountedRef.current || requestIdRef.current !== requestId || timedOut) return;
        setRows(p.items);
        setTotal(p.total);
        setOffset(p.offset);
      })
      .catch((e) => {
        if (!mountedRef.current || requestIdRef.current !== requestId || timedOut) return;
        setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        clearLoadTimers();
        if (!timedOut) {
          setLoading(false);
          setSlowLoading(false);
        }
      });
  }, [clearLoadTimers, onlyFlagged, type]);

  const retryLoad = useCallback(() => {
    load(requestedOffsetRef.current);
  }, [load]);

  const visibleRows = useMemo(() => {
    if (!lastDateSort) return rows;
    return [...rows].sort((a, b) => {
      const left = a.last_date ?? "";
      const right = b.last_date ?? "";
      return lastDateSort === "asc" ? left.localeCompare(right) : right.localeCompare(left);
    });
  }, [lastDateSort, rows]);

  /* La base local no trae nombres: la columna enseña el ISIN, y se llama como lo que enseña. */
  const hayNombres = rows.some((row) => row.name && row.name !== row.asset_id);

  const toggleLastDateSort = () => {
    setLastDateSort((current) => (current === "asc" ? "desc" : current === "desc" ? null : "asc"));
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => load(0), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const openDetail = (id: string) => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetailAssetId(id);
    setDetailLoading(true);
    setDetailError(null);
    setSelected(null);
    fetchAdminAssetDetail(id)
      .then((d) => {
        if (!mountedRef.current || detailRequestIdRef.current !== requestId) return;
        setSelected(d);
      })
      .catch((cause) => {
        if (!mountedRef.current || detailRequestIdRef.current !== requestId) return;
        setDetailError(cause instanceof Error ? cause.message : "No se pudo cargar la ficha del activo.");
      })
      .finally(() => {
        if (!mountedRef.current || detailRequestIdRef.current !== requestId) return;
        setDetailLoading(false);
      });
  };

  const closeDetail = () => {
    detailRequestIdRef.current += 1;
    setDetailLoading(false);
    setDetailError(null);
    setDetailAssetId(null);
    setSelected(null);
    const disparador = disparadorRef.current;
    disparadorRef.current = null;
    if (disparador?.isConnected) disparador.focus();
  };

  /* PLA-02: la fila no se enfoca, así que el detalle se abre y se cierra desde un botón propio de cada fila. */
  const alternarDetalle = (id: string, boton: HTMLButtonElement) => {
    if (detailAssetId === id) {
      closeDetail();
      return;
    }
    disparadorRef.current = boton;
    openDetail(id);
  };

  return (
    <div className="inspector">
      <div className="inspector-toolbar">
        <label className="check">
          Producto:
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos</option>
            <option value="FUND">Fondos</option>
            <option value="ETF">ETF</option>
            <option value="STOCK">Acciones</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          Solo con anomalías
        </label>
        <span className="inspector-meta">{loading ? "Cargando…" : `${total} activos`}</span>
      </div>
      <div aria-label="Inspección por activo (tabla desplazable)" className="report-table-wrapper inspector-table-wrapper" role="group" tabIndex={0}>
        <table className="report-table inspector-table" aria-label="Inspección por activo">
          <thead>
            <tr>
              <th scope="col">{hayNombres ? "Nombre" : "ISIN"}</th>
              <th scope="col">Producto</th>
              <th scope="col">Símbolo</th>
              <th scope="col">Desde</th>
              {/* PLA-20: el orden se anuncia en la cabecera; las flechas son solo para la vista. */}
              <th aria-sort={lastDateSort === "asc" ? "ascending" : lastDateSort === "desc" ? "descending" : undefined} scope="col">
                {/* Botón desnudo: hereda la tipografía de la cabecera (reset de base.css). La primitiva Button impondría alto, relleno y color propios dentro de la celda. */}
                <button type="button" onClick={toggleLastDateSort}>
                  Hasta <span aria-hidden="true">{lastDateSort === "asc" ? "↑" : lastDateSort === "desc" ? "↓" : "↕"}</span>
                </button>
              </th>
              <th scope="col" className="num">Pts</th>
              <th scope="col" className="num">Años</th>
              <th scope="col">Avisos</th>
              <th scope="col">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.asset_id} onClick={() => openDetail(r.asset_id)} className="inspector-row">
                <td>
                  <EnlaceAFicha isin={r.asset_id}>{r.name || r.asset_id}</EnlaceAFicha>
                </td>
                {/* D2.2: etiqueta en español, nunca el código del backend. */}
                <td>{TYPE_LABELS[r.type] ?? readableBackendLabel(r.type)}</td>
                <td>{r.symbol ?? FALTA}</td>
                {/* D2.1: fecha del sistema, no ISO cruda. */}
                <td>{r.first_date ? diaDe(r.first_date) : FALTA}</td>
                <td>{r.last_date ? diaDe(r.last_date) : FALTA}</td>
                <td className="num">{r.points}</td>
                <td className="num">
                  {r.years ?? FALTA}
                  {r.flags.includes(FLAG_NO_LLEGA_2011) ? <span className="inspector-dato">{readableBackendLabel(FLAG_NO_LLEGA_2011)}</span> : null}
                </td>
                <td>
                  <div className="inspector-flags">
                    {r.flags.filter((f) => f !== FLAG_NO_LLEGA_2011).map((f) => (
                      <Distintivo key={f} tono="aviso">{readableBackendLabel(f)}</Distintivo>
                    ))}
                  </div>
                </td>
                <td>
                  <Button
                    aria-controls={idDelDetalle}
                    aria-expanded={detailAssetId === r.asset_id}
                    aria-label={`Inspeccionar ${r.name || r.asset_id}`}
                    onClick={(evento) => {
                      /* Sin esto, el clic llegaría también a la fila y volvería a abrir lo que acaba de cerrar. */
                      evento.stopPropagation();
                      alternarDetalle(r.asset_id, evento.currentTarget);
                    }}
                    size="sm"
                  >
                    Inspeccionar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="inspector-pagination">
        <Button size="sm" disabled={loading || offset === 0} onClick={() => load(Math.max(0, offset - PAGE))}>
          ← Anterior
        </Button>
        <span className="inspector-meta">
          {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE, total)}`} de {total}
        </span>
        <Button size="sm" disabled={loading || offset + PAGE >= total} onClick={() => load(offset + PAGE)}>
          Siguiente →
        </Button>
      </div>

      {slowLoading && !error && (
        <Aviso
          accion={
            <>
              <Button size="sm" onClick={retryLoad}>
                Reintentar
              </Button>
            </>
          }
          anunciar
        >
          {SLOW_LOADING_MESSAGE} La inspección es de solo lectura; este reintento no ejecuta escrituras.
        </Aviso>
      )}

      {error && (
        <Aviso
          accion={
            <>
              <Button size="sm" onClick={retryLoad}>
                Reintentar
              </Button>
            </>
          }
          tono="error"
        >
          Error: {error} La inspección es de solo lectura; este reintento no ejecuta escrituras.
        </Aviso>
      )}

      {(detailLoading || selected || detailError) && (
        <section className="panel" id={idDelDetalle}>
          {detailLoading ? (
            <p className="ui-async-state">Cargando ficha…</p>
          ) : selected ? (
            // La clave remonta la ficha al cambiar de activo: su vista previa y su
            // «Aplicar» nunca sobreviven de un activo a otro (CRIT-06, blindaje).
            <Ficha key={selected.meta.asset_id} d={selected} onClose={closeDetail} />
          ) : detailError ? (
            <div className="panel__body">
              <Aviso
                accion={
                  <>
                    <Button size="sm" onClick={() => detailAssetId && openDetail(detailAssetId)}>
                      Reintentar
                    </Button>
                    <Button size="sm" onClick={closeDetail}>Cerrar</Button>
                  </>
                }
                tono="error"
              >
                Error al cargar la ficha: {detailError}
              </Aviso>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

function Ficha({ d, onClose }: { d: AdminAssetDetail; onClose: () => void }) {
  const s = d.series;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManualActionResult | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  /* El detalle se pinta debajo de la paginación, fuera de la vista: al abrirse, el foco va a su título y lo trae. */
  const tituloRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  const run = async (kind: ManualActionKind, write: boolean) => {
    if (
      write &&
      !(await confirm({
        title: "¿Aplicar el cambio en la base de datos?",
        message: "La escritura requiere permiso de administrador y no se puede deshacer desde aquí.",
        confirmLabel: "Aplicar",
        tone: "danger"
      }))
    ) {
      return;
    }
    setBusy(true);
    if (kind === "metric") {
      recomputeMetric(d.meta.asset_id, write)
        .then((data) => setResult({ kind, data }))
        .catch((cause) => setResult({
          kind,
          failure: cause instanceof Error ? cause.message : "No se pudo recalcular la caída."
        }))
        .finally(() => setBusy(false));
      return;
    }
    refreshAssetPrices(d.meta.asset_id, write)
      .then((data) => setResult({ kind, data }))
      .catch((cause) => setResult({
        kind,
        failure: cause instanceof Error ? cause.message : "No se pudieron refrescar los precios."
      }))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Panel
        acciones={<Button size="sm" onClick={onClose}>Cerrar</Button>}
        claseDelCuerpo="inspector-ficha-body"
        subtitulo={`${d.meta.asset_id} · ${TYPE_LABELS[d.meta.type] ?? readableBackendLabel(d.meta.type)} · ${d.meta.symbol ?? FALTA} · ${d.meta.currency ?? FALTA}`}
        titulo={
          <span ref={tituloRef} tabIndex={-1}>
            {d.meta.name || d.meta.asset_id}
          </span>
        }
      >
        <div className="inspector-ficha-grid">
          <span>Histórico: {s.first_date ? diaDe(s.first_date) : FALTA} → {s.last_date ? diaDe(s.last_date) : FALTA} ({recuento(s.points)} puntos)</span>
          <span>Huecos &gt;10d: {s.big_gaps_count}</span>
          <span>Duplicados: {s.duplicates}</span>
          <span>Valores ≤0: {s.non_positive}</span>
          <span>Caída máxima 5 años: {fmtDecimalPct(d.max_drawdown_5y?.value)}</span>
          <span>
            Máx. histórica: {fmtDecimalPct(d.max_drawdown_hist?.value)}
            {d.max_drawdown_hist?.date ? ` (${diaDe(d.max_drawdown_hist.date)})` : ""}
          </span>
        </div>
        {s.big_gaps.length > 0 && (
          <details className="inspector-gaps">
            <summary>Ver huecos ({s.big_gaps_count})</summary>
            <ul>
              {s.big_gaps.map((g, i) => (
                <li key={i}>{diaDe(g.from)} → {diaDe(g.to)} ({g.days} {g.days === 1 ? "día" : "días"})</li>
              ))}
            </ul>
          </details>
        )}

        <div className="inspector-manual">
          <p className="admin-panel__note">
            Rellenos manuales — previsualiza primero; «Aplicar» escribe en la BBDD (requiere permiso de escritura).
          </p>
          <Aviso>El servidor no aplicará ningún relleno si las escrituras maestras están bloqueadas.</Aviso>
          <div className="inspector-actions">
            <Button disabled={busy} onClick={() => void run("metric", false)}>
              Previsualizar recálculo de caída
            </Button>
            <Button disabled={busy} onClick={() => void run("prices", false)}>
              Previsualizar refresco de precios
            </Button>
          </div>
          {busy && <p className="ui-async-state">Ejecutando…</p>}
          {result && !busy && (
            <div className="inspector-result">
              {"failure" in result ? (
                <Aviso tono="error">{result.failure}</Aviso>
              ) : (
                <>
                  {result.kind === "prices" && describeHistoryRebuild(result.data) && (
                    <Aviso>{describeHistoryRebuild(result.data)}</Aviso>
                  )}
                  <pre className="code-block inspector-result-json">{JSON.stringify(result.data, null, 2)}</pre>
                </>
              )}
              {canApplyManualAction(result) && (
                <Button variant="primary" onClick={() => void run(result.kind, true)}>
                  Aplicar {result.kind === "metric" ? "recálculo de caída" : "refresco de precios"} (escribe)
                </Button>
              )}
            </div>
          )}
        </div>
      </Panel>
      {confirmDialog}
    </>
  );
}
