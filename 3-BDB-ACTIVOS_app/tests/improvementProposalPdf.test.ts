import { expect, test } from "vitest";
import { createImprovementProposalPdfBlob } from "../src/reports/improvementProposalPdf";
import type { ImprovementResponse } from "../src/adapters/improvePortfolioBackend";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../src/core/textosDeCartera";
import { extractPdfPageTexts } from "./support/pdfText";

const metrics = (cagr: number, vol: number, mdd: number, weeks: number) => ({ cagr, volatility: vol, sharpe: (cagr - 0.02) / vol, max_drawdown: mdd, cumulative_return: cagr, weeks });

const response: ImprovementResponse = {
  schema_version: "portfolio-improvement.v1", status: "PROPOSAL", window: "3Y",
  original: { weights: { A: 0.6, B: 0.4 }, metrics: { selection: metrics(0.05, 0.12, -0.15, 104), confirmation: metrics(0.04, 0.12, -0.10, 52), full: metrics(0.05, 0.12, -0.15, 156) }, weighted_cost: 0.013 },
  windows: { frequency: "WEEKLY", full: { first_date: "2023-10-02", last_date: "2026-10-05", weeks: 156 }, selection: { first_date: "2023-10-02", last_date: "2025-10-06", weeks: 104 }, confirmation: { first_date: "2025-10-06", last_date: "2026-10-05", weeks: 52 } },
  proposals: [{
    substitutions: [{ from_asset_id: "A", to_asset_id: "A2", from_name: "Fondo Global Alfa A Acc", to_name: "Fondo Global Beta I Acc", weight: 0.6, correlation: 0.82, tracking_error: 0.071 }],
    weights: { A2: 0.6, B: 0.4 },
    metrics: { selection: metrics(0.06, 0.12, -0.14, 104), confirmation: metrics(0.05, 0.119, -0.09, 52), full: metrics(0.06, 0.12, -0.14, 156) },
    deltas_confirmation: { cagr: 0.01, volatility: -0.001, sharpe: 0.08, max_drawdown: 0.01 },
    weighted_cost: 0.0088,
    validation: [
      { key: "cost", label: "Coste corriente ponderado", status: "PASS", detail: "−0,42 pp" },
      { key: "group_currency", label: "Exposición por divisa", status: "NOT_EVALUABLE", detail: "sin etiqueta en algún fondo" }
    ],
    improvements: [{ key: "cagr", label: "Rentabilidad anualizada", delta: 0.01 }],
    consistency: { windows: 26, wins: 20, share: 0.77, rolling_weeks: 52 },
    valid: true
  }],
  rejected_candidates: { A: [{ asset_id: "A3", reason: "LOW_CORRELATION", detail: "Correlación 0,40, mínimo 0,75." }] },
  excluded_assets: [{ asset_id: "A4", reason: "INSUFFICIENT_HISTORY" }],
  evaluated_combinations: 7, search: "EXHAUSTIVE", warnings: [],
  risk_free: { risk_free_rate: 0.02, risk_free_rate_policy: "WINDOW_AVERAGE" }
};

const assets = {
  A: { name: "Fondo Global Alfa A Acc", ongoingCharge: 0.015 }, A2: { name: "Fondo Global Beta I Acc", ongoingCharge: 0.008 },
  A3: { name: "Fondo Global Gamma", ongoingCharge: 0.01 }, A4: { name: "Fondo joven" }, B: { name: "Fondo Bonos B", ongoingCharge: 0.01 }
};

test("PDF de la propuesta: sustituciones, antes/después, validación, equivalencia y descartes; sin datos comerciales", async () => {
  const blob = await createImprovementProposalPdfBlob({
    portfolioName: "Cliente X", response, assets, date: "13 de octubre de 2026",
    equivalence: { "A:A2": { verdict: "EQUIVALENT", reason: "Misma categoría y exposiciones coincidentes.", shared: ["Categoría: Global"], differing: [], missing: ["Estilo"] } },
    skipped: [{ asset_id: "B", reason: "Sin fondos de la misma categoría o región en el catálogo." }]
  });
  const pages = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()));
  expect(pages).toHaveLength(2);
  const first = pages[0];
  expect(first).toContain("Cliente X");
  /* «Coste corriente medio», sin «ponderado», en la fila de antes y después (14-11-2026). La validación lleva su rótulo del servidor. */
  expect(first).toMatch(/Coste corriente medio\s+[\d,]+\s%/);
  expect(first).toContain("Propuesta que cumple las condiciones");
  expect(first).toContain("Fondo Global Beta I Acc");
  expect(first).toContain("60,0 %");
  expect(first).toContain("0,82");
  /* Las diferencias de dos porcentajes van en puntos, como la validación del mismo documento (revisión final, V3-8): 5,00 % − 4,00 % y 0,80 % − 1,50 %. */
  expect(first).toContain("+1,00 pp");
  expect(first).toContain("−0,70 pp");
  expect(first).not.toMatch(/[+−]1,00 %|−0,70 %/);
  expect(first).toContain("Cumple");
  expect(first).toContain("No evaluable");
  expect(first).toContain("20 de 26 ventanas");
  // Auditoría 16-10: «Δ» y «→» no tienen glifo en Instrument Sans.
  expect(first).toContain("Dif. coste");
  const second = pages[1];
  expect(second).toContain("Fondo Global Alfa A Acc por Fondo Global Beta I Acc");
  expect(second).toContain("Equivalente");
  expect(second).toContain("Categoría: Global");
  expect(second).toContain("Fondo Global Gamma");
  expect(second).toContain("Fondo joven");
  expect(second).toContain("Fondo Bonos B");
  expect(pages.join(" ")).not.toMatch(/retrocesi[oó]n(?!es y condiciones comerciales no intervienen)/i);
  pages.forEach((page, i) => expect(page).toContain(`Página ${i + 1} de ${pages.length}`));
});

