import { useId } from "react";
import { Ausencia } from "./ui/Ausencia";
import { Panel } from "./ui/Panel";
import { oFalta, peso } from "../core/formato";

export interface RiskContributionItem {
  asset_id: string;
  weight_pct: number;
  risk_pct: number;
}

/* Cómo se estimó la covarianza. Llega como código del servidor, y un código no llega a pantalla. */
const NOMBRE_DE_LA_COVARIANZA = { LEDOIT_WOLF: "Ledoit-Wolf", OAS: "OAS", SAMPLE: "muestral" } as const;

export interface RiskContributionChartProps {
  items: RiskContributionItem[] | null;
  reason?: string | null;
  covModel?: "LEDOIT_WOLF" | "OAS" | "SAMPLE";
  assetLabels?: Record<string, string>;
}

function formatPercent(value: number): string {
  // El dato llega en puntos porcentuales; `peso` espera la fracción. Es un reparto: un decimal.
  return oFalta(peso(value / 100));
}

function barWidth(value: number, maximum: number): string {
  if (!Number.isFinite(value) || maximum <= 0) {
    return "0%";
  }
  return `${Math.min(100, (Math.abs(value) / maximum) * 100)}%`;
}

export function RiskContributionChart({ items, reason, covModel, assetLabels = {} }: RiskContributionChartProps) {
  const headingId = useId();
  const unavailable = reason === "ZERO_VOLATILITY" || items === null;
  const safeItems = unavailable
    ? []
    : items.filter(
        (item) =>
          typeof item.asset_id === "string" &&
          Number.isFinite(item.weight_pct) &&
          Number.isFinite(item.risk_pct)
      );
  const sharedMaximum = Math.max(
    1,
    ...safeItems.flatMap((item) => [Math.abs(item.weight_pct), Math.abs(item.risk_pct)])
  );
  const concentrated = safeItems.filter((item) => item.risk_pct > 40);

  return (
    <Panel
      className="f5-analytics-panel f5-risk-contribution"
      rotulo="Contribución al riesgo"
      subtitulo={
        <>
          Compara el peso de cada activo con su aportación a la volatilidad total.
          {covModel ? <> · Covarianza: {NOMBRE_DE_LA_COVARIANZA[covModel]}</> : null}
        </>
      }
      titulo="Peso vs riesgo por posición"
      tituloId={headingId}
    >

      {unavailable || safeItems.length === 0 ? (
        <div className="f5-analytics-empty" role="status">
          {/* Con volatilidad nula la medida no está definida: no aplica. «Falta el dato» es para lo que debería estar. */}
          <strong><Ausencia clase={reason === "ZERO_VOLATILITY" ? "no-aplica" : "falta"} /></strong>
          <span>
            {reason === "ZERO_VOLATILITY"
              ? "Volatilidad de cartera nula: la contribución al riesgo no está definida."
              : reason || "Sin datos suficientes para calcular la contribución al riesgo."}
          </span>
        </div>
      ) : (
        <>
          <div className="f5-risk-legend" aria-hidden="true">
            <span><i className="f5-risk-swatch f5-risk-swatch-weight" />Peso</span>
            <span><i className="f5-risk-swatch f5-risk-swatch-risk" />Contribución al riesgo</span>
            <span><i className="f5-risk-swatch f5-risk-swatch-negative" />Contribución negativa</span>
          </div>
          <ul className="f5-risk-list">
            {safeItems.map((item) => {
              const label = assetLabels[item.asset_id] || item.asset_id;
              const riskClass = item.risk_pct < 0 ? "negative" : "positive";
              return (
                <li key={item.asset_id} className="f5-risk-item">
                  <div className="f5-risk-asset">
                    <strong>{label}</strong>
                    {label !== item.asset_id ? <span>{item.asset_id}</span> : null}
                  </div>
                  <div
                    className="f5-risk-double-bars"
                    role="img"
                    aria-label={`${label}: peso ${formatPercent(item.weight_pct)}; contribución al riesgo ${formatPercent(item.risk_pct)}.`}
                  >
                    <div className="f5-risk-bar-line">
                      <span>Peso</span>
                      <div className="f5-risk-track f5-risk-track-signed">
                        <i className="f5-risk-bar f5-risk-bar-weight" style={{ width: barWidth(item.weight_pct, sharedMaximum) }} />
                      </div>
                      <strong>{formatPercent(item.weight_pct)}</strong>
                    </div>
                    <div className="f5-risk-bar-line">
                      <span>Riesgo</span>
                      <div className="f5-risk-track f5-risk-track-signed">
                        <i
                          className={`f5-risk-bar f5-risk-bar-risk f5-risk-bar-${riskClass}`}
                          style={{ width: barWidth(item.risk_pct, sharedMaximum) }}
                        />
                      </div>
                      <strong>{formatPercent(item.risk_pct)}</strong>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {concentrated.length > 0 ? (
        /* ANA-27: contenido fijo de la pantalla, no un aviso que llega: una nota, sin interrumpir al lector de pantalla al montarse. */
        <div className="f5-risk-alert" role="note">
          <strong>Concentración de riesgo superior al 40 %</strong>
          <span>
            {concentrated
              .map((item) => `${assetLabels[item.asset_id] || item.asset_id}: ${formatPercent(item.risk_pct)}`)
              .join(" · ")}
          </span>
        </div>
      ) : null}
    </Panel>
  );
}
