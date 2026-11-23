/**
 * N-1 de la auditoría consolidada del 22-11-2026: el cambio escrito en una operación se descartaba entero si el mercado
 * traía esa divisa, también los días anteriores a su primer dato. Una compra en dólares con su cambio escrito, hecha antes
 * de que empiece la serie del dólar, valía cero esos días, daba −100 % y congelaba la TWR de todo periodo que los
 * contuviera (es lo que más casos de H1-01 provoca). Ahora, como con los precios (GES-1, `precioAntesDeLaSerie.test.ts`),
 * antes del primer punto del mercado valen los cambios propios, y desde él manda el mercado.
 *
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import { valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const E = activo("E", "ETF", "USD", { nombre: "ETF en dólares" });
const FIN = "2025-06-01";

/*
 * 10.000 € aportados el 01-01-2025 y, ese día, 100 títulos de E a 100 $ con cambio escrito 1 $/€: 10.000 €.
 * El mercado trae el dólar a 1 desde el 02-01 y E a 105 el 02-01, 120 el 01-03 y 150 el 01-06.
 */
const MERCADO: DatosDeMercado = {
  precios: new Map([["E", serie(["2025-01-02", 105], ["2025-03-01", 120], ["2025-06-01", 150])]]),
  cambios: new Map([["USD", serie(["2025-01-02", 1])]])
} as DatosDeMercado;
const MOVIMIENTOS = [
  mov("aportacion", "2025-01-01", { importe: "10000" }),
  mov("compra", "2025-01-01", { activoId: "E", titulos: "100", precio: "100", importe: "-10000", cambio: "1" })
];

describe("el cambio propio vale antes de que empiece la serie del mercado", () => {
  const c = cartera([E], MOVIMIENTOS);
  const preparado = preparar(c, MERCADO, new Map(), FIN);

  test("el día de la compra la posición vale 100 × 100 / 1 = 10.000 €, no cero", () => {
    const v = valorar(c, MERCADO, { hasta: FIN });
    expect(v.valor[v.indice.get("2025-01-01")!]).toBeCloseTo(10000, 8);
  });

  test("TWR desde el origen: 15.000 / 10.000 − 1 = 50 %; antes, −100 %", () => {
    /* 01-06: 100 × 150 / 1 = 15.000 €. Sin flujos después del primer día. */
    const a = analizar(preparado, { desde: "2024-12-31", hasta: FIN });
    expect(a.rentabilidad?.twr).toBeCloseTo(0.5, 10);
    expect(a.rentabilidad?.resultado).toBeCloseTo(5000, 8);
  });

  test("TWR desde el 02-01: 15.000 / 10.500 − 1 = 42,857 %; antes, 0 % con un resultado de +4.500 €", () => {
    /* 02-01: 100 × 105 / 1 = 10.500 €. */
    const a = analizar(preparado, { desde: "2025-01-02", hasta: FIN });
    expect(a.rentabilidad?.twr).toBeCloseTo(15000 / 10500 - 1, 10);
    expect(a.rentabilidad?.resultado).toBeCloseTo(4500, 8);
  });

  test("desde su primer punto manda el mercado aunque el cambio propio diga otra cosa", () => {
    /* Cambio escrito 2 $/€: el 01-01 vale 10.000 / 2 = 5.000 €; el 01-06, con el mercado a 1, 100 × 150 / 1 = 15.000 €. */
    const conOtroCambio = cartera([E], [MOVIMIENTOS[0], { ...MOVIMIENTOS[1], cambio: "2", importe: "-5000" }]);
    const v = valorar(conOtroCambio, MERCADO, { hasta: FIN });
    /* Efectivo: 10.000 − 5.000 = 5.000 €. */
    expect(v.valor[v.indice.get("2025-01-01")!]).toBeCloseTo(5000 + 5000, 8);
    expect(v.valor[v.indice.get(FIN)!]).toBeCloseTo(15000 + 5000, 8);
  });
});
