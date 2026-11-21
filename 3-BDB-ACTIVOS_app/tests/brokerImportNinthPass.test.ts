/* Novena pasada del importador (revisión 8): una prueba unitaria por regla.
   Ningún dato de cliente: ISIN inventados o públicos, nombres de fantasía. */
import { describe, expect, it } from "vitest";
import { readBrokerExport } from "../src/core/brokerPortfolioImport";
import { describeMentions, foreignCurrenciesIn, mentionsIn } from "../src/core/currencyMentions";
import { emptySheetMarkerLine, hiddenSheetMarkerLine, sheetMarkerLine, workbookNotesMarkerLine } from "../src/core/delimitedText";
import { readAmountCell } from "../src/core/eurAmount";
import { decodeHtmlEntities } from "../src/core/htmlEntities";
import { decodeImportBytes, spreadsheetSheetsToPositionText } from "../src/core/importFileReader";
import { INCLUDE_UNPROVEN_KEY, INCLUDE_UNPROVEN_YES, includeUnprovenText, pendingChoices } from "../src/core/importSummary";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import { parsePositionImport } from "../src/core/positionImport";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

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

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0000120271";
const ids = (text: string, choices = {}) => readBrokerExport(text, choices).positions.map((p) => `${p.id}=${p.amount}`);
const pending = (text: string) => pendingChoices(readBrokerExport(text).choices);

describe("selector de columna con una mención de otra divisa (B1)", () => {
  const w08 = (extra: string) =>
    `Producto;ISIN;Importe (€);Valor de mercado\nFondo A;${LU};75000;80000\nFondo B;${IE};100000;120000${extra}`;

  it.each([
    ["una línea de liquidez en USD (N25)", "\nCUENTA CORRIENTE USD;;;1250"],
    ["un fondo «Dollar Bond EUR Hedged» (N26)", `\nFondo Dollar Bond EUR Hedged;${FR};45000;50000`],
    ["una nota al pie en dólares", "\nLas posiciones en dólares se valoran al cambio del día."]
  ])("«Importe (€)» frente a «Valor de mercado», con %s: hay que elegir", (_, extra) => {
    const choices = pending(w08(extra));
    expect(choices).toHaveLength(1);
    expect(choices[0].options.map((option) => option.label)).toEqual(["Importe (€)", "Valor de mercado", "Ninguna: no importar este bloque"]);
    expect(ids(w08(extra))).toEqual([]);
  });

  it("también con la mención en una hoja oculta del libro", () => {
    const text = `${sheetMarkerLine("Cartera")}\n${w08("")}\n${hiddenSheetMarkerLine("Notas")}\nImportes en USD`;
    expect(pending(text)).toHaveLength(1);
  });

  it.each([
    ["Saldo €", "Valoración"],
    ["Valor €", "Valor de mercado"],
    ["Importe EUR", "Valoración"]
  ])("«%s» frente a «%s» con una mención: hay que elegir si no coinciden", (eur, other) => {
    const text = `Importes en USD\nProducto;ISIN;${eur};${other}\nFondo A;${LU};75000;80000\nFondo B;${IE};100000;120000`;
    expect(pending(text)).toHaveLength(1);
  });

  it("un «Importe (€)» se compara también en la fila que menciona otra divisa, aunque las demás coincidan", () => {
    const text = `Producto;ISIN;Importe (€);Valor de mercado\nFondo A;${LU};80000;80000\nETF B USD;${IE};7512,09;8736`;
    expect(pending(text)).toHaveLength(1);
  });

  it("un «Contravalor EUR» sí se queda sin preguntar: es el contravalor de la fila", () => {
    const text = `ISIN;Nombre;Valor de mercado;Contravalor EUR\n${LU};Fondo A;80.000,00;80.000,00\n${IE};ETF B USD;8.736,00;7.512,09`;
    expect(readBrokerExport(text).choices).toEqual([]);
    expect(ids(text)).toEqual([`${LU}=80000`, `${IE}=7512.09`]);
  });

  it("sin ninguna fila comparable, un «Importe €» y un «Valor de mercado» no cuentan como acuerdo", () => {
    const text = `ISIN;Nombre;Divisa;Importe €;Valor de mercado\n${LU};Fondo A;USD;75000;80000\n${IE};ETF B;USD;100000;120000`;
    const [choice] = pending(text);
    expect(choice.reason).toBe("Las columnas «Importe €» y «Valor de mercado» podrían ser el importe y no se pueden comparar en ninguna fila.");
  });
});

