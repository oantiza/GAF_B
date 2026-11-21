import { assetCommercialRetroKey } from "../adapters/commercialRetroStore";
import type { BdbAssetDetail, BdbAssetSearchResult, InstrumentType } from "../types/bdbAssets";
import type { AssetDataSource } from "../types/assetDataSource";
import type { CommercialRetroRecord } from "../types/commercialRetro";
import { appLogger } from "./appLogger";
import { resolveEffectiveCommercialRetro } from "./commercialRetroEffective";
import { categoriaLegible } from "./etiquetasDeReparto";
import { numero, oFalta } from "./formato";

export const COMPARISON_CATALOG_LIMIT = 200;
export const COMPARISON_DETAIL_BATCH_SIZE = 25;
/* Un recuento, con el punto de millar también en cuatro cifras («1.095»): el del módulo único. */
const recuento = (valor: number): string => oFalta(numero(valor));

export interface ComparisonCatalogFilters {
  instrumentTypes?: InstrumentType[];
  region: string;
  assetClass: string;
  category: string;
}

export interface ComparisonCatalogRow {
  asset: BdbAssetSearchResult;
  detail?: BdbAssetDetail;
  ongoingCharge?: number;
  retroRate?: number;
  annualizedReturn1y?: number;
}

export interface ComparisonCatalogDetailsResult {
  detailsByAssetId: Map<string, BdbAssetDetail>;
  partial: boolean;
}

export interface AssetPickerSearchResult {
  results: BdbAssetSearchResult[];
  error: string | null;
}

export async function loadAssetPickerResults(
  dataSource: Pick<AssetDataSource, "searchAssets">,
  options: { query: string; instrumentTypes?: InstrumentType[]; limit: number }
): Promise<AssetPickerSearchResult> {
  try {
    return { results: await dataSource.searchAssets(options), error: null };
  } catch (error) {
    return {
      results: [],
      error: error instanceof Error ? error.message : "No se pudo completar la búsqueda de activos."
    };
  }
}

function appliesFundFilters(instrumentTypes?: InstrumentType[]): boolean {
  return !instrumentTypes || instrumentTypes.every((type) => type === "FUND" || type === "ETF");
}

export function filterComparisonCatalog(
  assets: BdbAssetSearchResult[],
  filters: ComparisonCatalogFilters
): BdbAssetSearchResult[] {
  const useFundFilters = appliesFundFilters(filters.instrumentTypes);
  return assets.filter(
    (asset) =>
      (!filters.instrumentTypes || filters.instrumentTypes.includes(asset.instrument_type)) &&
      (filters.region === "ALL" || asset.region === filters.region) &&
      (filters.assetClass === "ALL" || !useFundFilters || asset.economic_asset_class === filters.assetClass) &&
      /* El filtro guarda el nombre que se enseña (decisión 101): trae todos los textos del proveedor que lo dan. */
      (filters.category === "ALL" || !useFundFilters || categoriaLegible(asset.category) === filters.category)
  );
}

export function commercialRetroByAssetId(
  assets: BdbAssetSearchResult[],
  records: CommercialRetroRecord[]
): Map<string, CommercialRetroRecord> {
  const recordsByIsin = new Map(records.map((record) => [record.isin, record]));
  const byAssetId = new Map<string, CommercialRetroRecord>();
  for (const asset of assets) {
    const key = assetCommercialRetroKey(asset);
    const record = key ? recordsByIsin.get(key) : undefined;
    if (record) byAssetId.set(asset.asset_id, record);
  }
  return byAssetId;
}

export function buildComparisonCatalogRows(
  assets: BdbAssetSearchResult[],
  detailsByAssetId: ReadonlyMap<string, BdbAssetDetail>,
  retroRecords: CommercialRetroRecord[]
): ComparisonCatalogRow[] {
  const retroByAssetId = commercialRetroByAssetId(assets, retroRecords);
  return assets.map((asset) => {
    const detail = detailsByAssetId.get(asset.asset_id);
    const retro = resolveEffectiveCommercialRetro(asset.asset_id, retroByAssetId);
    return {
      asset,
      detail,
      ongoingCharge: detail?.costs?.ongoing_charge,
      retroRate: retro?.rate,
      annualizedReturn1y: detail?.metrics.annualized_return_1y ?? asset.metrics.annualized_return_1y
    };
  });
}

/**
 * El catálogo abre por nombre (decisión 17 de Óscar, 04-11-2026). Abría ordenado por retrocesión, de
 * mayor a menor: lo primero que se veía al elegir un fondo era lo que cobra la casa por él. Si alguien
 * pregunta por qué se eligió un fondo, la herramienta no ordenaba por el ingreso propio.
 */
export function ordenarCatalogoPorNombre(rows: readonly ComparisonCatalogRow[]): ComparisonCatalogRow[] {
  return [...rows].sort(
    (left, right) =>
      left.asset.display_name.localeCompare(right.asset.display_name, "es", { sensitivity: "base" }) ||
      left.asset.asset_id.localeCompare(right.asset.asset_id)
  );
}

