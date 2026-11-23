import { describe, expect, test } from "vitest";
import { CLAVE_SIN_CLASIFICAR, riesgoPorClase } from "../src/core/riesgoPorClase";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import type { PortfolioRiskContribution } from "../src/types/portfolioFrontier";

/**
 * AN1 (21-11-2026): lo que aporta al riesgo cada clase es la suma de lo que aportan sus posiciones. Las cifras esperadas salen
 * de una cuenta a mano sobre una cartera de tres activos con su covarianza escrita, no de la salida de la función.
 *
 * Cartera: A (renta variable) 50 %, B (renta fija) 30 %, C (renta variable) 20 %.
 * Volatilidades: A 20 %, B 5 %, C 10 %. Correlaciones: A-B −0,175; A-C 0,5; B-C 0.
 *
 *         A          B          C
 *   A  0,04      −0,00175     0,01
 *   B −0,00175    0,0025      0
 *   C  0,01       0           0,01
 *
 * Σw:
 *   (Σw)_A = 0,04·0,5 − 0,00175·0,3 + 0,01·0,2 = 0,02 − 0,000525 + 0,002 = 0,021475
 *   (Σw)_B = −0,00175·0,5 + 0,0025·0,3       = −0,000875 + 0,00075     = −0,000125
 *   (Σw)_C = 0,01·0,5 + 0,01·0,2             = 0,005 + 0,002           = 0,007
 * Varianza wᵀΣw = 0,5·0,021475 + 0,3·(−0,000125) + 0,2·0,007 = 0,0107375 − 0,0000375 + 0,0014 = 0,0121 → σ = 0,11 (11 %).
 *
 * Contribución de Euler RC_i = w_i (Σw)_i / σ:
 *   A = 0,0107375 / 0,11 = 0,0976136…   → 0,0107375 / 0,0121 = 88,7397 %
 *   B = −0,0000375 / 0,11 = −0,000340909… → −0,0000375 / 0,0121 = −0,3099 %
 *   C = 0,0014 / 0,11 = 0,0127273…      → 0,0014 / 0,0121 = 11,5702 %
 *   Suma: 0,0121 / 0,11 = 0,11 = σ.
 *
 * Por clase:
 *   Renta variable (A + C): peso 70 %; aporta (0,0107375 + 0,0014) / 0,0121 = 0,0121375 / 0,0121 = 100,3099 %,
 *                           0,0121375 / 0,11 = 0,1103409 de volatilidad.
 *   Renta fija (B):         peso 30 %; aporta −0,3099 %, −0,0003409 de volatilidad: con correlación negativa, la reduce.
 *   Suma de las clases: 100 %, y 0,1103409 − 0,0003409 = 0,11 = σ.
 *
 * `functions_python/tests/test_risk_contributions.py` comprueba que el servidor da esas mismas tres cifras con esta misma covarianza.
 */

const SIGMA = 0.11;
const W = [0.5, 0.3, 0.2];
const COV = [
  [0.04, -0.00175, 0.01],
  [-0.00175, 0.0025, 0],
  [0.01, 0, 0.01]
];

const activo = (asset_id: string, economic_asset_class: string) => ({ asset_id, economic_asset_class }) as unknown as BdbAssetDetail;
const ACTIVOS = [activo("A", "EQUITY"), activo("B", "FIXED_INCOME"), activo("C", "EQUITY")];

/** Lo que manda el servidor: el peso de la parte medida y la contribución en tanto por ciento (las cifras de la cuenta de arriba). */
const DEL_SERVIDOR: PortfolioRiskContribution[] = [
  { asset_id: "A", weight_pct: 50, risk_pct: (100 * 0.0107375) / 0.0121 },
  { asset_id: "B", weight_pct: 30, risk_pct: (100 * -0.0000375) / 0.0121 },
  { asset_id: "C", weight_pct: 20, risk_pct: (100 * 0.0014) / 0.0121 }
];