describe("textos de la elección de columna (M5)", () => {
  it("con tres candidatas y dos que coinciden, dice «no todas coinciden»", () => {
    const text = `Producto;ISIN;Contravalor EUR;Valor de mercado;Importe EUR\nFondo A;${LU};80000;80000;75000\nFondo B;${IE};120000;120000;100000`;
    expect(pending(text)[0].reason).toBe(
      "Las columnas «Contravalor EUR», «Importe EUR» y «Valor de mercado» podrían ser el importe y no todas coinciden."
    );
  });

  it("con dos que no coinciden, «no coinciden»", () => {
    const text = `Producto;ISIN;Importe (€);Valor de mercado\nFondo A;${LU};75000;80000`;
    expect(pending(text)[0].reason).toBe("Las columnas «Importe (€)» y «Valor de mercado» podrían ser el importe y no coinciden.");
  });
});

describe("«Efectivo» es el valor de la posición (I4, I6)", () => {
  it("«Efectivo EUR» frente a «Importe» (lo invertido): hay que elegir, y la buena está en la lista (N34)", () => {
    const text = `Producto;ISIN;Títulos;Importe;Efectivo EUR\nFondo A;${LU};2467,605;75000;80000\nFondo B;${IE};1000;100000;120000`;
    const [choice] = pending(text);
    expect(choice.options.map((option) => option.label)).toContain("Efectivo EUR");
    expect(ids(text, { [choice.key]: choice.options.find((option) => option.label === "Efectivo EUR")!.value })).toEqual([
      `${LU}=80000`,
      `${IE}=120000`
    ]);
  });

  it("«Valor efectivo EUR» gana a «Valor de mercado» sin divisa y da la prueba de EUR (N32)", () => {
    const text = `Producto;ISIN;Valor de mercado;Valor efectivo EUR\nFondo A;${LU};80000;80000\nFondo B;${IE};120000;120000\nCUENTA CORRIENTE USD;;1250;`;
    const read = readBrokerExport(text);
    expect(read.choices).toEqual([]);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }, { id: IE, amount: 120000 }]);
    expect(read.summary.amountColumns).toEqual(["Valor efectivo EUR"]);
  });
});

describe("tipos de cambio de verdad (I7)", () => {
  it("«Cambio» con cifras de precio no es un tipo de cambio (N17)", () => {
    const text = `Producto;ISIN;Títulos;Cambio;Valoración\nFondo A;${LU};2467,605;32,42;80000\nFondo C;${FR};300;100;30000`;
    expect(ids(text)).toEqual([`${LU}=80000`, `${FR}=30000`]);
  });

  it("«Precio EUR/tít.» no es un par de divisas (N18)", () => {
    const text = `Producto;ISIN;Títulos;Precio EUR/tít.;Valoración\nFondo A;${LU};2467,605;32,42;80000\nFondo C;${FR};300;100;30000`;
    expect(ids(text)).toEqual([`${LU}=80000`, `${FR}=30000`]);
  });

  it.each(["Cambio", "Tipo de cambio", "EUR/USD"])("«%s» con cifras de tipo deja fuera la fila con un tipo distinto de 1 (y es una mención de otra divisa)", (header) => {
    const text = `Producto;ISIN;${header};Valoración\nFondo A;${LU};1,0000;80000\nETF B;${IE};1,0850;8736`;
    expect(ids(text)).toEqual([]);
    expect(readBrokerExport(text).warnings.join(" ")).toContain(`${IE} (tipo de cambio 1,085)`);
  });
});

