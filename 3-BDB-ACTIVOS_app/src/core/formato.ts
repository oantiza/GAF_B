/**
 * El módulo único de formato: cómo se escribe una cifra o una fecha en la pantalla, en los gráficos, en el motor del
 * gestor y en los PDF. Las reglas son las del apartado 6 de `docs/frontend/SISTEMA_DISENO.md`, y cada una tiene su
 * prueba en `tests/formato.test.ts`.
 *
 * 1. Lo que falta no se formatea: con `null`, `undefined`, `NaN` o un infinito, toda función devuelve `null`, y el
 *    texto de ausencia lo pone quien pinta (la pieza `Ausencia`). Donde solo cabe texto, `oFalta`.
 * 2. Los porcentajes se reciben siempre como fracción: 0,1039 es un 10,39 %. Quien tenga puntos divide entre 100.
 * 3. Punto de millar siempre, también en cuatro cifras («1.234,56»).
 * 4. Espacio duro (U+00A0) entre la cifra y su unidad: no se parten al saltar de línea.
 * 5. El menos es el tipográfico (U+2212); el «+» solo donde la función lo dice.
 * 6. Un cero no lleva signo: lo que redondea a cero se escribe como cero.
 * 7. Redondeo de `Intl` (medio hacia fuera) sobre la escritura decimal corta del número. Por eso un porcentaje se
 *    escala corriendo la coma en esa escritura y no multiplicando: 0,00035 × 100 da 0,034999… en coma flotante, y
 *    el 0,035 que se ve se redondea a 0,04.
 * 8. Un día «AAAA-MM-DD» se pinta tal cual, sin pasar por un huso; un instante, en la hora local.
 * 9. Los meses abreviados son una lista propia, no los de `Intl` («sept» en unos motores y «sep» en otros).
 * 10. Es puro: no importa nada de pantalla.
 *
 * De `Intl` solo se toman los dígitos ya redondeados. El signo, los separadores y los espacios los pone este módulo,
 * para que la salida sea la misma en cualquier motor, tenga los datos de idioma que tenga.
 */
import { textoDeAusencia } from "./textoDeAusencia";

const ESPACIO_DURO = "\u00a0";
const MENOS = "\u2212";

export type Signo = "sube" | "baja" | "neutro";

export interface OpcionesDeImporte {
  /** Código ISO de la divisa. Por defecto «EUR», que se escribe «€»; cualquier otra, su código. `null`: sin unidad. */
  divisa?: string | null;
  decimales?: number;
  /** Pone «+» delante de lo positivo (nunca de lo que se escribe como cero). */
  conSigno?: boolean;
}

export interface OpcionesDeCifra {
  decimales?: number;
  conSigno?: boolean;
}

/** Un día «AAAA-MM-DD», una fecha de JavaScript o un instante en texto ISO. */
export type FechaDeEntrada = string | Date | null | undefined;

