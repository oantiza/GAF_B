import { describe, it, expect } from "vitest";
import {
  looksLikeBrokerExport,
  brokerExportToCanonicalImport,
  brokerExportToCanonicalText,
  brokerExportToPositionAmounts,
  parseAmount,
  readBrokerExport
} from "./brokerPortfolioImport";
import { parsePositionImport, parsePositionLines } from "./positionImport";

// Extracto de bróker en CSV (separado por ";", 14 columnas, coma decimal) + fila TOTAL.
const brokerCsv = [
  "Producto;ISIN;Mercado;Div;Tipo saldo;Títulos;Coste medio;Precio de mercado;Fecha;Fecha;Coste Adquisicion;Valor de mercado;Plus Minus;Contravalor en EUR",
  "JPM EUR EQ PLUS;LU0289214628;FEX;EUR;CONTADO;2467,605;30,7215;32,46;26/06/2026;26/06/2026;75808,41;80000;4290,05;80000",
  "RENTA FIJA FLEXIBLE;LU2222028099;FEX;EUR;CONTADO;1363,056;117,6;119,7;25/06/2026;25/06/2026;160299,87;120000;2855,21;120000",
  "TOTAL CARTERA;;;;;;;;;;;200000;;200000"
].join("\n");

// El mismo extracto como ".xls" que en realidad es HTML (otra disposición de columnas, punto decimal).
const brokerHtml = `<table>
<tr><td>Producto</td><td>ISIN</td><td>Mercado</td><td>Valor de mercado</td></tr>
<tr><td>Fund A</td><td>LU0289214628</td><td>FEX</td><td>80000.00</td></tr>
<tr><td>Fund B</td><td>LU2222028099</td><td>FEX</td><td>120000.00</td></tr>
<tr><td>TOTAL</td><td></td><td></td><td>200000.00</td></tr>
</table>`;

function parseCanonical(text: string) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  expect(lines[0]).toBe("asset_id,weight");
  return lines.slice(1).map((l) => {
    const [id, w] = l.split(",");
    return { id, w: Number(w) };
  });
}

describe("looksLikeBrokerExport", () => {
  it("detecta un CSV de bróker (ISIN + Valor de mercado)", () => {
    expect(looksLikeBrokerExport(brokerCsv)).toBe(true);
  });
  it("detecta un .xls que es HTML con <table>", () => {
    expect(looksLikeBrokerExport(brokerHtml)).toBe(true);
  });
  it("NO confunde el formato simple asset_id,weight", () => {
    expect(looksLikeBrokerExport("asset_id,weight\nLU0289214628,40\nLU2222028099,60")).toBe(false);
  });
});

