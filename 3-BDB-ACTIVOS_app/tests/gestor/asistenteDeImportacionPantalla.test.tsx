// @vitest-environment happy-dom
/**
 * El asistente de importación pintado: los tres pasos con los tres extractos de Andbank hasta
 * `alAplicar`, un documento que no se reconoce no deja continuar, y dejar fuera un activo
 * quita sus movimientos del recuento.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivoDeCatalogo } from "../../src/gestor/mercado/fichas";
import { ISIN_BOLSA, ISIN_TECNOLOGIA, MOVIMIENTOS_COMPLETOS, OPERACIONES_COMPLETAS, POSICIONES_COMPLETAS } from "./andbankDeMuestra";

const CATALOGO: ActivoDeCatalogo[] = [
  { isin: ISIN_BOLSA, nombre: "Fondo Bolsa Mundial", tipo: "FONDO", divisa: "EUR" },
  { isin: ISIN_TECNOLOGIA, nombre: "Tecnologia Global Inc", tipo: "ACCION", divisa: "USD", ticker: "TGI" }
];

vi.mock("../../src/gestor/mercado/plataforma", () => ({
  HAY_PLATAFORMA: true,
  catalogoDeActivos: () => Promise.resolve(CATALOGO)
}));

import { carteraVacia, type Cartera } from "../../src/gestor/motor/modelo";
import { AsistenteDeImportacion } from "../../src/gestor/ui/dialogos/AsistenteDeImportacion";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let vista: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vista?.remove();
  root = undefined;
});

async function pintar(alAplicar = vi.fn()) {
  vista = document.createElement("div");
  document.body.append(vista);
  root = createRoot(vista);
  const cartera = carteraVacia({ nombre: "Familia Prueba", ahora: "2026-01-01T00:00:00.000Z", id: "c" });
  await act(async () => root!.render(<AsistenteDeImportacion alAplicar={alAplicar} alCerrar={() => undefined} cartera={cartera} />));
  return alAplicar;
}

/** Deja correr las promesas (lectura de ficheros, catálogo) hasta que se cumpla la condición. */
async function esperar(condicion: () => boolean) {
  for (let intento = 0; intento < 50 && !condicion(); intento += 1) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
  }
  expect(condicion()).toBe(true);
}

async function soltarFicheros(ficheros: File[]) {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: ficheros, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function boton(texto: string | RegExp): HTMLButtonElement {
  const encontrado = [...document.body.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent?.trim() === texto : texto.test(b.textContent?.trim() ?? "")));
  if (!encontrado) throw new Error(`No hay un botón «${texto}»`);
  return encontrado;
}

async function pulsar(elemento: HTMLElement) {
  await act(async () => {
    elemento.click();
  });
}

const TRES = () => [new File([MOVIMIENTOS_COMPLETOS], "mov.xls"), new File([POSICIONES_COMPLETAS], "pos.xls"), new File([OPERACIONES_COMPLETAS], "ops.xls")];

function listos(): number {
  const texto = document.body.querySelector(".gestor-resumen")?.textContent ?? "";
  const encontrado = /^(\d+) movimientos? listos?/.exec(texto);
  if (!encontrado) throw new Error(`Resumen inesperado: «${texto}»`);
  return Number(encontrado[1]);
}

describe("el asistente de importación", () => {
  it("recorre los tres pasos con los tres extractos y aplica una cartera con sus movimientos", async () => {
    const alAplicar = await pintar();
    await soltarFicheros(TRES());
    await esperar(() => document.body.querySelectorAll(".rows__item").length === 3 && !document.body.textContent?.includes("Leyendo…"));
    expect(document.body.textContent).toContain("Andbank · ");
    expect(document.body.textContent).toContain("no se envían a ningún sitio");

    await pulsar(boton("Continuar"));
    await esperar(() => document.body.querySelector(".gestor-resumen") !== null);
    const n = listos();
    expect(n).toBeGreaterThan(10);
    expect(document.body.querySelectorAll("tbody input[type=checkbox]:checked").length).toBe(n);

    await pulsar(boton("Continuar"));
    expect(document.body.textContent).toContain("La cartera cuadra con el extracto del 30/09/2025");
    await pulsar(boton(`Importar ${n} movimientos`));

    expect(alAplicar).toHaveBeenCalledTimes(1);
    const [cartera, descripcion] = alAplicar.mock.calls[0] as [Cartera, string];
    expect(descripcion).toBe(`Importar ${n} movimientos de Andbank`);
    expect(cartera.movimientos).toHaveLength(n);
    expect(cartera.importaciones).toHaveLength(1);
    expect(cartera.extractos).toHaveLength(2);
  });

  it("con un documento que no se reconoce no deja continuar, y dice qué se intentó", async () => {
    await pintar();
    await soltarFicheros([new File(["<html><body><table><tr><td>Estimado cliente</td></tr></table></body></html>"], "carta.html")]);
    await esperar(() => document.body.textContent?.includes("No se ha reconocido") ?? false);
    expect(document.body.textContent).toContain("Se ha probado con Andbank:");
    expect(document.body.textContent).toContain("pasa sus movimientos a la plantilla");
    expect(boton("Continuar").disabled).toBe(true);
  });

  it("dejar fuera un activo quita sus movimientos del recuento y del botón final", async () => {
    await pintar();
    await soltarFicheros(TRES());
    await esperar(() => document.body.querySelectorAll(".rows__item").length === 3 && !document.body.textContent?.includes("Leyendo…"));
    await pulsar(boton("Continuar"));
    await esperar(() => document.body.querySelector(".gestor-resumen") !== null);
    const antes = listos();

    const fila = [...document.body.querySelectorAll<HTMLElement>(".rows__item")].find((item) => item.textContent?.includes("ELECTRICA DEL SUR") && item.textContent.includes("Dejar fuera"));
    expect(fila).toBeDefined();
    await pulsar([...fila!.querySelectorAll("button")].find((b) => b.textContent === "Dejar fuera")!);
    const despues = listos();
    expect(despues).toBeLessThan(antes);
    expect(fila!.textContent).toContain("Se dejan fuera sus movimientos");
    expect(document.body.textContent).toContain("Se ha dejado fuera su activo.");

    await pulsar(boton("Continuar"));
    expect(boton(new RegExp(`^Importar ${despues} movimientos?$`))).toBeDefined();
  });
});
