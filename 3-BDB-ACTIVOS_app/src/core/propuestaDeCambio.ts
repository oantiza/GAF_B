import type { BacktestStressScenario } from "../adapters/backtestPortfolioBackend";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { crisisPasadas, SIN_DATOS_DE_LA_CRISIS, type CrisisDelInforme, type PosicionDeLaCartera } from "./crisisPasadas";
import { esAccion } from "./esAccion";
import { fecha, importe as escribirImporte, importeTitular, numero, oFalta, peso, porcentaje, rentabilidad } from "./formato";
import { diaLocal } from "./fechaLocal";
import { fraseDeLaParteMedida, motivoParaElCliente, parteMedidaDeLaSimulacion, pesoEnElPapel, type ParteMedida } from "./parteMedida";
import { assetOngoingCharge, calculatePortfolioCosts, esSoloDeAcciones, fraseDelCoste } from "./portfolioCosts";
import {
  alinearLasQueDanCifra,
  comparisonPositions,
  hasWeeklyGaps,
  notaDeAmpliacionLegible,
  type ComparisonHistory,
  type ComparisonMetrics,
  type ComparisonPeriod
} from "./portfolioComparison";
import { capitalValido, comparisonConcentration, comparisonPositionRows } from "./portfolioComparisonReport";
import { hayCifraDeCartera, PESO_MINIMO_MEDIDO_PCT } from "./riesgoMedido";
import { resolveBanker, type ReportBanker } from "./reportBanker";
import { notaDeDatosHasta, posicionesParadas } from "./serieParada";
import { textoDeAusencia } from "./textoDeAusencia";

/**
 * La Propuesta de cambio (decisión 32 de Óscar): qué se le propone cambiar a un cliente y por qué, con las dos composiciones
 * en el mismo periodo. Aquí se compone todo lo que el papel imprime, y el papel no calcula nada.
 *
 * **No hay cálculo nuevo salvo el plan de ejecución:** las cifras salen de la Comparativa de carteras
 * (`alignPortfolioComparison`), las crisis del informe de cliente (`crisisPasadas`), el coste del informe de costes
 * (`calculatePortfolioCosts` y `fraseDelCoste`) y lo que queda fuera de la simulación de `parteMedida`.
 *
 * **Se describe, no se valora.** Ninguna frase dice cuál es mejor: las diferencias son «Propuesta menos Actual», sin adjetivo. El
 * motivo lo escribe el asesor y se imprime tal cual: nunca se deduce de las cifras. Y **no se alimenta de «Fondos equivalentes»
 * ni de la Propuesta de mejora**: su plan dice que al cliente no se le enseña hasta validar en vivo, y sigue en pie
 * (`docs/PLAN_MEJORA_CARTERA_EQUIVALENTES_2026-10-13.md`). Actual y Propuesta se eligen a mano.
 */

export const ROTULO_ACTUAL = "Actual";
export const ROTULO_PROPUESTA = "Propuesta";

/** Lo que cabe sin que el motivo o las notas se coman la hoja del plan. */
export const MAXIMO_DEL_MOTIVO = 1200;
export const MAXIMO_DE_LAS_NOTAS_DEL_PLAN = 600;

/** Un cambio que no llega a una centésima de punto no se ve con las dos decimales del papel: no es una operación. */
const CAMBIO_MINIMO_EN_PUNTOS = 0.005;

const FALTA = textoDeAusencia("falta");
const NO_APLICA = textoDeAusencia("no-aplica");
const SIN_CAMBIO = "Sin cambio";
/** El de `formato`: la cifra y su unidad no se separan al saltar de línea. */
const ESPACIO_DURO = String.fromCharCode(0xa0);

const posiciones = (n: number) => `${n} ${n === 1 ? "posición" : "posiciones"}`;

/** Puntos porcentuales con su signo y su «pp»: «+1,50 pp». Un cero redondeado se escribe sin signo: «−0,00 pp» no dice nada. */
export function puntosConSigno(puntos: number, digitos = 2): string {
  return `${oFalta(numero(puntos, { decimales: digitos, conSigno: true }))}${ESPACIO_DURO}pp`;
}

function eurosConSigno(euros: number): string {
  return oFalta(escribirImporte(euros, { conSigno: true }));
}

export interface CarteraDeLaPropuesta {
  name: string;
  positions: readonly BdbManualPortfolioPosition[];
}

const conPeso = (cartera: CarteraDeLaPropuesta) =>
  cartera.positions.some((p) => Number.isFinite(p.weight_percent) && p.weight_percent > 0);

/** Si las dos dicen lo mismo, una vez llevadas al 100 %. */
export function mismaComposicion(a: CarteraDeLaPropuesta, b: CarteraDeLaPropuesta): boolean {
  const pesos = (cartera: CarteraDeLaPropuesta) => new Map(comparisonPositions(cartera.positions).map((p) => [p.asset_id, p.weight_percent]));
  const uno = pesos(a);
  const otro = pesos(b);
  return [...new Set([...uno.keys(), ...otro.keys()])].every((id) => Math.abs((uno.get(id) ?? 0) - (otro.get(id) ?? 0)) < CAMBIO_MINIMO_EN_PUNTOS);
}

