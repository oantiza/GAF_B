/**
 * El libro: las dos cuentas a cualquier fecha y el coste FIFO.
 *
 * Cada cifra esperada sale de la cuenta a mano que lleva al lado. Si una prueba falla, lo
 * que hay que revisar es el motor, no la cifra.
 */
import { describe, expect, it } from "vitest";
import { construirLibro, cuentasA, extractoDeEfectivo, posicionesDe, titulosDe, type Libro } from "../../src/gestor/motor/libro";
import { activo, cartera, mov } from "./ayudas";

const efectivo = (libro: Libro, divisa = "EUR"): string => (libro.final.efectivo.get(divisa)?.toFixed(2) ?? "0.00");
const posicion = (libro: Libro, activoId: string) => posicionesDe(libro.final).find((p) => p.activoId === activoId);
const realizadoDe = (libro: Libro, movimientoId: string): string[] =>
  libro.realizados.filter((r) => r.movimientoId === movimientoId).map((r) => r.resultado.toFixed(2));

/* Una cartera en euros que usa los veinte tipos de movimiento. */
const ACTIVOS = [
  activo("ACC"),
  activo("ACC2"),
  activo("FON1", "FONDO"),
  activo("FON2", "FONDO"),
  activo("BON", "BONO", "EUR", { multiplicador: "0.01" })
];

const MOVIMIENTOS = [
  mov("aportacion", "2024-01-02", { id: "a1", importe: "10000" }),
  // 100 × 20 = 2.000 + 10 de comisión = 2.010
  mov("compra", "2024-01-03", { id: "c1", activoId: "ACC", titulos: "100", precio: "20", comision: "10", importe: "-2010" }),
  // 50 × 24 = 1.200 + 6 = 1.206
  mov("compra", "2024-02-01", { id: "c2", activoId: "ACC", titulos: "50", precio: "24", comision: "6", importe: "-1206" }),
  // 120 × 30 = 3.600 − 12 = 3.588
  mov("venta", "2024-03-01", { id: "v1", activoId: "ACC", titulos: "120", precio: "30", comision: "12", importe: "3588" }),
  // bruto 30, retención 5,70, neto 24,30
  mov("dividendo", "2024-03-15", { id: "d1", activoId: "ACC", importe: "24.30", retencion: "5.70" }),
  mov("suscripcion", "2024-04-01", { id: "s1", activoId: "FON1", titulos: "100", precio: "50", importe: "-5000" }),
  // 40 participaciones de FON1 a 55 = 2.200 → 25 participaciones de FON2
  mov("traspaso", "2024-05-01", { id: "t1", activoId: "FON1", titulos: "40", precio: "55", valor: "2200", destino: { activoId: "FON2", titulos: "25" } }),
  mov("split", "2024-06-01", { id: "sp1", activoId: "ACC", razon: "2" }),
  mov("comision", "2024-06-10", { id: "co1", importe: "-15" }),
  mov("interes", "2024-06-15", { id: "i1", importe: "3.21" }),
  mov("retirada", "2024-07-01", { id: "r1", importe: "-1000" }),
  // 10 × 60 = 600 brutos; retención 19; neto 581
  mov("reembolso", "2024-07-10", { id: "re1", activoId: "FON1", titulos: "10", precio: "60", retencion: "19", importe: "581" }),
  mov("aportacion", "2024-07-20", { id: "a2", importe: "10000" }),
  // nominal 10.000 al 98,5 % = 9.850 + 120 de cupón corrido + 25 de comisión = 9.995
  mov("compra", "2024-08-01", { id: "c3", activoId: "BON", titulos: "10000", precio: "98.5", cuponCorrido: "120", comision: "25", importe: "-9995" }),
  // bruto 350, retención 66,50, neto 283,50
  mov("cupon", "2024-09-01", { id: "cu1", activoId: "BON", importe: "283.50", retencion: "66.50" }),
  // 40 títulos con coste de 9 cada uno = 360
  mov("entradaDeTitulos", "2024-10-01", { id: "e1", activoId: "ACC", titulos: "40", precio: "9" }),
  mov("dividendoEnAcciones", "2024-10-15", { id: "da1", activoId: "ACC", titulos: "5" }),
  mov("salidaDeTitulos", "2024-11-01", { id: "sa1", activoId: "ACC", titulos: "70" }),
  mov("retencion", "2024-11-15", { id: "rt1", importe: "-8.40" }),
  mov("otroEfectivo", "2024-11-20", { id: "o1", importe: "2" }),
  mov("amortizacion", "2024-12-01", { id: "am1", activoId: "BON", titulos: "10000", importe: "10000" }),
  mov("canje", "2024-12-10", { id: "ca1", activoId: "ACC", titulos: "35", destino: { activoId: "ACC2", titulos: "7" } })
];

