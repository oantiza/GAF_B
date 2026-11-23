import type { BacktestStressScenario } from "../adapters/backtestPortfolioBackend";
import type { HorizonPosition } from "../adapters/portfolioHorizon";
import { useClientMode, useModoCliente } from "../app/ClientModeContext";
import { motivoDeFueraParaElCliente } from "../core/backtestCoverage";
import { mismasFechasQueUnaCrisis, motivoDeUnaCrisisSinCifra, posicionesParaLasCrisis } from "../core/crisisPasadas";
import { useId, type ReactNode } from "react";
import { Ausencia } from "./ui/Ausencia";
import { Distintivo } from "./ui/Distintivo";
import { Panel } from "./ui/Panel";
import * as formato from "../core/formato";

export interface HistoricalStressCardsProps {
  scenarios: BacktestStressScenario[] | null;
  assetLabels?: Record<string, string>;
  /** Los pesos de la cartera: con ellos, un episodio sin cifra nombra con su peso lo que queda fuera (decisión 103). */
  positions?: readonly HorizonPosition[];
}

/* Lo que falta lo escribe siempre la pieza, «Falta el dato» en ocre (ANA-11). Hasta el 20-11-2026, en una misma tarjeta la duración y
   el activo que más restó lo decían con ella, y la caída, la recuperación y las fechas, con el texto suelto y en la tinta de una cifra. */
const FALTA = <Ausencia clase="falta" />;
/* P1-06 (21-11-2026): sin caída, la duración, la recuperación y el activo que más restó no faltan: no aplican. Antes salía
   «1 día» de recuperación y un activo que restaba un 0,00 %. */
const NO_APLICA = <Ausencia clase="no-aplica" />;
const SIN_CAIDA = <Ausencia clase="no-aplica" motivo="Sin caída" />;

/* Una caída o una contribución: el dato llega en puntos porcentuales y el módulo de formato recibe fracciones. Dos
   decimales, como toda cifra de riesgo de la pantalla (ANA-10). Sin cifra que escribir, `null`: quien la pinta pone la pieza. */
function formatPercent(value: number | null): string | null {
  return typeof value === "number" ? formato.porcentaje(value / 100) : null;
}

/* Un peso medido, con un decimal. Va dentro de una frase y llega siempre: el adaptador rechaza un escenario sin él. */
function formatWeight(value: number): string {
  return formato.oFalta(formato.peso(value / 100));
}

/* La fecha como en el resto de la pantalla, «13/11/2026» (ANA-26). Sin fecha, `null`. */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  return formato.fecha(value.slice(0, 10)) ?? value;
}

const EXCLUSION_LABELS: Record<string, string> = {
  NO_SERIES: "Sin serie EUR de 10 años",
  NO_DATA_AT_WINDOW_START: "Sin dato al inicio dentro de cinco días hábiles",
  YOUNGEST_TO_REACH_THREE_YEARS: "Excluido para alcanzar tres años comunes",
  SERIES_ENDS_EARLY: "Sus precios acaban antes del final del periodo",
  GAP_IN_WINDOW: "Sin cotizaciones durante parte de la crisis",
  PRICE_SERIES_MISSING: "Sin serie de precios",
  INSUFFICIENT_HISTORY: "Histórico insuficiente",
  FX_SERIES_MISSING: "Sin conversión a euros",
  FX_QUARANTINE: "Sin conversión a euros fiable",
  NON_INVESTABLE: "Activo no invertible",
  QUALITY_BLOCKED: "Bloqueado por calidad de datos",
  DISTRIBUTES_WITHOUT_PAYMENTS: "Reparte y no tenemos todos los pagos"
};

const SCENARIO_REASON_LABELS: Record<string, string> = {
  NO_POSITIVE_WEIGHTS: "No hay pesos positivos para calcular el escenario.",
  NO_ELIGIBLE_ASSETS: "Ningún activo tiene histórico elegible para esta ventana.",
  INSUFFICIENT_COMMON_DATA: "No hay fechas comunes suficientes para calcular el escenario."
};

/* El tramo de un episodio, «19/02/2020 – 23/03/2020». Sin ninguna de las dos fechas no hay tramo que escribir, y se dice una vez. */
function tramo(scenario: BacktestStressScenario): ReactNode {
  const desde = formatDate(scenario.start_date);
  const hasta = formatDate(scenario.end_date);
  return desde || hasta ? <>{desde ?? FALTA} – {hasta ?? FALTA}</> : FALTA;
}

function recoveryLabel(scenario: BacktestStressScenario): ReactNode {
  if (scenario.recovery_status === "NO_DRAWDOWN") return SIN_CAIDA;
  if (scenario.recovery_status === "RECOVERED" && scenario.recovery_days != null) {
    return <>{formato.cuantos(scenario.recovery_days, "día", "días")} · {formatDate(scenario.recovery_date) ?? FALTA}</>;
  }
  if (scenario.recovery_status === "NOT_RECOVERED") {
    /* Con este estado el servidor manda siempre cuánto falta (`stress_analytics.py`); si un día no llegara, no se escribe media frase. */
    const resto = formatPercent(scenario.remaining_to_recover_pct);
    return resto ? `Sin recuperar · falta ${resto}` : "Sin recuperar";
  }
  return FALTA;
}

