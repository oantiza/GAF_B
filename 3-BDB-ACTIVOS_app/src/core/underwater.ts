/**
 * Calculates the underwater (drawdown) series for a given array of values.
 * Formula: dd_t = V_t / max_{s<=t}(V_s) - 1
 * 
 * If a value is non-finite, it returns NaN for that point but maintains the peak.
 */
export function calculateUnderwaterSeries(values: number[]): number[] {
  if (!values || values.length === 0) return [];

  const drawdowns: number[] = new Array(values.length).fill(0);
  let peak = -Infinity;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      if (v > peak) {
        peak = v;
      }
      if (peak > 0) {
        drawdowns[i] = (v / peak) - 1;
      } else {
        drawdowns[i] = 0;
      }
    } else {
      drawdowns[i] = NaN;
    }
  }

  return drawdowns;
}
