/**
 * El análisis completo de una cartera pequeña, con todas sus cifras calculadas a mano.
 *
 *   1 ene  aportación de 10.000 €
 *          compra de 100 ACC a 20 € + 10 € de comisión           −2.010 €
 *          suscripción de 50 FON a 100 €                         −5.000 €
 *   3 ene  venta de 40 ACC a 25 € − 5 € de comisión                +995 €
 *   4 ene  dividendo de ACC: 10 € brutos, 1,90 € de retención     +8,10 €
 *   5 ene  comisión de custodia                                     −12 €
 *
 *   Efectivo:  10.000 − 2.010 − 5.000 + 995 + 8,10 − 12 = 3.981,10 €
 *   A 5 de enero, con ACC a 24 € y FON a 102 €:
 *     ACC  60 × 24 = 1.440 €   coste 2.010 × 60/100 = 1.206 €   latente 234 €
 *     FON  50 × 102 = 5.100 €  coste 5.000 €                    latente 100 €
 *   Patrimonio: 1.440 + 5.100 + 3.981,10 = 10.521,10 €.  Resultado: 521,10 €.
 *   Venta: cobra 995 €, costó 2.010 × 40/100 = 804 €. Realizado: 191 €.
 *   Comprobación: 191 + 234 + 100 + 8,10 − 12 = 521,10 €.
 */
