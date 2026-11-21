// Copiado de scratchpad/informe1016/review5_fe/probe (casesNew.ts) para la batería de
// aceptación de la sexta pasada (las 239 sondas con el juez estricto).
// Revisión de la cuarta pasada: extractos sintéticos NUEVOS (no están en las 87
// sondas del arreglador). ISIN inventados, salvo IE00B4L5Y983 y US0378331005,
// públicos. Ningún dato de cliente.
//
// Cada caso lleva su VERDAD: el importe en EUR por identificador; `null` = no hay
// un importe en EUR seguro (importarlo es un error).
import * as XLSX from "xlsx";
import { spreadsheetRowsToDelimitedText } from "../../src/core/importFileReader";

export const LU = "LU1234567891";
export const IE = "IE0098765432";
export const XS = "XS1234567891";
export const XS2 = "XS0098765432";
export const IEW = "IE00B4L5Y983";
export const AAPL = "US0378331005";

export type Truth = Record<string, number | null>;
export interface Case {
  id: string;
  tema: string;
  text: string;
  truth: Truth;
  /** Ids que el lector puede producir y que, si llegan con su importe correcto, no son un error de importe (id no resoluble). */
  alias?: Record<string, number>;
}

const two: Truth = { [LU]: 80000, [IE]: 120000 };
const usd: Truth = { [LU]: 80000, [IE]: 7512.09 };
const usdNull: Truth = { [LU]: 80000, [IE]: null };

/** Igual que `readSpreadsheetSheets` + `spreadsheetRowsToDelimitedText` (primera hoja), con las mismas opciones de SheetJS. */
function xlsxToText(sheets: Array<{ name: string; rows: unknown[][]; fmt?: Record<string, string> }>): string {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    for (const [addr, z] of Object.entries(sheet.fmt ?? {})) if (ws[addr]) ws[addr].z = z;
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const read = XLSX.read(buffer, { type: "array", cellDates: true });
  const first = read.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(read.Sheets[first], { header: 1, defval: null, raw: true, UTC: true });
  return spreadsheetRowsToDelimitedText(rows);
}

