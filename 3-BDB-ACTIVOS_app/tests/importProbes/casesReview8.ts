// Copiado de scratchpad/probe8/rev8/probe (cases8.ts) para la batería de
// aceptación de la novena pasada (408 sondas con el juez estricto).
// Revisión 8 del importador: extractos sintéticos NUEVOS contra la regla global
// de divisa y los selectores (columna y titular) de la octava pasada.
// Ningún dato de cliente: ISIN inventados o públicos, nombres de fantasía.
// VERDAD: importe real en EUR por identificador; `null` = posición real sin un
// importe en EUR seguro en el fichero (no debe enseñarse con un importe y, si
// queda fuera, el aviso la nombra). Un id que NO está en la verdad no debe
// enseñarse (p. ej., las posiciones de otro titular). `esperado`: lo que
// esperaba la revisión 8 con la octava pasada, antes de esta; `gris`: el fallo
// dependía de un criterio discutible.
import type { ProbeCase } from "./harness";

function makeIsin(prefix11: string): string {
  const digits = prefix11
    .toUpperCase()
    .split("")
    .map((ch) => (/\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)))
    .join("");
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return `${prefix11.toUpperCase()}${(10 - (sum % 10)) % 10}`;
}

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0000120271";
const DE = "DE0005557508";
const ES = "ES0113900J37";
const IE500 = "IE00B5BMR087";
const IEW = "IE00B4L5Y983";
const LU2 = "LU2222028099";
const XS = "XS1234567891";
const BG = makeIsin("BG110003413");
const AD = makeIsin("AD000000101");
const KY = makeIsin("KYG21234567");
const IECHF = makeIsin("IE00B1CHF23");

const csv = (lines: string[]) => lines.join("\n");
const tr = (cells: string[], tag = "td") => `<tr>${cells.map((c) => (c.startsWith("<t") ? c : `<${tag}>${c}</${tag}>`)).join("")}</tr>`;
const table = (rows: string[], caption = "") => `<table>${caption ? `<caption>${caption}</caption>` : ""}\n${rows.join("\n")}\n</table>`;
/** Andbank «Mercado» (la forma de V36/V38): Producto, ISIN, Mercado, Valor de mercado, sin divisa. */
const mercado = (rows: Array<[string, string, string]>, extra: string[] = []) =>
  table([
    tr(["Producto", "ISIN", "Mercado", "Valor de mercado"]),
    ...rows.map(([name, isin, amount]) => tr([name, isin, "FEX", amount])),
    ...extra,
    tr(["TOTAL", "", "", rows.reduce((s, [, , a]) => s + Number(a), 0).toFixed(2)])
  ]);
const usdRows = [
  ["Producto", "ISIN", "Valor de mercado"],
  ["ETF S&P 500", IE500, 9304],
  ["ETF World", IEW, 8736]
];
const usdTruth = { [IE500]: null, [IEW]: null };

function bytesOf(text: string, map: (code: number, ch: string) => number[]): Uint8Array {
  const out: number[] = [];
  for (const ch of text) out.push(...map(ch.codePointAt(0)!, ch));
  return new Uint8Array(out);
}
const cp1252Bytes = (text: string) =>
  bytesOf(text, (code, ch) => (ch === "€" ? [0x80] : code < 0x100 ? [code] : [0x3f]));
const latin9Bytes = (text: string) => bytesOf(text, (code, ch) => (ch === "€" ? [0xa4] : code < 0x100 ? [code] : [0x3f]));
function utf16leBom(text: string): Uint8Array {
  const out = [0xff, 0xfe];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    out.push(c & 0xff, c >> 8);
  }
  return new Uint8Array(out);
}
const utf8Bom = (text: string) => new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);


