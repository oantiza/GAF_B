/* Octava pasada del importador (revisión 7): una prueba unitaria por regla, para
   que ninguna quede protegida solo por la batería de sondas (M3 y M4 de la
   revisión 7). Ningún dato de cliente: ISIN inventados o públicos. */
import { describe, expect, it } from "vitest";
import { importBoxText, readBrokerExport } from "../src/core/brokerPortfolioImport";
import { describeMentions, foreignCurrenciesIn, mentionsIn } from "../src/core/currencyMentions";
import { hiddenRowsMarkerLine, hiddenSheetMarkerLine, sheetMarkerLine } from "../src/core/delimitedText";
import { spreadsheetSheetsToPositionText } from "../src/core/importFileReader";
import { describeImportSummary, HOLDER_CHOICE_KEY, NONE_CHOICE, pendingChoices } from "../src/core/importSummary";
import { parsePositionImport } from "../src/core/positionImport";

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0000120271";
const DE = "DE0005557508";
const GB = "GB0002374006";
const US = "US0378331005";
const ids = (text: string, choices = {}) => readBrokerExport(text, choices).positions.map((p) => `${p.id}=${p.amount}`);
const warnings = (text: string) => readBrokerExport(text).warnings.join(" | ");

describe("menciones de otra divisa (currencyMentions)", () => {
  it.each([
    ["Importes expresados en dólares estadounidenses (USD)", "note", ["USD"]],
    ["Cartera valorada en USD", "title", ["USD"]],
    ["Fondo Índice Suecia (coronas suecas)", "cell", ["coronas"]],
    ["Fondo Renta Fija Chile CLP Acc", "cell", ["CLP"]],
    ["ishares core s&p 500 ucits etf usd (acc)", "cell", ["USD"]],
    ["iShares $ Treasury Bond 7-10yr", "cell", ["USD"]],
    ["8.736,00 ¤", "cell", ["otra divisa"]],
    ["(1) En la divisa de cotización de cada valor.", "note", ["otra divisa"]]
  ] as const)("«%s» menciona %j", (text, source, expected) => {
    expect(foreignCurrenciesIn(text, source)).toEqual(expected);
  });

  it.each([
    ["Divisa de referencia: EUR", "note"],
    ["Fondo Euro Bonos EUR", "cell"],
    ["Global Industry Try Fund", "cell"],
    ["Cartera real", "title"],
    ["Valor de mercado (divisa)", "header"],
    [US, "cell"]
  ] as const)("«%s» no menciona ninguna otra", (text, source) => {
    expect(foreignCurrenciesIn(text, source)).toEqual([]);
  });

  it("una frase sin divisa solo cuenta en títulos y notas, no en una cabecera", () => {
    expect(foreignCurrenciesIn("Divisa local", "header")).toEqual([]);
    expect(foreignCurrenciesIn("Importes en la divisa local", "note")).toEqual(["otra divisa"]);
  });

  it("el resumen dice qué divisa y dónde", () => {
    expect(describeMentions(mentionsIn("Cuenta USD", "title", "el nombre de la hoja «Cuenta USD»"))).toBe(
      "USD en el nombre de la hoja «Cuenta USD» («Cuenta USD»)"
    );
  });
});

