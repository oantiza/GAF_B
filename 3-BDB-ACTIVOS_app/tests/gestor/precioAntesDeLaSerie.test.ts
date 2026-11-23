/**
 * Auditoría integral del 16-11-2026, hallazgo GES-1. Una posición comprada antes de que empiece su serie de precios valía
 * cero hasta el primer punto de la plataforma: el primer día daba −100 % y, encadenado, la rentabilidad de cualquier periodo
 * que lo incluyera también, sin aviso (el de «sin precio» se generaba y no llegaba a ninguna parte).
 *
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { comprobarIntegridad } from "../../src/gestor/motor/integridad";
import { rentabilidadDelPeriodo } from "../../src/gestor/motor/rentabilidad";
import { FUENTE, valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const TODO = { desde: "1900-01-01", hasta: "2100-01-01" };
const mercadoDe = (precios: Record<string, Array<[string, number]>>, ajustadas: string[] = []): DatosDeMercado => ({
  precios: new Map(Object.entries(precios).map(([id, puntos]) => [id, serie(...puntos)])),
  cambios: new Map(),
  ajustadasPorDividendos: new Set(ajustadas)
});

describe("GES-1 · antes de que empiece la serie de la plataforma, vale el precio de la operación", () => {
  /* 1.000 € aportados el 01-01-2020 y, el mismo día, 10 títulos a 100 €. La plataforma tiene precio desde el 10-01: 101 €; el 15-01, 102 €. */
  const c = cartera(
    [activo("F", "FONDO")],
    [mov("aportacion", "2020-01-01", { importe: "1000" }), mov("compra", "2020-01-01", { activoId: "F", titulos: "10", precio: "100", importe: "-1000" })]
  );
  const mercado = mercadoDe({ F: [["2020-01-10", 101], ["2020-01-15", 102]] });
  const v = valorar(c, mercado, { hasta: "2020-01-15" });
  const dia = (fecha: string) => v.indice.get(fecha) as number;

  test("del 1 al 9 vale lo pagado (10 × 100 = 1.000 €), no cero; el 10 entra la serie (10 × 101 = 1.010 €) y el 15, 1.020 €", () => {
    for (const fecha of ["2020-01-01", "2020-01-05", "2020-01-09"]) expect(v.valor[dia(fecha)]).toBeCloseTo(1000, 9);
    expect(v.valor[dia("2020-01-10")]).toBeCloseTo(1010, 9);
    expect(v.valor[dia("2020-01-14")]).toBeCloseTo(1010, 9);
    expect(v.valor[dia("2020-01-15")]).toBeCloseTo(1020, 9);
  });

  test("la rentabilidad del primer día es 0 %, no −100 %; la del 10 es 1.010/1.000 − 1 = 1 %; la del 15, 1.020/1.010 − 1", () => {
    expect(v.rentabilidad[dia("2020-01-01")]).toBeCloseTo(0, 12);
    expect(v.rentabilidad[dia("2020-01-10")]).toBeCloseTo(0.01, 12);
    expect(v.rentabilidad[dia("2020-01-15")]).toBeCloseTo(1020 / 1010 - 1, 12);
    /* Encadenada: 1 × 1,01 × (1.020/1.010) − 1 = 1.020/1.000 − 1 = 2 %. Antes, −100 %. */
    expect(rentabilidadDelPeriodo(v, TODO)?.twr).toBeCloseTo(0.02, 12);
  });

  test("consta con qué precio se valoró cada día y cuántos días tenía", () => {
    const serieDeF = v.porActivo.get("F")!;
    expect(serieDeF.fuente[dia("2020-01-01")]).toBe(FUENTE.operacion);
    expect(serieDeF.fuente[dia("2020-01-09")]).toBe(FUENTE.operacion);
    expect(serieDeF.antiguedad[dia("2020-01-09")]).toBe(8);
    expect(serieDeF.fuente[dia("2020-01-10")]).toBe(FUENTE.mercado);
    expect(serieDeF.precio[dia("2020-01-09")]).toBeCloseTo(100, 12);
  });

  test("ningún error de «sin precio», y una nota dice que hasta el 10 se valoró al precio de la operación", () => {
    const avisos = comprobarIntegridad(c, v, "2020-01-15", mercado).avisos;
    expect(avisos.filter((aviso) => aviso.codigo === "SIN_PRECIO")).toEqual([]);
    expect(avisos.filter((aviso) => aviso.codigo === "PRECIO_DE_OPERACION")).toEqual([
      {
        gravedad: "nota",
        codigo: "PRECIO_DE_OPERACION",
        activoId: "F",
        fecha: "2020-01-10",
        mensaje: "Activo F se valoró al precio de su última operación hasta el 10/01/2020, cuando empieza su serie de precios: lo que se movió hasta entonces aparece junto ese día."
      }
    ]);
  });

  test("a una fecha anterior a la serie, el aviso no dice que el activo «no tiene serie»", () => {
    const antes = valorar(c, mercado, { hasta: "2020-01-05" });
    const deOperacion = comprobarIntegridad(c, antes, "2020-01-05", mercado).avisos.filter((aviso) => aviso.codigo === "PRECIO_DE_OPERACION");
    expect(deOperacion.map((aviso) => [aviso.gravedad, aviso.mensaje])).toEqual([
      ["aviso", "Activo F aún no tiene precios en su serie: se valora al precio de su última operación, de hace 4 días. Ponle un precio a mano para actualizarlo."]
    ]);
  });

  test("una segunda compra antes de la serie pone su precio; una de después no pisa a la serie", () => {
    /* 2.000 € aportados; 10 títulos a 100 € el día 1 y 5 a 104 € el día 5 (520 €); quedan 480 € en efectivo. El 12-01, 2 títulos a 90 €, lejos del mercado. */
    const dos = cartera(
      [activo("F", "FONDO")],
      [
        mov("aportacion", "2020-01-01", { importe: "2000" }),
        mov("compra", "2020-01-01", { activoId: "F", titulos: "10", precio: "100", importe: "-1000" }),
        mov("compra", "2020-01-05", { activoId: "F", titulos: "5", precio: "104", importe: "-520" }),
        mov("compra", "2020-01-12", { activoId: "F", titulos: "2", precio: "90", importe: "-180" })
      ]
    );
    const w = valorar(dos, mercado, { hasta: "2020-01-15" });
    const en = (fecha: string) => w.valor[w.indice.get(fecha) as number];
    /* Día 4: 10 × 100 + 1.000 de efectivo = 2.000. Día 5: 15 × 104 + 480 = 2.040. Día 10: 15 × 101 + 480 = 1.995. */
    expect(en("2020-01-04")).toBeCloseTo(2000, 9);
    expect(en("2020-01-05")).toBeCloseTo(2040, 9);
    expect(en("2020-01-10")).toBeCloseTo(1995, 9);
    /* Día 12: 17 títulos al precio de la serie (101), no al de la operación (90): 17 × 101 + 300 = 2.017. */
    expect(en("2020-01-12")).toBeCloseTo(2017, 9);
  });
});

