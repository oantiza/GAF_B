// @vitest-environment happy-dom

/**
 * La identidad del asesor en los informes, escrita una sola vez: en este navegador y por cuenta, empezando con el nombre
 * visible de la cuenta, y su diálogo «Tus datos en los informes».
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const cuenta = vi.hoisted(() => ({
  auth: { currentUser: null as { uid?: string; displayName: string | null } | null },
  firestore: null,
  functions: null,
  appCheckReady: Promise.resolve()
}));
vi.mock("../src/firebase", () => cuenta);

import { DatosDelAsesorDialog } from "../src/components/DatosDelAsesorDialog";
import {
  faltaElNombre,
  guardarIdentidad,
  leerIdentidad,
  problemaDelLogotipo,
  useIdentidadDelAsesor
} from "../src/core/identidadDelAsesor";
import { clearSessionCaches } from "../src/core/sessionCaches";

/** Un navegador que no deja guardar (modo privado, cuota): todo acceso a `localStorage` lanza. */
function navegadorSinGuardar() {
  const lanza = () => {
    throw new DOMException("Cuota llena", "QuotaExceededError");
  };
  vi.stubGlobal("localStorage", { getItem: lanza, setItem: lanza, removeItem: lanza, clear: lanza, key: lanza, length: 0 });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  cuenta.auth.currentUser = { uid: "cuenta-1", displayName: "Ana Pérez Gil" };
  clearSessionCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("leer y guardar la identidad", () => {
  test("sin nada guardado, es el nombre de la cuenta, sin espacios; sin nombre en la cuenta, vacía", () => {
    cuenta.auth.currentUser = { uid: "cuenta-1", displayName: "  Ana Pérez Gil " };
    expect(leerIdentidad()).toEqual({ nombre: "Ana Pérez Gil" });
    expect(faltaElNombre(leerIdentidad())).toBe(false);
    cuenta.auth.currentUser = { uid: "cuenta-1", displayName: null };
    expect(leerIdentidad()).toEqual({});
    expect(faltaElNombre(leerIdentidad())).toBe(true);
  });

  test("se guarda y se vuelve a leer, en este navegador: recortando espacios y sin lo vacío", () => {
    const resultado = guardarIdentidad({ nombre: "  Marta López ", entidad: "   ", contacto: " marta@ejemplo.es", logotipo: "" });
    expect(resultado).toEqual({ identidad: { nombre: "Marta López", contacto: "marta@ejemplo.es" }, persistida: true });
    clearSessionCaches();
    expect(leerIdentidad()).toEqual({ nombre: "Marta López", contacto: "marta@ejemplo.es" });
    expect(JSON.parse(localStorage.getItem("gestor-activos:identidad-del-asesor:cuenta-1") ?? "null")).toEqual({
      nombre: "Marta López",
      contacto: "marta@ejemplo.es"
    });
  });

  test("borrar el nombre a propósito se respeta: no vuelve el de la cuenta", () => {
    guardarIdentidad({ nombre: "", entidad: "Despacho Norte" });
    expect(leerIdentidad()).toEqual({ entidad: "Despacho Norte" });
  });

  test("otra cuenta en el mismo navegador no ve la identidad de la primera", () => {
    guardarIdentidad({ nombre: "Marta López", entidad: "Despacho Norte" });
    clearSessionCaches();
    cuenta.auth.currentUser = { uid: "cuenta-2", displayName: "Luis Gómez" };
    expect(leerIdentidad()).toEqual({ nombre: "Luis Gómez" });
    clearSessionCaches();
    cuenta.auth.currentUser = { uid: "cuenta-1", displayName: "Ana Pérez Gil" };
    expect(leerIdentidad()).toEqual({ nombre: "Marta López", entidad: "Despacho Norte" });
  });

  test("si el navegador no deja guardar, vale en memoria y lo dice; con otra cuenta, no", () => {
    navegadorSinGuardar();
    const resultado = guardarIdentidad({ nombre: "Marta López" });
    expect(resultado.persistida).toBe(false);
    expect(resultado.identidad).toEqual({ nombre: "Marta López" });
    expect(leerIdentidad()).toEqual({ nombre: "Marta López" });
    clearSessionCaches();
    cuenta.auth.currentUser = { uid: "cuenta-2", displayName: null };
    expect(leerIdentidad()).toEqual({});
  });

  test("el logotipo: PNG o JPEG, de 300 KB como máximo", () => {
    expect(problemaDelLogotipo({ type: "image/png", size: 300 * 1024 })).toBeNull();
    expect(problemaDelLogotipo({ type: "image/jpeg", size: 1 })).toBeNull();
    expect(problemaDelLogotipo({ type: "image/gif", size: 1 })).toBe("El logotipo tiene que ser una imagen PNG o JPEG.");
    expect(problemaDelLogotipo({ type: "image/png", size: 300 * 1024 + 1 })).toBe(
      "El logotipo ocupa 301 KB y el máximo es 300 KB. Redúcelo o guárdalo como JPEG."
    );
  });
});

describe("el gancho", () => {
  let root: Root;
  let host: HTMLDivElement;
  let visto: ReturnType<typeof useIdentidadDelAsesor>;
  function Lector() {
    visto = useIdentidadDelAsesor();
    return null;
  }

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Lector />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  test("se entera de lo que se guarda aquí, en otra pestaña y al cambiar de cuenta", async () => {
    expect(visto.identidad).toEqual({ nombre: "Ana Pérez Gil" });
    await act(async () => void visto.guardar({ nombre: "Marta López" }));
    expect(visto.identidad).toEqual({ nombre: "Marta López" });

    localStorage.setItem("gestor-activos:identidad-del-asesor:cuenta-1", JSON.stringify({ nombre: "Desde otra pestaña" }));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "gestor-activos:identidad-del-asesor:cuenta-1" }));
    });
    expect(visto.identidad).toEqual({ nombre: "Desde otra pestaña" });

    cuenta.auth.currentUser = { uid: "cuenta-2", displayName: "Luis Gómez" };
    await act(async () => clearSessionCaches());
    expect(visto.identidad).toEqual({ nombre: "Luis Gómez" });
  });
});

