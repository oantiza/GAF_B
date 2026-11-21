// @vitest-environment happy-dom
/**
 * Auditoría · arreglos medios y bajos de los formularios y del libro de movimientos: cómo se ha
 * leído una cifra ambigua (GES-22), cerrar sin perder lo hecho (GES-15), nombres propios de los
 * botones repetidos y errores asociados a su campo (GES-17) y la página del libro tras editar (GES-18).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { DialogoDeAjustes } from "../../src/gestor/ui/dialogos/DialogoDeAjustes";
import { FormularioDeMovimiento } from "../../src/gestor/ui/dialogos/FormularioDeMovimiento";
import type { CarteraAbierta } from "../../src/gestor/ui/estado/useCarteraAbierta";
import { lecturaDeUnaCifraAmbigua } from "../../src/gestor/ui/formato";
import { VistaMovimientos } from "../../src/gestor/ui/vistas/VistaMovimientos";
import { activo, cartera, mov } from "./ayudas";
import { datosDeVista } from "./vistaAnalisisDatos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOY = "2026-11-13";
let root: Root | undefined;
let vista: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vista?.remove();
  root = undefined;
  document.body.innerHTML = "";
});

async function montar(nodo: React.ReactNode) {
  vista = document.createElement("div");
  document.body.append(vista);
  root = createRoot(vista);
  await act(async () => root!.render(nodo));
}

function campo(rotulo: string): HTMLElement {
  const encontrado = [...document.body.querySelectorAll<HTMLElement>(".field")].find((label) => label.querySelector(".field__label")?.textContent?.startsWith(rotulo));
  if (!encontrado) throw new Error(`No hay un campo «${rotulo}»`);
  return encontrado;
}

async function escribir(rotulo: string, valor: string) {
  const input = campo(rotulo).querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const boton = (nombre: string) => [...document.body.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === nombre || b.textContent?.trim() === nombre);

async function pulsar(nombre: string) {
  const encontrado = boton(nombre);
  if (!encontrado) throw new Error(`No hay un botón «${nombre}»`);
  await act(async () => encontrado.click());
}

const FONDO = activo("F", "FONDO", "EUR", { nombre: "Fondo Prueba" });
const CARTERA = cartera([FONDO], [mov("aportacion", "2025-01-02", { importe: "100000" })]);
const SIN_PRECIOS = { precios: new Map(), cambios: new Map() };

function abiertaDe(c: Cartera, cambiar = vi.fn()): CarteraAbierta {
  return { ...datosDeVista(c, { datos: SIN_PRECIOS, fichas: new Map(), avisos: [] }, HOY).abierta, cambiar };
}

describe("GES-22 · el formulario enseña cómo ha leído una cifra ambigua", () => {
  it("las reglas: un punto solo, o una coma con tres cifras, se enseñan; lo que no es ambiguo, no", () => {
    expect(lecturaDeUnaCifraAmbigua("105.123")).toBe("Leído como 105.123,00."); // punto seguido de tres cifras: millares
    expect(lecturaDeUnaCifraAmbigua("12.5")).toBe("Leído como 12,5."); // cualquier otro punto: decimal
    expect(lecturaDeUnaCifraAmbigua("1,234")).toBe("Leído como 1,234."); // la coma es siempre decimal
    expect(lecturaDeUnaCifraAmbigua("1.234,56")).toBeUndefined();
    expect(lecturaDeUnaCifraAmbigua("12,5")).toBeUndefined();
    expect(lecturaDeUnaCifraAmbigua("abc")).toBeUndefined();
  });

  it("bajo el precio de un movimiento", async () => {
    await montar(<FormularioDeMovimiento alCerrar={() => undefined} alGuardar={() => undefined} cartera={CARTERA} hoy={HOY} inicial={{ tipo: "suscripcion", activoId: "F" }} precios={SIN_PRECIOS} />);
    const rotuloDelPrecio = [...document.body.querySelectorAll(".field__label")].map((r) => r.textContent ?? "").find((t) => /Precio|Valor liquidativo/.test(t))!;
    await escribir(rotuloDelPrecio, "105.123");
    expect(campo(rotuloDelPrecio).textContent).toContain("Leído como 105.123,00.");
  });

  it("bajo el precio a mano de los ajustes", async () => {
    await montar(<DialogoDeAjustes abierta={abiertaDe(CARTERA)} alCerrar={() => undefined} hoy={HOY} />);
    await escribir("Precio", "105.123");
    expect(campo("Precio").textContent).toContain("Leído como 105.123,00.");
  });
});

describe("GES-15 · cerrar no pierde lo hecho sin preguntar", () => {
  it("el formulario con algo escrito pregunta antes de cerrar con la X", async () => {
    const alCerrar = vi.fn();
    await montar(<FormularioDeMovimiento alCerrar={alCerrar} alGuardar={() => undefined} cartera={CARTERA} hoy={HOY} inicial={{ tipo: "aportacion" }} precios={SIN_PRECIOS} />);
    await escribir("Importe", "500");
    await pulsar("Cerrar");
    expect(alCerrar).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("¿Cerrar sin guardar el movimiento?");
  });

  it("el formulario sin tocar se cierra sin preguntar", async () => {
    const alCerrar = vi.fn();
    await montar(<FormularioDeMovimiento alCerrar={alCerrar} alGuardar={() => undefined} cartera={CARTERA} hoy={HOY} inicial={{ tipo: "aportacion" }} precios={SIN_PRECIOS} />);
    await pulsar("Cerrar");
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  it("los ajustes no descartan en silencio un precio tecleado y sin añadir", async () => {
    const cambiar = vi.fn();
    const alCerrar = vi.fn();
    await montar(<DialogoDeAjustes abierta={abiertaDe(CARTERA, cambiar)} alCerrar={alCerrar} hoy={HOY} />);
    await escribir("Precio", "12,5");
    await pulsar("Guardar los ajustes");
    expect(cambiar).not.toHaveBeenCalled();
    expect(alCerrar).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("sin añadirlo");
  });
});

describe("GES-17 · nombres propios y errores asociados", () => {
  it("cada «Editar» y «Eliminar» del libro dice de qué movimiento es", async () => {
    const c = cartera([FONDO], [mov("aportacion", "2025-01-02", { importe: "1000" }), mov("suscripcion", "2025-01-03", { activoId: "F", titulos: "10", precio: "100", importe: "-1000" })]);
    await montar(<VistaMovimientos datos={datosDeVista(c, { datos: SIN_PRECIOS, fichas: new Map(), avisos: [] }, HOY)} />);
    expect(boton("Eliminar: Suscripción de fondo de Fondo Prueba del 03/01/2025")).toBeDefined();
    expect(boton("Editar: Aportación del 02/01/2025")).toBeDefined();
  });

  it("una cifra que no se puede leer marca su campo como no válido y lo une al mensaje", async () => {
    await montar(<FormularioDeMovimiento alCerrar={() => undefined} alGuardar={() => undefined} cartera={CARTERA} hoy={HOY} inicial={{ tipo: "aportacion" }} precios={SIN_PRECIOS} />);
    await escribir("Importe", "doce");
    await pulsar("Añadir a la cartera");
    const input = campo("Importe").querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const errores = document.getElementById(input.getAttribute("aria-describedby")!.split(" ").at(-1)!);
    expect(errores?.textContent).toContain("no es una cifra");
  });

  it("«Quitar» un precio a mano dice cuál", async () => {
    const c = { ...CARTERA, preciosManuales: [{ activoId: "F", fecha: "2026-03-02", precio: "101.5" }] };
    await montar(<DialogoDeAjustes abierta={abiertaDe(c)} alCerrar={() => undefined} hoy={HOY} />);
    expect(boton("Quitar el precio de Fondo Prueba del 02/03/2026")).toBeDefined();
  });
});

describe("GES-18 · el libro no vuelve a la página 1 tras editar un movimiento", () => {
  it("en la página 2, cambiar la cartera deja la tabla en la página 2", async () => {
    /* 30 aportaciones: con 25 por página, dos páginas. */
    const movimientos = Array.from({ length: 30 }, (_, i) => mov("aportacion", `2025-01-${String(i + 1).padStart(2, "0")}`, { id: `a${i}`, importe: "100" }));
    const c = cartera([], movimientos);
    const mercado: MercadoCargado = { datos: SIN_PRECIOS, fichas: new Map(), avisos: [] };
    await montar(<VistaMovimientos datos={datosDeVista(c, mercado, HOY)} />);
    await pulsar("Siguiente");
    expect(document.body.textContent).toContain("2 de 2");
    /* Se edita un movimiento: la cartera es otra, el filtro el mismo. */
    const editada = { ...c, movimientos: c.movimientos.map((m) => (m.id === "a0" ? { ...m, importe: "150" } : m)) };
    await act(async () => root!.render(<VistaMovimientos datos={datosDeVista(editada, mercado, HOY)} />));
    expect(document.body.textContent).toContain("2 de 2");
  });

  it("cambiar el filtro sí vuelve a la página 1", async () => {
    const movimientos = Array.from({ length: 30 }, (_, i) => mov("aportacion", `2025-01-${String(i + 1).padStart(2, "0")}`, { id: `b${i}`, importe: "100" }));
    const c = cartera([], movimientos);
    await montar(<VistaMovimientos datos={datosDeVista(c, { datos: SIN_PRECIOS, fichas: new Map(), avisos: [] }, HOY)} />);
    await pulsar("Siguiente");
    await escribir("Buscar", "2025");
    expect(document.body.textContent).toContain("1 de 2");
  });
});
