// @vitest-environment happy-dom

/* Quinta pasada: el panel de importar del Constructor enseña SIEMPRE el
   resumen de la importación (lo leído, la columna, la divisa y lo descartado),
   también cuando no hay avisos. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { PortfolioImportPanel } from "../src/components/PortfolioImportPanel";
import { WEIGHTS_CONFIRMATION_TEXT } from "../src/core/importSummary";
import type { BdbPortfolioImportResult } from "../src/types/bdbAssets";
import { confirmationLines, EURO_CONFIRMATION_LABEL } from "./support/euroConfirmation";

const files = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/core/importFileReader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/importFileReader")>()),
  readPositionImportFileText: files.read
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("el resumen se ve junto a «Importación sin avisos adicionales» (una vez cargada)", async () => {
  const importResult: BdbPortfolioImportResult = {
    sourceKind: "LOCAL_MOCK",
    imported_positions: [{ asset_id: "LU1234567891", weight_percent: 100, label: "Fondo A" }],
    rejected_positions: [],
    total_weight_percent: 100,
    detected_capital: 80000,
    warnings: [],
    import_summary: ["1 posición leída por 80.000,00 € en total.", "Importe: columna «Contravalor EUR»."],
    euro_confirmed: true,
    local_only_notice: "Importación local."
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<PortfolioImportPanel importResult={importResult} onImportText={async () => {}} embedded />);
    });
    const summary = host.querySelector('[aria-label="Resumen de la importación"]');
    expect(summary?.getAttribute("role")).toBe("status");
    expect(summary?.textContent).toContain("1 posición leída por 80.000,00 € en total.");
    expect(summary?.textContent).toContain("Importe: columna «Contravalor EUR».");
    expect(host.textContent).toContain("Importación sin avisos adicionales.");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("séptima pasada: «Cargar las posiciones» solo se activa tras marcar la casilla", async () => {
  const importResult: BdbPortfolioImportResult = {
    sourceKind: "LOCAL_MOCK",
    imported_positions: [{ asset_id: "LU1234567891", weight_percent: 100, label: "Fondo A" }],
    rejected_positions: [],
    total_weight_percent: 100,
    detected_capital: 80000,
    warnings: [],
    import_summary: [
      "1 posición leída por 80.000,00 € en total.",
      "Posiciones para comprobar (ISIN · nombre · importe):",
      "LU1234567891 · Fondo A · 80.000,00 €"
    ],
    euro_confirmation: { positions: [{ id: "LU1234567891", name: "Fondo A", amount: 80000 }], reason: "la cabecera «Contravalor EUR» dice EUR" },
    local_only_notice: "Importación local."
  };
  const onConfirmImport = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<PortfolioImportPanel importResult={importResult} onImportText={async () => {}} onConfirmImport={onConfirmImport} embedded />);
    });
    const summary = host.querySelector('[aria-label="Resumen de la importación"]')!;
    /* Lo pinta la pieza `Aviso` (MAR-21): lo pendiente, en su tono de aviso (ocre). */
    expect(summary.querySelector(".aviso")?.className).toContain("aviso--aviso");
    const load = [...host.querySelectorAll("button")].find((b) => b.textContent === "Cargar las posiciones")!;
    expect(load.disabled).toBe(true);
    const box = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) =>
      input.closest("label")?.textContent?.includes(EURO_CONFIRMATION_LABEL)
    )!;
    await act(async () => { box.click(); });
    expect(load.disabled).toBe(false);
    await act(async () => { load.click(); });
    expect(onConfirmImport).toHaveBeenCalledTimes(1);

    // Ya confirmada, el panel lo dice y no vuelve a pedirlo.
    await act(async () => {
      root.render(
        <PortfolioImportPanel importResult={{ ...importResult, euro_confirmed: true }} onImportText={async () => {}} onConfirmImport={onConfirmImport} embedded />
      );
    });
    expect(host.textContent).toContain("Importes confirmados en euros por el asesor.");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Cargar las posiciones")).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("octava pasada: con una elección pendiente, la casilla y «Cargar» no se pueden usar; elegir avisa a la página", async () => {
  const importResult: BdbPortfolioImportResult = {
    sourceKind: "LOCAL_MOCK",
    imported_positions: [],
    rejected_positions: [],
    total_weight_percent: 0,
    warnings: ["El extracto tiene varias columnas que podrían ser el importe."],
    import_summary: ["No se ha leído ninguna posición."],
    import_choices: [
      {
        kind: "amount",
        key: "0#isin|nombre|valor de mercado|saldo medio eur",
        question: "¿Qué columna es el valor de mercado en euros?",
        where: "el extracto",
        reason: "Las columnas «Valor de mercado» y «Saldo medio EUR» podrían ser el importe y no coinciden.",
        options: [
          { value: "2", label: "Valor de mercado", total: 200000, positions: 2 },
          { value: "3", label: "Saldo medio EUR", total: 196500, positions: 2 },
          { value: "ninguna", label: "Ninguna: no importar este bloque", total: 0, positions: 0 }
        ],
        chosen: null
      }
    ],
    local_only_notice: "Importación local."
  };
  const onChoose = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<PortfolioImportPanel importResult={importResult} onImportText={async () => {}} onChooseImportOption={onChoose} embedded />);
    });
    const radios = [...host.querySelectorAll<HTMLInputElement>('[role="radiogroup"] input[type="radio"]')];
    expect(radios.map((radio) => radio.closest("label")?.textContent?.replace(/\s/g, " "))).toEqual([
      "«Valor de mercado» · 2 posiciones · 200.000,00 €",
      "«Saldo medio EUR» · 2 posiciones · 196.500,00 €",
      "Ninguna: no importar este bloque"
    ]);
    expect(radios.some((radio) => radio.checked)).toBe(false);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Cargar las posiciones")).toBe(false);
    await act(async () => { radios[0].click(); });
    expect(onChoose).toHaveBeenCalledWith("0#isin|nombre|valor de mercado|saldo medio eur", "2");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("octava pasada: antes de confirmar, nada está «cargado» y la lista marca lo que no se cargará (W45)", async () => {
  const importResult: BdbPortfolioImportResult = {
    sourceKind: "LOCAL_MOCK",
    imported_positions: [{ asset_id: "LU1234567891", weight_percent: 100, label: "Fondo A" }],
    rejected_positions: [],
    total_weight_percent: 100,
    detected_capital: 80000,
    warnings: [],
    import_summary: ["2 posiciones leídas por 130.000,00 € en total."],
    euro_confirmation: {
      positions: [
        { id: "LU1234567891", name: "Fondo A", amount: 80000, eurStated: true },
        { id: "XS1234567891", name: "Bono C", amount: 50000, eurStated: true, notes: ["no está en la maestra: no se cargará"] }
      ],
      reason: "la cabecera «Contravalor EUR» dice EUR"
    },
    local_only_notice: "Importación local."
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<PortfolioImportPanel importResult={importResult} onImportText={async () => {}} onConfirmImport={() => undefined} embedded />);
    });
    expect(host.textContent).toContain("Leídas");
    expect(host.textContent).toContain("Peso leído");
    expect(host.textContent).not.toContain("Cargadas");
    expect(host.textContent).not.toContain("Importación sin avisos adicionales.");
    expect(confirmationLines(host)).toEqual([
      "LU1234567891 · Fondo A · 80.000,00 €",
      "XS1234567891 · Bono C · 50.000,00 € (no está en la maestra: no se cargará)"
    ]);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("DIS-21: el resumen de rechazos dice los índices y también las demás líneas rechazadas", async () => {
  const importResult = {
    sourceKind: "LOCAL_MOCK",
    imported_positions: [{ asset_id: "LU1234567891", weight_percent: 100, label: "Fondo A" }],
    rejected_positions: [
      { line_number: 2, raw_line: "MSCI;10", reason: "NON_INVESTABLE_BENCHMARK", asset_id: "MSCI", message: "Es un índice." },
      { line_number: 3, raw_line: "basura", reason: "MALFORMED_LINE", message: "Formato no válido." },
      { line_number: 4, raw_line: "otra", reason: "MALFORMED_LINE", message: "Formato no válido." }
    ],
    total_weight_percent: 100,
    warnings: [],
    euro_confirmed: true,
    local_only_notice: "Importación local."
  } as unknown as BdbPortfolioImportResult;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<PortfolioImportPanel importResult={importResult} onImportText={async () => {}} embedded />);
    });
    const resumen = host.querySelector(".portfolio-import-rejection-summary")?.textContent ?? "";
    expect(resumen).toContain("1 índice rechazado por no ser invertible");
    expect(resumen).toContain("2 líneas rechazadas por otros motivos");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("séptima pasada: el formato de pesos también se confirma, con su propio texto", async () => {
  const importResult: BdbPortfolioImportResult = {
    sourceKind: "LOCAL_MOCK",
    imported_positions: [{ asset_id: "LU1234567891", weight_percent: 100, label: "Fondo A" }],
    rejected_positions: [],
    total_weight_percent: 100,
    warnings: [],
    import_summary: ["Formato «asset_id,peso»: 1 línea con pesos, sin importes en euros; 1 posición leída."],
    local_only_notice: "Importación local."
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<PortfolioImportPanel importResult={importResult} onImportText={async () => {}} onConfirmImport={() => undefined} embedded />);
    });
    expect(host.textContent).toContain(WEIGHTS_CONFIRMATION_TEXT);
    expect(host.textContent).not.toContain(EURO_CONFIRMATION_LABEL);
    const load = [...host.querySelectorAll("button")].find((b) => b.textContent === "Cargar las posiciones")!;
    expect(load.disabled).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test("M2 · dos ficheros seguidos: al Constructor solo llega el último, aunque el primero tarde más en leerse", async () => {
  let finishA: (text: string) => void = () => undefined;
  files.read.mockReset()
    .mockImplementationOnce(() => new Promise<string>((resolve) => { finishA = resolve; }))
    .mockResolvedValueOnce("extracto B");
  const onImportText = vi.fn(async () => undefined);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<PortfolioImportPanel importResult={null} onImportText={onImportText} embedded />);
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    for (const name of ["a.csv", "b.csv"]) {
      Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], name)] });
      await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { finishA("extracto A"); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(onImportText.mock.calls).toEqual([["extracto B"]]);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});
