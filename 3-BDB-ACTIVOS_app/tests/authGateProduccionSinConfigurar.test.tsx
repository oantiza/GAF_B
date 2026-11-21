// @vitest-environment happy-dom

/**
 * Una build de PRODUCCIÓN sin backend configurado no abre la aplicación.
 *
 * El portón deja pasar cuando no hay configuración de Firebase, y hace bien: en local la
 * aplicación funciona contra el backend de demostración y pedir una sesión que no existe no
 * protegería nada. Pero lo mismo en una build servida en internet es la aplicación entera
 * ABIERTA, sin autenticación, con nombres de clientes dentro.
 *
 * Y no era hipotético. Medido el 02-11-2026: `.env.production` no fija
 * `VITE_FIREBASE_PROJECT_ID`, así que una build de producción hecha ese día arrancaba con
 * `FIREBASE_CONFIGURED` en false y se quedaba en modo local sin decirlo. La única razón por la
 * que no había pasado nada es que nunca se ha desplegado.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

vi.mock("../src/firebaseEnv", () => ({
  FIREBASE_CONFIGURED: false,
  PRODUCCION_SIN_CONFIGURAR: true,
  APUNTA_A_BDB: false,
  firebaseConfig: {},
  FUNCTIONS_REGION: "europe-west1"
}));
vi.mock("../src/firebase", () => ({ auth: null, functions: null, appCheckReady: Promise.resolve() }));

const { AuthGate } = await import("../src/auth/AuthGate");

test("en produccion sin configurar, el porton NO deja pasar", async () => {
  const anfitrion = document.createElement("div");
  document.body.appendChild(anfitrion);
  const raiz = createRoot(anfitrion);

  await act(async () => {
    raiz.render(createElement(AuthGate, null, createElement("div", null, "LA APLICACION")));
  });

  const texto = anfitrion.textContent ?? "";
  expect(texto).not.toContain("LA APLICACION");
  expect(texto).toContain("no tiene servidor configurado");
  /* Y lo dice como una alerta, no como un aviso que se pueda cerrar. */
  expect(anfitrion.querySelector('[role="alert"]')).not.toBeNull();

  await act(async () => raiz.unmount());
  anfitrion.remove();
});
