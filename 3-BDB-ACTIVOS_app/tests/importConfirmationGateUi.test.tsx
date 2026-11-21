// @vitest-environment happy-dom

/* Séptima pasada del importador (revisión 6): la confirmación es SIEMPRE y no
   se puede saltar por ningún camino de Posiciones globales ni de Extracto
   externo. Nada llega al backend (ni a la fuente de demo), ni a la tabla, ni a
   «Llevar al Constructor», hasta que el asesor marca la casilla para ESA
   importación; editar el texto o cargar otro fichero la desmarca y borra el
   resultado anterior (I3), y si se cargan dos ficheros seguidos gana el último
   (M2). */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  comparable: vi.fn(),
  retro: vi.fn(),
  file: vi.fn()
}));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({ getComparableAssets: mocks.comparable }) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
vi.mock("../src/core/importFileReader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/importFileReader")>()),
  readPositionImportFileText: mocks.file
}));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { EURO_CONFIRMATION_TEXT } from "../src/core/importSummary";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { confirmationLines, euroConfirmationBox } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0000120271";
const GLOBAL = "Calcular retrocesiones";
const EXTRACTO = "Analizar cartera";
const FILE_A = `Producto;ISIN;Divisa;Contravalor EUR\nFondo A;${LU};EUR;80000\nFondo B;${IE};EUR;120000`;
const FILE_B = `Producto;ISIN;Divisa;Contravalor EUR\nFondo C;${FR};EUR;5600`;

const fund = (id: string) => ({
  asset_id: id,
  display_name: `Fondo ${id}`,
  instrument_type: "FUND",
  is_investable: true,
  role: "INVESTABLE",
  quality_flags: []
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ClientModeProvider initialValue={false}>{node}</ClientModeProvider>); });
  return host;
}

async function unmount() {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
}