/** Lo que impide descargar, o null. El botón queda inactivo y esto es lo que dice el diálogo. */
export function faltaParaLaPropuesta({ actual, propuesta, motivo }: {
  actual: CarteraDeLaPropuesta | null | undefined;
  propuesta: CarteraDeLaPropuesta | null | undefined;
  motivo: string;
}): string | null {
  if (!actual && !propuesta) return `Falta elegir ${ROTULO_ACTUAL} y ${ROTULO_PROPUESTA}.`;
  if (!actual) return `Falta elegir la composición ${ROTULO_ACTUAL}.`;
  if (!propuesta) return `Falta elegir la composición ${ROTULO_PROPUESTA}.`;
  if (!conPeso(actual)) return `${ROTULO_ACTUAL} no tiene posiciones con peso.`;
  if (!conPeso(propuesta)) return `${ROTULO_PROPUESTA} no tiene posiciones con peso.`;
  try {
    if (mismaComposicion(actual, propuesta)) return `${ROTULO_ACTUAL} y ${ROTULO_PROPUESTA} tienen la misma composición: no hay cambio que enseñar.`;
  } catch (causa) {
    return causa instanceof Error ? causa.message : "Revisa los pesos de las dos carteras.";
  }
  if (!motivo.trim()) return "Falta escribir el motivo de la propuesta.";
  return null;
}

/* ------------------------------------------------------------------ Qué cambia ------------------------------------------------------------------ */

export interface FilaDeCambio {
  id: string;
  nombre: string;
  /** ISIN si se conoce; si no, el identificador de la posición. */
  codigo: string;
  /** De 0 a 100, con cada composición llevada al 100 %. */
  pesoActual: number;
  pesoPropuesta: number;
  /** Propuesta menos Actual, en puntos. */
  diferencia: number;
  textoActual: string;
  textoPropuesta: string;
  textoDiferencia: string;
  /** «0,20 %», «No aplica» si es una acción, «Falta el dato» si es un fondo o un ETF sin él. */
  coste: string;
  /** «Solo en Actual» o «Solo en Propuesta». Null si está en las dos, que es lo que se espera. */
  donde: string | null;
  /** Si la simulación no la mide, en qué lado. */
  fueraDeLaSimulacion: string | null;
}

function costeDeLaFila(activo: BdbAssetDetail | undefined): string {
  if (esAccion(activo?.instrument_type)) return NO_APLICA;
  const coste = assetOngoingCharge(activo);
  return coste == null ? FALTA : oFalta(porcentaje(coste));
}

function fueraEn(id: string, actual: ParteMedida | null, propuesta: ParteMedida | null): string | null {
  const enActual = actual?.excluded.some((item) => item.assetId === id) ?? false;
  const enPropuesta = propuesta?.excluded.some((item) => item.assetId === id) ?? false;
  if (enActual && enPropuesta) return "Fuera de la simulación en las dos";
  if (enActual) return `Fuera de la simulación en ${ROTULO_ACTUAL}`;
  if (enPropuesta) return `Fuera de la simulación en ${ROTULO_PROPUESTA}`;
  return null;
}

/** Posición a posición, de mayor a menor cambio. Salen todas, también las que no cambian: así los pesos suman 100 a la vista. */
export function filasDeCambios(
  actual: CarteraDeLaPropuesta,
  propuesta: CarteraDeLaPropuesta,
  assets: readonly BdbAssetDetail[],
  medidas: { actual: ParteMedida | null; propuesta: ParteMedida | null } = { actual: null, propuesta: null }
): FilaDeCambio[] {
  const porId = new Map(assets.map((activo) => [activo.asset_id, activo]));
  return comparisonPositionRows(actual.positions, propuesta.positions, assets).map((fila) => {
    const diferencia = fila.b - fila.a;
    const activo = porId.get(fila.id);
    return {
      id: fila.id,
      nombre: fila.name,
      codigo: activo?.isin ?? fila.id,
      pesoActual: fila.a,
      pesoPropuesta: fila.b,
      diferencia,
      textoActual: oFalta(peso(fila.a / 100)),
      textoPropuesta: oFalta(peso(fila.b / 100)),
      textoDiferencia: Math.abs(diferencia) < CAMBIO_MINIMO_EN_PUNTOS ? SIN_CAMBIO : puntosConSigno(diferencia),
      coste: costeDeLaFila(activo),
      donde: !fila.a ? `Solo en ${ROTULO_PROPUESTA}` : !fila.b ? `Solo en ${ROTULO_ACTUAL}` : null,
      fueraDeLaSimulacion: fueraEn(fila.id, medidas.actual, medidas.propuesta)
    };
  });
}

/* --------------------------------------------------------------- Plan de ejecución --------------------------------------------------------------- */

export type OperacionDelPlan = "Salir" | "Reducir" | "Aumentar" | "Incorporar";

export interface PasoDelPlan {
  operacion: OperacionDelPlan;
  id: string;
  nombre: string;
  codigo: string;
  /** Lo que se mueve, en puntos de la cartera. Siempre positivo: el sentido lo dice la operación. */
  puntos: number;
  textoPuntos: string;
  /** Null sin capital: sin capital no hay importes. */
  importe: number | null;
  textoImporte: string | null;
}

