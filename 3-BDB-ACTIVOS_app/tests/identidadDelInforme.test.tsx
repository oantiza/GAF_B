// @vitest-environment happy-dom

/**
 * Las dos puertas del informe de cliente, Informes y Análisis, firman igual. Reproducido en la revisión: se escribía
 * el responsable en Informes, se abría el informe en Análisis, y salía el nombre por defecto.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
/* INF-01: el responsable por defecto es el nombre visible de la cuenta con la que se ha entrado, nunca uno escrito en el código. */
const cuenta = vi.hoisted(() => ({
  auth: { currentUser: null as { uid?: string; displayName: string | null } | null },
  firestore: null,
  functions: null,
  appCheckReady: Promise.resolve()
}));
vi.mock("../src/firebase", () => cuenta);

import { olvidarTrabajoDeCartera } from "../src/core/disenoEnSesion";
import { guardarIdentidad, leerIdentidad } from "../src/core/identidadDelAsesor";
import { clienteDeLaCartera, useIdentidadDelInforme, useResponsableDelInforme } from "../src/core/identidadDelInforme";
import { clearSessionCaches } from "../src/core/sessionCaches";

let root: Root;
let host: HTMLDivElement;
let identidad: ReturnType<typeof useIdentidadDelInforme>;

function Puerta({ huella }: { huella: string }) {
  const suya = useIdentidadDelInforme(huella);
  useEffect(() => {
    identidad = suya;
  }, [suya]);
  return null;
}

const montar = async (huella: string) => {
  await act(async () => {
    root.render(createElement(Puerta, { huella }));
  });
};

const salirYVolver = async (huella: string) => {
  await act(async () => root.unmount());
  root = createRoot(host);
  await montar(huella);
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cuenta.auth.currentUser = null;
  localStorage.clear();
  clearSessionCaches();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("el responsable, también en lo que no lleva cartera (decisión A-64)", () => {
  let responsable: ReturnType<typeof useResponsableDelInforme>;
  function SoloElResponsable() {
    const suyo = useResponsableDelInforme();
    useEffect(() => {
      responsable = suyo;
    }, [suyo]);
    return null;
  }

  test("el Seguimiento lee y escribe el mismo responsable que Informes, y no toca al cliente de la cartera", async () => {
    await montar("A");
    await act(async () => {
      identidad.setBankerName("Marta López");
      identidad.setClientName("Ana Ruiz");
    });
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(SoloElResponsable)));
    expect(responsable.bankerName).toBe("Marta López");
    await act(async () => responsable.setBankerEmail("marta@ejemplo.es"));
    await salirYVolver("A");
    expect(identidad.bankerName).toBe("Marta López");
    expect(identidad.bankerEmail).toBe("marta@ejemplo.es");
    expect(identidad.clientName).toBe("Ana Ruiz");
    expect(clienteDeLaCartera("A")).toBe("Ana Ruiz");
  });
});

