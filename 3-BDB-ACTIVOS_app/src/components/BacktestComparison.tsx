import { usePortfolioHorizon } from "../core/usePortfolioHorizon";
import { SIN_PESOS_NO_HAY_SIMULACION } from "../core/textoDeAusencia";
import { useState } from "react";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { PortfolioOptimizationApplyContext } from "../core/portfolioOptimizationDiff";
import { oFalta, peso } from "../core/formato";
import { OaaLineChart } from "../charts/oaa";
import { SegmentedControl } from "./ui/SegmentedControl";
import { AnalysisPeriodSelect } from "./PortfolioHorizonPanel";
import { Aviso } from "./ui/Aviso";
import { Panel } from "./ui/Panel";
import { fraseDeLaEquiponderadaSinLoQueNoSePuedeComprar, fraseDelMaximoSinLoQueNoSePuedeComprar, rotuloDeLaSerie } from "../core/medidaDeLaCartera";
import { notaDelMaximoSharpe } from "../core/internalPortfolioReport";
import { fraseDelEncogimiento } from "../core/notaDeLaPropuesta";
import { TablaDeMetricasComparativas } from "./MetricasComparativas";

export function BacktestComparison({ positions, assets }: { positions: BdbManualPortfolioPosition[]; assets: BdbAssetDetail[];
  onApplyWeights?: (weights: Record<string,number>, context?: PortfolioOptimizationApplyContext) => void }) {
  const { data, error, sinPesos } = usePortfolioHorizon(positions);
  /* Sin máximo Sharpe —más de 40 activos medidos, o una frontera que no se resuelve— la vista abre en lo que sí
     puede enseñar. Lo que elija el asesor manda después. */
  const [elegida, setElegida] = useState<"equal" | "optimal" | null>(null);
  const target = elegida ?? (data && !data.maxSharpe ? "equal" : "optimal");
  const proposed = target === "equal" ? data?.equalWeight : data?.maxSharpe;
  /* El tope lo decide el servidor según el número de activos: se escribe el que ha aplicado, no uno de memoria. */
  const tope = data?.frontier?.methodologyV2?.weightBounds?.[1];
  const label = target === "equal"
    ? "Equiponderada"
    : typeof tope === "number" && tope < 1 ? `Máx. Sharpe (máx. ${oFalta(peso(tope))} por activo)` : "Máx. Sharpe";
  const a=data?.backtest.metrics; const b=proposed?.metrics;
  /* Decisión 95: la nota es la misma que la del informe interno, que añade esta frase aparte, como aquí: dentro de la nota saldría dos veces. */
  const encogimiento = fraseDelEncogimiento(data?.frontier, assets);
  /* La frontera solo usa lo que se puede comprar (15-11-2026): la cartera de Máximo Sharpe no lleva lo apartado, y se dice. */
  const nombres = new Map(assets.map((x) => [x.asset_id, x.display_name]));
  const sinLoApartado = data ? fraseDelMaximoSinLoQueNoSePuedeComprar(data, (id) => nombres.get(id) ?? id) : null;
  const igualSinLoApartado = data ? fraseDeLaEquiponderadaSinLoQueNoSePuedeComprar(data, (id) => nombres.get(id) ?? id) : null;
  return <Panel
    acciones={<>
      <SegmentedControl label="Alternativa" value={target} onChange={setElegida}
        options={[{id:"optimal",label:"Máx. Sharpe"},{id:"equal",label:"Equiponderada"}]} />
      <AnalysisPeriodSelect />
    </>}
    className="simulation-panel"
    rotulo="Vista táctica"
    titulo="Comparativa"
  >
    {/* El fallo lo cuenta una vez el panel de la simulación, que va justo encima: aquí solo se dice que sin ella
        no hay qué comparar. */}
    {!data ? (error
      ? <p className="panel__subtitle">Sin simulación no hay comparativa: el motivo está arriba, en «Simulación histórica y proyección».</p>
      : sinPesos ? <p className="panel__subtitle">{SIN_PESOS_NO_HAY_SIMULACION}</p>
      : <p role="status">Calculando la comparativa del periodo…</p>)
    : !proposed ? <div role="note"><Aviso tono="nota"><span className="stack stack--tight">
        {target === "equal"
          ? <span>Ninguna posición se puede comprar: no hay cartera equiponderada con la que comparar.</span>
          : <><span>Sin frontera no hay cartera de máximo Sharpe con la que comparar.</span>
            {data.frontierUnavailableReason ? <span>{data.frontierUnavailableReason}</span> : null}</>}
      </span></Aviso></div>
    : <>
      <div className="backtest-summary-layout backtest-comparison-layout">
        {/* Un solo hijo de la rejilla: el gráfico devuelve también su leyenda, y cada uno ocupaba una celda. */}
        <div>
          <OaaLineChart height={250} referenceValue={100} ariaLabel={`Comparativa ${data.years} años`}
            series={[{id:"actual",label:rotuloDeLaSerie(data),papel:"cartera",values:data.backtest.portfolio_series},
                     {id:"proposed",label,papel:"serie",values:proposed.portfolio_series}]} />
        </div>
        <aside className="backtest-results-metrics backtest-comparison-metrics"><h3 className="section-label">Métricas comparativas · {data.years} años{data.extensions.length ? " · estimado" : ""}</h3>
          <TablaDeMetricasComparativas aria="Comparativa de métricas" rotuloA={rotuloDeLaSerie(data)} rotuloB={label} a={a} b={b} conPalabra />
        </aside>
      </div>
      <p className="panel__subtitle">Mismos activos y fechas que la simulación histórica. {data.extensions.length ? "Incluye tramos estimados con referencias. " : ""}
        {target === "optimal" ? `Comparación retrospectiva: los pesos se optimizan usando este mismo periodo; no mide resultados fuera de muestra. ${notaDelMaximoSharpe([{ horizon: data }])}${encogimiento ? ` ${encogimiento}` : ""}${sinLoApartado ? ` ${sinLoApartado}` : ""}` : `Los activos que se pueden comprar, con pesos iguales.${igualSinLoApartado ? ` ${igualSinLoApartado}` : ""}`}</p>
    </>}
  </Panel>;
}
