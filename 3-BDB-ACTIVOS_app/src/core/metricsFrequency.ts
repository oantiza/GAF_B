import type { BdbAssetMetrics, BdbAssetSearchResult, RotuloDeVentana, VentanaDeMetricas } from "../types/bdbAssets";
import { fecha, oFalta } from "./formato";

// A1 (auditoría 29-09): la maestra mide las métricas de activo en semanal (metrics/latest
// declara WEEKLY); DAILY solo aparece en documentos anteriores al reproceso y se sigue
// etiquetando tal cual para que el control de comparabilidad avise de la mezcla.
const FREQUENCIES: Record<string, string> = {
  DAILY: "diarias", WEEKLY: "semanales", MONTHLY: "mensuales"
};

/**
 * Con qué método y frecuencia salen las cifras de UNA ventana. Un activo con cifras nuestras y, donde no llegan, del proveedor (decisión 110) no
 * tiene un rótulo común: quien lee los 3 años lee el de los 3 años. Sin esto, un fondo con solo la cifra a 10 años del proveedor dejaba sin
 * volatilidad estimada a toda su cartera, y Vanguard S&P 500 es de la cartera de muestra.
 */
export function rotuloDeLaVentana(
  metrics: Pick<BdbAssetMetrics, "metrics_method" | "metrics_frequency" | "metrics_by_window"> | undefined,
  ventana: VentanaDeMetricas
): RotuloDeVentana {
  if (metrics?.metrics_by_window) return metrics.metrics_by_window[ventana] ?? {};
  return { method: metrics?.metrics_method, frequency: metrics?.metrics_frequency };
}

export function metricFrequencyLabel(frequency?: string): string {
  return FREQUENCIES[frequency ?? ""] ?? "frecuencia no declarada";
}

/** An annualized number does not identify its sampling frequency. Never guess it. */
export function resolveMetricsFrequency(frequencies: readonly (string | undefined)[]) {
  const unique = [...new Set(frequencies)];
  const frequency = unique.length === 1 && FREQUENCIES[unique[0] ?? ""] ? unique[0] : undefined;
  const compatible = frequency !== undefined;
  const note = compatible
    ? `Estimación con observaciones ${metricFrequencyLabel(frequency)}. ${frequency === "WEEKLY"
      ? "La estimación usa correlaciones asumidas; la simulación histórica mide la cartera con sus series."
      : "La simulación histórica mide el riesgo en semanal; sus cifras no son directamente comparables con esta estimación."}`
    /* Sin «N/D» (FMT-08): lo que no se calcula se dice con palabras, y por qué. */
    : "La volatilidad y el Sharpe de la estimación no se calculan: las posiciones se miden con frecuencias distintas o no declaradas. Calcula la simulación histórica para medir la cartera en semanal.";
  return { compatible, frequency, note };
}

/** Con qué cálculo y a qué cierre son las cifras a 3 años de un activo: lo que decide con quién se puede ordenar. */
export interface ClaveDeGrupo {
  /** `metrics_method` de la ventana de 3 años. Sin él, el cálculo no está declarado. */
  metodo?: string;
  frecuencia?: string;
  /** El día de cierre de esas cifras, «AAAA-MM-DD». Sin él, no consta. */
  cierre?: string;
}

const METODO_DEL_PROVEEDOR = "TRAILING_PROVIDER";

/** El cierre de las cifras de 3 años: el de la rentabilidad del proveedor si la cifra es suya, y si no `metrics.as_of`. Sin ninguno, no consta. */
function cierreDeLas3Anos(metrics: BdbAssetSearchResult["metrics"], metodo: string | undefined): string | undefined {
  const delProveedor = metodo === METODO_DEL_PROVEEDOR
    ? metrics?.provider?.returns_as_of_by_window?.["3y"] ?? metrics?.provider?.returns_as_of ?? metrics?.provider?.as_of
      ?? metrics?.returns_as_of_by_window?.["3y"] ?? metrics?.returns_as_of
    : undefined;
  const dia = delProveedor ?? metrics?.as_of;
  return typeof dia === "string" && dia.trim() ? dia.trim().slice(0, 10) : undefined;
}

