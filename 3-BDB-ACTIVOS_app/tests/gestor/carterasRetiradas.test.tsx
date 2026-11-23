// @vitest-environment happy-dom
/**
 * «Carteras retiradas» en la entrada de Carteras de clientes (Óscar, 21-11-2026): al pie de la lista, plegado y solo si hay
 * alguna en la papelera; «Recuperar» pregunta, la devuelve a la carpeta y la lista la enseña; si ya hay una cartera con ese
 * nombre no se pisa y se dice; en Modo cliente no sale. Con el almacén de verdad sobre una carpeta falsa.
 */
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ almacen: null as unknown }));
vi.mock("../../src/gestor/ui/estado/useAlmacen", () => ({
  useAlmacen: () => ({ estado: { fase: "lista", almacen: control.almacen }, error: null, elegir: async () => undefined, reanudar: async () => undefined, olvidar: async () => undefined })
}));

import { ClientModeProvider } from "../../src/app/ClientModeContext";
import { almacenEnCarpeta } from "../../src/gestor/almacen/carpeta";
import type { AlmacenDeCarteras } from "../../src/gestor/almacen/almacen";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { GestorDeCarterasPage } from "../../src/gestor/ui/GestorDeCarterasPage";
import { activo, cartera, mov } from "./ayudas";
import { crearCarpetaFalsa, type CarpetaFalsa } from "./carpetaFalsa";
import { pintar, type Pintado } from "./vistaAnalisisDatos";

let falsa: CarpetaFalsa;
let almacen: AlmacenDeCarteras;
let pintado: Pintado | undefined;

beforeEach(() => {
  falsa = crearCarpetaFalsa({ nombre: "Carteras", reloj: () => Date.parse("2026-11-20T10:00:00Z") });
  almacen = almacenEnCarpeta(falsa.carpeta, { ahora: () => new Date("2026-11-20T10:00:00Z") });
  control.almacen = almacen;
});

afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

const enModo = (modoCliente: boolean, nodo: ReactNode) => <ClientModeProvider initialValue={modoCliente}>{nodo}</ClientModeProvider>;

async function esperar(condicion: () => boolean) {
  for (let intento = 0; intento < 200 && !condicion(); intento += 1) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
  }
  expect(condicion()).toBe(true);
}

const texto = () => document.body.textContent ?? "";
const boton = (nombre: string) => [...document.body.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nombre || b.textContent?.trim() === nombre);
const pulsar = async (elemento: Element | undefined) => {
  expect(elemento).toBeDefined();
  await act(async () => (elemento as HTMLElement).click());
};

function deCliente(nombre: string, id: string, cliente: string): Cartera {
  return cartera([activo("ES0000000001", "FONDO")], [mov("aportacion", "2026-01-02", { importe: "1000" })], { id, nombre, cliente: { nombre: cliente } });
}

/** «Familia García» retirada y «Familia Ruiz» viva. */
async function sembrar() {
  await almacen.guardar(deCliente("Familia García", "aaaaaaaa-1111-4000-8000-000000000001", "Marta García"));
  await almacen.retirar("Familia García.cartera.json");
  await almacen.guardar(deCliente("Familia Ruiz", "bbbbbbbb-2222-4000-8000-000000000002", "Luis Ruiz"));
}

describe("Carteras retiradas", () => {
  it("sin nada en la papelera no sale", async () => {
    await almacen.guardar(deCliente("Familia Ruiz", "bbbbbbbb-2222-4000-8000-000000000002", "Luis Ruiz"));
    pintado = await pintar(enModo(false, <GestorDeCarterasPage />));
    await esperar(() => texto().includes("Familia Ruiz"));
    expect(texto()).not.toContain("Carteras retiradas");
  });

  it("sale plegada al pie, con la retirada, y al recuperarla vuelve a la lista", async () => {
    await sembrar();
    pintado = await pintar(enModo(false, <GestorDeCarterasPage />));
    await esperar(() => texto().includes("Carteras retiradas"));
    const titulo = [...document.body.querySelectorAll("h2")].find((h) => h.textContent?.includes("Carteras retiradas"));
    expect(titulo).toBeDefined();
    expect(texto()).toContain("1 cartera");
    expect(texto()).toContain("En la subcarpeta «papelera» de «Carteras»");
    /* La lista de arriba no la enseña: solo «Familia Ruiz». */
    /* La primera tabla de la página es la lista de carteras vivas. */
    const tablaDeLaLista = document.body.querySelector("table");
    expect(tablaDeLaLista?.textContent).not.toContain("Familia García");

    await pulsar(boton("Recuperar: Familia García"));
    await esperar(() => texto().includes("¿Recuperar la cartera «Familia García»?"));
    const confirmar = [...document.body.querySelectorAll('[role="dialog"] button, dialog button')].find((b) => b.textContent?.trim() === "Recuperar");
    await pulsar(confirmar);
    await esperar(() => texto().includes("No queda ninguna cartera retirada."));
    expect(falsa.contenido("Familia García.cartera.json")).toBeDefined();
    expect(falsa.contenido("papelera/Familia García.cartera.json")).toBeUndefined();
    /* La lista se vuelve a leer y la enseña. */
    await esperar(() => [...document.body.querySelectorAll("table")].some((tabla) => tabla.textContent?.includes("Familia García") && tabla.textContent.includes("Familia Ruiz")));
  });

  it("si ya hay una cartera con ese nombre, no la pisa y lo dice", async () => {
    await sembrar();
    await almacen.guardar(deCliente("Familia García", "cccccccc-3333-4000-8000-000000000003", "Otra García"));
    const antes = falsa.volcar();
    pintado = await pintar(enModo(false, <GestorDeCarterasPage />));
    await esperar(() => Boolean(boton("Recuperar: Familia García")));
    await pulsar(boton("Recuperar: Familia García"));
    await esperar(() => texto().includes("¿Recuperar la cartera «Familia García»?"));
    await pulsar([...document.body.querySelectorAll('[role="dialog"] button, dialog button')].find((b) => b.textContent?.trim() === "Recuperar"));
    await esperar(() => texto().includes("No se ha recuperado"));
    expect(texto()).toContain("Ya hay en la carpeta una cartera que se llama «Familia García»");
    expect(falsa.volcar()).toEqual(antes);
    /* Sigue en la papelera, y se puede volver a intentar. */
    expect(boton("Recuperar: Familia García")).toBeDefined();
  });

  it("cancelar la pregunta no recupera nada", async () => {
    await sembrar();
    const antes = falsa.volcar();
    pintado = await pintar(enModo(false, <GestorDeCarterasPage />));
    await esperar(() => Boolean(boton("Recuperar: Familia García")));
    await pulsar(boton("Recuperar: Familia García"));
    await esperar(() => texto().includes("¿Recuperar la cartera «Familia García»?"));
    await pulsar([...document.body.querySelectorAll('[role="dialog"] button, dialog button')].find((b) => b.textContent?.trim() === "Cancelar"));
    expect(falsa.volcar()).toEqual(antes);
  });

  it("en Modo cliente no sale: son carteras de otros clientes", async () => {
    await sembrar();
    pintado = await pintar(enModo(true, <GestorDeCarterasPage />));
    await act(async () => new Promise((resolver) => setTimeout(resolver, 30)));
    expect(texto()).not.toContain("Carteras retiradas");
    expect(texto()).not.toContain("Familia García");
  });
});
