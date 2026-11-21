/*
 * El módulo único de formato (`src/core/formato.ts`). Cada texto esperado está escrito a mano, carácter a carácter:
 * `\u00a0` es el espacio duro que no se parte y `\u2212` el menos tipográfico, escritos como escapes para que se vean.
 *
 * El huso se fija al oeste de Greenwich: un día «AAAA-MM-DD» tiene que salir igual en cualquier huso, y un instante
 * cerca de medianoche tiene que salir en la hora local, que aquí es la de Nueva York (UTC-5 en noviembre).
 */
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import {
  cuantos,
  fecha,
  fechaDeEje,
  fechaLarga,
  fechaYHora,
  importe,
  importeGrande,
  importeTitular,
  numero,
  oFalta,
  periodo,
  peso,
  porcentaje,
  precio,
  puntos,
  ratio,
  rentabilidad,
  signoDe,
  titulos
} from "../src/core/formato";

const AUSENCIAS: Array<[string, number | null | undefined]> = [
  ["null", null],
  ["undefined", undefined],
  ["NaN", Number.NaN],
  ["infinito", Number.POSITIVE_INFINITY],
  ["menos infinito", Number.NEGATIVE_INFINITY]
];

describe("importe", () => {
  it.each([
    ["positivo", 1234.56, "1.234,56\u00a0€"],
    ["negativo", -1234.56, "\u22121.234,56\u00a0€"],
    ["cero", 0, "0,00\u00a0€"],
    ["menos cero", -0, "0,00\u00a0€"],
    ["redondea a cero desde abajo", -0.004, "0,00\u00a0€"],
    ["redondea a cero desde arriba", 0.004, "0,00\u00a0€"],
    ["cuatro cifras, con punto de millar", 1234, "1.234,00\u00a0€"],
    ["millones", 1234567.891, "1.234.567,89\u00a0€"],
    ["medio exacto hacia fuera", 1.005, "1,01\u00a0€"],
    ["medio exacto negativo hacia fuera", -1.005, "\u22121,01\u00a0€"],
    ["medio sobre la escritura corta", 2.675, "2,68\u00a0€"],
    ["menos de un céntimo que no es cero", -0.005, "\u22120,01\u00a0€"]
  ])("%s", (_caso, valor, esperado) => {
    expect(importe(valor)).toBe(esperado);
  });

  it("otra divisa lleva su código detrás", () => {
    expect(importe(1234.56, { divisa: "USD" })).toBe("1.234,56\u00a0USD");
    expect(importe(-5000, { divisa: "CHF" })).toBe("\u22125.000,00\u00a0CHF");
    expect(importe(12, { divisa: "gbp" })).toBe("12,00\u00a0GBP");
    expect(importe(12, { divisa: "eur" })).toBe("12,00\u00a0€");
  });

  it("los peniques no se convierten en libras: «GBp» y «GBX» se escriben como llegan", () => {
    /* El módulo pasaba todo código a mayúsculas, y «GBp» (peniques) salía «GBP» (libras): el mismo número, cien veces
       más. Se vio al pasar al formato único la ficha de un valor de Londres. */
    expect(importe(4250, { divisa: "GBp" })).toBe("4.250,00\u00a0GBp");
    expect(importe(4250, { divisa: "GBX" })).toBe("4.250,00\u00a0GBX");
    expect(importeGrande(1_500_000_000, { divisa: "GBp" })).toBe("1.500,0\u00a0M\u00a0GBp");
    expect(precio(4250.5, { divisa: "GBp" })).toBe("4.250,50\u00a0GBp");
    /* Y el euro es «€» lo escriba como lo escriba la fuente. */
    expect(importe(12, { divisa: "Eur" })).toBe("12,00\u00a0€");
  });

  it("sin divisa, la cifra sola", () => {
    expect(importe(1234.56, { divisa: null })).toBe("1.234,56");
  });

  it("con signo: el + solo si no es cero", () => {
    expect(importe(1234.56, { conSigno: true })).toBe("+1.234,56\u00a0€");
    expect(importe(-1234.56, { conSigno: true })).toBe("\u22121.234,56\u00a0€");
    expect(importe(0, { conSigno: true })).toBe("0,00\u00a0€");
    expect(importe(0.004, { conSigno: true })).toBe("0,00\u00a0€");
    expect(importe(-0.004, { conSigno: true })).toBe("0,00\u00a0€");
  });

  it("los decimales que se pidan", () => {
    expect(importe(1234.56, { decimales: 0 })).toBe("1.235\u00a0€");
    expect(importe(1234.5, { decimales: 3 })).toBe("1.234,500\u00a0€");
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(importe(valor)).toBeNull();
  });
});

