// @vitest-environment happy-dom

/**
 * Modo cliente en el marco (hallazgo 6 y decisión 19, 04-11-2026). El interruptor promete ocultar lo
 * comercial, y a un clic quedaban las retrocesiones de 376 fondos: la sección «Datos» seguía en el
 * menú, y Sistema se abría.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const estado = vi.hoisted(() => ({ admin: true, montados: [] as string[] }));

vi.mock("../src/auth/useIsAdmin", () => ({
  useIsAdmin: () => estado.admin,
  /* El marco espera a saber si hay permiso (MAR-22): en estas pruebas ya se sabe. */
  useAdminClaim: () => ({ isAdmin: estado.admin, resolved: true })
}));
vi.mock("../src/pages/MercadoPage", () => ({ MercadoPage: () => createElement("h1", null, "Mercado") }));
vi.mock("../src/pages/AdminPage", () => ({
  AdminPage: () => {
    estado.montados.push("AdminPage");
    return createElement("h1", null, "Sistema");
  }
}));
vi.mock("../src/pages/SaludDelCatalogoPage", () => ({
  SaludDelCatalogoPage: () => {
    estado.montados.push("SaludDelCatalogoPage");
    return createElement("h1", null, "Salud del catálogo");
  }
}));

import { BdbActivosApp } from "../src/app/BdbActivosApp";
import { CLIENT_MODE_STORAGE_KEY, ClientModeProvider, useClientMode } from "../src/app/ClientModeContext";
import { AuthSessionContext, type AuthSessionContextValue } from "../src/auth/AuthSessionContext";

let root: Root | undefined;
let host: HTMLDivElement;

const SESION: AuthSessionContextValue = {
  uid: "usuario-de-prueba",
  email: "alguien@ejemplo.test",
  emailVerified: true,
  mfaEnrolled: false,
  openSecurity: () => undefined,
  signOut: () => undefined
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  estado.admin = true;
  estado.montados = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function esperar(condicion: () => boolean, que: string) {
  for (let intento = 0; intento < 300; intento += 1) {
    if (condicion()) return;
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 10));
    });
  }
  throw new Error(`No aparece: ${que}`);
}

function montar(ruta: string, modoCliente: boolean, sesion: AuthSessionContextValue | null = SESION, extra: ReactNode = null) {
  window.history.replaceState(null, "", ruta);
  return act(async () => {
    root!.render(
      createElement(
        AuthSessionContext.Provider,
        { value: sesion },
        createElement(ClientModeProvider, { initialValue: modoCliente }, extra, createElement(BdbActivosApp))
      )
    );
  });
}

function Interruptor() {
  const { toggle } = useClientMode();
  return createElement("button", { "data-testid": "interruptor", onClick: toggle, type: "button" }, "modo");
}

const textoDeLaBarra = () => host.querySelector(".app-topbar")?.textContent ?? "";
const textoDelMenu = () => host.querySelector(".app-rail")?.textContent ?? "";

describe("la sección Datos", () => {
  test("sin el modo, un administrador la ve", async () => {
    await montar("/mercado", false);
    await esperar(() => host.querySelector("main h1") !== null, "Mercado");
    expect(textoDelMenu()).toContain("Salud del catálogo");
    expect(textoDelMenu()).toContain("Sistema");
  });

  test("con el modo, no se pinta", async () => {
    await montar("/mercado", true);
    await esperar(() => host.querySelector("main h1") !== null, "Mercado");
    expect(textoDelMenu()).not.toContain("Salud");
    expect(textoDelMenu()).not.toContain("Sistema");
    expect(textoDelMenu()).not.toContain("Datos");
  });

  test.each(["/sistema", "/salud-catalogo"])("por dirección directa a %s, dice que no está disponible y no monta la pantalla", async (ruta) => {
    await montar(ruta, true);
    await esperar(() => host.textContent?.includes("No disponible en modo cliente") ?? false, "el aviso");
    expect(host.textContent).toContain("Desactiva Modo cliente para ver esta sección.");
    expect(estado.montados).toEqual([]);
  });

  test("quitar el modo la devuelve, y ponerlo con la pantalla abierta la cierra", async () => {
    await montar("/sistema", false, SESION, createElement(Interruptor));
    await esperar(() => host.querySelector("main h1")?.textContent === "Sistema", "Sistema");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="interruptor"]')!.click());
    expect(host.querySelector("main")?.textContent).toContain("No disponible en modo cliente");
    /* Se queda el título de la pantalla, y la pantalla no. */
    expect(host.querySelector("main h1")?.textContent).toBe("Sistema");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="interruptor"]')!.click());
    await esperar(() => !host.querySelector("main")?.textContent?.includes("No disponible en modo cliente"), "Sistema otra vez");
  });

  test("activarlo en otra pestaña llega a esta, que estaba abierta", async () => {
    await montar("/sistema", false, SESION, createElement(Interruptor));
    await esperar(() => host.querySelector("main h1")?.textContent === "Sistema", "Sistema");
    expect(host.querySelector("main")?.textContent).not.toContain("No disponible en modo cliente");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: CLIENT_MODE_STORAGE_KEY, newValue: "true" }));
    });
    expect(host.querySelector("main")?.textContent).toContain("No disponible en modo cliente");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: CLIENT_MODE_STORAGE_KEY, newValue: "false" }));
    });
    await esperar(() => !host.querySelector("main")?.textContent?.includes("No disponible en modo cliente"), "Sistema otra vez");
  });

  test.each(["/sistema", "/salud-catalogo"])("sin permisos, %s dice que es del administrador, también en Modo cliente", async (ruta) => {
    estado.admin = false;
    await montar(ruta, true);
    await esperar(() => host.textContent?.includes("Sección reservada al administrador") ?? false, "el aviso");
    /* A quien no tiene permiso, decirle que quite Modo cliente sería mentirle. */
    expect(host.textContent).not.toContain("Desactiva Modo cliente");
    expect(estado.montados).toEqual([]);
  });
});