const CARTERA = cartera(ACTIVOS, MOVIMIENTOS);

describe("la cuenta de efectivo", () => {
  it("lleva el saldo de cada apunte, uno por uno", () => {
    const libro = construirLibro(CARTERA);
    expect(libro.avisos).toEqual([]);
    const saldos = Object.fromEntries(extractoDeEfectivo(libro, "EUR").map((linea) => [linea.movimiento.id, linea.saldo.toFixed(2)]));
    expect(saldos).toEqual({
      a1: "10000.00",
      c1: "7990.00", //   10.000 − 2.010
      c2: "6784.00", //    7.990 − 1.206
      v1: "10372.00", //   6.784 + 3.588
      d1: "10396.30", //  10.372 + 24,30
      s1: "5396.30", //   10.396,30 − 5.000
      co1: "5381.30", //   5.396,30 − 15      (el traspaso y el split no tocan el efectivo)
      i1: "5384.51", //    5.381,30 + 3,21
      r1: "4384.51", //    5.384,51 − 1.000
      re1: "4965.51", //   4.384,51 + 581
      a2: "14965.51", //   4.965,51 + 10.000
      c3: "4970.51", //   14.965,51 − 9.995
      cu1: "5254.01", //   4.970,51 + 283,50
      rt1: "5245.61", //   5.254,01 − 8,40    (entrada, scrip y salida de títulos no tocan el efectivo)
      o1: "5247.61", //    5.245,61 + 2
      am1: "15247.61" //   5.247,61 + 10.000
    });
    expect(efectivo(libro)).toBe("15247.61");
  });

  it("se puede consultar a cualquier fecha", () => {
    expect(efectivo(cuentasA(CARTERA, "2024-01-01"))).toBe("0.00");
    expect(efectivo(cuentasA(CARTERA, "2024-03-01"))).toBe("10372.00");
    expect(efectivo(cuentasA(CARTERA, "2024-06-30"))).toBe("5384.51");
    expect(efectivo(cuentasA(CARTERA, "2030-01-01"))).toBe("15247.61");
  });

  it("distingue la fecha de operación de la fecha valor", () => {
    const conLiquidacion = cartera([activo("ACC")], [
      mov("aportacion", "2024-01-02", { importe: "10000" }),
      mov("compra", "2024-01-03", { activoId: "ACC", titulos: "100", importe: "-2010", fechaValor: "2024-01-05" })
    ]);
    // El día 4 la compra está contratada pero no liquidada.
    expect(efectivo(cuentasA(conLiquidacion, "2024-01-04"))).toBe("7990.00");
    expect(efectivo(cuentasA(conLiquidacion, "2024-01-04", { criterio: "valor" }))).toBe("10000.00");
    expect(efectivo(cuentasA(conLiquidacion, "2024-01-05", { criterio: "valor" }))).toBe("7990.00");
  });
});

