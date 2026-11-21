export interface CoveredRateInput {
  amount: number;
  rate: number | null | undefined;
}

export interface CoveredRateSummary {
  totalAmount: number;
  coveredAmount: number;
  coverageRatio: number;
  weightedTotal: number;
  weightedAverage: number | null;
}

export function summarizeCoveredRate(inputs: CoveredRateInput[]): CoveredRateSummary {
  let totalAmount = 0;
  let coveredAmount = 0;
  let weightedTotal = 0;

  for (const input of inputs) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) continue;
    totalAmount += input.amount;
    if (typeof input.rate !== "number" || !Number.isFinite(input.rate)) continue;
    coveredAmount += input.amount;
    weightedTotal += input.amount * input.rate;
  }

  return {
    totalAmount,
    coveredAmount,
    coverageRatio: totalAmount > 0 ? coveredAmount / totalAmount : 0,
    weightedTotal,
    weightedAverage: coveredAmount > 0 ? weightedTotal / coveredAmount : null
  };
}
