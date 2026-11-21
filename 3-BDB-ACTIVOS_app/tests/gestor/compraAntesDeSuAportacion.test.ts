/**
 * Auditoría integral del 16-11-2026, hallazgo GES-9. Una compra anotada antes que su aportación deja el efectivo en negativo
 * por lo comprado: la cartera «vale» cero y no hay capital sobre el que medir lo que la posición gana hasta que llega el dinero.
 * Comprado el día 1, subiendo un 1 % diario y aportado el día 3, la rentabilidad salía un 1 % donde el resultado era un 2,01 %,
 * y nada lo decía.
 *
 * Sin capital no hay rentabilidad que dar, y se dice, con la fecha y los euros que quedan fuera. Y desde la decisión de Óscar del
 * 17-11-2026 («que los días sin capital no cuenten»), la rentabilidad se encadena DESDE QUE HAY DINERO: lo ganado antes de que
 * llegue la aportación no sirve de base para medir el día siguiente.
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { desgloseDelPeriodo } from "../../src/gestor/motor/desglose";
import { comprobarIntegridad } from "../../src/gestor/motor/integridad";
import { rentabilidadDelPeriodo } from "../../src/gestor/motor/rentabilidad";
import { valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const TODO = { desde: "1900-01-01", hasta: "2100-01-01" };
/* A sube un 1 % cada día: 100, 101 y 102,01. */
const mercado: DatosDeMercado = { precios: new Map([["A", serie(["2024-01-01", 100], ["2024-01-02", 101], ["2024-01-03", 102.01])]]), cambios: new Map() };
const compra = mov("compra", "2024-01-01", { activoId: "A", titulos: "100", precio: "100", importe: "-10000" });
const sinCapital = (c: ReturnType<typeof cartera>, fecha: string) =>
  comprobarIntegridad(c, valorar(c, mercado), fecha, mercado).avisos.filter((aviso) => aviso.codigo === "SIN_CAPITAL");

describe("GES-9 · una compra anotada dos días antes que su aportación", () => {
  const c = cartera([activo("A")], [compra, mov("aportacion", "2024-01-03", { importe: "10000" })]);
  const v = valorar(c, mercado);
  const dia = (fecha: string) => v.indice.get(fecha) as number;

  test("el patrimonio: 0 € el día de la compra, 100 € el segundo y 10.201 € al llegar el dinero", () => {
    /* Día 1: 100 títulos × 100 − 10.000 de efectivo en negativo = 0. Día 2: 10.100 − 10.000 = 100. Día 3: 10.201 − 10.000 + 10.000 = 10.201. */
    expect(v.valor[dia("2024-01-01")]).toBeCloseTo(0, 9);
    expect(v.valor[dia("2024-01-02")]).toBeCloseTo(100, 9);
    expect(v.valor[dia("2024-01-03")]).toBeCloseTo(10201, 9);
  });

  test("la rentabilidad sigue sin poder medir el segundo día: no había capital", () => {
    /* Día 2: capital = 0 de la víspera + 0 aportado: no hay sobre qué dividir los 100 € ganados, y la rentabilidad es 0. */
    expect(v.capital[dia("2024-01-02")]).toBeCloseTo(0, 9);
    expect(v.rentabilidad[dia("2024-01-02")]).toBe(0);
    /* Día 3: 10.201 / (100 de la víspera + 10.000 aportados) − 1 = 1 %. Y ese 1 % es todo lo que encadena el periodo. */
    expect(v.rentabilidad[dia("2024-01-03")]).toBeCloseTo(0.01, 12);
    expect(rentabilidadDelPeriodo(v, TODO)?.twr).toBeCloseTo(0.01, 12);
  });

  test("el dinero no se pierde: el resultado en euros es de 201 €, un 2,01 % de lo aportado", () => {
    /* 10.201 de valor final − 10.000 aportados = 201 €. */
    expect(rentabilidadDelPeriodo(v, TODO)?.resultado).toBeCloseTo(201, 9);
  });

  test("y ahora se dice, con el día y los 100 € que quedan fuera de la rentabilidad", () => {
    expect(sinCapital(c, "2024-01-03")).toEqual([
      {
        gravedad: "aviso",
        codigo: "SIN_CAPITAL",
        fecha: "2024-01-02",
        mensaje:
          "El 02/01/2024 la cartera no tenía capital del cliente sobre el que medir (lo que valía era cero, negativo o solo lo ganado antes de que llegara el dinero): el resultado de ese día, 100,00 EUR, no entra en la rentabilidad ponderada por tiempo, que se encadena desde que hay dinero. Suele ser una compra anotada antes que su aportación, o un cobro que llega a una cartera ya vacía: revisa las fechas. Sí cuenta en el resultado en euros."
      }
    ]);
    /* A la fecha de la compra todavía no ha pasado. */
    expect(sinCapital(c, "2024-01-01")).toEqual([]);
  });
});

