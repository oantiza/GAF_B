/**
 * Cableado del frontend a la futura callable `optimize_portfolio` (portfolio-frontier.v1).
 *
 * - SOLO llama a la callable si está EXPLÍCITAMENTE habilitada (flag interno, por defecto false).
 * - Construye el request con `buildOptimizationRequest` (sin series crudas).
 * - Mapea la respuesta con `frontierStateFromRawResponse` y los errores con `frontierStateFromError`.
 * - Nunca calcula covarianzas ni frontera en cliente.
 * - Si está deshabilitado / sin Firebase / pocos activos / error / respuesta no válida → la UI usa
 *   el fallback aproximado (estado "idle" o "error" controlado).
 */
import { DEFAULT_DATA_SOURCE_KIND, ENABLE_REAL_FRONTIER } from "../config/runtimeConfig";
import { functions } from "../firebase";
import { AppError } from "../core/appError";
import { registerSessionCache, sessionCacheEpoch } from "../core/sessionCaches";
import { frontierPortfolioCoverage } from "../core/frontierPortfolioCoverage";
import { callBackend } from "./callableBackend";
import {
  buildOptimizationRequest,
  frontierStateFromError,
  frontierStateFromRawResponse,
  type FrontierRequestInput
} from "./portfolioFrontierAdapter";
import type { FrontierHistoricalState, PortfolioOptimizationRequest } from "../types/portfolioFrontier";

/**
 * Flag interno seguro centralizado en runtimeConfig. Por defecto FALSE: no se llama a la callable y la
 * UI muestra el fallback aproximado. Para activarlo localmente hace falta una decisión explícita:
 * VITE_BDB_ENABLE_REAL_FRONTIER=true.
 */
export { ENABLE_REAL_FRONTIER };

const CALLABLE_NAME = "optimize_portfolio";
const FRONTIER_CACHE_TTL_MS = 10 * 60 * 1_000;
const FRONTIER_CACHE_MAX_ENTRIES = 8;

/** Mínimo de activos para que una frontera tenga sentido. */
const MIN_ASSETS = 2;

/**
 * Demo sin muros (auditoría 11-08, N5): en `npm run dev` sin Firebase,
 * callableBackend sirve `optimize_portfolio` desde demoBackend con el mismo
 * contrato, así que el optimizador también funciona ahí (con datos de muestra).
 * MODE !== "test" mantiene el comportamiento contractual de la suite de tests,
 * que fuerza sus propios caminos con el seam `options.enabled`/`options.call`.
 */
function isDemoFrontierActive(): boolean {
  return !functions && import.meta.env.DEV && import.meta.env.MODE !== "test";
}

/** ¿Se debe intentar la frontera histórica? Flag ON + Firebase, o demo local sin credenciales. */
export function isRealFrontierEnabled(): boolean {
  if (isDemoFrontierActive()) {
    return true;
  }
  // Solo en modo "BBDD en vivo": en local/estatico los activos son de muestra y la
  // frontera historica real no aplica (su resultado ocultaria la aproximada).
  return ENABLE_REAL_FRONTIER && Boolean(functions) && DEFAULT_DATA_SOURCE_KIND === "BBDD_LIVE_API";
}

/** Seam de inyección para tests: permite forzar `enabled` y un `call` simulado sin Firebase. */
export interface FetchFrontierOptions {
  enabled?: boolean;
  /** Devuelve los datos crudos de la respuesta (equivalente a `result.data`). */
  call?: (request: PortfolioOptimizationRequest) => Promise<unknown>;
}

/**
 * El texto técnico «Firebase no configurado…» (callableBackend) no debe llegar
 * a la UI del optimizador: se traduce aquí a un mensaje de usuario claro.
 */
function translateBackendUnavailable(error: unknown): unknown {
  if (error instanceof Error && error.message.includes("Firebase no configurado")) {
    return new AppError(
      "BACKEND",
      "La optimización histórica no está disponible con los datos de muestra.",
      { cause: error }
    );
  }
  return error;
}

type FrontierResultState = Extract<FrontierHistoricalState, { status: "result" }>;

interface FrontierCacheEntry {
  promise: Promise<FrontierHistoricalState>;
  result?: FrontierResultState;
  timestamp: number;
}

const frontierCache = new Map<string, FrontierCacheEntry>();

function roundedWeight(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function canonicalNumberMap(value: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, number]) => [key, roundedWeight(number)] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function stableValue(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(stableValue).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      const item = stableValue((value as Record<string, unknown>)[key]);
      if (item !== undefined) normalized[key] = item;
    }
    return normalized;
  }
  return value;
}

function canonicalOptimizationRequest(input: FrontierRequestInput): PortfolioOptimizationRequest {
  const request = buildOptimizationRequest(input);
  const canonical: PortfolioOptimizationRequest = {
    ...request,
    asset_ids: [...new Set(request.asset_ids)].sort((left, right) => left.localeCompare(right)),
    constraints: {
      long_only: true,
      fully_invested: true,
      min_weight: request.constraints?.min_weight ?? 0,
      max_weight: request.constraints?.max_weight ?? 1,
      /* Se perdía aquí: «Rotación máx.» se podía escribir, y el servidor nunca la recibía. */
      ...(request.constraints?.max_turnover === undefined ? {} : { max_turnover: request.constraints.max_turnover })
    },
    frontier_points: request.frontier_points ?? 12,
    expected_return_model: request.expected_return_model ?? "HISTORICAL_SHRINKAGE"
  };

  const currentWeights = canonicalNumberMap(request.current_weights);
  const lockedWeights = canonicalNumberMap(request.locked_weights);
  if (currentWeights) canonical.current_weights = currentWeights;
  else delete canonical.current_weights;
  if (lockedWeights) canonical.locked_weights = lockedWeights;
  else delete canonical.locked_weights;

  if (canonical.objective === "TARGET_RISK") {
    canonical.risk_target_mode = request.risk_target_mode ?? "FRONTIER_PERCENTILE";
    delete canonical.target_return;
    if (canonical.risk_target_mode === "FRONTIER_PERCENTILE") {
      /* A2.8: el dominio del selector es 1..10 — cualquier valor fuera (0
         incluido) se trata como ausente y materializa el 5 por defecto, ahora
         de forma explícita (antes lo decidía un `||` por accidente). El test
         de fingerprint fija este contrato. */
      const slider = request.risk_slider;
      canonical.risk_slider = typeof slider === "number" && slider >= 1 && slider <= 10 ? slider : 5;
      delete canonical.target_volatility;
    } else {
      delete canonical.risk_slider;
    }
  } else {
    delete canonical.risk_slider;
    delete canonical.risk_target_mode;
    delete canonical.target_volatility;
    if (canonical.objective !== "TARGET_RETURN") delete canonical.target_return;
  }

  return stableValue(canonical) as PortfolioOptimizationRequest;
}

