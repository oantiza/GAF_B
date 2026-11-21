// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { SwapSelectionOptions } from "../src/core/fundSwapPresentation";

/*
 * T12: al sustituir una posición en Diseño, el aviso cerraba con un punto detrás del nombre, y con «Iberdrola S.A.» salía «Posición sustituida
 * por Iberdrola S.A..». Es la errata que la decisión 80 quitó del papel y T11 de «Fuera del cálculo». Visto pulsando en la base nueva al cambiar
 * Endesa por Iberdrola desde su fila. Aquí se prueba la página: el constructor se sustituye por un botón que pide la sustitución y enseña el aviso.
 */
vi.mock("../src/components/PortfolioBuilder", () => ({
  PortfolioBuilder: ({ onSwap, portfolioNotice }: {
    onSwap: (oldId: string, newId: string, newLabel: string, options: SwapSelectionOptions) => void;
    portfolioNotice: string | null;
  }) => (
    <>
      <button id="por-iberdrola" onClick={() => onSwap("ES0130670112", "ES0144580Y14", "Iberdrola S.A.", { preserveMode: "weight" })}>Iberdrola</button>
      <button id="por-naturgy" onClick={() => onSwap("ES0130670112", "ES0116870314", "Naturgy Energy Group SA", { preserveMode: "weight" })}>Naturgy</button>
      <output id="aviso">{portfolioNotice ?? ""}</output>
    </>
  )
}));
vi.mock("../src/adapters/assetDataSource", () => {
  const dataSource = {
    getComparableAssets: async () => [],
    buildManualPortfolioSummary: async () => null,
    buildManualPortfolioOptimizationPreview: async () => null
  };
  return { getAssetDataSource: () => dataSource };
});
vi.mock("../src/pages/PortfolioReportPage", () => ({ PortfolioReportPage: () => null }));

const { PortfolioBuilderPage } = await import("../src/pages/PortfolioBuilderPage");
const { clearSessionCaches } = await import("../src/core/sessionCaches");

const POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "ES0130670112", weight_percent: 50, label: "Endesa SA" },
  { asset_id: "IE00B4L5Y983", weight_percent: 50, label: "iShares Core MSCI World UCITS ETF USD (Acc)" }
];

function Cascara() {
  const [positions, setPositions] = useState(POSICIONES);
  const [nombre, setNombre] = useState("Prueba");
  return (
    <PortfolioBuilderPage positions={positions} setPositions={setPositions} totalCapital={100000} onCapitalChange={() => undefined}
      sourceKind="BBDD_STATIC_EXPORT_SAMPLE" portfolioName={nombre} onPortfolioNameChange={setNombre} view="builder" onViewChange={() => undefined} />
  );
}

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearSessionCaches();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

const pulsa = async (id: string) => act(async () => document.querySelector<HTMLButtonElement>(`#${id}`)!.click());
const aviso = () => document.querySelector("#aviso")?.textContent;

test("un nombre que acaba en punto no deja dos en el aviso", async () => {
  await act(async () => root.render(<Cascara />));
  await pulsa("por-iberdrola");
  expect(aviso()).toBe("Posición sustituida por Iberdrola S.A.");
});

test("un nombre que no acaba en punto sigue cerrando con el suyo", async () => {
  await act(async () => root.render(<Cascara />));
  await pulsa("por-naturgy");
  expect(aviso()).toBe("Posición sustituida por Naturgy Energy Group SA.");
});
