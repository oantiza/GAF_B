/**
 * IMP-7 (17-11-2026): el solapamiento compara la cartera de un fondo con la de otro, y cada una es de un día. Más de 31 días de separación,
 * o una fecha que no consta, se dicen con las dos fechas. Cada número esperado sale de contar los días a mano, escrita en el caso.
 */
import { describe, expect, test } from "vitest";
import { DIAS_QUE_SEPARAN_DOS_CARTERAS, notasDeLasFechasDelModelo, notasDeLasFechasDelSolapamiento, solapamientoEnFrases, type ReportOverlap } from "../src/core/reportOverlap";

const fondo = (display_name: string, asOfDate?: string | null) => ({ display_name, asOfDate });

describe("notasDeLasFechasDelSolapamiento", () => {
  test("el umbral es de 31 días: 31 no avisa y 32 sí", () => {
    expect(DIAS_QUE_SEPARAN_DOS_CARTERAS).toBe(31);
    /* 30-jun → 31-jul: los 30 de junio al 30 de julio son 30 días, y uno más hasta el 31: 31. No es «más de un mes». */
    expect(notasDeLasFechasDelSolapamiento([fondo("A", "2026-06-30"), fondo("B", "2026-07-31")])).toEqual([]);
    /* 30-jun → 1-ago: 31 días hasta el 31-jul y uno más: 32. */
    const notas = notasDeLasFechasDelSolapamiento([fondo("A", "2026-06-30"), fondo("B", "2026-08-01")]);
    expect(notas).toHaveLength(1);
    expect(notas[0]).toContain("la de A, del 30/06/2026, y la de B, del 01/08/2026 (32 días)");
  });

  test("dos fondos: las dos fechas, la más antigua primero, y 123 días de 30-jun a 31-oct", () => {
    /* 30-jun → 31-jul: 31; → 31-ago: 62; → 30-sep: 92; → 31-oct: 123. */
    const notas = notasDeLasFechasDelSolapamiento([fondo("Nuevo", "2026-10-31"), fondo("Viejo", "2026-06-30")]);
    expect(notas).toEqual(["Las carteras de Viejo y Nuevo son de fechas separadas por más de un mes: la de Viejo, del 30/06/2026, y la de Nuevo, del 31/10/2026 (123 días). El solapamiento de ese par compara fondos en momentos distintos."]);
  });

  test("tres fondos: se cuentan los pares y se nombran los extremos (1-ene, 20-ene y 15-mar)", () => {
    /* 1-ene → 20-ene: 19 días, no avisa. 1-ene → 15-mar: 31 + 28 + 14 = 73. 20-ene → 15-mar: 73 − 19 = 54. Dos de los tres pares. */
    const notas = notasDeLasFechasDelSolapamiento([fondo("A", "2026-01-01"), fondo("B", "2026-01-20"), fondo("C", "2026-03-15")]);
    expect(notas).toEqual(["2 de los 3 pares de fondos comparan carteras de fechas separadas por más de un mes. La más antigua es la de A, del 01/01/2026, y la más reciente, la de C, del 15/03/2026 (73 días). El solapamiento de esos pares compara fondos en momentos distintos."]);
  });

  test("tres fondos a menos de un mes entre sí: nada", () => {
    /* 1-ene → 25-ene: 24 días; 5-ene → 25-ene: 20; 1-ene → 5-ene: 4. Ninguno pasa de 31. */
    expect(notasDeLasFechasDelSolapamiento([fondo("A", "2026-01-01"), fondo("B", "2026-01-05"), fondo("C", "2026-01-25")])).toEqual([]);
  });

  test("sin fecha en alguno: se dice que no consta, y la de los demás se compara igual", () => {
    expect(notasDeLasFechasDelSolapamiento([fondo("A", "2026-06-30"), fondo("B")])).toEqual(["No consta la fecha de la cartera de B: no se sabe si se compara con carteras del mismo momento."]);
    expect(notasDeLasFechasDelSolapamiento([fondo("A", null), fondo("B", "no es una fecha")])).toEqual(["No consta la fecha de la cartera de A y B: no se sabe si se compara con carteras del mismo momento."]);
    const mezcla = notasDeLasFechasDelSolapamiento([fondo("A", "2026-01-01"), fondo("B", "2026-03-15"), fondo("C")]);
    expect(mezcla).toHaveLength(2);
    expect(mezcla[0]).toContain("No consta la fecha de la cartera de C");
    expect(mezcla[1]).toContain("(73 días)");
    /* Con más de tres, se cuentan. */
    expect(notasDeLasFechasDelSolapamiento(["A", "B", "C", "D"].map((n) => fondo(n)))).toEqual(["No consta la fecha de la cartera de 4 fondos: no se sabe si se comparan con carteras del mismo momento."]);
  });

  test("un instante con hora vale por su día; menos de dos fondos, nada que comparar", () => {
    expect(notasDeLasFechasDelSolapamiento([fondo("A", "2026-06-30T23:59:00Z"), fondo("B", "2026-07-31T00:00:00Z")])).toEqual([]);
    expect(notasDeLasFechasDelSolapamiento([fondo("A")])).toEqual([]);
    expect(notasDeLasFechasDelSolapamiento([])).toEqual([]);
  });
});

describe("en el informe: solo cuentan los fondos que entran en la matriz", () => {
  const posicion = (display_name: string, status: ReportOverlap["positions"][number]["status"], asOfDate?: string): ReportOverlap["positions"][number] =>
    ({ asset_id: display_name, display_name, weight_percent: 10, instrument_type: "FUND", status, asOfDate });

  test("un fondo que no se mide, o una acción, no pone su fecha en la nota", () => {
    const model = { positions: [posicion("A", "available", "2026-06-30"), posicion("B", "available", "2026-06-30"), posicion("C", "insufficient", "2025-01-01"), posicion("ACC", "not_applicable")] };
    expect(notasDeLasFechasDelModelo(model)).toEqual([]);
  });

  test("la lectura del informe de cliente la lleva con las mismas palabras", () => {
    const model = {
      positions: [posicion("A", "available", "2026-06-30"), posicion("B", "available", "2026-10-31")],
      values: [[100, 12], [12, 100]]
    };
    const { frases } = solapamientoEnFrases(model);
    expect(frases).toContain("Las carteras de A y B son de fechas separadas por más de un mes: la de A, del 30/06/2026, y la de B, del 31/10/2026 (123 días). El solapamiento de ese par compara fondos en momentos distintos.");
  });
});
