/* Cuarta pasada del importador de extractos (revisión del 17-10-2026, N3-01 a
   N3-12). Principio: un importe solo se importa si es con certeza el
   contravalor en EUR de la posición; ante la duda, aviso y no se importa.
   Extractos SINTÉTICOS (ISIN inventados salvo IE00B4L5Y983). */
import { describe, expect, it } from "vitest";
import { brokerExportToCanonicalImport, looksLikeBrokerExport, readBrokerExport } from "../src/core/brokerPortfolioImport";
import { parsePositionImport } from "../src/core/positionImport";

const LU = "LU1234567891";
const IE = "IE0098765432";
const OK = [
  { id: LU, amount: 80000 },
  { id: IE, amount: 120000 }
];

describe("N3-01: rowspan en el importe", () => {
  it("la fila de continuación no vuelve a contar el importe (Posiciones globales)", () => {
    const html = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Cuenta</th><th>Títulos</th><th>Contravalor EUR</th></tr>
<tr><td rowspan="2">Fondo A</td><td rowspan="2">${LU}</td><td>C1</td><td>60</td><td rowspan="2">80.000,00</td></tr>
<tr><td>C2</td><td>40</td></tr>
<tr><td>ETF B</td><td>${IE}</td><td>C1</td><td>50</td><td>120.000,00</td></tr>
</table>`;
    const result = parsePositionImport(html);
    expect(result.entries).toEqual(OK);
    expect(result.warnings).toEqual([]);
  });

  it("un importe repetido para otro ISIN no se sabe de quién es: aviso y no se importa", () => {
    const html = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Contravalor EUR</th></tr>
<tr><td>A</td><td>${LU}</td><td rowspan="2">80.000,00</td></tr>
<tr><td>B</td><td>${IE}</td></tr>
</table>`;
    const read = readBrokerExport(html);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.warnings.join(" ")).toContain(`1 fila comparte el importe de la fila anterior (${IE})`);
  });
});

describe("N3-02: con cabecera, la columna de importe la decide la cabecera", () => {
  it.each([
    ["ISIN;Importe;Peso %", "40", "60"],
    ["ISIN;Contravalor EUR;Rentabilidad", "5,2", "3,1"],
    ["ISIN;Valor de mercado;Divisa", "EUR", "EUR"],
    ["ISIN;Importe;Fecha", "15/10/2026", "15/10/2026"]
  ])("«%s»", (header, a, b) => {
    const result = parsePositionImport(`${header}\n${LU};80000;${a}\n${IE};120000;${b}`);
    expect(result.entries).toEqual(OK);
  });

  it("una línea de total sin identificador no es una posición", () => {
    expect(parsePositionImport(`ISIN;Importe\n${LU};80000\n${IE};120000\n;200000`).entries).toEqual(OK);
    const list = parsePositionImport(`${LU};80000\n${IE};120000\n200000`);
    expect(list.entries).toEqual(OK);
    expect(list.warnings.join(" ")).toContain("«200000»");
  });

  it("sin cabecera, una cifra entre el identificador y el importe es ambigua: aviso", () => {
    const result = parsePositionImport(`${LU};80000;40\n${IE};120000;60`);
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(" ")).toContain("no siguen el formato");
  });
});

describe("N3-03: códigos que no son ISIN", () => {
  it("un rótulo de sección con subtotal no es una posición, y se dice", () => {
    const read = readBrokerExport(
      `ISIN;Nombre;Títulos;Valor de mercado\nFONDOS;;;80000\n${LU};Fondo A;100;80000\nETF;;;120000\n${IE};ETF B;50;120000\nTOTAL;;;200000`
    );
    expect(read.positions).toEqual(OK);
    expect(read.warnings.join(" ")).toContain("Se ignoran 2 filas de sección o subtotal (FONDOS, ETF)");
  });

  it("un código con nombre se importa, siempre con aviso", () => {
    const read = readBrokerExport(`ISIN/ID;Nombre;Importe EUR\n${LU};Fondo A;80000\nPRIVADO-1;Privado;45000`);
    expect(read.positions).toEqual([
      { id: LU, amount: 80000 },
      { id: "PRIVADO-1", amount: 45000 }
    ]);
    expect(read.warnings.join(" ")).toContain("identificador que no es ISIN (PRIVADO-1)");
  });
});

