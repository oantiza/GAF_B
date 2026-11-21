/* Tercera pasada del importador de extractos (revisión del 17-10-2026, N-01 a
   N-06 y N-10). Extractos SINTÉTICOS; los ISIN son inventados salvo
   IE00B4L5Y983, que ya aparece en la app como ejemplo. Criterio: ante una
   columna o una cabecera ambigua, avisar y no importar antes que adivinar. */
import { describe, expect, it } from "vitest";
import {
  brokerExportToCanonicalImport,
  brokerExportToPositionAmounts,
  looksLikeBrokerExport,
  readBrokerExport
} from "../src/core/brokerPortfolioImport";
import { parsePositionImport, parsePositionLines } from "../src/core/positionImport";

const OK = [
  { id: "LU1234567891", amount: 80000 },
  { id: "IE0098765432", amount: 120000 }
];

describe("N-01: la columna de importe es la valoración de la posición", () => {
  it("«Precio contravalor EUR» es un precio, no el importe", () => {
    const csv = "Producto;ISIN;Precio contravalor EUR;Valor de mercado\nA;LU1234567891;12,34;80000\nB;IE0098765432;5,67;120000";
    expect(brokerExportToPositionAmounts(csv)).toEqual(OK);
  });

  it("«Importe comisiones EUR» no manda sobre «Valor de mercado»", () => {
    const csv = "Producto;ISIN;Valor de mercado;Importe comisiones EUR\nA;LU1234567891;80000;12\nB;IE0098765432;120000;30";
    expect(brokerExportToPositionAmounts(csv)).toEqual(OK);
  });

  it("dos candidatas que no coinciden: ningún importe hasta que el asesor elige (octava pasada, B1)", () => {
    const csv = "Producto;ISIN;Importe EUR;Contravalor\nA;LU1234567891;80000;1\nB;IE0098765432;120000;1";
    const read = readBrokerExport(csv);
    expect(read.positions).toEqual([]);
    expect(read.warnings.join(" ")).toContain("(«Importe EUR» y «Contravalor») y no coinciden");
    expect(read.choices.map((choice) => [choice.kind, choice.chosen, choice.options.map((option) => option.label)])).toEqual([
      ["amount", null, ["Importe EUR", "Contravalor", "Ninguna: no importar este bloque"]]
    ]);
    const canonical = brokerExportToCanonicalImport(csv);
    expect(canonical.text).toBe("asset_id,weight");
    expect(canonical.warnings.join(" ")).toContain("no coinciden");
    // Elegida la columna, se lee con ella.
    const chosen = readBrokerExport(csv, { [read.choices[0].key]: read.choices[0].options[0].value });
    expect(chosen.positions).toEqual(OK);
  });

  it("dos candidatas del mismo rango que coinciden: se importa sin aviso", () => {
    const csv = "Producto;ISIN;Importe EUR;Contravalor\nA;LU1234567891;80000;80000\nB;IE0098765432;120000;120000";
    const read = readBrokerExport(csv);
    expect(read.positions).toEqual(OK);
    expect(read.warnings).toEqual([]);
  });
});

