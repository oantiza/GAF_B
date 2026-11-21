/**
 * Una cartera de pesos (como las de Diseño) convertida en un libro, para analizarla con el
 * mismo motor que una cartera del gestor.
 */
import { describe, expect, it } from "vitest";
import { carteraDesdePesos } from "../../src/gestor/motor/desdePesos";
import { construirLibro, titulosDe } from "../../src/gestor/motor/libro";
import { rentabilidadDelPeriodo } from "../../src/gestor/motor/rentabilidad";
import { ultimoHasta, valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, serie } from "./ayudas";

const A = activo("A", "FONDO");
const B = activo("B", "ACCION", "USD");
const SIN_PRECIO = activo("C", "FONDO");
const MERCADO: DatosDeMercado = {
  precios: new Map([
    ["A", serie(["2024-01-01", 10], ["2024-01-02", 11])],
    ["B", serie(["2024-01-01", 20], ["2024-01-02", 22])]
  ]),
  cambios: new Map([["USD", serie(["2024-01-01", 1.25])]])
};
const opciones = {
  id: "p",
  nombre: "Modelo 60/40",
  divisaBase: "EUR",
  fecha: "2024-01-01",
  capital: 1000,
  precio: (id: string, fecha: string) => ultimoHasta(MERCADO.precios.get(id), fecha)?.valor,
  cambio: (divisa: string, fecha: string) => ultimoHasta(MERCADO.cambios.get(divisa), fecha)?.valor
};

describe("de pesos a libro", () => {
  /*
   * 1.000 € : 60 % en A a 10 € → 600 € = 60 participaciones.
   *           40 % en B a 20 USD con el dólar a 1,25 → 400 € = 500 USD = 25 títulos.
   * Al día siguiente A vale 11 € y B 22 USD: 660 € + 25 × 22 / 1,25 = 440 € → 1.100 €. Sube un 10 %.
   */
  const { cartera, sinComprar, invertido } = carteraDesdePesos([{ activo: A, peso: 0.6 }, { activo: B, peso: 0.4 }], opciones);

  it("compra cada activo por su peso al precio del día", () => {
    const libro = construirLibro(cartera);
    expect(libro.avisos).toEqual([]);
    expect(titulosDe(libro.final, "A").toFixed()).toBe("60");
    expect(titulosDe(libro.final, "B").toFixed()).toBe("25");
    expect(libro.final.efectivo.get("EUR")?.toFixed(2)).toBe("0.00");
    expect(sinComprar).toEqual([]);
    expect(invertido).toBe(1);
    expect(cartera.movimientos.map((movimiento) => movimiento.tipo)).toEqual(["aportacion", "suscripcion", "compra"]);
  });

  it("pasa por el mismo motor: la rentabilidad es la de sus pesos", () => {
    const valoracion = valorar(cartera, MERCADO, { hasta: "2024-01-02" });
    expect([...valoracion.valor].map((valor) => Number(valor.toFixed(6)))).toEqual([1000, 1100]);
    expect(rentabilidadDelPeriodo(valoracion, { desde: "2023-12-31", hasta: "2024-01-02" })?.twr).toBeCloseTo(0.1, 12);
  });

  it("lo que no tiene precio ese día se queda en efectivo y se dice", () => {
    const conHueco = carteraDesdePesos([{ activo: A, peso: 0.5 }, { activo: SIN_PRECIO, peso: 0.5 }], opciones);
    expect(conHueco.sinComprar.map((linea) => [linea.activo.id, linea.peso, linea.motivo])).toEqual([["C", 0.5, "No tiene precio en esa fecha."]]);
    expect(conHueco.invertido).toBe(0.5);
    expect(construirLibro(conHueco.cartera).final.efectivo.get("EUR")?.toFixed(2)).toBe("500.00");
  });

  it("unos pesos que suman más de uno se reescalan", () => {
    const pasados = carteraDesdePesos([{ activo: A, peso: 0.9 }, { activo: B, peso: 0.6 }], opciones);
    // 0,9 y 0,6 suman 1,5: quedan en 60 % y 40 %, igual que arriba.
    expect(titulosDe(construirLibro(pasados.cartera).final, "A").toFixed()).toBe("60");
    expect(titulosDe(construirLibro(pasados.cartera).final, "B").toFixed()).toBe("25");
  });
});
