// @vitest-environment happy-dom

/**
 * Salud del catálogo (auditoría de frontend, ACT-25, solo el mensaje): si la lectura falla, la pantalla no
 * enseña el mensaje de desarrollo («¿Está levantado su emulador en…?»), sino uno para quien la usa; el
 * detalle técnico va al registro.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listarCalidades: vi.fn() }));
vi.mock("../src/adapters/baseNuevaLectura", () => ({
  BASE_NUEVA_DISPONIBLE: true,
  listarCalidades: mocks.listarCalidades
}));

import { appLogger } from "../src/core/appLogger";
import { SaludDelCatalogoPage } from "../src/pages/SaludDelCatalogoPage";

let root: Root | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("ACT-25: el error de lectura se dice para el usuario, y lo técnico va al registro", async () => {
  const registro = vi.spyOn(appLogger, "error").mockImplementation(() => undefined);
  mocks.listarCalidades.mockRejectedValue(
    new Error("La base nueva respondió 503 al leer la calidad. ¿Está levantado su emulador en 127.0.0.1:8092?")
  );
  await act(async () => { root!.render(<SaludDelCatalogoPage />); });
  await act(async () => { await new Promise((listo) => setTimeout(listo, 0)); });
  const aviso = host.querySelector('[role="alert"]')?.textContent ?? "";
  expect(aviso).toContain("No hemos podido leer la calidad del catálogo");
  expect(host.textContent).not.toContain("emulador");
  expect(host.textContent).not.toContain("127.0.0.1");
  expect(registro).toHaveBeenCalled();
  expect(String(registro.mock.calls[0]?.[1] ?? "")).toContain("emulador");
  expect(host.querySelector("button")?.textContent).toBe("Reintentar");
});
