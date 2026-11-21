/* Quinta pasada del importador (revisión 4, R4-01 a R4-15): estrategia en
   positivo. Un único analizador de importes en EUR; la divisa por cabecera,
   contenido y rótulos de grupo; una cabecera por tabla; subtotales, totales y
   palabras sueltas fuera; todas las hojas; y un resumen visible. Extractos
   SINTÉTICOS con ISIN inventados, salvo US0378331005 e IE00B4L5Y983. */
import { describe, expect, it } from "vitest";
import {
  brokerExportToCanonicalImport,
  classifyPositionId,
  isinCheckDigitOk,
  looksLikeBrokerExport,
  readBrokerExport
} from "../src/core/brokerPortfolioImport";
import { detectSeparator, emptySheetMarkerLine, parseDelimitedText, sheetMarkerLine, splitSheetBlocks } from "../src/core/delimitedText";
import { currencyOf, eurAmountOf, formatPlainEurAmount, readAmountCell, styleOfDigits } from "../src/core/eurAmount";
import { numberFormatMark, spreadsheetSheetsToPositionText } from "../src/core/importFileReader";
import { describeImportSummary } from "../src/core/importSummary";
import { parsePositionAmount, parsePositionImport } from "../src/core/positionImport";

const LU = "LU1234567891";
const IE = "IE0098765432";
const XS = "XS1234567891";
const OK = [
  { id: LU, amount: 80000 },
  { id: IE, amount: 120000 }
];
const USD_OK = [
  { id: LU, amount: 80000 },
  { id: IE, amount: 7512.09 }
];
const read = (text: string) => readBrokerExport(text);
const joined = (text: string) => read(text).warnings.join(" ");

describe("analizador único de importes en EUR (R4-04, R4-05)", () => {
  it("una cifra con otra divisa o con «%» no es un importe en EUR; con «€» o «EUR», sí", () => {
    expect(readAmountCell("8.736,00 USD")).toMatchObject({ kind: "foreign", currency: "USD" });
    expect(readAmountCell("$8,736.00")).toMatchObject({ kind: "foreign", currency: "USD" });
    expect(readAmountCell("USD 8.736,00")).toMatchObject({ kind: "foreign", currency: "USD" });
    expect(readAmountCell("40 %").kind).toBe("percent");
    expect(readAmountCell("Peso %").kind).toBe("invalid");
    expect(readAmountCell("8,00E+04").kind).toBe("invalid");
    expect(readAmountCell("80.000,00 €")).toMatchObject({ kind: "number", currency: "EUR" });
    expect(readAmountCell("EUR 80.000,00")).toMatchObject({ kind: "number", currency: "EUR" });
    expect(readAmountCell("80000 euros")).toMatchObject({ kind: "number", currency: "EUR" });
  });

  it("un solo separador con tres dígitos detrás es ambiguo; el resto decide su formato", () => {
    expect(styleOfDigits("80,000")).toEqual({ kind: "ambiguous", separator: "," });
    expect(styleOfDigits("80.000")).toEqual({ kind: "ambiguous", separator: "." });
    expect(styleOfDigits("7,512.09")).toEqual({ kind: "decided", style: "en" });
    expect(styleOfDigits("80.000,00")).toEqual({ kind: "decided", style: "es" });
    expect(styleOfDigits("12,50")).toEqual({ kind: "decided", style: "es" });
    expect(styleOfDigits("1,234,567")).toEqual({ kind: "decided", style: "en" });
    expect(styleOfDigits("80000")).toEqual({ kind: "plain" });
    expect(styleOfDigits("1.2345,67").kind).toBe("invalid");
  });

  it("«80,000» es 80.000 si el conjunto es inglés, 80 si es español y, sin nada que decida, solo miles con cabecera inglesa", () => {
    const cell = readAmountCell("80,000");
    expect(eurAmountOf(cell, { style: "en", language: null })).toMatchObject({ ok: true, value: 80000 });
    expect(eurAmountOf(cell, { style: "es", language: null })).toMatchObject({ ok: true, value: 80 });
    expect(eurAmountOf(cell, { style: null, language: "en" })).toMatchObject({ ok: true, value: 80000 });
    expect(eurAmountOf(cell, { style: null, language: "es" })).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(eurAmountOf(readAmountCell("80.000"), { style: null, language: "es" })).toMatchObject({ ok: true, value: 80000 });
  });

  it("apóstrofo suizo ASCII y tipográfico, espacio de miles, signo al final y paréntesis (R4-15)", () => {
    const ctx = { style: null, language: null };
    expect(eurAmountOf(readAmountCell("80'000.00"), ctx)).toMatchObject({ ok: true, value: 80000 });
    expect(eurAmountOf(readAmountCell("80’000.00"), ctx)).toMatchObject({ ok: true, value: 80000 });
    expect(eurAmountOf(readAmountCell("80 000,00"), ctx)).toMatchObject({ ok: true, value: 80000 });
    expect(eurAmountOf(readAmountCell("1.234,56-"), ctx)).toMatchObject({ ok: false, reason: "negative" });
    expect(eurAmountOf(readAmountCell("(1.234,56)"), ctx)).toMatchObject({ ok: false, reason: "negative" });
  });

  it("las divisas escritas con palabras o símbolo", () => {
    expect(["€", "Euro", "eur", "EUROS"].map(currencyOf)).toEqual(["EUR", "EUR", "EUR", "EUR"]);
    expect(["Dólar", "USD", "$", "libras", "CHF", "SEK"].map(currencyOf)).toEqual(["USD", "USD", "USD", "GBP", "CHF", "SEK"]);
    expect(currencyOf("FEX")).toBeNull();
  });

  it("la lista lee «20.000» como veinte mil y no acepta «8.736,00 USD» ni «40 %»", () => {
    expect(parsePositionAmount("20.000")).toBe(20000);
    expect(parsePositionAmount("8.736,00 USD")).toBeNaN();
    expect(parsePositionAmount("40 %")).toBeNaN();
    expect(parsePositionAmount("80,000")).toBeNaN();
  });

  it("el texto que Posiciones globales deja tras cargar un fichero se relee igual", () => {
    expect(formatPlainEurAmount(80000)).toBe("80000");
    expect(formatPlainEurAmount(7512.09)).toBe("7512,09");
    expect(formatPlainEurAmount(125.125)).toBe("125,1250");
    expect(parsePositionAmount(formatPlainEurAmount(125.125))).toBe(125.125);
  });
});