function esCifra(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

/* ---------------------------------------------------------------- cifras */

const FORMATOS = new Map<string, Intl.NumberFormat>();

function formatoDe(minimo: number, maximo: number): Intl.NumberFormat {
  const clave = `${minimo}-${maximo}`;
  let formato = FORMATOS.get(clave);
  if (!formato) {
    formato = new Intl.NumberFormat("es-ES", { minimumFractionDigits: minimo, maximumFractionDigits: maximo, useGrouping: false });
    FORMATOS.set(clave, formato);
  }
  return formato;
}

/** Corre la coma `exponente` posiciones sobre la escritura decimal corta del número, no multiplicando. */
function desplazar(valor: number, exponente: number): number {
  if (exponente === 0) return valor;
  const corto = String(valor);
  return corto.includes("e") ? valor * 10 ** exponente : Number(`${corto}e${exponente}`);
}

/**
 * La cifra, con su signo y sus millares, sin unidad. `exponente` corre la coma antes de redondear: 2 para un
 * porcentaje, −6 para millones.
 */
function cifra(valor: number, minimo: number, maximo: number, conSigno = false, exponente = 0): string {
  const partes = formatoDe(minimo, maximo).formatToParts(desplazar(Math.abs(valor), exponente));
  const entero = partes.filter((p) => p.type === "integer").map((p) => p.value).join("");
  const fraccion = partes.filter((p) => p.type === "fraction").map((p) => p.value).join("");
  const conMillares = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const texto = fraccion ? `${conMillares},${fraccion}` : conMillares;
  if (!/[1-9]/.test(texto)) return texto;
  if (valor < 0) return `${MENOS}${texto}`;
  return conSigno && valor > 0 ? `+${texto}` : texto;
}

function conUnidad(texto: string, unidad: string | null): string {
  return unidad === null ? texto : `${texto}${ESPACIO_DURO}${unidad}`;
}

/**
 * La unidad de un importe. El euro es «€». Cualquier otra divisa, su código **como llega**: «GBp» y «GBX» son peniques,
 * y pasados a mayúsculas («GBP», libras) dirían un precio cien veces mayor. Solo un código escrito entero en minúsculas
 * («usd») se pasa a mayúsculas, que es lo que quiso decir quien lo escribió.
 */
function unidadDeDivisa(divisa: string | null | undefined): string | null {
  if (divisa === null) return null;
  const recibido = (divisa ?? "EUR").trim();
  if (recibido.toUpperCase() === "EUR") return "€";
  return recibido === recibido.toLowerCase() ? recibido.toUpperCase() : recibido;
}

/** Importe con dos decimales y la divisa detrás: «1.234,56 €», «1.234,56 USD». */
export function importe(valor: number | null | undefined, opciones: OpcionesDeImporte = {}): string | null {
  if (!esCifra(valor)) return null;
  const decimales = opciones.decimales ?? 2;
  return conUnidad(cifra(valor, decimales, decimales, opciones.conSigno), unidadDeDivisa(opciones.divisa));
}

/** Importe sin decimales, para una cifra titular: «201.298 €». */
export function importeTitular(
  valor: number | null | undefined,
  opciones: Omit<OpcionesDeImporte, "decimales"> = {}
): string | null {
  return importe(valor, { ...opciones, decimales: 0 });
}

/** Importe en millones con un decimal: «2.304,3 M€», «1.500,0 M USD». */
export function importeGrande(valor: number | null | undefined, opciones: OpcionesDeImporte = {}): string | null {
  if (!esCifra(valor)) return null;
  const decimales = opciones.decimales ?? 1;
  const unidad = unidadDeDivisa(opciones.divisa);
  const millones = unidad === null ? "M" : unidad === "€" ? "M€" : `M${ESPACIO_DURO}${unidad}`;
  return conUnidad(cifra(valor, decimales, decimales, opciones.conSigno, -6), millones);
}

/** Rentabilidad desde una fracción, con dos decimales y siempre con signo: «+10,39 %», «−4,72 %», «0,00 %». */
export function rentabilidad(fraccion: number | null | undefined): string | null {
  if (!esCifra(fraccion)) return null;
  return conUnidad(cifra(fraccion, 2, 2, true, 2), "%");
}

/** Porcentaje desde una fracción, con dos decimales y sin signo salvo que se pida: «7,80 %», «−11,40 %». */
export function porcentaje(fraccion: number | null | undefined, opciones: OpcionesDeCifra = {}): string | null {
  if (!esCifra(fraccion)) return null;
  const decimales = opciones.decimales ?? 2;
  return conUnidad(cifra(fraccion, decimales, decimales, opciones.conSigno, 2), "%");
}

/** Peso en la cartera desde una fracción, con un decimal: «24,0 %». */
export function peso(fraccion: number | null | undefined): string | null {
  if (!esCifra(fraccion)) return null;
  return conUnidad(cifra(fraccion, 1, 1, false, 2), "%");
}

/** Diferencia entre dos fracciones, en puntos porcentuales con signo: 0,0125 → «+1,25 pp». */
export function puntos(diferencia: number | null | undefined): string | null {
  if (!esCifra(diferencia)) return null;
  return conUnidad(cifra(diferencia, 2, 2, true, 2), "pp");
}

/** Un ratio (Sharpe, beta…) con dos decimales: «1,18». */
export function ratio(valor: number | null | undefined): string | null {
  if (!esCifra(valor)) return null;
  return cifra(valor, 2, 2);
}

/** Precio o valor liquidativo, de dos a cuatro decimales, los que tenga: «535,02 €», «1,0834 USD». */
export function precio(valor: number | null | undefined, opciones: Pick<OpcionesDeImporte, "divisa"> = {}): string | null {
  if (!esCifra(valor)) return null;
  return conUnidad(cifra(valor, 2, 4), unidadDeDivisa(opciones.divisa));
}

/** Títulos o participaciones, hasta seis decimales y sin ceros de relleno: «17,6642», «1.051». */
export function titulos(valor: number | { toNumber(): number } | null | undefined): string | null {
  const numero = typeof valor === "object" && valor !== null ? valor.toNumber() : valor;
  if (!esCifra(numero)) return null;
  return cifra(numero, 0, 6);
}

/** Un número con punto de millar y los decimales que se pidan (por defecto ninguno): «1.334». */
export function numero(valor: number | null | undefined, opciones: OpcionesDeCifra = {}): string | null {
  if (!esCifra(valor)) return null;
  const decimales = opciones.decimales ?? 0;
  return cifra(valor, decimales, decimales, opciones.conSigno);
}

/**
 * Una cuenta con su nombre en el número que toca: «1 día», «2 días», «1.334 fondos» (UI-3, auditoría del 16-11-2026).
 * Había «1 días» y «1 fondos» donde la cuenta se pegaba a un plural fijo. El uno es el único singular: «0 días».
 */
export function cuantos(cuenta: number, singular: string, plural: string): string {
  return `${numero(cuenta) ?? ""} ${cuenta === 1 ? singular : plural}`;
}

/**
 * El signo de una cifra para darle color, mirando la cifra ya redondeada a `decimales`: lo que se pinta como cero es
 * neutro. Los decimales son los del número que se recibe: una rentabilidad que se pinta con dos decimales de
 * porcentaje son cuatro de fracción (`signoDe(r, 4)`).
 */
export function signoDe(valor: number | null | undefined, decimales: number): Signo | null {
  if (!esCifra(valor)) return null;
  const texto = cifra(valor, decimales, decimales);
  if (!/[1-9]/.test(texto)) return "neutro";
  return valor > 0 ? "sube" : "baja";
}

/** Para los sitios que solo admiten texto: el texto formateado o, si falta, la frase de lo que falta. */
export function oFalta(texto: string | null | undefined, siFalta: string = textoDeAusencia("falta")): string {
  return texto ?? siFalta;
}

/* ---------------------------------------------------------------- fechas */

/** Los doce meses abreviados, en minúsculas, como se escriben en español. Es la única lista: la usan los ejes de los
    gráficos y las tablas de rentabilidad por meses, en pantalla, en papel y en Excel. */
export const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;
const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre"
] as const;

