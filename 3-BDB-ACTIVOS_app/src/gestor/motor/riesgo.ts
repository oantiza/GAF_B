/**
 * Riesgo básico: volatilidad, máxima caída y ratio de Sharpe.
 *
 * Se mide igual que en Diseño (`functions_python/weekly_sampling.py`), para que la cifra
 * de una cartera del gestor y la de una cartera de Diseño se puedan poner una al lado de
 * la otra: dos cifras solo se comparan si coinciden también en el estimador.
 *
 *  - Volatilidad: rentabilidades SEMANALES (última observación de cada semana ISO),
 *    desviación típica muestral (n − 1), anualizada por √52. Con menos de 20 semanas, no se da.
 *  - Máxima caída: sobre la serie DIARIA, porque es una propiedad del camino.
 *  - Sharpe: (rentabilidad anualizada por fechas − tipo libre de riesgo) / volatilidad. El
 *    tipo libre de riesgo es la media del €STR en el periodo. Con menos de un año, 365 días, no se da: el
 *    mismo umbral que la rentabilidad en pantalla (`DIAS_PARA_ANUALIZAR`; decisión de Óscar del 17-11-2026, GES-12).
 *    Diseño y el Comparador anualizan desde 330, porque sus ventanas van de cotización a cotización y el año se
 *    queda en 364 días; la serie del gestor es de días naturales y su año dura 365 o 366.
 *  - Sortino: el mismo numerador que el Sharpe entre la desviación bajista semanal frente al
 *    tipo sin riesgo semanal, anualizada por √52 (`ex_post_sortino` de `weekly_sampling.py`).
 *    Solo con Sharpe, para que los dos no salgan nunca con signo contrario; con al menos 26 semanas.
 *  - Calmar: la rentabilidad anualizada del Sharpe entre la máxima caída del periodo, en valor
 *    absoluto (la cartera real del servidor, `engine.py`). No depende del tipo sin riesgo.
 */
import { DIAS_PARA_ANUALIZAR, DIAS_POR_ANIO, lunesDeLaSemana, type Dia } from "./fechas";
import type { Punto } from "./valoracion";

export const SEMANAS_POR_ANIO = 52;
/** Rentabilidades semanales mínimas para dar una volatilidad (unos cinco meses). */
export const MIN_SEMANAS = 20;
/** Días mínimos para anualizar la rentabilidad que entra en el Sharpe, el Sortino y el Calmar: un año, como en pantalla. */
export const MIN_DIAS_PARA_SHARPE = DIAS_PARA_ANUALIZAR;
/** Cobertura mínima del €STR sobre el periodo para dar su media por buena. */
export const COBERTURA_MINIMA_DEL_LIBRE_DE_RIESGO = 0.95;
/** Rentabilidades semanales mínimas para dar un Sortino (`SORTINO_MIN_WEEKLY_RETURNS` del servidor). */
export const MIN_SEMANAS_PARA_SORTINO = 26;
/** Por debajo de esto, una desviación o una caída se tienen por cero (la guarda del servidor). */
const CASI_CERO = 1e-12;

/** La última observación de cada semana ISO de una serie diaria. */
export function ultimasDeCadaSemana(serie: Punto[]): Punto[] {
  const porSemana = new Map<Dia, Punto>();
  for (const punto of serie) porSemana.set(lunesDeLaSemana(punto.fecha), punto);
  return [...porSemana.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, punto]) => punto);
}

/** Rentabilidades de semana a semana de una serie de niveles. */
export function rentabilidadesSemanales(serie: Punto[]): number[] {
  const semanas = ultimasDeCadaSemana(serie);
  const rentabilidades: number[] = [];
  for (let i = 1; i < semanas.length; i += 1) {
    if (semanas[i - 1].valor > 0) rentabilidades.push(semanas[i].valor / semanas[i - 1].valor - 1);
  }
  return rentabilidades;
}

