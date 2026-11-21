import { useMemo } from "react";
import { useModoCliente } from "../app/ClientModeContext";
import { usePortfolioHorizon } from "../core/usePortfolioHorizon";
import { SIN_PESOS_NO_HAY_SIMULACION } from "../core/textoDeAusencia";
import { resolveHorizonMetrics, type HorizonPosition, type PortfolioHorizon } from "../adapters/portfolioHorizon";
import { useAnalysisWindow, setAnalysisWindow } from "../core/analysisPreferences";
import { fecha, oFalta } from "../core/formato";
import { measurementSeries } from "../core/seriesFrequency";
import { calculateUnderwaterSeries } from "../core/underwater";
import { backtestExclusionLabel } from "../core/backtestCoverage";
import { aportacionAlRiesgo, coberturaDeLaSimulacion, esUnaSolaAccion, notaDeLaSimulacion, notaDeLoQueNoEntraEnLaFrontera, procedenciaDeLaSimulacion, rotuloDeLaMedida, rotuloDeLaSerie, soloAcciones, TOPE_DE_LA_FRONTERA } from "../core/medidaDeLaCartera";
import { motivoDeQueNoAplique } from "../core/metricasPorInstrumento";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { OaaLineChart, OaaMonteCarloChart, OaaFrontierChart } from "../charts/oaa";
import { UnderwaterChart } from "../charts/UnderwaterChart";
import { HistoricalStressCards } from "./HistoricalStressCards";
import { SegmentedControl } from "./ui/SegmentedControl";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { ApproximateFrontierChart } from "./ApproximateFrontierChart";
import { useApproximateFrontier } from "../core/useApproximateFrontier";
import type { FrontierResult } from "../core/frontier";
import type { OaaFrontierMark } from "../charts/oaa";
import type { BdbAssetDetail } from "../types/bdbAssets";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Cifra } from "./ui/Cifra";
import { KpiStrip } from "./ui/KpiStrip";
import { Panel } from "./ui/Panel";

const NO_ASSETS: BdbAssetDetail[] = [];

export function AnalysisPeriodSelect() {
  const window = useAnalysisWindow();
  return <SegmentedControl label="Periodo común de análisis y proyección" value={window} onChange={setAnalysisWindow}
    options={[{ id: "3Y", label: "3 años" }, { id: "5Y", label: "5 años" }]} />;
}

export function HorizonMetrics({ analysis, assets = NO_ASSETS }: { analysis: PortfolioHorizon; assets?: BdbAssetDetail[] }) {
  const metrics = resolveHorizonMetrics(analysis);
  /* Por debajo del 80 % del peso, cada cifra dice que es de la parte medida: Visión general dice que el riesgo de la
     cartera no está medido, y aquí se leían como de la cartera entera. */
  const rotulo = (nombre: string) => rotuloDeLaMedida(nombre, analysis.years, analysis.extensions.length > 0, analysis.coverageWeightPercent);
  const medidos = analysis.backtest.asset_ids;
  return <aside className="backtest-results-metrics" aria-label="Métricas del periodo">
    <h3 className="section-label">Métricas · {analysis.years} años</h3>
    {/* Las mismas cifras y con el mismo formato que la tabla de al lado (apartado 6 de SISTEMA_DISENO.md): la
        rentabilidad, con dos decimales, signo y color; la volatilidad y la caída máxima, con dos y en tinta; el
        Sharpe, un ratio. Las cifras salen de la función que comparte
        con el PDF, y los rótulos no: en pantalla manda el glosario (decisión 28), con el periodo y la parte
        medida que dice `rotuloDeLaMedida`. El sello tampoco: «Histórico observado» es lo que dice el
        papel, y en pantalla esto es una simulación con los pesos de hoy. Lo dice bajo el título, y aquí no
        se repite: queda lo que solo se dice aquí. */}
    <KpiStrip items={[
      { label: rotulo("Rentabilidad anualizada"), value: <Cifra tipo="rentabilidad" valor={metrics.cagr.value} /> },
      { label: rotulo("Volatilidad"), value: <Cifra tipo="porcentaje" valor={metrics.volatility.value} /> },
      esUnaSolaAccion(medidos, assets)
        ? { label: rotulo("Sharpe"), value: textoDeAusencia("no-aplica"), note: motivoDeQueNoAplique("sharpe", "STOCK") }
        : { label: rotulo("Sharpe"), value: <Cifra tipo="ratio" valor={metrics.sharpe.value} /> },
      { label: rotulo("Caída máxima"), value: <Cifra tipo="porcentaje" valor={metrics.maxDrawdown.value} /> }
    ]} />
    <p className="panel__subtitle">{notaDeLaSimulacion(analysis, { sinCobertura: true, sinFondos: soloAcciones(medidos, assets) })}</p>
  </aside>;
}

