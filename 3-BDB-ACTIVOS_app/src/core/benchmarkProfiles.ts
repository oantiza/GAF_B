// Las carteras de referencia: Conservador, Moderado, Equilibrado, Dinámico y Agresivo.
//
// Cinco mezclas de dos fondos base, renta fija global (IE00B18GC888) y renta variable global
// (IE00B03HCZ61), calculadas en el momento con las series de esos fondos (decisión 2 de Óscar,
// 04-11-2026). Hasta entonces iban compiladas en la aplicación con datos hasta su última regeneración.
//
// La regla de la mezcla es la de la simulación de la cartera (`portfolio_horizon._backtest`), para que las dos se comparen
// igual (decisión 39 de Óscar, 05-11-2026): los pesos se fijan el primer día de la ventana y se dejan derivar,
//   valor(t) = 100 × (pesoRF × RF(t) / RF(primer día) + pesoRV × RV(t) / RV(primer día)).
//
// **Por eso la mezcla no se puede calcular una vez y cortarla.** Una serie reequilibrada a diario no depende de dónde empieza;
// con pesos fijados, sí: calculada desde 2015 y cortada en 2023, sus pesos ya han derivado y no son los del perfil. Quien compara
// pide la mezcla desde el primer día de SU ventana, y `mezclaDeReferencia` no tiene valor por defecto.
//
// Los dos fondos base quedan fuera del catálogo: no se pueden buscar ni elegir (`isExcludedBenchmarkIsin`).
// Aquí solo aportan su histórico.

import {
  annualizeByElapsedTime,
  contiguousWeeklyReturns,
  contiguousWeeklySteps
} from "./portfolioExtendedAnalytics";
import { oFalta, porcentaje } from "./formato";
import { isoWeekOrdinal, weeklyLastObservations, type DatedValue } from "./seriesFrequency";

/** Los dos fondos base. EXCLUIDOS de toda selección de activos o carteras. */
export const BASE_RENTA_FIJA_ISIN = "IE00B18GC888";
export const BASE_RENTA_VARIABLE_ISIN = "IE00B03HCZ61";
export const EXCLUDED_BENCHMARK_ISINS: readonly string[] = [BASE_RENTA_FIJA_ISIN, BASE_RENTA_VARIABLE_ISIN];

/** true si el id/ISIN corresponde a un fondo base excluido de la selección. */
export function isExcludedBenchmarkIsin(id?: string | null): boolean {
  return !!id && EXCLUDED_BENCHMARK_ISINS.includes(id);
}

export interface PesosDeLaMezcla {
  rf: number;
  rv: number;
}

export interface BenchmarkProfile {
  id: string;
  name: string;
  /** Fracciones: 0,5 = 50 %. */
  weights: PesosDeLaMezcla;
}

export const BENCHMARK_PROFILES: readonly BenchmarkProfile[] = [
  { id: "conservador", name: "Conservador", weights: { rf: 1, rv: 0 } },
  { id: "moderado", name: "Moderado", weights: { rf: 0.75, rv: 0.25 } },
  { id: "equilibrado", name: "Equilibrado", weights: { rf: 0.5, rv: 0.5 } },
  { id: "dinamico", name: "Dinámico", weights: { rf: 0.25, rv: 0.75 } },
  { id: "agresivo", name: "Agresivo", weights: { rf: 0, rv: 1 } }
];

/**
 * Perfil de referencia por defecto (el central de los cinco). Vive aquí, y no en
 * BenchmarkContext, para que los generadores de PDF no dependan de un módulo de
 * React solo para conocer el valor por defecto.
 */
export const DEFAULT_BENCHMARK_ID = "equilibrado";

export function benchmarkById(id: string): BenchmarkProfile | undefined {
  return BENCHMARK_PROFILES.find((p) => p.id === id);
}

/** true si el id corresponde a uno de los perfiles publicados. */
export function isKnownBenchmarkId(id?: string | null): boolean {
  return !!id && BENCHMARK_PROFILES.some((p) => p.id === id);
}

