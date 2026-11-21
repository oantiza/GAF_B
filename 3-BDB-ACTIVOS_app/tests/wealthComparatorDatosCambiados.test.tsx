// @vitest-environment happy-dom

/**
 * Las cifras del servidor son de los datos con que se pidieron. Reproducido en la revisión: Cargar ejemplo,
 * Calcular, Valor final 40.000, y seguían «TIR 6,11 %» y «Ventaja frente a Letras 16.752 €» en una cartera
 * que pierde dinero.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearSessionCaches } from "../src/core/sessionCaches";

const backend = vi.hoisted(() => ({ fetchMacroReference: vi.fn() }));
vi.mock("../src/adapters/macroReferenceBackend", async (original) => ({
  ...(await original<typeof import("../src/adapters/macroReferenceBackend")>()),
  fetchMacroReference: backend.fetchMacroReference
}));

import { WealthComparator } from "../src/components/WealthComparator";

const RESPUESTA = {
  inflation_annual_pct: 4,
  letras_avg_rate_pct: 2,
  comparison: {
    cartera: { valor_final_bruto: 95000, valor_final_neto: 85175, tir_nominal_bruta_pct: 6.11, tir_nominal_neta_pct: 4.98, tir_real_bruta_pct: 2.66, tir_real_neta_pct: 1.5 },
    letras: { valor_final_bruto: 78000, valor_final_neto: 54985, tir_nominal_bruta_pct: 2, tir_nominal_neta_pct: 1, tir_real_bruta_pct: 0, tir_real_neta_pct: -1 },
    deposito: { valor_final_bruto: 76000, valor_final_neto: 53000, tir_nominal_bruta_pct: 1, tir_nominal_neta_pct: 1, tir_real_bruta_pct: 0, tir_real_neta_pct: -1 }
  }
};

let root: Root;
let host: HTMLDivElement;

const montar = async () => {
  await act(async () => {
    root.render(createElement(WealthComparator));
  });
};
const texto = () => (host.textContent ?? "").replace(/\s/g, " ");
const boton = (nombre: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === nombre) as HTMLButtonElement;
const pulsar = async (nombre: string) => {
  await act(async () => {
    boton(nombre).click();
  });
};
const poner = (campo: HTMLInputElement, valor: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
};
const campoDe = (rotulo: string) =>
  [...host.querySelectorAll(".field")].find((campo) => campo.querySelector("label")?.textContent?.startsWith(rotulo))?.querySelector("input") as HTMLInputElement;

/** Un importe se confirma al salir del campo. */
async function escribirImporte(campo: HTMLInputElement, valor: string) {
  await act(async () => {
    campo.focus();
  });
  await act(async () => {
    poner(campo, valor);
  });
  await act(async () => {
    campo.blur();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearSessionCaches();
  backend.fetchMacroReference.mockReset();
  backend.fetchMacroReference.mockResolvedValue(RESPUESTA);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
});

describe("Patrimonial con los datos cambiados", () => {
  async function calculado() {
    await montar();
    await pulsar("Cargar ejemplo");
    await pulsar("Calcular inflación, Letras y depósito");
  }

  test("pide el IPC desde el día 1 del mes de la primera aportación", async () => {
    await calculado();
    expect(backend.fetchMacroReference).toHaveBeenCalledTimes(1);
    expect(backend.fetchMacroReference.mock.calls[0][0]).toBe("2021-01-01");
    expect(backend.fetchMacroReference.mock.calls[0][1]).toBe("2026-11-04");
  });

  test("al cambiar el valor final se retira todo lo del servidor", async () => {
    await calculado();
    expect(texto()).toContain("TIR real bruta");
    expect(texto()).toContain("Cartera introducida");
    await escribirImporte(campoDe("Valor final"), "40.000");
    expect(texto()).not.toContain("TIR real");
    expect(texto()).not.toContain("Ventaja frente a Letras");
    expect(texto()).not.toContain("Cartera introducida");
    expect(texto()).toContain("Los datos han cambiado desde el último cálculo");
    /* La TIR vuelve a la de estos datos, sin rótulo de bruta o neta: pierde dinero. */
    expect(texto()).toContain("TIR nominal−");
  });

  test("también al cambiar la fecha final o el tipo del depósito", async () => {
    await calculado();
    await act(async () => {
      poner(campoDe("Fecha final"), "2026-11-05");
    });
    expect(texto()).toContain("Los datos han cambiado desde el último cálculo");

    await pulsar("Calcular inflación, Letras y depósito");
    expect(texto()).not.toContain("Los datos han cambiado");
    await act(async () => {
      poner(host.querySelector("input.wealth-tipo") as HTMLInputElement, "2");
    });
    expect(texto()).toContain("Los datos han cambiado desde el último cálculo");
  });

  test("con Neto marcado, toda la franja es neta", async () => {
    await calculado();
    await act(async () => {
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    });
    expect(texto()).toContain("Valor final neto85.175 €");
    expect(texto()).toContain("TIR nominal neta+4,98 %");
    expect(texto()).toContain("En Letras del Tesoro neto54.985 €");
    expect(texto()).toContain("Ventaja frente a Letras neta+30.190 €");
    expect(texto()).not.toContain("95.000 €");
  });

  test("una aportación posterior a la fecha final no da cifra y dice cuál", async () => {
    await montar();
    await pulsar("Cargar ejemplo");
    await act(async () => {
      poner(campoDe("Fecha final"), "2020-01-01");
    });
    expect(texto()).toContain("La aportación del 15/06/2023 es posterior a la fecha final (01/01/2020)");
    expect(texto()).not.toContain("Magnitudes clave");
    expect(boton("Calcular inflación, Letras y depósito").disabled).toBe(true);
  });

  test("lo tecleado y lo calculado vuelven al volver a la pantalla", async () => {
    await calculado();
    await act(async () => {
      root.unmount();
    });
    root = createRoot(host);
    await montar();
    expect(campoDe("Valor final").value).toBe("95.000");
    expect(texto()).toContain("TIR real bruta+2,66 %");
    expect(texto()).toContain("Cartera introducida");
    expect(backend.fetchMacroReference).toHaveBeenCalledTimes(1);
  });
});