/** Lo que acompaña a una simulación. Con `conPeriodo`, también el periodo y la cobertura, para donde no los diga ya el título. */
export function HorizonProvenance({ analysis, assets = [], conPeriodo = true }: { analysis: PortfolioHorizon; assets?: BdbAssetDetail[]; conPeriodo?: boolean }) {
  /* Lo que se queda fuera se dice siempre; por qué, es diagnóstico del asesor. */
  const { seEnsena } = useModoCliente();
  const names = new Map(assets.map((a) => [a.asset_id, a.display_name]));
  const { first_date: desde, last_date: hasta } = analysis.backtest.coverage ?? {};
  /* Sin nada que decir no se pinta la caja: vacía, ocuparía un hueco entre los bloques del panel. */
  if (!conPeriodo && analysis.extensions.length === 0 && analysis.backtest.excluded_assets.length === 0) return null;
  return <div className="panel__subtitle">
    {conPeriodo ? <p>{desde && hasta ? `${oFalta(fecha(desde))} a ${oFalta(fecha(hasta))} · ` : ""}{coberturaDeLaSimulacion(analysis)}.</p> : null}
    {analysis.extensions.length > 0 && <p>Histórico ampliado: los tramos estimados se usan en las métricas, la frontera y la proyección. No son precios reales del activo.</p>}
    {analysis.extensions.map((e) => <p key={e.assetId}>{names.get(e.assetId) ?? e.assetId}: {e.reference} · tramo estimado {oFalta(fecha(e.estimatedFrom))} → {oFalta(fecha(e.estimatedUntil))}.</p>)}
    {analysis.backtest.excluded_assets.map((e) => {
      const quien = `${names.get(e.asset_id) ?? e.asset_id}${seEnsena("calidadInterna") ? ` · ${backtestExclusionLabel(e.reason)}` : ""}`;
      /* Un nombre puede acabar en punto, como «Duro Felguera, S.A.», y en Modo cliente, sin el motivo, la frase no lleva dos (decisión 80, en el papel). */
      return <Aviso key={e.asset_id} tono="aviso">Fuera del cálculo: {quien}{quien.endsWith(".") ? "" : "."} Las cifras y proyecciones corresponden a la parte medida.</Aviso>;
    })}
  </div>;
}

/* B7 (decisión 30-09): sin frontera histórica en el análisis se dibuja la
   estimada por composición con el motivo, en el mismo gráfico; solo si tampoco
   hay estimada posible queda el motivo. Y entonces va como aviso y sin la nota
   de una frontera que no se dibuja. Si la aportación al riesgo sí ha salido
   (más de 40 activos medidos), el aviso lleva a Análisis, que es donde se lee.
   Desde la A-129 la estimada no llega aquí con más de 40 posiciones: lo decide
   el panel, que es quien la calcula. */