describe("brokerExportToCanonicalText", () => {
  it("CSV ; → pesos por valor de mercado, ignora la fila TOTAL", () => {
    const rows = parseCanonical(brokerExportToCanonicalText(brokerCsv));
    expect(rows.map((r) => r.id)).toEqual(["LU0289214628", "LU2222028099"]);
    expect(rows[0].w).toBeCloseTo(40, 2);
    expect(rows[1].w).toBeCloseTo(60, 2);
    expect(rows.reduce((s, r) => s + r.w, 0)).toBeCloseTo(100, 2);
  });
  it("HTML-.xls → mismo resultado (otra disposición de columnas)", () => {
    const rows = parseCanonical(brokerExportToCanonicalText(brokerHtml));
    expect(rows.map((r) => r.id)).toEqual(["LU0289214628", "LU2222028099"]);
    expect(rows[0].w).toBeCloseTo(40, 2);
    expect(rows[1].w).toBeCloseTo(60, 2);
  });
  it("localiza ISIN por contenido sin cabecera 'isin' y usa la última columna como valor", () => {
    // Quinta pasada (R4-12): «Saldo» solo con la divisa EUR explícita («Saldo EUR» o columna de divisa).
    const csv = ["Nombre;Codigo;Saldo EUR", "Fondo A;LU0289214628;80000", "Fondo B;LU2222028099;120000", "TOTAL;;200000"].join("\n");
    const rows = parseCanonical(brokerExportToCanonicalText(csv));
    expect(rows.map((r) => r.id)).toEqual(["LU0289214628", "LU2222028099"]);
    expect(rows[0].w).toBeCloseTo(40, 2);
    expect(rows[1].w).toBeCloseTo(60, 2);
  });
  it("prefiere «Contravalor en EUR» sobre «Valor de mercado» cuando la posición va en otra divisa", () => {
    // Incidente 04-09-2026: un ETF en USD entraba con su importe en dólares.
    const csv = [
      "Producto;ISIN;Div;Valor de mercado;Contravalor en EUR",
      "Fondo EUR;LU0289214628;EUR;80000;80000",
      "ETF USD;IE000DR59CI3;USD;8736;7512,09"
    ].join("\n");
    const rows = parseCanonical(brokerExportToCanonicalText(csv));
    const total = 80000 + 7512.09;
    expect(rows.map((r) => r.id)).toEqual(["LU0289214628", "IE000DR59CI3"]);
    expect(rows[1].w).toBeCloseTo((7512.09 / total) * 100, 2);
  });

  it("si el contravalor viene vacío en una fila, cae al valor de mercado", () => {
    const csv = [
      "Producto;ISIN;Div;Valor de mercado;Contravalor en EUR",
      "Fondo EUR;LU0289214628;EUR;80000;",
      "ETF USD;IE000DR59CI3;USD;8736;20000"
    ].join("\n");
    const rows = parseCanonical(brokerExportToCanonicalText(csv));
    expect(rows.map((r) => r.id)).toEqual(["LU0289214628", "IE000DR59CI3"]);
    expect(rows[0].w).toBeCloseTo(80, 2);
    expect(rows[1].w).toBeCloseTo(20, 2);
  });

  it("passthrough: extracto sin ISINs válidos → devuelve el texto tal cual", () => {
    const sinIsin = "Producto;ISIN;Valor de mercado\nEfectivo;;1000\nTOTAL;;1000";
    expect(brokerExportToCanonicalText(sinIsin)).toBe(sinIsin);
  });
});

/* B8 (auditoría 29-09): un ISIN repetido en el extracto (dos cuentas, dos
   compras) llegaba al Constructor como dos líneas y la segunda se rechazaba
   como DUPLICATE_ASSET; y las filas con importe ilegible se saltaban sin
   contarse. Ahora se agrupa por ISIN, como en Posiciones globales, y se
   devuelve el recuento de filas descartadas para que la UI lo muestre. */
describe("brokerExportToCanonicalImport", () => {
  const conDuplicados = [
    "Cliente;ISIN;Producto;Valor de mercado",
    "Cuenta 1;LU0289214628;JPM EUR EQ PLUS;50000",
    "Cuenta 2;LU0289214628;JPM EUR EQ PLUS;30000",
    "Cuenta 1;LU2222028099;RENTA FIJA FLEXIBLE;120000",
    "Cuenta 3;IE000DR59CI3;ETF sin importe;n/d",
    "Cuenta 3;IE00B4L5Y983;ETF a cero;0",
    "TOTAL;;;200000"
  ].join("\n");

  it("agrupa los importes por ISIN: un solo peso por activo", () => {
    const out = brokerExportToCanonicalImport(conDuplicados);
    const rows = parseCanonical(out.text);
    expect(rows.map((r) => r.id)).toEqual(["LU0289214628", "LU2222028099"]);
    expect(rows[0].w).toBeCloseTo(40, 2);
    expect(rows[1].w).toBeCloseTo(60, 2);
  });

  it("cuenta las filas con ISIN válido pero importe ilegible o no positivo", () => {
    expect(brokerExportToCanonicalImport(conDuplicados).unreadableRows).toBe(2);
    expect(brokerExportToCanonicalImport(brokerCsv).unreadableRows).toBe(0);
  });

  it("brokerExportToCanonicalText es el mismo texto agrupado", () => {
    expect(brokerExportToCanonicalText(conDuplicados)).toBe(brokerExportToCanonicalImport(conDuplicados).text);
  });
});

