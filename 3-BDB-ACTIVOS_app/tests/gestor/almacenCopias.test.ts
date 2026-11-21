import { describe, expect, it } from "vitest";
import type { CopiaDeSeguridad } from "../../src/gestor/almacen/almacen";
import { copiasAConservar, fechaDeCopia, nombreDeCopia, tocaCopia } from "../../src/gestor/almacen/copias";

function copia(fecha: string): CopiaDeSeguridad {
  return { carteraId: "c", fichero: nombreDeCopia(new Date(fecha)), fecha: new Date(fecha).toISOString(), bytes: 10 };
}

describe("nombres de las copias", () => {
  it("marca UTC sin dos puntos, y se lee de vuelta", () => {
    const nombre = nombreDeCopia(new Date("2026-11-13T15:04:22.789Z"));
    expect(nombre).toBe("2026-11-13T15-04-22Z.cartera.json");
    expect(fechaDeCopia(nombre)).toBe("2026-11-13T15:04:22.000Z");
    expect(nombreDeCopia(new Date("2026-11-13T15:04:22Z"), 2)).toBe("2026-11-13T15-04-22Z-2.cartera.json");
    expect(fechaDeCopia("2026-11-13T15-04-22Z-2.cartera.json")).toBe("2026-11-13T15:04:22.000Z");
    expect(fechaDeCopia("otra cosa.cartera.json")).toBeUndefined();
  });
});

describe("copiasAConservar", () => {
  it("las 20 más recientes y, de las anteriores, la última de cada día de los últimos 90", () => {
    const ahora = new Date("2026-11-13T12:00:00Z");
    /* 20 copias del 13-11, cada 20 minutos de 11:40 hacia atrás: la última es 11:40 − 19 × 20 min = 05:20. */
    const recientes = Array.from({ length: 20 }, (_, i) => copia(new Date(Date.parse("2026-11-13T11:40:00Z") - i * 20 * 60_000).toISOString()));
    expect(recientes[19].fecha).toBe("2026-11-13T05:20:00.000Z");
    const anteriores = [
      copia("2026-11-13T05:00:00Z"), // del 13-11, que ya tiene copias entre las 20: se elimina
      copia("2026-11-12T22:00:00Z"), // la última del 12-11: se conserva
      copia("2026-11-12T09:00:00Z"), // del 12-11 pero no la última: se elimina
      copia("2026-10-01T10:00:00Z"), // única de su día, a 43 días: se conserva
      copia("2026-08-15T13:00:00Z"), // el límite es 13-11 12:00 − 90 días = 15-08 12:00; esta es una hora posterior: se conserva
      copia("2026-08-15T11:00:00Z"), // una hora anterior al límite: se elimina
      copia("2026-07-01T10:00:00Z") // fuera de los 90 días: se elimina
    ];
    /* Se pasan desordenadas a propósito. */
    const todas = [...anteriores.slice(3), ...recientes.slice(10), ...anteriores.slice(0, 3), ...recientes.slice(0, 10)];
    const conservadas = copiasAConservar(todas, ahora);
    /* 20 recientes + 12-11 22:00 + 01-10 + 15-08 13:00 = 23, de la más reciente a la más antigua. */
    expect(conservadas.map((c) => c.fecha)).toEqual([
      ...recientes.map((c) => c.fecha),
      "2026-11-12T22:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      "2026-08-15T13:00:00.000Z"
    ]);
  });

  it("con 20 o menos se conservan todas, por antiguas que sean", () => {
    const pocas = [copia("2020-01-01T00:00:00Z"), copia("2021-01-01T00:00:00Z"), copia("2026-11-13T00:00:00Z")];
    expect(copiasAConservar(pocas, new Date("2026-11-13T12:00:00Z"))).toHaveLength(3);
  });
});

describe("tocaCopia", () => {
  const ahora = new Date("2026-11-13T12:00:00Z");
  it("sin copias, toca", () => expect(tocaCopia([], ahora)).toBe(true));
  it("la última hace 5 minutos: no toca", () => expect(tocaCopia([copia("2026-11-13T11:55:00Z"), copia("2026-11-12T10:00:00Z")], ahora)).toBe(false));
  it("la última hace exactamente 10 minutos: no toca (hace falta MÁS de 10)", () => expect(tocaCopia([copia("2026-11-13T11:50:00Z")], ahora)).toBe(false));
  it("la última hace 11 minutos: toca", () => expect(tocaCopia([copia("2026-11-13T11:49:00Z")], ahora)).toBe(true));
});
