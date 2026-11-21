/**
 * El aviso de ventana corta tiene que decir la verdad en la unidad correcta.
 *
 * 06-09-2026: con la serie dibujada en diario, el aviso imprimía el recuento DIARIO
 * con la palabra «semanales» —«320 observaciones semanales» sobre año y medio— y lo
 * comparaba con un mínimo que está en semanas. Aquí se fija que el número y su unidad
 * salen de las observaciones MEDIDAS, y que sin frecuencia declarada no se afirma
 * ninguna unidad.
 */
import { describe, expect, test } from "vitest";
import { backtestCoverageNotices, backtestWindowCoverage } from "../src/core/backtestCoverage";

const base = {
  window: "5Y",
  coverage: {
    common_observations: 320,
    measured_observations: 82,
    measurement_frequency: "WEEKLY",
    required_observations: 260,
    first_date: "2025-02-10",
    last_date: "2026-09-03",
    window_start_limited_by: "IE000DR59CI3"
  },
  warnings: ["WINDOW_COLLAPSED"],
  excluded_assets: []
};

describe("aviso de ventana común del backtest", () => {
  test("cuenta en semanas, no en días", () => {
    const [aviso] = backtestCoverageNotices(base, { IE000DR59CI3: "iShares Energy Storage" });

    expect(aviso).toContain("82 observaciones semanales");
    expect(aviso).not.toContain("320 observaciones semanales");
    expect(aviso).toContain("el mínimo para 5 años son 260");
  });

  test("nombra al activo que recorta la ventana", () => {
    const [aviso] = backtestCoverageNotices(base, { IE000DR59CI3: "iShares Energy Storage" });

    expect(aviso).toContain("Lo recorta iShares Energy Storage");
    expect(aviso.endsWith("Lo recorta iShares Energy Storage.")).toBe(true);
  });

  test("si la recorta alguien por el final, también lo nombra (OPT-5)", () => {
    const nombres = { IE000DR59CI3: "iShares Energy Storage", ES0116870314: "Naturgy" };
    const con = (limites: { window_start_limited_by?: string | null; window_end_limited_by?: string | null }) =>
      backtestCoverageNotices({ ...base, coverage: { ...base.coverage, window_start_limited_by: null, ...limites } }, nombres)[0];
    expect(con({ window_end_limited_by: "ES0116870314" }).endsWith("Lo recorta por el final Naturgy.")).toBe(true);
    expect(con({ window_start_limited_by: "IE000DR59CI3", window_end_limited_by: "ES0116870314" })
      .endsWith("Lo recorta por el principio iShares Energy Storage y por el final Naturgy.")).toBe(true);
    expect(con({ window_start_limited_by: "ES0116870314", window_end_limited_by: "ES0116870314" })
      .endsWith("Lo recorta Naturgy, por el principio y por el final.")).toBe(true);
    /* Sin ninguno de los dos, la frase acaba donde acababa. */
    expect(con({}).endsWith("no 5 años.")).toBe(true);
  });

  /* T12: la errata que la decisión 80 quitó del papel y T11 de «Fuera del cálculo». Duro Felguera se llama así en la base nueva. */
  test("un nombre que acaba en punto no deja dos", () => {
    const [aviso] = backtestCoverageNotices(base, { IE000DR59CI3: "Duro Felguera, S.A." });

    expect(aviso.endsWith("Lo recorta Duro Felguera, S.A.")).toBe(true);
    expect(aviso).not.toContain("S.A..");
  });

  test("sin frecuencia declarada no se inventa la unidad", () => {
    const sinFrecuencia = {
      ...base,
      coverage: { ...base.coverage, measured_observations: undefined, measurement_frequency: undefined }
    };
    const [aviso] = backtestCoverageNotices(sinFrecuencia, {});

    // Cae al recuento de la serie, y sin llamarlo semanal.
    expect(aviso).toContain("320 observaciones ·");
    expect(aviso).not.toContain("observaciones semanales");
  });

  test("la lectura de cobertura separa lo dibujado de lo medido", () => {
    const cobertura = backtestWindowCoverage(base)!;

    expect(cobertura.observations).toBe(320);
    expect(cobertura.measuredObservations).toBe(82);
    expect(cobertura.measurementLabel).toBe("observaciones semanales");
    expect(cobertura.coversWindow).toBe(false);
  });
});

/* OPT-2 (auditoría integral del 16-11-2026) y decisión A-161: el fin del periodo lo fija el dato más reciente de la
   cartera. Si ni ese es de este mes, el servidor manda un aviso; y la serie que se quedó atrás no recorta a las demás:
   sale apartada con su motivo. */
describe("aviso de periodo atrasado", () => {
  const completa = {
    window: "3Y",
    coverage: { common_observations: 783, measured_observations: 157, measurement_frequency: "WEEKLY", required_observations: 156, first_date: "2021-01-22", last_date: "2024-01-26" },
    excluded_assets: []
  };

  test("dice hasta qué día llega lo medido", () => {
    expect(backtestCoverageNotices({ ...completa, warnings: ["PERIOD_END_STALE"] })).toEqual([
      "El periodo medido acaba el 26/01/2024: ninguna serie de la cartera llega más allá, y las cifras no recogen lo ocurrido desde entonces."
    ]);
  });

  test("la serie que acaba antes del final sale apartada, con su motivo escrito", () => {
    const avisos = backtestCoverageNotices({
      ...completa,
      coverage: { ...completa.coverage, last_date: "2026-09-04" },
      warnings: [],
      excluded_assets: [{ asset_id: "PARADO", reason: "SERIES_ENDS_EARLY" }]
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("PARADO (sus precios acaban antes del final del periodo)");
    expect(avisos[0]).not.toContain("SERIES_ENDS_EARLY");
  });

  test("sin el aviso del servidor no se dice nada", () => {
    expect(backtestCoverageNotices({ ...completa, warnings: [] })).toEqual([]);
  });
});
