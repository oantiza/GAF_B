/**
 * Pipeline COMPARTIDO del informe de cartera (S6b, P6 — decisión 27-07:
 * deduplicar sin tocar la navegación).
 *
 * Antes, XrayPage y PortfolioReportPage llevaban 22 líneas byte-idénticas
 * (petición del look-through + huella de la frontera) y cada una repetía el
 * pipeline de previews con el perfil "RISK_5" incrustado a mano. Dos copias =
 * dos sitios donde arreglar cada fallo y un perfil hardcodeado por duplicado.
 */
import { useMemo } from "react";
import type { AssetDataSource } from "../types/assetDataSource";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbPortfolioLookThrough
} from "../types/bdbAssets";
import { buildDisplayedHistoricalFrontierRequest } from "./historicalFrontierRequest";
import { buildPortfolioLookThrough } from "./holdingsLookthrough";
import { checkPortfolioFeasibility, type PortfolioFeasibilityCheck } from "./portfolioConstraints";
import { RISK_PROFILE_CONTRACTS } from "./riskProfilePreview";
import { useAsyncData } from "./useAsyncData";

/** Perfil de referencia del informe local. ÚNICO sitio donde vive el valor. */
export const REPORT_RISK_PROFILE_ID = "RISK_5";

const EMPTY_LOOK_THROUGH: BdbPortfolioLookThrough = {
  rows: [],
  equities: { rows: [], identified_weight_percent: 0, equity_exposure_percent: 0, unclassified_funds: [] },
  fund_positions: 0,
  covered_funds: 0,
  direct_positions: 0,
  seen_weight_percent: 0,
  fund_portfolios: [],
  warnings: []
};

/**
 * Look-through + huella de la frontera mostrada: las 22 líneas que estaban
 * repetidas. `ready` reproduce la condición original de ambos montajes
 * (report listo, activos y posiciones presentes).
 */
export function useReportLookThrough(options: {
  dataSource: AssetDataSource;
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  ready: boolean;
}) {
  const { dataSource, positions, assets, ready } = options;
  const displayedFrontierRequest = useMemo(
    () => buildDisplayedHistoricalFrontierRequest({ assets, positions }),
    [assets, positions]
  );
  const lookThroughLoad = useAsyncData(
    async () => {
      if (!dataSource.getAssetHoldings) {
        return EMPTY_LOOK_THROUGH;
      }
      return buildPortfolioLookThrough({
        positions,
        assets,
        loadHoldings: dataSource.getAssetHoldings,
        // Ola 3b: una sola llamada batch cuando la fuente la ofrece.
        loadHoldingsMany: dataSource.getAssetHoldingsMany
      });
    },
    [assets, dataSource, positions],
    { enabled: ready, initialData: null }
  );
  const isLookThroughPending = Boolean(ready && !lookThroughLoad.data && !lookThroughLoad.error);
  return { displayedFrontierRequest, lookThroughLoad, isLookThroughPending };
}

/**
 * La viabilidad que imprime el informe, con el perfil de referencia aplicado una vez. Los candados los pone quien los tiene: el
 * Constructor sí, el X-Ray no.
 */
export function viabilidadDelInforme(options: {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  lockedWeights?: Record<string, number>;
}): PortfolioFeasibilityCheck {
  const { positions, assets, lockedWeights } = options;
  const selectedRiskProfile = RISK_PROFILE_CONTRACTS.find(
    (profile) => profile.risk_profile_id === REPORT_RISK_PROFILE_ID
  );
  return checkPortfolioFeasibility({ assets, positions, lockedWeights, selectedRiskProfile });
}
