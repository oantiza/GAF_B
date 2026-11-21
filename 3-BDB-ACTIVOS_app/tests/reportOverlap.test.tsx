import { describe, expect, test, vi } from "vitest";
import { buildReportOverlap, casillaNoAplica, corteDeLaMatriz, loadReportOverlap, recortarLaMatriz, reportOverlapPositions, type OverlapPosition } from "../src/core/reportOverlap";
import { calculateOverlap } from "../src/core/overlap";
import { createInformeDeClientePdfBlob } from "../src/reports/informeDeClientePdf";
import { extractPdfPageTexts } from "./support/pdfText";
import type { BdbAssetHoldings, BdbPortfolioReport } from "../src/types/bdbAssets";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";

const positions: OverlapPosition[] = Array.from({ length: 20 }, (_, i) => ({
  asset_id: `F${String(i).padStart(2, "0")}`, display_name: `Fondo ${i} de inversión internacional con un nombre extenso`,
  weight_percent: (i + 1) * 100 / 210, instrument_type: "FUND"
}));
const holdings = (id: string, weights: number[]): BdbAssetHoldings => ({
  asset_id: id, storage_mode: "SINGLE_DOCUMENT", as_of_date: "2026-08-31",
  holdings: weights.map((weight_pct, i) => ({ name: `Empresa ${i}`, isin: `ISIN${i}`, weight_pct }))
});

