/**
 * Extractos de Andbank SINTÉTICOS para las pruebas del importador, con la misma forma que los
 * de las pruebas de Python (`functions_python/tests/test_portfolio_real*.py`, en la etiqueta de Git
 * `referencia-portfolio-real-2026-11-17`). Ningún dato de
 * un cliente real: importes, fondos, fechas e ISIN son inventados (los ISIN, con formato
 * válido).
 */
import { leerTexto } from "../../src/gestor/importacion/lectura";
import type { DocumentoLeido } from "../../src/gestor/importacion/tipos";

/* ------------------------------------------------------------------ movimientos */

const CABECERA_DE_MOVIMIENTOS = `
  <tr><th>Fecha operaci&oacute;n</th><th>Fecha valor</th><th>Tipo de operaci&oacute;n</th>
      <th>Concepto</th><th>Cargo Abono Importe</th><th>Saldo</th></tr>`;

export function filaDeMovimiento(fecha: string, tipo: string, concepto: string, importe: string, saldo: string, fechaValor = fecha): string {
  return `<tr><td>${fecha}</td><td>${fechaValor}</td><td>${tipo}</td><td>${concepto}</td><td>${importe}</td><td>${saldo}</td></tr>`;
}

/** Una tabla de movimientos con su «Saldo Inicio» y su «Saldo Final», como las exporta el banco. */
export function tablaDeMovimientos(saldoInicio: string, fechaInicio: string, filas: string[], saldoFinal: string, fechaFinal = "30/09/2025"): string {
  return (
    "<table>" + CABECERA_DE_MOVIMIENTOS
    + `<tr><td>${fechaInicio}</td><td>Saldo Inicio</td><td>Saldo Inicio</td><td>Saldo Inicio</td><td>Saldo Inicio</td><td>${saldoInicio}</td></tr>`
    + filas.join("")
    + `<tr><td>${fechaFinal}</td><td>Saldo Final</td><td>Saldo Final</td><td>Saldo Final</td><td>Saldo Final</td><td>${saldoFinal}</td></tr>`
    + "</table>"
  );
}

/** Una tabla de movimientos sin filas de saldo (como `MOVEMENTS_HTML` de Python). */
export function tablaDeMovimientosSinSaldos(filas: string[]): string {
  return "<table>" + CABECERA_DE_MOVIMIENTOS + filas.join("") + "</table>";
}

/* ------------------------------------------------------------------ posiciones */

const CABECERA_DE_POSICIONES = `
  <tr><th>Producto</th><th>ISIN</th><th>Mercado</th><th>Div</th><th>Tipo saldo</th>
      <th>T&iacute;tulos</th><th>Coste medio</th><th>Precio de mercado</th>
      <th>Fecha Cotizaci&oacute;n Mercado</th><th>Fecha Cotizaci&oacute;n Entidad</th>
      <th>Coste Adquisici&oacute;n</th><th>Valor de mercado</th><th>Plus Minus</th><th>Contravalor en EUR</th></tr>`;

export interface PosicionDeMuestra {
  producto: string;
  isin: string;
  divisa: string;
  titulos: string;
  costeMedio: string;
  precio: string;
  fecha: string;
  coste: string;
  valor: string;
  plusvalia: string;
  contravalor: string;
}

export function filaDePosicion(p: PosicionDeMuestra): string {
  return (
    `<tr><td>${p.producto}</td><td>${p.isin}</td><td></td><td>${p.divisa}</td><td></td><td>${p.titulos}</td><td>${p.costeMedio}</td>`
    + `<td>${p.precio}</td><td>${p.fecha}</td><td></td><td>${p.coste}</td><td>${p.valor}</td><td>${p.plusvalia}</td><td>${p.contravalor}</td></tr>`
  );
}

/** Un subtotal de bloque: el nombre en Producto, ISIN, Valor y Plus Minus, y la cifra en Contravalor. */
export function filaDeSubtotal(nombre: string, contravalor: string): string {
  return (
    `<tr><td>${nombre}</td><td>${nombre}</td><td></td><td>EUR</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>`
    + `<td>${nombre}</td><td>${nombre}</td><td>${contravalor}</td></tr>`
  );
}

export function tablaDePosiciones(filas: string[]): string {
  return "<html><body><table>" + CABECERA_DE_POSICIONES + filas.join("") + "</table></body></html>";
}

/* ------------------------------------------------------------------ operaciones */

/** La cabecera de dos filas: «Fechas» con colspan=2 se parte debajo en Operación y Liquidación. */
const CABECERA_DE_OPERACIONES = `
  <tr><th colspan="2">Fechas</th><th rowspan="2">Operaci&oacute;n</th><th rowspan="2">Mercado</th>
      <th rowspan="2">Operaci&oacute;n</th><th rowspan="2">ISIN</th><th rowspan="2">Valor</th>
      <th rowspan="2">T&iacute;tulos/NOMINAL</th><th rowspan="2">Divisa</th>
      <th rowspan="2">Precio Neto</th><th rowspan="2">Importe neto</th></tr>
  <tr><th>Operaci&oacute;n</th><th>Liquidaci&oacute;n</th></tr>`;