export const cases: Case[] = [
  // ── A · Formatos numéricos ────────────────────────────────────────────────
  {
    id: "N01", tema: "CSV en inglés (Inversis/IB), miles con coma entre comillas y sin decimales",
    text: 'Security,ISIN,Currency,Quantity,Market value EUR\n"Fund A",LU1234567891,EUR,100,"80,000"\n"ETF B",IE0098765432,USD,50,"7,512.09"',
    truth: usd
  },
  {
    id: "N02", tema: "CSV en inglés, todos los importes enteros «80,000» / «120,000»",
    text: 'Security,ISIN,Market value EUR\n"Fund A",LU1234567891,"80,000"\n"Fund B",IE0098765432,"120,000"',
    truth: two
  },
  {
    id: "N03", tema: "Lombard: apóstrofo suizo ASCII «80'000.00»",
    text: "Security;ISIN;Ccy;Market value in EUR\nFund A;LU1234567891;EUR;80'000.00\nETF B;IE0098765432;USD;7'512.09",
    truth: usd
  },
  {
    id: "N04", tema: "Pictet: apóstrofo tipográfico U+2019 «80’000.00»",
    text: "Security;ISIN;Ccy;Market value in EUR\nFund A;LU1234567891;EUR;80’000.00\nETF B;IE0098765432;USD;7’512.09",
    truth: usd
  },
  {
    id: "N05", tema: "Negativo con signo al final «1.234,56-»",
    text: "Producto;ISIN;Contravalor EUR\nA;LU1234567891;80.000,00\nB;IE0098765432;1.234,56-\nC;XS1234567891;120.000,00",
    truth: { [LU]: 80000, [IE]: null, [XS]: 120000 }
  },
  {
    id: "N06", tema: "Miles con espacio «80 000,00» y cabecera «Code ISIN»",
    text: "Titre;Code ISIN;Devise;Contravalor EUR\nFonds A;LU1234567891;EUR;80 000,00\nETF B;IE0098765432;USD;7 512,09",
    truth: usd
  },
  {
    id: "N07", tema: "Lombard en francés: «Valeur de marché» y «Contre-valeur EUR»",
    text: "Titre;Code ISIN;Devise;Valeur de marché;Contre-valeur EUR\nFonds A;LU1234567891;EUR;80 000,00;80 000,00\nETF B;IE0098765432;USD;8 736,00;7 512,09",
    truth: usd
  },
  {
    id: "N08", tema: "Notación científica de Excel en un CSV «8,00E+04»",
    text: "Producto;ISIN;Importe EUR\nA;LU1234567891;8,00E+04\nB;IE0098765432;120000",
    truth: two
  },
  {
    id: "N09", tema: "«Valor de mercado» sin columna de divisa y la divisa escrita en la celda («8.736,00 USD»)",
    text: "Producto;ISIN;Valor de mercado\nA;LU1234567891;80.000,00 EUR\nB;IE0098765432;8.736,00 USD",
    truth: usdNull
  },
  {
    id: "N10", tema: "HTML: «USD 8.736,00» en «Valor de mercado», sin columna de divisa",
    text: "<table><tr><th>Producto</th><th>ISIN</th><th>Valor de mercado</th></tr><tr><td>A</td><td>LU1234567891</td><td>EUR 80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td>USD 8.736,00</td></tr></table>",
    truth: usdNull
  },
  {
    id: "N11", tema: "Lista sin cabecera con la divisa en el importe «8.736,00 USD»",
    text: "LU1234567891;Fondo A;80.000,00 €\nIE0098765432;ETF B;8.736,00 USD",
    truth: usdNull
  },
  {
    id: "N12", tema: "Lista sin cabecera de pesos «40 %» (no son euros)",
    text: "LU1234567891;40 %\nIE0098765432;60 %",
    truth: { [LU]: null, [IE]: null }
  },
  {
    id: "N13", tema: "«ISIN;Importe» con celdas «40%»",
    text: "ISIN;Importe\nLU1234567891;40%\nIE0098765432;60%",
    truth: { [LU]: null, [IE]: null }
  },
  {
    id: "N14", tema: "Degiro (inglés): «Symbol/ISIN», «Local value» de dos columnas y «Value in EUR»",
    text: "Product,Symbol/ISIN,Quantity,Closing,Local value,,Value in EUR\nFUND A,LU1234567891,100,800.00,EUR,80000.00,80000.00\nETF B,IE0098765432,50,174.72,USD,8736.00,7512.09\nCASH & CASH FUND & FTX CASH (EUR),,,,EUR,1500.00,1500.00",
    truth: usd
  },
  {
    id: "N15", tema: "Degiro (español), decimales con coma entre comillas, «Valor en EUR»",
    text: 'Producto,Símbolo/ISIN,Cantidad,Precio de cierre,Valor local,,Valor en EUR\nFONDO A,LU1234567891,100,"800,00",EUR,"80000,00","80000,00"\nETF B,IE0098765432,50,"174,72",USD,"8736,00","7512,09"',
    truth: usd
  },
  {
    id: "N16", tema: "Interactive Brokers (flex): «Currency» y «Market Value» en divisa local",
    text: "Symbol,ISIN,Currency,Quantity,Market Value\nAAPL,US0378331005,USD,10,2298.70\nIWDA,IE00B4L5Y983,EUR,100,8000.00",
    truth: { [AAPL]: null, [IEW]: 8000 }
  },

  // ── B · Divisa ────────────────────────────────────────────────────────────
  {
    id: "N20", tema: "Columna «Código divisa» (no reconocida) y «Valor de mercado» en divisa",
    text: "Producto;ISIN;Código divisa;Valor de mercado\nA;LU1234567891;EUR;80000\nB;IE0098765432;USD;8736",
    truth: usdNull
  },
  {
    id: "N21", tema: "Inglés: «Local currency» (no reconocida) y «Market value» en divisa",
    text: "Security;ISIN;Local currency;Market value\nFund A;LU1234567891;EUR;80000\nETF B;IE0098765432;USD;8736",
    truth: usdNull
  },
  {
    id: "N22", tema: "Dos divisas: «Div. cuenta» (EUR) antes de «Div. activo» (USD)",
    text: "Producto;ISIN;Div. cuenta;Div. activo;Valor de mercado\nA;LU1234567891;EUR;EUR;80000\nB;IE0098765432;EUR;USD;8736",
    truth: usdNull
  },
  {
    id: "N23", tema: "Divisa escrita «€», «Euro», «eur» y «Dólar»",
    text: "Producto;ISIN;Divisa;Valor de mercado\nA;LU1234567891;€;50000\nB;XS1234567891;Euro;20000\nC;XS0098765432;eur;10000\nD;IE0098765432;Dólar;8736",
    truth: { [LU]: 50000, [XS]: 20000, [XS2]: 10000, [IE]: null }
  },
  {
    id: "N24", tema: "«Moneda» y contravalor en blanco en la fila en EUR (respaldo)",
    text: "Producto;ISIN;Moneda;Valor de mercado;Contravalor EUR\nA;LU1234567891;EUR;80000;\nB;IE0098765432;USD;8736;7512,09",
    truth: usd
  },
  {
    id: "N25", tema: "HTML: «Valor de mercado» con colspan sobre «Importe | Divisa»",
    text: '<table><tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th colspan="2">Valor de mercado</th></tr><tr><th>Importe</th><th>Divisa</th></tr><tr><td>A</td><td>LU1234567891</td><td>80.000,00</td><td>EUR</td></tr><tr><td>B</td><td>IE0098765432</td><td>8.736,00</td><td>USD</td></tr></table>',
    truth: usdNull
  },
  {
    id: "N26", tema: "HTML: «Valoración» con colspan sobre «Divisa | EUR»",
    text: '<table><tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th colspan="2">Valoración</th></tr><tr><th>Divisa</th><th>EUR</th></tr><tr><td>A</td><td>LU1234567891</td><td>80.000,00</td><td>80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td>8.736,00</td><td>7.512,09</td></tr></table>',
    truth: usd
  },
  {
    id: "N27", tema: "HTML: «Contravalor» con colspan sobre «Divisa | EUR»",
    text: '<table><tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th colspan="2">Contravalor</th></tr><tr><th>Divisa</th><th>EUR</th></tr><tr><td>A</td><td>LU1234567891</td><td>80.000,00</td><td>80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td>8.736,00</td><td>7.512,09</td></tr></table>',
    truth: usd
  },
  {
    id: "N28", tema: "HTML: «Valor de mercado» con colspan sobre «Divisa | EUR»",
    text: '<table><tr><th rowspan="2">Producto</th><th rowspan="2">Código ISIN</th><th colspan="2">Valor de mercado</th></tr><tr><th>Divisa</th><th>EUR</th></tr><tr><td>A</td><td>LU1234567891</td><td>80.000,00</td><td>80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td>8.736,00</td><td>7.512,09</td></tr></table>',
    truth: usd
  },
  {
    id: "N29", tema: "«Saldo» sin columna de divisa y una fila en USD",
    text: "Producto;Código;Títulos;Saldo\nA;LU1234567891;100;80000\nB;IE0098765432;50;8736",
    truth: usdNull
  },
  {
    id: "N30", tema: "«Saldo» con columna «Divisa» y una fila en USD",
    text: "Producto;Código;Divisa;Saldo\nA;LU1234567891;EUR;80000\nB;IE0098765432;USD;8736",
    truth: usdNull
  },

  // ── C · Filas: subtotales, duplicados, identificadores ───────────────────
  {
    id: "N31", tema: "Subtotal por fondo que repite el ISIN («Total Fondo A»)",
    text: "Producto;ISIN;Cuenta;Contravalor EUR\nFondo A;LU1234567891;C1;50000\nFondo A;LU1234567891;C2;30000\nTotal Fondo A;LU1234567891;;80000\nETF B;IE0098765432;C1;120000",
    truth: two
  },
  {
    id: "N32", tema: "HTML Santander: fila «Subtotal» con el ISIN repetido",
    text: "<table><tr><th>Producto</th><th>ISIN</th><th>Contrato</th><th>Contravalor EUR</th></tr><tr><td>Fondo A</td><td>LU1234567891</td><td>0001</td><td>50.000,00</td></tr><tr><td>Fondo A</td><td>LU1234567891</td><td>0002</td><td>30.000,00</td></tr><tr><td>Subtotal</td><td>LU1234567891</td><td></td><td>80.000,00</td></tr><tr><td>ETF B</td><td>IE0098765432</td><td>0001</td><td>120.000,00</td></tr></table>",
    truth: two
  },
  {
    id: "N33", tema: "La misma posición en dos cuentas, sin subtotal",
    text: "Cuenta;Producto;ISIN;Contravalor EUR\n0001;Fondo A;LU1234567891;50000\n0002;Fondo A;LU1234567891;30000\n0001;ETF B;IE0098765432;120000",
    truth: two
  },
  {
    id: "N34", tema: "Lista sin cabecera con un total de una palabra «PATRIMONIO»",
    text: "LU1234567891;80000\nIE0098765432;120000\nPATRIMONIO;200000",
    truth: two
  },
  {
    id: "N35", tema: "«Activo;Importe» sin ningún ISIN y un total «CARTERA»",
    text: "Activo;Importe\nAAPL;500\nMSFT;300\nCARTERA;800",
    truth: { AAPL: 500, MSFT: 300 }
  },
  {
    id: "N36", tema: "ISIN con espacios «LU 1234 5678 91»",
    text: "Producto;ISIN;Contravalor EUR\nA;LU 1234 5678 91;80000\nB;IE00 9876 5432;120000",
    truth: two
  },
  {
    id: "N37", tema: "ISIN con guiones «LU-123456789-1»",
    text: "Producto;ISIN;Contravalor EUR\nA;LU-123456789-1;80000\nB;IE0098765432;120000",
    truth: two,
    alias: { "LU-123456789-1": 80000 }
  },
  {
    id: "N38", tema: "Dos columnas «Contravalor EUR» que no coinciden",
    text: "Producto;ISIN;Contravalor EUR;Contravalor EUR\nA;LU1234567891;80000;80000\nB;IE0098765432;7512,09;8736",
    truth: usd
  },
  {
    id: "N39", tema: "Columnas vacías intercaladas y al final",
    text: "Producto;;ISIN;;Contravalor EUR;\nA;;LU1234567891;;80000;\nB;;IE0098765432;;7512,09;",
    truth: usd
  },
  {
    id: "N40", tema: "ISIN con dígito de control inválido (formato válido)",
    text: "Producto;ISIN;Contravalor EUR\nA;LU1234567890;80000\nB;IE0098765432;120000",
    truth: { LU1234567890: 80000, [IE]: 120000 }
  },

  // ── D · Mecánica del CSV ─────────────────────────────────────────────────
  {
    id: "N41", tema: "BOM + CRLF + «;»",
    text: "\uFEFFProducto;ISIN;Divisa;Valor de mercado;Contravalor EUR\r\nA;LU1234567891;EUR;80.000,00;80.000,00\r\nB;IE0098765432;USD;8.736,00;7.512,09\r\n",
    truth: usd
  },
  {
    id: "N42a", tema: "Solo CR (CSV Macintosh de Excel) con cabecera",
    text: "Producto;ISIN;Contravalor EUR\rA;LU1234567891;80000\rB;IE0098765432;120000",
    truth: two
  },
  {
    id: "N42b", tema: "Solo CR (CSV Macintosh) sin cabecera",
    text: "LU1234567891;80000\rIE0098765432;120000\rXS1234567891;5000",
    truth: { [LU]: 80000, [IE]: 120000, [XS]: 5000 }
  },
  {
    id: "N43", tema: "Comillas dobles escapadas en el nombre",
    text: 'Producto;ISIN;Contravalor EUR\n"Fondo ""Global"" A";LU1234567891;"80.000,00"\n"ETF ""B""";IE0098765432;"7.512,09"',
    truth: usd
  },
  {
    id: "N44", tema: "Comilla sin cerrar al final",
    text: 'Producto;ISIN;Contravalor EUR\nA;LU1234567891;80000\nB;IE0098765432;"7512,09',
    truth: usd
  },
  {
    id: "N45", tema: "TSV con un nombre multilínea entre comillas",
    text: 'Producto\tISIN\tContravalor EUR\n"Fondo A\nClase I"\tLU1234567891\t80000\n"ETF B"\tIE0098765432\t7512,09',
    truth: usd
  },
  {
    id: "N46", tema: "CSV en inglés sin comillas, «80,000.00» y la última columna vacía",
    text: "ISIN,Market value EUR,Notes\nLU1234567891,80,000.00,\nIE0098765432,7,512.09,",
    truth: usd
  },
  {
    id: "N47", tema: "Primera línea «;;» (fila vacía de Excel) y «ISIN;Nombre;Peso %»",
    text: ";;\nISIN;Nombre;Peso %\nLU1234567891;Fondo A;40\nIE0098765432;Fondo B;60",
    truth: { [LU]: null, [IE]: null }
  },
  {
    id: "N48", tema: "Primera línea «;;» y «ISIN;Divisa;Valor de mercado» con una fila en USD",
    text: ";;\nISIN;Divisa;Valor de mercado\nLU1234567891;EUR;80000\nIE0098765432;USD;8736",
    truth: usdNull
  },
  {
    id: "N49", tema: "Título «BBVA» y «ISIN;Nombre;Valor liquidativo»",
    text: "BBVA\nISIN;Nombre;Valor liquidativo\nLU1234567891;Fondo A;12,34\nIE0098765432;Fondo B;5,67",
    truth: { [LU]: null, [IE]: null }
  },
  {
    id: "N50", tema: "Título «INVERSIS» y «ISIN;Divisa;Valor de mercado» con una fila en USD",
    text: "INVERSIS\nISIN;Divisa;Valor de mercado\nLU1234567891;EUR;80000\nIE0098765432;USD;8736",
    truth: usdNull
  },

  // ── E · HTML ─────────────────────────────────────────────────────────────
  {
    id: "N51", tema: "HTML con dos tablas de columnas distintas (fondos y renta fija con cupón corrido)",
    text:
      "<table><tr><th>Producto</th><th>ISIN</th><th>Participaciones</th><th>Liquidativo</th><th>Contravalor EUR</th></tr>" +
      "<tr><td>Fondo A</td><td>LU1234567891</td><td>100</td><td>800,00</td><td>80.000,00</td></tr></table>\n" +
      "<table><tr><th>Producto</th><th>ISIN</th><th>Nominal</th><th>Precio</th><th>Cupón corrido</th><th>Contravalor EUR</th></tr>" +
      "<tr><td>Bono B</td><td>XS1234567891</td><td>120.000</td><td>99,50</td><td>1.250,00</td><td>120.650,00</td></tr></table>",
    truth: { [LU]: 80000, [XS]: 120650 }
  },
  {
    id: "N52", tema: "HTML con dos tablas, la segunda más estrecha",
    text:
      "<table><tr><th>Producto</th><th>ISIN</th><th>Participaciones</th><th>Liquidativo</th><th>Contravalor EUR</th></tr>" +
      "<tr><td>Fondo A</td><td>LU1234567891</td><td>100</td><td>800,00</td><td>80.000,00</td></tr></table>\n" +
      "<table><tr><th>Producto</th><th>ISIN</th><th>Contravalor EUR</th></tr>" +
      "<tr><td>Cuenta remunerada</td><td>XS1234567891</td><td>5.000,00</td></tr></table>",
    truth: { [LU]: 80000, [XS]: 5000 }
  },
  {
    id: "N53", tema: "CSV con secciones y una cabecera repetida con las columnas en otro orden",
    text: "Producto;ISIN;Títulos;Contravalor EUR\nFondo A;LU1234567891;100;80000\nProducto;ISIN;Contravalor EUR;Títulos\nETF B;IE0098765432;120000;50",
    truth: two
  },
  {
    id: "N54", tema: "HTML con «&euro;» en el importe",
    text: "<table><tr><th>Producto</th><th>ISIN</th><th>Contravalor EUR</th></tr><tr><td>A</td><td>LU1234567891</td><td>80.000,00 &euro;</td></tr><tr><td>B</td><td>IE0098765432</td><td>120.000,00 &euro;</td></tr></table>",
    truth: two
  },
  {
    id: "N55", tema: "HTML con la divisa en rowspan sobre dos posiciones en USD",
    text: '<table><tr><th>Producto</th><th>ISIN</th><th>Divisa</th><th>Valor de mercado</th></tr><tr><td>A</td><td>LU1234567891</td><td>EUR</td><td>80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td rowspan="2">USD</td><td>8.736,00</td></tr><tr><td>C</td><td>XS1234567891</td><td>1.000,00</td></tr></table>',
    truth: { [LU]: 80000, [IE]: null, [XS]: null }
  },
  {
    id: "N56", tema: "HTML con una celda oculta solo en las filas de datos",
    text: '<table><tr><th>Producto</th><th>ISIN</th><th>Contravalor EUR</th></tr><tr><td>A</td><td>LU1234567891</td><td style="display:none">4711</td><td>80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td style="display:none">4712</td><td>120.000,00</td></tr></table>',
    truth: two
  },
  {
    id: "N57", tema: "HTML: «Valoración» colspan sobre «Div. | Importe | Importe EUR»",
    text: '<table><tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th colspan="3">Valoración</th></tr><tr><th>Div.</th><th>Importe</th><th>Importe EUR</th></tr><tr><td>A</td><td>LU1234567891</td><td>EUR</td><td>80.000,00</td><td>80.000,00</td></tr><tr><td>B</td><td>IE0098765432</td><td>USD</td><td>8.736,00</td><td>7.512,09</td></tr></table>',
    truth: usd
  },

  // ── F · .xlsx (SheetJS, primera hoja, como readImportFileText) ───────────
  {
    id: "X60", tema: ".xlsx con dos hojas: «Cuenta 1» y «Cuenta 2»",
    text: xlsxToText([
      { name: "Cuenta 1", rows: [["Producto", "ISIN", "Contravalor EUR"], ["Fondo A", LU, 80000]] },
      { name: "Cuenta 2", rows: [["Producto", "ISIN", "Contravalor EUR"], ["ETF B", IE, 120000]] }
    ]),
    truth: two
  },
  {
    id: "X61", tema: ".xlsx con una hoja «Resumen» delante de «Posiciones»",
    text: xlsxToText([
      { name: "Resumen", rows: [["Tipo", "Importe"], ["FONDOS", 80000], ["ETF", 120000]] },
      { name: "Posiciones", rows: [["Producto", "ISIN", "Contravalor EUR"], ["Fondo A", LU, 80000], ["ETF B", IE, 120000]] }
    ]),
    truth: two
  },
  {
    id: "X62", tema: ".xlsx: «Valor de mercado» con formato de moneda USD en la celda, sin columna de divisa",
    text: xlsxToText([
      {
        name: "Posiciones",
        rows: [["Producto", "ISIN", "Valor de mercado"], ["Fondo A", LU, 80000], ["ETF B", IE, 8736]],
        fmt: { C2: '#,##0.00 "€"', C3: '"$"#,##0.00' }
      }
    ]),
    truth: usdNull
  },
  {
    id: "X63", tema: ".xlsx con celdas numéricas (3 decimales) y formato de moneda EUR",
    text: xlsxToText([
      {
        name: "Posiciones",
        rows: [["Producto", "ISIN", "Divisa", "Valor de mercado", "Contravalor EUR"], ["Fondo A", LU, "EUR", 80000.125, 80000.125], ["ETF B", IE, "USD", 8736, 7512.09]],
        fmt: { E2: '#,##0.000 "€"', E3: '#,##0.00 "€"' }
      }
    ]),
    truth: { [LU]: 80000.125, [IE]: 7512.09 }
  },
  {
    id: "X64", tema: ".xlsx con importes como TEXTO en inglés («80,000»)",
    text: xlsxToText([
      { name: "Positions", rows: [["Security", "ISIN", "Market value EUR"], ["Fund A", LU, "80,000"], ["ETF B", IE, "7,512.09"]] }
    ]),
    truth: usd
  },

  // ── G · Variantes añadidas tras la primera ejecución ─────────────────────
  {
    id: "N58", tema: "CSV con cabecera de grupo en dos filas: «Contravalor» sobre «Divisa | EUR»",
    text: "Producto;ISIN;Contravalor;\n;;Divisa;EUR\nA;LU1234567891;80000;80000\nB;IE0098765432;8736;7512,09",
    truth: usd
  },
  {
    id: "N59", tema: "Solo «Market value (local)», sin columna de divisa",
    text: "Security;ISIN;Market value (local)\nFund A;LU1234567891;80000\nETF B;IE0098765432;8736",
    truth: usdNull
  },
  {
    id: "N60", tema: "Lista sin cabecera «ISIN;divisa;importe» (la divisa en medio pasa por nombre)",
    text: "LU1234567891;EUR;80000\nIE0098765432;USD;8736",
    truth: usdNull
  },
  {
    id: "N61", tema: "Posición sin ISIN cuyo nombre contiene «Total» («PIMCO Total Return»)",
    text: "Producto;ISIN;Contravalor EUR\nA;LU1234567891;80000\nPIMCO Total Return;;5000\nB;IE0098765432;120000",
    truth: { [LU]: 80000, [IE]: 120000, "PIMCO Total Return": null }
  },
  {
    id: "X65", tema: ".xlsx con el título «POSICIONES» en A1 y «ISIN | Nombre | Peso %»",
    text: xlsxToText([
      { name: "Hoja1", rows: [["POSICIONES", null, null], ["ISIN", "Nombre", "Peso %"], [LU, "Fondo A", 40], [IE, "Fondo B", 60]] }
    ]),
    truth: { [LU]: null, [IE]: null }
  }
];
