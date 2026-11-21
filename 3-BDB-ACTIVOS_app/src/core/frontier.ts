/**
 * Frontera eficiente APROXIMADA (lado cliente).
 *
 * No usa series históricas: parte de la rentabilidad y volatilidad por activo
 * (las que ya da el read model) + una matriz de correlación ASUMIDA por clase
 * de activo. Es una aproximación (igual que el resto de métricas "preview"),
 * no un backtest real.
 *
 * A2 (auditoría 06-09 / decisión 30-09): la frontera se resuelve como el
 * programa cuadrático de Markowitz —mín. wᵀΣw a rentabilidad dada, long-only,
 * suma 1— con un active-set exacto (n ≤ 40), sin Monte Carlo ni RNG. Es la
 * ENVOLVENTE de todas las carteras long-only: ninguna cartera factible queda a
 * su izquierda. Las carteras SUGERIDAS (máx. Sharpe y mín. volatilidad)
 * aplican además el tope y el suelo de concentración por activo, así que
 * pueden quedar ligeramente por dentro de la curva.
 *
 * Cuando hay series históricas, la frontera del backend la sustituye
 * manteniendo esta misma interfaz de salida para la UI.
 */
import { MAX_GENERATED_WEIGHT, MIN_GENERATED_WEIGHT, RISK_FREE_RATE } from "./quantConfig";
import { assumedAssetClassCorrelation } from "./portfolioRiskModel";

export interface FrontierAsset {
  id: string;
  name: string;
  expectedReturn: number; // decimal anual (0.12 = 12%)
  volatility: number; // decimal anual (0.18 = 18%)
  assetClass: string; // EQUITY | FIXED_INCOME | MONEY_MARKET | MIXED | ALTERNATIVE | REAL_ASSET | ...
}

export interface FrontierPoint {
  vol: number;
  ret: number;
  sharpe: number;
}

export interface FrontierPortfolio extends FrontierPoint {
  weights: Record<string, number>;
}

export interface FrontierAssetPoint {
  id: string;
  name: string;
  vol: number;
  ret: number;
}

export interface FrontierResult {
  /** Rama eficiente (retorno creciente ⇒ volatilidad no decreciente), con pesos. */
  frontier: FrontierPortfolio[];
  /** Sugerida: máx. Sharpe con tope/suelo de concentración. */
  maxSharpe: FrontierPortfolio;
  /** Sugerida: mín. volatilidad con tope/suelo de concentración. */
  minVol: FrontierPortfolio;
  /** Extremo izquierdo de la frontera (mín. varianza global, sin tope). */
  frontierMinVol: FrontierPortfolio;
  /** Tangencia: máx. Sharpe sobre la frontera (sin tope). */
  frontierMaxSharpe: FrontierPortfolio;
  current: FrontierPortfolio | null;
  assets: FrontierAssetPoint[];
  riskFree: number;
  maxWeight: number; // tope de concentración aplicado a las carteras sugeridas (decimal)
  minWeight: number; // peso mínimo aplicado a las carteras sugeridas (decimal)
  approximate: true;
}

export interface FrontierOptions {
  riskFree?: number; // decimal anual; por defecto ~€STR
  currentWeights?: Record<string, number>; // pesos actuales (decimal, suman ~1)
  maxWeight?: number; // tope por activo en las sugeridas (decimal); por defecto 0.30
  minWeight?: number; // mínimo por activo en las sugeridas (decimal); por defecto 0.05
  /** Nº aproximado de puntos de la frontera (malla de rentabilidades objetivo). */
  points?: number;
  /** Correlación entre dos activos distintos; por defecto la asumida por clase. */
  correlation?: (a: FrontierAsset, b: FrontierAsset) => number;
}

function covarianceMatrix(
  assets: FrontierAsset[],
  correlation: (a: FrontierAsset, b: FrontierAsset) => number
): number[][] {
  const n = assets.length;
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const rho = i === j ? 1 : correlation(assets[i], assets[j]);
      cov[i][j] = rho * assets[i].volatility * assets[j].volatility;
    }
  }
  return cov;
}