describe("regla global de divisa (B2, B3, B4)", () => {
  it("sin ninguna mención, todo entra para confirmar con su criterio", () => {
    const read = readBrokerExport(`ISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00\n${IE};Fondo B;120.000,00`);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }, { id: IE, amount: 120000 }]);
    expect(read.summary.currency).toEqual(["«Valor de mercado» no dice su divisa y el fichero no menciona ninguna otra divisa"]);
    expect(read.summary.mentions).toBeNull();
  });

  it.each([
    ["una nota al pie", `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;93.040,00\n${IE};ETF B;8.736,00\nImportes expresados en dólares (USD)`],
    ["el título", `Cartera 0012345 · Moneda de la cartera: USD\nISIN;Nombre;Valor de mercado\n${LU};Fondo A;93.040,00\n${IE};ETF B;8.736,00`],
    ["el <caption>", `<table><caption>Cartera valorada en USD</caption><tr><th>ISIN</th><th>Nombre</th><th>Valor de mercado</th></tr><tr><td>${LU}</td><td>Fondo A</td><td>93.040,00</td></tr><tr><td>${IE}</td><td>ETF B</td><td>8.736,00</td></tr></table>`],
    ["el nombre de la hoja", `${sheetMarkerLine("Cuenta USD")}\nISIN;Nombre;Valor de mercado\n${LU};Fondo A;93040\n${IE};ETF B;8736`],
    ["la cabecera del precio", `ISIN;Nombre;Títulos;Precio (USD);Valor de mercado\n${LU};Fondo A;20;436,80;8.736,00\n${IE};ETF B;100;93,04;9.304,00`],
    ["el tipo de cambio «T/C»", `ISIN;Nombre;Valor de mercado;T/C\n${LU};Fondo A;80.000,00;1,0000\n${IE};ETF B;8.736,00;1,1630`]
  ])("una mención en %s deja fuera las filas sin prueba de EUR, nombradas", (_where, text) => {
    const read = readBrokerExport(text);
    expect(read.positions).toEqual([]);
    // Décima pasada: el <caption> y la cabecera valen para su tabla o su bloque, y el aviso lo dice.
    expect(read.warnings.join(" ")).toMatch(/Hay otra divisa que el euro en (el fichero|una parte del fichero)/);
    expect(read.warnings.join(" ")).toContain(LU);
    expect(read.warnings.join(" ")).toContain(IE);
    expect(read.summary.mentions).not.toBeNull();
  });

  it("con mención, entran las filas con prueba: la divisa del activo, la cabecera EUR o «€» en la celda", () => {
    expect(ids(`ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};ETF B;USD;8.736,00`)).toEqual([`${LU}=80000`]);
    expect(ids(`Cuenta USD\nISIN;Nombre;Contravalor EUR\n${LU};Fondo A;80.000,00`)).toEqual([`${LU}=80000`]);
    expect(ids(`Cuenta USD\nISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00 €\n${IE};ETF B;8.736,00`)).toEqual([`${LU}=80000`]);
  });

  it("los códigos numéricos ISO 4217 de una columna «Cód. mon.» cuentan (W22)", () => {
    const read = readBrokerExport(`ISIN;Nombre;Cód. mon.;Valor de mercado\n${LU};Fondo A;978;80.000,00\n${IE};ETF B;840;8.736,00`);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.warnings.join(" ")).toContain(`${IE} (USD)`);
  });

  it("«Divisa» en blanco en un fichero con columna de divisa no es EUR (W25)", () => {
    const read = readBrokerExport(`ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${DE};Fondo D;;5.600,00`);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.warnings.join(" ")).toContain(`${DE} («Divisa» en blanco)`);
  });

  it("un nombre que dice EUR («… $ Treasury … EUR Hedged») no es una señal: la fila con «Divisa» EUR entra (W48)", () => {
    const read = readBrokerExport(`ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};iShares $ Treasury Bond EUR Hedged;EUR;25.000,00`);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }, { id: IE, amount: 25000 }]);
    expect(read.euroConfirmation?.positions.find((p) => p.id === IE)?.notes).toBeUndefined();
  });

  it("con «Divisa» EUR y otra divisa en el nombre («A USD Acc»), la fila no entra sola (novena pasada, N47)", () => {
    const text = `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};Fondo Global A USD Acc;EUR;8.736,00`;
    expect(readBrokerExport(text).positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(readBrokerExport(text).summary.unproven?.positions.map((p) => [p.id, p.amount, p.notes])).toEqual([
      [IE, 8736, ["«Divisa» dice EUR y el nombre, USD"]]
    ]);
  });

  it("«€» en las demás filas se cuenta en todo el fichero, no por bloque (B3, W17)", () => {
    const text = `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00 €\n\nISIN;Nombre;Valor de mercado\n${IE};Fondo B;12.000,00`;
    expect(ids(text)).toEqual([`${LU}=80000`]);
    expect(warnings(text)).toContain(`${IE} (las demás filas dicen «€» y esta no)`);
  });

  it("un ISIN de fuera de la zona euro sin prueba de EUR queda fuera; con «Divisa» EUR entra (W50, W51)", () => {
    expect(ids(`ISIN;Nombre;Valor de mercado\n${GB};AstraZeneca;12.400,00\n${LU};Fondo A;80.000,00`)).toEqual([`${LU}=80000`]);
    expect(ids(`ISIN;Nombre;Divisa;Valor de mercado\n${US};Apple (Xetra);EUR;20.000,00`)).toEqual([`${US}=20000`]);
  });

  it("con «Divisa de referencia: EUR», el resumen dice que lo dice la nota, no la cabecera (W10)", () => {
    const read = readBrokerExport(`Divisa de referencia: EUR\nProducto;ISIN;Divisa;Valor de mercado;Contravalor\nFondo A;${LU};EUR;80.000,00;80.000,00`);
    expect(read.summary.currency).toEqual(["la nota «Divisa de referencia: EUR» dice que «Contravalor» está en EUR"]);
  });
});

