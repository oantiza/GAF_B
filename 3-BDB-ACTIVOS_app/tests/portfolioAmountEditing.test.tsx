// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PortfolioPositionsTable } from "../src/components/PortfolioPositionsTable";
import { PortfolioBuilderPage, type PortfolioPageView } from "../src/pages/PortfolioBuilderPage";
import { clearSessionCaches } from "../src/core/sessionCaches";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

// Se prueban la página, el constructor y sus campos reales. Solo se aíslan
// las lecturas externas y el render del informe: no hay escrituras de clientes.
vi.mock("../src/adapters/assetDataSource", () => {
  const dataSource = {
    getComparableAssets: async () => [],
    buildManualPortfolioSummary: async () => null,
    buildManualPortfolioOptimizationPreview: async () => null
  };
  return { getAssetDataSource: () => dataSource };
});
vi.mock("../src/components/FrontierPanel", () => ({ FrontierPanel: () => null }));
vi.mock("../src/pages/PortfolioReportPage", () => ({
  PortfolioReportPage: ({ totalCapital, positions }: { totalCapital: number; positions: BdbManualPortfolioPosition[] }) =>
    <output id="report-input">{JSON.stringify({ totalCapital, positions })}</output>
}));

const startingPositions = [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }];
let root: Root;

function Shell({ initialPositions = startingPositions, initialCapital = 100000 }: {
  initialPositions?: BdbManualPortfolioPosition[]; initialCapital?: number;
}) {
  const [positions, setPositions] = useState(initialPositions);
  const [capital, setCapital] = useState(initialCapital);
  const [name, setName] = useState("Prueba de importes");
  // La vista sale de la ruta (CRIT-04): la cáscara hace de router.
  const [view, setView] = useState<PortfolioPageView>("builder");
  return <>
    <button id="add-position" onClick={() => setPositions((current) => [...current, { asset_id: "C", weight_percent: 0 }])}>Añadir posición</button>
    <button id="ir-al-informe" onClick={() => setView("report")}>Ir al informe</button>
    <output id="shell-state">{JSON.stringify({ totalCapital: capital, positions })}</output>
    <PortfolioBuilderPage positions={positions} setPositions={setPositions} totalCapital={capital} onCapitalChange={(value) => setCapital(value ?? 0)}
      sourceKind="BBDD_STATIC_EXPORT_SAMPLE" portfolioName={name} onPortfolioNameChange={setName} view={view} onViewChange={setView} />
  </>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearSessionCaches();
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; localStorage.clear(); vi.unstubAllGlobals(); });

function input(assetId: string) { return document.querySelector<HTMLInputElement>(`input[aria-label="Importe en euros de ${assetId}"]`)!; }
function state() { return JSON.parse(document.querySelector("#shell-state")!.textContent!); }
async function editAmount(assetId: string, value: string, enter = false) {
  const element = input(assetId);
  expect(element.disabled).toBe(false);
  await act(async () => element.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    if (enter) element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    else element.blur();
  });
}
async function button(text: string) {
  const target = [...document.querySelectorAll("button")].find((b) => b.textContent === text);
  expect(target).toBeDefined();
  await act(async () => target!.click());
}

