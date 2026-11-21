import { useEffect, useMemo, useState } from "react";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import {
  fetchPortfolioImprovement,
  type ImprovementProposal,
  type ImprovementResponse,
  type ImprovementWindow
} from "../adapters/improvePortfolioBackend";
import {
  excluidosSinRepetir,
  IMPROVEMENT_STATUS_LABELS,
  notasDelPeriodo,
  proposalPositions,
  rejectionLabel,
  resumenDeLaMejoraEnPantalla,
  type ImprovementCandidateSet
} from "../core/portfolioImprovement";
import { esAccion } from "../core/esAccion";
import { VERDICT_LABELS } from "../core/fundEquivalence";
import { NOTA_DE_LAS_ACCIONES } from "../core/portfolioCosts";
import {
  clearImprovementResult,
  improvementFingerprint,
  saveImprovementResult,
  type StoredImprovement
} from "../core/improvementResultStore";
import { useModoCliente } from "../app/ClientModeContext";
import { buildPortfolioOptimizationDiff } from "../core/portfolioOptimizationDiff";
import { ranuraDeCartera } from "../core/disenoEnSesion";
import { fecha, oFalta, peso, porcentaje } from "../core/formato";
import { cifrasEnPantalla, textoEnPantalla } from "../core/glosarioDePantalla";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../core/textosDeCartera";
import { CampoDeCifraAcotada } from "./CampoDeCifraAcotada";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { CambiosDePeso, CifrasDeLosCambios } from "./CambiosDePeso";
import { Ausencia } from "./ui/Ausencia";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Cifra } from "./ui/Cifra";
import { Distintivo } from "./ui/Distintivo";
import { claseDeLaDiferencia, NOTA_DEL_COLOR_DE_LA_DIFERENCIA, type SentidoDeLaCifra } from "../core/sentidoDeLaDiferencia";
import { SegmentedControl, type SegmentedControlOption } from "./ui/SegmentedControl";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { Panel } from "./ui/Panel";

export interface ImprovementCandidateOptions {
  requireSameDistribution: boolean;
}

interface PortfolioImprovementPanelProps {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
  /** Candados de la cartera (decimales): las posiciones fijadas no se sustituyen. */
  lockedWeights?: Record<string, number>;
  portfolioName?: string;
  onBuildCandidates: (
    positions: BdbManualPortfolioPosition[],
    assets: BdbAssetDetail[],
    options: ImprovementCandidateOptions
  ) => Promise<ImprovementCandidateSet>;
  onApplyProposal: (positions: BdbManualPortfolioPosition[]) => void;
  onSaveProposal?: (name: string, positions: BdbManualPortfolioPosition[], assets: BdbAssetDetail[]) => void;
  /** El capital de la cartera, solo si está fijado: con él, la revisión dice cuánto dinero hay que mover. */
  capital?: number;
}

const WINDOW_OPTIONS: readonly SegmentedControlOption<ImprovementWindow>[] = [
  { id: "3Y", label: "3 años" },
  { id: "5Y", label: "5 años" }
];

type Phase =
  | { status: "idle" }
  | { status: "loading"; step: string }
  | {
      status: "result";
      response: ImprovementResponse;
      candidates: ImprovementCandidateSet;
      /** Composición con la que se calculó: el resultado solo vale para ella. */
      positions: BdbManualPortfolioPosition[];
    }
  | { status: "error"; error: unknown };

/* Hallazgo 53: la búsqueda y su resultado sobreviven a cambiar de paso o de pantalla. Si la cartera ha
   cambiado, el resultado se enseña como de otra composición y no se puede aplicar (`isStale`). */
const mejoraEnSesion = ranuraDeCartera<{
  windowSel: ImprovementWindow;
  maxSubstitutions: number;
  sameDistribution: boolean;
  volatilityTolerance: number;
  drawdownTolerance: number;
  minReturnImprovement: number;
  phase: Phase;
  selectedProposal: number;
}>(() => ({
  windowSel: "3Y",
  maxSubstitutions: 3,
  sameDistribution: true,
  volatilityTolerance: 0.3,
  drawdownTolerance: 1,
  minReturnImprovement: 0.5,
  phase: { status: "idle" },
  selectedProposal: 0
}));

