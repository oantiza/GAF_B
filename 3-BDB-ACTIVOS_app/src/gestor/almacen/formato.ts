/**
 * El formato del fichero de una cartera: cómo se escribe y cómo se lee, con su versión.
 *
 * Un fichero es un JSON con cuatro claves: `formato` (siempre «gestor-carteras»), `version`
 * (entero), `guardado` (fecha y hora ISO de la escritura) y `cartera`.
 *
 * ESCRITURA DETERMINISTA. La misma cartera produce el mismo texto byte a byte salvo la línea
 * de `guardado`: sangría de dos espacios, LF, salto de línea final, y las claves de cada objeto
 * en un orden fijo (primero la identidad, luego el resto en un orden legible; las claves que
 * el orden no conoce van al final, alfabéticas). Los arrays conservan su orden. Así dos
 * versiones de un fichero se comparan con cualquier herramienta de diferencias.
 *
 * COMPATIBILIDAD HACIA DELANTE. Nada se pierde al leer ni al escribir: `cartera.extensiones`
 * y cualquier campo desconocido de la cartera o de sus elementos se conservan tal cual.
 *
 * LECTURA TOLERANTE PERO SEGURA. `leer` comprueba la estructura (lo que hace falta para que
 * el motor pueda abrir la cartera y para que un error se pueda explicar) y no la semántica de
 * cada tipo de movimiento, que valida el motor al abrir.
 */
import { esDecimal } from "../motor/decimal";
import { esDia } from "../motor/fechas";
import type { Cartera } from "../motor/modelo";
import { MIGRACIONES, type Migraciones } from "./migraciones/registro";

export const FORMATO = "gestor-carteras";
export const VERSION_ACTUAL = 1;

export interface FicheroDeCartera {
  formato: typeof FORMATO;
  version: number;
  /** Fecha y hora ISO en que se escribió el fichero. */
  guardado: string;
  cartera: Cartera;
}

export interface CarteraLeida {
  cartera: Cartera;
  /** La versión del formato con la que estaba escrito el fichero. */
  versionOriginal: number;
  /** Si se le aplicó alguna migración al leerlo. */
  migrada: boolean;
}

export type CodigoDeErrorDeFormato = "NO_ES_JSON" | "NO_ES_UNA_CARTERA" | "VERSION_POSTERIOR" | "SIN_MIGRACION" | "ESTRUCTURA";

/** Un fichero que no se puede leer como cartera. El mensaje está en lenguaje llano, para enseñarlo. */
export class ErrorDeFormato extends Error {
  readonly codigo: CodigoDeErrorDeFormato;

  constructor(codigo: CodigoDeErrorDeFormato, mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeFormato";
    this.codigo = codigo;
  }
}

/* ------------------------------------------------------------------ escritura */

/** El orden de las claves de un objeto y el de los objetos que cuelgan de él. */
export interface Esquema {
  claves?: readonly string[];
  campos?: Readonly<Record<string, Esquema>>;
  /** El esquema de cada elemento, si el valor es un array. */
  elemento?: Esquema;
}

const CUENTA: Esquema = { claves: ["nombre", "entidad", "identificador"] };

const ACTIVO: Esquema = {
  claves: ["id", "nombre", "tipo", "divisa", "isin", "ticker", "origen", "multiplicador", "bono", "clasificacion"],
  campos: {
    bono: { claves: ["cupon", "frecuencia", "vencimiento", "emision", "base", "amortizacion"] },
    clasificacion: { claves: ["claseDeActivo", "region", "sector", "gastosCorrientes"] }
  }
};

const MOVIMIENTO: Esquema = {
  claves: [
    "id", "tipo", "fechaOperacion", "fechaValor", "fechaEx", "activoId", "titulos", "precio", "divisa", "importe",
    "comision", "gastos", "retencion", "cuponCorrido", "cambio", "valor", "destino", "razon",
    "serieAjustada", "conceptoCliente", "nota", "origen"
  ],
  campos: {
    destino: { claves: ["activoId", "titulos", "precio", "divisa", "importe", "fecha"] },
    origen: { claves: ["via", "importacionId", "documento", "fila", "textoOriginal"] }
  }
};

const EXTRACTO: Esquema = {
  claves: ["id", "fecha", "entidad", "documento", "importacionId", "posiciones", "efectivo"],
  campos: {
    posiciones: { elemento: { claves: ["activoId", "isin", "nombre", "titulos", "valor", "precio", "divisa", "fecha"] } },
    efectivo: { elemento: { claves: ["divisa", "saldo"] } }
  }
};

