/* Décima pasada del importador (revisión 9): una prueba unitaria por regla.
   Ningún dato de cliente: ISIN inventados o públicos, nombres de fantasía. */
import { describe, expect, it } from "vitest";
import { readBrokerExport } from "../src/core/brokerPortfolioImport";
import { spreadsheetSheetsToPositionText } from "../src/core/importFileReader";
import { DATE_CHOICE_KEY, HOLDER_CHOICE_KEY, INCLUDE_UNPROVEN_KEY, INCLUDE_UNPROVEN_YES, nextChoiceValues, pendingChoices } from "../src/core/importSummary";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0000120271";
const DE = "DE0005557508";
const IE500 = "IE00B5BMR087";
const IEW = "IE00B4L5Y983";
const ids = (text: string, choices = {}) => readBrokerExport(text, choices).positions.map((p) => `${p.id}=${p.amount}`);
const csv = (lines: string[]) => lines.join("\n");
const usd = ["Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`];
const NO_MENTION = "el fichero no menciona ninguna otra divisa";

function activo(assetId: string): BdbAssetDetail {
  return {
    asset_id: assetId, display_name: `Activo ${assetId}`, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "FULL", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}
  } as unknown as BdbAssetDetail;
}

describe("B1 · una fila que no es una posición no tiene alcance de fila", () => {
  it.each([
    ["una nota con su llamada «(1)» (P01)", csv([...usd, "(1);Importes expresados en dólares estadounidenses (USD);"])],
    ["una nota numerada «1» (P02)", csv([...usd, "1;Importes en USD;"])],
    ["una suma que no empieza por «Total» (P03)", csv([...usd, "Valor total de la cartera (USD);;18040"])],
    ["una fila de total con la divisa (mata M2)", csv([...usd, "TOTAL CARTERA (USD);;18040"])],
    ["la nota tras una línea en blanco (P08)", csv([...usd, "", "(1);Importes en dólares USD"])],
    ["una agrupación con subtotal encima de todo (P05)", csv([usd[0], "Fondos de inversión (USD);;18040", usd[1], usd[2]])]
  ])("%s vale para el fichero o para lo que agrupa: los fondos en USD no entran", (_, text) => {
    const read = readBrokerExport(text);
    expect(read.positions).toEqual([]);
    expect(read.warnings.join(" ")).toContain(IE500);
    expect(read.summary.currency.join(" ")).not.toContain(NO_MENTION);
    expect(read.summary.mentions).toContain("USD");
  });

  it.each([
    ["una suma con una palabra de liquidez (Q01)", csv([...usd, "Saldo total de la cartera (USD);;18040"])],
    ["una suma con «total» en mitad del rótulo y otra cifra", csv([...usd, "Saldo total en cuentas (USD);;99999"])],
    ["una nota con su llamada y «Saldos» (Q02)", csv([...usd, "(1);Saldos expresados en dólares estadounidenses (USD);"])],
    ["un pie «Saldo cuenta de valores» con la suma (Q07)", csv([...usd, "Saldo cuenta de valores (USD);;18040"])]
  ])("undécima pasada (A1): %s vale para el fichero, aunque diga «saldo»", (_, text) => {
    expect(ids(text)).toEqual([]);
    expect(readBrokerExport(text).warnings.join(" ")).toContain(IE500);
  });

  it("un pie con el número de página en la columna del importe (.xlsx, P04)", () => {
    const text = spreadsheetSheetsToPositionText([{ name: "Cartera", rows: [["Producto", "ISIN", "Valor de mercado"], ["ETF S&P 500", IE500, 9304], ["ETF World", IEW, 8736], ["Importes en USD", "", 1]] }]);
    expect(ids(text)).toEqual([]);
  });

  it("una agrupación con subtotal vale solo para lo que agrupa (P10)", () => {
    const text = csv([
      "Producto;ISIN;Valor de mercado",
      "Renta variable Europa (EUR);;110000", `Fondo A;${LU};80000`, `Total SA;${FR};30000`,
      "Renta variable EE.UU. (USD);;18040", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`
    ]);
    const read = readBrokerExport(text);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }, { id: FR, amount: 30000 }]);
    expect(read.summary.unproven?.positions.map((p) => [p.id, p.notes])).toEqual([
      [IE500, ["su agrupación menciona USD"]],
      [IEW, ["su agrupación menciona USD"]]
    ]);
    expect(read.summary.currency.join(" ")).not.toContain(NO_MENTION);
  });

  it("también en HTML, con la agrupación en una celda combinada (P15)", () => {
    const tr = (cells: string[]) => `<tr>${cells.map((c) => (c.startsWith("<td") ? c : `<td>${c}</td>`)).join("")}</tr>`;
    const html = `<table>${tr(["Producto", "ISIN", "Valor de mercado"])}${tr(['<td colspan="2">Fondos en euros</td>', "110.000,00"])}${tr(["Fondo A", LU, "80.000,00"])}${tr(["Total SA", FR, "30.000,00"])}${tr(['<td colspan="2">Fondos en dólares</td>', "18.040,00"])}${tr(["ETF World", IEW, "8.736,00"])}${tr(["ETF S&amp;P", IE500, "9.304,00"])}</table>`;
    expect(ids(html)).toEqual([`${LU}=80000`, `${FR}=30000`]);
  });

  it("una línea de liquidez sigue valiendo solo para su fila (N16)", () => {
    const text = csv(["Producto;ISIN;Valor de mercado", `Fondo A;${LU};80000`, "CUENTA CORRIENTE USD;;1250"]);
    expect(ids(text)).toEqual([`${LU}=80000`]);
    expect(readBrokerExport(text).summary.currency.join(" ")).not.toContain(NO_MENTION);
  });

  it("el resumen no dice que no hay otra divisa cuando la hay en un bloque (P16)", () => {
    const text = csv(["Producto;ISIN;Valor de mercado", `Fondo A;${LU};80000`, "", "USD", ...usd]);
    const read = readBrokerExport(text);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.summary.currency.join(" ")).not.toContain(NO_MENTION);
  });
});

describe("B2 · titulares de los extractos de bancos españoles", () => {
  const two = (a: string, b: string) =>
    csv([a, "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, `Fondo B;${IE};120000`, "", b, "Producto;ISIN;Valor de mercado EUR", `Fondo C;${FR};30000`, `Fondo D;${DE};20000`]);

  it.each([
    ["Titular/es: Juan García López y María Pérez Ruiz", "Titular/es: Luis Gómez Sanz"],
    ["1er Titular: JUAN GARCIA LOPEZ", "1er Titular: MARIA PEREZ RUIZ"],
    ["2º Titular: Juan García López", "2º Titular: Luis Gómez Sanz"],
    ["Interviniente: Juan García López", "Interviniente: Luis Gómez Sanz"],
    ["D. JUAN GARCIA LOPEZ", "Dña. MARIA PEREZ RUIZ"],
    ["Nº de cliente: 123456", "Nº de cliente: 654321"],
    ["Cuenta de valores 0049-1234-56-1234567890 · Titular: JUAN GARCIA LOPEZ", "Cuenta de valores 0049-9876-54-0987654321 · Titular: MARIA PEREZ RUIZ"]
  ])("«%s» y «%s» no se mezclan: hay que elegir", (a, b) => {
    const read = readBrokerExport(two(a, b));
    expect(read.positions).toEqual([]);
    expect(pendingChoices(read.choices)[0].options.map((option) => option.label)).toEqual([a, b, "Ninguno: no importar nada"]);
    expect(ids(two(a, b), { [HOLDER_CHOICE_KEY]: a })).toEqual([`${LU}=80000`, `${IE}=120000`]);
  });

  it("«D.» sin un nombre de persona detrás no es un titular", () => {
    expect(readBrokerExport(two("D. Renta Fija", "D. Renta Variable")).choices).toEqual([]);
  });
});

describe("I6 · una columna «Cliente» con dos personas", () => {
  const text = csv(["Cliente;Producto;ISIN;Valor de mercado EUR", `Ana Ruiz;Fondo A;${LU};80000`, `Ana Ruiz;Fondo B;${IE};120000`, `Luis Gómez;Fondo C;${FR};30000`]);

  it("en Posiciones globales se acumula, como el Legacy", () => {
    expect(readBrokerExport(text).choices).toEqual([]);
    expect(ids(text)).toHaveLength(3);
  });

  it("en el Constructor pregunta de qué cliente es la cartera", async () => {
    const r = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, resolveAsset: activo });
    expect(r.imported_positions).toEqual([]);
    expect(r.import_choices?.[0].options.map((option) => option.label)).toEqual(["Ana Ruiz", "Luis Gómez", "Ninguno: no importar nada"]);
    const ana = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, choices: { [HOLDER_CHOICE_KEY]: "Ana Ruiz" }, resolveAsset: activo });
    expect(ana.imported_positions.map((p) => p.asset_id)).toEqual([LU, IE]);
  });

  it("con «Cuenta 1» y «Cuenta 2» se suman también en el Constructor", async () => {
    const accounts = csv(["Cliente;ISIN;Producto;Valor de mercado EUR", `Cuenta 1;${LU};A;50000`, `Cuenta 2;${IE};B;30000`]);
    const r = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text: accounts, resolveAsset: activo });
    expect(r.import_choices).toBeUndefined();
    expect(r.imported_positions).toHaveLength(2);
  });
});

describe("I7 · fechas con el mes abreviado", () => {
  it("«30-sep-2026» y «30-jun-2026» son dos fotos: se elige la fecha (P40)", () => {
    const text = csv([
      "Posición a 30-sep-2026", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, `Fondo B;${IE};120000`,
      "", "Posición a 30-jun-2026", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};78000`, `Fondo B;${IE};118000`
    ]);
    const [choice] = pendingChoices(readBrokerExport(text).choices);
    expect(choice.kind).toBe("date");
    expect(ids(text, { [DATE_CHOICE_KEY]: "2026-09-30" })).toEqual([`${LU}=80000`, `${IE}=120000`]);
  });

  it.each(["sep-2026", "septiembre de 2026", "30.sep.2026"])("«%s» es una fecha", (date) => {
    const text = csv([`Posición ${date}`, "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, "", "Posición a 30/06/2026", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};78000`]);
    expect(pendingChoices(readBrokerExport(text).choices)[0]?.kind).toBe("date");
  });
});

describe("I2 · las opciones cuentan lo que dejan fuera por no decir EUR", () => {
  it("«Valor de mercado» no dice «0 posiciones» cuando sus filas quedan fuera (P22)", () => {
    const text = csv(["Producto;ISIN;Importe (€);Valor de mercado", `Fondo A;${LU};75000;80000`, `Fondo B;${IE};100000;120000`, "", "Nota: cifras en dólares estadounidenses."]);
    const [choice] = pendingChoices(readBrokerExport(text).choices);
    const market = choice.options.find((option) => option.label === "Valor de mercado")!;
    expect(market).toMatchObject({ positions: 0, outside: { positions: 2, total: 200000 } });
  });
});

describe("I1 · la segunda casilla se borra al cambiar otra elección", () => {
  it("nextChoiceValues", () => {
    const included = nextChoiceValues({ titular: "Ana" }, INCLUDE_UNPROVEN_KEY, INCLUDE_UNPROVEN_YES);
    expect(included).toEqual({ titular: "Ana", [INCLUDE_UNPROVEN_KEY]: INCLUDE_UNPROVEN_YES });
    expect(nextChoiceValues(included, "titular", "Luis")).toEqual({ titular: "Luis" });
  });
});

describe("P20 · la misma posición con y sin prueba de EUR", () => {
  const text = csv(["Fondos", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, "", "Subcuenta USD", "Producto;ISIN;Valor de mercado", `Fondo A;${LU};80000`, `ETF S&P 500;${IE500};9304`]);

  it("no se ofrece otra vez, y la segunda casilla no la saca de la lista", () => {
    const read = readBrokerExport(text);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.summary.unproven?.positions.map((p) => p.id)).toEqual([IE500]);
    const included = readBrokerExport(text, { [INCLUDE_UNPROVEN_KEY]: INCLUDE_UNPROVEN_YES });
    expect(included.positions).toEqual([{ id: LU, amount: 80000 }, { id: IE500, amount: 9304 }]);
    expect(included.warnings.join(" ")).toContain("Has incluido 1 posición");
  });
});

describe("marcas invisibles (P29, P30)", () => {
  it("«&lrm;» junto a una cifra y «&ZeroWidthSpace;» junto a un ISIN no estorban", () => {
    const html = `<table><tr><td>Producto</td><td>ISIN</td><td>Valoraci&oacute;n</td></tr><tr><td>Fondo A</td><td>${LU}&ZeroWidthSpace;</td><td>80.000,00 &euro;</td></tr><tr><td>Total SA</td><td>${FR}</td><td>&lrm;30.000,00 &euro;&lrm;</td></tr></table>`;
    expect(ids(html)).toEqual([`${LU}=80000`, `${FR}=30000`]);
  });
});
