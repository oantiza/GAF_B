import { describe, expect, test } from "vitest";
import { buildUniverseNotice, hasMoreUniverse } from "../src/core/searchUniverse";

describe("buildUniverseNotice (aviso honesto del universo, D1)", () => {
  test("con total del servidor: avisa con cifras reales cuando falta universo", () => {
    expect(buildUniverseNotice(200, 766, 200)).toBe("cargados 200 de 766 activos del catálogo");
  });

  test("con todo el universo cargado no hay aviso", () => {
    expect(buildUniverseNotice(766, 766, 200)).toBeNull();
    expect(buildUniverseNotice(16, 16, 200)).toBeNull();
  });

  test("sin total conocido: aviso conservador solo al llegar al tope de página", () => {
    expect(buildUniverseNotice(200, null, 200)).toBe(
      "la lista puede estar recortada: amplía o afina la búsqueda"
    );
    expect(buildUniverseNotice(120, null, 200)).toBeNull();
  });

  test("nunca aparenta recorte con listas pequeñas", () => {
    expect(buildUniverseNotice(4, 4, 200)).toBeNull();
    expect(buildUniverseNotice(0, 0, 200)).toBeNull();
  });
});

describe("hasMoreUniverse", () => {
  test("hay más cuando el servidor da cursor y queda universo", () => {
    expect(hasMoreUniverse("LU123", 200, 766)).toBe(true);
    expect(hasMoreUniverse(null, 200, 766)).toBe(false);
    expect(hasMoreUniverse("LU123", 766, 766)).toBe(false);
  });

  test("sin total conocido, el cursor manda", () => {
    expect(hasMoreUniverse("LU123", 200, null)).toBe(true);
    expect(hasMoreUniverse(null, 200, null)).toBe(false);
  });
});