/* ALTA-07 (auditoría 16-10-2026): «Valor liquidativo» casaba como importe y,
   a la izquierda del valor de mercado, daba pesos por precio unitario y un
   capital de 310 €. Además los importes exigían la cabecera «ISIN» y los pesos
   la localizaban por contenido: un HTML sin esa cabecera daba pesos pero no
   importes. Ahora hay un solo localizador de columnas, con rango de cabeceras
   (contravalor > valor de mercado > importe) y sin precios ni costes. */
describe("localizador de columnas único (ALTA-07)", () => {
  const conLiquidativo = [
    "Producto;ISIN;Participaciones;Valor liquidativo;Valor de mercado",
    "Fondo A;LU0289214628;1000;10;10000",
    "Fondo B;LU2222028099;1000;300;30000"
  ].join("\n");

  it("el liquidativo a la izquierda no es el importe: pesos 25/75 e importes 10.000/30.000", () => {
    const rows = parseCanonical(brokerExportToCanonicalText(conLiquidativo));
    expect(rows.map((r) => r.id)).toEqual(["LU0289214628", "LU2222028099"]);
    expect(rows[0].w).toBeCloseTo(25, 4);
    expect(rows[1].w).toBeCloseTo(75, 4);
    expect(brokerExportToPositionAmounts(conLiquidativo)).toEqual([
      { id: "LU0289214628", amount: 10000 },
      { id: "LU2222028099", amount: 30000 }
    ]);
  });

  it("un extracto con solo el liquidativo no da importes y dice por qué", () => {
    const soloLiquidativo = [
      "Producto;ISIN;Participaciones;Valor liquidativo",
      "Fondo A;LU0289214628;1000;10",
      "Fondo B;LU2222028099;1000;300"
    ].join("\n");
    // Tercera pasada: es un extracto (cabecera ISIN), pero sin columna de importe.
    expect(looksLikeBrokerExport(soloLiquidativo)).toBe(true);
    expect(brokerExportToPositionAmounts(soloLiquidativo)).toEqual([]);
    const canonical = brokerExportToCanonicalImport(soloLiquidativo);
    expect(canonical.text).toBe(soloLiquidativo);
    expect(canonical.warnings.join(" ")).toContain("«Participaciones» y «Valor liquidativo» no son importes");
  });

  it("«Importe invertido» antes de «Valor de mercado»: manda el valor de mercado", () => {
    const csv = [
      "Producto;ISIN;Importe invertido;Valor de mercado",
      "Fondo A;LU0289214628;50000;80000",
      "Fondo B;LU2222028099;150000;120000"
    ].join("\n");
    const rows = parseCanonical(brokerExportToCanonicalText(csv));
    expect(rows[0].w).toBeCloseTo(40, 4);
    expect(rows[1].w).toBeCloseTo(60, 4);
    expect(brokerExportToPositionAmounts(csv).map((p) => p.amount)).toEqual([80000, 120000]);
  });

  it("«Contravalor» manda sobre «Valor de mercado» aunque vaya a su derecha, y un «Importe» genérico queda último", () => {
    const csv = [
      "Producto;ISIN;Div;Importe;Valor de mercado;Contravalor en EUR",
      "ETF USD;IE000DR59CI3;USD;1;8736;7512,09",
      "Fondo EUR;LU0289214628;EUR;1;80000;"
    ].join("\n");
    expect(brokerExportToPositionAmounts(csv)).toEqual([
      { id: "IE000DR59CI3", amount: 7512.09 },
      { id: "LU0289214628", amount: 80000 }
    ]);
  });

  /* Cuarta pasada (N3-05): sin columna de divisa no consta que la fila esté
     en EUR, así que un contravalor en blanco no se sustituye por el valor de
     mercado: la fila no se importa y se avisa. */
  it("contravalor en blanco y sin columna de divisa: la fila no se importa y se avisa", () => {
    const csv = [
      "Producto;ISIN;Valor de mercado;Contravalor en EUR",
      "ETF USD;IE000DR59CI3;8736;7512,09",
      "Fondo;LU0289214628;80000;"
    ].join("\n");
    const read = readBrokerExport(csv);
    expect(read.positions).toEqual([{ id: "IE000DR59CI3", amount: 7512.09 }]);
    // Sexta pasada (M2 de la revisión 5): se dice «sin importe en EUR», no «en otra divisa».
    expect(read.warnings.join(" ")).toContain("1 fila con identificador y sin importe en EUR (LU0289214628)");
  });

  it("HTML sin cabecera «ISIN»: importes y pesos salen del mismo localizador", () => {
    const html = `<table>
<tr><td>Producto</td><td>Código</td><td>Mercado</td><td>Valor de mercado</td></tr>
<tr><td>Fund A</td><td>LU0289214628</td><td>FEX</td><td>80000.00</td></tr>
<tr><td>Fund B</td><td>LU2222028099</td><td>FEX</td><td>120000.00</td></tr>
<tr><td>TOTAL</td><td></td><td></td><td>200000.00</td></tr>
</table>`;
    const amounts = [
      { id: "LU0289214628", amount: 80000 },
      { id: "LU2222028099", amount: 120000 }
    ];
    expect(brokerExportToPositionAmounts(html)).toEqual(amounts);
    expect(parsePositionLines(html)).toEqual(amounts);
    const rows = parseCanonical(brokerExportToCanonicalText(html));
    expect(rows[0].w).toBeCloseTo(40, 4);
    expect(rows[1].w).toBeCloseTo(60, 4);
  });

  it("el extracto Andbank real no cambia: contravalor como importe y valor de mercado de respaldo", () => {
    expect(brokerExportToPositionAmounts(brokerCsv)).toEqual([
      { id: "LU0289214628", amount: 80000 },
      { id: "LU2222028099", amount: 120000 }
    ]);
    const rows = parseCanonical(brokerExportToCanonicalText(brokerCsv));
    expect(rows[0].w).toBeCloseTo(40, 4);
    expect(rows[1].w).toBeCloseTo(60, 4);
  });

  it("una lista simple «id;importe» sigue leyéndose línea a línea (identificadores que no son ISIN incluidos)", () => {
    expect(parsePositionLines("LU0289214628;1000\nFUND-1;500")).toEqual([
      { id: "LU0289214628", amount: 1000 },
      { id: "FUND-1", amount: 500 }
    ]);
  });
});

