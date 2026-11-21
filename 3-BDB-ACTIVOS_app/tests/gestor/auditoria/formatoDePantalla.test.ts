/**
 * Auditoría · lo que se pinta (`src/gestor/ui/formato.ts`).
 *
 * El redondeo es el mismo en la cifra grande y en el detalle; los medios exactos se alejan del
 * cero (la regla que declara `motor/decimal.ts`); nunca se pinta un cero negativo; los miles
 * llevan punto también con cuatro cifras; el signo se pone con coherencia. Y, para las mismas
 * cifras, se compara con el módulo común con el que escriben los informes (`core/formato.ts`), en el que delega.
 *
 * Los textos esperados son los de la norma de la casa, escritos a mano. El menos es «−» (U+2212), y el espacio
 * antes de la unidad, el duro (U+00A0).
 */
import { describe, expect, it } from "vitest";
import * as informe from "../../../src/core/formato";
import { claseDelSigno, importe, importeConSigno, importeRedondo, porcentaje, porcentajeConSigno, precio, puntos, ratio, titulos } from "../../../src/gestor/ui/formato";

const NBSP = "\u00a0";

describe("el redondeo de la cifra grande y del detalle", () => {
  it("18.581,60 se escribe 18.582 € en grande y 18.581,60 € en el detalle", () => {
    expect(importeRedondo(18581.6)).toBe("18.582\u00a0€");
    expect(importe(18581.6)).toBe("18.581,60\u00a0€");
  });

  it("18.581,49 baja en grande y conserva sus céntimos en el detalle", () => {
    expect(importeRedondo(18581.49)).toBe("18.581\u00a0€");
    expect(importe(18581.49)).toBe("18.581,49\u00a0€");
  });
});

describe("los medios exactos se alejan del cero", () => {
  it("en importes", () => {
    expect(importeRedondo(2.5)).toBe("3\u00a0€");
    expect(importeRedondo(-2.5)).toBe("−3\u00a0€");
    expect(importe(0.005)).toBe("0,01\u00a0€");
    expect(importe(-0.005)).toBe("−0,01\u00a0€");
    expect(importe(0.125)).toBe("0,13\u00a0€"); // 0,125 es exacto en binario: es un medio de verdad
  });

  it("un medio que no es exacto en binario también sube, en la pantalla y en el informe", () => {
    /*
     * 1,005 no existe en binario (es 1,00499999999999989…), pero se escribe «1.005» y así lo redondea `Intl`:
     * a 1,01, como el redondeo comercial de `decimal.ts` sobre el decimal 1,005. Igual 2,675 → 2,68.
     */
    expect(importe(1.005)).toBe("1,01\u00a0€");
    expect(importe(2.675)).toBe("2,68\u00a0€");
    expect(informe.importe(1.005)).toBe("1,01\u00a0€");
    expect(informe.importe(2.675)).toBe("2,68\u00a0€");
  });

  it("en porcentajes", () => {
    expect(porcentaje(0.125)).toBe("12,50\u00a0%");
    expect(porcentaje(0.125, 1)).toBe("12,5\u00a0%");
    expect(porcentaje(0.00125)).toBe("0,13\u00a0%"); // 0,125 %
    expect(porcentaje(-0.00125)).toBe("−0,13\u00a0%");
  });
});

describe("nunca un cero negativo", () => {
  it("un importe que redondea a cero no lleva signo", () => {
    expect(importe(-0.004)).toBe("0,00\u00a0€");
    expect(importe(-0)).toBe("0,00\u00a0€");
    expect(importeRedondo(-0.4)).toBe("0\u00a0€");
    expect(importeConSigno(-0.004)).toBe("0,00\u00a0€");
  });

  it("ni un porcentaje, ni unos puntos, ni un ratio", () => {
    expect(porcentaje(-0.00004)).toBe("0,00\u00a0%"); // −0,004 %
    expect(porcentaje(-0.0004, 1)).toBe("0,0\u00a0%"); // −0,04 % con un decimal
    expect(porcentajeConSigno(-0.00004)).toBe("0,00\u00a0%");
    expect(puntos(-0.00004)).toBe("0,00\u00a0pp");
    expect(ratio(-0.001)).toBe("0,00");
  });
});

describe("los miles llevan punto también con cuatro cifras", () => {
  it("en importes, títulos y precios", () => {
    expect(importe(1234.56)).toBe("1.234,56\u00a0€");
    expect(importeRedondo(1234)).toBe("1.234\u00a0€");
    expect(importe(-1234.56, "USD")).toBe("−1.234,56\u00a0USD");
    expect(titulos(1234.5)).toBe("1.234,5");
    expect(titulos(0.000001)).toBe("0,000001"); // hasta seis decimales, sin ceros de relleno
    expect(precio(1234.5)).toBe("1.234,50");
    expect(precio(12.34567)).toBe("12,3457"); // entre dos y cuatro decimales
  });
});

