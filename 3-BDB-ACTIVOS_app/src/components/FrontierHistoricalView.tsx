import { isPartialFrontier } from "../core/frontierPortfolioCoverage";
/**
 * Vista presentacional de la frontera HISTÓRICA (portfolio-frontier.v1).
 * Solo renderiza un estado ya resuelto; no llama a ninguna callable ni calcula nada.
 */
import { HISTORICAL_FRONTIER_LABEL, PREFIJO_SIN_SOLUCION, type FrontierHistoricalState, type FrontierPointView, type FrontierViewModel } from "../types/portfolioFrontier";
import { concaveFrontierEnvelope, faltaElPuntoDeLaCartera } from "../core/frontierPresentation";
import { MAXIMO_SHARPE, MIN_VOLATILIDAD, notaDeLaPropuesta, RENTABILIDAD_OBJETIVO, TU_OBJETIVO } from "../core/notaDeLaPropuesta";
import { pesosDelPunto } from "../core/optimizationWeightValidation";
import { OaaFrontierChart, type OaaFrontierMark } from "../charts/oaa";
import type { PapelDeSerie } from "../charts/oaa/chartTheme";
import { MedidaDelObjetivo } from "./MedidaDelObjetivo";
import { RiskContributionChart } from "./RiskContributionChart";
import type { PortfolioOptimizationApplyContext } from "../core/portfolioOptimizationDiff";
import type { BdbAssetDetail } from "../types/bdbAssets";
import { useClientMode } from "../app/ClientModeContext";
import { fecha, oFalta, peso } from "../core/formato";
import { Cifra } from "./ui/Cifra";
import { avisoDeLaFrontera } from "../core/avisosDeLaFrontera";
import { textoEnPantalla, ventanaEnPalabras } from "../core/glosarioDePantalla";
import { KpiStrip } from "./ui/KpiStrip";

import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";

interface FrontierHistoricalViewProps {
  state: FrontierHistoricalState;
  compact?: boolean;
  /** Callback opcional para aplicar pesos a la cartera (flujo local; no es una callable). */
  onApplyWeights?: (weights: Record<string, number>, context?: PortfolioOptimizationApplyContext) => void;
  /** Texto de la acción. Permite revisar antes de aplicar sin duplicar la vista de resultados. */
  applyActionLabel?: string;
  /** La cartera actual no suele ser una propuesta accionable. Se conserva por compatibilidad. */
  includeCurrentApply?: boolean;
  /** Mapa asset_id -> nombre para mostrar nombres en lugar de ISIN/ID. */
  nameById?: Record<string, string>;
  /** Las fichas: si lo que se mide es una sola acción, cuyo Sharpe no se enseña, y si hay renta fija y bolsa, para la nota del encogimiento. */
  assets?: readonly Pick<BdbAssetDetail, "asset_id" | "instrument_type" | "economic_asset_class">[];
}

