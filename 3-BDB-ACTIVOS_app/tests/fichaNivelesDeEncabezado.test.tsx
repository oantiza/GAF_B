// @vitest-environment happy-dom

/**
 * ACT-18: en las dos fichas, del `h1` del nombre se pasaba al `h3` de cada sección sin ningún `h2`. Quien recorre la
 * página por encabezados encontraba la estructura rota. Las secciones son `h2`, y en ninguna pestaña se salta un nivel.
 *
 * Se cuentan solo los encabezados que se ven: las pestañas que no están elegidas van en el árbol con `hidden`.
 */
import { readFileSync } from "node:fs";
import { URL as UrlDeNode } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/* La evolución de la ficha anterior pide su serie; aquí basta su cabecera, que es la pieza común de la ficha. */
vi.mock("../src/components/AssetHistoryChart", async () => {
  const { CabeceraDeSeccion } = await vi.importActual<typeof import("../src/components/ficha/CabeceraDeSeccion")>(
    "../src/components/ficha/CabeceraDeSeccion"
  );
  return {
    AssetHistoryChart: () =>
      createElement("section", null, createElement(CabeceraDeSeccion, { titulo: "Evolución histórica", procedencia: "Base 100" }))
  };
});

import { AssetDetail } from "../src/components/AssetDetail";
import { CabeceraDeSeccion } from "../src/components/ficha/CabeceraDeSeccion";
import { FichaInstrumento } from "../src/components/ficha/FichaInstrumento";
import { PESTANAS_DE_LA_FICHA, type PestanaDeLaFicha } from "../src/components/ficha/mapaDeLaFicha";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { ACCION_DE_MUESTRA, BAJA_DE_MUESTRA, FONDO_DE_MUESTRA } from "./fixtures/fichasDeMuestra";

let root: Root | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

/** Los niveles de los encabezados que se ven, en el orden del documento. */
function nivelesVisibles(): number[] {
  return [...host.querySelectorAll("h1, h2, h3, h4, h5, h6")]
    .filter((encabezado) => !encabezado.closest("[hidden]"))
    .map((encabezado) => Number(encabezado.tagName.slice(1)));
}

/** El primero es el `h1`, y ninguno baja más de un nivel respecto al anterior. Devuelve el primer salto, si lo hay. */
function primerSalto(niveles: number[]): string | null {
  if (niveles[0] !== 1) return `empieza en h${niveles[0] ?? "—"}`;
  for (let i = 1; i < niveles.length; i += 1) {
    if (niveles[i] > niveles[i - 1] + 1) return `de h${niveles[i - 1]} a h${niveles[i]}`;
  }
  return null;
}

describe("ACT-18 · la ficha nueva", () => {
  /* La pantalla monta siempre la evolución, que abre el Resumen con la cabecera de la ficha. */
  const evolucion = createElement(
    "section",
    null,
    createElement(CabeceraDeSeccion, { titulo: "Evolución histórica", procedencia: "Base 100" })
  );

  test("la cabecera de una sección es un h2, vestido por su clase", () => {
    const fuente = readFileSync(new UrlDeNode("../src/components/ficha/CabeceraDeSeccion.tsx", import.meta.url), "utf8");
    expect(fuente).toContain('<h2 className="ficha__titulo"');
    expect(fuente).not.toMatch(/<h3\b/);
    const hoja = readFileSync(new UrlDeNode("../src/styles/ficha.css", import.meta.url), "utf8");
    expect(hoja, "la hoja de la ficha no viste por etiqueta").not.toMatch(/\bh[23]\b\s*[{,]/);
  });

  for (const [nombre, ficha] of [
    ["un fondo", FONDO_DE_MUESTRA],
    ["una acción", ACCION_DE_MUESTRA],
    ["un instrumento dado de baja", BAJA_DE_MUESTRA]
  ] as const) {
    test(`${nombre}: en ninguna pestaña se salta un nivel`, async () => {
      let comprobadas = 0;
      for (const { id } of PESTANAS_DE_LA_FICHA) {
        await act(async () => {
          root!.render(createElement(FichaInstrumento, { ficha, evolucion, pestana: id as PestanaDeLaFicha }));
        });
        const elegida = host.querySelector('[role="tab"][aria-selected="true"]')?.id ?? "";
        if (!elegida.endsWith(`-${id}`)) continue; // esa pestaña no existe para este instrumento
        const niveles = nivelesVisibles();
        expect(niveles.length, `pestaña ${id}: tiene encabezados además del nombre`).toBeGreaterThan(1);
        expect(primerSalto(niveles), `pestaña ${id}`).toBeNull();
        comprobadas += 1;
      }
      expect(comprobadas).toBeGreaterThan(1);
    });
  }
});

describe("ACT-18 · la ficha anterior", () => {
  const fondo = {
    asset_id: "LU0000000001",
    isin: "LU0000000001",
    display_name: "Un fondo",
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    is_investable: true,
    quality_flags: [],
    warnings: [],
    coverage_status: "FULL",
    metrics: {},
    costs: { ongoing_charge: 0.012 },
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 },
    fundamentals_summary: { source: "yahoo", as_of_date: "2026-11-10", valuation: { pe_trailing: 14 } },
    product_profile: { product_type: "UCITS Fund" },
    description: ""
  } as unknown as BdbAssetDetail;

  test("en ninguna pestaña se salta un nivel, y las secciones son h2", async () => {
    await act(async () => {
      root!.render(createElement(AssetDetail, { asset: fondo }));
    });
    const pestanas = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].map((pestana) => pestana.textContent ?? "");
    expect(pestanas.length).toBeGreaterThan(3);
    for (const texto of pestanas) {
      const pestana = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === texto)!;
      await act(async () => pestana.click());
      const niveles = nivelesVisibles();
      expect(niveles.length, `pestaña ${texto}`).toBeGreaterThan(1);
      expect(primerSalto(niveles), `pestaña ${texto}`).toBeNull();
      expect(host.querySelector(".asset-detail-section > h3"), `pestaña ${texto}`).toBeNull();
    }
  });

  test("la hoja viste las secciones por su clase, no por la etiqueta", () => {
    const hoja = readFileSync(new UrlDeNode("../src/styles/modules.css", import.meta.url), "utf8");
    expect(hoja).not.toMatch(/\.asset-detail-(section|panel)\s*>?\s*h3\b/);
    expect(hoja).toMatch(/\.asset-detail-panel \.asset-detail-titulo/);
  });
});