export interface PlanDeEjecucion {
  pasos: PasoDelPlan[];
  capital: number | null;
  /** Lo que cambia de posición: la mitad de la suma de las diferencias (`comparisonConcentration`). */
  totalPuntos: number;
  textoTotalPuntos: string;
  totalImporte: number | null;
  textoTotalImporte: string | null;
  /** Cambios que no llegan a una centésima de punto: no se listan, y se dice cuántos. */
  menoresSinListar: number;
}

/**
 * Euros enteros que suman lo que tienen que sumar (CMP-4, auditoría del 16-11-2026). Redondeando cada importe por su
 * cuenta, la columna no sumaba el total que se escribe debajo: con 123.456,78 €, salir de un 40 % y reducir un 10 % son
 * 49.382,71 € y 12.345,68 €, que redondeados dan 61.729 € junto a un total de 61.728 €. Aquí la suma de lo escrito es el
 * redondeo de la suma: cada importe se trunca, y los euros que faltan van a los de mayor resto, uno a cada uno.
 */
export function eurosQueCuadran(importes: readonly number[]): number[] {
  const enteros = importes.map((importe) => Math.floor(importe));
  let faltan = Math.round(importes.reduce((suma, importe) => suma + importe, 0)) - enteros.reduce((suma, entero) => suma + entero, 0);
  const porResto = importes.map((importe, indice) => ({ indice, resto: importe - Math.floor(importe) })).sort((a, b) => b.resto - a.resto || a.indice - b.indice);
  for (const { indice } of porResto) {
    if (faltan <= 0) break;
    enteros[indice] += 1;
    faltan -= 1;
  }
  return enteros;
}

/**
 * El plan de ejecución: qué se reduce o se deja y qué se aumenta o se incorpora, con la misma resta que «Qué cambia». Primero lo que
 * libera dinero y después lo que lo usa, de mayor a menor. El de la Radiografía, de donde viene (decisión 31), no calculaba
 * nada: era un texto que escribía el asesor. Ese texto sigue, en las notas; esto es lo que el papel puede decir por sí mismo.
 *
 * Con capital, el importe de cada paso es ese capital por sus puntos. No es una orden: no hay títulos, ni fechas, ni precios.
 */
export function planDeEjecucion(filas: readonly FilaDeCambio[], capitalFijado: number | null | undefined): PlanDeEjecucion {
  const capital = capitalValido(capitalFijado);
  const importeDe = (puntos: number) => (capital == null ? null : (capital * puntos) / 100);
  const conCambio = filas.filter((fila) => Math.abs(fila.diferencia) >= CAMBIO_MINIMO_EN_PUNTOS);
  const paso = (fila: FilaDeCambio): PasoDelPlan => {
    const puntos = Math.abs(fila.diferencia);
    const importe = importeDe(puntos);
    const operacion: OperacionDelPlan = fila.diferencia < 0
      ? (fila.pesoPropuesta === 0 ? "Salir" : "Reducir")
      : (fila.pesoActual === 0 ? "Incorporar" : "Aumentar");
    return {
      operacion,
      id: fila.id,
      nombre: fila.nombre,
      codigo: fila.codigo,
      puntos,
      textoPuntos: oFalta(porcentaje(puntos / 100)),
      importe,
      textoImporte: importe == null ? null : oFalta(importeTitular(importe))
    };
  };
  const deMayorAMenor = (a: PasoDelPlan, b: PasoDelPlan) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre, "es");
  /* Lo que se escribe de cada lado suma su redondeo (`eurosQueCuadran`): con los pesos al 100 % y sin cambios por debajo
     del mínimo, lo que sale, lo que entra y el total dicen la misma cifra. `importe` sigue siendo el exacto. */
  const conImportesQueCuadran = (lado: PasoDelPlan[]): PasoDelPlan[] => {
    if (capital == null) return lado;
    const escritos = eurosQueCuadran(lado.map((item) => item.importe ?? 0));
    return lado.map((item, indice) => ({ ...item, textoImporte: oFalta(importeTitular(escritos[indice])) }));
  };
  const pasos = [
    ...conImportesQueCuadran(conCambio.filter((fila) => fila.diferencia < 0).map(paso).sort(deMayorAMenor)),
    ...conImportesQueCuadran(conCambio.filter((fila) => fila.diferencia > 0).map(paso).sort(deMayorAMenor))
  ];
  /* Con los pesos ya al 100 %, lo que sale y lo que entra son lo mismo: la mitad de la suma de las diferencias. */
  const totalPuntos = filas.reduce((suma, fila) => suma + Math.abs(fila.diferencia), 0) / 2;
  const totalImporte = importeDe(totalPuntos);
  return {
    pasos,
    capital,
    totalPuntos,
    textoTotalPuntos: oFalta(porcentaje(totalPuntos / 100)),
    totalImporte,
    textoTotalImporte: totalImporte == null ? null : oFalta(importeTitular(totalImporte)),
    menoresSinListar: filas.filter((fila) => fila.diferencia !== 0 && Math.abs(fila.diferencia) < CAMBIO_MINIMO_EN_PUNTOS).length
  };
}

/* ---------------------------------------------------- Rentabilidad, volatilidad y caída, en la misma ventana ---------------------------------------------------- */

export interface FilaDeCifras {
  rotulo: string;
  actual: string;
  propuesta: string;
  diferencia: string;
}