function HistFrontierChart({ model }: { model: FrontierViewModel }) {
  const curve = [...model.frontier]
    .filter((p) => Number.isFinite(p.volatility) && Number.isFinite(p.expectedReturn))
    .sort((a, b) => a.volatility - b.volatility);
  const presentationCurve = concaveFrontierEnvelope(curve, (p) => p.volatility, (p) => p.expectedReturn);
  const ampliado = (model.extensions?.length ?? 0) > 0;
  /* El color sale del papel de cada punto (apartado 7 del sistema): la cartera, marino; el objetivo, con qué se compara,
     gris; el máximo Sharpe y la mínima volatilidad (hueca), series en su orden. */
  type Marca = { id: string; label: string; point: FrontierPointView; papel: PapelDeSerie; hollow?: boolean };
  const candidatas: (Marca | null)[] = [
    model.target ? { id: "target", label: TU_OBJETIVO, point: model.target, papel: "referencia" } : null,
    model.current ? { id: "current", label: isPartialFrontier(model) ? "Parte incluida" : "Tu cartera", point: model.current, papel: "cartera" } : null,
    { id: "max-sharpe", label: MAXIMO_SHARPE, point: model.maxSharpe, papel: "serie" },
    { id: "min-vol", label: MIN_VOLATILIDAD, point: model.minVolatility, papel: "serie", hollow: true },
    model.targetReturn ? { id: "target-return", label: RENTABILIDAD_OBJETIVO, point: model.targetReturn, papel: "referencia" } : null
  ];
  const marks = candidatas.filter((m): m is Marca => m !== null);

  const all = [
    ...curve.map((p) => ({ vol: p.volatility, ret: p.expectedReturn })),
    ...marks.map((m) => ({ vol: m.point.volatility, ret: m.point.expectedReturn }))
  ];
  if (all.length < 2) return null;

  const chartMarks: OaaFrontierMark[] = marks.map((mark) => ({
    id: mark.id,
    label: mark.label,
    vol: mark.point.volatility,
    ret: mark.point.expectedReturn,
    papel: mark.papel,
    hollow: mark.hollow
  }));

  return (
    <OaaFrontierChart
      frontier={presentationCurve.map((point) => ({ vol: point.volatility, ret: point.expectedReturn }))}
      marks={chartMarks}
      height={380}
      ariaLabel={`Frontera histórica: curva de riesgo y rentabilidad con tu cartera, ${model.targetReturn ? "la de la rentabilidad objetivo, " : ""}la de máximo Sharpe y la de mínima volatilidad.`}
      dataQuality={ampliado ? "estimated" : "real"}
      dataQualityLabel={ampliado ? "Histórico ampliado" : "Histórica"}
      dataQualityNote={ampliado ? "Calculada con series históricas alineadas semanalmente, con tramos estimados." : "Calculada con series históricas alineadas semanalmente."}
    />
  );
}

/**
 * Convierte el mensaje técnico de error de la frontera histórica real en una pista accionable.
 */
function frontierErrorHint(message: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("current_portfolio") || m.includes("peso") || m.includes("weight")) {
    return "Asigna pesos a la cartera para calcular la frontera histórica.";
  }
  if (m.includes("at least two") || m.includes("two assets")) {
    return "Se necesitan al menos 2 activos con histórico común.";
  }
  if (m.includes("insufficient") || m.includes("common") || m.includes("histor")) {
    return "No hay suficiente histórico común entre los activos.";
  }
  return "No se pudo calcular la frontera histórica real.";
}

/** El servidor habla de identificadores, porque no siempre tiene la ficha a mano; en pantalla, cada activo por su nombre. */
function conNombres(texto: string, nameById: Record<string, string> = {}): string {
  return Object.entries(nameById).reduce((escrito, [id, nombre]) => escrito.split(id).join(nombre), texto);
}

