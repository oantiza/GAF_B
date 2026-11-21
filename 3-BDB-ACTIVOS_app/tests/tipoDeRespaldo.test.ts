/**
 * Decisión 89: el tipo sin riesgo de respaldo se dice en la hoja donde se lee el Sharpe, y solo si ocurre. Cada caso está escrito a mano
 * con lo que manda el servidor: la política, el aviso, o los dos.
 */
import { describe, expect, test } from "vitest";
import { fraseDelTipoDeRespaldo, tipoDeRespaldo } from "../src/core/tipoDeRespaldo";

describe("tipoDeRespaldo", () => {
  test("con el €STR leído no hay respaldo", () => {
    expect(tipoDeRespaldo({ risk_free: { risk_free_rate: 0.0275, risk_free_rate_policy: "WINDOW_AVERAGE" }, warnings: [], metrics: { rf_rate: 0.0275 } })).toBeNull();
  });

  test("la política lo marca, y la cifra sale de la respuesta", () => {
    expect(tipoDeRespaldo({ risk_free: { risk_free_rate: 0.0193, risk_free_rate_policy: "STATIC_FALLBACK" } })).toBe(0.0193);
    /* Otra cifra, otra frase: no está escrita en ningún sitio. */
    expect(tipoDeRespaldo({ risk_free: { risk_free_rate: 0.031, risk_free_rate_policy: "STATIC_FALLBACK" } })).toBe(0.031);
  });

  test("el aviso solo también lo marca: entonces la cifra es la que se ha usado en el cálculo", () => {
    expect(tipoDeRespaldo({ warnings: ["RISK_FREE_RATE_STATIC_FALLBACK"], metrics: { rf_rate: 0.0193 } })).toBe(0.0193);
    expect(tipoDeRespaldo({ risk_free: { risk_free_rate: 0.0193, risk_free_rate_policy: "WINDOW_AVERAGE" }, warnings: ["RISK_FREE_RATE_STATIC_FALLBACK"] })).toBe(0.0193);
  });

  test("otro aviso no lo marca: la cobertura parcial del €STR no es un tipo fijo", () => {
    expect(tipoDeRespaldo({ risk_free: { risk_free_rate: 0.0275, risk_free_rate_policy: "WINDOW_AVERAGE" }, warnings: ["RISK_FREE_RATE_PARTIAL_COVERAGE"] })).toBeNull();
  });

  test("sin respuesta, o marcado y sin cifra, no se inventa ninguna", () => {
    expect(tipoDeRespaldo(null)).toBeNull();
    expect(tipoDeRespaldo(undefined)).toBeNull();
    expect(tipoDeRespaldo({ warnings: ["RISK_FREE_RATE_STATIC_FALLBACK"] })).toBeNull();
    expect(tipoDeRespaldo({ warnings: ["RISK_FREE_RATE_STATIC_FALLBACK"], metrics: { rf_rate: Number.NaN } })).toBeNull();
  });
});

describe("la frase", () => {
  test("es la de la decisión, con dos decimales", () => {
    expect(fraseDelTipoDeRespaldo(0.0193)).toBe("Sharpe con un tipo fijo de respaldo (1,93\u00a0%): no se pudo leer el €STR del periodo.");
    expect(fraseDelTipoDeRespaldo(0.031)).toBe("Sharpe con un tipo fijo de respaldo (3,10\u00a0%): no se pudo leer el €STR del periodo.");
  });
});