/** Un peso entero dentro de una frase («50 % renta fija global»): del módulo único, con su espacio duro (FMT-16). */
function porciento(fraccion: number): string {
  return oFalta(porcentaje(fraccion, { decimales: 0 }));
}

const SIN_REEQUILIBRAR = "con los pesos fijados el primer día, sin reequilibrar";

/** Qué es la cartera: «50 % renta fija global y 50 % renta variable global, con los pesos fijados el primer día, sin reequilibrar». */
export function composicionDeLaReferencia({ weights }: Pick<BenchmarkProfile, "weights">): string {
  if (weights.rv === 0) return `${porciento(1)} renta fija global`;
  if (weights.rf === 0) return `${porciento(1)} renta variable global`;
  return `${porciento(weights.rf)} renta fija global y ${porciento(weights.rv)} renta variable global, ${SIN_REEQUILIBRAR}`;
}

/** Lo mismo con sus fondos, para el documento interno del asesor. */
export function composicionConFondos({ weights }: Pick<BenchmarkProfile, "weights">): string {
  if (weights.rv === 0) return `${porciento(1)} ${BASE_RENTA_FIJA_ISIN}`;
  if (weights.rf === 0) return `${porciento(1)} ${BASE_RENTA_VARIABLE_ISIN}`;
  return `${porciento(weights.rf)} ${BASE_RENTA_FIJA_ISIN} + ${porciento(weights.rv)} ${BASE_RENTA_VARIABLE_ISIN}, ${SIN_REEQUILIBRAR}`;
}

/**
 * Lo que se dice de la cartera al lado de su referencia: tampoco se reequilibra. De un perfil de un solo fondo no se ha dicho
 * nada de reequilibrar, así que ahí no hay «tampoco».
 */
export function tampocoSeReequilibra({ weights }: Pick<BenchmarkProfile, "weights">): string {
  return `${weights.rf > 0 && weights.rv > 0 ? "tampoco" : "no"} se reequilibra`;
}

/** «50/50»: los pesos del perfil el primer día, renta fija y renta variable, en el orden en que los dice la nota. */
function pesosDelPrimerDia({ rf, rv }: PesosDeLaMezcla): string {
  return `${Math.round(rf * 100)}/${Math.round(rv * 100)}`;
}

/**
 * Cómo acaba la referencia, al lado de su nota (decisión 86 de Óscar, 05-11-2026): «50/50 el primer día; al final, 78 % renta
 * variable». Sin reequilibrar (decisión 39), un perfil deja de pesar lo que dice su nombre, y a 10 años quien lee «Equilibrado»
 * entiende 50/50. La cifra sale de las series (`rentaVariableAlFinal`), nunca de aquí.
 *
 * Un perfil de un solo fondo no deriva y no lleva frase; sin el dato tampoco.
 */
export function pesoDeLaReferenciaAlFinal(perfil: Pick<BenchmarkProfile, "weights">, rentaVariable: number | null | undefined): string | null {
  return pesoDeLaReferenciaPorVentanas(perfil, [{ anos: null, rentaVariable }]);
}

/**
 * Lo mismo con más de una ventana, como en el informe interno: «50/50 el primer día; al final, 61 % renta variable a 3 años y 65 % a 5».
 * Las ventanas sin el dato no se nombran; sin ninguna, no hay frase.
 */
export function pesoDeLaReferenciaPorVentanas(
  { weights }: Pick<BenchmarkProfile, "weights">,
  ventanas: ReadonlyArray<{ anos: number | null; rentaVariable: number | null | undefined }>
): string | null {
  if (weights.rf === 0 || weights.rv === 0) return null;
  const conDato = ventanas.filter((ventana): ventana is { anos: number | null; rentaVariable: number } =>
    typeof ventana.rentaVariable === "number" && Number.isFinite(ventana.rentaVariable));
  if (!conDato.length) return null;
  const trozos = conDato.map(({ anos, rentaVariable }, indice) => {
    const cuando = anos === null ? "" : indice === 0 ? ` a ${anos} años` : ` a ${anos}`;
    return `${porciento(rentaVariable)}${indice === 0 ? " renta variable" : ""}${cuando}`;
  });
  const enUnaFrase = trozos.length === 1 ? trozos[0] : `${trozos.slice(0, -1).join(", ")} y ${trozos[trozos.length - 1]}`;
  return `${pesosDelPrimerDia(weights)} el primer día; al final, ${enUnaFrase}`;
}

