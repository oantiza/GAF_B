/**
 * H2-02 (2 y 3) de la auditoría del 22-11-2026: el coste corriente de un fondo que tuvo títulos sin valor —sin precio o sin
 * tipo de cambio— parte del periodo se daba por completo. Solo se miraba si le faltaba el precio a la fecha final:
 *   (2) un fondo de 100.000 € sin cambio casi todo el año daba unos 30 € de coste corriente «completo», en vez de unos 1.000 €;
 *   (3) uno vendido antes del final sin haber valido nada daba 0 € «completo».
 * Ahora la cifra se marca parcial y el fondo se nombra. Las cifras esperadas salen de las cuentas escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import { DIAS_POR_ANIO } from "../../src/gestor/motor/fechas";
import { notaDelCosteCorrienteSinPrecio } from "../../src/gestor/motor/sinPrecio";
import { MERCADO_VACIO, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const F = activo("F", "FONDO", "USD", { nombre: "Fondo en dólares", clasificacion: { gastosCorrientes: "0.01" } });
const PERIODO = { desde: "2024-12-31", hasta: "2025-12-31" };

describe("(2) un fondo sin tipo de cambio casi todo el año", () => {
  /*
   * 100.000 € aportados el 01-01-2025 y 1.000 títulos de F a 100 $ pagados con ellos, sin cambio escrito. El mercado tiene
   * F a 100 $ y el dólar a 1 $/€ solo desde el 21-12-2025. Periodo: del 01-01 al 31-12-2025, 365 días.
   *   Días con valor: del 21-12 al 31-12, 11 días a 1.000 × 100 / 1 = 100.000 €.
   *   Valor medio: 100.000 × 11 / 365 = 3.013,70 €. Coste estimado: 3.013,70 × 1 % × 365 / 365,2425 = 30,12 €.
   *   Lo que costó de verdad, con el fondo los 365 días: 100.000 × 1 % × 365 / 365,2425 ≈ 999,34 €.
   */
  const mercado = { precios: new Map([["F", serie(["2024-12-31", 100])]]), cambios: new Map([["USD", serie(["2025-12-21", 1])]]) } as DatosDeMercado;
  const movimientos = [mov("aportacion", "2025-01-01", { importe: "100000" }), mov("compra", "2025-01-01", { activoId: "F", titulos: "1000", precio: "100", importe: "-100000" })];
  const ic = analizar(preparar(cartera([F], movimientos), mercado, new Map(), PERIODO.hasta), PERIODO).ingresosYCostes;

  test("la cifra es la de los 11 días con valor, y ya no se da por completa", () => {
    expect(ic.gastosCorrientes).toBeCloseTo(((100000 * 11) / 365) * 0.01 * (365 / DIAS_POR_ANIO), 6);
    expect(ic.gastosCorrientesCompletos).toBe(false);
    expect(ic.valoradosSoloParteDelPeriodo).toEqual(["Fondo en dólares"]);
    expect(ic.sinPrecioFueraDeLosGastosCorrientes).toEqual([]);
  });

  test("la nota lo dice", () => {
    expect(notaDelCosteCorrienteSinPrecio({ ingresosYCostes: ic })).toBe(
      "El coste corriente de Fondo en dólares solo cuenta los días en que tuvo valor: los días sin precio o sin tipo de cambio no entran."
    );
  });
});

describe("(3) un fondo sin valor en todo el periodo y vendido antes del final", () => {
  /*
   * 50.000 € aportados el 01-01-2025, 500 títulos de F a 100 $ con ellos, vendidos el 01-07 por 50.000 €; ningún cambio del
   * dólar en el mercado ni en las operaciones. F nunca tuvo valor en euros: su valor medio es 0 y no hay coste que estimar.
   * A la fecha final ya no está en la cartera, y antes no se nombraba: 0 € «completo».
   */
  const movimientos = [
    mov("aportacion", "2025-01-01", { importe: "50000" }),
    mov("compra", "2025-01-01", { activoId: "F", titulos: "500", precio: "100", importe: "-50000" }),
    mov("venta", "2025-07-01", { activoId: "F", titulos: "500", precio: "100", importe: "50000" })
  ];
  const ic = analizar(preparar(cartera([F], movimientos), MERCADO_VACIO, new Map(), PERIODO.hasta), PERIODO).ingresosYCostes;

  test("no hay cifra, y el fondo se nombra entre los que no tienen precio", () => {
    expect(ic.gastosCorrientes).toBeNull();
    expect(ic.gastosCorrientesCompletos).toBe(false);
    expect(ic.sinPrecioFueraDeLosGastosCorrientes).toEqual(["Fondo en dólares"]);
    expect(ic.valoradosSoloParteDelPeriodo).toEqual([]);
  });
});

describe("un fondo con valor todos los días sigue completo", () => {
  /* 100.000 € en F con precio y cambio desde antes de empezar: 100.000 × 1 % × 365 / 365,2425 = 999,34 €, completo. */
  const mercado = { precios: new Map([["F", serie(["2024-12-31", 100])]]), cambios: new Map([["USD", serie(["2024-12-31", 1])]]) } as DatosDeMercado;
  const movimientos = [mov("aportacion", "2025-01-01", { importe: "100000" }), mov("compra", "2025-01-01", { activoId: "F", titulos: "1000", precio: "100", importe: "-100000" })];
  const ic = analizar(preparar(cartera([F], movimientos), mercado, new Map(), PERIODO.hasta), PERIODO).ingresosYCostes;

  test("999,34 € y completo", () => {
    expect(ic.gastosCorrientes).toBeCloseTo(100000 * 0.01 * (365 / DIAS_POR_ANIO), 6);
    expect(ic.gastosCorrientesCompletos).toBe(true);
    expect(ic.valoradosSoloParteDelPeriodo).toEqual([]);
  });
});
