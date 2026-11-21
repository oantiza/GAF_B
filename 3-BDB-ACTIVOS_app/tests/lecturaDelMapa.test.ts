import { describe, expect, test } from "vitest";
import { BENCHMARK_PROFILES } from "../src/core/benchmarkProfiles";
import { fraseDelMapa, lecturaDelMapa, rentabilidadDeLaLinea } from "../src/core/lecturaDelMapa";

/** Los perfiles de la muestra a 3 años, medidos en las mismas fechas (volatilidad, rentabilidad). */
const PERFILES = [
  { label: "Agresivo", vol: 0.1287, ret: 0.1961 },
  { label: "Conservador", vol: 0.0408, ret: 0.0286 },
  { label: "Equilibrado", vol: 0.0705, ret: 0.1116 },
  { label: "Moderado", vol: 0.0477, ret: 0.0699 },
  { label: "Dinámico", vol: 0.0987, ret: 0.1537 }
];

describe("la línea de perfiles", () => {
  test("se interpola entre los dos perfiles que rodean el nivel de oscilación, calculado a mano", () => {
    /* 0,1116 + (0,0776 − 0,0705) / (0,0987 − 0,0705) × (0,1537 − 0,1116) = 0,1116 + 0,25177 × 0,0421 = 0,12220 */
    expect(rentabilidadDeLaLinea(0.0776, PERFILES)).toBeCloseTo(0.1222, 4);
  });

  test("sobre un perfil es ese perfil, y fuera de la línea el más cercano", () => {
    expect(rentabilidadDeLaLinea(0.0705, PERFILES)).toBeCloseTo(0.1116, 10);
    expect(rentabilidadDeLaLinea(0.3, PERFILES)).toBeCloseTo(0.1961, 10);
    expect(rentabilidadDeLaLinea(0.01, PERFILES)).toBeCloseTo(0.0286, 10);
  });

  test("sin perfiles no hay línea", () => {
    expect(rentabilidadDeLaLinea(0.05, [])).toBeNull();
    expect(lecturaDelMapa({ vol: 0.05, ret: 0.05 }, [])).toBeNull();
  });
});

describe("la frase del mapa", () => {
  const frase = (vol: number, ret: number) => fraseDelMapa(lecturaDelMapa({ vol, ret }, PERFILES)!);

  test("la muestra queda en línea: 11,92 % frente a 12,22 % son 0,3 puntos, menos de medio", () => {
    const lectura = lecturaDelMapa({ vol: 0.0776, ret: 0.1192 }, PERFILES)!;
    expect(lectura.posicion).toBe("en_linea");
    expect(lectura.puntos).toBeCloseTo(0.3, 2);
    expect(fraseDelMapa(lectura)).toBe("En este periodo, la composición simulada queda en línea con las carteras de referencia para su nivel de oscilación. Es una medida del pasado, no anticipa el futuro.");
  });

  test("por encima, con los puntos del dato: 13,32 % frente a 12,22 %", () => {
    expect(frase(0.0776, 0.1332)).toBe("En este periodo, la composición simulada queda 1,10\u00a0pp por encima de la línea de carteras de referencia para su nivel de oscilación. Es una medida del pasado, no una ventaja asegurada.");
  });

  test("por debajo, con los puntos del dato: 11,00 % frente a 12,22 %", () => {
    expect(frase(0.0776, 0.11)).toBe("En este periodo, la composición simulada queda 1,22\u00a0pp por debajo de la línea de carteras de referencia para su nivel de oscilación. Es una medida del pasado, no anticipa el futuro.");
  });

  test("el margen de medio punto: a cada lado, lo que corresponde", () => {
    const linea = rentabilidadDeLaLinea(0.0776, PERFILES)!;
    expect(lecturaDelMapa({ vol: 0.0776, ret: linea + 0.0049 }, PERFILES)!.posicion).toBe("en_linea");
    expect(lecturaDelMapa({ vol: 0.0776, ret: linea + 0.0051 }, PERFILES)!.posicion).toBe("encima");
    expect(lecturaDelMapa({ vol: 0.0776, ret: linea - 0.0049 }, PERFILES)!.posicion).toBe("en_linea");
    expect(lecturaDelMapa({ vol: 0.0776, ret: linea - 0.0051 }, PERFILES)!.posicion).toBe("debajo");
  });

  test("si oscila más o menos que todos, no se habla de «su nivel»: la línea no llega", () => {
    /* 25,00 % frente a Agresivo, 19,61 %: 5,39 puntos. */
    expect(frase(0.2, 0.25)).toBe("En este periodo, la composición simulada oscila más que todas las carteras de referencia, así que la línea no llega a su nivel: queda 5,39\u00a0pp por encima de Agresivo, la cartera de referencia que más oscila. Es una medida del pasado, no una ventaja asegurada.");
    /* 1,00 % frente a Conservador, 2,86 %: 1,86 puntos. */
    expect(frase(0.01, 0.01)).toBe("En este periodo, la composición simulada oscila menos que todas las carteras de referencia, así que la línea no llega a su nivel: queda 1,86\u00a0pp por debajo de Conservador, la cartera de referencia que menos oscila. Es una medida del pasado, no anticipa el futuro.");
    expect(frase(0.2, 0.1961)).toContain("queda en línea con Agresivo");
  });

  test("describe y no juzga", () => {
    for (const texto of [frase(0.0776, 0.1332), frase(0.0776, 0.11), frase(0.0776, 0.1192), frase(0.2, 0.25)]) {
      expect(texto).not.toMatch(/correspondería|conviene|revisar|riesgo que asume/);
    }
  });

  test("«cinco carteras de referencia» de la guía sigue siendo cierto", () => {
    expect(BENCHMARK_PROFILES).toHaveLength(5);
  });
});