function portfolioStats(
  weights: number[],
  mu: number[],
  cov: number[][],
  riskFree: number
): FrontierPoint {
  const n = weights.length;
  let ret = 0;
  for (let i = 0; i < n; i++) ret += weights[i] * mu[i];
  let variance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      variance += weights[i] * weights[j] * cov[i][j];
    }
  }
  const vol = Math.sqrt(Math.max(variance, 0));
  const sharpe = vol > 1e-9 ? (ret - riskFree) / vol : 0;
  return { vol, ret, sharpe };
}

function toWeightMap(ids: string[], w: number[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (let i = 0; i < ids.length; i++) m[ids[i]] = Math.round(w[i] * 1e6) / 1e6;
  return m;
}

/* ------------------------------------------------------------------------ */
/* QP media-varianza: mín ½ wᵀΣw − λ μᵀw  s.a.  Σw = 1,  lo ≤ w ≤ hi.        */
/*                                                                          */
/* Active-set primal (Nocedal & Wright, alg. 16.3) sobre las cotas, con la   */
/* restricción de suma como igualdad del sistema KKT. Con Σ definida        */
/* positiva termina en un número finito de pasos y el óptimo es exacto      */
/* (salvo redondeo de la eliminación gaussiana, ~1e-15). El parámetro λ ≥ 0 */
/* recorre la rama eficiente: λ = 0 es la mínima varianza global y λ → ∞ la */
/* cartera de máximo retorno; retorno y varianza son no decrecientes en λ.  */
/* ------------------------------------------------------------------------ */

type BoundState = 0 | 1 | 2; // 0 libre · 1 en la cota inferior · 2 en la cota superior

interface QpBounds {
  lo: number[];
  hi: number[];
}

interface QpSolution {
  w: number[];
  state: BoundState[];
}

/** Ridge relativo del bloque Σ_FF del sistema KKT (solo protege de singularidades numéricas). */
const KKT_RIDGE = 1e-14;
const STEP_TOL = 1e-14;
const BOUND_TOL = 1e-12;
/** Tolerancia relativa con la que la malla de retornos objetivo se da por alcanzada. */
const TARGET_TOL = 0.02;

/** Elimina un sistema denso (m ≤ 41) con pivotaje parcial; null si es singular. */
function solveDense(a: number[][], b: number[]): number[] | null {
  const m = b.length;
  const M = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let row = col + 1; row < m; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-300) return null;
    if (pivot !== col) {
      const tmp = M[pivot];
      M[pivot] = M[col];
      M[col] = tmp;
    }
    const inv = 1 / M[col][col];
    for (let row = col + 1; row < m; row++) {
      const factor = M[row][col] * inv;
      if (factor === 0) continue;
      for (let k = col; k <= m; k++) M[row][k] -= factor * M[col][k];
    }
  }
  const x = new Array<number>(m).fill(0);
  for (let row = m - 1; row >= 0; row--) {
    let s = M[row][m];
    for (let k = row + 1; k < m; k++) s -= M[row][k] * x[k];
    x[row] = s / M[row][row];
  }
  return x;
}

/** Proyección de un vector sobre { Σw = 1, lo ≤ w ≤ hi } (bisección del desplazamiento). */
function projectToBoxSimplex(v: number[], bounds: QpBounds): number[] {
  const { lo, hi } = bounds;
  const n = v.length;
  const sumAt = (tau: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.min(hi[i], Math.max(lo[i], v[i] - tau));
    return s;
  };
  let a = Math.min(...v) - Math.max(...hi) - 1;
  let b = Math.max(...v) - Math.min(...lo) + 1;
  for (let iter = 0; iter < 200 && b - a > 1e-16; iter++) {
    const mid = (a + b) / 2;
    if (sumAt(mid) > 1) a = mid;
    else b = mid;
  }
  const tau = (a + b) / 2;
  const out = v.map((x, i) => Math.min(hi[i], Math.max(lo[i], x - tau)));
  return out;
}

function statesFromWeights(w: number[], bounds: QpBounds): BoundState[] {
  return w.map((x, i) => (x <= bounds.lo[i] + BOUND_TOL ? 1 : x >= bounds.hi[i] - BOUND_TOL ? 2 : 0));
}

function gradient(cov: number[][], mu: number[], w: number[], lambda: number): number[] {
  const n = w.length;
  const g = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = cov[i];
    for (let j = 0; j < n; j++) s += row[j] * w[j];
    g[i] = s - lambda * mu[i];
  }
  return g;
}

