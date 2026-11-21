import { RISK_FREE_RATE } from "./quantConfig";

export interface PortfolioVolatilityInput {
  assetClass: string;
  volatility?: number;
  weight: number;
}

type UsablePortfolioVolatilityInput = PortfolioVolatilityInput & { volatility: number };

const roundMetric = (value: number) => Number(value.toFixed(4));

/**
 * Correlación supuesta entre clases cuando no hay series: misma clase 0,75
 * (también RV-RV); RV frente a RF o monetario 0,05; RF frente a monetario 0,6;
 * el resto 0,3.
 */
export function assumedAssetClassCorrelation(a: string, b: string): number {
  if (a === b) return 0.75;
  const eq = (c: string) => c === "EQUITY";
  const fi = (c: string) => c === "FIXED_INCOME" || c === "MONEY_MARKET";
  if ((eq(a) && fi(b)) || (fi(a) && eq(b))) return 0.05;
  if (fi(a) && fi(b)) return 0.6;
  return 0.3;
}

export function estimatePortfolioVolatility(inputs: PortfolioVolatilityInput[]): {
  value?: number;
  coverage: number;
} {
  const positiveInputs = inputs.filter((input) => Number.isFinite(input.weight) && input.weight > 0);
  const totalWeight = positiveInputs.reduce((sum, input) => sum + input.weight, 0);
  const usable = positiveInputs.filter((input): input is UsablePortfolioVolatilityInput =>
    typeof input.volatility === "number" && Number.isFinite(input.volatility) && input.volatility > 0
  );
  const contributingWeight = usable.reduce((sum, input) => sum + input.weight, 0);

  if (totalWeight <= 0 || contributingWeight <= 0) {
    return { value: undefined, coverage: totalWeight > 0 ? 0 : 0 };
  }

  const normalized = usable.map((input) => ({ ...input, weight: input.weight / contributingWeight }));
  let variance = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = 0; j < normalized.length; j += 1) {
      const left = normalized[i];
      const right = normalized[j];
      const rho = i === j ? 1 : assumedAssetClassCorrelation(left.assetClass, right.assetClass);
      variance += left.weight * right.weight * rho * left.volatility * right.volatility;
    }
  }

  return {
    value: roundMetric(Math.sqrt(Math.max(variance, 0))),
    coverage: contributingWeight / totalWeight
  };
}

export function estimatePortfolioSharpe(
  annualizedReturn: number | undefined,
  volatility: number | undefined,
  riskFreeRate = RISK_FREE_RATE
): number | undefined {
  if (
    typeof annualizedReturn !== "number" ||
    typeof volatility !== "number" ||
    !Number.isFinite(annualizedReturn) ||
    !Number.isFinite(volatility) ||
    volatility <= 0
  ) {
    return undefined;
  }
  return roundMetric((annualizedReturn - riskFreeRate) / volatility);
}
