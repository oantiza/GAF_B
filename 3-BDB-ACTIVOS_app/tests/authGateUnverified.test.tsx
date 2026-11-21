// @vitest-environment happy-dom

/**
 * MEDIA-07 (auditoría 16-10-2026): una cuenta con el correo sin verificar
 * entraba en la aplicación y todo fallaba después, porque el backend rechaza
 * sus callables (BDB_REQUIRE_EMAIL_VERIFIED). Ahora la puerta de acceso lo
 * dice antes, con «Enviar enlace» y «Ya lo he verificado», y no monta la app.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type AuthCallback = (user: unknown) => void;
const authState = vi.hoisted(() => ({
  callback: null as AuthCallback | null,
  initialUser: null as unknown,
  signOut: vi.fn(),
  sendEmailVerification: vi.fn(),
  reload: vi.fn()
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
  signOut: (...args: unknown[]) => {
    authState.signOut(...args);
    authState.callback?.(null);
    return Promise.resolve();
  },
  sendEmailVerification: (...args: unknown[]) => authState.sendEmailVerification(...args),
  reload: (...args: unknown[]) => authState.reload(...args),
  multiFactor: () => ({ enrolledFactors: [] }),
  TotpMultiFactorGenerator: { assertionForSignIn: vi.fn(), FACTOR_ID: "totp" },
  getMultiFactorResolver: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: class {}
}));

import { AuthGate } from "../src/auth/AuthGate";

interface FakeUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  getIdToken: ReturnType<typeof vi.fn>;
  getIdTokenResult: ReturnType<typeof vi.fn>;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let user: FakeUser;

function button(text: string): HTMLButtonElement {
  const found = [...(host?.querySelectorAll("button") ?? [])].find((b) => (b.textContent || "").trim() === text);
  if (!found) throw new Error(`No aparece el botón «${text}»`);
  return found as HTMLButtonElement;
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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  user = {
    uid: "asesora",
    email: "asesora@oaa.es",
    emailVerified: false,
    getIdToken: vi.fn(async () => "token"),
    getIdTokenResult: vi.fn(async () => ({ claims: { email_verified: true } }))
  };
  authState.initialUser = user;
  authState.signOut.mockReset();
  authState.sendEmailVerification.mockReset().mockResolvedValue(undefined);
  authState.reload.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

describe("AuthGate con el correo sin verificar", () => {
  test("enseña la pantalla de verificación y no monta la aplicación", async () => {
    await mountGate();
    expect(host?.querySelector("h1")?.textContent).toBe("Verifica tu correo electrónico");
    expect(host?.textContent).toContain("asesora@oaa.es");
    expect(host?.querySelector("#app")).toBeNull();
  });

  test("«Enviar enlace» manda la verificación al usuario de la sesión", async () => {
    await mountGate();
    await act(async () => { button("Enviar enlace de verificación").click(); });
    expect(authState.sendEmailVerification).toHaveBeenCalledWith(user);
    expect(host?.querySelector('[role="status"]')?.textContent).toContain("Enlace enviado a asesora@oaa.es");
  });

  test("«Ya lo he verificado» recarga la cuenta y, si ya consta, monta la aplicación", async () => {
    await mountGate();
    // Primera comprobación: todavía sin verificar.
    await act(async () => { button("Ya lo he verificado").click(); });
    expect(authState.reload).toHaveBeenCalledWith(user);
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(host?.querySelector("#app")).toBeNull();
    expect(host?.querySelector('[role="status"]')?.textContent).toContain("todavía no consta");

    // El usuario abre el enlace: la recarga trae emailVerified = true.
    authState.reload.mockImplementation(async (target: FakeUser) => { target.emailVerified = true; });
    await act(async () => { button("Ya lo he verificado").click(); });
    expect(host?.querySelector("#app")?.textContent).toBe("Aplicación");
  });

  test("«Cerrar sesión» sale de la cuenta", async () => {
    await mountGate();
    await act(async () => { button("Cerrar sesión").click(); });
    expect(authState.signOut).toHaveBeenCalledTimes(1);
    expect(host?.querySelector("h1")?.textContent).toBe("Acceso de asesor");
  });

  test("una cuenta verificada entra directamente", async () => {
    user.emailVerified = true;
    await mountGate();
    expect(host?.querySelector("#app")?.textContent).toBe("Aplicación");
    // El token ya dice email_verified: no se pide otro.
    expect(user.getIdToken).not.toHaveBeenCalled();
  });

  /* R-05: verificada por enlace en otra pestaña y recargada la app con F5. El
     SDK recarga el usuario (emailVerified = true) pero el token cacheado sigue
     diciendo email_verified: false, y el backend mira el token. */
  test("con el usuario verificado y el token desfasado, pide un token nuevo antes de entrar", async () => {
    user.emailVerified = true;
    let resolveToken!: (value: string) => void;
    user.getIdTokenResult.mockResolvedValue({ claims: { email_verified: false } });
    user.getIdToken.mockImplementation(() => new Promise<string>((resolve) => { resolveToken = resolve; }));
    await mountGate();

    expect(user.getIdToken).toHaveBeenCalledWith(true);
    // Mientras llega el token nuevo, la app no se monta.
    expect(host?.querySelector("#app")).toBeNull();
    await act(async () => { resolveToken("token-nuevo"); });
    expect(host?.querySelector("#app")?.textContent).toBe("Aplicación");
  });

  /* N-08 (revisión del 17-10-2026): la guarda de generación. Con la
     comprobación del token en vuelo, se cierra la sesión (otra pestaña); la
     respuesta tardía no puede volver a montar la app con el usuario anterior. */
  test("una comprobación de token en vuelo no reabre la app tras cerrar la sesión", async () => {
    user.emailVerified = true;
    let resolveToken!: (value: string) => void;
    user.getIdTokenResult.mockResolvedValue({ claims: { email_verified: false } });
    user.getIdToken.mockImplementation(() => new Promise<string>((resolve) => { resolveToken = resolve; }));
    await mountGate();
    expect(user.getIdToken).toHaveBeenCalledWith(true);

    await act(async () => { authState.callback?.(null); });
    expect(host?.querySelector("h1")?.textContent).toBe("Acceso de asesor");

    await act(async () => { resolveToken("token-tardio"); });
    expect(host?.querySelector("#app")).toBeNull();
    expect(host?.querySelector("h1")?.textContent).toBe("Acceso de asesor");
  });
});