describe("solapamiento del informe", () => {
  test("selecciona las 15 mayores por peso y conserva las posiciones sin datos", async () => {
    const rows = new Map([["F19", holdings("F19", [50, 50])], ["F04", holdings("F04", [100])]]);
    const batch = vi.fn(async () => rows);
    const model = await loadReportOverlap(positions, { getAssetHoldingsMany: batch });
    expect(batch).toHaveBeenCalledWith(Array.from({ length: 15 }, (_, i) => `F${String(19 - i).padStart(2, "0")}`));
    expect(model.positions).toHaveLength(15);
    expect(model.positions[1].status).toBe("missing");
    expect(model.values[1].every((value) => value === null)).toBe(true);
    expect(model.values[0][0]).toBe(100);
    expect(model.positions.some((row) => row.asset_id === "F04")).toBe(false);
    expect(positions[0].asset_id).toBe("F00");
  });

  test("coincide con el cálculo de pantalla, es simétrica y distingue cero de N/D", () => {
    const selected = reportOverlapPositions(positions).slice(0, 3);
    const a = holdings(selected[0].asset_id, [50, 30, 20]);
    const b = holdings(selected[1].asset_id, [50, 5, 45]);
    const model = buildReportOverlap(selected, new Map([[a.asset_id, a], [b.asset_id, b]]));
    expect(model.values[0][1]).toBe(75);
    expect(model.values[0][1]).toBe(calculateOverlap(a, b).overlapPercent);
    expect(model.values[1][0]).toBe(model.values[0][1]);
    expect(model.values[2][2]).toBeNull();
    b.holdings = [{ name: "Otra empresa", isin: "OTRA", weight_pct: 100 }];
    expect(buildReportOverlap(selected, new Map([[a.asset_id, a], [b.asset_id, b]])).values[0][1]).toBe(0);
  });

  test("no convierte una respuesta cruzada o pesos vacíos en un 0 %", () => {
    const selected = reportOverlapPositions(positions).slice(0, 2);
    const model = buildReportOverlap(selected, new Map([["F19", holdings("OTRO", [100])], ["F18", holdings("F18", [0])]]));
    expect(model.values.flat().every((value) => value === null)).toBe(true);
  });

  test("un fallo parcial se declara y un fallo total permite reintentar la descarga", async () => {
    const selected = reportOverlapPositions(positions).slice(0, 2);
    const source = { getAssetHoldingsMany: vi.fn(async () => { throw new Error("offline"); }),
      getAssetHoldings: vi.fn(async (id: string) => { if (id === "F18") throw new Error("offline"); return holdings(id, [100]); }) };
    expect((await loadReportOverlap(selected, source)).positions[1].status).toBe("failed");
    await expect(loadReportOverlap(selected, { getAssetHoldingsMany: source.getAssetHoldingsMany })).rejects.toThrow("offline");
  });

  test("el PDF conserva los pares nombrados de las 15 mayores, muestra una matriz reducida y numera todas las páginas", async () => {
    const report = { portfolio_name: "Prueba", mode: "BBDD_STATIC_EXPORT_SAMPLE", positions: positions.map((row) => ({...row, economic_asset_class: "EQUITY"})),
      summary: { total_weight_percent: 100, weighted_metrics: {}, by_economic_asset_class: [], by_instrument_type: [] },
      xray: { by_region: [] }, warnings: [], data_diagnostic: {}
    } as unknown as BdbPortfolioReport;
    const byId = new Map(positions.slice(1).map((row) => [row.asset_id, holdings(row.asset_id, [50, 50])]));
    byId.delete("F18");
    const blob = await createInformeDeClientePdfBlob({ report,
      overlap: buildReportOverlap(positions, byId), totalCapital: 100000,
      generadoEn: "2026-09-06T12:00:00Z",
      feasibility: {} as PortfolioFeasibilityCheck });
    const pages = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()));
    const crisisIndex = pages.findIndex((page) => page.includes("en crisis pasadas"));
    const guiaIndex = pages.findIndex((page) => page.includes("Guía de interpretación"));
    const hoja = pages.slice(crisisIndex, guiaIndex).join(" ").replace(/\s+/g, " ");
    /* Numeradas las dos y seguidas; el número depende de si sale el cono estadístico, que va delante (15-11-2026). */
    const [, crisis] = /(\d\d) Crisis pasadas/.exec(hoja) ?? [];
    const [, solapamiento] = /(\d\d) Solapamiento entre fondos/.exec(hoja) ?? [];
    expect(Number(solapamiento)).toBe(Number(crisis) + 1);
    expect(hoja).toContain("Solapamiento entre fondos");
    expect(hoja).toContain("Las 15 mayores posiciones");
    /* Las 15 mayores son F05 a F19; F18 no publica nada, y los otros 14 publican las mismas dos líneas: C(14, 2) = 91 pares, todos al 100. */
    expect(hoja).toContain("91 pares de fondos comparten el 40 % o más de lo que publican:");
    expect(hoja).toContain("Fondo 19 de inversión internacional con un nombre extenso y Fondo 17 de inversión internacional con un nombre extenso comparten al menos el 100,0 % de su cartera publicada.");
    expect(hoja).toContain("Y 86 pares más por encima del 40 %.");
    expect(hoja).toContain("1 de los 15 fondos no publica al menos la mitad de su cartera, y no se puede medir lo que comparte: Fondo 18 de inversión internacional con un nombre extenso.");
    expect(hoja).not.toContain("Fondo 4 de inversión");
    expect(hoja).toContain("Matriz de solapamiento reducida · 6 de 14 fondos con cruces del 40 % o más");
    expect(hoja).toContain("Fuera de la matriz: Fondo 18 de inversión internacional con un nombre extenso: no publica su cartera.");
    expect(hoja).not.toMatch(/N\/D/);
    /* Las hojas fluyen: cada una dice «Página x de N». */
    expect(pages.join(" ")).toContain("Reparto de la cartera");
    pages.forEach((page, i) => expect(page).toContain(`Página ${i + 1} de ${pages.length}`));
  }, 15000);

  test("una acción no entra y lo dice; un fondo que no publica la mitad se nombra, y sin pares medidos no hay cifra", async () => {
    const filas: OverlapPosition[] = [
      { asset_id: "IE00B4L5Y983", display_name: "iShares Core MSCI World", weight_percent: 50, instrument_type: "ETF" },
      { asset_id: "IE00B11XZ103", display_name: "PIMCO Global Bond", weight_percent: 30, instrument_type: "FUND" },
      { asset_id: "ES0144580Y14", display_name: "Iberdrola S.A.", weight_percent: 20, instrument_type: "STOCK" }
    ];
    const report = { portfolio_name: "Prueba", mode: "BBDD_STATIC_EXPORT_SAMPLE", positions: filas.map((row) => ({ ...row, economic_asset_class: "EQUITY" })),
      summary: { total_weight_percent: 100, weighted_metrics: {}, by_economic_asset_class: [], by_instrument_type: [] },
      xray: { by_region: [] }, warnings: [], data_diagnostic: {}
    } as unknown as BdbPortfolioReport;
    const model = buildReportOverlap(filas, new Map([
      ["IE00B4L5Y983", { ...holdings("IE00B4L5Y983", Array(10).fill(2.664)), as_of_date: "2026-09-24" }],
      ["IE00B11XZ103", holdings("IE00B11XZ103", [627.254, -527.254])]
    ]));
    const blob = await createInformeDeClientePdfBlob({ report, overlap: model, totalCapital: 100000,
      generadoEn: "2026-09-06T12:00:00Z",
      feasibility: {} as PortfolioFeasibilityCheck });
    const hoja = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).find((page) => page.includes("Solapamiento entre fondos"))!.replace(/\s+/g, " ");
    /* iShares publica 10 líneas que suman el 26,6 %: menos de la mitad, y su par con PIMCO no se mide. */
    expect(hoja).toContain("No se puede medir el solapamiento de ningún par de fondos.");
    expect(hoja).toContain("1 de los 2 fondos no publica al menos la mitad de su cartera, y no se puede medir lo que comparte: iShares Core MSCI World.");
    expect(hoja).toContain("La acción no entra: no tiene subyacentes.");
    expect(hoja).not.toMatch(/al menos el \d|comparten/);
    expect(hoja).not.toContain("Sin subyacentes");
  }, 15000);

  test.each([undefined, "   ", "  ÁGUILA ÍNDICE ÑOÑO  "])("la portada usa solo el cliente indicado: %s", async (clientName) => {
    const report = { portfolio_name: "Cartera BBDD en vivo", mode: "BBDD_STATIC_EXPORT_SAMPLE", positions: [],
      summary: { total_weight_percent: 0, weighted_metrics: {}, by_economic_asset_class: [], by_instrument_type: [] },
      xray: { by_region: [] }, warnings: [], data_diagnostic: {}
    } as unknown as BdbPortfolioReport;
    const blob = await createInformeDeClientePdfBlob({ report, clientName,
      generadoEn: "2026-09-06T12:00:00Z",
      feasibility: {} as PortfolioFeasibilityCheck });
    const cover = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()))[0];
    expect(cover).not.toContain("Cartera BBDD en vivo");
    expect(cover).not.toContain("Cartera de Banca Privada");
    if (clientName?.trim()) expect(cover).toContain(clientName.trim());
    else expect(cover).not.toContain("ÁGUILA");
  }, 15000);
});

