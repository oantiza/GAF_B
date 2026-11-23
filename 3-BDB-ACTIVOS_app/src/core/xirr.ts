/**
 * TIR de flujos con fechas (XIRR) — módulo puro extraído del Comparador
 * patrimonial (ola A2, A2.5) para poder testearlo sin romper Fast Refresh.
 *
 * Garantías: (1) una única convención de año en todo el módulo (365,2425
 * días); (2) toda salida es una raíz VERIFICADA del NPV — si Newton no
 * converge y la bisección no acota, se devuelve null, nunca el último
 * iterado; (3) sin flujos de signo mixto no existe TIR: null.
 *
 * H2-09 / N-2 (auditoría del 22-11-2026). Con todos los flujos en la misma
 * fecha no pasa el tiempo y la TIR no está definida: el NPV es la suma de los
 * flujos con cualquier tasa. Si esa suma era cero (1.000 € aportados el mismo
 * día de la fecha final, con 1.000 € de valor final), los dos extremos de la
 * bisección daban 0, el producto no era positivo y el primer punto medio,
 * (−0,95 + 5) / 2 = 2,025, «anulaba» el NPV: un 202,5 %. Ahora los flujos se
 * netean por fecha —el NPV solo depende del neto de cada día— y hacen falta dos
 * fechas con neto de signo distinto; y un extremo de la bisección que ya es raíz
 * se devuelve, en vez de dejar que la bisección se vaya al otro.
 */

const YEAR_MS = 365.2425 * 24 * 3600 * 1000;

export function yearsBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / YEAR_MS;
}

/**
 * Los flujos sumados por fecha, sin las fechas cuyo neto es cero. Un neto que es cero por redondeo (menos de una
 * billonésima de lo que se movió ese día) cuenta como cero. Conserva el orden de la primera aparición de cada fecha.
 */
export function flujosNetosPorFecha(flows: { date: Date; amount: number }[]): { date: Date; amount: number }[] {
  const porFecha = new Map<number, { date: Date; neto: number; bruto: number }>();
  for (const flow of flows) {
    const clave = flow.date.getTime();
    const dia = porFecha.get(clave) ?? { date: flow.date, neto: 0, bruto: 0 };
    dia.neto += flow.amount;
    dia.bruto += Math.abs(flow.amount);
    porFecha.set(clave, dia);
  }
  return [...porFecha.values()]
    .filter((dia) => Math.abs(dia.neto) > 1e-12 * Math.max(1, dia.bruto))
    .map((dia) => ({ date: dia.date, amount: dia.neto }));
}

export function xirr(rawFlows: { date: Date; amount: number }[]): number | null {
  const flows = flujosNetosPorFecha(rawFlows);
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
  const atLow = npv(low);
  const atHigh = npv(high);
  if (Math.abs(atLow) <= tolerance) return low;
  if (Math.abs(atHigh) <= tolerance) return high;
  if (atLow * atHigh > 0) return null;
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