/**
 * Qué dice el botón del catálogo. El servidor devuelve lo que va por orden de ISIN hasta su tope, así
 * que «Ver todos (200)» enseñaba 200 de 1.095: se dice de cuántos, y si hay filtros, de qué se han
 * filtrado. Sin el total del servidor no se inventa: solo se dice cuántos hay.
 */
export function rotuloDelCatalogo(filtrados: number, leidos: number, total: number | null): string {
  if (total === null || total <= leidos) return `Ver catálogo (${recuento(filtrados)})`;
  return filtrados === leidos
    ? `Ver catálogo (${recuento(leidos)} de ${recuento(total)})`
    : `Ver catálogo (${recuento(filtrados)} de los ${recuento(leidos)} primeros)`;
}

/**
 * El aviso de que el catálogo está recortado, o nada si no lo está.
 *
 * El servidor ordena por identificador y corta en el tope (`functions_python/readmodel/repository.py`),
 * y el identificador de lo que tiene ISIN es el ISIN. Decir que «no incluye los fondos con ISIN LU» solo
 * es cierto si se pueden pedir fondos y entre lo leído no hay ninguno: con el filtro de acciones sería
 * falso, y por eso se mira en vez de escribirlo siempre.
 */
export function avisoDeCatalogoLimitado(
  leidos: readonly BdbAssetSearchResult[],
  instrumentTypes?: readonly InstrumentType[]
): string | null {
  if (leidos.length < COMPARISON_CATALOG_LIMIT) return null;
  const primeros = `los ${COMPARISON_CATALOG_LIMIT} primeros por ISIN`;
  const pideFondos = !instrumentTypes || instrumentTypes.includes("FUND");
  const faltanLosLU = pideFondos && !leidos.some((asset) => asset.isin?.startsWith("LU"));
  return `Catálogo limitado a ${primeros}${faltanLosLU ? ": no incluye los fondos con ISIN LU" : ""}. Región, clase y categoría se aplican sobre ese catálogo.`;
}

export function toggleComparisonCatalogSelection(
  selectedIds: string[],
  assetId: string,
  max: number
): string[] {
  if (selectedIds.includes(assetId)) return selectedIds.filter((id) => id !== assetId);
  return selectedIds.length >= max ? selectedIds : [...selectedIds, assetId];
}

export function materializeComparisonCatalogSelection(
  stagedIds: string[],
  currentSelected: BdbAssetSearchResult[],
  catalogAssets: BdbAssetSearchResult[],
  detailsByAssetId: ReadonlyMap<string, BdbAssetDetail>
): BdbAssetSearchResult[] {
  const selectedById = new Map(currentSelected.map((asset) => [asset.asset_id, asset]));
  const catalogById = new Map(catalogAssets.map((asset) => [asset.asset_id, asset]));
  return stagedIds.flatMap((assetId) => {
    const asset = detailsByAssetId.get(assetId) ?? selectedById.get(assetId) ?? catalogById.get(assetId);
    return asset ? [asset] : [];
  });
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

export async function loadComparisonCatalogDetails(
  dataSource: AssetDataSource,
  assets: BdbAssetSearchResult[]
): Promise<ComparisonCatalogDetailsResult> {
  const detailsByAssetId = new Map<string, BdbAssetDetail>();

  if (dataSource.resolvePortfolioPositions && assets.length > 0) {
    try {
      const resolved = await dataSource.resolvePortfolioPositions(
        assets.map((asset) => ({ asset_id: asset.asset_id, amount: 0 }))
      );
      for (const row of resolved) {
        if (row.asset) detailsByAssetId.set(row.asset.asset_id, row.asset);
      }
    } catch (cause) {
      // El fallback por lotes mantiene operativo el catálogo si falla la resolución
      // masiva, pero el fallo queda registrado (auditoría 27-07, T1).
      appLogger.warn("catálogo de comparación: falló la resolución masiva; se usa el fallback por lotes", cause);
    }
  }

  const missingIds = assets
    .map((asset) => asset.asset_id)
    .filter((assetId) => !detailsByAssetId.has(assetId));
  const batches = chunks(missingIds, COMPARISON_DETAIL_BATCH_SIZE);
  const settled = await Promise.allSettled(batches.map((batch) => dataSource.getComparableAssets(batch)));
  const rejected = settled.filter((result) => result.status === "rejected");
  if (rejected.length > 0) {
    appLogger.warn(
      `catálogo de comparación: ${rejected.length} de ${batches.length} lotes de fichas fallaron (catálogo parcial)`,
      (rejected[0] as PromiseRejectedResult).reason
    );
  }
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const detail of result.value) detailsByAssetId.set(detail.asset_id, detail);
  }

  return {
    detailsByAssetId,
    partial: detailsByAssetId.size < assets.length
  };
}