describe("quién firma y para quién", () => {
  test("empieza con el nombre de la cuenta con la que se ha entrado, sin correo y sin cliente", async () => {
    cuenta.auth.currentUser = { displayName: "  Ana Pérez Gil " };
    await montar("A");
    expect(identidad.bankerName).toBe("Ana Pérez Gil");
    expect(identidad.bankerEmail).toBe("");
    expect(identidad.clientName).toBe("");
  });

  test("si la cuenta no tiene nombre, el responsable empieza vacío: ningún nombre escrito en el código", async () => {
    cuenta.auth.currentUser = { displayName: null };
    await montar("A");
    expect(identidad.bankerName).toBe("");
    await act(async () => root.unmount());
    clearSessionCaches();
    cuenta.auth.currentUser = null;
    root = createRoot(host);
    await montar("A");
    expect(identidad.bankerName).toBe("");
  });

  test("el responsable por defecto no está escrito en el código: ni el informe, ni las propuestas, ni el seguimiento", async () => {
    const { readFileSync } = await import("node:fs");
    for (const fichero of ["src/core/reportBanker.ts", "src/core/identidadDelInforme.ts"]) {
      expect(readFileSync(fichero, "utf8"), fichero).not.toMatch(/Antiza|name:\s*"[^"]+"/);
    }
    const { DEFAULT_BANKER, resolveBanker } = await import("../src/core/reportBanker");
    expect(DEFAULT_BANKER.name).toBe("");
    expect(resolveBanker().name).toBe("");
  });

  /* Sigue siendo verdad con la identidad en el navegador: otra cuenta, otra identidad, aunque la primera la escribiera. */
  test("al cambiar de cuenta, empieza con el nombre de la nueva, aunque la anterior escribiera el suyo", async () => {
    cuenta.auth.currentUser = { uid: "cuenta-1", displayName: "Ana Pérez Gil" };
    await montar("A");
    expect(identidad.bankerName).toBe("Ana Pérez Gil");
    await act(async () => identidad.setBankerEmail("ana@ejemplo.es"));
    await act(async () => root.unmount());
    clearSessionCaches();
    cuenta.auth.currentUser = { uid: "cuenta-2", displayName: "Luis Gómez" };
    root = createRoot(host);
    await montar("A");
    expect(identidad.bankerName).toBe("Luis Gómez");
    expect(identidad.bankerEmail).toBe("");
  });

  /* Cambia a propósito (paso de la identidad del asesor): antes el responsable duraba la sesión; ahora es la identidad del
   * asesor y se queda en este navegador para la próxima vez, con la misma cuenta. */
  test("el responsable se queda en este navegador: al volver a entrar con la misma cuenta, sigue", async () => {
    cuenta.auth.currentUser = { uid: "cuenta-1", displayName: "Ana Pérez Gil" };
    await montar("A");
    await act(async () => {
      identidad.setBankerName("  Marta López ");
      identidad.setBankerEmail("marta@ejemplo.es");
    });
    expect(identidad.bankerName).toBe("  Marta López ");
    await act(async () => root.unmount());
    clearSessionCaches();
    root = createRoot(host);
    await montar("A");
    expect(identidad.bankerName).toBe("Marta López");
    expect(identidad.bankerEmail).toBe("marta@ejemplo.es");
    expect(leerIdentidad()).toEqual({ nombre: "Marta López", contacto: "marta@ejemplo.es" });
  });

  test("lo escrito en «Tus datos en los informes» aparece en el diálogo abierto, sin perder la entidad ni el logotipo", async () => {
    cuenta.auth.currentUser = { uid: "cuenta-1", displayName: "Ana Pérez Gil" };
    await montar("A");
    await act(async () => void guardarIdentidad({ nombre: "Marta López", entidad: "Despacho Norte", contacto: "600 000 000", logotipo: "data:image/png;base64,iVBORw==" }));
    expect(identidad.bankerName).toBe("Marta López");
    expect(identidad.bankerEmail).toBe("600 000 000");
    await act(async () => identidad.setBankerName("Marta López Ruiz"));
    expect(leerIdentidad()).toEqual({ nombre: "Marta López Ruiz", entidad: "Despacho Norte", contacto: "600 000 000", logotipo: "data:image/png;base64,iVBORw==" });
  });

  test("lo escrito en una puerta está en la otra", async () => {
    await montar("A");
    await act(async () => {
      identidad.setBankerName("Responsable de prueba");
      identidad.setBankerEmail("responsable@prueba.test");
      identidad.setClientName("Cliente de prueba");
    });
    await salirYVolver("A");
    expect(identidad.bankerName).toBe("Responsable de prueba");
    expect(identidad.bankerEmail).toBe("responsable@prueba.test");
    expect(identidad.clientName).toBe("Cliente de prueba");
  });

  test("el cliente de la cartera se lee solo con su misma composición, y sin espacios", async () => {
    expect(clienteDeLaCartera("A")).toBe("");
    await montar("A");
    await act(async () => identidad.setClientName("  Cliente de prueba "));
    expect(clienteDeLaCartera("A")).toBe("Cliente de prueba");
    expect(clienteDeLaCartera("B")).toBe("");
  });

  test("el nombre del cliente no pasa a otra composición, ni con la pantalla montada", async () => {
    await montar("A");
    await act(async () => identidad.setClientName("Cliente de prueba"));
    await montar("B");
    expect(identidad.clientName).toBe("");
    await act(async () => identidad.setClientName("Otro"));
    await salirYVolver("A");
    expect(identidad.clientName).toBe("");
  });

  test("al sustituir la cartera, el cliente se olvida y el responsable no: es el asesor", async () => {
    await montar("A");
    await act(async () => {
      identidad.setBankerName("Responsable de prueba");
      identidad.setClientName("Cliente de prueba");
    });
    await act(async () => root.unmount());
    olvidarTrabajoDeCartera();
    root = createRoot(host);
    await montar("A");
    expect(identidad.clientName).toBe("");
    expect(identidad.bankerName).toBe("Responsable de prueba");
  });
});
