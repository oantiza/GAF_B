// Modelo del informe completo de cartera para el asesor (uso interno, nunca cliente).
//
// Reúne en una estructura plana lo que ya calculan otras piezas —informe de
// cartera, análisis del periodo (backend), composición subyacente, solapamiento,
// costes, retrocesiones, salud— más la analítica ampliada de
// `portfolioExtendedAnalytics`. No rehace ninguna cifra existente: cada dato
// conserva su fuente y su cobertura, y donde falta queda `null` (N/D en el PDF).
//
// Es puro y síncrono para poder probarlo sin generar el documento.

import type { StoredImprovement } from "./improvementResultStore";
import type { PortfolioHorizon } from "../adapters/portfolioHorizon";
import type { CommercialRetroRecord } from "../types/commercialRetro";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbPortfolioAllocationBucket,
  BdbPortfolioLookThrough,
  BdbPortfolioReport
} from "../types/bdbAssets";
import { aportacionAlRiesgo, avisoDeDivisas, cifrasDelProveedorEnOtraDivisa, esUnaSolaAccion, fueraDeLaMedida, hayCifraDeCartera, motivoSinCifraDeCartera, nombreConPeso, pesoLegible, PESO_MINIMO_MEDIDO_PCT, type FueraDeLaMedida } from "./medidaDeLaCartera";
import type { PortfolioFeasibilityCheck } from "./portfolioConstraints";
import { pasaDeCien, solapamientoEnUnaFrase } from "./overlap";
import { diezMayoresQueCuadran } from "./lineaDeCartera";
import { casillaNoAplica, type ReportOverlap } from "./reportOverlap";
import { benchmarkById, compararEnMismasFechas, perfilCalculable, type SeriesBaseDeReferencia } from "./benchmarkProfiles";
import { backtestExclusionLabel } from "./backtestCoverage";
import { resolveEffectiveCommercialRetro, retrocesionCreible, topeDeLaRetrocesion } from "./commercialRetroEffective";
import { summarizeCoveredRate } from "./coveredFinancialMetrics";
import { computeEquityRegionAllocation } from "./equityRegions";
import { cuentaQueCuadra } from "./cuentaDePosiciones";
import { categoriaLegible, regionLegible } from "./etiquetasDeReparto";
import { fecha, oFalta, peso, porcentaje, ratio } from "./formato";
import { computeEquitySectorAllocation } from "./equitySectors";
import { assetPmsShares, CLAVE_SIN_DATO_DEL_REPARTO, computePmsExposureDistribution } from "./portfolio";
import { textoDeAusencia } from "./textoDeAusencia";
import type { FrontierViewModel } from "../types/portfolioFrontier";
import { esAccion } from "./esAccion";
import { rotuloDeLaVentana } from "./metricsFrequency";
import { calculatePortfolioCosts } from "./portfolioCosts";
import { readableBackendLabel } from "./labels";
import { seEnsenaLaMetrica } from "./metricasPorInstrumento";
import { evaluatePortfolioHealth, type PortfolioHealthResult } from "./portfolioHealth";
import { filasPorCategoria, FUERA_DEL_REPARTO, fueraDelRepartoDelInforme, posicionesFueraDelCatalogo, type FueraDelRepartoEnElPapel } from "./repartoDelPapel";
import { riesgoMedidoDe } from "./riesgoMedido";
import { posicionesParadas, puntoDeSeriesParadas } from "./serieParada";
import { leerSaludYControl, type FilaDeControl, type LecturaDeSalud } from "./saludYControl";
import {
  benchmarkRelativeStats,
  calendarYearReturns,
  calmarRatio,
  concentrationStats,
  drawdownEpisodes,
  historicalTailRisk,
  worstWeeklyReturn,
  periodExtremes,
  rollingStats,
  sortinoRatio,
  type BenchmarkRelativeStats,
  type CalendarYearReturn,
  type ConcentrationStats,
  type DrawdownEpisode,
  type PeriodExtremes,
  type RollingPoint,
  type TailRisk
} from "./portfolioExtendedAnalytics";

export type InternalReportWindow = "3Y" | "5Y";
export type RetroLoadStatus = "ok" | "denied" | "error" | "not_requested";

export interface InternalReportInput {
  report: BdbPortfolioReport;
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
  totalCapital?: number;
  benchmarkId: string;
  /** Las series de las carteras de referencia, ya cargadas: el modelo es puro. null, no han llegado, y se dice. */
  referencia?: SeriesBaseDeReferencia | null;
  horizons: Partial<Record<InternalReportWindow, PortfolioHorizon | null>>;
  horizonErrors?: Partial<Record<InternalReportWindow, string>>;
  /** El servidor ha dicho que con estos datos no se puede simular: no es un fallo, y reintentar no lo arregla. */
  sinSerie?: boolean;
  lookThrough?: BdbPortfolioLookThrough | null;
  overlap?: ReportOverlap | null;
  overlapError?: string | null;
  retro: { status: RetroLoadStatus; records: ReadonlyMap<string, CommercialRetroRecord> };
  regionRows?: Array<{ key: string; weight_percent: number }>;
  feasibility?: PortfolioFeasibilityCheck | null;
  generatedAt: string;
  includeAssetSheets: boolean;
  /** Último resultado de «Mejorar cartera» para esta misma composición (decisión 8.6); null si no lo hay. */
  improvement?: StoredImprovement | null;
  /** Las posiciones con la serie parada más de 90 días, con su último dato (decisión B-78). Sin el campo, ninguna: lo que no se sabe no avisa. */
  seriesParadas?: ReadonlyMap<string, string>;
}

export interface InternalPositionRow {
  assetId: string;
  name: string;
  instrumentType: string;
  assetClass: string;
  currency: string;
  region?: string;
  category?: string;
  weight: number; // fracción normalizada sobre las posiciones con peso
  amount: number | null;
  sri: number | null;
  sriSource: string | null;
  ter: number | null; // fracción
  managementFee: number | null; // fracción
  retroPct: number | null; // porcentaje (1,9 = 1,9 %)
  retroAsOf: string | null;
  /**
   * La retrocesión guardada que no se usa porque supera lo que cobra el fondo (RET-2), con ese tope: los dos en
   * porcentaje. La fila sale sin retrocesión, y los puntos a revisar lo dicen. Null si no es el caso.
   */
  retroDescartada: { pct: number; topePct: number; frenteA: "comisión de gestión" | "gastos corrientes" } | null;
  costEur: number | null;
  retroIncomeEur: number | null;
  return1y: number | null;
  return3y: number | null;
  return5y: number | null;
  return10y: number | null;
  volatility3y: number | null;
  sharpe3y: number | null;
  maxDrawdown5y: number | null;
  /** El método de sus cifras a 3 años, las que esta tabla compara. En un activo mezclado (decisión 110) no es el de todas: ese es `metodoDeLaFicha`. */
  metricsMethod: string | null;
  /** El de todas sus cifras, el que se dice en su línea: «Propia y proveedor» si unas son nuestras y otras del proveedor. */
  metodoDeLaFicha: string | null;
  metricsFrequency: string | null;
  coverageStatus: string;
  qualityFlags: string[];
  updatedAt: string | null;
  holdingsAsOf: string | null;
  /** La cuenta de posiciones del proveedor, solo si no la desmienten los títulos recibidos de su cartera (`cuentaQueCuadra`). */
  holdingsCount: number | null;
  /** El peso de las diez mayores que declara el proveedor, en %, solo si cuadra con las diez primeras líneas recibidas (`diezMayoresComprobadas`). */
  top10Weight: number | null;
  equity: number | null;
  fixedIncome: number | null;
  cash: number | null;
  /** Lo que su reparto no lleva en bolsa, bonos ni liquidez. El oro físico tiene aquí su 100 %, y sin esto su línea diría tres ceros. */
  otherExposure: number | null;
  /** Su ficha no trae mezcla de activos y el servidor la rellena por su clase (`CLASSIFICATION_FALLBACK`): esas cifras no están en la base. */
  exposicionPorSuClase?: boolean;
  /** Un fondo que no declara su reparto, o una posición sin clase (A-203): no hay exposición que escribir, y sus cifras van a null. */
  exposicionSinDato?: boolean;
  inBacktest: Partial<Record<InternalReportWindow, "included" | "extended" | "excluded">>;
  exclusionReason: Partial<Record<InternalReportWindow, string>>;
  /** No está en el catálogo (`not_found_positions`, decisión 85): no se sabe su clase ni su vehículo, y no se escriben «Otros». */
  fueraDelCatalogo?: boolean;
  /** El último dato de su serie, si lleva más de 90 días parada (decisión B-78): sus cifras son de ese día o anteriores. */
  serieParadaDesde?: string;
}

export interface CorrelationPair { a: string; b: string; value: number }
export interface CorrelationSummary {
  ids: string[];
  /** `null` en la casilla que no se puede calcular (una serie plana): no es una correlación 0. */
  matrix: (number | null)[][];
  /** Media de las correlaciones entre pares distintos. */
  average: number | null;
  highest: CorrelationPair[];
  lowest: CorrelationPair[];
}