export interface CifrasDeLasDos {
  /** «3 años», o «periodo disponible» si no llegan. */
  periodo: string;
  /** «Del 26/10/2023 al 28/10/2026 (762 fechas comunes), en euros», o null si no hay ventana común. */
  ventana: string | null;
  filas: FilaDeCifras[];
  /** Lo que acompaña a las cifras, en este orden: lo que queda fuera de cada una, por qué falta algo y qué se ha estimado. */
  notas: string[];
  /** Una cifra que se da sale en parte de un tramo estimado: la cabecera de la tabla lo dice, como en la Comparativa de carteras. */
  conTramoEstimado: boolean;
}

/**
 * De qué son netas las cifras, para que el coste corriente no se reste otra vez. Comprobado en el servidor y dicho igual en pantalla
 * (`notaDeLaSimulacion`): los pesos de hoy desde el primer día, y series de valores liquidativos y de precios en euros.
 */
export function deQueSonNetasLasCifras(hayFondos: boolean): string {
  return hayFondos
    ? "Cada composición con sus pesos desde el primer día, sin reequilibrar. Las cifras ya van netas del coste corriente de los fondos, y antes de asesoramiento e impuestos."
    : "Cada composición con sus pesos desde el primer día, sin reequilibrar. Las cifras van antes de asesoramiento e impuestos.";
}

interface LadoMedido {
  rotulo: string;
  historia: ComparisonHistory | null;
  parte: ParteMedida | null;
}

const enMinuscula = (frase: string) => `${frase.charAt(0).toLocaleLowerCase("es-ES")}${frase.slice(1)}`;

/** «Actual: mide el 88,0 % de la cartera…». Solo si baja del 100 %. */
function notaDeCobertura(lado: LadoMedido, nombreDe: (id: string) => string): string | null {
  const frase = fraseDeLaParteMedida(lado.parte, nombreDe, "detalladas debajo");
  return frase ? `${lado.rotulo}: ${enMinuscula(frase)}` : null;
}

/** Decisión 36: por debajo del 80 % no hay cifra de la cartera. Lo que mide es otra cosa, y aquí se compara. */
function notaDeFaltaDeCifra(lado: LadoMedido): string | null {
  if (!lado.historia) return `${lado.rotulo}: ninguna de sus posiciones tiene serie suficiente en este periodo, así que no se puede simular.`;
  if (!lado.parte) return `${lado.rotulo}: la simulación no corresponde a las posiciones de esta composición, y no se da ninguna cifra.`;
  if (hayCifraDeCartera(lado.parte.weightPercent)) return null;
  return `${lado.rotulo}: la simulación mide el ${pesoEnElPapel(lado.parte.weightPercent)} del peso, y para dar una cifra de la cartera hace falta al menos el ${numero(PESO_MINIMO_MEDIDO_PCT)}${ESPACIO_DURO}%.`;
}

function notaDeAmpliacion(lado: LadoMedido, nombreDe: (id: string) => string): string[] {
  return (lado.historia?.extensionNotes ?? []).map((nota) => `${lado.rotulo}: ${notaDeAmpliacionLegible(nota, nombreDe)}`);
}