interface PartesDeFecha {
  anio: number;
  /** De 1 a 12. */
  mes: number;
  dia: number;
  /** Solo los instantes tienen hora. */
  hora?: { horas: number; minutos: number };
}

function partesLocales(fecha: Date): PartesDeFecha | null {
  if (Number.isNaN(fecha.getTime())) return null;
  return {
    anio: fecha.getFullYear(),
    mes: fecha.getMonth() + 1,
    dia: fecha.getDate(),
    hora: { horas: fecha.getHours(), minutos: fecha.getMinutes() }
  };
}

/**
 * Las partes de la fecha que se pinta. Un día «AAAA-MM-DD» se lee de su texto, sin `new Date` y sin huso (el criterio
 * de `diaLocal`); un instante, en la hora local.
 */
function partesDe(entrada: FechaDeEntrada): PartesDeFecha | null {
  if (entrada instanceof Date) return partesLocales(entrada);
  if (typeof entrada !== "string") return null;
  const texto = entrada.trim();
  if (!texto) return null;
  const dia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (dia) {
    const anio = Number(dia[1]);
    const mes = Number(dia[2]);
    const diaDelMes = Number(dia[3]);
    const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    if (mes < 1 || mes > 12 || diaDelMes < 1 || diaDelMes > diasDelMes) return null;
    return { anio, mes, dia: diaDelMes };
  }
  return partesLocales(new Date(texto));
}

const dos = (n: number) => String(n).padStart(2, "0");

const conBarras = (p: PartesDeFecha) => `${dos(p.dia)}/${dos(p.mes)}/${p.anio}`;

/** Día, mes y año con barras: «13/11/2026». */
export function fecha(dia: FechaDeEntrada): string | null {
  const partes = partesDe(dia);
  return partes ? conBarras(partes) : null;
}

/** Con el mes escrito: «13 de noviembre de 2026». */
export function fechaLarga(dia: FechaDeEntrada): string | null {
  const partes = partesDe(dia);
  return partes ? `${partes.dia} de ${MESES_LARGOS[partes.mes - 1]} de ${partes.anio}` : null;
}

/** Mes abreviado y año, para el eje de un gráfico: «nov 2026». */
export function fechaDeEje(dia: FechaDeEntrada): string | null {
  const partes = partesDe(dia);
  return partes ? `${MESES_CORTOS[partes.mes - 1]} ${partes.anio}` : null;
}

/** Fecha y hora local: «13/11/2026 14:30». Un día sin hora se escribe sin hora: no se inventa. */
export function fechaYHora(instante: FechaDeEntrada): string | null {
  const partes = partesDe(instante);
  if (!partes) return null;
  return partes.hora ? `${conBarras(partes)} ${dos(partes.hora.horas)}:${dos(partes.hora.minutos)}` : conBarras(partes);
}

/** Un periodo entre dos días: «del 31/12/2025 al 13/11/2026». Si falta un extremo, no hay periodo. */
export function periodo(desde: FechaDeEntrada, hasta: FechaDeEntrada): string | null {
  const inicio = fecha(desde);
  const fin = fecha(hasta);
  return inicio && fin ? `del ${inicio} al ${fin}` : null;
}
