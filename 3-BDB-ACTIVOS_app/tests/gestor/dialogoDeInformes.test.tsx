// @vitest-environment happy-dom
/**
 * El diálogo de informes, con el módulo de informes simulado: qué recibe cada documento, cómo
 * se enseña un fallo, para quién es cada documento y la firma de los informes, que es la
 * identidad del asesor de toda la aplicación (y que adopta, una vez, la que había en los ajustes
 * de la carpeta de carteras).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const informes = vi.hoisted(() => ({ pdf: vi.fn(), excel: vi.fn() }));
vi.mock("../../src/gestor/informes", () => ({ descargarInformePdf: informes.pdf, descargarExcel: informes.excel }));
/* Sin cuenta: la identidad del asesor vive en memoria, y cada prueba la deja vacía. */
const cuenta = vi.hoisted(() => ({ auth: { currentUser: null as { uid?: string; displayName: string | null } | null } }));
vi.mock("../../src/firebase", () => cuenta);

import { guardarIdentidad, leerIdentidad } from "../../src/core/identidadDelAsesor";
import type { AjustesDelGestor, AlmacenDeCarteras } from "../../src/gestor/almacen/almacen";
import type { Analisis } from "../../src/gestor/motor/analisis";
import { hoy } from "../../src/gestor/motor/fechas";
import { carteraVacia } from "../../src/gestor/motor/modelo";
import { DialogoDeInformes } from "../../src/gestor/ui/dialogos/DialogoDeInformes";
import { olvidarLasAdopciones } from "../../src/gestor/ui/dialogos/firmaDeLaCarpeta";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CARTERA = carteraVacia({ nombre: "Familia Prueba", ahora: "2026-01-01T00:00:00.000Z", id: "c" });
/* Solo lo que el diálogo lee del análisis: el periodo, los días valorados (para rotular el inicio) y la integridad. Lo demás lo pasa tal cual. */
const analisisCon = (errores = 0, avisos: Analisis["integridad"]["avisos"] = []) =>
  ({ periodo: { desde: "2025-12-31", hasta: "2026-11-13" }, valoracion: { dias: ["2025-01-02"] }, integridad: { errores, avisos } }) as unknown as Analisis;

let root: Root | undefined;
let vista: HTMLDivElement | undefined;

beforeEach(() => {
  informes.pdf.mockReset();
  informes.excel.mockReset();
  cuenta.auth.currentUser = null;
  guardarIdentidad({});
  olvidarLasAdopciones();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vista?.remove();
  root = undefined;
});

async function pintar(analisis: Analisis, almacen: AlmacenDeCarteras | null = null, avisosDeMercado: string[] = []) {
  vista = document.createElement("div");
  document.body.append(vista);
  root = createRoot(vista);
  await act(async () => root!.render(<DialogoDeInformes alCerrar={() => undefined} almacen={almacen} analisis={analisis} avisosDeMercado={avisosDeMercado} cartera={CARTERA} />));
}

async function esperar(condicion: () => boolean) {
  for (let intento = 0; intento < 50 && !condicion(); intento += 1) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
  }
  expect(condicion()).toBe(true);
}

function boton(etiqueta: string): HTMLButtonElement {
  const encontrado = [...document.body.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === etiqueta || b.textContent?.trim() === etiqueta);
  if (!encontrado) throw new Error(`No hay un botón «${etiqueta}»`);
  return encontrado;
}

async function pulsar(elemento: HTMLElement) {
  await act(async () => {
    elemento.click();
  });
}

/** Una carpeta de carteras de mentira: solo sus ajustes. */
function carpetaCon(ajustes: AjustesDelGestor) {
  const guardarAjustes = vi.fn().mockResolvedValue(undefined);
  const leerAjustes = vi.fn().mockResolvedValue(ajustes);
  return { almacen: { leerAjustes, guardarAjustes } as unknown as AlmacenDeCarteras, leerAjustes, guardarAjustes };
}

