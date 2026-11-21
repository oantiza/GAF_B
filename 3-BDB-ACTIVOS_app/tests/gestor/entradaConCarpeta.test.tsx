// @vitest-environment happy-dom
/**
 * La entrada del gestor con una carpeta abierta: dos ficheros que comparten identificador (GES-14) y
 * el aviso de una cartera actualizada al abrirla, que se ve dentro de ella (GES-24).
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlmacenDeCarteras, ResumenDeCartera } from "../../src/gestor/almacen/almacen";
import { activo, cartera, mov } from "./ayudas";

const almacen = vi.hoisted(() => ({ actual: undefined as unknown }));
vi.mock("../../src/gestor/ui/estado/useAlmacen", () => ({
  useAlmacen: () => ({ estado: { fase: "lista", almacen: almacen.actual }, error: null, elegir: async () => undefined, reanudar: async () => undefined, olvidar: async () => undefined })
}));
vi.mock("../../src/gestor/mercado/plataforma", () => ({ HAY_PLATAFORMA: false, catalogoDeActivos: async () => [] }));

import { GestorDeCarterasPage } from "../../src/gestor/ui/GestorDeCarterasPage";
import { pintar, type Pintado } from "./vistaAnalisisDatos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

const resumen = (fichero: string, id: string): ResumenDeCartera => ({ fichero, id, nombre: fichero.replace(".cartera.json", ""), divisaBase: "EUR", movimientos: 1, modificada: "2026-11-10T10:00:00.000Z" });

async function esperar(condicion: () => boolean) {
  for (let intento = 0; intento < 50 && !condicion(); intento += 1) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
  }
  expect(condicion()).toBe(true);
}

describe("GES-14 · dos ficheros con el mismo identificador", () => {
  it("salen las dos filas, y cada una avisa de que es copia de la otra", async () => {
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
    almacen.actual = { clase: "carpeta", nombre: "Carteras", listar: async () => [resumen("A.cartera.json", "mismo-id"), resumen("B.cartera.json", "mismo-id"), resumen("C.cartera.json", "otro-id")] } as unknown as AlmacenDeCarteras;
    pintado = await pintar(<GestorDeCarterasPage />);
    await esperar(() => (document.body.textContent ?? "").includes("Tus carteras"));
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Es una copia de «B.cartera.json»");
    expect(texto).toContain("Es una copia de «A.cartera.json»");
    expect(document.body.querySelectorAll("tbody tr")).toHaveLength(3);
  });
});

describe("GES-24 · el aviso de una cartera actualizada se ve dentro de ella", () => {
  it("al abrir una cartera migrada, la vista de la cartera lo dice", async () => {
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
    const c = cartera([activo("F", "FONDO")], [mov("aportacion", "2026-01-02", { importe: "1000" })], { id: "migrada", nombre: "Familia Vieja" });
    almacen.actual = {
      clase: "carpeta",
      nombre: "Carteras",
      listar: async () => [resumen("Familia Vieja.cartera.json", "migrada")],
      abrir: async () => ({ cartera: c, migrada: true }),
      guardar: async () => ({ fichero: "Familia Vieja.cartera.json" }),
      copias: async () => [],
      leerAjustes: async () => ({})
    } as unknown as AlmacenDeCarteras;
    pintado = await pintar(<GestorDeCarterasPage />);
    await esperar(() => [...document.body.querySelectorAll("button")].some((b) => b.textContent === "Familia Vieja"));
    const fila = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Familia Vieja")!;
    await act(async () => fila.click());
    await esperar(() => document.body.querySelector("h1")?.textContent === "Familia Vieja");
    expect(document.body.textContent).toContain("se ha actualizado al abrirla");
    expect(document.body.textContent).toContain("su versión antigua queda en las copias de seguridad");
  });
});
