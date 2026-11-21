import { expect, test } from "vitest";
import { TURNOVER_TOLERANCE, optimizationCoverageMessage, optimizationWeightIssue, pesosDelPunto, turnoverDistance, uncoveredPositionIds } from "../src/core/optimizationWeightValidation";

test("accepts a complete portfolio satisfying cap and exact locks", () => {
  expect(optimizationWeightIssue({ A: .2, B: .4, C: .4 }, ["A", "B", "C"], { A: .2 }, .4)).toBeNull();
});
test.each([
  [{ A: .1, B: .9 }, { A: .2 }, 1, "bloqueado"],
  [{ A: .2, B: .8 }, {}, .7, "máximo"],
  [{ A: .2, B: .7 }, {}, 1, "100"],
  [{ A: NaN, B: 1 }, {}, 1, "inválidos"],
  [{ A: -.1, B: 1.1 }, {}, 1, "inválidos"],
  [{ A: .2, C: .8 }, {}, 1, "inválidos"]
] as const)("rejects invalid weights %j", (weights, locks, cap, message) => {
  expect(optimizationWeightIssue(weights, ["A", "B"], locks, cap)).toContain(message);
});

/* R-01 (auditoría 29-09-2026): el tope del objetivo recorta la petición; la propuesta
   describe solo la parte incluida y no debe aplicarse a la cartera completa. */
test("rechaza una propuesta que no cubre todas las posiciones con peso", () => {
  const issue = optimizationWeightIssue({ A: .5, B: .5 }, ["A", "B", "C", "D"], {}, 1,
    { requiredAssetIds: ["A", "B", "C", "D"], maxAssets: 40 });
  expect(issue).toBe("La propuesta no cubre 2 posiciones de la cartera (límite de 40 activos por cálculo). Reduce la cartera.");
});
test("acepta una propuesta que cubre todas las posiciones aunque deje alguna a 0", () => {
  expect(optimizationWeightIssue({ A: .5, B: .5, C: 0 }, ["A", "B", "C"], {}, 1,
    { requiredAssetIds: ["A", "B", "C"] })).toBeNull();
});
test("una posición a 0 % en la cartera no exige cobertura", () => {
  expect(uncoveredPositionIds(
    [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }, { asset_id: "Z", weight_percent: 0 }],
    { A: .6, B: .4 }
  )).toEqual([]);
});
test("las posiciones sin candado que faltan en la propuesta se listan; las bloqueadas no", () => {
  expect(uncoveredPositionIds(
    [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 30 }, { asset_id: "C", weight_percent: 20 }],
    { A: 1 },
    { C: true }
  )).toEqual(["B"]);
});

/* Una posición que el optimizador deja a 0 %: el filtro de pintar la quitaba, y parecía que no la había considerado.
   Medido en la revisión: 6 de 6 objetivos con «Aplicar optimización» desactivado en una cartera de 7. */
test("los pesos de la propuesta son los del servidor, ceros incluidos; lo que se pinta no lleva los ceros", () => {
  const punto = { weights: [{ assetId: "A", weight: 1, weightLabel: "100,0 %" }], pesosCompletos: { A: 1, B: 0 } } as never;
  expect(pesosDelPunto(punto)).toEqual({ A: 1, B: 0 });
  expect(optimizationWeightIssue(pesosDelPunto(punto), ["A", "B"], {}, 1, { requiredAssetIds: ["A", "B"] })).toBeNull();
  expect(uncoveredPositionIds([{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }], pesosDelPunto(punto))).toEqual([]);
});

/* Auditoría 16-11-2026 (OPT-1): la cartera «Máx. Sharpe» que devolvió el motor con pesos de partida 79/20/1 y una
   rotación máxima del 45 % del patrimonio (0,90 como Σ|w − w₀|). La cuenta, a mano:
   |0,149 − 0,79| + |0 − 0,20| + |0,851 − 0,01| = 0,641 + 0,200 + 0,841 = 1,682 → se mueve el 84,1 %. */
test("una propuesta que mueve más que la rotación máxima no se aplica, y dice cuánto mueve", () => {
  const partida = { A: 0.79, B: 0.20, C: 0.01 };
  const rotacion = { currentWeights: partida, max: 0.90 };
  expect(turnoverDistance({ A: 0.149, B: 0, C: 0.851 }, partida)).toBeCloseTo(1.682, 12);
  expect(optimizationWeightIssue({ A: 0.149, B: 0, C: 0.851 }, ["A", "B", "C"], {}, 1, undefined, 0, rotacion))
    .toBe("La propuesta mueve el 84,1 % del patrimonio y la rotación máxima pedida es del 45,0 %. Vuelve a calcularla.");
  /* Justo en el tope: |0,34 − 0,79| + |0,20 − 0,20| + |0,46 − 0,01| = 0,45 + 0 + 0,45 = 0,90. */
  expect(optimizationWeightIssue({ A: 0.34, B: 0.20, C: 0.46 }, ["A", "B", "C"], {}, 1, undefined, 0, rotacion)).toBeNull();
  /* La holgura cubre lo que se pasa el solver (0,0004 aquí), no una décima de punto de más (0,002). */
  expect(optimizationWeightIssue({ A: 0.3398, B: 0.20, C: 0.4602 }, ["A", "B", "C"], {}, 1, undefined, 0, rotacion)).toBeNull();
  expect(optimizationWeightIssue({ A: 0.339, B: 0.20, C: 0.461 }, ["A", "B", "C"], {}, 1, undefined, 0, rotacion)).toContain("rotación máxima");
  /* Sin rotación pedida no se mira: la misma cartera pasa. */
  expect(optimizationWeightIssue({ A: 0.149, B: 0, C: 0.851 }, ["A", "B", "C"])).toBeNull();
  expect(TURNOVER_TOLERANCE).toBe(0.0005);
});

test("la rotación cuenta también lo que sale de la cartera y lo que entra nuevo", () => {
  /* Partida A 100 %; propuesta B 100 %: |0 − 1| + |1 − 0| = 2, el 100 % del patrimonio. */
  expect(turnoverDistance({ B: 1 }, { A: 1 })).toBe(2);
});

test("sin pesos completos, los que hay", () => {
  expect(pesosDelPunto({ weights: [{ assetId: "A", weight: 0.5, weightLabel: "" }] } as never)).toEqual({ A: 0.5 });
});

test("el límite y su consejo solo si de verdad se ha recortado la petición", () => {
  expect(optimizationCoverageMessage(4)).toBe("La propuesta no cubre 4 posiciones de la cartera. Vuelve a calcularla.");
  expect(optimizationCoverageMessage(1, 40)).toContain("límite de 40 activos por cálculo");
  /* Todos los objetivos admiten lo mismo: cambiarlo no ayuda, y no se aconseja. */
  expect(optimizationCoverageMessage(1, 40)).not.toContain("elige otro objetivo");
});