export const casesR8: ProbeCase[] = [
  /* ── M · Una mención de otra divisa en un sitio que el escáner quizá no mire ── */
  {
    id: "N01r8", group: "M sitio no mirado", tema: ".xlsx: «Importes en USD» solo en un COMENTARIO de la cabecera «Valor de mercado»",
    sheets: [{ name: "Cartera", rows: usdRows, comments: { C1: "Importes en USD" } }],
    truth: usdTruth, esperado: "el comentario no se mira: entra como EUR", gris: "un comentario solo se ve al pasar el ratón"
  },
  {
    id: "N02r8", group: "M sitio no mirado", tema: ".xlsx: «USD» solo en las PROPIEDADES del libro (Título, Asunto, Palabras clave)",
    sheets: [{ name: "Cartera", rows: usdRows }], props: { Title: "Cartera valorada en USD", Subject: "Divisa: USD", Keywords: "USD" },
    truth: usdTruth, esperado: "metadatos no mirados: entra como EUR", gris: "los metadatos no se ven en la hoja"
  },
  {
    id: "N03r8", group: "M sitio no mirado", tema: ".xlsx: hoja OCULTA «Notas» con «Importes expresados en dólares estadounidenses (USD)»",
    sheets: [{ name: "Cartera", rows: usdRows }, { name: "Notas", rows: [["Importes expresados en dólares estadounidenses (USD)"]], hidden: true }],
    truth: usdTruth, esperado: "la hoja oculta se escanea: todo fuera (∅⚠)"
  },
  {
    id: "N04r8", group: "M sitio no mirado", tema: ".xlsx: una PESTAÑA VACÍA llamada «Importes en USD» junto a la hoja «Cartera»",
    sheets: [{ name: "Cartera", rows: usdRows }, { name: "Importes en USD", rows: [] }],
    truth: usdTruth, esperado: "una hoja vacía no llega al texto: su nombre no se mira y entra como EUR"
  },
  {
    id: "N05r8", group: "M sitio no mirado", tema: "HTML: «Importes en USD» solo en el atributo title (tooltip) de la cabecera",
    text: table([tr(["Producto", "ISIN", '<th title="Importes en USD">Valor de mercado</th>'], "th"), tr(["ETF S&amp;P 500", IE500, "9.304,00"]), tr(["ETF World", IEW, "8.736,00"])]),
    truth: usdTruth, esperado: "el tooltip no se mira: entra como EUR", gris: "un tooltip solo se ve al pasar el ratón"
  },
  {
    id: "N06r8", group: "M sitio no mirado", tema: "HTML: nota con la tilde como entidad («d&oacute;lares estadounidenses»)",
    text: `<p>Importes expresados en d&oacute;lares estadounidenses</p>\n${table([tr(["Producto", "ISIN", "Valor de mercado"]), tr(["ETF S&amp;P 500", IE500, "9.304,00"]), tr(["ETF World", IEW, "8.736,00"])])}`,
    truth: usdTruth, esperado: "las entidades se decodifican: todo fuera (∅⚠)"
  },
  {
    id: "N07r8", group: "M sitio no mirado", tema: "HTML: la divisa como BANDERA (<img alt=\"USD\">) en la columna «Div.»",
    text: table([
      tr(["Producto", "ISIN", "Div.", "Valor de mercado"]),
      tr(["Fondo A", LU, '<td><img src="flags/eu.png" alt="EUR"></td>', "80.000,00"]),
      tr(["ETF S&amp;P 500", IE500, '<td><img src="flags/us.png" alt="USD"></td>', "9.304,00"])
    ]),
    truth: { [LU]: 80000, [IE500]: null }, esperado: "«Div.» en blanco: las dos fuera (∅⚠), sin importe falso"
  },
  {
    id: "N08r8", group: "M sitio no mirado", tema: "CSV sin ninguna mención; solo el NOMBRE del fichero dice USD («posiciones_USD.csv»)",
    text: csv(["Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`]), fileName: "posiciones_USD.csv",
    truth: usdTruth, esperado: "el nombre del fichero no se mira: entra como EUR", gris: "el nombre del fichero no es contenido; al pegar es la clase residual"
  },
  {
    id: "N09r8", group: "M sitio no mirado", tema: "«Divisa: Libra» (singular, sin «esterlina») en el título",
    text: csv(["Divisa: Libra", "Producto;ISIN;Valor de mercado", `Fondo Europa Acc;${LU};8000`, `Fondo Global;${IE};6500`]),
    truth: { [LU]: null, [IE]: null }, esperado: "«libra» en singular no cuenta: entra como EUR"
  },
  {
    id: "N10r8", group: "M sitio no mirado", tema: "Título «Importes en dól. estadounidenses» (abreviatura «dól.»)",
    text: csv(["Importes en dól. estadounidenses", "Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`]),
    truth: usdTruth, esperado: "«dól.» no cuenta: entra como EUR", gris: "abreviatura poco frecuente"
  },
  {
    id: "N11r8", group: "M sitio no mirado", tema: ".xlsx: FILA OCULTA «Importes en USD» encima de la cabecera",
    sheets: [{ name: "Cartera", rows: [["Importes en USD"], ...usdRows], hiddenRows: [0] }],
    truth: usdTruth, esperado: "las filas ocultas se escanean: todo fuera (∅⚠)"
  },

  /* ── F · Una «mención» falsa que expulsa filas en EUR sin necesidad ── */
  {
    id: "N12r8", group: "F mención falsa", tema: "Andbank «Mercado»: cinco fondos en EUR, uno «Fondo Dollar Bond EUR Hedged»",
    text: mercado([["Fondo Renta Fija Euro", LU, "80000.00"], ["Fondo Dollar Bond EUR Hedged", LU2, "50000.00"], ["Fondo Bolsa Europa", FR, "30000.00"], ["Fondo Mixto", ES, "20000.00"], ["Fondo Monetario", DE, "15000.00"]]),
    truth: { [LU]: 80000, [LU2]: 50000, [FR]: 30000, [ES]: 20000, [DE]: 15000 }, esperado: "«Dollar» es una mención: las cinco fuera (∅⚠)"
  },
  {
    id: "N13r8", group: "F mención falsa", tema: "Andbank «Mercado»: «iShares $ Treasury Bond 7-10yr UCITS ETF EUR Hedged (Dist)» y dos fondos en EUR",
    text: mercado([["Fondo Renta Fija Euro", LU, "80000.00"], ["iShares $ Treasury Bond 7-10yr UCITS ETF EUR Hedged (Dist)", IE, "25000.00"], ["Fondo Bolsa Europa", FR, "30000.00"]]),
    truth: { [LU]: 80000, [IE]: 25000, [FR]: 30000 }, esperado: "«$» es una mención: las tres fuera (∅⚠)"
  },
  {
    id: "N14r8", group: "F mención falsa", tema: "Control: «Divisa» EUR en todas las filas y «Fondo X USD Hedged EUR» en el nombre",
    text: csv(["Producto;ISIN;Divisa;Valor de mercado", `Fondo X USD Hedged EUR;${LU2};EUR;50000`, `Fondo Bolsa;${FR};EUR;30000`]),
    truth: { [LU2]: 50000, [FR]: 30000 }, esperado: "todas con prueba de EUR: ✔ (con la nota)"
  },
  {
    id: "N15r8", group: "F mención falsa", tema: "Andbank «Mercado»: «Fondo Libra Patrimonio FI» (singular) y un fondo en EUR",
    text: mercado([["Fondo Renta Fija Euro", LU, "80000.00"], ["Fondo Libra Patrimonio FI", ES, "20000.00"]]),
    truth: { [LU]: 80000, [ES]: 20000 }, esperado: "«Libra» en singular no es una mención: ✔ (clase residual con importes correctos)"
  },
  {
    id: "N16r8", group: "F mención falsa", tema: "Andbank «Mercado» con una línea de liquidez «CUENTA CORRIENTE USD» (sin ISIN) y tres fondos en EUR",
    text: mercado([["Fondo Renta Fija Euro", LU, "80000.00"], ["Fondo Bolsa Europa", FR, "30000.00"], ["Fondo Mixto", ES, "20000.00"]], [tr(["CUENTA CORRIENTE USD", "", "", "1250.00"])]),
    truth: { [LU]: 80000, [FR]: 30000, [ES]: 20000 }, esperado: "la liquidez en USD es una mención: los tres fondos fuera (∅⚠)"
  },
  {
    id: "N17r8", group: "F mención falsa", tema: "Bróker español: «Títulos;Cambio;Valoración» («Cambio» es el precio), sin divisa",
    text: csv(["Producto;ISIN;Títulos;Cambio;Valoración", `Fondo A;${LU};2467,605;32,42;80000`, `Fondo C;${FR};300;100;30000`]),
    truth: { [LU]: 80000, [FR]: 30000 }, esperado: "«Cambio» se lee como tipo de cambio ≠ 1: todo fuera (∅⚠)"
  },
  {
    id: "N18r8", group: "F mención falsa", tema: "Cabecera de precio «Precio EUR/tít.» (parece un par de divisas), sin divisa",
    text: csv(["Producto;ISIN;Títulos;Precio EUR/tít.;Valoración", `Fondo A;${LU};2467,605;32,42;80000`, `Fondo C;${FR};300;100;30000`]),
    truth: { [LU]: 80000, [FR]: 30000 }, esperado: "«EUR/tít.» casa con el patrón de par de divisas: todo fuera (∅⚠)"
  },
  {
    id: "N19r8", group: "F mención falsa", tema: "Andbank «Mercado» con la nota «Las posiciones en dólares se valoran al cambio del día» (es decir, convertidas)",
    text: `${mercado([["Fondo Renta Fija Euro", LU, "80000.00"], ["Fondo Bolsa Europa", FR, "30000.00"]])}\n<p>Las posiciones en dólares se valoran al cambio del día.</p>`,
    truth: { [LU]: 80000, [FR]: 30000 }, esperado: "«dólares» en la nota: todo fuera (∅⚠)"
  },
  {
    id: "N20r8", group: "F mención falsa", tema: "Control: «Mercado» con «JPM US SELECT EQUITY PLUS A (ACC) EUR HEDGED» y «AMUNDI MSCI USA ESG LEADERS EUR HEDGED»",
    text: mercado([["JPM US SELECT EQUITY PLUS A (ACC) EUR HEDGED", LU, "80000.00"], ["AMUNDI MSCI USA ESG LEADERS EUR HEDGED", FR, "30000.00"]]),
    truth: { [LU]: 80000, [FR]: 30000 }, esperado: "«US» y «USA» no son menciones: ✔"
  },
  {
    id: "N21r8", group: "F mención falsa", tema: "«Mercado» con un ISIN irlandés cuyo SEDOL contiene «CHF» entre cifras (IE00B1CHF23x)",
    text: mercado([["Fondo Renta Fija Euro", LU, "80000.00"], ["ETF Europa", IECHF, "30000.00"]]),
    truth: { [LU]: 80000, [IECHF]: 30000 }, esperado: "si el ISIN se escanea, «CHF» es una mención: todo fuera", gris: "teórico: un SEDOL así es raro"
  },
  {
    id: "N22r8", group: "F mención falsa", tema: "Control: «Mercado» con «Tipo de cambio» 1,0000 en todas las filas",
    text: table([
      tr(["Producto", "ISIN", "Mercado", "Tipo de cambio", "Valor de mercado"]),
      tr(["Fondo Renta Fija Euro", LU, "FEX", "1,0000", "80000.00"]),
      tr(["Fondo Bolsa Europa", FR, "FEX", "1,0000", "30000.00"])
    ]),
    truth: { [LU]: 80000, [FR]: 30000 }, esperado: "tipo de cambio 1: ninguna mención, ✔"
  },
  {
    id: "N23r8", group: "F mención falsa", tema: "Control: «Divisa» EUR en todas y la nota «Este informe no incluye posiciones en USD»",
    text: csv(["Producto;ISIN;Divisa;Valor de mercado", `Fondo A;${LU};EUR;80000`, `Fondo C;${FR};EUR;30000`, "Este informe no incluye posiciones en USD"]),
    truth: { [LU]: 80000, [FR]: 30000 }, esperado: "mención, pero todas dicen EUR: ✔"
  },
  {
    id: "N24r8", group: "F mención falsa", tema: ".xlsx: formatos con configuración regional, «#,##0.00 [$€-C0A]» en la fila en EUR y «[$$-409]#,##0.00» en la de USD",
    sheets: [{ name: "Cartera", rows: [["Producto", "ISIN", "Valor de mercado"], ["Fondo A", LU, 80000], ["ETF S&P 500", IE500, 9304]], fmt: { C2: "#,##0.00\\ [$€-C0A]", C3: "[$$-409]#,##0.00" } }],
    truth: { [LU]: 80000, [IE500]: null }, esperado: "«€» de la fila EUR es prueba; «$» de la otra la saca (½⚠)"
  },

  /* ── S · Selector de columna ── */
  {
    id: "N25r8", group: "S columna", tema: "W08 («Importe (€)» = lo invertido, «Valor de mercado») + una línea «CUENTA CORRIENTE USD» sin ISIN",
    text: csv(["Producto;ISIN;Importe (€);Valor de mercado", `Fondo A;${LU};75000;80000`, `Fondo B;${IE};100000;120000`, "CUENTA CORRIENTE USD;;;1250"]),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "con una mención, la columna EUR no se compara con la sin divisa: gana «Importe (€)» sin preguntar (✘)"
  },
  {
    id: "N26r8", group: "S columna", tema: "W08 + un fondo «Fondo Dollar Bond EUR Hedged» entre las posiciones",
    text: csv(["Producto;ISIN;Importe (€);Valor de mercado", `Fondo A;${LU};75000;80000`, `Fondo B;${IE};100000;120000`, `Fondo Dollar Bond EUR Hedged;${LU2};45000;50000`]),
    truth: { [LU]: 80000, [IE]: 120000, [LU2]: 50000 }, esperado: "igual que N25 (✘)"
  },
  {
    id: "N27r8", group: "S columna", tema: "Tres candidatas: «Contravalor EUR» = «Valor de mercado», «Importe EUR» (lo invertido), sin divisa",
    text: csv(["Producto;ISIN;Contravalor EUR;Valor de mercado;Importe EUR", `Fondo A;${LU};80000;80000;75000`, `Fondo B;${IE};120000;120000;100000`]),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "selector con tres opciones (⇄✔)"
  },
  {
    id: "N28r8", group: "S columna", tema: "Tres candidatas que cuadran dos a dos (A=B en una fila, A=C en otra, B≠C donde A está en blanco), «Divisa» EUR",
    text: csv([
      "Producto;ISIN;Divisa;Contravalor EUR;Valor de mercado;Valoración",
      `Fondo A;${LU};EUR;80000;80000;`,
      `Fondo B;${IE};EUR;120000;;120000`,
      `Fondo C;${FR};EUR;;50000;45000`
    ]),
    truth: { [LU]: 80000, [IE]: 120000, [FR]: 50000 }, esperado: "sin selector; FR sin respaldo inequívoco: fuera con aviso (½⚠)"
  },
  {
    id: "N29r8", group: "S columna", tema: "Casi iguales por redondeo: «Contravalor EUR» en euros enteros, «Valor de mercado» con céntimos, sin divisa",
    text: csv(["Producto;ISIN;Contravalor EUR;Valor de mercado", `Fondo A;${LU};80000;79999,57`, `Fondo B;${IE};120000;120000,40`]),
    truth: { [LU]: 79999.57, [IE]: 120000.4 }, esperado: "selector (⇄✔), aunque las dos valen al euro"
  },
  {
    id: "N30r8", group: "S columna", tema: "Casi iguales dentro de la tolerancia: 80.000,004 frente a 80.000",
    text: csv(["Producto;ISIN;Contravalor EUR;Valor de mercado", `Fondo A;${LU};80000,004;80000`, `Fondo B;${IE};120000;120000`]),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "sin selector: ✔"
  },
  {
    id: "N31r8", group: "S columna", tema: "Dos bloques: «Fondos» con W08 y «Acciones» con «Valor de mercado EUR»; ¿qué pasa con «Ninguna»?",
    text: csv(["Fondos", "Producto;ISIN;Importe (€);Valor de mercado", `Fondo A;${LU};75000;80000`, `Fondo B;${IE};100000;120000`, "", "Acciones", "Producto;ISIN;Valor de mercado EUR", `Acción C;${FR};30000`]),
    truth: { [LU]: 80000, [IE]: 120000, [FR]: 30000 }, esperado: "selector para «Fondos» (⇄✔); con «Ninguna», LU e IE nombradas"
  },
  {
    id: "N32r8", group: "S columna", tema: "«Valor de mercado» y «Valor efectivo EUR» iguales + una línea «CUENTA CORRIENTE USD»",
    text: csv(["Producto;ISIN;Valor de mercado;Valor efectivo EUR", `Fondo A;${LU};80000;80000`, `Fondo B;${IE};120000;120000`, "CUENTA CORRIENTE USD;;1250;"]),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "gana «Valor de mercado» por rango y, con la mención, todo fuera (∅⚠), con la columna EUR al lado"
  },
  {
    id: "N33r8", group: "S columna", tema: "Control: «Importe EUR» (lo invertido) y «Valor de mercado» con «Divisa» EUR en todas",
    text: csv(["Producto;ISIN;Divisa;Importe EUR;Valor de mercado", `Fondo A;${LU};EUR;75000;80000`, `Fondo B;${IE};EUR;100000;120000`]),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "selector (⇄✔)"
  },
  {
    id: "N34r8", group: "S columna", tema: "«Importe» (lo invertido) y «Efectivo EUR» (el de mercado), sin divisa",
    text: csv(["Producto;ISIN;Títulos;Importe;Efectivo EUR", `Fondo A;${LU};2467,605;75000;80000`, `Fondo B;${IE};1000;100000;120000`]),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "«Efectivo» no es una cabecera de importe: «Importe» es la única candidata (✘)", gris: "«Importe» puede ser el valor"
  },
  {
    id: "N35r8", group: "S columna", tema: "Titular y columna a la vez: dos bloques «Cliente: …» con W08 cada uno",
    text: csv([
      "Cliente: Ana Ruiz · Contrato 111", "Producto;ISIN;Importe (€);Valor de mercado", `Fondo A;${LU};75000;80000`, `Fondo B;${IE};100000;120000`, "",
      "Cliente: Luis Gómez · Contrato 222", "Producto;ISIN;Importe (€);Valor de mercado", `Fondo C;${FR};28000;30000`
    ]),
    truth: { [LU]: 80000, [IE]: 120000 }, alt: [{ [FR]: 30000 }], esperado: "dos elecciones (⇄½⚠)"
  },
  {
    id: "N36r8", group: "S columna", tema: "W08 partido por un salto de página (misma cabecera dos veces): una elección para los dos",
    text: csv(["Producto;ISIN;Importe (€);Valor de mercado", `Fondo A;${LU};75000;80000`, "Página 2", "Producto;ISIN;Importe (€);Valor de mercado", `Fondo B;${IE};100000;120000`]),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "una elección; los totales de la opción cubren las dos páginas (⇄✔)"
  },
  {
    id: "N37r8", group: "S columna", tema: "Control: «Valor de mercado EUR» e «Importe» (lo invertido) + «CUENTA CORRIENTE USD»",
    text: csv(["Producto;ISIN;Valor de mercado EUR;Importe", `Fondo A;${LU};80000;75000`, `Fondo B;${IE};120000;100000`, "CUENTA CORRIENTE USD;;1250;"]),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "gana la columna EUR y es la buena: ✔"
  },

  /* ── H · Titulares ── */
  {
    id: "N38r8", group: "H titular", tema: "Columna «Titular» por fila con dos clientes (informe consolidado de familia)",
    text: csv(["Titular;Producto;ISIN;Valor de mercado EUR", `Ana Ruiz;Fondo A;${LU};80000`, `Ana Ruiz;Fondo B;${IE};120000`, `Luis Gómez;Fondo C;${FR};30000`, `Luis Gómez;Fondo D;${DE};20000`]),
    truth: { [LU]: 80000, [IE]: 120000 }, alt: [{ [FR]: 30000, [DE]: 20000 }], esperado: "la columna «Titular» no se mira: se mezclan (✘)", gris: "el titular va en una columna, no en un título"
  },
  {
    id: "N39r8", group: "H titular", tema: "El mismo titular escrito distinto: «Titular: Juan García López» y «Titular: GARCÍA LÓPEZ, JUAN» (dos cuentas suyas)",
    text: csv(["Titular: Juan García López", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, `Fondo B;${IE};120000`, "", "Titular: GARCÍA LÓPEZ, JUAN", "Producto;ISIN;Valor de mercado EUR", `Fondo C;${FR};30000`]),
    truth: { [LU]: 80000, [IE]: 120000, [FR]: 30000 }, esperado: "dos titulares: hay que elegir uno y el otro queda fuera con aviso (⇄½⚠)"
  },
  {
    id: "N40r8", group: "H titular", tema: "El mismo titular con y sin tilde: «Cliente: Juan García» y «Cliente: Juan Garcia»",
    text: csv(["Cliente: Juan García", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, `Fondo B;${IE};120000`, "", "Cliente: Juan Garcia", "Producto;ISIN;Valor de mercado EUR", `Fondo C;${FR};30000`]),
    truth: { [LU]: 80000, [IE]: 120000, [FR]: 30000 }, esperado: "dos titulares por una tilde (⇄½⚠)"
  },
  {
    id: "N41r8", group: "H titular", tema: "«Titular: Ana Ruiz» y, en el segundo bloque, «Cartera de Luis Gómez»",
    text: csv(["Titular: Ana Ruiz", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, `Fondo B;${IE};120000`, "", "Cartera de Luis Gómez", "Producto;ISIN;Valor de mercado EUR", `Fondo C;${FR};30000`, `Fondo D;${DE};20000`]),
    truth: { [LU]: 80000, [IE]: 120000 }, alt: [{ [FR]: 30000, [DE]: 20000 }], esperado: "el segundo hereda el titular del primero: se mezclan (✘)"
  },
  {
    id: "N42r8", group: "H titular", tema: "HTML: <caption>Titular: Ana Ruiz</caption> y <caption>Posiciones de Luis Gómez</caption>",
    text: [
      table([tr(["Producto", "ISIN", "Valor de mercado EUR"]), tr(["Fondo A", LU, "80.000,00"]), tr(["Fondo B", IE, "120.000,00"])], "Titular: Ana Ruiz"),
      table([tr(["Producto", "ISIN", "Valor de mercado EUR"]), tr(["Fondo C", FR, "30.000,00"]), tr(["Fondo D", DE, "20.000,00"])], "Posiciones de Luis Gómez")
    ].join("\n"),
    truth: { [LU]: 80000, [IE]: 120000 }, alt: [{ [FR]: 30000, [DE]: 20000 }], esperado: "un solo titular reconocido: se mezclan (✘)"
  },
  {
    id: "N43r8", group: "H titular", tema: ".xlsx con una hoja por cliente, con el nombre a secas («Ana Ruiz», «Luis Gómez»)",
    sheets: [
      { name: "Ana Ruiz", rows: [["Producto", "ISIN", "Valor de mercado EUR"], ["Fondo A", LU, 80000], ["Fondo B", IE, 120000]] },
      { name: "Luis Gómez", rows: [["Producto", "ISIN", "Valor de mercado EUR"], ["Fondo C", FR, 30000], ["Fondo D", DE, 20000]] }
    ],
    truth: { [LU]: 80000, [IE]: 120000 }, alt: [{ [FR]: 30000, [DE]: 20000 }], esperado: "las hojas no son titulares: se mezclan (✘)", gris: "un nombre de hoja a secas puede ser una cuenta"
  },
  {
    id: "N44r8", group: "H titular", tema: "El mismo cliente con dos contratos: «Contrato nº 0012345» y «Contrato nº 0067890»",
    text: csv(["Contrato nº 0012345", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, `Fondo B;${IE};120000`, "", "Contrato nº 0067890", "Producto;ISIN;Valor de mercado EUR", `Fondo C;${FR};30000`]),
    truth: { [LU]: 80000, [IE]: 120000, [FR]: 30000 }, esperado: "dos «titulares»: solo uno de los contratos (⇄½⚠)"
  },
  {
    id: "N45r8", group: "H titular", tema: ".xlsx con dos fotos de la misma cartera en hojas «30-09-2026» y «30-06-2026»",
    sheets: [
      { name: "30-09-2026", rows: [["Producto", "ISIN", "Valor de mercado EUR"], ["Fondo A", LU, 80000], ["Fondo B", IE, 120000], ["Fondo C", FR, 30000]] },
      { name: "30-06-2026", rows: [["Producto", "ISIN", "Valor de mercado EUR"], ["Fondo A", LU, 78000], ["Fondo B", IE, 118000], ["Fondo D", DE, 25000]] }
    ],
    truth: { [LU]: 80000, [IE]: 120000, [FR]: 30000 }, esperado: "se suman las dos fotos (✘ o ✘⚠)"
  },
  {
    id: "N46r8", group: "H titular", tema: "Primer bloque sin título (cliente A) y segundo «Titular: Luis Gómez»",
    text: csv(["Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, `Fondo B;${IE};120000`, "", "Titular: Luis Gómez", "Producto;ISIN;Valor de mercado EUR", `Fondo C;${FR};30000`]),
    truth: { [LU]: 80000, [IE]: 120000 }, alt: [{ [FR]: 30000 }], esperado: "un solo titular reconocido: se mezclan (✘)"
  },

  /* ── I · Prefijo del ISIN y clase en otra divisa ── */
  {
    id: "N47r8", group: "I ISIN", tema: "ISIN de la zona euro (LU) con clase «A USD Acc» y «Divisa» EUR",
    text: csv(["Producto;ISIN;Divisa;Valor de mercado", `Fondo Global A USD Acc;${LU2};EUR;8736`, `Fondo Europa;${FR};EUR;30000`]),
    truth: { [LU2]: null, [FR]: 30000 }, esperado: "entra con la nota «el nombre dice USD» (✘n)", gris: "la columna «Divisa» dice EUR"
  },
  {
    id: "N48r8", group: "I ISIN", tema: "ISIN de la zona euro (LU) con clase en USD sin ninguna señal; la otra fila dice «€»",
    text: csv(["Producto;ISIN;Valor de mercado", `Fondo Global A Acc;${LU2};8736`, `Fondo Europa;${FR};30.000,00 €`]),
    truth: { [LU2]: null, [FR]: 30000 }, esperado: "«las demás filas dicen €»: LU2 fuera (½⚠)"
  },
  {
    id: "N49r8", group: "I ISIN", tema: "«Mercado» con un fondo búlgaro (BG, en el euro desde el 1-1-2026)",
    text: mercado([["Fondo Renta Fija Euro", LU, "80000.00"], ["Fondo Bulgaria Euro", BG, "20000.00"]]),
    truth: { [LU]: 80000, [BG]: 20000 }, esperado: "BG no está en la lista: fuera (½⚠), aunque cotiza en euros"
  },
  {
    id: "N50r8", group: "I ISIN", tema: "«Mercado» con un fondo andorrano (AD; Andorra usa el euro)",
    text: mercado([["Fondo Renta Fija Euro", LU, "80000.00"], ["Fondo Andorra Patrimoni", AD, "50000.00"]]),
    truth: { [LU]: 80000, [AD]: 50000 }, esperado: "AD fuera (½⚠)"
  },
  {
    id: "N51r8", group: "I ISIN", tema: "«Mercado» con un fondo de Caimán (KY) en clase EUR",
    text: mercado([["Fondo Renta Fija Euro", LU, "80000.00"], ["Feeder Fund Class E EUR", KY, "40000.00"]]),
    truth: { [LU]: 80000, [KY]: 40000 }, esperado: "KY fuera (½⚠), por diseño"
  },
  {
    id: "N52r8", group: "I ISIN", tema: "Bono XS en USD sin ninguna mención de divisa en el fichero",
    text: csv(["Producto;ISIN;Valor de mercado", `Bono Corp 4,5% 2030;${XS};98500`, `Fondo A;${LU};80000`]),
    truth: { [XS]: null, [LU]: 80000 }, residual: true, esperado: "XS cuenta como zona euro: clase residual (✘r)"
  },

  /* ── E · Codificación ── */
  {
    id: "N53r8", group: "E codificación", tema: "CSV windows-1252 con «€» como 0x80 en las celdas y una fila «8.736,00 $»",
    pasteText: csv(["Producto;ISIN;Valor de mercado", `Fondo A;${LU};80.000,00 €`, `ETF B;${IE500};8.736,00 $`, `Fondo C;${FR};30.000,00 €`]),
    fileBytes: cp1252Bytes(csv(["Producto;ISIN;Valor de mercado", `Fondo A;${LU};80.000,00 €`, `ETF B;${IE500};8.736,00 $`, `Fondo C;${FR};30.000,00 €`])),
    fileName: "extracto.csv", truth: { [LU]: 80000, [IE500]: null, [FR]: 30000 }, esperado: "½⚠ por los tres caminos"
  },
  {
    id: "N54r8", group: "E codificación", tema: "CSV windows-1252 con «Valoración» y la columna «Divisa» con «€» (0x80) o «USD»",
    pasteText: csv(["Producto;ISIN;Divisa;Valoración", `Fondo A;${LU};€;80.000,00`, `ETF B;${IE500};USD;8.736,00`]),
    fileBytes: cp1252Bytes(csv(["Producto;ISIN;Divisa;Valoración", `Fondo A;${LU};€;80.000,00`, `ETF B;${IE500};USD;8.736,00`])),
    fileName: "extracto.csv", truth: { [LU]: 80000, [IE500]: null }, esperado: "½⚠"
  },
  {
    id: "N55r8", group: "E codificación", tema: "CSV ISO-8859-15 (Latin-9: «€» es 0xA4), sin declaración",
    pasteText: csv(["Producto;ISIN;Valor de mercado", `Fondo A;${LU};80.000,00 €`, `Fondo C;${FR};30.000,00 €`]),
    fileBytes: latin9Bytes(csv(["Producto;ISIN;Valor de mercado", `Fondo A;${LU};80.000,00 €`, `Fondo C;${FR};30.000,00 €`])),
    fileName: "extracto.csv", truth: { [LU]: 80000, [FR]: 30000 }, esperado: "0xA4 se lee «¤» (otra divisa): todo fuera en el camino fichero", gris: "Latin-9 es raro hoy"
  },
  {
    id: "N56r8", group: "E codificación", tema: ".xls HTML en windows-1252 que declara <meta charset=\"utf-8\"> (mal etiquetado)",
    pasteText: `<html><head><meta charset="utf-8"></head><body>${table([tr(["Producto", "ISIN", "Valoración (€)"]), tr(["Fondo A", LU, "80.000,00 €"]), tr(["Fondo B", IE, "120.000,00 €"])])}</body></html>`,
    fileBytes: cp1252Bytes(`<html><head><meta charset="utf-8"></head><body>${table([tr(["Producto", "ISIN", "Valoración (€)"]), tr(["Fondo A", LU, "80.000,00 €"]), tr(["Fondo B", IE, "120.000,00 €"])])}</body></html>`),
    fileName: "extracto.xls", truth: { [LU]: 80000, [IE]: 120000 }, esperado: "se respeta la declaración falsa: «Valoraci�n (�)»; master (windows-1252 forzado) lo leía"
  },
  {
    id: "N57r8", group: "E codificación", tema: "Excel «Texto Unicode» (UTF-16LE con BOM, tabuladores)",
    pasteText: "Producto\tISIN\tValor de mercado EUR\nFondo A\t" + LU + "\t80000\nFondo B\t" + IE + "\t120000",
    fileBytes: utf16leBom("Producto\tISIN\tValor de mercado EUR\r\nFondo A\t" + LU + "\t80000\r\nFondo B\t" + IE + "\t120000\r\n"),
    fileName: "extracto.txt", truth: { [LU]: 80000, [IE]: 120000 }, esperado: "UTF-16 no se detecta: no se lee nada en el camino fichero"
  },
  {
    id: "N58r8", group: "E codificación", tema: "CSV UTF-8 con BOM y «Valoración (€)»",
    pasteText: csv(["Producto;ISIN;Valoración (€)", `Fondo A;${LU};80.000,00`, `Fondo B;${IE};120.000,00`]),
    fileBytes: utf8Bom(csv(["Producto;ISIN;Valoración (€)", `Fondo A;${LU};80.000,00`, `Fondo B;${IE};120.000,00`])),
    fileName: "extracto.csv", truth: { [LU]: 80000, [IE]: 120000 }, esperado: "✔"
  },
  {
    id: "N59r8", group: "M sitio no mirado", tema: "HTML: la cabecera «Valor de mercado (&pound;)» con la libra como entidad con nombre",
    text: table([tr(["Producto", "ISIN", "Valor de mercado (&pound;)"]), tr(["Fondo Europa Acc", LU, "8.000,00"]), tr(["Fondo Global", IE, "6.500,00"])]),
    truth: { [LU]: null, [IE]: null }, esperado: "«&pound;» no se decodifica: ni cabecera extranjera ni mención; entra como EUR"
  },
  {
    id: "N60r8", group: "E codificación", tema: "HTML: cabecera «Valoraci&oacute;n» (tilde como entidad con nombre), importes en EUR",
    text: table([tr(["Producto", "ISIN", "Valoraci&oacute;n"]), tr(["Fondo A", LU, "80.000,00"]), tr(["Fondo B", IE, "120.000,00"])]),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "«valoraci&oacute;n» no se reconoce como cabecera de importe: nada entra (∅⚠)"
  }
];
