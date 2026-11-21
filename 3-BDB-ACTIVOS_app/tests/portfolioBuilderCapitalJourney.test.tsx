// @vitest-environment happy-dom

/**
 * A6 (auditoría 06-09-2026): el capital del informe se copiaba a estado local al
 * montar el Constructor. Las rutas «Constructor» e «Informe de cliente» montan la
 * MISMA página, así que la copia sobrevivía a la importación de un extracto y el
 * informe salía con el capital anterior —100.000 € por defecto— repartiendo mal
 * todos los importes por posición.
 *
 * Esta prueba recorre el camino completo: cartera montada, importación de un
 * extracto que trae su propio patrimonio, y las DOS entradas al informe —el botón
 * del Constructor y la entrada por el rail, que cambia la ruta y con ella la
 * `view` de la MISMA página montada (CRIT-04)—. En ambas el informe tiene que
 * recibir el capital vivo.
 */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { BdbPortfolioImportResult } from "../src/types/bdbAssets";

const CAPITAL_POR_DEFECTO = 100000;
const CAPITAL_DEL_EXTRACTO = 250000;

/** El extracto importado: una posición y su patrimonio detectado. */
const importResult = {
  imported_positions: [{ asset_id: "LU0996182563", weight_percent: 100, label: "Fondo importado" }],
  rejected_positions: [],
  detected_capital: CAPITAL_DEL_EXTRACTO,
  source_label: "Extracto de prueba",
  warnings: []
} as unknown as BdbPortfolioImportResult;

vi.mock("../src/core/portfolioImport", () => ({
  buildLocalPortfolioImport: async () => importResult
}));

/* Los dos hijos se sustituyen por testigos: el Constructor solo tiene que poder
   disparar la importación y la apertura del informe; el informe solo tiene que
   decir con qué capital lo han llamado. Lo que se prueba es la página de en medio. */
vi.mock("../src/components/PortfolioBuilder", () => ({
  PortfolioBuilder: ({
    onImportText,
    onConfirmImport,
    onOpenReport,
    initialCapital
  }: {
    onImportText: (text: string) => Promise<void>;
    onConfirmImport?: () => void;
    onOpenReport: (locked: Record<string, number>) => void;
    initialCapital: number;
  }) =>
    createElement("div", null,
      createElement("output", { id: "capital-constructor" }, String(initialCapital)),
      createElement("button", { id: "importar", onClick: () => void onImportText("extracto") }, "Importar"),
      // Séptima pasada: la importación se aplica al confirmarla.
      createElement("button", { id: "confirmar", onClick: () => onConfirmImport?.() }, "Confirmar"),
      createElement("button", { id: "abrir-informe", onClick: () => onOpenReport({}) }, "Informe")
    )
}));

vi.mock("../src/pages/PortfolioReportPage", () => ({
  PortfolioReportPage: ({ totalCapital, positions }: { totalCapital: number; positions: unknown[] }) =>
    createElement("output", { id: "capital-informe" },
      `${totalCapital} · ${positions.length} posiciones`)
}));

const { PortfolioBuilderPage } = await import("../src/pages/PortfolioBuilderPage");

/** Cáscara equivalente a la de la app: el capital, las posiciones y la RUTA son
 *  SUYOS. El botón «rail-informe» hace lo que el rail: cambiar la ruta. */
function Shell() {
  const [positions, setPositions] = useState([
    { asset_id: "IE00B03HCZ61", weight_percent: 100, label: "Fondo inicial" }
  ]);
  const [totalCapital, setTotalCapital] = useState(CAPITAL_POR_DEFECTO);
  const [portfolioName, setPortfolioName] = useState("Cartera de prueba");
  const [view, setView] = useState<"builder" | "report">("builder");
  return createElement("div", null,
    createElement("button", { id: "rail-informe", onClick: () => setView("report") }, "Informe de cliente"),
    createElement(PortfolioBuilderPage, {
      positions,
      setPositions,
      sourceKind: "BBDD_STATIC_EXPORT_SAMPLE",
      totalCapital,
      onCapitalChange: setTotalCapital,
      portfolioName,
      onPortfolioNameChange: setPortfolioName,
      view,
      onViewChange: setView
    } as never)
  );
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Shell)); });
  return {
    host,
    root,
    click: async (id: string) => {
      const button = host.querySelector<HTMLButtonElement>(`#${id}`);
      expect(button, `falta el botón #${id}`).not.toBeNull();
      await act(async () => { button!.click(); });
    },
    text: (id: string) => host.querySelector(`#${id}`)?.textContent ?? ""
  };
}

describe("A6: el capital del extracto llega al informe por los dos caminos", () => {
  test("importar y abrir el informe desde el Constructor usa el capital del extracto", async () => {
    const view = await mount();
    expect(view.text("capital-constructor")).toBe(String(CAPITAL_POR_DEFECTO));

    await view.click("importar");
    expect(view.text("capital-constructor")).toBe(String(CAPITAL_POR_DEFECTO));
    await view.click("confirmar");
    expect(view.text("capital-constructor")).toBe(String(CAPITAL_DEL_EXTRACTO));

    await view.click("abrir-informe");
    expect(view.text("capital-informe")).toContain(String(CAPITAL_DEL_EXTRACTO));
    expect(view.text("capital-informe")).not.toContain(String(CAPITAL_POR_DEFECTO));
    view.root.unmount();
  });

  test("importar y entrar por el rail al informe usa el capital del extracto", async () => {
    /* El rail no desmonta la página: cambia la ruta y con ella `view`. Aquí
       vivía A6: la copia local del capital sobrevivía al cambio. */
    const view = await mount();
    await view.click("importar");
    await view.click("confirmar");
    expect(view.text("capital-constructor")).toBe(String(CAPITAL_DEL_EXTRACTO));

    // Entrada por el rail sobre la MISMA página montada.
    await view.click("rail-informe");
    const informe = view.text("capital-informe");
    expect(informe).toContain(String(CAPITAL_DEL_EXTRACTO));
    expect(informe).not.toContain(String(CAPITAL_POR_DEFECTO));
    view.root.unmount();
  });
});
