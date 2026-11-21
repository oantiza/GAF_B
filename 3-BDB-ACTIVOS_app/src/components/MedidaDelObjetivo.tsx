import type { BdbAssetDetail } from "../types/bdbAssets";
import type { FrontierViewModel } from "../types/portfolioFrontier";
import { fecha, oFalta } from "../core/formato";
import { isPartialFrontier } from "../core/frontierPortfolioCoverage";
import { ventanaEnPalabras } from "../core/glosarioDePantalla";
import { lecturaDelObjetivo, notaDeLaRentabilidadObjetivo, RENTABILIDAD_OBJETIVO, sharpeQueNoAplica } from "../core/notaDeLaPropuesta";
import { TablaDeMetricasComparativas } from "./MetricasComparativas";
import { Aviso } from "./ui/Aviso";

/**
 * Decisiones 61 y 94: lo que se escribe en «Rent. objetivo» es la media de la serie. Aquí se dice qué mide la serie de esa cartera y frente a la
 * actual, con la tabla de la Comparativa de Simular, porque este objetivo no tiene Comparativa. Si no llega a lo pedido, o no se ha podido medir,
 * se avisa: no puede parecer que se cumple.
 */
export function MedidaDelObjetivo({ model, assets = [] }: {
  model: FrontierViewModel;
  /** Para saber si lo medido es una sola acción, cuyo Sharpe no se enseña. */
  assets?: readonly Pick<BdbAssetDetail, "asset_id" | "instrument_type">[];
}) {
  const lectura = lecturaDelObjetivo(model);
  const nota = notaDeLaRentabilidadObjetivo(model, assets);
  if (!lectura || !nota) return null;
  const { medida, actual, frenteALoPedido } = lectura;
  const llega = frenteALoPedido === "lo-pedido" || frenteALoPedido === "por-encima";
  const parte = isPartialFrontier(model);
  const noAplica = sharpeQueNoAplica(model, assets);
  const ventana = ventanaEnPalabras(model.window);
  return (
    <div className="backtest-summary-layout">
      {/* Si llega a lo pedido, una nota; si no llega o no se ha medido, un aviso con la pieza (MAR-21): era el último
          aviso escrito a mano con la clase `notice`. */}
      {llega ? <p className="asset-detail-muted" role="status">{nota}</p> : <Aviso anunciar tono="aviso">{nota}</Aviso>}
      {medida ? (
        <aside className="backtest-results-metrics backtest-comparison-metrics">
          <h3 className="section-label">Medida con la serie · {ventana}</h3>
          <TablaDeMetricasComparativas
            aria={`Medida con la serie a ${ventana}`}
            rotuloA={actual ? (parte ? "Parte incluida" : "Tu cartera") : undefined}
            rotuloB={RENTABILIDAD_OBJETIVO}
            a={actual ?? undefined}
            b={medida}
            sharpeNoAplica={noAplica === "actual" ? "a" : noAplica === "propuesta" ? "b" : false}
          />
          <p className="panel__subtitle">
            {oFalta(fecha(model.coverage.firstDate))} → {oFalta(fecha(model.coverage.lastDate))} · EUR · pesos fijos desde el primer día{model.extensions?.length ? " · con tramos estimados" : ""}.
          </p>
        </aside>
      ) : null}
    </div>
  );
}