function PointCard({
  title,
  accent,
  point,
  comparisonPoint,
  onApplyWeights,
  applyActionLabel,
  nameById,
  reference = false
}: {
  title: string;
  accent: string;
  point: FrontierPointView;
  onApplyWeights?: (weights: Record<string, number>, context?: PortfolioOptimizationApplyContext) => void;
  comparisonPoint?: FrontierPointView;
  applyActionLabel: string;
  nameById?: Record<string, string>;
  /** Cartera de referencia (Máx. Sharpe, Mín. volatilidad): visualmente secundaria. */
  reference?: boolean;
}) {
  return (
    <article className={`frontier-card is-${accent}${reference ? " is-reference" : ""}`}>
      <header className="frontier-card-head">
        <div className="frontier-card-title">
          <span className="frontier-card-eyebrow">{title}</span>
          {reference ? <span className="frontier-card-tag">Referencia</span> : null}
        </div>
        <dl className="frontier-card-kpis">
          {/* Decisión 6.3 (17-10-2026): las tres son del modelo (media esperada), no las medidas con la serie. */}
          <div>
            <dt>Rent. del modelo</dt>
            {/* La rentabilidad, con su signo y su color; la volatilidad y el Sharpe, en tinta. */}
            <dd><Cifra tipo="rentabilidad" valor={point.expectedReturn} /></dd>
          </div>
          <div>
            <dt>Vol. del modelo</dt>
            <dd>{point.volatilityLabel}</dd>
          </div>
          <div>
            <dt>Sharpe del modelo</dt>
            <dd>{point.sharpeLabel}</dd>
          </div>
        </dl>
      </header>
      {point.weights.length > 0 ? (
        <ul className="frontier-card-weights">
          {point.weights.map((w) => {
            const name = nameById?.[w.assetId] ?? w.assetId;
            return (
              <li key={w.assetId}>
                <span className="frontier-card-weight-name" title={name}>{name}</span>
                <strong>{w.weightLabel}</strong>
              </li>
            );
          })}
        </ul>
      ) : null}
      {onApplyWeights ? (
        <div className="frontier-card-actions">
          <Button
            size="sm"
            variant={reference ? "secondary" : "primary"}
            onClick={() => onApplyWeights(pesosDelPunto(point), {
              source: title,
              beforeMetrics: comparisonPoint ? { expected_return: comparisonPoint.expectedReturn, volatility: comparisonPoint.volatility, sharpe: comparisonPoint.sharpeRatio } : undefined,
              afterMetrics: { expected_return: point.expectedReturn, volatility: point.volatility, sharpe: point.sharpeRatio }
            })}
          >
            {applyActionLabel}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function FrontierHistoricalView({
  state,
  compact = false,
  onApplyWeights,
  applyActionLabel = "Aplicar pesos",
  includeCurrentApply = true,
  nameById,
  assets
}: FrontierHistoricalViewProps) {
  const { enabled: clientMode } = useClientMode();
  /* Cargando, sin sesión y error escribían la misma cabecera tres veces. El
     distintivo repite el título a propósito mientras no hay modelo: lo que
     cualifica la cifra (`model.label`) todavía no existe en esos tres estados. */
  const cabecera = !clientMode ? <span className="status-pill">Frontera histórica</span> : null;
  if (state.status === "idle") {
    return null;
  }

  if (state.status === "loading") {
    return (
      <Panel estado={cabecera} titulo="Frontera histórica">
        <p className="asset-detail-muted">Calculando la frontera con series históricas…</p>
      </Panel>
    );
  }

  if (state.status === "unauthenticated") {
    return (
      <Panel estado={cabecera} titulo="Frontera histórica">
        <div className="portfolio-notice">
          Inicia sesión para calcular la frontera histórica con series reales.
        </div>
      </Panel>
    );
  }

  if (state.status === "error") {
    /* Que ninguna cartera cumpla lo pedido no es un fallo: lo dice el servidor con sus cifras, y no hay otra propuesta. */
    if (state.message.startsWith(PREFIJO_SIN_SOLUCION)) {
      return (
        <Panel className="frontier-historical-error" estado={cabecera} titulo="Frontera histórica">
          <div className="frontier-soft-notice" role="status">{conNombres(state.message, nameById)}</div>
        </Panel>
      );
    }
    /* El texto que manda el servidor ya dice qué pasa y qué probar: va como texto principal, sin «Detalle técnico» que lo repita. */
    if (state.textoDelServidor) {
      return (
        <Panel className="frontier-historical-error" estado={cabecera} titulo="Frontera histórica">
          <div className="frontier-soft-notice" role="status">
            <strong>Histórica no disponible.</strong> <span>{conNombres(state.message, nameById)}</span>
          </div>
        </Panel>
      );
    }
    return (
      <Panel className="frontier-historical-error" estado={cabecera} titulo="Frontera histórica">
        <div className="frontier-soft-notice">
          <strong>Histórica no disponible.</strong>{" "}
          <span>{compact && !faltaElPuntoDeLaCartera(state.message) ? state.message : frontierErrorHint(state.message)}</span>
        </div>
        {!clientMode ? <p className="asset-detail-muted frontier-technical-detail">Detalle técnico: {state.message}</p> : null}
      </Panel>
    );
  }

  const model = state.model;
  const partial = isPartialFrontier(model);
  const notaDelModelo = notaDeLaPropuesta(model, assets);
  const applyCompleteWeights = partial ? undefined : onApplyWeights;
  const avisos = model.warnings.flatMap((aviso) => avisoDeLaFrontera(aviso, clientMode) ?? []);
  /* OPT-3 (auditoría del 16-11-2026): si no se pudo leer el €STR del periodo, el Sharpe sale con un tipo fijo, y aquí se
     seguía llamando «€STR» en el subtítulo y en la nota. Las dos señales del servidor, como en `tipoDeRespaldo`. */
  const conTipoDeRespaldo = model.riskFreeRatePolicy === "STATIC_FALLBACK" || model.warnings.includes("RISK_FREE_RATE_STATIC_FALLBACK");

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      className="frontier-historical"
      /* Si dice lo mismo que el título, no es un estado. */
      estado={!clientMode && model.label !== HISTORICAL_FRONTIER_LABEL ? <span className="status-pill">{model.label}</span> : null}
      subtitulo={`Ventana de ${ventanaEnPalabras(model.window)} · tipo sin riesgo ${
        conTipoDeRespaldo ? "fijo de respaldo" : "media €STR"
      } ${model.riskFreeRateLabel} · ${oFalta(fecha(model.asOfDate))}`}
      titulo="Frontera histórica"
    >

      {model.portfolioCoverage ? (
        <div className={partial ? "portfolio-notice" : "asset-detail-muted"} role="status">
          Peso medido de la cartera original: {oFalta(peso(model.portfolioCoverage.weightPercent / 100))} · {model.portfolioCoverage.included}/{model.portfolioCoverage.requested} posiciones.
          {partial ? <> El cálculo representa solo la parte incluida, normalizada al 100 %. Para aplicar pesos, selecciona una cartera completa con un máximo de 40 activos y datos suficientes.
            <ul>{model.portfolioCoverage.excluded.map((item) => <li key={item.assetId}>{nameById?.[item.assetId] ?? item.assetId} · {oFalta(peso(item.weightPercent / 100))} · {textoEnPantalla(item.reasonLabel)}</li>)}</ul>
          </> : null}
        </div>
      ) : null}
      {!clientMode ? <p className="asset-detail-muted">
        Activos medidos: {model.coverage.included}/{model.coverage.requested} · {model.coverage.commonObservations}{" "}
        observaciones comunes · {oFalta(fecha(model.coverage.firstDate))} → {oFalta(fecha(model.coverage.lastDate))}
      </p> : null}

      {model.insufficientCoverage ? (
        <div className="portfolio-notice">
          Histórico insuficiente: se necesitan al menos 2 activos con histórico común para una frontera fiable.
        </div>
      ) : null}

      {!compact && (model.riskContributions !== undefined || model.riskContributionsMeta) ? (
        <RiskContributionChart
          items={model.riskContributions ?? null}
          reason={model.riskContributionsMeta?.reason}
          covModel={model.riskContributionsMeta?.cov_model}
          assetLabels={nameById}
        />
      ) : null}

      {model.extensions?.length ? (
        <div className="asset-detail-muted">
          <p>Histórico ampliado: los tramos estimados entran en el cálculo. No son precios reales del activo.</p>
          {model.extensions.map((tramo) => (
            <p key={tramo.assetId}>{nameById?.[tramo.assetId] ?? tramo.assetId}: {tramo.reference} · tramo estimado {oFalta(fecha(tramo.estimatedFrom))} → {oFalta(fecha(tramo.estimatedUntil))}.</p>
          ))}
        </div>
      ) : null}

      {!compact ? <MedidaDelObjetivo model={model} assets={assets} /> : null}

      {!compact && notaDelModelo ? <p className="asset-detail-muted">{notaDelModelo}</p> : null}

      {!compact ? <div className="frontier-cards">
        {model.target ? (
          <PointCard title={TU_OBJETIVO} accent="target" point={model.target} comparisonPoint={model.current} onApplyWeights={applyCompleteWeights} applyActionLabel={applyActionLabel} nameById={nameById} />
        ) : null}
        {model.targetReturn ? (
          <PointCard title={RENTABILIDAD_OBJETIVO} accent="target" point={model.targetReturn} comparisonPoint={model.current} onApplyWeights={applyCompleteWeights} applyActionLabel={applyActionLabel} nameById={nameById} />
        ) : null}
        {model.current ? (
          <PointCard title={partial ? "Parte incluida de tu cartera" : "Tu cartera"} accent="current" point={model.current} comparisonPoint={model.current} onApplyWeights={includeCurrentApply ? applyCompleteWeights : undefined} applyActionLabel={applyActionLabel} nameById={nameById} />
        ) : null}
        <PointCard title={MAXIMO_SHARPE} accent="sharpe" reference point={model.maxSharpe} comparisonPoint={model.current} onApplyWeights={applyCompleteWeights} applyActionLabel={applyActionLabel} nameById={nameById} />
        <PointCard title={MIN_VOLATILIDAD} accent="minvol" reference point={model.minVolatility} comparisonPoint={model.current} onApplyWeights={applyCompleteWeights} applyActionLabel={applyActionLabel} nameById={nameById} />
      </div> : null}

      {compact ? (
        <div className="backtest-summary-layout">
          <div><HistFrontierChart model={model} /></div>
          <aside className="backtest-results-metrics">
            <h3>Métricas de {partial ? "la parte incluida" : "tu cartera"}</h3>
            <p className="asset-detail-muted">{ventanaEnPalabras(model.window)} · EUR · observaciones semanales comunes</p>
            {model.current ? <KpiStrip className="metrics-grid" ariaLabel="Métricas de la frontera histórica" items={[
              { label: "Rentabilidad estimada del modelo", value: <Cifra tipo="rentabilidad" valor={model.current.expectedReturn} /> },
              { label: "Volatilidad anualizada", value: model.current.volatilityLabel },
              { label: "Sharpe del modelo", value: model.current.sharpeLabel }
            ]} /> : <p>No hay métricas disponibles para los pesos actuales.</p>}
            <p className="cmp-note">Mismo periodo, divisa y activos que el gráfico. La rentabilidad es una estimación del modelo; no equivale a la rentabilidad anualizada de la simulación histórica.</p>
          </aside>
        </div>
      ) : <HistFrontierChart model={model} />}

      <p className="asset-detail-muted">Frontera: {model.frontier.length} {model.frontier.length === 1 ? "punto calculado" : "puntos calculados"}.</p>

      {model.excluded.length > 0 ? (
        <div className="frontier-excluded">
          <h3>Activos excluidos del cálculo</h3>
          <ul>
            {model.excluded.map((item) => (
              <li key={item.assetId}>
                <span className="frontier-excluded-id">{nameById?.[item.assetId] ?? item.assetId}</span>
                <span className="frontier-excluded-sep" aria-hidden="true">·</span>
                <span className="frontier-excluded-reason">{textoEnPantalla(item.reasonLabel)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {avisos.length > 0 ? (
        <ul className="frontier-warnings">
          {avisos.map((aviso) => (
            <li key={aviso}>{aviso}</li>
          ))}
        </ul>
      ) : null}

      <div className="preview-boundary-note">
        <strong>Frontera histórica</strong>
        Calculada con series históricas semanales y {conTipoDeRespaldo
          ? "un tipo fijo de respaldo como tipo sin riesgo, porque no se pudo leer el €STR del periodo"
          : "el €STR como tipo sin riesgo"}. Informativa; no es asesoramiento
        ni recomendación personalizada.
      </div>
    </Panel>
  );
}