describe("entidades HTML (B2)", () => {
  it.each([
    ["Valoraci&oacute;n", "Valoración"],
    ["Valor de mercado (&pound;)", "Valor de mercado (£)"],
    ["d&oacute;lares &yen; &cent; &curren; &dollar;", "dólares ¥ ¢ ¤ $"],
    ["Espa&ntilde;a &Uuml; &ccedil;", "España Ü ç"],
    ["&#128; &#x20AC; &#8364; &euro;", "€ € € €"],
    ["z&lstrok;", "zł"],
    ["&amp;lt; &amp; &lt;b&gt;", "&lt; & <b>"],
    ["&aacute sin punto y coma", "á sin punto y coma"],
    ["&noexiste; &copy", "&noexiste; ©"],
    ["80.000,00&nbsp;€", "80.000,00 €"]
  ])("«%s» → «%s»", (raw, expected) => {
    expect(decodeHtmlEntities(raw)).toBe(expected);
  });

  const table = (header: string) =>
    `<table><tr><td>Producto</td><td>ISIN</td><td>${header}</td></tr><tr><td>Fondo A</td><td>${LU}</td><td>8.000,00</td></tr></table>`;

  it("«Valor de mercado (&pound;)» es una columna en libras: no entra como euros (N59)", () => {
    const read = readBrokerExport(table("Valor de mercado (&pound;)"));
    expect(read.positions).toEqual([]);
    expect(read.warnings.join(" ")).toContain(LU);
  });

  it("«Valoraci&oacute;n» es una cabecera de importe (N60)", () => {
    expect(ids(table("Valoraci&oacute;n"))).toEqual([`${LU}=8000`]);
  });

  it("«d&oacute;lares» en una nota es una mención de otra divisa (N06)", () => {
    const read = readBrokerExport(`<p>Importes expresados en d&oacute;lares estadounidenses</p>${table("Valor de mercado")}`);
    expect(read.positions).toEqual([]);
    expect(read.summary.mentions).toContain("USD");
  });
});

describe("codificación del fichero (M8)", () => {
  const text = `Producto\tISIN\tValoración (€)\r\nFondo A\t${LU}\t80.000,00\r\n`;

  it("UTF-16LE con su marca de orden de bytes («Texto Unicode» de Excel, N57)", () => {
    const bytes = [0xff, 0xfe];
    for (let i = 0; i < text.length; i += 1) bytes.push(text.charCodeAt(i) & 0xff, text.charCodeAt(i) >> 8);
    expect(decodeImportBytes(new Uint8Array(bytes))).toBe(text);
  });

  it("UTF-16BE con su marca", () => {
    const bytes = [0xfe, 0xff];
    for (let i = 0; i < text.length; i += 1) bytes.push(text.charCodeAt(i) >> 8, text.charCodeAt(i) & 0xff);
    expect(decodeImportBytes(new Uint8Array(bytes))).toBe(text);
  });

  it("un HTML que declara utf-8 y está en windows-1252 se lee como windows-1252 (N56)", () => {
    const html = `<html><head><meta charset="utf-8"></head><body>Valoración (€) 80.000,00 €</body></html>`;
    const bytes = [...html].map((ch) => (ch === "€" ? 0x80 : ch.charCodeAt(0)));
    expect(decodeImportBytes(new Uint8Array(bytes))).toBe(html);
  });

  it("un HTML que declara utf-8 y lo es se sigue leyendo como utf-8", () => {
    const html = `<html><head><meta charset="utf-8"></head><body>Valoración (€)</body></html>`;
    expect(decodeImportBytes(new TextEncoder().encode(html))).toBe(html);
  });
});

