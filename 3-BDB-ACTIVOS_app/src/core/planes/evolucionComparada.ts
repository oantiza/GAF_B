/**
 * La evolución de varios planes en un mismo gráfico: **el único cálculo de Planes y EPSV** (Óscar, 13-11-2026, que lo
 * pidió sabiendo que lo es).
 *
 * El valor de la participación de dos planes no se puede dibujar junto tal cual: uno vale 12 € y otro 230 €, y eso no
 * dice nada de cómo ha ido cada uno. Así que cada serie se pone en **base 100**: se divide por su propio valor en un
 * mes común y se multiplica por cien. No se crea ninguna métrica ni se toca ninguna cifra del proveedor: es la misma
 * serie, reescalada para que todas arranquen juntas.
 *
 * Tres convenciones, y las tres se dicen en pantalla:
 *
 * - **Mes a mes.** Lo guardado es el último valor publicado de cada mes, y cada plan lo publica el día que lo publica:
 *   uno el 30 y otro el 31. Se alinean por mes, no por día, o las líneas no tendrían un solo punto en común.
 * - **Solo meses cerrados.** El mes en que se consultó al proveedor no ha acabado: un plan tendría su valor del día 5 y
 *   otro el del 10. Se deja fuera, y el gráfico acaba en el último mes entero.
 * - **La base es el primer mes que tienen todos.** Si se compara un plan de 1988 con uno de este año, el gráfico empieza
 *   donde empieza el más joven. Un periodo más largo que esa historia común no se ofrece: un botón «5 años» que
 *   enseñara tres mentiría.
 *
 * Un plan sin valores en el periodo —porque dejó de publicarlos antes— no se dibuja y se nombra: no se le inventa un
 * tramo. Y un mes que un plan no publicó es un hueco en su línea, no una recta entre los vecinos.
 */
import { PERIODOS_DEL_GRAFICO, type PeriodoDelGrafico, type SerieDelPlan } from "./modelo";

export interface PlanParaComparar {
  id: string;
  nombre: string;
  /** Su serie mensual, o `undefined` si el proveedor no dio serie. */
  serie: SerieDelPlan | undefined;
}

export interface PuntoEnBase100 {
  /** El mes del punto, «AAAA-MM». */
  mes: string;
  /** El último día natural de ese mes: la fecha común con la que se dibuja, no la del valor. */
  fecha: string;
  /** El valor de la participación de ese mes, sobre 100 en el mes base. */
  valor: number;
}

export interface EvolucionComparada {
  /** El mes en que todas las líneas valen 100, o `undefined` si no hay gráfico que dibujar. */
  mesBase?: string;
  /** El último mes dibujado. */
  mesFinal?: string;
  lineas: Array<{ id: string; nombre: string; puntos: PuntoEnBase100[] }>;
  /** Los planes que no se dibujan en este periodo, con el motivo. */
  fuera: Array<{ id: string; nombre: string; motivo: string }>;
}

const mesDe = (fecha: string): string => fecha.slice(0, 7);

