import { describe, expect, test } from "vitest";
import { parseDividendsCalendarResult } from "../src/adapters/dividendsCalendarBackend";
import { parseEarningsCalendarResult } from "../src/adapters/earningsCalendarBackend";
import { parseEconomicCalendarResult } from "../src/adapters/economicCalendarBackend";
import { parseEcbYieldCurveResponse } from "../src/adapters/ecbYieldCurveBackend";
import { parseMacroReference } from "../src/adapters/macroReferenceBackend";
import { faseDeAgenda, importeEsDelUltimoPago } from "../src/core/agendaDeMercado";
import { notasDeLaReferencia } from "../src/core/referenciaMacro";

describe("hallazgo 25: el calendario dice hasta dónde llega su fuente", () => {
  test("lee el estado y el alcance, y un servidor sin actualizar sigue valiendo", () => {
    const nuevo = parseEconomicCalendarResult({
      events: [], from: "2026-07-14", to: "2026-07-20", source: "OUT_OF_SOURCE_RANGE", count: 0,
      status: "OUT_OF_SOURCE_RANGE", covers_from: "2026-07-06", covers_to: "2026-07-12", note: "fuera"
    });
    expect(nuevo.status).toBe("OUT_OF_SOURCE_RANGE");
    expect(nuevo.covers_to).toBe("2026-07-12");
    const viejo = parseEconomicCalendarResult({ events: [], source: "FOREX_FACTORY_JSON_LIVE", count: 0 });
    expect(viejo.status).toBeUndefined();
    expect(viejo.covers_to).toBeUndefined();
  });

  test("un rango fuera de la fuente es su propia fase, distinta de «sin eventos» y de «fallo»", () => {
    const base = { cargando: false, error: null, cuantos: 0 };
    expect(faseDeAgenda({ ...base, origen: "OUT_OF_SOURCE_RANGE" })).toBe("fuera");
    expect(faseDeAgenda({ ...base, origen: "FOREX_FACTORY_JSON_LIVE" })).toBe("vacia");
    expect(faseDeAgenda({ ...base, origen: "ERROR" })).toBe("fallo");
  });
});

describe("hallazgo 26: dividendos y resultados", () => {
  test("el importe dice qué es, y un servidor sin actualizar se deduce del origen", () => {
    const r = parseDividendsCalendarResult({
      items: [{ code: "IBE.MC", ex_date: "2027-01-12", amount: 0.427, amount_kind: "LAST_PAID" }],
      source: "YAHOO_LIVE", count: 1
    });
    expect(r.items[0].amount_kind).toBe("LAST_PAID");
    expect(importeEsDelUltimoPago("FMP_LIVE", "LAST_PAID")).toBe(true);
    expect(importeEsDelUltimoPago("YAHOO_LIVE")).toBe(true);
    expect(importeEsDelUltimoPago("EODHD_LIVE")).toBe(false);
  });

  test("la fecha estimada de resultados llega marcada", () => {
    const r = parseEarningsCalendarResult({
      items: [{ code: "SAN.MC", report_date: "2026-07-20", date_estimated: true, report_date_window_end: "2026-07-24" }],
      source: "YAHOO_LIVE", count: 1
    });
    expect(r.items[0].date_estimated).toBe(true);
    expect(r.items[0].report_date_window_end).toBe("2026-07-24");
    const viejo = parseEarningsCalendarResult({ items: [{ code: "SAN.MC", report_date: "2026-07-20" }], source: "YAHOO_LIVE", count: 1 });
    expect(viejo.items[0].date_estimated).toBeUndefined();
  });

  test("Yahoo sin contestar llega con estado y se pinta como fallo", () => {
    const r = parseDividendsCalendarResult({ items: [], source: "ERROR", count: 0, status: "SOURCE_NOT_RESPONDING", note: "Yahoo no está contestando" });
    expect(r.status).toBe("SOURCE_NOT_RESPONDING");
    expect(faseDeAgenda({ cargando: false, error: null, origen: r.source, cuantos: 0 })).toBe("fallo");
  });
});

describe("hallazgo 27: la referencia macro dice qué es dato y qué es supuesto", () => {
  const completa = {
    inflation_annual_pct: 3, inflation_total_pct: 6, letras_avg_rate_pct: 2.5,
    source: "INE (IPC), último dato 2026-09", notes: "",
    sources: [
      { name: "INE (IPC)", status: "OK", last_data: "2026-09" },
      { name: "BdE (Letras del Tesoro 1A)", status: "ERROR", last_data: null }
    ],
    letras_period: { kind: "LAST_12_MONTHS", last_data: "2026-11-11", matches_request: false, note: "Media simple de los últimos 12 meses" },
    bizkaia_tax_scale: { territory: "Bizkaia", fiscal_year: 2026, kind: "FIXED_TABLE", note: "Escala del ahorro de Bizkaia 2026" },
    rate_tables: {
      deposit: { measured_through_year: 2024, assumed_years: [2025, 2026] },
      letras: { measured_through_year: 2024, assumed_years: [2025, 2026] }
    }
  };

  test("las notas nombran fuentes, tablas, supuestos, periodo de las Letras y escala", () => {
    const notas = notasDeLaReferencia(parseMacroReference(completa));
    const texto = notas.join(" ");
    expect(texto).toContain("Sin respuesta: BdE (Letras del Tesoro 1A)");
    expect(texto).toContain("datos de tabla hasta 2024");
    expect(texto).toContain("supuestos en 2025 y 2026");
    expect(texto).toContain("últimos 12 meses");
    expect(texto).toContain("Bizkaia 2026");
  });

  test("un servidor sin actualizar no inventa notas", () => {
    expect(notasDeLaReferencia(parseMacroReference({ inflation_annual_pct: 3, source: "INE + BdE", notes: "" }))).toEqual([]);
  });
});

describe("ecb_rates: la curva vacía llega con notas", () => {
  test("acepta la respuesta vacía con as_of_date nulo", () => {
    const r = parseEcbYieldCurveResponse({
      schema_version: "ecb-yield-curve.v1", as_of_date: null, aaa: [], all_bonds: [],
      source: "ECB_DATA_PORTAL", notes: "No se pudo obtener ninguna curva de tipos del BCE"
    });
    expect(r.as_of_date).toBeNull();
    expect(r.notes).toContain("ninguna curva");
  });
});
