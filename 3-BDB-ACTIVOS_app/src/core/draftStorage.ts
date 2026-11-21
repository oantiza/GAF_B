import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { LocalPortfolioStorageLike } from "./localPortfolioStorage";

/**
 * Criterio único de almacenamiento del borrador activo (ola 3b): con la
 * fuente en vivo el borrador vive en sessionStorage (privacidad entre
 * sesiones); con las fuentes locales, en localStorage. Antes esta regla
 * estaba copiada en BdbActivosApp y AssetSearch (T4c).
 */
export function getBrowserDraftStorage(sourceKind: AssetDataSourceKind): LocalPortfolioStorageLike | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return sourceKind === "BBDD_LIVE_API" ? window.sessionStorage : window.localStorage;
  } catch {
    return undefined;
  }
}

export function getBrowserLocalStorage(): LocalPortfolioStorageLike | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return window.localStorage;
  } catch {
    return undefined;
  }
}
