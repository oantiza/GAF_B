/**
 * Siete defectos medidos al pasar por el importador un juego real de extractos de Andbank,
 * reproducidos con datos SINTÉTICOS (`andbankDeMuestra.ts`). Cada prueba falla sin su
 * corrección, y cada cifra esperada sale de la cuenta a mano escrita junto a ella.
 */
import { describe, expect, it } from "vitest";
import { importadorDeAndbank } from "../../src/gestor/importacion/andbank";
import type { ActivoCitado, MovimientoPropuesto, ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import { construirLibro, contextoDe, validarMovimiento } from "../../src/gestor/motor/libro";
import { carteraVacia, type Activo } from "../../src/gestor/motor/modelo";
import {
  ISIN_DERECHOS,
  ISIN_ELECTRICA,
  ISIN_TECNOLOGIA,
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

function conOperaciones(movimientos: string, operaciones: string): ResultadoDeImportacion {
  return importar([["mov.xls", movimientos, "movimientos"], ["ops.xls", operaciones, "operaciones"]]);
}

function resumen(propuesto: MovimientoPropuesto) {
  const { movimiento } = propuesto;
  return { id: movimiento.id, tipo: movimiento.tipo, fecha: movimiento.fechaOperacion, importe: movimiento.importe, activo: movimiento.activoId, titulos: movimiento.titulos, revisar: propuesto.requiereRevision };
}

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

const ISIN_PEQUENAS = "LU1000000011";
const ISIN_VALOR = "LU1000000029";
const ISIN_RENTA_FIJA = "LU1000000037";
const ISIN_EMERGENTES = "LU1000000045";
const ISIN_RED = "ES0000000127";
const ISIN_ETF = "IE1000000052";
const ISIN_BANCO = "ES0000000135";

/* ------------------------------------------------------------------ 1 */

describe("1. a igualdad de días, gana la operación de importe exacto", () => {
  it("dos suscripciones del mismo día de 4.999,96 € y 4.999,95 €, con nombres que no casan, se enlazan cada una con la suya", () => {
    const resultado = conOperaciones(
      tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+20.000,00", "20.000,00"),
        // Conceptos de más de 30 caracteres, cortados en la arroba: sin títulos fiables.
        filaDeMovimiento("10/03/2025", "SUSCRIPCION FONDOS", "GLB SMLLR COMPANIE AE ACC EUR @", "-4.999,96", "15.000,04"), // 20.000 − 4.999,96
        filaDeMovimiento("10/03/2025", "SUSCRIPCION FONDOS", "EURO VALUE FUND AE ACC EUR @", "-4.999,95", "10.000,09") // 15.000,04 − 4.999,95
      ], "10.000,09"),
      tablaDeOperaciones([
        filaDeOperacion("2025-03-10", "2025-03-12", "SUSCRIPCION", ISIN_PEQUENAS, "GLOBAL SMALLER COMP AE EUR", "300", "EUR", "16.6665", "4999.96"),
        filaDeOperacion("2025-03-10", "2025-03-12", "SUSCRIPCION", ISIN_VALOR, "EUROPEAN VALUE AE EUR", "400", "EUR", "12.4999", "4999.95")
      ])
    );
    expect(resultado.errores).toEqual([]);
    expect(resultado.movimientos.map(resumen)).toEqual([
      { id: "andbank-mov-1", tipo: "aportacion", fecha: "2025-01-02", importe: "20000", activo: undefined, titulos: undefined, revisar: false },
      // |4.999,96 − 4.999,95| = 0,01 ≤ 0,011: las dos casan con las dos; el importe exacto decide.
      { id: "andbank-mov-2", tipo: "suscripcion", fecha: "2025-03-10", importe: "-4999.96", activo: ISIN_PEQUENAS, titulos: "300", revisar: false },
      { id: "andbank-mov-3", tipo: "suscripcion", fecha: "2025-03-10", importe: "-4999.95", activo: ISIN_VALOR, titulos: "400", revisar: false }
    ]);
    expect(resultado.avisos).toEqual([]);
  });

  it("la liquidación de una suscripción cae el día de la otra: cada fila con la de su importe", () => {
    const resultado = conOperaciones(
      tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+2.000,00", "2.000,00"),
        // Las dos con fecha del 13: el cargo de la primera se apunta el día que liquida.
        filaDeMovimiento("13/01/2025", "SUSCRIPCION FONDOS", "FONDO RENTA FIJA CORTO PLAZO @", "-999,98", "1.000,02"), // 2.000 − 999,98
        filaDeMovimiento("13/01/2025", "SUSCRIPCION FONDOS", "FONDO BOLSA EMERGENTE GLOBAL @", "-999,97", "0,05") // 1.000,02 − 999,97
      ], "0,05"),
      tablaDeOperaciones([
        // Se opera el 10 y liquida el 13: a 0 días de las dos filas, igual que la del 13.
        filaDeOperacion("2025-01-10", "2025-01-13", "SUSCRIPCION", ISIN_RENTA_FIJA, "RF CORTO PLAZO FI", "100", "EUR", "9.9998", "999.98"),
        filaDeOperacion("2025-01-13", "2025-01-15", "SUSCRIPCION", ISIN_EMERGENTES, "EMERGENTES GLOBAL FI", "50", "EUR", "19.9994", "999.97")
      ])
    );
    expect(resultado.movimientos.slice(1).map(resumen)).toEqual([
      { id: "andbank-mov-2", tipo: "suscripcion", fecha: "2025-01-13", importe: "-999.98", activo: ISIN_RENTA_FIJA, titulos: "100", revisar: false },
      { id: "andbank-mov-3", tipo: "suscripcion", fecha: "2025-01-13", importe: "-999.97", activo: ISIN_EMERGENTES, titulos: "50", revisar: false }
    ]);
  });
});

