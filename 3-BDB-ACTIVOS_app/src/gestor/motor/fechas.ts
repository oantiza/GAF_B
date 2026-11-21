/**
 * Fechas del gestor: días naturales como texto ISO «AAAA-MM-DD», siempre en UTC para que
 * el día sea el del dato en cualquier huso. Sin horas: un movimiento ocurre un día.
 */

/** Un día natural: «2026-11-13». Se compara como texto. */
export type Dia = string;

const FORMA_DIA = /^\d{4}-\d{2}-\d{2}$/;
const MS_POR_DIA = 86_400_000;

/** Años por fechas, la convención de la casa para anualizar (días / 365,2425). */
export const DIAS_POR_ANIO = 365.2425;
/**
 * Desde cuántos días se anualiza una cifra, la rentabilidad y la que entra en el Sharpe, el Sortino y el Calmar: un año,
 * 365 días (decisión de Óscar del 17-11-2026, GES-12). Con menos de un año no se anualiza, y la rentabilidad es la del
 * periodo. Un año natural de 365 días y uno bisiesto de 366 se anualizan los dos.
 */
export const DIAS_PARA_ANUALIZAR = 365;

export function esDia(valor: unknown): valor is Dia {
  if (typeof valor !== "string" || !FORMA_DIA.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

function aMs(dia: Dia): number {
  return Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8, 10)));
}

function deMs(ms: number): Dia {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Días naturales de `desde` a `hasta` (positivo si `hasta` es posterior). */
export function diasEntre(desde: Dia, hasta: Dia): number {
  return Math.round((aMs(hasta) - aMs(desde)) / MS_POR_DIA);
}

export function sumarDias(dia: Dia, dias: number): Dia {
  return deMs(aMs(dia) + dias * MS_POR_DIA);
}

/** Años entre dos días, por fechas. */
export function aniosEntre(desde: Dia, hasta: Dia): number {
  return diasEntre(desde, hasta) / DIAS_POR_ANIO;
}

/** Todos los días de `desde` a `hasta`, los dos incluidos. */
export function rangoDeDias(desde: Dia, hasta: Dia): Dia[] {
  const dias: Dia[] = [];
  for (let ms = aMs(desde); ms <= aMs(hasta); ms += MS_POR_DIA) dias.push(deMs(ms));
  return dias;
}

/**
 * Suma meses conservando el día cuando existe y, si no, quedándose en el último del mes
 * (31 de enero + 1 mes = 28 o 29 de febrero). `finDeMes` fuerza siempre el último día,
 * que es la regla de los bonos que pagan a fin de mes.
 */
export function sumarMeses(dia: Dia, meses: number, finDeMes = false): Dia {
  const anio = Number(dia.slice(0, 4));
  const mes = Number(dia.slice(5, 7)) - 1 + meses;
  const diaDelMes = Number(dia.slice(8, 10));
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return deMs(Date.UTC(anio, mes, finDeMes ? ultimo : Math.min(diaDelMes, ultimo)));
}

export function sumarAnios(dia: Dia, anios: number): Dia {
  return sumarMeses(dia, anios * 12);
}

export function esUltimoDiaDelMes(dia: Dia): boolean {
  return sumarDias(dia, 1).slice(8, 10) === "01";
}

/** «2026-11»: la clave del mes de un día. */
export function mesDe(dia: Dia): string {
  return dia.slice(0, 7);
}

export function anioDe(dia: Dia): number {
  return Number(dia.slice(0, 4));
}

/** Un día escrito en español para los mensajes del motor: «13/11/2026». */
export function fechaEnTexto(dia: Dia): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

/** El último día del año anterior: desde donde se mide «el año en curso». */
export function finDelAnioAnterior(dia: Dia): Dia {
  return `${anioDe(dia) - 1}-12-31`;
}

/** Día de la semana ISO: 1 lunes … 7 domingo. */
export function diaDeLaSemana(dia: Dia): number {
  const n = new Date(aMs(dia)).getUTCDay();
  return n === 0 ? 7 : n;
}

/** El lunes de la semana ISO de un día: sirve de clave de la semana. */
export function lunesDeLaSemana(dia: Dia): Dia {
  return sumarDias(dia, 1 - diaDeLaSemana(dia));
}

export function maximoDia(a: Dia, b: Dia): Dia {
  return a >= b ? a : b;
}

export function minimoDia(a: Dia, b: Dia): Dia {
  return a <= b ? a : b;
}

/** El día de hoy según el reloj local del usuario. */
export function hoy(reloj: Date = new Date()): Dia {
  const mes = String(reloj.getMonth() + 1).padStart(2, "0");
  const dia = String(reloj.getDate()).padStart(2, "0");
  return `${reloj.getFullYear()}-${mes}-${dia}`;
}