describe("R4-04: miles en inglés y anchura de las filas", () => {
  it("N01 · «80,000» con «7,512.09» en la misma columna: 80.000", () => {
    expect(read('Security,ISIN,Currency,Quantity,Market value EUR\n"Fund A",LU1234567891,EUR,100,"80,000"\n"ETF B",IE0098765432,USD,50,"7,512.09"').positions).toEqual(USD_OK);
  });

  it("N02 · todos enteros «80,000» con cabecera inglesa: miles", () => {
    expect(read('Security,ISIN,Market value EUR\n"Fund A",LU1234567891,"80,000"\n"Fund B",IE0098765432,"120,000"').positions).toEqual(OK);
  });

  it("«80,000» bajo una cabecera española y sin nada que lo decida: ambiguo, aviso por ISIN", () => {
    const result = read(`Producto;ISIN;Contravalor EUR\nA;${LU};80,000\nB;${IE};120,000`);
    expect(result.positions).toEqual([]);
    expect(result.warnings.join(" ")).toContain(`${LU} («80,000»)`);
  });

  it("N46 · «80,000.00» sin comillas con la última columna vacía: la fila tiene un campo de más y no entra", () => {
    const result = read("ISIN,Market value EUR,Notes\nLU1234567891,80,000.00,\nIE0098765432,7,512.09,");
    expect(result.positions).toEqual([]);
    expect(result.warnings.join(" ")).toContain(`2 filas tienen más columnas que la cabecera (${LU}, ${IE})`);
  });
});