test("decisión 45: la hoja de sustituciones y antes y después dice lo que no incluye, con el texto de su único sitio", async () => {
  const pages = extractPdfPageTexts(Buffer.from(await (await createImprovementProposalPdfBlob({
    portfolioName: "Cliente X", response, assets, date: "13 de octubre de 2026"
  })).arrayBuffer())).map((page) => page.replace(/\s+/g, " "));
  expect(pages).toHaveLength(2);
  const [primera, segunda] = pages;
  expect(primera).toContain(SIN_COMISIONES_NI_IMPUESTOS);
  /* Junto a las cifras a las que se refiere: después del antes y después, antes de la validación. */
  expect(primera.indexOf(SIN_COMISIONES_NI_IMPUESTOS)).toBeGreaterThan(primera.indexOf("ventana de selección"));
  expect(primera.indexOf(SIN_COMISIONES_NI_IMPUESTOS)).toBeLessThan(primera.indexOf("Validación"));
  expect(segunda).not.toContain(SIN_COMISIONES_NI_IMPUESTOS);
});

test("sin propuesta: explica el motivo y la mejor combinación rechazada", async () => {
  const pages = extractPdfPageTexts(Buffer.from(await (await createImprovementProposalPdfBlob({
    portfolioName: "Cliente Y", assets, date: "13 de octubre de 2026",
    response: { ...response, status: "NO_IMPROVEMENT", proposals: [], reason: "La mejor combinación en selección no supera la confirmación: Sharpe.", best_rejected: { substitutions: response.proposals[0].substitutions, failed: ["Sharpe (confirmación)"] } }
  })).arrayBuffer()));
  expect(pages[0]).toContain("Sin mejora entre las alternativas evaluadas");
  expect(pages[0]).toContain("Sharpe");
  expect(pages[0]).toContain("Fondo Global Beta I Acc");
  expect(pages[0]).toContain("Fondo Global Alfa A Acc por Fondo Global Beta I Acc");
  /* Sin propuesta no hay nada que aplicar, ni cifras a las que le falten comisiones. */
  expect(pages.join(" ").replace(/\s+/g, " ")).not.toContain(SIN_COMISIONES_NI_IMPUESTOS);
});

const textoDeLaPropuesta = async (cambios: Partial<Parameters<typeof createImprovementProposalPdfBlob>[0]>) =>
  extractPdfPageTexts(Buffer.from(await (await createImprovementProposalPdfBlob({ portfolioName: "Cliente X", response, assets, date: "13 de octubre de 2026", ...cambios })).arrayBuffer())).join(" ").replace(/\s+/g, " ");

test("el tipo de respaldo se dice con su cifra, y solo si ocurre (decisión 89)", async () => {
  expect(await textoDeLaPropuesta({})).not.toContain("respaldo");
  const conRespaldo = await textoDeLaPropuesta({ response: { ...response, risk_free: { risk_free_rate: 0.0193, risk_free_rate_policy: "STATIC_FALLBACK" } } });
  /* El lector de texto pierde la ligadura de «fijo». */
  expect(conRespaldo).toMatch(/Sharpe con un tipo \S*jo de respaldo \(1,93 %\): no se pudo leer el €STR del periodo\./);
}, 30_000);

test("con una acción dice cómo cuenta en el coste y lo que no incluye; sin ella, no (decisiones 10 y 80)", async () => {
  expect(await textoDeLaPropuesta({})).not.toContain("custodia ni corretaje");
  const conAccion = await textoDeLaPropuesta({ hayAcciones: true });
  expect(conAccion).toContain("Las acciones no tienen coste corriente y cuentan como cero.");
  expect(conAccion).toContain("No incluye custodia ni corretaje.");
}, 30_000);

test("lo que llega del servidor con punto decimal se imprime con coma, como todo el papel (decisión 80)", async () => {
  const propuesta = response.proposals[0];
  const conPuntos: ImprovementResponse = { ...response, proposals: [{ ...propuesta, validation: [{ key: "cost", label: "Coste corriente ponderado", status: "PASS", detail: "-0.38 pp" }, { key: "dev", label: "Desviación máxima", status: "PASS", detail: "desviación máxima 0.0 pp" }] }] };
  const texto = await textoDeLaPropuesta({ response: conPuntos });
  expect(texto).toContain("−0,38 pp");
  expect(texto).toContain("desviación máxima 0,0 pp");
  expect(texto).not.toMatch(/\d\.\d+ pp/);
}, 30_000);
