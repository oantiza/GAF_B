// @vitest-environment happy-dom

/**
 * La puerta de la Propuesta de cambio, en Informes: se eligen Actual y Propuesta a mano, el motivo es obligatorio, y con Modo cliente
 * no se enseñan otras carteras. El documento no se alimenta de «Fondos equivalentes»: lo que llega al papel es lo elegido aquí.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
/* Decisión B-78: la lectura del final de cada serie va a la base nueva; aquí no se pregunta a ninguna, y ninguna posición está parada. */
vi.mock("../src/adapters/finDeLaSerie", () => ({ seriesParadas: async () => new Map(), useSeriesParadas: () => new Map() }));

const mocks = vi.hoisted(() => ({
  historia: vi.fn(),
  activos: vi.fn(),
  descargar: vi.fn(async () => {})
}));

vi.mock("../src/adapters/portfolioComparisonHistory", () => ({ fetchComparisonHistory: mocks.historia }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({ getComparableAssets: mocks.activos }) }));
vi.mock("../src/reports/propuestaDeCambioPdf", () => ({ downloadPropuestaDeCambioPdf: mocks.descargar }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { DialogoDePropuesta } from "../src/components/DialogoDePropuesta";
import { AppError } from "../src/core/appError";
import { CARTERA_ACTIVA, eleccionDeLaPropuesta } from "../src/core/comparacionDeCarteras";
import type { PropuestaDeCambio } from "../src/core/propuestaDeCambio";
import { clearSessionCaches } from "../src/core/sessionCaches";
import type { BdbSavedLocalPortfolio } from "../src/types/bdbAssets";
import { ACTIVOS, ACTUAL, historia, PROPUESTA, SERIE_ACTUAL, SERIE_PROPUESTA } from "./support/propuestaFixtures";

const guardada = (portfolio_id: string, name: string, positions: BdbSavedLocalPortfolio["positions"], total_capital?: number): BdbSavedLocalPortfolio => ({
  portfolio_id,
  name,
  positions,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  sourceKind: "BBDD_LIVE_API",
  total_capital
});

const CARTERAS = [
  guardada("p1", "La propuesta de Ana", [...PROPUESTA.positions], 250000),
  guardada("p2", "La de otro cliente", [{ asset_id: "LU0000000003", weight_percent: 100 }]),
  guardada("p3", "La de hoy, guardada", [...ACTUAL.positions], 100000)
];

const ACTIVA = { name: "Cartera de hoy", positions: ACTUAL.positions, capital: 100000 };

let host: HTMLDivElement;
let root: Root;

async function montar({ cliente = "Ana Ruiz", responsable = { name: "Marta López", email: "marta@ejemplo.es" }, modoCliente = false, activa = ACTIVA, carteras = CARTERAS, onClose = () => undefined }: {
  cliente?: string;
  responsable?: { name: string; email: string };
  modoCliente?: boolean;
  activa?: typeof ACTIVA | { name: string; positions: typeof ACTUAL.positions; capital: undefined };
  carteras?: BdbSavedLocalPortfolio[];
  onClose?: () => void;
} = {}) {
  await act(async () => {
    root.render(
      <ClientModeProvider initialValue={modoCliente}>
        <DialogoDePropuesta activa={activa} carteras={carteras} cliente={cliente} onClose={onClose} responsable={responsable} sourceKind="BBDD_LIVE_API" />
      </ClientModeProvider>
    );
  });
}

const selectores = () => [...document.querySelectorAll("select")] as HTMLSelectElement[];
const opciones = (select: HTMLSelectElement) => [...select.options].map((o) => o.textContent);
/* Rediseño (14-11-2026): el botón de un diálogo de documento dice «Descargar el informe». */
const boton = () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Descargar el informe")) as HTMLButtonElement;

async function elegir(indice: number, valor: string) {
  await act(async () => {
    const select = selectores()[indice];
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, valor);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function escribir(indice: number, texto: string) {
  await act(async () => {
    const area = document.querySelectorAll("textarea")[indice] as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, texto);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const pulsar = () => act(async () => {
  boton().click();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSessionCaches();
  mocks.historia.mockReset();
  mocks.activos.mockReset();
  mocks.descargar.mockClear();
  mocks.historia.mockImplementation(async (positions: typeof ACTUAL.positions) =>
    positions.length === ACTUAL.positions.length
      ? historia(positions.map((p) => p.asset_id), SERIE_ACTUAL)
      : historia(positions.map((p) => p.asset_id), SERIE_PROPUESTA));
  mocks.activos.mockResolvedValue(ACTIVOS);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("el botón dice lo que falta", () => {
  test("sin elegir nada, inactivo y dicho; con las dos y sin motivo, también; con el motivo, activo", async () => {
    await montar();
    expect(boton().disabled).toBe(true);
    expect(document.body.textContent).toContain("Falta elegir Actual y Propuesta.");
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p1");
    expect(boton().disabled).toBe(true);
    expect(document.body.textContent).toContain("Falta escribir el motivo de la propuesta.");
    await escribir(0, "   ");
    expect(boton().disabled).toBe(true);
    await escribir(0, "Bajar el coste.");
    expect(boton().disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Falta escribir");
  });

  test("la misma composición, aunque sea otra cartera guardada, no es un cambio", async () => {
    await montar();
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p3");
    await escribir(0, "Un motivo.");
    expect(boton().disabled).toBe(true);
    expect(document.body.textContent).toContain("misma composición");
  });

  test("lo elegido a un lado no se puede elegir al otro", async () => {
    await montar();
    await elegir(0, "p1");
    const propuesta = selectores()[1];
    expect([...propuesta.options].find((o) => o.value === "p1")?.disabled).toBe(true);
    expect(opciones(propuesta)).toContain("Propuesta en curso · Cartera de hoy");
  });
});

describe("lo que llega al papel", () => {
  test("lo elegido, con su motivo tal cual, sus notas, el cliente y el capital de Actual", async () => {
    await montar();
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p1");
    await escribir(0, "  Bajar el coste.\nY el riesgo de un solo gestor.  ");
    await escribir(1, "Por tramos.");
    await pulsar();
    expect(mocks.descargar).toHaveBeenCalledTimes(1);
    const modelo = (mocks.descargar.mock.calls[0] as unknown as [PropuestaDeCambio])[0];
    expect(modelo.motivo).toBe("Bajar el coste.\nY el riesgo de un solo gestor.");
    expect(modelo.notasDelPlan).toBe("Por tramos.");
    expect(modelo.cliente).toBe("Ana Ruiz");
    expect(modelo.nombreActual).toBe("Cartera de hoy");
    expect(modelo.nombrePropuesta).toBe("La propuesta de Ana");
    expect(modelo.capital).toBe(100000);
    expect(modelo.plan.textoTotalPuntos).toBe("50,00\u00a0%");
    /* Las dos en el mismo periodo. */
    expect(mocks.historia.mock.calls.map((llamada) => llamada[1])).toEqual(["3Y", "3Y"]);
  });

  test("«Elaborado por» es el de Informes, y lo dice antes de descargar (decisión A-64)", async () => {
    await montar();
    expect(document.body.textContent).toContain("Elaborado por: Marta López.");
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p1");
    await escribir(0, "Un motivo.");
    await pulsar();
    const modelo = (mocks.descargar.mock.calls[0] as unknown as [PropuestaDeCambio])[0];
    expect(modelo.responsable).toEqual({ name: "Marta López", email: "marta@ejemplo.es" });
  });

  test("vacío en Informes, sale sin firma, y también lo dice", async () => {
    await montar({ responsable: { name: "", email: "" } });
    expect(document.body.textContent).toContain("Elaborado por: sin firma en el informe.");
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p1");
    await escribir(0, "Un motivo.");
    await pulsar();
    const modelo = (mocks.descargar.mock.calls[0] as unknown as [PropuestaDeCambio])[0];
    expect(modelo.responsable).toEqual({ name: "", email: "" });
  });

  test("el capital de otra cartera no se toma prestado: sin capital en Actual, todo va en porcentajes", async () => {
    await montar({ activa: { name: "Sin capital", positions: ACTUAL.positions, capital: undefined } });
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p1");
    expect(document.body.textContent).toContain("Actual no tiene capital fijado: el documento saldrá en porcentajes.");
    await escribir(0, "Un motivo.");
    await pulsar();
    const modelo = (mocks.descargar.mock.calls[0] as unknown as [PropuestaDeCambio])[0];
    expect(modelo.capital).toBeNull();
    expect(modelo.plan.textoTotalImporte).toBeNull();
  });

  test("si Propuesta tiene otro capital, se avisa y el plan usa el de Actual", async () => {
    await montar();
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p1");
    expect(document.body.textContent?.replaceAll(" ", " ")).toContain("Propuesta tiene otro capital (250.000,00 €): el plan no lo usa.");
  });

  test("si con esas posiciones no se puede simular, el documento sale y dice que falta el dato", async () => {
    mocks.historia.mockImplementation(async (positions: typeof ACTUAL.positions) => {
      if (positions.length === ACTUAL.positions.length) return historia(positions.map((p) => p.asset_id), SERIE_ACTUAL);
      throw new AppError("BACKEND", "Sin precios.", { cause: { code: "failed-precondition" } });
    });
    await montar();
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p1");
    await escribir(0, "Un motivo.");
    await pulsar();
    const modelo = (mocks.descargar.mock.calls[0] as unknown as [PropuestaDeCambio])[0];
    expect(modelo.cifras.filas[0].propuesta).toBe("Falta el dato");
    expect(modelo.plan.textoTotalPuntos).toBe("50,00\u00a0%");
  });

  test("un fallo pasajero no se disfraza de dato que falta: se dice, no se descarga y el motivo sigue ahí", async () => {
    mocks.historia.mockRejectedValue(new AppError("BACKEND", "Se ha caído la conexión."));
    await montar();
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p1");
    await escribir(0, "Un motivo largo que no se quiere perder.");
    await pulsar();
    expect(mocks.descargar).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Se ha caído la conexión.");
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Un motivo largo que no se quiere perder.");
  });

  test("al cerrar y volver a abrir no queda ningún motivo: no puede colarse en la propuesta de otro cliente", async () => {
    await montar();
    await escribir(0, "El motivo de Ana.");
    await act(async () => root.unmount());
    root = createRoot(host);
    await montar();
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  test("no se guarda ni rastro del motivo en el navegador", async () => {
    await montar();
    await elegir(0, CARTERA_ACTIVA);
    await elegir(1, "p1");
    await escribir(0, "Un motivo privado.");
    await pulsar();
    expect(JSON.stringify(localStorage)).not.toContain("Un motivo privado");
    expect(JSON.stringify(sessionStorage)).not.toContain("Un motivo privado");
  });
});

describe("Modo cliente", () => {
  test("sin elegir antes, solo se ofrece la activa, y se dice cómo elegir las demás", async () => {
    await montar({ modoCliente: true });
    for (const select of selectores()) {
      expect(opciones(select)).toEqual(["Elige una propuesta", "Propuesta en curso · Cartera de hoy"]);
    }
    expect(document.body.textContent).toContain("Sal de Modo cliente para ver otras propuestas.");
    expect(document.body.textContent).not.toContain("La de otro cliente");
  });

  test("con la elección hecha antes de entrar, las dos ya elegidas y ninguna más", async () => {
    eleccionDeLaPropuesta.write({ actual: CARTERA_ACTIVA, propuesta: "p1" });
    await montar({ modoCliente: true });
    expect(opciones(selectores()[1])).toEqual(["Elige una propuesta", "Propuesta en curso · Cartera de hoy", "La propuesta de Ana"]);
    expect(document.body.textContent).not.toContain("La de otro cliente");
    await escribir(0, "Un motivo.");
    expect(boton().disabled).toBe(false);
    await pulsar();
    expect(mocks.descargar).toHaveBeenCalledTimes(1);
  });
});
