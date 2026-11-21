// @vitest-environment happy-dom
/**
 * Auditoría integral del 16-11-2026, hallazgo GES-13; decisión de Óscar del 17-11-2026: «recordar la carpeta por usuario».
 * La carpeta de carteras sobrevive al cierre de sesión, pero se guarda con quién la eligió y solo se le ofrece a esa persona.
 * La de antes de este cambio, sin dueño, no se ofrece a nadie y se olvida.
 *
 * IndexedDB no existe en el entorno de pruebas: se usa uno en memoria, escrito aquí, con lo justo que usa `acceso.ts`
 * (abrir la base, crear el almacén, y `get`, `put` y `delete` dentro de una transacción).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionContext, type AuthSessionContextValue } from "../../src/auth/AuthSessionContext";
import { CLAVE_SIN_DUENO, carpetaDelRegistro, carpetaRecordada, claveDeLaCarpeta, olvidarCarpeta, recordarCarpeta } from "../../src/gestor/almacen/acceso";
import { useAlmacen, type EstadoDelAlmacen } from "../../src/gestor/ui/estado/useAlmacen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Un IndexedDB en memoria: una base con un almacén de clave → valor. Las peticiones resuelven en la siguiente vuelta. */
function indexedDbEnMemoria(datos: Map<string, unknown>) {
  const peticion = <T,>(resultado: () => T) => {
    const p: { result?: T; onsuccess?: () => void } = {};
    p.result = resultado();
    return p;
  };
  const base = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: () => {
      const transaccion: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: () => unknown } = {
        objectStore: () => ({
          get: (clave: string) => peticion(() => datos.get(clave)),
          put: (valor: unknown, clave: string) => peticion(() => void datos.set(clave, valor)),
          delete: (clave: string) => peticion(() => void datos.delete(clave))
        })
      };
      setTimeout(() => transaccion.oncomplete?.(), 0);
      return transaccion;
    }
  };
  return {
    open: () => {
      const p: { result: typeof base; onsuccess?: () => void; onupgradeneeded?: () => void; onerror?: () => void; onblocked?: () => void } = { result: base };
      setTimeout(() => p.onsuccess?.(), 0);
      return p;
    }
  };
}

/** Una carpeta del sistema, falsa: con permiso concedido. */
const carpeta = (nombre: string) => ({ kind: "directory", name: nombre, queryPermission: async () => "granted" }) as unknown as FileSystemDirectoryHandle;

let datos: Map<string, unknown>;
beforeEach(() => {
  datos = new Map();
  vi.stubGlobal("indexedDB", indexedDbEnMemoria(datos));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GES-13 · la carpeta recordada es de quien la eligió", () => {
  it("Ana la elige, y solo Ana la vuelve a ver", async () => {
    const deAna = carpeta("Carteras de Ana");
    await recordarCarpeta(deAna, "ana");
    expect(datos.get(claveDeLaCarpeta("ana"))).toEqual({ dueno: "ana", carpeta: deAna });
    expect(await carpetaRecordada("ana")).toBe(deAna);
    expect(await carpetaRecordada("beto")).toBeUndefined();
  });

  it("cada uno tiene la suya, y olvidar la de uno no toca la del otro", async () => {
    const deAna = carpeta("Carteras de Ana");
    const deBeto = carpeta("Carteras de Beto");
    await recordarCarpeta(deAna, "ana");
    await recordarCarpeta(deBeto, "beto");
    expect(await carpetaRecordada("ana")).toBe(deAna);
    expect(await carpetaRecordada("beto")).toBe(deBeto);
    await olvidarCarpeta("ana");
    expect(await carpetaRecordada("ana")).toBeUndefined();
    expect(await carpetaRecordada("beto")).toBe(deBeto);
  });

  it("la de antes de este cambio, sin dueño, no se ofrece a nadie y se olvida", async () => {
    datos.set(CLAVE_SIN_DUENO, carpeta("Carteras"));
    expect(await carpetaRecordada("ana")).toBeUndefined();
    expect(datos.has(CLAVE_SIN_DUENO)).toBe(false);
  });

  it("sin sesión no hay a quién ofrecérsela: no se guarda, no se ofrece, y la sin dueño también se olvida", async () => {
    await recordarCarpeta(carpeta("Carteras"), undefined);
    expect(datos.size).toBe(0);
    datos.set(CLAVE_SIN_DUENO, carpeta("Carteras"));
    expect(await carpetaRecordada(undefined)).toBeUndefined();
    expect(datos.has(CLAVE_SIN_DUENO)).toBe(false);
  });

  it("un registro con otro dueño, o que no es una carpeta, no se da por bueno", () => {
    const deAna = carpeta("Carteras de Ana");
    expect(carpetaDelRegistro({ dueno: "ana", carpeta: deAna }, "ana")).toBe(deAna);
    expect(carpetaDelRegistro({ dueno: "ana", carpeta: deAna }, "beto")).toBeUndefined();
    expect(carpetaDelRegistro({ dueno: "ana", carpeta: { kind: "file" } }, "ana")).toBeUndefined();
    expect(carpetaDelRegistro(deAna, "ana")).toBeUndefined();
  });
});

describe("GES-13 · la pantalla abre la carpeta del usuario de la sesión, y la de nadie más", () => {
  let host: HTMLDivElement;
  let root: Root | undefined;
  let visto: EstadoDelAlmacen | undefined;

  function Sonda() {
    visto = useAlmacen().estado;
    return null;
  }
  const sesion = (uid: string): AuthSessionContextValue => ({ uid, email: `${uid}@ejemplo.test`, emailVerified: true, mfaEnrolled: true, openSecurity: () => undefined, signOut: () => undefined });

  async function entrar(uid: string) {
    visto = undefined;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(AuthSessionContext.Provider, { value: sesion(uid) }, createElement(Sonda)));
    });
    const fase = (): string | undefined => (visto as EstadoDelAlmacen | undefined)?.fase;
    for (let i = 0; i < 50 && fase() === "comprobando"; i += 1) {
      await act(async () => {
        await new Promise((resolver) => setTimeout(resolver, 5));
      });
    }
  }

  beforeEach(() => {
    vi.stubGlobal("showDirectoryPicker", async () => carpeta("Carteras de Ana"));
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
  });

  it("Ana entra y tiene su carpeta lista; Beto, en el mismo navegador, tiene que elegir la suya", async () => {
    await recordarCarpeta(carpeta("Carteras de Ana"), "ana");
    await entrar("ana");
    expect(visto?.fase).toBe("lista");
    await act(async () => root?.unmount());
    host.remove();
    await entrar("beto");
    expect(visto?.fase).toBe("sin-carpeta");
  });

  it("con la carpeta de antes, sin dueño, nadie la ve: hay que volver a elegirla", async () => {
    datos.set(CLAVE_SIN_DUENO, carpeta("Carteras"));
    await entrar("ana");
    expect(visto?.fase).toBe("sin-carpeta");
    expect(datos.has(CLAVE_SIN_DUENO)).toBe(false);
  });
});