describe("N3-04: CSV con comillas", () => {
  it("CSV en inglés con miles entre comillas", () => {
    const csv = `Security,ISIN,Quantity,Market value EUR\nFund A,${LU},100,"80,000.00"\nETF B,IE00B4L5Y983,50,"7,512.09"`;
    expect(parsePositionImport(csv).entries).toEqual([
      { id: LU, amount: 80000 },
      { id: "IE00B4L5Y983", amount: 7512.09 }
    ]);
  });

  it("CSV en inglés con miles SIN comillas: la fila está mal partida, aviso y no se importa", () => {
    const read = readBrokerExport(`Security,ISIN,Market value EUR\nFund A,${LU},80,000.00\nETF B,${IE},120.00`);
    expect(read.positions).toEqual([{ id: IE, amount: 120 }]);
    expect(read.warnings.join(" ")).toContain(`más columnas que la cabecera (${LU})`);
  });

  it("cabeceras con salto de línea dentro de comillas", () => {
    const csv = `Producto;ISIN;"Valor de\nmercado";"Contravalor\nEUR";Divisa\nA;${LU};80000;80000;EUR\nB;${IE};8736;7512,09;USD`;
    expect(parsePositionImport(csv).entries).toEqual([
      { id: LU, amount: 80000 },
      { id: IE, amount: 7512.09 }
    ]);
  });

  it("una comilla sin cerrar: no se importa nada y se dice", () => {
    const result = parsePositionImport(`Producto;ISIN;Importe\n"Fondo A;${LU};80000\nB;${IE};120000`);
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(" ")).toContain("comillas sin cerrar");
  });
});

describe("N3-05: la divisa de la fila manda", () => {
  it("el valor de mercado de una fila en USD sin contravalor no se toma como euros", () => {
    const read = readBrokerExport(`Producto;ISIN;Divisa;Valor de mercado;Contravalor EUR\nA;${LU};EUR;80000;80000\nB;${IE};USD;8736;`);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.warnings.join(" ")).toContain(`${IE} (USD)`);
  });

  it("solo «Valor de mercado» e «Importe»: la fila en USD no se importa", () => {
    const read = readBrokerExport(`Producto;ISIN;Divisa;Valor de mercado;Importe\nA;${LU};EUR;80000;80000\nB;${IE};USD;8736;7512,09`);
    expect(read.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(read.warnings.join(" ")).toContain(`${IE} (USD)`);
  });

  it("«Contravalor USD» no es el contravalor en euros; «Contravalor EUR» sí", () => {
    expect(readBrokerExport(`Producto;ISIN;Divisa;Contravalor USD;Contravalor EUR\nA;${LU};EUR;93000;80000\nB;${IE};USD;8736;7512,09`).positions).toEqual([
      { id: LU, amount: 80000 },
      { id: IE, amount: 7512.09 }
    ]);
    const onlyUsd = readBrokerExport(`Producto;ISIN;Divisa;Valor de mercado;Contravalor USD\nA;${LU};EUR;80000;93000\nB;${IE};USD;8736;8736`);
    expect(onlyUsd.positions).toEqual([{ id: LU, amount: 80000 }]);
    expect(onlyUsd.warnings.join(" ")).toContain(`${IE} (USD)`);
  });

  it("«Market value (local)» y «Market value in EUR»: el de euros, sin ambigüedad", () => {
    expect(
      readBrokerExport(`Security;ISIN;Market value (local);Market value in EUR\nA;${LU};80000;80000\nB;${IE};8736;7512,09`).positions
    ).toEqual([
      { id: LU, amount: 80000 },
      { id: IE, amount: 7512.09 }
    ]);
  });
});