/* ------------------------------------------------------------------ 2 */

describe("2. títulos cortados que el espacio doble esconde", () => {
  const operaciones = tablaDeOperaciones([
    filaDeOperacion("2025-02-05", "2025-02-07", "COMPRA", ISIN_RED, "RED ELECTRICA CORPORACION SA", "200", "EUR", "17.50", "3500.00") // 200 × 17,50 = 3.500
  ]);

  it("«RED ELECTRICA CORPORACION  @ 2» (30 con dos espacios, 29 al leerlo) casa con la compra de 200 títulos del mismo importe", () => {
    const resultado = conOperaciones(
      tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+5.000,00", "5.000,00"),
        filaDeMovimiento("05/02/2025", "COMPRA RV CONTADO", "RED ELECTRICA CORPORACION  @ 2", "-3.500,00", "1.500,00") // 5.000 − 3.500
      ], "1.500,00"),
      operaciones
    );
    expect(resultado.movimientos.map(resumen)).toEqual([
      { id: "andbank-mov-1", tipo: "aportacion", fecha: "2025-01-02", importe: "5000", activo: undefined, titulos: undefined, revisar: false },
      // «2» es el principio de «200», el importe casa al céntimo y el concepto mide 29 ≥ 28: es la operación, con sus 200.
      { id: "andbank-mov-2", tipo: "compra", fecha: "2025-02-05", importe: "-3500", activo: ISIN_RED, titulos: "200", revisar: false }
    ]);
    expect(resultado.movimientos[1].avisos).toEqual([]);
  });

  it("con un concepto corto, que no ha podido cortarse, los títulos siguen vetando", () => {
    const resultado = conOperaciones(
      tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+5.000,00", "5.000,00"),
        filaDeMovimiento("05/02/2025", "COMPRA RV CONTADO", "RED ELECTRICA @ 2", "-3.500,00", "1.500,00") // 17 caracteres
      ], "1.500,00"),
      operaciones
    );
    expect(resumen(resultado.movimientos[1])).toMatchObject({ id: "andbank-mov-2", titulos: "2", revisar: false });
    // La operación entra aparte, sin apunte en el efectivo.
    expect(resultado.movimientos.map((propuesto) => propuesto.movimiento.id)).toContain("andbank-op-1");
  });
});