describe("el diálogo de informes", () => {
  it("enseña el periodo de la pantalla y genera el informe del cliente con el análisis, la cartera, la firma del asesor y la fecha de hoy", async () => {
    informes.pdf.mockResolvedValue("Familia Prueba - informe del cliente.pdf");
    guardarIdentidad({ nombre: "Ana Asesora", entidad: "Despacho Prueba" });
    const analisis = analisisCon();
    await pintar(analisis);
    expect(document.body.textContent).toContain("Del 31/12/2025 al 13/11/2026");
    expect(document.body.textContent).toContain("Para entregar o enseñar en una reunión");

    await pulsar(boton("Descargar el PDF: Informe de la cartera"));
    await esperar(() => document.body.textContent?.includes("se ha descargado") ?? false);
    expect(informes.pdf).toHaveBeenCalledWith("cliente", { analisis, cartera: CARTERA, asesor: { nombre: "Ana Asesora", entidad: "Despacho Prueba" }, generado: hoy() });
    expect(document.body.textContent).toContain("«Familia Prueba - informe del cliente.pdf»");
  });

  it("ofrece el informe de costes y lo genera con el mismo periodo y los mismos datos", async () => {
    informes.pdf.mockResolvedValue("Costes de la cartera - Familia Prueba - 2026-01-01 a 2026-11-13.pdf");
    const analisis = analisisCon();
    await pintar(analisis);
    expect(document.body.textContent).toContain("Costes de la cartera");
    expect(document.body.textContent).toContain("lo que ha costado la cartera");
    await pulsar(boton("Descargar el PDF: Costes de la cartera"));
    await esperar(() => document.body.textContent?.includes("se ha descargado") ?? false);
    expect(informes.pdf).toHaveBeenCalledWith("costes", expect.objectContaining({ analisis, cartera: CARTERA, generado: hoy() }));
  });

  it("cada documento dice para quién es: «Para el cliente» o «Interno»", async () => {
    await pintar(analisisCon());
    const filas = [...document.body.querySelectorAll(".rows__item")].map((fila) => ({
      nombre: fila.querySelector(".rows__label")?.firstChild?.textContent?.trim(),
      para: fila.querySelector(".distintivo")?.textContent,
      interno: fila.querySelector(".distintivo")?.classList.contains("distintivo--interno")
    }));
    expect(filas).toEqual([
      { nombre: "Informe de la cartera", para: "Para el cliente", interno: false },
      { nombre: "Costes de la cartera", para: "Para el cliente", interno: false },
      { nombre: "Informe del asesor", para: "Interno", interno: true },
      { nombre: "Datos en Excel", para: "Interno", interno: true }
    ]);
  });

  it("un fallo al generar se enseña, y avisa antes si la cartera tiene errores", async () => {
    informes.excel.mockRejectedValue(new Error("No hay posiciones que escribir."));
    await pintar(analisisCon(2));
    expect(document.body.textContent).toContain("La cartera tiene 2 errores sin resolver; las cifras del informe pueden no ser fiables.");
    await pulsar(boton("Descargar el Excel: Datos en Excel"));
    await esperar(() => document.body.querySelector('[role="alert"]') !== null);
    expect(document.body.querySelector('[role="alert"]')!.textContent).toContain("No se ha podido generar el documento. No hay posiciones que escribir.");
  });

  it("GES-16 · antes de generar repite los avisos del motor y los de mercado, no solo los errores; las notas no", async () => {
    await pintar(
      analisisCon(0, [
        { gravedad: "aviso", codigo: "PRECIO_DE_OPERACION", mensaje: "Fondo X no tiene serie de precios: se valora al precio de su última operación." },
        { gravedad: "nota", codigo: "CONCENTRACION", mensaje: "Fondo X pesa un 60,0 % de la cartera." }
      ]),
      null,
      ["No se han podido leer los tipos de cambio."]
    );
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("2 cosas que revisar antes de generar");
    expect(texto).toContain("se valora al precio de su última operación");
    expect(texto).toContain("No se han podido leer los tipos de cambio.");
    expect(texto).not.toContain("pesa un 60,0 %");
  });
});

