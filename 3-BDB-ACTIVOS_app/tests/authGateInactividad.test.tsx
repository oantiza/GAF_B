// @vitest-environment happy-dom

/**
 * Decisión 46 de Óscar (05-11-2026), montada en la puerta de acceso de verdad, con un Firebase Auth simulado y un reloj falso:
 * el aviso, la respuesta, el cierre, y lo que dice el acceso después. La lógica, con las cuentas a mano, está en
 * `cierrePorInactividad.test.ts`; aquí se mira que los eventos y la pantalla llegan a ella.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type AuthCallback = (user: unknown) => void;
const authState = vi.hoisted(() => ({
  callback: null as AuthCallback | null,
  initialUser: null as unknown,
  signOut: vi.fn(),
  signOutFalla: false
}));

vi.mock("../src/firebaseEnv", () => ({
  FIREBASE_CONFIGURED: true,
  PRODUCCION_SIN_CONFIGURAR: false,
  APUNTA_A_BDB: false,
  firebaseConfig: {},
  FUNCTIONS_REGION: "europe-west1"
}));
vi.mock("../src/firebase", () => ({ auth: {}, functions: null, appCheckReady: Promise.resolve() }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, callback: AuthCallback) => {
    authState.callback = callback;
    callback(authState.initialUser);
    return () => {
      authState.callback = null;
    };
  },
  signOut: (...args: unknown[]) => {
    authState.signOut(...args);
    if (authState.signOutFalla) return Promise.reject(new Error("sin red"));
    authState.callback?.(null);
    return Promise.resolve();
  },
  multiFactor: () => ({ enrolledFactors: [{ uid: "totp" }] }),
  TotpMultiFactorGenerator: { assertionForSignIn: vi.fn(), FACTOR_ID: "totp" },
  getMultiFactorResolver: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {}
}));

import { AuthGate } from "../src/auth/AuthGate";
import { useAuthSession } from "../src/auth/AuthSessionContext";
import { CLAVE_ULTIMA_ACTIVIDAD } from "../src/auth/cierrePorInactividad";
import { CURRENT_PORTFOLIO_STORAGE_KEY } from "../src/core/localPortfolioStorage";

const MINUTO = 60_000;
const USUARIO = {
  uid: "asesora",
  email: "asesora@casa.es",
  emailVerified: true,
  getIdTokenResult: async () => ({ claims: { email_verified: true } })
};
const TEXTO = "Tu sesión se cerrará en 1 minuto por inactividad. Lo que no esté guardado se perderá.";
const CERRADA = "Sesión cerrada por inactividad";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function Aplicacion() {
  const session = useAuthSession();
  return createElement("button", { type: "button", onClick: session?.signOut }, `La aplicación de ${session?.email ?? "nadie"}`);
}

const reposar = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

async function montar() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AuthGate, null, createElement(Aplicacion)));
  });
  /* El módulo de Firebase se carga con un import dinámico, que no entiende de relojes falsos: se le da tiempo de verdad. */
  for (let vuelta = 0; vuelta < 200 && (host.querySelector("main.auth-screen .auth-loading") || host.textContent === ""); vuelta += 1) {
    await act(async () => {
      await new Promise((listo) => setImmediate(listo));
      await vi.advanceTimersByTimeAsync(1);
    });
  }
  await reposar();
}

const pasar = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

const aviso = () => document.querySelector('[role="dialog"]');
const enLaAplicacion = () => (host?.textContent ?? "").includes("La aplicación de");
const enElAcceso = () => host?.querySelector('input[type="email"]') !== null && host?.querySelector('input[type="email"]') !== undefined;
const seguirAqui = () => [...document.querySelectorAll("button")].find((boton) => boton.textContent === "Seguir aquí");