describe("alcance de las menciones e inclusión explícita (I5)", () => {
  const DE = "DE0005557508";
  const ES = "ES0113900J37";
  const LU2 = "LU2222028099";
  /** El formato «Mercado» de Andbank: Producto, ISIN, Mercado, Valor de mercado, sin divisa. */
  const mercado = (rows: Array<[string, string, string]>, extra = "") =>
    `<table><tr><td>Producto</td><td>ISIN</td><td>Mercado</td><td>Valor de mercado</td></tr>${rows
      .map(([name, isin, amount]) => `<tr><td>${name}</td><td>${isin}</td><td>FEX</td><td>${amount}</td></tr>`)
      .join("")}${extra}</table>`;
  const fondos: Array<[string, string, string]> = [
    ["Fondo Renta Fija Euro", LU, "80000.00"],
    ["Fondo Dollar Bond EUR Hedged", LU2, "50000.00"],
    ["Fondo Bolsa Europa", FR, "30000.00"],
    ["Fondo Mixto", ES, "20000.00"],
    ["Fondo Monetario", DE, "15000.00"]
  ];

  it("el «Mercado» con un fondo «Dollar Bond EUR Hedged» entra entero: un nombre que dice EUR no menciona otra divisa (N12)", () => {
    const read = readBrokerExport(mercado(fondos));
    expect(read.positions.map((p) => p.id)).toEqual([LU, LU2, FR, ES, DE]);
    expect(read.summary.mentions).toBeNull();
    expect(read.summary.unproven).toBeNull();
  });

  it("una «CUENTA CORRIENTE USD» solo vale para su fila: los fondos entran (N16)", () => {
    const read = readBrokerExport(mercado(fondos.slice(0, 1), "<tr><td>CUENTA CORRIENTE USD</td><td></td><td></td><td>1250.00</td></tr>"));
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
  });

  it("la divisa del nombre de un fondo solo saca ese fondo, con su importe y su motivo aparte", () => {
    const read = readBrokerExport(mercado([fondos[0], ["ETF S&P 500 USD Acc", IE, "9304.00"]]));
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.summary.unproven).toEqual({
      positions: [{ id: IE, name: "ETF S&P 500 USD Acc", amount: 9304, eurStated: false, notes: ["USD en la fila"] }],
      included: false
    });
  });

  it("una mención en el título de un bloque vale para ese bloque; la del título del extracto, para todo", () => {
    const blocks = (first: string, second: string) =>
      `${first}\nProducto;ISIN;Valor de mercado\nFondo A;${LU};80000\n\n${second}\nProducto;ISIN;Valor de mercado\nFondo B;${IE};9304`;
    expect(ids(blocks("Fondos", "Cuenta en USD"))).toEqual([`${LU}=80000`]);
    expect(readBrokerExport(blocks("Fondos", "Cuenta en USD")).summary.mentionScope).toBe("block");
    expect(ids(blocks("Cartera valorada en USD", "Fondos"))).toEqual([]);
    // Una nota al pie entre bloques vale para todo el fichero, aunque vaya encima del segundo.
    expect(ids(blocks("Fondos", "(1) Importes expresados en USD"))).toEqual([]);
  });

  it("una nota en dólares deja fuera las filas sin prueba de EUR; la segunda casilla las incluye, marcadas (N19)", () => {
    const text = `${mercado(fondos.slice(0, 1))}<p>Las posiciones en dólares se valoran al cambio del día.</p>`;
    const read = readBrokerExport(text);
    expect(read.positions).toEqual([]);
    expect(read.warnings.join(" ")).toContain("Exporta con contravalor en EUR o con columna de divisa, o compruébalas y márcalas en el resumen.");
    expect(read.summary.unproven?.positions.map((p) => [p.id, p.amount])).toEqual([[LU, 80000]]);
    const included = readBrokerExport(text, { [INCLUDE_UNPROVEN_KEY]: INCLUDE_UNPROVEN_YES });
    expect(included.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(included.euroConfirmation?.positions[0]).toMatchObject({ id: LU, eurStated: false, notes: ["incluida a mano: el fichero menciona USD"] });
    expect(included.summary.unproven?.included).toBe(true);
  });

  it("el Constructor tampoco carga lo de fuera sin la casilla, y con ella lo carga", async () => {
    const text = `${mercado(fondos.slice(0, 2))}<p>Las posiciones en dólares se valoran al cambio del día.</p>`;
    const base = { sourceKind: "LOCAL_MOCK" as const, text, resolveAsset: (id: string) => activo(id) };
    const without = await buildLocalPortfolioImport(base);
    expect(without.imported_positions).toEqual([]);
    expect(without.import_unproven?.positions.map((p) => p.id)).toEqual([LU, LU2]);
    const withBox = await buildLocalPortfolioImport({ ...base, choices: { [INCLUDE_UNPROVEN_KEY]: INCLUDE_UNPROVEN_YES } });
    expect(withBox.imported_positions.map((p) => p.asset_id)).toEqual([LU, LU2]);
    expect(withBox.detected_capital).toBe(130000);
  });

  it("en una lista, la mención de una nota vale para todas las líneas y la segunda casilla también las incluye", () => {
    const text = `Importes en USD\n${LU};Fondo A;80.000,00`;
    expect(parsePositionImport(text).entries).toEqual([]);
    expect(parsePositionImport(text, { [INCLUDE_UNPROVEN_KEY]: INCLUDE_UNPROVEN_YES }).entries).toEqual([{ id: LU, amount: 80000 }]);
  });

  it("el texto de la segunda casilla dice cuántas", () => {
    expect(includeUnprovenText(3)).toBe("Incluir también estas 3 posiciones: he comprobado que sus importes están en euros");
    expect(includeUnprovenText(1)).toBe("Incluir también esta posición: he comprobado que su importe está en euros");
  });
});

