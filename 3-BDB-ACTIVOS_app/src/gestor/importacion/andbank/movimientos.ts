/**
 * El extracto de movimientos de la cuenta de efectivo de Andbank.
 *
 * Traslado de `parse_movements_html`, `_parse_movement_table`, `classify_movement`,
 * `split_concept` y `_chain_movement_extracts` de `parser.py`. Una diferencia deliberada: un
 * primer extracto que no empieza con saldo cero no es un error; su saldo inicial se devuelve
 * para que la propuesta lo anote como saldo inicial.
 */
import { CERO, d, redondear, type Decimal } from "../../motor/decimal";
import type { Dia } from "../../motor/fechas";
import {
  ErrorDeFormato,
  columnaObligatoria,
  fechaEnTexto,
  importeEnTexto,
  leerFecha,
  leerImporteDeMovimiento,
  limpiar,
  marcoDeTabla,
  plegar,
  type Marco
} from "./comun";

/** Lo que cabe en el concepto de un movimiento del export de Andbank: más largo, lo corta. */
export const LARGO_MAXIMO_DEL_CONCEPTO = 30;

export type ClaseDeMovimiento =
  | "APERTURA"
  | "REPO"
  | "COMPRA"
  | "VENTA"
  | "SUSCRIPCION"
  | "REEMBOLSO"
  | "DIVIDENDO"
  | "COMISION"
  | "INTERES"
  | "TRANSFERENCIA"
  | "OTRO";

export interface FilaDeMovimiento {
  documento: string;
  fila: number;
  textoOriginal: string;
  fechaOperacion: Dia;
  fechaValor?: Dia;
  clase: ClaseDeMovimiento;
  /** El tipo de operación tal como lo escribe el banco. */
  tipoTexto: string;
  concepto: string;
  /** El nombre del activo del concepto, o `undefined` si el concepto es de efectivo. */
  nombreActivo?: string;
  titulos?: Decimal;
  /** El concepto llena los 30 caracteres: los títulos de detrás de la arroba pueden haber perdido cifras. */
  titulosCortados: boolean;
  importe: Decimal;
  saldo: Decimal;
}

export interface ExtractoDeMovimientos {
  saldoInicial: Decimal;
  fechaSaldoInicial?: Dia;
  /** De dónde sale el saldo inicial: la fila «Saldo Inicio» del extracto, si la hay. */
  origenDelSaldoInicial?: { documento: string; fila: number; textoOriginal: string };
  filas: FilaDeMovimiento[];
}

/** «DEVOL. PRIMA EM. RV»: la devolución de prima de emisión, que es remuneración al accionista en efectivo. */
export function esDevolucionDePrima(tipo: string): boolean {
  return plegar(tipo).includes("prima em");
}

/**
 * `classify_movement`: la clase de un movimiento por su tipo de operación. El orden de las preguntas importa.
 *
 * Tres reglas que Python no tiene, medidas con extractos reales (13-11-2026): la devolución de prima de emisión es un
 * DIVIDENDO (remuneración al accionista en efectivo, y casa en el export con «DEVOL.PRIMA EMISION»); y los gastos de
 * correspondencia («COBRO ENVIO CORRESPONDENCIA SF», y su retrocesión) y de mantenimiento de un ADR («CARGO
 * MANTENIMIENTO ADR SF») son COMISION. El signo lo resuelve la propuesta: con importe positivo, son un abono del banco.
 */
export function clasificarMovimiento(tipo: string): ClaseDeMovimiento {
  const texto = limpiar(tipo).toUpperCase();
  if (texto.includes("APERTURA")) return "APERTURA";
  if (texto.includes("REPO")) return "REPO";
  if (texto.includes("COMPRA")) return "COMPRA";
  if (texto.includes("VENTA")) return "VENTA";
  if (texto.includes("SUSCRIP")) return "SUSCRIPCION";
  if (texto.includes("REEMBOLSO")) return "REEMBOLSO";
  if (texto.includes("DIVIDENDO") || esDevolucionDePrima(texto)) return "DIVIDENDO";
  if (texto.includes("COMISION") || texto.includes("COMISIN") || plegar(texto).includes("comision")) return "COMISION";
  if (texto.includes("CORRESPONDENCIA") || texto.includes("MANTENIMIENTO")) return "COMISION";
  if (texto.includes("INTERES") || plegar(texto).includes("interes")) return "INTERES";
  if (texto.includes("TRANSFERENCIA")) return "TRANSFERENCIA";
  return "OTRO";
}

/**
 * `split_concept`: «NOMBRE @ títulos». Los títulos con coma se leen en formato europeo; sin
 * coma, el punto es decimal (como en Python: «1.500» son 1,5 títulos).
 */
