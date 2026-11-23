// @vitest-environment happy-dom
/**
 * La revisión de una importación pregunta qué tipo de activo es uno nuevo cuando el documento no lo dice (22-11-2026): una
 * «Compra» a secas solo supone «acción», y si fuera un bono, 10.000 de nominal al 98,5 valdrían 985.000 € en vez de 9.850 €.
 * Hasta que el asesor lo dice, la compra no se puede marcar.
 */
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { importadorDePlantilla } from "../../src/gestor/importacion/plantilla";
import { revisar, type DecisionSobreUnActivo } from "../../src/gestor/importacion/revision";
import type { ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import { carteraVacia, type Activo } from "../../src/gestor/motor/modelo";
import { PasoRevision } from "../../src/gestor/ui/importar/PasoRevision";
import { pintar } from "../piezas/pintar";

vi.mock("../../src/gestor/mercado/plataforma", () => ({ catalogoDeActivos: vi.fn(async () => []) }));

let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

const CABECERA = ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Importe"];

function importar(filas: string[][]): ResultadoDeImportacion {
  const tabla = [CABECERA, ...filas];
  return importadorDePlantilla.importar([{ documento: { nombre: "plantilla.csv", texto: "", tablas: [tabla] }, tipo: "movimientos" }], { divisaBase: "EUR" });
}

const cartera = carteraVacia({ nombre: "Importada", ahora: "2026-01-01T00:00:00.000Z", id: "c" });

function pintarLaRevision(resultados: ResultadoDeImportacion[], decisiones: Map<string, DecisionSobreUnActivo>, alDecidir = vi.fn()) {
  const revision = revisar(resultados, cartera, [], decisiones);
  const nodo = (
    <PasoRevision
      alDecidir={alDecidir}
      alMarcar={vi.fn()}
      cartera={cartera}
      decisiones={decisiones}
      marcas={new Map()}
      resultados={resultados}
      revision={revision}
      sinCatalogo={false}
    />
  );
  return nodo;
}

const botones = (host: HTMLElement, texto: string) => [...host.querySelectorAll("button")].filter((boton) => boton.textContent === texto);
const casillaDeLaCompra = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[aria-label^="Importar: Compra"]')!;

describe("un activo nuevo cuyo tipo no dice el documento", () => {
  test("pide el tipo, no deja marcar su compra hasta decidirlo y, dicho «Bono», lo da de alta en % del nominal", async () => {
    const resultados = [importar([["07/01/2026", "Compra", "ES0000000052", "Bono Ejemplo 2030", "10000", "98,5", "-9850"]])];
    const alDecidir = vi.fn();
    const vista = pintar(pintarLaRevision(resultados, new Map(), alDecidir));
    quitar = vista.quitar;
    await act(async () => undefined);
    const texto = vista.host.textContent ?? "";
    expect(texto).toContain("El documento no dice qué tipo de activo es, y no está en el catálogo. Dilo para darlo de alta con precio a mano: en un bono, los títulos son el nominal y el precio va en % del nominal.");
    const grupo = vista.host.querySelector('[role="group"][aria-label="Tipo de activo de «Bono Ejemplo 2030»"]')!;
    expect([...grupo.querySelectorAll("button")].map((boton) => boton.textContent)).toEqual(["Acción", "Bono", "ETF", "Fondo", "Otro"]);
    /* La compra: sin poder marcarse, con su estado en palabras. */
    expect(casillaDeLaCompra(vista.host).disabled).toBe(true);
    expect(texto).toContain("Falta el tipo");
    expect(texto).toContain("Falta decir qué tipo de activo es.");

    act(() => botones(vista.host, "Bono")[0].click());
    expect(alDecidir).toHaveBeenCalledTimes(1);
    const [clave, decision] = alDecidir.mock.calls[0] as [string, Activo];
    expect(clave).toBe("ES0000000052");
    expect(decision).toMatchObject({ id: "ES0000000052", isin: "ES0000000052", tipo: "BONO", multiplicador: "0.01", origen: "manual" });

    /* Con la decisión puesta: dice qué se hará y la compra se puede marcar, y va marcada. */
    vista.repintar(pintarLaRevision(resultados, new Map([[clave, decision]])));
    expect(vista.host.textContent).toContain("Activo propio con precio a mano (bono, con el precio en % del nominal): Bono Ejemplo 2030");
    expect(casillaDeLaCompra(vista.host).disabled).toBe(false);
    expect(casillaDeLaCompra(vista.host).checked).toBe(true);
  });

  test("uno citado solo por su nombre, al crearlo como activo propio, también pide el tipo", async () => {
    const resultados = [importar([["07/01/2026", "Compra", "", "Bono sin ISIN", "10000", "98,5", "-9850"]])];
    const alDecidir = vi.fn();
    const vista = pintar(pintarLaRevision(resultados, new Map(), alDecidir));
    quitar = vista.quitar;
    await act(async () => undefined);
    act(() => botones(vista.host, "Crear como activo propio")[0].click());
    expect(alDecidir).not.toHaveBeenCalled();
    expect(vista.host.textContent).toContain("Di qué tipo de activo es: en un bono, los títulos son el nominal y el precio va en % del nominal.");
    act(() => botones(vista.host, "Bono")[0].click());
    const [, decision] = alDecidir.mock.calls[0] as [string, Activo];
    expect(decision).toMatchObject({ tipo: "BONO", multiplicador: "0.01", origen: "manual" });
    expect(decision.isin).toBeUndefined();
    expect(decision.id.startsWith("propio-")).toBe(true);
  });

  test("la guarda del importe sale entre los avisos de la línea", async () => {
    const resultados = [importar([["07/01/2026", "Compra de acciones", "ES0000000060", "Acción cara", "100", "98,5", "-98,5"]])];
    const vista = pintar(pintarLaRevision(resultados, new Map()));
    quitar = vista.quitar;
    await act(async () => undefined);
    /* 100 × 98,5 = 9.850 €, frente a 98,50 €: cien veces. */
    expect(vista.host.textContent).toContain("El importe no cuadra con los títulos y el precio: con 100 títulos a 98,50 € sería 9.850,00 €, y la fila dice 98,50 €.");
    expect(vista.host.textContent).toContain("Revisar");
    expect(casillaDeLaCompra(vista.host).disabled).toBe(false);
  });
});
