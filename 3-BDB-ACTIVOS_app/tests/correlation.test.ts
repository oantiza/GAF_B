import { describe, expect, test } from "vitest";
import { correlationMatrixByDate, matrizDeCorrelacion, notaDeLaCorrelacion, pearsonByDate, returnsByDate } from "../src/core/correlation";

const DATES = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02", "2026-02-09"];

describe("correlación alineada por fecha (A3.3)", () => {
  test("dos series idénticas correlacionan 1 aunque una salte una observación", () => {
    const a = [100, 102, 104, 101, 105, 108];
    // La serie B pierde la observación del 19-01 (valor no positivo): antes
    // el emparejamiento por índice desplazaba todo lo posterior.
    const b = [100, 102, 0, 101, 105, 108];
    const [[, ab]] = correlationMatrixByDate(DATES, [a, b]);
    // Solo cuentan las fechas con rentabilidad en AMBAS series: 12-01, 02-02 y 09-02.
    expect(ab).not.toBeNull();
    expect(ab as number).toBeCloseTo(1, 10);
  });

  test("una serie y su inversa correlacionan −1 sobre las fechas comunes", () => {
    const a = [100, 110, 99, 105, 94, 103];
    const inverse = a.map((v) => 20000 / v);
    const matrix = correlationMatrixByDate(DATES, [a, inverse]);
    expect(matrix[0][1] as number).toBeLessThan(-0.97);
    expect(matrix[1][0]).toBe(matrix[0][1]);
    expect(matrix[0][0]).toBe(1);
  });

  test("el desplazamiento que antes contaminaba la matriz ya no cambia el resultado", () => {
    // Con emparejamiento por índice, quitar la primera observación de B
    // correlacionaba la semana i de A con la i+1 de B. Por fecha, el hueco
    // solo reduce el número de observaciones comunes.
    const a = [100, 105, 95, 110, 90, 112];
    const bFull = [200, 210, 190, 220, 180, 224];
    const bConHueco = [Number.NaN, 210, 190, 220, 180, 224];
    const full = correlationMatrixByDate(DATES, [a, bFull])[0][1] as number;
    const gapped = correlationMatrixByDate(DATES, [a, bConHueco])[0][1] as number;
    expect(full).toBeCloseTo(1, 10);
    expect(gapped).toBeCloseTo(1, 10);
  });

  test("menos de 3 observaciones comunes ⇒ null; varianza nula ⇒ null", () => {
    const matrix = correlationMatrixByDate(DATES.slice(0, 3), [
      [100, 101, 102],
      [100, 99, 98]
    ]);
    // 3 valores ⇒ 2 rentabilidades comunes ⇒ insuficiente.
    expect(matrix[0][1]).toBeNull();
    const flat = correlationMatrixByDate(DATES, [
      [100, 100, 100, 100, 100, 100],
      [100, 101, 99, 102, 98, 103]
    ]);
    // Serie plana: varianza 0 ⇒ sin correlación definida.
    expect(flat[0][1]).toBeNull();
  });

  test("returnsByDate ancla cada rentabilidad a la fecha final del tramo y omite huecos", () => {
    const rets = returnsByDate({ dates: DATES.slice(0, 4), values: [100, 110, 0, 121] });
    expect([...rets.keys()]).toEqual(["2026-01-12"]);
    expect(rets.get("2026-01-12")).toBeCloseTo(0.1, 12);
    // El tramo 19→26 no se cose: 0 invalida ambos tramos que lo tocan.
    expect(rets.has("2026-01-26")).toBe(false);
  });

  test("pearsonByDate ignora fechas presentes en una sola serie", () => {
    const a = new Map([
      ["d1", 0.01],
      ["d2", 0.02],
      ["d3", -0.01],
      ["d4", 0.03],
      ["soloA", 9.99]
    ]);
    const b = new Map([
      ["d1", 0.01],
      ["d2", 0.02],
      ["d3", -0.01],
      ["d4", 0.03],
      ["soloB", -9.99]
    ]);
    expect(pearsonByDate(a, b)).toBeCloseTo(1, 10);
  });
});

describe("con la línea de quien reparte no se mide (decisión 53)", () => {
  const a = [100, 110, 99, 105, 94, 103];
  const inversa = a.map((v) => 20000 / v);

  test("sus casillas quedan sin cifra, la diagonal se queda y las demás no cambian", () => {
    const { matrix, noSeMide } = matrizDeCorrelacion(DATES, [{ values: a }, { values: inversa, sin_dividendos: true }, { values: a }]);
    expect(noSeMide).toEqual([false, true, false]);
    expect(matrix[0][1]).toBeNull();
    expect(matrix[1][0]).toBeNull();
    expect(matrix[1][2]).toBeNull();
    expect(matrix[2][1]).toBeNull();
    expect(matrix[1][1]).toBe(1);
    /* Dos series idénticas siguen dando 1, y la de la línea sin dividendos no las toca. */
    expect(matrix[0][2] as number).toBeCloseTo(1, 10);
  });

  test("sin ninguna marcada da lo mismo que la matriz de siempre", () => {
    const { matrix, noSeMide } = matrizDeCorrelacion(DATES, [{ values: a }, { values: inversa }]);
    expect(noSeMide).toEqual([false, false]);
    expect(matrix).toEqual(correlationMatrixByDate(DATES, [a, inversa]));
  });

  test("todas marcadas: solo queda la diagonal", () => {
    const { matrix } = matrizDeCorrelacion(DATES, [{ values: a, sin_dividendos: true }, { values: inversa, sin_dividendos: true }]);
    expect(matrix).toEqual([[1, null], [null, 1]]);
  });

  test("la nota nombra a quien deja las casillas sin cifra, y sin nadie no hay nota", () => {
    expect(notaDeLaCorrelacion([])).toBeNull();
    expect(notaDeLaCorrelacion(["Schroder"])).toBe(
      "No se mide la correlación de Schroder: su línea es el valor liquidativo, sin dividendos, y cada pago se leería como una caída."
    );
    expect(notaDeLaCorrelacion(["Schroder", "Aegon", "EdR"])).toBe(
      "No se mide la correlación de Schroder, Aegon y EdR: sus líneas son el valor liquidativo, sin dividendos, y cada pago se leería como una caída."
    );
  });
});
