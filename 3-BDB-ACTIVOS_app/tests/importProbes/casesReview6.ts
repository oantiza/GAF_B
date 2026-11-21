// Copiado de scratchpad/informe1016/review6_fe/probe (cases6.ts) para la batería de
// aceptación de la séptima pasada (las 293 sondas con el juez estricto).
// Revisión 6 del importador: extractos sintéticos NUEVOS, pensados para engañar
// a la «prueba de EUR» o para saltar la confirmación. Ningún dato de cliente:
// ISIN inventados o públicos. VERDAD: importe real en EUR por identificador;
// `null` = posición real sin un importe en EUR seguro en el fichero (no debe
// enseñarse para confirmar con un importe, y si queda fuera, el aviso la nombra).
import type { ProbeCase } from "./harness";

const LU = "LU1234567891";
const IE = "IE0098765432";
const XS = "XS1234567891";
const XS2 = "XS0098765432";
const FR = "FR0000120271";
const US = "US0378331005";

const two = { [LU]: 80000, [IE]: 120000 };
const usdNull = { [LU]: 80000, [IE]: null };

const html = (rows: string[]) => `<table>\n${rows.join("\n")}\n</table>`;
const tr = (cells: string[], tag = "td") => `<tr>${cells.map((c) => (c.startsWith("<t") ? c : `<${tag}>${c}</${tag}>`)).join("")}</tr>`;

/** Estilo «Millares» de Excel en español (botón «000»): «_€» es un RELLENO del ancho de «€», no se ve en la celda. */
export const MILLARES_ES = '_-* #,##0.00\\ _€_-;\\-* #,##0.00\\ _€_-;_-* "-"??\\ _€_-;_-@_-';
/** «Comma style» de Excel en inglés: sin divisa. */
export const COMMA_EN = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
/** Formato de moneda EUR aplicado por plantilla. */
export const EUR_TEMPLATE = "#,##0.00 [$€-C0A]";