describe("prefijos del euro (I8 y M2)", () => {
  it.each([
    ["XS", "XS1234567891", "ISIN XS sin divisa: un eurobono puede estar en cualquier divisa"],
    ["US", "US0378331005", "ISIN de fuera del euro (US) sin divisa: no consta que esté en euros"]
  ])("un ISIN %s sin divisa no entra solo y se puede incluir", (_, isin, reason) => {
    const text = `Producto;ISIN;Valor de mercado\nFondo A;${LU};80000\nBono;${isin};98500`;
    expect(ids(text)).toEqual([`${LU}=80000`]);
    expect(readBrokerExport(text).warnings.join(" ")).toContain(`${isin} (${reason})`);
    expect(ids(text, { [INCLUDE_UNPROVEN_KEY]: INCLUDE_UNPROVEN_YES })).toEqual([`${LU}=80000`, `${isin}=98500`]);
  });

  it.each(["BG1100034138", "AD0000001019"])("%s (Bulgaria desde el 1-1-2026, Andorra) cuenta como zona euro", (isin) => {
    expect(ids(`Producto;ISIN;Valor de mercado\nFondo;${isin};20000`)).toEqual([`${isin}=20000`]);
  });
});

describe("vocabulario de divisas (I2)", () => {
  it.each([
    ["Divisa: Libra", "title", ["GBP"]],
    ["Importes en dól. estadounidenses", "title", ["USD"]],
    ["Importes en dls.", "note", ["USD"]],
    ["Precio (GBX)", "header", ["GBP"]],
    ["Precio en GBp", "header", ["GBP"]],
    ["Cotización en peniques", "note", ["GBP"]]
  ] as const)("«%s» menciona %j", (text, source, expected) => {
    expect(foreignCurrenciesIn(text, source)).toEqual(expected);
  });

  it("«Libra» en singular en el nombre de un fondo no es una mención (N15)", () => {
    expect(foreignCurrenciesIn("Fondo Libra Patrimonio FI", "cell")).toEqual([]);
  });

  it("una cifra en GBX o en peniques no es un importe en EUR", () => {
    expect(readAmountCell("8.736,00 GBX").kind).toBe("foreign");
    expect(readAmountCell("8.736,00 GBp").kind).toBe("foreign");
  });
});

describe("la línea de menciones enseña la mención (M3)", () => {
  it("con un nombre largo, el trozo con la divisa", () => {
    const [mention] = mentionsIn("Fondo de Inversión Global de Renta Variable Internacional Clase Institucional en USD Acumulación", "cell", "una fila");
    expect(mention.text).toContain("USD");
    expect(mention.text.startsWith("…")).toBe(true);
  });

  it("la misma divisa en el mismo sitio va una vez, con cuántas", () => {
    const text = describeMentions([
      { currency: "USD", text: "USD", where: "la columna «Divisa»" },
      { currency: "USD", text: "USD", where: "la columna «Divisa»" },
      { currency: "USD", text: "USD", where: "la columna «Divisa»" }
    ]);
    expect(text).toBe("USD en la columna «Divisa» («USD», 3 veces)");
  });
});

describe("lo que el libro dice fuera de las celdas (I1)", () => {
  const cartera = { name: "Cartera", rows: [["Producto", "ISIN", "Valor de mercado"], ["Fondo A", LU, 80000]] };

  it("el nombre de una pestaña vacía cuenta (N04)", () => {
    const text = spreadsheetSheetsToPositionText([cartera, { name: "Importes en USD", rows: [] }]);
    expect(text).toContain(emptySheetMarkerLine("Importes en USD"));
    expect(ids(text)).toEqual([]);
    expect(readBrokerExport(text).summary.mentions).toContain("Importes en USD");
  });

  it("un comentario de celda cuenta (N01)", () => {
    const text = spreadsheetSheetsToPositionText([{ ...cartera, comments: ["Importes en USD"] }]);
    expect(ids(text)).toEqual([]);
  });

  it("las propiedades del libro cuentan (N02)", () => {
    const text = spreadsheetSheetsToPositionText([cartera], [["Título", "Cartera valorada en USD"]]);
    expect(text).toContain(workbookNotesMarkerLine("propiedades del libro"));
    expect(ids(text)).toEqual([]);
  });

  it("lo que se ve al pasar el ratón por una celda de un HTML cuenta (N05)", () => {
    const html = `<table><tr><th>Producto</th><th>ISIN</th><th title="Importes en USD">Valor de mercado</th></tr><tr><td>Fondo</td><td>${LU}</td><td>80.000,00</td></tr></table>`;
    expect(ids(html)).toEqual([]);
  });

  it("sin nada de eso, el libro entra como antes", () => {
    expect(ids(spreadsheetSheetsToPositionText([cartera]))).toEqual([`${LU}=80000`]);
  });
});
