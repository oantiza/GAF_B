/** Componentes IBEX 35 (tickers EODHD/Yahoo con sufijo .MC). Lo que la agenda de Mercado promete en
 *  sus títulos; la membresía exacta puede variar con el tiempo. */
export const IBEX35_CODES: ReadonlySet<string> = new Set([
  "ACS.MC", "ACX.MC", "AENA.MC", "AMS.MC", "ANA.MC", "ANE.MC", "BBVA.MC", "BKT.MC",
  "CABK.MC", "CLNX.MC", "COL.MC", "ELE.MC", "ENG.MC", "FDR.MC", "FER.MC", "GRF.MC",
  "IAG.MC", "IBE.MC", "IDR.MC", "ITX.MC", "LOG.MC", "MAP.MC", "MRL.MC", "MTS.MC",
  "NTGY.MC", "PUIG.MC", "RED.MC", "REP.MC", "ROVI.MC", "SAB.MC", "SAN.MC", "SLR.MC",
  "TEF.MC", "UNI.MC", "SCYR.MC"
]);

export function isIbex35(code?: string | null): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  return IBEX35_CODES.has(c) || IBEX35_CODES.has(c.endsWith(".MC") ? c : `${c}.MC`);
}
