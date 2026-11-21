import { avisosDePantalla, type CifraEnOtraDivisa } from "../core/medidaDeLaCartera";
import type { BdbPortfolioReport } from "../types/bdbAssets";
import { Distintivo } from "./ui/Distintivo";
import { Panel } from "./ui/Panel";

interface PortfolioReportWarningsProps {
  report: BdbPortfolioReport;
  /** El peso que cubre la simulación, de 0 a 100, cuando ya se conoce. */
  pesoMedidoPct?: number;
  /** Lo único que puede quedar sin convertir a euros: cifras del proveedor en otra divisa. */
  enOtraDivisa?: readonly CifraEnOtraDivisa[];
  /** Los que ya salen en el panel de arriba: la misma frase, unos píxeles más abajo, no dice nada. */
  yaDichos?: readonly string[];
}

export function PortfolioReportWarnings({ report, pesoMedidoPct, enOtraDivisa, yaDichos = [] }: PortfolioReportWarningsProps) {
  const hasMissingMetrics = report.positions.some((position) =>
    position.quality_flags.includes("MISSING_QUANT_METRICS") || position.quality_flags.includes("MISSING_METRICS")
  );
  const avisos = avisosDePantalla(report.warnings, report.summary.weighted_metrics, pesoMedidoPct, enOtraDivisa);
  const warnings = (hasMissingMetrics ? [...avisos, "Hay activos sin métricas cuantitativas completas."] : avisos).filter(
    (aviso) => !yaDichos.includes(aviso)
  );

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      estado={<Distintivo tono="interno">Interno</Distintivo>}
      subtitulo="Lo que hay que saber de los datos antes de entregar un informe"
      titulo="Avisos y calidad del dato"
      tituloId="report-warnings-title"
    >
      {warnings.length > 0 ? (
        <ul className="report-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : (
        <p className="empty-inline">Sin avisos adicionales sobre la calidad de los datos.</p>
      )}
    </Panel>
  );
}
