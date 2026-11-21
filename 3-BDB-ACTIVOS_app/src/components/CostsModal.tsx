import "../styles/analisis.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { seriesParadas } from "../adapters/finDeLaSerie";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import * as formato from "../core/formato";
import {
  assetCommercialRetroKey,
  getCommercialRetroForAssets,
  saveCommercialRetro
} from "../adapters/commercialRetroStore";
import { isValidCommercialRetroPct, resolveEffectiveCommercialRetro } from "../core/commercialRetroEffective";
import { calculatePortfolioCosts, detalleDeLaOperacion, esSoloDeAcciones, fraseDelCoste, NOTA_DE_LAS_ACCIONES, SIN_MEDIA_QUE_DAR } from "../core/portfolioCosts";
import { clienteDeLaCartera } from "../core/identidadDelInforme";
import type { ReportBanker } from "../core/reportBanker";
import { improvementFingerprint } from "../core/improvementResultStore";
import { summarizeCoveredRate } from "../core/coveredFinancialMetrics";
import type { CommercialRetroRecord } from "../types/commercialRetro";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { Cifra } from "./ui/Cifra";
import { Distintivo } from "./ui/Distintivo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { Respuesta } from "./ui/Respuesta";
import { useClientMode } from "../app/ClientModeContext";
import { useCommercialRetroAccess } from "../auth/useCommercialRetroAccess";
import { PortfolioManagementFee, type ManagementFeeDraft } from "./PortfolioManagementFee";
import { EfectoDeLosCostes } from "./EfectoDeLosCostes";
import { RENTABILIDAD_SUPUESTA_POR_DEFECTO } from "../core/efectoDeLosCostes";
import { SegmentedTabs } from "./ui/SegmentedTabs";
import { seEnsenaLaMetrica } from "../core/metricasPorInstrumento";
import { seEnsena } from "../core/modoCliente";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { Ausencia } from "./ui/Ausencia";
import { AvisoDelInforme } from "./AvisoDelInforme";
import { AppError } from "../core/appError";
import { registerSessionCache } from "../core/sessionCaches";

const FALTA = textoDeAusencia("falta");

/**
 * Lo que el asesor escribe en este cuadro y que conviene no volver a escribir: la comisión de gestión de la cartera y la
 * rentabilidad supuesta del efecto de los costes. Hasta el rediseño se perdían al cerrarlo. Se recuerdan en memoria durante la
 * sesión —no en la base ni en el navegador— y se olvidan al cambiar de cuenta.
 */
const MANAGEMENT_INICIAL: ManagementFeeDraft = { enabled: false, unit: "percent", input: "" };
const RENTABILIDAD_INICIAL = String(RENTABILIDAD_SUPUESTA_POR_DEFECTO * 100);
let recordado: { management: ManagementFeeDraft; rentabilidad: string } = { management: MANAGEMENT_INICIAL, rentabilidad: RENTABILIDAD_INICIAL };
registerSessionCache(() => {
  recordado = { management: MANAGEMENT_INICIAL, rentabilidad: RENTABILIDAD_INICIAL };
});

const COST_TABS = [{ id: "costs", label: "Costes" }, { id: "retro", label: "Retrocesiones" }] as const;

interface CostsModalProps {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  /** El capital declarado. Sin él todo va en porcentajes: el de ejemplo de Diseño de cartera no entra aquí (decisión 5). */
  totalCapital?: number;
  /** Quién elabora el informe, si la pantalla que lo abre lo sabe. Sin él, el papel no pinta a nadie. */
  responsable?: ReportBanker;
  onClose: () => void;
}

function parseRetroInput(input: string | undefined): number | null {
  if (input == null || input.trim() === "") return null;
  // HTML number inputs and String(storedNumber) use a decimal dot, never a thousands separator.
  const value = Number(input);
  return isValidCommercialRetroPct(value) ? value : null;
}