export interface InternalHorizonModel {
  window: InternalReportWindow;
  correlation: CorrelationSummary | null;
  horizon: PortfolioHorizon;
  /**
   * Por qué esta ventana no da cifras de la cartera, con las palabras de la pantalla (decisión 59); null si las da. Con motivo, lo que sale de
   * la serie va vacío de aquí en adelante, y `horizon` solo se lee para decir qué se mide, las correlaciones y la frontera sin el punto de la cartera.
   */
  motivoSinCifra: string | null;
  /** Lo que mide la simulación es una sola acción, y entonces la cartera es la acción: ni Sharpe ni Sortino (decisión 41, la misma regla que Análisis). */
  sharpeNoAplica: boolean;
  /** El benchmark en las fechas de la serie de la cartera (mismo índice); null donde no tiene dato: no se arrastra. */
  benchmarkValues: Array<number | null> | null;
  /**
   * Hasta dónde se comparan cartera y benchmark. Null: no se comparan. `rentaVariableAlFinal` es lo que pesa la renta variable en el
   * benchmark el último día, que sin reequilibrar ya no es la de su nombre (decisión 86).
   */
  comparison: { first: string; last: string; cut: boolean; rentaVariableAlFinal: number | null } | null;
  calendarYears: CalendarYearReturn[];
  relative: BenchmarkRelativeStats | null;
  tailRisk: TailRisk[];
  /** El peor rendimiento semanal del periodo, o null con menos de 52 semanas. Es lo que se imprime en lugar del VaR al 99 %. */
  worstWeek: number | null;
  sortino: number | null;
  calmar: number | null;
  episodes: DrawdownEpisode[];
  extremes: PeriodExtremes;
  rolling: RollingPoint[];
}

export type ReviewSeverity = "alta" | "media" | "info";
export interface ReviewPoint {
  severity: ReviewSeverity;
  area: string;
  text: string;
}

export interface WeightedBucket {
  key: string;
  label: string;
  weight: number; // fracción
}

export interface InternalReportModel {
  title: string;
  portfolioName: string;
  generatedAt: string;
  benchmarkId: string;
  benchmarkLabel: string;
  /** Las series del benchmark han llegado. Si no, «Cartera de referencia no disponible». */
  benchmarkAvailable: boolean;
  totalCapital: number | null;
  positions: InternalPositionRow[];
  horizons: InternalHorizonModel[];
  horizonErrors: Partial<Record<InternalReportWindow, string>>;
  costs: {
    weightedTer: number | null;
    terCoverage: number; // fracción del peso con TER; una acción cuenta como conocida, a cero
    annualCostEur: number | null;
    missing: number; // fondos y ETF sin TER: lo que hace que la cifra no sea de toda la cartera
    stocks: number; // acciones: en su fila «No aplica», y en la media cuentan como cero
  };
  retro: {
    status: RetroLoadStatus;
    weightedRetroPct: number | null; // media ponderada sobre el peso con dato (porcentaje)
    coverage: number; // fracción del peso con retrocesión; a una acción no le aplica, y no cuenta como dato que falta
    annualIncomeEur: number | null;
    /** Lo que la retrocesión registrada supone sobre TODA la cartera (fracción): la suma de peso × retrocesión. Null si no hay ninguna. */
    sobreLaCartera: number | null;
    /** Hay retrocesiones, pero no de todo el peso al que le aplican: la media y el ingreso no son cifras de toda la cartera. */
    parcial: boolean;
  };
  health: PortfolioHealthResult;
  /** La misma lectura que «Salud y control» en Análisis: el titular, lo que queda fuera y cada fila con su umbral. */
  salud: LecturaDeSalud;
  /** La cartera y su referencia tienen riesgos distintos, con las dos cifras. Null si no pasa del umbral, o si no se conoce alguna de las dos. */
  avisoDeRiesgoDistinto: string | null;
  /** Las filas de esa lectura, y la de calidad de datos, que en pantalla va aparte. */
  medidas: FilaDeControl[];
  concentration: ConcentrationStats | null;
  allocation: {
    byClass: WeightedBucket[];
    byType: WeightedBucket[];
    byCurrency: WeightedBucket[];
    byRegion: WeightedBucket[];
    byCategory: WeightedBucket[];
    /** Cada origen en su fila: un SRI y un SRRI son dos escalas (decisión 79). No cuenta como «Fuera del reparto»: suma toda la cartera. */
    bySri: WeightedBucket[];
    byMetricsMethod: WeightedBucket[];
    underlyingMix: WeightedBucket[];
    underlyingMixCoverage: number | null;
    /** De 0 a 1, de toda la cartera: lo que no declara su reparto (A-203). Va en su propia fila de la mezcla, «Falta el dato». */
    underlyingMixSinReparto: number;
    equitySectors: WeightedBucket[];
    /** Fracción de la cartera sin reparto de activos, que no entra en sectores ni regiones (A-211). La misma que `underlyingMixSinReparto`. */
    equityLookthroughSinReparto: number;
    equitySectorsQuality: string;
    equityRegions: Array<{ key: string; weight_percent: number }>;
    /** % de la RV sin región (núcleo, `unclassified_weight_percent`): el mismo dato que la pantalla. */
    equityRegionsUnclassified: number;
    /** Las filas se han repartido sin Canadá y África, que el dato aún no separa (decisión 7). */
    canadaYAfricaSinSeparar: boolean;
    /** Lo que no entra en estos repartos, con su fila en cada uno (decisión 85). Sectores y regiones van en % de la renta variable: ahí no. */
    fueraDelReparto: FueraDelRepartoEnElPapel;
  };
  lookThrough: BdbPortfolioLookThrough | null;
  overlap: ReportOverlap | null;
  overlapError: string | null;
  highOverlapPairs: Array<{ a: string; b: string; value: number }>;
  /** Pares de fondos con cifra y sin ella, y el más alto de lo medido. Los de una acción no cuentan: ahí no falta nada, no aplica. */
  overlapPairs: { measured: number; unmeasured: number; mayor: { a: string; b: string; value: number } | null };
  feasibility: PortfolioFeasibilityCheck | null;
  reviewPoints: ReviewPoint[];
  dataDiagnostic: BdbPortfolioReport["data_diagnostic"];
  /** Los avisos del informe de cartera que hablan de estas cifras (hallazgo 114). */
  reportWarnings: string[];
  /** Las columnas por posición que siguen en otra divisa: cifras del proveedor, sin convertir. Null: ninguna. */
  cifrasEnOtraDivisa: string | null;
  /** La columna del Sharpe pone en fila cifras de más de un método: no se ordenan entre sí (decisión 79). */
  sharpeDeMetodosDistintos: boolean;
  includeAssetSheets: boolean;
  assetsById: Map<string, BdbAssetDetail>;
  improvement: StoredImprovement | null;
}

