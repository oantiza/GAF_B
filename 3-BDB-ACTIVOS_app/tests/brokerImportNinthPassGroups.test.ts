/* Novena pasada del importador (revisión 8): titulares y fechas que no se mezclan
   (B3, I3, M6 y M5). Ningún dato de cliente: ISIN inventados, nombres de fantasía. */
import { describe, expect, it } from "vitest";
import { readBrokerExport } from "../src/core/brokerPortfolioImport";
import { spreadsheetSheetsToPositionText } from "../src/core/importFileReader";
import { DATE_CHOICE_KEY, HOLDER_CHOICE_KEY, NO_HOLDER_CHOICE, pendingChoices } from "../src/core/importSummary";

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0000120271";
const DE = "DE0005557508";
const ids = (text: string, choices = {}) => readBrokerExport(text, choices).positions.map((p) => `${p.id}=${p.amount}`);
const pending = (text: string) => pendingChoices(readBrokerExport(text).choices);
const labels = (text: string) => pending(text).map((choice) => choice.options.map((option) => option.label));
const block = (title: string, rows: Array<[string, number]>) =>
  [title, "Producto;ISIN;Valor de mercado EUR", ...rows.map(([isin, amount], i) => `Fondo ${i + 1};${isin};${amount}`)].filter(Boolean).join("\n");

describe("titulares que se reconocen (B3)", () => {
  it("«Titular: …» y, en el segundo bloque, «Cartera de …»: no se hereda, hay que elegir (N41)", () => {
    const text = `${block("Titular: Ana Ruiz", [[LU, 80000], [IE, 120000]])}\n\n${block("Cartera de Luis Gómez", [[FR, 30000], [DE, 20000]])}`;
    expect(labels(text)).toEqual([["Titular: Ana Ruiz", "Cartera de Luis Gómez", "Ninguno: no importar nada"]]);
    expect(ids(text, { [HOLDER_CHOICE_KEY]: "Titular: Ana Ruiz" })).toEqual([`${LU}=80000`, `${IE}=120000`]);
  });

  it("<caption> «Titular: …» y «Posiciones de …» (N42)", () => {
    const table = (caption: string, isin: string) =>
      `<table><caption>${caption}</caption><tr><th>Producto</th><th>ISIN</th><th>Valor de mercado EUR</th></tr><tr><td>Fondo</td><td>${isin}</td><td>80.000,00</td></tr></table>`;
    expect(labels(table("Titular: Ana Ruiz", LU) + table("Posiciones de Luis Gómez", FR))[0]).toContain("Posiciones de Luis Gómez");
  });

  it("un primer bloque sin título junto a otro con titular: «sin titular» es una opción (N46)", () => {
    const text = `${block("", [[LU, 80000], [IE, 120000]])}\n\n${block("Titular: Luis Gómez", [[FR, 30000]])}`;
    const [choice] = pending(text);
    expect(choice.options.map((option) => option.value)).toEqual([NO_HOLDER_CHOICE, "Titular: Luis Gómez", "ninguna"]);
    expect(ids(text, { [HOLDER_CHOICE_KEY]: NO_HOLDER_CHOICE })).toEqual([`${LU}=80000`, `${IE}=120000`]);
    expect(readBrokerExport(text, { [HOLDER_CHOICE_KEY]: NO_HOLDER_CHOICE }).warnings.join(" ")).toContain(FR);
  });

  it("décima pasada (I5): con dos titulares, una sección sin titular («Acciones») hereda el último: cada opción es la cartera entera", () => {
    const text = `${block("Titular: Ana Ruiz", [[LU, 80000]])}\n\n${block("Acciones", [[IE, 120000]])}\n\n${block("Titular: Luis Gómez", [[FR, 30000]])}\n\n${block("Acciones", [[DE, 20000]])}`;
    expect(pending(text)[0].options.map((option) => [option.value, option.total])).toEqual([
      ["Titular: Ana Ruiz", 200000],
      ["Titular: Luis Gómez", 50000],
      ["ninguna", 0]
    ]);
    expect(ids(text, { [HOLDER_CHOICE_KEY]: "Titular: Ana Ruiz" })).toEqual([`${LU}=80000`, `${IE}=120000`]);
  });

  it("un único titular al principio vale para todo el fichero, también para sus secciones", () => {
    const text = `Titular: Ana Ruiz\n${block("Fondos", [[LU, 80000]])}\n\n${block("Acciones", [[IE, 120000]])}`;
    expect(readBrokerExport(text).choices).toEqual([]);
    expect(ids(text)).toEqual([`${LU}=80000`, `${IE}=120000`]);
  });

  it("un salto de página («Página 2») sigue siendo del mismo titular", () => {
    const text = `${block("Titular: Ana Ruiz", [[LU, 80000]])}\nPágina 2\n${block("", [[IE, 120000]])}\n\n${block("Titular: Luis Gómez", [[FR, 30000]])}`;
    const [choice] = pending(text);
    expect(choice.options.map((option) => [option.label, option.total])).toEqual([
      ["Titular: Ana Ruiz", 200000],
      ["Titular: Luis Gómez", 30000],
      ["Ninguno: no importar nada", 0]
    ]);
  });

  it.each(["Cartera de fondos", "Posiciones de renta fija", "Cartera de Inversión"])("«%s» no es un titular", (title) => {
    const text = `${block("Titular: Ana Ruiz", [[LU, 80000]])}\n\n${block(title, [[IE, 120000]])}`;
    // Con un titular al principio y otro bloque sin titular, todo es de Ana.
    expect(readBrokerExport(text).choices).toEqual([]);
  });

  it("hojas con el nombre de una persona a secas son titulares (N43); «Renta Fija» y «Renta Variable», no", () => {
    const sheets = (a: string, b: string) =>
      spreadsheetSheetsToPositionText([
        { name: a, rows: [["Producto", "ISIN", "Valor de mercado EUR"], ["Fondo A", LU, 80000]] },
        { name: b, rows: [["Producto", "ISIN", "Valor de mercado EUR"], ["Fondo C", FR, 30000]] }
      ]);
    expect(labels(sheets("Ana Ruiz", "Luis Gómez"))).toEqual([["Ana Ruiz", "Luis Gómez", "Ninguno: no importar nada"]]);
    expect(readBrokerExport(sheets("Renta Fija", "Renta Variable")).choices).toEqual([]);
  });

  it("una columna «Titular» con dos titulares es un selector (N38); una «Cliente» del Legacy, no", () => {
    const rows = (header: string) =>
      `${header};Producto;ISIN;Valor de mercado EUR\nAna Ruiz;Fondo A;${LU};80000\nAna Ruiz;Fondo B;${IE};120000\nLuis Gómez;Fondo C;${FR};30000`;
    expect(labels(rows("Titular"))).toEqual([["Ana Ruiz", "Luis Gómez", "Ninguno: no importar nada"]]);
    expect(ids(rows("Titular"), { [HOLDER_CHOICE_KEY]: "Ana Ruiz" })).toEqual([`${LU}=80000`, `${IE}=120000`]);
    expect(readBrokerExport(rows("Titular"), { [HOLDER_CHOICE_KEY]: "Ana Ruiz" }).warnings.join(" ")).toContain(FR);
    expect(readBrokerExport(rows("Cliente")).choices).toEqual([]);
  });
});

