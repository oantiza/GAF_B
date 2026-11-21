/**
 * Rentabilidad de una cartera entre dos fechas, a partir de su valoración diaria.
 *
 *  - TWR (ponderada por tiempo): encadena la rentabilidad de cada día. No depende de cuándo
 *    aportó o retiró dinero el cliente: mide la gestión.
 *  - TIR (ponderada por dinero): la tasa que iguala lo aportado con lo que hay. Sí depende
 *    de cuándo entró el dinero: mide lo que le ha rendido al cliente.
 *
 * Un periodo va del CIERRE de `desde` al CIERRE de `hasta`. Se anualiza un periodo de un año o
 * más; los años se cuentan por fechas (días / 365,2425), como en el resto de la app.
 *
 * QUÉ ES «UN AÑO» (decisión de Óscar del 17-11-2026, GES-12): 365 días, el mismo umbral que el
 * Sharpe (`DIAS_PARA_ANUALIZAR`, en `fechas.ts`). Con menos no se anualiza, y la rentabilidad es la
 * del periodo. El «1 año» se anualiza siempre, dure 365 días o 366 en un año bisiesto: con un 10 %
 * en el periodo, la anualizada es (1,10)^(365,2425 / 366) − 1 = 9,98 % o (1,10)^(365,2425 / 365) − 1
 * = 10,01 %. Antes el umbral era 367 (MOT-07, 13-11-2026), y el «1 año» no se anualizaba nunca.
 */
import { DIAS_PARA_ANUALIZAR, DIAS_POR_ANIO, anioDe, diasEntre, mesDe, sumarDias, type Dia } from "./fechas";
import type { Valoracion } from "./valoracion";

export interface Periodo {
  desde: Dia;
  hasta: Dia;
}

/** Días a partir de los cuales una rentabilidad se anualiza: un año (cabecera). */
export { DIAS_PARA_ANUALIZAR };

export interface Tramo {
  /** Índice del día de cierre inicial, o −1 si el periodo empieza antes que la cartera. */
  i0: number;
  /** Índice del último día del periodo. */
  i1: number;
  /** Cierre desde el que se mide de verdad: `desde`, o la víspera del primer movimiento. */
  desde: Dia;
  hasta: Dia;
  dias: number;
}

/** El tramo de la valoración que cubre un periodo, o `undefined` si no se solapan. */
export function tramoDe(valoracion: Valoracion, periodo: Periodo): Tramo | undefined {
  const n = valoracion.dias.length;
  if (n === 0 || periodo.hasta < valoracion.dias[0] || periodo.desde >= periodo.hasta) return undefined;
  const primero = valoracion.dias[0];
  const ultimo = valoracion.dias[n - 1];
  const hasta = periodo.hasta > ultimo ? ultimo : periodo.hasta;
  const i1 = valoracion.indice.get(hasta)!;
  if (periodo.desde < primero) {
    const vispera = sumarDias(primero, -1);
    return { i0: -1, i1, desde: vispera, hasta, dias: diasEntre(vispera, hasta) };
  }
  const i0 = valoracion.indice.get(periodo.desde)!;
  if (i0 >= i1) return undefined;
  return { i0, i1, desde: periodo.desde, hasta, dias: diasEntre(periodo.desde, hasta) };
}

/** Rentabilidad acumulada encadenando la de cada día del tramo. */
export function twrDelTramo(valoracion: Valoracion, tramo: Tramo): number {
  let factor = 1;
  for (let k = tramo.i0 + 1; k <= tramo.i1; k += 1) factor *= 1 + valoracion.rentabilidad[k];
  return factor - 1;
}

/** Anualiza una rentabilidad acumulada en `dias` días. */
export function anualizar(acumulada: number, dias: number): number {
  return Math.pow(1 + acumulada, DIAS_POR_ANIO / dias) - 1;
}

export interface FlujoFechado {
  /** Días desde el inicio del periodo. */
  dia: number;
  /** Desde el punto de vista del cliente: negativo lo que pone, positivo lo que recibe. */
  importe: number;
}

/**
 * La tasa interna del periodo (sin anualizar): R tal que Σ importe × (1 + R)^(−día / total) = 0.
 * Se resuelve por bisección sobre ln(1 + R), que acota cualquier tasa entre −99,9999 % y
 * más de un millón por ciento. Devuelve `null` si los flujos no tienen los dos signos o si
 * la ecuación no cambia de signo en ese intervalo: nunca devuelve una tasa que no anule la suma.
 */
export function tirDeFlujos(flujos: FlujoFechado[], total: number): number | null {
  if (total <= 0 || !flujos.some((f) => f.importe > 0) || !flujos.some((f) => f.importe < 0)) return null;
  const valorActual = (x: number) => flujos.reduce((suma, f) => suma + f.importe * Math.exp((-x * f.dia) / total), 0);
  let bajo = -14;
  let alto = 14;
  let enBajo = valorActual(bajo);
  const enAlto = valorActual(alto);
  if (!Number.isFinite(enBajo) || !Number.isFinite(enAlto) || enBajo * enAlto > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const medio = (bajo + alto) / 2;
    const enMedio = valorActual(medio);
    if (enMedio === 0) return Math.expm1(medio);
    if (enBajo * enMedio < 0) alto = medio;
    else {
      bajo = medio;
      enBajo = enMedio;
    }
    if (alto - bajo < 1e-13) break;
  }
  return Math.expm1((bajo + alto) / 2);
}