describe("N-02: cabeceras en dos filas, rowspan/colspan y celdas que no son números", () => {
  it("cabecera con rowspan/colspan: el contravalor de la subcabecera, alineado con los datos", () => {
    const html = `<table>
<tr><th rowspan="2">Producto</th><th rowspan="2">ISIN</th><th rowspan="2">Títulos</th><th colspan="2">Valoración</th></tr>
<tr><th>Valor de mercado</th><th>Contravalor EUR</th></tr>
<tr><td>ETF</td><td>IE00B4L5Y983</td><td>50</td><td>8.736,00</td><td>7.512,09</td></tr>
<tr><td>Fondo</td><td>LU1234567891</td><td>100</td><td>80.000,00</td><td>80.000,00</td></tr>
</table>`;
    // Octava pasada (B1): sin divisa en el fichero, 8.736 frente a 7.512,09 no se concilia: el asesor elige.
    const read = readBrokerExport(html);
    expect(read.positions).toEqual([]);
    const choice = read.choices[0];
    expect(choice.options.map((option) => option.label)).toEqual([
      "Valoración Contravalor EUR",
      "Valoración Valor de mercado",
      "Ninguna: no importar este bloque"
    ]);
    expect(brokerExportToPositionAmounts(html, { [choice.key]: choice.options[0].value })).toEqual([
      { id: "IE00B4L5Y983", amount: 7512.09 },
      { id: "LU1234567891", amount: 80000 }
    ]);
  });

  it("HTML con título, fila vacía, secciones, subtotal y total: contravalor y nada más", () => {
    const html = `<table>
<tr><td colspan="6">Posiciones a 15/10/2026 - Cartera de prueba</td></tr>
<tr><th>Producto</th><th>Código ISIN</th><th>Títulos</th><th>Liquidativo</th><th>Valor de mercado</th><th>Contravalor EUR</th></tr>
<tr></tr>
<tr><td colspan="6">Fondos de inversión</td></tr>
<tr><td>Fondo Uno</td><td>LU1234567891</td><td>100</td><td>800,00</td><td>80.000,00</td><td>80.000,00</td></tr>
<tr><td colspan="4">Total fondos</td><td></td><td>80.000,00</td></tr>
<tr><td colspan="6">ETF</td></tr>
<tr><td>ETF Dos USD</td><td>IE0098765432</td><td>50</td><td>174,72</td><td>8.736,00</td><td>7.512,09</td></tr>
<tr><td>TOTAL</td><td></td><td></td><td></td><td></td><td>87.512,09</td></tr>
</table>`;
    const read = readBrokerExport(html);
    expect(read.positions).toEqual([
      { id: "LU1234567891", amount: 80000 },
      { id: "IE0098765432", amount: 7512.09 }
    ]);
    expect(read.unreadableRows).toBe(0);
    expect(read.warnings).toEqual([]);
  });

  it("un bloque de resumen encima no presta su cabecera y un nombre con cifras no es un importe", () => {
    const html = `<table>
<tr><td>Valor de mercado total</td><td>200.000,00</td></tr>
<tr><td>Fecha</td><td>15/10/2026</td></tr>
<tr><th>Producto</th><th>Código</th><th>Títulos</th><th>Saldo EUR</th></tr>
<tr><td>A 2030</td><td>LU1234567891</td><td>100</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>50</td><td>120.000,00</td></tr>
</table>`;
    // Quinta pasada (R4-12): «Saldo» solo vale con la divisa EUR explícita; aquí, «Saldo EUR».
    const read = readBrokerExport(html);
    expect(read.positions).toEqual(OK);
    expect(readBrokerExport(html.replace("Saldo EUR", "Saldo")).positions).toEqual([]);
  });

  it("título de una celda en la fila 0: la cabecera es la fila de verdad", () => {
    const html = `<table>
<tr><td>Posiciones a 15/10/2026</td></tr>
<tr><th>Producto</th><th>Código</th><th>Títulos</th><th>Saldo EUR</th></tr>
<tr><td>Fondo 2030</td><td>LU1234567891</td><td>100</td><td>80.000,00</td></tr>
<tr><td>Fondo B</td><td>IE0098765432</td><td>50</td><td>120.000,00</td></tr>
</table>`;
    expect(brokerExportToPositionAmounts(html)).toEqual(OK);
  });

  /* N-05: el importe en una columna intermedia, con filas entre la cabecera y
     la primera posición: la cabecera hay que buscarla, no basta con la fila
     anterior ni con la última columna. */
  it("«Código ISIN» con el importe en medio y una sección delante de las posiciones", () => {
    const html = `<table>
<tr><th>Producto</th><th>Código ISIN</th><th>Valor de mercado</th><th>Divisa</th></tr>
<tr><td colspan="4">Fondos de inversión</td></tr>
<tr><td>Fund A</td><td>LU1234567891</td><td>80.000,00</td><td>EUR</td></tr>
<tr><td>Fund B</td><td>IE0098765432</td><td>120.000,00</td><td>EUR</td></tr>
</table>`;
    expect(brokerExportToPositionAmounts(html)).toEqual(OK);
  });

  it("sin cabecera ISIN, con el importe en medio y una fila vacía y una sección delante", () => {
    const html = `<table>
<tr><th>Producto</th><th>Código</th><th>Valor de mercado</th><th>Divisa</th></tr>
<tr></tr>
<tr><td colspan="4">Renta variable</td></tr>
<tr><td>Fund A</td><td>LU1234567891</td><td>80.000,00</td><td>EUR</td></tr>
<tr><td>Fund B</td><td>IE0098765432</td><td>120.000,00</td><td>EUR</td></tr>
</table>`;
    expect(brokerExportToPositionAmounts(html)).toEqual(OK);
  });
});

