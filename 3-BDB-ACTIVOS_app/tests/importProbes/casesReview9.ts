// Copiado de scratchpad/probe9rev/probe (cases9.ts) para la batería de
// aceptación de la décima pasada (448 sondas con el juez estricto).
// Revisión 9 del importador: 40 extractos sintéticos NUEVOS contra el alcance de
// las menciones de divisa y la segunda casilla (inclusión explícita) de la
// novena pasada. Ningún dato de cliente: ISIN inventados o públicos, nombres de
// fantasía.
// VERDAD: importe real en EUR por identificador; `null` = posición real sin un
// importe en EUR seguro en el fichero (no debe enseñarse con un importe y, si
// queda fuera, el aviso la nombra). Un id que NO está en la verdad (ni en `alt`)
// no debe enseñarse (p. ej., las posiciones de otro titular).
import type { ProbeCase } from "./harness";

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0000120271";
const DE = "DE0005557508";
const IE500 = "IE00B5BMR087";
const IEW = "IE00B4L5Y983";
const XS = "XS1234567891";
const US = "US0378331005";

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

export const casesR9: ProbeCase[] = [
  /* ── A · Una mención de FICHERO colocada donde parece de FILA ── */
  {
    id: "P01", group: "A fichero como fila", tema: "Nota al pie con la llamada «(1)» en su propia celda, pegada a la última posición: «(1);Importes expresados en dólares estadounidenses (USD)»",
    text: csv(["Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`, "(1);Importes expresados en dólares estadounidenses (USD);"]),
    truth: usdTruth, esperado: "nota del fichero: todo fuera con aviso (∅⚠)"
  },
  {
    id: "P02", group: "A fichero como fila", tema: "Nota al pie numerada «1» en su celda: «1;Importes en USD»",
    text: csv(["Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`, "1;Importes en USD;"]),
    truth: usdTruth, esperado: "nota del fichero (∅⚠)"
  },
  {
    id: "P03", group: "A fichero como fila", tema: "Fila final de suma que no empieza por «Total»: «Valor total de la cartera (USD);;18040»",
    text: csv(["Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`, "Valor total de la cartera (USD);;18040"]),
    truth: usdTruth, esperado: "una fila de total vale para el fichero (∅⚠)"
  },
  {
    id: "P04", group: "A fichero como fila", tema: ".xlsx: pie «Importes en USD» con el número de página (1) en la columna del importe",
    sheets: [{ name: "Cartera", rows: [["Producto", "ISIN", "Valor de mercado"], ["ETF S&P 500", IE500, 9304], ["ETF World", IEW, 8736], ["Importes en USD", "", 1]] }],
    truth: usdTruth, esperado: "pie del fichero (∅⚠)"
  },
  {
    id: "P05", group: "A fichero como fila", tema: "Fila de agrupación con subtotal justo debajo de la cabecera: «Fondos de inversión (USD);;18040»",
    text: csv(["Producto;ISIN;Valor de mercado", "Fondos de inversión (USD);;18040", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`]),
    truth: usdTruth, esperado: "la agrupación vale para lo que agrupa (∅⚠)"
  },
  {
    id: "P06", group: "A fichero como fila", tema: "Columna «Observaciones» con «Todas las cifras en USD» solo en la primera posición",
    text: csv(["Producto;ISIN;Valor de mercado;Observaciones", `ETF S&P 500;${IE500};9304;Todas las cifras en USD`, `ETF World;${IEW};8736;`]),
    truth: usdTruth, esperado: "la frase dice «todas»: vale para el fichero (∅⚠)", gris: "una observación de una fila suele ser de esa fila"
  },
  {
    id: "P07", group: "A fichero como fila", tema: "HTML: fila de pie dentro de la tabla con la llamada y la nota en dos celdas: «<td>(*)</td><td>Valoración en USD</td>»",
    text: html(table([tr(["Producto", "ISIN", "Valor de mercado"], "th"), tr(["ETF S&P 500", IE500, "9.304,00"]), tr(["ETF World", IEW, "8.736,00"]), tr(["(*)", "Valoración en USD", ""])])),
    truth: usdTruth, esperado: "nota del fichero (∅⚠)"
  },
  {
    id: "P08", group: "A fichero como fila", tema: "Control: la misma nota «(1);Importes en dólares USD», pero tras una línea en blanco",
    text: csv(["Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`, "", "(1);Importes en dólares USD"]),
    truth: usdTruth, esperado: "nota del fichero (∅⚠)"
  },

  /* ── B · Una mención de FILA que debería ser de BLOQUE ── */
  {
    id: "P09", group: "B fila como bloque", tema: "Subcuentas como filas con código: «SUBCUENTA USD;0012345-USD;1250» con dos fondos en USD debajo, y «SUBCUENTA EUR;0012345-EUR;500» con dos en EUR",
    text: csv([
      "Producto;ISIN;Valor de mercado",
      "SUBCUENTA USD;0012345-USD;1250", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`,
      "SUBCUENTA EUR;0012345-EUR;500", `Fondo A;${LU};80000`, `Total SA;${FR};30000`
    ]),
    truth: { ...usdTruth, [LU]: 80000, [FR]: 30000, "0012345-USD": null, "0012345-EUR": 500 }, esperado: "la subcuenta USD alcanza a sus fondos: fuera con aviso (½⚠)"
  },
  {
    id: "P10", group: "B fila como bloque", tema: "Agrupaciones con subtotal en mitad del bloque: «Renta variable Europa (EUR);;110000» y «Renta variable EE.UU. (USD);;18040»",
    text: csv([
      "Producto;ISIN;Valor de mercado",
      "Renta variable Europa (EUR);;110000", `Fondo A;${LU};80000`, `Total SA;${FR};30000`,
      "Renta variable EE.UU. (USD);;18040", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`
    ]),
    truth: { ...usdTruth, [LU]: 80000, [FR]: 30000 }, esperado: "la agrupación USD alcanza a sus fondos (½⚠)"
  },
  {
    id: "P11", group: "B fila como bloque", tema: "Línea de liquidez «Saldo efectivo USD;;1250» encima de dos fondos en USD cuyo nombre no lo dice",
    text: csv(["Producto;ISIN;Valor de mercado", "Saldo efectivo USD;;1250", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`]),
    truth: usdTruth, esperado: "la liquidez USD solo dice su fila: los fondos entran como EUR (✘ de diseño)", gris: "una línea de liquidez puede ser solo la liquidez (N16)"
  },
  {
    id: "P12", group: "B fila como bloque", tema: ".xlsx: columna «Divisa» combinada en vertical (USD sobre dos filas, EUR sobre dos)",
    sheets: [{
      name: "Cartera",
      rows: [["Divisa", "Producto", "ISIN", "Valor de mercado"], ["USD", "ETF S&P 500", IE500, 9304], ["", "ETF World", IEW, 8736], ["EUR", "Fondo A", LU, 80000], ["", "Total SA", FR, 30000]],
      merges: ["A2:A3", "A4:A5"]
    }],
    truth: { ...usdTruth, [LU]: 80000, [FR]: 30000 }, esperado: "solo la primera de cada grupo tiene divisa: lo demás fuera con aviso (½⚠)"
  },
  {
    id: "P13", group: "B fila como bloque", tema: "La divisa solo en la fila de agrupación, en la columna «Divisa»: «Fondos USD;;USD;18040» y «Fondos EUR;;EUR;110000»",
    text: csv([
      "Producto;ISIN;Divisa;Valor de mercado",
      "Fondos USD;;USD;18040", `ETF S&P 500;${IE500};;9304`, `ETF World;${IEW};;8736`,
      "Fondos EUR;;EUR;110000", `Fondo A;${LU};;80000`, `Total SA;${FR};;30000`
    ]),
    truth: { ...usdTruth, [LU]: 80000, [FR]: 30000 }, esperado: "en blanco con columna de divisa no es EUR: fuera con aviso (∅⚠)"
  },
  {
    id: "P14", group: "B fila como bloque", tema: ".xlsx: agrupación «Renta variable EE.UU. — USD» con subtotal, después de una de EUR",
    sheets: [{
      name: "Cartera",
      rows: [
        ["Producto", "ISIN", "Valor de mercado"], ["Renta variable Europa", "", 110000], ["Fondo A", LU, 80000], ["Total SA", FR, 30000],
        ["Renta variable EE.UU. — USD", "", 18040], ["ETF S&P 500", IE500, 9304], ["ETF World", IEW, 8736]
      ]
    }],
    truth: { ...usdTruth, [LU]: 80000, [FR]: 30000 }, esperado: "la agrupación USD alcanza a sus fondos (½⚠)"
  },
  {
    id: "P15", group: "B fila como bloque", tema: "HTML: fila de agrupación con subtotal «<td colspan=2>Fondos en dólares</td><td>18.040,00</td>» antes de los fondos en USD",
    text: html(table([
      tr(["Producto", "ISIN", "Valor de mercado"], "th"),
      tr(['<td colspan="2">Fondos en euros</td>', "110.000,00"]), tr(["Fondo A", LU, "80.000,00"]), tr(["Total SA", FR, "30.000,00"]),
      tr(['<td colspan="2">Fondos en dólares</td>', "18.040,00"]), tr(["ETF S&amp;P 500", IE500, "9.304,00"]), tr(["ETF World", IEW, "8.736,00"])
    ])),
    truth: { ...usdTruth, [LU]: 80000, [FR]: 30000 }, esperado: "la agrupación alcanza a sus fondos (½⚠)"
  },
  {
    id: "P16", group: "B fila como bloque", tema: "Control: dos bloques y el segundo con el título «USD» a secas",
    text: csv(["Producto;ISIN;Valor de mercado", `Fondo A;${LU};80000`, `Total SA;${FR};30000`, "", "USD", "Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`, `ETF World;${IEW};8736`]),
    truth: { ...usdTruth, [LU]: 80000, [FR]: 30000 }, esperado: "mención de bloque: solo el segundo fuera (½⚠)"
  },

  /* ── C · La segunda casilla por otra vía (el resto, en la pantalla) ── */
  {
    id: "P17", group: "C 2.ª casilla", tema: "Dos titulares; el bloque de Luis lleva «Subcuenta USD». Con Ana elegida y la 2.ª casilla, ¿entra algo de Luis?",
    text: csv([...holderA("Titular: Ana Ruiz"), "", "Titular: Luis Gómez", "Subcuenta USD", "Producto;ISIN;Valor de mercado", `ETF S&P 500;${IE500};9304`]),
    truth: truthA, alt: [{ [IE500]: null }], esperado: "elegir titular; la casilla no trae lo del otro (⇄✔)"
  },
  {
    id: "P18", group: "C 2.ª casilla", tema: "Nota del fichero en dólares + W08 en «Fondos» y «Acciones» en EUR. Con «Ninguna» en «Fondos» y la 2.ª casilla, ¿vuelve «Fondos»?",
    text: csv([
      "Nota: las posiciones en dólares se valoran al cambio del día.", "Fondos", "Producto;ISIN;Importe (€);Valor de mercado", `Fondo A;${LU};75000;80000`, `Fondo B;${IE};100000;120000`,
      "", "Acciones", "Producto;ISIN;Valor de mercado EUR", `Total SA;${FR};30000`
    ]),
    truth: { [LU]: 80000, [IE]: 120000, [FR]: 30000 }, esperado: "elegir columna (⇄); con «Ninguna», la casilla no trae «Fondos»"
  },
  {
    id: "P19", group: "C 2.ª casilla", tema: ".xlsx con dos fotos («30-09-2026», «30-06-2026») y «Importes en USD» en la de junio. Con septiembre y la 2.ª casilla, ¿entra junio?",
    sheets: [
      { name: "30-09-2026", rows: [["Producto", "ISIN", "Valor de mercado"], ["Fondo A", LU, 80000], ["Fondo B", IE, 120000]] },
      { name: "30-06-2026", rows: [["Importes en USD"], ["Producto", "ISIN", "Valor de mercado"], ["Fondo A", LU, 78000], ["Fondo B", IE, 118000]] }
    ],
    truth: { [LU]: null, [IE]: null }, esperado: "elegir fecha; mención del fichero: todo fuera; la casilla solo trae septiembre"
  },
  {
    id: "P20", group: "C 2.ª casilla", tema: "El mismo ISIN en un bloque con EUR y en un bloque «Subcuenta USD»",
    text: csv(["Fondos", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, "", "Subcuenta USD", "Producto;ISIN;Valor de mercado", `Fondo A;${LU};80000`, `ETF S&P 500;${IE500};9304`]),
    truth: { [LU]: 80000, [IE500]: null }, esperado: "sin casilla, LU 80.000; con ella, lo que enseña es lo que entra"
  },
  {
    id: "P21", group: "C 2.ª casilla", tema: "Columna «Titular» con dos clientes y una nota del fichero en USD. Con Ana y la 2.ª casilla, ¿entra Luis?",
    text: csv(["Importes en USD salvo indicación", "Titular;Producto;ISIN;Valor de mercado", `Ana Ruiz;Fondo A;${LU};80000`, `Ana Ruiz;Fondo B;${IE};120000`, `Luis Gómez;Fondo C;${FR};30000`, `Luis Gómez;Fondo D;${DE};20000`]),
    truth: { [LU]: null, [IE]: null }, alt: [{ [FR]: null, [DE]: null }], esperado: "elegir titular; la casilla no trae al otro"
  },
  {
    id: "P22", group: "C 2.ª casilla", tema: "W08 con una nota del fichero en dólares, un solo bloque: ¿qué dicen las opciones y qué trae la casilla?",
    text: csv(["Producto;ISIN;Importe (€);Valor de mercado", `Fondo A;${LU};75000;80000`, `Fondo B;${IE};100000;120000`, "", "Nota: cifras en dólares estadounidenses."]),
    truth: { [LU]: null, [IE]: null }, esperado: "elegir columna; con «Valor de mercado», todo fuera e incluible"
  },
  {
    id: "P23", group: "C 2.ª casilla", tema: "Un ISIN US y un XS sin ninguna mención de divisa; el XS es un eurobono en EUR",
    text: csv(["Producto;ISIN;Valor de mercado", `Apple Inc;${US};15000`, `Eurobono 2030;${XS};98500`, `Fondo A;${LU};80000`]),
    truth: { [US]: null, [XS]: 98500, [LU]: 80000 }, esperado: "US y XS fuera con aviso (½⚠); la casilla los trae con su importe"
  },
  {
    id: "P24", group: "C 2.ª casilla", tema: "Andbank 14 col.: «Valor de mercado» y «Contravalor EUR»; la fila en USD con el contravalor en blanco y una nota en dólares",
    text: csv([
      "Producto;ISIN;Valor de mercado;Contravalor EUR", `Fondo A;${LU};80000;80000`, `ETF S&P 500;${IE500};9304;`, `Total SA;${FR};30000;30000`, "", "Nota: los valores en dólares sin contravalor no se han convertido."
    ]),
    truth: { [LU]: 80000, [IE500]: null, [FR]: 30000 }, esperado: "la fila en USD no es incluible con su importe en USD (½⚠)"
  },

  /* ── D · Entidades HTML raras ── */
  {
    id: "P25", group: "D entidades", tema: "HTML: cabecera «Valor de mercado (&dollar;)» (entidad HTML5 con nombre)",
    text: html(table([tr(["Producto", "ISIN", "Valor de mercado (&dollar;)"], "th"), tr(["ETF S&amp;P 500", IE500, "9.304,00"]), tr(["ETF World", IEW, "8.736,00"])])),
    truth: usdTruth, esperado: "cabecera en USD: fuera (∅⚠)"
  },
  {
    id: "P26", group: "D entidades", tema: "HTML: nota fuera de la tabla «Importes en &#36;» (decimal) y «&#x24;» (hexadecimal) en una celda de título",
    text: html(`<p>Importes en &#36;</p>\n${table([tr(['<th colspan="3">Posiciones (&#x24;)</th>']), tr(["Producto", "ISIN", "Valor de mercado"], "th"), tr(["ETF S&amp;P 500", IE500, "9.304,00"]), tr(["ETF World", IEW, "8.736,00"])])}`),
    truth: usdTruth, esperado: "mención del fichero (∅⚠)"
  },
  {
    id: "P27", group: "D entidades", tema: "HTML: «Cifras en &pound» (entidad heredada sin punto y coma) en un párrafo",
    text: html(`<p>Cifras en &pound</p>\n${table([tr(["Producto", "ISIN", "Valor de mercado"], "th"), tr(["Fondo A", LU, "8.000,00"]), tr(["Fondo B", IE, "6.500,00"])])}`),
    truth: { [LU]: null, [IE]: null }, esperado: "«£»: mención del fichero (∅⚠)"
  },
  {
    id: "P28", group: "D entidades", tema: "HTML: doble codificación «Valor de mercado EUR (&amp;pound;)»: el navegador enseña «(&pound;)», no «£»",
    text: html(table([tr(["Producto", "ISIN", "Valor de mercado EUR (&amp;pound;)"], "th"), tr(["Fondo A", LU, "80.000,00"]), tr(["Fondo B", IE, "120.000,00"])])),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "una sola pasada: no hay «£» (✔)", gris: "un texto «&pound;» literal"
  },
  {
    id: "P29", group: "D entidades", tema: "HTML: importes con «&nbsp;», «&#8239;» (espacio fino) y «&lrm;», y «&euro;» detrás",
    text: html(table([
      tr(["Producto", "ISIN", "Valoraci&oacute;n"], "th"),
      tr(["Fondo A", LU, "80&nbsp;000,00&nbsp;&euro;"]), tr(["Fondo B", IE, "120&#8239;000,00 &euro;"]), tr(["Total SA", FR, "&lrm;30.000,00 &euro;&lrm;"])
    ])),
    truth: { [LU]: 80000, [IE]: 120000, [FR]: 30000 }, esperado: "✔"
  },
  {
    id: "P30", group: "D entidades", tema: "HTML: guion blando en la cabecera «Valor de mer&shy;cado EUR» y «&ZeroWidthSpace;» pegado a un ISIN",
    text: html(table([tr(["Producto", "ISIN", "Valor de mer&shy;cado EUR"], "th"), tr(["Fondo A", `${LU}&ZeroWidthSpace;`, "80.000,00"]), tr(["Fondo B", IE, "120.000,00"])])),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "✔ o pérdida con aviso"
  },
  {
    id: "P31", group: "D entidades", tema: "HTML: cabecera «Valor (&curren;)» («¤», la divisa genérica)",
    text: html(table([tr(["Producto", "ISIN", "Valor (&curren;)"], "th"), tr(["Fondo A", LU, "8.000,00"]), tr(["Fondo B", IE, "6.500,00"])])),
    truth: { [LU]: null, [IE]: null }, esperado: "«¤» es otra divisa: fuera (∅⚠)"
  },
  {
    id: "P32", group: "D entidades", tema: "HTML: tabla 1 «Valor de mercado (&#x20AC;)» y tabla 2 con <caption>Posiciones en &yen;</caption>",
    text: html([
      table([tr(["Producto", "ISIN", "Valor de mercado (&#x20AC;)"], "th"), tr(["Fondo A", LU, "80.000,00"]), tr(["Total SA", FR, "30.000,00"])]),
      table([tr(["Producto", "ISIN", "Valor de mercado"], "th"), tr(["ETF World", IEW, "1.200.000"])], "Posiciones en &yen;")
    ].join("\n")),
    truth: { [LU]: 80000, [FR]: 30000, [IEW]: null }, esperado: "tabla 2 fuera (½⚠)"
  },

  /* ── E · Titulares (y una fecha) en formatos de bancos españoles ── */
  {
    id: "P33", group: "E titulares", tema: "«TITULAR: GARCIA LOPEZ JUAN» y «TITULAR: PEREZ RUIZ MARIA» (mayúsculas, sin tildes)",
    text: twoHolders("TITULAR: GARCIA LOPEZ JUAN", "TITULAR: PEREZ RUIZ MARIA"), truth: truthA, alt: altB, esperado: "elegir titular (⇄✔)"
  },
  {
    id: "P34", group: "E titulares", tema: "«Titular/es: Juan García López y María Pérez Ruiz» y «Titular/es: Luis Gómez Sanz»",
    text: twoHolders("Titular/es: Juan García López y María Pérez Ruiz", "Titular/es: Luis Gómez Sanz"), truth: truthA, alt: altB, esperado: "elegir titular (⇄✔)"
  },
  {
    id: "P35", group: "E titulares", tema: "«1er Titular: JUAN GARCIA LOPEZ» y «1er Titular: MARIA PEREZ RUIZ»",
    text: twoHolders("1er Titular: JUAN GARCIA LOPEZ", "1er Titular: MARIA PEREZ RUIZ"), truth: truthA, alt: altB, esperado: "elegir titular (⇄✔)"
  },
  {
    id: "P36", group: "E titulares", tema: "«Interviniente: Juan García López» e «Interviniente: Luis Gómez Sanz»",
    text: twoHolders("Interviniente: Juan García López", "Interviniente: Luis Gómez Sanz"), truth: truthA, alt: altB, esperado: "elegir titular (⇄✔)"
  },
  {
    id: "P37", group: "E titulares", tema: "«D. JUAN GARCIA LOPEZ» y «Dña. MARIA PEREZ RUIZ» como títulos de bloque",
    text: twoHolders("D. JUAN GARCIA LOPEZ", "Dña. MARIA PEREZ RUIZ"), truth: truthA, alt: altB, esperado: "elegir titular (⇄✔)"
  },
  {
    id: "P38", group: "E titulares", tema: "«Nº de cliente: 123456» y «Nº de cliente: 654321»",
    text: twoHolders("Nº de cliente: 123456", "Nº de cliente: 654321"), truth: truthA, alt: altB, esperado: "elegir titular (⇄✔)"
  },
  {
    id: "P39", group: "E titulares", tema: "«Cuenta de valores 0049-1234-56-1234567890 · Titular: JUAN GARCIA LOPEZ» y la misma con otro titular y cuenta",
    text: twoHolders("Cuenta de valores 0049-1234-56-1234567890 · Titular: JUAN GARCIA LOPEZ", "Cuenta de valores 0049-9876-54-0987654321 · Titular: MARIA PEREZ RUIZ"),
    truth: truthA, alt: altB, esperado: "elegir titular o cuenta (⇄✔)"
  },
  {
    id: "P40", group: "E titulares", tema: "Dos fotos en un CSV: «Posición a 30-sep-2026» y «Posición a 30-jun-2026», con las mismas posiciones",
    text: csv([
      "Posición a 30-sep-2026", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};80000`, `Fondo B;${IE};120000`,
      "", "Posición a 30-jun-2026", "Producto;ISIN;Valor de mercado EUR", `Fondo A;${LU};78000`, `Fondo B;${IE};118000`
    ]),
    truth: { [LU]: 80000, [IE]: 120000 }, alt: [{ [LU]: 78000, [IE]: 118000 }], esperado: "elegir fecha (⇄✔)"
  }
];