async function paste(text: string) {
  const input = host!.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(label: string) {
  const button = [...host!.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(button, `falta el botón «${label}»`).toBeDefined();
  await act(async () => { button!.click(); });
}

async function mark() {
  const box = euroConfirmationBox(host!);
  expect(box, "falta la casilla de confirmación").not.toBeNull();
  await act(async () => { box!.click(); });
}

async function chooseFile() {
  const input = host!.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "extracto.csv")] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const tableRows = () => [...host!.querySelectorAll(".positions-table-panel .tabla tbody tr")].map((row) => row.textContent ?? "");
const summary = () => host!.querySelector('[aria-label="Resumen de la importación"]')?.textContent?.replace(/\s/g, " ") ?? "";

beforeEach(() => {
  clearSessionCaches();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolve.mockImplementation(async (positions: Array<{ asset_id: string; amount: number }>) =>
    positions.map((p) => ({ id: p.asset_id, amount: p.amount, asset: fund(p.asset_id) }))
  );
  mocks.comparable.mockImplementation(async (ids: string[]) => ids.map(fund));
  mocks.retro.mockResolvedValue(new Map());
});

afterEach(async () => {
  await unmount();
  clearSessionCaches();
});

describe("Posiciones globales: la confirmación no se salta", () => {
  test("pegar y «Calcular»: nada llega al backend hasta marcar la casilla, y volver a pulsar sin marcar no cambia nada", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(`${LU};Fondo A;80.000,00 €\n${IE};Fondo B;120.000,00 €`);
    await press(GLOBAL);
    await press(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(tableRows()).toEqual([]);
    expect(host!.textContent).toContain(EURO_CONFIRMATION_TEXT);
    expect(confirmationLines(host!)).toContain(`${LU} · Fondo A · 80.000,00 €`);
    expect(summary()).toContain("Total para comprobar: 200.000,00 €.");

    await mark();
    await press(GLOBAL);
    expect(mocks.resolve).toHaveBeenCalledWith([
      { asset_id: LU, amount: 80000 },
      { asset_id: IE, amount: 120000 }
    ]);
    expect(tableRows()).toHaveLength(2);
  });

  test("editar el texto después de marcar la desmarca: lo nuevo no llega al backend sin otra confirmación", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(`${LU};Fondo A;80.000,00`);
    await press(GLOBAL);
    await mark();
    await paste(`${LU};Fondo A;800.000,00`);
    expect(euroConfirmationBox(host!)).toBeNull();
    await press(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(euroConfirmationBox(host!)?.checked).toBe(false);
    expect(confirmationLines(host!)).toContain(`${LU} · Fondo A · 800.000,00 € (el fichero no dice su divisa)`);
  });

  test("I3 · cargar otro fichero borra la tabla y la confirmación del anterior (caso A/B)", async () => {
    mocks.file.mockResolvedValueOnce(FILE_A).mockResolvedValueOnce(FILE_B);
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await chooseFile();
    await settle();
    await press(GLOBAL);
    await mark();
    await press(GLOBAL);
    expect(tableRows()).toHaveLength(2);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);

    await chooseFile();
    await settle();
    // La tabla de A ya no está, el cuadro es el de B y la casilla, sin marcar.
    expect(tableRows()).toEqual([]);
    // Octava pasada (I6): el cuadro trae el propio contenido del fichero.
    expect(host!.querySelector("textarea")!.value).toBe(FILE_B);
    expect(euroConfirmationBox(host!)?.checked).toBe(false);
    expect(confirmationLines(host!)).toEqual([`${FR} · Fondo C · 5.600,00 €`]);
    expect(summary()).not.toContain(LU);
    await press(GLOBAL);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);

    await mark();
    await press(GLOBAL);
    expect(mocks.resolve).toHaveBeenLastCalledWith([{ asset_id: FR, amount: 5600 }]);
  });

  test("I3 · editar el texto tras analizar borra la tabla anterior", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(`${LU};Fondo A;80.000,00 €`);
    await press(GLOBAL);
    await mark();
    await press(GLOBAL);
    expect(tableRows()).toHaveLength(1);
    await paste(`${IE};Fondo B;120.000,00 €`);
    expect(tableRows()).toEqual([]);
  });

  test("M2 · dos ficheros seguidos: gana el último aunque el primero tarde más en leerse", async () => {
    let finishA: (text: string) => void = () => undefined;
    mocks.file.mockImplementationOnce(() => new Promise<string>((resolve) => { finishA = resolve; })).mockResolvedValueOnce(FILE_B);
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await chooseFile();
    await chooseFile();
    await settle();
    await act(async () => { finishA(FILE_A); });
    await settle();
    expect(host!.querySelector("textarea")!.value).toBe(FILE_B);
    expect(summary()).not.toContain(LU);
  });

  test("ir al Buscador y volver: lo pendiente sigue pendiente", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(`${LU};Fondo A;80.000,00`);
    await press(GLOBAL);
    await unmount();

    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    expect(euroConfirmationBox(host!)?.checked).toBe(false);
    await press(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
    await mark();
    await press(GLOBAL);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });

  test("recargar la página: no queda nada que usar ni nada confirmado", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(`${LU};Fondo A;80.000,00`);
    await press(GLOBAL);
    await mark();
    await press(GLOBAL);
    expect(tableRows()).toHaveLength(1);
    await unmount();

    clearSessionCaches();
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    expect(host!.querySelector("textarea")!.value).toBe("");
    expect(tableRows()).toEqual([]);
    expect(euroConfirmationBox(host!)).toBeNull();
  });

  test("modo demo: la fuente de muestra tampoco se consulta hasta confirmar", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_STATIC_EXPORT_SAMPLE" />);
    await paste(`${LU};Fondo A;80.000,00 €`);
    await press(GLOBAL);
    expect(mocks.comparable).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    await mark();
    await press(GLOBAL);
    expect(mocks.comparable).toHaveBeenCalledWith([LU]);
    expect(tableRows()).toHaveLength(1);
  });
});

