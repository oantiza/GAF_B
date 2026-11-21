import { fecha as escribirFecha, oFalta, periodo as escribirPeriodo, precio } from "./formato";
import { isIbex35 } from "./ibex35";

/**
 * La agenda de Mercado: lo que deciden juntas las pestañas de dividendos, resultados y calendario.
 *
 * Hallazgos 24 y 93 de la auditoría del 04-11-2026. Dos cosas se decían mal, y las dos son de las
 * que un asesor repite a un cliente:
 *
 * - **«Ha fallado» se leía como «no hay».** El servidor de estos calendarios nunca lanza un error:
 *   un fallo de la fuente llega como una respuesta vacía, con el origen `ERROR`. «Sin dividendos
 *   próximos (o el servicio no respondió)» juntaba las dos cosas en una frase.
 * - **El importe del «próximo pago» era el último pagado.** Con Yahoo, que es la fuente real, el
 *   servidor lee la fecha ex futura del calendario y el importe del último apunte de la serie
 *   (`spanish_calendar.py`, `divs.iloc[-1]`). Medido el 04-11-2026: Sabadell, ex 24-12-2026,
 *   enseñaba 0,50 €, y el diciembre anterior pagó 0,07 €.
 */

/** `fuera`: la fuente respondió, pero no llega hasta el rango pedido (calendario económico). No es «no hay eventos». */
export type FaseDeAgenda = "cargando" | "fallo" | "vacia" | "datos" | "fuera";

/** Lo que el servidor manda cuando no ha podido preguntar a nadie: no quiere decir «no hay». */
const ORIGENES_SIN_RESPUESTA = new Set(["ERROR", "NOT_CONFIGURED", "INVALID_REQUEST"]);

export function faseDeAgenda({
  cargando,
  error,
  origen,
  cuantos
}: {
  cargando: boolean;
  error: unknown;
  /** El origen que dice la respuesta, o null si no ha llegado ninguna. */
  origen: string | null;
  cuantos: number;
}): FaseDeAgenda {
  if (cargando) return "cargando";
  if (error) return "fallo";
  if (cuantos > 0) return "datos";
  if (origen === "OUT_OF_SOURCE_RANGE") return "fuera";
  if (origen === null || ORIGENES_SIN_RESPUESTA.has(origen)) return "fallo";
  return "vacia";
}

/**
 * La procedencia bajo el título: «Yahoo Finance · del 04/11/2026 al 02/02/2027». En Modo cliente el
 * proveedor no se dice (`fuenteDeDatos`, decisión 19) y queda solo el periodo.
 */
export function procedenciaDeAgenda(fuente: string | null, desde?: string, hasta?: string): string | null {
  const periodo = escribirPeriodo(desde, hasta);
  const texto = [fuente, periodo].filter(Boolean).join(" · ");
  return texto ? texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1) : null;
}

/**
 * Lo que la fuente avisa, si dice algo: «pueden faltar anuncios» cambia cómo se lee la lista, y eso se
 * queda en Modo cliente, sin el nombre del proveedor. «Sin datos en el rango» no añade nada a la frase
 * de que no hay nada previsto.
 */
export function notaDeLaFuente(nota: string | null | undefined, decirProveedor: boolean): string | null {
  if (!nota || nota === "Sin datos en el rango.") return null;
  return decirProveedor ? nota : nota.replace(/^Yahoo/, "La fuente").replace(/ de Yahoo/, " de la fuente");
}

/** El día de hoy en el huso de quien mira, para marcar lo que es hoy. */
export function hoyIso(ahora: Date = new Date()): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/**
 * Solo el IBEX 35, que es lo que dicen los títulos. Con Yahoo ya lo es, porque el servidor recorre
 * esa lista; con EODHD o FMP llegaría cualquier valor de la bolsa de Madrid, y el título mentiría.
 */
export function soloIbex35<T extends { code?: string | null }>(apuntes: readonly T[]): T[] {
  return apuntes.filter((apunte) => isIbex35(apunte.code));
}

export const codigoDeValor = (codigo?: string | null): string => (codigo ?? "").replace(/\.MC$/i, "");

/* ---------------------------------------------------------------- dividendos --- */

interface ApunteDeDividendo {
  code?: string | null;
  name?: string | null;
  ex_date?: string | null;
  payment_date?: string | null;
  amount?: number | null;
  currency?: string | null;
  amount_ex_date?: string | null;
}

export interface FilaDeDividendo {
  id: string;
  codigo: string;
  /** El nombre, o null si la fuente no lo da: no se deduce del código. */
  nombre: string | null;
  fechaEx: string | null;
  esHoy: boolean;
  fechaDePago: string | null;
  importe: number | null;
  divisa: string;
  /** La fecha ex del importe. El servidor aún no la envía. */
  fechaDelImporte: string | null;
}