describe("la regla de la mitad en la matriz (decisión 6)", () => {
  /* La cartera de muestra: lo que suman las líneas de cada posición en la base local. */
  const MUESTRA: Array<[string, number, number[], string]> = [
    ["IE00B4L5Y983", 24, Array(10).fill(2.664), "ETF"],
    ["IE00B3XXRP09", 12, Array(10).fill(3.779), "ETF"],
    ["IE00B11XZ103", 20, [527.254, -427.254], "FUND"],
    ["LU1883318740", 10, [111.893, -11.893], "FUND"],
    ["LU0430492750", 10, [100.407, -0.407], "FUND"],
    ["FR0013367265", 9, [100.183, -0.183], "FUND"],
    ["LU0329355670", 8, [100.748, -0.748], "FUND"],
    ["LU1103307408", 7, [313.751, -213.751], "FUND"]
  ];
  const filas = MUESTRA.map(([asset_id, weight_percent, , instrument_type]) => ({ asset_id, display_name: asset_id, weight_percent, instrument_type: instrument_type as "ETF" | "FUND" }));
  const carteras = new Map(MUESTRA.map(([id, , pesos]) => [id, holdings(id, pesos)]));

  test("con la muestra, 28 de 64 casillas pasan a N/D: las de los dos ETF, también contra sí mismos", () => {
    const model = buildReportOverlap(filas, carteras);
    expect(model.values.flat()).toHaveLength(64);
    expect(model.values.flat().filter((value) => value === null)).toHaveLength(28);
    /* Las de los 6 fondos con cartera completa siguen teniendo cifra: 6 × 6. */
    expect(model.values.flat().filter((value) => value !== null)).toHaveLength(36);
    const i = model.positions.findIndex((p) => p.asset_id === "IE00B4L5Y983");
    const j = model.positions.findIndex((p) => p.asset_id === "IE00B3XXRP09");
    expect(model.values[i][j]).toBeNull();
    expect(model.values[i][i]).toBeNull();
    expect(model.positions[i]).toMatchObject({ status: "insufficient", published: { lineas: 10, pesoPct: 26.64, suficiente: false } });
    const pimco = model.positions.find((p) => p.asset_id === "IE00B11XZ103");
    expect(pimco).toMatchObject({ status: "available", published: { lineas: 2, pesoPct: 100, suficiente: true } });
  });

  test("a los dos lados del umbral, con un par inventado", () => {
    const pares = (peso: number) => buildReportOverlap(
      [{ asset_id: "A", display_name: "A", weight_percent: 50, instrument_type: "FUND" }, { asset_id: "B", display_name: "B", weight_percent: 50, instrument_type: "FUND" }],
      new Map([["A", holdings("A", [peso])], ["B", holdings("B", [100])]])
    );
    /* A una sola línea, la misma «Empresa 0» que B: lo común es el peso de A, sin reescalar (decisión 47). */
    expect(pares(49.99).values[0][1]).toBeNull();
    expect(pares(50).values[0][1]).toBe(50);
    expect(pares(50.01).values[0][1]).toBe(50.01);
    /* Y la diagonal, el mismo fondo: 100, aunque de A se haya recibido la mitad. */
    expect(pares(50).values[0][0]).toBe(100);
    expect(pares(49.99).positions[0].status).toBe("insufficient");
    expect(pares(50).positions[0].status).toBe("available");
  });

  test("una acción no aplica, no se le pide cartera y sus casillas no son un dato que falte", async () => {
    const conAccion: OverlapPosition[] = [
      { asset_id: "F1", display_name: "Fondo", weight_percent: 50, instrument_type: "FUND" },
      { asset_id: "CORTO", display_name: "Fondo corto", weight_percent: 30, instrument_type: "ETF" },
      { asset_id: "ES0144580Y14", display_name: "Iberdrola", weight_percent: 20, instrument_type: "STOCK" }
    ];
    const lote = vi.fn(async () => new Map([["F1", holdings("F1", [100])], ["CORTO", holdings("CORTO", [30])]]));
    const model = await loadReportOverlap(conAccion, { getAssetHoldingsMany: lote });
    expect(lote).toHaveBeenCalledWith(["F1", "CORTO"]);
    const accion = model.positions.findIndex((p) => p.asset_id === "ES0144580Y14");
    const corto = model.positions.findIndex((p) => p.asset_id === "CORTO");
    const fondo = model.positions.findIndex((p) => p.asset_id === "F1");
    expect(model.positions[accion].status).toBe("not_applicable");
    expect(casillaNoAplica(model, accion, accion)).toBe(true);
    expect(casillaNoAplica(model, fondo, accion)).toBe(true);
    expect(casillaNoAplica(model, accion, corto)).toBe(true);
    /* El par del corto es N/D: ese sí es un dato que falta. */
    expect(casillaNoAplica(model, fondo, corto)).toBe(false);
    expect(model.values[fondo][corto]).toBeNull();
    expect(model.values[fondo][fondo]).toBe(100);
    expect(model.values[fondo][accion]).toBeNull();
  });

  test("una cartera solo de acciones no pide nada", async () => {
    const lote = vi.fn(async () => new Map());
    const model = await loadReportOverlap([{ asset_id: "S", display_name: "S", weight_percent: 100, instrument_type: "STOCK" }], { getAssetHoldingsMany: lote });
    expect(lote).not.toHaveBeenCalled();
    expect(model.positions[0].status).toBe("not_applicable");
  });
});