// --- La mezcla ---

/** Las series de los dos fondos, tal como llegan del servidor. */
export interface SeriesBaseDeReferencia {
  rf: readonly DatedValue[];
  rv: readonly DatedValue[];
}

function puntoValido(punto: DatedValue): boolean {
  return Number.isFinite(punto.value) && punto.value > 0;
}

function enOrden(puntos: readonly DatedValue[]): DatedValue[] {
  return puntos.filter(puntoValido).sort((a, b) => a.date.localeCompare(b.date));
}

/** Cuánto vale el último dato de un fondo el primer día: el hueco que puentea la simulación (`MAX_BRIDGED_WEEK_GAP_DAYS`). */
const ANTIGUEDAD_MAXIMA_DEL_PRIMER_DIA = 14;

/** El último valor conocido en esa fecha, como `portfolio_horizon._aligned`. Null si no hay o es de hace más de 14 días. */
function ultimoConocido(puntosEnOrden: readonly DatedValue[], fecha: string): number | null {
  let bajo = 0;
  let alto = puntosEnOrden.length - 1;
  let hallado = -1;
  while (bajo <= alto) {
    const medio = (bajo + alto) >> 1;
    if (puntosEnOrden[medio].date <= fecha) {
      hallado = medio;
      bajo = medio + 1;
    } else {
      alto = medio - 1;
    }
  }
  if (hallado < 0) return null;
  const dias = (Date.parse(fecha) - Date.parse(puntosEnOrden[hallado].date)) / 86_400_000;
  return dias <= ANTIGUEDAD_MAXIMA_DEL_PRIMER_DIA ? puntosEnOrden[hallado].value : null;
}

/**
 * La serie de la mezcla desde `desde`, con base 100 ese día: los pesos se fijan ahí y se dejan derivar, como en la simulación de
 * la cartera. `desde` es obligatorio porque es la regla: es el primer día de la ventana que se compara, y la serie no se puede
 * cortar para otra ventana.
 *
 * **El primer día** es el de la simulación: si ese día un fondo no publica, vale su último dato conocido, de hace 14 días como
 * mucho. Si no lo hay, la mezcla empieza en la primera fecha posterior con dato de los dos.
 *
 * **Después solo cuentan las fechas con dato de los dos fondos**: donde falta uno no hay valor y nada se arrastra (decisión 1).
 * Con pesos fijados un hueco no cambia ningún otro valor: cada uno depende de ese día y del primero, no del camino.
 *
 * Unos pesos que no suman 100 % (o negativos) no se normalizan en silencio: no hay serie. Sin dos fechas, tampoco.
 */
export function mezclaDeReferencia(
  rf: readonly DatedValue[],
  rv: readonly DatedValue[],
  pesos: PesosDeLaMezcla,
  desde: string
): DatedValue[] {
  return puntosDeLaMezcla(rf, rv, pesos, desde).map(({ date, value }) => ({ date, value }));
}

/** Un punto de la mezcla y lo que pesa en él la renta variable, en fracción. */
interface PuntoDeLaMezcla extends DatedValue {
  rentaVariable: number;
}