/** Por fecha ex, que es lo que la fuente da de verdad: en la medición, 0 de 10 traían fecha de pago. */
export function filasDeDividendos(apuntes: readonly ApunteDeDividendo[], hoy: string): FilaDeDividendo[] {
  return soloIbex35(apuntes)
    .map((apunte, indice) => ({
      id: `${apunte.code ?? "sin-codigo"}-${apunte.ex_date ?? indice}`,
      codigo: codigoDeValor(apunte.code),
      nombre: apunte.name || null,
      fechaEx: apunte.ex_date || null,
      esHoy: apunte.ex_date === hoy,
      fechaDePago: apunte.payment_date || null,
      importe: typeof apunte.amount === "number" && Number.isFinite(apunte.amount) ? apunte.amount : null,
      divisa: apunte.currency || "EUR",
      fechaDelImporte: apunte.amount_ex_date || null
    }))
    .sort(
      (a, b) =>
        (a.fechaEx ?? "9999-99-99").localeCompare(b.fechaEx ?? "9999-99-99") || a.codigo.localeCompare(b.codigo)
    );
}

/**
 * Qué es la cifra de la fila, y depende de quién la da. Yahoo: el último apunte de su serie, ya
 * pasado. EODHD y FMP traen el importe de esa misma fecha ex. Si algún día entra una de esas dos,
 * llamarlo «último» sería el error contrario.
 */
export function importeEsDelUltimoPago(origen: string | null, tipoDeImporte?: string | null): boolean {
  /* Si el servidor dice qué es el importe, manda; un servidor sin actualizar no lo dice y se deduce del origen. */
  if (tipoDeImporte) return tipoDeImporte === "LAST_PAID";
  return (origen ?? "").startsWith("YAHOO");
}

/**
 * El dinero de un dividendo por acción: al menos dos decimales y hasta cuatro, como un precio. «0,50 €», «0,427 €»,
 * «0,1336 €»; fuera del euro, el código de la divisa.
 */
export function escribirImporte(valor: number, divisa: string): string {
  return oFalta(precio(valor, { divisa }));
}

/**
 * La salvedad que acompaña a la columna. «A veces uno menor» no es una precaución de estilo: Iberdrola
 * paga cada mayo un dividendo de involucración de 0,005 €, condicionado al quórum de su junta, y
 * hasta el pago de julio ese sería su «último dividendo». Es cierto y no dice nada del siguiente.
 */
export function notaDelImporte(filas: readonly FilaDeDividendo[], origen: string | null, tipoDeImporte?: string | null): string {
  if (!importeEsDelUltimoPago(origen, tipoDeImporte)) return "Importe anunciado por la fuente para esa fecha ex.";
  const sinFecha = filas.some((fila) => fila.importe !== null && fila.fechaDelImporte === null);
  return [
    "El último dividendo es el último pago que registra la fuente, ya pasado y sea del tipo que sea, a veces uno menor: no anticipa el próximo.",
    sinFecha ? "Este calendario aún no recibe su fecha." : null
  ]
    .filter(Boolean)
    .join(" ");
}

/* --------------------------------------------------------------- tipos del BCE --- */

export interface TipoObservado {
  etiqueta: string;
  /** La fecha de la observación, o null si esa serie no ha llegado. */
  fecha: string | null;
}

/**
 * «Banco Central Europeo · €STR a 03/11/2026, el resto a 04/11/2026». Las series no se publican todas
 * el mismo día: el €STR sale al día siguiente y los tipos clave cambian en las reuniones. Una sola
 * fecha para las cuatro diría algo falso de alguna, y cuatro fechas repiten lo mismo.
 */
export function procedenciaDeLosTipos(series: readonly TipoObservado[]): string {
  const FUENTE = "Banco Central Europeo";
  const porFecha = new Map<string, string[]>();
  for (const serie of series) {
    if (serie.fecha) porFecha.set(serie.fecha, [...(porFecha.get(serie.fecha) ?? []), serie.etiqueta]);
  }
  if (porFecha.size === 0) return `${FUENTE} · sin observaciones: no se muestran valores de sustitución`;
  const fechas = [...porFecha.entries()].sort(
    ([fechaA, a], [fechaB, b]) => b.length - a.length || fechaB.localeCompare(fechaA)
  );
  const [fechaComun] = fechas[0];
  const dia = (fecha: string) => oFalta(escribirFecha(fecha));
  if (fechas.length === 1) return `${FUENTE} · a ${dia(fechaComun)}`;
  const otras = fechas.slice(1).map(([fecha, etiquetas]) => `${etiquetas.join(" y ")} a ${dia(fecha)}`);
  return `${FUENTE} · ${otras.join(", ")}, el resto a ${dia(fechaComun)}`;
}
