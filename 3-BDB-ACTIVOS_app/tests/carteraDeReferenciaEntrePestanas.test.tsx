// @vitest-environment happy-dom

/**
 * MAR-30. La cartera de referencia y el Modo cliente viven los dos en `localStorage`, pero solo el Modo cliente
 * escuchaba el aviso `storage` del navegador. Con dos pestañas, cambiar la referencia en una dejaba la otra
 * comparando contra la anterior hasta recargar, y el PDF que saliera de esa pestaña diría otra referencia.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BENCHMARK_STORAGE_KEY, BenchmarkProvider, DEFAULT_BENCHMARK_ID, useBenchmark } from "../src/app/BenchmarkContext";

let root: Root;
let host: HTMLDivElement;

function Sonda() {
  return createElement("span", { id: "referencia" }, useBenchmark().benchmarkId);
}

const referencia = () => host.querySelector("#referencia")?.textContent;
const enOtraPestana = (newValue: string | null, key = BENCHMARK_STORAGE_KEY) =>
  act(async () => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(BenchmarkProvider, null, createElement(Sonda))));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("la cartera de referencia entre pestañas", () => {
  test("si otra pestaña la cambia, esta la sigue", async () => {
    expect(referencia()).toBe(DEFAULT_BENCHMARK_ID);
    await enOtraPestana("dinamico");
    expect(referencia()).toBe("dinamico");
  });

  test("un valor que ya no existe cae a la de por defecto, como al leerla al arrancar", async () => {
    await enOtraPestana("dinamico");
    await enOtraPestana("perfil-retirado");
    expect(referencia()).toBe(DEFAULT_BENCHMARK_ID);
  });

  test("lo que cambia otra clave, o un borrado, no la toca", async () => {
    await enOtraPestana("dinamico");
    await enOtraPestana("agresivo", "otra-clave");
    await enOtraPestana(null);
    expect(referencia()).toBe("dinamico");
  });
});
