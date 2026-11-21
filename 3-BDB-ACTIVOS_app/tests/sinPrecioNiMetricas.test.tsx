// @vitest-environment happy-dom

/**
 * Decisión 44 de Óscar (05-11-2026): las cuotas participativas de la CAM constan como «nunca resuelto», sin precio ni métricas,
 * y no entran en una cartera. Aquí, los caminos que no son el Buscador ni la ficha (esos están en sus pruebas): Sustituir, el
 * Comparador, el selector de activos, el catálogo, importar un fichero y llevar un extracto a Diseño.
 *
 * Ninguna fixture usa el ISIN de la CAM con la marca por casualidad: la regla mira el estado, y por eso el activo de estas
 * pruebas se llama de otra forma.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ searchAssetsPage: vi.fn() }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ searchAssets: vi.fn(async () => []), searchAssetsPage: mocks.searchAssetsPage })
}));
vi.mock("../src/core/useCommercialRetroData", () => ({
  useCommercialRetroData: () => ({ records: new Map(), error: null, retry: vi.fn() })
}));

import { componerFicha } from "../src/adapters/componerFicha";
import { componerFila } from "../src/adapters/componerLista";
import { AssetComparisonCatalogContent } from "../src/components/AssetComparisonCatalogModal";
import { AssetPicker } from "../src/components/AssetPicker";
import { FundSwapModal } from "../src/components/FundSwapModal";
import { NO_SE_ANADE_SIN_MEDIR, sinPrecioNiMetricas } from "../src/core/accionDeCartera";
import { isInvestableAsset } from "../src/core/assetMapping";
import { buildComparisonCatalogRows } from "../src/core/assetComparisonCatalog";
import { findSwapAlternatives, isHomogeneousAlternative, type SwapSearchMode } from "../src/core/fundSwapper";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import { positionsToPortfolio } from "../src/core/positionsToPortfolio";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const TEXTO = "No se añade: sin precio ni métricas.";

function activo(id: string, cambios: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return {
    asset_id: id,
    display_name: `Activo ${id}`,
    isin: id,
    instrument_type: "STOCK",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: { annualized_return_1y: 0.05 },
    description: "",
    sector: "Utilities",
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 },
    ...cambios
  } as BdbAssetDetail;
}
const SIN_MEDIR = activo("XS0000000001", {
  display_name: "Sin resolver, cuotas",
  is_investable: false,
  coverage_status: "ROOT_ONLY",
  quality_flags: ["NON_INVESTABLE_NEVER_RESOLVED", "MISSING_QUANT_METRICS"],
  metrics: {}
});
const CORRIENTE = activo("XS0000000002", { display_name: "Corriente" });
const FUENTE = activo("XS0000000003", { display_name: "La que se sustituye" });

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.searchAssetsPage.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("la regla", () => {
  test("el texto es el de la decisión", () => {
    expect(NO_SE_ANADE_SIN_MEDIR).toBe(TEXTO);
  });

  test("se mira la marca y nada más: ni el ISIN, ni que falten las métricas", () => {
    expect(sinPrecioNiMetricas(SIN_MEDIR)).toBe(true);
    expect(sinPrecioNiMetricas(activo("ES0114400007"))).toBe(false);
    expect(sinPrecioNiMetricas(activo("XS1", { metrics: {}, quality_flags: ["MISSING_QUANT_METRICS"] }))).toBe(false);
    expect(sinPrecioNiMetricas({})).toBe(false);
  });

  test("no es invertible, y el motivo no es ser un índice", () => {
    expect(isInvestableAsset(SIN_MEDIR)).toBe(false);
    expect(SIN_MEDIR.role).toBe("INVESTABLE");
  });

  test("la fila del Buscador lo lee de su estado, y solo de ese", () => {
    const tarjeta = (state?: string) => ({
      instrument_id: "XS1",
      instrument_type: "STOCK",
      identity: { name: "Una", currency: "EUR" },
      ...(state ? { availability: { state } } : {})
    });
    expect(componerFila(tarjeta("NEVER_RESOLVED")).sinPrecioNiMetricas).toBe(true);
    expect(componerFila(tarjeta("NEVER_RESOLVED")).dejoDeCotizar).toBeUndefined();
    for (const state of ["DELISTED", "TRADING", "UNDETERMINED", undefined]) {
      expect(componerFila(tarjeta(state)).sinPrecioNiMetricas).toBeUndefined();
    }
  });

  test("la ficha escribe el texto de la decisión, partido en sus dos líneas", () => {
    const ficha = componerFicha({
      isin: "XS1",
      raiz: { identity: { name: "Una", currency: "EUR" }, instrument_type: "STOCK", availability: { state: "NEVER_RESOLVED" } },
      tarjeta: { instrument_id: "XS1" },
      calidad: undefined,
      bloques: {}
    } as never);
    expect(ficha.disponibilidad.rotulo + ficha.disponibilidad.valor).toBe(TEXTO);
    expect(ficha.disponibilidad.estado).toBe("baja");
  });

  test("la ficha no ofrece meterla en una radiografía, aunque su tarjeta diga que el reparto se deduce", () => {
    const conEstado = (state: string) =>
      componerFicha({
        isin: "XS1",
        raiz: { identity: { name: "Una", currency: "EUR" }, instrument_type: "STOCK", availability: { state } },
        tarjeta: {
          instrument_id: "XS1",
          exposure: { asset_mix: { equity: 1 } },
          quality: { fitness: { RADIOGRAFIA_DE_CARTERA: { apt: true } } }
        },
        calidad: undefined,
        bloques: {}
      } as never).aptitudes.find((a) => a.rotulo === "Entrar en una radiografía");
    expect(conEstado("NEVER_RESOLVED")).toMatchObject({ valor: "No aplica", estado: "no-aplica" });
    expect(conEstado("TRADING")).toMatchObject({ estado: "si" });
  });
});

describe("Sustituir", () => {
  test("entre las alternativas homogéneas no sale: esa lista propone", () => {
    expect(isHomogeneousAlternative(FUENTE, SIN_MEDIR)).toBe(false);
    const alternativas = findSwapAlternatives(FUENTE, [SIN_MEDIR, CORRIENTE], [], "homogeneous", 8);
    expect(alternativas.map(({ asset }) => asset.asset_id)).toEqual([CORRIENTE.asset_id]);
  });

  test("en «Elegir otro activo» se ve y se marca, sin «Cambiar»", async () => {
    const alSustituir = vi.fn();
    const buscar = vi.fn(async (_id: string, modo?: SwapSearchMode) =>
      findSwapAlternatives(FUENTE, [SIN_MEDIR, CORRIENTE], [], modo ?? "homogeneous", Number.POSITIVE_INFINITY)
    );
    await act(async () =>
      root?.render(
        createElement(FundSwapModal, {
          assets: [FUENTE],
          positions: [{ asset_id: FUENTE.asset_id, weight_percent: 100 }],
          onFindAlternatives: buscar,
          onSwap: alSustituir,
          onClose: vi.fn()
        })
      )
    );
    const elegir = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Elegir otro activo");
    await act(async () => elegir?.click());
    await act(async () => {
      await Promise.resolve();
    });
    const filas = [...document.querySelectorAll("tbody tr")];
    const suya = filas.find((fila) => fila.textContent?.includes("Sin resolver, cuotas"));
    expect(suya?.textContent).toContain(TEXTO);
    expect(suya?.querySelector("button[aria-label^='Cambiar']")).toBeNull();
    expect(filas.find((fila) => fila.textContent?.includes("Corriente"))?.querySelector("button[aria-label='Cambiar por Corriente']")).not.toBeNull();
  });

  test("una cartera que ya la lleva puede sustituirla: es la forma de quitarla", () => {
    const alternativas = findSwapAlternatives(SIN_MEDIR, [SIN_MEDIR, CORRIENTE], [], "custom", Number.POSITIVE_INFINITY);
    expect(alternativas.map(({ asset }) => asset.asset_id)).toEqual([CORRIENTE.asset_id]);
  });
});

describe("el selector de activos", () => {
  test("se ve y se marca, y no se puede elegir", async () => {
    mocks.searchAssetsPage.mockResolvedValue({ results: [SIN_MEDIR, CORRIENTE], totalMatches: 2, nextCursor: null });
    const elegidos: string[] = [];
    await act(async () =>
      root?.render(
        createElement(AssetPicker, { sourceKind: "LOCAL_MOCK", selectedIds: [], max: 5, onPick: (a) => elegidos.push(a.asset_id) })
      )
    );
    const filas = [...host.querySelectorAll<HTMLButtonElement>(".asset-picker-row")];
    const suya = filas.find((fila) => fila.textContent?.includes("Sin resolver, cuotas"));
    expect(suya?.textContent).toContain(TEXTO);
    expect(suya?.disabled).toBe(true);
    await act(async () => suya?.click());
    expect(elegidos).toEqual([]);
    const corriente = filas.find((fila) => fila.textContent?.includes("Corriente"));
    expect(corriente?.textContent).not.toContain(TEXTO);
    await act(async () => corriente?.click());
    expect(elegidos).toEqual([CORRIENTE.asset_id]);
  });
});

describe("el catálogo del Comparador", () => {
  const pintar = (stagedIds: string[] = []) =>
    renderToStaticMarkup(
      createElement(AssetComparisonCatalogContent, {
        rows: buildComparisonCatalogRows([SIN_MEDIR, CORRIENTE], new Map(), []),
        stagedIds,
        max: 5,
        onToggle: () => undefined,
        onCancel: () => undefined,
        onApply: () => undefined
      })
    );

  test("se ve con su motivo, y su casilla no se puede marcar", () => {
    const html = pintar();
    expect(html).toContain(TEXTO);
    const casilla = /<input[^>]*aria-label="Seleccionar Sin resolver, cuotas"[^>]*>/.exec(html)?.[0];
    expect(casilla).toContain("disabled");
    expect(/<input[^>]*aria-label="Seleccionar Corriente"[^>]*>/.exec(html)?.[0]).not.toContain("disabled");
  });

  test("si ya estaba marcada, se puede desmarcar", () => {
    const casilla = /<input[^>]*aria-label="Quitar Sin resolver, cuotas"[^>]*>/.exec(pintar([SIN_MEDIR.asset_id]))?.[0];
    expect(casilla).not.toContain("disabled");
  });
});

describe("importar un fichero que la trae", () => {
  const importar = (texto: string) =>
    buildLocalPortfolioImport({
      sourceKind: "BBDD_LIVE_API",
      text: texto,
      resolveAsset: (id) => [SIN_MEDIR, CORRIENTE].find((a) => a.asset_id === id) ?? null
    });

  test("la línea se rechaza con su motivo, y no como un índice", async () => {
    const resultado = await importar(`asset_id,peso\n${SIN_MEDIR.asset_id},40\n${CORRIENTE.asset_id},60`);
    expect(resultado.imported_positions.map((p) => p.asset_id)).toEqual([CORRIENTE.asset_id]);
    expect(resultado.rejected_positions).toHaveLength(1);
    expect(resultado.rejected_positions[0]).toMatchObject({
      asset_id: SIN_MEDIR.asset_id,
      weight_percent: 40,
      reason: "NON_INVESTABLE_NEVER_RESOLVED",
      message: TEXTO
    });
    expect(JSON.stringify(resultado)).not.toContain("Índice no invertible");
    /* Lo que queda no se reparte en silencio: 60 no suma 100, y se dice. */
    expect(resultado.warnings.join(" ")).toContain("60,0\u00a0%");
  });

  test("un fichero que solo la trae a ella no carga nada, y lo dice", async () => {
    const resultado = await importar(`${SIN_MEDIR.asset_id},100`);
    expect(resultado.imported_positions).toEqual([]);
    expect(resultado.warnings).toContain("No hay posiciones válidas para cargar.");
  });
});

describe("llevar un extracto a Diseño de cartera", () => {
  test("se queda fuera, con su importe, y el resto pasa sobre lo que queda", () => {
    const envio = positionsToPortfolio([
      { id: SIN_MEDIR.asset_id, amount: 400, asset: SIN_MEDIR },
      { id: CORRIENTE.asset_id, amount: 600, asset: CORRIENTE }
    ]);
    expect(envio.excludedIds).toEqual([SIN_MEDIR.asset_id]);
    expect(envio.excludedCapital).toBe(400);
    expect(envio.totalCapital).toBe(600);
    expect(envio.positions).toEqual([{ asset_id: CORRIENTE.asset_id, label: "Corriente", weight_percent: 100 }]);
  });
});
