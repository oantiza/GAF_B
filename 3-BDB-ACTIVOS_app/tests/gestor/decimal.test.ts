import { describe, expect, it } from "vitest";
import { aTexto, cuadrar, d, esDecimal, leerCifra, redondear, sumar } from "../../src/gestor/motor/decimal";
import { aniosEntre, diasEntre, esDia, finDelAnioAnterior, lunesDeLaSemana, rangoDeDias, sumarDias, sumarMeses } from "../../src/gestor/motor/fechas";

describe("aritmética decimal", () => {
  it("suma sin el error de la coma flotante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(aTexto(d("0.1").plus(d("0.2")))).toBe("0.3");
    expect(aTexto(sumar(["19.99", "0.01", "-20"].map(d)))).toBe("0");
  });

  it("redondea al céntimo alejándose del cero en la mitad", () => {
    expect(aTexto(redondear(d("2.675")))).toBe("2.68"); // en coma flotante, 2.675 → 2,67
    expect(aTexto(redondear(d("-2.675")))).toBe("-2.68");
    expect(aTexto(redondear(d("1.005")))).toBe("1.01");
    expect(aTexto(redondear(d("123.4567"), 3))).toBe("123.457");
  });

  it("guarda el texto sin exponentes ni ceros de más", () => {
    expect(aTexto(d("0.00000012"))).toBe("0.00000012");
    expect(aTexto(d("1500.00"))).toBe("1500");
    expect(aTexto(d(0.1))).toBe("0.1");
    expect(aTexto(d("-0"))).toBe("0");
  });

  it("reconoce un decimal bien formado", () => {
    expect(["12", "-0.5", "3.", ".5", "+7"].every(esDecimal)).toBe(true);
    expect(["", "1,5", "1e5", "abc", "1.2.3", "NaN"].some(esDecimal)).toBe(false);
  });

  it("lee cifras escritas en español y en inglés", () => {
    const lee = (texto: string) => leerCifra(texto)?.toFixed();
    expect(lee("1.234,56")).toBe("1234.56");
    expect(lee("1234,56")).toBe("1234.56");
    expect(lee("1,234.56")).toBe("1234.56");
    expect(lee("1.234.567")).toBe("1234567");
    expect(lee("1.234")).toBe("1234"); // un punto y tres cifras detrás: millares
    expect(lee("12.5")).toBe("12.5");
    expect(lee("0.125")).toBe("0.125");
    expect(lee("1234.5678")).toBe("1234.5678");
    expect(lee("−12,5 €")).toBe("-12.5"); // con el menos tipográfico y la divisa
    expect(lee("3,5 %")).toBe("3.5");
    expect(lee("abc")).toBeUndefined();
    expect(lee("1,2,3")).toBeUndefined();
    expect(lee("")).toBeUndefined();
  });

  it("cuadra un desglose en céntimos con su total", () => {
    // 100 entre tres: 33,333… cada uno. Redondeados sueltos suman 99,99; cuadrados, 100,00.
    expect(cuadrar([100 / 3, 100 / 3, 100 / 3])).toEqual([33.34, 33.33, 33.33]);
    // Total 0,00 con partes que redondean a +0,01 y −0,00.
    expect(cuadrar([0.004, -0.004])).toEqual([0, 0]);
    expect(cuadrar([10.005, -3.335, -6.67]).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
  });
});

describe("fechas", () => {
  it("cuenta días y años por fechas", () => {
    expect(diasEntre("2024-01-01", "2024-12-31")).toBe(365); // 2024 es bisiesto
    expect(diasEntre("2024-03-01", "2024-02-28")).toBe(-2);
    expect(sumarDias("2024-02-28", 2)).toBe("2024-03-01");
    expect(aniosEntre("2024-01-01", "2025-01-01")).toBeCloseTo(366 / 365.2425, 12);
    expect(rangoDeDias("2024-02-27", "2024-03-01")).toEqual(["2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01"]);
  });

  it("suma meses sin salirse del mes", () => {
    expect(sumarMeses("2024-01-31", 1)).toBe("2024-02-29");
    expect(sumarMeses("2023-01-31", 1)).toBe("2023-02-28");
    expect(sumarMeses("2024-08-15", -6)).toBe("2024-02-15");
    expect(sumarMeses("2024-02-29", 6, true)).toBe("2024-08-31");
  });

  it("valida días y encuentra la semana y el año anterior", () => {
    expect(esDia("2024-02-29")).toBe(true);
    expect(esDia("2023-02-29")).toBe(false);
    expect(esDia("2024-2-9")).toBe(false);
    expect(lunesDeLaSemana("2026-11-13")).toBe("2026-11-09"); // el 13-11-2026 es viernes
    expect(lunesDeLaSemana("2026-11-15")).toBe("2026-11-09"); // el domingo cierra la semana ISO
    expect(finDelAnioAnterior("2026-11-13")).toBe("2025-12-31");
  });
});