/** Un gesto de una persona. En este entorno los eventos no vienen marcados como de confianza, y en un navegador sí. */
function gesto(evento: Event) {
  Object.defineProperty(evento, "isTrusted", { value: true });
  return act(async () => {
    window.dispatchEvent(evento);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  localStorage.clear();
  sessionStorage.clear();
  authState.initialUser = USUARIO;
  authState.signOutFalla = false;
  authState.signOut.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("el aviso del último minuto", () => {
  test("sale a los 29 minutos, con el texto de la decisión y la cuenta atrás, sin nada del asesor", async () => {
    await montar();
    expect(enLaAplicacion()).toBe(true);
    await pasar(29 * MINUTO - 2000);
    expect(aviso()).toBeNull();
    await pasar(2000);
    expect(aviso()?.textContent).toContain(TEXTO);
    expect(aviso()?.querySelector('[role="timer"]')?.textContent).toContain("1:00");
    expect(aviso()?.textContent).not.toContain("asesora");
    await pasar(15_000);
    expect(aviso()?.querySelector('[role="timer"]')?.textContent).toContain("0:45");
  });

  test("«Seguir aquí» lo quita, y otros 30 minutos", async () => {
    await montar();
    await pasar(29 * MINUTO + 5000);
    await act(async () => seguirAqui()?.click());
    expect(aviso()).toBeNull();
    await pasar(29 * MINUTO - 1000);
    expect(aviso()).toBeNull();
    expect(enLaAplicacion()).toBe(true);
    await pasar(1000);
    expect(aviso()).not.toBeNull();
  });

  test("Escape responde, y un clic fuera o mover el ratón, no", async () => {
    await montar();
    await pasar(29 * MINUTO + 5000);
    await gesto(new MouseEvent("pointermove", { screenX: 10, screenY: 10 }));
    await gesto(new MouseEvent("pointerdown"));
    await act(async () => {
      document.querySelector(".ui-dialog-backdrop")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(aviso()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(aviso()).toBeNull();
  });
});

describe("la actividad", () => {
  test.each([
    ["el teclado", () => new KeyboardEvent("keydown", { key: "a" })],
    ["el ratón", () => new MouseEvent("pointermove", { screenX: 5, screenY: 7 })],
    ["un clic", () => new MouseEvent("pointerdown")],
    ["la rueda", () => new Event("wheel")],
    ["un toque", () => new Event("touchstart")]
  ])("%s aplaza el cierre", async (_nombre, crear) => {
    await montar();
    await pasar(20 * MINUTO);
    await gesto(crear());
    await pasar(20 * MINUTO);
    expect(aviso()).toBeNull();
    expect(enLaAplicacion()).toBe(true);
  });

  test("volver a la pestaña también", async () => {
    await montar();
    await pasar(20 * MINUTO);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pasar(20 * MINUTO);
    expect(aviso()).toBeNull();
  });

  test("un evento lanzado por código no aplaza nada", async () => {
    await montar();
    await pasar(28 * MINUTO);
    const deCodigo = new KeyboardEvent("keydown", { key: "a" });
    Object.defineProperty(deCodigo, "isTrusted", { value: false });
    await act(async () => {
      window.dispatchEvent(deCodigo);
    });
    await pasar(MINUTO);
    expect(aviso()).not.toBeNull();
  });
});

describe("el cierre", () => {
  test("sin responder, a los 30 minutos: cierra la sesión, borra la cartera y el acceso lo dice", async () => {
    localStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, "{}");
    sessionStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, "{}");
    await montar();
    await pasar(30 * MINUTO);
    expect(authState.signOut).toHaveBeenCalledTimes(1);
    expect(aviso()).toBeNull();
    expect(enLaAplicacion()).toBe(false);
    expect(enElAcceso()).toBe(true);
    expect(host?.textContent).toContain(CERRADA);
    expect(localStorage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
  });

  test("si cerrar falla, la pantalla se va igual", async () => {
    authState.signOutFalla = true;
    await montar();
    await pasar(30 * MINUTO);
    expect(authState.signOut).toHaveBeenCalledTimes(1);
    expect(enLaAplicacion()).toBe(false);
    expect(host?.textContent).toContain(CERRADA);
  });

  test("«Salir» a mano no dice que fuera por inactividad, ni después de un rato", async () => {
    await montar();
    await act(async () => host?.querySelector("button")?.click());
    expect(authState.signOut).toHaveBeenCalledTimes(1);
    expect(enElAcceso()).toBe(true);
    expect(host?.textContent).not.toContain(CERRADA);
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBeNull();
    await pasar(2 * 60 * MINUTO);
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    authState.initialUser = null;
    await montar();
    expect(host?.textContent).not.toContain(CERRADA);
  });

  test("cuando la cierra otra pestaña, esta se queda en el acceso diciéndolo", async () => {
    await montar();
    /* La otra ha llegado antes: el navegador la ha dejado sin la sesión, y la hora ya ha caducado. */
    vi.setSystemTime(Date.now() + 31 * MINUTO);
    await act(async () => authState.callback?.(null));
    expect(enElAcceso()).toBe(true);
    expect(host?.textContent).toContain(CERRADA);
  });
});

describe("una sesión que venía de antes", () => {
  test("con la hora caducada no llega a pintarse: el portátil dormido, el navegador cerrado", async () => {
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - 45 * MINUTO));
    localStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, "{}");
    await montar();
    expect(authState.signOut).toHaveBeenCalledTimes(1);
    expect(enLaAplicacion()).toBe(false);
    expect(host?.textContent).toContain(CERRADA);
    expect(localStorage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
  });

  test("si cerrarla falla, no se queda en «Comprobando sesión…», y la cartera tampoco se queda en el navegador", async () => {
    authState.signOutFalla = true;
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - 45 * MINUTO));
    localStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, "{}");
    await montar();
    await reposar();
    expect(enLaAplicacion()).toBe(false);
    expect(host?.textContent).toContain(CERRADA);
    expect(localStorage.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
  });

  test("con la hora reciente, recargar no pierde nada ni cuenta como actividad", async () => {
    const hace10 = Date.now() - 10 * MINUTO;
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(hace10));
    localStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, "{}");
    await montar();
    expect(enLaAplicacion()).toBe(true);
    expect(authState.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBe(String(hace10));
    await pasar(19 * MINUTO);
    expect(aviso()).not.toBeNull();
  });

  test("sin hora guardada empieza a contar: la primera vez tras publicar no echa a nadie", async () => {
    await montar();
    expect(enLaAplicacion()).toBe(true);
    expect(Number(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD))).toBe(Date.now());
  });
});

describe("entrar", () => {
  test("cuenta como actividad: la hora caducada de la sesión anterior no cierra la nueva, y deja de decirse", async () => {
    authState.initialUser = null;
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - 45 * MINUTO));
    await montar();
    expect(enElAcceso()).toBe(true);
    expect(host?.textContent).toContain(CERRADA);
    await act(async () => authState.callback?.(USUARIO));
    expect(enLaAplicacion()).toBe(true);
    expect(authState.signOut).not.toHaveBeenCalled();
    expect(Number(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD))).toBe(Date.now());
    await pasar(5 * MINUTO);
    expect(aviso()).toBeNull();
  });

  test("sin sesión y con una hora que no ha caducado, la hora no significa nada y no se queda", async () => {
    authState.initialUser = null;
    localStorage.setItem(CLAVE_ULTIMA_ACTIVIDAD, String(Date.now() - 5 * MINUTO));
    await montar();
    expect(host?.textContent).not.toContain(CERRADA);
    expect(localStorage.getItem(CLAVE_ULTIMA_ACTIVIDAD)).toBeNull();
  });
});