describe("la cuenta de valores y el coste FIFO", () => {
  it("una venta consume primero los títulos más antiguos", () => {
    const libro = cuentasA(CARTERA, "2024-03-01");
    // Se venden 120: los 100 del primer lote (coste 2.010) y 20 de los 50 del segundo (1.206 × 20/50 = 482,40).
    // Lo cobrado, 3.588, se reparte por títulos: 3.588 × 100/120 = 2.990 y 3.588 × 20/120 = 598.
    // Resultados: 2.990 − 2.010 = 980 y 598 − 482,40 = 115,60.
    expect(realizadoDe(libro, "v1")).toEqual(["980.00", "115.60"]);
    // Quedan 30 títulos del segundo lote, con coste 1.206 − 482,40 = 723,60.
    expect(titulosDe(libro.final, "ACC").toFixed()).toBe("30");
    expect(posicion(libro, "ACC")?.costeBase.toFixed(2)).toBe("723.60");
    expect(posicion(libro, "ACC")?.desde).toBe("2024-02-01");
  });

  it("un traspaso entre fondos mueve el dinero sin tocar el efectivo y realiza el resultado del origen", () => {
    const libro = cuentasA(CARTERA, "2024-05-01");
    // Salen 40 participaciones de FON1 que costaron 40 × 50 = 2.000 y valen 2.200: resultado 200.
    expect(realizadoDe(libro, "t1")).toEqual(["200.00"]);
    expect(titulosDe(libro.final, "FON1").toFixed()).toBe("60");
    expect(posicion(libro, "FON1")?.costeBase.toFixed(2)).toBe("3000.00");
    // Entran 25 participaciones de FON2 con coste 2.200.
    expect(titulosDe(libro.final, "FON2").toFixed()).toBe("25");
    expect(posicion(libro, "FON2")?.costeBase.toFixed(2)).toBe("2200.00");
    expect(efectivo(libro)).toBe("5396.30");
  });

  it("un split cambia los títulos y no el coste", () => {
    const libro = cuentasA(CARTERA, "2024-06-01");
    expect(titulosDe(libro.final, "ACC").toFixed()).toBe("60"); // 30 × 2
    expect(posicion(libro, "ACC")?.costeBase.toFixed(2)).toBe("723.60");
  });

  it("un reembolso con retención cobra el neto y realiza sobre el bruto", () => {
    const libro = cuentasA(CARTERA, "2024-07-10");
    // 10 participaciones que costaron 500 y valen 600 brutos: resultado 100. La retención (19) es un impuesto aparte.
    expect(realizadoDe(libro, "re1")).toEqual(["100.00"]);
    expect(posicion(libro, "FON1")?.costeBase.toFixed(2)).toBe("2500.00");
    const impuestos = libro.apuntes.filter((a) => a.efecto.clase === "coste" && a.efecto.categoria === "impuesto" && a.movimiento.id === "re1");
    expect(impuestos.map((a) => (a.efecto.clase === "coste" ? a.efecto.importe.toFixed(2) : ""))).toEqual(["19.00"]);
  });

  it("un bono lleva su nominal y su coste con cupón corrido y comisión", () => {
    const libro = cuentasA(CARTERA, "2024-08-01");
    expect(titulosDe(libro.final, "BON").toFixed()).toBe("10000");
    expect(posicion(libro, "BON")?.costeBase.toFixed(2)).toBe("9995.00");
  });

  it("entrada, dividendo en acciones y salida de títulos", () => {
    const antes = cuentasA(CARTERA, "2024-10-15");
    // 60 (tras el split) + 40 de la entrada + 5 liberadas = 105; coste 723,60 + 360 + 0.
    expect(titulosDe(antes.final, "ACC").toFixed()).toBe("105");
    expect(posicion(antes, "ACC")?.costeBase.toFixed(2)).toBe("1083.60");
    const despues = cuentasA(CARTERA, "2024-11-01");
    // Salen 70 por antigüedad: los 60 del lote de febrero y 10 de los 40 de la entrada (coste 90).
    // Quedan 30 de la entrada (coste 270) y las 5 liberadas (coste 0). Una salida de títulos no realiza resultado.
    expect(titulosDe(despues.final, "ACC").toFixed()).toBe("35");
    expect(posicion(despues, "ACC")?.costeBase.toFixed(2)).toBe("270.00");
    expect(realizadoDe(despues, "sa1")).toEqual([]);
  });

  it("la amortización de un bono cierra la posición con su resultado", () => {
    const libro = cuentasA(CARTERA, "2024-12-01");
    expect(realizadoDe(libro, "am1")).toEqual(["5.00"]); // 10.000 − 9.995
    expect(posicion(libro, "BON")).toBeUndefined();
  });

  it("un canje pasa los lotes al activo nuevo con su coste y su fecha", () => {
    const libro = construirLibro(CARTERA);
    expect(posicion(libro, "ACC")).toBeUndefined();
    const nueva = posicion(libro, "ACC2");
    // 35 títulos → 7: el lote de 30 pasa a 6 y el de 5 a 1. El coste (270 y 0) y las fechas no cambian.
    expect(nueva?.titulos.toFixed()).toBe("7");
    expect(nueva?.costeBase.toFixed(2)).toBe("270.00");
    expect(nueva?.lotes.map((lote) => [lote.fecha, lote.titulos.toFixed(), lote.costeBase.toFixed(2)])).toEqual([
      ["2024-10-01", "6", "270.00"],
      ["2024-10-15", "1", "0.00"]
    ]);
  });

  it("el estado final cuadra con la suma de todo", () => {
    const libro = construirLibro(CARTERA);
    expect(posicionesDe(libro.final).map((p) => [p.activoId, p.titulos.toFixed(), p.costeBase.toFixed(2)]).sort()).toEqual([
      ["ACC2", "7", "270.00"],
      ["FON1", "50", "2500.00"],
      ["FON2", "25", "2200.00"]
    ]);
    // Resultado realizado total: 980 + 115,60 + 200 + 100 + 5 = 1.400,60.
    const total = libro.realizados.reduce((suma, r) => suma.plus(r.resultado), libro.realizados[0].resultado.minus(libro.realizados[0].resultado));
    expect(total.toFixed(2)).toBe("1400.60");
    expect(libro.realizados.every((r) => !r.incompleto)).toBe(true);
  });
});

