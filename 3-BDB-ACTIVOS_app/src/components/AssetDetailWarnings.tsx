import { readableBackendLabel, WARNING_SEVERITY_LABELS } from "../core/labels";
import { etiquetaDeAviso, etiquetaDeCodigo } from "../core/glosarioDePantalla";
import type { BdbAssetDetail } from "../types/bdbAssets";

interface AssetDetailWarningsProps {
  asset: BdbAssetDetail;
}

/* Auditoría 14-10 (MEDIA-20a): distintivos y avisos salían con el código del
   backend («PARTIAL_COVERAGE», «MEDIUM»). Ningún código llega a pantalla. */

export function AssetDetailWarnings({ asset }: AssetDetailWarningsProps) {
  return (
    <section className="asset-detail-section" aria-labelledby="asset-detail-quality-title">
      <h2 className="asset-detail-titulo" id="asset-detail-quality-title">Calidad y avisos</h2>
      <div className="asset-detail-flags">
        {asset.quality_flags.map((flag) => (
          <span key={flag}>{etiquetaDeCodigo(flag)}</span>
        ))}
      </div>
      {asset.warnings.length > 0 ? (
        <ul className="asset-detail-warnings">
          {asset.warnings.map((warning) => (
            <li key={`${warning.code}-${warning.asset_id ?? asset.asset_id}`}>
              <strong>{WARNING_SEVERITY_LABELS[warning.severity] ?? readableBackendLabel(warning.severity)}</strong>{" "}
              {etiquetaDeAviso(warning.code)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="asset-detail-muted">Sin avisos adicionales para este activo.</p>
      )}
    </section>
  );
}
