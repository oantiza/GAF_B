// @vitest-environment happy-dom

/* Revisión de la cuarta pasada: comprobación en la pantalla real de
   Posiciones globales y con el lector de ficheros real. Invertido en la
   quinta pasada (antes zz_review4_ui): R4-05, R4-06 y R4-10 arreglados. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as XLSX from "xlsx";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(async () => []), retro: vi.fn(async () => ({})) }));
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => ({}) }));
vi.mock("../src/adapters/resolvePortfolioBackend", () => ({ resolvePortfolioBatch: mocks.resolve }));
vi.mock("../src/adapters/commercialRetroStore", () => ({ getCommercialRetroForAssets: mocks.retro }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { confirmEurosAndAnalyze } from "./support/euroConfirmation";
import { readImportFileText, readPositionImportFileText } from "../src/core/importFileReader";
import { parsePositionImport } from "../src/core/positionImport";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { PositionsWorkbench } from "../src/components/PositionsWorkbench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function paste(text: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ClientModeProvider initialValue={false}><PositionsWorkbench mode="global" sourceKind="BBDD_LIVE_API" /></ClientModeProvider>);
  });
  const input = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Calcular retrocesiones")!.click();
  });
  // Séptima pasada: lo leído se confirma siempre antes de llegar al backend.
  await confirmEurosAndAnalyze(host, "Calcular retrocesiones");
  const warning = host.querySelector('[aria-label="Avisos de la importación"]')?.textContent ?? null;
  // El importe en euros lleva un espacio duro antes del «€»: se normaliza para comparar.
  const summary = host.querySelector('[aria-label="Resumen de la importación"]')?.textContent?.replace(/\s/g, " ") ?? null;
  await act(async () => { root.unmount(); });
  host.remove();
  return { warning, summary };
}

test("N47 · primera línea «;;» y «ISIN;Nombre;Peso %»: no llega nada al backend y el aviso dice por qué", async () => {
  mocks.resolve.mockClear();
  const { warning, summary } = await paste(";;\nISIN;Nombre;Peso %\nLU1234567891;Fondo A;40\nIE0098765432;Fondo B;60");
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(warning).toContain("No se reconoce la columna de importe del extracto: no se importa ningún importe");
  expect(warning).toContain("«Peso %» no es un importe");
  expect(summary).toContain("No se ha leído ninguna posición.");
});

test("N12 · lista de pesos «40 %»: no llega nada al backend y el aviso nombra las dos líneas", async () => {
  mocks.resolve.mockClear();
  const { warning } = await paste("LU1234567891;40 %\nIE0098765432;60 %");
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(warning).toContain("2 posiciones con porcentajes en vez de un importe (LU1234567891 («40 %»), IE0098765432 («60 %»))");
});

test("N11 · «8.736,00 USD» en la lista: solo llega LU; IE, avisada por su ISIN", async () => {
  mocks.resolve.mockClear();
  const { warning, summary } = await paste("LU1234567891;Fondo A;80.000,00 €\nIE0098765432;ETF B;8.736,00 USD");
  expect(mocks.resolve.mock.calls[0]?.[0]).toEqual([{ asset_id: "LU1234567891", amount: 80000 }]);
  expect(warning).toContain("IE0098765432 (8.736,00 USD)");
  expect(summary).toContain("1 posición leída por 80.000,00 € en total.");
  expect(summary).toContain("1 fila descartada: en otra divisa sin contravalor en EUR (IE0098765432 (8.736,00 USD))");
});

function libro(sheets: Array<{ name: string; rows: unknown[][]; fmt?: Record<string, string> }>): File {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    for (const [addr, z] of Object.entries(sheet.fmt ?? {})) if (ws[addr]) ws[addr].z = z;
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buffer], "cartera.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

test("X60 · .xlsx con dos hojas: se leen las dos, y el resumen dice cuáles", async () => {
  const file = libro([
    { name: "Cuenta 1", rows: [["Producto", "ISIN", "Contravalor EUR"], ["Fondo A", "LU1234567891", 80000]] },
    { name: "Cuenta 2", rows: [["Producto", "ISIN", "Contravalor EUR"], ["ETF B", "IE0098765432", 120000]] }
  ]);
  const text = await readPositionImportFileText(file);
  const { entries, warnings, summary } = parsePositionImport(text);
  expect(entries).toEqual([
    { id: "LU1234567891", amount: 80000 },
    { id: "IE0098765432", amount: 120000 }
  ]);
  expect(warnings).toEqual([]);
  expect(summary.sources).toEqual(["hoja «Cuenta 1»", "hoja «Cuenta 2»"]);
  // La cartera real sigue leyendo la primera hoja, como antes.
  expect(await readImportFileText(file)).toBe("Producto;ISIN;Contravalor EUR\nFondo A;LU1234567891;80000");
});

test("X61 · una hoja «Resumen» delante: se avisa de que no se lee y entran las posiciones de la otra", async () => {
  const file = libro([
    { name: "Resumen", rows: [["Tipo", "Importe"], ["FONDOS", 80000], ["ETF", 120000]] },
    { name: "Posiciones", rows: [["Producto", "ISIN", "Contravalor EUR"], ["Fondo A", "LU1234567891", 80000], ["ETF B", "IE0098765432", 120000]] }
  ]);
  const { entries, warnings } = parsePositionImport(await readPositionImportFileText(file));
  expect(entries.map((e) => e.id)).toEqual(["LU1234567891", "IE0098765432"]);
  // Octava pasada (B6): el aviso nombra las filas de la hoja que no se lee.
  expect(warnings).toEqual(["La hoja «Resumen» no tiene una tabla de posiciones con ISIN: no se lee («FONDOS» y «ETF»)."]);
});

test("X62 · el formato de moneda USD de la celda cuenta: «Valor de mercado» en dólares no entra como euros, en GP ni en el Constructor", async () => {
  const file = libro([
    {
      name: "Posiciones",
      rows: [["Producto", "ISIN", "Valor de mercado"], ["Fondo A", "LU1234567891", 80000], ["ETF B", "IE0098765432", 8736]],
      fmt: { C2: '#,##0.00 "€"', C3: '"$"#,##0.00' }
    }
  ]);
  const text = await readPositionImportFileText(file);
  const gp = parsePositionImport(text);
  expect(gp.entries).toEqual([{ id: "LU1234567891", amount: 80000 }]);
  expect(gp.warnings.join(" ")).toContain("IE0098765432 (8736 USD)");
  const activo = (assetId: string) =>
    ({ asset_id: assetId, display_name: assetId, instrument_type: "FUND", role: "INVESTABLE", is_investable: true, quality_flags: [] }) as unknown as BdbAssetDetail;
  const constructor = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, resolveAsset: activo });
  expect(constructor.imported_positions.map((p) => p.asset_id)).toEqual(["LU1234567891"]);
  expect(constructor.detected_capital).toBe(80000);
});
