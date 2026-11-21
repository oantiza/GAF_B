/**
 * La propuesta de mejora en la plantilla única: tema interno, la identidad del asesor en la cabecera, y las cifras de la
 * respuesta del servidor con el formato común (diferencias en puntos, pesos con un decimal). Se lee el PDF generado.
 */
import { describe, expect, test } from "vitest";
import type { ImprovementResponse } from "../src/adapters/improvePortfolioBackend";
import { peso, porcentaje, puntos, ratio, rentabilidad } from "../src/core/formato";
import { createImprovementProposalPdfBlob, type ImprovementProposalPdfInput } from "../src/reports/improvementProposalPdf";
import { IDENTIDAD_DE_PRUEBA, comprobarPlantilla, guardarSiSePide } from "./support/comprobarPlantilla";
import { extractPdfPageTexts } from "./support/pdfText";

const metricas = (cagr: number, vol: number, mdd: number, weeks: number) => ({ cagr, volatility: vol, sharpe: (cagr - 0.02) / vol, max_drawdown: mdd, cumulative_return: cagr, weeks });

const RESPUESTA: ImprovementResponse = {
  schema_version: "portfolio-improvement.v1", status: "PROPOSAL", window: "3Y",
  original: { weights: { A: 0.6, B: 0.4 }, metrics: { selection: metricas(0.05, 0.12, -0.15, 104), confirmation: metricas(0.04, 0.12, -0.1, 52), full: metricas(0.05, 0.12, -0.15, 156) }, weighted_cost: 0.013 },
  windows: { frequency: "WEEKLY", full: { first_date: "2023-10-02", last_date: "2026-10-05", weeks: 156 }, selection: { first_date: "2023-10-02", last_date: "2025-10-06", weeks: 104 }, confirmation: { first_date: "2025-10-06", last_date: "2026-10-05", weeks: 52 } },
  proposals: [{
    substitutions: [
      { from_asset_id: "A", to_asset_id: "A2", from_name: "Fondo Global Alfa A Acc", to_name: "Fondo Global Beta I Acc", weight: 0.6, correlation: 0.82, tracking_error: 0.071 },
      { from_asset_id: "B", to_asset_id: "B2", from_name: "Fondo de Bonos Corporativos Europeos con Nombre Largo B Acc EUR", to_name: "Otro Fondo de Bonos Corporativos Europeos I Acc EUR Hedged", weight: 0.4, correlation: 0.91, tracking_error: 0.022 }
    ],
    weights: { A2: 0.6, B2: 0.4 },
    metrics: { selection: metricas(0.06, 0.12, -0.14, 104), confirmation: metricas(0.05, 0.119, -0.09, 52), full: metricas(0.06, 0.12, -0.14, 156) },
    deltas_confirmation: { cagr: 0.01, volatility: -0.001, sharpe: 0.08, max_drawdown: 0.01 },
    weighted_cost: 0.0088,
    validation: [
      { key: "cost", label: "Coste corriente ponderado", status: "PASS", detail: "−0,42 pp" },
      { key: "group_currency", label: "Exposición por divisa", status: "NOT_EVALUABLE", detail: "sin etiqueta en algún fondo" },
      { key: "vol", label: "Volatilidad", status: "FAIL", detail: "+0,30 pp" }
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

const ACTIVOS = {
  A: { name: "Fondo Global Alfa A Acc", ongoingCharge: 0.015 }, A2: { name: "Fondo Global Beta I Acc", ongoingCharge: 0.008 },
  B: { name: "Fondo de Bonos B", ongoingCharge: 0.01 }, B2: { name: "Otro fondo de bonos" },
  A3: { name: "Fondo Global Gamma", ongoingCharge: 0.01 }, A4: { name: "Fondo joven" }
};

const ENTRADA: ImprovementProposalPdfInput = {
  portfolioName: "Cartera de la familia García",
  response: RESPUESTA,
  assets: ACTIVOS,
  date: "13 de octubre de 2026",
  equivalence: { "A:A2": { verdict: "EQUIVALENT", reason: "Misma categoría y exposiciones coincidentes.", shared: ["Categoría: Global"], differing: [], missing: ["Estilo"] } },
  identidad: IDENTIDAD_DE_PRUEBA
};

async function generar(input: ImprovementProposalPdfInput, nombre?: string) {
  const bytes = Buffer.from(await (await createImprovementProposalPdfBlob(input)).arrayBuffer());
  if (nombre) guardarSiSePide(bytes, "propuesta-de-mejora", nombre);
  return { bytes, hojas: extractPdfPageTexts(bytes) };
}

describe("la propuesta de mejora en la plantilla", () => {
  test("tema interno, con la identidad del asesor en cada hoja", async () => {
    const { bytes } = await generar(ENTRADA, "propuesta");
    comprobarPlantilla(bytes, { tema: "interno", documento: "Propuesta de mejora", identidad: "Marta Ruiz Alonso" });
  }, 30_000);

  test("sin identidad guardada, sin membrete", async () => {
    const { bytes } = await generar({ ...ENTRADA, identidad: {} }, "propuesta-sin-identidad");
    comprobarPlantilla(bytes, { tema: "interno", documento: "Propuesta de mejora", identidad: null });
  }, 30_000);

  test("sin propuesta: el motivo, y las mismas comprobaciones", async () => {
    const { bytes, hojas } = await generar(
      { ...ENTRADA, response: { ...RESPUESTA, status: "NO_IMPROVEMENT", proposals: [], reason: "La mejor combinación en selección no supera la confirmación: Sharpe.", best_rejected: { substitutions: RESPUESTA.proposals[0].substitutions, failed: ["Sharpe (confirmación)"] } } },
      "sin-propuesta"
    );
    comprobarPlantilla(bytes, { tema: "interno", documento: "Propuesta de mejora", identidad: "Marta Ruiz Alonso" });
    expect(hojas[0]).toContain("Sin mejora entre las alternativas evaluadas");
  }, 30_000);

  test("las cifras son las de la respuesta, con el formato común", async () => {
    /* El texto por hojas, con los espacios normalizados: el lector parte en dos tramos una cifra alineada a la derecha («+1,00 » y «pp»). */
    const { hojas } = await generar(ENTRADA);
    const cadenas = hojas.join(" ").replace(/\s+/g, " ");
    const plano = (texto: string | null) => (texto ?? "").replace(/\s/g, " ");
    /* A mano: pesos 0,6 → «60,0 %»; rentabilidades 0,04 → «+4,00 %» y 0,05 → «+5,00 %»; su diferencia, «+1,00 pp»;
       coste 0,013 → «1,30 %» y 0,0088 → «0,88 %», diferencia «−0,42 pp»; la del primer cambio, 0,008 − 0,015 = «−0,70 pp». */
    for (const esperada of [peso(0.6), rentabilidad(0.04), rentabilidad(0.05), puntos(0.01), porcentaje(0.013), porcentaje(0.0088), puntos(-0.0042), puntos(-0.007), ratio(0.82), porcentaje(0.071)]) {
      expect(cadenas, esperada!).toContain(plano(esperada));
    }
    expect(cadenas).toContain("60,0 %");
    expect(cadenas).toContain("−0,70 pp");
    expect(cadenas).toContain("del 06/10/2025 al 05/10/2026");
    /* Solo la diferencia de una rentabilidad lleva color: la del Sharpe, como la de la volatilidad, va en tinta. */
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/reports/improvementProposalPdf.tsx", "utf8")).toMatch(/const conColor = tipo === "rentabilidad";/);
  }, 30_000);
});
