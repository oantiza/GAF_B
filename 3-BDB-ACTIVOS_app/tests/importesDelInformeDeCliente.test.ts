import { describe, expect, test } from "vitest";
import { importesQueSuman } from "../src/reports/informeDeClientePdf";

/**
 * INF-32 (auditoría de frontend, 13-11-2026): en la hoja de composición del informe de cliente cada importe se redondeaba al euro por su
 * cuenta y el total impreso es el capital, así que la columna podía no sumar. Ahora el residuo del redondeo se reparte por el método del
 * mayor resto: los euros que faltan van a las posiciones con mayor parte decimal, y la columna suma el total.
 */
describe("los importes por posición del informe de cliente", () => {
  test("siete posiciones sobre 12.345 €: suman el total, euro a euro", () => {
    /* A mano, capital × peso / 100:
         20,25 → 2.499,8625   18,15 → 2.240,6175   15,35 → 1.894,9575   14,45 → 1.783,8525
         12,55 → 1.549,2975   10,65 → 1.314,7425    8,60 → 1.061,67     (suman 12.345,00)
       Redondeando cada uno: 2.500 + 2.241 + 1.895 + 1.784 + 1.549 + 1.315 + 1.062 = 12.346, un euro de más.
       Mayor resto: los suelos suman 12.340; faltan 5 €, que van a los cinco restos mayores
       (0,9575, 0,8625, 0,8525, 0,7425 y 0,67): 2.500, 2.240, 1.895, 1.784, 1.549, 1.315, 1.062. */
    const importes = importesQueSuman(12_345, [20.25, 18.15, 15.35, 14.45, 12.55, 10.65, 8.6]);
    expect(importes).toEqual([2500, 2240, 1895, 1784, 1549, 1315, 1062]);
    expect(importes.reduce((suma, importe) => suma + importe, 0)).toBe(12_345);
  });

  test("tres tercios de 1.000 €: 334, 333 y 333, no tres de 333", () => {
    /* A mano: 1.000 / 3 = 333,33…; los suelos suman 999 y el euro que falta va al primero de los empatados. */
    expect(importesQueSuman(1_000, [100 / 3, 100 / 3, 100 / 3])).toEqual([334, 333, 333]);
  });

  test("si los pesos no suman 100, reparte el capital en proporción, como el cuadro de costes", () => {
    /* A mano: 24,5 / 98 × 100.000 = 25.000 € cada una. */
    expect(importesQueSuman(100_000, [24.5, 24.5, 24.5, 24.5])).toEqual([25_000, 25_000, 25_000, 25_000]);
  });

  test("con pesos redondos no cambia nada", () => {
    expect(importesQueSuman(100_000, [50, 30, 20])).toEqual([50_000, 30_000, 20_000]);
  });
});