describe("importeTitular", () => {
  it.each([
    ["positivo", 201298.4, "201.298\u00a0€"],
    ["medio hacia arriba", 201298.5, "201.299\u00a0€"],
    ["negativo", -201298.4, "\u2212201.298\u00a0€"],
    ["cuatro cifras", 1234, "1.234\u00a0€"],
    ["cero", 0, "0\u00a0€"],
    ["redondea a cero desde abajo", -0.4, "0\u00a0€"],
    ["redondea a cero desde arriba", 0.4, "0\u00a0€"]
  ])("%s", (_caso, valor, esperado) => {
    expect(importeTitular(valor)).toBe(esperado);
  });

  it("otra divisa y con signo", () => {
    expect(importeTitular(1234, { divisa: "USD" })).toBe("1.234\u00a0USD");
    expect(importeTitular(1234, { conSigno: true })).toBe("+1.234\u00a0€");
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(importeTitular(valor)).toBeNull();
  });
});

describe("importeGrande", () => {
  it.each([
    ["miles de millones", 2304300000, "2.304,3\u00a0M€"],
    ["negativo", -2304300000, "\u22122.304,3\u00a0M€"],
    ["un millón", 1000000, "1,0\u00a0M€"],
    ["en millones también por encima del billón", 12300000000000, "12.300.000,0\u00a0M€"],
    ["medio exacto hacia fuera", 50000, "0,1\u00a0M€"],
    ["medio sobre la escritura corta", 2304350000, "2.304,4\u00a0M€"],
    ["redondea a cero desde abajo", -40000, "0,0\u00a0M€"],
    ["redondea a cero desde arriba", 40000, "0,0\u00a0M€"],
    ["cero", 0, "0,0\u00a0M€"]
  ])("%s", (_caso, valor, esperado) => {
    expect(importeGrande(valor)).toBe(esperado);
  });

  it("otra divisa: «M» y el código, sin partirse", () => {
    expect(importeGrande(1500000000, { divisa: "USD" })).toBe("1.500,0\u00a0M\u00a0USD");
  });

  it("con signo", () => {
    expect(importeGrande(2304300000, { conSigno: true })).toBe("+2.304,3\u00a0M€");
    expect(importeGrande(40000, { conSigno: true })).toBe("0,0\u00a0M€");
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(importeGrande(valor)).toBeNull();
  });
});

describe("rentabilidad", () => {
  it.each([
    ["positiva", 0.1039, "+10,39\u00a0%"],
    ["negativa", -0.0472, "\u22124,72\u00a0%"],
    ["cero", 0, "0,00\u00a0%"],
    ["menos cero", -0, "0,00\u00a0%"],
    ["redondea a cero desde abajo", -0.00004, "0,00\u00a0%"],
    ["redondea a cero desde arriba", 0.00004, "0,00\u00a0%"],
    ["medio exacto hacia fuera", 0.00005, "+0,01\u00a0%"],
    ["medio exacto negativo hacia fuera", -0.00005, "\u22120,01\u00a0%"],
    // 0,00035 × 100 da 0,034999… en coma flotante; la escritura decimal dice 0,035, y se redondea eso.
    ["medio que la coma flotante escondería", 0.00035, "+0,04\u00a0%"],
    ["cuatro cifras", 12.3456, "+1.234,56\u00a0%"],
    ["pérdida total", -1, "\u2212100,00\u00a0%"]
  ])("%s", (_caso, valor, esperado) => {
    expect(rentabilidad(valor)).toBe(esperado);
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(rentabilidad(valor)).toBeNull();
  });
});

