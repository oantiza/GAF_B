import { readableBackendLabel } from "./labels";

/**
 * Clases del distintivo de cobertura. `modules.css` solo define la base
 * (`.quality-badge`, verde = completa) y los modificadores `is-partial` /
 * `is-missing`; cualquier otro nombre caía en verde por defecto.
 */
export const COVERAGE_BADGE: Record<string, { label: string; cls: "" | "is-partial" | "is-missing" }> = {
  COMPLETE: { label: "Datos completos", cls: "" },
  PARTIAL: { label: "Datos parciales", cls: "is-partial" },
  ROOT_ONLY: { label: "Datos básicos", cls: "is-partial" },
  MISSING: { label: "Datos faltantes", cls: "is-missing" }
};

export function coverageBadgeFor(status: string): { label: string; cls: string } {
  return COVERAGE_BADGE[status] ?? { label: readableBackendLabel(status), cls: "is-partial" };
}