describe("el diálogo «Tus datos en los informes»", () => {
  let root: Root;
  let host: HTMLDivElement;
  const alCerrar = vi.fn();
  const alGuardar = vi.fn();

  const montar = async (abierto = true) => {
    await act(async () => root.render(<DatosDelAsesorDialog abierto={abierto} alCerrar={alCerrar} alGuardar={alGuardar} />));
  };
  const dialogo = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
  const porRotulo = (rotulo: string) =>
    [...document.querySelectorAll("label")].find((label) => label.textContent?.startsWith(rotulo)) as HTMLLabelElement;
  const campoDe = (rotulo: string) => {
    const label = porRotulo(rotulo);
    return (label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector("input")) as HTMLInputElement;
  };
  const boton = (texto: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === texto) as HTMLButtonElement;
  const escribir = (campo: HTMLInputElement, texto: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const elegir = (fichero: File) =>
    act(async () => {
      const campo = campoDe("Logotipo");
      Object.defineProperty(campo, "files", { configurable: true, value: [fichero] });
      campo.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((listo) => setTimeout(listo, 0));
    });

  beforeEach(() => {
    alCerrar.mockClear();
    alGuardar.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  test("cerrado no pinta nada; abierto, el título, para qué sirve y los cuatro campos con su nombre", async () => {
    await montar(false);
    expect(dialogo()).toBeNull();
    await montar();
    const elDialogo = dialogo()!;
    const titulo = document.getElementById(elDialogo.getAttribute("aria-labelledby")!);
    expect(titulo?.textContent).toBe("Tus datos en los informes");
    expect(elDialogo.textContent).toContain("Salen en la cabecera de todos los informes que descargas. Se guardan en este navegador.");
    for (const rotulo of ["Nombre", "Entidad o despacho", "Contacto", "Logotipo"]) {
      expect(campoDe(rotulo), rotulo).toBeInstanceOf(HTMLInputElement);
    }
    expect(campoDe("Logotipo").type).toBe("file");
    expect(campoDe("Nombre").value).toBe("Ana Pérez Gil");
    const ayuda = document.getElementById(campoDe("Contacto").getAttribute("aria-describedby")!);
    expect(ayuda?.textContent).toBe("Un teléfono o un correo.");
  });

  test("«Guardar» guarda, sin espacios de más, avisa a quien lo abrió y cierra", async () => {
    await montar();
    await escribir(campoDe("Nombre"), "  Marta López ");
    await escribir(campoDe("Entidad o despacho"), "Despacho Norte");
    await escribir(campoDe("Contacto"), "600 000 000");
    await act(async () => boton("Guardar").click());
    const esperada = { nombre: "Marta López", entidad: "Despacho Norte", contacto: "600 000 000" };
    expect(leerIdentidad()).toEqual(esperada);
    expect(alGuardar).toHaveBeenCalledWith(esperada, true);
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  test("«Cancelar» no guarda", async () => {
    await montar();
    await escribir(campoDe("Nombre"), "Otro nombre");
    await act(async () => boton("Cancelar").click());
    expect(leerIdentidad()).toEqual({ nombre: "Ana Pérez Gil" });
    expect(alGuardar).not.toHaveBeenCalled();
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  test("Escape cierra sin guardar", async () => {
    await montar();
    await escribir(campoDe("Nombre"), "Otro nombre");
    await act(async () => {
      dialogo()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(alCerrar).toHaveBeenCalled();
    expect(leerIdentidad()).toEqual({ nombre: "Ana Pérez Gil" });
  });

  test("un logotipo que no es PNG ni JPEG, o de más de 300 KB, se rechaza con su mensaje junto al campo", async () => {
    await montar();
    await elegir(new File(["GIF89a"], "logo.gif", { type: "image/gif" }));
    const descripcion = () => document.getElementById(campoDe("Logotipo").getAttribute("aria-describedby")!)?.textContent ?? "";
    expect(descripcion()).toContain("El logotipo tiene que ser una imagen PNG o JPEG.");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("El logotipo tiene que ser una imagen PNG o JPEG.");

    await elegir(new File([new Uint8Array(300 * 1024 + 1)], "logo.png", { type: "image/png" }));
    expect(descripcion()).toContain("El logotipo ocupa 301 KB y el máximo es 300 KB.");
    expect(document.querySelector("img")).toBeNull();
    await act(async () => boton("Guardar").click());
    expect(leerIdentidad().logotipo).toBeUndefined();
  });

  test("un logotipo válido se ve antes de guardar, se guarda como data URL y se puede quitar", async () => {
    await montar();
    await elegir(new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" }));
    const imagen = document.querySelector("img") as HTMLImageElement;
    expect(imagen.alt).toBe("Vista previa del logotipo");
    expect(imagen.getAttribute("src")).toBe("data:image/png;base64,iVBORw==");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => boton("Guardar").click());
    expect(leerIdentidad().logotipo).toBe("data:image/png;base64,iVBORw==");

    await montar(false);
    await montar();
    expect((document.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe("data:image/png;base64,iVBORw==");
    await act(async () => boton("Quitar").click());
    expect(document.querySelector("img")).toBeNull();
    await act(async () => boton("Guardar").click());
    expect(leerIdentidad().logotipo).toBeUndefined();
  });

  test("si el navegador no deja guardar, el diálogo lo dice y no se cierra solo", async () => {
    navegadorSinGuardar();
    await montar();
    await act(async () => boton("Guardar").click());
    expect(alGuardar).toHaveBeenCalledWith({ nombre: "Ana Pérez Gil" }, false);
    expect(alCerrar).not.toHaveBeenCalled();
    expect(dialogo()?.textContent).toContain("Este navegador no deja guardar tus datos.");
    await act(async () => boton("Cerrar").click());
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });
});