describe("porcentaje", () => {
  it.each([
    ["positivo, sin signo", 0.078, "7,80\u00a0%"],
    ["negativo", -0.114, "\u221211,40\u00a0%"],
    ["cero", 0, "0,00\u00a0%"],
    ["redondea a cero desde abajo", -0.00004, "0,00\u00a0%"],
    ["redondea a cero desde arriba", 0.00004, "0,00\u00a0%"],
    ["coste", 0.0208, "2,08\u00a0%"],
    ["cuatro cifras", 10.5, "1.050,00\u00a0%"],
    ["medio exacto", 0.00035, "0,04\u00a0%"]
  ])("%s", (_caso, valor, esperado) => {
    expect(porcentaje(valor)).toBe(esperado);
  });

  it("con signo, si se pide", () => {
    expect(porcentaje(0.078, { conSigno: true })).toBe("+7,80\u00a0%");
    expect(porcentaje(0.00004, { conSigno: true })).toBe("0,00\u00a0%");
  });

  it("los decimales que se pidan", () => {
    expect(porcentaje(0.0208, { decimales: 1 })).toBe("2,1\u00a0%");
    expect(porcentaje(0.25, { decimales: 0 })).toBe("25\u00a0%");
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(porcentaje(valor)).toBeNull();
  });
});

describe("peso", () => {
  it.each([
    ["un cuarto", 0.24, "24,0\u00a0%"],
    ["un tercio", 1 / 3, "33,3\u00a0%"],
    ["toda la cartera", 1, "100,0\u00a0%"],
    ["cero", 0, "0,0\u00a0%"],
    ["redondea a cero desde abajo", -0.0004, "0,0\u00a0%"],
    ["redondea a cero desde arriba", 0.0004, "0,0\u00a0%"],
    ["medio exacto", 0.0005, "0,1\u00a0%"],
    ["negativo (corto)", -0.05, "\u22125,0\u00a0%"]
  ])("%s", (_caso, valor, esperado) => {
    expect(peso(valor)).toBe(esperado);
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(peso(valor)).toBeNull();
  });
});

describe("puntos", () => {
  it.each([
    ["positiva", 0.0125, "+1,25\u00a0pp"],
    ["negativa", -0.0472, "\u22124,72\u00a0pp"],
    ["cero", 0, "0,00\u00a0pp"],
    ["redondea a cero desde abajo", -0.00004, "0,00\u00a0pp"],
    ["redondea a cero desde arriba", 0.00004, "0,00\u00a0pp"],
    ["medio exacto", 0.00005, "+0,01\u00a0pp"]
  ])("%s", (_caso, valor, esperado) => {
    expect(puntos(valor)).toBe(esperado);
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(puntos(valor)).toBeNull();
  });
});

describe("ratio", () => {
  it.each([
    ["positivo", 1.18, "1,18"],
    ["negativo", -0.456, "\u22120,46"],
    ["cero", 0, "0,00"],
    ["redondea a cero desde abajo", -0.004, "0,00"],
    ["redondea a cero desde arriba", 0.004, "0,00"],
    ["cuatro cifras", 1234.5, "1.234,50"],
    ["medio exacto", 1.005, "1,01"]
  ])("%s", (_caso, valor, esperado) => {
    expect(ratio(valor)).toBe(esperado);
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(ratio(valor)).toBeNull();
  });
});

describe("precio", () => {
  it.each([
    ["dos decimales", 535.02, "535,02\u00a0€"],
    ["entero, con dos de relleno", 535, "535,00\u00a0€"],
    ["tres decimales", 12.345, "12,345\u00a0€"],
    ["más de cuatro, a cuatro", 12.345678, "12,3457\u00a0€"],
    ["cuatro cifras", 1234.5, "1.234,50\u00a0€"],
    ["cero", 0, "0,00\u00a0€"],
    ["redondea a cero", -0.00004, "0,00\u00a0€"]
  ])("%s", (_caso, valor, esperado) => {
    expect(precio(valor)).toBe(esperado);
  });

  it("otra divisa y sin divisa", () => {
    expect(precio(1.0834, { divisa: "USD" })).toBe("1,0834\u00a0USD");
    expect(precio(535.02, { divisa: null })).toBe("535,02");
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(precio(valor)).toBeNull();
  });
});

