/**
 * La cartera de las pruebas de A-205 (`precioDelExtractoEnSuDivisa.test.ts` y su `Pantalla`): 100 acciones en dólares que
 * entran a 90 $ el 02-01-2026, con el dólar a 1,125 por euro ese día y a 1,10 el 05-01, y un extracto del 05-01 que declara
 * su precio, 99,55 $, y su contravalor, 9.000 € (NUEVA), o solo el contravalor, como los ficheros de antes (ANTERIOR).
 */
import type { Cartera, PosicionDeclarada } from "../../src/gestor/motor/modelo";
import type { DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

export const DIA = "2026-01-05";
export const ISIN = "US0000000043";
export const U = activo("U", "ACCION", "USD", { isin: ISIN, nombre: "Accion americana" });
export const MERCADO: DatosDeMercado = { precios: new Map(), cambios: new Map([["USD", serie(["2026-01-02", 1.125], [DIA, 1.1])]]) };

export const conPosicion = (posicion: PosicionDeclarada): Cartera =>
  cartera([U], [mov("entradaDeTitulos", "2026-01-02", { id: "m1", activoId: "U", titulos: "100", precio: "90" })], {
    extractos: [{ id: "e1", fecha: DIA, posiciones: [posicion], efectivo: [] }]
  });
export const NUEVA = conPosicion({ activoId: "U", isin: ISIN, nombre: "Accion americana", titulos: "100", valor: "9000", precio: "99.55", divisa: "USD" });
export const ANTERIOR = conPosicion({ activoId: "U", isin: ISIN, nombre: "Accion americana", titulos: "100", valor: "9000" });
