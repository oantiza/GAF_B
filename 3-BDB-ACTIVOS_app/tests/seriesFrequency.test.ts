/**
 * Dibujar en diario, medir en semanal (lado cliente).
 *
 * El backend ya mide asi el backtest. Lo que el cliente calcula por su cuenta a
 * partir de la serie —la proyeccion Monte-Carlo y las dos matrices de
 * correlacion— tiene que medir igual, o la misma cartera contaria dos historias.
 */
import { describe, expect, test } from "vitest";
import { measurementSeries, weeklyLastObservations, weeklyMeasurementIndices } from "../src/core/seriesFrequency";

/* Lunes 2026-01-05 a viernes 2026-01-09, y lunes 2026-01-12 a miercoles 14. */
const DIARIA = [
  { date: "2026-01-05", value: 100 },
  { date: "2026-01-06", value: 101 },
  { date: "2026-01-07", value: 90 },   // el hoyo intrasemana
  { date: "2026-01-08", value: 101 },
  { date: "2026-01-09", value: 102 },  // viernes: la que manda
  { date: "2026-01-12", value: 103 },
  { date: "2026-01-13", value: 104 },
  { date: "2026-01-14", value: 105 }   // ultima de una semana incompleta
];

describe("remuestreo semanal", () => {
  test("se queda con la ultima observacion de cada semana ISO", () => {
    expect(weeklyLastObservations(DIARIA)).toEqual([
      { date: "2026-01-09", value: 102 },
      { date: "2026-01-14", value: 105 }
    ]);
  });

  test("el hoyo intrasemana desaparece al medir, que es justo lo que se busca", () => {
    const semanal = weeklyLastObservations(DIARIA).map((point) => point.value);
    expect(Math.min(...semanal)).toBe(102);
    expect(Math.min(...DIARIA.map((point) => point.value))).toBe(90);
  });

  test("una semana suelta se conserva entera", () => {
    expect(weeklyLastObservations([{ date: "2026-01-07", value: 7 }])).toEqual([{ date: "2026-01-07", value: 7 }]);
  });

  test("descarta las fechas ilegibles sin romper la serie", () => {
    expect(weeklyLastObservations([{ date: "no-es-fecha", value: 1 }, ...DIARIA])).toHaveLength(2);
  });

  test("los indices apuntan a las mismas observaciones, para arrays paralelos", () => {
    const indices = weeklyMeasurementIndices(DIARIA.map((point) => point.date));
    expect(indices).toEqual([4, 7]);
    expect(indices.map((index) => DIARIA[index].value)).toEqual([102, 105]);
  });
});

describe("serie de medicion", () => {
  test("en diario remuestrea y declara semanal, para que se anualice con 52", () => {
    const medida = measurementSeries(DIARIA, "DAILY");
    expect(medida.frequency).toBe("WEEKLY");
    expect(medida.series).toHaveLength(2);
  });

  test("en semanal no toca nada: el comportamiento de siempre", () => {
    const medida = measurementSeries(DIARIA, "WEEKLY");
    expect(medida.frequency).toBe("WEEKLY");
    expect(medida.series).toEqual(DIARIA);
  });
});
