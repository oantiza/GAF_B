// @vitest-environment happy-dom

/**
 * MAR-04: «Restablecer contraseña» con un correo mal escrito decía «No se pudo iniciar sesión: auth/invalid-email.
 * No es la contraseña, es la configuración del acceso.» MAR-31: cualquier error (red, demasiados intentos) marcaba
 * correo y contraseña como inválidos, y el mensaje no se asociaba a ningún campo.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authState = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn()
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
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    callback(null);
    return () => {};
  },
  signOut: vi.fn(async () => undefined),
  sendEmailVerification: vi.fn(),
  reload: vi.fn(),
  multiFactor: () => ({ enrolledFactors: [] }),
  TotpMultiFactorGenerator: { assertionForSignIn: vi.fn(), FACTOR_ID: "totp" },
  getMultiFactorResolver: vi.fn(),
  sendPasswordResetEmail: (...args: unknown[]) => authState.sendPasswordResetEmail(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => authState.signInWithEmailAndPassword(...args),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {}
}));

import { AuthGate } from "../src/auth/AuthGate";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function button(text: string): HTMLButtonElement {
  const found = [...(host?.querySelectorAll("button") ?? [])].find((b) => (b.textContent || "").trim() === text);
  if (!found) throw new Error(`No aparece el botón «${text}»`);
  return found as HTMLButtonElement;
}

function campo(tipo: "email" | "password"): HTMLInputElement {
  return host!.querySelector(`input[type="${tipo}"]`) as HTMLInputElement;
}

async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function mountGate() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AuthGate, null, createElement("p", { id: "app" }, "Aplicación")));
  });
  for (let attempt = 0; attempt < 50 && !host.querySelector("h1, #app"); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function enviar() {
  await act(async () => {
    host!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  authState.sendPasswordResetEmail.mockReset();
  authState.signInWithEmailAndPassword.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

describe("mensajes y campos señalados en el acceso", () => {
  test("«Restablecer contraseña» con un correo mal escrito dice que revise el correo", async () => {
    authState.sendPasswordResetEmail.mockRejectedValue({ code: "auth/invalid-email" });
    await mountGate();
    await escribir(campo("email"), "abc");
    await act(async () => { button("Restablecer contraseña").click(); });

    const alerta = host!.querySelector('[role="alert"]')!;
    expect(alerta.textContent).toBe("Revisa el correo: no tiene forma de dirección (nombre@empresa.com).");
    expect(alerta.textContent).not.toContain("configuración");
    expect(campo("email").getAttribute("aria-invalid")).toBe("true");
    expect(campo("password").getAttribute("aria-invalid")).toBe("false");
    expect(campo("email").getAttribute("aria-describedby")).toBe(alerta.id);
  });

  test("un fallo de red no marca los campos como inválidos", async () => {
    authState.signInWithEmailAndPassword.mockRejectedValue({ code: "auth/network-request-failed" });
    await mountGate();
    await escribir(campo("email"), "asesora@oaa.es");
    await escribir(campo("password"), "secreto123");
    await enviar();

    expect(host!.querySelector('[role="alert"]')?.textContent).toContain("Revisa la conexión");
    expect(campo("email").getAttribute("aria-invalid")).toBe("false");
    expect(campo("password").getAttribute("aria-invalid")).toBe("false");
    expect(campo("email").hasAttribute("aria-describedby")).toBe(false);
  });

  test("unas credenciales incorrectas marcan los dos campos y les asocian el mensaje", async () => {
    authState.signInWithEmailAndPassword.mockRejectedValue({ code: "auth/invalid-credential" });
    await mountGate();
    await escribir(campo("email"), "asesora@oaa.es");
    await escribir(campo("password"), "secreto123");
    await enviar();

    const alerta = host!.querySelector('[role="alert"]')!;
    expect(alerta.textContent).toContain("no son correctos");
    for (const tipo of ["email", "password"] as const) {
      expect(campo(tipo).getAttribute("aria-invalid")).toBe("true");
      expect(campo(tipo).getAttribute("aria-describedby")).toBe(alerta.id);
    }
  });
});