export function HorizonFrontier({ analysis, approximate, onVerAnalisis, compacta = false, assets = NO_ASSETS }: {
  analysis: PortfolioHorizon; approximate?: FrontierResult | null; onVerAnalisis?: () => void;
  /** Para nombrar lo que no entra en la frontera. */
  assets?: BdbAssetDetail[];
  /**
   * La versión del lateral de Componer, sobre las cuatro cifras (14-11-2026): más baja, solo con el punto de la cartera
   * y una nota corta; sin frontera que dibujar no dice nada, porque las cifras de debajo siguen valiendo.
   */
  compacta?: boolean;
}) {
  const f = analysis.frontier;
  if (!f && !approximate && compacta) return null;
  /* Lo que se mide y no se puede comprar: entra en las cifras y en el punto de la cartera, no en la curva ni en sus carteras. */
  const nombres = new Map(assets.map((a) => [a.asset_id, a.display_name]));
  const textoFuera = notaDeLoQueNoEntraEnLaFrontera(analysis, (id) => nombres.get(id) ?? id, { hayFrontera: Boolean(f) });
  const notaFuera = textoFuera ? <Aviso tono="nota" titulo="Fuera de la frontera.">{textoFuera}</Aviso> : null;
  if (!f && !approximate) {
    const conAportacion = Boolean(aportacionAlRiesgo(analysis)?.length);
    return <div className="backtest-block"><h3 className="section-label">Frontera eficiente · {analysis.years} años</h3>
      <div role="note">
        <Aviso
          accion={onVerAnalisis && conAportacion ? <Button onClick={onVerAnalisis} size="sm">Ver la aportación en Análisis</Button> : undefined}
          tono="nota"
        >
          {analysis.frontierUnavailableReason ?? "Sin frontera eficiente para esta cartera."}
        </Aviso>
        {notaFuera}
      </div>
    </div>;
  }
  const alto = compacta ? 220 : 300;
  /* El punto de la cartera actual y, fuera del lateral, la de máximo Sharpe y la de mínima volatilidad de la misma frontera, como en la
     «Analítica avanzada» de antes del rediseño (14-11-2026). Son puntos del modelo, no carteras medidas, y la leyenda los nombra. */
  const marcas: OaaFrontierMark[] = f ? [
    ...(f.current ? [{ id: "current", label: analysis.coverageWeightPercent < 99.999 ? "Parte medida" : "Cartera actual", vol: f.current.volatility, ret: f.current.expectedReturn, papel: "cartera" as const, labelled: true }] : []),
    ...(compacta ? [] : [
      { id: "max-sharpe", label: "Máx. Sharpe", vol: f.maxSharpe.volatility, ret: f.maxSharpe.expectedReturn, papel: "serie" as const },
      { id: "min-vol", label: "Mín. volatilidad", vol: f.minVolatility.volatility, ret: f.minVolatility.expectedReturn, papel: "serie" as const, hollow: true }
    ])
  ] : [];
  return <div><h3 className="section-label">{f?.label ?? (approximate ? `Frontera eficiente · ${analysis.years} años · estimada por composición` : `Frontera eficiente · ${analysis.years} años`)}</h3>
    {f ? <OaaFrontierChart frontier={f.frontier.map((p) => ({ vol: p.volatility, ret: p.expectedReturn }))}
      marks={marcas}
      height={alto} rotuloDelEjeY={compacta ? "Rent. anualizada estimada" : undefined} dataQuality={analysis.extensions.length ? "estimated" : "real"}
      dataQualityLabel={analysis.extensions.length ? "Histórico ampliado" : "Precios observados"}
      dataQualityNote="Mismo periodo y activos que las métricas. Rentabilidades y covarianza regularizadas para optimizar; no son la rentabilidad anualizada observada." />
      : approximate ? <ApproximateFrontierChart result={approximate} reason={analysis.frontierUnavailableReason} height={alto} /> : null}
    <p className="panel__subtitle">{compacta
      ? f ? "Rentabilidad y riesgo estimados con regularización; las cifras de debajo son el recorrido medido." : "Estimada por composición, no con series históricas: no sitúa la cartera."
      : f
      ? "La frontera estima riesgo y rentabilidad con regularización; las métricas describen el recorrido de la cartera en el mismo periodo."
      : "Frontera estimada con la rentabilidad y la volatilidad a 3 años de cada posición y correlaciones asumidas por clase de activo, no con series históricas. No sitúa la cartera: sin su serie, ese punto sería una suma de cifras, no una medida."}</p>
    {notaFuera ? <div role="note">{notaFuera}</div> : null}
  </div>;
}

/* Mientras la histórica carga (o si falla), la estimada sale de inmediato en
   el mismo gráfico y se sustituye cuando llega el resultado. Con más de 40
   posiciones no hay estimada que adelantar (A-129): queda el estado o el error. */