export function partirConcepto(concepto: string): { nombre?: string; titulos?: Decimal } {
  const texto = limpiar(concepto);
  if (!texto) return {};
  const partes = /^(.*?)@\s*([+-]?[\d.,]+)\s*$/.exec(texto);
  if (partes) {
    const bruto = partes[2];
    const normal = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
    const titulos = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(normal) ? d(normal) : undefined;
    return { nombre: partes[1].trim() || undefined, titulos };
  }
  return { nombre: texto.replace(/@+$/, "").trim() || undefined };
}

/** La columna de importe: de las que se llaman «Cargo Abono Importe», la que más importes válidos tiene. */
function columnaDeImporte(marco: Marco, documento: string): number {
  const candidatas = marco.columnas.map((columna, indice) => ({ indice, plegada: plegar(columna) })).filter((columna) => columna.plegada.includes("cargo abono importe"));
  if (candidatas.length === 0) throw new ErrorDeFormato(`Falta la columna de importe («Cargo Abono Importe») en ${documento}. Carga el export original del banco.`);
  const puntuadas = candidatas
    .map(({ indice }) => ({ indice, validos: marco.filas.filter((fila) => leerImporteDeMovimiento(fila.celdas[indice]) !== undefined).length }))
    .sort((a, b) => b.validos - a.validos || b.indice - a.indice);
  if (puntuadas[0].validos === 0) throw new ErrorDeFormato(`La columna de importe d${documento} no contiene importes válidos. Carga el export original del banco.`);
  return puntuadas[0].indice;
}

/** Si una tabla es un extracto de movimientos: su cabecera tiene el tipo de operación y el saldo. */
export function esTablaDeMovimientos(tabla: string[][]): boolean {
  const marco = marcoDeTabla(tabla);
  if (!marco) return false;
  const plegadas = marco.columnas.map(plegar);
  return plegadas.some((columna) => columna.includes("tipo de oper")) && plegadas.some((columna) => columna.includes("saldo"));
}

/** `_parse_movement_table`: un extracto, con su saldo inicial y el saldo comprobado fila a fila. */
export function leerTablaDeMovimientos(tabla: string[][], documento: string): ExtractoDeMovimientos {
  const marco = marcoDeTabla(tabla);
  /* «d» + `donde` se lee «del extracto…» en los mensajes. */
  const donde = `el extracto de movimientos «${documento}»`;
  if (!marco) throw new ErrorDeFormato(`No se ha encontrado ninguna tabla en ${donde}.`);
  const { columnas } = marco;
  const colFecha = columnaObligatoria(columnas, ["Fecha operación", "Fecha operacion", "Fecha operacin"], donde);
  const colFechaValor = columnaObligatoria(columnas, ["Fecha valor"], donde);
  const colTipo = columnaObligatoria(columnas, ["Tipo de operación", "Tipo de operacion", "Tipo de operacin"], donde);
  const colConcepto = columnaObligatoria(columnas, ["Concepto"], donde);
  const colImporte = columnaDeImporte(marco, donde);
  const colSaldo = columnaObligatoria(columnas, ["Saldo"], donde);

  let saldoInicial = CERO;
  let fechaSaldoInicial: Dia | undefined;
  let origenDelSaldoInicial: ExtractoDeMovimientos["origenDelSaldoInicial"];
  let acumulado: Decimal | undefined;
  const filas: FilaDeMovimiento[] = [];

  for (const { celdas, fila, textoOriginal } of marco.filas) {
    const tipoTexto = limpiar(celdas[colTipo]);
    if (tipoTexto === "Saldo Inicio") {
      if (filas.length === 0) {
        const declarado = leerImporteDeMovimiento(celdas[colSaldo]);
        saldoInicial = declarado ? redondear(declarado) : CERO;
        fechaSaldoInicial = leerFecha(celdas[colFecha]);
        origenDelSaldoInicial = { documento, fila, textoOriginal };
      }
      continue;
    }
    if (tipoTexto === "Saldo Final") continue;
    if (acumulado === undefined) acumulado = saldoInicial;

    const concepto = limpiar(celdas[colConcepto]);
    const { nombre, titulos } = partirConcepto(concepto);
    const importe = leerImporteDeMovimiento(celdas[colImporte]);
    const saldo = leerImporteDeMovimiento(celdas[colSaldo]);
    if (importe === undefined || saldo === undefined) {
      throw new ErrorDeFormato(`La fila ${fila} d${donde} no tiene un importe o un saldo válido. Carga el export original del banco.`);
    }
    const fechaOperacion = leerFecha(celdas[colFecha]);
    if (!fechaOperacion) {
      throw new ErrorDeFormato(`La fila ${fila} d${donde} no tiene una fecha de operación válida («${limpiar(celdas[colFecha])}»).`);
    }

    acumulado = redondear(acumulado.plus(importe));
    const declarado = redondear(saldo);
    if (acumulado.minus(declarado).abs().gt("0.01")) {
      throw new ErrorDeFormato(
        `El saldo no cuadra en la fila ${fila} d${donde}: sumando los importes sale ${importeEnTexto(acumulado)} €, y el extracto dice ${importeEnTexto(declarado)} €. ` +
          "Carga el export original del banco, sin filas añadidas ni borradas."
      );
    }

    filas.push({
      documento,
      fila,
      textoOriginal,
      fechaOperacion,
      fechaValor: leerFecha(celdas[colFechaValor]),
      clase: clasificarMovimiento(tipoTexto),
      tipoTexto,
      concepto,
      nombreActivo: nombre && !nombre.toUpperCase().startsWith("EFECTIVO") ? nombre : undefined,
      titulos,
      titulosCortados: titulos !== undefined && concepto.length >= LARGO_MAXIMO_DEL_CONCEPTO,
      importe,
      saldo
    });
  }
  return { saldoInicial, fechaSaldoInicial, origenDelSaldoInicial, filas };
}

