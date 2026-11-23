/**
 * Lo que el informe de cliente lee y cómo lo escribe, sin dibujar nada: las cuentas de presentación (los importes que suman, el reparto,
 * la geografía, las frases de la comparación, del mapa y del solapamiento) y la preparación de todo lo que imprimen las secciones.
 *
 * Nada de aquí calcula una cifra de la cartera: las cifras salen de la simulación (`PortfolioHorizon`), del informe de la cartera y de
 * los módulos de `core/`, que son los mismos que lee la pantalla. Las cifras que escribe este documento pasan por el módulo común de
 * formato (`core/formato.ts`); las frases que ya llegan escritas desde `core/` (las crisis, el solapamiento, la cobertura) se imprimen tal
 * cual. No importa @react-pdf.
 */
import { resolveHorizonMetrics, type CifrasDelHorizonte, type PortfolioHorizon } from "../../adapters/portfolioHorizon";
import type { BacktestResponse } from "../../adapters/backtestPortfolioBackend";
import { GEO_AREAS } from "../../charts/worldMapGeo";
import { deriveExposure } from "../../core/repartoDelInforme";
import { fraseDelRiesgoDeLaReferencia } from "../../core/riesgoDeLaReferencia";
import { benchmarkById, compararEnMismasFechas, composicionDeLaReferencia, DEFAULT_BENCHMARK_ID, MIN_SEMANAS_COMUNES, perfilesATresAnos, pesoDeLaReferenciaAlFinal, referenceProfilesForDates, tampocoSeReequilibra, type ComparacionConReferencia, type ReferenceProfile, type ReferenceProfileWindow, type SeriesBaseDeReferencia } from "../../core/benchmarkProfiles";
import { resolveBanker, type ReportBanker } from "../../core/reportBanker";
import { CLASS_LABELS } from "../../core/labels";
import { fecha, fechaLarga, importe, importeTitular, numero, periodo as periodoEntre, peso, porcentaje, ratio, rentabilidad, signoDe, type Signo } from "../../core/formato";
import { esAccion } from "../../core/esAccion";
import { errorDelHorizonte, errorDelNivelDePerfil, textoDelHorizonte, type PerfilYHorizonte } from "../../core/perfilYHorizonte";
import { textoDelNivel } from "../../core/textoDelNivelDePerfil";
import { crisisPasadas, LO_QUE_NO_ES_LA_CIFRA_DE_UNA_CRISIS, queMideLaCifraDeUnaCrisis, type CrisisPasadas as ModeloDeCrisis } from "../../core/crisisPasadas";
import { categoriaLegible, NO_DECLARADO } from "../../core/etiquetasDeReparto";
import { diaLocal } from "../../core/fechaLocal";
import { fraseDelMapa, lecturaDelMapa } from "../../core/lecturaDelMapa";
import { buildMonteCarloProjection, centrarEnElTipoSinRiesgo } from "../../core/monteCarloProjection";
import { measurementSeries } from "../../core/seriesFrequency";
import { esUnaSolaAccion, fueraDeLaMedida, idsConPeso, motivoSinCifraDeCartera } from "../../core/medidaDeLaCartera";
import { motivoDeQueNoAplique } from "../../core/metricasPorInstrumento";
import { fraseDeLaParteMedida, motivoParaElCliente, parteMedidaDeLaSimulacion, pesoEnElPapel, SIMULACION_CON_LOS_PESOS_DE_HOY, versionDeLaReferencia, type ParteMedida } from "../../core/parteMedida";
import { filasPorCategoria, fraseDeLoQueNoEntra, fraseDeLoQueNoTieneRepartoEnElPapel, fraseDelSinRepartoEnElPapel, FUERA_DEL_CATALOGO, FUERA_DEL_REPARTO, fueraDelRepartoDelInforme, posicionesFueraDelCatalogo } from "../../core/repartoDelPapel";
import { fraseDelTipoDeRespaldo, tipoDeRespaldo } from "../../core/tipoDeRespaldo";
import type { PortfolioFeasibilityCheck } from "../../core/portfolioConstraints";
import { backtestPeriodTitle, backtestWindowCoverage } from "../../core/backtestCoverage";
import { textoDeAusencia } from "../../core/textoDeAusencia";
import { NOTA_MAS_DE_100, pasaDeCien, sinComunes } from "../../core/overlap";
import { datosHasta } from "../../core/serieParada";
import { buildReportOverlap, corteDeLaMatriz, enumerarNombres, FUERA_DE_LA_MATRIZ, paresDeSolapamiento, recortarLaMatriz, SOLAPAMIENTO_ALTO, solapamientoEnFrases, type CorteDeLaMatriz, type ReportOverlap } from "../../core/reportOverlap";
import type { IdentidadDelAsesor } from "../../core/identidadDelAsesor";
import type { BdbAssetDetail, BdbPortfolioReport } from "../../types/bdbAssets";
import type { ClaseDeAusencia } from "../../types/fichaInstrumento";

/* ------------------------------------------------------------------------------------------------ La entrada */

export interface InformeDeClientePdfInput {
  overlap?: ReportOverlap;
  /** La simulación de la cartera. Los dos botones no generan el documento sin ella; aquí, si no llega, el papel dice «Falta el dato». */
  analysis?: PortfolioHorizon;
  report: BdbPortfolioReport;
  /** El momento de generarlo, para las pruebas. Por defecto, ahora. */
  generadoEn?: string;
  feasibility: PortfolioFeasibilityCheck;
  lockedWeights?: Record<string, number>;
  totalCapital?: number;
  clientName?: string;
  /** Cartera de referencia elegida por el usuario (BenchmarkContext). */
  benchmarkId?: string;
  /** Las series de las carteras de referencia, ya cargadas: el documento no pide nada mientras se dibuja.
      null, no han llegado, y el informe lo dice. Sin el campo, las carga `downloadInformeDeClientePdf`. */
  referencia?: SeriesBaseDeReferencia | null;
  /** Quién elabora el informe. Sin campo, o con un nombre vacío, la presentación sale
      sin «Elaborado por» (ver resolveBanker); el nombre de la cuenta lo propone la pantalla. */
  banker?: Partial<ReportBanker> | null;
  /**
   * La identidad del asesor para la cabecera (nombre, entidad, contacto, logotipo). La lee `downloadInformeDeClientePdf` con
   * `leerIdentidad()`; quien genera el `Blob` directamente (las pruebas) la pasa o no. Encima van el nombre y el correo de `banker`
   * cuando vienen escritos. Sin nada, la cabecera queda sin membrete.
   */
  identidad?: IdentidadDelAsesor;
  /** Auditoría 11-08 (N3.5): modo cliente. Reservado: ninguna sección del informe imprime datos comerciales hoy (retro/cesión); este
      flag protege las futuras — quien añada una sección comercial debe consultarlo antes de imprimir. */
  clientMode?: boolean;
  /** P3.2 (N4): distribución canónica de regiones de la renta variable (computeEquityRegionAllocation) — la MISMA que pintan Resumen y
      X-Ray. Sin ella, la geografía cae al desglose crudo `xray.by_region`. */
  regionRows?: Array<{ key: string; weight_percent: number }>;
  /**
   * La rentabilidad por dividendo prevista de cada acción —el dividendo previsto para doce meses entre el precio de hoy—, en tanto por
   * uno, ya leída de las fichas por quien llama con `rentabilidadPorDividendoDe` (A-143): el documento no recibe las fichas (decisión 102).
   * Es el dato del proveedor, nunca el del emisor (B-53). Una acción sin entrada, o con null, dice «Falta el dato»; un fondo, un ETF o
   * cualquier otra cosa que no sea acción, «No aplica».
   */
  rentabilidadPorDividendo?: Readonly<Record<string, number | null>>;
  /** El nivel de perfil y el horizonte de la cartera activa (decisión 59). Solo lo que esté puesto sale en la presentación. */
  perfilYHorizonte?: PerfilYHorizonte;
  /** Las posiciones cuyos datos se quedaron en una fecha, con esa fecha (decisión B-78). Se dice en su línea de la composición. */
  seriesParadas?: ReadonlyMap<string, string>;
}

/* ------------------------------------------------------------------------------------------------ Lo que falta */

/** Lo que dice una cifra de la cartera que no se da: nunca un cero ni una raya. */
export const FALTA = textoDeAusencia("falta");
export const NO_APLICA = textoDeAusencia("no-aplica");

