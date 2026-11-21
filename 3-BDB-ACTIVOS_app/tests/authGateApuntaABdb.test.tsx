// @vitest-environment happy-dom

/**
 * La aplicación no arranca si está configurada contra la base de datos de BDB.
 *
 * La regla que no se rompe en este clon es que nunca se toca BDB, y el 02-11-2026 se vio lo
 * fácil que es equivocarse: al pedir la configuración web del proyecto nuevo llegó la de BDB
 * —la misma, exactamente, que `.env.local.bdb-original`—. Cableada, la aplicación habría
 * leído, y con una sesión de administrador escrito, la base de datos de producción de BDB.
 *
 * Nadie se equivoca a propósito: se equivoca copiando el bloque de la pestaña que tenía
 * abierta. Así que esto lo comprueba el código, y no se queda en una advertencia escrita.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

vi.mock("../src/firebaseEnv", () => ({
  FIREBASE_CONFIGURED: false,
  PRODUCCION_SIN_CONFIGURAR: false,
  APUNTA_A_BDB: true,
  firebaseConfig: { projectId: "bbdd-activos-financieros" },
  FUNCTIONS_REGION: "europe-west1"
}));
vi.mock("../src/firebase", () => ({ auth: null, functions: null, appCheckReady: Promise.resolve() }));

const { AuthGate } = await import("../src/auth/AuthGate");

test("apuntando a BDB, el porton no deja pasar ni en desarrollo", async () => {
  const anfitrion = document.createElement("div");
  document.body.appendChild(anfitrion);
  const raiz = createRoot(anfitrion);

  await act(async () => {
    raiz.render(createElement(AuthGate, null, createElement("div", null, "LA APLICACION")));
  });

  const texto = anfitrion.textContent ?? "";
  expect(texto).not.toContain("LA APLICACION");
  expect(texto).toContain("base de datos de BDB");
  expect(anfitrion.querySelector('[role="alert"]')).not.toBeNull();

  await act(async () => raiz.unmount());
  anfitrion.remove();
});