/* ------------------------------------------------------------------ 3 */

describe("3. la identidad por nombre arrastra el ISIN a las filas sin operación propia", () => {
  it("(a) un dividendo de un ETF con el concepto cortado en «… @» toma el ISIN de las operaciones con ese nombre", () => {
    const resultado = conOperaciones(
      tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+100,00", "100,00"),
        filaDeMovimiento("20/06/2025", "ABONO DE DIVIDENDO", "ISHARES CORE MSCI WORLD UCITS @", "+12,34", "112,34") // 100 + 12,34
      ], "112,34"),
      tablaDeOperaciones([
        filaDeOperacion("2024-12-02", "2024-12-04", "COMPRA", ISIN_ETF, "ISHARES CORE MSCI WORLD UCITS ETF USD ACC", "30", "USD", "100.00", "3000.00")
      ])
    );
    const dividendo = resultado.movimientos[1];
    expect(resumen(dividendo)).toEqual({ id: "andbank-mov-2", tipo: "dividendo", fecha: "2025-06-20", importe: "12.34", activo: ISIN_ETF, titulos: undefined, revisar: false });
    expect(dividendo.activo).toEqual({ clave: ISIN_ETF, isin: ISIN_ETF, nombre: "ISHARES CORE MSCI WORLD UCITS ETF USD ACC", divisa: "USD" });
    expect(dividendo.avisos).toEqual([]);
  });

  it("(b) votan las filas del mismo nombre enlazadas: un dividendo «BCO SANTANDER @ 65» toma el ISIN de su compra", () => {
    const resultado = conOperaciones(
      tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+1.000,00", "1.000,00"),
        filaDeMovimiento("10/02/2025", "COMPRA RV CONTADO", "BCO SANTANDER @ 65", "-390,00", "610,00"), // 1.000 − 65 × 6
        filaDeMovimiento("02/05/2025", "ABONO DE DIVIDENDO", "BCO SANTANDER @ 65", "+7,15", "617,15") // 610 + 7,15
      ], "617,15"),
      // «BANCO SANTANDER SA» no casa con «BCO SANTANDER», y el export no trae el dividendo.
      tablaDeOperaciones([filaDeOperacion("2025-02-10", "2025-02-12", "COMPRA", ISIN_BANCO, "BANCO SANTANDER SA", "65", "EUR", "6.00", "390.00")])
    );
    expect(resultado.movimientos.slice(1).map(resumen)).toEqual([
      { id: "andbank-mov-2", tipo: "compra", fecha: "2025-02-10", importe: "-390", activo: ISIN_BANCO, titulos: "65", revisar: false },
      { id: "andbank-mov-3", tipo: "dividendo", fecha: "2025-05-02", importe: "7.15", activo: ISIN_BANCO, titulos: undefined, revisar: false }
    ]);
    expect(resultado.movimientos[2].activo).toMatchObject({ clave: ISIN_BANCO, nombre: "BANCO SANTANDER SA", divisa: "EUR" });
  });

  it("si las filas del mismo nombre apuntan a dos ISIN, no se elige", () => {
    const resultado = conOperaciones(
      tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+1.000,00", "1.000,00"),
        filaDeMovimiento("10/02/2025", "COMPRA RV CONTADO", "BCO DEL PUERTO @ 10", "-100,00", "900,00"), // 1.000 − 100
        filaDeMovimiento("11/02/2025", "COMPRA RV CONTADO", "BCO DEL PUERTO @ 20", "-200,00", "700,00"), // 900 − 200
        filaDeMovimiento("02/05/2025", "ABONO DE DIVIDENDO", "BCO DEL PUERTO @ 30", "+3,00", "703,00") // 700 + 3
      ], "703,00"),
      tablaDeOperaciones([
        filaDeOperacion("2025-02-10", "2025-02-12", "COMPRA", "ES0000000143", "BANCO DEL PUERTO SA", "10", "EUR", "10.00", "100.00"),
        filaDeOperacion("2025-02-11", "2025-02-13", "COMPRA", "ES0000000150", "BANCO DEL PUERTO PREF", "20", "EUR", "10.00", "200.00")
      ])
    );
    const dividendo = resultado.movimientos[3];
    expect(resumen(dividendo)).toMatchObject({ tipo: "dividendo", activo: "BCO DEL PUERTO", revisar: true });
    expect(dividendo.avisos).toContain("El activo solo se conoce por su nombre en el extracto: elige cuál es antes de importar.");
  });
});

