// @vitest-environment happy-dom

/* Novena pasada del importador (revisión 8), en pantalla:
   - I9: la puerta de elección de Posiciones globales con un bloque pendiente y
     otro con posiciones (N31): la casilla está desactivada y «Calcular» no llega
     a la fuente hasta elegir (la mutación M3 de la revisión 8 tiene que morir);
   - I5: la segunda casilla, desmarcada por defecto y ligada a la entrada; lo
     que la regla de divisa deja fuera va aparte, con su importe y su motivo;
   - M1: lo pendiente va en ocre, también una elección sin posiciones;
   - I10 y M7: en el Constructor la lista se lee en una columna estrecha, con
     el importe y la nota a la vista. */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  comparable: vi.fn(),
  retro: vi.fn()
}));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({ getComparableAssets: mocks.comparable }) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PortfolioImportPanel } from "../src/components/PortfolioImportPanel";
import { INCLUDE_UNPROVEN_KEY, INCLUDE_UNPROVEN_YES, includeUnprovenText } from "../src/core/importSummary";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import { clearSessionCaches } from "../src/core/sessionCaches";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { confirmationLines, euroConfirmationBox } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LU = "LU1234567891";
const IE = "IE0098765432";
const FR = "FR0000120271";
const GLOBAL = "Calcular retrocesiones";
const SUMMARY = '[aria-label="Resumen de la importación"]';

const fund = (id: string) => ({ asset_id: id, display_name: `Fondo ${id}`, instrument_type: "FUND", is_investable: true, role: "INVESTABLE", quality_flags: [] });

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ClientModeProvider initialValue={false}>{node}</ClientModeProvider>); });
  return host;
}

async function paste(text: string) {
  const input = host!.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Pulsa TODOS los botones con ese texto (el de arriba y el del resumen). */
async function pressAll(label: string) {
  const buttons = [...host!.querySelectorAll("button")].filter((b) => b.textContent === label);
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) await act(async () => { button.click(); });
}

async function choose(label: string) {
  const radio = [...host!.querySelectorAll<HTMLInputElement>('[role="radiogroup"] input[type="radio"]')].find((input) =>
    input.closest("label")?.textContent?.includes(label)
  );
  expect(radio, `falta la opción «${label}»`).toBeDefined();
  await act(async () => { radio!.click(); });
}

const includeBox = () =>
  [...host!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => input.closest("label")?.textContent?.startsWith("Incluir también")) ?? null;

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
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  clearSessionCaches();
});

describe("Posiciones globales: un bloque por elegir y otro con posiciones (I9, N31)", () => {
  const N31 = [
    "Fondos", "Producto;ISIN;Importe (€);Valor de mercado", `Fondo A;${LU};75000;80000`, `Fondo B;${IE};100000;120000`, "",
    "Acciones", "Producto;ISIN;Valor de mercado EUR", `Acción C;${FR};30000`
  ].join("\n");

  test("la casilla existe pero está desactivada, y ningún «Calcular» llega a la fuente hasta elegir", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(N31);
    await pressAll(GLOBAL);
    // El bloque «Acciones» ya tiene posición: la tabla y la casilla se ven.
    expect(confirmationLines(host!)).toEqual([`${FR} · Acción C · 30.000,00 €`]);
    const box = euroConfirmationBox(host!);
    expect(box).not.toBeNull();
    expect(box!.disabled).toBe(true);
    await act(async () => { box!.click(); });
    expect(box!.checked).toBe(false);
    await pressAll(GLOBAL);
    await pressAll(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(host!.querySelector(".positions-table-panel .tabla")).toBeNull();

    await choose("«Valor de mercado»");
    expect(euroConfirmationBox(host!)!.disabled).toBe(false);
    await act(async () => { euroConfirmationBox(host!)!.click(); });
    await pressAll(GLOBAL);
    expect(mocks.resolve).toHaveBeenLastCalledWith([
      { asset_id: LU, amount: 80000 },
      { asset_id: IE, amount: 120000 },
      { asset_id: FR, amount: 30000 }
    ]);
  });

  test("M1 · una elección pendiente sin ninguna posición va en ocre", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(`Producto;ISIN;Importe (€);Valor de mercado\nFondo A;${LU};75000;80000`);
    await pressAll(GLOBAL);
    expect(euroConfirmationBox(host!)).toBeNull();
    /* Rediseño: el resumen es un `Aviso`; lo pendiente, en su tono de aviso (ocre). */
    expect(host!.querySelector(SUMMARY)?.querySelector(".aviso")?.className).toBe("aviso aviso--aviso");
  });
});

