import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { EuroYieldCurvePanel } from "../src/charts/EuroYieldCurveChart";
import type { EcbYieldCurveResult } from "../src/adapters/ecbYieldCurveBackend";

const result: EcbYieldCurveResult = {
  schema_version: "ecb-yield-curve.v1",
  as_of_date: "2026-07-09",
  aaa: [{ maturity_years: 0.25, yield_pct: 2.32 }, { maturity_years: 30, yield_pct: 3.15 }],
  all_bonds: [{ maturity_years: 0.25, yield_pct: 2.41 }, { maturity_years: 30, yield_pct: 3.34 }],
  source: "ECB_DATA_PORTAL",
  notes: "AAA: 2/18 vencimientos disponibles"
};

function render(props: Partial<Parameters<typeof EuroYieldCurvePanel>[0]> = {}) {
  return renderToStaticMarkup(createElement(EuroYieldCurvePanel, {
    result,
    loading: false,
    error: null,
    onRetry: () => undefined,
    ...props
  }));
}

describe("EuroYieldCurvePanel", () => {
  test("muestra leyenda, fecha, fuente y declara una curva parcial", () => {
    const html = render();
    expect(html).toContain("Curva de tipos del euro");
    expect(html).toContain("Bonos AAA");
    expect(html).toContain("Todos los bonos de gobierno");
    expect(html).toContain("Curva parcial");
    /* Quién lo dice y desde cuándo, pegado bajo el título y no en un pie (principio 1 de la
       dirección, hallazgos 92 y 136). */
    expect(html).toContain('<p class="panel__subtitle">Banco Central Europeo · dato a 09/07/2026 · ');
    expect(html).toContain("Los puntos ausentes no se estiman");
  });

  test("DIR-09: la nota del servidor escribe su fecha con el formato común y cada frase empieza en mayúscula", () => {
    const html = render({
      result: { ...result, notes: "AAA: omitida por fecha antigua 2026-11-11 | todos los bonos: 17/18 vencimientos disponibles" }
    });
    expect(html).toContain("AAA: omitida por fecha antigua 11/11/2026. Todos los bonos: 17/18 vencimientos disponibles.");
    expect(html).not.toContain("2026-11-11");
  });

  test("sin un solo punto: un solo mensaje en español con «Reintentar», sin «Curva parcial» ni la nota en inglés", () => {
    const html = render({
      result: { ...result, aaa: [], all_bonds: [], notes: "AAA: The read operation timed out. | todos los bonos: The read operation timed out." }
    });
    expect(html).toContain("No hemos podido leer la curva del BCE.");
    expect(html).toContain("Reintentar");
    expect(html).not.toContain("Curva parcial");
    expect(html).not.toContain("Curva BCE sin observaciones disponibles.");
    expect(html).not.toContain("timed out");
    expect(html.match(/class="aviso /g)).toHaveLength(1);
  });

  test("sin un solo punto porque las curvas se omitieron por viejas: el aviso dice el motivo bajo su título", () => {
    const html = render({
      result: {
        ...result,
        aaa: [],
        all_bonds: [],
        notes: "AAA: omitida por fecha antigua 2026-11-11 | todos los bonos: omitida por fecha antigua 2026-11-11"
      }
    });
    /* Cuenta a mano sobre la nota: cada parte separada por « | » es una frase con mayúscula inicial y punto final, y la
       fecha ISO pasa al formato común (2026-11-11 → 11/11/2026). */
    const aviso = html.match(/<div class="aviso [^"]*"[^>]*>[\s\S]*?<\/div><div class="aviso__accion">/)?.[0] ?? "";
    expect(aviso).toContain("No hemos podido leer la curva del BCE.");
    expect(aviso).toContain(
      "<p>AAA: omitida por fecha antigua 11/11/2026. Todos los bonos: omitida por fecha antigua 11/11/2026.</p>"
    );
    expect(html).not.toContain("2026-11-11");
    expect(html).not.toContain("Curva parcial");
    expect(html.match(/class="aviso /g)).toHaveLength(1);
  });

  test("el tiempo agotado que el servidor escribe en inglés se dice en español en la nota de una curva parcial", () => {
    const html = render({ result: { ...result, aaa: [], notes: "AAA: The read operation timed out. | todos los bonos: 2/18 vencimientos disponibles" } });
    expect(html).toContain("AAA: el BCE no respondió a tiempo. Todos los bonos: 2/18 vencimientos disponibles.");
    expect(html).not.toContain("timed out");
    expect(html).toContain("Curva parcial");
  });

  test("declara el estado de carga", () => {
    const html = render({ result: null, loading: true });
    expect(html).toContain("Consultando la curva de tipos del BCE");
    /* Sin dato no hay fecha que afirmar, aunque se siga diciendo quién lo da. */
    expect(html).toContain("Banco Central Europeo");
    expect(html).not.toContain("dato a");
  });

  test("declara error y ofrece reintento", () => {
    const html = render({ result: null, error: new Error("BCE no disponible") });
    expect(html).toContain("BCE no disponible");
    expect(html).toContain("Reintentar");
  });
});
