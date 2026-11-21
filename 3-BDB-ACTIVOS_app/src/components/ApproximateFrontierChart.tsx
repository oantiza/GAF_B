import type { FrontierResult } from "../core/frontier";
import { APPROXIMATE_FRONTIER_BADGE, approximateFrontierBadge, concaveFrontierEnvelope } from "../core/frontierPresentation";
import { OaaFrontierChart, type OaaFrontierMark } from "../charts/oaa";

/**
 * B7 (decisión 30-09): la frontera estimada por composición se dibuja con el
 * MISMO gráfico que la histórica para que, cuando esta llegue, solo cambie la
 * curva y el distintivo, no el marco. La frontera, continua (lo dice el distintivo, no el trazo).
 * El sello del gráfico es corto; el motivo completo va en la línea de pie
 * («Frontera estimada por composición · motivo»), que sí tiene sitio.
 *
 * Dibuja la curva y los activos, y no sitúa la cartera: ese punto sería la suma ponderada de sus rentabilidades y una
 * volatilidad con correlaciones asumidas, y sin serie no hay cifra de la cartera (decisión 36). El papel tiene su dibujo.
 */
export function ApproximateFrontierChart({
  result,
  reason,
  note,
  height = 340,
  extraMarks = [],
  frontierLabel = "Frontera eficiente",
  assetsLabel = "Activos de la cartera",
  assetsColor = "var(--borde-control)",
  ariaLabel = "Frontera eficiente estimada por composición: riesgo y rentabilidad con la frontera y los activos de la cartera."
}: {
  result: FrontierResult;
  /** Motivo por el que no se enseña la histórica (va en la línea de pie). */
  reason?: string;
  /** Nota de calidad del dato (frecuencia de las métricas). */
  note?: string;
  height?: number;
  /** Marcas adicionales (máx. Sharpe, mín. volatilidad) en la vista de Análisis. */
  extraMarks?: OaaFrontierMark[];
  frontierLabel?: string;
  assetsLabel?: string;
  /** EN RETIRADA: el color de los activos lo decide su papel (contexto, en gris); ya no se pinta el que se pase. */
  assetsColor?: string;
  ariaLabel?: string;
}) {
  const frontier = concaveFrontierEnvelope(result.frontier, (p) => p.vol, (p) => p.ret);
  return (
    <>
      <OaaFrontierChart
        frontier={frontier.map((point) => ({ vol: point.vol, ret: point.ret }))}
        assets={result.assets.map((asset) => ({ id: asset.id, label: asset.name, vol: asset.vol, ret: asset.ret }))}
        marks={extraMarks}
        height={height}
        frontierLabel={frontierLabel}
        assetsLabel={assetsLabel}
        assetsColor={assetsColor}
        ariaLabel={ariaLabel}
        dataQuality="estimated"
        dataQualityLabel={APPROXIMATE_FRONTIER_BADGE}
        dataQualityNote={note}
      />
      <p className="panel__subtitle frontier-approximate-caption">{approximateFrontierBadge(reason)}</p>
    </>
  );
}
