import type { FrontierRequestInput } from "../adapters/portfolioFrontierAdapter";
import type { FrontierViewModel } from "../types/portfolioFrontier";

export function frontierPortfolioCoverage(input: FrontierRequestInput, model: FrontierViewModel): FrontierViewModel["portfolioCoverage"] {
  const weights = input.portfolioWeightsPercent ?? Object.fromEntries(
    Object.entries(input.currentWeights ?? {}).map(([id, weight]) => [id, weight * 100])
  );
  const positions = Object.entries(weights).filter(([, weight]) => Number.isFinite(weight) && weight > 0);
  if (!positions.length) return undefined;
  const reasons = new Map([
    ...(input.selectionExclusions ?? []).map((item) => [item.assetId, item.reasonLabel] as const),
    ...(model.excluded ?? []).map((item) => [item.assetId, item.reasonLabel] as const)
  ]);
  const included = new Set(input.assetIds.filter((id) => !reasons.has(id)));
  const excluded = positions.filter(([id]) => !included.has(id)).map(([assetId, weightPercent]) => ({
    assetId, weightPercent, reasonLabel: reasons.get(assetId) ?? "Fuera de la selección del cálculo"
  }));
  const total = positions.reduce((sum, [, weight]) => sum + weight, 0);
  return {
    requested: positions.length, included: positions.length - excluded.length,
    weightPercent: (total - excluded.reduce((sum, item) => sum + item.weightPercent, 0)) / total * 100,
    excluded
  };
}

export function isPartialFrontier(model: FrontierViewModel): boolean {
  return (model.portfolioCoverage?.excluded.length ?? 0) > 0 || model.insufficientCoverage;
}
