/**
 * El dividendo cobrado cuando la posición cambió entre la fecha ex y el cobro (auditoría del 16-11-2026, GES-8).
 *
 * El libro anota el dividendo el día que se cobra, y el dividendo por título salía de los títulos de ese día. Si la
 * posición cambió desde la fecha ex, sale mal, y con él todos los precios anteriores. Con la fecha ex escrita en el
 * dividendo, sale de los títulos de la víspera, que son los que tenían derecho.
 *
 * Un mismo caso en todas las pruebas. Precios reales: 50 € hasta el 9 de enero; el día 10 es la fecha ex de un
 * dividendo de 1 € por título, y cotiza a 49 € desde entonces. Serie ajustada del proveedor: lo anterior a la fecha
 * ex, por 49/50 → 49 € todos los días. Se compran 100 títulos a 50 € el día 1 y el dividendo, 100 € brutos y sin
 * retención, se cobra el día 15. Cada cifra esperada sale de esa cuenta, no del motor.
 */
import { describe, expect, it } from "vitest";
import { leer, serializar } from "../../src/gestor/almacen/formato";
import { comprobarIntegridad } from "../../src/gestor/motor/integridad";
import { definicionDe } from "../../src/gestor/motor/movimientos/registro";
import { valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const dia = (n: number): string => `2024-01-${String(n).padStart(2, "0")}`;
const MERCADO: DatosDeMercado = {
  precios: new Map([["ACC", serie(...Array.from({ length: 15 }, (_, i): [string, number] => [dia(i + 1), 49]))]]),
  cambios: new Map(),
  ajustadasPorDividendos: new Set(["ACC"])
};
const COMPRA = [
  mov("aportacion", dia(1), { importe: "5000" }),
  mov("compra", dia(1), { activoId: "ACC", titulos: "100", precio: "50", importe: "-5000" })
];
const valores = (movimientos: ReturnType<typeof mov>[]): number[] =>
  [...valorar(cartera([activo("ACC")], movimientos), MERCADO, { hasta: dia(15) }).valor].map((x) => Number(x.toFixed(6)));
const veces = (n: number, valor: number): number[] => Array.from({ length: n }, () => valor);

describe("la mitad de la posición vendida entre la fecha ex y el cobro", () => {
  const venta = mov("venta", dia(12), { activoId: "ACC", titulos: "50", precio: "49", importe: "2450" });

  it("sin fecha ex, el dividendo por título sale el doble y la compra se valora un 2 % por encima de lo pagado", () => {
    /* 100 € entre los 50 títulos del día del cobro: 2 € por título. Factor 1 + 2/49: 49 × 51/49 = 51 € el día 1. */
    const sin = valores([...COMPRA, venta, mov("dividendo", dia(15), { activoId: "ACC", importe: "100" })]);
    expect(sin[0]).toBe(5100);
  });

  it("con fecha ex, sale de los 100 títulos que tenían derecho y los precios anteriores son los reales", () => {
    /*
     * 100 € entre 100 títulos: 1 € por título. Factor 1 + 1/49 hasta el cobro: 50 €.
     *   días 1 a 11   100 × 50 = 5.000 €        (desde el 10: 49 € de precio y 1 € de dividendo pendiente)
     *   días 12 a 14  50 × 50 + 2.450 = 4.950 € (el resto que queda: 1 € × los 50 títulos vendidos, hasta el cobro)
     *   día 15        50 × 49 + 2.450 + 100 = 5.000 €
     */
    const con = valores([...COMPRA, venta, mov("dividendo", dia(15), { activoId: "ACC", importe: "100", fechaEx: dia(10) })]);
    expect(con).toEqual([...veces(11, 5000), ...veces(3, 4950), 5000]);
  });
});

describe("toda la posición vendida entre la fecha ex y el cobro", () => {
  const venta = mov("venta", dia(12), { activoId: "ACC", titulos: "100", precio: "49", importe: "4900" });

  it("sin fecha ex, el dividendo se pierde para el precio y la compra sale con una pérdida que no existe", () => {
    /* La posición se ancla en su venta, a 49 €, y nada sube los precios anteriores: 100 × 49 = 4.900 € el día 1. */
    const sin = valores([...COMPRA, venta, mov("dividendo", dia(15), { activoId: "ACC", importe: "100" })]);
    expect(sin[0]).toBe(4900);
  });

  it("con fecha ex, el escalón va en ella: antes 50 €, después los 49 € a los que se vendió", () => {
    /*
     *   días 1 a 9    100 × 50 = 5.000 €
     *   días 10 y 11  100 × 49 = 4.900 €   (el dividendo pendiente no se lleva como saldo)
     *   días 12 a 14  4.900 € en efectivo
     *   día 15        4.900 + 100 = 5.000 €
     */
    const con = valores([...COMPRA, venta, mov("dividendo", dia(15), { activoId: "ACC", importe: "100", fechaEx: dia(10) })]);
    expect(con).toEqual([...veces(9, 5000), ...veces(5, 4900), 5000]);
  });
});

describe("una posición que no cambia", () => {
  it("da lo mismo con fecha ex que sin ella: el patrimonio no se mueve entre la fecha ex y el cobro", () => {
    /* 100 × 50 hasta el día 14; el 15, 100 × 49 + 100. */
    const sin = valores([...COMPRA, mov("dividendo", dia(15), { activoId: "ACC", importe: "100" })]);
    const con = valores([...COMPRA, mov("dividendo", dia(15), { activoId: "ACC", importe: "100", fechaEx: dia(10) })]);
    expect(sin).toEqual(veces(15, 5000));
    expect(con).toEqual(sin);
  });
});

describe("se avisa cuando puede hacer falta, y solo entonces", () => {
  const nota = (movimientos: ReturnType<typeof mov>[]) => {
    const c = cartera([activo("ACC")], movimientos);
    return comprobarIntegridad(c, valorar(c, MERCADO, { hasta: dia(15) }), dia(15), MERCADO).avisos.filter((aviso) => aviso.codigo === "DIVIDENDO_SIN_FECHA_EX");
  };
  const venta = mov("venta", dia(12), { activoId: "ACC", titulos: "50", precio: "49", importe: "2450" });

  it("un dividendo sin fecha ex con la posición cambiada tres días antes lleva una nota", () => {
    const avisos = nota([...COMPRA, venta, mov("dividendo", dia(15), { id: "div", activoId: "ACC", importe: "100" })]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ gravedad: "nota", activoId: "ACC", movimientoIds: ["div"], fecha: dia(15) });
    expect(avisos[0].mensaje).toContain("su posición había cambiado el 12/01/2024");
  });

  it("con la fecha ex escrita, o sin cambios en la posición, no hay nota", () => {
    expect(nota([...COMPRA, venta, mov("dividendo", dia(15), { activoId: "ACC", importe: "100", fechaEx: dia(10) })])).toEqual([]);
    /* La compra que abre la posición no es un cambio: si se compró entera antes de la fecha ex, los títulos son los mismos. */
    expect(nota([...COMPRA, mov("dividendo", dia(15), { activoId: "ACC", importe: "100" })])).toEqual([]);
  });
});

