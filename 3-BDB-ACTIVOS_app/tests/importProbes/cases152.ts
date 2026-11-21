// Copiado de scratchpad/informe1016/review5_fe/probe (cases152.ts) para la batería de
// aceptación de la sexta pasada (las 239 sondas con el juez estricto).
// Las 152 sondas de la quinta pasada (87 del arreglador + 65 de la revisión 4),
// con las verdades de probe5pass/runner152.ts, sin cambios. Los .xlsx X60-X65
// se generan como ficheros .xlsx reales y entran por el lector de ficheros de
// cada versión (master: primera hoja en bruto; 5.ª: todas las hojas y formato).
import { c as c35 } from "./cases35";
import { c as c52 } from "./cases52";
import { cases as casesNew } from "./casesReview4";
import type { ProbeCase, SheetDef, Truth } from "./harness";

const LU = "LU1234567891", IE = "IE0098765432", IEW = "IE00B4L5Y983", XS = "XS1234567891";
const two = { [LU]: 80000, [IE]: 120000 };
const usd = { [LU]: 80000, [IE]: 7512.09 };
const usdW = { [LU]: 80000, [IEW]: 7512.09 };
const truth87: Record<string, Truth> = {
  E1: usd, E2: two, E2b: two, E2c: two, E3: usd, E4: usd, E4b: usd, E5: two, E5b: two, E6: two,
  E7: { [LU]: 1000, AAPL: 500, "FUND-1": 250 }, E7b: { [LU]: 1000, AAPL: 500, "FUND-1": 250 }, E8: two,
  E9: two, E10: usd, E11: two, E12: { [LU]: 80000, AAPL: 500, "FUND-1": 250 }, E13: two, E14: two,
  F1: { XS1234567891: 80000, XS0098765432: 120000 }, F1b: two, F1c: two, F2: two,
  F3: { [LU]: 80000, "PRIVADO-1": 45000 }, F4: { [IEW]: 7512.09, [LU]: 80000 }, F5: two, F6: two, F7: two, F8: two,
  P3a: two, P3b: usd, P3c: usd, P4: two, P5: two,
  ANDBANK: { LU0289214628: 80000, LU2222028099: 120000 },
  R1a: usd, R1b: { [LU]: 80000, [IE]: null }, R1c: { [LU]: 80000, [IE]: null }, R1d: usd, R1e: usd, R2a: usd,
  R2b: { [LU]: 80000, [IE]: 7512.09 }, R3a: usdW, R3b: usdW, R3c: usdW, R3d: usdW, R3e: usdW, R3f: usdW,
  R4a: two, R4b: two, R4c: two, R4d: two, R4e: two, R5a: two, R5b: two,
  R6a: usd, R6b: usd, R6c: usd, R6d: { [LU]: null, [IE]: null }, R6e: usd,
  R7a: usdW, R7b: usdW, R7c: usd,
  R8a: two, R8b: two, R8c: two, R8d: two, R8e: { [LU]: 80000, AAPL: 500, [IE]: 120000 }, R8f: two, R8g: two,
  R9a: { [LU]: 80000, [IE]: null, [XS]: 120000 }, R9b: two, R9c: { [LU]: null, [IE]: 120000, [XS]: 5000 },
  R10a: two, R11a: { [LU]: 80000, [IE]: 120000, [XS]: null }, R11b: { [LU]: 80000, [IE]: 120000, [XS]: 1000 },
  R12a: usd, R12b: two,
  X1: { [LU]: 80000, "PRIVADO-1": 45000 }, X2: { [LU]: 80000, "PRIVADO-1": 45000 },
  X3: { [LU]: 80000, "PRIVADO-1": 45000, "fund-1": 1000 }, X4: two, X5: { [LU]: 80000, "fund-1": 5000 },
  X6: { [LU]: 80000, "PRIVADO-1": 45000 }, X7: two, X8: { AAPL: 1500, MSFT: 1000 }, X9: two
};

const xlsxDefs: Record<string, SheetDef[]> = {
  X60: [
    { name: "Cuenta 1", rows: [["Producto", "ISIN", "Contravalor EUR"], ["Fondo A", LU, 80000]] },
    { name: "Cuenta 2", rows: [["Producto", "ISIN", "Contravalor EUR"], ["ETF B", IE, 120000]] }
  ],
  X61: [
    { name: "Resumen", rows: [["Tipo", "Importe"], ["FONDOS", 80000], ["ETF", 120000]] },
    { name: "Posiciones", rows: [["Producto", "ISIN", "Contravalor EUR"], ["Fondo A", LU, 80000], ["ETF B", IE, 120000]] }
  ],
  X62: [
    {
      name: "Posiciones",
      rows: [["Producto", "ISIN", "Valor de mercado"], ["Fondo A", LU, 80000], ["ETF B", IE, 8736]],
      fmt: { C2: '#,##0.00 "€"', C3: '"$"#,##0.00' }
    }
  ],
  X63: [
    {
      name: "Posiciones",
      rows: [["Producto", "ISIN", "Divisa", "Valor de mercado", "Contravalor EUR"], ["Fondo A", LU, "EUR", 80000.125, 80000.125], ["ETF B", IE, "USD", 8736, 7512.09]],
      fmt: { E2: '#,##0.000 "€"', E3: '#,##0.00 "€"' }
    }
  ],
  X64: [{ name: "Positions", rows: [["Security", "ISIN", "Market value EUR"], ["Fund A", LU, "80,000"], ["ETF B", IE, "7,512.09"]] }],
  X65: [{ name: "Hoja1", rows: [["POSICIONES", null, null], ["ISIN", "Nombre", "Peso %"], [LU, "Fondo A", 40], [IE, "Fondo B", 60]] }]
};

export const cases152: ProbeCase[] = [];
for (const [id, text] of Object.entries({ ...c35, ...c52 })) {
  if (!truth87[id]) throw new Error(`sin verdad para ${id}`);
  cases152.push({ id, group: "87", tema: "", text, truth: truth87[id] });
}
for (const c of casesNew) {
  const sheets = xlsxDefs[c.id];
  cases152.push({ id: c.id, group: "65", tema: c.tema, ...(sheets ? { sheets } : { text: c.text }), truth: c.truth, alias: c.alias });
}