/** `_movement_key`: lo que hace que dos filas de dos extractos sean la misma. */
function claveDeFila(fila: FilaDeMovimiento): string {
  return [fila.fechaOperacion, fila.tipoTexto, fila.concepto, redondear(fila.importe).toFixed(2), redondear(fila.saldo).toFixed(2)].join("\u0001");
}

/**
 * `_chain_movement_extracts`: une varios extractos de una misma cuenta en una sola historia,
 * comprobando que encadenan por el saldo. Andbank corta cada export en unas doscientas filas,
 * y los cortes se solapan en su frontera. Cada extracto tiene que empezar con un saldo por el
 * que pase la historia que ya se tiene, y las filas que se repiten tienen que ser las mismas.
 * Un extracto que ya está entero dentro de otro se ignora.
 *
 * A diferencia de Python, el primero puede empezar con cualquier saldo: es el saldo inicial.
 */
export function encadenarExtractos(partes: ExtractoDeMovimientos[]): ExtractoDeMovimientos {
  const ordenadas = partes
    .filter((parte) => parte.filas.length > 0)
    .sort((a, b) => {
      const fa = a.filas[0].fechaOperacion;
      const fb = b.filas[0].fechaOperacion;
      if (fa !== fb) return fa < fb ? -1 : 1;
      const sa = a.fechaSaldoInicial ?? "";
      const sb = b.fechaSaldoInicial ?? "";
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  if (ordenadas.length === 0) throw new ErrorDeFormato("El extracto de movimientos no tiene ningún movimiento. Comprueba que has descargado el periodo correcto.");
  const [primera, ...resto] = ordenadas;
  let unidas = [...primera.filas];
  for (const parte of resto) {
    const claves = parte.filas.map(claveDeFila);
    const clavesUnidas = unidas.map(claveDeFila);
    let unida = false;
    /* De la última fila hacia atrás: el punto de la historia cuyo saldo es el inicial del extracto, y desde el que lo
       que sigue coincide con su principio. `corte` es cuántas filas de lo que ya se tiene quedan antes de él. */
    for (let corte = unidas.length; corte >= 0; corte -= 1) {
      const saldoAntes = corte > 0 ? redondear(unidas[corte - 1].saldo) : primera.saldoInicial;
      if (saldoAntes.minus(parte.saldoInicial).abs().gt("0.01")) continue;
      const solape = clavesUnidas.slice(corte);
      const comunes = Math.min(solape.length, claves.length);
      let iguales = true;
      for (let i = 0; i < comunes; i += 1) {
        if (solape[i] !== claves[i]) {
          iguales = false;
          break;
        }
      }
      if (!iguales) continue;
      unidas = [...unidas, ...parte.filas.slice(comunes)];
      unida = true;
      break;
    }
    if (!unida) {
      const desde = parte.fechaSaldoInicial ?? parte.filas[0].fechaOperacion;
      throw new ErrorDeFormato(
        `Los extractos de movimientos no encadenan: el que empieza el ${fechaEnTexto(desde)} parte de un saldo de ${importeEnTexto(parte.saldoInicial)} € por el que no pasa el anterior. ` +
          "Comprueba que son de la misma cuenta y que no falta ninguno entre medias."
      );
    }
  }
  return { ...primera, filas: unidas };
}

/**
 * Los movimientos de efectivo de uno o varios documentos de movimientos, ya encadenados.
 * Se leen todas sus tablas de movimientos; las demás tablas del documento se ignoran.
 */
export function leerMovimientos(documentos: Array<{ nombre: string; tablas: string[][][] }>): ExtractoDeMovimientos {
  const partes: ExtractoDeMovimientos[] = [];
  for (const documento of documentos) {
    const tablas = documento.tablas.filter(esTablaDeMovimientos);
    if (tablas.length === 0) {
      throw new ErrorDeFormato(`No se ha encontrado la tabla de movimientos en «${documento.nombre}». Carga el export original del banco.`);
    }
    for (const tabla of tablas) partes.push(leerTablaDeMovimientos(tabla, documento.nombre));
  }
  return encadenarExtractos(partes);
}