describe("Posiciones globales: elecciones antes de confirmar (octava pasada, B1 y B5)", () => {
  const radios = () => [...host!.querySelectorAll<HTMLInputElement>('[role="radiogroup"] input[type="radio"]')];
  const choose = async (label: string) => {
    const radio = radios().find((input) => input.closest("label")?.textContent?.includes(label));
    expect(radio, `falta la opción «${label}»`).toBeDefined();
    await act(async () => { radio!.click(); });
  };

  test("B1 · dos columnas que no se concilian: sin elegir no hay casilla ni análisis; elegida, llega esa columna", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(`ISIN;Nombre;Valor de mercado;Saldo medio EUR\n${LU};Fondo A;80.000,00;78.500,00\n${IE};Fondo B;120.000,00;118.000,00`);
    await press(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(radios()).toHaveLength(3);
    expect(radios().some((input) => input.checked)).toBe(false);
    expect(euroConfirmationBox(host!)).toBeNull();
    expect(summary()).toContain("¿Qué columna es el valor de mercado en euros?");

    await choose("«Saldo medio EUR»");
    expect(confirmationLines(host!)).toEqual([`${IE} · Fondo B · 118.000,00 €`, `${LU} · Fondo A · 78.500,00 €`]);
    await choose("«Valor de mercado»");
    expect(confirmationLines(host!)).toEqual([
      `${IE} · Fondo B · 120.000,00 € (el fichero no dice su divisa)`,
      `${LU} · Fondo A · 80.000,00 € (el fichero no dice su divisa)`
    ]);
    await press(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
    await mark();
    await press(GLOBAL);
    expect(mocks.resolve).toHaveBeenCalledWith([
      { asset_id: LU, amount: 80000 },
      { asset_id: IE, amount: 120000 }
    ]);
  });

  test("B5 · dos titulares no se mezclan: se elige uno y solo llega el suyo", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(
      [
        "Cliente: Titular Uno", "ISIN;Nombre;Divisa;Valor de mercado", `${LU};Fondo A;EUR;80.000,00`, "",
        "Cliente: Titular Dos", "ISIN;Nombre;Divisa;Valor de mercado", `${FR};Fondo C;EUR;30.000,00`
      ].join("\n")
    );
    await press(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(euroConfirmationBox(host!)).toBeNull();
    await choose("Cliente: Titular Dos");
    await mark();
    await press(GLOBAL);
    expect(mocks.resolve).toHaveBeenCalledWith([{ asset_id: FR, amount: 30000 }]);
  });

  test("con 200 posiciones, la casilla y el botón van juntos ANTES de la lista, ordenada de mayor a menor", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => `LU${String(1000000000 + i)};Fondo ${i};${(i + 1) * 100},00 €`);
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(rows.join("\n"));
    await press(GLOBAL);
    const box = euroConfirmationBox(host!)!;
    const table = host!.querySelector('table[aria-label="Posiciones para comprobar"]')!;
    const confirm = [...host!.querySelectorAll('[aria-label="Resumen de la importación"] button')].find((b) => b.textContent === GLOBAL)!;
    expect(box.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(confirm.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(confirmationLines(host!)[0]).toContain("20.000,00 €");
    expect(confirmationLines(host!)).toHaveLength(200);
    expect(table.querySelector("td")?.className).toBe("mono");
  });
});

describe("Extracto externo: «Llevar al Constructor» solo con lo confirmado", () => {
  test("sin confirmar no hay tabla ni botón; confirmado, lleva las posiciones confirmadas", async () => {
    const send = vi.fn();
    mocks.file.mockResolvedValueOnce(FILE_A);
    await mount(<PositionsWorkbench mode="extracto" onSendToBuilder={send} sourceKind="BBDD_LIVE_API" />);
    await chooseFile();
    await settle();
    await press(EXTRACTO);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect([...host!.querySelectorAll("button")].some((b) => b.textContent === "Llevar a una propuesta")).toBe(false);

    await mark();
    await press(EXTRACTO);
    await press("Llevar a una propuesta");
    expect(send).toHaveBeenCalledTimes(1);
    const transfer = send.mock.calls[0][0] as { positions: Array<{ asset_id: string }>; totalCapital: number };
    expect(transfer.positions.map((p) => p.asset_id)).toEqual([LU, IE]);
    expect(transfer.totalCapital).toBe(200000);
  });
});