function solveLambdaQp(
  cov: number[][],
  mu: number[],
  lambda: number,
  bounds: QpBounds,
  warm?: number[]
): QpSolution {
  const n = mu.length;
  // Arranque factible: la solución previa (las restricciones no dependen de λ)
  // o la proyección de pesos iguales sobre el símplex acotado.
  const w = warm && warm.length === n ? warm.slice() : projectToBoxSimplex(new Array<number>(n).fill(1 / n), bounds);
  const state = statesFromWeights(w, bounds);
  const maxIter = 6 * n + 40;
  for (let iter = 0; iter < maxIter; iter++) {
    let g = gradient(cov, mu, w, lambda);
    const free: number[] = [];
    for (let i = 0; i < n; i++) if (state[i] === 0) free.push(i);

    let stepped = false;
    if (free.length > 0) {
      const m = free.length + 1;
      const a: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
      const b = new Array<number>(m).fill(0);
      for (let r = 0; r < free.length; r++) {
        for (let c = 0; c < free.length; c++) a[r][c] = cov[free[r]][free[c]];
        a[r][r] += KKT_RIDGE * cov[free[r]][free[r]];
        a[r][free.length] = 1;
        a[free.length][r] = 1;
        b[r] = -g[free[r]];
      }
      const sol = solveDense(a, b);
      if (sol) {
        let alpha = 1;
        let blocking = -1;
        let blockingState: BoundState = 0;
        let moved = false;
        for (let r = 0; r < free.length; r++) {
          const p = sol[r];
          if (Math.abs(p) <= STEP_TOL) continue;
          moved = true;
          const i = free[r];
          if (p < 0) {
            const t = (bounds.lo[i] - w[i]) / p;
            if (t < alpha) {
              alpha = t;
              blocking = i;
              blockingState = 1;
            }
          } else {
            const t = (bounds.hi[i] - w[i]) / p;
            if (t < alpha) {
              alpha = t;
              blocking = i;
              blockingState = 2;
            }
          }
        }
        if (moved) {
          alpha = Math.max(0, alpha);
          for (let r = 0; r < free.length; r++) w[free[r]] += alpha * sol[r];
          if (blocking >= 0) {
            w[blocking] = blockingState === 1 ? bounds.lo[blocking] : bounds.hi[blocking];
            state[blocking] = blockingState;
            stepped = true;
          }
          // Corrige el redondeo acumulado para que la suma siga siendo exactamente 1.
          const stillFree = free.filter((i) => i !== blocking);
          if (stillFree.length > 0) {
            let sum = 0;
            for (let i = 0; i < n; i++) sum += w[i];
            const share = (1 - sum) / stillFree.length;
            for (const i of stillFree) w[i] += share;
          }
        }
      }
    }
    if (stepped) continue;

    // Paso completo (o ninguno): comprobación de multiplicadores.
    g = gradient(cov, mu, w, lambda);
    let nu: number;
    if (free.length > 0) {
      nu = 0;
      for (const i of free) nu += g[i];
      nu /= free.length;
    } else {
      let minLower = Infinity;
      let maxUpper = -Infinity;
      for (let i = 0; i < n; i++) {
        if (state[i] === 1) minLower = Math.min(minLower, g[i]);
        else maxUpper = Math.max(maxUpper, g[i]);
      }
      nu = Number.isFinite(minLower) && Number.isFinite(maxUpper) ? (minLower + maxUpper) / 2
        : Number.isFinite(minLower) ? minLower : maxUpper;
    }
    let scale = 1e-300;
    for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(g[i]));
    const tol = 1e-11 * (1 + scale);
    let worst = -tol;
    let worstIdx = -1;
    for (let i = 0; i < n; i++) {
      if (state[i] === 0) continue;
      // Variables fijadas por cotas iguales no se liberan nunca.
      if (bounds.hi[i] - bounds.lo[i] <= BOUND_TOL) continue;
      const multiplier = state[i] === 1 ? g[i] - nu : nu - g[i];
      if (multiplier < worst) {
        worst = multiplier;
        worstIdx = i;
      }
    }
    if (worstIdx < 0) break;
    state[worstIdx] = 0;
  }
  return { w, state };
}

