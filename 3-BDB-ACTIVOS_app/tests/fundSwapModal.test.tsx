// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FundSwapModal } from "../src/components/FundSwapModal";
import { PortfolioPositionsTable } from "../src/components/PortfolioPositionsTable";
import { findSwapAlternatives, type SwapAlternative, type SwapSearchMode } from "../src/core/fundSwapper";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../src/core/textosDeCartera";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const retroHook = vi.hoisted(() => vi.fn(() => ({ records: new Map(), error: null, retry: vi.fn() })));
vi.mock("../src/core/useCommercialRetroData", () => ({ useCommercialRetroData: retroHook }));

function asset(id: string, overrides: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return { asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}, description: "",
    region: "Europe", category: "Global Equity", ...overrides } as BdbAssetDetail;
}
const source = asset("Fondo actual");
const stockSource = asset("Acción actual", { instrument_type: "STOCK", sector: "Utilities" });
const candidates = [asset("Fondo similar"), asset("Fondo de bonos", { economic_asset_class: "FIXED_INCOME", category: "Corporate" }),
  asset("ETF alternativo", { instrument_type: "ETF" }), asset("Acción alternativa", { instrument_type: "STOCK", sector: "Utilities" })];
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  retroHook.mockClear();
});

async function mount(find = vi.fn(async (id: string, mode?: SwapSearchMode) => findSwapAlternatives(id === source.asset_id ? source : stockSource, candidates, [], mode, Infinity))) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onSwap = vi.fn();
  const onClose = vi.fn();
  await act(async () => root?.render(createElement(FundSwapModal, {
    assets: [source, stockSource], positions: [{ asset_id: source.asset_id, weight_percent: 25 }, { asset_id: stockSource.asset_id, weight_percent: 75 }],
    onFindAlternatives: find, onSwap, onClose, totalCapital: 100000,
  })));
  return { find, onSwap, onClose };
}

function button(text: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text);
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function select(label: string, value: string) {
  /* Rediseño del 14-11-2026: cada control va en un `Campo`, cuyo rótulo lo nombra por `for` en vez de envolverlo. */
  const rotulo = [...document.querySelectorAll<HTMLLabelElement>("label.field__label")].find((element) => element.textContent === label);
  const field = rotulo ? document.getElementById(rotulo.htmlFor)?.closest("select") ?? null : null;
  if (!field) throw new Error(`Missing select ${label}`);
  await act(async () => { field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); });
}
const rowNames = () => [...document.querySelectorAll("tbody .tabla-de-alternativas__nombre")].map((node) => node.textContent);

