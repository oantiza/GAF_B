import { describe, expect, test } from "vitest";
import { aportaMasRiesgoDelQuePesa, divisaDelPapel, regionDelPapel } from "../src/core/internalPortfolioReport";
import { CLAVE_SIN_DATO_DEL_REPARTO } from "../src/core/portfolio";

/* Decisiones de Óscar del 20-11-2026 sobre el informe interno. Cada caso, a mano: un peso se imprime con un decimal. */
describe("contribución al riesgo frente al peso: el ocre se decide con lo impreso", () => {
  test("1,41 % de peso y 1,44 % de riesgo se imprimen «1,4 % / 1,4 %»: no va en ocre", () => {
    expect(aportaMasRiesgoDelQuePesa(1.41, 1.44)).toBe(false);
  });
  test("1,40 % de peso y 1,46 % de riesgo se imprimen «1,4 % / 1,5 %»: sí", () => {
    expect(aportaMasRiesgoDelQuePesa(1.4, 1.46)).toBe(true);
  });
  test("10,0 % y 10,04 % se imprimen igual, «10,0 %»: no; 10,0 % y 10,06 %, «10,0 % / 10,1 %»: sí", () => {
    expect(aportaMasRiesgoDelQuePesa(10, 10.04)).toBe(false);
    expect(aportaMasRiesgoDelQuePesa(10, 10.06)).toBe(true);
  });
  test("aporta menos de lo que pesa, o un riesgo negativo: no", () => {
    expect(aportaMasRiesgoDelQuePesa(5, 3.2)).toBe(false);
    expect(aportaMasRiesgoDelQuePesa(5, -0.8)).toBe(false);
  });
});

describe("región declarada: lo que no trae región dice «Falta el dato»", () => {
  test("la clave de lo que falta se traduce, y una región se sigue nombrando como antes", () => {
    expect(regionDelPapel(CLAVE_SIN_DATO_DEL_REPARTO)).toBe("Falta el dato");
    expect(regionDelPapel("Spain")).toBe("España");
  });
});

describe("divisa de denominación: lo que no trae divisa dice «Falta el dato» (Óscar, 21-11-2026)", () => {
  test("la clave de lo que falta se traduce, y una divisa se sigue escribiendo por su código", () => {
    expect(divisaDelPapel(CLAVE_SIN_DATO_DEL_REPARTO)).toBe("Falta el dato");
    expect(divisaDelPapel("USD")).toBe("USD");
  });
});
