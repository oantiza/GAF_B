import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppError } from "../src/core/appError";

const { callBackendMock } = vi.hoisted(() => ({
  callBackendMock: vi.fn()
}));

vi.mock("../src/adapters/callableBackend", () => ({
  callBackend: callBackendMock
}));

import {
  fetchMacroReference,
  parseMacroReference
} from "../src/adapters/macroReferenceBackend";

function alternative(overrides: Record<string, unknown> = {}) {
  return {
    valor_final_bruto: 10365,
    valor_final_neto: 10295.65,
    tir_nominal_bruta_pct: 3.65,
    tir_nominal_neta_pct: 2.96,
    tir_real_bruta_pct: 0.63,
    tir_real_neta_pct: -0.08,
    ...overrides
  };
}

const taxBrackets = [
  { threshold_eur: 0, rate_pct: 19 },
  { threshold_eur: 7500, rate_pct: 20 },
  { threshold_eur: 15000, rate_pct: 22 },
  { threshold_eur: 30000, rate_pct: 24 },
  { threshold_eur: 50000, rate_pct: 25.5 },
  { threshold_eur: 90000, rate_pct: 26 },
  { threshold_eur: 120000, rate_pct: 26.5 },
  { threshold_eur: 240000, rate_pct: 27 },
  { threshold_eur: 300000, rate_pct: 28 }
];

describe("parseMacroReference", () => {
  test("mantiene compatible la respuesta clásica sin comparativa", () => {
    const parsed = parseMacroReference({
      inflation_annual_pct: 3,
      inflation_total_pct: 6.09,
      letras_avg_rate_pct: 2.5,
      source: "INE (IPC) + BdE (Letras del Tesoro 1A)",
      notes: ""
    });

    expect(parsed.inflation_annual_pct).toBe(3);
    expect(parsed.comparison).toBeUndefined();
    expect(parsed.bizkaia_tax_brackets).toBeUndefined();
  });

  test("acepta las tres alternativas y la escala progresiva de Bizkaia", () => {
    const parsed = parseMacroReference({
      inflation_annual_pct: 3,
      bizkaia_tax_brackets: taxBrackets,
      deposit_rate_default_pct: 2,
      deposit_rate_used_pct: null,
      comparison: {
        cartera: alternative({ valor_final_bruto: 60000, valor_final_neto: 58075 }),
        letras: alternative(),
        deposito: alternative({ tir_real_neta_pct: null })
      }
    });

    expect(parsed.bizkaia_tax_brackets).toEqual(taxBrackets);
    expect(parsed.deposit_rate_used_pct).toBeNull();
    expect(parsed.comparison?.cartera.valor_final_neto).toBe(58075);
    expect(parsed.comparison?.letras.tir_nominal_neta_pct).toBe(2.96);
    expect(parsed.comparison?.deposito.tir_real_neta_pct).toBeNull();
  });

  test("rechaza alternativas incompletas o con tipos inválidos", () => {
    expect(() =>
      parseMacroReference({
        comparison: {
          cartera: alternative({ valor_final_neto: "58000" }),
          letras: alternative(),
          deposito: alternative()
        }
      })
    ).toThrow(AppError);
    expect(() =>
      parseMacroReference({
        comparison: {
          cartera: { valor_final_bruto: 60000 },
          letras: alternative(),
          deposito: alternative()
        }
      })
    ).toThrow(AppError);
    expect(() => parseMacroReference({ comparison: "no-objeto" })).toThrow(AppError);
  });

  test("valida estrictamente cada tramo y el orden de umbrales", () => {
    expect(() => parseMacroReference({ bizkaia_tax_brackets: [] })).toThrow(AppError);
    expect(() =>
      parseMacroReference({ bizkaia_tax_brackets: [{ threshold_eur: 0, rate_pct: "19" }] })
    ).toThrow(AppError);
    expect(() =>
      parseMacroReference({ bizkaia_tax_brackets: [{ threshold_eur: 7500, rate_pct: 20 }] })
    ).toThrow(AppError);
    expect(() =>
      parseMacroReference({
        bizkaia_tax_brackets: [
          { threshold_eur: 0, rate_pct: 19 },
          { threshold_eur: 0, rate_pct: 20 }
        ]
      })
    ).toThrow(AppError);
    expect(() =>
      parseMacroReference({ bizkaia_tax_brackets: [{ threshold_eur: 0, rate_pct: 101 }] })
    ).toThrow(AppError);
  });
});

describe("fetchMacroReference", () => {
  beforeEach(() => {
    callBackendMock.mockReset();
    callBackendMock.mockResolvedValue({
      inflation_annual_pct: null,
      inflation_total_pct: null,
      letras_avg_rate_pct: null,
      source: "INE + BdE",
      notes: ""
    });
  });

  test("conserva el payload clásico cuando no se solicita la comparativa", async () => {
    await fetchMacroReference("2021-01-15", "2026-07-12");

    expect(callBackendMock).toHaveBeenCalledWith(
      "get_macro_reference",
      { start_date: "2021-01-15", end_date: "2026-07-12" },
      "No se pudo consultar INE/BdE."
    );
  });

  test("envía flujos, valor final y un tipo fijo incluido el 0 %", async () => {
    await fetchMacroReference("2021-01-15", "2026-07-12", {
      flows: [
        { date: "2021-01-15", amount: 50000 },
        { date: "2023-06-15", amount: 20000 }
      ],
      finalValue: 95000,
      depositRatePct: 0
    });

    expect(callBackendMock).toHaveBeenCalledWith(
      "get_macro_reference",
      {
        start_date: "2021-01-15",
        end_date: "2026-07-12",
        flows: [
          { date: "2021-01-15", amount: 50000 },
          { date: "2023-06-15", amount: 20000 }
        ],
        final_value: 95000,
        deposit_rate_pct: 0
      },
      "No se pudo consultar INE/BdE."
    );
  });

  test("omite el tipo para activar la curva histórica", async () => {
    await fetchMacroReference("2021-01-15", "2026-07-12", {
      flows: [{ date: "2021-01-15", amount: 50000 }],
      finalValue: 95000
    });

    expect(callBackendMock.mock.calls[0]?.[1]).toEqual({
      start_date: "2021-01-15",
      end_date: "2026-07-12",
      flows: [{ date: "2021-01-15", amount: 50000 }],
      final_value: 95000
    });
  });

  test("rechaza un tipo fijo fuera del rango antes de invocar el backend", async () => {
    await expect(fetchMacroReference("2021-01-15", "2026-07-12", {
      flows: [{ date: "2021-01-15", amount: 50000 }],
      finalValue: 95000,
      depositRatePct: 25.01
    })).rejects.toThrow("entre -5 % y 25 %");
    expect(callBackendMock).not.toHaveBeenCalled();
  });
});