function PendingFrontier({ approximate, reason }: { approximate: FrontierResult | null; reason: string }) {
  if (!approximate) return null;
  return <div className="backtest-summary-layout"><div><h3 className="section-label">Frontera eficiente · estimada por composición</h3>
    <ApproximateFrontierChart result={approximate} reason={reason} height={300} /></div></div>;
}

/**
 * La simulación del periodo común. Cuatro formas, según dónde va:
 *
 * - `full`: Simular, entera, con la frontera eficiente.
 * - `frontier`: la frontera y las cuatro cifras juntas.
 * - `metricas`: el lateral de Componer, «Rentabilidad y riesgo»: la frontera en su versión compacta, las cuatro cifras
 *   debajo y el enlace a Análisis, que es donde se lee el detalle.
 * - `frontera`: la frontera del periodo común, sin las cifras: Optimizar antes de calcular, y Análisis → Diversificación
 *   (`FrontierPanel`), donde las cifras ya están en la respuesta de arriba.
 *
 * El 14-11-2026 (Óscar: recuperar los datos de antes del rediseño) la frontera volvió a Simular, a Componer y a Análisis;
 * el rediseño la había dejado solo en Optimizar.
 */
export function PortfolioHorizonPanel({ positions, assets, variant = "full", onVerAnalisis }: {
  positions: readonly HorizonPosition[]; assets?: BdbAssetDetail[]; variant?: "full" | "frontier" | "metricas" | "frontera";
  /** Solo en Diseño: lleva a Análisis, donde se lee la aportación al riesgo cuando no hay frontera que dibujar. */
  onVerAnalisis?: () => void;
}) {
  const { data, error, retry, sinPesos } = usePortfolioHorizon(positions);
  /* A-129: con más de 40 posiciones no se dibuja la frontera estimada por composición. Su extremo es el activo que más
     subió, y crece con el número de activos; lo que sirve ahí es la aportación al riesgo. Se cuentan las posiciones, que
     es lo que se sabe antes de que llegue el cálculo, y los activos medidos nunca son más. Ni se calcula (el gancho
     recibe la lista vacía) ni se enseña la que quedara de antes, que el gancho conserva mientras espera. */
  const sinEstimada = positions.length > TOPE_DE_LA_FRONTERA;
  const calculada = useApproximateFrontier(sinEstimada ? NO_ASSETS : assets ?? NO_ASSETS).result;
  const approximate = sinEstimada ? null : calculada;
  /* La caída desde máximos, con la función común (`core/underwater.ts`) y una sola vez por serie (ANA-31): se
     recalculaba aquí a mano, en cada pintado. */
  const serieDeLaCartera = data?.backtest.portfolio_series;
  const drawdown = useMemo(() => {
    if (!serieDeLaCartera) return undefined;
    const caidas = calculateUnderwaterSeries(serieDeLaCartera.map((punto) => punto.value));
    return serieDeLaCartera.map((punto, indice) => ({ date: punto.date, value: caidas[indice] }));
  }, [serieDeLaCartera]);
  if (variant === "metricas" || variant === "frontera") {
    const titulo = variant === "metricas" ? "Rentabilidad y riesgo" : "Frontera eficiente";
    return <Panel
      acciones={variant === "metricas" && onVerAnalisis ? <Button onClick={onVerAnalisis} size="sm" variant="quiet">Ver el análisis</Button> : undefined}
      className="simulation-panel"
      claseDelCuerpo="stack stack--tight"
      subtitulo={data ? procedenciaDeLaSimulacion(data) : error ? undefined : "Simulación con los pesos de hoy"}
      titulo={titulo}
    >
      {error ? <>
        <AsyncErrorBanner error={error} onRetry={retry} />
        {variant === "frontera" ? <PendingFrontier approximate={approximate} reason={error} /> : null}
      </> : !data && sinPesos ? <p className="panel__subtitle">{SIN_PESOS_NO_HAY_SIMULACION}</p> : !data ? <>
        <p role="status">Calculando el periodo completo…</p>
        {variant === "frontera" ? <PendingFrontier approximate={approximate} reason="calculando la histórica con series reales" /> : null}
      </> : variant === "metricas" ? <>
        <HorizonProvenance analysis={data} assets={assets} conPeriodo={false} />
        <HorizonFrontier analysis={data} approximate={approximate} compacta assets={assets} />
        <HorizonMetrics analysis={data} assets={assets} />
      </> : <HorizonFrontier analysis={data} approximate={approximate} onVerAnalisis={onVerAnalisis} assets={assets} />}
    </Panel>;
  }
  return <Panel
    /* En Análisis, la variante de la frontera, el periodo se elige junto al benchmark: dos mandos para lo
       mismo sobran. */
    acciones={variant === "full" ? <AnalysisPeriodSelect /> : undefined}
    className="simulation-panel portfolio-backtest-panel"
    /* El aire entre los bloques del cuerpo lo pone la pila. La regla de `.simulation-panel` lo daba cuando los bloques
       colgaban de la sección; desde que van dentro del cuerpo, quedaban pegados (el aviso y lo que le sigue). */
    claseDelCuerpo="stack stack--tight"
    subtitulo={data ? procedenciaDeLaSimulacion(data) : error ? undefined : "Simulación con los pesos de hoy"}
    titulo={variant === "full" ? "Simulación histórica y proyección" : "Rentabilidad y riesgo"}
  >
    {error ? <>
      {/* Auditoría 16-10: banner con causa y «Reintentar» (antes un <button> crudo sin type). */}
      <AsyncErrorBanner error={error} onRetry={retry} />
      {variant === "frontier" ? <PendingFrontier approximate={approximate} reason={error} /> : null}
    </> : !data && sinPesos ? <p className="panel__subtitle">{SIN_PESOS_NO_HAY_SIMULACION}</p> : !data ? <>
      <p role="status">Calculando el periodo completo…</p>
      {variant === "frontier" ? <PendingFrontier approximate={approximate} reason="calculando la histórica con series reales" /> : null}
    </> : <>
      <HorizonProvenance analysis={data} assets={assets} conPeriodo={false} />
      {variant === "full" ? <p className="panel__subtitle">El periodo elegido se comparte con las métricas, la comparativa y el informe.</p> : null}
      {variant === "frontier" ? <div className="backtest-summary-layout"><HorizonFrontier analysis={data} approximate={approximate} onVerAnalisis={onVerAnalisis} assets={assets} /><HorizonMetrics analysis={data} assets={assets} /></div> : <>
        <div className="backtest-summary-layout backtest-dashboard">
          <div className="backtest-history-column"><div className="backtest-block backtest-evolution-block">
            <OaaLineChart series={[{ id:"portfolio",label:`${rotuloDeLaSerie(data)}${data.extensions.length ? " · histórico ampliado" : ""}`,values:data.backtest.portfolio_series }]}
              referenceValue={100} height={250} ariaLabel={`Simulación histórica a ${data.years} años`} />
          </div></div>
          <HorizonMetrics analysis={data} assets={assets} />
          <div className="backtest-block backtest-drawdown-block"><h3 className="section-label">Caída máxima · {data.years} años{data.extensions.length ? " · estimado" : ""}</h3>
            <UnderwaterChart series={[{id:"drawdown",label:"Caída máxima",color:"var(--baja)",values:drawdown ?? []}]} height={210} /></div>
          {/* No simula nada: es una fórmula cerrada con la deriva histórica (decisión 3). */}
          <div className="backtest-block backtest-projection-block"><h3 className="section-label">Cono estadístico · {data.years} años{data.extensions.length ? " · estimado" : ""}</h3>
            <OaaMonteCarloChart {...measurementSeries(data.backtest.portfolio_series,data.backtest.frequency)} horizonYears={data.years} height={210} />
          </div>
        </div>
        <HorizonFrontier analysis={data} approximate={approximate} onVerAnalisis={onVerAnalisis} assets={assets} />
        <p className="panel__subtitle">Los episodios de estrés siguientes usan exclusivamente precios observados y sus propias fechas históricas; su peso medido se indica en cada episodio.</p>
        <HistoricalStressCards scenarios={data.backtest.stress_scenarios} assetLabels={Object.fromEntries((assets ?? []).map((a) => [a.asset_id,a.display_name]))} positions={positions} />
      </>}
    </>}
  </Panel>;
}