const WINDOWS: InternalReportWindow[] = ["3Y", "5Y"];
const METHOD_SHORT_LABELS: Record<string, string> = {
  GEOMETRIC_CAGR: "Calculada sobre serie propia",
  TRAILING_PROVIDER: "Cifra del proveedor",
  nd: "Metodología no declarada"
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * El peso de las diez mayores que declara el proveedor, en %, solo si cuadra con las diez primeras líneas recibidas de su cartera: la regla de
 * la ficha (`diezMayoresQueCuadran`, con su medio punto). Sin líneas no se puede comprobar, y no se escribe, como en la ficha. El proveedor la
 * calcula sin efectivo ni derivados, y las líneas los llevan: PIMCO declara 23,7 % en la base nueva y sus diez primeras suman 151,75. Medido el
 * 06-11-2026 en la base nueva, el interno y la ficha dicen lo mismo en los 761 fondos con cartera; cuadra en 439 de 748.
 *
 * **Y no pasa de 100** (`pasaDeCien`, que deja hasta 100,5 al redondeo): diez posiciones no pesan más que el fondo. La base vieja guarda en 31
 * fondos la suma de sus diez primeras líneas con el nominal de los derivados, que cuadra por construcción: PIMCO 151,8 %, Goldman 114,0 %. En la
 * base nueva no cuadra ninguna por encima de 100.
 */
function diezMayoresComprobadas(declarado: unknown, diezPrimeras: readonly number[] | undefined): number | null {
  const pct = num(declarado);
  if (pct === null || !diezPrimeras || pasaDeCien(pct)) return null;
  return diezMayoresQueCuadran(pct / 100, diezPrimeras.map((peso) => peso / 100)) === undefined ? null : pct;
}

/**
 * Un reparto del papel es de toda la cartera, y lo que no entra lleva su propia fila, la última (decisión 85). Antes se llevaba al 100 % lo que
 * entraba, sin decirlo. Si entra todo, las mismas cifras de siempre.
 */
function bucketsFrom(
  rows: readonly BdbPortfolioAllocationBucket[] | undefined,
  etiquetaDe: (key: string) => string = (key) => key,
  fuera: Pick<FueraDelRepartoEnElPapel, "peso"> = { peso: 0 }
): WeightedBucket[] {
  const total = (rows ?? []).reduce((sum, row) => sum + Math.max(0, row.weight_percent), 0) + fuera.peso;
  if (total <= 0) return [];
  const filas = (rows ?? [])
    .filter((row) => row.weight_percent > 0)
    .map((row) => ({ key: row.key, label: etiquetaDe(row.key), weight: row.weight_percent / total }))
    .sort((a, b) => b.weight - a.weight);
  return fuera.peso > 0 ? [...filas, { key: CLAVE_DE_LO_QUE_NO_ENTRA, label: FUERA_DEL_REPARTO, weight: fuera.peso / total }] : filas;
}

/**
 * El nombre de una región en el papel. Las posiciones sin región se juntan bajo `CLAVE_SIN_DATO_DEL_REPARTO`, que es una clave y no un texto:
 * el papel dice «Falta el dato», como la pantalla (`FilasDeReparto` con `claveDeLoQueFalta`). Óscar, 20-11-2026; antes imprimía «N/D».
 */
export const regionDelPapel = (clave: string): string => (clave === CLAVE_SIN_DATO_DEL_REPARTO ? textoDeAusencia("falta") : regionLegible(clave));

/** La divisa de denominación en el papel, con la misma regla que la región (Óscar, 21-11-2026): sin divisa, «Falta el dato»; antes, «N/D». */
export const divisaDelPapel = (clave: string): string => (clave === CLAVE_SIN_DATO_DEL_REPARTO ? textoDeAusencia("falta") : clave);

/**
 * Si una posición aporta más riesgo del que pesa, decidido con las dos cifras tal como se imprimen, con un decimal (Óscar, 20-11-2026): con las
 * de antes de redondear salía en ocre una fila que dice «1,4 % / 1,4 %». Las dos llegan en puntos (de 0 a 100). Sin cifra que imprimir, no.
 */
export function aportaMasRiesgoDelQuePesa(pesoPct: number, riesgoPct: number): boolean {
  const impresa = (pct: number): number | null => {
    const texto = peso(pct / 100);
    return texto === null ? null : Number(texto.replace(/\u00a0%$/, "").replace(/\./g, "").replace(",", ".").replace("\u2212", "-"));
  };
  const elPeso = impresa(pesoPct);
  const elRiesgo = impresa(riesgoPct);
  return elPeso !== null && elRiesgo !== null && elRiesgo > elPeso;
}

/** La clave de la fila de lo que no entra: el papel la deja siempre a la vista, y las frases no la toman por la clase que más pesa. */
export const CLAVE_DE_LO_QUE_NO_ENTRA = "fuera_del_reparto";

/**
 * La mezcla de lo que hay dentro de los fondos, en % de toda la cartera, con su fila de lo que no entra. El reparto es neto de cortos: una clase
 * negativa se enseña, con la barra a cero, si se llega a leer en el decimal que se escribe (decisión A-63); lo que redondea a −0,0 no dice nada.
 */
/** La fila de la mezcla con lo que no declara su reparto (A-203): no se reparte entre las clases, y va antes de lo que queda fuera. */
export const CLAVE_SIN_REPARTO_EN_LA_MEZCLA = "sin_reparto";

export function bucketsDeLaMezcla(
  porcentajes: Readonly<Record<string, number>>,
  etiquetas: Readonly<Record<string, string>>,
  fuera: Pick<FueraDelRepartoEnElPapel, "parteInvertible" | "pesoPct">,
  sinRepartoPct = 0
): WeightedBucket[] {
  const filas = Object.entries(porcentajes)
    .map(([key, value]) => ({ key, label: etiquetas[key] ?? key, weight: (value * fuera.parteInvertible) / 100 }))
    .filter((fila) => fila.weight > 0 || fila.weight <= -0.0005)
    .sort((a, b) => b.weight - a.weight);
  const sinReparto = (sinRepartoPct * fuera.parteInvertible) / 100;
  const conSinReparto = sinReparto >= 0.0005 ? [...filas, { key: CLAVE_SIN_REPARTO_EN_LA_MEZCLA, label: textoDeAusencia("falta"), weight: sinReparto }] : filas;
  return fuera.pesoPct > 0 ? [...conSinReparto, { key: CLAVE_DE_LO_QUE_NO_ENTRA, label: FUERA_DEL_REPARTO, weight: fuera.pesoPct / 100 }] : conSinReparto;
}

/** Cómo se escribe de dónde sale un indicador, en una barra: un código que no se conoce dice su nombre, y sin origen no se le pone. */
function rotuloDelOrigen(fuente: string | null): string {
  return origenDelRiesgo(fuente, readableBackendLabel) ?? "Indicador";
}

/**
 * La barra del indicador de riesgo de una posición (decisión 79): el SRI de un KID y el SRRI de un KIID son dos indicadores con otra escala, y un 6 de
 * uno no es un 6 del otro. La clave ordena: SRI, SRRI, lo que venga de otro origen, los que no tienen y a los que no les aplica.
 */
export function barraDelIndicador(fila: Pick<InternalPositionRow, "instrumentType" | "sri" | "sriSource">): { key: string; label: string } {
  if (!seEnsenaLaMetrica("indicadorDeRiesgo", fila.instrumentType)) return { key: "9-no-aplica", label: "No aplica" };
  if (fila.sri === null) return { key: "8-sin-indicador", label: "Sin indicador" };
  const nivel = Math.round(fila.sri);
  const grupo = fila.sriSource === "SRI_KID" ? 1 : fila.sriSource === "SRRI" ? 2 : 3;
  return { key: `${grupo}-${fila.sriSource ?? ""}-${nivel}`, label: `${rotuloDelOrigen(fila.sriSource)} ${nivel}` };
}

function accumulate(map: Map<string, number>, key: string, weight: number) {
  map.set(key, (map.get(key) ?? 0) + weight);
}

function toBuckets(map: Map<string, number>, labelFor: (key: string) => string): WeightedBucket[] {
  return [...map.entries()]
    .filter(([, weight]) => weight > 0)
    .map(([key, weight]) => ({ key, label: labelFor(key), weight }))
    .sort((a, b) => b.weight - a.weight);
}

/** Puntos de renta variable a partir de los cuales una comparación con la cartera de referencia junta riesgos distintos. Con estos exactos no se avisa. */
export const PUNTOS_DE_RENTA_VARIABLE_PARA_AVISAR = 20;

/** Con dos porcentajes de renta variable, de 0 a 100. El margen es para que un 70,000000001 de la aritmética no cuente como más de 20. */
export function avisoDeRentaVariableDistinta(carteraPct: number | null | undefined, referenciaPct: number | null | undefined): string | null {
  const [cartera, referencia] = [num(carteraPct), num(referenciaPct)];
  if (cartera === null || referencia === null || Math.abs(cartera - referencia) <= PUNTOS_DE_RENTA_VARIABLE_PARA_AVISAR + 1e-9) return null;
  return `La cartera tiene un ${oFalta(peso(cartera / 100))} de renta variable y la referencia, un ${oFalta(peso(referencia / 100))}: estas cifras comparan riesgos distintos.`;
}

/** Cuáles son las alertas que se cuentan, en una frase: la primera con sus palabras y cuántas más hay. Null: ninguna. */
export function cualesSonLasAlertas({ alertas, filas }: Pick<LecturaDeSalud, "alertas" | "filas">): string | null {
  const todas = [...alertas.map((alerta) => alerta.texto.replace(/\.$/, "")), ...filas.filter((fila) => fila.cuentaEnElTitular).map((fila) => `${fila.rotulo}: ${fila.cifra}`)];
  if (!todas.length) return null;
  return todas.length === 1 ? todas[0] : `${todas[0]}; y ${todas.length - 1} más, en los puntos a revisar`;
}

function benchmarkLabelFor(id: string): string {
  return benchmarkById(id)?.name ?? id;
}

/** Modelo completo del informe interno. */
export function buildInternalReportModel(
  input: InternalReportInput,
  labels: {
    classLabels: Record<string, string>;
    typeLabels: Record<string, string>;
    sectorLabels: Record<string, string>;
    metricsMethodLabel: (method: string | undefined) => string;
  }
): InternalReportModel {
  const { report, assets } = input;
  const assetsById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const activePositions = input.positions.filter((p) => Number.isFinite(p.weight_percent) && p.weight_percent > 0);
  const weightTotal = activePositions.reduce((sum, p) => sum + p.weight_percent, 0);
  const capital = num(input.totalCapital) !== null && (input.totalCapital ?? 0) > 0 ? input.totalCapital! : null;
  const costs = calculatePortfolioCosts(activePositions, assets, capital ?? 0);
  const costById = new Map(costs.rows.map((row) => [row.assetId, row]));
  const reportById = new Map(report.positions.map((p) => [p.asset_id, p]));

  /* El benchmark se calcula con las series de sus dos fondos y se compara en las MISMAS fechas que la cartera: arrastrar
     su último dato hacía comparar semanas de viernes con semanas de lunes (beta 0,25 en una cartera que se mueve con él).
     Se mezcla una vez por ventana, desde su primer día (decisión 39): con pesos fijados, la de 5 años cortada no sirve a 3. */
  const perfilDelBenchmark = perfilCalculable(input.benchmarkId, input.referencia);
  const horizons: InternalHorizonModel[] = [];
  for (const window of WINDOWS) {
    const horizon = input.horizons[window];
    if (!horizon) continue;
    const { backtest } = horizon;
    const motivoSinCifra = motivoSinCifraDeCartera(horizon, fueraDeLaMedida(horizon, activePositions, assets), { dondeSeDetallan: "detalladas en la sección 10" });
    /* Por debajo del 80 % del peso, la serie es de una parte: nada de lo que se calcula con ella llega al papel como si fuera de la cartera. */
    const series = motivoSinCifra ? [] : backtest.portfolio_series;
    const dates = series.map((point) => point.date);
    const comparison = !motivoSinCifra && perfilDelBenchmark && input.referencia ? compararEnMismasFechas(dates, series.map((point) => point.value), perfilDelBenchmark.weights, input.referencia) : null;
    /* Sin solape suficiente no se compara: ni línea, ni años, ni medidas relativas. */
    const benchmarkValues = comparison ? comparison.referenciaEnLaSerie : null;
    horizons.push({
      window,
      correlation: correlationSummary(backtest.asset_ids, backtest.correlation_matrix),
      horizon,
      motivoSinCifra,
      sharpeNoAplica: esUnaSolaAccion(backtest.asset_ids, assets),
      benchmarkValues,
      comparison: comparison ? { first: comparison.primeraComun, last: comparison.ultimaComun, cut: comparison.cortadaAlFinal, rentaVariableAlFinal: comparison.rentaVariableAlFinal } : null,
      calendarYears: calendarYearReturns(series, benchmarkValues),
      // La rentabilidad de la cartera del bloque relativo es el CAGR del backtest cuando la
      // ventana común con el benchmark es la misma (ALTA-14): una cifra, una definición.
      relative: motivoSinCifra ? null : benchmarkRelativeStats(series, benchmarkValues, backtest.metrics.rf_rate, { portfolioCagr: backtest.metrics.cagr }),
      tailRisk: historicalTailRisk(series),
      worstWeek: worstWeeklyReturn(series),
      sortino: motivoSinCifra ? null : sortinoRatio(series, backtest.metrics.cagr, backtest.metrics.rf_rate),
      calmar: motivoSinCifra ? null : calmarRatio(backtest.metrics.cagr, backtest.metrics.max_drawdown),
      episodes: drawdownEpisodes(series),
      extremes: periodExtremes(series),
      rolling: rollingStats(series)
    });
  }

  const sinFicha = new Set(posicionesFueraDelCatalogo(input.report.summary).map((posicion) => posicion.asset_id));
  /* Los títulos recibidos de cada fondo, de su composición subyacente y del solapamiento, que leen la misma cartera: la cuenta del
     proveedor solo se escribe si no la desmienten (`cuentaQueCuadra`). Sin ellos, se escribe la suya. */
  const titulosRecibidos = new Map<string, number>();
  const anotarTitulos = (assetId: string, titulos: number | undefined) => {
    if (typeof titulos === "number") titulosRecibidos.set(assetId, Math.max(titulosRecibidos.get(assetId) ?? 0, titulos));
  };
  for (const fondo of input.lookThrough?.fund_portfolios ?? []) anotarTitulos(fondo.asset_id, fondo.security_lines);
  for (const posicion of input.overlap?.positions ?? []) anotarTitulos(posicion.asset_id, posicion.published?.titulos);
  /* Y sus diez primeras líneas, del solapamiento, que es quien guarda lo recibido de cada fondo: con ellas se comprueba el peso de las diez
     mayores que declara el proveedor (`diezMayoresComprobadas`). */
  const diezPrimeras = new Map<string, readonly number[]>();
  for (const posicion of input.overlap?.positions ?? []) if (posicion.published) diezPrimeras.set(posicion.asset_id, posicion.published.diezPrimeras);
  const positions: InternalPositionRow[] = activePositions
    .map((position) => {
      const asset = assetsById.get(position.asset_id);
      const reportPosition = reportById.get(position.asset_id);
      const cost = costById.get(position.asset_id);
      const guardada = resolveEffectiveCommercialRetro(position.asset_id, input.retro.records);
      /* RET-2: una retrocesión mayor que lo que cobra el fondo no es un porcentaje del patrimonio, y no se usa. */
      const topeDeRetro = topeDeLaRetrocesion(cost?.mgmtPct, cost?.ongoingPct);
      const retro = guardada && retrocesionCreible(guardada.rate, topeDeRetro?.tope ?? null) ? guardada : null;
      const retroDescartada = guardada && !retro && topeDeRetro ? { pct: guardada.pct, topePct: topeDeRetro.tope * 100, frenteA: topeDeRetro.frenteA } : null;
      const metrics = asset?.metrics;
      const weight = weightTotal > 0 ? position.weight_percent / weightTotal : 0;
      const amount = capital !== null ? weight * capital : null;
      const inBacktest: InternalPositionRow["inBacktest"] = {};
      const exclusionReason: InternalPositionRow["exclusionReason"] = {};
      for (const h of horizons) {
        const { backtest, extensions } = h.horizon;
        if (backtest.asset_ids.includes(position.asset_id)) {
          inBacktest[h.window] = extensions.some((e) => e.assetId === position.asset_id) ? "extended" : "included";
        } else {
          inBacktest[h.window] = "excluded";
          const reason = backtest.excluded_assets.find((e) => e.asset_id === position.asset_id)?.reason;
          exclusionReason[h.window] = reason ? backtestExclusionLabel(reason) : "Fuera del histórico común";
        }
      }
      const qualityFlags = [...new Set([...(asset?.quality_flags ?? []), ...(reportPosition?.quality_flags ?? [])])];
      const instrumentType = asset?.instrument_type ?? reportPosition?.instrument_type ?? "UNKNOWN";
      /* El indicador de riesgo es de quien tiene KID o KIID: a una acción no le aplica, aunque la base vieja le traiga un nivel estimado (decisión 83). */
      const conIndicador = seEnsenaLaMetrica("indicadorDeRiesgo", instrumentType);
      const exposure = asset?.pms_exposure;
      const sinReparto = Boolean(exposure) && assetPmsShares({ pms_exposure: exposure, economic_asset_class: asset?.economic_asset_class }).source === "sin_reparto";
      return {
        assetId: position.asset_id,
        name: asset?.display_name ?? reportPosition?.display_name ?? position.label ?? position.asset_id,
        instrumentType,
        assetClass: asset?.economic_asset_class ?? reportPosition?.economic_asset_class ?? "UNKNOWN",
        currency: asset?.currency ?? reportPosition?.currency ?? "",
        region: asset?.region ?? reportPosition?.region,
        category: categoriaLegible(asset?.category ?? reportPosition?.category),
        weight,
        amount,
        sri: conIndicador ? num(metrics?.risk_score) : null,
        sriSource: conIndicador ? metrics?.risk_score_source ?? null : null,
        ter: cost?.ongoingPct ?? null,
        managementFee: cost?.mgmtPct ?? null,
        retroPct: retro?.pct ?? null,
        retroAsOf: retro?.record.as_of_date ?? null,
        retroDescartada,
        costEur: cost?.costEur ?? null,
        retroIncomeEur: retro && amount !== null ? amount * retro.rate : null,
        return1y: num(metrics?.annualized_return_1y),
        return3y: num(metrics?.annualized_return_3y),
        return5y: num(metrics?.annualized_return_5y),
        return10y: num(metrics?.annualized_return_10y),
        volatility3y: num(metrics?.volatility_3y),
        sharpe3y: num(metrics?.sharpe_3y),
        maxDrawdown5y: num(metrics?.max_drawdown_5y),
        metricsMethod: rotuloDeLaVentana(metrics, "3y").method ?? metrics?.metrics_method ?? null,
        metodoDeLaFicha: metrics?.metrics_method ?? null,
        metricsFrequency: metrics?.metrics_frequency ?? null,
        coverageStatus: asset?.coverage_status ?? reportPosition?.coverage_status ?? "MISSING",
        qualityFlags,
        updatedAt: asset?.updated_at ?? null,
        holdingsAsOf: asset?.holdings_summary?.as_of_date ?? null,
        holdingsCount: cuentaQueCuadra(asset?.holdings_summary?.positions_count, titulosRecibidos.get(position.asset_id)) ?? null,
        top10Weight: diezMayoresComprobadas(asset?.holdings_summary?.top10_weight, diezPrimeras.get(position.asset_id)),
        /* A-203: sin reparto declarado, las tres cifras no son ceros: faltan. */
        equity: sinReparto ? null : num(exposure?.equity),
        fixedIncome: sinReparto ? null : num(exposure?.fixed_income),
        cash: sinReparto ? null : num(exposure?.cash),
        otherExposure: exposure && !sinReparto ? (num(exposure.other) ?? 0) + (num(exposure.alternative) ?? 0) + (num(exposure.real_asset) ?? 0) : null,
        exposicionPorSuClase: exposure?.source === "CLASSIFICATION_FALLBACK",
        exposicionSinDato: sinReparto,
        inBacktest,
        exclusionReason,
        fueraDelCatalogo: sinFicha.has(position.asset_id),
        serieParadaDesde: input.seriesParadas?.get(position.asset_id)
      } satisfies InternalPositionRow;
    })
    .sort((a, b) => b.weight - a.weight);

  // Retrocesiones y TER: media ponderada solo sobre el peso con dato y la cobertura
  // aparte, con la definición única de `summarizeCoveredRate` (la de costes y salud).
  /* Una acción no tiene retrocesión: por su tipo, nunca por su nombre. La media y el ingreso no cambian: solo deja de contar como un dato que falta. */
  const retroSummary = summarizeCoveredRate(positions.filter((p) => !esAccion(p.instrumentType) || p.retroPct !== null).map((p) => ({ amount: p.weight, rate: p.retroPct })));
  const retroCoverage = retroSummary.coverageRatio;
  const weightedRetroPct = retroSummary.weightedAverage;
  const retroCovered = positions.filter((p) => p.retroPct !== null);
  const annualIncomeEur = capital !== null && retroCovered.length > 0
    ? retroCovered.reduce((sum, p) => sum + (p.retroIncomeEur ?? 0), 0)
    : null;

  /* Una cifra, una definición: la media cuenta las acciones a cero, como la pantalla y el informe de costes. Antes salía
     un 1,00 % con 700 € al año sobre 100.000 €, que no casan, porque la acción se quedaba fuera de la media y de los euros no. */
  const terSummary = summarizeCoveredRate(positions.map((p) => ({ amount: p.weight, rate: esAccion(p.instrumentType) ? 0 : p.ter })));
  const terCoverage = terSummary.coverageRatio;
  const weightedTer = terSummary.weightedAverage;

  /* La aportación al riesgo se lee como en Análisis (decisión A-132): viaja en la frontera o, con más activos medidos que el tope de la
     frontera, aparte y con el mismo estimador. Leída solo de la frontera, por encima de 40 el informe no la tenía y la pantalla sí. */
  const riskContributions = aportacionAlRiesgo(input.horizons["3Y"]) ?? aportacionAlRiesgo(input.horizons["5Y"]) ?? null;
  /* Las reglas miden el riesgo como el resto del informe: con la serie de la cartera, a 3 años si la hay. */
  const horizonteDeLasReglas = input.horizons["3Y"] ?? input.horizons["5Y"] ?? null;
  const medido = riesgoMedidoDe(horizonteDeLasReglas);
  const health = evaluatePortfolioHealth({
    positions: activePositions,
    assets,
    riskContributions,
    riesgoMedido: Boolean(medido)
  });
  const salud = leerSaludYControl({
    positions: activePositions,
    assets,
    feasibility: input.feasibility ?? null,
    salud: health,
    horizonte: horizonteDeLasReglas,
    midiendo: false,
    medicionFallida: !input.sinSerie && Boolean(input.horizonErrors?.["3Y"] && input.horizonErrors?.["5Y"]),
    sinSerie: input.sinSerie
  });
  const concentration = concentrationStats(activePositions.map((p) => p.weight_percent));

  const sri = new Map<string, number>();
  const rotulosDelIndicador = new Map<string, string>();
  const method = new Map<string, number>();
  for (const p of positions) {
    const barra = barraDelIndicador(p);
    accumulate(sri, barra.key, p.weight);
    rotulosDelIndicador.set(barra.key, barra.label);
    /* La barra habla de todas sus métricas, como la hoja de calidad y el anexo: el de sus 3 años es solo el de la regla del Sharpe (decisión 110). */
    accumulate(method, p.metodoDeLaFicha ?? p.metricsMethod ?? "nd", p.weight);
  }
  // Exposición subyacente: el cálculo canónico de `computePmsExposureDistribution`
  // (el del Resumen y el PDF de cartera). Un activo sin vector cuenta por su clase
  // económica en vez de desaparecer; la cobertura sigue siendo la del vector real.
  const MIX_LABELS: Record<string, string> = {
    equity: "Renta variable", fixed_income: "Renta fija", cash: "Liquidez", alternative: "Alternativos",
    real_asset: "Activos reales", other: "Otros"
  };
  /* Lo que no entra no se reparte entre los demás, ni aquí se cuenta por su clase: va en su propia fila (decisión 85). La misma cifra que la pantalla. */
  const fueraDelReparto = fueraDelRepartoDelInforme(report);
  const idsFuera = new Set(fueraDelReparto.posiciones.map((posicion) => posicion.assetId));
  const mixDistribution = computePmsExposureDistribution(positions.filter((p) => !idsFuera.has(p.assetId)).map((p) => ({
    weight_percent: p.weight * 100,
    pms_exposure: assetsById.get(p.assetId)?.pms_exposure,
    economic_asset_class: p.assetClass
  })));
  const mixBuckets = mixDistribution ? bucketsDeLaMezcla(mixDistribution.percent, MIX_LABELS, fueraDelReparto, mixDistribution.sin_reparto_weight_percent) : [];
  /* A-203: lo que no tiene reparto, en % de la cartera, para decirlo junto a la cobertura. */
  const mixSinReparto = mixDistribution ? (mixDistribution.sin_reparto_weight_percent / 100) * fueraDelReparto.parteInvertible : 0;
  const mixCovered = mixDistribution ? (mixDistribution.covered_weight_percent / 100) * fueraDelReparto.parteInvertible : 0;
  /* A-211: el fondo sin reparto de activos no entra, como en pantalla; su peso lo dice `equityLookthroughSinReparto`. */
  const sectors = computeEquitySectorAllocation(activePositions, assets);
  /* Regiones con la misma función que la pantalla (RegionAllocation). Las filas
     siguen llegando por `input.regionRows` (los llamadores pasan
     las filas de computeEquityRegionAllocation sobre estas posiciones); lo sin clasificar sale de
     aquí y no de «100 − suma», que no coincidía con la pantalla porque esta
     descarta las filas por debajo de 0,05 % (revisión 14-10, ronda 3). */
  const regionAllocation = computeEquityRegionAllocation(activePositions, assets);
  const SECTOR_UNCLASSIFIED = "unclassified";
  const sectorBuckets: WeightedBucket[] = sectors.rows.map((row) => ({ key: row.key, label: labels.sectorLabels[row.key] ?? row.key, weight: row.weight_percent / 100 }));
  // Las barras cierran el 100 % de la RV: lo que no tiene sector se dice, no se omite. Ya no se deduce del nombre (decisión 11).
  if (sectorBuckets.length > 0 && sectors.unclassified_weight_percent > 0) {
    sectorBuckets.push({ key: SECTOR_UNCLASSIFIED, label: "No declarado", weight: sectors.unclassified_weight_percent / 100 });
  }

  const highOverlapPairs: Array<{ a: string; b: string; value: number }> = [];
  const overlapPairs: InternalReportModel["overlapPairs"] = { measured: 0, unmeasured: 0, mayor: null };
  if (input.overlap) {
    const { positions: overlapPositions, values } = input.overlap;
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const value = values[i][j];
        if (value !== null && value >= 40) highOverlapPairs.push({ a: overlapPositions[i].display_name, b: overlapPositions[j].display_name, value });
        if (value !== null) overlapPairs.measured += 1;
        else if (!casillaNoAplica(input.overlap, i, j)) overlapPairs.unmeasured += 1;
        if (value !== null && value > (overlapPairs.mayor?.value ?? 0)) overlapPairs.mayor = { a: overlapPositions[i].display_name, b: overlapPositions[j].display_name, value };
      }
    }
    highOverlapPairs.sort((a, b) => b.value - a.value);
  }

  /* Se mira dentro de los fondos y sobre lo que entra en el reparto, con la mezcla de la hoja 3. Sin ningún vector, por la clase, no se conoce. */
  /* A-203: la renta variable de lo que tiene reparto. Lo que no lo tiene no se cuenta como cero, que la rebajaría. */
  const conReparto = mixDistribution ? 100 - mixDistribution.sin_reparto_weight_percent : 0;
  const rentaVariableDeLaCartera = mixDistribution && mixDistribution.covered_weight_percent > 0 && conReparto > 0 ? (mixDistribution.percent.equity / conReparto) * 100 : null;
  /* Sin ninguna ventana comparada no hay cifras de las que avisar. */
  const avisoDeRiesgoDistinto = perfilDelBenchmark && horizons.some((h) => h.comparison) ? avisoDeRentaVariableDistinta(rentaVariableDeLaCartera, perfilDelBenchmark.weights.rv * 100) : null;
  const reviewPoints = buildReviewPoints({
    positions, horizons, horizonErrors: input.horizonErrors ?? {}, health, concentration, seriesParadas: input.seriesParadas ?? new Map<string, string>(),
    retroStatus: input.retro.status, retroCoverage, terCoverage, highOverlapPairs, overlapPairs, report,
    benchmarkAvailable: perfilDelBenchmark !== null, avisoDeRiesgoDistinto,
    filasConAlerta: salud.filas.filter((fila) => fila.cuentaEnElTitular), restriccionesBloqueadas: input.feasibility?.status === "BLOCKED"
  });

  return {
    title: "Informe interno del asesor",
    portfolioName: report.portfolio_name || "Cartera sin nombre",
    generatedAt: input.generatedAt,
    benchmarkId: input.benchmarkId,
    benchmarkLabel: benchmarkLabelFor(input.benchmarkId),
    benchmarkAvailable: perfilDelBenchmark !== null,
    totalCapital: capital,
    positions,
    horizons,
    horizonErrors: input.horizonErrors ?? {},
    costs: {
      weightedTer,
      terCoverage,
      annualCostEur: costs.totalCostEur,
      missing: positions.filter((p) => !esAccion(p.instrumentType) && p.ter === null).length,
      stocks: positions.filter((p) => esAccion(p.instrumentType)).length
    },
    retro: {
      status: input.retro.status, weightedRetroPct, coverage: retroCoverage, annualIncomeEur,
      sobreLaCartera: retroCovered.length > 0 ? retroCovered.reduce((sum, p) => sum + p.weight * (p.retroPct ?? 0) / 100, 0) : null,
      parcial: input.retro.status === "ok" && retroCovered.length > 0 && retroCoverage < 0.9995
    },
    health,
    salud,
    avisoDeRiesgoDistinto,
    medidas: medidasDelInforme(salud, horizonteDeLasReglas?.coverageWeightPercent ?? null),
    concentration,
    allocation: {
      byClass: bucketsFrom(report.xray.by_economic_asset_class ?? report.summary.by_economic_asset_class, (key) => labels.classLabels[key] ?? key, fueraDelReparto),
      byType: bucketsFrom(report.xray.by_instrument_type ?? report.summary.by_instrument_type, (key) => labels.typeLabels[key] ?? key, fueraDelReparto),
      byCurrency: bucketsFrom(report.xray.by_currency, divisaDelPapel, fueraDelReparto),
      byRegion: bucketsFrom(report.xray.by_region, regionDelPapel, fueraDelReparto),
      byCategory: bucketsFrom(filasPorCategoria(report), (key) => categoriaLegible(key) ?? key, fueraDelReparto),
      bySri: toBuckets(sri, (key) => rotulosDelIndicador.get(key) ?? key).sort((a, b) => a.key.localeCompare(b.key)),
      /* Los métodos de la base nueva no tienen nombre corto: el suyo, con mayúscula como los demás de la lista. */
      byMetricsMethod: toBuckets(method, (key) => METHOD_SHORT_LABELS[key] ?? labels.metricsMethodLabel(key).replace(/^./, (letra) => letra.toLocaleUpperCase("es"))),
      underlyingMix: mixBuckets,
      underlyingMixCoverage: mixDistribution ? mixCovered : null,
      underlyingMixSinReparto: mixSinReparto,
      equitySectors: sectorBuckets,
      equityLookthroughSinReparto: mixSinReparto,
      equitySectorsQuality: sectors.quality,
      equityRegions: input.regionRows ?? regionAllocation.rows,
      equityRegionsUnclassified: regionAllocation.unclassified_weight_percent,
      canadaYAfricaSinSeparar: regionAllocation.canadaYAfricaSinSeparar === true,
      fueraDelReparto
    },
    lookThrough: input.lookThrough ?? null,
    overlap: input.overlap ?? null,
    overlapError: input.overlapError ?? null,
    highOverlapPairs,
    overlapPairs,
    feasibility: input.feasibility ?? null,
    reviewPoints,
    dataDiagnostic: report.data_diagnostic,
    reportWarnings: avisosDeEstasCifras(report.warnings ?? []),
    cifrasEnOtraDivisa: avisoDeDivisas(cifrasDelProveedorEnOtraDivisa(activePositions, assets)),
    /* Solo de las cifras que la columna imprime: a una acción no se le enseña el Sharpe, y su método no se mezcla con nada. */
    sharpeDeMetodosDistintos: new Set(positions.filter((p) => !esAccion(p.instrumentType) && p.sharpe3y !== null).map((p) => p.metricsMethod ?? "nd")).size > 1,
    includeAssetSheets: input.includeAssetSheets,
    improvement: input.improvement ?? null,
    assetsById
  };
}