describe("GES-1 · el precio de un extracto anterior a la serie también vale", () => {
  /* El libro empieza con 10 títulos que llegan de otra entidad el 01-01-2020, con un coste de 95 € por título. El extracto del banco
     de ese día declara la posición en 1.000 € (100 € por título). La serie empieza el 10-01 a 101 €. */
  const c = cartera([activo("F", "FONDO")], [mov("entradaDeTitulos", "2020-01-01", { activoId: "F", titulos: "10", precio: "95" })], {
    extractos: [{ id: "e1", fecha: "2020-01-01", posiciones: [{ activoId: "F", titulos: "10", valor: "1000" }], efectivo: [] }]
  });
  const mercado = mercadoDe({ F: [["2020-01-10", 101], ["2020-01-15", 102]] });
  const v = valorar(c, mercado, { hasta: "2020-01-15" });

  test("vale lo que declaró el banco (1.000 €), no el coste (950 €); y entra como aportación por ese valor", () => {
    expect(v.valor[v.indice.get("2020-01-01") as number]).toBeCloseTo(1000, 9);
    expect(v.entradas[v.indice.get("2020-01-01") as number]).toBeCloseTo(1000, 9);
    expect(v.porActivo.get("F")!.fuente[v.indice.get("2020-01-05") as number]).toBe(FUENTE.extracto);
    /* 1.010/1.000 − 1 = 1 % el día 10; 1.020/1.000 − 1 = 2 % en el periodo. */
    expect(rentabilidadDelPeriodo(v, TODO)?.twr).toBeCloseTo(0.02, 12);
  });
});

