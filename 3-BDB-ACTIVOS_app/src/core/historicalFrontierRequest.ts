import { rotuloDeLoQueNoEntra } from "./assetMapping";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { FrontierRequestInput } from "../adapters/portfolioFrontierAdapter";
import type { FrontierWindow } from "../types/portfolioFrontier";

/**
 * Tope real del backend para una petición de optimización (`CAP_OPTIMIZE_ASSETS`, main.py). Decisiones 40 y 61 (05-11-2026): todos los
 * objetivos salen del motor regularizado, que escala hasta aquí.
 */
export const OPTIMIZER_MAX_ASSETS = 40;

/**
 * Cuántos activos admite la frontera de cada periodo (hallazgo 12, decisión de Óscar del 15-11-2026): la misma proporción
 * entre datos y activos que se aceptó a 3 años, 40 activos con 157 retornos semanales. Es 40 × semanas / 157, a la baja y
 * sin pasar de 40. El servidor lo calcula (`maximo_de_activos_de_la_ventana`, optimization/repository.py) y lo hace
 * cumplir; esta tabla es para decirlo antes de llamar, y
 * `functions_python/tests/test_optimizar_activos_por_ventana.py` falla si deja de decir lo mismo que él.
 */
export const LIMITE_DE_ACTIVOS_POR_PERIODO: Record<FrontierWindow, { semanas: number; maximo: number }> = {
  "1Y": { semanas: 53, maximo: 13 },
  "3Y": { semanas: 157, maximo: 40 },
  "5Y": { semanas: 261, maximo: 40 },
  "10Y": { semanas: 522, maximo: 40 }
};

/**
 * Quién puede entrar en el cálculo y, si no, por qué exactamente.
 *
 * El motivo importa: «No invertible o sin métricas suficientes» metía en el mismo saco
 * un índice no invertible y un ETF perfectamente invertible al que solo le falta la
 * ventana de tres años (auditoría 06-09-2026, revisando el aviso de B1: el iShares
 * Energy Storage & Hydrogen, ACEPTADO y bucket alto, aparecía como «no invertible»
 * porque su proveedor solo publica un año de métricas).
 *
 * `exigeMetricas`: la frontera estimada por composición las necesita; el optimizador, no (ver `buildOptimizerFrontierRequest`).
 */
function frontierEligibility(assets: BdbAssetDetail[], exigeMetricas: boolean): {
  eligible: string[];
  reasonById: Record<string, string>;
} {
  const eligible: string[] = [];
  const reasonById: Record<string, string> = {};
  for (const asset of assets) {
    if (!asset.is_investable || asset.role === "BENCHMARK") {
      /* Decisión 75: Deoleo cotiza. Este aviso lo lee también el cliente. */
      reasonById[asset.asset_id] = rotuloDeLoQueNoEntra(asset, true);
      continue;
    }
    const volatility = asset.metrics?.volatility_3y;
    const annualReturn = asset.metrics?.annualized_return_3y;
    if (exigeMetricas && !(typeof volatility === "number" && volatility > 0 && typeof annualReturn === "number")) {
      reasonById[asset.asset_id] = "Sin métricas a 3 años";
      continue;
    }
    eligible.push(asset.asset_id);
  }
  return { eligible, reasonById };
}

function buildHistoricalFrontierRequest({
  eligibleAssetIds,
  positions,
  riskSlider = 5,
  reasonById = {}
}: {
  eligibleAssetIds: string[];
  positions: BdbManualPortfolioPosition[];
  riskSlider?: number;
  /** Motivo por activo descartado, para que el aviso de la pantalla sea exacto. */
  reasonById?: Record<string, string>;
}): FrontierRequestInput | null {
  const eligible = new Set(eligibleAssetIds);
  const assetIds: string[] = [];

  positions
    .filter((position) => (position.weight_percent || 0) > 0 && eligible.has(position.asset_id))
    .sort((left, right) =>
      (right.weight_percent || 0) - (left.weight_percent || 0)
      || left.asset_id.localeCompare(right.asset_id)
    )
    .forEach((position) => {
      if (!assetIds.includes(position.asset_id) && assetIds.length < OPTIMIZER_MAX_ASSETS) {
        assetIds.push(position.asset_id);
      }
    });

  for (const assetId of eligibleAssetIds) {
    if (assetIds.length >= OPTIMIZER_MAX_ASSETS) break;
    if (!assetIds.includes(assetId)) assetIds.push(assetId);
  }

  if (assetIds.length < 2) return null;

  const selected = new Set(assetIds);
  const entries = positions
    .filter((position) => (position.weight_percent || 0) > 0 && selected.has(position.asset_id))
    .map((position) => [position.asset_id, (position.weight_percent || 0) / 100] as const);
  const totalWeight = entries.reduce((total, [, weight]) => total + weight, 0);
  const currentWeights = totalWeight > 0
    ? Object.fromEntries(entries.map(([assetId, weight]) => [assetId, weight / totalWeight]))
    : undefined;
  const portfolioWeightsPercent: Record<string, number> = {};
  positions.forEach((position) => {
    if (Number.isFinite(position.weight_percent) && position.weight_percent > 0) {
      portfolioWeightsPercent[position.asset_id] = (portfolioWeightsPercent[position.asset_id] ?? 0) + position.weight_percent;
    }
  });
  const selectionExclusions = Object.keys(portfolioWeightsPercent).filter((id) => !selected.has(id)).map((assetId) => ({
    assetId,
    reasonLabel: eligible.has(assetId)
      ? `Límite de ${OPTIMIZER_MAX_ASSETS} activos por cálculo`
      : reasonById[assetId] ?? "Sin ficha cargada en la fuente activa"
  }));

  return {
    assetIds,
    portfolioWeightsPercent,
    selectionExclusions,
    currentWeights,
    window: "3Y",
    objective: "TARGET_RISK",
    riskTargetMode: "FRONTIER_PERCENTILE",
    riskSlider,
    expectedReturnModel: "HISTORICAL_SHRINKAGE"
  };
}

/**
 * Construye la misma petición histórica que ve el usuario en Riesgo y optimización.
 * Los pesos se renormalizan tras descartar activos no invertibles o sin métricas.
 */
export function buildDisplayedHistoricalFrontierRequest({
  assets,
  positions
}: {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
}): FrontierRequestInput | null {
  const { eligible, reasonById } = frontierEligibility(assets, true);
  return buildHistoricalFrontierRequest({ eligibleAssetIds: eligible, positions, reasonById });
}

/**
 * Petición del panel de optimización: las mayores por peso entre las invertibles, acotadas
 * al tope del motor. El objetivo y sus parámetros los pone el panel encima; aquí solo se
 * resuelve qué activos entran y con qué pesos.
 *
 * Decisión 40 (05-11-2026): no se exigen métricas a 3 años. El servidor calcula con la serie
 * y deja fuera, con su motivo, lo que no cubre la ventana, igual que Simular. Exigirlas aquí
 * dejaba fuera a un fondo con la serie entera (el Goldman de la muestra, en la base nueva):
 * con otros activos, Optimizar y Simular daban otra cartera.
 */
export function buildOptimizerFrontierRequest({
  assets,
  positions,
  riskSlider = 5
}: {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
  riskSlider?: number;
}): FrontierRequestInput | null {
  const { eligible, reasonById } = frontierEligibility(assets, false);
  return buildHistoricalFrontierRequest({
    eligibleAssetIds: eligible,
    positions,
    riskSlider,
    reasonById
  });
}