describe("N3-06: sin columna de importe reconocida no se importa nada", () => {
  it("«Saldo» solo con la divisa EUR explícita (quinta pasada, R4-12); «Peso %» nunca", () => {
    const read = readBrokerExport(`Producto;Código;Títulos;Saldo;Peso %\nA;${LU};100;80000;40\nB;${IE};50;120000;60`);
    expect(read.positions).toEqual([]);
    expect(read.warnings.join(" ")).toContain("La columna «Saldo» no es el contravalor en EUR");
    expect(read.warnings.join(" ")).toContain(`${LU}, ${IE}`);
    expect(readBrokerExport(`Producto;Código;Títulos;Saldo EUR;Peso %\nA;${LU};100;80000;40\nB;${IE};50;120000;60`).positions).toEqual(OK);
    expect(readBrokerExport(`Producto;Código;Divisa;Saldo\nA;${LU};EUR;80000\nB;${IE};EUR;120000`).positions).toEqual(OK);
  });

  it("una tabla sin cabecera no dice qué columna es el importe: aviso y nada", () => {
    const read = readBrokerExport(`Fondo A;${LU};100;80000\nFondo B;${IE};50;120000`);
    expect(read.positions).toEqual([]);
    expect(read.warnings.join(" ")).toContain("no tiene cabecera");
  });

  it("«Valor\\nliquidativo» y «Peso\\n%» no son importes, tampoco en el Constructor", () => {
    const csv = `ISIN;Producto;"Valor\nliquidativo";"Peso\n%"\n${LU};A;12,34;91,4\n${IE};B;5,67;8,6`;
    expect(looksLikeBrokerExport(csv)).toBe(true);
    expect(readBrokerExport(csv).positions).toEqual([]);
    expect(brokerExportToCanonicalImport(csv).text).toBe(csv);
  });
});

describe("N3-07 y menores", () => {
  it("una primera línea con identificador nunca es cabecera; su importe se lee como el lector («80.000,00 EUR»)", () => {
    expect(parsePositionImport(`${LU};80.000,00 EUR\n${IE};120.000,00 EUR`).entries).toEqual(OK);
    // Séptima pasada (V54): sin «EUR» cuando la otra línea lo dice, la línea queda fuera y se nombra.
    const mixed = parsePositionImport(`${LU};80.000,00 EUR\n${IE};120000`);
    expect(mixed.entries).toEqual([{ id: LU, amount: 80000 }]);
    expect(mixed.warnings.join(" ")).toContain(`${IE} (las demás líneas dicen «€» y esta no)`);
    const negative = parsePositionImport(`${LU};(1.234)\n${IE};120000`);
    expect(negative.entries).toEqual([{ id: IE, amount: 120000 }]);
    expect(negative.warnings.join(" ")).toContain(`1 posición con importe negativo o cero (${LU})`);
  });

  it("los ISIN de una lista en minúsculas se pasan a mayúsculas", () => {
    expect(parsePositionImport("isin;importe\nlu1234567891;80000\nie0098765432;120000").entries).toEqual(OK);
    expect(parsePositionImport("lu1234567891;80000\nie0098765432;120000").entries).toEqual(OK);
  });

  it("una fila de liquidez sin ISIN se descarta con aviso; los totales, sin aviso", () => {
    const read = readBrokerExport(`Producto;ISIN;Títulos;Valor de mercado\nA;${LU};100;80000\nLiquidez cuenta;;;5000\nB;${IE};50;120000\nTOTAL;;;205000`);
    expect(read.positions).toEqual(OK);
    // Séptima pasada: todo se confirma; el resumen lista cada posición con su nombre.
    expect(read.euroConfirmation?.positions.map(({ id, name, amount }) => ({ id, name, amount }))).toEqual([
      { id: LU, name: "A", amount: 80000 },
      { id: IE, name: "B", amount: 120000 }
    ]);
    expect(read.warnings).toEqual(["1 fila con importe y sin ISIN («Liquidez cuenta»), como la liquidez: no se importa."]);
  });

  it("las filas con identificador sin importe legible se nombran", () => {
    const read = readBrokerExport(`Producto;ISIN;Valor de mercado\nA;${LU};80.000,00\nB;${IE};(1.234,00)`);
    expect(read.warnings.join(" ")).toContain(`(${IE})`);
  });
});
