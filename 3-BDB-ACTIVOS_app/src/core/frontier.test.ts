import { describe, expect, it } from "vitest";
import { computeFrontier, type FrontierAsset, type FrontierResult } from "./frontier";
import { assumedAssetClassCorrelation } from "./portfolioRiskModel";

const ASSETS: FrontierAsset[] = [
  {
    id: "EQUITY-A",
    name: "Equity A",
    expectedReturn: 0.08,
    volatility: 0.16,
    assetClass: "EQUITY"
  },
  {
    id: "FIXED-A",
    name: "Fixed A",
    expectedReturn: 0.035,
    volatility: 0.045,
    assetClass: "FIXED_INCOME"
  },
  {
    id: "MONEY-A",
    name: "Money A",
    expectedReturn: 0.025,
    volatility: 0.01,
    assetClass: "MONEY_MARKET"
  }
];

/* Repro de la auditoría A2 (06-09): ocho activos de cinco clases. */
const EIGHT: FrontierAsset[] = [
  { id: "MM", name: "Monetario", expectedReturn: 0.025, volatility: 0.008, assetClass: "MONEY_MARKET" },
  { id: "FI1", name: "RF corto", expectedReturn: 0.032, volatility: 0.03, assetClass: "FIXED_INCOME" },
  { id: "FI2", name: "RF largo", expectedReturn: 0.04, volatility: 0.07, assetClass: "FIXED_INCOME" },
  { id: "MX", name: "Mixto", expectedReturn: 0.055, volatility: 0.09, assetClass: "MIXED" },
  { id: "EQ1", name: "RV Europa", expectedReturn: 0.08, volatility: 0.16, assetClass: "EQUITY" },
  { id: "EQ2", name: "RV USA", expectedReturn: 0.11, volatility: 0.18, assetClass: "EQUITY" },
  { id: "EQ3", name: "RV emergente", expectedReturn: 0.09, volatility: 0.22, assetClass: "EQUITY" },
  { id: "ALT", name: "Alternativo", expectedReturn: 0.06, volatility: 0.12, assetClass: "ALTERNATIVE" }
];

function weightSum(weights: Record<string, number>): number {
  return Object.values(weights).reduce((sum, weight) => sum + weight, 0);
}

/* PRNG solo para generar carteras de contraste en los tests (el motor no usa ninguno). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomLongOnly(n: number, rng: () => number): number[] {
  const w = Array.from({ length: n }, () => -Math.log(1 - rng() * 0.999999));
  const sum = w.reduce((acc, x) => acc + x, 0);
  return w.map((x) => x / sum);
}

/* Misma covarianza asumida por clase que usa el motor. */
function stats(assets: FrontierAsset[], w: number[], riskFree: number) {
  let ret = 0;
  let variance = 0;
  for (let i = 0; i < w.length; i++) {
    ret += w[i] * assets[i].expectedReturn;
    for (let j = 0; j < w.length; j++) {
      const rho = i === j ? 1 : assumedAssetClassCorrelation(assets[i].assetClass, assets[j].assetClass);
      variance += w[i] * w[j] * rho * assets[i].volatility * assets[j].volatility;
    }
  }
  const vol = Math.sqrt(variance);
  return { ret, vol, sharpe: (ret - riskFree) / vol };
}

/* Volatilidad de la frontera interpolada linealmente a una rentabilidad dada.
   La cuerda queda POR ENCIMA de la curva convexa (error O(Δr²)), así que el
   test de envolvente usa una malla fina para que ese error quede muy por
   debajo de la tolerancia. */
function frontierVolAt(result: FrontierResult, ret: number): number | null {
  const f = result.frontier;
  if (ret < f[0].ret - 1e-12 || ret > f[f.length - 1].ret + 1e-12) return null;
  for (let i = 1; i < f.length; i++) {
    if (ret <= f[i].ret) {
      const t = (ret - f[i - 1].ret) / (f[i].ret - f[i - 1].ret);
      return f[i - 1].vol + t * (f[i].vol - f[i - 1].vol);
    }
  }
  return f[f.length - 1].vol;
}

