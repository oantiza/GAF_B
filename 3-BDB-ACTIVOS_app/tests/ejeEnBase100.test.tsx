// @vitest-environment happy-dom

/**
 * El eje vertical en base 100 escribe sus marcas sin decimal cuando todas son enteras («90 · 95 · 100»): «100,0» era
 * ruido (Comparador 16, Ficha 12). La etiqueta del final de la línea y la tabla alternativa conservan su decimal, y si
 * alguna marca no es entera («97,5»), el eje lo conserva también. Las marcas esperadas salen de la regla del eje
 * (`marcasDelEje`: pasos de 1, 2, 2,5 y 5 por potencia de diez, el primero que deja siete marcas o menos) contada a mano.
 */
import { act, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, { width: 960, height: 260 }) : null
  };
});

import { ejeVertical } from "../src/charts/oaa/ejeVertical";
import { OaaLineChart } from "../src/charts/oaa/OaaLineChart";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FECHAS = ["2026-01-02", "2026-02-02", "2026-03-02"];

async function pintar(valores: number[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<OaaLineChart series={[{ id: "A", label: "Activo A", values: FECHAS.map((date, i) => ({ date, value: valores[i] })) }]} />)
  );
  const textos = (selector: string) => [...host.querySelectorAll(selector)].map((n) => n.textContent?.trim() ?? "").filter(Boolean);
  const lectura = {
    /* Las marcas de los dos ejes llevan la misma clase; las del vertical son las que no dicen un mes. */
    eje: textos("text.recharts-cartesian-axis-tick-value").filter((texto) => /^[\d.,]+$/.test(texto)),
    /* La etiqueta del final de la línea: el `<g aria-hidden>` que la gráfica pinta encima, fuera de los ejes. */
    final: textos(".recharts-wrapper g[aria-hidden='true'] > g > text"),
    tabla: textos(".sr-only table tbody td")
  };
  await act(async () => root.unmount());
  host.remove();
  return lectura;
}

describe("el eje en base 100", () => {
  test("con marcas enteras, el eje va sin decimal; la etiqueta final y la tabla, con el suyo", async () => {
    /* De 92 a 108 hay 16: de 1 en 1 serían diecisiete marcas, de 2 en 2 nueve, de 2,5 en 2,5 nueve; de 5 en 5, de 90
       a 110, cinco. */
    expect(ejeVertical([92, 100, 108])?.marcas).toEqual([90, 95, 100, 105, 110]);
    const { eje, final, tabla } = await pintar([92, 100, 108]);
    expect(eje).toEqual(["90", "95", "100", "105", "110"]);
    expect(eje).not.toContain("100,0");
    expect(final).toEqual(["108,0"]);
    expect(tabla).toEqual(["92,0", "100,0", "108,0"]);
  });

  test("con una marca que no es entera, el eje conserva el decimal", async () => {
    /* De 97,6 a 112 hay 14,4: de 1 en 1 serían dieciséis marcas y de 2 en 2, de 96 a 112, nueve; de 2,5 en 2,5, de
       97,5 a 112,5, siete. */
    expect(ejeVertical([97.6, 100, 112])?.marcas).toEqual([97.5, 100, 102.5, 105, 107.5, 110, 112.5]);
    const { eje, final, tabla } = await pintar([97.6, 100, 112]);
    expect(eje).toEqual(["97,5", "100,0", "102,5", "105,0", "107,5", "110,0", "112,5"]);
    expect(final).toEqual(["112,0"]);
    expect(tabla).toEqual(["97,6", "100,0", "112,0"]);
  });
});