/** Desviación típica muestral (n − 1) anualizada. */
export function volatilidadAnualizada(rentabilidades: number[], periodosPorAnio = SEMANAS_POR_ANIO): number {
  if (rentabilidades.length < 2) return 0;
  const media = rentabilidades.reduce((suma, r) => suma + r, 0) / rentabilidades.length;
  const varianza = rentabilidades.reduce((suma, r) => suma + (r - media) ** 2, 0) / (rentabilidades.length - 1);
  return Math.sqrt(Math.max(0, varianza)) * Math.sqrt(periodosPorAnio);
}

/**
 * La desviación bajista anualizada frente a un tipo sin riesgo anual: raíz(media(min(0, r − rf_s)²)) × raíz(52), con
 * rf_s = (1 + rf)^(1/52) − 1 y la media sobre TODAS las semanas (las que no caen por debajo de rf_s cuentan como cero).
 */
export function desviacionBajista(rentabilidades: number[], tasaSinRiesgo: number, periodosPorAnio = SEMANAS_POR_ANIO): number {
  if (rentabilidades.length === 0) return 0;
  const porPeriodo = Math.pow(1 + tasaSinRiesgo, 1 / periodosPorAnio) - 1;
  const cuadrados = rentabilidades.reduce((suma, r) => suma + Math.min(0, r - porPeriodo) ** 2, 0);
  return Math.sqrt(cuadrados / rentabilidades.length) * Math.sqrt(periodosPorAnio);
}

export interface MaximaCaida {
  /** La caída, en negativo: −0,23 es un 23 %. Cero si la serie nunca bajó de un máximo. */
  caida: number;
  maximo?: Dia;
  minimo?: Dia;
  /** Día en que se recuperó el máximo anterior, si ya ocurrió. */
  recuperacion?: Dia;
}

/** La mayor caída desde un máximo, sobre la serie diaria de niveles. */
export function maximaCaida(serie: Punto[]): MaximaCaida {
  let pico = Number.NEGATIVE_INFINITY;
  let diaDelPico: Dia | undefined;
  let peor: MaximaCaida = { caida: 0 };
  for (const punto of serie) {
    if (punto.valor > pico) {
      pico = punto.valor;
      diaDelPico = punto.fecha;
    } else if (pico > 0) {
      const caida = punto.valor / pico - 1;
      if (caida < peor.caida) peor = { caida, maximo: diaDelPico, minimo: punto.fecha };
    }
  }
  if (peor.maximo && peor.minimo) {
    const nivelDelPico = serie.find((punto) => punto.fecha === peor.maximo)!.valor;
    peor.recuperacion = serie.find((punto) => punto.fecha > peor.minimo! && punto.valor >= nivelDelPico)?.fecha;
  }
  return peor;
}

export interface LibreDeRiesgo {
  /** Media de la tasa anual en el periodo, en fracción. */
  tasa: number;
  observaciones: number;
  /** Parte del periodo cubierta por observaciones, de 0 a 1. */
  cobertura: number;
}

/** La media del tipo libre de riesgo entre dos fechas, con su cobertura. */
export function libreDeRiesgoMedio(serie: Punto[] | undefined, desde: Dia, hasta: Dia): LibreDeRiesgo | undefined {
  if (!serie || serie.length === 0) return undefined;
  const dentro = serie.filter((punto) => punto.fecha > desde && punto.fecha <= hasta);
  if (dentro.length === 0) return undefined;
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
  /* El €STR se publica en días hábiles: unos 5 de cada 7, menos festivos. */
  const esperadas = Math.max(1, (dias * 5) / 7 * 0.97);
  return {
    tasa: dentro.reduce((suma, punto) => suma + punto.valor, 0) / dentro.length,
    observaciones: dentro.length,
    cobertura: Math.min(1, dentro.length / esperadas)
  };
}

