import type { PositionImportEntry } from "./positionImport";

/** Agrupa por ISIN/identificador, nunca por cliente ni por nombre comercial. */
export function groupPositionAmounts(entries: PositionImportEntry[]): PositionImportEntry[] {
  const amounts = new Map<string, number>();
  for (const entry of entries) {
    const id = entry.id.trim().toUpperCase();
    amounts.set(id, (amounts.get(id) ?? 0) + entry.amount);
  }
  return Array.from(amounts, ([id, amount]) => ({ id, amount }));
}