let numeroDeOperacion = 1000;

export function filaDeOperacion(fecha: string, liquidacion: string, tipo: string, isin: string, valor: string, titulos: string, divisa: string, precio: string, importe: string): string {
  numeroDeOperacion += 1;
  return (
    `<tr><td>${fecha}</td><td>${liquidacion}</td><td>${numeroDeOperacion}</td><td>EXT</td><td>${tipo}</td><td>${isin}</td>`
    + `<td>${valor}</td><td>${titulos}</td><td>${divisa}</td><td>${precio}</td><td>${importe}</td></tr>`
  );
}

export function tablaDeOperaciones(filas: string[]): string {
  return "<table>" + CABECERA_DE_OPERACIONES + filas.join("") + "</table>";
}

/* ------------------------------------------------------------------ documentos */

export function documento(nombre: string, html: string): DocumentoLeido {
  return leerTexto(nombre, html);
}

/* ------------------------------------------------------------------ el juego completo */

export const ISIN_ELECTRICA = "ES0000000019";
export const ISIN_TECNOLOGIA = "US0000000027";
export const ISIN_MIXTO = "LU0000000035";
export const ISIN_BOLSA = "LU0000000050";
export const ISIN_DERECHOS = "ES0600000084";

/**
 * Nueve meses de una cartera inventada, en los tres documentos. Cada saldo sale del anterior
 * más el importe de su fila (la cuenta va a la derecha).
 */
export const MOVIMIENTOS_COMPLETOS = tablaDeMovimientos("0,00", "01/01/2025", [
  filaDeMovimiento("02/01/2025", "APERTURA", "A", "+0,00", "0,00"),                                                  // 0
  filaDeMovimiento("02/01/2025", "TRANSFERENCIA SEPA", "EFECTIVO", "+50.000,00", "50.000,00"),                         // 0 + 50.000 = 50.000,00
  filaDeMovimiento("10/01/2025", "COMPRA RV CONTADO", "ELECTRICA DEL SUR @ 100", "-1.234,56", "48.765,44", "14/01/2025"), // 50.000 − 1.234,56
  filaDeMovimiento("15/01/2025", "COMPRA RV CONTADO", "TECNOLOGIA AMERICANA @ 10", "-1.800,00", "46.965,44"),          // 48.765,44 − 1.800
  filaDeMovimiento("20/01/2025", "SUSCRIPCION FONDOS", "FONDO MIXTO PRUDENTE EURO @ 40", "-4.000,00", "42.965,44"),     // 46.965,44 − 4.000 (concepto de 30: «@ 400» cortado)
  filaDeMovimiento("03/03/2025", "ABONO DE DIVIDENDO", "ELECTRICA DEL SUR @ 100", "+45,60", "43.011,04"),             // 42.965,44 + 45,60
  filaDeMovimiento("31/03/2025", "COMISION CUSTODIA", "COMISION CUSTODIA", "-30,25", "42.980,79"),                    // 43.011,04 − 30,25
  filaDeMovimiento("31/03/2025", "LIQUIDACION INTERESES", "INTERESES CUENTA", "+12,10", "42.992,89"),                 // 42.980,79 + 12,10
  filaDeMovimiento("15/05/2025", "VENTA RV CONTADO", "ELECTRICA DEL SUR @ 50", "+700,00", "43.692,89"),               // 42.992,89 + 700
  filaDeMovimiento("20/06/2025", "REEMBOLSO FONDOS", "FONDO MIXTO PRUDENTE EURO @ 10", "+1.050,00", "44.742,89"),      // 43.692,89 + 1.050 (cortado: son 100)
  filaDeMovimiento("01/07/2025", "TRANSFERENCIA EMITIDA", "EFECTIVO", "-2.000,00", "42.742,89"),                      // 44.742,89 − 2.000
  filaDeMovimiento("10/07/2025", "COMPRA RV CONTADO", "TECNOLOGIA AMERICANA @ 10", "-3,64", "42.739,25"),             // 42.742,89 − 3,64: el cargo del ADR
  filaDeMovimiento("15/09/2025", "ABONO DE DIVIDENDO", "TECNOLOGIA AMERICANA @ 10", "+8,50", "42.747,75")             // 42.739,25 + 8,50
], "42.747,75");

