/**
 * El export de operaciones de valores de Andbank.
 *
 * Traslado de `parse_operation_identities` y `parse_transfer_operations_html` de `parser.py`,
 * leyendo todas las filas: compras, ventas, suscripciones, reembolsos, dividendos, traspasos,
 * canjes, cargos de mercado y lo demás. La cabecera viene en dos filas: «Fechas», con
 * `colspan=2`, se parte debajo en «Operación» y «Liquidación». Por eso las dos columnas de
 * fecha se localizan por su contenido (las dos primeras con alguna fecha) y no por su nombre.
 */
import { CERO, type Decimal } from "../../motor/decimal";
import type { Dia } from "../../motor/fechas";
import {
  ErrorDeFormato,
  ISIN,
  columnaObligatoria,
  indiceDeColumna,
  leerDivisa,
  leerFecha,
  leerNumero,
  limpiar,
  marcoDeTabla,
  plegar,
  type Marco
} from "./comun";

export type SentidoDelTraspaso = "SALE" | "ENTRA";

export interface OperacionLeida {
  documento: string;
  fila: number;
  /** Número correlativo entre todas las operaciones leídas, empezando en 1. */
  orden: number;
  textoOriginal: string;
  fechaOperacion: Dia;
  fechaLiquidacion: Dia;
  /** El tipo de operación tal como lo escribe el banco, en mayúsculas. */
  tipo: string;
  isin: string;
  nombre: string;
  /** Siempre en valor absoluto. */
  titulos: Decimal;
  divisa?: string;
  /** Precio neto en la divisa de la operación, en valor absoluto. */
  precio?: Decimal;
  /** Importe neto en la divisa de la operación, en valor absoluto. */
  importe: Decimal;
  traspaso?: SentidoDelTraspaso;
}

/** Las palabras que delatan la columna del tipo de operación. */
const TIPOS_CONOCIDOS = ["SUSCRIPCION", "REEMBOLSO", "COMPRA", "VENTA", "DIVIDENDO", "EQUIPARACION", "DCHOS", "DERECHOS", "TRASPASO", "CANJE", "CARGO GASTOS"];

/** `_transfer_direction`: «REEMB.POR TRASPASO…» sale y «SUSCR.POR TRASPASO…» entra. */
export function sentidoDelTraspaso(tipo: string): SentidoDelTraspaso | undefined {
  const plegado = plegar(tipo);
  if (!plegado.includes("traspaso")) return undefined;
  if (plegado.includes("suscr")) return "ENTRA";
  if (plegado.includes("reemb")) return "SALE";
  return undefined;
}

/** Si una tabla es un export de operaciones: su cabecera tiene ISIN, Importe neto y Títulos/NOMINAL. */
export function esTablaDeOperaciones(tabla: string[][]): boolean {
  const marco = marcoDeTabla(tabla);
  if (!marco) return false;
  const plegadas = marco.columnas.map(plegar);
  return plegadas.includes("isin") && plegadas.some((columna) => columna.includes("importe neto")) && plegadas.some((columna) => columna.includes("nominal"));
}

/** `_transfer_date_cols`: las dos primeras columnas con alguna fecha (operación y liquidación). */
function columnasDeFecha(marco: Marco, donde: string): [number, number] {
  const conFecha = marco.columnas
    .map((_, indice) => indice)
    .filter((indice) => marco.filas.some((fila) => leerFecha(fila.celdas[indice]) !== undefined));
  if (conFecha.length === 0) throw new ErrorDeFormato(`Falta la columna de fecha de operación en ${donde}. Carga el export original del banco.`);
  return [conFecha[0], conFecha.length > 1 ? conFecha[1] : conFecha[0]];
}

/** La columna del tipo de operación: la que más celdas tiene con un tipo conocido. */
function columnaDelTipo(marco: Marco, donde: string, excluidas: number[]): number {
  let mejor = -1;
  let cuenta = 0;
  marco.columnas.forEach((_, indice) => {
    if (excluidas.includes(indice)) return;
    const aciertos = marco.filas.filter((fila) => {
      const texto = limpiar(fila.celdas[indice]).toUpperCase();
      return TIPOS_CONOCIDOS.some((palabra) => texto.includes(palabra));
    }).length;
    if (aciertos > cuenta || (aciertos === cuenta && aciertos > 0 && indice > mejor)) {
      mejor = indice;
      cuenta = aciertos;
    }
  });
  if (mejor < 0) throw new ErrorDeFormato(`No se ha encontrado la columna del tipo de operación en ${donde}. Carga el export original del banco.`);
  return mejor;
}

