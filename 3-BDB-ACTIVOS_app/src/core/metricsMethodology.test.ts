import { describe, expect, it } from "vitest";
import { calculoEnPalabras, describeMetricsMethodology } from "./metricsMethodology";

/**
 * El comparador ponía en la columna «Sharpe 3A» la cifra trailing de Morningstar
 * de un fondo junto a la que calcula BDB sobre la serie diaria de una acción, sin
 * decir que no son la misma medida (auditoría 03-09, hallazgo 02). Con
 * `metrics.v1.2` la metodología viaja en el dato y se puede avisar.
 */
describe("comparabilidad de las métricas", () => {
  it("no avisa cuando todas salen del mismo cálculo", () => {
    const out = describeMetricsMethodology([
      { value: 0.4, method: "GEOMETRIC_CAGR" },
      { value: 0.8, method: "GEOMETRIC_CAGR" }
    ]);

    expect(out.mixed).toBe(false);
    /* La casa no se llama BDB en lo que se entrega (decisión 23), y «el Sharpe» es masculino (decisión 42). */
    expect(out.footnote).toContain("Sharpe 3A: calculado por nosotros con rentabilidad geométrica");
    expect(out.footnote).not.toContain("calculada");
    expect(out.footnote).not.toContain("BDB");
  });

  it("avisa cuando se mezclan metodologías", () => {
    const out = describeMetricsMethodology([
      { value: 0.4, method: "TRAILING_PROVIDER", frequency: "PROVIDER" },
      { value: 0.6, method: "TRAILING_PROVIDER", frequency: "PROVIDER" },
      { value: 0.8, method: "GEOMETRIC_CAGR", frequency: "WEEKLY" }
    ]);

    expect(out.mixed).toBe(true);
    expect(out.sinDeclarar).toBe(false);
  });

  it("de qué sale una cifra, en palabras", () => {
    expect(calculoEnPalabras({ method: "GEOMETRIC_CAGR", frequency: "WEEKLY" })).toBe("con datos semanales");
    expect(calculoEnPalabras({ method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY" })).toBe("con datos mensuales en euros");
    expect(calculoEnPalabras({ method: "EXTRACTOR_DAILY_V2", frequency: "DAILY" })).toBe("con datos diarios en euros");
    /* La versión 3 del método (A-158 y A-166) se lee igual: lo que cambia es el código, no lo que se le dice al asesor. */
    expect(calculoEnPalabras({ method: "EXTRACTOR_MONTHLY_V3", frequency: "MONTHLY" })).toBe("con datos mensuales en euros");
    expect(calculoEnPalabras({ method: "EXTRACTOR_DAILY_V3", frequency: "DAILY" })).toBe("con datos diarios en euros");
    /* Y la versión 4 (MET-6 y MET-7), igual. */
    expect(calculoEnPalabras({ method: "EXTRACTOR_MONTHLY_V4", frequency: "MONTHLY" })).toBe("con datos mensuales en euros");
    expect(calculoEnPalabras({ method: "EXTRACTOR_DAILY_V4", frequency: "DAILY" })).toBe("con datos diarios en euros");
    /* Del proveedor es del proveedor, con la frecuencia que traiga. */
    expect(calculoEnPalabras({ method: "TRAILING_PROVIDER", frequency: "PROVIDER" })).toBe("con la cifra del proveedor");
    expect(calculoEnPalabras({ method: "TRAILING_PROVIDER" })).toBe("con la cifra del proveedor");
    /* «en euros» lo dice el método: el V1 no lo afirma. */
    expect(calculoEnPalabras({ method: "EXTRACTOR_MONTHLY_V1", frequency: "MONTHLY" })).toBe("con datos mensuales");
    /* Una frecuencia que no se declara no se supone por el nombre del método. */
    expect(calculoEnPalabras({ method: "GEOMETRIC_CAGR" })).toBe("con datos de frecuencia no declarada");
    expect(calculoEnPalabras({})).toBe("sin método declarado");
  });

  it("el pie dice las observaciones de lo que se le da, y no solo de la fila: una acción sin Sharpe también trae cifras", () => {
    const sharpe = [{ value: 0.5, method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY" }, { value: undefined, method: "GEOMETRIC_CAGR", frequency: "WEEKLY" }];
    const tabla = [...sharpe, { value: 0.1, method: "GEOMETRIC_CAGR", frequency: "WEEKLY" }];
    expect(describeMetricsMethodology(sharpe).footnote).toBe(
      "Sharpe 3A: calculado por nosotros en euros, mensual. Volatilidad y rentabilidad anualizadas. Observaciones: mensuales."
    );
    expect(describeMetricsMethodology(sharpe, "Sharpe 3A", tabla).footnote).toBe(
      "Sharpe 3A: calculado por nosotros en euros, mensual. Volatilidad y rentabilidad anualizadas. Observaciones: mensuales y semanales."
    );
  });

  it("tres frecuencias se escriben como una lista, y dos sin declarar son una", () => {
    const tabla = [
      { value: 0.1, method: "GEOMETRIC_CAGR", frequency: "WEEKLY" },
      { value: 0.1, method: "TRAILING_PROVIDER", frequency: "PROVIDER" },
      { value: 0.1, method: "TRAILING_PROVIDER" },
      { value: 0.1, method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY" }
    ];
    expect(describeMetricsMethodology(tabla).footnote).toBe(
      "Volatilidad y rentabilidad anualizadas. Observaciones: semanales, frecuencia no declarada y mensuales."
    );
  });

  it("un activo sin la cifra no aporta metodología", () => {
    // Contarlo daria un aviso falso: no hay dos cifras que comparar.
    const out = describeMetricsMethodology([
      { value: 0.4, method: "GEOMETRIC_CAGR" },
      { value: null, method: "TRAILING_PROVIDER" },
      { value: undefined }
    ]);

    expect(out.mixed).toBe(false);
  });

  it("un dato anterior a v1.2 se declara desconocido, no se supone", () => {
    const out = describeMetricsMethodology([
      { value: 0.4 },
      { value: 0.8, method: "GEOMETRIC_CAGR" }
    ]);

    expect(out.mixed).toBe(true);
    expect(out.sinDeclarar).toBe(true);
  });

  it("dos cifras sin metodo NO son el mismo metodo: son dos incognitas", () => {
    /*
     * El caso medido el 03-11-2026: BHP y DWS ESG Stiftungsfonds, los dos leidos de la base
     * anterior, quedaban en la misma fila con metodos distintos de verdad y la tabla no
     * avisaba. Las dos cadenas vacias caian en el mismo conjunto, el conjunto tenia un solo
     * elemento y esta funcion concluia que no habia mezcla.
     *
     * Era el defecto caracteristico de este proyecto en su forma mas pura: la comprobacion
     * cazaba dos etiquetas DISTINTAS y no dos DESCONOCIDAS, que es justo donde hacia falta.
     */
    const out = describeMetricsMethodology([{ value: 0.4984 }, { value: 0.742 }]);

    expect(out.mixed).toBe(true);
    expect(out.sinDeclarar).toBe(true);
  });

  it("una sola cifra sin metodo no avisa: no hay nada con lo que compararla", () => {
    // La otra direccion, que es la que evita el aviso gritado en cada informe de un activo.
    const out = describeMetricsMethodology([{ value: 0.4984 }]);
    expect(out.mixed).toBe(false);
    expect(out.sinDeclarar).toBe(false);
  });

  it("sin cifras no hay nada que declarar", () => {
    const out = describeMetricsMethodology([{ value: null }, { value: undefined }]);

    expect(out.mixed).toBe(false);
    expect(out.footnote).toBe("Volatilidad y rentabilidad anualizadas.");
  });

  it("ningún código interno llega al texto", () => {
    for (const method of ["TRAILING_PROVIDER", "GEOMETRIC_CAGR", "EXTRACTOR_MONTHLY_V2", "EXTRACTOR_DAILY_V2", "UN_METODO_NUEVO"]) {
      const palabras = calculoEnPalabras({ method, frequency: "WEEKLY" });
      expect(palabras).not.toContain(method);
      expect(palabras).not.toMatch(/_/);
      expect(palabras).not.toContain("BDB");
    }
  });
});
