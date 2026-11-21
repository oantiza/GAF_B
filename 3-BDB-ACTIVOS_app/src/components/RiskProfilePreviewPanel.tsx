import { showPreviewDisclaimers } from "../config/runtimeConfig";
import type {
  BdbRiskProfileContract,
  BdbRiskProfileId,
  BdbRiskProfilePreview,
  BdbRiskProfilePreviewExcludedAsset
} from "../types/bdbAssets";
import { VALIDATION_STATUS_LABELS, humanizeKeys, readableBackendLabel } from "../core/labels";
import { ETIQUETAS_DE_METRICA, textoEnPantalla } from "../core/glosarioDePantalla";
import { useClientMode } from "../app/ClientModeContext";
import { KpiStrip } from "./ui/KpiStrip";
import { Panel } from "./ui/Panel";

interface RiskProfilePreviewPanelProps {
  /** `null` mientras nadie haya elegido perfil (decisión 14): no hay nada que enseñar de ningún nivel. */
  preview: BdbRiskProfilePreview | null;
  riskProfiles: BdbRiskProfileContract[];
  selectedProfileId: BdbRiskProfileId | null;
  onProfileChange: (profileId: BdbRiskProfileId | null) => void;
}

function formatReason(reason: BdbRiskProfilePreviewExcludedAsset["reason"]): string {
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

export function RiskProfilePreviewPanel({
  preview,
  riskProfiles,
  selectedProfileId,
  onProfileChange
}: RiskProfilePreviewPanelProps) {
  const { enabled: clientMode } = useClientMode();

  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      className="risk-profile-preview"
      /* Rediseño del 14-11-2026: su procedencia dice en una frase en qué se diferencia del perfil de la propuesta, el de la
         banda de arriba (DIS-11 sigue abierta: qué hace el generador con el perfil lo decide Óscar). */
      subtitulo={`Informativo: lo elige el asesor para describir qué cabe esperar de un perfil, y ninguno viene puesto. No es el perfil de la propuesta, el de los datos de arriba, que se guarda con ella y se compara con el mercado objetivo.${preview?.disclaimer ? ` ${preview.disclaimer}` : ""}`}
      titulo="Perfil de riesgo"
      tituloId="risk-profile-preview-title"
    >

      <label className="risk-profile-selector">
        <span>Perfil</span>
        <select
          value={selectedProfileId ?? ""}
          onChange={(event) => onProfileChange(event.target.value ? (event.target.value as BdbRiskProfileId) : null)}
        >
          <option value="">Sin elegir</option>
          {riskProfiles.map((profile) => (
            <option key={profile.risk_profile_id} value={profile.risk_profile_id}>
              {profile.risk_profile_label}
            </option>
          ))}
        </select>
      </label>

      {preview ? (
      <>
      <KpiStrip
        ariaLabel="Perfil de riesgo"
        items={[
          { label: "Nivel", value: `${preview.selected_profile.level}/10` },
          { label: "Horizonte", value: preview.selected_profile.indicative_time_horizon },
          { label: "Invertibles", value: preview.investable_position_count },
          { label: "Excluidos", value: preview.excluded_assets.length },
          { label: "Estado de pesos", value: VALIDATION_STATUS_LABELS[preview.validation_status] ?? readableBackendLabel(preview.validation_status) }
        ]}
      />
      {!clientMode && showPreviewDisclaimers(preview.sourceKind) ? (
      <div className="preview-boundary-note">
        <strong>Métricas locales aproximadas</strong>
        <span>{preview.metrics_boundary.limitations.join(" ")}</span>
      </div>
      ) : null}

      <div className="optimization-preview-grid">
        <div>
          <h3>Señales informativas</h3>
          <ul>
            {preview.risk_signals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Datos disponibles</h3>
          <p>
            {preview.portfolio_metrics_available.length > 0
              ? humanizeKeys(preview.portfolio_metrics_available, ETIQUETAS_DE_METRICA)
              : "Sin métricas disponibles"}
          </p>
        </div>

        <div>
          <h3>Datos faltantes</h3>
          <p>
            {preview.portfolio_metrics_missing.length > 0
              ? humanizeKeys(preview.portfolio_metrics_missing, ETIQUETAS_DE_METRICA)
              : "No falta ninguna métrica básica"}
          </p>
        </div>

        <div>
          <h3>Restricciones informativas</h3>
          <ul>
            {preview.selected_profile.informative_constraints.map((constraint) => (
              <li key={constraint}>{constraint}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Avisos de datos</h3>
          {preview.data_warnings.length > 0 ? (
            <ul>
              {preview.data_warnings.map((warning) => (
                <li key={warning}>{textoEnPantalla(warning)}</li>
              ))}
            </ul>
          ) : (
            <p className="empty-inline">Sin avisos adicionales.</p>
          )}
        </div>

        <div>
          <h3>Exclusiones</h3>
          {preview.excluded_assets.length > 0 ? (
            <ul>
              {preview.excluded_assets.map((asset) => (
                <li key={`${asset.asset_id}-${asset.reason}`}>
                  <span>{asset.display_name}</span>
                  <strong>{formatReason(asset.reason)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-inline">Ninguna posición queda excluida.</p>
          )}
        </div>
      </div>

      <p className="risk-profile-disclaimer">{preview.serious_evaluation_notice}</p>
      </>
      ) : null}
    </Panel>
  );
}