describe("GES-9 · cuándo no hay nada que avisar", () => {
  test("con la aportación el mismo día de la compra, o al día siguiente, no queda ningún resultado sin medir", () => {
    const hasta = { hasta: "2024-01-03" };
    /* El mismo día: capital = 10.000 aportados, y los tres días se miden. 10.201 / 10.000 − 1 = 2,01 %. */
    const elMismoDia = cartera([activo("A")], [compra, mov("aportacion", "2024-01-01", { importe: "10000" })]);
    expect(valorar(elMismoDia, mercado, hasta).avisos.filter((aviso) => aviso.codigo === "SIN_CAPITAL")).toEqual([]);
    expect(rentabilidadDelPeriodo(valorar(elMismoDia, mercado, hasta), TODO)?.twr).toBeCloseTo(0.0201, 12);
    /* Al día siguiente: el día de la compra la cartera vale 0 y no gana nada (compra y cierre a 100); el día 2 ya hay
       capital, los 10.000 aportados: 10.100 / 10.000 − 1 = 1 %, y el día 3 otro 1 %. También 2,01 %. */
    const alDiaSiguiente = cartera([activo("A")], [compra, mov("aportacion", "2024-01-02", { importe: "10000" })]);
    expect(valorar(alDiaSiguiente, mercado, hasta).avisos.filter((aviso) => aviso.codigo === "SIN_CAPITAL")).toEqual([]);
    expect(rentabilidadDelPeriodo(valorar(alDiaSiguiente, mercado, hasta), TODO)?.twr).toBeCloseTo(0.0201, 12);
  });
});

describe("GES-9 · varios días seguidos se dicen juntos, con su suma", () => {
  /* A baja un 1 % diario: 100, 99 y 98,01. La aportación llega el 04-01. Día 2: 9.900 − 10.000 = −100 € de patrimonio, con
     0 de capital. Día 3: 9.801 − 10.000 = −199 €, con −100 de capital. Ninguno de los dos se puede medir: −100 y −99, −199 €. */
  const bajando: DatosDeMercado = { precios: new Map([["A", serie(["2024-01-01", 100], ["2024-01-02", 99], ["2024-01-03", 98.01], ["2024-01-04", 98.01])]]), cambios: new Map() };
  const c = cartera([activo("A")], [compra, mov("aportacion", "2024-01-04", { importe: "10000" })]);
  const v = valorar(c, bajando);

  test("los dos días sin capital van en un solo aviso", () => {
    const avisos = comprobarIntegridad(c, v, "2024-01-04", bajando).avisos.filter((aviso) => aviso.codigo === "SIN_CAPITAL");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].fecha).toBe("2024-01-02");
    expect(avisos[0].mensaje).toContain("Del 02/01/2024 al 03/01/2024 la cartera no tuvo capital del cliente sobre el que medir");
    expect(avisos[0].mensaje).toContain("el resultado de esos días, −199,00 EUR, no entra");
  });

  test("y el resultado en euros los cuenta: −199 €", () => {
    /* 9.801 de valor final (el efectivo queda a cero) − 10.000 aportados = −199 €. */
    expect(rentabilidadDelPeriodo(v, TODO)?.resultado).toBeCloseTo(-199, 9);
  });
});

describe("GES-9 · decisión de Óscar (17-11-2026): la rentabilidad se encadena desde que hay dinero", () => {
  /* A sube un 1 % diario y la aportación llega el 04-01, dos días después de lo que haría falta. */
  const subiendo: DatosDeMercado = { precios: new Map([["A", serie(["2024-01-01", 100], ["2024-01-02", 101], ["2024-01-03", 102.01], ["2024-01-04", 103.0301])]]), cambios: new Map() };
  const c = cartera([activo("A")], [compra, mov("aportacion", "2024-01-04", { importe: "10000" })]);
  const v = valorar(c, subiendo);
  const dia = (fecha: string) => v.indice.get(fecha) as number;

  test("lo ganado antes de que llegue el dinero no es la base del día siguiente: ya no sale +101 % en un día", () => {
    /* Día 2: +100 € con 0 de capital: fuera. Día 3: la víspera valía 100 €, pero eran lo ganado con una compra sin pagar, no
       dinero del cliente: fuera también (antes se medía 201 / 100 − 1 = +101 %). Día 4: llegan los 10.000; capital = 201 de
       la víspera + 10.000 = 10.201, y el cierre vale 100 × 103,0301 − 10.000 + 10.000 = 10.303,01: 10.303,01 / 10.201 − 1 = 1 %. */
    expect(v.rentabilidad[dia("2024-01-02")]).toBe(0);
    expect(v.rentabilidad[dia("2024-01-03")]).toBe(0);
    expect(v.rentabilidad[dia("2024-01-04")]).toBeCloseTo(0.01, 12);
    expect([...v.encadena]).toEqual([0, 0, 0, 1]);
    /* El periodo encadena solo el día 4: 1 %. Antes, 2,01 × 1,01 − 1 = +103,01 %. */
    expect(rentabilidadDelPeriodo(v, TODO)?.twr).toBeCloseTo(0.01, 12);
  });

  test("el resultado en euros no cambia: 303,01 €, y el aviso dice los dos días y los 201 € que quedan fuera", () => {
    /* 10.303,01 de valor final − 10.000 aportados = 303,01 €. Fuera de la TWR: 100 € del día 2 + 101 € del día 3 = 201 €. */
    expect(rentabilidadDelPeriodo(v, TODO)?.resultado).toBeCloseTo(303.01, 6);
    const avisos = comprobarIntegridad(c, v, "2024-01-04", subiendo).avisos;
    const sinCapital = avisos.filter((aviso) => aviso.codigo === "SIN_CAPITAL");
    expect(sinCapital).toHaveLength(1);
    expect(sinCapital[0].fecha).toBe("2024-01-02");
    expect(sinCapital[0].mensaje).toContain("Del 02/01/2024 al 03/01/2024 la cartera no tuvo capital del cliente sobre el que medir");
    expect(sinCapital[0].mensaje).toContain("el resultado de esos días, 201,00 EUR, no entra");
    /* Y sigue diciéndose que el efectivo estuvo en negativo. */
    expect(avisos.map((aviso) => aviso.codigo)).toContain("EFECTIVO_EN_NEGATIVO");
  });

  test("la contribución de la posición es la de la TWR: 1 punto, solo del día 4", () => {
    /* Día 4: efecto precio de A = 100 × (103,0301 − 102,01) = 102,01 €, sobre 10.201 de capital: 102,01 / 10.201 = 0,01. Los
       días 2 y 3 no pesan, como no entran en la TWR. */
    const desglose = desgloseDelPeriodo(v, TODO)!;
    expect(desglose.posiciones.find((p) => p.activoId === "A")?.contribucion).toBeCloseTo(0.01, 12);
    expect(desglose.contribucionTotal).toBeCloseTo(0.01, 12);
  });
});