export interface RentabilidadDelPeriodo {
  /** Cierre inicial real (puede ser posterior al pedido si la cartera empezó después). */
  desde: Dia;
  hasta: Dia;
  dias: number;
  valorInicial: number;
  valorFinal: number;
  /** Lo que entró de fuera (≥ 0) y lo que salió (≤ 0) dentro del periodo. */
  entradas: number;
  salidas: number;
  aportacionesNetas: number;
  /** Lo ganado o perdido: valor final − valor inicial − aportaciones netas. */
  resultado: number;
  /** Rentabilidad ponderada por tiempo, acumulada en el periodo. */
  twr: number;
  /** La misma, anualizada. Solo en periodos de un año o más. */
  twrAnualizada: number | null;
  /** Rentabilidad del cliente (TIR) del periodo, sin anualizar. `null` si no se puede calcular. */
  tir: number | null;
  tirAnualizada: number | null;
  /** Si el periodo se anualiza: dura un año o más (`DIAS_PARA_ANUALIZAR`). */
  anualiza: boolean;
}

export function rentabilidadDelPeriodo(valoracion: Valoracion, periodo: Periodo): RentabilidadDelPeriodo | undefined {
  const tramo = tramoDe(valoracion, periodo);
  if (!tramo) return undefined;
  const { i0, i1 } = tramo;
  const valorInicial = i0 >= 0 ? valoracion.valor[i0] : 0;
  const valorFinal = valoracion.valor[i1];
  let entradas = 0;
  let salidas = 0;
  const flujos: FlujoFechado[] = [];
  if (valorInicial !== 0) flujos.push({ dia: 0, importe: -valorInicial });
  for (let k = i0 + 1; k <= i1; k += 1) {
    const entra = valoracion.entradas[k];
    const sale = valoracion.salidas[k];
    entradas += entra;
    salidas += sale;
    /* Como en la TWR: lo que entra cuenta desde el inicio del día; lo que sale, al cierre. */
    if (entra !== 0) flujos.push({ dia: k - i0 - 1, importe: -entra });
    if (sale !== 0) flujos.push({ dia: k - i0, importe: -sale });
  }
  flujos.push({ dia: tramo.dias, importe: valorFinal });
  const twr = twrDelTramo(valoracion, tramo);
  const anualiza = tramo.dias >= DIAS_PARA_ANUALIZAR;
  const tir = tirDeFlujos(flujos, tramo.dias);
  return {
    desde: tramo.desde,
    hasta: tramo.hasta,
    dias: tramo.dias,
    valorInicial,
    valorFinal,
    entradas,
    salidas,
    aportacionesNetas: entradas + salidas,
    resultado: valorFinal - valorInicial - entradas - salidas,
    twr,
    twrAnualizada: anualiza ? anualizar(twr, tramo.dias) : null,
    tir,
    tirAnualizada: anualiza && tir !== null ? anualizar(tir, tramo.dias) : null,
    anualiza
  };
}

/** La serie de la cartera en base 100 desde el cierre inicial del periodo. */
export function serieBase100(valoracion: Valoracion, periodo: Periodo): Array<{ fecha: Dia; valor: number }> {
  const tramo = tramoDe(valoracion, periodo);
  if (!tramo) return [];
  const serie = [{ fecha: tramo.desde, valor: 100 }];
  let nivel = 100;
  for (let k = tramo.i0 + 1; k <= tramo.i1; k += 1) {
    nivel *= 1 + valoracion.rentabilidad[k];
    serie.push({ fecha: valoracion.dias[k], valor: nivel });
  }
  return serie;
}

export interface RentabilidadDelMes {
  /** «2026-11». */
  mes: string;
  rentabilidad: number;
  /** Si el mes no está entero: es el primero, el último o el mes en curso. */
  parcial: boolean;
}

export interface RentabilidadDelAnio {
  anio: number;
  /** Doce casillas, de enero a diciembre; `null` donde la cartera no existía. */
  meses: Array<RentabilidadDelMes | null>;
  /** Rentabilidad del año (de lo que hay de él), encadenando sus meses. */
  total: number;
  parcial: boolean;
}

/** La tabla de rentabilidad por meses y años de toda la historia de la cartera (TWR). */
export function rentabilidadPorMeses(valoracion: Valoracion, hasta?: Dia): RentabilidadDelAnio[] {
  const porMes = new Map<string, { factor: number; dias: number }>();
  for (let k = 0; k < valoracion.dias.length; k += 1) {
    const dia = valoracion.dias[k];
    if (hasta !== undefined && dia > hasta) break;
    const clave = mesDe(dia);
    const mes = porMes.get(clave) ?? { factor: 1, dias: 0 };
    mes.factor *= 1 + valoracion.rentabilidad[k];
    mes.dias += 1;
    porMes.set(clave, mes);
  }
  const anios = new Map<number, RentabilidadDelAnio>();
  for (const [clave, mes] of porMes) {
    const anio = anioDe(`${clave}-01`);
    const numero = Number(clave.slice(5, 7));
    const diasDelMes = new Date(Date.UTC(anio, numero, 0)).getUTCDate();
    const fila = anios.get(anio) ?? { anio, meses: Array.from({ length: 12 }, () => null), total: 0, parcial: false };
    fila.meses[numero - 1] = { mes: clave, rentabilidad: mes.factor - 1, parcial: mes.dias < diasDelMes };
    anios.set(anio, fila);
  }
  for (const fila of anios.values()) {
    fila.total = fila.meses.reduce((factor, mes) => factor * (1 + (mes?.rentabilidad ?? 0)), 1) - 1;
    fila.parcial = fila.meses.some((mes) => mes === null || mes.parcial);
  }
  return [...anios.values()].sort((a, b) => a.anio - b.anio);
}