export function claveDeGrupoDe(asset: Pick<BdbAssetSearchResult, "metrics">): ClaveDeGrupo {
  const { method, frequency } = rotuloDeLaVentana(asset.metrics, "3y");
  return { metodo: method, frecuencia: frequency, cierre: cierreDeLas3Anos(asset.metrics, method) };
}

const mismaClave = (a: ClaveDeGrupo, b: ClaveDeGrupo) => a.metodo === b.metodo && a.frecuencia === b.frecuencia && a.cierre === b.cierre;
const ORDEN_DE_FRECUENCIA: Record<string, number> = { WEEKLY: 0, MONTHLY: 1, DAILY: 2 };

/**
 * El orden de los grupos, que depende solo de su clave y no de cuántos activos haya en cada uno (así no cambia al filtrar la lista): primero los
 * que declaran su cálculo y su cierre; entre ellos, el cálculo propio antes que el del proveedor, el cierre más reciente antes, y la frecuencia que
 * mide la maestra (semanal) antes que la mensual y la diaria, que solo queda en documentos antiguos.
 */
export function compararGrupos(a: ClaveDeGrupo, b: ClaveDeGrupo): number {
  const sinDeclarar = (k: ClaveDeGrupo) => (k.metodo && k.cierre ? 0 : 1);
  const delProveedor = (k: ClaveDeGrupo) => (k.metodo === METODO_DEL_PROVEEDOR ? 1 : 0);
  const frecuencia = (k: ClaveDeGrupo) => ORDEN_DE_FRECUENCIA[k.frecuencia ?? ""] ?? 3;
  return sinDeclarar(a) - sinDeclarar(b)
    || delProveedor(a) - delProveedor(b)
    /* El día más reciente primero; sin día, al final del grupo. */
    || (a.cierre === b.cierre ? 0 : !a.cierre ? 1 : !b.cierre ? -1 : a.cierre < b.cierre ? 1 : -1)
    || frecuencia(a) - frecuencia(b)
    || (a.metodo ?? "").localeCompare(b.metodo ?? "") || (a.frecuencia ?? "").localeCompare(b.frecuencia ?? "");
}

export type CriterioDeOrden = "sharpe_3y" | "annualized_return_3y" | "annualized_return_1y";

export const CRITERIO_EN_PALABRAS: Record<CriterioDeOrden, string> = {
  sharpe_3y: "Sharpe a 3 años", annualized_return_3y: "rentabilidad a 3 años", annualized_return_1y: "rentabilidad a 1 año"
};

export interface GrupoDeComparabilidad {
  /** 1, 2, 3…, en el orden de `compararGrupos`. */
  numero: number;
  clave: ClaveDeGrupo;
  /** La cifra con la que se ordenan entre sí los de este grupo. */
  criterio: CriterioDeOrden;
  activos: BdbAssetSearchResult[];
}

/** Dentro de un grupo, el Sharpe solo si todos lo tienen y el cálculo y la frecuencia están declarados (MET-4: lo que antes exigía a todo el conjunto). */
function criterioDelGrupo(clave: ClaveDeGrupo, activos: readonly BdbAssetSearchResult[]): CriterioDeOrden {
  const usaSharpe = activos.length > 0 && Boolean(clave.metodo) && Boolean(clave.frecuencia && FREQUENCIES[clave.frecuencia])
    && activos.every((a) => Number.isFinite(a.metrics?.sharpe_3y));
  if (usaSharpe) return "sharpe_3y";
  return activos.some((a) => Number.isFinite(a.metrics?.annualized_return_3y)) ? "annualized_return_3y" : "annualized_return_1y";
}

/**
 * MET-4 (17-11-2026): los activos se agrupan por el cálculo y el cierre de sus cifras a 3 años, y solo se ordenan entre sí los del mismo grupo.
 * Antes, si no compartían todos el cálculo y la frecuencia, se ordenaba por rentabilidad a 3 años mezclando cálculos propios y del proveedor y
 * cierres de fechas distintas; y el cierre no se miraba ni cuando coincidían los cálculos.
 */