describe("el campo", () => {
  const dividendo = definicionDe("dividendo")!;
  const contexto = { divisaBase: "EUR", activo: (activoId: string | undefined) => (activoId === "ACC" ? activo("ACC") : undefined) };

  it("es de los dividendos y no de los cupones, y no puede ser posterior al cobro", () => {
    expect(dividendo.campos.some((campo) => campo.campo === "fechaEx" && !campo.obligatorio)).toBe(true);
    expect(definicionDe("cupon")!.campos.some((campo) => campo.campo === "fechaEx")).toBe(false);
    expect(dividendo.validar(mov("dividendo", dia(15), { activoId: "ACC", importe: "100", fechaEx: dia(10) }), contexto)).toEqual([]);
    expect(dividendo.validar(mov("dividendo", dia(15), { activoId: "ACC", importe: "100", fechaEx: dia(16) }), contexto)).toContain("La fecha ex-dividendo no puede ser posterior a la del cobro.");
    expect(dividendo.validar(mov("dividendo", dia(15), { activoId: "ACC", importe: "100", fechaEx: "10/01/2024" }), contexto)).toContain("La fecha ex-dividendo no es válida.");
  });

  it("se guarda en el fichero de la cartera y se vuelve a leer", () => {
    const c = cartera([activo("ACC")], [...COMPRA, mov("dividendo", dia(15), { id: "div", activoId: "ACC", importe: "100", fechaEx: dia(10) })]);
    const leida = leer(serializar(c)).cartera;
    expect(leida.movimientos.find((movimiento) => movimiento.id === "div")?.fechaEx).toBe(dia(10));
  });
});
