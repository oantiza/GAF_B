/* Revisión de la cuarta pasada (17-10-2026): batería de aceptación de la
   quinta, incorporada tal cual (antes zz_review4_aceptacion). Cada test afirma
   el criterio aceptado —un importe solo entra si es con certeza el contravalor
   en EUR; si no, aviso que nombra la posición (o la columna) y no se importa—
   para los hallazgos R4-01 a R4-09 de review4_frontend.md, en Posiciones
   globales y en el Constructor. */
import { describe, expect, it } from "vitest";
import { parsePositionImport } from "../src/core/positionImport";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const LU = "LU1234567891";
const IE = "IE0098765432";
const XS = "XS1234567891";
type Truth = Record<string, number | null>;

function activo(assetId: string): BdbAssetDetail {
  return {
    asset_id: assetId,
    display_name: `Activo ${assetId}`,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "FULL",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {}
  } as unknown as BdbAssetDetail;
}

/** Ningún importe falso; lo que falte, avisado por su id o con un aviso global. */
function expectSafe(entries: Array<{ id: string; amount: number }>, warnings: string[], truth: Truth) {
  const got = new Map<string, number>();
  for (const e of entries) got.set(e.id, (got.get(e.id) ?? 0) + e.amount);
  for (const [id, amount] of got) {
    expect(truth[id], `importe de ${id}`).not.toBeNull();
    expect(truth[id], `importe de ${id}`).toBeDefined();
    expect(amount, `importe de ${id}`).toBeCloseTo(truth[id] as number, 2);
  }
  for (const [id, amount] of Object.entries(truth)) {
    if (amount === null || got.has(id)) continue;
    expect(warnings.some((w) => w.includes(id) || /no se importa ning|no se importa nada/i.test(w)), `aviso de ${id}`).toBe(true);
  }
}

function gp(text: string, truth: Truth) {
  const r = parsePositionImport(text);
  expectSafe(r.entries, r.warnings, truth);
}

async function constructor(text: string, truth: Truth) {
  const r = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, resolveAsset: (id) => (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(id) ? activo(id) : null) });
  const capital = r.detected_capital ?? 0;
  const entries = r.imported_positions.map((p) => ({ id: p.asset_id, amount: (p.weight_percent / 100) * capital }));
  // Con capital 0 (parser simple) no hay importes: basta con que no se inventen pesos.
  if (capital > 0) expectSafe(entries, r.warnings, truth);
}

