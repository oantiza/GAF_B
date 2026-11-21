import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbManualPortfolioSummary } from "../types/bdbAssets";
import { avisosDeComprobar, cifrasDelProveedorEnOtraDivisa } from "../core/medidaDeLaCartera";
import { Panel } from "./ui/Panel";

interface PortfolioValidationPanelProps {
  summary: BdbManualPortfolioSummary | null;
  optimizationAssetCount: number;
  /** Las posiciones y sus fichas: para saber si alguna cifra del proveedor sigue en otra divisa. */
  positions?: readonly BdbManualPortfolioPosition[];
  assets?: readonly BdbAssetDetail[];
}

function getValidationLabel(summary: BdbManualPortfolioSummary): string {
  if (summary.validation_status === "VALID") {
    return "Cartera válida";
  }
  if (summary.validation_status === "UNDER_ALLOCATED") {
    return "Peso por debajo del 100 %";
  }
  if (summary.validation_status === "OVER_ALLOCATED") {
    return "Peso por encima del 100 %";
  }

  return "Cartera vacía";
}

export function PortfolioValidationPanel({ summary, optimizationAssetCount, positions = [], assets = [] }: PortfolioValidationPanelProps) {
  if (!summary) {
    return null;
  }
  /* Lo que está fuera por su serie cotiza y se puede comprar: no va en la misma frase que un índice (decisión 75). */
  const bloqueados = summary.quality_blocked_assets ?? [];
  const noInvertibles = summary.non_investable_assets.filter((assetId) => !bloqueados.includes(assetId));
  const avisos = avisosDeComprobar(summary.warnings, summary.weighted_metrics, cifrasDelProveedorEnOtraDivisa(positions, assets));
  /* DIS-22: por su nombre, como el resto de la pantalla, con el ISIN de apunte. Sin ficha, queda el ISIN. */
  const nombrar = (assetId: string) => {
    const nombre = assets.find((asset) => asset.asset_id === assetId)?.display_name ?? positions.find((position) => position.asset_id === assetId)?.label;
    return nombre && nombre !== assetId ? `${nombre} (${assetId})` : assetId;
  };

  return (
    <Panel claseDelCuerpo="stack stack--tight" titulo="Validación" tituloId="portfolio-validation-title">
      <div className={summary.is_valid ? "portfolio-validation portfolio-validation-ok" : "portfolio-validation"}>
        <strong>{getValidationLabel(summary)}</strong>
        <span>
          {optimizationAssetCount === 1
            ? "1 activo invertible disponible para optimizar"
            : `${optimizationAssetCount} activos invertibles disponibles para optimizar`}
        </span>
      </div>

      {noInvertibles.length > 0 ? (
        <div className="benchmark-notice">
          Fuera del cálculo por ser índices o activos no invertibles: {noInvertibles.map(nombrar).join(", ")}
        </div>
      ) : null}

      {bloqueados.length > 0 ? (
        <div className="benchmark-notice">
          Fuera del cálculo por una incidencia en su serie de precios: {bloqueados.map(nombrar).join(", ")}
        </div>
      ) : null}

      {avisos.length > 0 ? (
        <ul className="portfolio-warnings">
          {avisos.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : (
        <p className="empty-inline">Sin avisos adicionales para esta cartera.</p>
      )}
    </Panel>
  );
}