/** La mezcla de `mezclaDeReferencia`, con la renta variable de cada día: el mismo cálculo, y la misma cifra en `value`. */
function puntosDeLaMezcla(
  rf: readonly DatedValue[],
  rv: readonly DatedValue[],
  pesos: PesosDeLaMezcla,
  desde: string
): PuntoDeLaMezcla[] {
  if (!Number.isFinite(pesos.rf) || !Number.isFinite(pesos.rv) || pesos.rf < 0 || pesos.rv < 0 || Math.abs(pesos.rf + pesos.rv - 1) > 1e-9) {
    return [];
  }
  const fondoRf = enOrden(rf);
  const fondoRv = enOrden(rv);
  const rfPorFecha = new Map(fondoRf.map((punto) => [punto.date, punto.value]));
  const comunes = fondoRv
    .filter((punto) => punto.date >= desde && rfPorFecha.has(punto.date))
    .map((punto) => ({ date: punto.date, rv: punto.value, rf: rfPorFecha.get(punto.date) as number }));
  const baseRf = ultimoConocido(fondoRf, desde);
  const baseRv = ultimoConocido(fondoRv, desde);
  const base = baseRf !== null && baseRv !== null ? { date: desde, rf: baseRf, rv: baseRv } : comunes[0];
  if (!base) return [];
  const serie: PuntoDeLaMezcla[] = [{ date: base.date, value: 100, rentaVariable: pesos.rv }];
  for (const fila of comunes) {
    if (fila.date > base.date) {
      const parteRf = (pesos.rf * fila.rf) / base.rf;
      const parteRv = (pesos.rv * fila.rv) / base.rv;
      serie.push({ date: fila.date, value: 100 * (parteRf + parteRv), rentaVariable: parteRv / (parteRf + parteRv) });
    }
  }
  return serie.length >= 2 ? serie : [];
}

/**
 * Lo que pesa la renta variable en la mezcla al final de una ventana, en fracción (decisión 86). Es la de `mezclaDeReferencia`, con
 * los pesos fijados en `desde`; el final es la última fecha con dato de los dos fondos que no pasa de `hasta`:
 *
 *   RV al final = pesoRV × RV(fin) / RV(primer día) ÷ [pesoRF × RF(fin) / RF(primer día) + pesoRV × RV(fin) / RV(primer día)]
 *
 * Null si en esas fechas no hay mezcla: la frase que la usa no se escribe.
 */
export function rentaVariableAlFinal(series: SeriesBaseDeReferencia, pesos: PesosDeLaMezcla, desde: string, hasta: string): number | null {
  const puntos = puntosDeLaMezcla(series.rf, series.rv, pesos, desde).filter((punto) => punto.date <= hasta);
  return puntos.length >= 2 ? puntos[puntos.length - 1].rentaVariable : null;
}

/** Las fechas con dato de los dos fondos, en orden. */
function fechasDeLaReferencia(series: SeriesBaseDeReferencia): string[] {
  const conRf = new Set(enOrden(series.rf).map((punto) => punto.date));
  return enOrden(series.rv).map((punto) => punto.date).filter((fecha) => conRf.has(fecha));
}

/** El perfil, si existe y sus dos fondos tienen al menos dos fechas en común. Si no, no hay referencia que calcular. */
export function perfilCalculable(perfilId: string, series: SeriesBaseDeReferencia | null | undefined): BenchmarkProfile | null {
  const perfil = benchmarkById(perfilId);
  return perfil && series && fechasDeLaReferencia(series).length >= 2 ? perfil : null;
}

// --- Comparar en las mismas fechas ---

/**
 * La referencia en esas fechas, con base 100 en la primera que tiene dato. Donde no lo hay, null:
 * nunca se arrastra el último valor. Con la referencia arrastrada, las semanas de la cartera iban de
 * viernes a viernes y las suyas de lunes a lunes, y salía beta 0,25 para una cartera que se mueve con ella.
 */
export function referenciaEnFechas(fechas: readonly string[], mezcla: readonly DatedValue[]): Array<number | null> {
  const porFecha = new Map(mezcla.map((punto) => [punto.date, punto.value]));
  let base: number | null = null;
  return fechas.map((fecha) => {
    const valor = porFecha.get(fecha);
    if (valor === undefined) return null;
    base ??= valor;
    return (valor / base) * 100;
  });
}

