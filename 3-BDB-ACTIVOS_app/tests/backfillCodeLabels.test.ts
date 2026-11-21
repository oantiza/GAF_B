import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BACKFILL_CODE_LABELS, backfillCodeLabel } from "../src/core/labels";

/**
 * Sistema › Históricos (revisión del 16-10, MENOR-6): todo código que la carga
 * de históricos devuelve en `resolution`, `skipped` o `reason` tiene etiqueta
 * en español. Se leen los códigos del propio backend para que uno nuevo sin
 * traducir rompa la prueba.
 */
const backend = readFileSync(new URL("../functions_python/history_backfill.py", import.meta.url), "utf8");

function backendCodes(): string[] {
  const codes = new Set<string>();
  for (const match of backend.matchAll(/out\["(?:skipped|reason)"\] = "([A-Z_]+)"/g)) codes.add(match[1]);
  const resolve = backend.slice(backend.indexOf("def _resolve("), backend.indexOf("def backfill_one("));
  for (const match of resolve.matchAll(/"([A-Z][A-Z_]+)"/g)) codes.add(match[1]);
  return [...codes].sort();
}

describe("códigos de la carga de históricos", () => {
  test("el backend devuelve los códigos que conocemos y todos tienen etiqueta propia", () => {
    const codes = backendCodes();
    expect(codes).toEqual(expect.arrayContaining(["HINT", "SEARCH_EXACT", "SEARCH_FALLBACK", "UNRESOLVED", "NOT_FOUND", "NOT_CANONICAL", "HAS_SERIES", "NO_SYMBOL"]));
    for (const code of codes) expect(BACKFILL_CODE_LABELS[code], code).toBeDefined();
  });

  test("ninguna etiqueta es el código con otras mayúsculas", () => {
    for (const [code, label] of Object.entries(BACKFILL_CODE_LABELS)) {
      expect(label.toUpperCase().replace(/ /g, "_")).not.toBe(code);
      expect(backfillCodeLabel(code)).toBe(label);
    }
    expect(backfillCodeLabel("SEARCH_EXACT")).toBe("Búsqueda exacta por ISIN");
    expect(backfillCodeLabel("HINT")).toBe("Pista de la ficha");
  });
});