describe("titulos", () => {
  it.each([
    ["con decimales", 17.6642, "17,6642"],
    ["entero, sin ceros de relleno", 1051, "1.051"],
    ["muchos decimales, a seis", 0.1234567, "0,123457"],
    ["negativo", -12.5, "\u221212,5"],
    ["cero", 0, "0"],
    ["redondea a cero", -0.0000001, "0"],
    ["millones", 1234567.5, "1.234.567,5"]
  ])("%s", (_caso, valor, esperado) => {
    expect(titulos(valor)).toBe(esperado);
  });

  it("admite un decimal del gestor (lo que tenga `toNumber`)", () => {
    expect(titulos({ toNumber: () => 17.5 })).toBe("17,5");
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(titulos(valor)).toBeNull();
  });
});

describe("numero", () => {
  it.each([
    ["cuatro cifras, sin decimales por defecto", 1334, "1.334"],
    ["medio exacto", 1334.5, "1.335"],
    ["negativo", -3, "\u22123"],
    ["redondea a cero desde abajo", -0.4, "0"],
    ["redondea a cero desde arriba", 0.4, "0"],
    ["millones", 39285000, "39.285.000"]
  ])("%s", (_caso, valor, esperado) => {
    expect(numero(valor)).toBe(esperado);
  });

  it("decimales y signo, si se piden", () => {
    expect(numero(1234.5, { decimales: 2 })).toBe("1.234,50");
    expect(numero(5, { conSigno: true })).toBe("+5");
    expect(numero(0, { conSigno: true })).toBe("0");
  });

  it.each(AUSENCIAS)("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(numero(valor)).toBeNull();
  });
});

describe("fechas", () => {
  it("un día ISO se pinta tal cual, también al oeste de Greenwich", () => {
    expect(fecha("2026-11-13")).toBe("13/11/2026");
    expect(fecha("2026-01-01")).toBe("01/01/2026");
    expect(fechaLarga("2026-11-13")).toBe("13 de noviembre de 2026");
    expect(fechaLarga("2026-09-01")).toBe("1 de septiembre de 2026");
    expect(fechaDeEje("2026-11-13")).toBe("nov 2026");
    expect(fechaDeEje("2026-01-01")).toBe("ene 2026");
  });

  it("un instante cerca de medianoche se pinta en la hora local", () => {
    // 03:30 en Greenwich son las 22:30 del día anterior en Nueva York.
    expect(fecha("2026-11-13T03:30:00Z")).toBe("12/11/2026");
    expect(fechaLarga("2026-11-13T03:30:00Z")).toBe("12 de noviembre de 2026");
    expect(fechaYHora("2026-11-13T03:30:00Z")).toBe("12/11/2026 22:30");
    expect(fechaYHora("2026-11-13T05:05:00Z")).toBe("13/11/2026 00:05");
    // Y el primero de mes hacia atrás cambia también el mes del eje.
    expect(fechaDeEje("2026-12-01T02:00:00Z")).toBe("nov 2026");
  });

  it("un objeto Date es un instante, en hora local", () => {
    expect(fecha(new Date(2026, 10, 13, 23, 59))).toBe("13/11/2026");
    expect(fechaYHora(new Date(2026, 10, 13, 14, 30))).toBe("13/11/2026 14:30");
  });

  it("fechaYHora de un día sin hora no se inventa la hora", () => {
    expect(fechaYHora("2026-11-13")).toBe("13/11/2026");
  });

  it("los meses abreviados son la lista propia: «sep», no «sept»", () => {
    const meses = Array.from({ length: 12 }, (_, i) => fechaDeEje(`2026-${String(i + 1).padStart(2, "0")}-15`));
    expect(meses).toEqual([
      "ene 2026",
      "feb 2026",
      "mar 2026",
      "abr 2026",
      "may 2026",
      "jun 2026",
      "jul 2026",
      "ago 2026",
      "sep 2026",
      "oct 2026",
      "nov 2026",
      "dic 2026"
    ]);
  });

  it("los meses escritos", () => {
    expect(fechaLarga("2026-02-28")).toBe("28 de febrero de 2026");
    expect(fechaLarga("2024-02-29")).toBe("29 de febrero de 2024");
    expect(fechaLarga("2026-12-31")).toBe("31 de diciembre de 2026");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["cadena vacía", ""],
    ["texto que no es fecha", "no es fecha"],
    ["día que no existe", "2026-02-30"],
    ["mes que no existe", "2026-13-01"],
    ["Date inválido", new Date("x")]
  ])("lo que falta no se formatea: %s", (_caso, valor) => {
    expect(fecha(valor)).toBeNull();
    expect(fechaLarga(valor)).toBeNull();
    expect(fechaDeEje(valor)).toBeNull();
    expect(fechaYHora(valor)).toBeNull();
  });
});