/* ------------------------------------------------------------------ 4 */

describe("4. dos dividendos en dólares del mismo ADR el mismo día", () => {
  it("se emparejan por orden de importe y sus operaciones no se proponen aparte sin importe en euros", () => {
    const resultado = conOperaciones(
      tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+100,00", "100,00"),
        filaDeMovimiento("15/09/2025", "ABONO DE DIVIDENDO", "TECNOLOGIA AMERICANA @ 10", "+8,50", "108,50"), // 100 + 8,50
        filaDeMovimiento("15/09/2025", "ABONO DE DIVIDENDO", "TECNOLOGIA AMERICANA @ 10", "+2,55", "111,05") // 108,50 + 2,55
      ], "111,05"),
      tablaDeOperaciones([
        filaDeOperacion("2025-09-15", "2025-09-15", "DIVIDENDO", ISIN_TECNOLOGIA, "TECNOLOGIA AMERICANA INC", "10", "USD", "0.30", "3.00"), // 10 × 0,30
        filaDeOperacion("2025-09-15", "2025-09-15", "DIVIDENDO", ISIN_TECNOLOGIA, "TECNOLOGIA AMERICANA INC", "10", "USD", "1.00", "10.00") // 10 × 1,00
      ])
    );
    // 8,50 € con 10 USD y 2,55 € con 3 USD. Ninguna operación queda suelta.
    expect(resultado.movimientos.map(resumen)).toEqual([
      { id: "andbank-mov-1", tipo: "aportacion", fecha: "2025-01-02", importe: "100", activo: undefined, titulos: undefined, revisar: false },
      { id: "andbank-mov-2", tipo: "dividendo", fecha: "2025-09-15", importe: "8.5", activo: ISIN_TECNOLOGIA, titulos: undefined, revisar: false },
      { id: "andbank-mov-3", tipo: "dividendo", fecha: "2025-09-15", importe: "2.55", activo: ISIN_TECNOLOGIA, titulos: undefined, revisar: false }
    ]);
    expect(resultado.movimientos.flatMap((propuesto) => propuesto.avisos)).not.toContain("Falta el importe en euros: complétalo antes de importar.");
    expect(resultado.avisos).toEqual([]);
  });

  it("si hay más operaciones que filas, no se enlaza ninguna", () => {
    const resultado = conOperaciones(
      tablaDeMovimientos("0,00", "01/01/2025", [
        filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+100,00", "100,00"),
        filaDeMovimiento("15/09/2025", "ABONO DE DIVIDENDO", "TECNOLOGIA AMERICANA @ 10", "+8,50", "108,50")
      ], "108,50"),
      tablaDeOperaciones([
        filaDeOperacion("2025-09-15", "2025-09-15", "DIVIDENDO", ISIN_TECNOLOGIA, "TECNOLOGIA AMERICANA INC", "10", "USD", "0.30", "3.00"),
        filaDeOperacion("2025-09-15", "2025-09-15", "DIVIDENDO", ISIN_TECNOLOGIA, "TECNOLOGIA AMERICANA INC", "10", "USD", "1.00", "10.00")
      ])
    );
    // Las dos operaciones entran aparte, sin importe en euros.
    expect(resultado.movimientos.filter((propuesto) => propuesto.avisos.includes("Falta el importe en euros: complétalo antes de importar.")).length).toBe(2);
  });
});

