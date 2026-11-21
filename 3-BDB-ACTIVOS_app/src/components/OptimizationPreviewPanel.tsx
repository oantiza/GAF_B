import { showPreviewDisclaimers } from "../config/runtimeConfig";
import { CLASS_LABELS, TYPE_LABELS } from "../core/labels";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbOptimizationPreview, BdbOptimizationPreviewExcludedAsset } from "../types/bdbAssets";
import { oFalta, peso } from "../core/formato";
import { VALIDATION_STATUS_LABELS, readableBackendLabel } from "../core/labels";
import {
  avisosDeLaVistaPrevia,
  cifrasDelProveedorEnOtraDivisa,
  metricasPorPosicion,
  universoDeLaComprobacion
} from "../core/medidaDeLaCartera";
import { usePortfolioHorizon } from "../core/usePortfolioHorizon";
import { useClientMode } from "../app/ClientModeContext";
import { KpiStrip } from "./ui/KpiStrip";
import { Panel } from "./ui/Panel";

interface OptimizationPreviewPanelProps {
  preview: BdbOptimizationPreview | null;
  /** Las posiciones y sus fichas: para saber qué deja fuera la simulación y qué cifra no está en euros. */
  positions?: readonly BdbManualPortfolioPosition[];
  assets?: readonly BdbAssetDetail[];
  /** En Optimizar va plegada: es detalle, no el cálculo («primero la respuesta; el detalle, a un clic»). */
  plegable?: boolean;
}

function formatReason(reason: BdbOptimizationPreviewExcludedAsset["reason"]): string {
  if (reason === "NON_INVESTABLE_BENCHMARK") {
    return "Índice o no invertible";
  }
  if (reason === "QUALITY_BLOCKED") {
    return "Incidencia en su serie de precios";
  }
  if (reason === "INVALID_WEIGHT") {
    return "Peso cero o no válido";
  }

  return "Activo no encontrado";
}

const SIN_POSICIONES: readonly BdbManualPortfolioPosition[] = [];
const SIN_ACTIVOS: readonly BdbAssetDetail[] = [];

/**
 * La comprobación previa del paso Optimizar. Solo mira que cada activo exista, pese y sea invertible, y descuenta lo
 * que la simulación deja fuera en cuanto se sabe. **No es el cálculo**: el optimizador hace su propia selección, y lo
 * que entra de verdad lo dice su resultado. Por eso va al final del paso, y por eso no se titula «Qué entra en el
 * cálculo», que sería afirmar lo que no mide.
 */
export function OptimizationPreviewPanel({ preview, positions = SIN_POSICIONES, assets = SIN_ACTIVOS, plegable = false }: OptimizationPreviewPanelProps) {
  const { enabled: clientMode } = useClientMode();
  const { data: horizonte } = usePortfolioHorizon(positions);
  if (!preview) {
    return null;
  }
  const universo = universoDeLaComprobacion(preview, horizonte, formatReason);
  const metricas = metricasPorPosicion(preview.eligible_assets);
  const enOtraDivisa = cifrasDelProveedorEnOtraDivisa(positions, assets);
  const avisos = avisosDeLaVistaPrevia(preview.portfolio_warnings, preview.metrics_available, enOtraDivisa);

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      plegable={plegable}
      subtitulo={`Solo comprueba que cada activo exista, tenga peso y sea invertible${
        horizonte ? `, y descuenta lo que la simulación a ${horizonte.years} años deja fuera` : ""
      }. No es el cálculo de la optimización: lo que entra de verdad lo dice su resultado. No evalúa idoneidad ni es una recomendación personalizada.`}
      titulo="Comprobación previa: activos invertibles con peso"
      tituloId="optimization-preview-title"
    >
      <KpiStrip
        ariaLabel="Comprobación previa"
        items={[
          { label: "Elegibles", value: universo.elegibles.length },
          { label: "Excluidos", value: universo.excluidos.length },
          { label: "Peso total", value: oFalta(peso(preview.total_weight_percent / 100)) },
          { label: "Estado de pesos", value: VALIDATION_STATUS_LABELS[preview.validation_status] ?? readableBackendLabel(preview.validation_status) }
        ]}
      />
      {!clientMode && showPreviewDisclaimers(preview.sourceKind) ? (
      <div className="preview-boundary-note">
        <strong>Métricas locales aproximadas</strong>
        <span>{preview.metrics_boundary.limitations.join(" ")}</span>
      </div>
      ) : null}

      <div className="comprobacion-previa__bloques">
        <div>
          <h3>Activos elegibles</h3>
          {universo.elegibles.length > 0 ? (
            <ul>
              {universo.elegibles.map((asset) => (
                <li key={asset.asset_id}>
                  <span>
                    {asset.display_name}
                    <small>
                      {TYPE_LABELS[asset.instrument_type] ?? readableBackendLabel(asset.instrument_type)} · {CLASS_LABELS[asset.economic_asset_class] ?? readableBackendLabel(asset.economic_asset_class)}
                    </small>
                  </span>
                  <strong>{oFalta(peso(asset.weight_percent / 100))}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="asset-detail-muted">Sin posiciones elegibles.</p>
          )}
        </div>

        <div>
          <h3>Excluidos</h3>
          {universo.excluidos.length > 0 ? (
            <ul>
              {universo.excluidos.map((asset) => (
                <li key={`${asset.asset_id}-${asset.motivo}`}>
                  <span>
                    {asset.display_name}
                    <small>{asset.motivo}{asset.diagnostico && !clientMode ? `: ${asset.diagnostico}` : ""}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="asset-detail-muted">Ningún activo queda fuera.</p>
          )}
        </div>

        {!clientMode ? <>
        <div>
          <h3>Métricas por posición</h3>
          {metricas.length > 0 ? (
            <ul>
              {metricas.map((metrica) => (
                <li key={metrica.clave}>
                  <span>{metrica.etiqueta}</span>
                  <strong>{metrica.con}/{metrica.de}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="asset-detail-muted">Sin posiciones que medir.</p>
          )}
        </div>

        <div>
          <h3>Avisos de calidad</h3>
          {preview.quality_warnings.length > 0 ? (
            <ul>
              {preview.quality_warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="asset-detail-muted">Sin avisos de calidad en los activos elegibles.</p>
          )}
        </div>

        <div>
          <h3>Avisos de cartera</h3>
          {avisos.length > 0 ? (
            <ul>
              {avisos.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="asset-detail-muted">Sin avisos de cartera.</p>
          )}
        </div>
        </> : null}
      </div>
    </Panel>
  );
}