export function cifrasDeLasDos(
  actual: LadoMedido,
  propuesta: LadoMedido,
  periodo: ComparisonPeriod,
  nombreDe: (id: string) => string
): CifrasDeLasDos {
  const cobertura = [notaDeCobertura(actual, nombreDe), notaDeCobertura(propuesta, nombreDe)].filter((nota): nota is string => Boolean(nota));
  const faltas = [notaDeFaltaDeCifra(actual), notaDeFaltaDeCifra(propuesta)].filter((nota): nota is string => Boolean(nota));
  const ampliaciones = [...notaDeAmpliacion(actual, nombreDe), ...notaDeAmpliacion(propuesta, nombreDe)];
  /* La rentabilidad, con su signo; la volatilidad y la caída máxima, porcentajes sin él. */
  const rotulos: Array<[string, (m: ComparisonMetrics) => number | null, (valor: number) => string | null]> = [
    ["Rentabilidad anualizada", (m) => m.cagr, rentabilidad],
    ["Volatilidad", (m) => m.volatility, porcentaje],
    ["Caída máxima", (m) => m.maxDrawdown, porcentaje]
  ];
  /* CMP-2 (auditoría del 16-11-2026): bastaba con que UNA no tuviera serie para no dar ninguna cifra, mientras Comparar
     carteras, con las mismas dos, enseña las de la que sí la tiene. Ahora es como allí y como cuando una no llega al 80 %
     del peso (CMP-1): la que tiene serie da sus cifras, sobre su propio periodo. Sin ninguna de las dos, nada. */
  if (!actual.historia && !propuesta.historia) {
    return {
      periodo: `${Number.parseInt(periodo, 10)} años`,
      ventana: null,
      filas: rotulos.map(([rotulo]) => ({ rotulo, actual: FALTA, propuesta: FALTA, diferencia: FALTA })),
      notas: [...cobertura, ...faltas, "Sin ninguna de las dos simulaciones no hay cifras que dar."],
      conTramoEstimado: false
    };
  }
  const seDaLaDe = (lado: LadoMedido) => Boolean(lado.parte) && hayCifraDeCartera(lado.parte?.weightPercent);
  /* CMP-1: la composición que no da cifra no recorta el periodo de la otra. Con una sola, sus cifras son de su propio periodo. */
  const resultado = alinearLasQueDanCifra({ historia: actual.historia, daCifra: seDaLaDe(actual) }, { historia: propuesta.historia, daCifra: seDaLaDe(propuesta) }, periodo)!;
  const soloUna = seDaLaDe(actual) !== seDaLaDe(propuesta);
  /* Con menos de un año común no se anualiza (15-11-2026): la fila da la rentabilidad del periodo, con sus fechas. */
  if (!resultado.annualized) {
    rotulos[0] = [`Rentabilidad del periodo, ${resultado.rangeLabel}`, (m) => m.cumulative, rentabilidad];
  }
  const filas = rotulos.map(([rotulo, lee, escribe]) => {
    const a = seDaLaDe(actual) ? lee(resultado.metricsA) : null;
    const b = seDaLaDe(propuesta) ? lee(resultado.metricsB) : null;
    return {
      rotulo,
      actual: a == null ? FALTA : oFalta(escribe(a)),
      propuesta: b == null ? FALTA : oFalta(escribe(b)),
      diferencia: a == null || b == null ? FALTA : puntosConSigno((b - a) * 100)
    };
  });
  const notas = [...cobertura, ...faltas];
  const anos = Number.parseInt(periodo, 10);
  if (soloUna) notas.push(`Solo se dan las cifras de la ${seDaLaDe(actual) ? "cartera actual" : "propuesta"}, medidas sobre su propio periodo: sin la otra no hay fechas comunes.`);
  if (!resultado.coversPeriod) notas.push(soloUna
    ? `Se han pedido ${anos} años, y su serie solo cubre las fechas de arriba: las cifras son de ese periodo.`
    : `Se han pedido ${anos} años, y las dos solo comparten las fechas de arriba: las cifras son de ese periodo.`);
  if (!resultado.annualized) notas.push(soloUna
    ? `Su serie cubre ${numero(resultado.periodDays)} días, menos de un año: un periodo tan corto no se anualiza, y la rentabilidad es la del periodo.`
    : `Las dos comparten ${numero(resultado.periodDays)} días, menos de un año: un periodo tan corto no se anualiza, y la rentabilidad es la del periodo.`);
  if ((resultado.metricsA.volatility === null || resultado.metricsB.volatility === null) && (seDaLaDe(actual) || seDaLaDe(propuesta))) {
    notas.push("La volatilidad falta donde no hay semanas consecutivas suficientes con fechas comunes.");
  } else if (hasWeeklyGaps(resultado.seriesA)) {
    notas.push("Hay semanas sin fechas comunes: la volatilidad se calcula solo entre semanas consecutivas.");
  }
  return {
    periodo: resultado.periodLabel,
    ventana: `Del ${oFalta(fecha(resultado.firstDate))} al ${oFalta(fecha(resultado.lastDate))} (${numero(resultado.seriesA.length)} ${soloUna ? "fechas" : "fechas comunes"}), en euros`,
    filas,
    notas: [...notas, ...ampliaciones],
    /* Solo si es de un lado que da sus cifras: la otra composición, medida en las mismas fechas, sigue siendo su serie observada. */
    conTramoEstimado: [actual, propuesta].some((lado) => seDaLaDe(lado) && (lado.historia?.extensionNotes?.length ?? 0) > 0)
  };
}

/* --------------------------------------------------------------- Crisis pasadas --------------------------------------------------------------- */

export interface CeldaDeCrisis {
  /** Null si no hay cifra. Nunca un cero. */
  cifra: string | null;
  /** Debajo de la cifra: el tramo, la parte que mide y lo que queda fuera; o, sin cifra, por qué falta y lo que queda fuera. */
  lineas: string[];
}

export interface FilaDeCrisis {
  id: string;
  nombre: string;
  contexto: string;
  actual: CeldaDeCrisis;
  propuesta: CeldaDeCrisis;
}

export interface CrisisDeLasDos {
  /** Vacía si ninguna de las dos tiene cifra. */
  filas: FilaDeCrisis[];
  sinNinguna: string | null;
}

function celdaDeCrisis(crisis: CrisisDelInforme | undefined): CeldaDeCrisis {
  if (!crisis) return { cifra: null, lineas: [SIN_DATOS_DE_LA_CRISIS, "Sus posiciones no tienen precios válidos y comunes en estas fechas."] };
  /* Por debajo del 60 %, «Falta el dato», lo que mide y quién queda fuera (decisión 103). */
  if (!crisis.cifra) return { cifra: null, lineas: [crisis.ausencia ?? SIN_DATOS_DE_LA_CRISIS, crisis.sinDato ?? "No hay datos para esta crisis.", ...(crisis.fuera ? [crisis.fuera] : [])] };
  return {
    cifra: crisis.cifra,
    lineas: [
      ...(crisis.tramo ? [crisis.tramo] : []),
      ...(crisis.parteMedida ? [crisis.parteMedida] : []),
      ...(crisis.fuera ? [crisis.fuera] : [])
    ]
  };
}