/** Cartera de máximo retorno con las cotas: rellena por retorno descendente (LP exacto). */
function maxReturnPortfolio(mu: number[], bounds: QpBounds): number[] {
  const w = bounds.lo.slice();
  let remaining = 1 - w.reduce((s, x) => s + x, 0);
  const order = mu.map((_, i) => i).sort((a, b) => mu[b] - mu[a] || a - b);
  for (const i of order) {
    if (remaining <= 0) break;
    const add = Math.min(bounds.hi[i] - bounds.lo[i], remaining);
    w[i] += add;
    remaining -= add;
  }
  return w;
}

interface TracedPoint {
  lambda: number;
  w: number[];
  stats: FrontierPoint;
}

interface FrontierTrace {
  points: TracedPoint[]; // ordenados por λ (y por tanto por retorno y varianza)
  minVol: TracedPoint;
  maxSharpe: TracedPoint;
}

/**
 * Recorre la rama eficiente con λ ≥ 0 sobre una malla de ~`pointsWanted`
 * rentabilidades objetivo, equiespaciadas entre la mínima varianza global y el
 * retorno máximo factible. Para cada objetivo se busca el λ que lo alcanza
 * (regula falsi con salvaguarda: r(λ) es continua, monótona y lineal a trozos).
 * Cada punto evaluado es un óptimo exacto del QP a su propio retorno, así que
 * la curva es la envolvente aunque el objetivo no se clave al milímetro.
 */
function traceFrontier(
  cov: number[][],
  mu: number[],
  riskFree: number,
  bounds: QpBounds,
  pointsWanted: number
): FrontierTrace {
  const stats = (w: number[]) => portfolioStats(w, mu, cov, riskFree);
  const evaluate = (lambda: number, warm?: number[]): TracedPoint => {
    const sol = solveLambdaQp(cov, mu, lambda, bounds, warm);
    return { lambda, w: sol.w, stats: stats(sol.w) };
  };

  const minVol = evaluate(0);
  const maxRetW = maxReturnPortfolio(mu, bounds);
  const maxRet = stats(maxRetW).ret;
  const span = maxRet - minVol.stats.ret;
  if (span <= 1e-12) {
    return { points: [minVol], minVol, maxSharpe: minVol };
  }

  // λ suficientemente grande: la solución alcanza el retorno máximo (el último
  // tramo de la solución paramétrica es constante, así que se alcanza exacto).
  let lambdaHi = 1e-3;
  let hiPoint = evaluate(lambdaHi, minVol.w);
  for (let iter = 0; iter < 80 && maxRet - hiPoint.stats.ret > span * 1e-9; iter++) {
    lambdaHi *= 2;
    hiPoint = evaluate(lambdaHi, hiPoint.w);
  }

  const steps = Math.max(2, pointsWanted - 1);
  const gap = span / steps;
  const tol = gap * TARGET_TOL;
  const collected: TracedPoint[] = [minVol];
  let lo = minVol;
  for (let k = 1; k < steps; k++) {
    const target = minVol.stats.ret + gap * k;
    if (target >= hiPoint.stats.ret - tol) break;
    let hi = hiPoint;
    let found: TracedPoint | null = null;
    let sideLo = 0;
    let sideHi = 0;
    for (let iter = 0; iter < 60; iter++) {
      const fLo = lo.stats.ret - target;
      const fHi = hi.stats.ret - target;
      const width = hi.lambda - lo.lambda;
      let next = hi.lambda - (fHi * width) / (fHi - fLo);
      if (!Number.isFinite(next) || next <= lo.lambda + 1e-3 * width || next >= hi.lambda - 1e-3 * width) {
        next = lo.lambda + width / 2;
      }
      const p = evaluate(next, lo.w);
      if (Math.abs(p.stats.ret - target) <= tol) {
        found = p;
        break;
      }
      if (p.stats.ret < target) {
        lo = p;
        sideLo += 1;
        sideHi = 0;
        // Illinois: si el mismo lado se repite, el siguiente corte tiende al centro.
        if (sideLo >= 2) hi = { ...hi, stats: { ...hi.stats, ret: target + (hi.stats.ret - target) / 2 } };
      } else {
        hi = p;
        sideHi += 1;
        sideLo = 0;
        if (sideHi >= 2) lo = { ...lo, stats: { ...lo.stats, ret: target - (target - lo.stats.ret) / 2 } };
      }
      if (width <= 1e-12 * (1 + hi.lambda)) break;
    }
    if (!found) {
      // Salvaguarda: el extremo del corchete más cercano ya es un punto válido de la frontera.
      const loReal = evaluate(lo.lambda, lo.w);
      const hiReal = evaluate(hi.lambda, hi.w);
      found = Math.abs(loReal.stats.ret - target) <= Math.abs(hiReal.stats.ret - target) ? loReal : hiReal;
    }
    collected.push(found);
    lo = found;
  }
  collected.push(hiPoint);
  collected.sort((p, q) => p.lambda - q.lambda);

  // Tangencia: mejor punto de la malla y afinado por sección áurea en λ
  // (el Sharpe es cuasicóncavo a lo largo de la rama eficiente).
  let bestIdx = 0;
  for (let i = 1; i < collected.length; i++) {
    if (collected[i].stats.sharpe > collected[bestIdx].stats.sharpe) bestIdx = i;
  }
  let best = collected[bestIdx];
  let a = collected[Math.max(0, bestIdx - 1)].lambda;
  let b = collected[Math.min(collected.length - 1, bestIdx + 1)].lambda;
  if (b - a > 0) {
    const phi = (Math.sqrt(5) - 1) / 2;
    let x1 = b - phi * (b - a);
    let x2 = a + phi * (b - a);
    let p1 = evaluate(x1, best.w);
    let p2 = evaluate(x2, best.w);
    for (let iter = 0; iter < 48 && b - a > 1e-12 * (1 + b); iter++) {
      if (p1.stats.sharpe >= p2.stats.sharpe) {
        b = x2;
        x2 = x1;
        p2 = p1;
        x1 = b - phi * (b - a);
        p1 = evaluate(x1, p2.w);
      } else {
        a = x1;
        x1 = x2;
        p1 = p2;
        x2 = a + phi * (b - a);
        p2 = evaluate(x2, p1.w);
      }
      const candidate = p1.stats.sharpe >= p2.stats.sharpe ? p1 : p2;
      if (candidate.stats.sharpe > best.stats.sharpe) best = candidate;
    }
  }
  return { points: collected, minVol, maxSharpe: best };
}