describe("computeFrontier", () => {
  it("builds suggested portfolios and normalizes current weights", () => {
    const result = computeFrontier(ASSETS, {
      currentWeights: {
        "EQUITY-A": 60,
        "FIXED-A": 40
      }
    });

    expect(result).not.toBeNull();
    expect(result?.frontier.length).toBeGreaterThan(0);
    expect(weightSum(result?.maxSharpe.weights ?? {})).toBeCloseTo(1, 5);
    expect(weightSum(result?.minVol.weights ?? {})).toBeCloseTo(1, 5);
    expect(weightSum(result?.current?.weights ?? {})).toBeCloseTo(1, 5);
  });

  it("returns null when fewer than two assets are usable", () => {
    expect(computeFrontier(ASSETS.slice(0, 1))).toBeNull();
    expect(computeFrontier([{ ...ASSETS[0], volatility: 0 }])).toBeNull();
  });

  it("(1) dos activos no correlacionados: mínima varianza = fórmula cerrada", () => {
    const s1 = 0.12;
    const s2 = 0.2;
    const two: FrontierAsset[] = [
      { id: "A", name: "A", expectedReturn: 0.05, volatility: s1, assetClass: "EQUITY" },
      { id: "B", name: "B", expectedReturn: 0.09, volatility: s2, assetClass: "MIXED" }
    ];
    /* ρ = 0 literal: w₁ = σ₂² / (σ₁² + σ₂²). */
    const uncorrelated = computeFrontier(two, { correlation: () => 0 });
    expect(uncorrelated).not.toBeNull();
    const closedForm = (s2 * s2) / (s1 * s1 + s2 * s2);
    expect(uncorrelated!.frontierMinVol.weights.A).toBeCloseTo(closedForm, 6);
    expect(uncorrelated!.frontierMinVol.weights.B).toBeCloseTo(1 - closedForm, 6);
    expect(uncorrelated!.frontierMinVol.vol).toBeCloseTo(Math.sqrt((s1 * s1 * s2 * s2) / (s1 * s1 + s2 * s2)), 9);
    expect(uncorrelated!.frontier[0].vol).toBeCloseTo(uncorrelated!.frontierMinVol.vol, 12);
    /* Con la correlación asumida por clase (EQUITY–MIXED): fórmula general
       w₁ = (σ₂² − ρσ₁σ₂) / (σ₁² + σ₂² − 2ρσ₁σ₂). */
    const rho = assumedAssetClassCorrelation("EQUITY", "MIXED");
    const assumed = computeFrontier(two);
    const general = (s2 * s2 - rho * s1 * s2) / (s1 * s1 + s2 * s2 - 2 * rho * s1 * s2);
    expect(assumed!.frontierMinVol.weights.A).toBeCloseTo(general, 6);
  });

  it("(2) tres activos: ninguna cartera long-only queda a la izquierda de la frontera", () => {
    const result = computeFrontier(ASSETS, { points: 200 });
    expect(result).not.toBeNull();
    const rng = mulberry32(2026);
    let checked = 0;
    for (let sample = 0; sample < 1000; sample++) {
      const w = randomLongOnly(ASSETS.length, rng);
      const point = stats(ASSETS, w, result!.riskFree);
      const frontierVol = frontierVolAt(result!, point.ret);
      if (frontierVol === null) continue;
      checked += 1;
      expect(point.vol).toBeGreaterThanOrEqual(frontierVol - 1e-6);
    }
    expect(checked).toBeGreaterThan(900);
    /* La cartera 60/30/10 del repro de la auditoría tampoco. */
    const audited = stats(ASSETS, [0.1, 0.3, 0.6], result!.riskFree);
    expect(audited.vol).toBeGreaterThanOrEqual((frontierVolAt(result!, audited.ret) ?? 0) - 1e-6);
  });

  it("(3) el máximo Sharpe de la frontera domina a 2.000 carteras aleatorias", () => {
    const result = computeFrontier(EIGHT);
    expect(result).not.toBeNull();
    const rng = mulberry32(99);
    let best = -Infinity;
    for (let sample = 0; sample < 2000; sample++) {
      best = Math.max(best, stats(EIGHT, randomLongOnly(EIGHT.length, rng), result!.riskFree).sharpe);
    }
    expect(result!.frontierMaxSharpe.sharpe).toBeGreaterThanOrEqual(best - 1e-8);
    expect(Math.max(...result!.frontier.map((p) => p.sharpe))).toBeLessThanOrEqual(result!.frontierMaxSharpe.sharpe + 1e-12);
    /* Repro A2: mín. varianza y tangencia reales frente al casco Monte Carlo antiguo. */
    expect(result!.frontierMinVol.vol).toBeLessThan(0.0354);
    expect(result!.frontierMaxSharpe.sharpe).toBeGreaterThan(0.72);
  });

  it("(4) las cotas se respetan: frontera long-only y sugeridas dentro de tope y suelo", () => {
    const result = computeFrontier(EIGHT, { maxWeight: 0.3, minWeight: 0.05 });
    expect(result).not.toBeNull();
    expect(result!.maxWeight).toBeCloseTo(0.3, 12);
    expect(result!.minWeight).toBeCloseTo(0.05, 12);
    for (const point of result!.frontier) {
      expect(weightSum(point.weights)).toBeCloseTo(1, 5);
      for (const w of Object.values(point.weights)) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    for (const portfolio of [result!.maxSharpe, result!.minVol]) {
      expect(weightSum(portfolio.weights)).toBeCloseTo(1, 5);
      for (const w of Object.values(portfolio.weights)) {
        expect(w).toBeLessThanOrEqual(0.3 + 1e-6);
        expect(w === 0 || w >= 0.05 - 1e-6).toBe(true);
      }
    }
    /* Las sugeridas, con tope, no pueden batir a la tangencia sin tope. */
    expect(result!.maxSharpe.sharpe).toBeLessThanOrEqual(result!.frontierMaxSharpe.sharpe + 1e-9);
    expect(result!.minVol.vol).toBeGreaterThanOrEqual(result!.frontierMinVol.vol - 1e-9);
  });

  it("la rama eficiente es monótona: retorno creciente ⇒ volatilidad no decreciente", () => {
    const result = computeFrontier(EIGHT);
    expect(result).not.toBeNull();
    const f = result!.frontier;
    expect(f.length).toBeGreaterThanOrEqual(30);
    for (let i = 1; i < f.length; i++) {
      expect(f[i].ret).toBeGreaterThan(f[i - 1].ret);
      expect(f[i].vol).toBeGreaterThanOrEqual(f[i - 1].vol);
    }
    expect(f[0].vol).toBeCloseTo(result!.frontierMinVol.vol, 12);
    expect(f[f.length - 1].ret).toBeCloseTo(Math.max(...EIGHT.map((a) => a.expectedReturn)), 9);
  });

  it("(5) determinista y rápido con 40 activos", () => {
    const many: FrontierAsset[] = Array.from({ length: 40 }, (_, i) => ({
      id: `A${i}`,
      name: `A${i}`,
      expectedReturn: 0.02 + (0.1 * ((i * 7) % 11)) / 11,
      volatility: 0.01 + (0.25 * ((i * 5) % 13)) / 13,
      assetClass: ["EQUITY", "FIXED_INCOME", "MONEY_MARKET", "MIXED", "ALTERNATIVE"][i % 5]
    }));
    computeFrontier(many); // calentamiento del JIT
    const started = performance.now();
    const first = computeFrontier(many);
    const elapsed = performance.now() - started;
    const second = computeFrontier(many);
    expect(elapsed).toBeLessThan(200);
    expect(first).toEqual(second);
    expect(first!.frontier.length).toBeGreaterThanOrEqual(30);
  });
});