/* ------------------------------------------------------------------ 5 */

describe("5. conceptos del banco que antes no se sabía qué eran", () => {
  const MOVIMIENTOS = tablaDeMovimientos("0,00", "01/01/2025", [
    filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+1.000,00", "1.000,00"),
    filaDeMovimiento("15/01/2025", "COMPRA RV CONTADO", "TECNOLOGIA AMERICANA @ 10", "-900,00", "100,00"), // 1.000 − 900
    filaDeMovimiento("10/04/2025", "DEVOL. PRIMA EM. RV", "ELECTRICA DEL SUR @ 100", "+20,00", "120,00"), // 100 + 20
    filaDeMovimiento("30/04/2025", "COBRO ENVIO CORRESPONDENCIA SF", "CORRESPONDENCIA", "-1,50", "118,50"), // 120 − 1,50
    filaDeMovimiento("05/05/2025", "CARGO MANTENIMIENTO ADR SF", "TECNOLOGIA AMERICANA @ 10", "-0,90", "117,60"), // 118,50 − 0,90
    filaDeMovimiento("06/05/2025", "RETRO COMIS CORRESPONDENCIA SF", "CORRESPONDENCIA", "+1,50", "119,10"), // 117,60 + 1,50
    filaDeMovimiento("07/05/2025", "ABONO POR PENALIZACI&Oacute;N RV SF", "PENALIZACION", "+3,00", "122,10") // 119,10 + 3
  ], "122,10");
  const OPERACIONES = tablaDeOperaciones([
    filaDeOperacion("2025-01-15", "2025-01-17", "COMPRA", ISIN_TECNOLOGIA, "TECNOLOGIA AMERICANA INC", "10", "USD", "99.00", "990.00"), // 1
    filaDeOperacion("2025-04-10", "2025-04-10", "DEVOL.PRIMA EMISION", ISIN_ELECTRICA, "ELECTRICA DEL SUR", "100", "EUR", "0.20", "20.00"), // 2: 100 × 0,20
    filaDeOperacion("2025-04-20", "2025-04-20", "DEVOL.PRIMA EMISION", ISIN_ELECTRICA, "ELECTRICA DEL SUR", "100", "EUR", "0.05", "5.00"), // 3: sin fila que case
    filaDeOperacion("2025-05-05", "2025-05-05", "CARGO MANTENIMIENTO", ISIN_TECNOLOGIA, "TECNOLOGIA AMERICANA INC", "10", "USD", "0.10", "1.00"), // 4
    filaDeOperacion("2025-05-07", "2025-05-07", "ABONO POR PENALIZACI", ISIN_ELECTRICA, "ELECTRICA DEL SUR", "0", "EUR", "0", "3.00") // 5
  ]);

  it("prima de emisión como dividendo con su ISIN, gastos como comisión y abonos del banco sin revisión", () => {
    const resultado = conOperaciones(MOVIMIENTOS, OPERACIONES);
    expect(resultado.errores).toEqual([]);
    expect(resultado.movimientos.slice(2).map(resumen)).toEqual([
      // 100 títulos y 20,00 €: casa con la operación 2.
      { id: "andbank-mov-3", tipo: "dividendo", fecha: "2025-04-10", importe: "20", activo: ISIN_ELECTRICA, titulos: undefined, revisar: false },
      { id: "andbank-mov-4", tipo: "comision", fecha: "2025-04-30", importe: "-1.5", activo: undefined, titulos: undefined, revisar: false },
      // El nombre «TECNOLOGIA AMERICANA» casa con las operaciones de un solo ISIN.
      { id: "andbank-mov-5", tipo: "comision", fecha: "2025-05-05", importe: "-0.9", activo: ISIN_TECNOLOGIA, titulos: undefined, revisar: false },
      { id: "andbank-mov-6", tipo: "otroEfectivo", fecha: "2025-05-06", importe: "1.5", activo: undefined, titulos: undefined, revisar: false },
      { id: "andbank-mov-7", tipo: "otroEfectivo", fecha: "2025-05-07", importe: "3", activo: undefined, titulos: undefined, revisar: false }
    ]);
    const [prima, , , retro, penalizacion] = resultado.movimientos.slice(2);
    expect(prima.movimiento.nota).toBe("Devolución de prima de emisión");
    expect(retro.avisos).toEqual(["Abono del banco: «RETRO COMIS CORRESPONDENCIA SF». Se propone como otro abono de efectivo."]);
    expect(penalizacion.avisos).toEqual(["Abono del banco: «ABONO POR PENALIZACIÓN RV SF». Se propone como otro abono de efectivo."]);
    // Las tres operaciones que solo describen un apunte del efectivo no mandan darlas de alta: una sola línea.
    expect(resultado.avisos).toEqual([
      "3 operaciones del export (DEVOL.PRIMA EMISION, CARGO MANTENIMIENTO, ABONO POR PENALIZACI) solo describen un apunte de efectivo que ya está en el extracto de la cuenta: no se importan aparte para no duplicarlo."
    ]);
    // Ninguna se propone aparte como dividendo sin apunte.
    expect(resultado.movimientos.some((propuesto) => propuesto.movimiento.id.startsWith("andbank-op-"))).toBe(false);
  });

  it("sin extracto de efectivo, se mantiene el aviso de darlas de alta a mano", () => {
    const resultado = importar([["ops.xls", OPERACIONES, "operaciones"]]);
    expect(resultado.avisos.filter((aviso) => aviso.startsWith("Operación no importada") && aviso.endsWith("dala de alta a mano.")).length).toBe(4);
  });
});