describe("Posiciones globales: la segunda casilla (I5)", () => {
  const MERCADO_NOTA =
    `<table><tr><td>Producto</td><td>ISIN</td><td>Mercado</td><td>Valor de mercado</td></tr>` +
    `<tr><td>Fondo Renta Fija Euro</td><td>${LU}</td><td>FEX</td><td>80000.00</td></tr>` +
    `<tr><td>Fondo Bolsa Europa</td><td>${FR}</td><td>FEX</td><td>30000.00</td></tr></table>` +
    `<p>Las posiciones en dólares se valoran al cambio del día.</p>`;

  test("desmarcada por defecto, lo de fuera se ve aparte y no se usa; marcada, entra marcado y se confirma", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(MERCADO_NOTA);
    await pressAll(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(euroConfirmationBox(host!)).toBeNull();
    expect(includeBox()).not.toBeNull();
    expect(includeBox()!.checked).toBe(false);
    expect(includeBox()!.closest("label")?.textContent).toBe(includeUnprovenText(2));
    expect(confirmationLines(host!, "Posiciones fuera, sin prueba de EUR")).toEqual([
      `${LU} · Fondo Renta Fija Euro · 80.000,00 (el fichero menciona USD)`,
      `${FR} · Fondo Bolsa Europa · 30.000,00 (el fichero menciona USD)`
    ]);
    /* Rediseño: el resumen es un `Aviso`; lo pendiente, en su tono de aviso (ocre). */
    expect(host!.querySelector(SUMMARY)?.querySelector(".aviso")?.className).toBe("aviso aviso--aviso");

    await act(async () => { includeBox()!.click(); });
    expect(includeBox()!.checked).toBe(true);
    expect(host!.querySelector('table[aria-label="Posiciones fuera, sin prueba de EUR"]')).toBeNull();
    expect(confirmationLines(host!)).toEqual([
      `${LU} · Fondo Renta Fija Euro · 80.000,00 € (el fichero no dice su divisa; incluida a mano: el fichero menciona USD)`,
      `${FR} · Fondo Bolsa Europa · 30.000,00 € (el fichero no dice su divisa; incluida a mano: el fichero menciona USD)`
    ]);
    await pressAll(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
    await act(async () => { euroConfirmationBox(host!)!.click(); });
    await pressAll(GLOBAL);
    expect(mocks.resolve).toHaveBeenCalledWith([
      { asset_id: LU, amount: 80000 },
      { asset_id: FR, amount: 30000 }
    ]);
  });

  test("queda ligada a la entrada: otro texto la borra", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(MERCADO_NOTA);
    await pressAll(GLOBAL);
    await act(async () => { includeBox()!.click(); });
    await paste(`${MERCADO_NOTA} `);
    await pressAll(GLOBAL);
    expect(includeBox()!.checked).toBe(false);
    expect(euroConfirmationBox(host!)).toBeNull();
  });
});

