// @vitest-environment happy-dom

/* Séptima pasada del importador (auditoría del 16-10-2026): en el Constructor,
   TODA importación con posiciones queda pendiente —un extracto con o sin
   contravalor en EUR, el HTML «Mercado» de Andbank, el formato de pesos—: ni
   las posiciones ni los pesos ni el capital se cargan, y por tanto nada se
   guarda como propuesta, hasta que el asesor confirma en el panel. Si se
   importan dos ficheros seguidos, gana el último (M2). */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import type { BdbPortfolioImportResult } from "../src/types/bdbAssets";

const MERCADO = `<table>
<tr><td>Producto</td><td>ISIN</td><td>Mercado</td><td>Valor de mercado</td></tr>
<tr><td>Fund A</td><td>LU0289214628</td><td>FEX</td><td>80000.00</td></tr>
<tr><td>Fund B</td><td>LU2222028099</td><td>FEX</td><td>120000.00</td></tr>
<tr><td>TOTAL</td><td></td><td></td><td>200000.00</td></tr>
</table>`;

describe("buildLocalPortfolioImport", () => {
  test("Andbank «Mercado»: los mismos pesos y el mismo capital que antes, pendientes de confirmar", async () => {
    const { buildLocalPortfolioImport } = await vi.importActual<typeof import("../src/core/portfolioImport")>("../src/core/portfolioImport");
    const activo = (assetId: string) =>
      ({ asset_id: assetId, display_name: assetId, instrument_type: "FUND", role: "INVESTABLE", is_investable: true, quality_flags: [] }) as never;
    const r = await buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text: MERCADO, resolveAsset: activo });
    expect(r.imported_positions.map((p) => [p.asset_id, p.weight_percent])).toEqual([
      ["LU0289214628", 40],
      ["LU2222028099", 60]
    ]);
    expect(r.detected_capital).toBe(200000);
    expect(r.euro_confirmation?.positions.map(({ id, name, amount }) => ({ id, name, amount }))).toEqual([
      { id: "LU0289214628", name: "Fund A", amount: 80000 },
      { id: "LU2222028099", name: "Fund B", amount: 120000 }
    ]);
    // Octava pasada: el resumen dice cuántas hay que comprobar; la lista la pinta el panel como tabla.
    const summary = (r.import_summary ?? []).map((line) => line.replace(/\s/g, " "));
    expect(summary).toContain("Posiciones para comprobar (ISIN · nombre · importe), de mayor a menor: 2, todas sin que el fichero diga su divisa.");
    expect(summary).toContain("Divisa: «Valor de mercado» no dice su divisa y el fichero no menciona ninguna otra divisa.");
    expect(r.euro_confirmation?.positions.every((position) => position.eurStated === false)).toBe(true);
    expect(r.euro_confirmed).toBeUndefined();
  });

  test("con contravalor en EUR también se confirma, y el resumen dice que la cabecera dice EUR", async () => {
    const { buildLocalPortfolioImport } = await vi.importActual<typeof import("../src/core/portfolioImport")>("../src/core/portfolioImport");
    const activo = (assetId: string) =>
      ({ asset_id: assetId, display_name: assetId, instrument_type: "FUND", role: "INVESTABLE", is_investable: true, quality_flags: [] }) as never;
    const r = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: "Producto;ISIN;Contravalor EUR\nA;LU0289214628;80000\nB;LU2222028099;120000",
      resolveAsset: activo
    });
    expect(r.euro_confirmation?.positions.map((p) => p.id)).toEqual(["LU0289214628", "LU2222028099"]);
    expect(r.euro_confirmation?.reason).toBe("la cabecera «Contravalor EUR» dice EUR");
    expect(r.import_summary).toContain("Divisa: la cabecera «Contravalor EUR» dice EUR.");
  });
});

/* La página del Constructor, con el resultado de la importación pendiente. */
const pendingResult = {
  sourceKind: "LOCAL_MOCK",
  imported_positions: [{ asset_id: "LU0289214628", weight_percent: 100, label: "Fondo importado" }],
  rejected_positions: [],
  total_weight_percent: 100,
  detected_capital: 250000,
  warnings: [],
  import_summary: ["1 posición leída por 250.000,00 € en total."],
  euro_confirmation: { positions: [{ id: "LU0289214628", name: "Fondo importado", amount: 250000 }], reason: "la cabecera «Contravalor EUR» dice EUR" },
  local_only_notice: ""
} as unknown as BdbPortfolioImportResult;

/** Formato «asset_id,peso»: sin importes, sin «euro_confirmation», y también pendiente. */
const weightsResult = {
  sourceKind: "LOCAL_MOCK",
  imported_positions: [
    { asset_id: "FR0000120271", weight_percent: 40, label: "Fondo P" },
    { asset_id: "IE0098765432", weight_percent: 60, label: "Fondo Q" }
  ],
  rejected_positions: [],
  total_weight_percent: 100,
  warnings: [],
  import_summary: ["Formato «asset_id,peso»: 2 líneas con pesos, sin importes en euros; 2 posiciones leídas."],
  local_only_notice: ""
} as unknown as BdbPortfolioImportResult;