function safeNumber(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Un día, o la frase de lo que falta. */
const diaOFalta = (dia: string | null | undefined) => fecha(dia) ?? FALTA;

function assetClassLabel(value: string): string {
  return CLASS_LABELS[value as keyof typeof CLASS_LABELS] ?? value.replace(/_/g, " ");
}

/* ------------------------------------------------------------------------------------------------ Medir texto */

/** El ancho en puntos de un texto a un cuerpo dado. Lo da la fuente ya cargada; sin ella, una estimación por lo alto. */
export type Medidor = (texto: string, cuerpo: number) => number;

/** La estimación por lo alto: un poco más de media letra por carácter. */
export const MEDIDOR_ESTIMADO: Medidor = (texto, cuerpo) => texto.length * cuerpo * 0.56;

/** Cuántas líneas ocupa un texto en `ancho` puntos, partiendo solo entre palabras, como lo compone el papel. */
export function lineasDe(texto: string, ancho: number, cuerpo: number, mide: Medidor): number {
  let lineas = 0;
  for (const parrafo of texto.split("\n")) {
    const palabras = parrafo.split(/\s+/).filter(Boolean);
    let linea = "";
    lineas += 1;
    for (const palabra of palabras) {
      const prueba = linea ? `${linea} ${palabra}` : palabra;
      if (linea && mide(prueba, cuerpo) > ancho) {
        lineas += 1;
        linea = palabra;
      } else linea = prueba;
    }
  }
  return Math.max(1, lineas);
}

/* ------------------------------------------------------------------------------------------------ Los importes que suman */

/**
 * El importe de cada posición en euros enteros, de modo que la columna sume el total impreso (INF-32). El capital se reparte en proporción
 * a los pesos con valor, como en el cuadro de costes, y el residuo del redondeo va por el método del mayor resto: los euros que faltan, a
 * las posiciones con mayor parte decimal (a igualdad, la primera). Sin ningún peso, no hay importe.
 */
export function importesQueSuman(capital: number, pesos: readonly number[]): Array<number | null> {
  const validos = pesos.map((peso) => (Number.isFinite(peso) && peso > 0 ? peso : 0));
  const repartido = validos.reduce((suma, peso) => suma + peso, 0);
  if (!(repartido > 0) || !Number.isFinite(capital)) return pesos.map(() => null);
  const exactos = validos.map((peso) => (capital * peso) / repartido);
  const suelos = exactos.map((exacto) => Math.floor(exacto + 1e-9));
  let faltan = Math.round(capital) - suelos.reduce((suma, suelo) => suma + suelo, 0);
  const porResto = exactos.map((exacto, indice) => ({ indice, resto: exacto - suelos[indice] })).sort((a, b) => b.resto - a.resto || a.indice - b.indice);
  for (let i = 0; faltan > 0 && porResto.length > 0; i = (i + 1) % porResto.length, faltan -= 1) suelos[porResto[i].indice] += 1;
  return suelos;
}

/** La línea de la guía que explica las siglas de las categorías (decisión 99). Solo si el reparto por categoría imprime alguna. */
export const SIGLAS_DE_LAS_CATEGORIAS = "RV: renta variable. RF: renta fija.";
const conSiglas = (rotulos: readonly string[]) => rotulos.some((rotulo) => /\bR[VF]\b/.test(rotulo));

/* ------------------------------------------------------------------------------------------------ La geografía y la referencia */

/* La geografía, las cifras del mapa, la exposición y la regla 1,25 / 0,80 viven en `core/` (INF-20): aquí se importan y se
   reexportan, para que quien las tomaba del informe las siga encontrando. */
export { buildReportGeography, cifrasDelMapa, type CifraDelMapa } from "../../core/repartoDelInforme";
export { COCIENTE_DE_RIESGO_MAXIMO, COCIENTE_DE_RIESGO_MINIMO, fraseDelRiesgoDeLaReferencia } from "../../core/riesgoDeLaReferencia";

/** Qué se compara y hasta cuándo, bajo el título de la evolución. Ni una palabra de «misma ventana» si no lo es. */
function fraseDeLaComparacion(benchmarkId: string, comparacion: ComparacionConReferencia | null, referencia: SeriesBaseDeReferencia | null, rango?: string | null): string {
  const perfil = benchmarkById(benchmarkId);
  const sinComparar = rango ? ` Se dibuja solo la composición simulada (${rango}), que parte de 100.` : " Se dibuja solo la composición simulada, que parte de 100.";
  if (!referencia || !perfil) return `${SIN_REFERENCIA}.${sinComparar}`;
  if (!comparacion) return `La composición simulada y la cartera de referencia ${perfil.name} no tienen fechas suficientes en común: no se comparan (hacen falta ${MIN_SEMANAS_COMUNES} semanas).${sinComparar}`;
  /* Cómo acaba la referencia sin reequilibrar (decisión 86): justo detrás de lo que es, para que no se lea de la composición simulada. */
  const alFinal = pesoDeLaReferenciaAlFinal(perfil, comparacion.rentaVariableAlFinal);
  return `Cartera de referencia: ${perfil.name} (${composicionDeLaReferencia(perfil)}).${alFinal ? ` ${alFinal}.` : ""} Ambos parten de 100 el ${diaOFalta(comparacion.primeraComun)} y se comparan en las mismas fechas hasta el ${diaOFalta(comparacion.ultimaComun)}, la última común. La composición simulada ${tampocoSeReequilibra(perfil)}.`;
}

/** Lo que se dice cuando no han llegado las series de las carteras de referencia. */
const SIN_REFERENCIA = "Cartera de referencia: falta el dato";

/**
 * F-02 (auditoría 29-09): qué carteras de referencia pintar en el mapa y cómo rotularlas. Con serie del backtest, se miden en sus mismas
 * fechas (semanal). Si llegan menos lejos, la cartera se mide también hasta ahí, y se escribe. Sin serie del backtest, a 3 años hasta su
 * último dato, diciéndolo y sin comparar la cartera con ellas. Sin sus series no hay referencias: se dice, y no se cae a datos viejos.
 */
export function referenceProfilesFor(backtest: BacktestResponse | null | undefined, referencia: SeriesBaseDeReferencia | null, sinCifraDeCartera: boolean): {
  profiles: ReferenceProfile[];
  window: ReferenceProfileWindow | null;
  label: string;
} {
  const series = backtest?.portfolio_series ?? [];
  if (!referencia) return { profiles: [], window: null, label: SIN_REFERENCIA };
  if (series.length >= 2) {
    const window = referenceProfilesForDates(series.map((point) => point.date), series.map((point) => point.value), referencia);
    if (!window) return { profiles: [], window: null, label: `Sin fechas suficientes en común con las carteras de referencia (hacen falta ${MIN_SEMANAS_COMUNES} semanas)` };
    const fechas = periodoEntre(window.firstDate, window.lastDate) ?? FALTA;
    return {
      profiles: window.profiles,
      window,
      label: sinCifraDeCartera
        ? `Carteras de referencia medidas en el periodo de la simulación (semanal, ${fechas})`
        : window.mismaVentana
        ? `Carteras de referencia medidas en el mismo periodo que la composición simulada (semanal, ${fechas})`
        : `Composición simulada y carteras de referencia medidas en las mismas fechas (semanal, ${fechas}, la última común)`
    };
  }
  const aTresAnos = perfilesATresAnos(referencia);
  if (!aTresAnos) return { profiles: [], window: null, label: SIN_REFERENCIA };
  return { profiles: aTresAnos.profiles, window: null, label: `Carteras de referencia: 3 años, datos a ${diaOFalta(aTresAnos.lastDate)}` };
}

/**
 * La volatilidad con la que el mapa sitúa la composición: la del tramo común si las carteras de referencia no cubren toda la ventana, y la
 * de las cifras si la cubren. Null si no hay cifra de la cartera.
 */
function volatilidadEnElMapa(reference: ReturnType<typeof referenceProfilesFor>, cifras: CifrasDelHorizonte | null): number | null {
  if (!cifras) return null;
  const tramoComun = reference.window && !reference.window.mismaVentana ? reference.window : null;
  return tramoComun ? tramoComun.cartera.vol : cifras.volatility.value;
}

/* ------------------------------------------------------------------------------------------------ Las cifras de la cartera */

/** Una de las cuatro cifras de la cartera: su rótulo, el texto que se imprime y, si falta o no aplica, por qué; si es una rentabilidad, su signo. */
export interface CifraDeLaCartera {
  label: string;
  /** Lo que se imprime: la cifra, o la frase de lo que falta («Falta el dato», «No aplica»). */
  value: string;
  /** Si no hay cifra: la clase de ausencia. */
  ausencia?: ClaseDeAusencia;
  /** El signo de una rentabilidad, para su color. Las demás cifras no llevan color. */
  signo?: Signo | null;
}

/**
 * Las posiciones del informe y, detrás, las que la fuente no conoce: el informe solo trae las que tienen ficha, y sin ellas una posición fuera
 * del catálogo desaparecía de la composición, con el total diciendo 100 % (decisión 85).
 */
function posicionesDeLaCartera(report: BdbPortfolioReport) {
  return [
    ...(report.positions ?? []).map((posicion) => ({ asset_id: posicion.asset_id, display_name: posicion.display_name, weight_percent: posicion.weight_percent, economic_asset_class: posicion.economic_asset_class as string | null })),
    ...posicionesFueraDelCatalogo(report.summary).map((posicion) => ({ asset_id: posicion.asset_id, display_name: posicion.label || posicion.asset_id, weight_percent: posicion.weight_percent, economic_asset_class: null }))
  ];
}

/**
 * Si lo que mide la simulación es una sola acción, su Sharpe es el de la acción y no se imprime (§9 del método; decisión 41). Una acción
 * dentro de una cartera con fondos ya no es el Sharpe de una acción, y sale.
 */
function sharpeDeUnaSolaAccion(report: BdbPortfolioReport, backtest?: BacktestResponse | null): boolean {
  const posiciones = report.positions ?? [];
  return esUnaSolaAccion(backtest ? backtest.asset_ids : idsConPeso(posiciones), posiciones);
}

/**
 * Lo que escriben las notas de la simulación cuando no caben los nombres. Desde A-143 el anexo es una sola línea, sin nombres, y mandar a
 * él sería mandar a nada.
 */
const POR_FALTA_DE_DATOS = "por falta de datos suficientes para el periodo medido";
/** Lo mismo en la nota del reparto: lo que no entra en él son posiciones de la tabla de composición, que las lista todas. */
const EN_LA_TABLA_DE_COMPOSICION = "todas en la tabla de composición";

/**
 * Por qué no hay cifra de la cartera, con las palabras de la tira de Análisis y su mismo corte (decisiones 36 y 59), o null si la hay. Sin
 * serie que cubra al menos el 80 % del peso no hay cifra.
 */
function motivoSinCifra(report: BdbPortfolioReport, analysis?: PortfolioHorizon): string | null {
  const posiciones = posicionesDeLaCartera(report);
  return motivoSinCifraDeCartera(analysis, fueraDeLaMedida(analysis, posiciones, posiciones), { hayPeso: posiciones.some((posicion) => posicion.weight_percent > 0), escribirPeso: pesoEnElPapel, dondeSeDetallan: POR_FALTA_DE_DATOS });
}

/** El título de la sección de las cifras. La guía lo cita cuando no hay cifras que dar, para mandar a leer el motivo. */
export const TITULO_DE_LAS_CIFRAS = "Cifras de la cartera";

/**
 * Las cuatro cifras de la cartera, como se imprimen en su sección («Cifras de la cartera»; nunca en la portada, Óscar, 15-11-2026):
 * rentabilidad anualizada (con su signo), volatilidad, Sharpe y caída máxima. El tipo sin riesgo no es una de ellas (decisión de Óscar del 10-11-2026), y desde el 22-11-2026 tampoco va en una nota debajo: al cliente no le dice nada.
 */
export function informeDeClienteMetricRows(report: BdbPortfolioReport, analysis?: PortfolioHorizon): CifraDeLaCartera[] {
  const anos = analysis?.years ?? 3;
  if (!analysis || motivoSinCifra(report, analysis)) {
    return ["Rentabilidad anualizada", "Volatilidad", "Sharpe", "Caída máxima"].map((nombre) => ({ label: `${nombre} ${anos} años`, value: FALTA, ausencia: "falta" }));
  }
  const cifras = resolveHorizonMetrics(analysis);
  const oFalta = (label: string, texto: string | null, signo?: Signo | null): CifraDeLaCartera =>
    texto === null ? { label, value: FALTA, ausencia: "falta" } : { label, value: texto, ...(signo !== undefined ? { signo } : {}) };
  return [
    oFalta(cifras.cagr.label, rentabilidad(cifras.cagr.value), signoDe(cifras.cagr.value, 4)),
    oFalta(cifras.volatility.label, porcentaje(cifras.volatility.value)),
    sharpeDeUnaSolaAccion(report, analysis.backtest)
      ? { label: cifras.sharpe.label, value: NO_APLICA, ausencia: "no-aplica" }
      : oFalta(cifras.sharpe.label, ratio(cifras.sharpe.value)),
    oFalta(cifras.maxDrawdown.label, porcentaje(cifras.maxDrawdown.value))
  ];
}

/* ------------------------------------------------------------------------------------------------ El alcance de las cifras */

/** Con una sola línea, ya no es «Qué queda fuera del cálculo» (decisión 34): dice sobre qué parte de la cartera están hechas las cifras. */
export const TITULO_DEL_ANEXO = "Alcance de las cifras";

/**
 * La línea del alcance (A-143, Óscar, 12-11-2026): qué parte de la cartera miden las cifras, y que del resto no hay datos suficientes, sin
 * nombres ni detalle por posición. Los dos porcentajes salen de la misma parte medida y suman 100 con el mismo redondeo: el segundo es 100
 * menos el primero ya redondeado, con sus mismos decimales. Con toda la cartera medida, null.
 */
export function lineaDelAlcance(parte: ParteMedida | null): string | null {
  if (!parte || parte.excluded.length === 0) return null;
  const medida = pesoEnElPapel(parte.weightPercent);
  const cifra = medida.replace(/[^\d,]/g, "");
  const decimales = cifra.includes(",") ? cifra.split(",")[1].length : 0;
  /* Con la misma escritura que `pesoEnElPapel`, que da la primera cifra: las dos se leen juntas. */
  const resto = porcentaje((100 - Number(cifra.replace(",", "."))) / 100, { decimales }) ?? FALTA;
  return `Cifras calculadas sobre el ${medida} de la cartera. Del ${resto} restante no hay datos suficientes para el periodo medido.`;
}

/* ------------------------------------------------------------------------------------------------ La matriz de solapamiento */

/** Los tramos del tono de una casilla, en %: «sin comunes» es el primero, y de ahí, menos del 10 %, del 10, del 20, del 40, del 60 y del 80. */
const TRAMOS_DE_LA_MATRIZ = [10, 20, 40, 60, 80] as const;
export function pasoDeLaMatriz(valor: number): number {
  if (sinComunes(valor)) return 0;
  return 1 + TRAMOS_DE_LA_MATRIZ.filter((tramo) => valor >= tramo).length;
}

const superaUmbralDeLaMatriz = (valor: number) => valor >= SOLAPAMIENTO_ALTO;

/** La explicación del cálculo cuando solo hay lectura textual. */
const NOTA_SIN_MATRIZ = "Los títulos comunes de cada par de fondos, con el peso real de las posiciones que publican; no cuentan los derivados ni el efectivo, cuando el dato los distingue. Es un mínimo: no mide lo que el fondo no publica, y el real puede ser mayor. Solo hay cifra si de los dos fondos se ha recibido al menos la mitad de la cartera.";
const NOTA_DE_LA_MATRIZ = `La matriz muestra los cruces del ${SOLAPAMIENTO_ALTO} % o más. En blanco: la diagonal, y los cruces medidos por debajo del ${SOLAPAMIENTO_ALTO} %. Se comparan fondos con al menos la mitad de su cartera publicada. Cada título común suma el menor de sus dos pesos. Solo cuenta lo publicado, así que «al menos» indica un mínimo. Se excluyen los derivados y el efectivo cuando el dato los distingue.`;

/* Las medidas de la matriz en el papel: casillas de 32 pt, que bajan con muchos fondos para dejar 150 pt al nombre, o para caber bajo las
   crisis, y nunca de 30: «al menos» mide 25 pt a 6,3, el cuerpo menor del documento. La cifra va a 7,9, o a 7,4 si la casilla baja de 32.
   El ancho es el de la hoja, de margen a margen (595,28 − 2 × 45). */
export const MATRIZ = {
  ancho: 505,
  cabecera: 12,
  casillaMaxima: 32,
  casillaMinima: 30,
  anchoDelNumero: 16,
  holguraDelNombre: 6,
  interlinea: 1.2
} as const;
export const casillaDeLaMatriz = (n: number) => Math.min(MATRIZ.casillaMaxima, Math.max(MATRIZ.casillaMinima, Math.floor((MATRIZ.ancho - 10 - 150) / Math.max(1, n))));

/**
 * El nombre de un fondo en `maxLineas` líneas de `ancho` pt como mucho, cortando solo entre palabras. Si no cabe, la última línea termina
 * en la última palabra entera que quepa con «…» (sin guion ni coma colgando). Las líneas se dan hechas para que @react-pdf no las rehaga.
 */
export function nombreEnLineas(nombre: string, ancho: number, maxLineas: number, mide: (texto: string) => number): string[] {
  const palabras = nombre.split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let i = 0;
  while (i < palabras.length && lineas.length < maxLineas) {
    let linea = palabras[i++];
    while (i < palabras.length && mide(`${linea} ${palabras[i]}`) <= ancho) linea += ` ${palabras[i++]}`;
    lineas.push(linea);
    if (mide(linea) > ancho) break;
  }
  let ultima = lineas.at(-1);
  if (ultima && (i < palabras.length || mide(ultima) > ancho)) {
    const recorta = (texto: string) => texto.replace(/[\s,;:·–—-]+$/u, "");
    while (mide(`${recorta(ultima)}…`) > ancho && ultima.includes(" ")) ultima = ultima.slice(0, ultima.lastIndexOf(" "));
    const caracteres = Array.from(ultima);
    while (mide(`${recorta(ultima)}…`) > ancho && caracteres.length) {
      caracteres.pop();
      ultima = caracteres.join("");
    }
    lineas[lineas.length - 1] = `${recorta(ultima)}…`;
  }
  return lineas;
}

/** Lo que imprime la sección del solapamiento con una selección de fondos en la matriz. */
export interface SolapamientoDelInforme {
  alcance: string | null;
  frases: string[];
  nombres: string[];
  valores: Array<Array<number | null>>;
  sinMatriz: string | null;
  tituloMatriz: string;
  nota: string | null;
  bajoElUmbral: string | null;
  fuera: string[];
}

function prepararSolapamiento(model: ReportOverlap, corte: CorteDeLaMatriz, seleccion: readonly number[], significativos: ReadonlySet<number> = new Set(seleccion)): SolapamientoDelInforme {
  const n = model.positions.length;
  const { frases, masDeCien } = solapamientoEnFrases(model);
  const totalSignificativos = significativos.size;
  const reducida = seleccion.length < totalSignificativos;
  const nombres = seleccion.map((i) => model.positions[i].display_name);
  const valores = recortarLaMatriz(model.values, seleccion).map((fila, i) => fila.map((valor, j) => (i !== j && valor !== null && superaUmbralDeLaMatriz(valor) ? valor : null)));
  const sinMatriz = corte.sinMatriz && !frases.includes(corte.sinMatriz) ? corte.sinMatriz : null;
  const pesoTotal = peso(model.positions.reduce((suma, posicion) => suma + posicion.weight_percent, 0) / 100) ?? FALTA;
  const alcance = n ? `${n === 1 ? "La única posición" : `Las ${n} mayores posiciones por peso`} · ${pesoTotal} de la cartera.` : null;
  const tituloMatriz = reducida
    ? `Matriz de solapamiento reducida · ${nombres.length} de ${totalSignificativos} fondos con cruces del ${SOLAPAMIENTO_ALTO} % o más`
    : `Matriz de solapamiento · ${nombres.length} de ${corte.dentro.length} fondos comparables`;
  const otrosComparables = nombres.length >= 2 ? corte.dentro.filter((i) => !significativos.has(i)).map((i) => model.positions[i].display_name) : [];
  const bajoElUmbral = otrosComparables.length === 0
    ? null
    : otrosComparables.length === 1
      ? `El otro fondo comparable no comparte el ${SOLAPAMIENTO_ALTO} % o más con ningún otro: ${otrosComparables[0]}.`
      : `Los otros ${otrosComparables.length} fondos comparables no comparten el ${SOLAPAMIENTO_ALTO} % o más con ningún otro: ${enumerarNombres(otrosComparables)}.`;
  const nota = nombres.length >= 2
    ? `${reducida ? "Se priorizan los pares con mayor solapamiento medido. " : ""}${NOTA_DE_LA_MATRIZ}`
    : model.positions.some((posicion) => posicion.status !== "not_applicable")
      ? NOTA_SIN_MATRIZ
      : null;
  const notaConExceso = nota && (masDeCien || valores.some((fila) => fila.some(pasaDeCien))) ? `${nota} ${NOTA_MAS_DE_100}` : nota;
  return { alcance, frases, nombres, valores, sinMatriz, tituloMatriz, nota: notaConExceso, bajoElUmbral, fuera: corte.fuera };
}

/* ------------------------------------------------------------------------------------------------ Las alturas, para decidir qué va junto */

/**
 * Las medidas del papel, en puntos, para estimar alturas: las de la plantilla (`plantilla/tema.ts`). Solo deciden si la matriz cabe bajo
 * las crisis o en una hoja; si una estimación se queda corta, la matriz, que no se parte, pasa a la hoja siguiente, y no se corta nada.
 * Desde el 14-11-2026 la plantilla tiene el aspecto del papel de antes: márgenes de 45, título grande en la hoja y Roboto Flex.
 */
const PAPEL_MEDIDO = {
  /** De margen a margen. */
  ancho: 505,
  /** El alto del cuerpo de una hoja vertical: 841,89 menos lo que reservan la cabecera (56) y el pie (54,5). */
  alto: 731,
  /** El título grande de la sección que abre la hoja: el título en Fraunces de 19,5, su filete y el aire de debajo. */
  tituloDeHoja: 48,
  /** El título de una sección que sigue en la hoja, sin el aire de encima. */
  tituloDeSeccion: 21,
  /** El aire y el filete de encima de una sección que sigue en la hoja. */
  aireDeSeccion: 25,
  /** Lo que se deja de holgura en cada estimación: mejor una hoja de más que un bloque que no cabe donde se dijo. */
  holgura: 4
} as const;

const altoDeParrafo = (texto: string, mide: Medidor, ancho: number = PAPEL_MEDIDO.ancho, cuerpo = 9.3, interlineado = 1.4, encima = 5) =>
  encima + lineasDe(texto, ancho, cuerpo, mide) * cuerpo * interlineado;
const altoDeNota = (texto: string, mide: Medidor) => 9 + 2 + lineasDe(texto, PAPEL_MEDIDO.ancho - 12.5, 8.5, mide) * 8.5 * 1.4;

/** Lo que mide la matriz con su título, su nota y lo que va debajo, sin las casillas. */
function altoDelSolapamiento({ alcance, frases, nombres, nota, bajoElUmbral, fuera, sinMatriz }: SolapamientoDelInforme, mide: Medidor) {
  const lectura = (alcance ? 4 + lineasDe(alcance, PAPEL_MEDIDO.ancho, 7.7, mide) * 7.7 * 1.4 : 0)
    + frases.reduce((suma, frase) => suma + altoDeParrafo(frase, mide), 0) + 6;
  const altoBajoElUmbral = bajoElUmbral ? altoDeParrafo(bajoElUmbral, mide) : 0;
  const altoFuera = fuera.length ? 9 + 9.3 * 1.3 + 9.3 * 1.4 * fuera.reduce((suma, linea) => suma + lineasDe(linea, PAPEL_MEDIDO.ancho, 9.3, mide), 0) : 0;
  const altoNota = nota ? altoDeNota(nota, mide) : 0;
  if (nombres.length >= 2) return { lectura, detalle: 10 + 7 * 1.3 + 4 + MATRIZ.cabecera + altoNota + altoBajoElUmbral + altoFuera };
  const fraseSinMatriz = sinMatriz ? altoDeParrafo(sinMatriz, mide) : 0;
  return { lectura, detalle: fraseSinMatriz + altoFuera + altoNota };
}

function casillaQueCabe(contenido: SolapamientoDelInforme, espacio: number, mide: Medidor) {
  const { lectura, detalle } = altoDelSolapamiento(contenido, mide);
  const n = contenido.nombres.length;
  const libre = espacio - lectura - detalle;
  const casilla = n ? Math.min(casillaDeLaMatriz(n), Math.floor(libre / n)) : MATRIZ.casillaMaxima;
  return libre >= 0 && casilla >= MATRIZ.casillaMinima ? { contenido, casilla } : undefined;
}

const MAX_FONDOS_MATRIZ_REDUCIDA = 6;

function matrizReducidaQueCabe(model: ReportOverlap, corte: CorteDeLaMatriz, pares: ReturnType<typeof paresDeSolapamiento>, significativos: ReadonlySet<number>, espacio: number, mide: Medidor) {
  const maximo = Math.min(MAX_FONDOS_MATRIZ_REDUCIDA, significativos.size - 1);
  for (let limite = maximo; limite >= 2; limite--) {
    const incluidos = new Set<number>();
    for (const { a, b } of pares) {
      const adicionales = Number(!incluidos.has(a)) + Number(!incluidos.has(b));
      if (incluidos.size + adicionales > limite) continue;
      incluidos.add(a);
      incluidos.add(b);
      if (incluidos.size === limite) break;
    }
    const ajuste = casillaQueCabe(prepararSolapamiento(model, corte, [...incluidos], significativos), espacio, mide);
    if (ajuste) return ajuste;
  }
  return undefined;
}

/** Lo que miden las crisis, con su título y su nota: la sección abre hoja, así que esto es lo que deja libre debajo. */
function altoDeLasCrisis(modelo: ModeloDeCrisis, queMide: string, loQueNoEs: string, mide: Medidor): number {
  /* El título grande de la hoja y el subtítulo en Fraunces de 12,5. */
  const titulo = PAPEL_MEDIDO.tituloDeHoja + 6 + 12.5 * 1.2;
  if (modelo.crisis.length === 0) return titulo + altoDeNota(modelo.sinNinguna ?? "", mide);
  const columnas = modelo.crisis.length;
  /* Cada tarjeta, con su borde y su relleno de 10 a cada lado, y 8 entre dos. */
  const ancho = (PAPEL_MEDIDO.ancho - 8 * (columnas - 1)) / columnas - 21;
  const linea = (texto: string | null, cuerpo = 7.7) => (texto ? 2 + lineasDe(texto, ancho, cuerpo, mide) * cuerpo * 1.4 : 0);
  const ficha = (crisis: ModeloDeCrisis["crisis"][number]) => 18 + 1.1 + 8 + linea(crisis.nombre, 7) + linea(crisis.contexto) + 7 + 18.5 * 1.15
    + (crisis.cifra ? linea(crisis.tramo) + linea(crisis.parteMedida) : linea(crisis.sinDato)) + linea(crisis.fuera, 6.8);
  return titulo + 4 + lineasDe(queMide, PAPEL_MEDIDO.ancho, 7.7, mide) * 7.7 * 1.4 + 12 + Math.max(...modelo.crisis.map(ficha)) + altoDeNota(loQueNoEs, mide);
}

/* ------------------------------------------------------------------------------------------------ La guía */

/**
 * La guía de interpretación. Describe y no juzga (decisión 4): ningún «gestión excelente», ningún «peor escenario», ningún nivel de confort
 * que el informe no contiene. Lo que depende de la cartera se dice solo si es verdad en esta, y cada entrada corresponde a algo que el papel
 * imprime.
 *
 * Sin «Tipo sin riesgo», «Caída máxima» ni «Crisis pasadas» (Óscar, 22-11-2026): el tipo sin riesgo no le dice nada al cliente y su cifra
 * sigue en la nota bajo las cifras (con el tipo de respaldo, si lo hay, en `fraseDelRespaldo`); las crisis se explican en su propia
 * sección; y la caída máxima, que es una de las cuatro cifras, se queda sin entrada. Entra el cono, que no la tenía.
 */
function entradasDeLaGuia({ anos, sharpeNoAplica, unaSolaAccion, conAcciones, conFrontera, conCono }: {
  anos: number;
  sharpeNoAplica: boolean;
  /** La cartera entera es una sola acción: sin solapamiento, que no le aplica (decisión 80). */
  unaSolaAccion: boolean;
  /** Hay alguna acción: la composición lleva su rentabilidad por dividendo prevista, y la guía dice qué es (A-143). */
  conAcciones: boolean;
  /** Se dibuja la frontera: la guía la explica (Óscar, 16-11-2026). Sin curva, esa entrada no sale. */
  conFrontera: boolean;
  /** Sale el cono estadístico: la guía lo explica (Óscar, 22-11-2026). Sin cono, esa entrada no sale. */
  conCono: boolean;
}): ReadonlyArray<readonly [titulo: string, subtitulo: string, texto: string]> {
  const entradas: ReadonlyArray<readonly [titulo: string, subtitulo: string, texto: string]> = [
    ["Rentabilidad anualizada", "Lo que se habría ganado cada año, de media", "La rentabilidad media de cada año del periodo medido, con las ganancias acumuladas. Sale de una simulación con los pesos de hoy: no es la rentabilidad que usted ha obtenido."],
    ["Volatilidad", "El indicador de estabilidad (¿cuánto se mueve?)", "A menudo se asocia erróneamente con «pérdida», pero técnicamente mide la incertidumbre. Una volatilidad baja refleja un comportamiento estable y tranquilo; una volatilidad alta implica oscilaciones más fuertes en el corto plazo."],
    sharpeNoAplica
      ? ["Ratio de Sharpe", "No aplica a una sola acción", `Lo que mide la simulación es una sola acción, y a una acción no se le da este ratio. ${motivoDeQueNoAplique("sharpe", "STOCK")}`]
      : ["Ratio de Sharpe", "Rentabilidad por cada punto de oscilación", "Rentabilidad por encima del tipo sin riesgo por cada punto de oscilación en el periodo medido. No mide la calidad de la gestión ni anticipa el futuro."],
    ["Mapa de riesgo y rentabilidad", "El contexto visual (¿dónde estoy situado?)", "El eje horizontal representa el riesgo (volatilidad) y el eje vertical la rentabilidad. Hacia la derecha: mayor riesgo/movimiento. Hacia arriba: mayor rentabilidad en el periodo medido; comparada con cinco carteras de referencia."],
    ["Frontera eficiente", "Qué combinaciones dieron más por el mismo riesgo", `Con estas mismas posiciones y el histórico de ${anos} años, la curva marca, para cada nivel de oscilación, la combinación que más habría rendido. Depende del periodo con que se calcula: con otros años sería otra curva. No dice lo que rendirá ninguna combinación, y no es una recomendación de cambiar su cartera.`],
    [`Cono estadístico a ${anos} años`, "El margen en que podría moverse su inversión", `Dibuja entre qué valores podría moverse la cartera en los próximos ${anos} años si oscilara tanto como en los últimos ${anos}. La línea central supone que el dinero crece como una inversión sin riesgo, sin dar por hecho que se repitan las ganancias del pasado. La zona oscura del cono reúne la mitad de los resultados posibles, y la clara, nueve de cada diez. Es un cálculo estadístico, no una previsión: los resultados pueden quedar fuera del cono, y las pérdidas, ser mayores que las del caso desfavorable.`],
    ["Solapamiento", "Qué parte de sus carteras comparten dos fondos", "El porcentaje de inversiones que dos fondos tienen en común, según las carteras que publican, con el peso real de cada una. Solo se suma lo publicado: por eso dice «al menos», y el real puede ser mayor. Si a uno de los dos le falta más de la mitad de su cartera publicada, el par no se mide, y eso no quiere decir que no coincidan."],
    ["Rentabilidad por dividendo prevista", "Lo que se espera que reparta cada acción", "El dividendo que se prevé que pague cada acción en los próximos doce meses, dividido entre su precio de hoy. Es una estimación del proveedor de datos, no un dividendo cobrado, y puede cambiar. En los fondos y los ETF no aplica."]
  ];
  return entradas.filter(([titulo]) =>
    !(unaSolaAccion && titulo === "Solapamiento")
    && (conAcciones || !titulo.startsWith("Rentabilidad por dividendo"))
    && (conFrontera || titulo !== "Frontera eficiente")
    && (conCono || !titulo.startsWith("Cono estadístico")));
}

/* ------------------------------------------------------------------------------------------------ La rentabilidad por dividendo */

/**
 * La rentabilidad por dividendo de las acciones, de sus fichas, para `rentabilidadPorDividendo`. Lee `fundamentals_summary.dividends.yield_ratio`,
 * en tanto por uno, que es como lo trae el modelo de lectura: no se calcula ni se completa aquí. Solo las acciones entran; lo que no es un
 * número finito, null.
 */
export function rentabilidadPorDividendoDe(activos: readonly BdbAssetDetail[]): Record<string, number | null> {
  const salida: Record<string, number | null> = {};
  for (const activo of activos) {
    if (!esAccion(activo.instrument_type)) continue;
    const valor = activo.fundamentals_summary?.dividends?.yield_ratio;
    salida[activo.asset_id] = typeof valor === "number" && Number.isFinite(valor) ? valor : null;
  }
  return salida;
}

/* ------------------------------------------------------------------------------------------------ El reparto */

/**
 * Una fila de categoría. `agrupa` es la de «Otras N categorías», que solo sale si de verdad no caben todas: va la última, en gris y sin
 * barra, para que no parezca la mayor por ser una suma, y la nota de debajo dice cuántas suma y cuánto pesa la mayor de ellas.
 */
export interface FilaDeCategoria {
  label: string;
  /** En % de toda la cartera. */
  value: number;
  agrupa?: { cuantas: number; mayor: number };
  /** Lo que no entra en el reparto: la última fila, en gris. */
  fuera?: boolean;
}

/** Las mayores categorías que caben en una hoja con el reparto global al lado: si son más, «Otras N categorías» al final (decisión de Óscar del 10-11-2026). */
function filasDeCategoria(ordenadas: ReadonlyArray<{ label: string; value: number }>, fuera: { label: string; value: number } | null, huecos: number): FilaDeCategoria[] {
  const sitio = Math.max(2, huecos - (fuera ? 1 : 0));
  const caben = ordenadas.length <= sitio;
  const nombradas = caben ? ordenadas : ordenadas.slice(0, sitio - 1);
  const resto = caben ? [] : ordenadas.slice(sitio - 1);
  return [
    ...nombradas.map((fila) => ({ ...fila })),
    ...(resto.length ? [{ label: `Otras ${resto.length} categorías`, value: resto.reduce((suma, fila) => suma + fila.value, 0), agrupa: { cuantas: resto.length, mayor: Math.max(...resto.map((fila) => fila.value)) } }] : []),
    ...(fuera ? [{ ...fuera, fuera: true }] : [])
  ];
}

/* ------------------------------------------------------------------------------------------------ Todo lo que imprime el documento */

/** Una fila de la tabla de composición, con sus textos ya escritos. `null`: falta; `NO_APLICA`, no aplica. */
export interface FilaDeComposicion {
  assetId: string;
  nombre: string;
  /** Clase · ISIN · hasta dónde llegan sus datos. */
  apunte: string;
  peso: string | null;
  importe: string | null;
  dividendo: { texto: string | null; motivo?: ClaseDeAusencia };
  divisa: string | null;
}

export interface CrisisDelInforme {
  modelo: ModeloDeCrisis;
  queMide: string;
  loQueNoEs: string;
}

export interface DatosDelInforme {
  input: InformeDeClientePdfInput;
  mide: Medidor;
  clientName: string;
  identidad: IdentidadDelAsesor;
  /* La presentación. */
  esMuestra: boolean;
  metodologia: string | null;
  periodo: string | null;
  fechaDeCreacion: string;
  fechaCorta: string;
  elaboradoPor: string | null;
  perfil: string | null;
  horizonte: string | null;
  valoracion: string | null;
  cifras: CifraDeLaCartera[];
  fraseDelRespaldo: string | null;
  sinCifra: string | null;
  ilustrativas: boolean;
  /* La composición. */
  conImporte: boolean;
  filas: FilaDeComposicion[];
  totalPeso: string | null;
  totalImporte: string | null;
  /* El reparto. */
  composicionGlobal: Array<{ label: string; value: number }>;
  loQueNoEntra: string | null;
  /** A-203: los fondos que no declaran su reparto de activos, que no cuentan en la composición global. Null si no hay. */
  sinReparto: string | null;
  categorias: FilaDeCategoria[];
  /* La geografía. */
  regiones: Array<{ key: string; weight_percent: number }>;
  equityLookThrough: boolean;
  /** A-211: lo que no declara su reparto de activos y no entra en las regiones de la renta variable. Null si no hay, o sin mapa por dentro. */
  sinRepartoEnLaGeografia: string | null;
  fueraDelReparto: number;
  /* La evolución. */
  tituloDeLaEvolucion: string;
  periodoDeLaEvolucion: string;
  fraseDeLaEvolucion: string;
  serie: { fechas: string[]; cartera: number[]; referencia: number[] | null } | null;
  nombreDeLaSerie: string;
  nombreDeLaReferencia: string;
  resumenDeLaEvolucion: { titulo: string | null; texto: string };
  /* El mapa de riesgo y rentabilidad. */
  mapa: MapaDelInforme;
  /** La frontera eficiente (Óscar, 16-11-2026). Null: no le aplica a esta cartera y la sección no sale. */
  frontera: FronteraDelInforme | null;
  /** El cono estadístico, tras el mapa. `null`: no hay cifra de la cartera, o falta histórico o tipo sin riesgo, y la sección no sale. */
  cono: ConoDelInforme | null;
  /* Las crisis y el solapamiento. */
  crisis: CrisisDelInforme;
  solapamiento: { contenido: SolapamientoDelInforme; casilla: number; parte: "todo" | "lectura" };
  /** Si la lectura y la matriz van en dos bloques: la matriz no cabe con la lectura, y va a la hoja siguiente. */
  matrizAparte: { contenido: SolapamientoDelInforme; casilla: number } | null;
  /* La guía y el alcance. */
  leadDeLaGuia: string;
  entradas: ReadonlyArray<readonly [string, string, string]>;
  lineaDeAlcance: string | null;
  /* El histórico ampliado. */
  ampliado: { titulo: string; texto: string; metodologia: string; extensiones: Array<{ nombre: string; lineas: string[] }> } | null;
}

/** Un punto del cono: los cinco percentiles en un momento, en la unidad del papel (euros, o base 100). */
export interface PuntoDelCono { p5: number; p25: number; p50: number; p75: number; p95: number }

/**
 * Lo que imprime el cono estadístico del informe de cliente (Óscar, 15-11-2026). Es el del informe interno: una lognormal cerrada con la
 * volatilidad medida en el periodo, **centrada en el tipo sin riesgo** y no en la rentabilidad pasada (`centrarEnElTipoSinRiesgo`). Con la
 * rentabilidad pasada hasta el percentil 5 ganaba y se leía como una promesa, que es por lo que salió de este papel el 04-11-2026
 * (decisión 3 de la auditoría); así enseña cuánto puede oscilar, pérdidas incluidas. Todo llega ya escrito: el gráfico solo dibuja.
 */
export interface ConoDelInforme {
  anos: number;
  /** El valor de hoy, del que parte: el capital, o 100. */
  base: number;
  /** El valor de hoy, escrito: «250.000 €» o «100 €». */
  hoy: string;
  /** Un punto por semana, de hoy al final. */
  puntos: PuntoDelCono[];
  /** Los tres casos al final del plazo, escritos, con su variación respecto a hoy. */
  desfavorable: { valor: string; variacion: string };
  central: { valor: string; variacion: string };
  favorable: { valor: string; variacion: string };
  /** La explicación, en el lenguaje del cliente. */
  parrafos: string[];
  /** Con qué se ha calculado y qué no es. La sección cierra la frase con dónde están las crisis. */
  nota: string;
}

/** Desde qué cobertura el capital declarado es el capital medido: el corte del informe interno (`capitalDelCono`). */
const COBERTURA_DE_TODO_EL_CAPITAL = 99.95;

/**
 * El cono del informe de cliente. Sin cifra de la cartera no hay cono (mide menos del 80 % del peso); sin histórico que cubra el plazo, o
 * sin tipo sin riesgo, tampoco: nunca vuelve a la rentabilidad pasada. En euros solo si hay capital y la simulación mide toda la cartera;
 * si no, por cada 100 € invertidos, que es lo que la serie mide de verdad.
 *
 * Cuenta a mano del caso central: 250.000 € al 2,00 % durante 3 años son 250.000 × 1,02³ = 250.000 × 1,061208 = 265.302 €, un +6,12 %.
 */
export function prepararElCono(analysis: PortfolioHorizon | undefined, sinCifra: boolean, capital: number | null, periodoMedido: string | null): ConoDelInforme | null {
  if (!analysis || sinCifra) return null;
  const medida = measurementSeries(analysis.backtest.portfolio_series, analysis.backtest.frequency);
  const historica = buildMonteCarloProjection(medida.series, medida.frequency, analysis.years);
  const tipo = safeNumber(analysis.backtest.metrics.rf_rate);
  const centrada = historica ? centrarEnElTipoSinRiesgo(historica, tipo) : null;
  if (!centrada || tipo === null) return null;
  const enEuros = capital !== null && capital > 0 && analysis.coverageWeightPercent >= COBERTURA_DE_TODO_EL_CAPITAL;
  const base = enEuros ? capital : 100;
  const escala = base / centrada.lastValue;
  const puntos = centrada.points.map((punto) => ({ p5: punto.p5 * escala, p25: punto.p25 * escala, p50: punto.p50 * escala, p75: punto.p75 * escala, p95: punto.p95 * escala }));
  const final = puntos[puntos.length - 1];
  const escribir = (valor: number) => (enEuros ? importeTitular(valor) : importe(valor, { decimales: 1 })) ?? FALTA;
  const caso = (valor: number) => ({ valor: escribir(valor), variacion: rentabilidad(valor / base - 1) ?? FALTA });
  const anos = analysis.years;
  const sujeto = enEuros ? "el valor de su inversión" : "el valor de cada 100 € invertidos";
  return {
    anos,
    base,
    hoy: escribir(base),
    puntos,
    desfavorable: caso(final.p5),
    central: caso(final.p50),
    favorable: caso(final.p95),
    parrafos: [
      `Este gráfico no es una previsión. Enseña entre qué cifras podría moverse ${sujeto} en los próximos ${anos} años si la cartera oscilara tanto como ha oscilado en los últimos ${anos}.`,
      `La línea central supone que el dinero crece solo al tipo sin riesgo (${porcentaje(tipo)} al año), lo que daría una inversión sin riesgo: no da por hecho que las ganancias del pasado se repitan.`,
      "La franja oscura recoge la mitad de los resultados posibles, y la clara, nueve de cada diez. Uno de cada veinte quedaría por debajo de la franja clara, y uno de cada veinte, por encima."
    ],
    nota: `Cálculo estadístico con la oscilación medida ${periodoMedido ?? `en los últimos ${anos} años`}. Los mercados pueden comportarse de otro modo y las pérdidas pueden ser mayores que las del caso desfavorable. No es una promesa ni una recomendación.`
  };
}

/* ------------------------------------------------------------------------------------------------ La frontera eficiente */

/**
 * Lo que imprime la frontera eficiente (Óscar, 16-11-2026, «También la frontera»). Vuelve al papel de cliente, de donde salió el
 * 10-11 con **A-136.1**, y vuelve con las dos condiciones que faltaban entonces: **cifras en los dos ejes** —la curva de aquel papel
 * no tenía ninguna, y una curva sin escala no se puede leer— y **la nota de que depende del periodo**, que es el argumento con el
 * que se quitó. No es una recomendación de cambiar la cartera, y lo dice.
 *
 * Es la frontera **histórica** de la simulación (`analysis.frontier`), la misma que lee el informe completo: nunca la estimada por
 * composición, que salió del papel con la decisión 102 y no se ha recuperado. El punto de la cartera sigue la decisión 59: por
 * debajo del 80 % del peso medido no se pinta, porque sería una suma ponderada.
 */
export interface FronteraDelInforme {
  /** La curva, ya ordenada de menor a mayor riesgo. Vacía si no hay frontera que dibujar. */
  curva: Array<{ vol: number; ret: number }>;
  minVol: { vol: number; ret: number };
  maxSharpe: { vol: number; ret: number };
  /** La cartera, o la parte cubierta, con el rótulo que le corresponde. Null: no se sitúa. */
  cartera: { vol: number; ret: number; rotulo: string } | null;
  /** La calibración: ventana, fecha y observaciones comunes. */
  subtitulo: string;
  /** La cobertura cuando no es toda la cartera; null si la cubre entera. */
  cobertura: string | null;
  nota: string;
  /** Las posiciones que no entran en el cálculo, escritas: «Nombre (8,3 %), por histórico insuficiente.» */
  fuera: string[];
  /** Si no hay curva: el motivo, y no se dibuja nada. */
  ausencia: string | null;
}

/** Sin dos posiciones medidas no hay nada que combinar, y lo dice con las palabras de la decisión 102. */
const FRONTERA_CON_UNA_SOLA_MEDIDA = `${textoDeAusencia("falta")}. Hacen falta al menos dos posiciones medidas, y aquí se mide una.`;

function prepararLaFrontera(
  analysis: PortfolioHorizon | undefined,
  sinCifra: boolean,
  unaSolaAccion: boolean,
  pesoDe: (assetId: string) => number | null,
  nombreDe: (assetId: string) => string | null
): FronteraDelInforme | null {
  const frontier = analysis?.frontier ?? null;
  const vacia = { curva: [], minVol: { vol: 0, ret: 0 }, maxSharpe: { vol: 0, ret: 0 }, cartera: null, subtitulo: "", cobertura: null, nota: "", fuera: [] };
  /* Una cartera de una sola acción no tiene frontera que le falte: no hay nada que combinar (decisión 83). */
  if (unaSolaAccion) return null;
  const puntos = frontier?.frontier ?? [];
  if (!frontier || puntos.length < 2 || frontier.insufficientCoverage) {
    const medidas = analysis?.backtest?.asset_ids?.length ?? 0;
    const ausencia = medidas === 1
      ? FRONTERA_CON_UNA_SOLA_MEDIDA
      : `${FALTA}. ${analysis?.frontierUnavailableReason ?? "No hay suficientes datos comunes entre estas posiciones para dibujar una frontera."}`;
    return { ...vacia, ausencia };
  }
  const cobertura = frontier.portfolioCoverage;
  /* Parcial si el cálculo deja fuera posiciones, por cualquiera de las dos cuentas que lo saben. */
  const parcial = (cobertura ? cobertura.included < cobertura.requested : false) || frontier.coverage.included < frontier.coverage.requested || frontier.excluded.length > 0;
  const rotulo = parcial ? "Parte cubierta" : "Su cartera";
  const actual = sinCifra ? null : frontier.current;
  const anos = frontier.window.replace("Y", "");
  /* Las dos listas de exclusión del servidor dicen lo mismo de activos distintos: una sola entrada por activo. */
  const excluidas = new Map<string, string | null>();
  for (const item of frontier.excluded) excluidas.set(item.assetId, item.reason);
  for (const item of cobertura?.excluded ?? []) excluidas.set(item.assetId, (item as { reason?: string | null }).reason ?? excluidas.get(item.assetId) ?? null);
  /* El peso es el de la composición de este mismo informe, no el que manda el servidor con la exclusión: si los dos difieren, el
     cliente leería dos pesos distintos de la misma posición en el mismo documento. Y el motivo va en las palabras de cliente que
     ya usa el resto del papel (`motivoParaElCliente`), no en la etiqueta del servidor: «bloqueado por calidad del dato» no le
     explica nada a quien lo lee. */
  const fuera = [...excluidas.entries()].map(([assetId, motivo]) => {
    const nombre = nombreDe(assetId) ?? assetId;
    const pesoPct = pesoDe(assetId);
    return `${nombre}${pesoPct === null ? "" : ` (${peso(pesoPct / 100)})`}, por ${motivoParaElCliente(motivo)}.`;
  }).sort((a, b) => a.localeCompare(b, "es-ES"));
  return {
    curva: [...puntos].sort((a, b) => a.volatility - b.volatility).map((punto) => ({ vol: punto.volatility, ret: punto.expectedReturn })),
    minVol: { vol: frontier.minVolatility.volatility, ret: frontier.minVolatility.expectedReturn },
    maxSharpe: { vol: frontier.maxSharpe.volatility, ret: frontier.maxSharpe.expectedReturn },
    cartera: actual ? { vol: actual.volatility, ret: actual.expectedReturn, rotulo } : null,
    subtitulo: `Calibrada con ${anos} años de histórico, a ${fecha(frontier.asOfDate) ?? FALTA}, sobre ${frontier.coverage.commonObservations} fechas comunes.`,
    cobertura: cobertura
      ? `Cubre el ${pesoEnElPapel(cobertura.weightPercent)} del peso: ${cobertura.included} de ${cobertura.requested} posiciones.`
      : parcial ? `Cubre ${frontier.coverage.included} de ${frontier.coverage.requested} posiciones.` : null,
    /* Las dos condiciones de Óscar al recuperarla: que se lea en los ejes, y que diga de qué depende. */
    nota: `${actual
      ? `El punto granate es ${rotulo === "Su cartera" ? "su cartera" : "la parte cubierta, con sus proporciones llevadas al 100 % de ese subconjunto: no es la cartera completa"}.`
      : "La cartera no se sitúa en la curva: para hacerlo harían falta su volatilidad y su rentabilidad medidas."} La curva sale del histórico de estos ${anos} años: con otro periodo sería otra, y no es una previsión de lo que rendirá cada combinación. No es una recomendación de cambiar su cartera.`,
    fuera,
    ausencia: null
  };
}

/** Lo que imprime el mapa de riesgo y rentabilidad: el punto de la composición (si lo hay), las carteras de referencia y las frases. */
export interface MapaDelInforme {
  portfolio: { vol: number; ret: number } | null;
  profiles: ReferenceProfile[];
  /** Si se traza la distancia de la composición a la línea de las carteras de referencia (mismo periodo). */
  comparable: boolean;
  subtitulo: string;
  nota: string;
}

function prepararElMapa(cifras: CifrasDelHorizonte | null, sinCifra: boolean, analysis: PortfolioHorizon | undefined, reference: ReturnType<typeof referenceProfilesFor>): MapaDelInforme {
  /* El punto de la cartera sale de la MISMA lectura que las cifras de su sección. Sin cifra de la cartera no hay punto que pintar ni
     comparación que hacer: serían afirmaciones que el informe no sostiene. */
  if (!analysis || !cifras || sinCifra) {
    return {
      portfolio: null,
      profiles: reference.profiles,
      comparable: false,
      subtitulo: `No hay datos para situar la cartera en el mapa: falta su volatilidad y su rentabilidad. ${reference.profiles.length ? "Se muestran solo las carteras de referencia. " : ""}${reference.label}.`,
      nota: "Sin ellas no se sitúa la cartera ni se compara con las carteras de referencia: hacerlo exigiría dar por buenos valores que el informe no tiene."
    };
  }
  /* Si las carteras de referencia no cubren toda la ventana, la cartera se mide en sus mismas fechas. */
  const tramoComun = reference.window && !reference.window.mismaVentana ? reference.window : null;
  const vol = volatilidadEnElMapa(reference, cifras) as number;
  const ret = tramoComun ? tramoComun.cartera.ret : cifras.cagr.value;
  const eje = tramoComun ? "del tramo común" : `a ${analysis.years} años${analysis.extensions.length ? " con tramos estimados" : ""}`;
  const situada = `La composición simulada (el punto granate) tiene una volatilidad del ${porcentaje(vol) ?? FALTA} y una rentabilidad anualizada del ${rentabilidad(ret) ?? FALTA}.`;
  if (reference.profiles.length === 0) {
    return {
      portfolio: { vol, ret },
      profiles: [],
      comparable: false,
      subtitulo: `Composición simulada (volatilidad ${eje} y rentabilidad ${eje}). ${reference.label}.`,
      nota: `${situada} El mapa no la compara con ninguna cartera de referencia.`
    };
  }
  const lectura = lecturaDelMapa({ vol, ret }, reference.profiles);
  /* F-02: la frase de la distancia a la línea solo cuando las referencias están medidas en la misma ventana que la cartera. */
  const comparable = reference.window !== null;
  return {
    portfolio: { vol, ret },
    profiles: reference.profiles,
    comparable,
    subtitulo: `Composición simulada (volatilidad ${eje} y rentabilidad ${eje}) frente a las carteras de referencia. ${reference.label}.`,
    nota: `${situada} ${comparable && lectura ? fraseDelMapa(lectura) : "Las carteras de referencia no están medidas en el mismo periodo que la composición simulada, así que el mapa no la compara con su línea."}`
  };
}

/**
 * El alto de una fila de categoría en las barras del reparto: 18 de alto y 2 de aire, en los que caben dos líneas del nombre (94 pt a
 * 7,7); cada línea más suma 9,2.
 */
const ANCHO_DEL_NOMBRE_DE_CATEGORIA = 94;
const altoDeUnaCategoria = (rotulo: string, mide: Medidor) => 20 + Math.max(0, lineasDe(rotulo, ANCHO_DEL_NOMBRE_DE_CATEGORIA, 7.7, mide) - 2) * 9.24;

export function prepararInforme(input: InformeDeClientePdfInput, mide: Medidor = MEDIDOR_ESTIMADO): DatosDelInforme {
  const { report, totalCapital, analysis } = input;
  const backtest = analysis?.backtest;
  /* El 80 % se decide con la misma función que la pantalla. Null: hay cifras de la cartera. */
  const sinCifra = motivoSinCifra(report, analysis);
  const horizonYears = analysis?.years ?? 3;
  const esMuestra = analysis?.referenceVersion === "demo-synthetic.v1";
  const benchmarkId = input.benchmarkId || DEFAULT_BENCHMARK_ID;
  const referencia = input.referencia ?? null;
  const perfilElegido = benchmarkById(benchmarkId);
  /* Una cartera de referencia es una cartera entera, y no se compara con una parte de otra (decisión 59). */
  const comparacionHistorica = !sinCifra && perfilElegido && referencia && backtest
    ? compararEnMismasFechas(backtest.portfolio_series.map((point) => point.date), backtest.portfolio_series.map((point) => point.value), perfilElegido.weights, referencia)
    : null;
  const banker = resolveBanker(input.banker);
  /* La identidad del asesor, y encima lo que se escribió en el diálogo del informe: el nombre y el correo, cuando vienen escritos. */
  const identidad: IdentidadDelAsesor = { ...(input.identidad ?? {}), ...(banker.name ? { nombre: banker.name } : {}), ...(banker.email ? { contacto: banker.email } : {}) };
  const clientName = input.clientName?.trim() || "";
  /* El día de quien lo genera, no el de Greenwich: entre medianoche y las dos salía la fecha de ayer. */
  const generatedAt = diaLocal(input.generadoEn || new Date().toISOString());
  const startDate = backtest?.coverage?.first_date ?? analysis?.frontier?.coverage.firstDate;
  const endDate = backtest?.coverage?.last_date ?? analysis?.frontier?.coverage.lastDate;
  const periodo = periodoEntre(startDate, endDate);
  const capitalKnown = (safeNumber(totalCapital) ?? 0) > 0 ? (safeNumber(totalCapital) as number) : null;
  const positions = posicionesDeLaCartera(report).sort((a, b) => b.weight_percent - a.weight_percent);
  /* INF-32: los importes de la composición suman el total impreso: el capital, en euros enteros. */
  const importeDe = new Map(capitalKnown ? importesQueSuman(capitalKnown, positions.map((position) => position.weight_percent)).map((cifra, indice) => [positions[indice].asset_id, cifra]) : []);
  const fuera = fueraDelRepartoDelInforme(report);
  const unaSolaAccion = esUnaSolaAccion(idsConPeso(positions), report.positions);
  const respaldo = tipoDeRespaldo(backtest);
  const parteMedida = parteMedidaDeLaSimulacion(backtest, positions);
  const nombreDePosicion = (assetId: string) => positions.find((position) => position.asset_id === assetId)?.display_name ?? assetId;
  const hayCurva = (backtest?.portfolio_series.length ?? 0) >= 2;
  /* Bajo la curva de la evolución (A-143), no bajo las cifras. */
  const notaDeLaSimulacion = [SIMULACION_CON_LOS_PESOS_DE_HOY, fraseDeLaParteMedida(parteMedida, nombreDePosicion, POR_FALTA_DE_DATOS)].filter(Boolean).join(" ");
  const totalDePesos = positions.reduce((suma, position) => suma + Math.max(0, position.weight_percent || 0), 0);
  const modeloDeCrisis = crisisPasadas(backtest?.stress_scenarios, (assetId) => {
    const position = positions.find((item) => item.asset_id === assetId);
    return position && totalDePesos > 0 ? { nombre: position.display_name, pesoPct: position.weight_percent / totalDePesos * 100 } : null;
  });

  /* ---------- La portada (la rejilla) y las cifras que responden, que van en su sección. ---------- */
  const nivel = input.perfilYHorizonte?.risk_profile_level;
  const horizonte = input.perfilYHorizonte?.horizon_years;
  const conPerfil = nivel !== undefined && errorDelNivelDePerfil(nivel) === null;
  const conHorizonte = horizonte !== undefined && errorDelHorizonte(horizonte) === null;
  const cifras = analysis && !sinCifra ? resolveHorizonMetrics(analysis) : null;

  /* ---------- La composición, con la rentabilidad por dividendo y la divisa de cada posición; el importe, solo con capital. ---------- */
  const delInforme = new Map((report.positions ?? []).map((posicion) => [posicion.asset_id, posicion]));
  /* La rentabilidad por dividendo a doce meses, solo de las acciones (A-143): en lo demás «No aplica», y en una acción sin dato «Falta el
     dato», nunca un cero. Una posición fuera del catálogo no tiene tipo que leer, y dice que falta. */
  const dividendoDe = (assetId: string): FilaDeComposicion["dividendo"] => {
    const posicion = delInforme.get(assetId);
    if (!posicion) return { texto: null };
    if (!esAccion(posicion.instrument_type)) return { texto: null, motivo: "no-aplica" };
    return { texto: porcentaje(input.rentabilidadPorDividendo?.[assetId]) };
  };
  const filas: FilaDeComposicion[] = positions.map((position) => {
    const desde = input.seriesParadas?.get(position.asset_id);
    const clase = position.economic_asset_class === null ? FUERA_DEL_CATALOGO : assetClassLabel(position.economic_asset_class);
    return {
      assetId: position.asset_id,
      nombre: position.display_name,
      apunte: `${clase} · ${position.asset_id}${desde ? ` · ${datosHasta(desde, position.asset_id)}` : ""}`,
      peso: peso(position.weight_percent / 100),
      importe: capitalKnown ? importe(importeDe.get(position.asset_id)) : null,
      dividendo: dividendoDe(position.asset_id),
      divisa: delInforme.get(position.asset_id)?.currency?.trim() || null
    };
  });

  /* ---------- El reparto. ---------- */
  /* A-203: lo que no declara su reparto no se reparte por su clase; las cuatro cifras suman menos de 100, y `sinReparto` dice por qué. */
  const exposure = deriveExposure(report);
  /* `pms_exposure_percent` suma 100 de lo invertible: aquí se lleva a toda la cartera, como la pantalla, y lo que no entra se dice debajo (decisión 85). */
  const deLaCartera = (valor: number) => valor * fuera.parteInvertible;
  const composicionGlobal = [
    { label: "Renta fija", value: deLaCartera(exposure.fixed_income) },
    { label: "Renta variable", value: deLaCartera(exposure.equity) },
    { label: "Liquidez", value: deLaCartera(exposure.cash) },
    { label: "Otros", value: deLaCartera(exposure.alternative + exposure.real_asset + exposure.other) }
  ];
  const porCategoria = filasPorCategoria(report);
  /* Sin ninguna categoría que decir, por su clase. Una acción sí la tiene: «Acciones», no «No declarado» (decisión 83). */
  const usesCategories = porCategoria.some((row) => row.key !== NO_DECLARADO);
  const underlyingSource = usesCategories ? porCategoria : report.summary.by_economic_asset_class;
  const categoriasOrdenadas = [...underlyingSource]
    .filter((row) => row.weight_percent > 0.001)
    .sort((a, b) => b.weight_percent - a.weight_percent)
    .map((row) => ({ label: usesCategories ? (categoriaLegible(row.key) ?? row.key) : assetClassLabel(row.key), value: row.weight_percent }));
  /* Lo que no entra lleva su propia fila, siempre a la vista y la última: si no, las categorías suman menos de 100 sin decirlo. */
  const filaDeFuera = fuera.peso > 0 ? { label: FUERA_DEL_REPARTO, value: fuera.peso } : null;
  /* Las categorías que caben en una hoja con su título: las demás, «Otras N». */
  let huecos = 0;
  for (let alto = 0, i = 0; i < categoriasOrdenadas.length + 1; i += 1) {
    const rotulo = categoriasOrdenadas[i]?.label ?? FUERA_DEL_REPARTO;
    alto += altoDeUnaCategoria(rotulo, mide);
    if (alto > PAPEL_MEDIDO.alto - PAPEL_MEDIDO.tituloDeSeccion - 40 - PAPEL_MEDIDO.holgura) break;
    huecos += 1;
  }
  const categorias = filasDeCategoria(categoriasOrdenadas, filaDeFuera, huecos);

  /* ---------- La geografía. ---------- */
  /* P3.2 · taxonomía única: primero la distribución canónica de regiones (la de Resumen y X-Ray); el desglose crudo por metadato del activo
     queda solo como respaldo (p. ej. cartera sin RV). */
  const canonicalRegionRows = (input.regionRows ?? []).filter((row) => (safeNumber(row.weight_percent) ?? 0) > 0.05);
  const equityLookThrough = canonicalRegionRows.length > 0;
  const regiones = equityLookThrough ? canonicalRegionRows : Array.isArray(report.xray?.by_region) ? report.xray.by_region : [];

  /* ---------- La evolución. ---------- */
  /* A7: una sola lectura de la cobertura para todo el informe. */
  const historyCoverage = backtestWindowCoverage(backtest);
  const historyPeriod = backtestPeriodTitle(historyCoverage);
  /* Sin cifra de la cartera, lo que se dibuja es solo la parte medida, y se llama así. */
  const rotuloDeLaParte = sinCifra && analysis && hayCurva ? `Parte medida (${pesoEnElPapel(analysis.coverageWeightPercent)})` : null;
  const referenciaDelMapa = referenceProfilesFor(backtest, referencia, sinCifra !== null);
  const volatilidadDeLaReferencia = referenciaDelMapa.window ? referenciaDelMapa.profiles.find((perfil) => perfil.id === benchmarkId)?.vol ?? null : null;
  const fraseDelRiesgo = comparacionHistorica ? fraseDelRiesgoDeLaReferencia(volatilidadEnElMapa(referenciaDelMapa, cifras), volatilidadDeLaReferencia) : null;
  const nombreDeLaReferencia = benchmarkById(benchmarkId)?.name ?? benchmarkId;
  const serie = hayCurva && backtest
    ? comparacionHistorica
      ? { fechas: [...comparacionHistorica.fechas], cartera: [...comparacionHistorica.valores], referencia: [...comparacionHistorica.referencia] }
      : { fechas: backtest.portfolio_series.map((punto) => punto.date), cartera: backtest.portfolio_series.map((punto) => punto.value), referencia: null }
    : null;
  const resumenDeLaEvolucion = (() => {
    if (!serie || rotuloDeLaParte) return { titulo: null, texto: notaDeLaSimulacion };
    const primero = serie.cartera[0];
    const ultimo = serie.cartera[serie.cartera.length - 1];
    const titulo = `Composición simulada ${numero(ultimo, { decimales: 1 })} (${rentabilidad(ultimo / primero - 1) ?? FALTA})`;
    const partes: string[] = [];
    if (serie.referencia && serie.referencia.length >= 2) {
      const refPrimero = serie.referencia[0];
      const refUltimo = serie.referencia[serie.referencia.length - 1];
      partes.push(`· ${nombreDeLaReferencia} ${numero(refUltimo, { decimales: 1 })} (${rentabilidad(refUltimo / refPrimero - 1) ?? FALTA}) · Diferencial ${numero(ultimo - refUltimo, { decimales: 1, conSigno: true })} puntos (ambos parten de 100).`);
      if (fraseDelRiesgo) partes.push(fraseDelRiesgo);
    }
    partes.push(notaDeLaSimulacion);
    return { titulo, texto: partes.join(" ") };
  })();

  /* ---------- Las crisis y el solapamiento, con la matriz de los fondos medibles. ---------- */
  const crisis: CrisisDelInforme = { modelo: modeloDeCrisis, queMide: queMideLaCifraDeUnaCrisis("esta composición"), loQueNoEs: LO_QUE_NO_ES_LA_CIFRA_DE_UNA_CRISIS };
  /* El modelo llega ya medido de la pantalla que pide el informe, con la cartera completa del emisor en los ETF que la tienen
     (decisión de Óscar del 14-11-2026, que revisa la B-79: «no los dejes fuera»). El papel usa la cifra y no dice de quién es la
     cartera: aquí no se imprime `issuerPortfolio` en ningún sitio. */
  const modelo = input.overlap ?? buildReportOverlap(report.positions);
  const corte = corteDeLaMatriz(modelo.positions);
  const paresSignificativos = paresDeSolapamiento(modelo.values, corte.dentro).filter(({ valor }) => superaUmbralDeLaMatriz(valor));
  const fondosSignificativos = new Set(paresSignificativos.flatMap(({ a, b }) => [a, b]));
  const matrizCompleta = prepararSolapamiento(modelo, corte, corte.dentro.filter((i) => fondosSignificativos.has(i)), fondosSignificativos);
  /* Las crisis abren hoja; el solapamiento va debajo si cabe. Si la matriz completa no cabe bajo las crisis, se priorizan los pares con
     mayor solapamiento (Óscar, 12-11-2026); si ni así, la lectura va bajo las crisis y la matriz entera a la hoja siguiente. */
  const libreEnHojaPropia = PAPEL_MEDIDO.alto - PAPEL_MEDIDO.tituloDeSeccion - PAPEL_MEDIDO.holgura;
  const libreBajoLasCrisis = PAPEL_MEDIDO.alto - altoDeLasCrisis(modeloDeCrisis, crisis.queMide, crisis.loQueNoEs, mide) - PAPEL_MEDIDO.aireDeSeccion - PAPEL_MEDIDO.tituloDeSeccion - PAPEL_MEDIDO.holgura;
  const bajoLasCrisis = casillaQueCabe(matrizCompleta, libreBajoLasCrisis, mide)
    ?? matrizReducidaQueCabe(modelo, corte, paresSignificativos, fondosSignificativos, libreBajoLasCrisis, mide);
  const aparte = bajoLasCrisis ? undefined : casillaQueCabe(matrizCompleta, libreEnHojaPropia, mide)
    ?? matrizReducidaQueCabe(modelo, corte, paresSignificativos, fondosSignificativos, libreEnHojaPropia, mide);
  const casillaPropia = casillaDeLaMatriz(matrizCompleta.nombres.length);
  const solapamiento = bajoLasCrisis
    ? { ...bajoLasCrisis, parte: "todo" as const }
    : { contenido: aparte?.contenido ?? matrizCompleta, casilla: aparte?.casilla ?? casillaPropia, parte: "lectura" as const };
  const matrizAparte = bajoLasCrisis ? null : { contenido: aparte?.contenido ?? matrizCompleta, casilla: aparte?.casilla ?? casillaPropia };

  /* ---------- La guía y, al pie, el alcance de las cifras. ---------- */
  const laFrontera = prepararLaFrontera(
    analysis,
    sinCifra !== null,
    unaSolaAccion,
    (assetId) => positions.find((position) => position.asset_id === assetId)?.weight_percent ?? null,
    (assetId) => positions.find((position) => position.asset_id === assetId)?.display_name ?? null
  );
  const elCono = prepararElCono(analysis, sinCifra !== null, capitalKnown, periodo);
  const entradas = entradasDeLaGuia({
    anos: horizonYears,
    sharpeNoAplica: !sinCifra && sharpeDeUnaSolaAccion(report, backtest),
    unaSolaAccion,
    conAcciones: (report.positions ?? []).some((posicion) => esAccion(posicion.instrument_type)),
    /* La guía explica la frontera solo si se dibuja: sin curva no hay nada que interpretar. */
    conFrontera: laFrontera !== null && laFrontera.ausencia === null,
    /* Y el cono, solo si sale su sección. */
    conCono: elCono !== null
  });
  const leadDeLaGuia = `«Breve guía para ayudarle a interpretar los indicadores clave de su cartera.»${sinCifra ? ` En esta cartera no se dan las cifras de rentabilidad, volatilidad, Sharpe y caída máxima: «${TITULO_DE_LAS_CIFRAS}» dice por qué.` : ""}${conSiglas(categorias.map((fila) => fila.label)) ? ` ${SIGLAS_DE_LAS_CATEGORIAS}` : ""}`;
  /* El alcance existe si las cifras miden menos del 100 % de la cartera (A-143), y es una sola línea al pie de la guía. Sin cifras de la
     cartera no sale: «Cifras calculadas sobre…» diría que las hay, y la sección de las cifras ya dice por qué no. */
  const lineaDeAlcance = sinCifra ? null : lineaDelAlcance(parteMedida);

  /* ---------- El histórico ampliado. ---------- */
  const ampliado = analysis && analysis.extensions.length > 0
    ? {
      titulo: "Histórico ampliado con referencias",
      texto: `Periodo común: ${analysis.years} años, ${periodo ?? FALTA.toLocaleLowerCase("es-ES")}. ${versionDeLaReferencia(analysis.referenceVersion)}.`,
      metodologia: analysis.methodology,
      extensiones: analysis.extensions.map((extension) => ({
        nombre: positions.find((p) => p.asset_id === extension.assetId)?.display_name ?? extension.assetId,
        lineas: [
          `${extension.assetId}. Referencia: ${extension.reference}.`,
          `Tramo estimado: ${periodoEntre(extension.estimatedFrom, extension.estimatedUntil) ?? FALTA.toLocaleLowerCase("es-ES")}. Precios reales desde el ${diaOFalta(extension.observedFrom)}.`,
          `Validación: ${extension.validationWeeks} variaciones semanales; correlación fuera de muestra ${ratio(extension.holdoutCorrelation) ?? FALTA.toLocaleLowerCase("es-ES")}. Riesgo residual anual ${porcentaje(extension.residualVolatility) ?? FALTA.toLocaleLowerCase("es-ES")}.`,
          `Fuente: ${extension.url}`,
          ...(extension.referenceHasBacktestedHistory ? ["El índice incluye historia retrospectiva anterior a su lanzamiento."] : [])
        ]
      }))
    }
    : null;

  return {
    input,
    mide,
    clientName,
    identidad,
    esMuestra,
    metodologia: esMuestra ? analysis?.methodology ?? null : null,
    periodo,
    fechaDeCreacion: fechaLarga(generatedAt) ?? FALTA,
    fechaCorta: diaOFalta(generatedAt),
    elaboradoPor: identidad.nombre?.trim() || null,
    perfil: conPerfil ? textoDelNivel(nivel) : null,
    horizonte: conHorizonte ? textoDelHorizonte(horizonte) : null,
    valoracion: capitalKnown ? importeTitular(capitalKnown) : null,
    cifras: informeDeClienteMetricRows(report, analysis),
    /* Solo si ocurre, y solo si hay un Sharpe del que decirlo (decisión 89). */
    fraseDelRespaldo: respaldo !== null && !sinCifra && !sharpeDeUnaSolaAccion(report, backtest) ? fraseDelTipoDeRespaldo(respaldo) : null,
    sinCifra,
    ilustrativas: esMuestra && cifras !== null,
    conImporte: capitalKnown !== null,
    filas,
    totalPeso: peso(safeNumber(report.summary.total_weight_percent) === null ? null : report.summary.total_weight_percent / 100),
    totalImporte: capitalKnown ? importe(Math.round(capitalKnown)) : null,
    composicionGlobal,
    loQueNoEntra: fraseDeLoQueNoEntra(fuera, EN_LA_TABLA_DE_COMPOSICION),
    sinReparto: fraseDeLoQueNoTieneRepartoEnElPapel(report, fuera.parteInvertible),
    categorias,
    regiones,
    equityLookThrough,
    /* En % de la cartera, como la frase de la composición global: los pesos del análisis son de lo invertible. */
    sinRepartoEnLaGeografia: equityLookThrough ? fraseDelSinRepartoEnElPapel((report.xray?.pms_exposure_sin_reparto_percent ?? 0) * fuera.parteInvertible) : null,
    fueraDelReparto: fuera.peso,
    tituloDeLaEvolucion: rotuloDeLaParte ? "Evolución simulada de la parte medida" : "Evolución simulada de la composición actual",
    periodoDeLaEvolucion: `Evolución · ${historyPeriod}${(analysis?.extensions.length ?? 0) > 0 ? " · estimado" : ""}`,
    fraseDeLaEvolucion: sinCifra
      ? `${sinCifra}${rotuloDeLaParte ? " La línea dibuja solo la parte medida, que parte de 100, y no se compara con la cartera de referencia, que es una cartera entera." : ""}`
      : `${fraseDeLaComparacion(benchmarkId, comparacionHistorica, referencia, historyCoverage?.rangeLabel)}${historyCoverage && !historyCoverage.coversWindow
        ? ` La historia común de estas posiciones no alcanza los ${historyCoverage.requestedYears} años: las métricas describen el periodo mostrado.`
        : ""}`,
    serie,
    nombreDeLaSerie: rotuloDeLaParte ?? "Composición simulada",
    nombreDeLaReferencia,
    resumenDeLaEvolucion,
    mapa: prepararElMapa(cifras, sinCifra !== null, analysis, referenciaDelMapa),
    frontera: laFrontera,
    cono: elCono,
    crisis,
    solapamiento,
    matrizAparte,
    leadDeLaGuia,
    entradas,
    lineaDeAlcance,
    ampliado
  };
}

export { FUERA_DE_LA_MATRIZ, GEO_AREAS };
