// @vitest-environment happy-dom

/**
 * MAR-24 · Las regiones `role="status"` de la puerta de acceso no nacen llenas.
 *
 * Muchos lectores de pantalla no anuncian una región viva que se monta ya con su texto: anuncian lo que cambia dentro
 * de una región que ya estaba. Así que se mira cómo llega el texto al DOM: si la región nace llena, su texto entra con
 * ella, en el mismo nodo insertado, y ninguna mutación cae dentro de la región; si nace vacía, hay una mutación cuyo
 * destino es la propia región y que le añade el texto. Lo segundo es lo que tiene que pasar.
 *
 * Lo que esta prueba no puede decir es que un lector concreto lo anuncie: eso se comprueba con NVDA.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type AuthCallback = (user: unknown) => void;
const authState = vi.hoisted(() => ({
  callback: null as AuthCallback | null,
  initialUser: null as unknown,
  sendEmailVerification: vi.fn()
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
    return () => { authState.callback = null; };
  },
  signOut: () => Promise.resolve(),
  sendEmailVerification: (...args: unknown[]) => authState.sendEmailVerification(...args),
  reload: vi.fn(),
  multiFactor: () => ({ enrolledFactors: [] }),
  TotpMultiFactorGenerator: { assertionForSignIn: vi.fn(), FACTOR_ID: "totp" },
  getMultiFactorResolver: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {}
}));

import { AuthGate } from "../src/auth/AuthGate";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let observador: MutationObserver | undefined;
const mutaciones: MutationRecord[] = [];

const esRegion = (nodo: Node | null): nodo is Element => nodo instanceof Element && nodo.getAttribute("role") === "status";

/** Los textos que entraron en una región `status` que ya estaba montada. */
function textosQueEntraronEnUnaRegion(): string[] {
  observador?.takeRecords().forEach((registro) => mutaciones.push(registro));
  return mutaciones
    .filter((registro) => registro.type === "childList" && esRegion(registro.target))
    .flatMap((registro) => [...registro.addedNodes].map((nodo) => nodo.textContent ?? ""))
    .filter(Boolean);
}

async function montar(hasta: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  observador = new MutationObserver((registros) => mutaciones.push(...registros));
  observador.observe(host, { childList: true, subtree: true, characterData: true });
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AuthGate, null, createElement("p", { id: "app" }, "Aplicación")));
  });
  for (let intento = 0; intento < 50 && !host.querySelector(hasta); intento += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

function boton(texto: string): HTMLButtonElement {
  const encontrado = [...(host?.querySelectorAll("button") ?? [])].find((b) => (b.textContent || "").trim() === texto);
  if (!encontrado) throw new Error(`No aparece el botón «${texto}»`);
  return encontrado as HTMLButtonElement;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mutaciones.length = 0;
  authState.initialUser = null;
  authState.sendEmailVerification.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  observador?.disconnect();
  observador = undefined;
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

describe("MAR-24 · las regiones de estado del acceso", () => {
  test("«Cargando acceso…» entra en una región que ya estaba, no nace con ella", async () => {
    await montar("h1");
    expect(textosQueEntraronEnUnaRegion()).toContain("Cargando acceso…");
  });

  test("«Comprobando sesión…» entra en una región que ya estaba", async () => {
    // Una cuenta verificada cuyo token no lo dice todavía: la puerta se queda comprobando la sesión.
    authState.initialUser = {
      uid: "asesora",
      email: "asesora@oaa.es",
      emailVerified: true,
      getIdToken: vi.fn(() => new Promise<string>(() => {})),
      getIdTokenResult: vi.fn(async () => ({ claims: { email_verified: false } }))
    };
    await montar(".auth-loading");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(host?.querySelector('[role="status"]')?.textContent).toBe("Comprobando sesión…");
    expect(textosQueEntraronEnUnaRegion()).toContain("Comprobando sesión…");
  });

  test("en el acceso la región del aviso está montada y vacía antes de que haya aviso", async () => {
    await montar("h1");
    expect(host?.querySelector("h1")?.textContent).toBe("Acceso de asesor");
    const region = host?.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe("");
    expect(region?.className).toBe("auth-vivo");
  });

  test("al verificar el correo, el aviso cambia el texto de una región que ya estaba", async () => {
    authState.initialUser = {
      uid: "asesora",
      email: "asesora@oaa.es",
      emailVerified: false,
      getIdToken: vi.fn(async () => "token"),
      getIdTokenResult: vi.fn(async () => ({ claims: { email_verified: true } }))
    };
    await montar("h1");
    const antes = host?.querySelector('[role="status"]');
    expect(antes?.textContent).toBe("");

    await act(async () => { boton("Enviar enlace de verificación").click(); });
    const despues = host?.querySelector('[role="status"]');
    expect(despues).toBe(antes);
    expect(despues?.querySelector(".auth-success")?.textContent).toContain("Enlace enviado a asesora@oaa.es");
    expect(textosQueEntraronEnUnaRegion().some((texto) => texto.includes("Enlace enviado"))).toBe(true);
  });
});