export const OPERACIONES_COMPLETAS = tablaDeOperaciones([
  filaDeOperacion("2025-01-10", "2025-01-14", "COMPRA", ISIN_ELECTRICA, "ELECTRICA DEL SUR", "100", "EUR", "12.3456", "1234.56"),     // 1: 100 × 12,3456 = 1.234,56
  filaDeOperacion("2025-01-15", "2025-01-17", "COMPRA", ISIN_TECNOLOGIA, "TECNOLOGIA AMERICANA INC", "10", "USD", "198.00", "1980.00"), // 2: 10 × 198 = 1.980 USD
  filaDeOperacion("2025-01-20", "2025-01-22", "SUSCRIPCION", ISIN_MIXTO, "FONDO MIXTO PRUDENTE EURO", "400", "EUR", "10.00", "4000.00"), // 3: 400 × 10 = 4.000
  filaDeOperacion("2025-03-03", "2025-03-03", "DIVIDENDO", ISIN_ELECTRICA, "ELECTRICA DEL SUR", "100", "EUR", "0.456", "45.60"),       // 4: 100 × 0,456 = 45,60
  filaDeOperacion("2025-05-15", "2025-05-19", "VENTA", ISIN_ELECTRICA, "ELECTRICA DEL SUR", "50", "EUR", "14.00", "700.00"),           // 5: 50 × 14 = 700
  filaDeOperacion("2025-06-10", "2025-06-10", "ALTA DCHOS. SUSCRIP.", ISIN_DERECHOS, "ELECTRICA SUR DERECHOS", "50", "EUR", "0", "0.00"), // 6
  filaDeOperacion("2025-06-20", "2025-06-24", "REEMBOLSO", ISIN_MIXTO, "FONDO MIXTO PRUDENTE EURO", "100", "EUR", "10.50", "1050.00"),  // 7: 100 × 10,50 = 1.050
  filaDeOperacion("2025-07-08", "2025-07-08", "CARGO GASTOS MERCADO", ISIN_TECNOLOGIA, "TECNOLOGIA AMERICANA INC", "10", "USD", "0.40", "4.00"), // 8: 10 × 0,40 = 4 USD
  filaDeOperacion("2025-08-01", "2025-08-01", "REEMB.POR TRASPASO I", ISIN_MIXTO, "FONDO MIXTO PRUDENTE EURO", "150", "EUR", "10.60", "1590.00"), // 9: 150 × 10,60 = 1.590
  filaDeOperacion("2025-08-03", "2025-08-03", "SUSCR.POR TRASPASO I", ISIN_BOLSA, "FONDO BOLSA GLOBAL", "100", "EUR", "15.90", "1590.00"),      // 10: 100 × 15,90 = 1.590
  filaDeOperacion("2025-09-05", "2025-09-05", "REEMB.POR TRASPASO E", ISIN_MIXTO, "FONDO MIXTO PRUDENTE EURO", "50", "EUR", "10.80", "540.00"),   // 11: 50 × 10,80 = 540
  /* 12: los 50 derechos de la operación 6 se ejercen; desde que el alta se importa, tienen que salir para que el
     libro cuadre con las posiciones, que no los declaran. Las acciones nuevas del ejercicio no forman parte de este
     juego: se deja así para no cambiar las posiciones ni el efectivo. Va al final para no mover el orden de las demás. */
  filaDeOperacion("2025-06-20", "2025-06-20", "EJERCICIO DERECHOS", ISIN_DERECHOS, "ELECTRICA SUR DERECHOS", "50", "EUR", "0", "0.00")
]);

/** Lo que queda: Eléctrica 100 − 50 = 50; Tecnología 10; Mixto 400 − 100 − 150 − 50 = 100; Bolsa 100. */
export const POSICIONES_COMPLETAS = tablaDePosiciones([
  filaDePosicion({ producto: "ELECTRICA DEL SUR SA", isin: ISIN_ELECTRICA, divisa: "EUR", titulos: "50", costeMedio: "12,35", precio: "15,00", fecha: "29/09/2025", coste: "617,28", valor: "750,00", plusvalia: "132,72", contravalor: "750,00" }), // 50 × 15
  filaDeSubtotal("TOTAL ACCIONES NACIONALES", "750,00"),
  filaDePosicion({ producto: "TECNOLOGIA AMERICANA INC", isin: ISIN_TECNOLOGIA, divisa: "USD", titulos: "10", costeMedio: "198,00", precio: "210,00", fecha: "29/09/2025", coste: "1.980,00", valor: "2.100,00", plusvalia: "120,00", contravalor: "1.800,00" }), // 10 × 210 = 2.100 USD
  filaDeSubtotal("TOTAL ACCIONES INTERNACIONALES", "1.800,00"),
  filaDePosicion({ producto: "FONDO MIXTO PRUDENTE EURO", isin: ISIN_MIXTO, divisa: "EUR", titulos: "100", costeMedio: "10,00", precio: "10,90", fecha: "30/09/2025", coste: "1.000,00", valor: "1.090,00", plusvalia: "90,00", contravalor: "1.090,00" }), // 100 × 10,90
  filaDePosicion({ producto: "FONDO BOLSA GLOBAL", isin: ISIN_BOLSA, divisa: "EUR", titulos: "100", costeMedio: "15,90", precio: "16,20", fecha: "29/09/2025", coste: "1.590,00", valor: "1.620,00", plusvalia: "30,00", contravalor: "1.620,00" }), // 100 × 16,20
  filaDeSubtotal("TOTAL FONDOS INTERNACIONALES", "2.710,00"), // 1.090 + 1.620
  filaDeSubtotal("TOTAL CARTERA", "5.260,00") // 750 + 1.800 + 2.710
]);
