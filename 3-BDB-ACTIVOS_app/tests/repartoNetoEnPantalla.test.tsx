// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { OaaDonutChart } from "../src/charts/oaa/OaaDonutChart";
import { NOTA_DEL_ARO_NETO, NOTA_DEL_REPARTO_NETO, sumaComoUnRepartoNeto, tieneCortosOApalancamiento } from "../src/core/repartoNeto";
import { fichaDeLaTarjeta } from "../src/gestor/mercado/fichas";
import { componer } from "../src/gestor/motor/composicion";
import type { Activo } from "../src/gestor/motor/modelo";

/**
 * Decisión C-29 de Óscar (21-11-2026, «Sí, las tres»): el reparto neto del proveedor, que suma el 100 %, se acepta tal cual. Una clase
 * negativa se escribe con su signo y sin barra ni porción de aro; la que pasa de 100, tal cual. Las cifras esperadas son de una
 * cuenta a mano sobre ES0137396000 del canónico del 17-11-2026: renta variable 3,198089, renta fija 0,115421, liquidez −2,425742 y
 * otros 0,112232, que suman 1.
 */

const N = " ";
const MENOS = "−";

describe("la regla, en un solo sitio", () => {
  test("suma 1 y dentro de los topes del contrato: se lee tal cual", () => {
    expect(sumaComoUnRepartoNeto([3.198089, 0.115421, -2.425742, 0.112232])).toBe(true);
    expect(sumaComoUnRepartoNeto([6, -5])).toBe(true);
    expect(sumaComoUnRepartoNeto([6.01, -5.01])).toBe(false);
    /* 0,6 + 0,15 + 0,05 = 0,80: no suma 1, no es un reparto. */
    expect(sumaComoUnRepartoNeto([0.6, 0.15, 0.05])).toBe(false);
  });

  test("la nota sale con cortos o apalancamiento más allá del redondeo, en fracción o en porcentaje", () => {
    expect(tieneCortosOApalancamiento([1.000401, -0.000844])).toBe(false);
    expect(tieneCortosOApalancamiento([1.0116, -0.0139])).toBe(true);
    expect(tieneCortosOApalancamiento([121.98089, -24.25742], 100)).toBe(true);
    expect(tieneCortosOApalancamiento([60, 40], 100)).toBe(false);
  });
});

describe("el aro", () => {
  const datos = [
    { key: "equity", label: "Renta variable", value: 319.8089, colorDeCategoria: "#2F4F8C" },
    { key: "fixed_income", label: "Renta fija", value: 11.5421, colorDeCategoria: "#7A8C5A" },
    { key: "cash", label: "Liquidez", value: -242.5742, colorDeCategoria: "#9AA5B1" },
    { key: "other", label: "Otros", value: 11.2232 }
  ];

  test("la negativa va en la leyenda con su signo y muestra hueca, y la nota dice que el aro dibuja solo lo positivo", () => {
    const html = renderToStaticMarkup(createElement(OaaDonutChart, { data: datos }));
    const leyenda = html.slice(html.indexOf('<ul class="oaa-chart-legend">'));
    expect(leyenda).toContain(`<span>Liquidez</span><strong>${MENOS}242,6${N}%</strong>`);
    expect(leyenda).toContain(`<span>Renta variable</span><strong>319,8${N}%</strong>`);
    /* La muestra de la negativa, hueca: papel por dentro y el color de su clase en el borde. */
    expect(leyenda).toMatch(/<i style="background:var\(--papel\);border-color:#9AA5B1"><\/i><span>Liquidez/);
    expect(html).toContain(`<p class="oaa-donut-nota">${NOTA_DEL_ARO_NETO}</p>`);
  });

  test("un reparto de 0 a 100 no lleva nota", () => {
    const html = renderToStaticMarkup(
      createElement(OaaDonutChart, { data: [{ key: "a", label: "Renta variable", value: 60 }, { key: "b", label: "Renta fija", value: 40 }] })
    );
    expect(html).not.toContain("oaa-donut-nota");
  });
});

describe("Carteras de clientes", () => {
  const tarjeta = {
    instrument_id: "ES0137396000",
    instrument_type: "FUND",
    exposure: {
      asset_mix: { equity: 3.198089, fixed_income: 0.115421, cash: -2.425742, other: 0.112232 },
      equity_regions: { eurozone: 1 }
    }
  };

  test("la ficha del fondo lleva su reparto neto tal cual, y su renta variable es su 319,8 %", () => {
    const ficha = fichaDeLaTarjeta(tarjeta);
    expect(ficha.clases).toEqual({ "Renta variable": 3.198089, "Renta fija": 0.115421, Liquidez: -2.425742, Otros: 0.112232 });
    expect(ficha.rentaVariable).toBe(3.198089);
  });

  test("un reparto que no suma 1 sigue como siempre: lo positivo, reescalado si pasa de 1", () => {
    /* 0,90 + 0,15 = 1,05 y no hay negativos: no es un reparto neto, y la renta variable es 0,90 / 1,05. */
    const ficha = fichaDeLaTarjeta({ instrument_id: "X", exposure: { asset_mix: { equity: 0.9, fixed_income: 0.15 } } });
    expect(ficha.clases?.["Renta variable"]).toBeCloseTo(0.9 / 1.05, 12);
  });

  test("la composición reparte con su signo y la cartera suma su valor", () => {
    const fondo: Activo = { id: "ES0137396000", nombre: "Apalancado", tipo: "FONDO", divisa: "EUR", origen: "catalogo" };
    const accion: Activo = { id: "ACC", nombre: "Una acción", tipo: "ACCION", divisa: "EUR", origen: "manual" };
    const composicion = componer(
      [
        { activo: fondo, valor: 1000 },
        { activo: accion, valor: 9000 }
      ],
      [],
      new Map([[fondo.id, fichaDeLaTarjeta(tarjeta)]])
    );
    const porNombre = Object.fromEntries(composicion.porClaseDeActivo.lineas.map((linea) => [linea.nombre, linea.valor]));
    /* 9.000 + 1.000 × 3,198089 = 12.198,089; 1.000 × (−2,425742) = −2.425,742; 115,421 y 112,232. Suman 10.000. */
    expect(porNombre["Renta variable"]).toBeCloseTo(12198.089, 6);
    expect(porNombre["Liquidez"]).toBeCloseTo(-2425.742, 6);
    expect(porNombre["Renta fija"]).toBeCloseTo(115.421, 6);
    expect(porNombre["Otros"]).toBeCloseTo(112.232, 6);
    expect(porNombre["Sin clasificar"]).toBeUndefined();
    expect(composicion.porClaseDeActivo.lineas.reduce((suma, linea) => suma + linea.valor, 0)).toBeCloseTo(10000, 6);
    /* La renta variable de la cartera: 12.198,089 / 10.000; las regiones se refieren a ella. */
    expect(composicion.rentaVariable).toBeCloseTo(1.2198089, 9);
    expect(tieneCortosOApalancamiento(composicion.porClaseDeActivo.lineas.map((linea) => linea.peso))).toBe(true);
  });

  test("la nota de la ficha y de la cartera es la misma frase", () => {
    expect(NOTA_DEL_REPARTO_NETO).toBe(
      "Reparto neto: incluye posiciones cortas o apalancamiento, así que una clase puede salir en negativo y otra pasar del 100 %."
    );
  });
});
