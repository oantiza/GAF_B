import { describe, expect, test } from "vitest";
import { candadosTrasSustituir, loQueSePerderiaAlVolver, mismaComposicion } from "../src/core/cambiosTrasAplicar";

const nombre = (id: string) => `Fondo ${id}`;

describe("una propuesta aplicada, si la cartera sigue cambiando", () => {
  const aplicada = [
    { asset_id: "A", weight_percent: 15.5 },
    { asset_id: "B", weight_percent: 84.5 }
  ];

  test("la misma composición es la misma, en otro orden y con el redondeo de aplicar", () => {
    expect(mismaComposicion(aplicada, [...aplicada].reverse())).toBe(true);
    expect(mismaComposicion(aplicada, [{ asset_id: "A", weight_percent: 15.504 }, { asset_id: "B", weight_percent: 84.5 }])).toBe(true);
  });

  test("otro peso, otra posición o una de menos ya no lo es", () => {
    expect(mismaComposicion(aplicada, [{ asset_id: "A", weight_percent: 15 }, { asset_id: "B", weight_percent: 84.5 }])).toBe(false);
    expect(mismaComposicion(aplicada, [...aplicada, { asset_id: "C", weight_percent: 0 }])).toBe(false);
    expect(mismaComposicion(aplicada, [aplicada[0]])).toBe(false);
  });

  test("si no ha cambiado nada, volver no se lleva nada más", () => {
    expect(loQueSePerderiaAlVolver(aplicada, aplicada, nombre)).toEqual([]);
  });

  test("nombra lo que se perdería: lo añadido, lo quitado y lo escrito después", () => {
    const ahora = [
      { asset_id: "A", weight_percent: 15 },
      { asset_id: "C", weight_percent: 5 }
    ];
    expect(loQueSePerderiaAlVolver(aplicada, ahora, nombre)).toEqual([
      "Se quita «Fondo C», añadida después.",
      "Vuelve «Fondo B», quitada después.",
      "«Fondo A» pierde el peso escrito después, 15,0\u00a0%."
    ]);
  });
});

describe("sustituir una posición con candado", () => {
  test("el candado pasa al fondo nuevo, y los demás se quedan", () => {
    expect(candadosTrasSustituir({ A: true, B: true }, "A", "C")).toEqual({ B: true, C: true });
  });

  test("sin candado no se inventa ninguno", () => {
    const candados = { B: true };
    expect(candadosTrasSustituir(candados, "A", "C")).toBe(candados);
    expect(candadosTrasSustituir({ A: false }, "A", "C")).toEqual({ A: false });
  });
});