const CHECK_WORD = { PASS: "Cumple", FAIL: "No cumple", NOT_EVALUABLE: "No evaluable" } as const;
/* Desde el 14-11-2026 (Óscar: recuperar el color de antes del rediseño), lo que cumple va en verde y lo que no, en rojo, cada uno con su
   palabra en un distintivo; lo que no se puede evaluar no tiene sentido que decir y va neutro. */
const CHECK_TONO = { PASS: "favorable", FAIL: "desfavorable", NOT_EVALUABLE: "neutro" } as const;

/**
 * Una diferencia. La de dos porcentajes va en puntos, «+0,43 pp», como la validación de esta pantalla y el papel de la Propuesta de mejora
 * (`improvementProposalPdf.tsx`, revisión final, V3-8): «+0,43 %» se lee como variación relativa. La del Sharpe es un ratio, con su signo.
 *
 * Desde el 14-11-2026 vuelve el color de antes: verde si la propuesta mejora y rojo si empeora, según el sentido de la cifra (más rentabilidad
 * y más Sharpe, mejor; menos volatilidad, una caída menos profunda y menos coste, mejor). El signo escrito no cambia: un coste que baja se
 * escribe con «−» y va en verde. Una diferencia nula o que no se puede calcular, sin color.
 */
function Diferencia({ antes, despues, tipo, sentido }: {
  antes: number | null | undefined; despues: number | null | undefined; tipo: "rentabilidad" | "porcentaje" | "ratio"; sentido: SentidoDeLaCifra;
}) {
  const valor = typeof antes === "number" && typeof despues === "number" ? despues - antes : null;
  const clase = claseDeLaDiferencia(antes, despues, sentido, tipo === "ratio" ? 2 : 4);
  if (tipo === "ratio") return <Cifra className={clase} tipo="ratio" valor={valor} conSigno />;
  return <Cifra className={clase} colorDeSigno={false} tipo="puntos" valor={valor} />;
}

function MetricRow({ label, before, after, tipo, sentido }: {
  label: string; before: number | null | undefined; after: number | null | undefined; tipo: "rentabilidad" | "porcentaje" | "ratio"; sentido: SentidoDeLaCifra;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="num"><Cifra tipo={tipo} valor={before} /></td>
      <td className="num"><Cifra tipo={tipo} valor={after} /></td>
      <td className="num"><Diferencia antes={before} despues={after} tipo={tipo} sentido={sentido} /></td>
    </tr>
  );
}

