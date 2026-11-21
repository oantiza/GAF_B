import { afterEach, describe, expect, it, vi } from "vitest";
import { listarTarjetas } from "../src/adapters/baseNuevaLectura";

afterEach(() => vi.unstubAllGlobals());

describe("la lista de tarjetas", () => {
  it("pide la fecha de cada tarjeta: lo que la máscara no nombra no llega a la pantalla", async () => {
    const pedir = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", pedir);

    await listarTarjetas();

    const [, opciones] = pedir.mock.calls[0] as unknown as [string, RequestInit];
    const campos = JSON.parse(String(opciones.body)).structuredQuery.select.fields;
    expect(campos).toContainEqual({ fieldPath: "computed_at" });
    /* Y si dejó de cotizar: con la tarjeta bien escrita, sin esto el Buscador seguía ofreciendo «Añadir». */
    expect(campos).toContainEqual({ fieldPath: "availability" });
  });
});