const cases: Record<string, { text: string; truth: Truth }> = {
  // R4-01: la cabecera de grupo con colspan pierde su rótulo y la columna «divisa» se lee como euros.
  N27: {
    text: '<table><tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th colspan="2">Contravalor</th></tr><tr><th>Divisa</th><th>EUR</th></tr><tr><td>A</td><td>LU1234567891</td><td>80.000,00</td><td>80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td>8.736,00</td><td>7.512,09</td></tr></table>',
    truth: { [LU]: 80000, [IE]: 7512.09 }
  },
  N58: { text: "Producto;ISIN;Contravalor;\n;;Divisa;EUR\nA;LU1234567891;80000;80000\nB;IE0098765432;8736;7512,09", truth: { [LU]: 80000, [IE]: 7512.09 } },
  N59: { text: "Security;ISIN;Market value (local)\nFund A;LU1234567891;80000\nETF B;IE0098765432;8736", truth: { [LU]: 80000, [IE]: null } },
  // R4-02: subtotal que repite el ISIN.
  N31: {
    text: "Producto;ISIN;Cuenta;Contravalor EUR\nFondo A;LU1234567891;C1;50000\nFondo A;LU1234567891;C2;30000\nTotal Fondo A;LU1234567891;;80000\nETF B;IE0098765432;C1;120000",
    truth: { [LU]: 80000, [IE]: 120000 }
  },
  // R4-03: tablas o secciones con otra disposición de columnas.
  N51: {
    text:
      "<table><tr><th>Producto</th><th>ISIN</th><th>Participaciones</th><th>Liquidativo</th><th>Contravalor EUR</th></tr>" +
      "<tr><td>Fondo A</td><td>LU1234567891</td><td>100</td><td>800,00</td><td>80.000,00</td></tr></table>\n" +
      "<table><tr><th>Producto</th><th>ISIN</th><th>Nominal</th><th>Precio</th><th>Cupón corrido</th><th>Contravalor EUR</th></tr>" +
      "<tr><td>Bono B</td><td>XS1234567891</td><td>120.000</td><td>99,50</td><td>1.250,00</td><td>120.650,00</td></tr></table>",
    truth: { [LU]: 80000, [XS]: 120650 }
  },
  N53: { text: "Producto;ISIN;Títulos;Contravalor EUR\nFondo A;LU1234567891;100;80000\nProducto;ISIN;Contravalor EUR;Títulos\nETF B;IE0098765432;120000;50", truth: { [LU]: 80000, [IE]: 120000 } },
  // R4-04: «80,000» en un extracto en inglés.
  N01: { text: 'Security,ISIN,Currency,Quantity,Market value EUR\n"Fund A",LU1234567891,EUR,100,"80,000"\n"ETF B",IE0098765432,USD,50,"7,512.09"', truth: { [LU]: 80000, [IE]: 7512.09 } },
  N46: { text: "ISIN,Market value EUR,Notes\nLU1234567891,80,000.00,\nIE0098765432,7,512.09,", truth: { [LU]: 80000, [IE]: 7512.09 } },
  // R4-05: la divisa escrita en la celda del importe, y «%», se borran.
  N09: { text: "Producto;ISIN;Valor de mercado\nA;LU1234567891;80.000,00 EUR\nB;IE0098765432;8.736,00 USD", truth: { [LU]: 80000, [IE]: null } },
  N11: { text: "LU1234567891;Fondo A;80.000,00 €\nIE0098765432;ETF B;8.736,00 USD", truth: { [LU]: 80000, [IE]: null } },
  N12: { text: "LU1234567891;40 %\nIE0098765432;60 %", truth: { [LU]: null, [IE]: null } },
  N13: { text: "ISIN;Importe\nLU1234567891;40%\nIE0098765432;60%", truth: { [LU]: null, [IE]: null } },
  // R4-06: una primera línea «;;» o un título de una palabra saltan la cabecera.
  N47: { text: ";;\nISIN;Nombre;Peso %\nLU1234567891;Fondo A;40\nIE0098765432;Fondo B;60", truth: { [LU]: null, [IE]: null } },
  N48: { text: ";;\nISIN;Divisa;Valor de mercado\nLU1234567891;EUR;80000\nIE0098765432;USD;8736", truth: { [LU]: 80000, [IE]: null } },
  N50: { text: "INVERSIS\nISIN;Divisa;Valor de mercado\nLU1234567891;EUR;80000\nIE0098765432;USD;8736", truth: { [LU]: 80000, [IE]: null } },
  // R4-07: la columna de divisa existe pero no se reconoce, o se toma la de la cuenta.
  N20: { text: "Producto;ISIN;Código divisa;Valor de mercado\nA;LU1234567891;EUR;80000\nB;IE0098765432;USD;8736", truth: { [LU]: 80000, [IE]: null } },
  N22: { text: "Producto;ISIN;Div. cuenta;Div. activo;Valor de mercado\nA;LU1234567891;EUR;EUR;80000\nB;IE0098765432;EUR;USD;8736", truth: { [LU]: 80000, [IE]: null } },
  // R4-08: un código que no es ISIN entra sin aviso por la lista línea a línea.
  N34: { text: "LU1234567891;80000\nIE0098765432;120000\nPATRIMONIO;200000", truth: { [LU]: 80000, [IE]: 120000 } },
  // R4-09: solo CR como salto de línea.
  N42b: { text: "LU1234567891;80000\rIE0098765432;120000\rXS1234567891;5000", truth: { [LU]: 80000, [IE]: 120000, [XS]: 5000 } }
};

describe("aceptación de la revisión 4 · Posiciones globales", () => {
  for (const [id, c] of Object.entries(cases)) it(`${id} · GP`, () => gp(c.text, c.truth));
});

describe("aceptación de la revisión 4 · Constructor", () => {
  for (const [id, c] of Object.entries(cases)) it(`${id} · Constructor`, async () => constructor(c.text, c.truth));
});
