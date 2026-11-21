import { optimizationCoverageMessage, optimizationWeightIssue, pesosDelPunto } from "../core/optimizationWeightValidation";
import { isPartialFrontier } from "../core/frontierPortfolioCoverage";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAnalysisWindow } from "../core/analysisPreferences";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { FrontierHistoricalState, FrontierObjective, FrontierPointView, FrontierViewModel, FrontierWindow } from "../types/portfolioFrontier";
import type { OptimizerLaunchConfig } from "../types/optimizerLaunch";
import { fetchHistoricalFrontier, isRealFrontierEnabled } from "../adapters/optimizePortfolioBackend";
import { buildOptimizerFrontierRequest, LIMITE_DE_ACTIVOS_POR_PERIODO, OPTIMIZER_MAX_ASSETS } from "../core/historicalFrontierRequest";
import { canOptimizePortfolioWithConstraints, type PortfolioFeasibilityCheck } from "../core/portfolioConstraints";
import { FrontierHistoricalView } from "./FrontierHistoricalView";
import type { PortfolioOptimizationApplyContext } from "../core/portfolioOptimizationDiff";
import { OptimizationReviewDialog, type OptimizationProposal } from "./OptimizationReviewDialog";
import { ranuraDeCartera } from "../core/disenoEnSesion";
import { oFalta, peso } from "../core/formato";
import { textoEnPantalla } from "../core/glosarioDePantalla";
import { improvementFingerprint } from "../core/improvementResultStore";
import { MAXIMO_SHARPE, MIN_VOLATILIDAD, notaDeLaCartera, RENTABILIDAD_OBJETIVO, TU_OBJETIVO } from "../core/notaDeLaPropuesta";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";
import { CampoDeCifraAcotada } from "./CampoDeCifraAcotada";
import { problemaDelMinimo } from "../core/minimoPorActivo";

const OBJECTIVES: { value: FrontierObjective; label: string }[] = [
  /* DIS-14: los mismos nombres que el gráfico, las tarjetas y el papel. */
  { value: "MAX_SHARPE", label: MAXIMO_SHARPE },
  { value: "MIN_VOLATILITY", label: MIN_VOLATILIDAD },
  { value: "TARGET_RETURN", label: RENTABILIDAD_OBJETIVO },
  /* DIS-02: es un punto de la frontera de estos activos, no el perfil de riesgo 1-10 de la cartera. */
  { value: "TARGET_RISK", label: "Posición en la frontera" }
];
const WINDOWS: FrontierWindow[] = ["1Y", "3Y", "5Y", "10Y"];
/* DIS-06: los mismos rótulos que el periodo común de toda la sección («3 años», no «3A»). */
const ROTULO_DEL_PERIODO: Record<FrontierWindow, string> = { "1Y": "1 año", "3Y": "3 años", "5Y": "5 años", "10Y": "10 años" };
/* Hallazgo 12: el periodo al que se propone pasar cuando el elegido tiene pocos datos para tantos activos. */
const PERIODO_CON_DATOS: FrontierWindow = "3Y";
/* «Máx. Sharpe» y «Mín. volatilidad» son los mismos que en Simular, que no tiene este límite. */
const admiteRotacion = (objective: FrontierObjective) => objective === "TARGET_RISK" || objective === "TARGET_RETURN";

interface OptimizerPanelProps {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
  /** Pesos fijos por activo (decimales) — candados de la cartera. */
  lockedWeights?: Record<string, number>;
  feasibility?: PortfolioFeasibilityCheck;
  /** Devuelve un motivo (texto) si el receptor rechaza los pesos; el panel lo muestra en vez de «Pesos aplicados». */
  onApplyWeights?: (weights: Record<string, number>, context?: PortfolioOptimizationApplyContext) => string | null | void;
  /** Auditoría 11-08 (F1.4): tras aplicar pesos, el siguiente paso natural es
      el informe. Abre la vista de informe por la vía existente (onOpenReport
      del Constructor, con capital y candados actuales). */
  onOpenReport?: () => void;
  launch?: OptimizerLaunchConfig;
  /** El capital de la cartera, solo si está fijado: con él, la revisión dice cuánto dinero hay que mover. */
  capital?: number;
  /** Tras aplicar, el otro paso siguiente: Análisis. */
  onVerAnalisis?: () => void;
  /**
   * Lo que se enseña mientras no hay un cálculo: en Diseño, la frontera del periodo común. Con un resultado, la frontera
   * que se ve es la del cálculo: dos fronteras de la misma cartera en el mismo paso no se pueden leer.
   */
  frontierPrevia?: ReactNode;
}