/* Segunda pasada de la revisión (R-01 a R-04). */
describe("localizador de columnas: segunda pasada", () => {
  const importes = [
    { id: "LU0289214628", amount: 80000 },
    { id: "LU2222028099", amount: 120000 }
  ];
  const esperaExtracto = (text: string) => {
    expect(brokerExportToPositionAmounts(text)).toEqual(importes);
    expect(parsePositionLines(text)).toEqual(importes);
    const rows = parseCanonical(brokerExportToCanonicalText(text));
    expect(rows.map((r) => r.id)).toEqual(["LU0289214628", "LU2222028099"]);
    expect(rows[0].w).toBeCloseTo(40, 4);
    expect(rows[1].w).toBeCloseTo(60, 4);
  };

  // R-01: entre la cabecera y la primera posición hay filas de sección o vacías.
  it("«Código ISIN» con filas de sección entre la cabecera y las posiciones", () => {
    esperaExtracto(`<table>
<tr><th>Producto</th><th>Código ISIN</th><th>Valor de mercado</th></tr>
<tr><td colspan="3">Fondos de inversión</td></tr>
<tr><td>Fund A</td><td>LU0289214628</td><td>80.000,00</td></tr>
<tr><td colspan="3">ETF</td></tr>
<tr><td>Fund B</td><td>LU2222028099</td><td>120.000,00</td></tr>
</table>`);
  });

  it("«Código ISIN» con una fila vacía tras la cabecera", () => {
    esperaExtracto(`<table>
<tr><th>Producto</th><th>Código ISIN</th><th>Valor de mercado</th></tr>
<tr></tr>
<tr><td>Fund A</td><td>LU0289214628</td><td>80.000,00</td></tr>
<tr><td>Fund B</td><td>LU2222028099</td><td>120.000,00</td></tr>
</table>`);
  });

  it("sin cabecera ISIN («Código») y con filas de sección", () => {
    esperaExtracto(`<table>
<tr><th>Producto</th><th>Código</th><th>Divisa</th><th>Valor de mercado</th></tr>
<tr><td colspan="4">Renta variable</td></tr>
<tr><td>Fund A</td><td>LU0289214628</td><td>EUR</td><td>80.000,00</td></tr>
<tr><td colspan="4">Renta fija</td></tr>
<tr><td>Fund B</td><td>LU2222028099</td><td>EUR</td><td>120.000,00</td></tr>
</table>`);
  });

  it("cabecera en dos filas: el importe sale de la subcabecera", () => {
    esperaExtracto(`<table>
<tr><th>Producto</th><th>Código ISIN</th><th colspan="2">Valoración</th></tr>
<tr><th></th><th></th><th>Divisa</th><th>Valor de mercado</th></tr>
<tr><td>Fund A</td><td>LU0289214628</td><td>EUR</td><td>80.000,00</td></tr>
<tr><td>Fund B</td><td>LU2222028099</td><td>EUR</td><td>120.000,00</td></tr>
</table>`);
  });

  it("«ISIN code» en un CSV se reconoce como cabecera de extracto", () => {
    const csv = "Product;ISIN code;Market value\nFund A;LU0289214628;80000\nFund B;LU2222028099;120000";
    expect(looksLikeBrokerExport(csv)).toBe(true);
    esperaExtracto(csv);
  });

  // R-02: un importe que nombra el euro manda sobre el valor de mercado en divisa de la posición.
  it("«Importe EUR» manda sobre «Valor de mercado» en USD", () => {
    const csv = "Producto;ISIN;Div;Importe EUR;Valor de mercado\nETF USD;IE000DR59CI3;USD;7512,09;8736\nFondo;LU0289214628;EUR;80000;80000";
    expect(brokerExportToPositionAmounts(csv)).toEqual([
      { id: "IE000DR59CI3", amount: 7512.09 },
      { id: "LU0289214628", amount: 80000 }
    ]);
    const rows = parseCanonical(brokerExportToCanonicalText(csv));
    expect(rows[0].w).toBeCloseTo((7512.09 / 87512.09) * 100, 4);
  });

  // R-03: los rangos 0 y 1 solo descartan costes.
  it.each([
    "Valor de mercado de la inversión",
    "Contravalor a precio de mercado",
    "Market value (price date)",
    "Valor de mercado títulos"
  ])("«%s» se reconoce como importe", (cabecera) => {
    const csv = `Producto;ISIN;Participaciones;${cabecera}\nA;LU0289214628;10;80000\nB;LU2222028099;10;120000`;
    expect(looksLikeBrokerExport(csv)).toBe(true);
    esperaExtracto(csv);
  });

  it("los costes siguen fuera también en contravalor y valor de mercado", () => {
    const csv = "Producto;ISIN;Contravalor coste;Contravalor mercado\nA;LU0289214628;1;80000\nB;LU2222028099;1;120000";
    esperaExtracto(csv);
  });

  // R-04: «ISIN;Valor» no es un importe reconocido: lista simple, línea a línea.
  it("con «ISIN;Valor» no se adivina el importe: aviso y nada importado", () => {
    // Cuarta pasada (N3-06): «Valor» no es una cabecera de importe reconocida
    // («valor» también es el título). Antes se leía línea a línea.
    const result = parsePositionImport("ISIN;Valor\nLU0232524495;1000\nAAPL;500\nFUND-1;250");
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(" ")).toContain("No se reconoce la columna de importe");
  });
});

describe("parseAmount", () => {
  it("coma decimal con miles (es): 80.098,46", () => expect(parseAmount("80.098,46")).toBeCloseTo(80098.46, 2));
  it("punto decimal (en/html): 2467.605", () => expect(parseAmount("2467.605")).toBeCloseTo(2467.605, 3));
  it("miles ingleses: 1,234,567.89", () => expect(parseAmount("1,234,567.89")).toBeCloseTo(1234567.89, 2));
  it("solo coma: 80098,46", () => expect(parseAmount("80098,46")).toBeCloseTo(80098.46, 2));
});