export const casesR6: ProbeCase[] = [
  // ── A · «Contravalor» que no está en euros ────────────────────────────────
  { id: "V01", group: "A contravalor", tema: "«Contravalor» a secas; título «Divisa de referencia: USD»; contravalor en USD",
    text: `Cartera 0012345 · Divisa de referencia: USD\nProducto;ISIN;Divisa;Valor de mercado;Contravalor\nFondo A;${LU};EUR;80.000,00;93.040,00\nETF B;${IE};USD;8.736,00;8.736,00`,
    truth: usdNull },
  { id: "V02", group: "A contravalor", tema: "«Contravalor» a secas con «Div. cuenta» USD (la cuenta es en dólares)",
    text: `Producto;ISIN;Div. cuenta;Divisa;Valor de mercado;Contravalor\nFondo A;${LU};USD;EUR;80.000,00;93.040,00\nETF B;${IE};USD;USD;8.736,00;8.736,00`,
    truth: usdNull },
  { id: "V03", group: "A contravalor", tema: "«Contravalor (USD)» junto a «Valor de mercado» y «Divisa»",
    text: `Producto;ISIN;Divisa;Valor de mercado;Contravalor (USD)\nFondo A;${LU};EUR;80.000,00;93.040,00\nETF B;${IE};USD;8.736,00;8.736,00`,
    truth: usdNull },
  { id: "V04", group: "A contravalor", tema: "«Contravalor USD» y «Valor de mercado», sin columna de divisa",
    text: `Producto;ISIN;Valor de mercado;Contravalor USD\nFondo A;${LU};80.000,00;93.040,00\nETF B;${IE};8.736,00;8.736,00`,
    truth: usdNull },
  { id: "V05", group: "A contravalor", tema: "Columna «Valor EUR/USD» (tipo de cambio) con «Divisa»",
    text: `Producto;ISIN;Divisa;Valor de mercado;Valor EUR/USD\nFondo A;${LU};EUR;80.000,00;1,0000\nETF B;${IE};USD;8.736,00;1,1630`,
    truth: usdNull },
  { id: "V06", group: "A contravalor", tema: "«Importe» sin divisa y un «Cambio EUR/USD» relleno solo en la fila en dólares",
    text: `ISIN;Nombre;Importe;Cambio EUR/USD\n${LU};Fondo A;80.000,00;\n${IE};ETF B;8.736,00;1,1630`,
    truth: usdNull },
  { id: "V07", group: "A contravalor", tema: "HTML: «Contravalor (1)» y nota al pie «en la divisa de referencia de la cartera (USD)»",
    text: html([
      tr(["ISIN", "Nombre", "Divisa", "Valor de mercado", "Contravalor (1)"], "th"),
      tr([LU, "Fondo A", "EUR", "80.000,00", "93.040,00"]),
      tr([IE, "ETF B", "USD", "8.736,00", "8.736,00"]),
      tr(['<td colspan="5">(1) Contravalor en la divisa de referencia de la cartera (USD).</td>'])
    ]),
    truth: usdNull },
  { id: "V08", group: "A contravalor", tema: "Inglés: «Counter value» con «Base currency: USD»",
    text: `Base currency: USD\nSecurity,ISIN,Currency,Market value,Counter value\n"Fund A",${LU},EUR,"80,000.00","93,040.00"\n"ETF B",${IE},USD,"8,736.00","8,736.00"`,
    truth: usdNull },
  { id: "V09", group: "A contravalor", tema: "Control: «Contravalor» con «Divisa de referencia: EUR»",
    text: `Divisa de referencia: EUR\nProducto;ISIN;Divisa;Valor de mercado;Contravalor\nFondo A;${LU};EUR;80.000,00;80.000,00\nETF B;${IE};USD;8.736,00;7.512,09`,
    truth: { [LU]: 80000, [IE]: 7512.09 } },
  { id: "V10", group: "A contravalor", tema: "HTML: grupo «Contravalor» sobre «Moneda | Importe», con Moneda = USD",
    text: html([
      tr(['<th rowspan="2">ISIN</th>', '<th rowspan="2">Nombre</th>', '<th colspan="2">Valor</th>', '<th colspan="2">Contravalor</th>']),
      tr(["Divisa", "Importe", "Moneda", "Importe"], "th"),
      tr([LU, "Fondo A", "EUR", "80.000,00", "USD", "93.040,00"]),
      tr([IE, "ETF B", "USD", "8.736,00", "USD", "8.736,00"])
    ]),
    truth: usdNull },
  { id: "V11", group: "A contravalor", tema: "«Contravalor» (USD) delante de «Contravalor EUR» vacío",
    text: `ISIN;Nombre;Divisa;Valor de mercado;Contravalor;Contravalor EUR\n${LU};Fondo A;EUR;80.000,00;93.040,00;\n${IE};ETF B;USD;8.736,00;8.736,00;`,
    truth: usdNull },
  { id: "V12", group: "A contravalor", tema: "«Contravalor EUR» y «Contravalor» juntos, distintos en la fila USD",
    text: `ISIN;Nombre;Divisa;Contravalor EUR;Contravalor\n${LU};Fondo A;EUR;80.000,00;80.000,00\n${IE};ETF B;USD;7.512,09;8.736,00`,
    truth: { [LU]: 80000, [IE]: 7512.09 } },

  // ── B · Cabecera con «€» sobre un importe que no lo es ────────────────────
  { id: "V13", group: "B cabecera €", tema: "«Importe €» como única columna de importe, con «Divisa» USD (el banco pone la divisa local)",
    text: `ISIN;Nombre;Divisa;Títulos;Importe €\n${LU};Fondo A;EUR;1.000;80.000,00\n${IE};ETF B;USD;100;8.736,00`,
    truth: usdNull, nota: "diseño: el fichero dice «€»/EUR sobre un importe que no lo es" },
  { id: "V14", group: "B cabecera €", tema: "«Importe €» idéntico a «Valor de mercado» en la fila USD (no está convertido)",
    text: `ISIN;Nombre;Divisa;Valor de mercado;Importe €\n${LU};Fondo A;EUR;80.000,00;80.000,00\n${IE};ETF B;USD;8.736,00;8.736,00`,
    truth: usdNull, nota: "diseño: el fichero dice «€»/EUR sobre un importe que no lo es" },
  { id: "V15", group: "B cabecera €", tema: "HTML «Importe &#8364;» con «Divisa» USD",
    text: html([
      tr(["ISIN", "Nombre", "Divisa", "Importe &#8364;"], "th"),
      tr([LU, "Fondo A", "EUR", "80.000,00"]),
      tr([IE, "ETF B", "USD", "8.736,00"])
    ]),
    truth: usdNull, nota: "diseño: el fichero dice «€»/EUR sobre un importe que no lo es" },
  { id: "V16", group: "B cabecera €", tema: "«Precio €» y «Importe» sin divisa (el € del precio no prueba nada)",
    text: `ISIN;Nombre;Precio €;Títulos;Importe\n${LU};Fondo A;80,00;1.000;80.000,00\n${IE};Fondo B;120,00;1.000;120.000,00`,
    truth: two },

  // ── C · Una columna en € que no es el valor de mercado gana a la que sí lo es
  { id: "V17", group: "C otra columna €", tema: "«Valor unitario €» (precio) junto a «Importe» con «Divisa» EUR",
    text: `ISIN;Nombre;Divisa;Títulos;Valor unitario €;Importe\n${LU};Fondo A;EUR;1.000;80,00;80.000,00\n${IE};Fondo B;EUR;2.000;60,00;120.000,00`,
    truth: two },
  { id: "V18", group: "C otra columna €", tema: "«Valor €» (precio por título) junto a «Importe»",
    text: `ISIN;Nombre;Títulos;Valor €;Importe\n${LU};Fondo A;1.000;80,00;80.000,00\n${IE};Fondo B;2.000;60,00;120.000,00`,
    truth: two },
  { id: "V19", group: "C otra columna €", tema: "Lombard: «Valor de garantía EUR» junto a «Valor de mercado» y «Divisa»",
    text: `ISIN;Nombre;Divisa;Valor de mercado;Valor de garantía EUR\n${LU};Fondo A;EUR;80.000,00;56.000,00\n${IE};Fondo B;EUR;120.000,00;60.000,00`,
    truth: two },
  { id: "V20", group: "C otra columna €", tema: "Inglés: «Lending value EUR» junto a «Market value» y «Currency»",
    text: `Security,ISIN,Currency,Market value,Lending value EUR\n"Fund A",${LU},EUR,"80,000.00","56,000.00"\n"ETF B",${IE},USD,"8,736.00","5,258.46"`,
    truth: usdNull },
  { id: "V21", group: "C otra columna €", tema: "Bonos: «Importe nominal EUR» junto a «Valor de mercado»",
    text: `ISIN;Nombre;Divisa;Importe nominal EUR;Precio;Valor de mercado\n${XS};Bono A 2030;EUR;100.000,00;95,50;95.500,00\n${XS2};Bono B 2028;EUR;50.000,00;101,20;50.600,00`,
    truth: { [XS]: 95500, [XS2]: 50600 } },
  { id: "V22", group: "C otra columna €", tema: "«Importe pignorado €» junto a «Valor de mercado»",
    text: `ISIN;Nombre;Divisa;Valor de mercado;Importe pignorado €\n${LU};Fondo A;EUR;80.000,00;30.000,00\n${IE};Fondo B;EUR;120.000,00;120.000,00`,
    truth: two },
  { id: "V23", group: "C otra columna €", tema: "Fondos: «Importe suscrito €» junto a «Valoración»",
    text: `ISIN;Nombre;Divisa;Importe suscrito €;Valoración\n${LU};Fondo A;EUR;75.000,00;80.000,00\n${IE};Fondo B;EUR;130.000,00;120.000,00`,
    truth: two },

  // ── D · Cabecera de grupo con EUR sobre columnas que no lo son ─────────────
  { id: "V24", group: "D grupo EUR", tema: "CSV: fila de grupo «Valoración de la cartera en EUR» sobre «Divisa | Valor de mercado»",
    text: `Valoración de la cartera en EUR;;;;Fecha: 30/09/2026\nISIN;Nombre;Divisa;Valor de mercado;Títulos\n${LU};Fondo A;EUR;80.000,00;1.000\n${IE};ETF B;USD;8.736,00;100`,
    truth: usdNull },
  { id: "V25", group: "D grupo EUR", tema: "HTML: banda «Valoración de la cartera en EUR» (colspan=4) y la fecha",
    text: html([
      tr(['<th colspan="4">Valoración de la cartera en EUR</th>', "<th>30/09/2026</th>"]),
      tr(["ISIN", "Nombre", "Divisa", "Valor de mercado", "Títulos"], "th"),
      tr([LU, "Fondo A", "EUR", "80.000,00", "1.000"]),
      tr([IE, "ETF B", "USD", "8.736,00", "100"])
    ]),
    truth: usdNull },
  { id: "V26", group: "D grupo EUR", tema: "Control: dos filas de cabecera, «Valor de mercado» sobre «(divisa)» y «(€)»",
    text: `ISIN;Nombre;Divisa;Valor de mercado;Valor de mercado\n;;;(divisa);(€)\n${LU};Fondo A;EUR;80.000,00;80.000,00\n${IE};ETF B;USD;8.736,00;7.512,09`,
    truth: { [LU]: 80000, [IE]: 7512.09 } },

  // ── E · Multidivisa con el contravalor solo en el total ───────────────────
  { id: "V27", group: "E total", tema: "EUR y USD sin contravalor por fila; solo el total en EUR",
    text: `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};ETF B;USD;8.736,00\n${US};Apple Inc;USD;23.260,00\nTotal cartera (contravalor EUR);;;107.512,09`,
    truth: { [LU]: 80000, [IE]: null, [US]: null } },
  { id: "V28", group: "E total", tema: "«Valor de mercado» sin divisa con «€» solo en el TOTAL",
    text: `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00\n${IE};Fondo B;120.000,00\nTOTAL;;200.000,00 €`,
    truth: two },

  // ── F · Entidades HTML y celdas con dos divisas ───────────────────────────
  { id: "V29", group: "F HTML/celda", tema: "HTML: «&#160;&#8364;» en la celda EUR y «&#36;» en la USD, sin divisa",
    text: html([
      tr(["ISIN", "Nombre", "Valor de mercado"], "th"),
      tr([LU, "Fondo A", "80.000,00&#160;&#8364;"]),
      tr([IE, "ETF B", "&#36;8,736.00"])
    ]),
    truth: usdNull },
  { id: "V30", group: "F HTML/celda", tema: "HTML: «&#x20AC;» y «&euro» sin punto y coma",
    text: html([
      tr(["ISIN", "Nombre", "Valor de mercado"], "th"),
      tr([LU, "Fondo A", "80.000,00 &#x20AC;"]),
      tr([IE, "Fondo B", "120.000,00 &euro"])
    ]),
    truth: two },
  { id: "V31", group: "F HTML/celda", tema: "HTML: «€» en un <span> oculto (display:none) en la celda USD",
    text: html([
      tr(["ISIN", "Nombre", "Valor de mercado"], "th"),
      tr([LU, "Fondo A", "80.000,00"]),
      tr([IE, "ETF B", '8.736,00<span style="display:none"> €</span>'])
    ]),
    truth: usdNull },
  { id: "V32", group: "F HTML/celda", tema: "Celda «EUR 7.512,09 (USD 8.736,00)» en «Valor de mercado», sin divisa",
    text: `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;EUR 80.000,00\n${IE};ETF B;EUR 7.512,09 (USD 8.736,00)`,
    truth: { [LU]: 80000, [IE]: 7512.09 } },
  { id: "V33", group: "F HTML/celda", tema: "Celda «8.736,00 USD / 7.512,09 EUR» bajo «Contravalor EUR»",
    text: `ISIN;Nombre;Divisa;Contravalor EUR\n${LU};Fondo A;EUR;80.000,00\n${IE};ETF B;USD;8.736,00 USD / 7.512,09 EUR`,
    truth: { [LU]: 80000, [IE]: 7512.09 } },
  { id: "V34", group: "F HTML/celda", tema: "HTML: columna sin rótulo con el símbolo («€» / «$») junto al importe",
    text: html([
      tr(["ISIN", "Nombre", "Valor de mercado", ""], "th"),
      tr([LU, "Fondo A", "80.000,00", "€"]),
      tr([IE, "ETF B", "8.736,00", "$"])
    ]),
    truth: usdNull },
  { id: "V35", group: "F HTML/celda", tema: "«€» solo en las filas en euros; la fila en dólares, sin marca ni columna de divisa",
    text: `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00 €\n${FR};TotalEnergies;5.600,00 €\n${IE};ETF B;8.736,00`,
    truth: { [LU]: 80000, [FR]: 5600, [IE]: null } },

  // ── G · Formato de celda de Excel ─────────────────────────────────────────
  { id: "V36", group: "G formato xlsx", tema: ".xlsx con estilo «Millares» español («_€» es relleno, no se ve «€»), ETF en USD, sin divisa",
    sheets: [{ name: "Posiciones", rows: [["ISIN", "Nombre", "Valor de mercado"], [LU, "Fondo A", 80000], [IE, "ETF B", 8736]], fmt: { C2: MILLARES_ES, C3: MILLARES_ES } }],
    truth: usdNull },
  { id: "V37", group: "G formato xlsx", tema: ".xlsx «Millares» en una cartera de acciones USD (Apple, Microsoft), sin divisa",
    sheets: [{ name: "Cartera", rows: [["ISIN", "Nombre", "Títulos", "Valor de mercado"], [US, "Apple Inc", 100, 23260], ["US5949181045", "Microsoft Corp", 50, 21300]], fmt: { C2: MILLARES_ES, C3: MILLARES_ES, D2: MILLARES_ES, D3: MILLARES_ES } }],
    truth: { [US]: null, US5949181045: null } },
  { id: "V38", group: "G formato xlsx", tema: "Control: .xlsx con «Comma style» inglés (sin divisa), ETF en USD",
    sheets: [{ name: "Posiciones", rows: [["ISIN", "Nombre", "Valor de mercado"], [LU, "Fondo A", 80000], [IE, "ETF B", 8736]], fmt: { C2: COMMA_EN, C3: COMMA_EN } }],
    truth: usdNull },
  { id: "V39", group: "G formato xlsx", tema: ".xlsx «Millares» con «Divisa» (EUR / USD)",
    sheets: [{ name: "Posiciones", rows: [["ISIN", "Nombre", "Divisa", "Valor de mercado"], [LU, "Fondo A", "EUR", 80000], [IE, "ETF B", "USD", 8736]], fmt: { D2: MILLARES_ES, D3: MILLARES_ES } }],
    truth: usdNull },
  { id: "V40", group: "G formato xlsx", tema: ".xlsx con «[$€-C0A]» de plantilla en todas las cifras (también los títulos), valores en USD",
    sheets: [{ name: "Cartera", rows: [["ISIN", "Nombre", "Títulos", "Valor de mercado"], [LU, "Fondo A", 1000, 80000], [US, "Apple Inc", 100, 23260]], fmt: { C2: EUR_TEMPLATE, C3: EUR_TEMPLATE, D2: EUR_TEMPLATE, D3: EUR_TEMPLATE } }],
    truth: { [LU]: 80000, [US]: null }, nota: "diseño: el fichero dice «€»/EUR sobre un importe que no lo es" },

  // ── H · «EUR» en el nombre ────────────────────────────────────────────────
  { id: "V41", group: "H nombre", tema: "«Euro Stoxx 50 USD Acc» y «Fondo Euro Bonos EUR», sin divisa",
    text: `ISIN;Nombre;Valor de mercado\n${LU};Fondo Euro Bonos EUR;80.000,00\n${IE};Euro Stoxx 50 USD Acc;8.736,00`,
    truth: usdNull },
  { id: "V42", group: "H nombre", tema: "Divisa del nombre en minúsculas («… ucits etf usd (acc)»)",
    text: `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00\n${IE};ishares core s&p 500 ucits etf usd (acc);8.736,00`,
    truth: usdNull },

  // ── I · Divisa de la cuenta con un rótulo abreviado o raro ────────────────
  { id: "V43", group: "I divisa cuenta", tema: "«Div. cta.» (la de la cuenta, EUR) y un ETF en USD",
    text: `ISIN;Nombre;Div. cta.;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};ETF B;EUR;8.736,00`,
    truth: usdNull },
  { id: "V44", group: "I divisa cuenta", tema: "Inglés: «Acct ccy» (EUR) y un ETF en USD",
    text: `Security;ISIN;Acct ccy;Market value\nFund A;${LU};EUR;80,000.00\nETF B;${IE};EUR;8,736.00`,
    truth: usdNull },
  { id: "V45", group: "I divisa cuenta", tema: "«Div. liq.» (liquidación, EUR) y un ETF en USD",
    text: `ISIN;Nombre;Div. liq.;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};ETF B;EUR;8.736,00`,
    truth: usdNull },
  { id: "V46", group: "I divisa cuenta", tema: "«Divisa» (EUR, de la cuenta) y «Mda. cotiz.» con «Dólar americano»",
    text: `ISIN;Nombre;Divisa;Mda. cotiz.;Valor de mercado\n${LU};Fondo A;EUR;Euro;80.000,00\n${IE};ETF B;EUR;Dólar americano;8.736,00`,
    truth: usdNull },
  { id: "V47", group: "I divisa cuenta", tema: "Control: «Divisa» (EUR) y «Cotiza en» (USD) por contenido",
    text: `ISIN;Nombre;Divisa;Cotiza en;Valor de mercado\n${LU};Fondo A;EUR;EUR;80.000,00\n${IE};ETF B;EUR;USD;8.736,00`,
    truth: usdNull },
  { id: "V48", group: "I divisa cuenta", tema: "«Divisa» EUR y el precio «87,36 USD» en otra columna",
    text: `ISIN;Nombre;Divisa;Títulos;Precio;Valor de mercado\n${LU};Fondo A;EUR;1.000;80,00 EUR;80.000,00\n${IE};ETF B;EUR;100;87,36 USD;8.736,00`,
    truth: usdNull },
  { id: "V49", group: "I divisa cuenta", tema: "Sin «Divisa»: el precio dice «$» y el valor de mercado no",
    text: `ISIN;Nombre;Títulos;Precio;Valor de mercado\n${LU};Fondo A;1.000;80,00 €;80.000,00\n${IE};ETF B;100;87,36 $;8.736,00`,
    truth: usdNull },

  // ── J · Otros: movimientos, bloques y la confirmación ─────────────────────
  { id: "V50", group: "J otros", tema: "Extracto de MOVIMIENTOS (compras y una venta) con «Importe EUR»",
    text: `Fecha;Operación;ISIN;Nombre;Títulos;Importe EUR\n02/09/2026;Compra;${LU};Fondo A;500;40.000,00\n15/09/2026;Compra;${LU};Fondo A;500;40.000,00\n20/09/2026;Venta;${IE};Fondo B;200;24.000,00\n25/09/2026;Suscripción;${FR};TotalEnergies;100;5.600,00`,
    truth: { [LU]: null, [IE]: null, [FR]: null } },
  { id: "V51", group: "J otros", tema: "Mismo ISIN con prueba (bloque «Contravalor EUR») y sin ella (bloque «Valor de mercado»)",
    text: `ISIN;Nombre;Contravalor EUR\n${LU};Fondo A;50.000,00\n\nISIN;Nombre;Valor de mercado\n${LU};Fondo A;30.000,00\n${IE};Fondo B;120.000,00`,
    truth: two },
  { id: "V52", group: "J otros", tema: ".xlsx: hoja «Cuenta 1» con «Contravalor EUR» y hoja «Cuenta 2» sin divisa",
    sheets: [
      { name: "Cuenta 1", rows: [["ISIN", "Nombre", "Contravalor EUR"], [LU, "Fondo A", 80000]] },
      { name: "Cuenta 2", rows: [["ISIN", "Nombre", "Valor de mercado"], [IE, "Fondo B", 120000]] }
    ],
    truth: two },
  { id: "V53", group: "J otros", tema: "Bloque «Importe (EUR)» y, tras un salto, bloque «Importe (USD)»",
    text: `ISIN;Nombre;Importe (EUR)\n${LU};Fondo A;80.000,00\n\nISIN;Nombre;Importe (USD)\n${IE};ETF B;8.736,00`,
    truth: usdNull },
  { id: "V54", group: "J otros", tema: "Lista tecleada: «€» en la primera línea y no en la segunda (ETF en USD)",
    text: `${LU};Fondo A;80.000,00 €\n${IE};ETF B;8.736,00`,
    truth: usdNull }
];