const page = vi.hoisted(() => ({
  build: vi.fn(),
  save: vi.fn()
}));

vi.mock("../src/core/portfolioImport", () => ({ buildLocalPortfolioImport: page.build }));
vi.mock("../src/core/useSavedPortfolios", () => ({
  useSavedPortfolios: () => ({ savedPortfolios: [], discardedCount: 0, save: page.save, load: () => undefined, remove: async () => undefined })
}));
vi.mock("../src/components/PortfolioBuilder", () => ({
  PortfolioBuilder: ({
    onImportText,
    onConfirmImport,
    onChooseImportOption,
    onSaveLocalPortfolio,
    initialCapital,
    positions,
    portfolioNotice
  }: {
    onImportText: (text: string) => Promise<void>;
    onConfirmImport?: () => void;
    onChooseImportOption?: (key: string, value: string) => void;
    onSaveLocalPortfolio: (name: string, positions: Array<{ asset_id: string }>, assets: unknown[], capital: number | undefined) => void;
    initialCapital: number;
    positions: Array<{ asset_id: string }>;
    portfolioNotice: string | null;
  }) =>
    createElement(
      "div",
      null,
      createElement("output", { id: "capital" }, String(initialCapital)),
      createElement("output", { id: "posiciones" }, positions.map((p) => p.asset_id).join(",")),
      createElement("output", { id: "aviso" }, portfolioNotice ?? ""),
      createElement("button", { id: "importar", onClick: () => void onImportText("extracto A") }, "Importar"),
      createElement("button", { id: "importar-b", onClick: () => void onImportText("extracto B") }, "Importar B"),
      createElement("button", { id: "confirmar", onClick: () => onConfirmImport?.() }, "Confirmar"),
      createElement("button", { id: "elegir", onClick: () => onChooseImportOption?.("bloque", "2") }, "Elegir"),
      createElement("button", { id: "incluir", onClick: () => onChooseImportOption?.("incluir-sin-prueba", "sí") }, "Incluir"),
      // «Guardar» y «Guardar como propuesta» guardan las posiciones que tiene el Constructor.
      createElement("button", { id: "guardar", onClick: () => onSaveLocalPortfolio("Cliente · propuesta", positions, [], initialCapital) }, "Guardar")
    )
}));
vi.mock("../src/pages/PortfolioReportPage", () => ({ PortfolioReportPage: () => null }));

async function mountPage() {
  const { PortfolioBuilderPage } = await import("../src/pages/PortfolioBuilderPage");
  function Shell() {
    const [positions, setPositions] = useState([{ asset_id: "IE00B03HCZ61", weight_percent: 100, label: "Fondo inicial" }]);
    const [totalCapital, setTotalCapital] = useState(100000);
    return createElement(PortfolioBuilderPage, {
      positions,
      setPositions,
      sourceKind: "BBDD_STATIC_EXPORT_SAMPLE",
      totalCapital,
      onCapitalChange: setTotalCapital,
      portfolioName: "Cartera",
      onPortfolioNameChange: () => undefined,
      view: "builder",
      onViewChange: () => undefined
    } as never);
  }
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Shell)); });
  return {
    text: (id: string) => host.querySelector(`#${id}`)?.textContent ?? "",
    click: async (id: string) => {
      await act(async () => { host.querySelector<HTMLButtonElement>(`#${id}`)!.click(); });
    },
    close: async () => {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  };
}