describe("N-03: la cabecera del ISIN es la celda que lo es, no la que lo nombra", () => {
  it("un título CSV que nombra el ISIN no tapa la cabecera real", () => {
    const csv = "Detalle de posiciones por ISIN;;\nProducto;ISIN;Valor de mercado\nA;LU1234567891;80000\nB;IE0098765432;120000";
    expect(parsePositionLines(csv)).toEqual(OK);
    expect(looksLikeBrokerExport(csv)).toBe(true);
  });

  it("«Filtro ISIN: todos» encima de una cabecera «Código»", () => {
    const html = `<table>
<tr><td colspan="3">Filtro ISIN: todos</td></tr>
<tr><th>Producto</th><th>Código</th><th>Valor de mercado</th></tr>
<tr><td>A</td><td>LU1234567891</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>120.000,00</td></tr>
</table>`;
    expect(parsePositionLines(html)).toEqual(OK);
    expect(brokerExportToCanonicalImport(html).text).not.toBe(html);
  });
});

describe("N-04: ninguna fila con identificador desaparece en silencio", () => {
  it("«ISIN;Importe» con identificadores que no son ISIN y una fila TOTAL", () => {
    expect(parsePositionLines("ISIN;Importe\nLU1234567891;1000\nAAPL;500\nFUND-1;250\nTOTAL;1750")).toEqual([
      { id: "LU1234567891", amount: 1000 },
      { id: "AAPL", amount: 500 },
      { id: "FUND-1", amount: 250 }
    ]);
  });

  it("«Producto;ISIN;Títulos;Saldo»: ISIN como identificador, no el nombre; sin divisa EUR, aviso que nombra las filas (R4-12)", () => {
    const result = parsePositionImport("Producto;ISIN;Títulos;Saldo\nFondo A;LU1234567891;100;80000\nFondo B;IE0098765432;50;120000");
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(" ")).toContain("«Saldo»");
    expect(result.warnings.join(" ")).toContain("LU1234567891, IE0098765432");
    const eur = parsePositionImport("Producto;ISIN;Títulos;Saldo EUR\nFondo A;LU1234567891;100;80000\nFondo B;IE0098765432;50;120000");
    expect(eur.entries).toEqual(OK);
  });

  it("la exportación propia de Posiciones globales se reimporta entera", () => {
    const csv = [
      "ISIN/ID;Nombre;Estado;Retro %;Coeficiente cesión;Cesión %;Importe EUR;Peso %;Ingreso estimado EUR;Coste corriente %;Coste anual EUR",
      "LU1234567891;Fondo A;Encontrado;0,5;0,5;0,25;80000;64;200;1,2;960",
      "PRIVADO-1;Vehículo privado;No encontrado;;0,5;;45000;36;;;"
    ].join("\n");
    expect(parsePositionLines(csv)).toEqual([
      { id: "LU1234567891", amount: 80000 },
      { id: "PRIVADO-1", amount: 45000 }
    ]);
  });

  it("una fila con importe y un rótulo que no es un identificador se dice", () => {
    const read = readBrokerExport("Producto;ISIN;Valor de mercado\nA;LU1234567891;80000\nB;fondo-b;5000");
    expect(read.positions).toEqual([{ id: "LU1234567891", amount: 80000 }]);
    expect(read.warnings.join(" ")).toContain("1 fila con importe y sin un identificador reconocible («fondo-b»)");
  });

  it("las filas con identificador y sin importe se cuentan en un aviso", () => {
    const result = parsePositionImport("Producto;ISIN;Divisa;Valor de mercado\nA;LU1234567891;EUR;80000\nB;IE0098765432;EUR;n/d");
    expect(result.entries).toEqual([{ id: "LU1234567891", amount: 80000 }]);
    expect(result.warnings.join(" ")).toContain("1 fila con identificador y sin importe legible");
  });
});

describe("N-06 y N-10 (previos a la rama)", () => {
  it("N-06: en una lista línea a línea, la última columna «Valor liquidativo» no se toma como importe", () => {
    const result = parsePositionImport("ISIN;Valor;Valor liquidativo\nLU1234567891;80000;12,34\nIE0098765432;120000;5,67");
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(" ")).toContain("«Valor liquidativo»");
  });

  it("N-10: una fila de datos con rowspan conserva su ISIN y su importe", () => {
    const html = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Cuenta</th><th>Contravalor EUR</th></tr>
<tr><td rowspan="2">Fondo Uno</td><td>LU1234567891</td><td>C1</td><td>50.000,00</td></tr>
<tr><td>LU1234567891</td><td>C2</td><td>30.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>C1</td><td>120.000,00</td></tr>
</table>`;
    expect(parsePositionLines(html)).toEqual([
      { id: "LU1234567891", amount: 50000 },
      { id: "LU1234567891", amount: 30000 },
      { id: "IE0098765432", amount: 120000 }
    ]);
  });
});