describe("varias divisas", () => {
  const usa = activo("USA", "ACCION", "USD");
  const movimientos = [
    mov("aportacion", "2024-01-02", { id: "a", importe: "10000" }),
    // 10 × 100 USD = 1.000 USD al cambio 1,25 = 800 EUR + 5 EUR de comisión = 805 EUR
    mov("compra", "2024-01-03", { id: "c1", activoId: "USA", titulos: "10", precio: "100", cambio: "1.25", comision: "5", importe: "-805" }),
    // 1.250 EUR → 1.500 USD
    mov("cambioDeDivisa", "2024-02-01", { id: "fx", importe: "-1250", destino: { divisa: "USD", importe: "1500" } }),
    // 5 × 120 USD = 600 USD desde la cuenta en dólares, al cambio 1,20 = 500 EUR de coste
    mov("compra", "2024-02-05", { id: "c2", activoId: "USA", titulos: "5", precio: "120", divisa: "USD", cambio: "1.20", importe: "-600" }),
    // 12 × 150 USD = 1.800 USD al cambio 1,25 = 1.440 EUR
    mov("venta", "2024-03-01", { id: "v", activoId: "USA", titulos: "12", precio: "150", cambio: "1.25", importe: "1440" })
  ];

  it("lleva un saldo por divisa y el coste en la divisa base con el cambio de cada operación", () => {
    const libro = construirLibro(cartera([usa], movimientos));
    expect(libro.avisos).toEqual([]);
    expect(efectivo(libro, "EUR")).toBe("9385.00"); // 10.000 − 805 − 1.250 + 1.440
    expect(efectivo(libro, "USD")).toBe("900.00"); //  1.500 − 600
    // FIFO: los 10 del primer lote (805 EUR) y 2 de los 5 del segundo (500 × 2/5 = 200 EUR).
    // Cobrado 1.440 EUR: 1.200 y 240. Resultados: 395 y 40.
    expect(realizadoDe(libro, "v")).toEqual(["395.00", "40.00"]);
    const queda = posicion(libro, "USA");
    expect(queda?.titulos.toFixed()).toBe("3");
    expect(queda?.costeBase.toFixed(2)).toBe("300.00"); // 500 − 200
    expect(queda?.costeLocal?.toFixed(2)).toBe("360.00"); // 600 USD × 3/5
  });

  it("el coste en la divisa del activo de una compra pagada en euros sale del cambio de la operación", () => {
    const libro = cuentasA(cartera([usa], movimientos), "2024-01-03");
    expect(posicion(libro, "USA")?.costeLocal?.toFixed(2)).toBe("1006.25"); // 805 EUR × 1,25
  });

  it("sin cambio propio usa el de mercado, y sin ninguno lo dice en vez de inventarlo", () => {
    const sinCambio = cartera([usa], [
      mov("aportacion", "2024-01-02", { importe: "1000", divisa: "USD" }),
      mov("compra", "2024-01-03", { id: "c", activoId: "USA", titulos: "5", precio: "120", divisa: "USD", importe: "-600" })
    ]);
    const conMercado = construirLibro(sinCambio, { cambio: (divisa) => (divisa === "USD" ? 1.2 : undefined) });
    expect(conMercado.avisos).toEqual([]);
    expect(posicion(conMercado, "USA")?.costeBase.toFixed(2)).toBe("500.00"); // 600 / 1,20
    const sinNada = construirLibro(sinCambio);
    expect(sinNada.avisos.map((aviso) => aviso.codigo)).toEqual(["FALTA_EL_CAMBIO"]);
    expect(posicion(sinNada, "USA")?.costeIncompleto).toBe(true);
  });
});

