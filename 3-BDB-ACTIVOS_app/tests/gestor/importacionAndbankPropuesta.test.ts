/**
 * De los extractos de Andbank a movimientos propuestos para el libro. Los extractos son
 * sintéticos (`andbankDeMuestra.ts`) y cada cifra esperada sale de una cuenta a mano escrita
 * junto a ella, nunca de la salida del importador.
 */
import { describe, expect, it } from "vitest";
import { importadorDeAndbank } from "../../src/gestor/importacion/andbank";
import type { ActivoCitado, MovimientoPropuesto, ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import { construirLibro, contextoDe, validarMovimiento } from "../../src/gestor/motor/libro";
import { carteraVacia, type Activo } from "../../src/gestor/motor/modelo";
import {
  ISIN_BOLSA,
  ISIN_DERECHOS,
  ISIN_ELECTRICA,
  ISIN_MIXTO,
  ISIN_TECNOLOGIA,
  MOVIMIENTOS_COMPLETOS,
  OPERACIONES_COMPLETAS,
  POSICIONES_COMPLETAS,
  documento,
  filaDeMovimiento,
  filaDeOperacion,
  tablaDeMovimientos,
  tablaDeOperaciones
} from "./andbankDeMuestra";

const BASE = { divisaBase: "EUR" };

function importar(documentos: Array<[nombre: string, html: string, tipo: string]>): ResultadoDeImportacion {
  return importadorDeAndbank.importar(documentos.map(([nombre, html, tipo]) => ({ documento: documento(nombre, html), tipo })), BASE);
}

function completo(): ResultadoDeImportacion {
  return importar([
    ["mov.xls", MOVIMIENTOS_COMPLETOS, "movimientos"],
    ["pos.xls", POSICIONES_COMPLETAS, "posiciones"],
    ["ops.xls", OPERACIONES_COMPLETAS, "operaciones"]
  ]);
}

/** Lo que se comprueba de cada movimiento propuesto. */
function resumen(propuesto: MovimientoPropuesto) {
  const { movimiento } = propuesto;
  return {
    id: movimiento.id,
    tipo: movimiento.tipo,
    fecha: movimiento.fechaOperacion,
    importe: movimiento.importe,
    activo: movimiento.activoId,
    titulos: movimiento.titulos,
    precio: movimiento.precio,
    revisar: propuesto.requiereRevision
  };
}

/** Una cartera con todos los activos citados, con `id` = `clave`. */
function carteraCon(movimientos: MovimientoPropuesto[]) {
  const activos = new Map<string, Activo>();
  const anadir = (citado: ActivoCitado | undefined) => {
    if (!citado || activos.has(citado.clave)) return;
    activos.set(citado.clave, { id: citado.clave, nombre: citado.nombre, tipo: citado.tipo ?? "OTRO", divisa: citado.divisa ?? "EUR", isin: citado.isin, origen: "manual" });
  };
  for (const propuesto of movimientos) {
    anadir(propuesto.activo);
    anadir(propuesto.destino);
  }
  return { ...carteraVacia({ nombre: "Prueba", ahora: "2026-01-01T00:00:00.000Z", id: "prueba" }), activos: [...activos.values()] };
}

describe("la propuesta de un juego completo de tres documentos", () => {
  const resultado = completo();

  it("no da errores y reconoce los tres documentos con sus filas", () => {
    expect(resultado.errores).toEqual([]);
    expect(resultado.documentos).toEqual([
      { nombre: "mov.xls", tipo: "movimientos", etiqueta: "Movimientos de la cuenta de efectivo", filas: 13 },
      { nombre: "pos.xls", tipo: "posiciones", etiqueta: "Posiciones de la cuenta de valores", filas: 4 },
      { nombre: "ops.xls", tipo: "operaciones", etiqueta: "Operaciones de valores", filas: 12 }
    ]);
  });

  it("propone un movimiento por fila de efectivo, más el traspaso y la salida sin pareja, en orden de fecha", () => {
    expect(resultado.movimientos.map(resumen)).toEqual([
      // La apertura de importe cero (mov-1) se descarta.
      { id: "andbank-mov-2", tipo: "aportacion", fecha: "2025-01-02", importe: "50000", activo: undefined, titulos: undefined, precio: undefined, revisar: false },
      // 100 × 12,3456 = 1.234,56: casa al céntimo con la operación 1.
      { id: "andbank-mov-3", tipo: "compra", fecha: "2025-01-10", importe: "-1234.56", activo: ISIN_ELECTRICA, titulos: "100", precio: "12.3456", revisar: false },
      // En dólares casa por los títulos (10 = 10).
      { id: "andbank-mov-4", tipo: "compra", fecha: "2025-01-15", importe: "-1800", activo: ISIN_TECNOLOGIA, titulos: "10", precio: "198", revisar: false },
      // El concepto dice «@ 40» (cortado a 30 caracteres); la operación, 400.
      { id: "andbank-mov-5", tipo: "suscripcion", fecha: "2025-01-20", importe: "-4000", activo: ISIN_MIXTO, titulos: "400", precio: "10", revisar: false },
      { id: "andbank-mov-6", tipo: "dividendo", fecha: "2025-03-03", importe: "45.6", activo: ISIN_ELECTRICA, titulos: undefined, precio: undefined, revisar: false },
      { id: "andbank-mov-7", tipo: "comision", fecha: "2025-03-31", importe: "-30.25", activo: undefined, titulos: undefined, precio: undefined, revisar: false },
      { id: "andbank-mov-8", tipo: "interes", fecha: "2025-03-31", importe: "12.1", activo: undefined, titulos: undefined, precio: undefined, revisar: false },
      { id: "andbank-mov-9", tipo: "venta", fecha: "2025-05-15", importe: "700", activo: ISIN_ELECTRICA, titulos: "50", precio: "14", revisar: false },
      // Los 50 derechos asignados entran sin coste (operación 6).
      { id: "andbank-op-6", tipo: "dividendoEnAcciones", fecha: "2025-06-10", importe: undefined, activo: ISIN_DERECHOS, titulos: "50", precio: undefined, revisar: false },
      // «@ 10» cortado; la operación, 100 × 10,50 = 1.050.
      { id: "andbank-mov-10", tipo: "reembolso", fecha: "2025-06-20", importe: "1050", activo: ISIN_MIXTO, titulos: "100", precio: "10.5", revisar: false },
      // Y salen al ejercerse (operación 12): 50 − 50 = 0.
      { id: "andbank-op-12", tipo: "extincionDeTitulos", fecha: "2025-06-20", importe: undefined, activo: ISIN_DERECHOS, titulos: "50", precio: undefined, revisar: false },
      { id: "andbank-mov-11", tipo: "retirada", fecha: "2025-07-01", importe: "-2000", activo: undefined, titulos: undefined, precio: undefined, revisar: false },
      // La «compra» de 3,64 € es el cargo de 4 USD del ADR: 3,64 / 4 = 0,91, dentro de [0,2; 5].
      { id: "andbank-mov-12", tipo: "comision", fecha: "2025-07-10", importe: "-3.64", activo: ISIN_TECNOLOGIA, titulos: undefined, precio: undefined, revisar: false },
      // 150 × 10,60 = 1.590 salen el 1 de agosto y entran el 3.
      { id: "andbank-op-9", tipo: "traspaso", fecha: "2025-08-01", importe: undefined, activo: ISIN_MIXTO, titulos: "150", precio: "10.6", revisar: false },
      // 50 × 10,80 = 540 salen sin ninguna entrada que case.
      { id: "andbank-op-11", tipo: "salidaDeTitulos", fecha: "2025-09-05", importe: undefined, activo: ISIN_MIXTO, titulos: "50", precio: undefined, revisar: true },
      // Sin operación: lo identifica el extracto de posiciones por el nombre.
      { id: "andbank-mov-13", tipo: "dividendo", fecha: "2025-09-15", importe: "8.5", activo: ISIN_TECNOLOGIA, titulos: undefined, precio: undefined, revisar: false }
    ]);
  });

  const porId = (id: string) => resultado.movimientos.find((propuesto) => propuesto.movimiento.id === id)!;

  it("la compra en dólares lleva el cambio: 10 × 198 USD / 1.800 € = 1,1 USD por euro", () => {
    expect(porId("andbank-mov-4").movimiento.cambio).toBe("1.1");
    expect(porId("andbank-mov-4").activo).toEqual({ clave: ISIN_TECNOLOGIA, isin: ISIN_TECNOLOGIA, nombre: "TECNOLOGIA AMERICANA INC", divisa: "USD", tipo: "ACCION" });
    expect(porId("andbank-mov-3").movimiento.cambio).toBeUndefined();
  });

  it("el traspaso lleva el destino con su llegada dos días después", () => {
    const { movimiento, destino } = porId("andbank-op-9");
    expect(movimiento.valor).toBe("1590");
    expect(movimiento.destino).toEqual({ activoId: ISIN_BOLSA, titulos: "100", precio: "15.9", fecha: "2025-08-03" });
    expect(destino).toMatchObject({ clave: ISIN_BOLSA, tipo: "FONDO" });
  });

  it("cada movimiento lleva su origen en el extracto", () => {
    const compra = porId("andbank-mov-3");
    // Cabecera (1), Saldo Inicio (2), apertura (3), transferencia (4), compra (5).
    expect(compra).toMatchObject({ documento: "mov.xls", fila: 5 });
    expect(compra.movimiento.origen).toEqual({ via: "importado", documento: "mov.xls", fila: 5, textoOriginal: compra.textoOriginal });
    expect(compra.movimiento.fechaValor).toBe("2025-01-14");
    expect(compra.textoOriginal).toContain("ELECTRICA DEL SUR @ 100");
  });

  it("avisa de lo que no se ha convertido y de las líneas que hay que mirar", () => {
    // El alta de derechos ya se importa (entrada de títulos sin coste): no se manda darla de alta a mano.
    expect(resultado.avisos).toEqual(["Se ha descartado 1 apunte de importe cero del extracto de movimientos."]);
    expect(porId("andbank-op-11").avisos[0]).toContain("Traspaso de salida sin su entrada");
    expect(porId("andbank-mov-12").avisos[0]).toContain("cargo de gastos de mercado");
    // Los títulos cortados se confirmaron con la operación: no hay aviso.
    expect(porId("andbank-mov-5").avisos).toEqual([]);
  });

  /*
   * GES-10: el extracto va a la fecha de cotización más reciente, y cada posición lleva la suya: aquí, tres del 29 y una del 30.
   * A-205: y su precio de mercado en la divisa del activo, la columna «Precio de mercado» con la de «Div»: Tecnología, 210 $
   * (10 × 210 = 2.100 $ de valor de mercado), y no 1.800 € / 10 = 180 € pasados a dólares con un cambio que no es el del banco.
   */
  it("declara las posiciones a la fecha de cotización más reciente y el saldo de efectivo al último movimiento", () => {
    expect(resultado.extractos).toEqual([
      {
        fecha: "2025-09-30",
        documento: "pos.xls",
        posiciones: [
          { activo: { clave: ISIN_ELECTRICA, isin: ISIN_ELECTRICA, nombre: "ELECTRICA DEL SUR SA", divisa: "EUR", tipo: "ACCION" }, titulos: "50", valor: "750", fecha: "2025-09-29", precio: "15", divisa: "EUR" },
          { activo: { clave: ISIN_TECNOLOGIA, isin: ISIN_TECNOLOGIA, nombre: "TECNOLOGIA AMERICANA INC", divisa: "USD", tipo: "ACCION" }, titulos: "10", valor: "1800", fecha: "2025-09-29", precio: "210", divisa: "USD" },
          { activo: { clave: ISIN_MIXTO, isin: ISIN_MIXTO, nombre: "FONDO MIXTO PRUDENTE EURO", divisa: "EUR", tipo: "FONDO" }, titulos: "100", valor: "1090", fecha: "2025-09-30", precio: "10.9", divisa: "EUR" },
          { activo: { clave: ISIN_BOLSA, isin: ISIN_BOLSA, nombre: "FONDO BOLSA GLOBAL", divisa: "EUR", tipo: "FONDO" }, titulos: "100", valor: "1620", fecha: "2025-09-29", precio: "16.2", divisa: "EUR" }
        ],
        efectivo: []
      },
      { fecha: "2025-09-15", documento: "mov.xls", posiciones: [], efectivo: [{ divisa: "EUR", saldo: "42747.75" }] }
    ]);
  });

  it("todo movimiento sin revisión es válido para el motor, y aplicados dan el último saldo del extracto", () => {
    const cartera = carteraCon(resultado.movimientos);
    const contexto = contextoDe(cartera);
    const validos = resultado.movimientos.filter((propuesto) => !propuesto.requiereRevision);
    // 12 filas del efectivo + el traspaso + el alta y el ejercicio de los derechos.
    expect(validos.length).toBe(15);
    for (const propuesto of validos) expect([propuesto.movimiento.id, validarMovimiento(propuesto.movimiento, contexto)]).toEqual([propuesto.movimiento.id, []]);
    const libro = construirLibro({ ...cartera, movimientos: validos.map((propuesto) => propuesto.movimiento) });
    // 50.000 − 1.234,56 − 1.800 − 4.000 + 45,60 − 30,25 + 12,10 + 700 + 1.050 − 2.000 − 3,64 + 8,50 = 42.747,75.
    expect(libro.final.efectivo.get("EUR")?.toFixed(2)).toBe("42747.75");
    // Mixto: 400 − 100 − 150 = 150 (la salida sin pareja está por revisar). Bolsa: 100.
    const titulosDe = (id: string) => (libro.final.lotes.get(id) ?? []).reduce((suma, lote) => suma + Number(lote.titulos.toFixed()), 0);
    expect([titulosDe(ISIN_MIXTO), titulosDe(ISIN_BOLSA), titulosDe(ISIN_ELECTRICA), titulosDe(ISIN_TECNOLOGIA)]).toEqual([150, 100, 50, 10]);
  });
});

describe("casos que la propuesta no da por buenos sin mirar", () => {
  it("un extracto que empieza con saldo se anota como saldo inicial, por revisar", () => {
    const resultado = importar([["mov.xls", tablaDeMovimientos("9.000,00", "27/04/2022", [
      filaDeMovimiento("28/04/2022", "TRANSFERENCIA", "EFECTIVO", "+1.000,00", "10.000,00") // 9.000 + 1.000
    ], "10.000,00"), "movimientos"]]);
    expect(resultado.errores).toEqual([]);
    expect(resultado.movimientos.map(resumen)[0]).toEqual({ id: "andbank-mov-0", tipo: "aportacion", fecha: "2022-04-27", importe: "9000", activo: undefined, titulos: undefined, precio: undefined, revisar: true });
    expect(resultado.movimientos[0].avisos).toEqual(["El extracto empieza con un saldo de 9.000,00 €: se ha anotado como saldo inicial. Si tienes los movimientos anteriores, impórtalos también."]);
    expect(resultado.movimientos[0].fila).toBe(2);

    const negativo = importar([["mov.xls", tablaDeMovimientos("-50,00", "27/04/2022", [
      filaDeMovimiento("28/04/2022", "TRANSFERENCIA", "EFECTIVO", "+100,00", "50,00") // −50 + 100
    ], "50,00"), "movimientos"]]);
    expect(resumen(negativo.movimientos[0])).toMatchObject({ tipo: "retirada", importe: "-50", revisar: true });
  });

  it("una compra con importe positivo es otro abono por revisar, y un activo solo por su nombre también", () => {
    const resultado = importar([["mov.xls", tablaDeMovimientos("0,00", "01/01/2025", [
      filaDeMovimiento("02/01/2025", "TRANSFERENCIA", "EFECTIVO", "+500,00", "500,00"),
      filaDeMovimiento("03/01/2025", "ANULACION COMPRA", "ACCION CUALQUIERA @ 5", "+50,00", "550,00"), // 500 + 50
      filaDeMovimiento("04/01/2025", "COMPRA RV CONTADO", "ACCION CUALQUIERA @ 5", "-50,00", "500,00"), // 550 − 50
      filaDeMovimiento("05/01/2025", "COMPRA RV CONTADO", "ACCION CON NOMBRE MUY LARGO @ 2", "-20,00", "480,00") // 500 − 20; 31 caracteres
    ], "480,00"), "movimientos"]]);
    const [, anulacion, compra, cortada] = resultado.movimientos;
    expect(resumen(anulacion)).toMatchObject({ tipo: "otroEfectivo", importe: "50", revisar: true });
    expect(anulacion.avisos[0]).toContain("puede ser una anulación");
    expect(resumen(compra)).toMatchObject({ tipo: "compra", activo: "ACCION CUALQUIERA", titulos: "5", revisar: true });
    expect(compra.activo).toEqual({ clave: "ACCION CUALQUIERA", nombre: "ACCION CUALQUIERA", tipo: "ACCION" });
    expect(cortada.avisos).toContain("El banco corta el concepto a 30 caracteres: comprueba el número de títulos.");
  });

  it("sin extracto de efectivo, las operaciones se proponen con su importe en euros; en otra divisa, sin importe", () => {
    const resultado = importar([["ops.xls", tablaDeOperaciones([
      filaDeOperacion("2025-03-16", "2025-03-17", "COMPRA", "ES0000000092", "ELECTRICA DEL NORTE", "200", "EUR", "9.662", "1932.40"), // 200 × 9,662 = 1.932,40
      filaDeOperacion("2025-10-15", "2025-10-17", "COMPRA", "IE0000000031", "BATERIAS ETF", "600", "USD", "7.35", "4410.00") // 600 × 7,35 = 4.410 USD
    ]), "operaciones"]]);
    expect(resultado.movimientos.map(resumen)).toEqual([
      { id: "andbank-op-1", tipo: "compra", fecha: "2025-03-16", importe: "-1932.4", activo: "ES0000000092", titulos: "200", precio: "9.662", revisar: false },
      { id: "andbank-op-2", tipo: "compra", fecha: "2025-10-15", importe: undefined, activo: "IE0000000031", titulos: "600", precio: "7.35", revisar: true }
    ]);
    expect(resultado.movimientos[1].avisos).toEqual(["Falta el importe en euros: complétalo antes de importar."]);
  });

  it("con extracto de efectivo, una operación sin apunte se marca dentro del periodo y se avisa fuera de él", () => {
    const resultado = importar([
      ["mov.xls", tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA", "EFECTIVO", "+5.000,00", "5.000,00"),
        filaDeMovimiento("31/03/2025", "LIQUIDACION INTERESES", "INTERESES", "+1,00", "5.001,00")
      ], "5.001,00"), "movimientos"],
      ["ops.xls", tablaDeOperaciones([
        filaDeOperacion("2025-02-15", "2025-02-17", "COMPRA", "ES0000000092", "ELECTRICA DEL NORTE", "10", "EUR", "10.00", "100.00"),
        filaDeOperacion("2025-05-10", "2025-05-12", "COMPRA", "ES0000000092", "ELECTRICA DEL NORTE", "5", "EUR", "10.00", "50.00")
      ]), "operaciones"]
    ]);
    const dentro = resultado.movimientos.find((propuesto) => propuesto.movimiento.id === "andbank-op-1")!;
    expect(resumen(dentro)).toMatchObject({ tipo: "compra", importe: "-100", revisar: true });
    expect(dentro.avisos).toEqual(["No se ha encontrado su apunte en la cuenta de efectivo."]);
    expect(resultado.movimientos.some((propuesto) => propuesto.movimiento.id === "andbank-op-2")).toBe(false);
    expect(resultado.avisos).toEqual(["Operación posterior al extracto de efectivo, no importada: 10/05/2025, COMPRA de ELECTRICA DEL NORTE (ES0000000092), 5 títulos."]);
  });
});