const CARTERA: Esquema = {
  claves: [
    "id", "nombre", "divisaBase", "creada", "modificada", "cliente", "referencia", "cuentas", "notas",
    "activos", "movimientos", "preciosManuales", "extractos", "importaciones", "extensiones"
  ],
  campos: {
    cliente: { claves: ["id", "nombre"] },
    referencia: { claves: ["activoId", "nombre"] },
    cuentas: { claves: ["efectivo", "valores"], campos: { efectivo: CUENTA, valores: CUENTA } },
    activos: { elemento: ACTIVO },
    movimientos: { elemento: MOVIMIENTO },
    preciosManuales: { elemento: { claves: ["activoId", "fecha", "precio"] } },
    extractos: { elemento: EXTRACTO },
    importaciones: {
      elemento: {
        claves: ["id", "fecha", "entidad", "documentos", "movimientos"],
        campos: { documentos: { elemento: { claves: ["nombre", "tipo"] } } }
      }
    }
  }
};

const FICHERO: Esquema = { claves: ["formato", "version", "guardado", "cartera"], campos: { cartera: CARTERA } };

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Copia un valor con las claves de cada objeto en el orden de su esquema. Las claves que el
 * esquema no nombra van detrás, en orden alfabético por código (no depende del idioma del
 * navegador). Las claves con `undefined` desaparecen, como haría `JSON.stringify`.
 */
export function ordenarClaves(valor: unknown, esquema?: Esquema): unknown {
  if (Array.isArray(valor)) return valor.map((elemento) => ordenarClaves(elemento, esquema?.elemento));
  if (!esObjeto(valor)) return valor;
  const conocidas = esquema?.claves ?? [];
  const resto = Object.keys(valor)
    .filter((clave) => !conocidas.includes(clave))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const salida: Record<string, unknown> = {};
  for (const clave of [...conocidas, ...resto]) {
    if (!(clave in valor) || valor[clave] === undefined) continue;
    salida[clave] = ordenarClaves(valor[clave], esquema?.campos?.[clave]);
  }
  return salida;
}

/** El texto del fichero: JSON con sangría de dos espacios, claves en orden estable, LF, y un salto de línea final. */
export function serializar(cartera: Cartera, ahora: string = new Date().toISOString()): string {
  const fichero: FicheroDeCartera = { formato: FORMATO, version: VERSION_ACTUAL, guardado: ahora, cartera };
  return `${JSON.stringify(ordenarClaves(fichero, FICHERO), null, 2)}\n`;
}

/**
 * El texto sin la línea de `guardado`: lo que hay que comparar para saber si dos ficheros
 * guardan la misma cartera. Solo vale para textos escritos por `serializar`.
 */
export function sinMarcaDeGuardado(texto: string): string {
  return texto.replace(/^ {2}"guardado": "[^"\n]*",\n/m, "");
}

/* ------------------------------------------------------------------ lectura */

/** Lee el texto de un fichero. Lanza `ErrorDeFormato` (con mensaje en lenguaje llano) si no se puede leer. */
export function leer(texto: string, migraciones: Migraciones = MIGRACIONES): CarteraLeida {
  return leerConVersion(texto, migraciones, VERSION_ACTUAL);
}

/**
 * `leer` con la versión actual como parámetro. Existe para probar la cadena de migraciones
 * mientras solo hay una versión del formato; la aplicación usa `leer`.
 */
export function leerConVersion(texto: string, migraciones: Migraciones, versionActual: number): CarteraLeida {
  let datos: unknown;
  try {
    datos = JSON.parse(texto.replace(/^\uFEFF/, ""));
  } catch {
    throw new ErrorDeFormato("NO_ES_JSON", "El fichero no es una cartera del gestor: su contenido no es un JSON válido. Puede estar dañado o ser otro tipo de fichero.");
  }
  if (!esObjeto(datos) || datos.formato !== FORMATO) {
    throw new ErrorDeFormato("NO_ES_UNA_CARTERA", "El fichero no es una cartera del gestor de carteras.");
  }
  const versionOriginal = datos.version;
  if (typeof versionOriginal !== "number" || !Number.isInteger(versionOriginal) || versionOriginal < 1) {
    throw new ErrorDeFormato("ESTRUCTURA", "El fichero no dice con qué versión del formato se guardó.");
  }
  if (versionOriginal > versionActual) {
    throw new ErrorDeFormato(
      "VERSION_POSTERIOR",
      `Esta cartera se guardó con una versión más nueva del gestor (formato ${versionOriginal}). Actualiza la aplicación para abrirla.`
    );
  }

  let fichero: Record<string, unknown> = datos;
  for (let version = versionOriginal; version < versionActual; version += 1) {
    const migracion = migraciones[version];
    if (migracion === undefined) {
      throw new ErrorDeFormato(
        "SIN_MIGRACION",
        `Esta cartera está guardada con el formato ${versionOriginal} y esta versión del gestor no sabe pasarla del formato ${version} al ${version + 1}.`
      );
    }
    try {
      fichero = migracion(fichero);
    } catch (error) {
      const detalle = error instanceof Error ? ` (${error.message})` : "";
      throw new ErrorDeFormato("ESTRUCTURA", `No se pudo pasar la cartera del formato ${version} al ${version + 1}${detalle}.`);
    }
    if (!esObjeto(fichero)) {
      throw new ErrorDeFormato("ESTRUCTURA", `La conversión del formato ${version} al ${version + 1} no devolvió una cartera.`);
    }
    fichero = { ...fichero, version: version + 1 };
  }

  const cartera = validarCartera(fichero.cartera, typeof fichero.guardado === "string" ? fichero.guardado : undefined);
  return { cartera, versionOriginal, migrada: versionOriginal < versionActual };
}

