/**
 * La entrada del informe de cliente, montada en un solo sitio para sus dos puertas: Informes y Análisis (ANA-01, 13-11-2026).
 *
 * Antes cada puerta la montaba por su cuenta y no coincidían: Informes añadía a las posiciones la réplica de cada ficha y Análisis no,
 * así que el mismo PDF explicaba el solapamiento de un ETF sintético de dos maneras según desde dónde se descargara. Análisis tampoco
 * pasaba el Modo cliente. Ahora las dos le dan a esta función lo que tienen y el generador recibe lo mismo.
 *
 * Es pura: lo que hay que pedir (la simulación, las series paradas) lo pide quien llama, y la lectura de dividendos llega como
 * función porque vive en el módulo del PDF, que se carga a demanda.
 */
import type { PortfolioHorizon } from "../adapters/portfolioHorizon";
import type { InformeDeClientePdfInput } from "../reports/informeDeClientePdf";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbPortfolioReport } from "../types/bdbAssets";
import { AppError } from "./appError";
import { computeEquityRegionAllocation } from "./equityRegions";
import { oFalta, peso } from "./formato";
import type { PerfilYHorizonte } from "./perfilYHorizonte";
import { conLaReplica, type ReportOverlap } from "./reportOverlap";
import { viabilidadDelInforme } from "./reportPipeline";
import { isWeightBalanced } from "./weightTolerance";

/**
 * Por qué el informe de cliente no se genera con esta cartera, o `null` si se puede (auditoría 16-11-2026, INF-1).
 *
 * Con pesos que no suman 100 el papel se contradecía en la misma tabla: la columna de peso imprimía el peso escrito y la de
 * importe repartía el capital entero en proporción (con 100.000 € y una sola posición al 60 %, «60,0 % · 100.000 €», y el total
 * igual), mientras la mayor posición, la parte medida y la proyección contaban sobre el 100 %. El informe de costes y el interno
 * normalizan y lo dicen; este es una propuesta que se entrega, y una propuesta que no suma 100 no está terminada: no se genera.
 * La tolerancia es la única de la aplicación (`weightTolerance.ts`, ±0,05), la misma con la que Diseño dice que la cartera cuadra.
 */
export function motivoParaNoGenerarElInformeDeCliente(report: Pick<BdbPortfolioReport, "summary">): string | null {
  const total = report.summary.total_weight_percent;
  if (isWeightBalanced(total)) return null;
  return `Los pesos suman ${oFalta(peso(total / 100))}, no el 100 %: este informe no se genera hasta que cuadren.`;
}

export interface OpcionesDelInformeDeCliente {
  report: BdbPortfolioReport;
  /** El nombre escrito para la cartera. Vacío o ausente, el papel se queda con el del informe. */
  nombreDeLaCartera?: string;
  /** Las posiciones de la cartera activa, con sus pesos: de ellas salen la viabilidad y las regiones. */
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  /** Los candados de Diseño, si la puerta los tiene. Análisis no los tiene. */
  lockedWeights?: Record<string, number>;
  clientMode: boolean;
  analysis: PortfolioHorizon;
  seriesParadas: ReadonlyMap<string, string>;
  benchmarkId: string;
  totalCapital?: number;
  clientName: string;
  banker: { name: string; email: string };
  perfilYHorizonte?: PerfilYHorizonte;
  /** `rentabilidadPorDividendoDe` del módulo del PDF (A-143). */
  rentabilidadPorDividendoDe: (activos: readonly BdbAssetDetail[]) => Record<string, number | null>;
  /**
   * El solapamiento ya medido, con las cargas de la pantalla (`posicionesDelInformeDeCliente` y `cargasDeLaCartera`): un ETF se mide
   * con la cartera completa de su emisor (decisión del 14-11-2026). Sin él, el papel lo calcula con la fuente del proveedor.
   */
  overlap?: ReportOverlap;
}

/** Las posiciones con las que el informe de cliente mide su solapamiento: las del informe, cada una con la réplica de su ficha. */
export function posicionesDelInformeDeCliente(report: BdbPortfolioReport, assets: BdbAssetDetail[]): BdbPortfolioReport["positions"] {
  return conLaReplica(report.positions, assets);
}

export function entradaDelInformeDeCliente(opciones: OpcionesDelInformeDeCliente): InformeDeClientePdfInput {
  const { report, positions, assets, lockedWeights } = opciones;
  /* Las dos puertas ya no dejan llegar aquí con una cartera sin cuadrar: esto es la última defensa, por si aparece una tercera. */
  const sinCuadrar = motivoParaNoGenerarElInformeDeCliente(report);
  if (sinCuadrar) throw new AppError("BACKEND", sinCuadrar);
  const nombre = opciones.nombreDeLaCartera?.trim();
  return {
    /* Cada posición lleva la réplica de su ficha: el solapamiento la necesita para decir que un ETF sintético replica con una
       permuta y no que «no publica». */
    report: { ...report, ...(nombre ? { portfolio_name: nombre } : {}), positions: posicionesDelInformeDeCliente(report, assets) },
    seriesParadas: opciones.seriesParadas,
    feasibility: viabilidadDelInforme({ positions, assets, lockedWeights }),
    lockedWeights,
    totalCapital: opciones.totalCapital,
    analysis: opciones.analysis,
    benchmarkId: opciones.benchmarkId,
    banker: opciones.banker,
    clientMode: opciones.clientMode,
    /* La geografía canónica, la misma que pintan Resumen y Análisis: sin el fondo que no declara su reparto (A-211). */
    regionRows: computeEquityRegionAllocation(positions, assets).rows,
    rentabilidadPorDividendo: opciones.rentabilidadPorDividendoDe(assets),
    perfilYHorizonte: opciones.perfilYHorizonte,
    clientName: opciones.clientName.trim(),
    ...(opciones.overlap ? { overlap: opciones.overlap } : {})
  };
}
