import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.stubGlobal("document", { body: {} });

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: ReactNode) => children
}));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { AssetComparison } from "../src/components/AssetComparison";
import { AssetComparisonCatalogContent } from "../src/components/AssetComparisonCatalogModal";
import { CostsModal } from "../src/components/CostsModal";
import { FundSwapModal } from "../src/components/FundSwapModal";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";

function asset(id: string): BdbAssetDetail {
  return {
    asset_id: id, display_name: `Fondo ${id}`, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "",
    metrics: { annualized_return_1y: 0.05, annualized_return_3y: 0.06, volatility_3y: 0.1, sharpe_3y: 0.6 },
    costs: { ongoing_charge: 0.012 }, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 }
  };
}

function client(node: ReactNode): string {
  return renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: true, children: node }));
}

describe("modo cliente", () => {
  test("retro no aparece en Comparador ni Ver Todos", () => {
    const assets = [asset("A"), asset("B")];
    const comparison = client(createElement(AssetComparison, { assets, sourceKind: "BBDD_LIVE_API", onRemove: () => undefined }));
    const catalog = client(createElement(AssetComparisonCatalogContent, {
      rows: [{ asset: assets[0], ongoingCharge: 0.012, retroRate: 0.007, annualizedReturn1y: 0.05 }], stagedIds: [], max: 5,
      onToggle: () => undefined, onCancel: () => undefined, onApply: () => undefined
    }));
    expect(`${comparison}${catalog}`.toLocaleLowerCase("es")).not.toContain("retro");
  });

  test("retro no aparece en CostsModal, PositionsWorkbench ni FundSwapModal", () => {
    const assets = [asset("A")];
    const positions = [{ asset_id: "A", weight_percent: 100 }];
    const costs = client(createElement(CostsModal, { assets, positions, totalCapital: 100000, onClose: () => undefined }));
    const analyzer = client(createElement(PositionsWorkbench, { mode: "extracto" as const, sourceKind: "BBDD_LIVE_API" })) + client(createElement(PositionsWorkbench, { mode: "global" as const, sourceKind: "BBDD_LIVE_API" }));
    const swap = client(createElement(FundSwapModal, {
      assets, positions, totalCapital: 100000, onClose: () => undefined,
      onFindAlternatives: async () => [], onSwap: () => undefined
    }));
    expect(`${costs}${analyzer}${swap}`.toLocaleLowerCase("es")).not.toContain("retro");
  });

  test("CostsModal sin capital: la frase y el porcentaje, ni retrocesión, ni ingreso, ni la cocina de costes conocidos", () => {
    const costs = client(createElement(CostsModal, { assets: [asset("A")], positions: [{ asset_id: "A", weight_percent: 100 }], onClose: () => undefined })).replace(/\u00a0/g, " ");
    expect(costs).toContain("1,20 % al año, unos 120 € por cada 10.000 €");
    expect(costs).toContain("Capital sin fijar");
    expect(costs.toLocaleLowerCase("es")).not.toContain("retro");
    expect(costs).not.toContain("Ingreso");
    expect(costs).not.toContain("Costes conocidos");
    expect(costs).toContain("Descargar el informe");
  });
});
