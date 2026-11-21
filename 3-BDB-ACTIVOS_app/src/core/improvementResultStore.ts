/**
 * Último resultado de «Mejorar cartera» de la sesión, para que el informe interno
 * pueda incluirlo (decisión 8.6: solo informe interno).
 *
 * Vive en sessionStorage y queda ligado a la composición exacta de la cartera
 * (huella de posiciones y pesos): si la cartera cambia, el resultado ya no aplica
 * y no se enseña. Nunca contiene retrocesiones.
 */
import type { ImprovementResponse } from "../adapters/improvePortfolioBackend";
import type { FundEquivalence } from "./fundEquivalence";
import type { BdbManualPortfolioPosition } from "../types/bdbAssets";

export const IMPROVEMENT_RESULT_STORAGE_KEY = "bdb-activos.improvement-result.v1";

export type StoredEquivalence = Pick<FundEquivalence, "verdict" | "reason" | "shared" | "differing" | "missing">;

export interface StoredImprovement {
  schema_version: "improvement-result.v1";
  fingerprint: string;
  savedAt: string;
  response: ImprovementResponse;
  proposalIndex: number;
  assets: Record<string, { name: string; ongoingCharge?: number | null }>;
  equivalence: Record<string, StoredEquivalence>;
  skipped: { asset_id: string; reason: string }[];
  /** La cartera calculada lleva alguna acción: lo que el papel dice de su coste (decisión 10). */
  hayAcciones?: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Huella de la cartera: ids y pesos con cuatro decimales, en orden estable. */
export function improvementFingerprint(positions: readonly Pick<BdbManualPortfolioPosition, "asset_id" | "weight_percent">[]): string {
  return positions
    .filter((position) => Number.isFinite(position.weight_percent) && position.weight_percent > 0)
    .map((position) => `${position.asset_id.trim()}:${position.weight_percent.toFixed(4)}`)
    .sort()
    .join("|");
}

export function saveImprovementResult(
  positions: readonly Pick<BdbManualPortfolioPosition, "asset_id" | "weight_percent">[],
  data: Omit<StoredImprovement, "schema_version" | "fingerprint" | "savedAt"> & { savedAt?: string },
  store: StorageLike | null = storage()
): StoredImprovement | null {
  const record: StoredImprovement = {
    schema_version: "improvement-result.v1",
    fingerprint: improvementFingerprint(positions),
    savedAt: data.savedAt ?? new Date().toISOString(),
    response: data.response,
    proposalIndex: data.proposalIndex,
    assets: data.assets,
    equivalence: data.equivalence,
    skipped: data.skipped
  };
  try {
    store?.setItem(IMPROVEMENT_RESULT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    return null;
  }
  return record;
}

/** Resultado guardado solo si corresponde exactamente a estas posiciones. */
export function loadImprovementResult(
  positions: readonly Pick<BdbManualPortfolioPosition, "asset_id" | "weight_percent">[],
  store: StorageLike | null = storage()
): StoredImprovement | null {
  try {
    const raw = store?.getItem(IMPROVEMENT_RESULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredImprovement>;
    if (parsed.schema_version !== "improvement-result.v1" || typeof parsed.fingerprint !== "string") return null;
    if (parsed.fingerprint !== improvementFingerprint(positions)) return null;
    if (!parsed.response || typeof parsed.response !== "object" || !Array.isArray(parsed.response.proposals)) return null;
    return {
      schema_version: "improvement-result.v1",
      fingerprint: parsed.fingerprint,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
      response: parsed.response,
      proposalIndex: typeof parsed.proposalIndex === "number" ? parsed.proposalIndex : 0,
      assets: parsed.assets ?? {},
      equivalence: parsed.equivalence ?? {},
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : []
    };
  } catch {
    return null;
  }
}

export function clearImprovementResult(store: StorageLike | null = storage()): void {
  try {
    store?.removeItem(IMPROVEMENT_RESULT_STORAGE_KEY);
  } catch {
    /* sin almacenamiento disponible */
  }
}