/**
 * Lo mismo para una serie semanal del servidor, cuyas fechas son el lunes de cada semana y sus
 * valores los del último dato de la semana: se toma el último dato de la referencia en esa semana.
 */
export function referenciaEnSemanas(lunes: readonly string[], mezcla: readonly DatedValue[]): Array<number | null> {
  const porSemana = new Map<number, number>();
  for (const punto of mezcla) {
    const semana = isoWeekOrdinal(punto.date);
    if (semana !== null) porSemana.set(semana, punto.value);
  }
  let base: number | null = null;
  return lunes.map((fecha) => {
    const semana = isoWeekOrdinal(fecha);
    const valor = semana === null ? undefined : porSemana.get(semana);
    if (valor === undefined) return null;
    base ??= valor;
    return (valor / base) * 100;
  });
}

/**
 * Semanas en común para que una comparación diga algo: medio año, el mismo mínimo que las medidas
 * frente a la referencia del informe interno (`benchmarkRelativeStats`). Por debajo no se compara y se dice.
 */
export const MIN_SEMANAS_COMUNES = 26;

export interface ComparacionConReferencia {
  /** Solo las fechas con dato de las dos series. */
  fechas: string[];
  /** La serie comparada en esas fechas, con base 100 en la primera. */
  valores: number[];
  /** La referencia en esas mismas fechas, con base 100 en la primera y los pesos fijados ese día. */
  referencia: number[];
  /** La misma referencia, en las fechas de entrada: mismo índice, null donde no se compara. Es lo que leen las medidas relativas. */
  referenciaEnLaSerie: Array<number | null>;
  primeraComun: string;
  ultimaComun: string;
  /** Hay datos de la serie comparada después de la última fecha común. */
  cortadaAlFinal: boolean;
  /** Hay datos de la serie comparada antes de la primera fecha común. */
  cortadaAlInicio: boolean;
  /** Rendimientos semanales en común, entre semanas contiguas. */
  semanasComunes: number;
  /**
   * Lo que pesa la renta variable en la referencia el último día que se compara, en fracción: sin reequilibrar, ya no es la del
   * perfil (decisión 86). La dice `pesoDeLaReferenciaAlFinal`. Null si no se puede saber.
   */
  rentaVariableAlFinal: number | null;
}

/**
 * El primer día de la comparación, que es el que fija los pesos de la referencia: la primera fecha de la serie comparada para la
 * que la referencia puede dar valor. En semanal, el último dato de la referencia en esa semana, porque es el que se empareja.
 */
function primerDiaDeLaComparacion(
  fechas: readonly string[],
  valores: readonly number[],
  series: SeriesBaseDeReferencia,
  frecuencia: "DAILY" | "WEEKLY"
): string | null {
  const conValor = fechas.filter((_, indice) => Number.isFinite(valores[indice]) && valores[indice] > 0);
  if (frecuencia === "WEEKLY") {
    const ultimaDeLaSemana = new Map<number, string>();
    for (const fecha of fechasDeLaReferencia(series)) {
      const semana = isoWeekOrdinal(fecha);
      if (semana !== null) ultimaDeLaSemana.set(semana, fecha);
    }
    for (const lunes of conValor) {
      const semana = isoWeekOrdinal(lunes);
      const fecha = semana === null ? undefined : ultimaDeLaSemana.get(semana);
      if (fecha) return fecha;
    }
    return null;
  }
  const fondoRf = enOrden(series.rf);
  const fondoRv = enOrden(series.rv);
  return conValor.find((fecha) => ultimoConocido(fondoRf, fecha) !== null && ultimoConocido(fondoRv, fecha) !== null) ?? null;
}

/**
 * Serie y referencia en las mismas fechas y hasta su última fecha común, con la mezcla calculada desde el primer día de esta
 * comparación (decisión 39). Con menos de `MIN_SEMANAS_COMUNES` no hay comparación (null). `frecuencia` dice cómo es la serie de
 * entrada: «WEEKLY» es la semanal del servidor, con el lunes como fecha.
 */