/** Las operaciones de una tabla. `primerOrden` es el número correlativo de la primera. */
function leerTablaDeOperaciones(tabla: string[][], documento: string, primerOrden: number): OperacionLeida[] {
  /* «d» + `donde` se lee «del export…» en los mensajes. */
  const donde = `el export de operaciones «${documento}»`;
  const marco = marcoDeTabla(tabla);
  if (!marco) throw new ErrorDeFormato(`No se ha encontrado ninguna tabla en ${donde}.`);
  const { columnas } = marco;
  const [colFecha, colLiquidacion] = columnasDeFecha(marco, donde);
  const colIsin = columnaObligatoria(columnas, ["ISIN"], donde);
  const colNombre = columnaObligatoria(columnas, ["Valor"], donde);
  const colTitulos = columnaObligatoria(columnas, ["Títulos/NOMINAL", "Titulos/NOMINAL", "Ttulos/NOMINAL"], donde);
  const colDivisa = columnaObligatoria(columnas, ["Divisa"], donde);
  const colImporte = columnaObligatoria(columnas, ["Importe neto"], donde);
  const colPrecio = indiceDeColumna(columnas, ["Precio Neto"]);
  const colTipo = columnaDelTipo(marco, donde, [colIsin, colNombre]);

  const operaciones: OperacionLeida[] = [];
  for (const { celdas, fila, textoOriginal } of marco.filas) {
    const tipo = limpiar(celdas[colTipo]).toUpperCase();
    const traspaso = sentidoDelTraspaso(tipo);
    const isin = limpiar(celdas[colIsin]).toUpperCase();
    const fechaOperacion = leerFecha(celdas[colFecha]);
    if (!ISIN.test(isin)) {
      if (traspaso) throw new ErrorDeFormato(`El traspaso de la fila ${fila} d${donde} no tiene un ISIN válido.`);
      continue;
    }
    if (!fechaOperacion) {
      if (traspaso) throw new ErrorDeFormato(`El traspaso ${isin} de la fila ${fila} d${donde} no tiene una fecha válida.`);
      continue;
    }
    const divisa = leerDivisa(celdas[colDivisa]);
    const titulos = leerNumero(celdas[colTitulos])?.abs();
    const precio = colPrecio >= 0 ? leerNumero(celdas[colPrecio])?.abs() : undefined;
    const importe = leerNumero(celdas[colImporte])?.abs();
    if (traspaso) {
      if (!divisa) throw new ErrorDeFormato(`El traspaso ${isin} de la fila ${fila} d${donde} no tiene una divisa válida.`);
      if (!titulos || titulos.lte(0) || !precio || precio.lte(0) || !importe || importe.lte(0)) {
        throw new ErrorDeFormato(`El traspaso ${isin} de la fila ${fila} d${donde} no tiene títulos, precio e importe válidos.`);
      }
      const tolerancia = importe.times("0.001");
      if (titulos.times(precio).minus(importe).abs().gt(tolerancia.gt("0.05") ? tolerancia : "0.05")) {
        throw new ErrorDeFormato(`El traspaso ${isin} de la fila ${fila} d${donde} tiene títulos, precio e importe que no cuadran entre sí.`);
      }
    }
    operaciones.push({
      documento,
      fila,
      orden: primerOrden + operaciones.length,
      textoOriginal,
      fechaOperacion,
      fechaLiquidacion: leerFecha(celdas[colLiquidacion]) ?? fechaOperacion,
      tipo,
      isin,
      nombre: limpiar(celdas[colNombre]) || isin,
      titulos: titulos ?? CERO,
      divisa,
      precio,
      importe: importe ?? CERO,
      traspaso
    });
  }
  return operaciones;
}

/** Las operaciones de uno o varios documentos de operaciones, en el orden en que llegan. */
export function leerOperaciones(documentos: Array<{ nombre: string; tablas: string[][][] }>): OperacionLeida[] {
  const operaciones: OperacionLeida[] = [];
  for (const documento of documentos) {
    const tabla = documento.tablas.find(esTablaDeOperaciones);
    if (!tabla) throw new ErrorDeFormato(`No se ha encontrado la tabla de operaciones en «${documento.nombre}». Carga el export original del banco.`);
    operaciones.push(...leerTablaDeOperaciones(tabla, documento.nombre, operaciones.length + 1));
  }
  return operaciones;
}