describe("sustituir una posición", () => {
  test("«Cambiar» aplica en el momento, así que lo que no incluye está a la vista antes de pulsar", async () => {
    await mount();
    expect(button("Cerrar").closest("footer")?.textContent).toContain(SIN_COMISIONES_NI_IMPUESTOS);
  });

  test("la tabla solo muestra el importe y no consulta retrocesiones", () => {
    const html = renderToStaticMarkup(createElement(PortfolioPositionsTable, {
      assets: [source], positions: [{ asset_id: source.asset_id, weight_percent: 25 }], totalCapital: 100000, locks: {},
      onRemove: vi.fn(), onWeightChange: vi.fn(), onEuroChange: vi.fn(), onToggleLock: vi.fn(),
    }));
    expect(html).toContain("Importe");
    expect(html.toLowerCase()).not.toContain("retro");
    expect(retroHook).not.toHaveBeenCalled();
  });

  test("arranca homogéneo y filtra vehículos incorrectos incluso si llegan en la respuesta", async () => {
    const find = vi.fn(async () => candidates.map((asset): SwapAlternative => ({ asset, tier: 1, score: 1 })));
    await mount(find);
    expect(find).toHaveBeenCalledWith(source.asset_id, "homogeneous");
    expect(rowNames()).toEqual(["Fondo similar"]);
    expect(button("Alternativas homogéneas").getAttribute("aria-pressed")).toBe("true");
  });

  test("permite elegir fondos de renta fija y otro vehículo conservando el importe", async () => {
    const { onSwap, onClose } = await mount();
    await click("Elegir otro activo");
    await select("Clase de activo", "FIXED_INCOME");
    expect(rowNames()).toEqual(["Fondo de bonos"]);
    await select("Categoría", "Corporate");
    expect(rowNames()).toEqual(["Fondo de bonos"]);
    await select("Producto", "ETF");
    expect(rowNames()).toEqual(["ETF alternativo"]);
    await click("Mantener €");
    await click("Cambiar");
    // U-17: la confirmación de divergencias es un diálogo del sistema, no window.confirm.
    const confirmDialog = document.querySelector(".ui-confirm-dialog");
    expect(confirmDialog).not.toBeNull();
    expect(confirmDialog!.textContent).toContain("La sustitución cambia estas características");
    expect(onSwap).not.toHaveBeenCalled();
    await click("Aplicar la sustitución");
    expect(onSwap).toHaveBeenCalledWith(source.asset_id, "ETF alternativo", "ETF alternativo", { preserveMode: "money", targetEuros: 25000 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("DIS-26: con «Mantener €» se dice antes de cambiar que la nueva posición queda con importe fijo", async () => {
    await mount();
    expect(document.body.textContent).not.toContain("queda con importe fijo");
    await click("Mantener €");
    /* 25 % de 100.000 € = 25.000 €. */
    expect(document.body.textContent?.replace(/\u00a0/g, " ")).toContain("La nueva posición queda con importe fijo: conserva sus 25.000,00 €");
  });

  test("la búsqueda libre permite recorrer más de veinte resultados", async () => {
    const alternatives = Array.from({ length: 45 }, (_, index): SwapAlternative => ({ asset: asset(`Fondo ${index + 1}`), tier: 3, score: 1 }));
    await mount(vi.fn(async () => alternatives));
    await click("Elegir otro activo");
    expect(rowNames()).toHaveLength(20);
    await click("Mostrar más");
    expect(rowNames()).toHaveLength(40);
    await click("Mostrar más");
    expect(rowNames()).toHaveLength(45);
    expect(document.body.textContent).toContain("45 de 45 alternativas");
  });

  test("cambiar la posición vuelve al modo homogéneo y al vehículo de la nueva posición", async () => {
    const { find } = await mount();
    await click("Elegir otro activo");
    await select("Posición a sustituir", stockSource.asset_id);
    expect(button("Alternativas homogéneas").getAttribute("aria-pressed")).toBe("true");
    expect(find).toHaveBeenLastCalledWith(stockSource.asset_id, "homogeneous");
    expect(rowNames()).toEqual(["Acción alternativa"]);
  });

  describe("las alternativas de una acción (decisión 16)", () => {
    const montaUna = async (fuente: BdbAssetDetail, universo: BdbAssetDetail[]) => {
      const container = document.body.appendChild(document.createElement("div"));
      root = createRoot(container);
      await act(async () => root?.render(createElement(FundSwapModal, {
        assets: [fuente], positions: [{ asset_id: fuente.asset_id, weight_percent: 100 }],
        onFindAlternatives: vi.fn(async (_id: string, mode?: SwapSearchMode) => findSwapAlternatives(fuente, universo, [], mode, Infinity)), onSwap: vi.fn(), onClose: vi.fn(), totalCapital: 100000,
      })));
    };
    const iberdrola = asset("Iberdrola", { instrument_type: "STOCK", sector: "Utilities", region: "Iberia" });
    const accion = (nombre: string, sector: string | undefined, region: string) => asset(nombre, { instrument_type: "STOCK", sector, region });

    test("con Iberdrola: fuera bancos y aerolínea, y dice por qué están las que están", async () => {
      await montaUna(iberdrola, [accion("Santander", "Financial Services", "Iberia"), accion("IAG", "Industrials", "Iberia"), accion("Endesa", "Utilities", "Iberia"), accion("NextEra", "Utilities", "EE.UU.")]);
      expect(rowNames()).toEqual(["Endesa", "NextEra"]);
      expect(document.body.textContent).toContain("Acciones de su sector: Utilities.");
      expect(document.body.textContent).toContain("el orden no mira la rentabilidad pasada");
      /* El distintivo de cada una, y de qué sector es en vez de «Renta variable». */
      const filas = [...document.querySelectorAll(".tabla-de-alternativas tbody tr")].map((tr) => tr.textContent ?? "");
      expect(filas[0]).toContain("Muy afín");
      expect(filas[0]).toContain("Acción · Utilities · Iberia");
      expect(filas[1]).toContain("Afín");
      expect(filas[1]).not.toContain("Muy afín");
    });

    test("sin sector: no se puede proponer un equivalente, y sigue «Elegir otro activo»", async () => {
      const sinSector = accion("Sin sector", undefined, "Iberia");
      await montaUna(sinSector, [accion("Endesa", "Utilities", "Iberia")]);
      expect(rowNames()).toEqual([]);
      expect(document.body.textContent).toContain("No se puede proponer un equivalente: no tenemos el sector de esta acción. Puedes usar «Elegir otro activo».");
      await click("Elegir otro activo");
      expect(rowNames()).toEqual(["Endesa"]);
    });

    test("elegir una de otro sector avisa de que cambia el sector", async () => {
      await montaUna(iberdrola, [accion("Santander", "Financial Services", "Iberia")]);
      await click("Elegir otro activo");
      await act(async () => button("Cambiar").click());
      expect(document.body.textContent).toContain("sector: Utilities → Financieras");
    });
  });

  describe("lo que no aplica a una acción", () => {
    const stockB = asset("Acción B", { instrument_type: "STOCK", sector: "Utilities", metrics: { annualized_return_3y: 0.1, volatility_3y: 0.2, sharpe_3y: 1.23 } });
    const fundB = asset("Fondo B", { metrics: { annualized_return_3y: 0.1, volatility_3y: 0.2, sharpe_3y: 0.87 } });
    const headers = () => [...document.querySelectorAll(".tabla-de-alternativas thead th")].map((th) => th.textContent);
    const row = (name: string) =>
      [...document.querySelectorAll(".tabla-de-alternativas tbody tr")].find((tr) => tr.textContent?.includes(name))?.textContent ?? "";

    test("en una tabla solo de acciones la columna del Sharpe no sale, ni su cifra", async () => {
      const container = document.body.appendChild(document.createElement("div"));
      root = createRoot(container);
      await act(async () => root?.render(createElement(FundSwapModal, {
        assets: [stockSource], positions: [{ asset_id: stockSource.asset_id, weight_percent: 100 }],
        onFindAlternatives: vi.fn(async () => [{ asset: stockB, tier: 1, score: 1 }] as SwapAlternative[]), onSwap: vi.fn(), onClose: vi.fn(), totalCapital: 100000,
      })));
      expect(rowNames()).toEqual(["Acción B"]);
      expect(headers()).not.toContain("Sharpe 3A");
      expect(row("Acción B")).not.toContain("1,23");
      /* La retrocesión tampoco le aplica: no es que falte, y por eso sus columnas no salen. */
      expect(headers()).not.toContain("Retrocesión");
      expect(row("Acción B")).not.toContain("N/D");
      /* Y lo que dice de la posición actual, igual. */
      expect(document.querySelector(".swap-retro-controls")?.textContent).toContain("No aplica");
    });

    test("en una tabla mixta la celda dice No aplica, y la del fondo sigue con su cifra", async () => {
      await mount(vi.fn(async () => [{ asset: fundB, tier: 3, score: 1 }, { asset: stockB, tier: 3, score: 1 }] as SwapAlternative[]));
      await click("Elegir otro activo");
      await select("Producto", "ALL");
      expect(rowNames()).toEqual(expect.arrayContaining(["Fondo B", "Acción B"]));
      expect(headers()).toContain("Sharpe 3A");
      expect(row("Fondo B")).toContain("0,87");
      expect(row("Acción B")).toContain("No aplica");
      expect(row("Acción B")).not.toContain("1,23");
      expect(row("Acción B")).not.toContain("N/D");
    });
  });

  describe("ordenar por lo que cobra el asesor (decisión 17)", () => {
    const retro = (retro_pct: number) => ({ isin: "X", retro_pct, as_of_date: "2026-11-01", source: "prueba" });
    const alta = asset("Retro alta, poca afinidad");
    const baja = asset("Retro baja, muy afín");

    test("no hay casilla ni distintivo, y la retrocesión queda como dato en su columna", async () => {
      retroHook.mockReturnValue({ records: new Map([[alta.asset_id, retro(1.5)], [baja.asset_id, retro(0.25)], [source.asset_id, retro(0.5)]]), error: null, retry: vi.fn() });
      await mount(vi.fn(async () => [{ asset: alta, tier: 3, score: 1 }, { asset: baja, tier: 1, score: 1 }] as SwapAlternative[]));
      const texto = document.body.textContent ?? "";
      expect(texto).not.toContain("Máxima retrocesión");
      expect(texto).not.toContain("Mejor retrocesión");
      expect(document.querySelector('.swap-retro-controls input[type="checkbox"]')).toBeNull();
      /* El orden es el de la afinidad, aunque la otra pague el triple. */
      expect(rowNames()).toEqual([baja.display_name, alta.display_name]);
      const encabezados = [...document.querySelectorAll(".tabla-de-alternativas thead th")].map((th) => th.textContent);
      expect(encabezados).toEqual(expect.arrayContaining(["Rent. 3A (Rentabilidad 3 años)", "Vol. 3A (Volatilidad 3 años)", "Retrocesión", "Diferencia"]));
      /* Y por ella no se puede ordenar: su título no es un botón. */
      expect(document.querySelector(".tabla-de-alternativas thead button")).toBeNull();
      const filaDeLaAlta = [...document.querySelectorAll(".tabla-de-alternativas tbody tr")].find((tr) => tr.textContent?.includes(alta.display_name));
      expect(filaDeLaAlta?.textContent).toContain("1,50\u00a0%");
      expect(filaDeLaAlta?.textContent).toContain("+1,00\u00a0pp");
      retroHook.mockReturnValue({ records: new Map(), error: null, retry: vi.fn() });
    });
  });

  test("descarta respuestas de un modo anterior y permite reintentar un catálogo fallido", async () => {
    let resolveCustom: (rows: SwapAlternative[]) => void = () => undefined;
    const find = vi.fn(async (_id: string, mode?: SwapSearchMode) => mode === "custom"
      ? new Promise<SwapAlternative[]>((resolve) => { resolveCustom = resolve; })
      : findSwapAlternatives(source, candidates));
    await mount(find);
    await click("Elegir otro activo");
    await click("Alternativas homogéneas");
    await act(async () => resolveCustom([{ asset: candidates[3], tier: 4, score: 10 }]));
    expect(rowNames()).toEqual(["Fondo similar"]);
    find.mockRejectedValueOnce(new Error("No se pudo cargar el catálogo"));
    await click("Elegir otro activo");
    expect(document.body.textContent).toContain("No se pudo cargar el catálogo");
    find.mockResolvedValueOnce(findSwapAlternatives(source, candidates, [], "custom", Infinity));
    await click("Reintentar");
    expect(rowNames()).toEqual(["Fondo similar", "Fondo de bonos"]);
  });
});