describe("PortfolioBuilderPage", () => {
  test("una importación pendiente no carga posiciones ni capital hasta que el asesor confirma", async () => {
    page.build.mockReset().mockResolvedValue(pendingResult);
    const view = await mountPage();
    try {
      await view.click("importar");
      expect(view.text("posiciones")).toBe("IE00B03HCZ61");
      expect(view.text("capital")).toBe("100000");
      expect(view.text("aviso")).toContain("Importación pendiente de confirmar");

      await view.click("confirmar");
      expect(view.text("posiciones")).toBe("LU0289214628");
      expect(view.text("capital")).toBe("250000");
    } finally {
      await view.close();
    }
  });

  test("el formato de pesos también queda pendiente hasta confirmar", async () => {
    page.build.mockReset().mockResolvedValue(weightsResult);
    const view = await mountPage();
    try {
      await view.click("importar");
      expect(view.text("posiciones")).toBe("IE00B03HCZ61");
      expect(view.text("aviso")).toContain("Importación pendiente de confirmar: 2 posiciones");
      await view.click("confirmar");
      expect(view.text("posiciones")).toBe("FR0000120271,IE0098765432");
    } finally {
      await view.close();
    }
  });

  test("guardar como propuesta con una importación pendiente guarda la cartera de antes, no la importada", async () => {
    page.build.mockReset().mockResolvedValue(pendingResult);
    page.save.mockReset().mockResolvedValue(undefined);
    const view = await mountPage();
    try {
      await view.click("importar");
      await view.click("guardar");
      expect(page.save).toHaveBeenCalledTimes(1);
      expect((page.save.mock.calls[0][1] as Array<{ asset_id: string }>).map((p) => p.asset_id)).toEqual(["IE00B03HCZ61"]);
      expect(page.save.mock.calls[0][3]).toBe(100000);
    } finally {
      await view.close();
    }
  });

  test("M2 · dos importaciones seguidas: gana la última aunque la primera tarde más, y la primera no se puede confirmar", async () => {
    let finishA: (result: BdbPortfolioImportResult) => void = () => undefined;
    page.build
      .mockReset()
      .mockImplementationOnce(() => new Promise<BdbPortfolioImportResult>((resolve) => { finishA = resolve; }))
      .mockImplementationOnce(async () => weightsResult);
    const view = await mountPage();
    try {
      await view.click("importar");
      await view.click("importar-b");
      await act(async () => { finishA(pendingResult); });
      expect(view.text("aviso")).toContain("2 posiciones");
      await view.click("confirmar");
      // Se carga B (pesos), nunca A (el extracto que llegó tarde).
      expect(view.text("posiciones")).toBe("FR0000120271,IE0098765432");
      // B no trae capital y sustituye a una cartera con posiciones: ni el de A ni el de antes (decisión 38).
      expect(view.text("capital")).toBe("undefined");
    } finally {
      await view.close();
    }
  });

  test("octava pasada: con una elección pendiente no se carga nada; elegir rehace la importación con la elección", async () => {
    const pendingChoice = {
      ...pendingResult,
      imported_positions: [],
      detected_capital: undefined,
      euro_confirmation: undefined,
      import_choices: [
        {
          kind: "amount",
          key: "bloque",
          question: "¿Qué columna es el valor de mercado en euros?",
          where: "el extracto",
          reason: "Las columnas no coinciden.",
          options: [{ value: "2", label: "Valor de mercado", total: 250000, positions: 1 }],
          chosen: null
        }
      ]
    } as unknown as BdbPortfolioImportResult;
    page.build.mockReset().mockResolvedValueOnce(pendingChoice).mockResolvedValueOnce(pendingResult);
    const view = await mountPage();
    try {
      await view.click("importar");
      expect(view.text("aviso")).toContain("elige en el resumen");
      await view.click("confirmar");
      expect(view.text("posiciones")).toBe("IE00B03HCZ61");
      await view.click("elegir");
      expect(page.build).toHaveBeenLastCalledWith(expect.objectContaining({ text: "extracto A", choices: { bloque: "2" } }));
      await view.click("confirmar");
      expect(view.text("posiciones")).toBe("LU0289214628");
    } finally {
      await view.close();
    }
  });

  test("una importación nueva deja sin confirmar la anterior mientras se lee", async () => {
    let finishB: (result: BdbPortfolioImportResult) => void = () => undefined;
    page.build
      .mockReset()
      .mockImplementationOnce(async () => pendingResult)
      .mockImplementationOnce(() => new Promise<BdbPortfolioImportResult>((resolve) => { finishB = resolve; }));
    const view = await mountPage();
    try {
      await view.click("importar");
      await view.click("importar-b");
      // A estaba pendiente; con B en curso, confirmar no carga A.
      await view.click("confirmar");
      expect(view.text("posiciones")).toBe("IE00B03HCZ61");
      await act(async () => { finishB(weightsResult); });
      await view.click("confirmar");
      expect(view.text("posiciones")).toBe("FR0000120271,IE0098765432");
    } finally {
      await view.close();
    }
  });

  test("décima pasada (I1): la segunda casilla queda ligada a la entrada y a las demás elecciones", async () => {
    page.build.mockReset().mockResolvedValue(pendingResult);
    const view = await mountPage();
    try {
      await view.click("importar");
      await view.click("incluir");
      expect(page.build).toHaveBeenLastCalledWith(expect.objectContaining({ text: "extracto A", choices: { "incluir-sin-prueba": "sí" } }));
      // Otra elección la borra: lo que se había comprobado eran otras posiciones.
      await view.click("elegir");
      expect(page.build).toHaveBeenLastCalledWith(expect.objectContaining({ text: "extracto A", choices: { bloque: "2" } }));
      await view.click("incluir");
      // Un fichero nuevo empieza sin ninguna elección, tampoco la segunda casilla (M1 de la revisión 9).
      await view.click("importar-b");
      expect(page.build).toHaveBeenLastCalledWith(expect.objectContaining({ text: "extracto B", choices: {} }));
    } finally {
      await view.close();
    }
  });
});
