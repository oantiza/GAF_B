/**
 * Decisión 2 de la auditoría consolidada del 22-11-2026 (H1-01), aprobada por Óscar el 23-11: un día en que la cartera vale
 * cero porque todo lo que tiene son títulos sin valorar —sin precio o sin tipo de cambio— no apaga la cadena de la TWR. Antes
 * se trataba como un capital cero (GES-9): la cadena solo se reencendía con dinero nuevo del cliente, y la TWR de cualquier
 * periodo que contuviera ese día quedaba congelada (0 % con +4.500 € de resultado; −100 % desde el origen). Ahora esos días no
 * se encadenan, la cadena se reanuda el primer día con valor, y el aviso `SIN_VALORAR` dice el tramo y su resultado.
 *
 * Las cifras esperadas salen de las cuentas escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import { valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const E = activo("E", "ETF", "USD", { nombre: "ETF en dólares" });
const FIN = "2025-06-01";

/*
 * 10.000 € aportados el 01-01-2025 y, ese día, 100 títulos de E a 100 $ pagados con ellos, SIN cambio escrito. El mercado
 * trae el dólar a 1 $/€ solo desde el 02-01, y E a 105 $ el 02-01, 120 $ el 01-03 y 150 $ el 01-06.
 *   01-01: E sin cambio (no vale nada en euros) y efectivo 10.000 − 10.000 = 0: la cartera vale 0. Resultado −10.000 €.
 *   02-01: E vale 100 × 105 / 1 = 10.500 €, pero el capital del día es 0 (lo de ayer): no se mide. Resultado +10.500 €.
 *   Tramo sin valoración, del 01-01 al 02-01: −10.000 + 10.500 = +500 €.
 *   Desde el 03-01 se encadena: 01-06, 100 × 150 = 15.000 €; TWR 15.000 / 10.500 − 1 = 42,857 %.
 *   Resultado del periodo: 15.000 − 10.000 aportados = +5.000 €.
 */
const MERCADO = {
  precios: new Map([["E", serie(["2025-01-02", 105], ["2025-03-01", 120], ["2025-06-01", 150])]]),
  cambios: new Map([["USD", serie(["2025-01-02", 1])]])
} as DatosDeMercado;
const MOVIMIENTOS = [
  mov("aportacion", "2025-01-01", { importe: "10000" }),
  mov("compra", "2025-01-01", { activoId: "E", titulos: "100", precio: "100", importe: "-10000" })
];

describe("una cartera que empieza sin valoración no congela la TWR", () => {
  const c = cartera([E], MOVIMIENTOS);
  const preparado = preparar(c, MERCADO, new Map(), FIN);

  test("los dos días sin valoración no se encadenan, y desde el 03-01 sí", () => {
    const v = valorar(c, MERCADO, { hasta: FIN });
    expect(v.encadena[v.indice.get("2025-01-01")!]).toBe(0);
    expect(v.encadena[v.indice.get("2025-01-02")!]).toBe(0);
    expect(v.encadena[v.indice.get("2025-01-03")!]).toBe(1);
  });

  test("TWR desde el origen: 15.000 / 10.500 − 1 = 42,857 %; antes, −100 %", () => {
    const a = analizar(preparado, { desde: "2024-12-31", hasta: FIN });
    expect(a.rentabilidad?.twr).toBeCloseTo(15000 / 10500 - 1, 10);
    expect(a.rentabilidad?.resultado).toBeCloseTo(5000, 8);
  });

  test("TWR desde el 02-01: la misma 42,857 %; antes, 0 % con +4.500 € de resultado", () => {
    const a = analizar(preparado, { desde: "2025-01-02", hasta: FIN });
    expect(a.rentabilidad?.twr).toBeCloseTo(15000 / 10500 - 1, 10);
    /* 15.000 − 10.500 de valor al empezar = +4.500 €. */
    expect(a.rentabilidad?.resultado).toBeCloseTo(4500, 8);
  });

  test("el aviso dice el tramo y su resultado, y no se confunde con «sin capital»", () => {
    const v = valorar(c, MERCADO, { hasta: FIN });
    const codigos = v.avisos.map((aviso) => aviso.codigo);
    expect(codigos).toContain("SIN_VALORAR");
    expect(codigos).not.toContain("SIN_CAPITAL");
    expect(v.avisos.find((aviso) => aviso.codigo === "SIN_VALORAR")!.mensaje).toBe(
      "Del 01/01/2025 al 02/01/2025 todo lo que tenía la cartera estuvo sin precio o sin tipo de cambio, y no hay valor sobre el que medir: esos días no entran en la rentabilidad ponderada por tiempo, que sigue desde que vuelve a haber valoración, y su resultado, 500,00 EUR, cuenta en el resultado en euros y en la TIR. Escribe el precio o el cambio que falta para medirlo."
    );
  });
});

describe("lo que no cambia", () => {
  test("una compra anotada antes que su aportación sigue siendo «sin capital» (GES-9)", () => {
    /* 01-01: compra de 10 títulos de una acción en euros a 100 € sin dinero: efectivo −1.000, posición 1.000; vale 0 y no
       hay capital. 02-01: entran 1.000 €. No hay títulos sin valorar: no es «sin valoración». */
    const A = activo("A", "ACCION", "EUR");
    const c = cartera([A], [mov("compra", "2025-01-01", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }), mov("aportacion", "2025-01-02", { importe: "1000" })]);
    const mercado = { precios: new Map([["A", serie(["2025-01-01", 100], ["2025-01-10", 110])]]), cambios: new Map() } as DatosDeMercado;
    const v = valorar(c, mercado, { hasta: "2025-01-31" });
    expect(v.avisos.map((aviso) => aviso.codigo)).not.toContain("SIN_VALORAR");
  });
});
