/**
 * Auditoría integral del 16-11-2026, hallazgo GES-2. Vendido todo y retirado el dinero quedan 0,50 €; diez días después llega
 * un dividendo de 30 € y la rentabilidad de ese día era 30,50 / 0,50 − 1 = +6.000 %, que encadenada era la del periodo, sin aviso.
 *
 * Un día cuyo capital queda por debajo del 1 % de lo más que había llegado a valer la cartera no se encadena, y se dice.
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { comprobarIntegridad } from "../../src/gestor/motor/integridad";
import { rentabilidadDelPeriodo } from "../../src/gestor/motor/rentabilidad";
import { CAPITAL_RESIDUAL, valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const TODO = { desde: "1900-01-01", hasta: "2100-01-01" };
const mercado: DatosDeMercado = { precios: new Map([["A", serie(["2024-01-01", 100], ["2024-01-05", 100])]]), cambios: new Map() };

/* 1.000 € aportados e invertidos el 01-01-2024 en 10 títulos de A a 100 €. El 05-01 se venden a 100 € y se retiran 999,50 €: quedan 0,50 €. */
const hastaVaciar = [
  mov("aportacion", "2024-01-01", { importe: "1000" }),
  mov("compra", "2024-01-01", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
  mov("venta", "2024-01-05", { activoId: "A", titulos: "10", precio: "100", importe: "1000" }),
  mov("retirada", "2024-01-05", { importe: "-999.50" })
];

describe("GES-2 · un dividendo que llega a una cartera casi vacía no dispara la rentabilidad", () => {
  const c = cartera([activo("A")], [...hastaVaciar, mov("dividendo", "2024-01-15", { activoId: "A", importe: "30" })]);
  const v = valorar(c, mercado);
  const dia = (fecha: string) => v.indice.get(fecha) as number;

  test("el patrimonio es el de siempre: 1.000 €, 0,50 € tras retirar y 30,50 € con el dividendo", () => {
    expect(v.valor[dia("2024-01-04")]).toBeCloseTo(1000, 9);
    expect(v.valor[dia("2024-01-05")]).toBeCloseTo(0.5, 9);
    expect(v.valor[dia("2024-01-15")]).toBeCloseTo(30.5, 9);
  });

  test("el día del dividendo no se encadena: 0,50 € de capital es menos del 1 % de los 1.000 € que llegó a valer", () => {
    expect(CAPITAL_RESIDUAL).toBe(0.01);
    expect(v.capital[dia("2024-01-15")]).toBeCloseTo(0.5, 9);
    /* Antes: 30,50 / 0,50 − 1 = 60, es decir, +6.000 %. */
    expect(v.rentabilidad[dia("2024-01-15")]).toBe(0);
    /* El día de la retirada sí se mide: (0,50 + 999,50) / 1.000 − 1 = 0 %. Y el periodo entero: 0 %. */
    expect(v.rentabilidad[dia("2024-01-05")]).toBeCloseTo(0, 12);
    expect(rentabilidadDelPeriodo(v, TODO)?.twr).toBeCloseTo(0, 12);
  });

  test("el dinero no se pierde: el resultado en euros sigue siendo 30 €", () => {
    /* 30,50 de valor final + 999,50 retirados − 1.000 aportados = 30 €. */
    expect(rentabilidadDelPeriodo(v, TODO)?.resultado).toBeCloseTo(30, 9);
  });

  test("y se dice, con la fecha y los euros que quedan fuera", () => {
    const avisos = comprobarIntegridad(c, v, "2024-01-15", mercado).avisos.filter((aviso) => aviso.codigo === "CAPITAL_RESIDUAL");
    expect(avisos).toEqual([
      {
        gravedad: "aviso",
        codigo: "CAPITAL_RESIDUAL",
        fecha: "2024-01-15",
        mensaje:
          "El 15/01/2024 la cartera estaba casi vacía (por debajo del 1 % de lo que había llegado a valer): el resultado de ese día, 30,00 EUR, no entra en la rentabilidad ponderada por tiempo, porque medido sobre un capital tan pequeño la dispararía. Sí cuenta en el resultado en euros y en la TIR."
      }
    ]);
    /* A una fecha anterior al dividendo todavía no ha pasado. */
    expect(comprobarIntegridad(c, v, "2024-01-10", mercado).avisos.some((aviso) => aviso.codigo === "CAPITAL_RESIDUAL")).toBe(false);
  });
});

describe("GES-2 · varios días y vuelta a la normalidad", () => {
  /* Tras vaciar (0,50 €): 5 € de dividendo el 15-01 y una comisión de 0,20 € el 18-01, con 5,50 € de capital, que sigue por debajo
     de los 10 € del corte. El 20-01 el cliente vuelve a aportar 5.000 €. El 22-01, 50 € de intereses. */
  const c = cartera(
    [activo("A")],
    [
      ...hastaVaciar,
      mov("dividendo", "2024-01-15", { activoId: "A", importe: "5" }),
      mov("comision", "2024-01-18", { importe: "-0.20" }),
      mov("aportacion", "2024-01-20", { importe: "5000" }),
      mov("interes", "2024-01-22", { importe: "50" })
    ]
  );
  const v = valorar(c, mercado);
  const dia = (fecha: string) => v.indice.get(fecha) as number;

  test("los dos días con resultado quedan fuera, y el aviso los suma: 5,00 − 0,20 = 4,80 €", () => {
    expect(v.capital[dia("2024-01-18")]).toBeCloseTo(5.5, 9);
    expect(v.rentabilidad[dia("2024-01-15")]).toBe(0);
    expect(v.rentabilidad[dia("2024-01-18")]).toBe(0);
    const avisos = comprobarIntegridad(c, v, "2024-01-22", mercado).avisos.filter((aviso) => aviso.codigo === "CAPITAL_RESIDUAL");
    expect(avisos.map((aviso) => aviso.mensaje)).toEqual([
      "Del 15/01/2024 al 18/01/2024 la cartera estuvo casi vacía (por debajo del 1 % de lo que había llegado a valer): el resultado de esos días, 4,80 EUR, no entra en la rentabilidad ponderada por tiempo, porque medido sobre un capital tan pequeño la dispararía. Sí cuenta en el resultado en euros y en la TIR."
    ]);
  });

  test("con dinero otra vez, se vuelve a medir: 50 € de intereses sobre 5.005,30 € son un 0,999 %", () => {
    /* Día 20: capital = 5,30 + 5.000 = 5.005,30; valor 5.005,30 → 0 %. Día 22: 5.055,30 / 5.005,30 − 1. */
    expect(v.capital[dia("2024-01-20")]).toBeCloseTo(5005.3, 9);
    expect(v.rentabilidad[dia("2024-01-20")]).toBeCloseTo(0, 12);
    expect(v.rentabilidad[dia("2024-01-22")]).toBeCloseTo(5055.3 / 5005.3 - 1, 12);
    expect(rentabilidadDelPeriodo(v, TODO)?.twr).toBeCloseTo(5055.3 / 5005.3 - 1, 12);
  });

  test("por encima del corte se mide, aunque el capital sea pequeño: es el límite de la regla", () => {
    /* Con 30 € de dividendo en vez de 5, el capital del 18-01 es 30,50 €, más del 1 % de 1.000 €: la comisión de 0,20 € se mide, −0,20 / 30,50. */
    const conMas = cartera([activo("A")], [...hastaVaciar, mov("dividendo", "2024-01-15", { activoId: "A", importe: "30" }), mov("comision", "2024-01-18", { importe: "-0.20" })]);
    const w = valorar(conMas, mercado);
    expect(w.rentabilidad[w.indice.get("2024-01-18") as number]).toBeCloseTo(-0.2 / 30.5, 12);
  });
});

describe("GES-2 · dónde está el corte", () => {
  const con = (retirada: string) => {
    /* 1.000 € aportados el día 1, una retirada el día 2 y 1 € de intereses el día 3. */
    const c = cartera([], [mov("aportacion", "2024-01-01", { importe: "1000" }), mov("retirada", "2024-01-02", { importe: retirada }), mov("interes", "2024-01-03", { importe: "1" })]);
    return valorar(c);
  };

  test("con 10 € (justo el 1 % de 1.000 €) se mide: 11 / 10 − 1 = 10 %", () => {
    expect(con("-990").rentabilidad[2]).toBeCloseTo(0.1, 12);
  });

  test("con 9,99 € no se mide", () => {
    expect(con("-990.01").rentabilidad[2]).toBe(0);
  });

  test("una cartera que empieza pequeña y crece se mide desde el primer día: el máximo es el de hasta la víspera", () => {
    /* 10 € el día 1, 1 € de intereses el día 2 (11 / 10 − 1 = 10 %) y 100.000 € aportados el día 3. */
    const c = cartera([], [mov("aportacion", "2024-01-01", { importe: "10" }), mov("interes", "2024-01-02", { importe: "1" }), mov("aportacion", "2024-01-03", { importe: "100000" })]);
    const v = valorar(c);
    expect(v.rentabilidad[1]).toBeCloseTo(0.1, 12);
    expect(v.avisos.some((aviso) => aviso.codigo === "CAPITAL_RESIDUAL")).toBe(false);
  });
});