/* ------------------------------------------------------------------ 6 */

describe("6. derechos de suscripción", () => {
  const resultado = conOperaciones(
    tablaDeMovimientos("0,00", "01/01/2025", [
      filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+1.000,00", "1.000,00"),
      filaDeMovimiento("20/06/2025", "SUSCRIPCION ACCIONES", "ELECTRICA DEL SUR @ 20", "-200,00", "800,00"), // 1.000 − 20 × 10
      filaDeMovimiento("25/06/2025", "VENTA DERECHOS", "ELECTRICA SUR DERECHOS @ 20", "+3,00", "803,00") // 800 + 20 × 0,15
    ], "803,00"),
    tablaDeOperaciones([
      filaDeOperacion("2025-06-10", "2025-06-10", "ALTA DCHOS. SUSCRIP.", ISIN_DERECHOS, "ELECTRICA SUR DERECHOS", "100", "EUR", "0", "0.00"), // 1
      filaDeOperacion("2025-06-20", "2025-06-24", "SUSCRIPCION RV", ISIN_ELECTRICA, "ELECTRICA DEL SUR", "20", "EUR", "10.00", "200.00"), // 2: 20 × 10
      filaDeOperacion("2025-06-20", "2025-06-20", "EJERCICIO DERECHOS", ISIN_DERECHOS, "ELECTRICA SUR DERECHOS", "80", "EUR", "0", "0.00"), // 3
      filaDeOperacion("2025-06-25", "2025-06-27", "VENTA", ISIN_DERECHOS, "ELECTRICA SUR DERECHOS", "20", "EUR", "0.15", "3.00") // 4: 20 × 0,15
    ])
  );

  it("el alta entra sin coste, el ejercicio sale y la venta de los sobrantes cierra a cero", () => {
    expect(resultado.errores).toEqual([]);
    expect(resultado.movimientos.map(resumen)).toEqual([
      { id: "andbank-mov-1", tipo: "aportacion", fecha: "2025-01-02", importe: "1000", activo: undefined, titulos: undefined, revisar: false },
      { id: "andbank-op-1", tipo: "dividendoEnAcciones", fecha: "2025-06-10", importe: undefined, activo: ISIN_DERECHOS, titulos: "100", revisar: false },
      { id: "andbank-mov-2", tipo: "suscripcion", fecha: "2025-06-20", importe: "-200", activo: ISIN_ELECTRICA, titulos: "20", revisar: false },
      { id: "andbank-op-3", tipo: "extincionDeTitulos", fecha: "2025-06-20", importe: undefined, activo: ISIN_DERECHOS, titulos: "80", revisar: false },
      { id: "andbank-mov-3", tipo: "venta", fecha: "2025-06-25", importe: "3", activo: ISIN_DERECHOS, titulos: "20", revisar: false }
    ]);
    const porId = (id: string) => resultado.movimientos.find((propuesto) => propuesto.movimiento.id === id)!;
    expect(porId("andbank-op-1").movimiento).toMatchObject({ nota: "Derechos de suscripción asignados" });
    expect(porId("andbank-op-1").movimiento.valor).toBeUndefined();
    expect(porId("andbank-op-3").movimiento.nota).toBe("Derechos ejercidos");
    expect(porId("andbank-op-1").activo).toMatchObject({ clave: ISIN_DERECHOS, tipo: "ACCION" });
    expect(resultado.avisos).toEqual([]);
  });

  it("una «SUSCRIPCION RV» es de acciones, no de un fondo", () => {
    expect(resultado.movimientos.find((propuesto) => propuesto.movimiento.id === "andbank-mov-2")!.activo).toMatchObject({ clave: ISIN_ELECTRICA, tipo: "ACCION" });
  });

  it("el motor los aplica sin descubierto: derechos 100 − 80 − 20 = 0, acciones 20, efectivo 803", () => {
    const cartera = carteraCon(resultado.movimientos);
    const contexto = contextoDe(cartera);
    for (const propuesto of resultado.movimientos) expect([propuesto.movimiento.id, validarMovimiento(propuesto.movimiento, contexto)]).toEqual([propuesto.movimiento.id, []]);
    const libro = construirLibro({ ...cartera, movimientos: resultado.movimientos.map((propuesto) => propuesto.movimiento) });
    expect(libro.avisos.filter((aviso) => aviso.nivel === "error")).toEqual([]);
    const titulosDe = (id: string) => (libro.final.lotes.get(id) ?? []).reduce((suma, lote) => suma + Number(lote.titulos.toFixed()), 0);
    expect([titulosDe(ISIN_DERECHOS), titulosDe(ISIN_ELECTRICA)]).toEqual([0, 20]);
    expect(libro.final.efectivo.get("EUR")?.toFixed(2)).toBe("803.00");
  });
});