/** «AAAA-MM» desplazado un número de meses, hacia atrás si es negativo. */
export function mesMas(mes: string, meses: number): string {
  const total = Number(mes.slice(0, 4)) * 12 + (Number(mes.slice(5, 7)) - 1) + meses;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** El último día natural de un mes, «AAAA-MM-DD». */
export function finDeMes(mes: string): string {
  const dias = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
  return `${mes}-${String(dias).padStart(2, "0")}`;
}

/** El último mes entero cuando se consultó al proveedor: el anterior al de la consulta. */
export function ultimoMesCerrado(consultado: string): string {
  return mesMas(mesDe(consultado), -1);
}

/** El último día de lunes a viernes de un mes, «AAAA-MM-DD». No sabe de festivos. */
export function ultimoLaborableDelMes(mes: string): string {
  const fin = new Date(`${finDeMes(mes)}T00:00:00Z`);
  /* 0 es domingo y 6, sábado: se retrocede hasta el viernes. */
  while (fin.getUTCDay() === 0 || fin.getUTCDay() === 6) fin.setUTCDate(fin.getUTCDate() - 1);
  return fin.toISOString().slice(0, 10);
}

/**
 * El valor de cada mes hasta `hasta`. La serie llega en orden, así que de un mes queda su último valor.
 *
 * JUB-9 (auditoría del 16-11-2026): que el mes haya acabado en el calendario no dice que el plan lo haya cerrado. Si la
 * serie se queda en el día 10 de octubre y se consulta en noviembre, octubre entraba con el valor del día 10 como si
 * fuera el de fin de mes. El ÚLTIMO mes con valor de un plan solo cuenta si su último valor es del último día laborable
 * de ese mes, o si la serie sigue después. Los meses anteriores tienen valores posteriores: el suyo es el último que hubo.
 * No sabe de festivos: un plan cuyo último valor sea del 30 de diciembre espera al primer valor de enero.
 */
function valoresPorMes(serie: SerieDelPlan, hasta: string): Map<string, number> {
  const porMes = new Map<string, number>();
  let ultimaFecha = "";
  for (const punto of serie.puntos) {
    const mes = mesDe(punto.fecha);
    if (punto.fecha > ultimaFecha) ultimaFecha = punto.fecha;
    if (mes <= hasta) porMes.set(mes, punto.valor);
  }
  const ultimoMes = mesDe(ultimaFecha);
  if (porMes.has(ultimoMes) && ultimaFecha < ultimoLaborableDelMes(ultimoMes)) porMes.delete(ultimoMes);
  return porMes;
}

interface PlanConValores {
  id: string;
  nombre: string;
  porMes: Map<string, number>;
}

/**
 * El grupo más grande, de dos o más, que comparte algún mes, con sus meses comunes en orden. Si hay varios igual de
 * grandes, el que llega más tarde —el plan que sobra es el que dejó de publicar—; después, el de más meses comunes;
 * después, el orden en que se marcaron. `null` si no hay dos que coincidan. Se comparan cuatro planes como mucho:
 * probar todos los grupos son once.
 */
function mayorGrupoQueCoincide<T extends PlanConValores>(planes: readonly T[]): { planes: T[]; comunes: string[] } | null {
  let mejor: { planes: T[]; comunes: string[] } | null = null;
  for (let mascara = (1 << planes.length) - 1; mascara > 0; mascara--) {
    /* El primer plan es el bit más alto: recorriendo de mayor a menor, los grupos con los primeros marcados salen antes. */
    const elegidos = planes.filter((_, i) => mascara & (1 << (planes.length - 1 - i)));
    if (elegidos.length < 2) continue;
    const comunes = [...elegidos[0].porMes.keys()].filter((mes) => elegidos.every((plan) => plan.porMes.has(mes))).sort();
    if (comunes.length === 0) continue;
    const candidato = { planes: elegidos, comunes };
    if (!mejor || esMejorGrupo(candidato, mejor)) mejor = candidato;
  }
  return mejor;
}

function esMejorGrupo(a: { planes: unknown[]; comunes: string[] }, b: { planes: unknown[]; comunes: string[] }): boolean {
  if (a.planes.length !== b.planes.length) return a.planes.length > b.planes.length;
  const finA = a.comunes[a.comunes.length - 1];
  const finB = b.comunes[b.comunes.length - 1];
  if (finA !== finB) return finA > finB;
  /* A igualdad también aquí, se queda el que se vio antes, que es el de los primeros marcados. */
  return a.comunes.length > b.comunes.length;
}

/**
 * Las series de varios planes en base 100 sobre un periodo. `consultado` es el día de la consulta más reciente de los
 * planes que se comparan: fija cuál es el último mes cerrado.
 */
export function evolucionComparada(planes: readonly PlanParaComparar[], periodo: PeriodoDelGrafico, consultado: string): EvolucionComparada {
  const ultimo = ultimoMesCerrado(consultado);
  const anios = PERIODOS_DEL_GRAFICO.find((p) => p.id === periodo)?.anios ?? null;
  const desde = anios === null ? undefined : mesMas(ultimo, -12 * anios);

  const fuera: EvolucionComparada["fuera"] = [];
  const conValores: PlanConValores[] = [];
  for (const plan of planes) {
    if (!plan.serie) {
      fuera.push({ id: plan.id, nombre: plan.nombre, motivo: "no tiene serie" });
      continue;
    }
    const todos = valoresPorMes(plan.serie, ultimo);
    const porMes = new Map([...todos].filter(([mes]) => desde === undefined || mes >= desde));
    if (porMes.size === 0) {
      fuera.push({ id: plan.id, nombre: plan.nombre, motivo: "no tiene valores en este periodo" });
      continue;
    }
    conValores.push({ id: plan.id, nombre: plan.nombre, porMes });
  }

  if (conValores.length < 2) return { lineas: [], fuera };

  /* Se dibujan los que coinciden en el tiempo: todos si comparten algún mes; si no, el grupo más grande que sí lo
     comparte, y los demás se nombran (PLA-07). Antes, con un plan que dejó de publicar antes de que empezara otro,
     no quedaba mes común y desaparecía el gráfico de todos. */
  const grupo = mayorGrupoQueCoincide(conValores);
  if (!grupo) return { lineas: [], fuera };
  for (const plan of conValores) {
    if (!grupo.planes.includes(plan)) fuera.push({ id: plan.id, nombre: plan.nombre, motivo: "no tiene ningún mes con valor en común con los demás" });
  }

  /* El mes base es el primero que tienen TODOS los que se dibujan. */
  const mesBase = grupo.comunes[0];
  const lineas = grupo.planes.map((plan) => {
    const base = plan.porMes.get(mesBase) as number;
    const puntos = [...plan.porMes]
      .filter(([mes]) => mes >= mesBase)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, valor]) => ({ mes, fecha: finDeMes(mes), valor: (valor / base) * 100 }));
    return { id: plan.id, nombre: plan.nombre, puntos };
  });
  const mesFinal = lineas.flatMap((linea) => linea.puntos.map((punto) => punto.mes)).sort().at(-1);
  return { mesBase, mesFinal, lineas, fuera };
}