/**
 * La calidad de los datos cuenta lo que el dato deja fuera del cálculo, con su nombre y su motivo. Un «A» encima de un 12 % fuera era la
 * contradicción que la decisión 18 quita. `pesoMedidoPct` null: sin simulación no se sabe qué se queda fuera, y se dice.
 */
export function filaDeCalidadDeDatos(fuera: readonly FueraDeLaMedida[], pesoMedidoPct: number | null): FilaDeControl {
  const rotulo = "Calidad de datos";
  if (pesoMedidoPct === null) return { rotulo, ausencia: "falta", nota: "Sin simulación no se sabe qué deja fuera el dato.", revisar: false };
  const pesoFuera = Math.max(0, 100 - pesoMedidoPct);
  return {
    rotulo,
    cifra: `${pesoLegible(pesoFuera)} fuera`,
    nota: fuera.length > 0
      ? fuera.map((item) => `${nombreConPeso(item)}: ${item.motivo}`).join("; ")
      : "Ninguna posición se queda fuera del análisis por el dato.",
    revisar: false
  };
}

/** Las filas de la lectura de Análisis, con la de calidad justo detrás de la del peso medido. */
function medidasDelInforme(salud: LecturaDeSalud, pesoMedidoPct: number | null): FilaDeControl[] {
  return salud.filas.flatMap((fila) => (fila.rotulo === "Peso medido" ? [fila, filaDeCalidadDeDatos(salud.fuera, pesoMedidoPct)] : [fila]));
}