/* ------------------------------------------------------------------ 7 */

describe("7. traspasos de varios fondos a varios, por oleadas", () => {
  /* Salen tres fondos el 1 de abril (1.200 + 800 + 500 = 2.500) y entran cuatro entre el 2 y el 5
     (700 + 600 + 450 + 750 = 2.500). Ningún emparejado anterior lo resuelve: ningún importe es otro,
     ninguna salida es la suma de entradas de un día, ninguna entrada es la suma de salidas. */
  const salidas = [
    filaDeOperacion("2025-04-01", "2025-04-01", "REEMB.POR TRASPASO I", "LU2000000018", "FONDO A", "100", "EUR", "12", "1200.00"), // 1: 100 × 12
    filaDeOperacion("2025-04-01", "2025-04-01", "REEMB.POR TRASPASO I", "LU2000000026", "FONDO B", "200", "EUR", "4", "800.00"), // 2: 200 × 4
    filaDeOperacion("2025-04-01", "2025-04-01", "REEMB.POR TRASPASO I", "LU2000000034", "FONDO C", "50", "EUR", "10", "500.00") // 3: 50 × 10
  ];
  const entradas = (ultima: string) => [
    filaDeOperacion("2025-04-02", "2025-04-02", "SUSCR.POR TRASPASO I", "LU2000000042", "FONDO D", "70", "EUR", "10", "700.00"), // 4: 70 × 10
    filaDeOperacion("2025-04-02", "2025-04-02", "SUSCR.POR TRASPASO I", "LU2000000059", "FONDO E", "40", "EUR", "15", "600.00"), // 5: 40 × 15
    filaDeOperacion("2025-04-03", "2025-04-03", "SUSCR.POR TRASPASO I", "LU2000000067", "FONDO F", "45", "EUR", "10", "450.00"), // 6: 45 × 10
    ultima // 7
  ];

  it("si la oleada cierra, el dinero se reparte en orden de fecha en seis traspasos", () => {
    const resultado = importar([["ops.xls", tablaDeOperaciones([
      ...salidas,
      ...entradas(filaDeOperacion("2025-04-05", "2025-04-05", "SUSCR.POR TRASPASO I", "LU2000000075", "FONDO G", "50", "EUR", "15", "750.00")) // 50 × 15
    ]), "operaciones"]]);
    expect(resultado.errores).toEqual([]);
    const filas = resultado.movimientos.map((propuesto) => {
      const { movimiento } = propuesto;
      return [movimiento.id, movimiento.tipo, movimiento.activoId, movimiento.titulos, movimiento.valor, movimiento.destino?.activoId, movimiento.destino?.titulos, movimiento.destino?.fecha, propuesto.requiereRevision];
    });
    expect(filas).toEqual([
      // A (1.200) cubre D (700) y 500 de E. Títulos de A: 100 × 700 / 1.200 = 58,3333…; el resto, 100 − 58,3333 = 41,6667.
      ["andbank-op-1-a-4", "traspaso", "LU2000000018", "58.3333", "700", "LU2000000042", "70", "2025-04-02", false],
      // De E: 40 × 500 / 600 = 33,3333.
      ["andbank-op-1-a-5", "traspaso", "LU2000000018", "41.6667", "500", "LU2000000059", "33.3333", "2025-04-02", false],
      // B (800) cubre los 100 que faltan de E (200 × 100 / 800 = 25; E: 40 − 33,3333 = 6,6667), F entera (200 × 450 / 800 = 112,5) y 250 de G.
      ["andbank-op-2-a-5", "traspaso", "LU2000000026", "25", "100", "LU2000000059", "6.6667", "2025-04-02", false],
      ["andbank-op-2-a-6", "traspaso", "LU2000000026", "112.5", "450", "LU2000000067", "45", "2025-04-03", false],
      // B: 200 − 25 − 112,5 = 62,5. G: 50 × 250 / 750 = 16,6667.
      ["andbank-op-2-a-7", "traspaso", "LU2000000026", "62.5", "250", "LU2000000075", "16.6667", "2025-04-05", false],
      // C (500) cubre el resto de G: 50 − 16,6667 = 33,3333.
      ["andbank-op-3-a-7", "traspaso", "LU2000000034", "50", "500", "LU2000000075", "33.3333", "2025-04-05", false]
    ]);
    const cartera = carteraCon(resultado.movimientos);
    const contexto = contextoDe(cartera);
    for (const propuesto of resultado.movimientos) expect(validarMovimiento(propuesto.movimiento, contexto)).toEqual([]);
  });

  it("si no cierra (sale 2.500 y entra 2.450), las siete patas se quedan como salidas y entradas de títulos por revisar", () => {
    const resultado = importar([["ops.xls", tablaDeOperaciones([
      ...salidas,
      ...entradas(filaDeOperacion("2025-04-05", "2025-04-05", "SUSCR.POR TRASPASO I", "LU2000000075", "FONDO G", "50", "EUR", "14", "700.00")) // 50 × 14
    ]), "operaciones"]]);
    // 2.500 − 2.450 = 50 > 2,50 (el 0,1 % de 2.500).
    expect(resultado.movimientos.map((propuesto) => [propuesto.movimiento.tipo, propuesto.requiereRevision])).toEqual([
      ["salidaDeTitulos", true], ["salidaDeTitulos", true], ["salidaDeTitulos", true],
      ["entradaDeTitulos", true], ["entradaDeTitulos", true], ["entradaDeTitulos", true], ["entradaDeTitulos", true]
    ]);
  });
});
