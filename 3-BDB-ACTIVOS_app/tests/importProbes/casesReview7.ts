// Copiado de scratchpad/probe7/rev7/probe (cases7.ts) para la batería de
// aceptación de la octava pasada (las 348 sondas con el juez estricto).
// Revisión 7 del importador: extractos sintéticos NUEVOS contra el diseño de la
// séptima pasada. Ningún dato de cliente: ISIN inventados o públicos, nombres
// de fantasía. VERDAD: importe real en EUR por identificador; `null` = posición
// real sin un importe en EUR seguro en el fichero (no debe enseñarse con un
// importe, y si queda fuera, el aviso la nombra). `esperado`: lo que esperaba
// la revisión 7 con la séptima pasada, antes de esta.
import type { ProbeCase } from "./harness";

/** ISIN con su dígito de control (el mismo algoritmo que isinCheckDigitOk). */
export function makeIsin(prefix11: string): string {
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
const XS = "XS1234567891";
const DE = "DE0005557508";
const ES = "ES0113900J37";
const IE500 = "IE00B5BMR087";
const IEW = "IE00B4L5Y983";
const LU2 = "LU2222028099";
const SE = makeIsin("SE000035611");
const CLP = makeIsin("LU188123456");
const GB = "GB0002374006";
const CH = "CH0012005267";
const JP = "JP3633400001";
const US = "US0378331005";
const US2 = "US5949181045";

const html = (rows: string[], caption = "") => `<table>${caption ? `<caption>${caption}</caption>` : ""}\n${rows.join("\n")}\n</table>`;
const tr = (cells: string[], tag = "td") => `<tr>${cells.map((c) => (c.startsWith("<t") ? c : `<${tag}>${c}</${tag}>`)).join("")}</tr>`;

const MILLARES_ES = '_-* #,##0.00\\ _€_-;\\-* #,##0.00\\ _€_-;_-* "-"??\\ _€_-;_-@_-';

/** Cartera grande: n posiciones en EUR (fondos LU/FR/DE con ISIN válido), importes deterministas. */
function bigRows(n: number, seed: number): Array<{ isin: string; name: string; amount: number }> {
  const out: Array<{ isin: string; name: string; amount: number }> = [];
  const prefixes = ["LU", "FR", "DE", "ES", "IE", "LU", "LU", "FR"];
  for (let i = 0; i < n; i += 1) {
    const p = prefixes[i % prefixes.length];
    const isin = makeIsin(`${p}${String(100000000 + seed * 1000 + i).padStart(9, "0")}`);
    const amount = Math.round(((i * 7919 + seed * 104729) % 90000) + 1000) + ((i * 37) % 100) / 100;
    out.push({ isin, name: `Fondo ${p} ${i + 1}`, amount });
  }
  return out;
}
const es = (v: number) => v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
// toLocaleString("es-ES") no agrupa los millares de cuatro cifras: se fuerza a mano.
const eur = (v: number) => {
  const [int, dec] = v.toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
};
void es;

const big200 = bigRows(200, 7);
const big200b = bigRows(200, 11);
const big200c = bigRows(200, 13);

// W30: 15 filas en USD sin contravalor (fuera, con aviso).
const usdIdx30 = new Set([3, 17, 29, 41, 58, 66, 77, 89, 101, 123, 137, 150, 166, 181, 199]);
// W31: tres posiciones en un bloque «Subcuenta USD» al final, sin columna de divisa.
const usd31 = [
  { isin: makeIsin("IE00B5BMR08"), name: "ETF S&P 500 Acc", amount: 23260 },
  { isin: makeIsin("IE00BK5BQT8"), name: "ETF All-World Acc", amount: 41800 },
  { isin: makeIsin("IE00B3RBWM2"), name: "ETF Small Cap Value", amount: 15500 }
];

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
function ansi(text: string): Uint8Array {
  const map: Record<string, number> = { "€": 0x80 };
  return new Uint8Array([...text].map((ch) => (map[ch] ?? (ch.codePointAt(0)! <= 0xff ? ch.codePointAt(0)! : 0x3f))));
}

export const casesR7: ProbeCase[] = [
  // ── A · Una columna equivocada como importe ────────────────────────────────
  { id: "W01", group: "A columna", tema: "«Valoración» y «Valoración 31/12/2025 (EUR)» (la del año pasado), sin columna de divisa",
    text: `ISIN;Fondo;Participaciones;Valoración;Valoración 31/12/2025 (EUR)\n${LU};Fondo A;1.000;80.000,00;75.000,00\n${IE};Fondo B;2.000;120.000,00;110.000,00`,
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "✘: gana la columna EUR del 31/12" },
  { id: "W02", group: "A columna", tema: "«Valor de mercado» y «Saldo medio EUR»",
    text: `ISIN;Nombre;Valor de mercado;Saldo medio EUR\n${LU};Fondo A;80.000,00;78.500,00\n${IE};Fondo B;120.000,00;118.000,00`,
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "✘: gana el saldo medio" },
  { id: "W03", group: "A columna", tema: "Capital riesgo: «Compromiso», «Importe desembolsado EUR» y «Valor de mercado»",
    text: `ISIN;Fondo;Compromiso;Importe desembolsado EUR;Valor de mercado\n${LU};FCR Alfa;100.000,00;60.000,00;72.000,00\n${IE};FCR Beta;200.000,00;150.000,00;141.000,00`,
    truth: { [LU]: 72000, [IE]: 141000 }, esperado: "✘: gana lo desembolsado" },
  { id: "W04", group: "A columna", tema: "Cartera toda en USD («Divisa» USD) con «Valoración 31/12/2025 EUR»: E3 no tiene filas en EUR con que comparar",
    text: `ISIN;Nombre;Divisa;Valor de mercado;Valoración 31/12/2025 EUR\n${IE500};iShares Core S&P 500;USD;23.260,00;19.500,00\n${IEW};iShares Core MSCI World;USD;21.300,00;18.100,00`,
    truth: { [IE500]: null, [IEW]: null }, esperado: "✘: entra la valoración del 31/12 como actual" },
  { id: "W05", group: "A columna", tema: "Informe de cartera modelo: «Valor de mercado» e «Importe objetivo EUR»",
    text: `ISIN;Fondo;Valor de mercado;Importe objetivo EUR;Desviación\n${LU};Fondo A;80.000,00;100.000,00;-20.000,00\n${IE};Fondo B;120.000,00;100.000,00;20.000,00`,
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "✘: gana el objetivo" },
  { id: "W06", group: "A columna", tema: "«Valor de mercado» e «Importe retenido EUR» (embargo), sin columna de divisa",
    text: `ISIN;Nombre;Valor de mercado;Importe retenido EUR\n${LU};Fondo A;80.000,00;5.000,00\n${IE};Fondo B;120.000,00;7.500,00`,
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "✘: gana lo retenido" },
  { id: "W07", group: "A columna", tema: "Control de W06 con «Divisa» EUR: E3 lo para",
    text: `ISIN;Nombre;Divisa;Valor de mercado;Importe retenido EUR\n${LU};Fondo A;EUR;80.000,00;5.000,00\n${IE};Fondo B;EUR;120.000,00;7.500,00`,
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "∅⚠ (bloque no leído)" },
  { id: "W08", group: "A columna", tema: "«Importe (€)» (lo invertido) junto a «Valor de mercado»",
    text: `ISIN;Nombre;Títulos;Importe (€);Valor de mercado\n${LU};Fondo A;1.000;75.000,00;80.000,00\n${IE};Fondo B;2.000;100.000,00;120.000,00`,
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "✘: gana «Importe (€)»; S21 solo mira «Contravalor»" },
  { id: "W54", group: "A columna", tema: "«Importe» (lo invertido) y «Valor efectivo EUR» (el de mercado): gana «Importe» por rango",
    text: `ISIN;Nombre;Títulos;Importe;Valor efectivo EUR
${LU};Fondo A;1.000;75.000,00;80.000,00
${IE};Fondo B;2.000;100.000,00;120.000,00`,
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "✘ (gris): dos columnas que podrían ser el importe y no coinciden; se elige en silencio" },
  { id: "W09", group: "A columna", tema: "Control: «Valoración» y «Valoración 31/12/2025», ninguna dice EUR",
    text: `ISIN;Fondo;Valoración;Valoración 31/12/2025\n${LU};Fondo A;80.000,00;75.000,00\n${IE};Fondo B;120.000,00;110.000,00`,
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "∅⚠ (no coinciden)" },

  // ── C · El resumen dice algo que no es ─────────────────────────────────────
  { id: "W10", group: "C resumen", tema: "«Divisa de referencia: EUR» y «Contravalor» a secas: ¿qué criterio enseña el resumen?",
    text: `Divisa de referencia: EUR\nProducto;ISIN;Divisa;Valor de mercado;Contravalor\nFondo A;${LU};EUR;80.000,00;80.000,00\nETF B;${IE};USD;8.736,00;7.512,09`,
    truth: { [LU]: 80000, [IE]: 7512.09 }, esperado: "✔, pero el criterio dice «la cabecera «Contravalor» dice EUR»" },

  // ── B · Indicios de divisa que la regla no ve ──────────────────────────────
  { id: "W11", group: "B divisa", tema: "Nota al pie «Importes expresados en dólares estadounidenses (USD)», sin columna de divisa",
    text: `ISIN;Nombre;Títulos;Valor de mercado\n${LU};Fondo A;1.000;93.040,00\n${IE};ETF B;100;8.736,00\nImportes expresados en dólares estadounidenses (USD)`,
    truth: { [LU]: null, [IE]: null }, esperado: "✘" },
  { id: "W12", group: "B divisa", tema: "Título «Moneda de la cartera: USD»",
    text: `Cartera 0012345 · Moneda de la cartera: USD\nISIN;Nombre;Valor de mercado\n${LU};Fondo A;93.040,00\n${IE};ETF B;8.736,00`,
    truth: { [LU]: null, [IE]: null }, esperado: "✘" },
  { id: "W13", group: "B divisa", tema: "«Divisa de referencia:;USD;Fecha:;…» en una fila de cuatro celdas, «Valor local» y «Contravalor» a secas",
    text: `Divisa de referencia:;USD;Fecha:;16/10/2026\nProducto;ISIN;Divisa;Valor local;Contravalor\nFondo A;${LU};EUR;80.000,00;93.040,00\nETF B;${IE};USD;8.736,00;8.736,00`,
    truth: { [LU]: 80000, [IE]: null }, esperado: "✘: LU entra por 93.040 (el contravalor en USD)" },
  { id: "W14", group: "B divisa", tema: "HTML con <caption>«Cartera valorada en USD»</caption>",
    text: html([tr(["ISIN", "Nombre", "Valor de mercado"], "th"), tr([LU, "Fondo A", "93.040,00"]), tr([IE, "ETF B", "8.736,00"])], "Cartera valorada en USD"),
    truth: { [LU]: null, [IE]: null }, esperado: "✘" },
  { id: "W15", group: "B divisa", tema: ".xlsx con la hoja «Cuenta USD», «Valor de mercado» sin divisa",
    sheets: [{ name: "Cuenta USD", rows: [["ISIN", "Nombre", "Valor de mercado"], [LU, "Fondo A", 93040], [IE, "ETF B", 8736]] }],
    truth: { [LU]: null, [IE]: null }, esperado: "✘ (la hoja sale en «Leído»)" },
  { id: "W16", group: "B divisa", tema: "Título de bloque «Subcuenta en dólares (USD)» sobre la cabecera",
    text: `Subcuenta en dólares (USD)\nISIN;Nombre;Valor de mercado\n${LU};Fondo A;93.040,00\n${IE};ETF B;8.736,00`,
    truth: { [LU]: null, [IE]: null }, esperado: "✘" },
  { id: "W17", group: "B divisa", tema: "Dos bloques con la misma cabecera: «Cuenta EUR» con «€» en cada fila y «Cuenta USD» sin «€»",
    text: `Cuenta EUR\nISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00 €\n${FR};Fondo C;40.000,00 €\n\nCuenta USD\nISIN;Nombre;Valor de mercado\n${IE};ETF B;8.736,00\n${IE500};ETF S&P 500;12.000,00`,
    truth: { [LU]: 80000, [FR]: 40000, [IE]: null, [IE500]: null }, esperado: "✘: «€ en las demás filas» solo mira su bloque" },
  { id: "W18", group: "B divisa", tema: "Divisa en palabras que la regla no conoce: «(coronas suecas)» en el nombre",
    text: `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00\n${SE};Fondo Índice Suecia (coronas suecas);95.000,00`,
    truth: { [LU]: 80000, [SE]: null }, esperado: "✘" },
  { id: "W19", group: "B divisa", tema: "Código ISO que la regla del nombre no conoce: «… CLP Acc»",
    text: `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00\n${CLP};Fondo Renta Fija Chile CLP Acc;7.450.000,00`,
    truth: { [LU]: 80000, [CLP]: null }, esperado: "✘" },
  { id: "W20", group: "B divisa", tema: "La cabecera del precio dice «Precio (USD)»; el valor de mercado, sin divisa",
    text: `ISIN;Nombre;Títulos;Precio (USD);Valor de mercado\n${IE500};iShares Core S&P 500;20;436,80;8.736,00\n${IEW};iShares Core MSCI World;100;93,04;9.304,00`,
    truth: { [IE500]: null, [IEW]: null }, esperado: "✘" },
  { id: "W21", group: "B divisa", tema: "Inglés: «Price (USD)» y «Market value»",
    text: `ISIN,Security,Quantity,Price (USD),Market value\n${IE500},"iShares Core S&P 500",20,436.80,"8,736.00"\n${IEW},"iShares Core MSCI World",100,93.04,"9,304.00"`,
    truth: { [IE500]: null, [IEW]: null }, esperado: "✘" },
  { id: "W22", group: "B divisa", tema: "Columna «Cód. mon.» con códigos numéricos ISO 4217 (978 / 840)",
    text: `ISIN;Nombre;Cód. mon.;Valor de mercado\n${LU};Fondo A;978;80.000,00\n${IE};ETF B;840;8.736,00`,
    truth: { [LU]: 80000, [IE]: null }, esperado: "✘ en IE" },
  { id: "W23", group: "B divisa", tema: "Tipo de cambio con la cabecera «T/C» (1,1630 en la fila en dólares)",
    text: `ISIN;Nombre;Valor de mercado;T/C\n${LU};Fondo A;80.000,00;1,0000\n${IE};ETF B;8.736,00;1,1630`,
    truth: { [LU]: 80000, [IE]: null }, esperado: "✘ en IE" },
  { id: "W24", group: "B divisa", tema: "Tipo de cambio con la cabecera «Paridad»",
    text: `ISIN;Nombre;Valor de mercado;Paridad\n${LU};Fondo A;80.000,00;1\n${IE};ETF B;8.736,00;1,1630`,
    truth: { [LU]: 80000, [IE]: null }, esperado: "✘ en IE" },
  { id: "W25", group: "C resumen", tema: "«Divisa» en blanco en una fila de un fichero con EUR y USD",
    text: `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};ETF B;USD;8.736,00\n${XS};Bono C 2031;;5.600,00`,
    truth: { [LU]: 80000, [IE]: null, [XS]: null }, esperado: "✘ en XS; y el criterio dice «el fichero no trae ninguna columna de divisa»" },
  { id: "W26", group: "B divisa", tema: "«Valor de mercado (1)» y la nota «(1) En la divisa de cotización de cada valor»",
    text: `ISIN;Nombre;Valor de mercado (1)\n${LU};Fondo A;80.000,00\n${IE};ETF B;8.736,00\n(1) En la divisa de cotización de cada valor.`,
    truth: { [LU]: 80000, [IE]: null }, esperado: "✘ en IE" },
  { id: "W27", group: "B divisa", tema: ".xlsx: formato con letras escapadas «#,##0.00\\ \\U\\S\\D» en la fila en dólares (la celda enseña «8.736,00 USD»)",
    sheets: [{ name: "Posiciones", rows: [["ISIN", "Nombre", "Valor de mercado"], [LU, "Fondo A", 80000], [IE, "ETF B", 8736]],
      fmt: { C2: "#,##0.00\\ \\€", C3: "#,##0.00\\ \\U\\S\\D" } }],
    truth: { [LU]: 80000, [IE]: null }, esperado: "✘ en IE" },
  { id: "W27b", group: "B divisa", tema: ".xlsx: solo la fila en dólares lleva formato, «#,##0.00\\ \\U\\S\\D» (Excel enseña «8.736,00 USD»); la otra, sin formato",
    sheets: [{ name: "Posiciones", rows: [["ISIN", "Nombre", "Valor de mercado"], [LU, "Fondo A", 80000], [IE, "ETF B", 8736]],
      fmt: { C3: "#,##0.00\\ \\U\\S\\D" } }],
    truth: { [LU]: 80000, [IE]: null }, esperado: "✘ en IE: el formato dice USD y el lector no lo ve" },
  { id: "W28", group: "B divisa", tema: "Control de W27: «#,##0.00\\ \"USD\"» entre comillas",
    sheets: [{ name: "Posiciones", rows: [["ISIN", "Nombre", "Valor de mercado"], [LU, "Fondo A", 80000], [IE, "ETF B", 8736]],
      fmt: { C2: '#,##0.00\\ "€"', C3: '#,##0.00\\ "USD"' } }],
    truth: { [LU]: 80000, [IE]: null }, esperado: "½⚠" },

  // ── D · Ficheros grandes ───────────────────────────────────────────────────
  { id: "W29", group: "D grande", tema: "200 posiciones con «Contravalor EUR» (mezcla EUR / USD)",
    text: ["Producto;ISIN;Divisa;Valor de mercado;Contravalor EUR",
      ...big200.map((r, i) => (i % 9 === 4 ? `${r.name};${r.isin};USD;${eur(r.amount * 1.163)};${eur(r.amount)}` : `${r.name};${r.isin};EUR;${eur(r.amount)};${eur(r.amount)}`))].join("\n"),
    truth: Object.fromEntries(big200.map((r) => [r.isin, r.amount])), esperado: "✔" },
  { id: "W30", group: "D grande", tema: "200 posiciones con «Valor de mercado» y «Divisa»: 15 en USD sin contravalor",
    text: ["Producto;ISIN;Divisa;Valor de mercado", ...big200b.map((r, i) => `${r.name};${r.isin};${usdIdx30.has(i) ? "USD" : "EUR"};${eur(r.amount)}`)].join("\n"),
    truth: Object.fromEntries(big200b.map((r, i) => [r.isin, usdIdx30.has(i) ? null : r.amount])), esperado: "½⚠ (15 fuera, nombradas)" },
  { id: "W31", group: "D grande", tema: "200 posiciones sin divisa (forma «Mercado») y, al final, un bloque «Subcuenta USD» con tres ETF",
    text: ["ISIN;Nombre;Valor de mercado", ...big200c.slice(0, 197).map((r) => `${r.isin};${r.name};${eur(r.amount)}`), "", "Subcuenta USD", "ISIN;Nombre;Valor de mercado",
      ...usd31.map((r) => `${r.isin};${r.name};${eur(r.amount)}`)].join("\n"),
    truth: { ...Object.fromEntries(big200c.slice(0, 197).map((r) => [r.isin, r.amount])), ...Object.fromEntries(usd31.map((r) => [r.isin, null])) },
    esperado: "✘ en los tres ETF, que no se ven entre 200" },

  // ── E · Válidas y descartadas mezcladas ────────────────────────────────────
  { id: "W32", group: "E mezcla", tema: "Andbank-like: EUR, USD con contravalor, GBP sin él, un 0, liquidez, subtotal, una corta, una vacía y el TOTAL",
    text: ["Producto;ISIN;Divisa;Títulos;Valor de mercado;Contravalor EUR",
      `Fondo A;${LU};EUR;1.000;80.000,00;80.000,00`,
      `ETF B;${IE};USD;100;8.736,00;7.512,09`,
      `Bono C;${XS};GBP;50;5.600,00;`,
      `Fondo D;${FR};EUR;500;0,00;0,00`,
      `Liquidez;;EUR;;12.000,00;12.000,00`,
      `Subtotal Fondos;;;;;87.512,09`,
      `Venta en corto F;${DE};EUR;-100;-2.500,00;-2.500,00`,
      `Fondo G;${ES};EUR;200;;`,
      `TOTAL;;;;;99.512,09`].join("\n"),
    truth: { [LU]: 80000, [IE]: 7512.09, [XS]: null, [FR]: null, [DE]: null, [ES]: null }, esperado: "½⚠" },

  // ── F · Dos clientes en un extracto ────────────────────────────────────────
  { id: "W33", group: "F dos clientes", tema: "CSV con dos bloques «Cliente: …», la misma cabecera y un ISIN en los dos",
    text: ["Cliente: Titular Uno · Contrato 0012345", "ISIN;Nombre;Divisa;Valor de mercado", `${LU};Fondo A;EUR;80.000,00`, `${IE};Fondo B;EUR;120.000,00`, "",
      "Cliente: Titular Dos · Contrato 0067890", "ISIN;Nombre;Divisa;Valor de mercado", `${LU};Fondo A;EUR;50.000,00`, `${FR};Fondo C;EUR;30.000,00`, `${DE};Fondo D;EUR;20.000,00`].join("\n"),
    truth: { [LU]: 80000, [IE]: 120000, [FR]: null, [DE]: null }, esperado: "✘: se mezclan los dos clientes; LU suma (con aviso), FR y DE entran sin aviso" },
  { id: "W34", group: "F dos clientes", tema: ".xlsx con una hoja por cliente («Titular Uno», «Titular Dos»)",
    sheets: [
      { name: "Titular Uno", rows: [["ISIN", "Nombre", "Divisa", "Valor de mercado"], [LU, "Fondo A", "EUR", 80000], [IE, "Fondo B", "EUR", 120000]] },
      { name: "Titular Dos", rows: [["ISIN", "Nombre", "Divisa", "Valor de mercado"], [FR, "Fondo C", "EUR", 30000], [DE, "Fondo D", "EUR", 20000]] }
    ],
    truth: { [LU]: 80000, [IE]: 120000, [FR]: null, [DE]: null }, esperado: "✘ (las dos hojas salen en «Leído»)" },
  { id: "W35", group: "F dos clientes", tema: "HTML con dos tablas, <caption>«Titular: …»</caption>",
    text: html([tr(["ISIN", "Nombre", "Contravalor EUR"], "th"), tr([LU, "Fondo A", "80.000,00"]), tr([IE, "Fondo B", "120.000,00"])], "Titular: Titular Uno") + "\n" +
      html([tr(["ISIN", "Nombre", "Contravalor EUR"], "th"), tr([FR, "Fondo C", "30.000,00"]), tr([DE, "Fondo D", "20.000,00"])], "Titular: Titular Dos"),
    truth: { [LU]: 80000, [IE]: 120000, [FR]: null, [DE]: null }, esperado: "✘ («Leído: tabla 1, tabla 2», sin el titular)" },

  // ── G · Importe 0 ──────────────────────────────────────────────────────────
  { id: "W36", group: "G cero", tema: "Posiciones con «0,00», «0», «-» y «n.d.» en el importe",
    text: `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};Fondo B (reembolsado);EUR;0,00\n${FR};Fondo C;EUR;0\n${DE};Fondo D;EUR;-\n${ES};Fondo E;EUR;n.d.`,
    truth: { [LU]: 80000, [IE]: null, [FR]: null, [DE]: null, [ES]: null }, esperado: "½⚠ (cuatro nombradas)" },
  { id: "W37", group: "G cero", tema: ".xlsx «Millares» con un 0 (se ve «-») y una fila sin importe",
    sheets: [{ name: "Posiciones", rows: [["ISIN", "Nombre", "Valor de mercado"], [LU, "Fondo A", 80000], [IE, "Fondo B", 0], [FR, "Fondo C", null]],
      fmt: { C2: MILLARES_ES, C3: MILLARES_ES } }],
    truth: { [LU]: 80000, [IE]: null, [FR]: null }, esperado: "½⚠" },

  // ── H · Mismo ISIN, distinta clase ─────────────────────────────────────────
  { id: "W38", group: "H clase", tema: "El mismo ISIN en dos filas con dos clases («Clase A» y «Clase I»)",
    text: `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo Global Clase A;EUR;80.000,00\n${LU};Fondo Global Clase I;EUR;50.000,00\n${IE};Fondo B;EUR;120.000,00`,
    truth: { [LU]: 130000, [IE]: 120000 }, esperado: "✔ sumado, con aviso; la línea de la confirmación solo dice «Clase A»" },
  { id: "W39", group: "H clase", tema: "Dos clases con ISIN distinto y el mismo nombre",
    text: `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo Global;EUR;80.000,00\n${LU2};Fondo Global;EUR;50.000,00`,
    truth: { [LU]: 80000, [LU2]: 50000 }, esperado: "✔" },
  { id: "W40", group: "H clase", tema: "La misma posición repetida en un segundo bloque «Distribución por gestora» (dos filas, sin «Total»)",
    text: `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};Fondo B;EUR;120.000,00\n\nDistribución por gestora\nISIN;Gestora;Divisa;Valor de mercado\n${LU};Gestora Uno;EUR;80.000,00\n${IE};Gestora Dos;EUR;120.000,00`,
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "✘⚠: se suman (160.000 / 240.000) con el aviso «se suman»" },

  // ── J · Posiciones que se pierden ──────────────────────────────────────────
  { id: "W41", group: "J pérdida", tema: "CSV: bloque de fondos con ISIN y, debajo, bloque de acciones con «Ticker»",
    text: `Fondos\nISIN;Nombre;Valor de mercado EUR\n${LU};Fondo A;80.000,00\n${IE};Fondo B;120.000,00\n\nAcciones\nTicker;Nombre;Títulos;Valor de mercado EUR\nSAN.MC;Banco Santander;1.000;5.000,00\nITX.MC;Inditex;150;7.000,00`,
    truth: { [LU]: 80000, [IE]: 120000, "SAN.MC": 5000, "ITX.MC": 7000 }, esperado: "✘∅: el bloque de acciones desaparece sin aviso" },
  { id: "W42", group: "J pérdida", tema: ".xlsx: hoja «Fondos» con ISIN y hoja «Acciones» con «Ticker»",
    sheets: [
      { name: "Fondos", rows: [["ISIN", "Nombre", "Contravalor EUR"], [LU, "Fondo A", 80000], [IE, "Fondo B", 120000]] },
      { name: "Acciones", rows: [["Ticker", "Nombre", "Títulos", "Contravalor EUR"], ["SAN.MC", "Banco Santander", 1000, 5000], ["ITX.MC", "Inditex", 150, 7000]] }
    ],
    truth: { [LU]: 80000, [IE]: 120000, "SAN.MC": 5000, "ITX.MC": 7000 }, esperado: "✘∅g: aviso de hoja, sin nombrar las acciones" },
  { id: "W43", group: "J pérdida", tema: ".xlsx con una hoja OCULTA «Cartera 31-12-2025» (otra foto, otros ISIN)",
    sheets: [
      { name: "Cartera", rows: [["ISIN", "Nombre", "Contravalor EUR"], [LU, "Fondo A", 80000], [IE, "Fondo B", 120000]] },
      { name: "Cartera 31-12-2025", hidden: true, rows: [["ISIN", "Nombre", "Contravalor EUR"], [FR, "Fondo C (vendido)", 30000], [DE, "Fondo D (vendido)", 20000]] }
    ],
    truth: { [LU]: 80000, [IE]: 120000, [FR]: null, [DE]: null }, esperado: "✘ (la hoja oculta sale en «Leído»)" },
  { id: "W44", group: "J pérdida", tema: ".xlsx con una fila OCULTA (posición vendida que el asesor ocultó)",
    sheets: [{ name: "Cartera", hiddenRows: [2], rows: [["ISIN", "Nombre", "Contravalor EUR"], [LU, "Fondo A", 80000], [FR, "Fondo C (vendido)", 30000], [IE, "Fondo B", 120000]] }],
    truth: { [LU]: 80000, [IE]: 120000, [FR]: null }, esperado: "✘ (zona gris: la fila está en el fichero)" },

  // ── K · Constructor y lectura de ficheros ──────────────────────────────────
  { id: "W45", group: "K Constructor", tema: "Constructor: un ISIN que la maestra no tiene (MISSING_ASSET); ¿cuadra el «Total para comprobar» con el capital?",
    text: `ISIN;Nombre;Contravalor EUR\n${LU};Fondo A;80.000,00\n${IE};Fondo B;120.000,00\n${XS};Bono C;50.000,00`,
    rejectIds: [XS], truth: { [LU]: 80000, [IE]: 120000, [XS]: 50000 }, esperado: "✔ en lo enseñado; el capital cargado es 200.000 con aviso" },
  { id: "W46", group: "K fichero", tema: "HTML en UTF-8 guardado como .html (con <meta charset=utf-8>): la app lo lee en windows-1252",
    text: `<html><head><meta charset="utf-8"></head><body>${html([tr(["ISIN", "Nombre", "Valoración (€)"], "th"), tr([LU, "Fondo Cañada", "80.000,00 €"]), tr([IE, "Fondo B", "120.000,00 €"])])}</body></html>`,
    fileName: "extracto.html", fileBytes: utf8(`<html><head><meta charset="utf-8"></head><body>${html([tr(["ISIN", "Nombre", "Valoración (€)"], "th"), tr([LU, "Fondo Cañada", "80.000,00 €"]), tr([IE, "Fondo B", "120.000,00 €"])])}</body></html>`),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "pegar ✔; fichero: se estropean «ó» y «€»" },
  { id: "W47", group: "K fichero", tema: "CSV de Excel en español («CSV delimitado»: windows-1252) con «Valoración (€)» y «€» en las celdas",
    text: `ISIN;Nombre;Valoración (€)\n${LU};Fondo A;80.000,00 €\n${IE};Fondo B;120.000,00 €`,
    fileName: "extracto.csv", fileBytes: ansi(`ISIN;Nombre;Valoración (€)\n${LU};Fondo A;80.000,00 €\n${IE};Fondo B;120.000,00 €`),
    truth: { [LU]: 80000, [IE]: 120000 }, esperado: "pegar ✔; fichero: se estropean «ó» y «€» (se lee como utf-8)" },

  // ── L · Las decisiones del arreglador, en formatos legítimos ───────────────
  { id: "W48", group: "L decisiones", tema: "«Divisa» EUR en un ETF cubierto con «$» en el nombre («… $ Treasury … EUR Hedged»)",
    text: `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};iShares $ Treasury Bond 7-10yr UCITS ETF EUR Hedged (Dist);EUR;25.000,00`,
    truth: { [LU]: 80000, [IE]: 25000 }, esperado: "½⚠: IE fuera aunque la fila dice EUR (falso positivo con aviso)" },
  { id: "W49", group: "L decisiones", tema: "«€» solo en la primera fila (estilo contable)",
    text: `ISIN;Nombre;Valor de mercado\n${LU};Fondo A;80.000,00 €\n${IE};Fondo B;120.000,00\n${FR};Fondo C;40.000,00`,
    truth: { [LU]: 80000, [IE]: 120000, [FR]: 40000 }, esperado: "½⚠: IE y FR fuera (con aviso)" },
  { id: "W50", group: "L decisiones", tema: "Acciones de EE. UU.: Apple con «Divisa» EUR (Xetra) y Microsoft sin divisa",
    text: `ISIN;Nombre;Divisa;Valor de mercado\n${US};Apple (Xetra);EUR;20.000,00\n${US2};Microsoft;;18.300,00\n${LU};Fondo A;EUR;80.000,00`,
    truth: { [US]: 20000, [US2]: null, [LU]: 80000 }, esperado: "½⚠" },
  { id: "W51", group: "L decisiones", tema: "Acciones de Reino Unido, Suiza y Japón sin divisa (el criterio del ISIN de EE. UU. no se extiende)",
    text: `ISIN;Nombre;Valor de mercado\n${GB};AstraZeneca;12.400,00\n${CH};Nestlé;9.800,00\n${JP};Sony;7.300,00\n${LU};Fondo A;80.000,00`,
    truth: { [GB]: null, [CH]: null, [JP]: null, [LU]: 80000 }, esperado: "✘ (decisión: si el prefijo US vale, GB/CH/JP también)" },
  { id: "W52", group: "L decisiones", tema: "Lista tecleada: «EUR» en medio de una línea y un nombre en la otra",
    text: `${LU};EUR;80.000\n${IEW};iShares Core MSCI World;25.000`,
    truth: { [LU]: 80000, [IEW]: 25000 }, esperado: "½⚠: la segunda fuera" },
  { id: "W53", group: "L decisiones", tema: "Nombre con una palabra que es un código ISO en minúsculas («… Try Fund»)",
    text: `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};Global Industry Try Fund;EUR;30.000,00`,
    truth: { [LU]: 80000, [IE]: 30000 }, esperado: "½⚠ (falso positivo con aviso; la fila dice EUR)" }
];