/** De dónde sale la frecuencia de las métricas de una posición, en palabras. Códigos medidos en las dos bases el 05-11-2026. */
const ORIGEN_POR_FRECUENCIA: Record<string, string> = {
  PROVIDER: "Cifra del proveedor",
  WEEKLY: "Serie semanal propia",
  DAILY: "Serie diaria propia",
  MONTHLY: "Serie mensual propia"
};

/** Sin frecuencia, nada. Una que no se conozca dice su nombre, sin inventar de dónde sale. */
export function origenDeLasMetricas(frecuencia: string | null | undefined, legible: (codigo: string) => string): string | null {
  if (!frecuencia) return null;
  return ORIGEN_POR_FRECUENCIA[frecuencia.toUpperCase()] ?? `Frecuencia ${legible(frecuencia).toLowerCase()}`;
}

/**
 * De dónde sale el indicador de riesgo de una posición, con las palabras de la ficha. No todos son el SRI de un KID: `SRRI` es el indicador
 * antiguo que publica el fondo, y `VOL_BUCKET` es justo lo contrario de un dato publicado, una estimación por tramos de volatilidad
 * (`functions_python/fund_ingest.py`, `readmodel/mappers.py`). Códigos medidos en las dos bases el 05-11-2026.
 */
const ORIGEN_DEL_RIESGO: Record<string, string> = {
  SRI_KID: "SRI del KID",
  SRRI: "SRRI",
  VOL_BUCKET: "Estimado por volatilidad"
};