/* ------------------------------------------------------------------ estructura */

function falla(mensaje: string): never {
  throw new ErrorDeFormato("ESTRUCTURA", mensaje);
}

function esTextoConContenido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim() !== "";
}

/** Nombres llanos de los campos decimales, para los mensajes. */
const NOMBRE_DEL_CAMPO: Readonly<Record<string, string>> = {
  titulos: "un número de títulos",
  precio: "un precio",
  importe: "un importe",
  comision: "una comisión",
  gastos: "unos gastos",
  retencion: "una retención",
  cuponCorrido: "un cupón corrido",
  cambio: "un tipo de cambio",
  valor: "un valor",
  razon: "una proporción",
  multiplicador: "un multiplicador",
  cupon: "un cupón",
  amortizacion: "un precio de amortización",
  gastosCorrientes: "unos gastos corrientes",
  saldo: "un saldo"
};

/** Comprueba que los campos decimales PRESENTES de un objeto son decimales válidos. */
function decimales(objeto: Record<string, unknown>, campos: readonly string[], quien: string): void {
  for (const campo of campos) {
    if (!(campo in objeto) || objeto[campo] === undefined) continue;
    const valor = objeto[campo];
    if (!esDecimal(valor)) {
      const mostrado = typeof valor === "string" ? `«${valor}»` : JSON.stringify(valor);
      falla(`${quien} tiene ${NOMBRE_DEL_CAMPO[campo] ?? `un campo «${campo}»`} que no es un número decimal válido (${mostrado}).`);
    }
  }
}

function diaOpcional(objeto: Record<string, unknown>, campo: string, mensaje: string): void {
  if (campo in objeto && objeto[campo] !== undefined && !esDia(objeto[campo])) falla(mensaje);
}

/** Un array de la cartera: si falta, vacío; si es otra cosa, error. Cada elemento, un objeto. */
function lista(cartera: Record<string, unknown>, campo: string, nombre: string, elemento: string): Record<string, unknown>[] {
  const valor = cartera[campo];
  if (valor === undefined) return [];
  if (!Array.isArray(valor)) falla(`La lista de ${nombre} de la cartera no es una lista.`);
  valor.forEach((item, indice) => {
    if (!esObjeto(item)) falla(`${elemento} ${indice + 1} no tiene la forma esperada.`);
  });
  return valor as Record<string, unknown>[];
}

