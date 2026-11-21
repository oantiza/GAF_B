import type {
  BdbAdapterWarning,
  BdbAssetDetail,
  BdbAssetSearchResult,
  BdbOptimizationAsset,
  BdbQualityFlag,
  InstrumentType
} from "../types/bdbAssets";
import { cloneOfficialBenchmark } from "./officialBenchmark";
import { QUALITY_FLAG_LABELS, readableBackendLabel } from "./labels";

export const DEFAULT_INSTRUMENT_TYPES: InstrumentType[] = ["FUND", "ETF", "STOCK", "INDEX"];

const SEVERITY_BY_FLAG: Record<BdbQualityFlag, BdbAdapterWarning["severity"]> = {
  MOCK_DATA: "LOW",
  MISSING_HOLDINGS: "LOW",
  MISSING_HISTORY: "LOW",
  MISSING_QUANT_METRICS: "MEDIUM",
  MISSING_METRICS: "MEDIUM",
  PARTIAL_COVERAGE: "MEDIUM",
  NON_INVESTABLE_BENCHMARK: "LOW",
  NON_INVESTABLE_CORPORATE_ACTION: "HIGH",
  NON_INVESTABLE_SUSPENDED: "HIGH",
  NON_INVESTABLE_DELISTED: "HIGH",
  NON_INVESTABLE_CLOSED_SUBSCRIPTIONS: "HIGH",
  NON_INVESTABLE_NEVER_RESOLVED: "HIGH",
  QUALITY_BLOCKED: "HIGH",
  UNSUPPORTED_INSTRUMENT_TYPE: "MEDIUM",
  MISSING_ASSET: "HIGH",
  SUITABILITY_REVIEW_REQUIRED: "MEDIUM",
  /* La revisión del histórico (decisión 120), con la gravedad que les da el servidor. */
  HISTORY_CONTINUITY_UNVERIFIED: "LOW",
  HISTORY_RESTRICTED_AFTER_REVIEW: "LOW",
  TOTAL_RETURN_UNVERIFIED: "LOW",
  HISTORY_SPLICED_SISTER_CLASS: "LOW",
  PRICE_FROZEN_DELISTED: "LOW"
};

export function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function matchesAssetIdentifier(asset: BdbAssetDetail, assetId: string): boolean {
  return asset.asset_id === assetId || asset.isin === assetId || asset.ticker === assetId;
}

export function findAssetByIdentifier(assets: BdbAssetDetail[], assetId: string): BdbAssetDetail | undefined {
  return assets.find((asset) => matchesAssetIdentifier(asset, assetId));
}

export function getComparableAssetsById(assets: BdbAssetDetail[], assetIds: string[]): BdbAssetDetail[] {
  const seenAssetIds = new Set<string>();

  return assetIds
    .map((assetId) => findAssetByIdentifier(assets, assetId))
    .filter((asset): asset is BdbAssetDetail => Boolean(asset))
    .filter((asset) => {
      if (seenAssetIds.has(asset.asset_id)) {
        return false;
      }

      seenAssetIds.add(asset.asset_id);
      return true;
    });
}

/**
 * These restrictions block new selections while preserving existing positions.
 *
 * Una baja con precio congelado (`PRICE_FROZEN_DELISTED`, hoy solo NH Hotel Group, decisión de Óscar del 12-11-2026) no restringe
 * la selección: se queda dado de alta, valorado a su último precio. Lo demás que pueda tener —una suspensión, un cierre— sí.
 */
export function historicalSelectionRestriction(asset: Pick<BdbAssetDetail, "quality_flags">): BdbQualityFlag | undefined {
  const conPrecioCongelado = asset.quality_flags.includes("PRICE_FROZEN_DELISTED");
  return asset.quality_flags.find((flag) =>
    flag === "NON_INVESTABLE_CORPORATE_ACTION" ||
    flag === "NON_INVESTABLE_SUSPENDED" ||
    (flag === "NON_INVESTABLE_DELISTED" && !conPrecioCongelado) ||
    flag === "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS" ||
    flag === "NON_INVESTABLE_NEVER_RESOLVED"
  );
}

