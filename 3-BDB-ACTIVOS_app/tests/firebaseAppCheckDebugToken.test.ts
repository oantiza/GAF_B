// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/* S-03 (auditoría 29-09): `src/firebase.ts` horneaba VITE_FIREBASE_APPCHECK_DEBUG_TOKEN
   en el bundle y lo asignaba a window.FIREBASE_APPCHECK_DEBUG_TOKEN sin
   condicionarlo al modo de desarrollo: un token de depuración de App Check en
   producción es una puerta abierta. Solo se asigna con import.meta.env.DEV. */

vi.mock("firebase/app", () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock("firebase/app-check", () => ({
  initializeAppCheck: vi.fn(() => ({})),
  getToken: vi.fn(async () => ({ token: "t" })),
  ReCaptchaEnterpriseProvider: class {},
  ReCaptchaV3Provider: class {}
}));
vi.mock("firebase/auth", () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn() }));
vi.mock("firebase/firestore", () => ({ getFirestore: vi.fn(() => ({})), connectFirestoreEmulator: vi.fn() }));
vi.mock("firebase/functions", () => ({ getFunctions: vi.fn(() => ({})), connectFunctionsEmulator: vi.fn() }));

async function loadFirebaseWith(dev: boolean) {
  vi.resetModules();
  // App Check se salta cuando el clon apunta a emuladores; esta suite prueba
  // el camino con App Check activo, asi que fija la bandera en vez de
  // heredarla del .env.local.
  vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "false");
  vi.stubEnv("VITE_FIREBASE_API_KEY", "api-key");
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "proyecto");
  vi.stubEnv("VITE_FIREBASE_APPCHECK_SITE_KEY", "site-key");
  vi.stubEnv("VITE_FIREBASE_APPCHECK_DISABLED", "false");
  vi.stubEnv("VITE_FIREBASE_APPCHECK_DEBUG_TOKEN", "debug-token-secreto");
  vi.stubEnv("DEV", dev);
  vi.stubEnv("PROD", !dev);
  await import("../src/firebase");
}

beforeEach(() => {
  delete window.FIREBASE_APPCHECK_DEBUG_TOKEN;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.FIREBASE_APPCHECK_DEBUG_TOKEN;
});

describe("token de depuración de App Check", () => {
  test("en producción no se asigna a window aunque la variable exista", async () => {
    await loadFirebaseWith(false);
    expect(window.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });

  test("en desarrollo sí se asigna", async () => {
    await loadFirebaseWith(true);
    expect(window.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe("debug-token-secreto");
  });
});
