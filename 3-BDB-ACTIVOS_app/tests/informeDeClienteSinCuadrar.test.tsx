// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

/**
 * Auditoría integral del 16-11-2026, hallazgo INF-1. Con pesos que no suman 100, el informe de cliente imprimía en la misma
 * fila el peso escrito y el importe repartido sobre el capital entero («60,0 % · 100.000 €» con una sola posición al 60 %), y
 * nada en el camino lo impedía. Ahora no se genera: lo dicen la lista de Informes y el diálogo, que es el mismo en Análisis.
 * El informe de costes no se bloquea: normaliza y lo dice en el papel.
 */
import { buildManualPortfolioReport, getComparableAssets } from "../src/adapters/bdbAssetsAdapter";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { DialogoDelInformeDeCliente } from "../src/components/DialogoDelInformeDeCliente";
import { PortfolioReport } from "../src/components/PortfolioReport";
import { guardarIdentidad } from "../src/core/identidadDelAsesor";
import { checkPortfolioFeasibility } from "../src/core/portfolioConstraints";
import { entradaDelInformeDeCliente, motivoParaNoGenerarElInformeDeCliente } from "../src/core/reportPipelineCliente";
import { clearSessionCaches } from "../src/core/sessionCaches";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const conTotal = (total: number) => ({ summary: { total_weight_percent: total } }) as never;
const SIN_CUADRAR = "Los pesos suman 60,0 %, no el 100 %: este informe no se genera hasta que cuadren.";

describe("cuándo no se genera", () => {
  test("con pesos que no suman 100 dice cuánto suman; si cuadran, nada", () => {
    expect(motivoParaNoGenerarElInformeDeCliente(conTotal(60))).toBe(SIN_CUADRAR);
    expect(motivoParaNoGenerarElInformeDeCliente(conTotal(100))).toBeNull();
    expect(motivoParaNoGenerarElInformeDeCliente(conTotal(0))).toContain("Los pesos suman 0,0");
    expect(motivoParaNoGenerarElInformeDeCliente(conTotal(140))).toContain("Los pesos suman 140,0");
  });

  test("la tolerancia es la de toda la aplicación: ±0,05 puntos, la misma con la que Diseño dice que cuadra", () => {
    expect(motivoParaNoGenerarElInformeDeCliente(conTotal(99.96))).toBeNull();
    expect(motivoParaNoGenerarElInformeDeCliente(conTotal(100.04))).toBeNull();
    expect(motivoParaNoGenerarElInformeDeCliente(conTotal(99.94))).not.toBeNull();
    expect(motivoParaNoGenerarElInformeDeCliente(conTotal(100.06))).not.toBeNull();
  });

  test("la entrada del papel, que comparten las dos puertas, tampoco se monta: es la última defensa", async () => {
    const posiciones = [{ asset_id: "MOCK-FUND-MIXED", weight_percent: 60 }];
    const report = await buildManualPortfolioReport(posiciones, "Sin cuadrar");
    const assets = await getComparableAssets(posiciones.map((p) => p.asset_id));
    expect(report.summary.total_weight_percent).toBe(60);
    expect(() =>
      entradaDelInformeDeCliente({ report, positions: posiciones, assets, clientMode: false, analysis: {} as never, seriesParadas: new Map(), benchmarkId: "x", clientName: "", banker: { name: "", email: "" }, rentabilidadPorDividendoDe: () => ({}) } as never)
    ).toThrow(SIN_CUADRAR);
  });
});

describe("en pantalla", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    clearSessionCaches();
    guardarIdentidad({});
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    guardarIdentidad({});
    clearSessionCaches();
  });

  async function montarInformes(posiciones: Array<{ asset_id: string; weight_percent: number }>, modoCliente = false) {
    const report = await buildManualPortfolioReport(posiciones, "Familia García");
    const assets = await getComparableAssets(posiciones.map((p) => p.asset_id));
    const feasibility = checkPortfolioFeasibility({ positions: posiciones, assets });
    await act(async () => {
      root.render(
        createElement(ClientModeProvider, {
          initialValue: modoCliente,
          children: createElement(PortfolioReport, { report, originalPositions: posiciones, assets, feasibility, totalCapital: 100000, portfolioName: "Familia García" })
        })
      );
    });
  }

  const fila = (nombre: string) =>
    [...host.querySelectorAll(".informes-lista__documento")].find((item) => item.querySelector(".informes-lista__nombre")?.textContent?.includes(nombre)) as HTMLElement;
  const botonDe = (nombre: string) => fila(nombre).querySelector(".informes-lista__boton button") as HTMLButtonElement;

  test("una sola posición al 60 %: el informe de cliente no se puede preparar y dice por qué y dónde se arregla", async () => {
    await montarInformes([{ asset_id: "MOCK-FUND-MIXED", weight_percent: 60 }]);
    expect(botonDe("Informe para el cliente").disabled).toBe(true);
    expect(fila("Informe para el cliente").textContent).toContain(`${SIN_CUADRAR} Se ajustan en Diseño.`);
    /* El de costes normaliza y lo dice en su papel: sigue abierto. */
    expect(botonDe("Informe de costes").disabled).toBe(false);
  });

  test("delante del cliente dice que no cuadra, sin la instrucción al asesor", async () => {
    await montarInformes([{ asset_id: "MOCK-FUND-MIXED", weight_percent: 60 }], true);
    expect(botonDe("Informe para el cliente").disabled).toBe(true);
    expect(fila("Informe para el cliente").textContent).toContain(SIN_CUADRAR);
    expect(fila("Informe para el cliente").textContent).not.toContain("Se ajustan en Diseño");
  });

  test("con 60 y 40 se prepara como siempre", async () => {
    await montarInformes([{ asset_id: "MOCK-FUND-MIXED", weight_percent: 60 }, { asset_id: "MOCK-ETF-CASH", weight_percent: 40 }]);
    expect(botonDe("Informe para el cliente").disabled).toBe(false);
    expect(fila("Informe para el cliente").textContent).not.toContain("no se genera");
  });

  test("el diálogo, que es el de las dos puertas, lo dice dentro y no deja descargar", async () => {
    await act(async () => {
      root.render(
        createElement(ClientModeProvider, {
          initialValue: false,
          children: createElement(DialogoDelInformeDeCliente, {
            nombre: "Familia García", pedirNombre: false, alCambiarNombre: () => undefined, cliente: "", alCambiarCliente: () => undefined,
            capital: 100000, ocupado: false, error: null, bloqueo: SIN_CUADRAR, alDescargar: () => undefined, alCerrar: () => undefined
          })
        })
      );
    });
    const dialogo = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogo.textContent).toContain("La cartera no cuadra.");
    expect(dialogo.textContent).toContain(SIN_CUADRAR);
    const descargar = [...dialogo.querySelectorAll("button")].find((boton) => boton.textContent?.includes("Descargar el informe")) as HTMLButtonElement;
    expect(descargar.disabled).toBe(true);
  });
});