/**
 * Hallazgo 53: el resultado se borraba con solo cambiar a Simular y volver. Se conserva en la sesión con
 * la cartera para la que se calculó, y caduca si esa cartera cambia, como en «Mejorar cartera»: si no, se
 * aplicaría una propuesta calculada para otros pesos.
 */
interface OptimizadorEnSesion {
  objective: FrontierObjective;
  windowSel: FrontierWindow;
  maxWeight: number;
  /** Mín. por activo (14-11-2026); falta en lo guardado antes de que existiera. */
  minWeight?: number;
  maxTurnover: number;
  targetReturn: number;
  riskSlider: number;
  state: FrontierHistoricalState;
  calculadaCon: string | null;
}

const optimizadorEnSesion = ranuraDeCartera<OptimizadorEnSesion | null>(() => null);

/** Lo que decide la propuesta: posiciones y pesos, y cuáles tienen candado. */
function huellaDeOptimizacion(positions: BdbManualPortfolioPosition[], locked: Record<string, number> | undefined): string {
  return `${improvementFingerprint(positions)}#${Object.keys(locked ?? {}).sort().join(",")}`;
}

const TEXTO_DE_CADUCADA =
  "La cartera ha cambiado desde el cálculo: esta propuesta corresponde a la composición anterior. Vuelve a optimizar para aplicarla.";

function pointForObjective(model: FrontierViewModel, objective: FrontierObjective): { title: string; point: FrontierPointView } | null {
  if (objective === "MIN_VOLATILITY") return { title: MIN_VOLATILIDAD, point: model.minVolatility };
  if (objective === "TARGET_RETURN") {
    return model.targetReturn ? { title: RENTABILIDAD_OBJETIVO, point: model.targetReturn } : null;
  }
  if (objective === "TARGET_RISK") {
    return model.target ? { title: TU_OBJETIVO, point: model.target } : null;
  }
  return { title: MAXIMO_SHARPE, point: model.maxSharpe };
}

function proposalFromPoint(
  title: string,
  point: FrontierPointView,
  current: FrontierPointView | undefined,
  nota: string | null
): OptimizationProposal {
  return {
    weights: pesosDelPunto(point),
    nota,
    context: {
      source: title,
      beforeMetrics: current ? {
        expected_return: current.expectedReturn,
        volatility: current.volatility,
        sharpe: current.sharpeRatio
      } : undefined,
      afterMetrics: {
        expected_return: point.expectedReturn,
        volatility: point.volatility,
        sharpe: point.sharpeRatio
      }
    }
  };
}