/* Óscar, 11-11-2026: la matriz solo lleva los fondos que se pueden medir, y debajo va lo que no entra y por qué. La regla de la mitad no cambia. */
describe("qué entra en la matriz (corteDeLaMatriz)", () => {
  const MUESTRA: Array<[string, string, number[] | null]> = [
    ["A", "FUND", [60, 40]],
    ["CORTO", "ETF", Array(10).fill(4.23)],
    ["B", "FUND", [60, 40]],
    ["SIN", "FUND", null],
    ["ES0144580Y14", "STOCK", null],
    ["C", "FUND", [50, 50]]
  ];
  const filas: OverlapPosition[] = MUESTRA.map(([asset_id, instrument_type], i) => ({ asset_id, display_name: asset_id, weight_percent: 60 - i, instrument_type: instrument_type as "FUND" }));
  const carteras = new Map(MUESTRA.flatMap(([id, , pesos]) => (pesos ? [[id, holdings(id, pesos)] as const] : [])));

  test("medibles y no medibles: entran A, B y C, con las mismas cifras de antes, y debajo cada uno con su motivo", () => {
    const model = buildReportOverlap(filas, carteras);
    const corte = corteDeLaMatriz(model.positions);
    expect(corte.dentro.map((i) => model.positions[i].asset_id)).toEqual(["A", "B", "C"]);
    expect(corte.sinMatriz).toBeNull();
    expect(corte.fuera).toEqual([
      "CORTO: publica el 42,3\u00a0% de su cartera.",
      "SIN: no publica su cartera.",
      "Acción en directo, que no tiene cartera propia: ES0144580Y14."
    ]);
    /* Ninguna cifra cambia: la matriz recortada son las mismas casillas del modelo. */
    const recortada = recortarLaMatriz(model.values, corte.dentro);
    corte.dentro.forEach((i, x) => corte.dentro.forEach((j, y) => expect(recortada[x][y]).toBe(model.values[i][j])));
    expect(recortada.flat().every((v) => v !== null)).toBe(true);
    expect(recortada[0][1]).toBe(calculateOverlap(carteras.get("A"), carteras.get("B")).overlapPercent);
  });

  test("con menos de dos fondos medibles no hay matriz, y una frase dice por qué", () => {
    const uno = buildReportOverlap(filas.slice(0, 2), carteras);
    expect(corteDeLaMatriz(uno.positions)).toEqual({
      dentro: [0],
      sinMatriz: "No hay matriz de solapamiento: hacen falta dos fondos con al menos la mitad de su cartera publicada, y solo hay uno.",
      fuera: ["CORTO: publica el 42,3\u00a0% de su cartera."]
    });
    const ninguno = buildReportOverlap([filas[1], filas[3]], carteras);
    expect(corteDeLaMatriz(ninguno.positions).sinMatriz).toBe("No hay matriz de solapamiento: hacen falta dos fondos con al menos la mitad de su cartera publicada, y no hay ninguno.");
    const unSoloFondo = buildReportOverlap([filas[0], filas[4]], carteras);
    expect(corteDeLaMatriz(unSoloFondo.positions)).toMatchObject({ dentro: [0], sinMatriz: "No hay matriz de solapamiento: hacen falta dos fondos, y solo hay uno." });
  });

  test("con acciones: solo acciones, la frase de siempre y ninguna lista; con más de tres, se cuentan", () => {
    const acciones: OverlapPosition[] = ["ES1", "ES2"].map((asset_id) => ({ asset_id, display_name: asset_id, weight_percent: 50, instrument_type: "STOCK" }));
    expect(corteDeLaMatriz(buildReportOverlap(acciones).positions)).toEqual({
      dentro: [], sinMatriz: "Las 2 mayores posiciones son acciones, que no tienen subyacentes: el solapamiento no aplica.", fuera: []
    });
    const cuatro: OverlapPosition[] = [...filas.slice(0, 1), filas[2], ...["S1", "S2", "S3", "S4"].map((asset_id) => ({ asset_id, display_name: asset_id, weight_percent: 5, instrument_type: "STOCK" as const }))];
    expect(corteDeLaMatriz(buildReportOverlap(cuatro, carteras).positions).fuera).toEqual(["4 acciones en directo, que no tienen cartera propia."]);
    const tres = cuatro.slice(0, 5);
    expect(corteDeLaMatriz(buildReportOverlap(tres, carteras).positions).fuera).toEqual(["Acciones en directo, que no tienen cartera propia: S1, S2 y S3."]);
  });

  test("un fallo de carga dice que no se pudo leer, y lo que publica no se redondea hasta la mitad", () => {
    const fallo = buildReportOverlap(filas.slice(0, 4), carteras, new Set(["SIN"]));
    expect(corteDeLaMatriz(fallo.positions).fuera).toContain("SIN: no se ha podido leer su cartera.");
    const casi = buildReportOverlap([filas[0], { ...filas[1], asset_id: "CASI" }], new Map([["A", holdings("A", [100])], ["CASI", holdings("CASI", [49.96])]]));
    expect(corteDeLaMatriz(casi.positions).fuera).toEqual(["CORTO: publica el 49,9\u00a0% de su cartera."]);
    const nada = buildReportOverlap([filas[0], { ...filas[1], asset_id: "NADA" }], new Map([["A", holdings("A", [100])], ["NADA", holdings("NADA", [0.02])]]));
    expect(corteDeLaMatriz(nada.positions).fuera).toEqual(["CORTO: publica menos del 0,1\u00a0% de su cartera."]);
  });
});
