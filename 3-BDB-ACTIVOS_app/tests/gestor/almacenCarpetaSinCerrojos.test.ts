/**
 * Las pruebas de siempre del almacén en carpeta, otra vez, en un navegador SIN `navigator.locks`.
 *
 * Node 24 trae la Web Locks API, así que `almacenCarpeta.test.ts` corre con cerrojos de verdad.
 * Aquí se quita `navigator` para que el almacén use solo la cola de su pestaña, como antes del
 * 22-11-2026, y se importan las mismas pruebas: tienen que pasar igual.
 */
import { afterAll, beforeAll, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubGlobal("navigator", undefined);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

it("de verdad corren sin navigator.locks", () => {
  expect((globalThis as { navigator?: { locks?: unknown } }).navigator?.locks).toBeUndefined();
});

await import("./almacenCarpeta.test");