export function PortfolioImprovementPanel({
  assets,
  positions,
  lockedWeights,
  portfolioName = "",
  onBuildCandidates,
  onApplyProposal,
  onSaveProposal,
  capital
}: PortfolioImprovementPanelProps) {
  const { seEnsena } = useModoCliente();
  const [enSesion] = useState(() => mejoraEnSesion.read());
  const [windowSel, setWindowSel] = useState<ImprovementWindow>(enSesion.windowSel);
  const [maxSubstitutions, setMaxSubstitutions] = useState(enSesion.maxSubstitutions);
  const [maxSustitucionesNoValido, setMaxSustitucionesNoValido] = useState(false);
  const [sameDistribution, setSameDistribution] = useState(enSesion.sameDistribution);
  const [volatilityTolerance, setVolatilityTolerance] = useState(enSesion.volatilityTolerance);
  const [drawdownTolerance, setDrawdownTolerance] = useState(enSesion.drawdownTolerance);
  const [minReturnImprovement, setMinReturnImprovement] = useState(enSesion.minReturnImprovement);
  const [phase, setPhase] = useState<Phase>(enSesion.phase);
  const [selectedProposal, setSelectedProposal] = useState(enSesion.selectedProposal);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);

  useEffect(() => {
    mejoraEnSesion.write({
      windowSel,
      maxSubstitutions,
      sameDistribution,
      volatilityTolerance,
      drawdownTolerance,
      minReturnImprovement,
      // Un cálculo a medias o un error no se recuerdan: al volver no hay nada que esperar.
      phase: phase.status === "result" ? phase : { status: "idle" },
      selectedProposal
    });
  }, [windowSel, maxSubstitutions, sameDistribution, volatilityTolerance, drawdownTolerance, minReturnImprovement, phase, selectedProposal]);

  const investable = positions.filter((position) => (position.weight_percent ?? 0) > 0);
  const canRun = investable.length >= 1 && phase.status !== "loading" && !maxSustitucionesNoValido;

  async function run() {
    setNotice(null);
    setSelectedProposal(0);
    setPhase({ status: "loading", step: "Buscando fondos equivalentes en el catálogo…" });
    try {
      const candidates = await onBuildCandidates(investable, assets, { requireSameDistribution: sameDistribution });
      setPhase({ status: "loading", step: "Evaluando las combinaciones en la ventana común…" });
      const total = investable.reduce((sum, position) => sum + position.weight_percent, 0);
      const locked = Object.keys(lockedWeights ?? {}).filter((id) => investable.some((position) => position.asset_id === id));
      const response = await fetchPortfolioImprovement({
        positions: investable.map((position) => ({ asset_id: position.asset_id, weight: position.weight_percent / total })),
        candidates: candidates.candidates,
        same_fund_class: candidates.sameFundClass,
        window: windowSel,
        locked,
        max_substitutions: maxSubstitutions,
        thresholds: {
          max_volatility_increase: volatilityTolerance / 100,
          max_drawdown_worsening: drawdownTolerance / 100,
          min_return_improvement: minReturnImprovement / 100
        }
      });
      setPhase({ status: "result", response, candidates, positions: investable });
    } catch (error) {
      setPhase({ status: "error", error });
    }
  }

  const result = phase.status === "result" ? phase : null;
  const proposal: ImprovementProposal | null = result?.response.proposals[selectedProposal] ?? null;
  const allAssets = useMemo(() => {
    if (!result) return assets;
    const merged = new Map(assets.map((asset) => [asset.asset_id, asset]));
    for (const [id, asset] of result.candidates.assetsById) if (!merged.has(id)) merged.set(id, asset);
    return [...merged.values()];
  }, [assets, result]);
  const proposed = useMemo(() => (proposal ? proposalPositions(positions, proposal) : null), [positions, proposal]);
  /* Revisión del 14-10-2026: si la cartera del Constructor ya no es la evaluada
     (otro peso, otra posición), la propuesta es de otra cartera: no se aplica ni
     se guarda hasta recalcular. El PDF sí, porque describe lo que se evaluó. */
  const evaluatedFingerprint = useMemo(
    () => (result ? improvementFingerprint(result.positions) : null),
    [result]
  );
  const isStale = evaluatedFingerprint !== null && evaluatedFingerprint !== improvementFingerprint(investable);
  const diff = useMemo(() => proposal && proposed && result
    ? buildPortfolioOptimizationDiff({
      source: "Fondos equivalentes",
      before: positions,
      after: proposed,
      assets: allAssets,
      beforeMetrics: {
        expected_return: result.response.original?.metrics.confirmation.cagr,
        volatility: result.response.original?.metrics.confirmation.volatility,
        sharpe: result.response.original?.metrics.confirmation.sharpe
      },
      afterMetrics: {
        expected_return: proposal.metrics.confirmation.cagr,
        volatility: proposal.metrics.confirmation.volatility,
        sharpe: proposal.metrics.confirmation.sharpe
      }
    })
    : null, [allAssets, positions, proposal, proposed, result]);

  function applyProposal() {
    if (!proposed || isStale) return;
    onApplyProposal(proposed);
    setReviewing(false);
    /* ALTA-20.3 (auditoría 14-10-2026): aplicada la propuesta, la cartera que se
       evaluó ya no existe. El resultado se retira de la pantalla y de la sesión:
       antes seguía montado y el efecto de guardado lo volvía a escribir bajo la
       huella de la cartera NUEVA, y el informe interno lo tomaba como suyo. */
    setPhase({ status: "idle" });
    setSelectedProposal(0);
    clearImprovementResult();
    setNotice("Sustituciones aplicadas en Diseño de cartera. La cartera guardada original no cambia. Si quieres ajustar también los pesos, usa «Optimizar cartera» con el objetivo «Posición en la frontera» y una rotación máxima.");
  }

  function saveProposal() {
    if (!proposed || !onSaveProposal || isStale) return;
    const base = portfolioName.trim() || "Cartera";
    onSaveProposal(`${base} · propuesta de mejora`, proposed, allAssets);
    setNotice("Propuesta guardada como cartera nueva; la original sigue tal cual.");
  }

  /** Lo que comparten el PDF propio y el informe interno: resultado, fichas, equivalencia y descartes. */
  const storedPayload = useMemo((): Omit<StoredImprovement, "schema_version" | "fingerprint" | "savedAt"> | null => result ? {
    response: result.response,
    proposalIndex: selectedProposal,
    assets: Object.fromEntries(allAssets.map((asset) => [asset.asset_id, { name: asset.display_name, ongoingCharge: asset.costs?.ongoing_charge ?? null }])),
    equivalence: Object.fromEntries([...result.candidates.equivalence].map(([key, value]) => [key, {
      verdict: value.verdict, reason: value.reason, shared: value.shared, differing: value.differing, missing: value.missing
    }])),
    skipped: result.candidates.skipped,
    hayAcciones: result.positions.some((position) => esAccion(allAssets.find((asset) => asset.asset_id === position.asset_id)?.instrument_type))
  } : null, [allAssets, result, selectedProposal]);

  /* Decisión 8.6: el informe interno recoge el último cálculo de esta cartera; se guarda
     en la sesión del navegador ligado a la composición exacta (ids y pesos) CON LA QUE
     SE CALCULÓ, nunca a la que haya en pantalla después: si la cartera cambia, el
     resultado deja de casar y el informe no lo toma. */
  const resultPositions = result?.positions ?? null;
  useEffect(() => {
    if (storedPayload && resultPositions) saveImprovementResult(resultPositions, storedPayload);
  }, [storedPayload, resultPositions]);

  async function exportPdf() {
    if (!result || !storedPayload) return;
    setExporting(true);
    setExportError(null);
    try {
      const { downloadImprovementProposalPdf } = await import("../reports/improvementProposalPdf");
      await downloadImprovementProposalPdf({ portfolioName, ...storedPayload });
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  }

  const response = result?.response;
  const original = response?.original;
  /* Decisión 8.3: las clases del mismo fondo se enseñan siempre, en bloque aparte y antes
     que cualquier otra propuesta, aunque el servidor no las haya incluido. */
  const sameClassRows = useMemo(() => result
    ? Object.entries(result.candidates.sameFundClass).flatMap(([position, ids]) => ids.map((id) => ({ position, id })))
    : [], [result]);
  const windows = response?.windows;
  const nombreDe = (assetId: string) => allAssets.find((asset) => asset.asset_id === assetId)?.display_name ?? assetId;
  /* 15-11-2026: se mide con el periodo de Simular; estas notas dicen cuál, qué se queda fuera y qué se recortó. */
  const notas = response ? notasDelPeriodo(response, nombreDe) : null;
  const otrosExcluidos = response ? excluidosSinRepetir(response) : [];
  const ter =(asset: BdbAssetDetail | undefined) => {
    const value = asset?.costs?.ongoing_charge;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      className="improvement-panel"
      subtitulo="Busca en la base de datos fondos homogéneos a los actuales, mantiene los pesos y propone solo lo que no empeora ningún criterio obligatorio y mejora al menos uno. Solo sustituye fondos por fondos: los ETF y las acciones de la cartera se conservan tal cual. Se elige en los dos primeros tercios de la ventana y se confirma en el último."
      titulo="Fondos equivalentes que mejoran la cartera"
      tituloId="improvement-panel-title"
    >

      <div className="optimizer-controls improvement-controls">
        <SegmentedControl options={WINDOW_OPTIONS} value={windowSel} onChange={setWindowSel} label="Ventana de evaluación" />
        {/* DIS-04: se lee al confirmar; antes, al borrar quedaba un 1 y lo tecleado se le añadía. */}
        <CampoDeCifraAcotada
          alCambiarValidez={(valida) => setMaxSustitucionesNoValido(!valida)}
          alConfirmar={setMaxSubstitutions}
          etiqueta="Máx. sustituciones"
          max={5}
          min={1}
          step={1}
          valor={maxSubstitutions}
        />
        <label className="check">
          <input type="checkbox" checked={sameDistribution} onChange={(event) => setSameDistribution(event.target.checked)} />
          <span>Misma política de distribución</span>
        </label>
        <Button variant="primary" busy={phase.status === "loading"} disabled={!canRun} onClick={() => void run()}>
          {phase.status === "loading" ? "Buscando…" : "Buscar sustituciones"}
        </Button>
      </div>
      <div className="improvement-conditions">
        <h3 className="section-label">Condiciones de mejora</h3>
        <div className="optimizer-controls">
          <label className="optimizer-num">
            <span>Volatilidad: tolerancia (pp)</span>
            <input type="number" lang="es" min={0} max={5} step={0.1} value={volatilityTolerance} onChange={(event) => setVolatilityTolerance(Math.max(0, Number(event.target.value) || 0))} />
          </label>
          <label className="optimizer-num">
            <span>Caída máxima: tolerancia (pp)</span>
            <input type="number" lang="es" min={0} max={10} step={0.5} value={drawdownTolerance} onChange={(event) => setDrawdownTolerance(Math.max(0, Number(event.target.value) || 0))} />
          </label>
          <label className="optimizer-num">
            <span>Mejora mínima de rentabilidad (pp)</span>
            <input type="number" lang="es" min={0} max={10} step={0.1} value={minReturnImprovement} onChange={(event) => setMinReturnImprovement(Math.max(0, Number(event.target.value) || 0))} />
          </label>
        </div>
        <p className="field__hint">
          El coste corriente no puede subir; el Sharpe no puede bajar más de 0,02; la rentabilidad no puede bajar más de 0,25 pp.
          Cada candidato debe correlacionar con el fondo que sustituye y cubrir la ventana completa con su propia serie.
        </p>
      </div>

      {phase.status === "idle" && investable.length === 0 ? (
        <p className="asset-detail-muted">Añade posiciones con peso para buscar una mejora.</p>
      ) : null}
      {phase.status === "loading" ? <p className="ui-async-state" role="status">{phase.step}</p> : null}
      {phase.status === "error" ? <AsyncErrorBanner error={phase.error} onRetry={() => void run()} /> : null}
      {notice ? <Aviso anunciar tono="nota">{notice}</Aviso> : null}
      {isStale ? (
        <Aviso anunciar tono="aviso">
          La cartera ha cambiado desde el cálculo: esta propuesta corresponde a la composición anterior. Vuelve a
          calcular para aplicarla o guardarla.
        </Aviso>
      ) : null}

      {response ? (
        <div className="improvement-result">
          <div>
            <h3 className="section-label">Resultado</h3>
            <p className="improvement-result__estado">{IMPROVEMENT_STATUS_LABELS[response.status]}</p>
            <p>{resumenDeLaMejoraEnPantalla(response, nombreDe)}</p>
            {notas?.periodo ? <p className="field__hint">{notas.periodo}</p> : null}
          </div>

          {notas?.apartadas ? <Aviso tono="nota">{notas.apartadas}</Aviso> : null}
          {notas?.completadas ? <Aviso tono="nota">{notas.completadas}</Aviso> : null}
          {notas?.recorte ? <Aviso tono="nota">{notas.recorte}</Aviso> : null}

          {response.status === "NO_IMPROVEMENT" && response.best_rejected ? (
            <Aviso anunciar tono="aviso">
              La mejor combinación ({response.best_rejected.substitutions.map((s) => `${s.from_name} → ${s.to_name}`).join("; ")}) no cumple:{" "}
              {response.best_rejected.failed.map(textoEnPantalla).join(", ")}.
            </Aviso>
          ) : null}

          {sameClassRows.length > 0 ? (
            <div>
              <h3 className="section-label">Misma estrategia, otra clase</h3>
              <p className="field__hint">Clases del mismo fondo detectadas por el nombre. No cuentan como sustitución, pero para entrar en una propuesta pasan las mismas comprobaciones de series que cualquier otro fondo.</p>
              <div className="table-wrap" role="region" aria-label="Clases del mismo fondo" tabIndex={0}>
                <table className="dialog-table improvement-table" aria-label="Clases del mismo fondo">
                  <thead>
                    <tr><th scope="col">Fondo actual</th><th scope="col">Otra clase</th><th className="num" scope="col">Coste actual</th><th className="num" scope="col">Coste de la clase</th><th scope="col">Diferencias</th></tr>
                  </thead>
                  <tbody>
                    {sameClassRows.map(({ position, id }) => {
                      const from = allAssets.find((asset) => asset.asset_id === position);
                      const to = allAssets.find((asset) => asset.asset_id === id);
                      const equivalence = result?.candidates.equivalence.get(`${position}:${id}`);
                      return (
                        <tr key={`${position}:${id}`}>
                          <td><div className="cell-entity"><div className="cell-entity__name">{from?.display_name ?? position}</div><div className="cell-entity__code">{position}</div></div></td>
                          <td><div className="cell-entity"><div className="cell-entity__name">{to?.display_name ?? id}</div><div className="cell-entity__code">{id}</div></div></td>
                          {/* Un coste va en tinta, sea mayor o menor que el otro: el color dice si se gana o se pierde. */}
                          <td className="num"><Cifra tipo="porcentaje" valor={ter(from)} /></td>
                          <td className="num"><Cifra tipo="porcentaje" valor={ter(to)} /></td>
                          <td>{equivalence?.differing.length ? textoEnPantalla(equivalence.differing.join("; ")) : "Sin diferencias detectadas en las etiquetas"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {response.proposals.length > 1 ? (
            <SegmentedControl
              options={response.proposals.map((_, index) => ({ id: String(index), label: `Propuesta ${index + 1}` }))}
              value={String(selectedProposal)}
              onChange={(value) => setSelectedProposal(Number(value))}
              label="Propuesta a revisar"
            />
          ) : null}

          {proposal && original ? (
            <>
              <div className="table-wrap" role="region" aria-label="Sustituciones propuestas" tabIndex={0}>
                <table className="dialog-table improvement-table" aria-label="Sustituciones propuestas">
                  <thead>
                    <tr>
                      <th scope="col">Fondo actual</th>
                      <th scope="col">Sustituto</th>
                      <th className="num" scope="col">Peso</th>
                      <th scope="col">Equivalencia</th>
                      <th className="num" scope="col">Correlación</th>
                      <th className="num" scope="col">Diferencia de coste corriente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposal.substitutions.map((sub) => {
                      const equivalence = result?.candidates.equivalence.get(`${sub.from_asset_id}:${sub.to_asset_id}`);
                      const before = ter(allAssets.find((asset) => asset.asset_id === sub.from_asset_id));
                      const after = ter(allAssets.find((asset) => asset.asset_id === sub.to_asset_id));
                      return (
                        <tr key={`${sub.from_asset_id}:${sub.to_asset_id}`}>
                          <td><div className="cell-entity"><div className="cell-entity__name">{sub.from_name}</div><div className="cell-entity__code">{sub.from_asset_id}</div></div></td>
                          <td><div className="cell-entity"><div className="cell-entity__name">{sub.to_name}</div><div className="cell-entity__code">{sub.to_asset_id}</div></div></td>
                          <td className="num">{oFalta(peso(sub.weight))}</td>
                          <td>
                            {equivalence ? (
                              <div className="cell-entity">
                                <div className="cell-entity__name">{sub.same_fund_class ? "Misma estrategia, otra clase · no cuenta como sustitución" : VERDICT_LABELS[equivalence.verdict]}</div>
                                <div className="cell-entity__code cell-entity__code--text">{textoEnPantalla(equivalence.reason)}</div>
                              </div>
                            ) : <Ausencia clase="falta" />}
                          </td>
                          <td className="num"><Cifra tipo="ratio" valor={sub.correlation} /></td>
                          <td className="num">
                            <Diferencia antes={before} despues={after} tipo="porcentaje" sentido="menos" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="table-wrap" role="region" aria-label="Comparativa en la ventana de confirmación" tabIndex={0}>
                <table className="dialog-table improvement-metrics" aria-label="Comparativa en la ventana de confirmación">
                  <thead>
                    <tr>
                      <th scope="col">Ventana de confirmación{windows ? ` · ${oFalta(fecha(windows.confirmation.first_date))} a ${oFalta(fecha(windows.confirmation.last_date))}` : ""}</th>
                      <th className="num" scope="col">Cartera actual</th>
                      <th className="num" scope="col">Propuesta</th>
                      <th className="num" scope="col">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    <MetricRow label="Rentabilidad anualizada" before={original.metrics.confirmation.cagr} after={proposal.metrics.confirmation.cagr} tipo="rentabilidad" sentido="mas" />
                    <MetricRow label="Volatilidad anual" before={original.metrics.confirmation.volatility} after={proposal.metrics.confirmation.volatility} tipo="porcentaje" sentido="menos" />
                    <MetricRow label="Sharpe" before={original.metrics.confirmation.sharpe} after={proposal.metrics.confirmation.sharpe} tipo="ratio" sentido="mas" />
                    <MetricRow label="Caída máxima" before={original.metrics.confirmation.max_drawdown} after={proposal.metrics.confirmation.max_drawdown} tipo="porcentaje" sentido="menosProfunda" />
                    <MetricRow label="Coste corriente medio" before={original.weighted_cost} after={proposal.weighted_cost} tipo="porcentaje" sentido="menos" />
                    <MetricRow label="Rentabilidad anualizada (selección)" before={original.metrics.selection.cagr} after={proposal.metrics.selection.cagr} tipo="rentabilidad" sentido="mas" />
                  </tbody>
                </table>
              </div>
              <p className="cmp-note">{NOTA_DEL_COLOR_DE_LA_DIFERENCIA}</p>

              <div>
                <h3 className="section-label">Validación</h3>
                <ul className="improvement-checks">
                  {proposal.validation.map((check) => (
                    <li key={check.key}>
                      <Distintivo tono={CHECK_TONO[check.status]}>{CHECK_WORD[check.status]}</Distintivo>
                      <span>{cifrasEnPantalla(textoEnPantalla(check.label))}{check.detail ? ` · ${cifrasEnPantalla(textoEnPantalla(check.detail))}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="improvement-actions">
                <Button variant="primary" disabled={isStale} onClick={() => setReviewing(true)}>Revisar y aplicar</Button>
                {onSaveProposal ? <Button variant="secondary" disabled={isStale} onClick={saveProposal}>Guardar como propuesta</Button> : null}
                {/* El documento lleva «USO INTERNO»: no se ofrece delante del cliente. */}
                {seEnsena("documentosInternos") ? (
                  <Button variant="secondary" disabled={exporting} onClick={() => void exportPdf()}>
                    {exporting ? "Descargando la propuesta…" : "Descargar la propuesta"}
                  </Button>
                ) : null}
              </div>
              {exportError ? <AsyncErrorBanner error={exportError} onRetry={() => void exportPdf()} /> : null}
            </>
          ) : null}

          <p className="cmp-note">
            {windows ? `Selección ${oFalta(fecha(windows.selection.first_date))} a ${oFalta(fecha(windows.selection.last_date))} (${windows.selection.weeks} semanas); confirmación ${oFalta(fecha(windows.confirmation.first_date))} a ${oFalta(fecha(windows.confirmation.last_date))} (${windows.confirmation.weeks} semanas). ` : ""}
            Medido en semanal y en euros, pesos fijos al inicio de cada ventana{notas?.tipoLibre ? `, ${notas.tipoLibre}` : response.risk_free ? `, tipo sin riesgo ${oFalta(porcentaje(response.risk_free.risk_free_rate))}` : ""}.
            {response.evaluated_combinations > 0 ? ` ${response.evaluated_combinations} combinaciones evaluadas${response.search === "GREEDY" ? " (búsqueda por pasos)" : ""}.` : ""}
            {/* Decisión 10: en el coste una acción cuenta como cero, y quien enseña esa media lo dice. */}
            {result!.positions.some((position) => esAccion(allAssets.find((asset) => asset.asset_id === position.asset_id)?.instrument_type))
              ? ` Las acciones no tienen coste corriente y cuentan como cero. ${NOTA_DE_LAS_ACCIONES}`
              : ""}
            {" "}Resultados históricos: no garantizan el comportamiento futuro.
          </p>

          {(Object.keys(response.rejected_candidates).length > 0 || result!.candidates.skipped.length > 0 || otrosExcluidos.length > 0) ? (
            <div className="improvement-rejected">
              <h3 className="section-label">Candidatos descartados y posiciones sin alternativa</h3>
              <ul>
                {result!.candidates.skipped.map((item) => (
                  <li key={`skip-${item.asset_id}`}><strong>{allAssets.find((asset) => asset.asset_id === item.asset_id)?.display_name ?? item.asset_id}</strong>: {textoEnPantalla(item.reason)}</li>
                ))}
                {Object.entries(response.rejected_candidates).flatMap(([position, items]) => items.map((item) => (
                  <li key={`rej-${position}-${item.asset_id}`}>
                    <strong>{allAssets.find((asset) => asset.asset_id === item.asset_id)?.display_name ?? item.asset_id}</strong>
                    {" "}(para {allAssets.find((asset) => asset.asset_id === position)?.display_name ?? position}): {item.not_evaluable ? "no evaluable · " : ""}{textoEnPantalla(rejectionLabel(item.reason))}{item.detail ? ` · ${cifrasEnPantalla(textoEnPantalla(item.detail))}` : ""}
                  </li>
                )))}
                {otrosExcluidos.map((item) => (
                  <li key={`exc-${item.asset_id}`}><strong>{allAssets.find((asset) => asset.asset_id === item.asset_id)?.display_name ?? item.asset_id}</strong>: {textoEnPantalla(rejectionLabel(item.reason))}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {reviewing && diff && proposed ? (
        <ModalDialog labelledBy="improvement-review-title" onClose={() => setReviewing(false)} size="lg" className="optimization-review-dialog" closeOnBackdrop={false}>
          <DialogHeader titleId="improvement-review-title" eyebrow="Mejora calculada" title="Revisar sustituciones" onClose={() => setReviewing(false)} />
          <DialogBody className="optimization-review-body">
            <div className="optimization-review-notice" role="status">
              <strong>La cartera original no se ha modificado.</strong>
              <span>Comprueba los cambios y decide si quieres aplicarlos en Diseño de cartera.</span>
            </div>
            <Panel
              claseDelCuerpo="stack stack--tight"
              nivel={3}
              rotulo="Antes / propuesta"
              titulo={`Diferencias · ${diff.source}`}
              tituloId="improvement-review-diff-title"
            >
              <CifrasDeLosCambios comparacion={diff} medida="confirmacion" />
              <CambiosDePeso capital={capital} comparacion={diff} titulo="Sustituciones propuestas" />
            </Panel>
          </DialogBody>
          <DialogFooter nota={SIN_COMISIONES_NI_IMPUESTOS}>
            <Button variant="secondary" onClick={() => setReviewing(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={isStale}
              title={isStale ? "La cartera ha cambiado desde el cálculo: vuelve a calcular." : undefined}
              onClick={applyProposal}
            >
              Aplicar sustituciones
            </Button>
          </DialogFooter>
        </ModalDialog>
      ) : null}
    </Panel>
  );
}