export function compararEnMismasFechas(
  fechas: readonly string[],
  valores: readonly number[],
  pesos: PesosDeLaMezcla,
  series: SeriesBaseDeReferencia,
  frecuencia: "DAILY" | "WEEKLY" = "DAILY"
): ComparacionConReferencia | null {
  const desde = primerDiaDeLaComparacion(fechas, valores, series, frecuencia);
  if (desde === null) return null;
  const mezcla = mezclaDeReferencia(series.rf, series.rv, pesos, desde);
  const enFechas = frecuencia === "WEEKLY" ? referenciaEnSemanas(fechas, mezcla) : referenciaEnFechas(fechas, mezcla);
  const conValor = fechas
    .map((fecha, indice) => ({ fecha, valor: valores[indice], referencia: enFechas[indice] }))
    .filter((fila) => Number.isFinite(fila.valor) && fila.valor > 0);
  const comunes = conValor.filter((fila): fila is { fecha: string; valor: number; referencia: number } => fila.referencia !== null);
  if (comunes.length < 2) return null;
  const semanas =
    frecuencia === "WEEKLY"
      ? comunes.length - 1
      : contiguousWeeklySteps(weeklyLastObservations(comunes.map((fila) => ({ date: fila.fecha, value: fila.valor })))).length;
  if (semanas < MIN_SEMANAS_COMUNES) return null;
  const [primera] = comunes;
  const ultima = comunes[comunes.length - 1];
  return {
    fechas: comunes.map((fila) => fila.fecha),
    valores: comunes.map((fila) => (fila.valor / primera.valor) * 100),
    referencia: comunes.map((fila) => (fila.referencia / primera.referencia) * 100),
    referenciaEnLaSerie: enFechas,
    primeraComun: primera.fecha,
    ultimaComun: ultima.fecha,
    cortadaAlFinal: ultima.fecha !== conValor[conValor.length - 1].fecha,
    cortadaAlInicio: primera.fecha !== conValor[0].fecha,
    semanasComunes: semanas,
    rentaVariableAlFinal: rentaVariableAlFinal(series, pesos, desde, ultimoDiaDeLaReferencia(mezcla, ultima.fecha, frecuencia))
  };
}

/**
 * El día de la mezcla que se ha comparado con la última fecha común: ese mismo en diario, y en semanal el último de la mezcla en esa
 * semana, que es el que empareja `referenciaEnSemanas`.
 */
function ultimoDiaDeLaReferencia(mezcla: readonly DatedValue[], fecha: string, frecuencia: "DAILY" | "WEEKLY"): string {
  if (frecuencia !== "WEEKLY") return fecha;
  const semana = isoWeekOrdinal(fecha);
  let ultimo = fecha;
  for (const punto of mezcla) {
    if (semana !== null && isoWeekOrdinal(punto.date) === semana) ultimo = punto.date;
  }
  return ultimo;
}

/** Otra serie con las fechas de esa comparación, con base 100 en la primera: los demás activos de un gráfico. */
export function otraSerieEnLaComparacion(
  fechas: readonly string[],
  valores: readonly number[],
  comparacion: Pick<ComparacionConReferencia, "fechas">
): number[] {
  const porFecha = new Map(fechas.map((fecha, indice) => [fecha, valores[indice]]));
  const base = porFecha.get(comparacion.fechas[0]);
  return comparacion.fechas.map((fecha) => ((porFecha.get(fecha) ?? Number.NaN) / (base ?? Number.NaN)) * 100);
}

// --- Las carteras de referencia en el mapa de riesgo y rentabilidad ---

export interface ReferenceProfile {
  id: string;
  /** Etiqueta corta visible en el mapa. */
  label: string;
  /** Volatilidad anualizada (fracción: 0,10 = 10 %). */
  vol: number;
  /** Rentabilidad anualizada (fracción). */
  ret: number;
}

