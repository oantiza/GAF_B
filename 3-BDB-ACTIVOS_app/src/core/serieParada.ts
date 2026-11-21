import { diaLocal } from "./fechaLocal";
import { fecha, oFalta } from "./formato";
import { precioCongeladoDe, textoDePrecioCongelado } from "./precioCongelado";

/**
 * Una posición con la serie de precios parada (decisión B-78 de Óscar, 11-11-2026): su coste, su rentabilidad y su riesgo salían como si
 * estuvieran al día, y son de una clase que dejó de cotizar o de una fuente que dejó de servirla. Se avisa donde se enseñan sus cifras: no se
 * retira ninguna ni se toca ningún dato.
 *
 * La fecha es la del último punto de su serie, la de `instruments/{id}/price_series` (`adapters/finDeLaSerie.ts`), y **no** vale otra: el
 * `latest_value_date` que llega con la ficha es el del último valor liquidativo, y de las 14 series paradas medidas el 11-11-2026, 11 lo tienen
 * de finales de octubre de 2026. Con esa fecha, esas 11 no avisarían.
 *
 * Sin fecha conocida no se afirma nada: una posición de la que no se sabe no está parada.
 */

/** Más de estos días sin dato avisa; estos exactos, no. */
export const DIAS_PARA_SERIE_PARADA = 90;

const MS_POR_DIA = 86_400_000;

function diaEnMs(dia: string): number | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!partes) return null;
  const [anio, mes, diaDelMes] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const ms = Date.UTC(anio, mes - 1, diaDelMes);
  /* «2026-02-31» cae en marzo: no es una fecha. */
  return new Date(ms).getUTCMonth() === mes - 1 ? ms : null;
}

/** Los días entre el último dato de la serie y el día en que se genera, el de quien lo genera. Null si falta o no se entiende alguna de las dos. */
export function diasSinDato(ultimoDato: string | null | undefined, generadoEn: string): number | null {
  if (!ultimoDato) return null;
  const hoy = diaLocal(generadoEn);
  const desde = diaEnMs(ultimoDato);
  const hasta = hoy ? diaEnMs(hoy) : null;
  return desde === null || hasta === null ? null : Math.round((hasta - desde) / MS_POR_DIA);
}

export function estaParada(ultimoDato: string | null | undefined, generadoEn: string): boolean {
  const dias = diasSinDato(ultimoDato, generadoEn);
  return dias !== null && dias > DIAS_PARA_SERIE_PARADA;
}

/** De las fechas conocidas, las paradas: posición → último dato. Las que no están aquí, o están al día o no se sabe, y no avisan. */
export function soloLasParadas(finesDeSerie: ReadonlyMap<string, string>, generadoEn: string): ReadonlyMap<string, string> {
  return new Map([...finesDeSerie].filter(([, ultimoDato]) => estaParada(ultimoDato, generadoEn)));
}

export interface PosicionParada {
  nombre: string;
  desde: string;
  /** El instrumento, para reconocer el que se valora a su último precio por decisión (B-80). */
  id?: string;
}

/** Las paradas de una lista de posiciones, en su orden y con el nombre que tengan ahí. */
export function posicionesParadas<T>(
  posiciones: readonly T[],
  paradas: ReadonlyMap<string, string>,
  idDe: (posicion: T) => string,
  nombreDe: (posicion: T) => string
): PosicionParada[] {
  return posiciones.flatMap((posicion) => {
    const id = idDe(posicion);
    const desde = paradas.get(id);
    return desde ? [{ nombre: nombreDe(posicion), desde, id }] : [];
  });
}

/**
 * NH Hotel Group (B-80, Óscar, 12-11-2026): su serie se para porque dejó de negociarse y se valora a su último precio por decisión,
 * no porque falte un dato. Decir «serie parada» o «sus datos llegan hasta» contradiría la excepción, así que se dice lo mismo que la
 * ficha: «Sin negociación desde el 15/09/2025 · valorado a 6,50 € por decisión». La fecha es la de la política (`frozen_price.from`,
 * la última sesión real), no la del último punto de la serie, que EODHD alarga unos días. Null: no es el caso.
 */
export function textoSiCongelado(id: string | null | undefined): string | null {
  const congelado = precioCongeladoDe(id);
  return id && congelado ? textoDePrecioCongelado(id, congelado.desde) : null;
}

const esCongelada = (parada: PosicionParada) => textoSiCongelado(parada.id) !== null;

/* ---------- Para el asesor. ---------- */

const CIFRAS_DE_ESA_FECHA = "sus cifras son de esa fecha o anteriores";

export const rotuloDeSerieParada = (desde: string, id?: string) => textoSiCongelado(id) ?? `Serie parada desde el ${oFalta(fecha(desde))}`;
export const avisoDeSerieParada = ({ nombre, desde, id }: PosicionParada) => {
  const congelado = textoSiCongelado(id);
  return congelado ? `${nombre} · ${congelado}.` : `${nombre} · ${rotuloDeSerieParada(desde)}: ${CIFRAS_DE_ESA_FECHA}.`;
};

/** El punto a revisar del informe interno, que nombra las posiciones y sus fechas. Null: ninguna. */
export function puntoDeSeriesParadas(paradas: readonly PosicionParada[]): string | null {
  const congeladas = paradas.filter(esCongelada).map(avisoDeSerieParada);
  const deVerdad = paradas.filter((parada) => !esCongelada(parada));
  const partes = [
    deVerdad.length === 1 ? avisoDeSerieParada(deVerdad[0]) : null,
    deVerdad.length > 1 ? `Series paradas, y ${CIFRAS_DE_ESA_FECHA}: ${deVerdad.map(({ nombre, desde }) => `${nombre}, desde el ${oFalta(fecha(desde))}`).join("; ")}.` : null,
    ...congeladas
  ].filter((parte): parte is string => parte !== null);
  return partes.length ? partes.join(" ") : null;
}

/* ---------- Para el cliente: «serie parada» no le dice nada. ---------- */

export const datosHasta = (desde: string, id?: string) => {
  const congelado = textoSiCongelado(id);
  return congelado ? `${congelado}.` : `Sus datos llegan hasta el ${oFalta(fecha(desde))}.`;
};

/** La nota de un documento de cliente que no tiene una línea por posición donde decirlo. Null: ninguna. */
export function notaDeDatosHasta(paradas: readonly PosicionParada[]): string | null {
  const congeladas = paradas.filter(esCongelada).map(({ nombre, id }) => `${nombre}: ${textoSiCongelado(id)}.`);
  const deVerdad = paradas.filter((parada) => !esCongelada(parada));
  const partes = [
    deVerdad.length === 1 ? `${deVerdad[0].nombre}: sus datos llegan hasta el ${oFalta(fecha(deVerdad[0].desde))}.` : null,
    deVerdad.length > 1 ? `Sus datos llegan hasta la fecha indicada: ${deVerdad.map(({ nombre, desde }) => `${nombre} (${oFalta(fecha(desde))})`).join("; ")}.` : null,
    ...congeladas
  ].filter((parte): parte is string => parte !== null);
  return partes.length ? partes.join(" ") : null;
}