describe("el signo, con coherencia", () => {
  it("el «+» solo cuando la cifra escrita no es cero; el menos tipográfico en los negativos", () => {
    expect(importeConSigno(1234.5)).toBe("+1.234,50\u00a0€");
    expect(importeConSigno(-1234.5)).toBe("−1.234,50\u00a0€");
    expect(importeConSigno(0.004)).toBe("0,00\u00a0€");
    expect(importeConSigno(0.005)).toBe("+0,01\u00a0€");
    expect(importeConSigno(0)).toBe("0,00\u00a0€");
    expect(importeConSigno(1234.5, "EUR", 0)).toBe("+1.235\u00a0€");
    expect(porcentajeConSigno(0.0123)).toBe("+1,23\u00a0%");
    expect(porcentajeConSigno(-0.0123)).toBe("−1,23\u00a0%");
    expect(porcentajeConSigno(0.00004)).toBe("0,00\u00a0%");
    expect(puntos(0.0123)).toBe("+1,23\u00a0pp");
    expect(puntos(-0.0123)).toBe("−1,23\u00a0pp");
  });

  it("el color de un porcentaje sigue a lo que se escribe", () => {
    expect(claseDelSigno(0.0123)).toBe("gestor-sube");
    expect(claseDelSigno(-0.0123)).toBe("gestor-baja");
    expect(claseDelSigno(-0.00004)).toBe(""); // se escribe «0,00 %»: sin color
    expect(claseDelSigno(null)).toBe("");
  });
});

describe("comparación con el módulo común de los informes", () => {
  const cifras = [18581.6, 1234.56, 2.5, 0.005, -0.005, 0.125, -1234.5, 1000000];

  it("los importes en euros coinciden carácter a carácter con los del informe", () => {
    for (const cifra of cifras) {
      expect(informe.importe(cifra), String(cifra)).toBe(importe(cifra));
      expect(informe.importeTitular(cifra), String(cifra)).toBe(importeRedondo(cifra));
    }
  });

  it("los porcentajes coinciden carácter a carácter con los del informe", () => {
    for (const fraccion of [0.125, 0.00125, -0.0123, 0.0598333, -0.25, 12.345]) {
      expect(informe.porcentaje(fraccion), String(fraccion)).toBe(porcentaje(fraccion));
    }
  });

  /* Antes, el formato propio de los informes escribía «No disponible»; el común no escribe nada y la pieza pone la frase. */
  it("donde falta la cifra, el formato de los informes no la inventa: no da texto, nunca un cero", () => {
    expect(informe.importe(null)).toBeNull();
    expect(informe.importe(Number.NaN)).toBeNull();
    expect(informe.porcentaje(undefined)).toBeNull();
  });

  it("lo que antes difería entre la pantalla y el informe ya se escribe igual en los dos", () => {
    /*
     * Cada línea: la misma cifra, lo que escribe la pantalla, lo que escribe el informe y el texto esperado. Antes la
     * pantalla separaba la unidad con un espacio normal (1, 5 y 6) y ponía «$» fuera del euro (2). Las filas 3 y 4
     * comparaban con `fmtPct` y `fmtNum`, que no agrupaban los miles, y la 5, con su «−0,00»: esos dos se retiran.
     */
    const filas = [
      ["importe 1.234,56", importe(1234.56), informe.importe(1234.56), `1.234,56${NBSP}€`],
      ["importe 1.234,56 USD", importe(1234.56, "USD"), informe.importe(1234.56, { divisa: "USD" }), `1.234,56${NBSP}USD`],
      ["porcentaje 12,345", porcentaje(12.345), informe.porcentaje(12.345), `1.234,50${NBSP}%`],
      ["número 1.234,56", ratio(1234.56), informe.ratio(1234.56), "1.234,56"],
      ["porcentaje −0,004 %", porcentaje(-0.00004), informe.porcentaje(-0.00004), `0,00${NBSP}%`],
      ["número −0,001", ratio(-0.001), informe.ratio(-0.001), "0,00"],
      ["importe −0,005 en euros enteros", importeRedondo(-0.005), informe.importeTitular(-0.005), `0${NBSP}€`],
      ["puntos +1,23", puntos(0.0123), informe.puntos(0.0123), `+1,23${NBSP}pp`]
    ];
    for (const [cifra, pantalla, otro, esperado] of filas) {
      expect([cifra, pantalla, otro]).toEqual([cifra, esperado, esperado]);
    }
  });
});