/**
 * Decisión 75: lo que el equipo deja fuera porque su serie tiene saltos sin resolver. Hoy son Deoleo, Duro Felguera y Squirrel,
 * bloqueadas por Óscar el 30-09-2026. Cotizan y se pueden comprar, así que no se dicen «no invertibles»: no se pueden proponer, y lo
 * que tienen es una incidencia en su serie. Se decide por la marca del servidor y nunca por el ISIN. Con un servidor que aún no la
 * manda, dicen lo de antes: por eso esto no condiciona el orden de publicar.
 *
 * Desde el 14-11-2026 (decisión de Óscar, ACT-01 de la auditoría del frontend) el asesor sí puede añadirlas a mano, con el aviso
 * «Sin datos fiables para medirlo» junto al botón (`avisoDeAccionDeCartera`). El programa sigue sin proponerlas por su cuenta
 * (optimizador, alternativas, generador) y sin medirlas: dentro de una cartera quedan fuera de las métricas.
 */
export function bloqueadoPorCalidadDelDato(asset: { quality_flags?: readonly BdbQualityFlag[] }): boolean {
  return (asset.quality_flags ?? []).includes("QUALITY_BLOCKED");
}

/** Lo que no entra, nombrado en una fila. Para el cliente, lo que le pasa a la serie: «calidad del dato» es la cocina (decisión 19). */
export function rotuloDeLoQueNoEntra(asset: { quality_flags?: readonly BdbQualityFlag[] }, modoCliente: boolean): string {
  if (!bloqueadoPorCalidadDelDato(asset)) return "No invertible";
  return modoCliente ? "Incidencia en su serie de precios" : "Bloqueado por calidad del dato";
}

export function isInvestableAsset(asset: BdbAssetDetail): boolean {
  return (
    asset.instrument_type !== "INDEX" &&
    asset.is_investable &&
    asset.role !== "BENCHMARK" &&
    !asset.quality_flags.includes("NON_INVESTABLE_BENCHMARK") &&
    !historicalSelectionRestriction(asset)
  );
}

/**
 * Lo que una cartera conserva aunque no se pueda proponer: lo invertible; lo que tiene una restricción revisada (dado de baja, suspendido,
 * cerrado a nuevas suscripciones, sin resolver), porque un cliente puede tenerlo; y lo que tiene una incidencia en su serie, porque cotiza
 * (decisión 75). Un índice no es una posición. Es la regla al guardar (decisión 113), y la de importar un fichero y llevar posiciones a Diseño,
 * que además dejan fuera lo que la decisión 44 no deja entrar (`entraAlCargarUnaCartera`).
 */
export function seConservaEnLaCartera(asset: BdbAssetDetail): boolean {
  /* El tipo dice que las marcas siempre llegan, y hay activos que llegan sin ellas: sin marcas no hay restricción que leer. */
  const marcas = { quality_flags: asset.quality_flags ?? [] };
  return isInvestableAsset(asset) || Boolean(historicalSelectionRestriction(marcas)) || bloqueadoPorCalidadDelDato(marcas);
}

/** Un índice o una referencia: lo que no es una posición. Lo demás que no entra en una cartera es «no invertible», y no se le llama índice. */
export function esUnIndice(asset: Pick<BdbAssetDetail, "instrument_type" | "role" | "quality_flags">): boolean {
  return asset.instrument_type === "INDEX" || asset.role === "BENCHMARK" || (asset.quality_flags ?? []).includes("NON_INVESTABLE_BENCHMARK");
}