export interface Riesgo {
  /** Volatilidad anualizada, o `null` si no hay semanas suficientes. */
  volatilidad: number | null;
  semanas: number;
  maximaCaida: MaximaCaida;
  /** Ratio de Sharpe, o `null` con su motivo. */
  sharpe: number | null;
  motivoSinSharpe?: string;
  /** El Sharpe no sale porque falta un dato (el tipo sin riesgo), no porque el periodo sea corto. */
  sharpeFaltaUnDato?: boolean;
  libreDeRiesgo?: LibreDeRiesgo;
  /** La rentabilidad anualizada por fechas que entra en el Sharpe, en el Sortino y en el Calmar. */
  rentabilidadAnualizada: number | null;
  /** Ratio de Sortino, o `null` con su motivo. Sin Sharpe no hay Sortino, y el motivo es el del Sharpe. */
  sortino: number | null;
  motivoSinSortino?: string;
  /** El Sortino no sale porque falta un dato (el tipo sin riesgo), no porque no corresponda. */
  sortinoFaltaUnDato?: boolean;
  /** Ratio de Calmar, o `null` con su motivo. Cuando no sale, es siempre porque no corresponde: no le falta ningún dato. */
  calmar: number | null;
  motivoSinCalmar?: string;
}

/** El riesgo de una serie de niveles (base 100) entre su primer y su último punto. */
export function riesgoDeLaSerie(serie: Punto[], libreDeRiesgo?: Punto[]): Riesgo {
  const semanales = rentabilidadesSemanales(serie);
  const volatilidad = semanales.length >= MIN_SEMANAS ? volatilidadAnualizada(semanales) : null;
  const caida = maximaCaida(serie);
  const resultado: Riesgo = { volatilidad, semanas: semanales.length, maximaCaida: caida, sharpe: null, rentabilidadAnualizada: null, sortino: null, calmar: null };
  /* Sin Sharpe no hay Sortino: el mismo motivo para los dos, y la misma distinción entre «no aplica» y «falta el dato». */
  const sinSharpe = (motivo: string, faltaUnDato = false): Riesgo => ({
    ...resultado,
    motivoSinSharpe: motivo,
    motivoSinSortino: motivo,
    ...(faltaUnDato ? { sharpeFaltaUnDato: true, sortinoFaltaUnDato: true } : {})
  });
  if (serie.length < 2) return { ...sinSharpe("No hay historia suficiente."), motivoSinCalmar: "No hay historia suficiente." };
  const desde = serie[0].fecha;
  const hasta = serie[serie.length - 1].fecha;
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
  if (dias < MIN_DIAS_PARA_SHARPE) return { ...sinSharpe("Hace falta al menos un año de historia."), motivoSinCalmar: "Hace falta al menos un año de historia." };
  const acumulada = serie[serie.length - 1].valor / serie[0].valor - 1;
  const anualizada = Math.pow(1 + acumulada, DIAS_POR_ANIO / dias) - 1;
  resultado.rentabilidadAnualizada = anualizada;
  /* Calmar: la misma rentabilidad anualizada entre la caída máxima del mismo periodo. No usa el tipo sin riesgo. */
  if (caida.caida < -CASI_CERO) resultado.calmar = anualizada / Math.abs(caida.caida);
  else resultado.motivoSinCalmar = "La cartera no ha bajado de ningún máximo en el periodo: no hay caída con la que comparar.";
  if (volatilidad === null || volatilidad <= CASI_CERO) return sinSharpe("No hay semanas suficientes para medir la volatilidad.");
  const rf = libreDeRiesgoMedio(libreDeRiesgo, desde, hasta);
  if (!rf) return sinSharpe("Falta el tipo libre de riesgo (€STR) del periodo.", true);
  resultado.libreDeRiesgo = rf;
  if (rf.cobertura < COBERTURA_MINIMA_DEL_LIBRE_DE_RIESGO) return sinSharpe("El tipo libre de riesgo (€STR) no cubre todo el periodo.", true);
  resultado.sharpe = (anualizada - rf.tasa) / volatilidad;
  /* Sortino: el numerador es exactamente el del Sharpe, para que los dos no salgan nunca con signo contrario. */
  if (semanales.length < MIN_SEMANAS_PARA_SORTINO) {
    resultado.motivoSinSortino = `Hacen falta al menos ${MIN_SEMANAS_PARA_SORTINO} semanas de historia.`;
    return resultado;
  }
  const bajista = desviacionBajista(semanales, rf.tasa);
  if (bajista <= CASI_CERO) resultado.motivoSinSortino = "Ninguna semana ha quedado por debajo del tipo sin riesgo: no hay desviación a la baja que medir.";
  else resultado.sortino = (anualizada - rf.tasa) / bajista;
  return resultado;
}