describe("GES-1 · un hueco sin precio en el pasado es un error que se ve", () => {
  /* 1.000 € en 10 títulos de A a 100 €, con serie plana a 100 € desde el primer día. El 03-01-2020, A se canjea por 10 títulos de B, que no
     tiene operación con precio y cuya serie empieza el 10-01 a 101 €: del 3 al 9 no hay con qué valorar B. */
  const c = cartera(
    [activo("A", "FONDO"), activo("B", "FONDO")],
    [
      mov("aportacion", "2020-01-01", { importe: "1000" }),
      mov("compra", "2020-01-01", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
      mov("canje", "2020-01-03", { activoId: "A", destino: { activoId: "B", titulos: "10" } })
    ]
  );
  const mercado = mercadoDe({ A: [["2020-01-01", 100], ["2020-01-03", 100]], B: [["2020-01-10", 101], ["2020-01-15", 102]] });
  const v = valorar(c, mercado, { hasta: "2020-01-15" });

  test("esos días la cartera sale a cero: es lo que hay que ver", () => {
    expect(v.valor[v.indice.get("2020-01-02") as number]).toBeCloseTo(1000, 9);
    expect(v.valor[v.indice.get("2020-01-05") as number]).toBeCloseTo(0, 9);
  });

  test("a una fecha en que ya tiene precio, el error nombra el tramo y dice cómo arreglarlo", () => {
    const sinPrecio = comprobarIntegridad(c, v, "2020-01-15", mercado).avisos.filter((aviso) => aviso.codigo === "SIN_PRECIO");
    expect(sinPrecio).toEqual([
      {
        gravedad: "error",
        codigo: "SIN_PRECIO",
        activoId: "B",
        fecha: "2020-01-03",
        mensaje: "Activo B no tuvo precio del 03/01/2020 al 09/01/2020: esos días contó como cero, y la rentabilidad de cualquier periodo que los incluya no vale. Ponle un precio a mano con fecha 03/01/2020."
      }
    ]);
  });

  test("con el precio a mano que pide, el hueco desaparece", () => {
    const conPrecio = { ...c, preciosManuales: [{ activoId: "B", fecha: "2020-01-03", precio: "100" }] };
    const w = valorar(conPrecio, mercado, { hasta: "2020-01-15" });
    /* 10 × 100 = 1.000 € también del 3 al 9. */
    expect(w.valor[w.indice.get("2020-01-05") as number]).toBeCloseTo(1000, 9);
    expect(comprobarIntegridad(conPrecio, w, "2020-01-15", mercado).avisos.filter((aviso) => aviso.codigo === "SIN_PRECIO")).toEqual([]);
  });

  test("si sigue sin precio en la fecha pedida, un solo error: el de siempre", () => {
    const antes = valorar(c, mercado, { hasta: "2020-01-05" });
    const sinPrecio = comprobarIntegridad(c, antes, "2020-01-05", mercado).avisos.filter((aviso) => aviso.codigo === "SIN_PRECIO");
    expect(sinPrecio.map((aviso) => aviso.mensaje)).toEqual(["Activo B no tiene precio: cuenta como cero, y la rentabilidad de cualquier periodo que incluya esta fecha no vale. Ponle un precio a mano."]);
  });
});
