// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
/* Decisión B-78: la lectura del final de cada serie va a la base nueva; aquí no se pregunta a ninguna, y ninguna posición está parada. */
vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PortfolioComparator } from "../src/components/PortfolioComparator";
import { AppError } from "../src/core/appError";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { comparisonFixture, comparisonPortfolios, comparisonAssets } from "./support/portfolioComparisonFixtures";
import { historiaDeTramo } from "./support/tramoCorto";
import type { ComparisonHistory, ComparisonPeriod } from "../src/core/portfolioComparison";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { AssetDataSourceKind } from "../src/types/assetDataSource";

const mocks = vi.hoisted(() => ({ list: vi.fn(), assets: vi.fn(), history: vi.fn(), pdf: vi.fn(), local: vi.fn() }));
vi.mock("../src/adapters/portfolioBackend", () => ({ backendListPortfolios: mocks.list, usesBackendPersistence: (kind: string) => kind === "BBDD_LIVE_API" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({ getComparableAssets: mocks.assets }) }));
vi.mock("../src/adapters/portfolioComparisonHistory", () => ({ fetchComparisonHistory: mocks.history }));
vi.mock("../src/core/localPortfolioStorage", () => ({ readLocalPortfoliosFromStorage: mocks.local }));
vi.mock("../src/reports/comparePdf", () => ({ downloadComparisonPdf: mocks.pdf }));
vi.mock("../src/charts/oaa", () => ({
  OaaLineChart: (props: unknown) => <div data-testid="history" data-chart={JSON.stringify(props)} />,
  OaaRiskReturnChart: (props: unknown) => <div data-testid="risk" data-chart={JSON.stringify(props)} />,
  OaaLegend: () => null
}));
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  /* La elección y el periodo se conservan en la sesión: sin esto, cada prueba hereda la anterior. */
  clearSessionCaches();
  mocks.list.mockResolvedValue(comparisonPortfolios);
  mocks.assets.mockResolvedValue(comparisonAssets);
  mocks.local.mockReturnValue(comparisonPortfolios.map((p) => ({ ...p, sourceKind: "LOCAL_MOCK" })));
  mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => comparisonFixture(period, positions[0].asset_id));
  mocks.pdf.mockResolvedValue(undefined);
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
async function mount(kind: AssetDataSourceKind = "BBDD_LIVE_API") { await act(async () => root.render(<PortfolioComparator sourceKind={kind} />)); }
async function select(index: number, value: string) { await act(async () => { const field = document.querySelectorAll("select")[index]; field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function click(label: string) { const button = [...document.querySelectorAll("button")].find((b) => b.textContent === label); if (!button) throw new Error(label); await act(async () => button.click()); }
async function choose() { await select(0, "Alfa"); await select(1, "Beta"); }
function chart(testId: string) { return JSON.parse(document.querySelector(`[data-testid="${testId}"]`)!.getAttribute("data-chart")!); }

describe("comparador visual de carteras", () => {
  test("espera dos carteras distintas y dibuja sus curvas a tres años", async () => {
    await mount(); await select(0, "Alfa"); expect(mocks.history).not.toHaveBeenCalled();
    await select(1, "Beta");
    expect(mocks.history).toHaveBeenCalledTimes(2);
    expect(chart("history").series.map((s: { label: string }) => s.label)).toEqual(["Cartera Alfa", "Cartera Beta"]);
    expect(chart("history").series.every((s: { values: { value: number }[] }) => s.values[0].value === 100)).toBe(true);
    expect(chart("risk").marks).toHaveLength(2);
    expect(document.body.textContent).toContain("Rentabilidad y riesgo · 3 años");
    expect(document.querySelectorAll("select")[1].querySelector('option[value="Alfa"]')?.hasAttribute("disabled")).toBe(true);
  });
  test("5 y 10 años actualizan juntos gráfico, mapa, cifras y el PDF", async () => {
    await mount(); await choose();
    for (const years of [5, 10]) {
      await click(`${years} años`);
      expect(chart("history").series[0].values[0].date.startsWith(String(2026 - years))).toBe(true);
      expect(chart("risk").ariaLabel).toContain(`${years} años`);
      expect(document.body.textContent).toContain(`Rentabilidad y riesgo · ${years} años`);
      await click("Descargar el informe");
      const input = mocks.pdf.mock.calls.at(-1)![0];
      expect(input.periodLabel).toBe(`${years} años`);
      expect(input.history.a).toEqual(chart("history").series[0].values);
      expect(input.a.ret).toBe(chart("risk").marks[0].ret);
      expect(input.a.ret).not.toBe(.99);
      expect(input.riskFree).toBe(.02);
      expect(input.coverage.a).toMatchObject({ weight: 100, included: 2, total: 2 });
      expect(input.positions).toHaveLength(3);
      expect(input.categoryRows.length).toBeGreaterThan(0);
      /* La renta variable por región y los costes, de las mismas fichas (10-11-2026). */
      expect(input.rentaVariable.a.pesoPct).toBeGreaterThan(0);
      expect(input.costes.a.rows).toHaveLength(2);
    }
  });
  test("una respuesta lenta del periodo anterior nunca pisa el nuevo", async () => {
    await mount(); await choose();
    const resolve: ((value: ComparisonHistory) => void)[] = [];
    mocks.history.mockImplementation((positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => period === "5Y" ? new Promise((done) => resolve.push(done)) : Promise.resolve(comparisonFixture(period, positions[0].asset_id)));
    await click("5 años");
    expect(chart("history").series).toEqual([]);
    expect(chart("risk").marks).toEqual([]);
    await click("10 años");
    await act(async () => { resolve.forEach((done) => done(comparisonFixture("5Y"))); });
    expect(chart("history").series[0].values[0].date).toBe("2016-09-03");
    expect(document.body.textContent).toContain("Rentabilidad y riesgo · 10 años");
  });
  test("cambiar de cartera no deja curvas o métricas de la selección anterior", async () => {
    await mount(); await choose();
    mocks.history.mockImplementation(() => new Promise(() => {}));
    await select(0, "Gamma");
    expect(chart("history").series).toEqual([]);
    expect(chart("risk").marks).toEqual([]);
    expect(document.querySelector(".pcmp-metrics-table")?.textContent).not.toContain("Cartera Alfa");
  });
  test("un fallo de una cartera permite reintentar y no muestra la otra como comparación completa", async () => {
    mocks.history.mockRejectedValueOnce(new Error("No hay histórico"));
    await mount(); await choose();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Cartera Alfa: No hay histórico");
    expect(chart("history").series).toEqual([]);
    await click("Reintentar");
    expect(chart("history").series).toHaveLength(2);
  });
  test("el PDF que falla se reintenta desde el banner (auditoría 16-10)", async () => {
    mocks.pdf.mockRejectedValueOnce(new Error("No se pudo generar el documento."));
    await mount(); await choose();
    await click("Descargar el informe");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("No se pudo generar el documento.");
    await click("Reintentar");
    expect(mocks.pdf).toHaveBeenCalledTimes(2);
    expect(mocks.pdf.mock.calls[1][0]).toEqual(mocks.pdf.mock.calls[0][0]);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  test("explica las exclusiones y las referencias utilizadas", async () => {
    mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => {
      const result = comparisonFixture(period, positions[0].asset_id); result.backtest.asset_ids = [positions[0].asset_id];
      result.backtest.excluded_assets = [{ asset_id: "cash", reason: "INSUFFICIENT_HISTORY" }]; result.extensionNotes = ["A: referencia histórica aprobada."]; return result;
    });
    await mount(); await choose();
    expect(document.querySelector(".aviso--aviso")?.textContent).toContain("80,0\u00a0%");
    expect(document.body.textContent).toContain("Fuera del cálculo: cash");
    expect(chart("history").dataQualityLabel).toBe("Histórico ampliado");
  });
  test("una cartera medida por debajo del 80 % no tiene cifras: «Falta», sin su curva ni su punto, y la otra no pierde los suyos (decisiones 36 y 104)", async () => {
    /* Alfa se mide entera. Beta pesa 70 en B y 30 en «cash», y «cash» se queda fuera: mide el 70 %. */
    mocks.list.mockResolvedValue(comparisonPortfolios.map((p) => p.portfolio_id === "Beta"
      ? { ...p, positions: [{ asset_id: "B", weight_percent: 70 }, { asset_id: "cash", weight_percent: 30 }] }
      : p));
    mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => {
      const result = comparisonFixture(period, positions[0].asset_id);
      if (positions[0].asset_id === "B") {
        result.backtest.asset_ids = ["B"];
        result.backtest.excluded_assets = [{ asset_id: "cash", reason: "INSUFFICIENT_HISTORY" }];
      }
      return result;
    });
    await mount(); await choose();
    const filas = [...document.querySelectorAll(".pcmp-metrics-table tbody tr")].map((fila) => [...fila.children].map((celda) => (celda.textContent ?? "").replace(/\u00a0/g, " ")));
    const fila = (rotulo: string) => filas.find((celdas) => celdas[0] === rotulo)!;
    /* La columna de Alfa tiene cifra; la de Beta y la diferencia, no: comparar con una parte no es comparar con la cartera. */
    for (const rotulo of ["Rentabilidad acumulada", "Rentabilidad anualizada", "Volatilidad anual", "Sharpe", "Caída máxima"]) {
      expect(fila(rotulo)[1]).toMatch(/\d/);
      expect(fila(rotulo)[2]).toBe("Falta");
      expect(fila(rotulo)[3]).toBe("Falta");
    }
    /* Lo que se sostiene se queda: el peso medido y cuántos activos entran. */
    expect(fila("Peso medido")[2]).toBe("70,0 %");
    expect(fila("Activos incluidos / total")[2]).toBe("1 / 2");
    expect(document.body.textContent).toContain("Cartera Beta: La simulación mide el 70,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso.");
    /* Fuera su curva y su punto; la de Alfa se queda entera, con su color y su serie. */
    expect(chart("history").series.map((s: { label: string }) => s.label)).toEqual(["Cartera Alfa"]);
    expect(chart("history").series[0].values.length).toBeGreaterThan(1000);
    expect(chart("history").ariaLabel).toBe("Evolución de Cartera Alfa · 3 años");
    expect(chart("risk").marks.map((m: { label: string }) => m.label)).toEqual(["Cartera Alfa"]);
    expect(document.body.textContent).toContain("Falta el dato de B: su curva no se dibuja.");
    expect(document.body.textContent).toContain("Mapa: falta el dato de B, y una cartera sola no se compara con nada.");
    /* El motivo, con lo que se queda fuera, en el aviso de arriba; y lo que se mide de la otra sigue dicho. */
    const aviso = document.querySelector(".aviso--aviso")?.textContent ?? "";
    expect(aviso).toContain("Falta el dato de B. La simulación mide el 70,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se queda fuera: Activo cash (30,0\u00a0%). Sin esa cifra no se comparan rentabilidad ni riesgo.");
    expect(document.body.textContent).not.toContain("parte medida");
    /* Y nada de «Ambas carteras parten de 100»: solo se dibuja una. */
    expect(document.body.textContent).not.toContain("Ambas carteras parten de 100");
  });
  test("si la que no llega es A, se queda la curva de B, con su color y no con el de A", async () => {
    mocks.list.mockResolvedValue(comparisonPortfolios.map((p) => p.portfolio_id === "Alfa"
      ? { ...p, positions: [{ asset_id: "A", weight_percent: 70 }, { asset_id: "cash", weight_percent: 30 }] }
      : p));
    mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => {
      const result = comparisonFixture(period, positions[0].asset_id);
      if (positions[0].asset_id === "A") {
        result.backtest.asset_ids = ["A"];
        result.backtest.excluded_assets = [{ asset_id: "cash", reason: "INSUFFICIENT_HISTORY" }];
      }
      return result;
    });
    await mount(); await choose();
    expect(chart("history").series.map((s: { label: string }) => s.label)).toEqual(["Cartera Beta"]);
    expect(chart("risk").marks.map((m: { label: string }) => m.label)).toEqual(["Cartera Beta"]);
    /* El color sale del papel de la serie (chartTheme.ts): B sola sigue siendo la serie de B, `--serie-2` por su puesto, y no la cartera de A. */
    expect(chart("history").series[0]).toMatchObject({ papel: "serie", puesto: 0 });
    /* Y al final de su línea sigue siendo «B», como la llama su selector: el nombre entero se cortaba. */
    expect(chart("history").series[0].etiquetaFinal).toBe("B");
    expect(chart("risk").marks[0].papel).toBe("serie");
    expect(chart("history").series[0].color).toBeUndefined();
    expect(document.body.textContent).toContain("Falta el dato de A: su curva no se dibuja.");
  });
  test("con las dos por debajo la pantalla compara composición, y lo dice: sin curvas, sin mapa y sin la tabla de «Falta»", async () => {
    mocks.list.mockResolvedValue(comparisonPortfolios.map((p) => ({ ...p, positions: [{ asset_id: p.portfolio_id === "Alfa" ? "A" : "B", weight_percent: 70 }, { asset_id: "cash", weight_percent: 30 }] })));
    mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => {
      const result = comparisonFixture(period, positions[0].asset_id);
      result.backtest.asset_ids = [positions[0].asset_id];
      result.backtest.excluded_assets = [{ asset_id: "cash", reason: "INSUFFICIENT_HISTORY" }];
      return result;
    });
    await mount(); await choose();
    expect(document.querySelector('[data-testid="history"]')).toBeNull();
    expect(document.querySelector('[data-testid="risk"]')).toBeNull();
    expect(document.body.textContent).toContain("Sin cifras de ninguna de las dos: se compara su composición.");
    expect(document.querySelector(".aviso--aviso")?.textContent).toContain("Falta el dato de las dos. A: La simulación mide el 70,0\u00a0% del peso");
    expect(document.querySelector(".aviso--aviso")?.textContent).toContain("Sin esas cifras no se comparan rentabilidad ni riesgo: aquí se compara su composición.");
    /* Lo que se sostiene se queda: cuánto mide cada una, y su composición. */
    const filas = [...document.querySelectorAll(".pcmp-metrics-table tbody tr")].map((fila) => [...fila.children].map((celda) => (celda.textContent ?? "").replace(/\u00a0/g, " ")));
    expect(filas).toEqual([["Peso medido", "70,0 %", "70,0 %"], ["Activos incluidos / total", "1 / 2", "1 / 2"]]);
    expect(document.body.textContent).not.toContain("Rentabilidad y riesgo");
    expect(document.querySelectorAll(".pcmp-bar-track").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Ambas carteras parten de 100");
  });
  describe("con un 0 % medido: el servidor dice que con esos datos no se puede", () => {
    const sinDatos = () => new AppError("BACKEND", "La operación no se puede ejecutar en el estado actual de los datos.", { cause: { code: "functions/failed-precondition" } });

    test("la otra no pierde su curva, ni su punto ni sus cifras, y no se ofrece reintentar", async () => {
      mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => {
        if (positions[0].asset_id === "B") throw sinDatos();
        return comparisonFixture(period, positions[0].asset_id);
      });
      await mount(); await choose();
      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(document.body.textContent).not.toContain("Reintentar");
      expect(chart("history").series.map((s: { label: string }) => s.label)).toEqual(["Cartera Alfa"]);
      expect(chart("risk").marks.map((m: { label: string }) => m.label)).toEqual(["Cartera Alfa"]);
      const filas = [...document.querySelectorAll(".pcmp-metrics-table tbody tr")].map((fila) => [...fila.children].map((celda) => (celda.textContent ?? "").replace(/\u00a0/g, " ")));
      const fila = (rotulo: string) => filas.find((celdas) => celdas[0] === rotulo)!;
      expect(fila("Rentabilidad anualizada")[1]).toMatch(/\d/);
      expect(fila("Rentabilidad anualizada")[2]).toBe("Falta");
      expect(fila("Rentabilidad anualizada")[3]).toBe("Falta");
      expect(fila("Peso medido")[2]).toBe("0,0 %");
      expect(fila("Activos incluidos / total")[2]).toBe("0 / 2");
      expect(document.querySelector(".aviso--aviso")?.textContent).toContain("Falta el dato de B. Con los datos de hoy, la simulación no mide ninguna posición, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se queda fuera toda la cartera.");
      /* El papel es de dos carteras con su simulación: se dice, y el botón no se ofrece. */
      expect(([...document.querySelectorAll("button")].find((boton) => boton.textContent === "Descargar el informe") as HTMLButtonElement).disabled).toBe(true);
      expect(document.body.textContent).toContain("Este informe no se genera");
    });

    test("con las dos, se compara la composición, sin curvas ni aviso de fallo", async () => {
      mocks.history.mockRejectedValue(sinDatos());
      await mount(); await choose();
      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(document.querySelector('[data-testid="history"]')).toBeNull();
      expect(document.querySelector('[data-testid="risk"]')).toBeNull();
      expect(document.querySelector(".aviso--aviso")?.textContent).toContain("Falta el dato de las dos.");
      expect(document.querySelectorAll(".pcmp-bar-track").length).toBeGreaterThan(0);
    });

    test("un fallo de verdad en una de las dos sigue siendo un fallo, y se reintenta", async () => {
      mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => {
        if (positions[0].asset_id === "A") throw sinDatos();
        if (positions[0].asset_id === "B") throw new AppError("BACKEND", "El servicio ha fallado internamente. Reinténtalo en unos segundos.", { cause: { code: "functions/internal" } });
        return comparisonFixture(period, positions[0].asset_id);
      });
      await mount(); await choose();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("Cartera Beta: El servicio ha fallado internamente");
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("Reintentar");
    });
  });
  test("con Modo cliente se dice lo mismo: se va la cifra, no la salvedad", async () => {
    mocks.list.mockResolvedValue(comparisonPortfolios.map((p) => p.portfolio_id === "Beta"
      ? { ...p, positions: [{ asset_id: "B", weight_percent: 70 }, { asset_id: "cash", weight_percent: 30 }] }
      : p));
    mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => {
      const result = comparisonFixture(period, positions[0].asset_id);
      if (positions[0].asset_id === "B") {
        result.backtest.asset_ids = ["B"];
        result.backtest.excluded_assets = [{ asset_id: "cash", reason: "INSUFFICIENT_HISTORY" }];
      }
      return result;
    });
    await mount(); await choose();
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(<ClientModeProvider initialValue><PortfolioComparator sourceKind="BBDD_LIVE_API" /></ClientModeProvider>));
    expect(chart("history").series.map((s: { label: string }) => s.label)).toEqual(["Cartera Alfa"]);
    expect(document.querySelector(".aviso--aviso")?.textContent).toContain("Falta el dato de B.");
    expect(document.body.textContent).toContain("Mapa: falta el dato de B, y una cartera sola no se compara con nada.");
  });
  test("lo que la ficha no trae dice «No declarado», como el papel, y no «Sin clasificar» (decisión 113)", async () => {
    mocks.assets.mockResolvedValue(comparisonAssets.map((asset) => {
      if (asset.asset_id === "A") return { ...asset, category: undefined, region: undefined };
      if (asset.asset_id === "cash") return { ...asset, instrument_type: "STOCK", category: undefined, region: undefined };
      return asset;
    }));
    await mount(); await choose();
    const texto = document.querySelector(".pcmp-allocations")?.textContent ?? "";
    expect(texto).toContain("No declarado");
    expect(texto).toMatch(/Acci[oó]n/);
    expect(texto).toContain("Falta el dato");
    expect(document.body.textContent).not.toContain("Sin clasificar");
    expect(document.body.textContent).toContain("lo que la ficha de un fondo no trae figura como «No declarado»");
  });
  test("con el 80 % justo la cartera tiene sus cifras: el corte no se mueve", async () => {
    mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => {
      const result = comparisonFixture(period, positions[0].asset_id);
      result.backtest.asset_ids = [positions[0].asset_id];
      result.backtest.excluded_assets = [{ asset_id: "cash", reason: "INSUFFICIENT_HISTORY" }];
      return result;
    });
    await mount(); await choose();
    expect(document.querySelector(".pcmp-metrics-table")?.textContent).not.toContain("Falta");
    expect(chart("history").series.map((s: { label: string }) => s.label)).toEqual(["Cartera Alfa", "Cartera Beta"]);
  });
  test("el Sharpe de lo que se mide: una acción sola dice «No aplica», también si el resto de la cartera se queda fuera", async () => {
    mocks.assets.mockResolvedValue(comparisonAssets.map((asset) => (asset.asset_id === "A" ? { ...asset, instrument_type: "STOCK" } : asset)));
    mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[], period: ComparisonPeriod) => {
      const result = comparisonFixture(period, positions[0].asset_id);
      if (positions[0].asset_id === "A") {
        result.backtest.asset_ids = ["A"];
        result.backtest.excluded_assets = [{ asset_id: "cash", reason: "INSUFFICIENT_HISTORY" }];
      }
      return result;
    });
    await mount(); await choose();
    const sharpe = [...document.querySelectorAll(".pcmp-metrics-table tbody tr")].map((fila) => [...fila.children].map((celda) => celda.textContent ?? "")).find((celdas) => celdas[0] === "Sharpe")!;
    /* A · B · Diferencia (ANA-29): A no aplica, B tiene cifra, y la diferencia tampoco aplica. */
    expect(sharpe[1]).toBe("No aplica");
    expect(sharpe[2]).toMatch(/\d/);
    expect(sharpe[3]).toBe("No aplica");
    /* Y el papel recibe lo mismo. */
    await click("Descargar el informe");
    expect(mocks.pdf.mock.calls[0][0].sharpeNoAplica).toEqual({ a: true, b: false });
  });
  test("en muestra local conserva la distribución sin consultar históricos reales", async () => {
    await mount("LOCAL_MOCK"); await choose();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Con los datos de muestra no hay histórico que comparar");
    expect(document.querySelectorAll(".pcmp-bar-track").length).toBeGreaterThan(0);
  });
  test("cambia la asignación de categoría a clase sin recalcular los históricos", async () => {
    await mount(); await choose(); await click("Clase");
    expect(document.body.textContent).toContain("Por clase de activo");
    expect(document.body.textContent).toContain("Renta variable");
    expect(mocks.history).toHaveBeenCalledTimes(2);
  });
  test("con menos de un año común no se anualiza: la respuesta da la rentabilidad del periodo con sus fechas, y la anualizada y el Sharpe no aplican (15-11-2026)", async () => {
    /* A: de 100 a 106 en 119 días; B: de 100 a 103. Antes, A salía con un 1,06^(365,2425/119) − 1 = 19,58 % «anualizado». */
    mocks.history.mockImplementation(async (positions: BdbManualPortfolioPosition[]) =>
      historiaDeTramo(119, positions[0].asset_id === "A" ? 0.06 : 0.03, positions[0].asset_id, "3Y"));
    await mount(); await choose();
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Rentabilidad del periodo · Cartera Alfa");
    expect(texto).not.toContain("Rentabilidad anualizada · Cartera Alfa");
    expect(texto).toContain("+6,00 %");
    expect(texto).toContain("+3,00 %");
    /* B − A = 3 % − 6 % = −3,00 pp, con sus fechas. */
    expect(texto).toContain("−3,00 pp");
    expect(texto).toContain("En rentabilidad del periodo · del 07/05/2026 al 03/09/2026");
    const filas = [...document.querySelectorAll(".pcmp-metrics-table tbody tr")].map((fila) => [...fila.children].map((celda) => celda.textContent ?? ""));
    expect(filas.find((celdas) => celdas[0] === "Rentabilidad del periodo, del 07/05/2026 al 03/09/2026")).toEqual(
      ["Rentabilidad del periodo, del 07/05/2026 al 03/09/2026", "+6,00 %", "+3,00 %", "−3,00 pp"]);
    expect(filas.find((celdas) => celdas[0] === "Rentabilidad anualizada")).toEqual(["Rentabilidad anualizada", "No aplica", "No aplica", "No aplica"]);
    expect(filas.find((celdas) => celdas[0] === "Sharpe")).toEqual(["Sharpe", "No aplica", "No aplica", "No aplica"]);
    /* Sin rentabilidad anualizada no hay punto en el mapa, que tiene esa cifra en su eje vertical. */
    expect(chart("risk").marks).toHaveLength(0);
  });

  test("ANA-29: las columnas van en el orden de la tabla común, A · B · Diferencia", async () => {
    await mount(); await choose();
    const cabecera = [...document.querySelectorAll(".pcmp-metrics-table thead th")].map((celda) => celda.textContent);
    expect(cabecera).toEqual(["Métrica", "Cartera Alfa", "Cartera Beta", "Diferencia B − A"]);
    /* Y cada fila sigue a su cabecera: la diferencia es la última celda, y es B − A. */
    const filas = [...document.querySelectorAll(".pcmp-metrics-table tbody tr")].map((fila) => [...fila.children].map((celda) => celda.textContent ?? ""));
    expect(filas.every((celdas) => celdas.length === 4)).toBe(true);
    const anualizada = filas.find((celdas) => celdas[0] === "Rentabilidad anualizada")!;
    expect(anualizada[3]).toMatch(/pp$/);
  });
  /* 14-11-2026 (Óscar: recuperar el color de antes del rediseño): la diferencia vuelve a ir en verde si mejora y en rojo si empeora, y la nota
     lo dice con su frase; las clases viejas del color («positive», «negative») no vuelven. El color se comprueba en
     `colorDelComparadorDePropuestas.test.tsx`. */
  test("la nota dice cómo leer la diferencia y qué significa su color, sin las clases de color de antes", async () => {
    await mount(); await choose();
    expect(document.body.textContent).toContain("Diferencia B − A");
    expect(document.body.textContent).toContain("En volatilidad, menor es mejor; en caída, más cerca de cero es mejor.");
    expect(document.body.textContent).toContain("En verde, lo que mejora; en rojo, lo que empeora.");
    expect(document.body.textContent).not.toContain("Verde: mejor cifra");
    expect(document.querySelector(".pcmp-metrics-table .positive, .pcmp-metrics-table .negative")).toBeNull();
  });
  test("la elección no se pierde al cambiar de pantalla", async () => {
    await mount(); await choose();
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await mount();
    expect(document.querySelectorAll("select")[0].value).toBe("Alfa");
    expect(document.querySelectorAll("select")[1].value).toBe("Beta");
    expect(document.body.textContent).toContain("Rentabilidad y riesgo · 3 años");
  });
  test("con Modo cliente el desplegable solo enseña las dos elegidas antes de entrar", async () => {
    await mount(); await choose();
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(<ClientModeProvider initialValue><PortfolioComparator sourceKind="BBDD_LIVE_API" /></ClientModeProvider>));
    const opciones = (indice: number) => [...document.querySelectorAll("select")[indice].querySelectorAll("option")].map((opcion) => opcion.value).filter(Boolean);
    expect(opciones(0)).toEqual(["Alfa", "Beta"]);
    expect(opciones(1)).toEqual(["Alfa", "Beta"]);
    expect(document.body.textContent).not.toContain("Cartera Gamma");
    expect(document.body.textContent).toContain("Sal de Modo cliente para ver otras propuestas");
    /* Y la comparación sigue ahí: el modo no se la lleva. */
    expect(document.body.textContent).toContain("Rentabilidad y riesgo · 3 años");
  });
  test("con Modo cliente y nada elegido antes no se enseña ninguna cartera", async () => {
    await act(async () => root.render(<ClientModeProvider initialValue><PortfolioComparator sourceKind="BBDD_LIVE_API" /></ClientModeProvider>));
    expect([...document.querySelectorAll("select")[0].querySelectorAll("option")].map((opcion) => opcion.value).filter(Boolean)).toEqual([]);
    expect(document.body.textContent).toContain("Las dos propuestas se eligen antes de entrar");
    expect(document.body.textContent).toContain("Sal de Modo cliente para ver otras propuestas");
    expect(mocks.history).not.toHaveBeenCalled();
  });
  test("una cartera vacía no rompe la página ni lanza un cálculo sin posiciones", async () => {
    mocks.list.mockResolvedValueOnce(comparisonPortfolios.map((p, i) => i === 0 ? { ...p, positions: [] } : p));
    await mount(); await choose();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("no tiene posiciones con peso válido");
    expect(mocks.history).not.toHaveBeenCalled();
  });
});