export function HistoricalStressCards({ scenarios, assetLabels = {}, positions = [] }: HistoricalStressCardsProps) {
  const { enabled: clientMode } = useClientMode();
  const { seEnsena } = useModoCliente();
  const headingId = useId();
  const visibleScenarios = scenarios ?? [];
  const posicionDe = posicionesParaLasCrisis(positions, (id) => assetLabels[id]);
  /* Junto a la historia común, si cae en las fechas de una crisis y da otra cifra: por qué (Óscar, 20-11-2026). */
  const mismasFechas = mismasFechasQueUnaCrisis(visibleScenarios, (escenario) => formatPercent(escenario.drawdown_pct));

  return (
    <Panel
      className="f5-analytics-panel f5-stress"
      subtitulo="Simulación con los pesos de hoy: cómo se habría comportado la cartera en tres episodios históricos."
      titulo="Crisis pasadas"
      tituloId={headingId}
    >

      {visibleScenarios.length === 0 ? (
        <div className="f5-analytics-empty" role="status">
          <Ausencia clase="falta" />
          <span>Sin escenarios históricos disponibles para la cartera.</span>
        </div>
      ) : (
        <div className="f5-stress-grid">
          {visibleScenarios.map((scenario) => {
            const representative = scenario.representative;
            const worstAsset = scenario.worst_asset;
            /* Por debajo del 60 % no hay cifra, ni nada de lo que sale de ella: se dice cuánto mide y quién queda fuera, igual en Modo cliente y en el
               papel (decisión 103). La salvedad de antes, «poco representativa», pasa a ser ese motivo. */
            const sinCifra = motivoDeUnaCrisisSinCifra(scenario, posicionDe);
            /* La historia común mide de máximo a mínimo, y las crisis desde su primer día (decisión 115): su cifra es la caída
               máxima, y la duración dice desde qué máximo cuenta. Sin `peak_date` no se dice, porque no se ha medido así. */
            const maximo = scenario.peak_date ?? null;
            const sinCaida = scenario.recovery_status === "NO_DRAWDOWN";
            return (
              <article
                key={scenario.id}
                className="f5-stress-card"
                aria-label={`Escenario ${scenario.label}`}
              >
                <header>
                  <div>
                    <h3>{scenario.label}</h3>
                    <p>{tramo(scenario)}</p>
                  </div>
                  {!clientMode ? <Distintivo tono={representative ? "neutro" : "aviso"}>
                    {representative ? "Representativo" : "No representativo"}
                  </Distintivo> : null}
                </header>

                {scenario.reason ? (
                  <p className="f5-stress-no-data" role="status">
                    {SCENARIO_REASON_LABELS[scenario.reason] ?? scenario.reason}
                  </p>
                ) : null}

                {/* `f5-stress-sin-cifra`: este párrafo va en el sitio de las cifras, y la hoja lo coloca a su altura. El de
                    arriba, el motivo, va delante de ellas. */}
                {sinCifra ? (
                  <p className="f5-stress-no-data f5-stress-sin-cifra" role="status">
                    <Ausencia clase="falta" />
                    <span>{sinCifra}</span>
                  </p>
                ) : <dl className="f5-stress-metrics">
                  <div className="f5-stress-drop">
                    <dt>{maximo ? "Caída máxima" : "Caída"}</dt>
                    <dd>{formatPercent(scenario.drawdown_pct) ?? FALTA}</dd>
                  </div>
                  <div>
                    <dt>Duración</dt>
                    <dd>
                      {sinCaida
                        ? NO_APLICA
                        : scenario.duration_days == null
                        ? FALTA
                        : <>{formato.cuantos(scenario.duration_days, "día", "días")} · {maximo ? <>máximo {formatDate(maximo) ?? FALTA} · </> : null}mínimo {formatDate(scenario.trough_date) ?? FALTA}</>}
                    </dd>
                  </div>
                  <div>
                    <dt>Recuperación</dt>
                    <dd>{recoveryLabel(scenario)}</dd>
                  </div>
                  {/* Sobre cuánto se calcula se queda siempre, también en Modo cliente: sin esto la
                      cifra dice más de lo que mide (decisión 19). */}
                  <div>
                    <dt>{clientMode ? "Calculado sobre" : "Peso medido"}</dt>
                    <dd>
                      {clientMode
                        ? `el ${formatWeight(scenario.coverage.weight_pct)} de la cartera`
                        : `${formatWeight(scenario.coverage.weight_pct)} · ${scenario.coverage.included_assets}/${scenario.coverage.total_assets}`}
                    </dd>
                  </div>
                </dl>}

                {!clientMode && !sinCifra ? <div className="f5-stress-detail">
                  <h4>Activo que más restó</h4>
                  {worstAsset ? (
                    <p>
                      <strong>{assetLabels[worstAsset.asset_id] || worstAsset.asset_id}</strong>
                      <span>{formatPercent(worstAsset.contribution_pct) ?? FALTA}</span>
                    </p>
                  ) : (
                    <p>{sinCaida ? NO_APLICA : FALTA}</p>
                  )}
                </div> : null}

                <div className="f5-stress-detail">
                  <h4>Excluidos ({scenario.excluded_assets.length})</h4>
                  {scenario.excluded_assets.length > 0 ? (
                    <ul>
                      {scenario.excluded_assets.map((asset) => (
                        <li key={`${scenario.id}-${asset.asset_id}`}>
                          <span>{assetLabels[asset.asset_id] || asset.asset_id}</span>
                          <small>{seEnsena("calidadInterna") ? EXCLUSION_LABELS[asset.reason] ?? asset.reason : motivoDeFueraParaElCliente(asset.reason)}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Sin activos excluidos.</p>
                  )}
                </div>

                {scenario.id === "COMMON_HISTORY" && mismasFechas && !sinCifra ? (
                  <p className="f5-stress-mismas-fechas">{mismasFechas}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
