/**
 * Piezas comunes de los lectores de Andbank: limpieza de texto, columnas, números y fechas.
 *
 * Traslado de `functions_python/portfolio_real/parser.py` (borrado el 17-11-2026; está en la
 * etiqueta de Git `referencia-portfolio-real-2026-11-17`), que salió de extractos reales: cada regla de aquí
 * tiene allí su razón. Los números se leen con aritmética decimal exacta,
 * nunca con coma flotante.
 */
import { d, type Decimal } from "../../motor/decimal";
import { esDia, type Dia } from "../../motor/fechas";
import { DIVISAS_MENORES } from "../../mercado/cargar";

/** Un error de formato de un extracto: el mensaje es para el usuario y dice qué hacer. */
export class ErrorDeFormato extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeFormato";
  }
}

export const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const DIVISA = /^[A-Z]{3}$/;
/**
 * Las divisas en céntimos se distinguen por la caja («GBp»): pasarlas a mayúsculas las confundiría con la libra. Son las que
 * el cargador de mercado convierte con el cambio de su divisa mayor por cien (`DIVISAS_MENORES`).
 */
export const DIVISAS_EN_CENTIMOS: ReadonlySet<string> = new Set(Object.keys(DIVISAS_MENORES));

/** `_clean_text`: sin espacios duros ni el carácter de sustitución de una mala codificación. */
export function limpiar(valor: string | undefined): string {
  return (valor ?? "").replace(/\u00a0/g, " ").replace(/\ufffd/g, "").trim();
}