describe("selector de columna de importe (B1)", () => {
  const W02 = `ISIN;Nombre;Valor de mercado;Saldo medio EUR\n${LU};Fondo A;80.000,00;78.500,00\n${IE};Fondo B;120.000,00;118.000,00`;

  it("dos candidatas que no se concilian: no se elige; el resumen enseña cada una con su total", () => {
    const read = readBrokerExport(W02);
    expect(read.positions).toEqual([]);
    const [choice] = read.choices;
    expect(choice.kind).toBe("amount");
    expect(choice.chosen).toBeNull();
    expect(choice.options.map((o) => [o.label, o.total, o.positions])).toEqual([
      ["Saldo medio EUR", 196500, 2],
      ["Valor de mercado", 200000, 2],
      ["Ninguna: no importar este bloque", 0, 0]
    ]);
    expect(describeImportSummary(read.summary).some((line) => line.startsWith("Por elegir:"))).toBe(true);
  });

  it("elegida la columna, se lee con ella; «ninguna» no importa el bloque y lo nombra", () => {
    const [choice] = readBrokerExport(W02).choices;
    const market = choice.options.find((o) => o.label === "Valor de mercado")!;
    const chosen = readBrokerExport(W02, { [choice.key]: market.value });
    expect(chosen.positions).toEqual([{ id: LU, amount: 80000 }, { id: IE, amount: 120000 }]);
    expect(pendingChoices(chosen.choices)).toEqual([]);
    expect(chosen.choices[0].chosen).toBe(market.value);
    const none = readBrokerExport(W02, { [choice.key]: NONE_CHOICE });
    expect(none.positions).toEqual([]);
    expect(none.warnings.join(" ")).toContain(`(${LU}, ${IE})`);
  });

  it("una columna de otro momento («Valoración 31/12/2025 EUR») nunca se elige en silencio, aunque no haya filas con que comparar (W04)", () => {
    const read = readBrokerExport(`ISIN;Nombre;Divisa;Valor de mercado;Valoración 31/12/2025 EUR\n${IE};ETF;USD;23.260,00;19.500,00`);
    expect(read.choices[0]?.chosen).toBeNull();
  });

  it("un precio por título («Valor €» = importe / títulos) no es candidata (V18)", () => {
    const read = readBrokerExport(`ISIN;Nombre;Títulos;Valor €;Importe\n${LU};Fondo A;1.000;80,00;80.000,00`);
    expect(read.choices).toEqual([]);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
  });

  it("con otra divisa en el fichero, una fila sin divisa no compara la columna EUR con la que no la dice", () => {
    const text = `ISIN;Nombre;Valor de mercado;Contravalor EUR\n${LU};Fondo A;80.000,00;80.000,00\n${IE};ETF B USD;8.736,00;7.512,09`;
    const read = readBrokerExport(text);
    expect(read.choices).toEqual([]);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }, { id: IE, amount: 7512.09 }]);
  });
});

describe("varios titulares (B5)", () => {
  const W33 = [
    "Cliente: Titular Uno · Contrato 0012345", "ISIN;Nombre;Divisa;Valor de mercado", `${LU};Fondo A;EUR;80.000,00`, `${IE};Fondo B;EUR;120.000,00`, "",
    "Cliente: Titular Dos · Contrato 0067890", "ISIN;Nombre;Divisa;Valor de mercado", `${LU};Fondo A;EUR;50.000,00`, `${FR};Fondo C;EUR;30.000,00`
  ].join("\n");

  it("no se mezclan: nada entra hasta elegir el titular, con el total de cada uno", () => {
    const read = readBrokerExport(W33);
    expect(read.positions).toEqual([]);
    const [choice] = read.choices;
    expect(choice.key).toBe(HOLDER_CHOICE_KEY);
    expect(choice.options.map((o) => [o.label, o.total])).toEqual([
      ["Cliente: Titular Uno · Contrato 0012345", 200000],
      ["Cliente: Titular Dos · Contrato 0067890", 80000],
      ["Ninguno: no importar nada", 0]
    ]);
  });

  it("elegido un titular, solo sus bloques; los del otro se nombran", () => {
    const read = readBrokerExport(W33, { [HOLDER_CHOICE_KEY]: "Cliente: Titular Uno · Contrato 0012345" });
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }, { id: IE, amount: 120000 }]);
    expect(read.warnings.join(" ")).toContain(FR);
  });

  it("varias cuentas de un mismo cliente («Cuenta 1», «Cuenta 2») sí se suman", () => {
    const text = `${sheetMarkerLine("Cuenta 1")}\nISIN;Contravalor EUR\n${LU};80000\n${sheetMarkerLine("Cuenta 2")}\nISIN;Contravalor EUR\n${IE};120000`;
    expect(readBrokerExport(text).choices).toEqual([]);
    expect(ids(text)).toEqual([`${LU}=80000`, `${IE}=120000`]);
  });
});