/**
 * Suelo de concentración (semicontinuo): un activo entra con al menos `floor`
 * o no entra. Se resuelve por soporte: los pesos por debajo del suelo (incluidos
 * los nulos) salen del universo y el resto se reoptimiza con cota inferior
 * `floor`; se repite hasta que no queda "polvo". No es un QP convexo: es la
 * heurística habitual, y el resultado siempre es factible.
 */
function applyConcentrationFloor(
  cov: number[][],
  mu: number[],
  riskFree: number,
  cap: number,
  floor: number,
  initial: TracedPoint,
  objective: "minVol" | "maxSharpe"
): TracedPoint {
  const n = mu.length;
  let point = initial;
  if (floor <= 0) return point;
  const excluded = new Array<boolean>(n).fill(false);
  for (let round = 0; round < n; round++) {
    // Candidatos a salir, del más pequeño al mayor, sin dejar el soporte por
    // debajo de lo que el tope permite (Σhi ≥ 1).
    const dust = mu
      .map((_, i) => i)
      .filter((i) => !excluded[i] && point.w[i] < floor - 1e-9)
      .sort((i, j) => point.w[i] - point.w[j]);
    let support = excluded.filter((x) => !x).length;
    let changed = false;
    for (const i of dust) {
      if ((support - 1) * cap < 1 - 1e-12) break;
      excluded[i] = true;
      support -= 1;
      changed = true;
    }
    if (!changed) break;
    const floorFeasible = support * floor <= 1 + 1e-12;
    const bounds: QpBounds = {
      lo: mu.map((_, i) => (excluded[i] || !floorFeasible ? 0 : floor)),
      hi: mu.map((_, i) => (excluded[i] ? 0 : cap))
    };
    const w = objective === "minVol"
      ? solveLambdaQp(cov, mu, 0, bounds).w
      : traceFrontier(cov, mu, riskFree, bounds, 24).maxSharpe.w;
    point = { lambda: 0, w, stats: portfolioStats(w, mu, cov, riskFree) };
  }
  return point;
}