export function gruposDeComparabilidad(assets: readonly BdbAssetSearchResult[]): GrupoDeComparabilidad[] {
  const grupos: Array<{ clave: ClaveDeGrupo; activos: BdbAssetSearchResult[] }> = [];
  for (const asset of assets) {
    const clave = claveDeGrupoDe(asset);
    const existente = grupos.find((grupo) => mismaClave(grupo.clave, clave));
    if (existente) existente.activos.push(asset);
    else grupos.push({ clave, activos: [asset] });
  }
  return grupos
    .sort((a, b) => compararGrupos(a.clave, b.clave))
    .map((grupo, i) => ({ numero: i + 1, clave: grupo.clave, criterio: criterioDelGrupo(grupo.clave, grupo.activos), activos: grupo.activos }));
}

function calculoDeLaCifra({ metodo, frecuencia }: ClaveDeGrupo): string {
  if (!metodo) return "con un cálculo sin declarar";
  if (metodo === METODO_DEL_PROVEEDOR) return "con la cifra del proveedor";
  const datos = FREQUENCIES[frecuencia ?? ""];
  return datos ? `con datos ${datos}` : "con datos de frecuencia no declarada";
}

/** Cada grupo, para quien lo lee: «con datos semanales, a 13/11/2026». Sin cálculo o sin cierre, se dice. */
export function grupoEnPalabras(clave: ClaveDeGrupo): string {
  return `${calculoDeLaCifra(clave)}, ${clave.cierre ? `a ${oFalta(fecha(clave.cierre))}` : "sin fecha de cierre"}`;
}

/**
 * Una frase que dice que la lista va por grupos y por qué, con lo que cada grupo es. Con un solo grupo no hay nada que decir. Con más de tres
 * activos en un grupo se cuentan, no se nombran.
 */
export function notaDeLosGrupos(grupos: readonly GrupoDeComparabilidad[]): string | null {
  if (grupos.length < 2) return null;
  const cada = grupos.map((grupo) => {
    const quienes = grupo.activos.length <= 3 ? grupo.activos.map((a) => a.display_name).join(", ") : `${grupo.activos.length} alternativas`;
    return `Grupo ${grupo.numero}: ${quienes} (${grupoEnPalabras(grupo.clave)}; por ${CRITERIO_EN_PALABRAS[grupo.criterio]})`;
  });
  return `Las alternativas van en ${grupos.length} grupos porque sus cifras no se calculan igual o no son de la misma fecha, y no se pueden poner en orden unas contra otras. Solo se ordenan entre sí las del mismo grupo. ${cada.join(". ")}.`;
}

/**
 * Un solo criterio para cada grupo, nunca una mezcla de Sharpe y rentabilidad dentro de uno. El orden de los grupos es `compararGrupos`;
 * dentro de un grupo, de mayor a menor cifra, y sin cifra al final.
 */
export function candidateRanking(assets: readonly BdbAssetSearchResult[]) {
  const grupos = gruposDeComparabilidad(assets);
  const criterioDe = new Map<BdbAssetSearchResult, CriterioDeOrden>(grupos.flatMap((grupo) => grupo.activos.map((a) => [a, grupo.criterio] as const)));
  const numeroDe = new Map<BdbAssetSearchResult, number>(grupos.flatMap((grupo) => grupo.activos.map((a) => [a, grupo.numero] as const)));
  const score = (asset: BdbAssetSearchResult): number => {
    const key = criterioDe.get(asset) ?? gruposDeComparabilidad([asset])[0].criterio;
    const value = asset.metrics?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  };
  const compare = (left: BdbAssetSearchResult, right: BdbAssetSearchResult): number => {
    const a = score(left), b = score(right);
    return compararGrupos(claveDeGrupoDe(left), claveDeGrupoDe(right))
      || (a === b ? 0 : a > b ? -1 : 1)
      || left.display_name.localeCompare(right.display_name, "es") || left.asset_id.localeCompare(right.asset_id);
  };
  const [primero] = grupos;
  const label = grupos.length > 1 ? "por grupos comparables" : primero?.criterio === "sharpe_3y" ? "Sharpe 3A comparable" : primero?.criterio === "annualized_return_1y" ? "rentabilidad 1A" : "rentabilidad 3A";
  return { score, compare, label, grupos, grupoDe: (asset: BdbAssetSearchResult) => numeroDe.get(asset) ?? null };
}
