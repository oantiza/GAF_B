// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PageHeader } from "../src/components/ui/PageHeader";
import { ConfirmDialog } from "../src/components/ui/ConfirmDialog";
import { useConfirm } from "../src/components/ui/useConfirm";
import { PortfolioPositionsTable } from "../src/components/PortfolioPositionsTable";
import { CostsModal } from "../src/components/CostsModal";
import { WealthComparator } from "../src/components/WealthComparator";
import { costAssets, costPositions } from "./support/portfolioCostFixtures";

vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/commercialRetroStore", () => ({
  getCommercialRetroForAssets: async () => new Map(),
  saveCommercialRetro: async () => undefined,
  assetCommercialRetroKey: (asset: { asset_id: string } | undefined) => asset?.asset_id ?? null
}));

/* U-14 (auditoría 29-09): un solo h1 por página (PageHeader), subvistas en h2;
   toda cabecera de tabla lleva `scope` y la tabla tiene nombre accesible. */

function tableScopes(html: string): { ths: number; withScope: number; tables: number; named: number } {
  const ths = html.match(/<th\b[^>]*>/g) ?? [];
  const tables = html.match(/<table\b[^>]*>/g) ?? [];
  return {
    ths: ths.length,
    withScope: ths.filter((tag) => /\bscope="(col|row)"/.test(tag)).length,
    tables: tables.length,
    named: tables.filter((tag) => /aria-label(?:ledby)?=/.test(tag)).length
  };
}

describe("U-14 · jerarquía de encabezados", () => {
  test("PageHeader de página pinta h1 y la subvista h2", () => {
    const page = renderToStaticMarkup(<PageHeader title="Constructor" titleId="t" />);
    expect(page).toMatch(/<h1 id="t">Constructor<\/h1>/);
    expect(page).not.toMatch(/<h2/);
    const section = renderToStaticMarkup(<PageHeader level="section" title="Informe semanal" titleId="s" />);
    expect(section).toMatch(/<h2 id="s">Informe semanal<\/h2>/);
    expect(section).not.toMatch(/<h1/);
  });
});

describe("U-14 · tablas con scope y nombre", () => {
  test("tabla de posiciones del Constructor", () => {
    const html = renderToStaticMarkup(
      <PortfolioPositionsTable
        positions={[{ asset_id: "A", label: "Fondo A", weight_percent: 60 }, { asset_id: "B", label: "Fondo B", weight_percent: 40 }]}
        assets={[]}
        totalCapital={100000}
        locks={{}}
        onWeightChange={() => {}}
        onEuroChange={() => {}}
        onToggleLock={() => {}}
        onRemove={() => {}}
      />
    );
    const stats = tableScopes(html);
    expect(stats.tables).toBeGreaterThan(0);
    expect(stats.named).toBe(stats.tables);
    expect(stats.ths).toBeGreaterThan(0);
    expect(stats.withScope).toBe(stats.ths);
  });

  test("tabla de costes (diálogo, en el DOM)", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
      const stats = tableScopes(document.body.innerHTML);
      expect(stats.tables).toBeGreaterThan(0);
      expect(stats.named).toBe(stats.tables);
      expect(stats.withScope).toBe(stats.ths);
    } finally {
      await act(async () => root.unmount());
      document.body.innerHTML = "";
      vi.unstubAllGlobals();
    }
  });

  test("tabla de aportaciones del comparador patrimonial", () => {
    const html = renderToStaticMarkup(<WealthComparator />);
    const stats = tableScopes(html);
    expect(stats.tables).toBeGreaterThan(0);
    expect(stats.named).toBe(stats.tables);
    expect(stats.withScope).toBe(stats.ths);
  });
});

describe("U-17 · diálogo de confirmación", () => {
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function button(text: string) {
    const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
    if (!element) throw new Error(`Falta el botón ${text}`);
    return element;
  }

  test("ConfirmDialog es un diálogo modal con Cancelar y la acción propia", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    await act(async () =>
      root.render(<ConfirmDialog title="¿Eliminar?" message={"Línea 1\nLínea 2"} confirmLabel="Eliminar" tone="danger" onConfirm={onConfirm} onCancel={onCancel} />)
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
    expect(dialog!.querySelectorAll(".ui-dialog__body p")).toHaveLength(2);
    expect(button("Eliminar").className).toContain("danger");
    await act(async () => button("Cancelar").click());
    expect(onCancel).toHaveBeenCalledOnce();
    await act(async () => button("Eliminar").click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  test("useConfirm resuelve true al aplicar y false al cancelar", async () => {
    const results: boolean[] = [];
    function Harness() {
      const { confirm, confirmDialog } = useConfirm();
      return (
        <>
          <button type="button" onClick={() => void confirm({ title: "¿Seguro?" }).then((value) => results.push(value))}>Preguntar</button>
          {confirmDialog}
        </>
      );
    }
    await act(async () => root.render(<Harness />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => button("Preguntar").click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => button("Aplicar").click());
    expect(results).toEqual([true]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => button("Preguntar").click());
    await act(async () => button("Cancelar").click());
    expect(results).toEqual([true, false]);
  });
});