describe("el mismo titular escrito distinto (M6)", () => {
  it.each([
    ["Titular: Juan García López", "Titular: GARCÍA LÓPEZ, JUAN"],
    ["Cliente: Juan García", "Cliente: Juan Garcia"],
    ["Titular: Juan  García", "Cliente: juan garcía"]
  ])("«%s» y «%s» son el mismo: se suman sin preguntar", (a, b) => {
    const text = `${block(a, [[LU, 80000], [IE, 120000]])}\n\n${block(b, [[FR, 30000]])}`;
    expect(readBrokerExport(text).choices).toEqual([]);
    expect(ids(text)).toEqual([`${LU}=80000`, `${IE}=120000`, `${FR}=30000`]);
  });
});

describe("dos fotos fechadas de la misma cartera (I3)", () => {
  const snapshot = (name: string, rows: Array<[string, number]>) => ({
    name,
    rows: [["Producto", "ISIN", "Valor de mercado EUR"], ...rows.map(([isin, amount], i) => [`Fondo ${i + 1}`, isin, amount])]
  });

  it("dos hojas con fechas distintas que repiten posiciones no se suman: se elige la fecha (N45)", () => {
    const text = spreadsheetSheetsToPositionText([
      snapshot("30-09-2026", [[LU, 80000], [IE, 120000], [FR, 30000]]),
      snapshot("30-06-2026", [[LU, 78000], [IE, 118000], [DE, 25000]])
    ]);
    const [choice] = pending(text);
    expect(choice.kind).toBe("date");
    expect(choice.options.map((option) => option.label)).toEqual([
      "30/09/2026 (hoja «30-09-2026»)",
      "30/06/2026 (hoja «30-06-2026»)",
      "Ninguna: no importar nada"
    ]);
    expect(ids(text, { [DATE_CHOICE_KEY]: "2026-09-30" })).toEqual([`${LU}=80000`, `${IE}=120000`, `${FR}=30000`]);
    expect(readBrokerExport(text, { [DATE_CHOICE_KEY]: "2026-09-30" }).warnings.join(" ")).toContain(DE);
  });

  it("dos bloques con fechas distintas que no repiten posiciones (fondos y acciones) se suman", () => {
    const text = `${block("Fondos (valor liquidativo a 29/09/2026)", [[LU, 80000]])}\n\n${block("Acciones (cotización a 30/09/2026)", [[IE, 120000]])}`;
    expect(readBrokerExport(text).choices).toEqual([]);
    expect(ids(text)).toEqual([`${LU}=80000`, `${IE}=120000`]);
  });
});

describe("las opciones de titular con una columna por elegir dentro (M5)", () => {
  it("no dicen «0,00 €»: el importe depende de la columna", () => {
    const w08 = (title: string, isin: string) => `${title}\nProducto;ISIN;Importe (€);Valor de mercado\nFondo;${isin};75000;80000`;
    const [choice] = pending(`${w08("Cliente: Ana Ruiz", LU)}\n\n${w08("Cliente: Luis Gómez", FR)}`);
    expect(choice.options[0]).toMatchObject({ label: "Cliente: Ana Ruiz", positions: 1, pendingInside: true });
  });
});