describe("periodo", () => {
  it("del … al …", () => {
    expect(periodo("2025-12-31", "2026-11-13")).toBe("del 31/12/2025 al 13/11/2026");
  });

  it("si falta un extremo, no hay periodo", () => {
    expect(periodo(null, "2026-11-13")).toBeNull();
    expect(periodo("2025-12-31", undefined)).toBeNull();
    expect(periodo("2025-12-31", "no es fecha")).toBeNull();
  });
});

describe("signoDe", () => {
  it.each([
    [-0.004, 2, "neutro"],
    [0.004, 2, "neutro"],
    [0, 2, "neutro"],
    [-0, 2, "neutro"],
    [0.005, 2, "sube"],
    [-0.005, 2, "baja"],
    [1.5, 0, "sube"],
    [-0.4, 0, "neutro"],
    [-0.0001, 4, "baja"]
  ] as const)("signoDe(%s, %s) → %s", (valor, decimales, esperado) => {
    expect(signoDe(valor, decimales)).toBe(esperado);
  });

  it("mira la cifra que se pinta: una rentabilidad a dos decimales de porcentaje son cuatro de fracción", () => {
    expect(rentabilidad(-0.00004)).toBe("0,00\u00a0%");
    expect(signoDe(-0.00004, 4)).toBe("neutro");
    expect(signoDe(-0.00005, 4)).toBe("baja");
  });

  it.each(AUSENCIAS)("lo que falta no tiene signo: %s", (_caso, valor) => {
    expect(signoDe(valor, 2)).toBeNull();
  });
});

describe("oFalta", () => {
  it("devuelve el texto, o la frase de lo que falta", () => {
    expect(oFalta(importe(12))).toBe("12,00\u00a0€");
    expect(oFalta(importe(null))).toBe("Falta el dato");
    expect(oFalta(rentabilidad(Number.NaN), "No aplica")).toBe("No aplica");
    expect(oFalta(undefined)).toBe("Falta el dato");
  });
});

describe("invariantes en todo el módulo", () => {
  const valores = [-1234567.891, -1.005, -0.5, -0.004, -0.00004, -0, 0, 0.00004, 0.004, 0.5, 1.005, 1234567.891];
  const salidas = valores.flatMap((v) => [
    importe(v),
    importe(v, { divisa: "USD", conSigno: true }),
    importeTitular(v),
    importeGrande(v * 1e6),
    rentabilidad(v),
    porcentaje(v),
    peso(v),
    puntos(v),
    ratio(v),
    precio(v),
    titulos(v),
    numero(v, { conSigno: true })
  ]);

  it("nunca un guion, «NaN», «N/D», «—» ni cadena vacía", () => {
    for (const texto of salidas) {
      expect(texto).not.toBeNull();
      expect(texto).not.toMatch(/-|NaN|N\/D|—|^$/);
    }
  });

  it("nunca un cero con signo", () => {
    for (const texto of salidas) {
      expect(texto).not.toMatch(/^[+\u2212]0(,0+)?(\u00a0|$)/);
    }
  });

  it("nunca un espacio normal ni estrecho entre la cifra y su unidad", () => {
    for (const texto of salidas) {
      expect(texto).not.toMatch(/[ \u202f]/);
    }
  });
});

/* UI-3 (auditoría del 16-11-2026): «1 días», «1 fondos». El uno es el único singular. */
describe("cuantos", () => {
  it("uno va en singular; cero y los demás, en plural; y el millar lleva su punto", () => {
    expect(cuantos(1, "día", "días")).toBe("1 día");
    expect(cuantos(0, "día", "días")).toBe("0 días");
    expect(cuantos(2, "día", "días")).toBe("2 días");
    expect(cuantos(1334, "fondo", "fondos")).toBe("1.334 fondos");
    expect(cuantos(1, "posición", "posiciones")).toBe("1 posición");
  });
});
