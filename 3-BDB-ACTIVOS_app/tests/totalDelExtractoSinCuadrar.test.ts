/* Auditoría integral del 16-11-2026, hallazgo IMP-2. La fila de total de un extracto se descartaba sin mirarla: dos
   fondos de 1.000 y 2.000 € con «Total 5.000» entraban como 3.000 € y nadie decía que al fichero le faltaban 2.000.
   El total es la única cifra del fichero que dice cuánto debería haberse leído, así que ahora se compara, y se avisa.
   No cambia lo que entra: solo avisa, y solo cuando la comparación es limpia.

   Extractos SINTÉTICOS (ISIN inventados). Las cifras esperadas salen de las cuentas escritas junto a cada una. */
import { describe, expect, it } from "vitest";
import { totalMismatches, type SegmentTotals } from "../src/core/brokerPortfolioImport";
import { parsePositionImport } from "../src/core/positionImport";

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0010135103";

const leer = (text: string) => {
  const r = parsePositionImport(text);
  return { entradas: r.entries, delTotal: r.warnings.filter((aviso) => aviso.includes("no cuadra")) };
};

describe("IMP-2 · el total del extracto se compara con lo leído", () => {
  it("1.000 + 2.000 con «Total 5.000»: entran los 3.000 de siempre, y ahora se dice que faltan 2.000", () => {
    const { entradas, delTotal } = leer(`ISIN;Nombre;Importe\n${LU};Fondo A;1000\n${IE};Fondo B;2000\nTotal;;5000`);
    expect(entradas).toEqual([
      { id: LU, amount: 1000 },
      { id: IE, amount: 2000 }
    ]);
    /* 5.000 − (1.000 + 2.000) = 2.000. */
    expect(delTotal).toEqual([
      "La fila de total no cuadra con lo leído: «Total» dice 5.000,00 y las filas con importe suman 3.000,00 (2.000,00 de diferencia). " +
        "Puede faltar alguna posición en el fichero o haberse leído mal un importe: compruébalo antes de confirmar."
    ]);
  });

  it("un total que cuadra no dice nada, tampoco por un redondeo de céntimos", () => {
    expect(leer(`ISIN;Nombre;Importe\n${LU};Fondo A;1000\n${IE};Fondo B;2000\nTotal;;3000`).delTotal).toEqual([]);
    /* 1.000,33 + 2.000,33 = 3.000,66, y el total dice 3.001: 0,34 € de diferencia, dentro del euro de margen. */
    expect(leer(`ISIN;Nombre;Importe\n${LU};Fondo A;1000,33\n${IE};Fondo B;2000,33\nTotal;;3001`).delTotal).toEqual([]);
  });

  it("una fila de total sin rótulo también se compara", () => {
    const { delTotal } = leer(`ISIN;Importe\n${LU};80000\n${IE};120000\n;250000`);
    /* 80.000 + 120.000 = 200.000 frente a 250.000. */
    expect(delTotal).toHaveLength(1);
    expect(delTotal[0]).toContain("dice 250.000,00 y las filas con importe suman 200.000,00 (50.000,00 de diferencia)");
  });

  it("la liquidez, que no entra por no tener ISIN, sí cuenta para el total", () => {
    /* 1.000 + 2.000 + 500 de liquidez = 3.500: el total cuadra aunque solo entren 3.000. */
    const { entradas, delTotal } = leer(`ISIN;Nombre;Importe\n${LU};Fondo A;1000\n${IE};Fondo B;2000\n;Liquidez;500\nTotal;;3500`);
    expect(entradas.map((entrada) => entrada.amount)).toEqual([1000, 2000]);
    expect(delTotal).toEqual([]);
  });

  it("y un total que dice solo las posiciones, sin la liquidez, también está bien", () => {
    expect(leer(`ISIN;Nombre;Importe\n${LU};Fondo A;1000\n${IE};Fondo B;2000\n;Liquidez;500\nTotal;;3000`).delTotal).toEqual([]);
  });

  it("subtotales por grupo y total general: cada uno se compara con lo suyo", () => {
    const filas = (total: string) =>
      `ISIN;Nombre;Importe\n${LU};Fondo A;1000\n${IE};Fondo B;2000\nSubtotal fondos;;3000\n${FR};ETF C;4000\nSubtotal ETF;;4000\nTotal;;${total}`;
    /* 3.000 + 4.000 = 7.000. */
    expect(leer(filas("7000")).delTotal).toEqual([]);
    const { delTotal } = leer(filas("9000"));
    expect(delTotal).toHaveLength(1);
    expect(delTotal[0]).toContain("«Total» dice 9.000,00 y las filas con importe suman 7.000,00 (2.000,00 de diferencia)");
  });

  it("con una fila en otra divisa no se compara: la suma de la columna no dice nada, y la fila ya tiene su aviso", () => {
    const r = parsePositionImport(`ISIN;Nombre;Divisa;Importe\n${LU};Fondo A;EUR;1000\n${IE};Fondo B;USD;2000\nTotal;;;9999`);
    expect(r.warnings.some((aviso) => aviso.includes("no cuadra"))).toBe(false);
    expect(r.warnings.some((aviso) => aviso.includes(IE))).toBe(true);
  });
});

describe("IMP-2 · la regla, sobre la cuenta de cada bloque", () => {
  const bloque = (sum: number, totals: SegmentTotals["totals"], extra: Partial<SegmentTotals> = {}): SegmentTotals => ({ comparable: true, sum, accepted: sum, totals, ...extra });
  const total = (value: number, sinceLast: number, toHere: number, untilNext = 0) => ({ label: "Total", value, sinceLast, untilNext, toHere });

  it("un total general al final de dos bloques se compara con la suma de los dos", () => {
    /* Bloque 1: 3.000. Bloque 2: 4.000 y un «Total» de 7.000 = 3.000 + 4.000. */
    expect(totalMismatches([bloque(3000, []), bloque(4000, [total(7000, 4000, 4000)])], true)).toEqual([]);
    expect(totalMismatches([bloque(3000, []), bloque(4000, [total(8000, 4000, 4000)])], true)).toEqual([
      "«Total» dice 8.000,00 y las filas con importe suman 7.000,00 (1.000,00 de diferencia)"
    ]);
  });

  it("un total escrito encima de sus filas se compara con las de debajo", () => {
    expect(totalMismatches([bloque(3000, [total(3000, 0, 0, 3000)])], true)).toEqual([]);
  });

  it("si falta un bloque por leer o uno no es comparable, calla: no hay con qué comparar", () => {
    expect(totalMismatches([bloque(3000, [total(5000, 3000, 3000)])], false)).toEqual([]);
    expect(totalMismatches([bloque(3000, [total(5000, 3000, 3000)], { comparable: false })], true)).toEqual([]);
    expect(totalMismatches([bloque(3000, [total(5000, 3000, 3000)])], true)).toHaveLength(1);
  });

  it("el margen es un euro, o el 0,05 % del total si es más", () => {
    /* 3.000 frente a 3.001: 1 €, dentro. Frente a 3.001,60: 1,60 € y el 0,05 % de 3.001,60 son 1,50 €: fuera. */
    expect(totalMismatches([bloque(3000, [total(3001, 3000, 3000)])], true)).toEqual([]);
    expect(totalMismatches([bloque(3000, [total(3001.6, 3000, 3000)])], true)).toHaveLength(1);
    /* 1.000.000 frente a 1.000.400: 400 €, y el 0,05 % de 1.000.400 son 500,20 €: dentro. */
    expect(totalMismatches([bloque(1_000_000, [total(1_000_400, 1_000_000, 1_000_000)])], true)).toEqual([]);
  });
});