export interface ReferenceProfileWindow {
  profiles: ReferenceProfile[];
  /** La cartera medida igual y en esas mismas fechas. */
  cartera: { vol: number; ret: number };
  /** Primera y última fecha comunes. */
  firstDate: string;
  lastDate: string;
  /** Rendimientos semanales usados. */
  observations: number;
  /** Las fechas comunes empiezan y acaban donde la serie de la cartera. */
  mismaVentana: boolean;
}

/** Desviación muestral de los rendimientos semanales × raíz de 52, y rentabilidad por tiempo transcurrido. */
function medidaSemanal(puntos: readonly DatedValue[]): { vol: number; ret: number; semanas: number } | null {
  const rendimientos = contiguousWeeklyReturns(weeklyLastObservations(puntos)).map((r) => r.value);
  if (rendimientos.length < 2 || puntos.length < 2) return null;
  const media = rendimientos.reduce((suma, r) => suma + r, 0) / rendimientos.length;
  const varianza = rendimientos.reduce((suma, r) => suma + (r - media) ** 2, 0) / (rendimientos.length - 1);
  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  const ret = annualizeByElapsedTime(primero.date, ultimo.date, primero.value, ultimo.value);
  return ret === null ? null : { vol: Math.sqrt(varianza) * Math.sqrt(52), ret, semanas: rendimientos.length };
}

/** Las cinco, cada una con sus pesos fijados el primer día de esas fechas: es su primer día, no el de otra ventana. */
function perfilesMedidos(series: SeriesBaseDeReferencia, fechas: readonly string[]): ReferenceProfile[] | null {
  const [primerDia] = fechas;
  if (primerDia === undefined) return null;
  const dentro = new Set(fechas);
  const perfiles: ReferenceProfile[] = [];
  for (const perfil of BENCHMARK_PROFILES) {
    const mezcla = mezclaDeReferencia(series.rf, series.rv, perfil.weights, primerDia).filter((punto) => dentro.has(punto.date));
    const medida = medidaSemanal(mezcla);
    if (!medida) return null;
    perfiles.push({ id: perfil.id, label: perfil.name, vol: medida.vol, ret: medida.ret });
  }
  return perfiles;
}

/**
 * Las cinco carteras de referencia y la cartera, medidas en las mismas fechas: semanal × raíz de 52, y
 * rentabilidad por tiempo transcurrido entre la primera y la última fecha común. Null sin solape suficiente.
 */
export function referenceProfilesForDates(
  fechas: readonly string[],
  valores: readonly number[],
  series: SeriesBaseDeReferencia
): ReferenceProfileWindow | null {
  /* Las fechas son las mismas para los cinco perfiles: sirve cualquiera. */
  const comparacion = compararEnMismasFechas(fechas, valores, { rf: 1, rv: 0 }, series);
  if (!comparacion) return null;
  const profiles = perfilesMedidos(series, comparacion.fechas);
  const cartera = medidaSemanal(comparacion.fechas.map((date, indice) => ({ date, value: comparacion.valores[indice] })));
  if (!profiles || !cartera) return null;
  return {
    profiles,
    cartera: { vol: cartera.vol, ret: cartera.ret },
    firstDate: comparacion.primeraComun,
    lastDate: comparacion.ultimaComun,
    observations: comparacion.semanasComunes,
    mismaVentana: !comparacion.cortadaAlFinal && !comparacion.cortadaAlInicio
  };
}

/**
 * Las cinco carteras a 3 años hasta su último dato, para el mapa de un informe sin serie de la cartera,
 * que no la compara con ellas: no están medidas en las mismas fechas.
 */
export function perfilesATresAnos(series: SeriesBaseDeReferencia): { profiles: ReferenceProfile[]; lastDate: string } | null {
  const todas = fechasDeLaReferencia(series);
  const ultima = todas.at(-1);
  if (!ultima) return null;
  const desde = `${Number(ultima.slice(0, 4)) - 3}${ultima.slice(4)}`;
  const profiles = perfilesMedidos(series, todas.filter((fecha) => fecha >= desde));
  return profiles ? { profiles, lastDate: ultima } : null;
}