import { describe, expect, it } from "vitest";
import { analizar, periodosHabituales, preparar } from "../../src/gestor/motor/analisis";
import type { FichaDeActivo } from "../../src/gestor/motor/composicion";
import { conciliar, posiblesDuplicados, yaEnElLibro } from "../../src/gestor/motor/integridad";
import type { Cartera, ExtractoDeclarado } from "../../src/gestor/motor/modelo";
import type { DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const MOVIMIENTOS = [
  mov("aportacion", "2024-01-01", { id: "a", importe: "10000" }),
  mov("compra", "2024-01-01", { id: "c", activoId: "ACC", titulos: "100", precio: "20", comision: "10", importe: "-2010" }),
  mov("suscripcion", "2024-01-01", { id: "s", activoId: "FON", titulos: "50", precio: "100", importe: "-5000" }),
  mov("venta", "2024-01-03", { id: "v", activoId: "ACC", titulos: "40", precio: "25", comision: "5", importe: "995" }),
  mov("dividendo", "2024-01-04", { id: "d", activoId: "ACC", importe: "8.10", retencion: "1.90" }),
  mov("comision", "2024-01-05", { id: "k", importe: "-12" })
];
const CARTERA: Cartera = cartera([activo("ACC"), activo("FON", "FONDO")], MOVIMIENTOS);
const MERCADO: DatosDeMercado = {
  precios: new Map([
    ["ACC", serie(["2024-01-01", 20], ["2024-01-02", 22], ["2024-01-03", 25], ["2024-01-05", 24])],
    ["FON", serie(["2024-01-01", 100], ["2024-01-05", 102])]
  ]),
  cambios: new Map()
};
const FICHAS = new Map<string, FichaDeActivo>([
  ["FON", { clases: { "Renta variable": 0.6, "Renta fija": 0.4 }, rentaVariable: 0.6, regiones: { Europa: 0.5, "Norteamérica": 0.5 }, sectores: { "Tecnología": 1 }, gastosCorrientes: 0.01 }]
]);
const TODO = { desde: "2023-12-31", hasta: "2024-01-05" };
const a = analizar(preparar(CARTERA, MERCADO, FICHAS, "2024-01-05"), TODO);
const lineas = (reparto: { lineas: Array<{ nombre: string; valor: number }> }) => Object.fromEntries(reparto.lineas.map((linea) => [linea.nombre, Number(linea.valor.toFixed(2))]));

describe("análisis: las cuatro preguntas de la vista principal", () => {
  it("cuánto vale", () => {
    expect(a.patrimonio).toBeCloseTo(10521.1, 9);
    expect(a.efectivo.total).toBeCloseTo(3981.1, 9);
    expect(a.efectivo.porDivisa.map((linea) => [linea.divisa, linea.saldo.toFixed(2)])).toEqual([["EUR", "3981.10"]]);
  });

  it("cuánto ha ganado o perdido, en euros y en porcentaje", () => {
    expect(a.rentabilidad?.resultado).toBeCloseTo(521.1, 9);
    expect(a.rentabilidad?.twr).toBeCloseTo(0.05211, 12); // sin flujos tras el primer día: 10.521,10 / 10.000 − 1
    expect(a.rentabilidad?.aportacionesNetas).toBe(10000);
    expect(a.realizado).toBeCloseTo(191, 9);
    expect(a.latente).toBeCloseTo(334, 9);
  });

  it("en qué está invertida", () => {
    expect(a.posiciones.map((p) => [p.activo.id, p.titulos.toFixed(), Number(p.valor?.toFixed(2)), Number(p.coste?.toFixed(2)), Number(p.latente?.toFixed(2))])).toEqual([
      ["FON", "50", 5100, 5000, 100],
      ["ACC", "60", 1440, 1206, 234]
    ]);
    expect(a.posiciones[1].latentePct).toBeCloseTo(234 / 1206, 12);
    expect(a.posiciones[1].precioMedio).toBeCloseTo(20.1, 12); // 2.010 € / 100 títulos, comisión incluida
    expect(a.posiciones[0].peso).toBeCloseTo(5100 / 10521.1, 12);
    expect(lineas(a.composicion.porTipoDeProducto)).toEqual({ Fondos: 5100, Efectivo: 3981.1, Acciones: 1440 });
  });

  it("qué ha pasado: los movimientos quedan en el libro, por orden", () => {
    expect(a.valoracion.libro.apuntes.filter((apunte) => apunte.efecto.clase === "efectivo").map((apunte) => apunte.movimiento.id)).toEqual(["a", "c", "s", "v", "d", "k"]);
  });
});

describe("análisis: el detalle", () => {
  it("posiciones cerradas en el periodo", () => {
    expect(a.cerradas).toHaveLength(1);
    const venta = a.cerradas[0];
    expect([venta.activoId, venta.titulos, venta.coste, venta.cobrado, venta.resultado]).toEqual(["ACC", 40, 804, 995, 191]);
    expect(venta.resultadoPct).toBeCloseTo(191 / 804, 12);
    expect(venta.cerradaDelTodo).toBe(false); // quedan 60 títulos
  });

  it("ingresos y costes del periodo", () => {
    const i = a.ingresosYCostes;
    expect(i.dividendos).toEqual({ bruto: 10, retencion: 1.9, neto: 8.1 });
    expect(i.ingresosNetos).toBeCloseTo(8.1, 9);
    expect(i.costesDeOperacion).toBe(15); // 10 € de la compra + 5 € de la venta
    expect(i.costesDelServicio).toBe(12); // la custodia
    expect(i.impuestos).toBeCloseTo(1.9, 9);
    expect(i.costesExplicitos).toBe(27);
    // Patrimonio medio de los cinco días: (10.000 + 10.200 + 10.495 + 10.503,10 + 10.521,10) / 5
    //   día 1: 2.000 + 5.000 + 2.990 (lo pagado de más son los 10 € de comisión) = 9.990 … se calcula abajo.
    const dia = [
      100 * 20 + 5000 + 2990, //           9.990
      100 * 22 + 5000 + 2990, //          10.190
      60 * 25 + 5000 + 3985, //           10.485
      60 * 25 + 5000 + 3993.1, //         10.493,10
      60 * 24 + 5100 + 3981.1 //          10.521,10
    ];
    expect(i.patrimonioMedio).toBeCloseTo(dia.reduce((x, y) => x + y, 0) / 5, 9);
    // Gastos corrientes del fondo: valor medio (5.000 × 4 + 5.100) / 5 = 5.020 € × 1 % × 5 días / 365,2425.
    expect(i.gastosCorrientes).toBeCloseTo((5020 * 0.01 * 5) / 365.2425, 9);
    expect(i.coberturaDeGastosCorrientes).toBe(1); // del fondo se conoce el TER y la acción no tiene
  });

  it("el detalle de los costes: cada línea es un movimiento y suman los totales", () => {
    const i = a.ingresosYCostes;
    expect(i.costesPorOperacion.map((l) => [l.movimientoId, l.tipo, l.activoId, l.importe])).toEqual([["c", "compra", "ACC", 10], ["v", "venta", "ACC", 5]]);
    expect(i.cargosDelServicio.map((l) => [l.fecha, l.movimientoId, l.tipo, l.importe])).toEqual([["2024-01-05", "k", "comision", 12]]);
    expect(i.impuestosApuntados).toBe(0); // la retención del dividendo va dentro del dividendo
    expect(i.porProducto).toHaveLength(1);
    expect(i.porProducto[0]).toMatchObject({ activoId: "FON", nombre: "Activo FON", gastosCorrientes: 0.01, valorMedio: 5020 });
    expect(i.porProducto[0].coste).toBe(i.gastosCorrientes);
    expect(i.productosSinGastosCorrientes).toEqual([]); // la acción no tiene gastos corrientes: no falta nada
  });

  it("los gastos corrientes, producto a producto, con uno desconocido", () => {
    /*
     * 1 ene  aportación de 10.000 €
     *        suscripción de 20 F1 a 100 € + 3 € de comisión + 2 € de gastos      −2.005 €   gastos corrientes 2 %
     *        suscripción de 30 F2 a 100 €                                        −3.000 €   gastos corrientes desconocidos
     *        compra de 10 E3 a 50 €                                                −500 €   gastos corrientes 0,3 %
     * 3 ene  comisión de custodia, «Custodia trimestral»                             −6 €
     * 4 ene  otro cargo                                                            −1,50 €
     * Precios planos: F1 vale 2.000 €, F2 3.000 € y E3 500 € los cinco días del periodo.
     *   F1: 2.000 × 2 % × 5 / 365,2425 = 0,547581…   E3: 500 × 0,3 % × 5 / 365,2425 = 0,020534…
     *   Cobertura: (2.000 + 500) / 5.500.
     */
    const activos = [activo("F1", "FONDO"), activo("F2", "FONDO"), activo("E3", "ETF")];
    const movimientos = [
      mov("aportacion", "2024-01-01", { id: "ap", importe: "10000" }),
      mov("suscripcion", "2024-01-01", { id: "s1", activoId: "F1", titulos: "20", precio: "100", comision: "3", gastos: "2", importe: "-2005" }),
      mov("suscripcion", "2024-01-01", { id: "s2", activoId: "F2", titulos: "30", precio: "100", importe: "-3000" }),
      mov("compra", "2024-01-01", { id: "c3", activoId: "E3", titulos: "10", precio: "50", importe: "-500" }),
      mov("comision", "2024-01-03", { id: "cu", importe: "-6", nota: "Custodia trimestral" }),
      mov("otroEfectivo", "2024-01-04", { id: "ot", importe: "-1.50" })
    ];
    const mercado: DatosDeMercado = {
      precios: new Map([["F1", serie(["2024-01-01", 100])], ["F2", serie(["2024-01-01", 100])], ["E3", serie(["2024-01-01", 50])]]),
      cambios: new Map()
    };
    const fichas = new Map<string, FichaDeActivo>([["F1", { gastosCorrientes: 0.02 }], ["E3", { gastosCorrientes: 0.003 }]] as Array<[string, FichaDeActivo]>);
    const i = analizar(preparar(cartera(activos, movimientos), mercado, fichas, "2024-01-05"), TODO).ingresosYCostes;
    const f1 = (2000 * 0.02 * 5) / 365.2425;
    const e3 = (500 * 0.003 * 5) / 365.2425;
    expect(i.porProducto.map((p) => [p.activoId, p.gastosCorrientes, p.valorMedio])).toEqual([["F1", 0.02, 2000], ["E3", 0.003, 500]]);
    expect(i.porProducto[0].coste).toBeCloseTo(f1, 12);
    expect(i.porProducto[1].coste).toBeCloseTo(e3, 12);
    expect(i.gastosCorrientes).toBe(i.porProducto[0].coste + i.porProducto[1].coste);
    expect(i.gastosCorrientes).toBeCloseTo(f1 + e3, 12); // 0,5681 €
    expect(i.productosSinGastosCorrientes).toEqual(["Activo F2"]);
    expect(i.coberturaDeGastosCorrientes).toBeCloseTo(2500 / 5500, 12);
    /* La comisión y los gastos de la suscripción, en una sola línea. */
    expect(i.costesPorOperacion.map((l) => [l.movimientoId, l.importe])).toEqual([["s1", 5]]);
    expect(i.costesDeOperacion).toBe(5);
    expect(i.cargosDelServicio.map((l) => [l.fecha, l.tipo, l.nota, l.importe])).toEqual([["2024-01-03", "comision", "Custodia trimestral", 6], ["2024-01-04", "otroEfectivo", undefined, 1.5]]);
    expect(i.costesDelServicio).toBe(7.5);
    expect(i.costesTotales).toBe(12.5 + i.gastosCorrientes!);
  });

  it("el desglose del resultado cuadra con el total", () => {
    const d = a.desglose!;
    // Precio: la venta y lo latente llevan dentro las comisiones de compraventa. 191 + 234 + 100 = 525.
    expect(d.precio).toBeCloseTo(525, 9);
    expect(d.ingresos).toBeCloseTo(8.1, 9);
    expect(d.costes).toBeCloseTo(12, 9);
    expect(d.divisa).toBe(0);
    expect(d.cuadrado).toEqual({ precio: 525, ingresos: 8.1, divisa: 0, costes: 12, resultado: 521.1 });
    expect(d.contribucionTotal).toBeCloseTo(a.rentabilidad!.twr, 12);
  });

  it("composición mirando dentro del fondo", () => {
    // Renta variable: 1.440 de la acción + 60 % de 5.100 = 4.500. Renta fija: 40 % de 5.100 = 2.040. Liquidez: 3.981,10.
    expect(lineas(a.composicion.porClaseDeActivo)).toEqual({ "Renta variable": 4500, Liquidez: 3981.1, "Renta fija": 2040 });
    expect(a.composicion.rentaVariable).toBeCloseTo(4500 / 10521.1, 12);
    // Regiones de la renta variable: el fondo reparte sus 3.060 € a medias; de la acción no se sabe.
    expect(lineas(a.composicion.porRegion)).toEqual({ Europa: 1530, "Norteamérica": 1530, "Sin clasificar": 1440 });
    expect(lineas(a.composicion.porSector)).toEqual({ "Tecnología": 3060, "Sin clasificar": 1440 });
    expect(lineas(a.composicion.porDivisa)).toEqual({ EUR: 10521.1 });
    expect(a.composicion.mayorPosicion).toBeCloseTo(5100 / 10521.1, 12);
  });

  it("compara con un índice de referencia en las mismas fechas", () => {
    // El índice pasa de 200 a 210: +5 %. La cartera, +5,211 %. Diferencia: +0,211 puntos.
    const conIndice = analizar(preparar(CARTERA, MERCADO, FICHAS, "2024-01-05"), TODO, { nombre: "Índice", serie: serie(["2023-12-29", 200], ["2024-01-05", 210]) });
    expect(conIndice.referencia?.disponible).toBe(true);
    expect(conIndice.referencia?.rentabilidad).toBeCloseTo(0.05, 12);
    expect(conIndice.referencia?.diferencia).toBeCloseTo(0.00211, 12);
    expect(conIndice.referencia?.serie[0]).toEqual({ fecha: "2023-12-31", valor: 100 });
    const sinHistoria = analizar(preparar(CARTERA, MERCADO, FICHAS, "2024-01-05"), TODO, { nombre: "Índice", serie: serie(["2024-01-03", 200]) });
    expect(sinHistoria.referencia?.disponible).toBe(false);
    expect(sinHistoria.referencia?.motivo).toBe("El índice no tiene datos desde el inicio del periodo.");
  });

  it("ofrece los periodos habituales y sabe cuáles tienen historia", () => {
    const periodos = periodosHabituales(a.valoracion, "2024-01-05");
    expect(periodos.map((p) => [p.id, p.periodo.desde, p.disponible])).toEqual([
      ["anio", "2023-12-31", true],
      ["1a", "2023-12-31", false], // no hay un año de historia
      ["3a", "2023-12-31", false],
      ["inicio", "2023-12-31", true]
    ]);
  });

  it("entre dos fechas intermedias mide solo ese tramo", () => {
    const tramo = analizar(preparar(CARTERA, MERCADO, FICHAS, "2024-01-05"), { desde: "2024-01-02", hasta: "2024-01-04" });
    // Del cierre del día 2 (10.190 €) al del día 4 (10.493,10 €), sin flujos: +303,10 €.
    expect(tramo.rentabilidad?.resultado).toBeCloseTo(303.1, 9);
    expect(tramo.fecha).toBe("2024-01-04");
    expect(tramo.patrimonio).toBeCloseTo(10493.1, 9);
    expect(tramo.cerradas[0].resultado).toBe(191);
    expect(tramo.ingresosYCostes.costesDelServicio).toBe(0); // la custodia es del día 5
  });
});

describe("integridad de los datos", () => {
  const extracto = (posiciones: Array<[string, string]>, saldo: string): ExtractoDeclarado => ({
    id: "e",
    fecha: "2024-01-05",
    posiciones: posiciones.map(([activoId, titulos]) => ({ activoId, nombre: activoId, titulos })),
    efectivo: [{ divisa: "EUR", saldo }]
  });

  it("concilia el libro con lo que declara el extracto", () => {
    expect(conciliar(CARTERA, extracto([["ACC", "60"], ["FON", "50"]], "3981.10")).cuadra).toBe(true);
    const mal = conciliar(CARTERA, extracto([["ACC", "60"], ["FON", "55"]], "4000"));
    expect(mal.cuadra).toBe(false);
    expect(mal.diferencias.map((dif) => [dif.clase, dif.concepto, dif.diferencia.toFixed(2)])).toEqual([
      ["titulos", "Activo FON", "-5.00"], //        el libro tiene 50 y el extracto dice 55
      ["efectivo", "Efectivo en EUR", "-18.90"] //  3.981,10 − 4.000
    ]);
  });

  it("señala lo que el libro tiene y el extracto no menciona", () => {
    const falta = conciliar(CARTERA, extracto([["FON", "50"]], "3981.10"));
    expect(falta.diferencias.map((dif) => [dif.concepto, dif.enElLibro.toFixed(), dif.enElExtracto.toFixed()])).toEqual([["Activo ACC", "60", "0"]]);
  });

  it("avisa de movimientos duplicados y de lo que ya está en el libro al importar", () => {
    const repetida = { ...MOVIMIENTOS[5], id: "k2" };
    expect(posiblesDuplicados([...MOVIMIENTOS, repetida]).map((grupo) => grupo.map((m) => m.id))).toEqual([["k", "k2"]]);
    expect([...yaEnElLibro([repetida, mov("comision", "2024-02-01", { id: "nueva", importe: "-12" })], MOVIMIENTOS)]).toEqual(["k2"]);
    const conDuplicado = analizar(preparar({ ...CARTERA, movimientos: [...MOVIMIENTOS, repetida] }, MERCADO, FICHAS, "2024-01-05"), TODO);
    expect(conDuplicado.integridad.avisos.filter((aviso) => aviso.codigo === "POSIBLE_DUPLICADO")).toHaveLength(1);
  });

  it("avisa del efectivo en negativo, de los precios que faltan y de una concentración", () => {
    const sinAportacion = analizar(preparar({ ...CARTERA, movimientos: MOVIMIENTOS.slice(1) }, MERCADO, FICHAS, "2024-01-05"), TODO);
    const negativo = sinAportacion.integridad.avisos.find((aviso) => aviso.codigo === "EFECTIVO_EN_NEGATIVO");
    expect(negativo?.fecha).toBe("2024-01-01");
    expect(negativo?.mensaje).toContain("−7.010,00 EUR"); // −2.010 − 5.000, con formato español (FMT-03)

    const sinPrecios = analizar(preparar(CARTERA, { precios: new Map(), cambios: new Map() }, FICHAS, "2024-01-20"), { desde: "2023-12-31", hasta: "2024-01-20" });
    const codigos = sinPrecios.integridad.avisos.map((aviso) => aviso.codigo);
    expect(codigos.filter((codigo) => codigo === "PRECIO_DE_OPERACION")).toHaveLength(2); // se valoran al último precio contratado

    expect(a.integridad.avisos.map((aviso) => aviso.codigo)).toEqual(["CONCENTRACION"]); // el fondo pesa el 48 %
    expect(a.integridad.errores).toBe(0);
  });
});
