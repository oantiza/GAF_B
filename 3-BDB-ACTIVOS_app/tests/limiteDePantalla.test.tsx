// @vitest-environment happy-dom

/**
 * MAR-02 (auditoría de frontend, 13-11-2026): un error en una pantalla no tumba la aplicación.
 *
 * El único límite de error estaba en `main.tsx`, fuera del marco: si una pantalla lanzaba al pintar, o un trozo
 * diferido no se descargaba tras publicar una versión nueva, desaparecían el menú y la barra y solo quedaba
 * «Recargar». Ahora cada pantalla tiene el suyo, dentro del contenido, y se reinicia al navegar.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const fallos = vi.hoisted(() => ({ jubilacion: new Error("pendiente") as Error }));

vi.mock("../src/auth/useIsAdmin", () => ({
  useIsAdmin: () => false,
  /* El marco espera a saber si hay permiso (MAR-22): en estas pruebas ya se sabe. */
  useAdminClaim: () => ({ isAdmin: false, resolved: true })
}));
vi.mock("../src/pages/PlanesPage", () => ({
  PlanesPage: () => {
    throw new Error("La pantalla simulada falla al pintar");
  }
}));
vi.mock("../src/pages/MercadoPage", () => ({ MercadoPage: () => <h1>Mercado simulado</h1> }));
vi.mock("../src/pages/JubilacionPage", () => ({
  JubilacionPage: () => {
    throw fallos.jubilacion;
  }
}));

import { BdbActivosApp } from "../src/app/BdbActivosApp";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  /* React escribe en la consola el error que captura un límite: aquí es lo esperado. */
  vi.spyOn(console, "error").mockImplementation(() => undefined);
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

const reposar = () =>
  act(async () => {
    await new Promise((listo) => setTimeout(listo, 0));
  });
const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
const entradaDelMenu = (nombre: string) => host.querySelector<HTMLAnchorElement>(`.rail-nav a[aria-label="${nombre}"]`);

async function abrirEn(camino: string) {
  window.history.replaceState(null, "", camino);
  await act(async () => root!.render(<BdbActivosApp />));
  await reposar();
  await reposar();
}

describe("límite de error por pantalla", () => {
  test("una pantalla que lanza deja vivos el menú y la barra, y dice cuál ha fallado", async () => {
    await abrirEn("/jubilacion/planes");

    const contenido = host.querySelector("#contenido-principal")!;
    expect(host.querySelector(".rail-nav")).not.toBeNull();
    expect(host.querySelector(".app-topbar")).not.toBeNull();
    expect(contenido.querySelector("h1")?.textContent).toBe("Planes y EPSV");
    expect(contenido.textContent).toContain("Esta pantalla no se ha podido abrir");
    expect(boton("Reintentar")).toBeDefined();
    expect(boton("Ir al Buscador")).toBeDefined();
  });

  test("navegar a otra entrada del menú pinta esa pantalla", async () => {
    await abrirEn("/jubilacion/planes");
    await act(async () => entradaDelMenu("Mercado")!.click());
    await reposar();

    const contenido = host.querySelector("#contenido-principal")!;
    expect(contenido.textContent).toContain("Mercado simulado");
    expect(contenido.textContent).not.toContain("Esta pantalla no se ha podido abrir");
  });

  test("un trozo que no se descarga ofrece recargar, avisando de la versión nueva", async () => {
    /* Lo que manda Vite cuando no puede traer un trozo: el evento `vite:preloadError` con el error, que luego
       rechaza el `import()` dinámico y llega al límite. El mensaje no dice nada a propósito: lo reconoce el evento. */
    fallos.jubilacion = new Error("Trozo simulado sin descargar");
    await abrirEn("/mercado");
    const evento = new Event("vite:preloadError");
    Object.assign(evento, { payload: fallos.jubilacion });
    window.dispatchEvent(evento);
    await act(async () => entradaDelMenu("Jubilación")!.click());
    await reposar();

    const contenido = host.querySelector("#contenido-principal")!;
    expect(host.querySelector(".rail-nav")).not.toBeNull();
    expect(contenido.textContent).toContain("versión nueva");
    expect(contenido.textContent).toContain("cartera en curso se conserva");
    expect(boton("Recargar la aplicación")).toBeDefined();
  });

  test("el error de un `import()` dinámico se trata igual", async () => {
    fallos.jubilacion = new TypeError("Failed to fetch dynamically imported module: https://x/assets/JubilacionPage-abc.js");
    await abrirEn("/jubilacion");
    expect(boton("Recargar la aplicación")).toBeDefined();
    expect(host.querySelector("#contenido-principal")?.textContent).toContain("versión nueva");
  });
});