/**
 * Las dos composiciones en cada crisis, si los datos lo permiten. **No se restan:** cada cifra puede medir una parte y unas
 * fechas distintas, porque el primer día es el primero con precio de lo que entra en cada una. Por eso cada celda dice las suyas.
 */
export function crisisDeLasDos(
  escenariosActual: readonly BacktestStressScenario[] | null | undefined,
  escenariosPropuesta: readonly BacktestStressScenario[] | null | undefined,
  posicionActual: (id: string) => PosicionDeLaCartera | null,
  posicionPropuesta: (id: string) => PosicionDeLaCartera | null
): CrisisDeLasDos {
  const a = crisisPasadas(escenariosActual, posicionActual).crisis;
  const b = crisisPasadas(escenariosPropuesta, posicionPropuesta).crisis;
  const lista = a.length > 0 ? a : b;
  if (lista.length === 0) {
    return { filas: [], sinNinguna: `Ni ${ROTULO_ACTUAL} ni ${ROTULO_PROPUESTA} tienen precios válidos y comunes en las fechas de estas crisis: no se puede decir cómo se habrían comportado.` };
  }
  return {
    filas: lista.map(({ id, nombre, contexto }) => ({
      id,
      nombre,
      contexto,
      actual: celdaDeCrisis(a.find((crisis) => crisis.id === id)),
      propuesta: celdaDeCrisis(b.find((crisis) => crisis.id === id))
    })),
    sinNinguna: null
  };
}

/* --------------------------------------------------------------- Coste corriente --------------------------------------------------------------- */

export interface CostesDeLasDos {
  filas: FilaDeCifras[];
  /** Cuántas acciones hay en las dos: lo que obliga a decir cómo cuentan en la media. */
  hayAcciones: boolean;
  /** Las dos son solo acciones: no hay media que dar en ninguna. */
  sinMediaEnNinguna: boolean;
}

type CostesDeUnaCartera = ReturnType<typeof calculatePortfolioCosts>;

/** La cifra de una cartera. Sin capital, la frase del informe de costes; con capital, el porcentaje, y los euros van en su fila. */
function cifraDelCoste(costes: CostesDeUnaCartera, conCapital: boolean): string {
  if (!conCapital || costes.avgCostPct == null || costes.avgCostPct === 0) return fraseDelCoste(costes);
  return `${oFalta(porcentaje(costes.avgCostPct))} al año`;
}

/**
 * El coste corriente antes y después, con la misma función que el informe de costes: la media ponderada, con las acciones a
 * cero (decisión 10). Si falta el coste de un fondo no hay media, y entonces tampoco hay diferencia: se dice cuánto falta.
 */
export function costesDeLasDos(
  actual: CarteraDeLaPropuesta,
  propuesta: CarteraDeLaPropuesta,
  assets: readonly BdbAssetDetail[],
  capitalFijado: number | null | undefined
): CostesDeLasDos {
  const capital = capitalValido(capitalFijado);
  const a = calculatePortfolioCosts([...actual.positions], [...assets], capital ?? 0);
  const b = calculatePortfolioCosts([...propuesta.positions], [...assets], capital ?? 0);
  /* Con las dos solo de acciones no hay nada que restar. Con una sola, sí: pasar a una acción quita ese coste corriente (decisión 10). */
  const lasDosSoloDeAcciones = esSoloDeAcciones(a) && esSoloDeAcciones(b);
  const filas: FilaDeCifras[] = [{
    rotulo: "Coste corriente anual de los productos",
    actual: cifraDelCoste(a, capital != null),
    propuesta: cifraDelCoste(b, capital != null),
    diferencia: lasDosSoloDeAcciones ? NO_APLICA : a.avgCostPct == null || b.avgCostPct == null ? FALTA : puntosConSigno((b.avgCostPct - a.avgCostPct) * 100)
  }];
  if (capital != null) {
    const euros = (costes: CostesDeUnaCartera) => (costes.avgCostPct == null ? null : costes.totalCostEur);
    const eurosA = euros(a);
    const eurosB = euros(b);
    /* «0,00 €» sonaría a gratis: lo mismo que la frase de arriba (decisión A-65). */
    const enEuros = (costes: CostesDeUnaCartera, importe: number | null) => (esSoloDeAcciones(costes) ? NO_APLICA : importe == null ? FALTA : oFalta(escribirImporte(importe)));
    filas.push({
      rotulo: `En euros al año, sobre ${oFalta(escribirImporte(capital))}`,
      actual: enEuros(a, eurosA),
      propuesta: enEuros(b, eurosB),
      diferencia: lasDosSoloDeAcciones ? NO_APLICA : eurosA == null || eurosB == null ? FALTA : eurosConSigno(eurosB - eurosA)
    });
  }
  return { filas, hayAcciones: a.acciones > 0 || b.acciones > 0, sinMediaEnNinguna: lasDosSoloDeAcciones };
}

/* --------------------------------------------------------------- El documento --------------------------------------------------------------- */

export interface FueraDeLaSimulacion {
  rotulo: string;
  nombre: string;
  peso: string;
  motivo: string;
}

