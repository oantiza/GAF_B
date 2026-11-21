import { PortfolioHorizonPanel } from "./PortfolioHorizonPanel";
import { useMemo } from "react";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { APPROXIMATE_FRONTIER_LABEL, type FrontierHistoricalState } from "../types/portfolioFrontier";
import { isRealFrontierEnabled } from "../adapters/optimizePortfolioBackend";
import { FrontierHistoricalView } from "./FrontierHistoricalView";
import { oFalta, peso, porcentaje } from "../core/formato";
import { Aviso } from "./ui/Aviso";
import { Cifra } from "./ui/Cifra";
import { approximateFrontierReason, HISTORICA_SIN_PESOS } from "../core/frontierPresentation";
import { ApproximateFrontierChart } from "./ApproximateFrontierChart";
import { useApproximateFrontier } from "../core/useApproximateFrontier";
import type { OaaFrontierMark } from "../charts/oaa";
import type { PortfolioOptimizationApplyContext } from "../core/portfolioOptimizationDiff";
import { buildDisplayedHistoricalFrontierRequest } from "../core/historicalFrontierRequest";
import { avisoDelTopeDeLaEstimada, TOPE_DE_LA_FRONTERA } from "../core/medidaDeLaCartera";
import { Panel } from "./ui/Panel";

interface FrontierPanelProps {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
  /** Estado historico (portfolio-frontier.v1). En produccion aun no se pasa (la callable se cablea en O1). */
  historical?: FrontierHistoricalState;
  /** Callback opcional para aplicar pesos de un punto a la cartera (flujo local). */
  onApplyWeights?: (weights: Record<string, number>, context?: PortfolioOptimizationApplyContext) => void;
  /**
   * Ola 1 (E3): en el Constructor la frontera es el gráfico protagonista y va
   * en 8 columnas al lado de las métricas clave. `compact` deja solo el
   * gráfico (sin la columna de estadísticas ni la lista de máximo Sharpe,
   * que pertenecen al optimizador) y una nota al pie.
   */
  compact?: boolean;
  /** Solo desde Diseño: lleva a Análisis cuando no hay frontera que dibujar. Análisis no lo pasa, porque ya se está allí. */
  onVerAnalisis?: () => void;
}

const NO_ASSETS: BdbAssetDetail[] = [];