export function OptimizerPanel({
  assets,
  positions,
  lockedWeights,
  feasibility,
  onApplyWeights,
  onOpenReport,
  launch,
  capital,
  onVerAnalisis,
  frontierPrevia
}: OptimizerPanelProps) {
  const nameById = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.asset_id, a.display_name])),
    [assets]
  );
  const effectiveLockedWeights = useMemo<Record<string, number> | undefined>(() => {
    const entries = Object.entries({ ...(launch?.lockedWeights ?? {}), ...(lockedWeights ?? {}) })
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }, [launch?.lockedWeights, lockedWeights]);

  /* Lo que se lanza con una configuración de fuera no hereda lo que hubiera en la sesión. */
  const [enSesion] = useState(() => (launch ? null : optimizadorEnSesion.read()));
  const [objective, setObjective] = useState<FrontierObjective>(launch?.objective ?? enSesion?.objective ?? "MAX_SHARPE");
  /* DIS-06: arranca en el periodo común de análisis, y lo sigue mientras el asesor no elija otro aquí. 1 y 10 años se
     pueden elegir, y se dicen distintos del periodo común. */
  const periodoComun = useAnalysisWindow();
  const [windowSel, setWindowSel] = useState<FrontierWindow>(enSesion?.windowSel ?? periodoComun);
  const comunDeAntes = useRef<FrontierWindow>(periodoComun);
  useEffect(() => {
    const anterior = comunDeAntes.current;
    if (anterior === periodoComun) return;
    comunDeAntes.current = periodoComun;
    setWindowSel((actual) => (actual === anterior ? periodoComun : actual));
  }, [periodoComun]);
  const [maxWeight, setMaxWeight] = useState<number>(launch?.maxWeightPercent ?? enSesion?.maxWeight ?? 100);
  /* Mín. por activo (Óscar, 14-11-2026): 0 por defecto, que es lo de antes. Lo que se lanza de fuera no lo hereda. */
  const [minWeight, setMinWeight] = useState<number>(launch ? 0 : enSesion?.minWeight ?? 0);
  /* M2 «Mejorar cartera» (13-10-2026): rotación máxima en % del patrimonio que cambia de
     sitio (0 = sin límite). Se ofrece con «Posición en la frontera» y «Rentabilidad objetivo». */
  const [maxTurnover, setMaxTurnover] = useState<number>(enSesion?.maxTurnover ?? 0);
  const [targetReturn, setTargetReturn] = useState<number>(enSesion?.targetReturn ?? 8);
  const [riskSlider, setRiskSlider] = useState<number>(launch?.riskSlider ?? enSesion?.riskSlider ?? 5);
  const [state, setState] = useState<FrontierHistoricalState>(enSesion?.state ?? { status: "idle" });
  const [calculadaCon, setCalculadaCon] = useState<string | null>(enSesion?.calculadaCon ?? null);
  const [proposal, setProposal] = useState<OptimizationProposal | null>(null);
  /* `huella`: la cartera que dejó aplicar. «Pesos aplicados» deja de ser cierto en cuanto se vuelve atrás o se edita. */
  const [applyNotice, setApplyNotice] = useState<{ text: string; ok: boolean; huella?: string } | null>(null);
  /* DIS-04: un tope escrito que no vale no deja optimizar con el anterior sin decirlo. */
  const [topesNoValidos, setTopesNoValidos] = useState({ minWeight: false, maxWeight: false, maxTurnover: false });
  const requestSequence = useRef(0);
  const consumedLaunch = useRef<string | null>(null);

  /* Se aplica al volver de `onApplyWeights`: la cartera nueva llega en el render siguiente, y esa es la que se anota. */
  const huellaDeLaCartera = huellaDeOptimizacion(positions, effectiveLockedWeights);
  useEffect(() => {
    setApplyNotice((actual) => (actual?.huella === "pendiente" ? { ...actual, huella: huellaDeLaCartera } : actual));
  }, [applyNotice?.huella, huellaDeLaCartera]);
  const notaDeAplicadoVigente = applyNotice?.huella === "pendiente" || applyNotice?.huella === huellaDeLaCartera;

  const caducada =
    state.status === "result" && calculadaCon !== null && calculadaCon !== huellaDeOptimizacion(positions, effectiveLockedWeights);

  useEffect(() => {
    if (launch) return;
    optimizadorEnSesion.write({
      objective,
      windowSel,
      maxWeight,
      minWeight,
      maxTurnover,
      targetReturn,
      riskSlider,
      // Un cálculo a medias o un error no se recuerdan: al volver no hay nada que esperar.
      state: state.status === "result" ? state : { status: "idle" },
      calculadaCon
    });
  }, [launch, objective, windowSel, maxWeight, minWeight, maxTurnover, targetReturn, riskSlider, state, calculadaCon]);

  /* B1 (auditoría 06-09-2026): el panel enviaba TODAS las posiciones, y con las carteras reales
     de 38-39 posiciones el botón fallaba siempre y la pista culpaba al servidor. Ahora se usa la
     misma selección que el gráfico del Constructor, acotada al tope del motor, y el recorte se
     dice en pantalla. */
  const selection = useMemo(
    () => buildOptimizerFrontierRequest({ assets, positions, riskSlider }),
    [assets, positions, riskSlider]
  );
  const excluded = selection?.selectionExclusions ?? [];
  const requestedPositions = Object.keys(selection?.portfolioWeightsPercent ?? {}).length;
  const includedPositions = selection?.assetIds.length ?? 0;
  /* Una posición al 0 % entra aquí, y el optimizador puede proponer que entre. Simular solo mide lo que tiene peso. */
  const alCeroPorCiento = (selection?.assetIds ?? []).filter((id) => !((selection?.portfolioWeightsPercent ?? {})[id] > 0)).length;
  const excludedByCap = excluded.filter((item) => item.reasonLabel.startsWith("Límite")).length;
  const includedWeightPercent = Object.entries(selection?.portfolioWeightsPercent ?? {})
    .filter(([assetId]) => !excluded.some((item) => item.assetId === assetId))
    .reduce((total, [, weight]) => total + weight, 0);

  const constraintsAllowRun = canOptimizePortfolioWithConstraints(feasibility, includedPositions);
  const canRun = isRealFrontierEnabled() && constraintsAllowRun && selection !== null;
  /* Lo que el mínimo no deja calcular se dice antes de llamar, con sus cifras, y no se recorta. */
  const problemaDeMinimo = selection
    ? problemaDelMinimo({
      minimoPct: minWeight,
      maximoPct: maxWeight,
      assetIds: selection.assetIds,
      candados: effectiveLockedWeights,
      nombre: (id) => nameById[id] ?? id
    })
    : null;
  /* Hallazgo 12 (15-11-2026): cuántos activos caben depende de las semanas de datos del periodo. Se dice antes de llamar,
     con la tabla que el servidor comprueba; si lo dice el servidor, su texto. Los dos ofrecen pasar a 3 años. */
  const limiteDelPeriodo = LIMITE_DE_ACTIVOS_POR_PERIODO[windowSel];
  const pasaDelPeriodo = includedPositions > limiteDelPeriodo.maximo;
  /* El del servidor vale para la cartera con la que se llamó; cambiar de periodo lo retira (`elegirPeriodo`). */
  const limiteDelServidor = state.status === "error" && state.limiteDelPeriodo && calculadaCon === huellaDeLaCartera
    ? state.message
    : null;
  const avisoDelPeriodo = limiteDelServidor ?? (pasaDelPeriodo
    ? `El cálculo admite ${limiteDelPeriodo.maximo} activos como máximo y esta cartera tiene ${includedPositions} con el periodo de ${ROTULO_DEL_PERIODO[windowSel]}: con ${limiteDelPeriodo.semanas} semanas de datos son pocos datos por activo para estimar cómo se mueven juntos, y la propuesta sería sobre todo error de estimación. Pasa a ${ROTULO_DEL_PERIODO[PERIODO_CON_DATOS]}, que admite ${LIMITE_DE_ACTIVOS_POR_PERIODO[PERIODO_CON_DATOS].maximo}, o quita activos hasta dejar ${limiteDelPeriodo.maximo}.`
    : null);
  const elegirPeriodo = (periodo: FrontierWindow) => {
    setWindowSel(periodo);
    if (state.status === "error" && state.limiteDelPeriodo) setState({ status: "idle" });
  };
  const isLoading = state.status === "loading";
  /* El mensaje lo escribe un módulo que también imprime el papel: aquí se lee en palabras de pantalla, como en Comprobar. */
  const primerBloqueo = feasibility?.blocking_issues[0]?.message;
  const blockReason = primerBloqueo
    ? textoEnPantalla(primerBloqueo)
    : includedPositions < 2 ? "Añade al menos 2 activos invertibles para optimizar." : null;

  const execute = useCallback(async (parameters: {
    objective: FrontierObjective;
    maxWeight: number;
    minWeight?: number;
    targetReturn: number;
    riskSlider: number;
    maxTurnover?: number;
  }) => {
    if (!canRun) {
      return;
    }
    const requestId = ++requestSequence.current;
    const request = buildOptimizerFrontierRequest({
      assets,
      positions,
      riskSlider: parameters.riskSlider
    });
    if (!request) {
      setState({ status: "error", message: "No hay al menos dos activos invertibles en la cartera." });
      return;
    }
    setProposal(null);
    setApplyNotice(null);
    setState({ status: "loading" });
    setCalculadaCon(huellaDeOptimizacion(positions, effectiveLockedWeights));
    try {
      const nextState = await fetchHistoricalFrontier({
        ...request,
        window: windowSel,
        objective: parameters.objective,
        targetReturn: parameters.objective === "TARGET_RETURN" ? parameters.targetReturn / 100 : undefined,
        riskSlider: parameters.objective === "TARGET_RISK" ? parameters.riskSlider : undefined,
        riskTargetMode: parameters.objective === "TARGET_RISK" ? "FRONTIER_PERCENTILE" : undefined,
        maxWeight: parameters.maxWeight < 100 ? parameters.maxWeight / 100 : undefined,
        minWeight: (parameters.minWeight ?? 0) > 0 ? (parameters.minWeight ?? 0) / 100 : undefined,
        // La rotación se mide como Σ|w − w₀|: un 15 % del patrimonio que cambia de sitio son 0,30.
        maxTurnover: admiteRotacion(parameters.objective) && (parameters.maxTurnover ?? 0) > 0
          ? Math.min(2, (2 * (parameters.maxTurnover ?? 0)) / 100)
          : undefined,
        lockedWeights: effectiveLockedWeights
      });
      if (requestId !== requestSequence.current) return;
      setState(nextState);
      if (nextState.status === "result" && onApplyWeights && !isPartialFrontier(nextState.model)) {
        const selected = pointForObjective(nextState.model, parameters.objective);
        if (selected) {
          setProposal(proposalFromPoint(selected.title, selected.point, nextState.model.current, notaDeLaCartera(nextState.model, selected.title, assets)));
        }
      }
    } catch (cause: unknown) {
      if (requestId !== requestSequence.current) return;
      setState({
        status: "error",
        message: cause instanceof Error ? cause.message : "No se pudo optimizar la cartera."
      });
    }
  }, [assets, positions, canRun, effectiveLockedWeights, onApplyWeights, windowSel]);

  const run = () => void execute({ objective, maxWeight, minWeight, targetReturn, riskSlider, maxTurnover });

  const launchKey = launch
    ? `${launch.objective}|${launch.riskSlider ?? 5}|${launch.maxWeightPercent ?? 100}|${launch.autoRun === true}`
    : null;

  useEffect(() => {
    if (!launch) return;
    setObjective(launch.objective);
    setRiskSlider(Math.max(1, Math.min(10, launch.riskSlider ?? 5)));
    setMaxWeight(Math.max(1, Math.min(100, launch.maxWeightPercent ?? 100)));
  }, [launch, launchKey]);

  useEffect(() => {
    if (!launch?.autoRun || !launchKey || !canRun || pasaDelPeriodo || consumedLaunch.current === launchKey) return;
    consumedLaunch.current = launchKey;
    void execute({
      objective: launch.objective,
      maxWeight: Math.max(1, Math.min(100, launch.maxWeightPercent ?? 100)),
      targetReturn,
      riskSlider: Math.max(1, Math.min(10, launch.riskSlider ?? 5))
    });
  }, [canRun, execute, launch, launchKey, pasaDelPeriodo, targetReturn]);

  const reviewWeights = useCallback((weights: Record<string, number>, context?: PortfolioOptimizationApplyContext) => {
    setApplyNotice(null);
    setProposal({
      weights,
      nota: state.status === "result" ? notaDeLaCartera(state.model, context?.source, assets) : null,
      context: context ?? { source: "Optimizador" }
    });
  }, [assets, state]);

  /* R-01 (auditoría 29-09-2026): la propuesta describe solo la parte incluida en el
     cálculo. Si el tope del objetivo dejó posiciones fuera, aplicarla ponía a 0 % todas
     las demás (28 de 38 con Máximo Sharpe). Se exige cobertura completa y, si hay
     recortes, Aplicar queda deshabilitado con ese motivo. */
  const coverage = useMemo(() => {
    const requiredAssetIds = positions.filter((p) => (p.weight_percent || 0) > 0).map((p) => p.asset_id);
    /* El límite se nombra solo si la cartera lo pasa: si no, no es el motivo. */
    return {
      requiredAssetIds,
      maxAssets: requiredAssetIds.length > OPTIMIZER_MAX_ASSETS ? OPTIMIZER_MAX_ASSETS : undefined
    };
  }, [positions]);
  const exclusionIssue = excluded.length > 0
    ? optimizationCoverageMessage(excluded.length, excludedByCap > 0 ? OPTIMIZER_MAX_ASSETS : undefined)
    : null;
  /* La rotación se comprueba con lo que el servidor dice que usó: el máximo de su metodología y su cartera de partida.
     No con el campo de la pantalla, que puede haber cambiado después de calcular. */
  const rotacionDelCalculo = state.status === "result"
    && state.model.methodologyV2?.maxTurnover !== undefined
    && state.model.current
    ? { currentWeights: pesosDelPunto(state.model.current), max: state.model.methodologyV2.maxTurnover }
    : undefined;
  const issueFor = (weights: Record<string, number>) =>
    optimizationWeightIssue(weights, positions.map((p) => p.asset_id), effectiveLockedWeights, maxWeight / 100, coverage, minWeight / 100, rotacionDelCalculo)
    ?? exclusionIssue;
  const proposalIssue = proposal ? (caducada ? TEXTO_DE_CADUCADA : issueFor(proposal.weights)) : null;

  const applyProposal = (weights: Record<string, number>, context: PortfolioOptimizationApplyContext) => {
    if (caducada || issueFor(weights)) return;
    const refusal = onApplyWeights?.(weights, context);
    setProposal(null);
    if (typeof refusal === "string" && refusal) {
      setApplyNotice({ text: refusal, ok: false });
      return;
    }
    setApplyNotice({ text: "Pesos aplicados a la cartera.", ok: true, huella: "pendiente" });
    /* Aplicada, la cartera que se calculó ya no existe: el resultado se retira, como en «Mejorar cartera».
       Lo aplicado se lee en Antes/después, y desde allí se puede volver atrás. */
    setState({ status: "idle" });
    setCalculadaCon(null);
  };

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      className="optimizer-panel"
      subtitulo="Calcula una propuesta con tus activos, compárala con la cartera original y decide si quieres aplicarla."
      titulo="Optimizar cartera"
    >

      <div className="optimizer-controls">
        <label className="asset-search-select">
          <span>Objetivo</span>
          <select
            value={objective}
            onChange={(event) => {
              setObjective(event.target.value as FrontierObjective);
              // El campo de rotación se va o vuelve vacío de errores: lo que tuviera escrito ya no está.
              setTopesNoValidos((actual) => ({ ...actual, maxTurnover: false }));
            }}
          >
            {OBJECTIVES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="asset-search-select">
          <span>Periodo</span>
          <select aria-describedby="optimizer-periodo-hint" value={windowSel} onChange={(event) => elegirPeriodo(event.target.value as FrontierWindow)}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w === periodoComun ? `${ROTULO_DEL_PERIODO[w]} · el común` : `${ROTULO_DEL_PERIODO[w]} · distinto del común`}
              </option>
            ))}
          </select>
        </label>
        <CampoDeCifraAcotada
          alCambiarValidez={(valida) => setTopesNoValidos((actual) => ({ ...actual, minWeight: !valida }))}
          alConfirmar={setMinWeight}
          etiqueta="Mín. por activo (%)"
          max={100}
          min={0}
          step={1}
          valor={minWeight}
        />
        <CampoDeCifraAcotada
          alCambiarValidez={(valida) => setTopesNoValidos((actual) => ({ ...actual, maxWeight: !valida }))}
          alConfirmar={setMaxWeight}
          etiqueta="Máx. por activo (%)"
          max={100}
          min={1}
          step={5}
          valor={maxWeight}
        />
        {objective === "TARGET_RETURN" ? (
          <label className="optimizer-num">
            <span>Rent. objetivo (%)</span>
            <input
              type="number"
              lang="es"
              step={0.5}
              aria-describedby="optimizer-target-hint"
              value={targetReturn}
              onChange={(event) => setTargetReturn(Number(event.target.value))}
            />
          </label>
        ) : null}
        {admiteRotacion(objective) ? (
          <CampoDeCifraAcotada
            alCambiarValidez={(valida) => setTopesNoValidos((actual) => ({ ...actual, maxTurnover: !valida }))}
            alConfirmar={setMaxTurnover}
            describedBy="optimizer-turnover-hint"
            etiqueta="Rotación máx. (%)"
            max={100}
            min={0}
            step={5}
            valor={maxTurnover}
          />
        ) : null}
        {objective === "TARGET_RISK" ? (
          <label className="optimizer-num">
            <span>{`Riesgo dentro de la frontera: de menor (1) a mayor (10) · ${riskSlider}`}</span>
            <input
              aria-label="Riesgo dentro de la frontera, de menor (1) a mayor (10)"
              aria-describedby="optimizer-frontier-hint"
              type="range"
              min={1}
              max={10}
              step={1}
              value={riskSlider}
              onChange={(event) => setRiskSlider(Number(event.target.value))}
            />
          </label>
        ) : null}
        <Button variant="primary" busy={isLoading} disabled={!canRun || problemaDeMinimo !== null || pasaDelPeriodo || topesNoValidos.minWeight || topesNoValidos.maxWeight || topesNoValidos.maxTurnover} onClick={run}>
          {isLoading ? "Optimizando…" : "Optimizar"}
        </Button>
      </div>

      {/* DIS-20: una región viva que está siempre, para que el lector de pantalla anuncie el cálculo al empezar. El aviso
          de la vista de la frontera aparece con el cálculo, y lo que aparece ya lleno no siempre se anuncia. */}
      <p className="sr-only" role="status">
        {isLoading ? "Calculando la propuesta con series históricas…" : ""}
      </p>

      <p className="field__hint" id="optimizer-periodo-hint">
        {windowSel === periodoComun
          ? `Periodo: el común de análisis, ${ROTULO_DEL_PERIODO[periodoComun]}, el mismo de Componer, Simular, Análisis y los informes.`
          : `Periodo: ${ROTULO_DEL_PERIODO[windowSel]}, distinto del común de análisis (${ROTULO_DEL_PERIODO[periodoComun]}): las cifras del cálculo no son las de Componer, Simular ni Análisis.`}
        {limiteDelPeriodo.maximo < OPTIMIZER_MAX_ASSETS
          ? ` Con ${ROTULO_DEL_PERIODO[windowSel]} hay ${limiteDelPeriodo.semanas} semanas de datos, y el cálculo admite ${limiteDelPeriodo.maximo} activos como máximo.`
          : ""}
      </p>

      <p className="field__hint">
        {/* «También los que están al 0 %», solo si los hay: si no, la frase habla de algo que esta cartera no tiene. */}
        {`Mín. por activo: con 0, el optimizador puede dejar fuera cualquier activo; con otra cifra, todos se quedan con al menos esa${alCeroPorCiento > 0 ? ", también los que están al 0 %" : ""}.`}
      </p>

      <p className="field__hint">
        Máx. por activo: con 100, manda el tope del modelo, que depende del número de activos; con otra cifra, la que escribas.
        {alCeroPorCiento > 0
          ? ` ${alCeroPorCiento === 1 ? "Entra también una posición al 0 %, que Simular no mide" : `Entran también ${alCeroPorCiento} posiciones al 0 %, que Simular no mide`}: con otros activos, otra cartera.`
          : ""}
      </p>

      {objective === "TARGET_RETURN" ? (
        <p id="optimizer-target-hint" className="field__hint">
          Rent. objetivo: lo que escribes es la media de la serie, la de las rentabilidades semanales de la cartera en la ventana, anualizada. Medida como en Simular, la rentabilidad anualizada se queda cerca sin ser la misma cifra, y el resultado dice las dos.
        </p>
      ) : null}

      {objective === "TARGET_RISK" ? (
        <p id="optimizer-frontier-hint" className="field__hint">
          Riesgo dentro de la frontera: elige un punto de la frontera eficiente de estos activos, del de menos riesgo (1) al de más (10). No es el perfil de riesgo de la cartera.
        </p>
      ) : null}

      {admiteRotacion(objective) ? (
        <p id="optimizer-turnover-hint" className="field__hint">
          Rotación máxima: parte del patrimonio que puede cambiar de activo respecto a la cartera actual; 0 = sin límite.
        </p>
      ) : null}

      {!canRun ? (
        <p className="asset-detail-muted">{blockReason ?? "La frontera real no está activa en este entorno."}</p>
      ) : null}

      {canRun && problemaDeMinimo ? (
        <Aviso anunciar tono="aviso">{problemaDeMinimo}</Aviso>
      ) : null}

      {canRun && avisoDelPeriodo ? (
        <Aviso
          accion={
            <Button size="sm" variant="secondary" onClick={() => elegirPeriodo(PERIODO_CON_DATOS)}>
              {`Pasar a ${ROTULO_DEL_PERIODO[PERIODO_CON_DATOS]}`}
            </Button>
          }
          anunciar
          tono="aviso"
        >
          {avisoDelPeriodo}
        </Aviso>
      ) : null}

      {canRun && excluded.length > 0 ? (
        <Aviso anunciar tono="aviso">
          Se optimizan {includedPositions} de {requestedPositions} posiciones
          {" "}({oFalta(peso(includedWeightPercent / 100))} del patrimonio).
          {excludedByCap > 0 ? ` El cálculo admite ${OPTIMIZER_MAX_ASSETS} activos.` : ""}
          {" "}Fuera:{" "}
          {excluded
            .slice(0, 5)
            .map((item) => `${nameById[item.assetId] ?? item.assetId} (${item.reasonLabel.toLocaleLowerCase("es")})`)
            .join(", ")}
          {excluded.length > 5 ? ` y ${excluded.length - 5} más` : ""}.
          {" "}La propuesta describe solo la parte incluida, así que no se puede aplicar a la cartera completa:
          el botón «Aplicar optimización» queda desactivado.
        </Aviso>
      ) : null}

      {effectiveLockedWeights && Object.keys(effectiveLockedWeights).length > 0 ? (
        <p className="optimizer-locked-note">
          Fijados (candados de la cartera):{" "}
          {Object.entries(effectiveLockedWeights)
            .map(([id, w]) => `${nameById[id] ?? id} ${oFalta(peso(w))}`)
            .join(" · ")}
          . El optimizador reparte el resto entre los demás, con su tope; un candado manda aunque pase de él.
        </p>
      ) : null}

      {/* Auditoría 11-08 (F1.4): tras aplicar la optimización se ofrece el
          siguiente paso (informe de cliente) en el propio aviso, sin modales
          nuevos. */}
      {applyNotice && !applyNotice.ok ? (
        /* La caja de fuera lo sigue anunciando al aparecer: la pieza `Aviso` solo lo hace con el tono de error. */
        <div role="alert"><Aviso tono="aviso">{applyNotice.text}</Aviso></div>
      ) : null}
      {applyNotice?.ok && notaDeAplicadoVigente ? (
        <Aviso
          accion={
            onVerAnalisis || onOpenReport ? (
              <>
                {onVerAnalisis ? (
                  <Button size="sm" variant="secondary" onClick={onVerAnalisis}>
                    Ver el análisis
                  </Button>
                ) : null}
                {onOpenReport ? (
                  <Button size="sm" variant="secondary" onClick={onOpenReport}>
                    Preparar los informes
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
          anunciar
          tono="nota"
        >
          {applyNotice.text}
        </Aviso>
      ) : null}

      {caducada ? (
        <Aviso anunciar tono="aviso">{TEXTO_DE_CADUCADA}</Aviso>
      ) : null}

      {(state.status === "idle" || limiteDelServidor) && frontierPrevia ? frontierPrevia : null}

      <FrontierHistoricalView
        /* El límite del periodo ya lo dice el aviso de arriba, con su botón: dos veces, no. */
        state={limiteDelServidor ? { status: "idle" } : state}
        onApplyWeights={onApplyWeights && !caducada ? reviewWeights : undefined}
        applyActionLabel="Revisar propuesta"
        includeCurrentApply={false}
        nameById={nameById}
        assets={assets}
      />

      {proposal && onApplyWeights ? (
        <OptimizationReviewDialog
          assets={assets}
          positions={positions}
          proposal={proposal}
          blockedReason={proposalIssue}
          capital={capital}
          onCancel={() => setProposal(null)}
          onApply={applyProposal}
        />
      ) : null}
    </Panel>
  );
}