export interface PropuestaDeCambio {
  cliente: string;
  /** «Elaborado por». Vacío, la portada no lo lleva. */
  responsable: ReportBanker;
  /** «05/11/2026», el día de quien lo genera. */
  fecha: string;
  /** El mismo día en ISO («2026-11-05»), para el nombre del fichero. Sin él, el de hoy. */
  dia?: string;
  nombreActual: string;
  nombrePropuesta: string;
  posicionesActual: number;
  posicionesPropuesta: number;
  capital: number | null;
  /** La frase de la portada: con capital, cuál; sin él, que todo va en porcentajes. Se dice una vez. */
  fraseDelCapital: string;
  motivo: string;
  notasDelPlan: string;
  cambios: FilaDeCambio[];
  /** Lo que suman las dos columnas de pesos, sacado de las filas: se imprime debajo. */
  totalActual: string;
  totalPropuesta: string;
  /** «Cambia de posición el 18,00 % de la cartera…» */
  resumenDeCambios: string;
  /** Si una composición no sumaba 100 antes de llevarla al 100 %. */
  notasDePeso: string[];
  cifras: CifrasDeLasDos;
  /** La frase de `deQueSonNetasLasCifras` para estas dos composiciones. */
  netasDe: string;
  crisis: CrisisDeLasDos;
  costes: CostesDeLasDos;
  plan: PlanDeEjecucion;
  /** Solo si son más de tres en un lado: la frase de cobertura las cuenta y aquí se detallan. */
  fueraDetallado: FueraDeLaSimulacion[];
}

export interface EntradaDeLaPropuesta {
  actual: CarteraDeLaPropuesta;
  propuesta: CarteraDeLaPropuesta;
  periodo: ComparisonPeriod;
  /** Null si el servidor dice que con esas posiciones no se puede simular. Un fallo pasajero no llega aquí. */
  historiaActual: ComparisonHistory | null;
  historiaPropuesta: ComparisonHistory | null;
  assets: readonly BdbAssetDetail[];
  /** El de Actual. Sin él, todo va en porcentajes. */
  capital: number | null | undefined;
  cliente?: string;
  /** Quién lo elabora. Sin campo o vacío, la portada sale sin firma: como el informe de cliente (`resolveBanker`). */
  responsable?: Partial<ReportBanker> | null;
  motivo: string;
  notasDelPlan?: string;
  /** El instante en que se genera. */
  generadoEn: string;
  /** Las posiciones cuyos datos se quedaron en una fecha, con esa fecha (decisión B-78). Va entre las notas de las cifras. */
  seriesParadas?: ReadonlyMap<string, string>;
}

function resumenDeLosCambios(filas: readonly FilaDeCambio[], plan: PlanDeEjecucion): string {
  const concentracion = comparisonConcentration(filas.map((fila) => ({
    id: fila.id, name: fila.nombre, category: "", currency: "", a: fila.pesoActual, b: fila.pesoPropuesta
  })));
  const cambia = `Cambia de posición el ${plan.textoTotalPuntos} de la cartera`;
  if (!concentracion) return `${cambia}.`;
  const partes = [
    ...(concentracion.shared > 0 ? [`${concentracion.shared === 1 ? "se mantiene" : "se mantienen"} ${posiciones(concentracion.shared)}`] : []),
    ...(concentracion.onlyA > 0 ? [`${concentracion.onlyA === 1 ? "sale" : "salen"} ${concentracion.onlyA}`] : []),
    ...(concentracion.onlyB > 0 ? [`${concentracion.onlyB === 1 ? "entra" : "entran"} ${concentracion.onlyB}`] : [])
  ];
  const ultima = partes.length - 1;
  return `${cambia}: ${ultima > 0 ? `${partes.slice(0, ultima).join(", ")} y ${partes[ultima]}` : partes[0]}.`;
}

function fueraDetallado(lados: readonly LadoMedido[], nombreDe: (id: string) => string): FueraDeLaSimulacion[] {
  return lados.flatMap((lado) => {
    const fuera = lado.parte?.excluded ?? [];
    /* Hasta tres, los nombra la frase de cobertura, con su motivo. */
    const frase = lado.parte ? fraseDeLaParteMedida(lado.parte, nombreDe, "detalladas debajo") : null;
    if (!frase?.includes("detalladas debajo")) return [];
    return [...fuera].sort((x, y) => y.weightPercent - x.weightPercent).map((item) => ({
      rotulo: lado.rotulo,
      nombre: nombreDe(item.assetId),
      peso: pesoEnElPapel(item.weightPercent),
      motivo: motivoParaElCliente(item.reason)
    }));
  });
}

