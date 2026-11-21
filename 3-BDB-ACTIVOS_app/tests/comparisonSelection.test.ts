import { describe, expect, it } from "vitest";
import {
  MAX_COMPARISON_ASSETS,
  readComparisonSelection,
  toggleComparisonId,
  writeComparisonSelection
} from "../src/core/comparisonSelection";

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  };
}

describe("comparisonSelection (ola 3b)", () => {
  it("persiste y recupera la selección — sobrevive a navegación y F5 (F1)", () => {
    const storage = memoryStorage();
    writeComparisonSelection(storage, ["A", "B"]);
    expect(readComparisonSelection(storage)).toEqual(["A", "B"]);
  });

  it("tolera almacenamiento vacío o corrupto", () => {
    const storage = memoryStorage();
    expect(readComparisonSelection(storage)).toEqual([]);
    storage.setItem("bdb-activos.comparison-selection.v1", "{corrupto");
    expect(readComparisonSelection(storage)).toEqual([]);
    expect(readComparisonSelection(undefined)).toEqual([]);
  });

  it("recorta al máximo de 5 activos al leer y escribir", () => {
    const storage = memoryStorage();
    writeComparisonSelection(storage, ["A", "B", "C", "D", "E", "F", "G"]);
    expect(readComparisonSelection(storage)).toHaveLength(MAX_COMPARISON_ASSETS);
  });

  it("toggleComparisonId añade, quita y respeta el tope", () => {
    expect(toggleComparisonId([], "A")).toEqual(["A"]);
    expect(toggleComparisonId(["A"], "A")).toEqual([]);
    expect(toggleComparisonId(["A", "B", "C", "D", "E"], "F")).toEqual(["A", "B", "C", "D", "E"]);
    expect(toggleComparisonId(["A", "B", "C", "D", "E"], "C")).toEqual(["A", "B", "D", "E"]);
  });
});
