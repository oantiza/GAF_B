// @vitest-environment happy-dom

/* Séptima pasada del importador (auditoría del 16-10-2026): en Posiciones
   globales, NADA se analiza hasta que el asesor confirma lo que enseña el
   resumen —cada posición con su ISIN, su nombre y su importe—, haya o no «€»,
   contravalor en EUR o columna de divisa: ninguna «prueba de EUR» automática
   es de fiar. Lo que dice el fichero sobre la divisa se conserva en el
   resumen. Y los avisos del fichero se SUMAN a los de la relectura (I1). */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(async (positions: Array<{ asset_id: string; amount: number }>) =>
    positions.map((p) => ({ id: p.asset_id, amount: p.amount, asset: { asset_id: p.asset_id, display_name: p.asset_id, instrument_type: "FUND" } }))
  ),
  retro: vi.fn(async () => new Map()),
  file: vi.fn()
}));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));
vi.mock("../src/core/importFileReader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/importFileReader")>()),
  readPositionImportFileText: mocks.file
}));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";
import { confirmationLines, euroConfirmationBox, IMPORT_WARNINGS } from "./support/euroConfirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LU = "LU1234567891";
const IE = "IE0098765432";
const BUTTON = "Calcular retrocesiones";

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>);
  });
  return {
    host,
    paste: async (text: string) => {
      const input = host.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    analyze: async () => {
      await act(async () => {
        [...host.querySelectorAll("button")].find((b) => b.textContent === BUTTON)!.click();
      });
    },
    upload: async () => {
      const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "extracto.csv")] });
      await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    },
    summary: () => host.querySelector('[aria-label="Resumen de la importación"]')?.textContent?.replace(/\s/g, " ") ?? "",
    warning: () => host.querySelector(IMPORT_WARNINGS)?.textContent ?? "",
    unmount: async () => {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  };
}

test("una lista sin «€» no llega al backend hasta confirmar; el resumen lista cada posición con su nombre y su importe", async () => {
  mocks.resolve.mockClear();
  const view = await mount();
  try {
    await view.paste(`${LU};Fondo A;80.000,00\n${IE};ETF B;7.512,09`);
    await view.analyze();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(view.summary()).toContain("Divisa: la lista no dice en qué divisa están los importes y no menciona ninguna otra divisa.");
    expect(view.summary()).toContain("Posiciones para comprobar (ISIN · nombre · importe), de mayor a menor: 2, todas sin que el fichero diga su divisa.");
    // Octava pasada: tabla de mayor a menor importe, con el criterio débil marcado.
    expect(confirmationLines(view.host)).toEqual([
      `${LU} · Fondo A · 80.000,00 € (el fichero no dice su divisa)`,
      `${IE} · ETF B · 7.512,09 € (el fichero no dice su divisa)`
    ]);
    expect(view.summary()).toContain("Total para comprobar: 87.512,09 €.");
    const box = euroConfirmationBox(view.host)!;
    expect(box.checked).toBe(false);

    // Volver a pulsar sin confirmar no cambia nada.
    await view.analyze();
    expect(mocks.resolve).not.toHaveBeenCalled();

    await act(async () => { box.click(); });
    await view.analyze();
    expect(mocks.resolve).toHaveBeenCalledWith([
      { asset_id: LU, amount: 80000 },
      { asset_id: IE, amount: 7512.09 }
    ]);

    // Cambiar el texto pide confirmar otra vez.
    mocks.resolve.mockClear();
    await view.paste(`${LU};Fondo A;90.000,00`);
    await view.analyze();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(euroConfirmationBox(view.host)?.checked).toBe(false);
  } finally {
    await view.unmount();
  }
});

test("con «€» en cada línea también se confirma; el resumen dice que la línea lo dice", async () => {
  mocks.resolve.mockClear();
  const view = await mount();
  try {
    await view.paste(`${LU};Fondo A;80.000,00 €\n${IE};ETF B;7.512,09 €`);
    await view.analyze();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(view.summary()).toContain("Divisa: «€» o «EUR» en la línea.");
    await act(async () => { euroConfirmationBox(view.host)!.click(); });
    await view.analyze();
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  } finally {
    await view.unmount();
  }
});

test("un fichero con contravalor en EUR también se confirma, y sus avisos se SUMAN a los de la relectura (I1)", async () => {
  mocks.resolve.mockClear();
  mocks.file.mockResolvedValue(
    `Producto;ISIN;Divisa;Valor de mercado;Contravalor EUR\nA;${LU};EUR;80000;80000\nB;${IE};USD;8736;\nC;PRIVADO-1;EUR;45000;45000`
  );
  const view = await mount();
  try {
    await view.upload();
    // Octava pasada (I6): el cuadro trae el propio fichero; tocarlo aplica la misma regla.
    expect(view.host.querySelector("textarea")!.value).toContain(`A;${LU};EUR;80000;80000`);
    expect(view.warning()).toContain(`${IE} (USD)`);
    expect(view.summary()).toContain("Divisa: la cabecera «Contravalor EUR» dice EUR.");
    expect(confirmationLines(view.host)).toContain(`${LU} · A · 80.000,00 €`);
    await view.analyze();
    expect(mocks.resolve).not.toHaveBeenCalled();
    await act(async () => { euroConfirmationBox(view.host)!.click(); });
    await view.analyze();
    expect(mocks.resolve).toHaveBeenCalledWith([
      { asset_id: LU, amount: 80000 },
      { asset_id: "PRIVADO-1", amount: 45000 }
    ]);
    // La relectura avisa del código que no es ISIN, y el aviso de la fila en USD sigue.
    expect(view.warning()).toContain("PRIVADO-1");
    expect(view.warning()).toContain(`${IE} (USD)`);
  } finally {
    await view.unmount();
  }
});

test("un fichero sin divisa (CSV Legacy): el cuadro trae el fichero y se confirma una vez", async () => {
  mocks.resolve.mockClear();
  mocks.file.mockResolvedValue(`CLIENTE;ISIN;INSTRUMENTO;VALOR DE MERCADO\nCliente Uno;${LU};Fondo A;1.000,25\nCliente Dos;${IE};Fondo B;400,00`);
  const view = await mount();
  try {
    await view.upload();
    expect(view.host.querySelector("textarea")!.value).toContain(`Cliente Uno;${LU};Fondo A;1.000,25`);
    expect(view.summary()).toContain("Posiciones para comprobar");
    await act(async () => { euroConfirmationBox(view.host)!.click(); });
    await view.analyze();
    expect(mocks.resolve).toHaveBeenCalledWith([
      { asset_id: LU, amount: 1000.25 },
      { asset_id: IE, amount: 400 }
    ]);
  } finally {
    await view.unmount();
  }
});