function todayIso(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function sameRetroInput(input: string | undefined, record?: CommercialRetroRecord): boolean {
  if (!record || input == null || input === "") return false;
  const parsed = parseRetroInput(input);
  return parsed != null && Math.abs(parsed - record.retro_pct) <= 0.000001;
}



export function CostsModal({ positions, assets, totalCapital, responsable, onClose }: CostsModalProps) {
  const { enabled: clientMode } = useClientMode();
  const [activeTab, setActiveTab] = useState<"costs" | "retro">("costs");
  const visibleTab = clientMode ? "costs" : activeTab;
  const panelsRef = useRef<HTMLDivElement>(null);
  const [management, setManagement] = useState<ManagementFeeDraft>(() => recordado.management);
  /* La rentabilidad supuesta del efecto de los costes, en puntos: un supuesto del asesor, nunca la rentabilidad pasada de la cartera. */
  const [rentabilidadSupuesta, setRentabilidadSupuesta] = useState(() => recordado.rentabilidad);
  useEffect(() => {
    recordado = { management, rentabilidad: rentabilidadSupuesta };
  }, [management, rentabilidadSupuesta]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<AppError | null>(null);
  const [margin, setMargin] = useState<number>(1.0);
  const [retros, setRetros] = useState<Record<string, string>>({});
  const [storedRetros, setStoredRetros] = useState<Map<string, CommercialRetroRecord>>(new Map());
  const [retroLoading, setRetroLoading] = useState(false);
  const [retroSavingId, setRetroSavingId] = useState<string | null>(null);
  const [retroError, setRetroError] = useState<string | null>(null);

  const costs = useMemo(() => calculatePortfolioCosts(positions, assets, totalCapital ?? 0), [positions, assets, totalCapital]);
  const sinCapital = !(typeof totalCapital === "number" && Number.isFinite(totalCapital) && totalCapital > 0);
  const { rows, totalCostEur, totalWeight, avgCostPct, missing, coveragePct } = costs;
  /* Solo con acciones, la media y el total valen cero porque no hay nada que medir. «0,00 %» y «0,00 €» se leerían como
     que la cartera sale gratis, y no incluyen ni custodia ni corretaje. El cálculo no cambia: es lo que se escribe. */
  const soloAcciones = esSoloDeAcciones(costs);
  const aplicaElCoste = (assetId: string) => seEnsenaLaMetrica("costeCorriente", assets.find((asset) => asset.asset_id === assetId)?.instrument_type);

  async function exportCosts() {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const paradas = await seriesParadas(rows.map((row) => row.assetId), new Date().toISOString());
      const { downloadCostsPdf } = await import("../reports/costsPdf");
      await downloadCostsPdf({ costs, management, seriesParadas: paradas, clientName: clienteDeLaCartera(improvementFingerprint(positions)), ...(responsable ? { banker: responsable } : {}) });
    } catch (error) {
      /* ANA-28: como en los demás diálogos de informe, un texto propio y el error detrás, sin el mensaje técnico a la vista. */
      setPdfError(new AppError("BACKEND", "No se pudo generar el informe de costes. Reinténtalo en unos segundos.", { cause: error }));
    } finally { setPdfBusy(false); }
  }

  useEffect(() => {
    const body = panelsRef.current?.parentElement;
    if (body) body.scrollTop = 0;
  }, [visibleTab]);

  // Auditoría 27-07 (T3): las retrocesiones dependen de QUÉ activos hay en la
  // cartera, no del capital. `rows` cambia de identidad con cada tecla en el
  // capital (deriva de totalCapital) y relanzaba la carga entera. Huella por
  // CONTENIDO (ids), no por identidad del array de posiciones: teclear capital
  // —incluso con posiciones keepEuros que reajustan pesos— ya no refetchea.
  const rowAssetIdsKey = positions
    .filter((p) => Number.isFinite(p.weight_percent) && p.weight_percent > 0)
    .map((p) => p.asset_id)
    .join(",");
  const rowAssets = useMemo(
    () =>
      rowAssetIdsKey
        .split(",")
        .filter(Boolean)
        .map((assetId) => assets.find((a) => a.asset_id === assetId))
        .filter((asset): asset is BdbAssetDetail => Boolean(asset)),
    [rowAssetIdsKey, assets]
  );

  // B4 / R-07 (29-09): sin claim admin no se consulta `commercial_retro`
  // (las reglas lo rechazarían); la retro queda editable a mano, sin error.
  const retroAccess = useCommercialRetroAccess();

  useEffect(() => {
    let active = true;
    if (clientMode || retroAccess === "denied") {
      setStoredRetros(new Map());
      if (clientMode) setRetros({});
      setRetroError(null);
      setRetroLoading(false);
      return () => { active = false; };
    }
    setRetroLoading(true);
    if (retroAccess === "pending") {
      return () => { active = false; };
    }
    getCommercialRetroForAssets(rowAssets)
      .then((loaded) => {
        if (!active) return;
        setStoredRetros(loaded);
        setRetros((current) => {
          const next = { ...current };
          loaded.forEach((record, assetId) => {
            if (next[assetId] == null || next[assetId] === "") {
              next[assetId] = record.status === "PENDING_CONFIRMATION" ? "" : String(record.retro_pct);
            }
          });
          return next;
        });
      })
      .catch((e) => {
        if (active) setRetroError(e instanceof Error ? e.message : "No se pudieron cargar las retrocesiones.");
      })
      .finally(() => {
        if (active) setRetroLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientMode, retroAccess, rowAssets]);

  const retroRows = rows.map((r) => {
    const raw = retros[r.assetId];
    const retroPct = parseRetroInput(raw);
    const income = retroPct != null && r.capital != null ? r.capital * (retroPct / 100) * margin : null;
    const storedRetro = resolveEffectiveCommercialRetro(r.assetId, storedRetros);
    const stored = storedRetro?.record;
    const sourceLabel = storedRetro && sameRetroInput(raw, stored) ? storedRetro.sourceLabel : retroPct != null ? "manual" : FALTA;
    return { assetId: r.assetId, asset: r.asset, name: r.name, weight: r.weight, capital: r.capital, retroPct, income, sourceLabel, stored };
  });
  const retroSummary = summarizeCoveredRate(retroRows.map((row) => ({
    /* La media se pondera igual por capital que por peso. El ingreso, en cambio, solo existe si alguien ha declarado el capital. */
    amount: row.capital ?? row.weight, rate: row.retroPct != null ? row.retroPct / 100 : null
  })));
  const totalIncome = !sinCapital && retroSummary.coveredAmount > 0 ? retroSummary.weightedTotal * margin : null;

  async function saveRetro(row: (typeof retroRows)[number]) {
    const isin = assetCommercialRetroKey(row.asset);
    if (!isin) {
      setRetroError("Solo se puede guardar retrocesión comercial cuando el activo tiene ISIN.");
      return;
    }
    const raw = retros[row.assetId];
    const parsed = parseRetroInput(raw);
    if (parsed == null) {
      setRetroError("La retrocesión debe estar entre 0 y 100.");
      return;
    }
    setRetroSavingId(row.assetId);
    setRetroError(null);
    try {
      const saved = await saveCommercialRetro({
        isin,
        retro_pct: parsed,
        as_of_date: row.stored?.as_of_date ?? todayIso(),
        source: "COSTS_MODAL",
        note: row.stored?.note
      });
      setStoredRetros((current) => new Map(current).set(row.assetId, saved));
      setRetros((current) => ({ ...current, [row.assetId]: String(saved.retro_pct) }));
    } catch (e) {
      setRetroError(e instanceof Error ? e.message : "No se pudo guardar la retrocesión.");
    } finally {
      setRetroSavingId(null);
    }
  }

  return (
    /* ANA-28: mientras se genera el PDF no se cierra, para que un fallo no quede guardado detrás del diálogo cerrado. */
    <ModalDialog labelledBy="costs-modal-title" onClose={() => { if (!pdfBusy) onClose(); }} size="lg" className="costs-dialog">
        <DialogHeader titleId="costs-modal-title" eyebrow="Propuesta" title="Costes de la propuesta" onClose={pdfBusy ? undefined : onClose} />
        <div className="costs-dialog-nav">
          {!clientMode ? <SegmentedTabs tabs={COST_TABS} value={visibleTab} onChange={setActiveTab}
            label="Secciones de los costes" idPrefix="costs" /> : <span className="section-label">Costes de la cartera</span>}
          {sinCapital
            ? <p className="costs-capital"><span>Capital sin fijar: todo va en porcentajes</span></p>
            : <p className="costs-capital"><span>Capital analizado</span><strong>{formato.importe(totalCapital)}</strong></p>}
        </div>
        <DialogBody>
          {pdfError ? <AvisoDelInforme error={pdfError} onRetry={() => void exportCosts()} /> : null}
          <div ref={panelsRef} className="costs-panels">
          <section className="costs-tab-panel" id="costs-panel-costs" role={clientMode ? undefined : "tabpanel"}
            aria-labelledby={clientMode ? undefined : "costs-tab-costs"} hidden={visibleTab !== "costs"} tabIndex={0}>
          <Respuesta
            datos={[
              ...(sinCapital
                ? [{ rotulo: "Coste corriente anual", cifra: <span className="cifra">{fraseDelCoste(costs)}</span> }]
                : [
                    {
                      rotulo: missing > 0 ? "Coste corriente anual identificado" : "Coste corriente anual",
                      cifra: soloAcciones ? <Cifra ausencia="no-aplica" tipo="importe" valor={null} /> : <Cifra tipo="importe" valor={totalCostEur} />
                    },
                    {
                      rotulo: "Coste corriente medio",
                      cifra: soloAcciones ? <Cifra ausencia="no-aplica" tipo="porcentaje" valor={null} /> : <Cifra tipo="porcentaje" valor={avgCostPct} />
                    }
                  ]),
              ...(!clientMode
                ? [{ rotulo: "Costes conocidos", cifra: soloAcciones ? <Cifra ausencia="no-aplica" tipo="porcentaje" valor={null} /> : <Cifra decimales={0} tipo="porcentaje" valor={coveragePct} /> }]
                : [])
            ]}
            etiqueta="Coste corriente de la propuesta"
          />

          {costs.normalized ? (
            <Aviso titulo="Pesos normalizados.">
              Para este análisis: {formato.porcentaje(costs.inputWeight / 100)} → 100 %.{" "}
              {sinCapital ? "Los pesos guardados no se modifican." : "El capital declarado y los pesos guardados no se modifican."}
            </Aviso>
          ) : null}

          {missing > 0 ? (
            <Aviso titulo={`${missing} ${missing === 1 ? "posición" : "posiciones"} sin coste corriente válido.`}>
              {sinCapital ? "El" : "El importe identificado solo incluye los costes conocidos; el"} coste medio de toda la cartera queda sin
              dato hasta completar los datos.
            </Aviso>
          ) : null}

          {costs.acciones > 0 ? (
            <Aviso tono="nota">
              {soloAcciones ? SIN_MEDIA_QUE_DAR : "Una acción no tiene coste corriente: en su fila no aplica, y en la media cuenta como cero."} {NOTA_DE_LAS_ACCIONES}
            </Aviso>
          ) : null}

          <div className="costs-section-heading"><div><h3>Costes por activo</h3>
            <p>{rows.length === 1 ? "1 posición" : `${rows.length} posiciones`} · coste corriente anual{sinCapital ? ", en porcentaje" : " sobre el capital asignado"}</p></div></div>
          <div className="table-wrap costs-table-wrap" role="region" aria-label="Costes por activo" tabIndex={0}><table className={sinCapital ? "dialog-table costs-table costs-table--sin-importes" : "dialog-table costs-table"} aria-label="Costes por posición">
            <colgroup><col className="costs-col-name" /><col className="costs-col-weight" />{sinCapital ? null : <col className="costs-col-capital" />}
              <col className="costs-col-rate" /><col className="costs-col-management" />{sinCapital ? null : <col className="costs-col-annual" />}</colgroup>
            <thead>
              <tr>
                <th scope="col">Activo</th>
                <th className="num" scope="col">Peso</th>
                {sinCapital ? null : <th className="num" scope="col">Capital</th>}
                <th className="num" scope="col">Coste corriente</th>
                <th className="num" scope="col">Gestión del activo</th>
                {sinCapital ? null : <th className="num" scope="col">Coste anual</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={sinCapital ? 4 : 6}>No hay posiciones en cartera</td></tr>
              ) : rows.map((r) => (
                <tr key={r.assetId}>
                  <td><div className="cell-entity">
                    <div className="cell-entity__name costs-asset-name" title={r.name}>{r.name}</div>
                    <div className="cell-entity__code">{r.assetId}</div>
                  </div></td>
                  <td className="num"><Cifra tipo="peso" valor={r.weight / 100} /></td>
                  {sinCapital ? null : <td className="num u-muted"><Cifra tipo="importe" valor={r.capital} /></td>}
                  {/* A una acción no le aplican: no es que falte el dato. En la media cuenta como cero (decisión 10). */}
                  <td className="num">{!aplicaElCoste(r.assetId) ? <Ausencia clase="no-aplica" /> : <Cifra tipo="porcentaje" valor={r.ongoingPct} />}</td>
                  <td className="num u-muted">{!aplicaElCoste(r.assetId) ? <Ausencia clase="no-aplica" /> : <Cifra tipo="porcentaje" valor={r.mgmtPct} />}</td>
                  {sinCapital ? null : <td className="num is-strong">{!aplicaElCoste(r.assetId) ? <Ausencia clase="no-aplica" /> : <Cifra tipo="importe" valor={r.costEur} />}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {/* INF-3: con algún coste sin dato, el total en euros es solo lo identificado. Se dice en el rótulo de la fila
                    y no en la casilla del importe: la tabla es de ancho fijo y allí no cabía (10 px de desborde a 1440). */}
                <td className="is-total">{missing > 0 && !sinCapital && !soloAcciones ? "Total · coste anual identificado" : "Total"}</td>
                <td className="num is-total"><Cifra tipo="peso" valor={totalWeight / 100} /></td>
                {sinCapital ? null : <td className="num is-total"><Cifra tipo="importe" valor={costs.totalCapital} /></td>}
                <td className="num is-total">{soloAcciones ? <Ausencia clase="no-aplica" /> : <Cifra tipo="porcentaje" valor={avgCostPct} />}</td>
                <td className="num" />
                {sinCapital ? null : <td className="num is-total">{soloAcciones ? <Ausencia clase="no-aplica" /> : <Cifra tipo="importe" valor={totalCostEur} />}</td>}
              </tr>
            </tfoot>
          </table></div>

          {/* Sin columnas nuevas: a 768 el cuadro ya corta dos. Las de cada fila, con su fuente, van en el informe. */}
          {soloAcciones || rows.length === 0 ? null : (
            <Aviso tono="nota">
              Costes de operación de los fondos: {formato.oFalta(formato.porcentaje(costs.operacion.tasa ?? (costs.operacion.medido > 0 ? costs.operacion.medido : null)))}. No entran en el coste corriente. {detalleDeLaOperacion(costs.operacion, { conFuente: seEnsena("fuenteDeDatos", clientMode) })}
            </Aviso>
          )}

          <details className="costs-method"><summary>Cómo se calcula el coste</summary><p>
            Coste corriente medio = suma de (peso relativo × coste corriente).{sinCapital ? " " : " Coste anual = capital × coste corriente medio. "}
            La comisión de gestión de cada activo se muestra como información y no se suma al coste corriente.
            {seEnsena("fuenteDeDatos", clientMode) ? " Cada cifra sale del KID del producto, con su fecha; donde no lo hay, o no da esa cifra, del proveedor de datos. El informe lo dice fila a fila." : null}
          </p></details>
          <PortfolioManagementFee costs={costs} value={management} onChange={setManagement} />
          {/* Después de la gestión: el coste que se proyecta la lleva si el asesor la ha indicado. Solo en pantalla. */}
          {rows.length === 0 ? null : <EfectoDeLosCostes costs={costs} management={management} rentabilidad={rentabilidadSupuesta}
            onRentabilidad={setRentabilidadSupuesta} clientMode={clientMode} />}
          </section>

          {!clientMode ? <section className="costs-tab-panel costs-retro-section" id="costs-panel-retro" role="tabpanel"
            aria-labelledby="costs-tab-retro" hidden={visibleTab !== "retro"} tabIndex={0}>
            {/* Del asesor: en Modo cliente la pestaña no existe. */}
            <p className="row"><Distintivo tono="interno">Interno</Distintivo></p>
            <Respuesta
                datos={[
                ...(sinCapital ? [] : [{ rotulo: "Ingreso anual estimado", cifra: <Cifra tipo="importe" valor={totalIncome} /> }]),
                { rotulo: "Retrocesión media conocida", cifra: <Cifra tipo="porcentaje" valor={retroSummary.weightedAverage} /> },
                { rotulo: "Retrocesiones conocidas", cifra: retroLoading ? <span className="cifra">Cargando…</span> : <Cifra decimales={0} tipo="porcentaje" valor={retroSummary.coverageRatio} /> }
              ]}
              etiqueta="Retrocesiones de la propuesta"
            />
            {retroLoading ? (
              <p className="ui-async-state" role="status">Cargando retrocesiones comerciales…</p>
            ) : null}
            {retroError ? <Aviso tono="error">{retroError}</Aviso> : null}

            <div className="costs-retro-toolbar">
              <div className="costs-section-heading"><div><h3>Retrocesiones por activo</h3>
                <p>Edita el porcentaje y guarda cada cambio en la base comercial.{sinCapital ? " Sin capital fijado no se estima ningún ingreso." : ""}</p></div></div>
              {/* El coeficiente solo mueve el ingreso: sin capital no habría nada que moviera. */}
              {sinCapital ? null : (
                <Campo className="costs-margin-field" pista="Veces la retrocesión" rotulo="Coeficiente de margen">
                  <input
                    type="number"
                    lang="es"
                    step="0.05"
                    min="0"
                    value={margin}
                    onChange={(e) => { const value = e.target.valueAsNumber; setMargin(Number.isFinite(value) && value >= 0 ? value : 0); }}
                    className="costs-margin-input"
                  />
                </Campo>
              )}
            </div>

            <div className="table-wrap costs-table-wrap" role="region" aria-label="Retrocesiones por activo" tabIndex={0}><table className={sinCapital ? "dialog-table costs-table costs-retro-table costs-table--sin-importes" : "dialog-table costs-table costs-retro-table"} aria-label="Retrocesiones por posición">
              <colgroup><col className="costs-col-name" /><col className="costs-col-retro-capital" /><col className="costs-col-retro-rate" />
                <col className="costs-col-source" />{sinCapital ? null : <col className="costs-col-annual" />}<col className="costs-col-save" /></colgroup>
              <thead>
                <tr>
                  <th scope="col">Activo</th>
                  <th className="num" scope="col">{sinCapital ? "Peso" : "Capital"}</th>
                  <th className="num" scope="col">Retrocesión %</th>
                  <th className="num" scope="col">Origen</th>
                  {sinCapital ? null : <th className="num" scope="col">Ingreso anual</th>}
                  <th className="num" scope="col">Guardar</th>
                </tr>
              </thead>
              <tbody>
                {retroRows.length === 0 ? (
                  <tr><td colSpan={sinCapital ? 5 : 6}>No hay posiciones en cartera</td></tr>
                ) : retroRows.map((r) => (
                  <tr key={r.assetId}>
                    <td><div className="cell-entity">
                      <div className="cell-entity__name costs-asset-name" title={r.name}>{r.name}</div>
                      <div className="cell-entity__code">{r.assetId}</div>
                    </div></td>
                    <td className="num u-muted">{sinCapital ? <Cifra tipo="peso" valor={r.weight / 100} /> : <Cifra tipo="importe" valor={r.capital} />}</td>
                    <td className="num">
                      <input
                        type="number"
                        lang="es"
                        step="0.0001"
                        min="0"
                        max="100"
                        value={retros[r.assetId] ?? ""}
                        onChange={(e) => setRetros((prev) => ({ ...prev, [r.assetId]: e.target.value }))}
                        placeholder="0,00"
                        aria-label={`Retrocesión de ${r.name}`}
                        className="costs-retro-input"
                      />
                    </td>
                    <td className="num"><span className="costs-source">{r.sourceLabel}</span></td>
                    {sinCapital ? null : <td className="num"><Cifra tipo="importe" valor={r.retroPct != null ? r.income : null} /></td>}
                    <td className="num">
                      <Button
                        size="sm"
                        onClick={() => saveRetro(r)}
                        disabled={retroSavingId != null || !assetCommercialRetroKey(r.asset)}
                      >
                        {retroSavingId === r.assetId ? "…" : "Guardar"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="is-total">Total</td>
                  <td className="num is-total">{sinCapital ? <Cifra tipo="peso" valor={totalWeight / 100} /> : <Cifra tipo="importe" valor={costs.totalCapital} />}</td>
                  <td className="num" />
                  <td className="num" />
                  {sinCapital ? null : <td className="num"><Cifra tipo="importe" valor={totalIncome} /></td>}
                  <td className="num" />
                </tr>
              </tfoot>
            </table></div>
          </section> : null}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="primary" busy={pdfBusy} disabled={pdfBusy || rows.length === 0} onClick={() => void exportCosts()}>
            {pdfBusy ? "Preparando…" : "Descargar el informe"}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={pdfBusy}>Cerrar</Button>
        </DialogFooter>
    </ModalDialog>
  );
}