describe("la firma de los informes", () => {
  it("es la identidad del asesor, en una línea, con «Cambiar», que abre «Tus datos en los informes»", async () => {
    guardarIdentidad({ nombre: "Ana Asesora", entidad: "Despacho Prueba", contacto: "ana@ejemplo.test", logotipo: "data:image/png;base64,iVBORw==" });
    await pintar(analisisCon());
    const firma = document.body.querySelector(".gestor-firma")!;
    expect(firma.textContent).toContain("Firma de los informes");
    expect(firma.textContent).toContain("Ana Asesora · Despacho Prueba · ana@ejemplo.test · con logotipo");
    expect(document.body.textContent).not.toContain("Falta tu nombre.");
    await pulsar(boton("Cambiar la firma de los informes"));
    const titulos = [...document.body.querySelectorAll('[role="dialog"] h2, [role="dialog"] h3')].map((titulo) => titulo.textContent);
    expect(titulos).toContain("Tus datos en los informes");
  });

  it("sin nombre, lo avisa: los informes saldrán sin firma", async () => {
    await pintar(analisisCon());
    expect(document.body.querySelector(".gestor-firma")!.textContent).toContain("Sin datos del asesor");
    expect(document.body.textContent).toContain("Falta tu nombre.");
  });

  it("con la identidad vacía, adopta una vez la firma de los ajustes de la carpeta, y no escribe en ellos", async () => {
    informes.pdf.mockResolvedValue("x.pdf");
    const { almacen, leerAjustes, guardarAjustes } = carpetaCon({ asesor: { nombre: " Ana Asesora ", contacto: "ana@ejemplo.test" }, extensiones: { otra: 1 } });
    await pintar(analisisCon(), almacen);
    await esperar(() => leerIdentidad().nombre === "Ana Asesora");
    expect(leerIdentidad()).toEqual({ nombre: "Ana Asesora", contacto: "ana@ejemplo.test" });
    await esperar(() => document.body.querySelector(".gestor-firma")?.textContent?.includes("Ana Asesora · ana@ejemplo.test") ?? false);

    /* Lo que va a los informes es esa identidad. */
    await pulsar(boton("Descargar el PDF: Informe de la cartera"));
    await esperar(() => informes.pdf.mock.calls.length === 1);
    expect(informes.pdf.mock.calls[0][1].asesor).toEqual({ nombre: "Ana Asesora", contacto: "ana@ejemplo.test" });

    /* Una sola vez: si el asesor la vacía después, abrir de nuevo el diálogo no la vuelve a traer. */
    await act(async () => root!.unmount());
    vista?.remove();
    root = undefined;
    guardarIdentidad({});
    await pintar(analisisCon(), almacen);
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
    expect(leerIdentidad()).toEqual({});
    expect(leerAjustes).toHaveBeenCalledTimes(1);
    expect(guardarAjustes).not.toHaveBeenCalled();
  });

  it("no pisa una identidad ya escrita por el asesor", async () => {
    guardarIdentidad({ entidad: "Mi despacho" });
    const { almacen, guardarAjustes } = carpetaCon({ asesor: { nombre: "Otro nombre", entidad: "Otra entidad" } });
    await pintar(analisisCon(), almacen);
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
    expect(leerIdentidad()).toEqual({ entidad: "Mi despacho" });
    expect(guardarAjustes).not.toHaveBeenCalled();
  });

  it("el nombre que la cuenta propone sin nada guardado no cuenta como escrito: la firma de la carpeta se adopta", async () => {
    cuenta.auth.currentUser = { displayName: "Nombre De La Cuenta" };
    /* Sin uid no hay clave en el navegador; lo guardado en memoria se olvida al cambiar de cuenta: aquí, la identidad es solo el nombre propuesto. */
    guardarIdentidad({ nombre: "Nombre De La Cuenta" });
    const { almacen } = carpetaCon({ asesor: { nombre: "Ana Asesora", entidad: "Despacho Prueba" } });
    await pintar(analisisCon(), almacen);
    await esperar(() => leerIdentidad().nombre === "Ana Asesora");
    expect(leerIdentidad()).toEqual({ nombre: "Ana Asesora", entidad: "Despacho Prueba" });
  });
});
