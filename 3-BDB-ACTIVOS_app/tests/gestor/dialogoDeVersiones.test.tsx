// @vitest-environment happy-dom
/**
 * El diálogo de versiones anteriores, con el almacén de verdad sobre una carpeta en memoria y
 * un reloj inyectado: lista las copias, enseña en qué se diferencia una de la actual y la
 * recupera; sin copias, dice cuándo aparecerá la primera.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { almacenEnCarpeta } from "../../src/gestor/almacen/carpeta";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { DialogoDeVersiones } from "../../src/gestor/ui/dialogos/DialogoDeVersiones";
import { activo, cartera, mov } from "./ayudas";
import { crearCarpetaFalsa } from "./carpetaFalsa";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MINUTO = 60_000;

let root: Root | undefined;
let vista: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vista?.remove();
  root = undefined;
});

function preparar() {
  let reloj = Date.parse("2026-11-13T09:00:00Z");
  const falsa = crearCarpetaFalsa({ reloj: () => reloj });
  const almacen = almacenEnCarpeta(falsa.carpeta, { ahora: () => new Date(reloj) });
  return { almacen, avanzar: (minutos: number) => (reloj += minutos * MINUTO) };
}

const garcia = (): Cartera =>
  cartera([activo("ES0000000001", "FONDO")], [mov("aportacion", "2026-01-02", { id: "m-1", importe: "1000" })], { id: "aaaaaaaa-1111-4000-8000-000000000001", nombre: "Familia García" });

async function pintar(actual: Cartera, almacen: ReturnType<typeof almacenEnCarpeta>, alRecuperar = vi.fn()) {
  vista = document.createElement("div");
  document.body.append(vista);
  root = createRoot(vista);
  await act(async () => root!.render(<DialogoDeVersiones alCerrar={() => undefined} alRecuperar={alRecuperar} almacen={almacen} cartera={actual} />));
  return alRecuperar;
}

async function esperar(condicion: () => boolean) {
  for (let intento = 0; intento < 50 && !condicion(); intento += 1) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
  }
  expect(condicion()).toBe(true);
}

function boton(texto: string): HTMLButtonElement {
  const encontrado = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
  if (!encontrado) throw new Error(`No hay un botón «${texto}»`);
  return encontrado;
}

describe("las versiones anteriores", () => {
  it("lista las copias, enseña en qué se diferencia la elegida y la recupera", async () => {
    const { almacen, avanzar } = preparar();
    const antigua = garcia();
    await almacen.guardar(antigua);
    avanzar(11);
    const actual: Cartera = { ...antigua, activos: [...antigua.activos, activo("ES0000000002")], movimientos: [...antigua.movimientos, mov("aportacion", "2026-03-01", { id: "m-2", importe: "50" })] };
    /* Al guardar la nueva, la anterior pasa a las copias: han pasado más de 10 minutos. */
    expect((await almacen.guardar(actual)).copia).toBeDefined();

    const alRecuperar = await pintar(actual, almacen);
    await esperar(() => document.body.querySelectorAll(".rows__item").length === 1);
    expect(document.body.querySelector(".rows__item")!.textContent).toContain("1 movimiento");
    expect(document.body.textContent).toContain("subcarpeta «copias»");
    expect(boton("Recuperar esta versión").disabled).toBe(true);

    await act(async () => boton("Ver").click());
    await esperar(() => document.body.querySelector("tbody") !== null);
    const filas = [...document.body.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(filas).toEqual([
      ["Movimientos", "1 movimiento", "2 movimientos"],
      ["Activos", "1", "2"],
      ["Último movimiento", "02/01/2026", "01/03/2026"]
    ]);
    expect(document.body.textContent).toContain("La versión actual no se pierde");
    /* GES-10: al recuperar, la copia de la actual es obligada; el texto ya no admite la excepción de los 10 minutos. */
    expect(document.body.textContent).toContain("queda como una copia más.");
    expect(document.body.textContent).not.toContain("salvo que");

    await act(async () => boton("Recuperar esta versión").click());
    expect(alRecuperar).toHaveBeenCalledTimes(1);
    const recuperada = alRecuperar.mock.calls[0][0] as Cartera;
    expect(recuperada.movimientos.map((m) => m.id)).toEqual(["m-1"]);
    expect(recuperada.id).toBe(actual.id);
  });

  it("sin copias, dice cuándo aparecerá la primera y dónde están", async () => {
    const { almacen } = preparar();
    const unica = garcia();
    await almacen.guardar(unica);
    await pintar(unica, almacen);
    await esperar(() => document.body.textContent?.includes("Aún no hay versiones anteriores") ?? false);
    expect(document.body.textContent).toContain("Las copias se hacen solas al guardar: la primera aparecerá en cuanto cambies la cartera.");
    expect(document.body.textContent).toContain("subcarpeta «copias»");
    expect([...document.body.querySelectorAll("button")].some((b) => b.textContent === "Recuperar esta versión")).toBe(false);
  });
});
