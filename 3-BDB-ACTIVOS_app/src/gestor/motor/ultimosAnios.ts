/**
 * La rentabilidad de los últimos 1, 3 y 5 años: la de la cartera (TWR) hasta su último día, sobre la serie de TODA su
 * historia, sin depender del periodo elegido (como la tabla de meses y años). Es la definición de `_rolling_return` de la
 * cartera real del servidor (`functions_python/portfolio_real/engine.py`, en la etiqueta de Git
 * `referencia-portfolio-real-2026-11-17`):
 *
 *  - El ancla de N años es el último punto de la serie en una fecha IGUAL O ANTERIOR al último día menos N años
 *    naturales (el mismo día y mes, N años antes; un 29 de febrero pasa al 28).
 *  - Acumulada = nivel final / nivel del ancla − 1.
 *  - Si la serie no llega tan atrás (ningún punto en o antes de esa fecha), no se da: no aplica.
 *  - Para 3 y 5 años, además, la anualizada por fechas: (1 + acumulada)^(365,2425 / días entre el ancla y el final) − 1.
 *    Para un año es la misma cifra y no se repite.
 */
import { diasEntre, sumarAnios, type Dia } from "./fechas";
import { anualizar } from "./rentabilidad";
import { ultimoHasta, type Punto } from "./valoracion";

/** Los horizontes que se dan, en años. */
export const ANIOS_RECIENTES = [1, 3, 5] as const;
export type AniosRecientes = (typeof ANIOS_RECIENTES)[number];

export interface RentabilidadDeLosUltimosAnios {
  anios: AniosRecientes;
  /** El día desde el que se querría medir: el último menos N años naturales. */
  objetivo: Dia;
  /** El ancla: el último día de la serie en o antes de `objetivo`. `null` si la serie no llega. */
  desde: Dia | null;
  /** El último día de la serie. */
  hasta: Dia;
  acumulada: number | null;
  /** Solo en 3 y 5 años. */
  anualizada: number | null;
  /** Por qué no hay cifra: siempre un «no aplica», la cartera aún no tiene esa historia. */
  motivo?: string;
}

/** «un año», «3 años». */
function enAnios(anios: number): string {
  return anios === 1 ? "un año" : `${anios} años`;
}

/** La rentabilidad de los últimos `anios` años de una serie de niveles (base 100) ordenada por fecha. */
export function rentabilidadDeLosUltimosAnios(serie: Punto[], anios: AniosRecientes): RentabilidadDeLosUltimosAnios | undefined {
  if (serie.length === 0) return undefined;
  const final = serie[serie.length - 1];
  const objetivo = sumarAnios(final.fecha, -anios);
  const sinHistoria: RentabilidadDeLosUltimosAnios = {
    anios,
    objetivo,
    desde: null,
    hasta: final.fecha,
    acumulada: null,
    anualizada: null,
    motivo: `La cartera no tiene todavía ${enAnios(anios)} de historia.`
  };
  const ancla = ultimoHasta(serie, objetivo);
  if (!ancla || ancla.valor <= 0) return sinHistoria;
  const acumulada = final.valor / ancla.valor - 1;
  const dias = diasEntre(ancla.fecha, final.fecha);
  return {
    anios,
    objetivo,
    desde: ancla.fecha,
    hasta: final.fecha,
    acumulada,
    anualizada: anios > 1 && dias > 0 ? anualizar(acumulada, dias) : null
  };
}

/** Las tres: último año, últimos 3 y últimos 5 años. Vacío si la serie no tiene puntos. */
export function rentabilidadesDeLosUltimosAnios(serie: Punto[]): RentabilidadDeLosUltimosAnios[] {
  return ANIOS_RECIENTES.map((anios) => rentabilidadDeLosUltimosAnios(serie, anios)).filter((linea): linea is RentabilidadDeLosUltimosAnios => linea !== undefined);
}