/**
 * Cierto si ese periodo se puede ofrecer: hay al menos dos planes que dibujar y su historia común lo cubre entero.
 * «Todo» se ofrece siempre que haya gráfico.
 */
export function hayEvolucionPara(planes: readonly PlanParaComparar[], periodo: PeriodoDelGrafico, consultado: string): boolean {
  const evolucion = evolucionComparada(planes, periodo, consultado);
  if (evolucion.mesBase === undefined) return false;
  const anios = PERIODOS_DEL_GRAFICO.find((p) => p.id === periodo)?.anios ?? null;
  return anios === null || evolucion.mesBase === mesMas(ultimoMesCerrado(consultado), -12 * anios);
}

/**
 * Las líneas que acaban antes que el gráfico, con su último mes: un plan que dejó de publicar valor. Su línea se
 * queda donde se quedó el dato, y hay que decirlo: una línea corta al lado de otra larga no explica sola por qué.
 */
export function lineasQueAcabanAntes(evolucion: EvolucionComparada): Array<{ id: string; nombre: string; ultimoMes: string }> {
  return evolucion.lineas.flatMap((linea) => {
    const ultimoMes = linea.puntos.at(-1)?.mes;
    return ultimoMes !== undefined && evolucion.mesFinal !== undefined && ultimoMes < evolucion.mesFinal ? [{ id: linea.id, nombre: linea.nombre, ultimoMes }] : [];
  });
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «octubre de 2026». */
export function nombreDelMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
}