export function origenDelRiesgo(fuente: string | null | undefined, legible: (codigo: string) => string): string | null {
  if (!fuente) return null;
  return ORIGEN_DEL_RIESGO[fuente] ?? legible(fuente);
}

export { versionDeLaReferencia } from "./parteMedida";

/** El tope por posición que ha aplicado el motor, tal como lo devuelve: depende del número de activos. Si no lo trae, null; no se supone. */
export function topeDelModelo(horizon: Pick<PortfolioHorizon, "frontier">): number | null {
  const tope = horizon.frontier?.methodologyV2?.weightBounds?.[1];
  return typeof tope === "number" && Number.isFinite(tope) ? tope : null;
}

/**
 * El tope por posición, en palabras. `superado`: alguna posición lo pasa, y eso solo lo hace un candado. Con el tope que pone el modelo por defecto
 * —el que depende del número de activos— un candado es una decisión del asesor y puede quedar por encima (`robust_engine.solve`, `lock_cap`); con
 * un tope que fija el asesor, no. Óscar, 20-11-2026: la nota no puede decir «tope del X % por posición» de una cartera que lleva una por encima.
 */
export const topeEscrito = (tope: number | null, superado = false) =>
  tope === null
    ? "tope por posición no informado"
    : `tope del ${oFalta(peso(tope))} por posición${superado ? ", que una posición con candado puede superar" : ""}`;

type FronteraConPesos = Pick<FrontierViewModel, "maxSharpe" | "minVolatility"> & Partial<Pick<FrontierViewModel, "target" | "targetReturn" | "methodologyV2">>;

/**
 * Si el modelo lleva una posición con candado por encima del tope. Se reconoce en los pesos: un candado fija el mismo peso en todas las carteras del
 * modelo (`bounds = (locked, locked)`), así que es una posición que pasa del tope en Máximo Sharpe y pesa lo mismo en las demás. Con medio punto
 * básico de holgura, por el redondeo de los pesos. Sin pesos completos no se afirma.
 */
export function hayCandadoPorEncimaDelTope(frontier: FronteraConPesos | null | undefined): boolean {
  const tope = frontier?.methodologyV2?.weightBounds?.[1];
  const pesos = frontier?.maxSharpe?.pesosCompletos;
  if (typeof tope !== "number" || !Number.isFinite(tope) || !pesos) return false;
  const otras = [frontier?.minVolatility, frontier?.target, frontier?.targetReturn].flatMap((punto) => (punto?.pesosCompletos ? [punto.pesosCompletos] : []));
  return Object.entries(pesos).some(([id, w]) => w > tope + 0.00005 && otras.every((otra) => Math.abs((otra[id] ?? 0) - w) <= 0.00005));
}

/**
 * Si el modelo regulariza también las rentabilidades. Con tres activos o menos no: `estimate_returns` (robust_engine.py) solo las encoge hacia la
 * media con más de tres (`N > 3`), y entonces solo se regulariza la covarianza. Los activos del cálculo son los de los pesos completos, ceros
 * incluidos. Sin pesos completos no se sabe, y no se afirma: `null`.
 */
export function regularizaLasRentabilidades(frontier: Pick<FrontierViewModel, "maxSharpe"> | null | undefined): boolean | null {
  const pesos = frontier?.maxSharpe?.pesosCompletos;
  if (!pesos) return null;
  return Object.keys(pesos).length > 3;
}

/** Lo que regulariza el modelo para Máximo Sharpe, dicho solo donde es verdad. */
export function queRegularizaElMaximoSharpe(frontier: Pick<FrontierViewModel, "maxSharpe"> | null | undefined): string {
  const conRentabilidades = regularizaLasRentabilidades(frontier);
  if (conRentabilidades === false) return "covarianza regularizada (con tres activos o menos, las rentabilidades no se regularizan)";
  if (conRentabilidades === true) return "rentabilidades y covarianza regularizadas";
  return "covarianza regularizada";
}