export function warningFromQualityFlag(asset: Pick<BdbAssetDetail, "asset_id">, flag: BdbQualityFlag): BdbAdapterWarning {
  const canonicalFlag = flag === "MISSING_METRICS" ? "MISSING_QUANT_METRICS" : flag;
  return {
    code: canonicalFlag,
    severity: SEVERITY_BY_FLAG[canonicalFlag],
    /* D2.2: aviso en español con la etiqueta del sistema, no el código crudo. */
    message: `Aviso de datos: ${QUALITY_FLAG_LABELS[canonicalFlag] ?? readableBackendLabel(canonicalFlag)}.`,
    asset_id: asset.asset_id
  };
}

export function warningsFromQualityFlags(
  asset: Pick<BdbAssetDetail, "asset_id" | "quality_flags">,
  options: { includeMockData?: boolean; includeNonInvestableBenchmark?: boolean } = {}
): BdbAdapterWarning[] {
  return asset.quality_flags
    .filter((flag) => options.includeMockData || flag !== "MOCK_DATA")
    .filter((flag) => options.includeNonInvestableBenchmark || flag !== "NON_INVESTABLE_BENCHMARK")
    .map((flag) => warningFromQualityFlag(asset, flag));
}

export function missingAssetWarning(assetId: string): BdbAdapterWarning {
  return {
    code: "MISSING_ASSET",
    severity: "HIGH",
    message: "Aviso de datos: activo no encontrado en la fuente local.",
    asset_id: assetId
  };
}

export function toAssetSearchResult(asset: BdbAssetDetail): BdbAssetSearchResult {
  const result: BdbAssetSearchResult = {
    asset_id: asset.asset_id,
    display_name: asset.display_name,
    instrument_type: asset.instrument_type,
    economic_asset_class: asset.economic_asset_class,
    isin: asset.isin,
    ticker: asset.ticker,
    provider: asset.provider,
    currency: asset.currency,
    coverage_status: asset.coverage_status,
    is_investable: asset.is_investable,
    role: asset.role,
    quality_flags: asset.quality_flags,
    warnings: asset.warnings,
    metrics: asset.metrics,
    morningstar_rating: asset.morningstar_rating,
    region: asset.region,
    category: asset.category,
    sector: asset.sector,
    strategy: asset.strategy
  };

  const officialBenchmark = cloneOfficialBenchmark(asset.official_benchmark);
  return officialBenchmark ? { ...result, official_benchmark: officialBenchmark } : result;
}

export function searchAssetDetails(
  assets: BdbAssetDetail[],
  options: { query?: string; instrumentTypes?: InstrumentType[]; limit?: number } = {}
): BdbAssetSearchResult[] {
  const query = normalizeSearchValue(options.query ?? "");
  const allowedTypes = options.instrumentTypes ?? DEFAULT_INSTRUMENT_TYPES;
  const limit = options.limit ?? 20;

  return assets
    .filter((asset) => allowedTypes.includes(asset.instrument_type))
    .filter((asset) => {
      if (!query) {
        return true;
      }

      return [
        asset.asset_id,
        asset.display_name,
        asset.instrument_type,
        asset.economic_asset_class,
        asset.isin,
        asset.ticker,
        asset.provider,
        asset.category,
        asset.region,
        asset.sector,
        asset.strategy,
        asset.official_benchmark?.name,
        asset.role
      ]
        .filter(Boolean)
        .some((value) => normalizeSearchValue(String(value)).includes(query));
    })
    .slice(0, limit)
    .map(toAssetSearchResult);
}

export function toOptimizationAsset(asset: BdbAssetDetail): BdbOptimizationAsset {
  return {
    asset_id: asset.asset_id,
    display_name: asset.display_name,
    instrument_type: asset.instrument_type,
    economic_asset_class: asset.economic_asset_class,
    currency: asset.currency,
    is_investable: asset.is_investable,
    role: asset.role,
    metrics: asset.metrics,
    pms_exposure: asset.pms_exposure,
    quality_flags: asset.quality_flags,
    warnings: asset.warnings
  };
}