function validarCartera(valor: unknown, guardado: string | undefined): Cartera {
  if (!esObjeto(valor)) falla("El fichero no contiene ninguna cartera.");
  const c: Record<string, unknown> = { ...valor };

  if (!esTextoConContenido(c.id)) falla("La cartera no tiene identificador.");
  if (typeof c.nombre !== "string") falla("La cartera no tiene nombre.");
  if (!esTextoConContenido(c.divisaBase)) falla("La cartera no tiene divisa base.");
  if (!esObjeto(c.cuentas)) falla("La cartera no tiene sus cuentas de efectivo y de valores.");
  for (const [clave, nombre] of [["efectivo", "de efectivo"], ["valores", "de valores"]] as const) {
    const cuenta = c.cuentas[clave];
    if (!esObjeto(cuenta) || typeof cuenta.nombre !== "string") falla(`La cuenta ${nombre} de la cartera no tiene nombre.`);
  }
  /* Las fechas de alta y modificación las pone el gestor; si un fichero no las trae, la del
     propio guardado es la mejor aproximación honesta. */
  for (const campo of ["creada", "modificada"] as const) {
    if (c[campo] === undefined) c[campo] = guardado ?? "";
    else if (typeof c[campo] !== "string") falla(`La fecha «${campo}» de la cartera no es una fecha.`);
  }

  const activos = lista(c, "activos", "activos", "El activo");
  activos.forEach((activo, i) => {
    const quien = `El activo ${i + 1}`;
    if (!esTextoConContenido(activo.id)) falla(`${quien} no tiene identificador.`);
    decimales(activo, ["multiplicador"], quien);
    if (activo.bono !== undefined) {
      if (!esObjeto(activo.bono)) falla(`${quien} tiene unas condiciones de bono que no tienen la forma esperada.`);
      decimales(activo.bono, ["cupon", "amortizacion"], `El bono del activo ${i + 1}`);
      diaOpcional(activo.bono, "vencimiento", `El bono del activo ${i + 1} tiene una fecha de vencimiento que no es un día válido.`);
      diaOpcional(activo.bono, "emision", `El bono del activo ${i + 1} tiene una fecha de emisión que no es un día válido.`);
    }
    if (activo.clasificacion !== undefined) {
      if (!esObjeto(activo.clasificacion)) falla(`${quien} tiene una clasificación que no tiene la forma esperada.`);
      decimales(activo.clasificacion, ["gastosCorrientes"], quien);
    }
  });

  const movimientos = lista(c, "movimientos", "movimientos", "El movimiento");
  movimientos.forEach((movimiento, i) => {
    const quien = `El movimiento ${i + 1}`;
    if (!esTextoConContenido(movimiento.id)) falla(`${quien} no tiene identificador.`);
    if (!esTextoConContenido(movimiento.tipo)) falla(`${quien} no tiene tipo.`);
    if (movimiento.fechaOperacion === undefined) falla(`${quien} no tiene fecha de operación.`);
    if (!esDia(movimiento.fechaOperacion)) falla(`${quien} tiene una fecha de operación que no es un día válido.`);
    diaOpcional(movimiento, "fechaValor", `${quien} tiene una fecha valor que no es un día válido.`);
    diaOpcional(movimiento, "fechaEx", `${quien} tiene una fecha ex-dividendo que no es un día válido.`);
    if (movimiento.conceptoCliente !== undefined && typeof movimiento.conceptoCliente !== "string") falla(`${quien} tiene un concepto para el cliente que no es un texto.`);
    decimales(movimiento, ["titulos", "precio", "importe", "comision", "gastos", "retencion", "cuponCorrido", "cambio", "valor", "razon"], quien);
    if (movimiento.destino !== undefined) {
      if (!esObjeto(movimiento.destino)) falla(`${quien} tiene un destino que no tiene la forma esperada.`);
      decimales(movimiento.destino, ["titulos", "precio", "importe"], `El destino del movimiento ${i + 1}`);
      diaOpcional(movimiento.destino, "fecha", `El destino del movimiento ${i + 1} tiene una fecha que no es un día válido.`);
    }
  });

  const precios = lista(c, "preciosManuales", "precios manuales", "El precio manual");
  precios.forEach((precio, i) => {
    const quien = `El precio manual ${i + 1}`;
    if (!esTextoConContenido(precio.activoId)) falla(`${quien} no dice de qué activo es.`);
    if (!esDia(precio.fecha)) falla(`${quien} no tiene una fecha válida.`);
    if (precio.precio === undefined) falla(`${quien} no tiene precio.`);
    decimales(precio, ["precio"], quien);
  });

  const extractos = lista(c, "extractos", "extractos", "El extracto");
  extractos.forEach((extracto, i) => {
    const quien = `El extracto ${i + 1}`;
    if (!esTextoConContenido(extracto.id)) falla(`${quien} no tiene identificador.`);
    if (!esDia(extracto.fecha)) falla(`${quien} no tiene una fecha válida.`);
    const posiciones = lista(extracto, "posiciones", `posiciones del extracto ${i + 1}`, `La posición del extracto ${i + 1} número`);
    posiciones.forEach((posicion, j) => {
      decimales(posicion, ["titulos", "valor", "precio"], `La posición ${j + 1} del extracto ${i + 1}`);
      if (posicion.divisa !== undefined && !esTextoConContenido(posicion.divisa)) falla(`La posición ${j + 1} del extracto ${i + 1} tiene una divisa que no es un texto.`);
      diaOpcional(posicion, "fecha", `La posición ${j + 1} del extracto ${i + 1} tiene una fecha de cotización que no es un día válido.`);
    });
    const efectivo = lista(extracto, "efectivo", `saldos de efectivo del extracto ${i + 1}`, `El saldo del extracto ${i + 1} número`);
    efectivo.forEach((saldo, j) => decimales(saldo, ["saldo"], `El saldo de efectivo ${j + 1} del extracto ${i + 1}`));
    extracto.posiciones = posiciones;
    extracto.efectivo = efectivo;
  });

  const importaciones = lista(c, "importaciones", "importaciones", "La importación");
  importaciones.forEach((importacion, i) => {
    if (!esTextoConContenido(importacion.id)) falla(`La importación ${i + 1} no tiene identificador.`);
  });

  if (c.extensiones !== undefined && !esObjeto(c.extensiones)) falla("Las extensiones de la cartera no tienen la forma esperada.");

  c.activos = activos;
  c.movimientos = movimientos;
  c.preciosManuales = precios;
  c.extractos = extractos;
  c.importaciones = importaciones;
  return c as unknown as Cartera;
}
