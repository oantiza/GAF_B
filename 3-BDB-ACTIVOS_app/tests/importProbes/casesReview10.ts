// Copiado de scratchpad/probe10rev/probe (cases10.ts): solo los seis que la undécima pasada
// añade a la batería (Q01, Q02, Q06, Q07: filas que no son posición; Q08, Q09: titulares).
// Revisión 10 (cierre) del importador: 20 extractos sintéticos NUEVOS, solo sobre
// lo que toca la décima pasada: filas que no son posición (notas, sumas,
// agrupaciones que cuadran y que no), titulares de bancos españoles, herencia
// del titular, la segunda casilla al cambiar de elección y fechas en texto.
// Ningún dato de cliente: ISIN inventados o públicos, nombres de fantasía.
// VERDAD: importe real en EUR por identificador; `null` = posición real sin un
// importe en EUR seguro en el fichero. Un id que NO está en la verdad (ni en
// `alt`) no debe enseñarse (p. ej., las posiciones de otro titular).
import type { ProbeCase } from "./harness";

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0000120271";
const DE = "DE0005557508";
const IE500 = "IE00B5BMR087";
const IEW = "IE00B4L5Y983";

const csv = (lines: string[]) => lines.join("\n");
const tr = (cells: string[], tag = "td") => `<tr>${cells.map((c) => (c.startsWith("<t") ? c : `<${tag}>${c}</${tag}>`)).join("")}</tr>`;
const table = (rows: string[], caption = "") => `<table>${caption ? `<caption>${caption}</caption>` : ""}\n${rows.join("\n")}\n</table>`;
const html = (body: string) => `<html><head><meta charset="utf-8"></head><body>\n${body}\n</body></html>`;

const usdTruth = { [IE500]: null, [IEW]: null };
const holderA = (title: string) => [title, "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, `Fondo B;${IE};120000`];
const holderB = (title: string) => [title, "Producto;ISIN;Valor de mercado EUR", `Fondo C;${FR};30000`, `Fondo D;${DE};20000`];
const twoHolders = (a: string, b: string) => csv([...holderA(a), "", ...holderB(b)]);
const truthA = { [LU]: 80000, [IE]: 120000 };
const altB = [{ [FR]: 30000, [DE]: 20000 }];

export const casesR10: ProbeCase[] = [
  {
    id: "Q01", group: "A fila que no es posición", tema: "Fila final de suma con una palabra de liquidez: «Saldo total de la cartera (USD);;18040»",
    text: csv(["Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`, "Saldo total de la cartera (USD);;18040"]),
    truth: usdTruth, esperado: "es una suma, vale para el fichero (∅⚠)"
  },
  {
    id: "Q02", group: "A fila que no es posición", tema: "Nota al pie con la llamada en su celda y «Saldos» en el texto: «(1);Saldos expresados en dólares estadounidenses (USD)»",
    text: csv(["Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`, "(1);Saldos expresados en dólares estadounidenses (USD);"]),
    truth: usdTruth, esperado: "nota del fichero (∅⚠)"
  },
  {
    id: "Q06", group: "A fila que no es posición", tema: "HTML: fila de total «<td colspan=2>Valor efectivo total (USD)</td><td>18.040,00</td>» («efectivo» = valor de mercado)",
    text: html(table([
      tr(["Producto", "ISIN", "Efectivo"], "th"),
      tr(["ETF S&amp;P 500", IE500, "9.304,00"]), tr(["ETF World", IEW, "8.736,00"]),
      tr(['<td colspan="2">Valor efectivo total (USD)</td>', "18.040,00"])
    ])),
    truth: usdTruth, esperado: "es un total: vale para el fichero (∅⚠)"
  },
  {
    id: "Q07", group: "A fila que no es posición", tema: ".xlsx: pie «Saldo cuenta de valores (USD)» con la suma en la columna del importe",
    sheets: [{ name: "Posición", rows: [["Producto", "ISIN", "Valor de mercado"], ["ETF S&P 500", IE500, 9304], ["ETF World", IEW, 8736], ["Saldo cuenta de valores (USD)", "", 18040]] }],
    truth: usdTruth, esperado: "es una suma: vale para el fichero (∅⚠)"
  },
  {
    id: "Q08", group: "B titulares", tema: "«Titular(es): JUAN GARCIA LOPEZ» y «Titular(es): MARIA PEREZ RUIZ»",
    text: twoHolders("Titular(es): JUAN GARCIA LOPEZ", "Titular(es): MARIA PEREZ RUIZ"),
    truth: truthA, alt: altB, esperado: "elegir titular (⇄✔)"
  },
  {
    id: "Q09", group: "B titulares", tema: "«D. JUAN GARCÍA LÓPEZ» y «D.ª MARÍA PÉREZ RUIZ» (la abreviatura de la RAE)",
    text: twoHolders("D. JUAN GARCÍA LÓPEZ", "D.ª MARÍA PÉREZ RUIZ"),
    truth: truthA, alt: altB, esperado: "elegir titular (⇄✔)"
  }
];