/**
 * La nota del Máximo Sharpe (hallazgo 43). Se elige con un modelo que regulariza rentabilidades y covarianza y se mide luego con la serie
 * real, así que puede quedar por debajo de la cartera actual; que pase o no en esta cartera lo dice el dato, ventana a ventana. Con la
 * muestra pasa a 3 años y no a 5.
 */
export function notaDelMaximoSharpe(horizontes: readonly Pick<InternalHorizonModel, "horizon">[]): string {
  const conMaximo = horizontes.filter(({ horizon }) => horizon.maxSharpe);
  const topeDe = ({ horizon }: Pick<InternalHorizonModel, "horizon">) => topeEscrito(topeDelModelo(horizon), hayCandadoPorEncimaDelTope(horizon.frontier));
  const topes = [...new Set(conMaximo.map(topeDe))];
  const tope = topes.length <= 1
    ? (topes[0] ?? topeEscrito(null))
    : conMaximo.map((h) => `${topeDe(h)} a ${h.horizon.years} años`).join(" y ");
  /* Lo que se regulariza, como el tope: si las ventanas dicen lo mismo, una vez; si no, cada una lo suyo. */
  const regulariza = [...new Set(conMaximo.map(({ horizon }) => queRegularizaElMaximoSharpe(horizon.frontier)))];
  const queRegulariza = regulariza.length <= 1
    ? (regulariza[0] ?? queRegularizaElMaximoSharpe(null))
    : conMaximo.map(({ horizon }) => `${queRegularizaElMaximoSharpe(horizon.frontier)} a ${horizon.years} años`).join(" y ");
  const pordebajo = conMaximo
    /* Un Sharpe vacío (volatilidad cero) no se compara: no está ni por encima ni por debajo. */
    .filter(({ horizon }) => {
      const maximo = horizon.maxSharpe!.metrics.sharpe;
      const actual = horizon.backtest.metrics.sharpe;
      return maximo !== null && actual !== null && maximo < actual;
    })
    .map(({ horizon }) => `a ${horizon.years} años, ${oFalta(ratio(horizon.maxSharpe!.metrics.sharpe))} frente a ${oFalta(ratio(horizon.backtest.metrics.sharpe))}`);
  return `Máximo Sharpe del modelo: ${queRegulariza}, ${tope}. Medida luego con la serie real puede quedar por debajo de la cartera actual${pordebajo.length ? `: aquí, ${pordebajo.join("; ")}` : ""}.`;
}

/**
 * Lo que mide una cifra titular, en una línea (hallazgo 114): de qué parte de la cartera es, qué se ha quedado fuera y con qué pesos.
 * Sale del dato, comprobado en `functions_python/portfolio_horizon.py`: `_backtest` fija los pesos el primer día de la ventana y no
 * reequilibra, y la serie va en la divisa base. Si las ventanas miden lo mismo se dice una vez; si no, cada una lo suyo.
 */
export function loQueMide(
  horizontes: readonly PortfolioHorizon[],
  positions: readonly BdbManualPortfolioPosition[],
  assets: readonly BdbAssetDetail[]
): string | null {
  if (!horizontes.length) return null;
  const moneda = horizontes[0].backtest.base_currency === "EUR" ? "euros" : horizontes[0].backtest.base_currency;
  const coberturas = horizontes.map((h) => {
    const { asset_ids: dentro, excluded_assets: excluidos, coverage } = h.backtest;
    const total = coverage?.requested_assets ?? dentro.length + (excluidos?.length ?? 0);
    const fuera = fueraDeLaMedida(h, positions, assets).map((item) => `${item.nombre} (${item.pesoPct === null ? "" : `${pesoLegible(item.pesoPct)}, `}${item.motivo})`);
    return [`${dentro.length} de ${total} ${total === 1 ? "posición" : "posiciones"}, ${pesoLegible(h.coverageWeightPercent)} del peso`, fuera.length ? `fuera: ${fuera.join("; ")}` : null].filter(Boolean).join(" · ");
  });
  const cobertura = coberturas.every((texto) => texto === coberturas[0])
    ? coberturas[0]
    : horizontes.map((h, i) => `a ${h.years} años, ${coberturas[i]}`).join("; ");
  const fijados = horizontes
    .filter((h) => h.backtest.coverage?.first_date)
    .map((h) => (horizontes.length > 1 ? `el ${oFalta(fecha(h.backtest.coverage!.first_date!))} a ${h.years} años` : `el ${oFalta(fecha(h.backtest.coverage!.first_date!))}`))
    .join(" y ");
  const ampliado = horizontes.some((h) => h.extensions.length > 0) ? " · en parte estimada con referencias" : "";
  return `Simulación en ${moneda} · ${cobertura} · ${fijados ? `pesos fijados ${fijados}` : "pesos de hoy"}, sin reequilibrar${ampliado}`;
}

/**
 * «Metricas parciales» y «Mezcla de divisas» son de la estimación por composición, que no da ninguna cifra de este informe: las de cartera
 * salen de la serie, en euros. Lo que sí queda sin convertir son las cifras del proveedor de la tabla de posiciones, y allí se dice.
 */
export function avisosDeEstasCifras(avisos: readonly string[]): string[] {
  return avisos.filter((aviso) => !aviso.startsWith("Metricas parciales") && !aviso.startsWith("Mezcla de divisas"));
}

/** Una fila de la tabla de años naturales: lo de cada ventana, si ese año cae en ella. */
export interface FilaDeAnioNatural {
  year: number;
  porVentana: Partial<Record<InternalReportWindow, CalendarYearReturn>>;
}

export function filasDeAniosNaturales(horizontes: readonly Pick<InternalHorizonModel, "window" | "calendarYears">[]): FilaDeAnioNatural[] {
  const filas = new Map<number, FilaDeAnioNatural>();
  for (const { window, calendarYears } of horizontes) {
    for (const anio of calendarYears) {
      const fila = filas.get(anio.year) ?? { year: anio.year, porVentana: {} };
      fila.porVentana[window] = anio;
      filas.set(anio.year, fila);
    }
  }
  return [...filas.values()].sort((a, b) => a.year - b.year);
}

/**
 * El año completo en las dos ventanas que más difiere entre ellas, para decirlo con cifras del dato: cada ventana fija sus pesos en su primer
 * día, y por eso el mismo año no da lo mismo. Null si no hay ninguno que difiera en lo que se escribe, a un decimal. Lo mismo vale para el
 * benchmark (decisión 39): van sus cifras de ese año, si las tiene en las dos ventanas.
 */
export function anioQueMasDifiere(filas: readonly FilaDeAnioNatural[]): { year: number; a3: number; a5: number; benchmark: { a3: number; a5: number } | null } | null {
  let mayor: { year: number; a3: number; a5: number; benchmark: { a3: number; a5: number } | null } | null = null;
  for (const { year, porVentana } of filas) {
    const a3 = porVentana["3Y"];
    const a5 = porVentana["5Y"];
    if (!a3 || !a5 || a3.partial || a5.partial) continue;
    const distancia = Math.abs(a3.portfolio - a5.portfolio);
    if (distancia >= 0.0005 && (!mayor || distancia > Math.abs(mayor.a3 - mayor.a5))) {
      mayor = { year, a3: a3.portfolio, a5: a5.portfolio, benchmark: a3.benchmark !== null && a5.benchmark !== null ? { a3: a3.benchmark, a5: a5.benchmark } : null };
    }
  }
  return mayor;
}

/** Resumen de la matriz de correlación del backend: media y pares extremos. */
export function correlationSummary(ids: string[], matrix: (number | null)[][] | undefined): CorrelationSummary | null {
  if (!matrix || ids.length < 2 || matrix.length !== ids.length) return null;
  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const value = matrix[i]?.[j];
      if (typeof value === "number" && Number.isFinite(value)) pairs.push({ a: ids[i], b: ids[j], value });
    }
  }
  if (!pairs.length) return null;
  const sorted = [...pairs].sort((x, y) => y.value - x.value);
  const take = Math.min(5, Math.floor(sorted.length / 2) || 1);
  return {
    ids,
    matrix,
    average: pairs.reduce((sum, p) => sum + p.value, 0) / pairs.length,
    highest: sorted.slice(0, take),
    lowest: sorted.slice(-take).reverse()
  };
}

/** Un peso o una parte de la cartera dentro de una frase: del módulo único, con su espacio duro (FMT-16). */
function pctText(value: number, digits = 1): string {
  return oFalta(porcentaje(value, { decimales: digits }));
}