/** `_fold`: minúsculas sin tildes, y todo lo que no es letra, cifra o punto, un espacio. */
export function plegar(valor: string | undefined): string {
  return limpiar(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `normalize_catalog_name` (decisión B-71): la forma común con la que se comparan dos nombres
 * de activo. Sin tildes, en mayúsculas, «&» como «AND», puntos y apóstrofos borrados, cualquier
 * otro signo convertido en espacio y los espacios colapsados.
 */
export function normalizarNombre(valor: string | undefined): string {
  return (valor ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[.'’‘`\u00b4]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Si dos nombres normalizados son el mismo activo: uno es el principio del otro (el banco corta los conceptos). */
export function nombresCasan(a: string, b: string): boolean {
  return a !== "" && b !== "" && (a.startsWith(b) || b.startsWith(a));
}

/**
 * La divisa tal como llega, en mayúsculas salvo la caja de las divisas en céntimos: «GBp» se queda «GBp», «eur» es «EUR».
 * No comprueba que sea una divisa. `undefined` si la celda está vacía.
 */
export function divisaComoLlega(valor: string | undefined): string | undefined {
  const texto = limpiar(valor);
  if (texto === "") return undefined;
  return DIVISAS_EN_CENTIMOS.has(texto) ? texto : texto.toUpperCase();
}

/** La divisa como la escribe el banco, conservando la caja de las divisas en céntimos. `undefined` si no es una divisa. */
export function leerDivisa(valor: string | undefined): string | undefined {
  const divisa = divisaComoLlega(valor);
  return divisa !== undefined && (DIVISAS_EN_CENTIMOS.has(divisa) || DIVISA.test(divisa)) ? divisa : undefined;
}

/* ------------------------------------------------------------------ tablas */

/** Una tabla con su cabecera ya localizada. Las filas van rellenas o cortadas al ancho de la cabecera. */
export interface Marco {
  columnas: string[];
  filas: Array<{
    celdas: string[];
    /** Posición de la fila en la tabla, empezando en 1 y contando la cabecera. */
    fila: number;
    textoOriginal: string;
  }>;
}

/** `_dedupe_columns`: una columna repetida se llama «Nombre.1», «Nombre.2»… */
function sinRepetidas(columnas: string[]): string[] {
  const vistas = new Map<string, number>();
  return columnas.map((bruta) => {
    const nombre = limpiar(bruta);
    const veces = vistas.get(nombre) ?? 0;
    vistas.set(nombre, veces + 1);
    return veces === 0 ? nombre : `${nombre}.${veces}`;
  });
}

/**
 * `_table_frame`: la cabecera es la primera fila con una celda «ISIN» o con una celda que
 * contenga «tipo de oper»; si no hay ninguna, la primera fila.
 */
export function marcoDeTabla(tabla: string[][]): Marco | undefined {
  const filas = tabla.filter((fila) => fila.some((celda) => limpiar(celda) !== ""));
  if (filas.length === 0) return undefined;
  let indiceDeCabecera = filas.findIndex((fila) => {
    const plegadas = fila.map(plegar);
    return plegadas.includes("isin") || plegadas.some((celda) => celda.includes("tipo de oper"));
  });
  if (indiceDeCabecera < 0) indiceDeCabecera = 0;
  const columnas = sinRepetidas(filas[indiceDeCabecera]);
  const ancho = columnas.length;
  return {
    columnas,
    filas: filas.slice(indiceDeCabecera + 1).map((fila, indice) => {
      const celdas = fila.slice(0, ancho);
      while (celdas.length < ancho) celdas.push("");
      return { celdas, fila: indiceDeCabecera + 2 + indice, textoOriginal: fila.map(limpiar).join(" | ") };
    })
  };
}

/** `_find_col`: primero el nombre exacto (plegado) y luego que lo contenga. -1 si no está. */
export function indiceDeColumna(columnas: string[], alias: string[]): number {
  const plegadas = columnas.map(plegar);
  for (const nombre of alias) {
    const indice = plegadas.indexOf(plegar(nombre));
    if (indice >= 0) return indice;
  }
  for (const nombre of alias) {
    const buscado = plegar(nombre);
    const indice = plegadas.findIndex((columna) => buscado !== "" && columna.includes(buscado));
    if (indice >= 0) return indice;
  }
  return -1;
}

/** Como `indiceDeColumna`, pero si falta la columna es un error que dice cuál y en qué documento. */
export function columnaObligatoria(columnas: string[], alias: string[], documento: string): number {
  const indice = indiceDeColumna(columnas, alias);
  if (indice < 0) {
    throw new ErrorDeFormato(`Falta la columna «${alias[0]}» en ${documento}. Carga el export original del banco, sin cambiar sus columnas.`);
  }
  return indice;
}

/* ------------------------------------------------------------------ números */

/** Formato de un importe para un mensaje: «1.234,56». */
export function importeEnTexto(valor: Decimal): string {
  const [entera, decimales] = valor.abs().toFixed(2).split(".");
  const conMillares = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${valor.lt(0) ? "-" : ""}${conMillares},${decimales}`;
}

/**
 * `parse_amount_mov`: un importe del extracto de movimientos. Regla validada con extractos
 * reales: con coma, formato europeo («1.234,56»); sin coma, los dos últimos dígitos son los
 * céntimos («18000» son 180,00). Un punto sin coma es ambiguo y es un error.
 * `undefined` si la celda está vacía o no es una cifra.
 */
export function leerImporteDeMovimiento(bruto: string | undefined): Decimal | undefined {
  const texto = (bruto ?? "").trim().replace(/\u00a0/g, "").replace(/ /g, "");
  if (texto === "" || texto.toLowerCase() === "nan") return undefined;
  const negativo = texto.startsWith("-");
  const cuerpo = texto.replace(/^[+-]+/, "");
  if (!/^[\d.,]+$/.test(cuerpo)) return undefined;
  if (cuerpo.includes(".") && !cuerpo.includes(",")) {
    throw new ErrorDeFormato(
      `Importe ambiguo en el extracto de movimientos («${texto}»): un punto sin coma puede ser de millares o decimal, y no se adivina. Exporta el extracto de nuevo desde el banco sin abrirlo antes en una hoja de cálculo.`
    );
  }
  let valor: Decimal;
  if (cuerpo.includes(",")) {
    const normal = cuerpo.replace(/\./g, "").replace(",", ".");
    if (!/^(\d+\.?\d*|\.\d+)$/.test(normal)) {
      throw new ErrorDeFormato(`Importe con formato no válido en el extracto de movimientos («${texto}»). Carga el export original del banco.`);
    }
    valor = d(normal);
  } else {
    valor = d(cuerpo).div(100);
  }
  return negativo ? valor.times(-1) : valor;
}

/**
 * `parse_num_pos`: una cifra de posiciones u operaciones. Con coma y punto, el punto es de
 * millares; solo con coma, la coma es decimal; solo con punto, el punto es decimal.
 * `undefined` si no es una cifra.
 */
export function leerNumero(bruto: string | undefined): Decimal | undefined {
  let texto = (bruto ?? "").trim().replace(/\u00a0/g, "").replace(/ /g, "");
  if (texto === "" || texto.toLowerCase() === "nan" || !/\d/.test(texto)) return undefined;
  texto = texto.replace(/[^0-9.,+-]/g, "");
  if (texto.includes(",") && texto.includes(".")) texto = texto.replace(/\./g, "").replace(/,/g, ".");
  else if (texto.includes(",")) texto = texto.replace(/,/g, ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(texto)) return undefined;
  return d(texto);
}

/* ------------------------------------------------------------------ fechas */

/** `_parse_date`: «dd/mm/aaaa» o «aaaa-mm-dd» (día y mes pueden ir con una cifra). `undefined` si no es una fecha real. */
export function leerFecha(bruto: string | undefined): Dia | undefined {
  const texto = limpiar(bruto);
  let anio: string;
  let mes: string;
  let dia: string;
  const europea = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(texto);
  if (europea) [, dia, mes, anio] = europea;
  else if (iso) [, anio, mes, dia] = iso;
  else return undefined;
  const resultado = `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  return esDia(resultado) ? resultado : undefined;
}

/** «2025-01-31» → «31/01/2025», para los mensajes. */
export function fechaEnTexto(dia: Dia): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}