describe("R4-05 y R4-07: la divisa, por la celda, la cabecera y el contenido", () => {
  it("N09 y N10 · la divisa escrita en la celda del importe", () => {
    expect(read("Producto;ISIN;Valor de mercado\nA;LU1234567891;80.000,00 EUR\nB;IE0098765432;8.736,00 USD").positions).toEqual([{ id: LU, amount: 80000 }]);
    const html = read(
      "<table><tr><th>Producto</th><th>ISIN</th><th>Valor de mercado</th></tr><tr><td>A</td><td>LU1234567891</td><td>EUR 80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td>USD 8.736,00</td></tr></table>"
    );
    expect(html.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(html.warnings.join(" ")).toContain(`${IE} (USD 8.736,00)`);
  });

  it.each([
    ["Código divisa", "Producto;ISIN;Código divisa;Valor de mercado"],
    ["Local currency", "Security;ISIN;Local currency;Market value"],
    ["Devise", "Titre;Code ISIN;Devise;Valeur de marché"]
  ])("N20/N21 · columna «%s»: la fila en USD no entra", (_, header) => {
    const result = read(`${header}\nA;${LU};EUR;80000\nB;${IE};USD;8736`);
    expect(result.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(result.warnings.join(" ")).toContain(`${IE} (USD)`);
  });

  it("N22 · la divisa del activo manda sobre la de la cuenta", () => {
    expect(read(`Producto;ISIN;Div. cuenta;Div. activo;Valor de mercado\nA;${LU};EUR;EUR;80000\nB;${IE};EUR;USD;8736`).positions).toEqual([
      { id: LU, amount: 80000 }
    ]);
  });

  it("dos columnas de divisa del mismo tipo que se contradicen: la fila no entra", () => {
    const result = read(`Producto;ISIN;Divisa;Moneda;Valor de mercado\nA;${LU};EUR;EUR;80000\nB;${IE};EUR;USD;8736`);
    expect(result.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(result.warnings.join(" ")).toContain(`divisas contradictorias (${IE})`);
  });

  it("una columna de divisa sin cabecera de divisa se reconoce por su contenido", () => {
    expect(read(`Producto;ISIN;Mercado;Valor de mercado\nA;${LU};EUR;80000\nB;${IE};USD;8736`).positions).toEqual([{ id: LU, amount: 80000 }]);
  });

  it("sin columna de divisa, un importe que no dice su divisa se enseña para confirmar, como todo (séptima pasada)", () => {
    const result = read(`Producto;ISIN;Valor de mercado\nA;${LU};80000\nB;${IE};120000`);
    expect(result.positions).toEqual(OK);
    expect(result.euroConfirmation?.positions).toEqual([
      { id: LU, name: "A", amount: 80000, eurStated: false },
      { id: IE, name: "B", amount: 120000, eurStated: false }
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.summary.currency).toEqual([
      "«Valor de mercado» no dice su divisa y el fichero no menciona ninguna otra divisa"
    ]);
  });

  it("N59 · «Market value (local)» sin columna de divisa: nada, con aviso que nombra las filas", () => {
    const result = read(`Security;ISIN;Market value (local)\nFund A;${LU};80000\nETF B;${IE};8736`);
    expect(result.positions).toEqual([]);
    expect(result.warnings.join(" ")).toContain(`2 posiciones sin divisa conocida (${LU}, ${IE})`);
  });

  it("R4-12 · «Saldo» solo con la divisa EUR explícita", () => {
    expect(read(`Producto;Código;Títulos;Saldo\nA;${LU};100;80000\nB;${IE};50;8736`).positions).toEqual([]);
    expect(joined(`Producto;Código;Títulos;Saldo\nA;${LU};100;80000\nB;${IE};50;8736`)).toContain("columna «Saldo»");
    expect(read(`Producto;Código;Divisa;Saldo\nA;${LU};EUR;80000\nB;${IE};USD;8736`).positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read(`Producto;Código;Saldo EUR\nA;${LU};80000\nB;${IE};120000`).positions).toEqual(OK);
  });
});

describe("R4-01: rótulos de grupo", () => {
  const group = (label: string) =>
    `<table><tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th colspan="2">${label}</th></tr><tr><th>Divisa</th><th>EUR</th></tr>` +
    `<tr><td>A</td><td>${LU}</td><td>80.000,00</td><td>80.000,00</td></tr><tr><td>B</td><td>${IE}</td><td>8.736,00</td><td>7.512,09</td></tr></table>`;

  it.each(["Contravalor", "Valor de mercado", "Valoración"])("N26-N28 · «%s» con colspan sobre «Divisa | EUR»: la columna EUR", (label) => {
    expect(read(group(label)).positions).toEqual(USD_OK);
  });

  it("N58 · la misma cabecera de grupo en dos filas de CSV", () => {
    expect(read("Producto;ISIN;Contravalor;\n;;Divisa;EUR\nA;LU1234567891;80000;80000\nB;IE0098765432;8736;7512,09").positions).toEqual(USD_OK);
  });

  it("N25 · «Valor de mercado» sobre «Importe | Divisa»: la divisa de la fila manda", () => {
    const html =
      '<table><tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th colspan="2">Valor de mercado</th></tr><tr><th>Importe</th><th>Divisa</th></tr>' +
      `<tr><td>A</td><td>${LU}</td><td>80.000,00</td><td>EUR</td></tr><tr><td>B</td><td>${IE}</td><td>8.736,00</td><td>USD</td></tr></table>`;
    expect(read(html).positions).toEqual([{ id: LU, amount: 80000 }]);
  });
});

describe("R4-03: una cabecera por tabla y por bloque", () => {
  it("N51 · dos tablas HTML con columnas distintas: cada una con la suya", () => {
    const html =
      "<table><tr><th>Producto</th><th>ISIN</th><th>Participaciones</th><th>Liquidativo</th><th>Contravalor EUR</th></tr>" +
      `<tr><td>Fondo A</td><td>${LU}</td><td>100</td><td>800,00</td><td>80.000,00</td></tr></table>\n` +
      "<table><tr><th>Producto</th><th>ISIN</th><th>Nominal</th><th>Precio</th><th>Cupón corrido</th><th>Contravalor EUR</th></tr>" +
      `<tr><td>Bono B</td><td>${XS}</td><td>120.000</td><td>99,50</td><td>1.250,00</td><td>120.650,00</td></tr></table>`;
    const result = read(html);
    expect(result.positions).toEqual([
      { id: LU, amount: 80000 },
      { id: XS, amount: 120650 }
    ]);
    expect(result.summary.sources).toEqual(["tabla 1", "tabla 2"]);
  });

  it("N53 · una cabecera repetida con las columnas en otro orden se vuelve a planificar", () => {
    expect(read(`Producto;ISIN;Títulos;Contravalor EUR\nFondo A;${LU};100;80000\nProducto;ISIN;Contravalor EUR;Títulos\nETF B;${IE};120000;50`).positions).toEqual(OK);
  });

  it("N56 · una celda oculta no desplaza las columnas", () => {
    const html =
      "<table><tr><th>Producto</th><th>ISIN</th><th>Contravalor EUR</th></tr>" +
      `<tr><td>A</td><td>${LU}</td><td style="display:none">4711</td><td>80.000,00</td></tr>` +
      `<tr><td>B</td><td>${IE}</td><td style="display: none">4712</td><td>120.000,00</td></tr></table>`;
    expect(read(html).positions).toEqual(OK);
  });

  it("en HTML, una fila con más celdas que la cabecera no entra", () => {
    const html =
      "<table><tr><th>Producto</th><th>ISIN</th><th>Contravalor EUR</th></tr>" +
      `<tr><td>A</td><td>${LU}</td><td>4711</td><td>80.000,00</td></tr><tr><td>B</td><td>${IE}</td><td>120.000,00</td></tr></table>`;
    const result = read(html);
    expect(result.positions).toEqual([{ id: IE, amount: 120000 }]);
    expect(result.warnings.join(" ")).toContain(`1 fila tiene más columnas que la cabecera (${LU})`);
  });

  it("una tabla anidada es una tabla propia", () => {
    const html =
      "<table><tr><td>Cartera de prueba</td></tr><tr><td>" +
      `<table><tr><th>Producto</th><th>ISIN</th><th>Contravalor EUR</th></tr><tr><td>A</td><td>${LU}</td><td>80.000,00</td></tr></table>` +
      "</td></tr></table>";
    expect(read(html).positions).toEqual([{ id: LU, amount: 80000 }]);
  });

  it("una tabla HTML sin ISIN pero con importes se avisa", () => {
    const html =
      `<table><tr><th>Producto</th><th>ISIN</th><th>Contravalor EUR</th></tr><tr><td>A</td><td>${LU}</td><td>80.000,00</td></tr></table>` +
      "<table><tr><th>Cuenta</th><th>Contravalor EUR</th></tr><tr><td>Liquidez</td><td>5.000,00</td></tr></table>";
    expect(joined(html)).toContain("La tabla 2 no tiene ninguna columna de ISIN: no se importa su fila con importe («Liquidez»)");
  });
});

describe("R4-02, R4-08, R4-11: filas que no son posiciones", () => {
  it("N31 · un ISIN repetido con una fila de total no entra: no se sabe qué filas sumar (B5)", () => {
    const result = read(`Producto;ISIN;Cuenta;Contravalor EUR\nFondo A;${LU};C1;50000\nFondo A;${LU};C2;30000\nTotal Fondo A;${LU};;80000\nETF B;${IE};C1;120000`);
    expect(result.positions).toEqual([{ id: IE, amount: 120000 }]);
    expect(result.warnings.join(" ").replace(/\s/g, " ")).toContain(`${LU} aparece en 3 filas (50.000,00 € + 30.000,00 € + 80.000,00 €) y alguna puede ser un total`);
    expect(describeImportSummary(result.summary).join(" ")).toContain("identificador repetido con un posible total (LU1234567891)");
  });

  it("S27 a S30 · tres cuentas cuyo importe es la suma de las otras, en cualquier orden: el ISIN no entra; dos cuentas sin indicio de total se suman", () => {
    for (const order of [["30000", "50000", "80000"], ["80000", "30000", "50000"]]) {
      const text = `Producto;ISIN;Cuenta;Contravalor EUR\n${order.map((amount, i) => `Fondo A;${LU};C${i + 1};${amount}`).join("\n")}\nETF B;${IE};C1;120000`;
      const result = read(text);
      expect(result.positions).toEqual([{ id: IE, amount: 120000 }]);
      expect(result.warnings.join(" ")).toContain(`${LU} aparece en 3 filas`);
    }
    const two = read(`Producto;ISIN;Cuenta;Contravalor EUR\nFondo A;${LU};C1;50000\nFondo A;${LU};C2;30000\nETF B;${IE};C1;120000`);
    expect(two.positions.filter((p) => p.id === LU).reduce((sum, p) => sum + p.amount, 0)).toBe(80000);
    expect(two.warnings.join(" ")).toContain(`${LU} aparece en 2 filas`);
    expect(two.warnings.join(" ")).toContain("se suman en una posición");
  });

  it("S31 y S32 · una tabla u hoja «Resumen»/«Consolidado» que repite los ISIN: esos ISIN no entran", () => {
    const tbl = (rows: string[][]) => `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
    const html =
      tbl([["Cuenta 1", "", ""], ["Producto", "ISIN", "Contravalor EUR"], ["Fondo A", LU, "50.000,00"]]) +
      tbl([["Cuenta 2", "", ""], ["Producto", "ISIN", "Contravalor EUR"], ["ETF B", IE, "120.000,00"]]) +
      tbl([["Resumen por producto", "", ""], ["Producto", "ISIN", "Contravalor EUR"], ["Fondo A", LU, "50.000,00"], ["ETF B", IE, "120.000,00"]]);
    const result = read(html);
    expect(result.positions).toEqual([]);
    expect(result.warnings.join(" ")).toContain(`${LU} aparece en 2 filas`);
    expect(result.warnings.join(" ")).toContain(`${IE} aparece en 2 filas`);
  });

  it("N32 · «Subtotal» a secas con el ISIN no es una posición; el ISIN repetido, tampoco", () => {
    const html =
      "<table><tr><th>Producto</th><th>ISIN</th><th>Contrato</th><th>Contravalor EUR</th></tr>" +
      `<tr><td>Fondo A</td><td>${LU}</td><td>0001</td><td>50.000,00</td></tr><tr><td>Fondo A</td><td>${LU}</td><td>0002</td><td>30.000,00</td></tr>` +
      `<tr><td>Subtotal</td><td>${LU}</td><td></td><td>80.000,00</td></tr><tr><td>ETF B</td><td>${IE}</td><td>0001</td><td>120.000,00</td></tr></table>`;
    const result = read(html);
    expect(result.warnings.join(" ")).toContain(`${LU} («Subtotal»)`);
    // Las dos cuentas restantes, sin indicio de total entre ellas, se suman.
    expect(result.positions.reduce((sum, p) => sum + p.amount, 0)).toBe(200000);
  });

  it("un fondo cuyo nombre empieza por «Total» y no repite ISIN es una posición", () => {
    expect(read(`Producto;ISIN;Contravalor EUR\nTotal Return Bond;${LU};80000\nB;${IE};120000`).positions).toEqual(OK);
  });

  it("N61 · «PIMCO Total Return» sin ISIN se avisa (el total anclado no lo silencia)", () => {
    expect(joined(`Producto;ISIN;Contravalor EUR\nA;${LU};80000\nPIMCO Total Return;;5000\nB;${IE};120000`)).toContain("«PIMCO Total Return»");
  });

  it("palabras sueltas y códigos: clases del identificador", () => {
    expect(["PATRIMONIO", "CARTERA", "FONDOS", "AAPL", "SAN.MC", "PRIVADO-1", "TOTAL", "EUR", LU].map((id) => classifyPositionId(id))).toEqual([
      "word", "word", "word", "code", "code", "code", "none", "none", "isin"
    ]);
    expect(classifyPositionId("aapl")).toBe("none");
    expect(classifyPositionId("aapl", { list: true })).toBe("code");
  });

  it("N34 y N35 · en la lista, PATRIMONIO y CARTERA no son posiciones; AAPL y MSFT entran con el aviso del lector", () => {
    const n34 = parsePositionImport(`${LU};80000\n${IE};120000\nPATRIMONIO;200000`);
    expect(n34.entries).toEqual(OK);
    expect(n34.warnings.join(" ")).toContain("Se ignora una fila de sección o subtotal (PATRIMONIO): no es una posición.");
    const n35 = parsePositionImport("Activo;Importe\nAAPL;500\nMSFT;300\nCARTERA;800");
    expect(n35.entries).toEqual([
      { id: "AAPL", amount: 500 },
      { id: "MSFT", amount: 300 }
    ]);
    expect(n35.warnings.join(" ")).toContain("Se importan como posiciones 2 identificadores que no son ISIN (AAPL, MSFT)");
    expect(n35.warnings.join(" ")).toContain("(CARTERA)");
  });
});

describe("R4-06 y R4-09: Posiciones globales", () => {
  it("N47 a N50 · una primera línea «;;» o un título en A1 no saltan la cabecera", () => {
    expect(parsePositionImport(`;;\nISIN;Nombre;Peso %\n${LU};Fondo A;40\n${IE};Fondo B;60`).entries).toEqual([]);
    expect(parsePositionImport(`BBVA\nISIN;Nombre;Valor liquidativo\n${LU};Fondo A;12,34\n${IE};Fondo B;5,67`).entries).toEqual([]);
    expect(parsePositionImport(`;;\nISIN;Divisa;Valor de mercado\n${LU};EUR;80000\n${IE};USD;8736`).entries).toEqual([{ id: LU, amount: 80000 }]);
    expect(parsePositionImport(`INVERSIS\nISIN;Divisa;Valor de mercado\n${LU};EUR;80000\n${IE};USD;8736`).entries).toEqual([{ id: LU, amount: 80000 }]);
  });

  it("N60 · en la lista, una divisa en medio no es un nombre: solo vale EUR", () => {
    const result = parsePositionImport(`${LU};EUR;80000\n${IE};USD;8736`);
    expect(result.entries).toEqual([{ id: LU, amount: 80000 }]);
    expect(result.warnings.join(" ")).toContain(`${IE} (USD)`);
  });

  it("N42b · solo CR como salto de línea (novena pasada, I8: el XS sin divisa no entra solo)", () => {
    const result = parsePositionImport(`${LU};80000\r${IE};120000\r${XS};5000`);
    expect(result.entries).toEqual(OK);
    expect(result.warnings.join(" ")).toContain(`${XS} (ISIN XS sin divisa`);
  });

  it("la lista decide el formato por el conjunto: «80,000» junto a «7,512.09» es inglés", () => {
    expect(parsePositionImport(`${LU};"80,000"\n${IE};"7,512.09"`).entries).toEqual(USD_OK);
  });
});

describe("R4-10 y R4-07: libros con varias hojas y divisa del formato", () => {
  it("numberFormatMark reconoce la divisa y el porcentaje del formato de Excel", () => {
    expect(numberFormatMark('"$"#,##0.00')).toBe("USD");
    expect(numberFormatMark("[$USD] #,##0.00")).toBe("USD");
    expect(numberFormatMark("#,##0.00 [$€-C0A]")).toBe("€");
    expect(numberFormatMark('#,##0.00 "€"')).toBe("€");
    expect(numberFormatMark("_-* #,##0.00 €_-")).toBe("€");
    expect(numberFormatMark("£#,##0")).toBe("GBP");
    expect(numberFormatMark("0.00%")).toBe("%");
    expect(numberFormatMark("#,##0.00")).toBeNull();
    expect(numberFormatMark("dd/mm/yyyy")).toBeNull();
  });

  it("las hojas con datos van tras su línea de hoja, también si solo hay una (M4)", () => {
    const text = spreadsheetSheetsToPositionText([
      { name: "Cuenta 1", rows: [["ISIN", "Contravalor EUR"], [LU, 80000]] },
      { name: "Vacía", rows: [[null]] },
      { name: "Cuenta 2", rows: [["ISIN", "Contravalor EUR"], [IE, 120000]], marks: { "1,1": "€" } }
    ]);
    // Novena pasada (I1 de la revisión 8): la hoja vacía va con su nombre, que también cuenta para la divisa.
    expect(text).toBe(
      `${sheetMarkerLine("Cuenta 1")}\nISIN;Contravalor EUR\n${LU};80000\n${emptySheetMarkerLine("Vacía")}\n${sheetMarkerLine("Cuenta 2")}\nISIN;Contravalor EUR\n${IE};120000 €`
    );
    expect(splitSheetBlocks(text).map((block) => block.sheet)).toEqual(["Cuenta 1", "Vacía", "Cuenta 2"]);
    expect(spreadsheetSheetsToPositionText([{ name: "Única", rows: [["ISIN"], [LU]] }])).toBe(`${sheetMarkerLine("Única")}\nISIN\n${LU}`);
  });

  it("el lector trata cada hoja como una tabla y avisa de las que no tienen posiciones", () => {
    const text = [
      sheetMarkerLine("Resumen"),
      "Tipo;Importe",
      "FONDOS;80000",
      sheetMarkerLine("Posiciones"),
      "Producto;ISIN;Contravalor EUR",
      `Fondo A;${LU};80000`,
      `ETF B;${IE};120000`
    ].join("\n");
    const result = read(text);
    expect(result.positions).toEqual(OK);
    expect(result.warnings).toEqual(["La hoja «Resumen» no tiene una tabla de posiciones con ISIN: no se lee («FONDOS»)."]);
    expect(result.summary.sources).toEqual(["hoja «Posiciones»", "hoja «Resumen» (sin tabla de posiciones, no leída)"]);
    expect(parsePositionImport(text).entries).toEqual(OK);
    expect(looksLikeBrokerExport(text)).toBe(true);
  });
});

describe("menores (R4-14, R4-15)", () => {
  it("R4-14 · el separador se detecta con las mismas comillas que el lector", () => {
    expect(detectSeparator(`Bono 5" largo;${XS};1\nB;${IE};2`)).toBe(";");
    expect(detectSeparator('Título\n"a;b",c,d')).toBe(",");
  });

  it("N44 · una comilla sin cerrar al final, sin separadores ni saltos dentro, se da por cerrada", () => {
    expect(parseDelimitedText(`A;${LU};80000\nB;${IE};"7512,09`).unclosedQuote).toBe(false);
    expect(read(`Producto;ISIN;Contravalor EUR\nA;${LU};80000\nB;${IE};"7512,09`).positions).toEqual(USD_OK);
    expect(parseDelimitedText(`A;"${LU};80000`).unclosedQuote).toBe(true);
  });

  it("N54 · «&euro;» en HTML", () => {
    const html = `<table><tr><th>Producto</th><th>ISIN</th><th>Contravalor EUR</th></tr><tr><td>A</td><td>${LU}</td><td>80.000,00 &euro;</td></tr><tr><td>B</td><td>${IE}</td><td>120.000,00 &euro;</td></tr></table>`;
    expect(read(html).positions).toEqual(OK);
  });

  it("N14 y N15 · Degiro: «Symbol/ISIN», «Local value» de dos columnas y «Value in EUR» / «Valor en EUR»", () => {
    expect(
      read("Product,Symbol/ISIN,Quantity,Closing,Local value,,Value in EUR\nFUND A,LU1234567891,100,800.00,EUR,80000.00,80000.00\nETF B,IE0098765432,50,174.72,USD,8736.00,7512.09").positions
    ).toEqual(USD_OK);
    expect(
      read('Producto,Símbolo/ISIN,Cantidad,Precio de cierre,Valor local,,Valor en EUR\nFONDO A,LU1234567891,100,"800,00",EUR,"80000,00","80000,00"\nETF B,IE0098765432,50,"174,72",USD,"8736,00","7512,09"').positions
    ).toEqual(USD_OK);
  });

  it("N07 · cabeceras en francés y en catalán", () => {
    expect(
      read("Titre;Code ISIN;Devise;Valeur de marché;Contre-valeur EUR\nFonds A;LU1234567891;EUR;80 000,00;80 000,00\nETF B;IE0098765432;USD;8 736,00;7 512,09").positions
    ).toEqual(USD_OK);
    expect(read(`Producte;ISIN;Divisa;Valor de mercat\nA;${LU};EUR;80000\nB;${IE};EUR;120000`).positions).toEqual(OK);
  });

  it("R4-15 · el dígito de control del ISIN: no excluye, pero el resumen lo dice", () => {
    expect(isinCheckDigitOk("US0378331005")).toBe(true);
    expect(isinCheckDigitOk("IE00B4L5Y983")).toBe(true);
    expect(isinCheckDigitOk("US0378331006")).toBe(false);
    const result = read(`Producto;ISIN;Contravalor EUR\nA;US0378331005;80000\nB;LU1234567890;120000`);
    expect(result.positions).toHaveLength(2);
    expect(result.summary.checkDigit).toEqual(["LU1234567890"]);
  });
});

describe("resumen de la importación", () => {
  it("dice lo leído, la columna, la divisa y lo descartado", () => {
    const result = read(`Producto;ISIN;Divisa;Valor de mercado;Contravalor EUR\nA;${LU};EUR;80000;80000\nB;${IE};USD;8736;\nTOTAL;;;;80000`);
    const lines = describeImportSummary(result.summary).map((line) => line.replace(/\s/g, " "));
    expect(lines).toEqual([
      "1 posición leída por 80.000,00 € en total.",
      "Importe: columna «Contravalor EUR».",
      "Divisa: la cabecera «Contravalor EUR» dice EUR.",
      // Octava pasada: las otras divisas que menciona el fichero, y dónde.
      "Otras divisas en el fichero: USD en la columna «Divisa» («USD»). Solo entran solas las filas que dicen EUR.",
      // Séptima pasada: cada posición que se va a confirmar, con su nombre y su importe.
      "Posiciones para comprobar (ISIN · nombre · importe), de mayor a menor: 1.",
      "LU1234567891 · A · 80.000,00 €",
      "Total para comprobar: 80.000,00 €.",
      "2 filas descartadas: en otra divisa sin contravalor en EUR (IE0098765432 (USD)); fila de total (TOTAL).",
      // Los ISIN de estas pruebas son inventados: el resumen lo dice, sin excluirlos.
      "Un código con forma de ISIN no cumple el dígito de control (LU1234567891): comprueba que esté bien escrito."
    ]);
  });

  it("el Constructor recibe el mismo resumen que el lector", () => {
    const text = `Producto;ISIN;Contravalor EUR\nA;${LU};80000\nB;${IE};120000`;
    expect(brokerExportToCanonicalImport(text).summary).toEqual(read(text).summary);
  });
});