describe("lo que aporta al riesgo cada clase de activo", () => {
  test("la cuenta a mano cuadra con la covarianza: Σw, la varianza y las tres contribuciones", () => {
    const sigmaW = COV.map((fila) => fila.reduce((suma, c, j) => suma + c * W[j], 0));
    expect(sigmaW[0]).toBeCloseTo(0.021475, 12);
    expect(sigmaW[1]).toBeCloseTo(-0.000125, 12);
    expect(sigmaW[2]).toBeCloseTo(0.007, 12);
    const varianza = W.reduce((suma, w, i) => suma + w * sigmaW[i], 0);
    expect(varianza).toBeCloseTo(0.0121, 12);
    expect(Math.sqrt(varianza)).toBeCloseTo(SIGMA, 12);
    DEL_SERVIDOR.forEach((fila, i) => expect(fila.risk_pct).toBeCloseTo((100 * W[i] * sigmaW[i]) / varianza, 10));
  });

  test("cada clase suma las de sus posiciones, y las clases suman la volatilidad de la cartera", () => {
    const clases = riesgoPorClase(DEL_SERVIDOR, ACTIVOS)!;
    expect(clases.map((clase) => [clase.clave, clase.rotulo, clase.posiciones])).toEqual([
      ["EQUITY", "Renta variable", 2],
      ["FIXED_INCOME", "Renta fija", 1]
    ]);
    const [variable, fija] = clases;
    expect(variable.pesoPct).toBeCloseTo(70, 10);
    expect(variable.riesgoPct).toBeCloseTo(100.3099, 4);
    expect(fija.pesoPct).toBeCloseTo(30, 10);
    expect(fija.riesgoPct).toBeCloseTo(-0.3099, 4);
    /* En tanto por ciento suman 100, y llevadas a volatilidad (por σ) suman σ: 0,1103409 − 0,0003409 = 0,11. */
    expect(clases.reduce((suma, clase) => suma + clase.riesgoPct, 0)).toBeCloseTo(100, 10);
    expect((variable.riesgoPct / 100) * SIGMA).toBeCloseTo(0.1103409, 7);
    expect((fija.riesgoPct / 100) * SIGMA).toBeCloseTo(-0.0003409, 7);
    expect(clases.reduce((suma, clase) => suma + (clase.riesgoPct / 100) * SIGMA, 0)).toBeCloseTo(SIGMA, 12);
    /* Pesar no es aportar: la renta variable pesa el 70 % y aporta todo el riesgo. */
    expect(variable.riesgoPct - variable.pesoPct).toBeCloseTo(30.3099, 4);
  });

  test("una posición sin clase, o sin ficha, va a «Sin clasificar», la última aunque aporte más", () => {
    const clases = riesgoPorClase(DEL_SERVIDOR, [activo("A", "UNKNOWN"), activo("B", "FIXED_INCOME")])!;
    expect(clases.map((clase) => [clase.clave, clase.rotulo, clase.posiciones])).toEqual([
      ["FIXED_INCOME", "Renta fija", 1],
      [CLAVE_SIN_CLASIFICAR, "Sin clasificar", 2]
    ]);
    expect(clases[1].riesgoPct).toBeCloseTo(100.3099, 4);
  });

  test("un fondo mixto cuenta entero como «Mixto», como en el reparto por clase de la pantalla", () => {
    const clases = riesgoPorClase(DEL_SERVIDOR, [activo("A", "MIXED"), activo("B", "FIXED_INCOME"), activo("C", "EQUITY")])!;
    expect(clases.map((clase) => clase.rotulo)).toEqual(["Mixto", "Renta variable", "Renta fija"]);
    expect(clases[0].riesgoPct).toBeCloseTo(88.7397, 4);
  });

  test("sin aportaciones no hay reparto: midiendo, con volatilidad nula o sin serie", () => {
    expect(riesgoPorClase(undefined, ACTIVOS)).toBeNull();
    expect(riesgoPorClase(null, ACTIVOS)).toBeNull();
    expect(riesgoPorClase([], ACTIVOS)).toBeNull();
  });
});
