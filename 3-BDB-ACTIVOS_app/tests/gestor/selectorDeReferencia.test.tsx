// @vitest-environment happy-dom
/**
 * «Comparar con» en pantalla: la lista agrupada, la línea que dice qué es lo elegido, que
 * elegir guarda en la cartera desde el bloque del análisis, que «Otro activo…» abre el
 * buscador, y que con la demostración está desactivado y lo explica.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import type { Cartera, ReferenciaDeCartera } from "../../src/gestor/motor/modelo";
import { BloqueReferencia } from "../../src/gestor/ui/analisis/BloqueReferencia";
import { SelectorDeReferencia } from "../../src/gestor/ui/dialogos/SelectorDeReferencia";
import { activo, cartera, mov, serie } from "./ayudas";
import { datosDeLaDemo, datosDeVista, panel, pintar, type Pintado } from "./vistaAnalisisDatos";

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

async function elegir(select: HTMLSelectElement, valor: string): Promise<void> {
  await act(async () => {
    select.value = valor;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const FONDO = activo("A", "FONDO");
const MERCADO: MercadoCargado = {
  datos: { precios: new Map([["A", serie(["2025-01-02", 100], ["2026-11-13", 110])]]), cambios: new Map() },
  fichas: new Map(),
  avisos: []
};
const MOVIMIENTOS = [
  mov("aportacion", "2025-01-02", { importe: "10000" }),
  mov("suscripcion", "2025-01-02", { activoId: "A", titulos: "100", precio: "100", importe: "-10000" })
];

describe("el selector de la referencia", () => {
  it("lo pinta la pieza Campo (MAR-10): su rótulo nombra al desplegable, y la línea de debajo lo describe", async () => {
    pintado = await pintar(<SelectorDeReferencia alCambiar={() => undefined} divisaBase="EUR" referencia={undefined} />);
    const select = pintado.vista.querySelector("select")!;
    const rotulo = pintado.vista.querySelector("label.field__label")!;
    expect(rotulo.textContent).toBe("Comparar con");
    expect(rotulo.getAttribute("for")).toBe(select.id);
    expect(document.getElementById(select.getAttribute("aria-describedby")!)?.textContent).toBe("La cartera no se compara con ninguna referencia.");
  });

  it("ofrece la lista agrupada y dice qué es lo elegido", async () => {
    pintado = await pintar(<SelectorDeReferencia alCambiar={() => undefined} divisaBase="EUR" referencia={{ activoId: "perfil:equilibrado", nombre: "Equilibrado" }} />);
    const select = pintado.vista.querySelector("select")!;
    expect([...select.querySelectorAll("optgroup")].map((grupo) => grupo.label)).toEqual(["Carteras de referencia", "Índices", "Liquidez"]);
    expect([...select.options].map((opcion) => opcion.textContent)).toEqual([
      "Conservador", "Moderado", "Equilibrado", "Dinámico", "Agresivo",
      "MSCI ACWI", "IBEX 35 con dividendos", "Renta fija global",
      "Liquidez (€STR capitalizado)",
      "Otro activo del catálogo…", "Sin referencia"
    ]);
    expect(select.value).toBe("perfil:equilibrado");
    expect(pintado.vista.textContent).toContain("50\u00a0% renta fija global y 50\u00a0% renta variable global, con los pesos fijados el primer día, sin reequilibrar.");
  });

  it("avisa con la referencia elegida, o con ninguna", async () => {
    const alCambiar = vi.fn<(referencia: ReferenciaDeCartera | undefined) => void>();
    pintado = await pintar(<SelectorDeReferencia alCambiar={alCambiar} divisaBase="EUR" referencia={undefined} />);
    const select = pintado.vista.querySelector("select")!;
    expect(select.value).toBe("");
    expect(pintado.vista.textContent).toContain("La cartera no se compara con ninguna referencia.");
    await elegir(select, "tipo:ESTR");
    expect(alCambiar).toHaveBeenLastCalledWith({ activoId: "tipo:ESTR", nombre: "Liquidez (€STR)" });
    await elegir(select, "IE00B6R52259");
    expect(alCambiar).toHaveBeenLastCalledWith({ activoId: "IE00B6R52259", nombre: "MSCI ACWI" });
    await elegir(select, "");
    expect(alCambiar).toHaveBeenLastCalledWith(undefined);
  });

  it("«Otro activo del catálogo…» abre el buscador sin cambiar nada todavía", async () => {
    const alCambiar = vi.fn();
    pintado = await pintar(<SelectorDeReferencia alCambiar={alCambiar} divisaBase="EUR" referencia={undefined} />);
    await elegir(pintado.vista.querySelector("select")!, "otro");
    expect(pintado.vista.textContent).toContain("Buscar en el catálogo");
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it("un activo que no es de la lista sale como «Otro activo», con su nombre", async () => {
    pintado = await pintar(<SelectorDeReferencia alCambiar={() => undefined} divisaBase="EUR" referencia={{ activoId: "LU0000000001", nombre: "Un fondo" }} />);
    expect(pintado.vista.querySelector("select")!.value).toBe("otro");
    expect(pintado.vista.textContent).toContain("Un fondo. Un activo del catálogo, LU0000000001, en la divisa de la cartera.");
  });
});

describe("el bloque «Frente a la referencia»", () => {
  it("elegir en el bloque guarda la referencia en la cartera", async () => {
    const cambios: Array<{ accion: string; cartera: Cartera }> = [];
    const carteraA = cartera([FONDO], MOVIMIENTOS);
    const datos = datosDeVista(carteraA, MERCADO, undefined, "inicio", null, (accion, cambio) => cambios.push({ accion, cartera: cambio(carteraA) }));
    pintado = await pintar(<BloqueReferencia abierta={datos.abierta} analisis={datos.analisis} />);
    await elegir(panel(pintado.vista, "Frente a la referencia").querySelector("select")!, "perfil:equilibrado");
    expect(cambios).toHaveLength(1);
    expect(cambios[0].accion).toBe("Cambiar la referencia");
    expect(cambios[0].cartera.referencia).toEqual({ activoId: "perfil:equilibrado", nombre: "Cartera de referencia Equilibrado" });
  });

  it("con una referencia que no se puede dar, dice por qué debajo del selector", async () => {
    const carteraA = cartera([FONDO], MOVIMIENTOS, { referencia: { activoId: "tipo:ESTR", nombre: "Liquidez (€STR)" } });
    const datos = datosDeVista(carteraA, { ...MERCADO, referencia: { nombre: "Liquidez (€STR)", motivo: "La plataforma no tiene el €STR: no se puede comparar con la liquidez." } });
    pintado = await pintar(<BloqueReferencia abierta={datos.abierta} analisis={datos.analisis} />);
    const bloque = panel(pintado.vista, "Frente a la referencia");
    expect(bloque.querySelector("select")!.value).toBe("tipo:ESTR");
    expect(bloque.textContent).toContain("La plataforma no tiene el €STR: no se puede comparar con la liquidez.");
  });

  it("con la demostración, el selector está desactivado y lo explica", async () => {
    const datos = datosDeLaDemo();
    pintado = await pintar(<BloqueReferencia abierta={datos.abierta} analisis={datos.analisis} />);
    const bloque = panel(pintado.vista, "Frente a la referencia");
    expect(bloque.querySelector("select")!.disabled).toBe(true);
    expect(bloque.textContent).toContain("La cartera de demostración se compara con su propio índice");
    /* Y la comparación sigue: su gráfico y sus cifras. */
    expect(bloque.textContent).toContain("Rentabilidad de la referencia");
  });
});
