import type { LocalPortfolioStorageLike } from "./localPortfolioStorage";

/**
 * Selección del comparador de activos (máx. 5), persistida para que
 * sobreviva a la navegación entre rutas y a un F5 (auditoría 11-08, F1:
 * «F5 pierde la selección del comparador»). Con el router de la ola 3b el
 * Buscador y el Comparador son páginas independientes: la selección vive en
 * el shell de la app y se hidrata desde aquí.
 */
const COMPARISON_SELECTION_KEY = "bdb-activos.comparison-selection.v1";

export const MAX_COMPARISON_ASSETS = 5;

export function readComparisonSelection(storage: LocalPortfolioStorageLike | undefined): string[] {
  try {
    const raw = storage?.getItem(COMPARISON_SELECTION_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .slice(0, MAX_COMPARISON_ASSETS);
  } catch {
    return [];
  }
}

export function writeComparisonSelection(
  storage: LocalPortfolioStorageLike | undefined,
  assetIds: string[]
): void {
  try {
    storage?.setItem(COMPARISON_SELECTION_KEY, JSON.stringify(assetIds.slice(0, MAX_COMPARISON_ASSETS)));
  } catch {
    // almacenamiento no disponible: la selección sigue viva en memoria
  }
}

export function toggleComparisonId(current: string[], assetId: string): string[] {
  if (current.includes(assetId)) {
    return current.filter((id) => id !== assetId);
  }
  if (current.length >= MAX_COMPARISON_ASSETS) {
    return current;
  }
  return [...current, assetId];
}