/** De lo que se ha pedido a lo que se imprime. Sin motivo no hay documento: el motivo no se inventa. */
export function propuestaDeCambio(entrada: EntradaDeLaPropuesta): PropuestaDeCambio {
  const { actual, propuesta, periodo, historiaActual, historiaPropuesta, assets, cliente, generadoEn } = entrada;
  const motivo = entrada.motivo.trim();
  const falta = faltaParaLaPropuesta({ actual, propuesta, motivo });
  if (falta) throw new Error(falta);

  const porId = new Map(assets.map((activo) => [activo.asset_id, activo]));
  const etiquetas = new Map([...actual.positions, ...propuesta.positions].map((p) => [p.asset_id.trim(), p.label]));
  const nombreDe = (id: string) => porId.get(id)?.display_name || etiquetas.get(id) || id;
  const posicionDe = (cartera: CarteraDeLaPropuesta) => {
    const pesos = new Map(comparisonPositions(cartera.positions).map((p) => [p.asset_id, p.weight_percent]));
    return (id: string): PosicionDeLaCartera | null => {
      const pesoPct = pesos.get(id);
      return pesoPct === undefined ? null : { nombre: nombreDe(id), pesoPct };
    };
  };
  const ladoDe = (rotulo: string, cartera: CarteraDeLaPropuesta, historia: ComparisonHistory | null): LadoMedido => ({
    rotulo,
    historia,
    parte: historia ? parteMedidaDeLaSimulacion(historia.backtest, comparisonPositions(cartera.positions)) : null
  });
  const ladoActual = ladoDe(ROTULO_ACTUAL, actual, historiaActual);
  const ladoPropuesta = ladoDe(ROTULO_PROPUESTA, propuesta, historiaPropuesta);

  const capital = capitalValido(entrada.capital);
  const cambios = filasDeCambios(actual, propuesta, assets, { actual: ladoActual.parte, propuesta: ladoPropuesta.parte });
  const plan = planDeEjecucion(cambios, capital);
  const costesActual = calculatePortfolioCosts([...actual.positions], [...assets], capital ?? 0);
  const costesPropuesta = calculatePortfolioCosts([...propuesta.positions], [...assets], capital ?? 0);
  const cifras = cifrasDeLasDos(ladoActual, ladoPropuesta, periodo, nombreDe);
  const notaDeLasParadas = notaDeDatosHasta(posicionesParadas(cambios.map((fila) => fila.id), entrada.seriesParadas ?? new Map<string, string>(), (id) => id, nombreDe));
  const notaDePeso = (rotulo: string, costes: CostesDeUnaCartera) =>
    costes.normalized ? [`Los pesos de ${rotulo} sumaban ${oFalta(peso(costes.inputWeight / 100))} y se han llevado al 100 % para este documento.`] : [];

  return {
    cliente: cliente?.trim() ?? "",
    responsable: resolveBanker(entrada.responsable),
    fecha: oFalta(fecha(diaLocal(generadoEn))),
    ...(diaLocal(generadoEn) ? { dia: diaLocal(generadoEn) as string } : {}),
    nombreActual: actual.name.trim() || "Cartera sin nombre",
    nombrePropuesta: propuesta.name.trim() || "Cartera sin nombre",
    posicionesActual: costesActual.rows.length,
    posicionesPropuesta: costesPropuesta.rows.length,
    capital,
    fraseDelCapital: capital == null
      ? "No se ha fijado un capital: este documento va en porcentajes."
      : `Capital de la composición ${ROTULO_ACTUAL}: ${oFalta(escribirImporte(capital))}.`,
    motivo,
    notasDelPlan: entrada.notasDelPlan?.trim() ?? "",
    cambios,
    totalActual: oFalta(peso(cambios.reduce((suma, fila) => suma + fila.pesoActual, 0) / 100)),
    totalPropuesta: oFalta(peso(cambios.reduce((suma, fila) => suma + fila.pesoPropuesta, 0) / 100)),
    resumenDeCambios: resumenDeLosCambios(cambios, plan),
    notasDePeso: [...notaDePeso(ROTULO_ACTUAL, costesActual), ...notaDePeso(ROTULO_PROPUESTA, costesPropuesta)],
    cifras: notaDeLasParadas ? { ...cifras, notas: [...cifras.notas, notaDeLasParadas] } : cifras,
    netasDe: deQueSonNetasLasCifras(costesActual.acciones < costesActual.rows.length || costesPropuesta.acciones < costesPropuesta.rows.length),
    crisis: crisisDeLasDos(historiaActual?.backtest.stress_scenarios, historiaPropuesta?.backtest.stress_scenarios, posicionDe(actual), posicionDe(propuesta)),
    costes: costesDeLasDos(actual, propuesta, assets, capital),
    plan,
    fueraDetallado: fueraDetallado([ladoActual, ladoPropuesta], nombreDe)
  };
}

/* ------------------------------------------------------------------ En hojas ------------------------------------------------------------------ */

/**
 * Reparte filas en hojas por lo que miden, sin partir ninguna: la primera hoja tiene un hueco y las demás, otro. Con los pesos en
 * puntos de altura y no en número de filas, una lista de nombres largos no se sale de la hoja ni deja media hoja vacía.
 */
export function repartirEnHojas<T>(filas: readonly T[], altoDe: (fila: T) => number, huecoDeLaPrimera: number, huecoDeLasDemas: number): T[][] {
  const hojas: T[][] = [];
  let hoja: T[] = [];
  let usado = 0;
  let hueco = huecoDeLaPrimera;
  for (const fila of filas) {
    const alto = altoDe(fila);
    if (hoja.length > 0 && usado + alto > hueco) {
      hojas.push(hoja);
      hoja = [];
      usado = 0;
      hueco = huecoDeLasDemas;
    } else if (hoja.length === 0 && hojas.length === 0 && alto > hueco) {
      /* Si no cabe ni la primera fila, la primera hoja se queda sin tabla. */
      hojas.push([]);
      hueco = huecoDeLasDemas;
    }
    hoja.push(fila);
    usado += alto;
  }
  if (hoja.length > 0 || hojas.length === 0) hojas.push(hoja);
  return hojas;
}