function LegacyFrontierPanel({
  assets,
  positions,
  historical,
  onApplyWeights,
  compact = false
}: FrontierPanelProps) {
  /* Auditoría 27-07 (T2/P7): caché por huella + debounce, ahora en el hook
     compartido con el panel del periodo común (useApproximateFrontier). */
  /* A-130: la regla de la A-129, aquí también. Con más de 40 posiciones la estimada ni se calcula (el gancho recibe
     la lista vacía) ni se enseña la que quedara de antes, y en su sitio va el aviso que dice por qué. */
  const sinEstimada = positions.length > TOPE_DE_LA_FRONTERA;
  const { result: calculada, inputs: frontierInputs } = useApproximateFrontier(sinEstimada ? NO_ASSETS : assets);
  const result = sinEstimada ? null : calculada;

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assets) m.set(a.asset_id, a.display_name);
    return m;
  }, [assets]);

  const historicalRequest = useMemo(
    () => buildDisplayedHistoricalFrontierRequest({ assets, positions }),
    [assets, positions]
  );
  const hayPeso = positions.some((p) => p.weight_percent > 0);

  /* A-135: este panel ya no pide la frontera histórica. Solo sale sin pesos, con la histórica dada desde fuera o donde
     no está habilitada (`FrontierPanel`, abajo): con pesos manda el otro panel, que la mide con la simulación. Así que
     la única petición que hacía era sin pesos, y esa el servidor la contestaba sin el punto de la cartera —a propósito—
     y el sitio la descartaba: un cálculo por cada cambio en la composición, para nada. Va el estado que dice por qué. */
  const effectiveHistorical = useMemo<FrontierHistoricalState>(() => {
    if (historical !== undefined) return historical;
    if (!isRealFrontierEnabled()) return compact ? { status: "error", message: "El cálculo histórico no está habilitado en este entorno." } : { status: "idle" };
    if (!historicalRequest) return compact ? { status: "error", message: "Se necesitan al menos dos activos aptos para solicitar la frontera histórica." } : { status: "idle" };
    return hayPeso ? { status: "idle" } : HISTORICA_SIN_PESOS;
  }, [compact, historical, historicalRequest, hayPeso]);

  /* B7 (decisión 30-09): en el Constructor la histórica manda cuando existe;
     en cualquier otro estado final (error, sin sesión, no habilitada) y
     mientras carga, se dibuja la estimada por composición con el motivo. Solo
     si tampoco hay estimada posible (un activo, frecuencias incompatibles) se
     enseña el estado histórico tal cual. */
  const avisoDelTope = sinEstimada ? (
    <div role="note">
      <Aviso tono="nota">
        {avisoDelTopeDeLaEstimada(positions.length, hayPeso)}
      </Aviso>
    </div>
  ) : null;
  /* Por encima del tope, en Diseño no se enseña el estado de la histórica: sin pesos sería «se necesitan al menos dos
     activos aptos», que no es el motivo. La histórica, si llega, sigue mandando. */
  if (compact && avisoDelTope && effectiveHistorical.status !== "result") {
    return (
      <Panel className="frontier-panel" titulo="Frontera eficiente">
        {avisoDelTope}
      </Panel>
    );
  }
  if (compact && (effectiveHistorical.status === "result" || !result)) {
    return <FrontierHistoricalView state={effectiveHistorical} compact nameById={Object.fromEntries(nameById)} />;
  }
  const approximateReason = effectiveHistorical.status === "result" ? undefined : approximateFrontierReason(effectiveHistorical, hayPeso);

  if (effectiveHistorical.status === "result") {
    return <FrontierHistoricalView state={effectiveHistorical} onApplyWeights={onApplyWeights} nameById={Object.fromEntries(nameById)} />;
  }

  /* En compacto (Constructor) el motivo ya va en el pie del gráfico estimado;
     el bloque de estado histórico solo se conserva en Análisis. */
  const historicalBanner =
    effectiveHistorical.status !== "idle" && !compact ? (
      <FrontierHistoricalView state={effectiveHistorical} onApplyWeights={onApplyWeights} nameById={Object.fromEntries(nameById)} />
    ) : null;

  const emptyNote = (
    <p className="oaa-chart-empty">
      {frontierInputs.frontierAssets.length >= 2 && !frontierInputs.frequency.compatible
        ? frontierInputs.frequency.note
        : "Necesitas al menos 2 activos invertibles con rentabilidad, volatilidad y frecuencia compatible para trazar la frontera aproximada."}
    </p>
  );

  if (!result) {
    return (
      <>
        {historicalBanner}
        <Panel
          acciones={<span className="status-pill">{APPROXIMATE_FRONTIER_LABEL}</span>}
          className="frontier-panel"
          titulo="Frontera eficiente (aproximada)"
        >
          {avisoDelTope ?? emptyNote}
        </Panel>
      </>
    );
  }

  /* El color sale del papel (apartado 7 del sistema): el máximo Sharpe y la mínima volatilidad (hueca) son series. */
  /* Ola 2 (B″): en el Constructor los activos van en el gris de los puntos de contexto
     (`COLOR_DEL_PUNTO_DE_CONTEXTO`); la frontera es la única línea, en tinta apagada
     (`COLOR_DEL_CONTEXTO`). Las carteras de máximo Sharpe y mínima volatilidad pertenecen al
     paso Optimizar, no a la mesa de trabajo. */
  const frontierMarks: OaaFrontierMark[] = compact
    ? []
    : [
        { id: "max-sharpe", label: "Máx. Sharpe", vol: result.maxSharpe.vol, ret: result.maxSharpe.ret, papel: "serie" },
        { id: "min-vol", label: "Mín. volatilidad", vol: result.minVol.vol, ret: result.minVol.ret, papel: "serie", hollow: true }
      ];

  const topWeights = Object.entries(result.maxSharpe.weights)
    .filter(([, w]) => w >= 0.005)
    .sort((a, b) => b[1] - a[1]);

  /* La cartera no sale aquí: en esta frontera su punto sería una suma ponderada, no una medida (decisión 36). */
  const stats: { key: string; label: string; point: { ret: number; vol: number; sharpe: number } }[] = [
    { key: "sharpe", label: "Máx. Sharpe", point: result.maxSharpe },
    { key: "minvol", label: "Mín. volatilidad", point: result.minVol }
  ];

  const chartHeight = compact ? 340 : 430;
  const body = (
    <div className={compact ? "frontier-grid frontier-grid--compact" : "frontier-grid"}>
      <div className="frontier-chart-col">
        <ApproximateFrontierChart
          result={result}
          reason={approximateReason}
          note={frontierInputs.frequency.note}
          height={chartHeight}
          extraMarks={frontierMarks}
          frontierLabel={compact ? "Frontera eficiente" : "Frontera"}
          assetsLabel={compact ? "Activos de la cartera" : "Activos"}
          ariaLabel={compact
            ? undefined
            : "Frontera eficiente: riesgo y rentabilidad con la frontera suavizada, los activos de la cartera, la de máximo Sharpe y la de mínima volatilidad."}
        />
      </div>
      {compact ? (
        <p className="frontier-footnote">
          {frontierInputs.frequency.note}{" "}
          Construida con la rentabilidad y volatilidad por activo y correlaciones asumidas por clase (no series
          históricas). No es asesoramiento ni recomendación personalizada.
        </p>
      ) : (
      <aside className="frontier-aside">
        <dl className="frontier-stats">
          {stats.map((stat) => (
            <div className="frontier-stat" key={stat.key}>
              <dt>{stat.label}</dt>
              <dd>
                <span className="frontier-stat-pair">
                  Rentabilidad <b><Cifra tipo="rentabilidad" valor={stat.point.ret} /></b>
                </span>
                <span className="frontier-stat-pair">
                  Volatilidad <b><Cifra tipo="porcentaje" valor={stat.point.vol} /></b>
                </span>
                <span className="frontier-stat-pair">
                  {/* Decisión 6.3: Sharpe del modelo (media esperada), no el ex post. */}
                  Sharpe del modelo <b><Cifra tipo="ratio" valor={stat.point.sharpe} /></b>
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="frontier-optimal">
          <h3>Cartera de máximo Sharpe</h3>
          <p className="cmp-note">
            {result.maxWeight < 0.999
              ? `Sugerida · ${oFalta(peso(result.minWeight))}–${oFalta(peso(result.maxWeight))} por activo`
              : `Sugerida · mín. ${oFalta(peso(result.minWeight))} por activo`}
          </p>
          <ul className="rows">
            {topWeights.map(([id, w]) => (
              <li className="rows__item" key={id}>
                <span className="rows__label">{nameById.get(id) ?? id}</span>
                <strong className="rows__value">{oFalta(peso(w))}</strong>
              </li>
            ))}
          </ul>
        </div>
        <p className="frontier-footnote">
          {frontierInputs.frequency.note}{" "}
          Construida con la rentabilidad y volatilidad por activo y correlaciones asumidas por clase (no series
          históricas). No es asesoramiento ni recomendación personalizada. La frontera histórica real (series
          semanales) la sustituye en cuanto hay ≥2 activos con histórico común y pesos asignados.
        </p>
      </aside>
      )}
    </div>
  );

  return (
    <>
      {historicalBanner}
      <Panel
        acciones={compact ? null : <span className="status-pill">{APPROXIMATE_FRONTIER_LABEL}</span>}
        className="frontier-panel"
        subtitulo={
          compact
            ? `Riesgo y rentabilidad a 3 años · frontera estimada por composición · tipo sin riesgo ${oFalta(porcentaje(result.riskFree))}`
            : `Riesgo y rentabilidad de carteras posibles con tus activos · tipo sin riesgo ${oFalta(porcentaje(result.riskFree))}.`
        }
        titulo={compact ? "Frontera eficiente" : "Frontera eficiente (aproximada)"}
      >
        {body}
      </Panel>
    </>
  );
}

/** Explicit externally supplied states retain the existing presentation contract. */
export function FrontierPanel(props: FrontierPanelProps) {
  return props.historical || !props.positions.some((p) => p.weight_percent > 0) || !isRealFrontierEnabled() ? <LegacyFrontierPanel {...props} />
    : <CoherentFrontierPanel {...props} />;
}

/* Con pesos, la frontera del periodo común con el punto de la cartera, el máximo Sharpe y la mínima volatilidad. Sin las cuatro
   cifras: donde se monta (Análisis → Diversificación) ya están en la respuesta de arriba, y dos veces la misma cifra sobran. */
function CoherentFrontierPanel({ positions, assets, onVerAnalisis }: FrontierPanelProps) {
  return <PortfolioHorizonPanel positions={positions} assets={assets} onVerAnalisis={onVerAnalisis} variant="frontera" />;
}