describe("GES-9 · la cadena se apaga con una cartera liquidada y vuelve a encenderse con el dinero siguiente", () => {
  /* A: aportados 1.000 € el 01-01 y comprados 10 títulos a 100; vendidos el 02-01 a 101 (1.010 €) y retirado todo: la
     cartera queda a cero. B: comprados 100 títulos a 100 el 03-01 sin dinero; sube un 1 % diario y la aportación de
     10.000 € llega el 06-01. */
  const mercado2: DatosDeMercado = {
    precios: new Map([
      ["A", serie(["2024-01-01", 100], ["2024-01-02", 101])],
      ["B", serie(["2024-01-03", 100], ["2024-01-04", 101], ["2024-01-05", 102.01], ["2024-01-06", 103.0301])]
    ]),
    cambios: new Map()
  };
  const c = cartera(
    [activo("A"), activo("B")],
    [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("compra", "2024-01-01", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
      mov("venta", "2024-01-02", { activoId: "A", titulos: "10", precio: "101", importe: "1010" }),
      mov("retirada", "2024-01-02", { importe: "-1010" }),
      mov("compra", "2024-01-03", { activoId: "B", titulos: "100", precio: "100", importe: "-10000" }),
      mov("aportacion", "2024-01-06", { importe: "10000" })
    ]
  );
  const v = valorar(c, mercado2);
  const dia = (fecha: string) => v.indice.get(fecha) as number;

  test("el 05-01 ya no se mide sobre los 100 € ganados el 04-01", () => {
    /* 01-01: capital 1.000, cierre 1.000: 0 %. 02-01: capital 1.000, sale 1.010: (0 + 1.010) / 1.000 − 1 = 1 %. 03-01: capital
       0: se apaga. 04-01: capital 0, +100 €: fuera. 05-01: capital 100, sin dinero nuevo: fuera (antes 201 / 100 − 1 = +101 %;
       no era capital residual, porque 100 € no quedan por debajo del 1 % de los 1.000 que llegó a valer). 06-01: entran
       10.000, capital 10.201, cierre 10.303,01: 1 %. */
    expect(v.rentabilidad[dia("2024-01-02")]).toBeCloseTo(0.01, 12);
    expect(v.rentabilidad[dia("2024-01-05")]).toBe(0);
    expect(v.rentabilidad[dia("2024-01-06")]).toBeCloseTo(0.01, 12);
    expect([...v.encadena]).toEqual([1, 1, 0, 0, 0, 1]);
    /* 1,01 × 1,01 − 1 = 2,01 %. */
    expect(rentabilidadDelPeriodo(v, TODO)?.twr).toBeCloseTo(0.0201, 12);
  });

  test("el resultado en euros cuenta todo: 313,01 €", () => {
    /* 10.303,01 de valor final − (1.000 − 1.010 + 10.000) aportados netos = 313,01 €: 10 de A y 303,01 de B. */
    expect(rentabilidadDelPeriodo(v, TODO)?.resultado).toBeCloseTo(313.01, 6);
    const sinCapital = v.avisos.filter((aviso) => aviso.codigo === "SIN_CAPITAL");
    expect(sinCapital).toHaveLength(1);
    expect(sinCapital[0].desde).toBe("2024-01-04");
    /* 100 € del 04-01 + 101 € del 05-01. */
    expect(sinCapital[0].mensaje).toContain("Del 04/01/2024 al 05/01/2024");
    expect(sinCapital[0].mensaje).toContain("201,00 EUR");
  });
});