describe("ningún bloque desaparece (B6) y lo repetido no se suma (I2)", () => {
  it("un bloque con «Ticker» se lee, con el aviso de los códigos (W41)", () => {
    const text = `Fondos\nISIN;Nombre;Valor de mercado EUR\n${LU};Fondo A;80.000,00\n\nAcciones\nTicker;Nombre;Títulos;Valor de mercado EUR\nSAN.MC;Banco Santander;1.000;5.000,00`;
    expect(ids(text)).toEqual([`${LU}=80000`, "SAN.MC=5000"]);
    expect(warnings(text)).toContain("SAN.MC");
  });

  it("un bloque sin identificadores en una tabla con otro que sí los tiene se avisa con sus filas", () => {
    const text = `ISIN;Nombre;Contravalor EUR\n${LU};Fondo A;80.000,00\n\nGestora;Contravalor EUR\nGestora Uno;30.000,00`;
    expect(warnings(text)).toContain("«Gestora Uno»".replace(/«|»/g, ""));
  });

  it("el mismo ISIN con el mismo importe en un bloque de resumen de otra cabecera no se suma (W40)", () => {
    const text = `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n\nDistribución por gestora\nISIN;Gestora;Divisa;Valor de mercado\n${LU};Gestora Uno;EUR;80.000,00`;
    expect(ids(text)).toEqual([]);
    expect(warnings(text)).toContain(`${LU} aparece en 2 filas`);
  });

  it("con un ISIN repetido que se suma, la lista enseña todos sus nombres (W38)", () => {
    const read = readBrokerExport(`ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo Global Clase A;EUR;80.000,00\n${LU};Fondo Global Clase I;EUR;50.000,00`);
    expect(read.euroConfirmation?.positions[0].name).toBe("Fondo Global Clase A + Fondo Global Clase I");
  });
});

describe("lo oculto y los formatos de un libro (I1, B3)", () => {
  it("una hoja oculta y unas filas ocultas no se leen y se nombran", () => {
    const text = spreadsheetSheetsToPositionText([
      { name: "Cartera", rows: [["ISIN", "Contravalor EUR"], [LU, 80000], [FR, 30000]], hiddenRows: [2] },
      { name: "Antigua", rows: [["ISIN", "Contravalor EUR"], [DE, 20000]], hidden: true }
    ]);
    expect(text).toContain(hiddenRowsMarkerLine("Cartera"));
    expect(text).toContain(hiddenSheetMarkerLine("Antigua"));
    const read = readBrokerExport(text);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.warnings.join(" ")).toContain(`(${FR})`);
    expect(read.warnings.join(" ")).toContain(`La hoja oculta «Antigua» no se lee (${DE})`);
  });

  it("una fila oculta de un HTML no se lee y se nombra", () => {
    const read = readBrokerExport(
      `<table><tr><th>ISIN</th><th>Contravalor EUR</th></tr><tr><td>${LU}</td><td>80.000,00</td></tr><tr style="display:none"><td>${FR}</td><td>30.000,00</td></tr></table>`
    );
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.warnings.join(" ")).toContain(FR);
  });

});

describe("el cuadro de Posiciones globales y la lista aplican la misma regla (I6)", () => {
  it("un CSV o un libro se dejan tal cual; un HTML, como texto delimitado que se lee igual", () => {
    const csv = `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00`;
    expect(importBoxText(csv)).toBe(csv);
    const html = `<table><caption>Cartera</caption><tr><th>ISIN</th><th>Nombre</th><th>Contravalor EUR</th></tr><tr><td>${LU}</td><td>Fondo A</td><td>80.000,00</td></tr></table>`;
    const box = importBoxText(html);
    expect(box).not.toContain("<table");
    expect(readBrokerExport(box).positions).toEqual(readBrokerExport(html).positions);
  });

  it("en una lista, la divisa del nombre de una línea solo saca esa línea (novena pasada, I5)", () => {
    const result = parsePositionImport(`${LU};Fondo A;80.000,00\n${IE};ETF B USD;8.736,00`);
    expect(result.entries).toEqual([{ id: LU, amount: 80000 }]);
    expect(result.warnings.join(" ")).toContain(`${IE} (USD en el nombre)`);
  });

  it("una lista con una nota que menciona otra divisa deja fuera las líneas sin «€»", () => {
    const result = parsePositionImport(`Importes en USD\n${LU};Fondo A;80.000,00\n${IE};ETF B;8.736,00`);
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(" ")).toContain(LU);
    expect(result.warnings.join(" ")).toContain(IE);
  });
});