describe("operaciones que no pasan por el efectivo", () => {
  it("un canje 1 a 1, una fusión y una equiparación son canjes", () => {
    const resultado = importar([["ops.xls", tablaDeOperaciones([
      filaDeOperacion("2021-08-04", "2021-08-04", "BAJA POR CANJE", "US0000000101", "RED SOCIAL ANTIGUA", "200", "USD", "16.15", "3230.00"),
      filaDeOperacion("2021-08-04", "2021-08-04", "ALTA POR CANJE", "US0000000200", "RED SOCIAL NUEVA ADR", "200", "USD", "16.15", "3230.00"),
      filaDeOperacion("2022-05-10", "2022-05-10", "BAJA POR CANJE", "US0000000309", "MINERA ABSORBIDA", "100", "USD", "10", "1000.00"),
      filaDeOperacion("2022-05-10", "2022-05-10", "ALTA POR CANJE", "US0000000408", "MINERA ABSORBENTE", "37", "USD", "27.03", "1000.00"),
      filaDeOperacion("2021-07-06", "2021-07-06", "EQUIPARACION-BAJA", "ES0000000052", "TELECO 0621", "40", "EUR", "0", "0.00"),
      filaDeOperacion("2021-07-06", "2021-07-06", "EQUIPARACION-ALTA", "ES0000000051", "TELECO", "40", "EUR", "0", "0.00")
    ]), "operaciones"]]);
    expect(resultado.movimientos.map((propuesto) => [propuesto.movimiento.tipo, propuesto.movimiento.fechaOperacion, propuesto.movimiento.activoId, propuesto.movimiento.titulos, propuesto.movimiento.destino])).toEqual([
      ["canje", "2021-07-06", "ES0000000052", "40", { activoId: "ES0000000051", titulos: "40" }],
      ["canje", "2021-08-04", "US0000000101", "200", { activoId: "US0000000200", titulos: "200" }],
      ["canje", "2022-05-10", "US0000000309", "100", { activoId: "US0000000408", titulos: "37" }]
    ]);
    expect(resultado.movimientos.every((propuesto) => !propuesto.requiereRevision)).toBe(true);
    expect(resultado.avisos).toEqual([]);
  });

  it("un cargo de mercado en euros convierte la «compra» del efectivo en comisión", () => {
    const resultado = importar([
      ["mov.xls", tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA", "EFECTIVO", "+100,00", "100,00"),
        filaDeMovimiento("12/02/2025", "COMPRA RV CONTADO", "BANCO NACIONAL @ 300", "-2,50", "97,50") // 100 − 2,50
      ], "97,50"), "movimientos"],
      ["ops.xls", tablaDeOperaciones([
        filaDeOperacion("2025-02-10", "2025-02-10", "CARGO GASTOS MERCADO", "ES0000000118", "BANCO NACIONAL", "300", "EUR", "0", "2.50")
      ]), "operaciones"]
    ]);
    // 2,50 € contra 2,50 €: al céntimo. Dos días de diferencia.
    expect(resumen(resultado.movimientos[1])).toMatchObject({ tipo: "comision", importe: "-2.5", activo: "ES0000000118", titulos: undefined, revisar: false });
    expect(resultado.avisos).toEqual([]);
  });

  it("una salida repartida en dos entradas del mismo día son dos traspasos; una entrada sola, una entrada de títulos", () => {
    const resultado = importar([["ops.xls", tablaDeOperaciones([
      filaDeOperacion("2025-03-03", "2025-03-03", "REEMB.POR TRASPASO I", "LU0000000126", "FONDO ORIGEN", "300", "EUR", "10", "3000.00"), // 300 × 10
      filaDeOperacion("2025-03-05", "2025-03-05", "SUSCR.POR TRASPASO I", "LU0000000134", "FONDO DESTINO A", "50", "EUR", "20", "1000.00"), // 50 × 20
      filaDeOperacion("2025-03-05", "2025-03-05", "SUSCR.POR TRASPASO I", "LU0000000142", "FONDO DESTINO B", "100", "EUR", "20", "2000.00"), // 100 × 20
      filaDeOperacion("2025-06-01", "2025-06-01", "SUSCR.POR TRASPASO E", "LU0000000159", "FONDO DE FUERA", "10", "EUR", "12", "120.00") // 10 × 12
    ]), "operaciones"]]);
    expect(resultado.errores).toEqual([]);
    expect(resultado.movimientos.map((propuesto) => [propuesto.movimiento.id, propuesto.movimiento.tipo, propuesto.movimiento.titulos, propuesto.movimiento.valor, propuesto.movimiento.destino?.activoId, propuesto.movimiento.destino?.titulos, propuesto.requiereRevision])).toEqual([
      // 1.000 + 2.000 = 3.000. Títulos: 300 × 1.000 / 3.000 = 100, y el último, 300 − 100 = 200.
      ["andbank-op-1-1", "traspaso", "100", "1000", "LU0000000134", "50", false],
      ["andbank-op-1-2", "traspaso", "200", "2000", "LU0000000142", "100", false],
      ["andbank-op-4", "entradaDeTitulos", "10", "120", undefined, undefined, true]
    ]);
    expect(resultado.movimientos[2].avisos[0]).toContain("Traspaso de entrada sin su salida");
  });

  it("si llegan dos extractos de posiciones, usa el más reciente y avisa", () => {
    const viejo = POSICIONES_COMPLETAS.replace(/29\/09\/2025|30\/09\/2025/g, "30/06/2025");
    const resultado = importar([["viejo.xls", viejo, "posiciones"], ["nuevo.xls", POSICIONES_COMPLETAS, "posiciones"]]);
    expect(resultado.extractos.map((extracto) => [extracto.documento, extracto.fecha])).toEqual([["nuevo.xls", "2025-09-30"]]);
    expect(resultado.avisos).toEqual(["Has cargado 2 extractos de posiciones: se usa el más reciente, «nuevo.xls», del 30/09/2025."]);
  });
});
