import type { BdbPortfolioDataDiagnostic, BdbPortfolioReportPosition } from "../types/bdbAssets";
import { etiquetaDeCodigo } from "../core/glosarioDePantalla";
import { recuentoEnPantalla, senalDeLoQueQuedaFuera, type FueraDeLaMedida } from "../core/medidaDeLaCartera";
import { Distintivo } from "./ui/Distintivo";
import { Panel } from "./ui/Panel";

interface PortfolioDataDiagnosticProps {
  diagnostic: BdbPortfolioDataDiagnostic;
  /** Lo que la serie deja fuera: el recuento del núcleo no lo sabe, y también lo lee el papel. */
  fuera?: readonly FueraDeLaMedida[];
  posiciones?: readonly BdbPortfolioReportPosition[];
}

function formatFlags(diagnostic: BdbPortfolioDataDiagnostic, fuera: readonly FueraDeLaMedida[], conAvisos: number): string {
  const partes = diagnostic.quality_flags.map((item) => `${etiquetaDeCodigo(item.flag)} (${item.count})`);
  const senal = senalDeLoQueQuedaFuera(fuera);
  if (senal) partes.push(senal);
  if (partes.length > 0) return partes.join(" · ");
  /* «Sin avisos relevantes» con una posición fuera del cálculo o con un aviso en su fila era falso. */
  return conAvisos > 0 ? `${conAvisos} ${conAvisos === 1 ? "posición" : "posiciones"} con avisos en su ficha: se ven en la tabla de composición.` : "Sin avisos relevantes";
}

export function PortfolioDataDiagnostic({ diagnostic, fuera = [], posiciones }: PortfolioDataDiagnosticProps) {
  const recuento = posiciones ? recuentoEnPantalla(posiciones, fuera) : null;
  const conAvisos = recuento?.conAvisos ?? diagnostic.partial_or_warning_positions;
  const conMetricas = recuento?.conMetricas ?? diagnostic.performance_preview_available;
  const items = [
    { label: "Posiciones invertibles", value: diagnostic.investable_positions },
    { label: "Posiciones excluidas", value: diagnostic.excluded_non_investable_positions },
    { label: "Datos enriquecidos", value: `${diagnostic.enriched_positions}/${diagnostic.investable_positions}` },
    { label: "Métricas de rentabilidad y riesgo", value: `${conMetricas}/${diagnostic.investable_positions}` },
    {
      label: "Con resumen de calidad",
      value: `${diagnostic.data_quality_summary_available}/${diagnostic.investable_positions}`
    },
    { label: "Con avisos o datos parciales", value: conAvisos }
  ];

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      estado={<Distintivo tono="interno">Interno</Distintivo>}
      subtitulo={diagnostic.local_only_notice}
      titulo="Diagnóstico de datos"
      tituloId="portfolio-data-diagnostic-title"
    >

      <dl className="portfolio-diagnostic-grid">
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="portfolio-diagnostic-detail">
        <strong>Resumen agregado de calidad</strong>
        <p>{formatFlags(diagnostic, fuera, conAvisos)}</p>
      </div>

      <div className="portfolio-diagnostic-detail">
        <strong>Principales advertencias</strong>
        {diagnostic.top_warnings.length > 0 ? (
          <ul className="rows">
            {diagnostic.top_warnings.map((warning) => (
              <li className="rows__item" key={warning}>
                <span className="rows__label">{warning}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Sin advertencias adicionales para esta cartera.</p>
        )}
      </div>
    </Panel>
  );
}