/** Fingerprint canónico y estable del mismo payload que se envía al backend. */
export function frontierRequestFingerprint(input: FrontierRequestInput): string {
  return JSON.stringify(stableValue({
    request: canonicalOptimizationRequest(input),
    portfolioWeightsPercent: input.portfolioWeightsPercent,
    selectionExclusions: input.selectionExclusions
  }));
}

function touchCacheEntry(fingerprint: string, entry: FrontierCacheEntry): void {
  frontierCache.delete(fingerprint);
  frontierCache.set(fingerprint, entry);
}

function trimFrontierCache(): void {
  while (frontierCache.size > FRONTIER_CACHE_MAX_ENTRIES) {
    const completed = [...frontierCache.entries()].find(([, entry]) => entry.result !== undefined);
    if (!completed) return;
    frontierCache.delete(completed[0]);
  }
}

/** Vacía la caché compartida. Exportado para pruebas y cambios explícitos de sesión. */
export function invalidateFrontierCache(): void {
  frontierCache.clear();
}
registerSessionCache(invalidateFrontierCache);

/**
 * Llama a optimize_portfolio SOLO si está habilitado. Devuelve un estado de UI:
 * - "idle"           → deshabilitado / sin Firebase / pocos activos (la UI usa el fallback aproximado);
 * - "result"         → respuesta válida portfolio-frontier.v1;
 * - "unauthenticated"→ error de autenticación;
 * - "error"          → error controlado o respuesta no válida (la UI sigue mostrando el fallback).
 */
export async function fetchHistoricalFrontier(
  input: FrontierRequestInput,
  options?: FetchFrontierOptions
): Promise<FrontierHistoricalState> {
  const enabled = options?.enabled ?? isRealFrontierEnabled();
  if (!enabled) {
    return { status: "idle" };
  }
  if (input.assetIds.length < MIN_ASSETS) {
    return { status: "idle" };
  }

  let request: PortfolioOptimizationRequest;
  let fingerprint: string;
  try {
    request = canonicalOptimizationRequest(input);
    fingerprint = `${DEFAULT_DATA_SOURCE_KIND}:${sessionCacheEpoch()}:${frontierRequestFingerprint(input)}`;
  } catch (error) {
    return frontierStateFromError(error);
  }

  const cached = frontierCache.get(fingerprint);
  if (cached) {
    if (!cached.result || Date.now() - cached.timestamp <= FRONTIER_CACHE_TTL_MS) {
      touchCacheEntry(fingerprint, cached);
      return cached.promise;
    }
    frontierCache.delete(fingerprint);
  }

  const entry: FrontierCacheEntry = {
    promise: Promise.resolve({ status: "idle" }),
    timestamp: Date.now()
  };
  const epoch = sessionCacheEpoch();
  entry.promise = (async (): Promise<FrontierHistoricalState> => {
    try {
      let data: unknown;
      if (options?.call) {
        data = await options.call(request);
      } else {
        // En demo (dev sin credenciales) se sigue adelante: callBackend resuelve
        // `optimize_portfolio` con el handler de demoBackend (mismo contrato).
        if (!functions && !isDemoFrontierActive()) return { status: "idle" };
        data = await callBackend<unknown>(
          CALLABLE_NAME,
          request,
          "No se pudo calcular la frontera histórica.",
          { timeout: 300_000 }
        );
      }
      const state = frontierStateFromRawResponse(data);
      if (state.status === "result") {
        state.model = { ...state.model, requestFingerprint: frontierRequestFingerprint(input), requestInput: structuredClone(input), sessionEpoch: epoch,
          portfolioCoverage: frontierPortfolioCoverage(input, state.model) };
      }
      return state;
    } catch (error) {
      return frontierStateFromError(translateBackendUnavailable(error));
    }
  })().then((state) => {
    if (epoch !== sessionCacheEpoch()) return { status: "idle" } as const;
    if (state.status === "result" && frontierCache.get(fingerprint) === entry) {
      entry.result = state;
      entry.timestamp = Date.now();
      touchCacheEntry(fingerprint, entry);
      trimFrontierCache();
    } else if (frontierCache.get(fingerprint) === entry) {
      frontierCache.delete(fingerprint);
    }
    return state;
  });

  frontierCache.set(fingerprint, entry);
  trimFrontierCache();
  return entry.promise;
}

/** Calienta la caché en segundo plano. Los fallos se descartan deliberadamente. */
export async function prefetchHistoricalFrontier(input: FrontierRequestInput): Promise<void> {
  try {
    await fetchHistoricalFrontier(input);
  } catch {
    // Prefetch best-effort: nunca bloquea la navegación ni muestra errores.
  }
}
