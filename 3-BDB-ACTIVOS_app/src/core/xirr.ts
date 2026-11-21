/**
 * TIR de flujos con fechas (XIRR) — módulo puro extraído del Comparador
 * patrimonial (ola A2, A2.5) para poder testearlo sin romper Fast Refresh.
 *
 * Garantías: (1) una única convención de año en todo el módulo (365,2425
 * días); (2) toda salida es una raíz VERIFICADA del NPV — si Newton no
 * converge y la bisección no acota, se devuelve null, nunca el último
 * iterado; (3) sin flujos de signo mixto no existe TIR: null.
 */

const YEAR_MS = 365.2425 * 24 * 3600 * 1000;

export function yearsBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / YEAR_MS;
}

export function xirr(flows: { date: Date; amount: number }[]): number | null {
  if (flows.length < 2) return null;
  if (!flows.some((flow) => flow.amount > 0) || !flows.some((flow) => flow.amount < 0)) {
    return null;
  }
  const t0 = flows[0].date;
  // Tolerancia de residuo proporcional al tamaño de los flujos (en €).
  const tolerance = Math.max(1e-6, 1e-9 * flows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0));
  const npv = (rate: number) =>
    flows.reduce((sum, flow) => {
      const years = (flow.date.getTime() - t0.getTime()) / YEAR_MS;
      return sum + flow.amount / Math.pow(1 + rate, years);
    }, 0);
  let rate = 0.1;
  for (let index = 0; index < 80; index += 1) {
    const value = npv(rate);
    const derivative = (npv(rate + 1e-6) - value) / 1e-6;
    if (Math.abs(derivative) < 1e-10) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-8) {
      if (Math.abs(npv(next)) <= tolerance) return next;
      break; // convergió a un punto que no anula el NPV: probar bisección
    }
    rate = next < -0.999 ? -0.5 : next;
  }
  let low = -0.95;
  let high = 5;
  if (npv(low) * npv(high) > 0) return null;
  for (let index = 0; index < 200; index += 1) {
    const middle = (low + high) / 2;
    const value = npv(middle);
    if (Math.abs(value) <= tolerance) return middle;
    if (npv(low) * value < 0) high = middle;
    else low = middle;
  }
  const middle = (low + high) / 2;
  return Math.abs(npv(middle)) <= tolerance * 100 ? middle : null;
}