/** Lista de cosas que el asesor debería mirar, de más a menos importante. */
function buildReviewPoints(ctx: {
  positions: InternalPositionRow[];
  horizons: InternalHorizonModel[];
  horizonErrors: Partial<Record<InternalReportWindow, string>>;
  health: PortfolioHealthResult;
  concentration: ConcentrationStats | null;
  retroStatus: RetroLoadStatus;
  retroCoverage: number;
  terCoverage: number;
  highOverlapPairs: Array<{ a: string; b: string; value: number }>;
  overlapPairs: InternalReportModel["overlapPairs"];
  report: BdbPortfolioReport;
  benchmarkAvailable: boolean;
  avisoDeRiesgoDistinto: string | null;
  filasConAlerta: FilaDeControl[];
  restriccionesBloqueadas: boolean;
  seriesParadas: ReadonlyMap<string, string>;
}): ReviewPoint[] {
  const out: ReviewPoint[] = [];
  /* Decisión B-78: sus cifras no son de hoy, y la tabla de posiciones las pone en fila con las que sí. */
  const seriesParadas = puntoDeSeriesParadas(posicionesParadas(ctx.positions, ctx.seriesParadas, (p) => p.assetId, (p) => p.name));
  if (seriesParadas) out.push({ severity: "alta", area: "Datos", text: seriesParadas });
  if (!ctx.benchmarkAvailable) {
    out.push({ severity: "media", area: "Referencia", text: "Cartera de referencia no disponible: no han llegado las series de sus fondos, y el informe sale sin comparación frente a ella." });
  }
  if (ctx.avisoDeRiesgoDistinto) out.push({ severity: "media", area: "Referencia", text: ctx.avisoDeRiesgoDistinto });
  for (const v of ctx.health.violations) {
    out.push({ severity: v.severity === "FAIL" ? "alta" : "media", area: "Umbrales", text: v.message });
  }
  /* Las que cuenta el titular y no son una regla de salud: sin esto, «Alertas: 1» no tenía punto a revisar. */
  for (const fila of ctx.filasConAlerta) {
    const detalle = fila.detalle?.length ? `. ${fila.detalle.map((d) => d.replace(/\.$/, "")).join("; ")}` : fila.nota ? `; ${fila.nota}` : "";
    out.push({ severity: fila.rotulo === "Restricciones" && ctx.restriccionesBloqueadas ? "alta" : "media", area: "Umbrales", text: `${fila.rotulo}: ${fila.cifra}${detalle}.` });
  }
  for (const [window, error] of Object.entries(ctx.horizonErrors)) {
    if (error) out.push({ severity: "media", area: `Análisis ${window[0]} años`, text: `No disponible: ${error}` });
  }
  for (const h of ctx.horizons) {
    const coverage = h.horizon.coverageWeightPercent;
    if (coverage < 99.5) {
      const fuera = ctx.positions.filter((p) => p.inBacktest[h.window] === "excluded").map((p) => `${p.name} (${pctText(p.weight)}, ${p.exclusionReason[h.window]})`);
      out.push(hayCifraDeCartera(coverage)
        ? { severity: "media", area: `Análisis ${h.window[0]} años`,
            text: `El histórico común cubre el ${coverage.toFixed(1).replace(".", ",")} % del peso; ${fuera.length ? `fuera de las cifras del periodo: ${fuera.join("; ")}.` : "el resto queda fuera de las cifras del periodo."}` }
        : { severity: "alta", area: `Análisis ${h.window[0]} años`,
            text: `El histórico común cubre el ${pesoLegible(coverage)} del peso, y por debajo del ${PESO_MINIMO_MEDIDO_PCT} % no se da ninguna cifra de la cartera${fuera.length ? `; fuera: ${fuera.join("; ")}` : ""}.` });
    }
    if (ctx.benchmarkAvailable && !h.comparison && !h.motivoSinCifra) {
      out.push({ severity: "media", area: `Análisis ${h.window[0]} años`, text: "La cartera y la referencia no tienen fechas suficientes en común: no se comparan." });
    }
    if (h.comparison?.cut) {
      out.push({ severity: "info", area: `Análisis ${h.window[0]} años`, text: `La referencia se compara hasta el ${oFalta(fecha(h.comparison.last))}, su última fecha común con la cartera.` });
    }
    if (h.horizon.extensions.length) {
      out.push({ severity: "info", area: `Análisis ${h.window[0]} años`,
        text: `${h.horizon.extensions.length === 1 ? "1 posición" : `${h.horizon.extensions.length} posiciones`} con historia estimada desde una referencia antes de su lanzamiento.` });
    }
  }
  /* Los escenarios de estrés no dependen de la ventana: se dice una vez, aunque salgan en las dos. */
  const estres = [...new Set(ctx.horizons.flatMap((h) => h.horizon.backtest.stress_scenarios.filter((s) => !s.representative && s.reason === null).map((s) => s.label)))];
  if (estres.length) {
    out.push({ severity: "info", area: "Estrés", text: `${estres.join(", ")}: cobertura insuficiente para ser representativo.` });
  }
  if (ctx.concentration && ctx.concentration.effectivePositions < 5 && ctx.concentration.positions >= 5) {
    out.push({ severity: "media", area: "Concentración",
      text: `Número efectivo de posiciones ${ctx.concentration.effectivePositions.toFixed(1).replace(".", ",")} con ${ctx.concentration.positions} posiciones: los pesos están muy concentrados.` });
  }
  for (const pair of ctx.highOverlapPairs.slice(0, 5)) {
    out.push({ severity: pair.value >= 60 ? "media" : "info", area: "Solapamiento",
      text: `${pair.a} y ${pair.b} comparten ${solapamientoEnUnaFrase(pair.value)} de sus subyacentes publicados.` });
  }
  if (ctx.overlapPairs.unmeasured > 0) {
    out.push({ severity: "info", area: "Solapamiento",
      text: `${ctx.overlapPairs.unmeasured} de ${ctx.overlapPairs.measured + ctx.overlapPairs.unmeasured} pares de fondos sin medir: a alguno de los dos le falta más de la mitad de su cartera publicada, o no la publica.` });
  }
  const missingMetrics = ctx.positions.filter((p) => p.return3y === null && p.volatility3y === null);
  if (missingMetrics.length) {
    out.push({ severity: "media", area: "Datos",
      text: `Sin rentabilidad ni volatilidad a 3 años: ${missingMetrics.map((p) => p.name).join(", ")}.` });
  }
  /* A una acción no le falta: no tiene KID ni KIID, y no avisa (decisión 83). */
  const noSri = ctx.positions.filter((p) => p.sri === null && seEnsenaLaMetrica("indicadorDeRiesgo", p.instrumentType));
  if (noSri.length) out.push({ severity: "media", area: "Regulatorio", text: `Sin indicador de riesgo: ${noSri.map((p) => p.name).join(", ")}.` });
  if (ctx.terCoverage < 0.999) {
    out.push({ severity: "media", area: "Costes", text: `Sin coste corriente para el ${pctText(1 - ctx.terCoverage)} del peso: la media solo cubre el resto.` });
  }
  /* A una acción no le falta la retrocesión: no le aplica. */
  const sinRetro = ctx.positions.filter((p) => p.retroPct === null && !esAccion(p.instrumentType));
  if (ctx.retroStatus === "ok" && sinRetro.length > 0) {
    out.push(ctx.retroCoverage <= 0
      ? { severity: "info", area: "Comercial", text: `${sinRetro.length === ctx.positions.length ? "Ninguna posición tiene" : "Ningún fondo ni ETF tiene"} retrocesión registrada en la base comercial.` }
      : { severity: "info", area: "Comercial", text: `Sin retrocesión registrada (${pctText(sinRetro.reduce((suma, p) => suma + p.weight, 0))} del peso): ${sinRetro.map((p) => p.name).join(", ")}.` });
  }
  for (const p of ctx.positions) {
    if (!p.retroDescartada) continue;
    out.push({
      severity: "alta",
      area: "Comercial",
      text: `La retrocesión guardada de ${p.name} (${pctText(p.retroDescartada.pct / 100, 2)}) supera ${p.retroDescartada.frenteA === "gastos corrientes" ? "sus gastos corrientes" : "su comisión de gestión"} (${pctText(p.retroDescartada.topePct / 100, 2)}): no puede ser un porcentaje del patrimonio, y no se usa. Parece un porcentaje de la comisión; corrígela en Administración.`
    });
  }
  if (ctx.retroStatus === "denied") out.push({ severity: "info", area: "Comercial", text: "La cuenta no tiene acceso a la base de retrocesiones." });
  if (ctx.retroStatus === "error") out.push({ severity: "media", area: "Comercial", text: "No se pudieron leer las retrocesiones." });
  const provider = ctx.positions.filter((p) => p.metricsMethod === "TRAILING_PROVIDER").reduce((s, p) => s + p.weight, 0);
  /* Los métodos propios de la base nueva son los del extractor: sin mirarlos, en la web la cartera mezclaba métodos y este punto no salía (decisión 80). */
  const own = ctx.positions.filter((p) => p.metricsMethod === "GEOMETRIC_CAGR" || p.metricsMethod?.startsWith("EXTRACTOR_")).reduce((s, p) => s + p.weight, 0);
  if (provider > 0 && own > 0) {
    out.push({ severity: "info", area: "Datos",
      text: `Métricas por posición de dos metodologías: ${pctText(own, 0)} del peso calculado sobre serie propia y ${pctText(provider, 0)} cifra del proveedor.` });
  }
  const flagged = ctx.positions.filter((p) => p.qualityFlags.length > 0);
  if (flagged.length) out.push({ severity: "info", area: "Datos", text: `${flagged.length === 1 ? "1 posición" : `${flagged.length} posiciones`} con avisos de calidad del dato (detalle en Calidad y trazabilidad).` });
  const order: Record<ReviewSeverity, number> = { alta: 0, media: 1, info: 2 };
  /* Un nombre puede acabar en punto, como «Iberdrola S.A.», y la frase no lleva dos. */
  return out.map((punto) => ({ ...punto, text: punto.text.replace(/\.\.$/, ".") })).sort((a, b) => order[a.severity] - order[b.severity]);
}
