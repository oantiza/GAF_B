import { describe, expect, test, vi } from "vitest";
import { filasDelGrafico } from "../src/charts/oaa/OaaLineChart";

/**
 * ANA-21 (auditoría de frontend, 13-11-2026): la tabla del gráfico de líneas se construía buscando cada fecha en cada serie con
 * `values.find`, unas 3,4 millones de comparaciones con cinco años diarios y dos series, y se rehacía en cada pintada. Ahora cada
 * serie se indexa una vez por fecha. Lo que sale es lo mismo.
 */
describe("las filas del gráfico de líneas", () => {
  const cartera = { id: "cartera", label: "Cartera", values: [{ date: "2024-01-03", value: 101 }, { date: "2024-01-01", value: 100 }, { date: "2024-01-02", value: null }] };
  const referencia = { id: "ref", label: "Referencia", values: [{ date: "2024-01-02", value: 99 }, { date: "2024-01-04", value: Number.NaN }] };

  test("una fila por fecha, ordenadas, con el valor de cada serie o nada", () => {
    expect(filasDelGrafico([cartera, referencia])).toEqual([
      { date: "2024-01-01", cartera: 100, ref: null },
      { date: "2024-01-02", cartera: null, ref: 99 },
      { date: "2024-01-03", cartera: 101, ref: null },
      { date: "2024-01-04", cartera: null, ref: null }
    ]);
  });

  test("si una fecha sale dos veces en una serie, vale la primera, como antes", () => {
    const repetida = { id: "r", label: "R", values: [{ date: "2024-01-01", value: 1 }, { date: "2024-01-01", value: 2 }] };
    expect(filasDelGrafico([repetida])).toEqual([{ date: "2024-01-01", r: 1 }]);
  });

  test("no busca cada fecha en la serie: la recorre una sola vez", () => {
    const valores = Array.from({ length: 300 }, (_, i) => ({ date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, value: i }));
    const busqueda = vi.spyOn(valores, "find");
    const filas = filasDelGrafico([{ id: "s", label: "S", values: valores }]);
    expect(filas).toHaveLength(300);
    expect(busqueda).not.toHaveBeenCalled();
  });
});