describe("Posiciones globales: la segunda casilla queda ligada a las elecciones (décima pasada, I1)", () => {
  test("marcada con un titular, elegir otro la desmarca y no entra nada del otro sin listarlo (P21)", async () => {
    await mount(<PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" />);
    await paste(
      [
        "Importes en USD salvo indicación", "Titular;Producto;ISIN;Valor de mercado",
        `Ana Ruiz;Fondo A;${LU};80000`, `Ana Ruiz;Fondo B;${IE};120000`, `Luis Gómez;Fondo C;${FR};30000`
      ].join("\n")
    );
    await pressAll(GLOBAL);
    await choose("Ana Ruiz");
    expect(includeBox()!.checked).toBe(false);
    await act(async () => { includeBox()!.click(); });
    expect(confirmationLines(host!).map((line) => line.split(" · ")[0])).toEqual([IE, LU]);
    await choose("Luis Gómez");
    expect(includeBox()!.checked).toBe(false);
    expect(host!.querySelector('table[aria-label="Posiciones para comprobar"]')).toBeNull();
    expect(confirmationLines(host!, "Posiciones fuera, sin prueba de EUR").map((line) => line.split(" · ")[0])).toEqual([FR]);
    await pressAll(GLOBAL);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});

describe("Constructor: la casilla de confirmación queda ligada a SU importación (undécima pasada, b.7)", () => {
  const activo = (id: string) => ({ ...fund(id), economic_asset_class: "EQUITY", currency: "EUR", coverage_status: "FULL", warnings: [], metrics: {} }) as unknown as BdbAssetDetail;

  test("marcada para una importación, otra (otra elección, la segunda casilla o un fichero nuevo) la vuelve a pedir", async () => {
    const text = `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};Fondo Global A USD Acc;EUR;8.736,00`;
    const first = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, resolveAsset: activo });
    const onConfirm = vi.fn();
    const panel = (result: typeof first) => (
      <PortfolioImportPanel importResult={result} onImportText={async () => {}} onConfirmImport={onConfirm} onChooseImportOption={() => {}} embedded />
    );
    await mount(panel(first));
    const load = () => [...host!.querySelectorAll("button")].find((button) => button.textContent === "Cargar las posiciones")!;
    await act(async () => { euroConfirmationBox(host!)!.click(); });
    expect(euroConfirmationBox(host!)!.checked).toBe(true);
    expect(load().disabled).toBe(false);

    // La misma entrada con la segunda casilla marcada es otra importación: la confirmación se vuelve a pedir.
    const second = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, choices: { [INCLUDE_UNPROVEN_KEY]: INCLUDE_UNPROVEN_YES }, resolveAsset: activo });
    await act(async () => { root!.render(<ClientModeProvider initialValue={false}>{panel(second)}</ClientModeProvider>); });
    expect(euroConfirmationBox(host!)!.checked).toBe(false);
    expect(load().disabled).toBe(true);
    await act(async () => { load().click(); });
    expect(onConfirm).not.toHaveBeenCalled();

    // Y un fichero nuevo, igual.
    const third = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text: `ISIN;Nombre;Contravalor EUR\n${FR};Fondo C;30.000,00`, resolveAsset: activo });
    await act(async () => { euroConfirmationBox(host!)!.click(); });
    await act(async () => { root!.render(<ClientModeProvider initialValue={false}>{panel(third)}</ClientModeProvider>); });
    expect(euroConfirmationBox(host!)!.checked).toBe(false);
    expect(load().disabled).toBe(true);
  });
});

describe("Constructor: la segunda casilla y la lista en una columna estrecha (I5, I10, M7)", () => {
  const activo = (id: string) => ({ ...fund(id), economic_asset_class: "EQUITY", currency: "EUR", coverage_status: "FULL", warnings: [], metrics: {} }) as unknown as BdbAssetDetail;

  test("la casilla pide incluir con la clave de la entrada; la lista enseña el importe y la nota en la misma fila", async () => {
    const text = `ISIN;Nombre;Divisa;Valor de mercado\n${LU};Fondo A;EUR;80.000,00\n${IE};Fondo Global A USD Acc;EUR;8.736,00`;
    const result = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, resolveAsset: activo });
    const onChoose = vi.fn();
    await mount(<PortfolioImportPanel importResult={result} onImportText={async () => {}} onConfirmImport={() => {}} onChooseImportOption={onChoose} embedded />);
    expect(includeBox()!.checked).toBe(false);
    expect(confirmationLines(host!, "Posiciones fuera, sin prueba de EUR")).toEqual([
      `${IE} · Fondo Global A USD Acc · 8.736,00 («Divisa» dice EUR y el nombre, USD)`
    ]);
    await act(async () => { includeBox()!.click(); });
    expect(onChoose).toHaveBeenCalledWith(INCLUDE_UNPROVEN_KEY, INCLUDE_UNPROVEN_YES);

    const included = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, choices: { [INCLUDE_UNPROVEN_KEY]: INCLUDE_UNPROVEN_YES }, resolveAsset: activo });
    await act(async () => {
      root!.render(
        <ClientModeProvider initialValue={false}>
          <PortfolioImportPanel importResult={included} onImportText={async () => {}} onConfirmImport={() => {}} onChooseImportOption={onChoose} embedded />
        </ClientModeProvider>
      );
    });
    const table = host!.querySelector('table[aria-label="Posiciones para comprobar"]')!;
    // Dos columnas: la posición (nombre, ISIN y nota apilados) y el importe.
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Posición", "Importe"]);
    const row = [...table.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(IE))!;
    expect(row.querySelectorAll("td")).toHaveLength(2);
    expect(row.querySelector('[data-field="note"]')?.textContent).toContain("incluida a mano");
    expect(row.querySelector('[data-field="amount"]')?.className).toBe("num");
    expect(row.querySelector('[data-field="id"]')?.className).toBe("cell-entity__code");
  });
});