describe("casos límite", () => {
  it("un traspaso que tarda unos días deja el dinero en tránsito, no lo pierde", () => {
    const fondos = [activo("FON1", "FONDO"), activo("FON2", "FONDO")];
    const c = cartera(fondos, [
      mov("entradaDeTitulos", "2024-01-02", { activoId: "FON1", titulos: "40", precio: "50" }),
      mov("traspaso", "2024-05-01", { activoId: "FON1", titulos: "40", valor: "2200", destino: { activoId: "FON2", titulos: "25", fecha: "2024-05-06" } })
    ]);
    const enCurso = cuentasA(c, "2024-05-03");
    expect(titulosDe(enCurso.final, "FON1").toFixed()).toBe("0");
    expect(titulosDe(enCurso.final, "FON2").toFixed()).toBe("0");
    expect(enCurso.final.transito.get("EUR")?.toFixed(2)).toBe("2200.00");
    expect(efectivo(enCurso)).toBe("0.00"); // no pasa por la cuenta del banco
    const llegado = cuentasA(c, "2024-05-06");
    expect(titulosDe(llegado.final, "FON2").toFixed()).toBe("25");
    expect(llegado.final.transito.get("EUR")?.toFixed(2)).toBe("0.00");
  });

  it("vender más títulos de los que hay se avisa y no deja la posición en negativo", () => {
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2024-01-02", { importe: "1000" }),
      mov("compra", "2024-01-03", { activoId: "ACC", titulos: "4", importe: "-400" }),
      mov("venta", "2024-02-01", { id: "v", activoId: "ACC", titulos: "10", importe: "1500" })
    ]);
    const libro = construirLibro(c);
    expect(libro.avisos.map((aviso) => aviso.codigo)).toEqual(["DESCUBIERTO_DE_TITULOS"]);
    expect(titulosDe(libro.final, "ACC").toFixed()).toBe("0");
    // Los 4 que había: cobran 1.500 × 4/10 = 600 y costaron 400. De los otros 6 no se conoce el coste.
    expect(libro.realizados.map((r) => [r.titulos.toFixed(), r.resultado.toFixed(2), r.incompleto])).toEqual([
      ["4", "200.00", false],
      ["6", "900.00", true]
    ]);
  });

  it("un movimiento que no es válido no se aplica y se dice cuál", () => {
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2024-01-02", { importe: "1000" }),
      mov("compra", "2024-01-03", { id: "mala", activoId: "ACC", titulos: "4", importe: "400" }),
      mov("inventado", "2024-01-04", { id: "rara" })
    ]);
    const libro = construirLibro(c);
    expect(libro.avisos.map((aviso) => [aviso.movimientoId, aviso.codigo])).toEqual([
      ["mala", "MOVIMIENTO_NO_VALIDO"],
      ["rara", "TIPO_DESCONOCIDO"]
    ]);
    expect(efectivo(libro)).toBe("1000.00");
  });

  it("dentro de un día, lo que entra se aplica antes que lo que sale, sea cual sea el orden de alta", () => {
    const c = cartera([activo("ACC")], [
      mov("venta", "2024-01-03", { id: "v", activoId: "ACC", titulos: "4", importe: "440" }),
      mov("compra", "2024-01-03", { id: "c", activoId: "ACC", titulos: "4", importe: "-400" }),
      mov("aportacion", "2024-01-03", { importe: "1000" })
    ]);
    // Se dieron de alta al revés (venta, compra, aportación) y aun así el día se aplica como aportación, compra, venta.
    const libro = construirLibro(c);
    expect(libro.avisos).toEqual([]);
    expect(titulosDe(libro.final, "ACC").toFixed()).toBe("0");
    expect(realizadoDe(libro, "v")).toEqual(["40.00"]); // 440 − 400
    expect(efectivo(libro)).toBe("1040.00");
  });

  it("los decimales no arrastran errores de coma flotante", () => {
    const c = cartera([], Array.from({ length: 10 }, (_, i) => mov("aportacion", "2024-01-02", { id: `p${i}`, importe: "0.1" })));
    expect(construirLibro(c).final.efectivo.get("EUR")?.toFixed()).toBe("1"); // en coma flotante, 0,1 × 10 = 0,9999999999999999
  });
});