describe("introducir importes en el constructor", () => {
  test("posición nueva → importe → capital y pesos → informe, conservando las demás posiciones", async () => {
    await act(async () => root.render(<Shell />));
    await button("Añadir posición");
    expect(input("C").value).toBe("0");
    expect(state().totalCapital).toBe(100000);
    await editAmount("C", "10.000,25", true);
    expect(state().totalCapital).toBe(110000.25);
    expect(input("A").value).toBe("60.000");
    expect(input("B").value).toBe("40.000");
    expect(input("C").value).toBe("10.000,25");
    expect(state().positions.reduce((sum: number, p: BdbManualPortfolioPosition) => sum + p.weight_percent, 0)).toBeCloseTo(100, 12);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Capital total en euros"]')!.value).toBe("110.000,25");
    expect(document.querySelector('[aria-label="Datos de la propuesta"]')!.textContent).toMatch(/Suma de pesos100,0\s%/);
    const expected = state();
    await button("Ir al informe");
    expect(JSON.parse(document.querySelector("#report-input")!.textContent!)).toEqual(expected);
  });

  /* Decisión 37. A mano: con A fijada en 60 %, los 10.000,25 € de C salen de los 40.000 € de B, y el capital no cambia. */
  test("con un candado manda el peso: el capital no cambia y lo libre absorbe, también hasta el informe", async () => {
    await act(async () => root.render(<Shell />));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="Bloquear el peso de A"]')!.click());
    await button("Añadir posición");
    await editAmount("C", "10.000,25", true);
    expect(state().totalCapital).toBe(100000);
    expect(state().positions[0].weight_percent).toBe(60);
    expect(input("A").value).toBe("60.000");
    expect(input("B").value).toBe("29.999,75");
    expect(input("C").value).toBe("10.000,25");
    expect(input("A").disabled).toBe(true);
    expect(state().positions.reduce((sum: number, p: BdbManualPortfolioPosition) => sum + p.weight_percent, 0)).toBeCloseTo(100, 10);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Capital total en euros"]')!.value).toBe("100.000");
    expect(document.querySelector('[aria-label="Datos de la propuesta"]')!.textContent).toMatch(/Suma de pesos100,0\s%/);
    expect(document.querySelector('[data-testid="aviso-peso"]')).toBeNull();
    const expected = state();
    await button("Ir al informe");
    expect(JSON.parse(document.querySelector("#report-input")!.textContent!)).toEqual(expected);
  });

  test("un importe que no cabe se queda en lo que deja lo fijado, y lo dice con la cifra; el campo enseña lo que ha quedado", async () => {
    await act(async () => root.render(<Shell />));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="Bloquear el peso de A"]')!.click());
    await button("Añadir posición");
    await editAmount("C", "70.000");
    expect(input("A").value).toBe("60.000");
    expect(input("B").value).toBe("0");
    expect(input("C").value).toBe("40.000");
    expect(state().totalCapital).toBe(100000);
    const aviso = document.querySelector('[data-testid="aviso-peso"]')!.textContent!.replace(/\u00a0/g, " ");
    expect(aviso).toContain("El importe no cabe porque hay un 60,0 % fijado: «C» se queda en 40.000,00 € en vez de 70.000,00 €");
    expect(aviso).not.toContain("también los que tienen candado");
    // Soltar el candado: lo de «hay un 60 % fijado» deja de ser cierto.
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="Desbloquear el peso de A"]')!.click());
    expect(document.querySelector('[data-testid="aviso-peso"]')).toBeNull();
  });

  test("sin otra libre no se mueve nada, y el campo vuelve a lo que había", async () => {
    await act(async () => root.render(<Shell />));
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="Bloquear el peso de A"]')!.click());
    await editAmount("B", "25.000");
    expect(state().totalCapital).toBe(100000);
    expect(state().positions).toEqual(startingPositions);
    expect(input("B").value).toBe("40.000");
    expect(document.querySelector('[data-testid="aviso-peso"]')!.textContent!.replace(/\u00a0/g, " ")).toContain(
      "«B» es la única posición libre: su importe es lo que deja lo fijado, 40.000,00 €, y no 25.000,00 €."
    );
  });

  test("el aviso se trae a la vista al aparecer, pero volver a la tabla con él puesto no mueve la página", async () => {
    const traerALaVista = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = traerALaVista;
    try {
      const props = {
        assets: [],
        locks: { A: true },
        onEuroChange: () => undefined,
        onRemove: () => undefined,
        onToggleLock: () => undefined,
        onWeightChange: () => undefined,
        positions: startingPositions,
        totalCapital: 100000
      };
      await act(async () => root.render(<PortfolioPositionsTable {...props} />));
      await act(async () => root.render(<PortfolioPositionsTable {...props} aviso="No cabe." />));
      expect(traerALaVista).toHaveBeenCalledTimes(1);
      expect(traerALaVista).toHaveBeenCalledWith({ block: "nearest" });
      await act(async () => root.render(<PortfolioPositionsTable {...props} aviso="No cabe." />));
      expect(traerALaVista).toHaveBeenCalledTimes(1);
      /* Otro paso de Diseño desmonta la tabla; al volver, el aviso ya estaba. */
      await act(async () => root.render(<p>Otro paso</p>));
      await act(async () => root.render(<PortfolioPositionsTable {...props} aviso="No cabe." />));
      expect(traerALaVista).toHaveBeenCalledTimes(1);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  test("la regla del importe cambia en la pantalla con el candado, y la fila fijada dice que no se edita", async () => {
    await act(async () => root.render(<Shell />));
    const subtitulo = () => document.querySelector("#portfolio-positions-title")!.closest("section")!.textContent!;
    expect(subtitulo()).toContain("Al editar un importe se actualizan el capital total");
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="Bloquear el peso de A"]')!.click());
    expect(subtitulo()).toContain("Con pesos fijados, el capital no cambia");
    expect(subtitulo()).not.toContain("Al editar un importe se actualizan el capital total");
    expect(document.querySelector<HTMLButtonElement>('button[aria-label^="Desbloquear el peso de A"]')!.title).toContain("su peso y su importe no se editan");
  });

  test("editar euros conserva los otros importes también en modo Proporcional", async () => {
    await act(async () => root.render(<Shell />));
    await button("Proporcional");
    await editAmount("B", "25.000,37");
    expect(state().totalCapital).toBe(85000.37);
    expect(input("A").value).toBe("60.000");
    expect(input("B").value).toBe("25.000,37");
    await editAmount("B", "200.000");
    expect(state().totalCapital).toBe(260000);
    expect(input("A").value).toBe("60.000");
    expect(state().positions.reduce((sum: number, p: BdbManualPortfolioPosition) => sum + p.weight_percent, 0)).toBeCloseTo(100, 12);
  });

  test("permite introducir la primera cantidad con capital cero y volver a cero", async () => {
    await act(async () => root.render(<Shell initialPositions={[{ asset_id: "A", weight_percent: 0 }]} initialCapital={0} />));
    await editAmount("A", "1.234,56");
    expect(state().totalCapital).toBe(1234.56);
    expect(state().positions[0].weight_percent).toBe(100);
    await editAmount("A", "0");
    expect(state().totalCapital).toBe(0);
    expect(state().positions[0].weight_percent).toBe(0);
    await editAmount("A", "100");
    expect(state().totalCapital).toBe(100);
    expect(state().positions[0].weight_percent).toBe(100);
  });
});