export function computeFrontier(
  assets: FrontierAsset[],
  opts: FrontierOptions = {}
): FrontierResult | null {
  const usable = assets.filter(
    (a) => Number.isFinite(a.expectedReturn) && Number.isFinite(a.volatility) && a.volatility > 0
  );
  if (usable.length < 2) return null;

  const riskFree = opts.riskFree ?? RISK_FREE_RATE;
  const pointsWanted = Math.max(8, Math.min(200, opts.points ?? 40));
  // Tope adaptativo para evitar dos degeneraciones:
  //  - tope = 1/n forzaria pesos iguales (sin variacion);
  //  - con muy pocos activos, 30% seria infeasible (no suma 100%).
  // Regla: max(tope deseado, 1/(n-1)); con 2 activos no hay tope efectivo.
  // Asi: 5+ activos -> 30%; 4 -> 33%; 3 -> 50%; 2 -> sin tope.
  const maxWeight =
    usable.length >= 3
      ? Math.min(1, Math.max(opts.maxWeight ?? MAX_GENERATED_WEIGHT, 1 / (usable.length - 1)))
      : 1;
  // Suelo por activo (no superior a la mitad del tope, para que sea factible).
  const minWeight = Math.min(opts.minWeight ?? MIN_GENERATED_WEIGHT, maxWeight * 0.5);

  const ids = usable.map((a) => a.id);
  const mu = usable.map((a) => a.expectedReturn);
  const cov = covarianceMatrix(
    usable,
    opts.correlation ?? ((a, b) => assumedAssetClassCorrelation(a.assetClass, b.assetClass))
  );
  const n = usable.length;

  // (A) Frontera: envolvente long-only sin tope (universo completo de oportunidades).
  const unconstrained: QpBounds = { lo: new Array<number>(n).fill(0), hi: new Array<number>(n).fill(1) };
  const trace = traceFrontier(cov, mu, riskFree, unconstrained, pointsWanted);

  // Rama eficiente: retorno estrictamente creciente y varianza no decreciente.
  // (Ambas quedan garantizadas por la parametrización en λ; el filtro solo
  // elimina duplicados numéricos.)
  const frontier: FrontierPortfolio[] = [];
  let lastRet = -Infinity;
  let lastVol = -Infinity;
  for (const p of trace.points) {
    if (p.stats.ret <= lastRet + 1e-12) continue;
    const vol = Math.max(p.stats.vol, lastVol);
    frontier.push({ ...p.stats, vol, weights: toWeightMap(ids, p.w) });
    lastRet = p.stats.ret;
    lastVol = vol;
  }

  // (B) Carteras SUGERIDAS con tope y suelo de concentración (más diversificadas).
  const capped: QpBounds = { lo: new Array<number>(n).fill(0), hi: new Array<number>(n).fill(maxWeight) };
  const cappedTrace = traceFrontier(cov, mu, riskFree, capped, pointsWanted);
  const best = applyConcentrationFloor(cov, mu, riskFree, maxWeight, minWeight, cappedTrace.maxSharpe, "maxSharpe");
  const lowest = applyConcentrationFloor(cov, mu, riskFree, maxWeight, minWeight, cappedTrace.minVol, "minVol");

  const current =
    opts.currentWeights != null
      ? (() => {
          const currentWeights = opts.currentWeights;
          const w = ids.map((id) => currentWeights[id] ?? 0);
          const total = w.reduce((acc, x) => acc + x, 0);
          const norm = total > 0 ? w.map((x) => x / total) : w;
          const stats = portfolioStats(norm, mu, cov, riskFree);
          return { ...stats, weights: toWeightMap(ids, norm) };
        })()
      : null;

  return {
    frontier,
    maxSharpe: { ...best.stats, weights: toWeightMap(ids, best.w) },
    minVol: { ...lowest.stats, weights: toWeightMap(ids, lowest.w) },
    frontierMinVol: { ...trace.minVol.stats, weights: toWeightMap(ids, trace.minVol.w) },
    frontierMaxSharpe: { ...trace.maxSharpe.stats, weights: toWeightMap(ids, trace.maxSharpe.w) },
    current,
    assets: usable.map((a) => ({ id: a.id, name: a.name, vol: a.volatility, ret: a.expectedReturn })),
    riskFree,
    maxWeight,
    minWeight,
    approximate: true,
  };
}