describe("las carteras guardadas, que son de otros clientes", () => {
  test("sin el modo, el menú las ofrece; con el modo, no", async () => {
    await montar("/mercado", false);
    await esperar(() => host.querySelector("main h1") !== null, "Mercado");
    expect(textoDelMenu()).toContain("Guardadas");
    await act(async () => root!.unmount());
    root = createRoot(host);
    await montar("/mercado", true);
    await esperar(() => host.querySelector("main h1") !== null, "Mercado");
    expect(textoDelMenu()).not.toContain("Guardadas");
  });

  test("con el modo, tampoco escribiendo la dirección", async () => {
    await montar("/carteras-guardadas", true);
    await esperar(() => host.textContent?.includes("No disponible en modo cliente") ?? false, "el aviso");
    expect(host.querySelector("main table")).toBeNull();
  });
});

describe("la cuenta en la barra", () => {
  test("sin el modo: el correo, y las palabras solo si hay algo que decir", async () => {
    await montar("/mercado", false, { ...SESION, mfaEnrolled: false });
    expect(textoDeLaBarra()).toContain("alguien@ejemplo.test");
    expect(textoDeLaBarra()).toContain("Revisar seguridad");
    expect(host.querySelector(".topbar-account--aviso")).not.toBeNull();
  });

  test("con la cuenta protegida no se dice nada a la vista", async () => {
    await montar("/mercado", false, { ...SESION, mfaEnrolled: true });
    expect(textoDeLaBarra()).toContain("alguien@ejemplo.test");
    expect(textoDeLaBarra()).not.toContain("Revisar seguridad");
    expect(host.querySelector(".topbar-account--aviso")).toBeNull();
  });

  /* El botón abría el diálogo con el correo y el estado de seguridad: quitar solo lo que se leía en la barra dejaba
     a un clic lo que la decisión 19 oculta. Tampoco para un lector de pantalla: se quita, no se esconde. */
  test.each([false, true])("con el modo no hay botón de la cuenta, ni correo, ni aviso, ni el nombre que sale del correo (cuenta protegida: %s)", async (mfaEnrolled) => {
    await montar("/mercado", true, { ...SESION, mfaEnrolled });
    expect(host.querySelector(".topbar-account")).toBeNull();
    expect(textoDeLaBarra()).not.toContain("alguien@ejemplo.test");
    expect(textoDeLaBarra()).not.toContain("Revisar seguridad");
    expect(textoDeLaBarra()).not.toContain("Cuenta");
    expect(textoDeLaBarra()).not.toContain("verificación en dos pasos");
    expect(textoDelMenu()).not.toContain("Alguien");
    expect(host.querySelector(".rail-avatar")).toBeNull();
  });

  test("quitar el modo devuelve el botón, y ponerlo con la barra a la vista lo quita", async () => {
    await montar("/mercado", false, SESION, createElement(Interruptor));
    expect(host.querySelector(".topbar-account")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="interruptor"]')!.click());
    expect(host.querySelector(".topbar-account")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="interruptor"]')!.click());
    expect(host.querySelector(".topbar-account")).not.toBeNull();
  });

  test("«Salir» sigue ahí, con el modo o sin él", async () => {
    await montar("/mercado", true);
    expect(textoDeLaBarra()).toContain("Salir");
  });
});
