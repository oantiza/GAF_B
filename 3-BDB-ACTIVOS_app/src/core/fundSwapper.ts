import { sinPrecioNiMetricas } from "./accionDeCartera";
import { coincideConLoTecleado, plegar } from "./busquedaDeActivos";
import { normalizeBackendSector } from "./equitySectors";
import { categoriaLegible, etiquetaDeReparto } from "./etiquetasDeReparto";
import { candidateRanking, claveDeGrupoDe, type ClaveDeGrupo } from "./metricsFrequency";
import type { BdbAssetSearchResult, EconomicAssetClass, InstrumentType } from "../types/bdbAssets";

export type SwapSearchMode = "homogeneous" | "custom";

// Los niveles 1-3 siempre comparten vehículo y clase económica. 4 es elección libre.
// En una acción (decisión 16): 1, mismo sector y región; 2, mismo sector. No tiene nivel 3.
export interface SwapAlternative {
  asset: BdbAssetSearchResult;
  tier: 1 | 2 | 3 | 4;
  score: number;
  /**
   * El cálculo y el cierre de las cifras con las que se ordenó (MET-4): solo se comparan entre sí las del mismo grupo. Sin él, la lista no se
   * ordena por cifras (las acciones van por nombre) y no hay grupos que decir.
   */
  grupo?: ClaveDeGrupo;
}

export interface SwapSearchFilters {
  query: string;
  instrumentType: InstrumentType | "ALL";
  assetClass: EconomicAssetClass | "ALL";
  category: string;
  region: string;
}

export const EMPTY_SWAP_FILTERS: SwapSearchFilters = {
  query: "", instrumentType: "ALL", assetClass: "ALL", category: "ALL", region: "ALL"
};

function norm(s?: string | null): string {
  return plegar((s ?? "").trim());
}

export function isSwapCandidate(asset: BdbAssetSearchResult): boolean {
  return asset.is_investable && asset.role !== "BENCHMARK" && ["FUND", "ETF", "STOCK"].includes(asset.instrument_type);
}

/**
 * Lo que sale en la lista de «Elegir otro activo» sin que se pueda elegir (decisión 44): quien busca un instrumento por su
 * nombre tiene que saber por qué no puede cambiarlo, en vez de no encontrarlo. Entre las alternativas homogéneas no sale: esa
 * lista propone, y esto no se puede proponer.
 */
export const seVeSinPoderElegirse = (asset: BdbAssetSearchResult): boolean => sinPrecioNiMetricas(asset);

/** El sector de una acción en la clave de la casa, para comparar: las dos bases no lo escriben igual («Banking», «Financial Services»). */
export function sectorComparable(asset: Pick<BdbAssetSearchResult, "sector">): string | null {
  const sector = asset.sector?.trim();
  return sector ? normalizeBackendSector(sector) ?? norm(sector) : null;
}

/** El sector tal como se enseña: «Financieras». Lo que no conocemos, tal cual viene. */
export function sectorLegible(asset: Pick<BdbAssetSearchResult, "sector">): string | null {
  const clave = sectorComparable(asset);
  if (!clave) return null;
  const etiqueta = etiquetaDeReparto(clave);
  return etiqueta === clave ? asset.sector?.trim() ?? null : etiqueta;
}

/**
 * La región de una acción a efectos de afinidad. La base anterior guarda aquí un país, y en inglés, y mezcla «Spain», «Iberia»,
 * «Germany» y «Europa»; la nueva dice Eurozona, Reino Unido o Europa ex-euro por la bolsa en la que cotiza. Para sustituir una
 * acción lo que cuenta es el continente: Enel es tan parecida a Iberdrola como Endesa, y NextEra no. Y es lo único que se puede
 * comparar en las dos bases: de «Europa» no se sabe el país.
 */
const REGION_DE_UNA_ACCION: Record<string, string> = {
  europa: "europa", eurozona: "europa", "europa ex-euro": "europa", "reino unido": "europa", iberia: "europa",
  spain: "europa", germany: "europa", france: "europa", netherlands: "europa", italy: "europa", ireland: "europa",
  luxembourg: "europa", switzerland: "europa", "united kingdom": "europa"
};

export function regionComparable(region: string | null | undefined): string | null {
  const texto = norm(region);
  return texto ? REGION_DE_UNA_ACCION[texto] ?? texto : null;
}

/**
 * Una acción solo se parece a otra de su sector: compartir «renta variable» no dice nada, y era lo que ponía a bancos y a una
 * aerolínea como alternativas de Iberdrola. Sin sector, no se parece a nada: «No se puede proponer un equivalente». Lo demás
 * sigue a mano en «Elegir otro activo». Un fondo y un ETF siguen con su producto y su clase.
 */
export function isHomogeneousAlternative(source: BdbAssetSearchResult, candidate: BdbAssetSearchResult): boolean {
  if (!isSwapCandidate(candidate)
    || source.instrument_type !== candidate.instrument_type
    || source.economic_asset_class !== candidate.economic_asset_class) return false;
  if (source.instrument_type !== "STOCK") return true;
  const sector = sectorComparable(source);
  return sector !== null && sector === sectorComparable(candidate);
}

/** Por qué no hay alternativas de este activo. Sin sector no es que no las haya: es que no se pueden proponer. */
export function motivoSinAlternativas(source: BdbAssetSearchResult | null | undefined): string {
  if (source?.instrument_type !== "STOCK") return "No hay alternativas del mismo producto y clase en el catálogo.";
  const sector = sectorLegible(source);
  return sector
    ? `No hay otras acciones de su sector (${sector}) en el catálogo.`
    : "No se puede proponer un equivalente: no tenemos el sector de esta acción.";
}

export function findSwapAlternatives(
  source: BdbAssetSearchResult,
  universe: BdbAssetSearchResult[],
  excludeIds: string[] = [],
  mode: SwapSearchMode = "homogeneous",
  limit = 8
): SwapAlternative[] {
  const exclude = new Set<string>([source.asset_id, ...excludeIds]);
  const esAccion = source.instrument_type === "STOCK";
  const region = norm(source.region);
  /* Por el nombre que se enseña: la misma categoría en dos idiomas es la misma (decisión 101). */
  const category = norm(categoriaLegible(source.category));
  const regionDeLaAccion = regionComparable(source.region);
  const out: SwapAlternative[] = [];
  const seen = new Set<string>();
  for (const asset of universe) {
    if (exclude.has(asset.asset_id) || seen.has(asset.asset_id)) continue;
    if (!isSwapCandidate(asset) && !(mode === "custom" && seVeSinPoderElegirse(asset))) continue;
    const homogeneous = isHomogeneousAlternative(source, asset);
    if (mode === "homogeneous" && !homogeneous) continue;
    const sameRegion = !region || norm(asset.region) === region;
    const tier = !homogeneous
      ? 4
      : esAccion
        ? regionDeLaAccion && regionComparable(asset.region) === regionDeLaAccion ? 1 : 2
        : category && norm(categoriaLegible(asset.category)) === category && sameRegion ? 1 : sameRegion ? 2 : 3;
    out.push({ asset, tier, score: 0 });
    seen.add(asset.asset_id);
  }
  /* Por nombre, nunca por lo que ha subido: una lista de acciones ordenada por su rentabilidad empuja a la última que ha subido
     (decisión 16). Y sin recorte: ya la acota el sector, y cortarla a las 8 primeras del abecedario dejaría fuera a Naturgy. El
     tamaño no sirve de orden: la tarjeta de la base nueva no trae capitalización. */
  if (esAccion) {
    return out.sort(
      (x, y) => x.tier - y.tier
        || x.asset.display_name.localeCompare(y.asset.display_name, "es")
        || x.asset.asset_id.localeCompare(y.asset.asset_id)
    );
  }
  const ranking = candidateRanking(out.map((item) => item.asset));
  out.forEach((item) => { item.score = ranking.score(item.asset); item.grupo = claveDeGrupoDe(item.asset); });
  out.sort((x, y) => x.tier - y.tier || ranking.compare(x.asset, y.asset));
  return out.slice(0, limit);
}

/** Fondos con fondos, ETFs con ETFs y acciones con acciones; siempre de la misma clase económica. */
export function findHomogeneousAlternatives(
  source: BdbAssetSearchResult,
  universe: BdbAssetSearchResult[],
  excludeIds: string[] = [],
  limit = 8
): SwapAlternative[] {
  return findSwapAlternatives(source, universe, excludeIds, "homogeneous", limit);
}

export function filterSwapAlternatives(alternatives: SwapAlternative[], filters: SwapSearchFilters): SwapAlternative[] {
  return alternatives.filter(({ asset }) =>
    (filters.instrumentType === "ALL" || asset.instrument_type === filters.instrumentType)
    && (filters.assetClass === "ALL" || asset.economic_asset_class === filters.assetClass)
    && (filters.category === "ALL" || norm(categoriaLegible(asset.category)) === norm(filters.category))
    && (filters.region === "ALL" || norm(asset.region) === norm(filters.region))
    /* La regla de las otras dos búsquedas (decisión 113). El identificador, por si no es el ISIN. */
    && coincideConLoTecleado({ nombre: `${asset.display_name} ${asset.asset_id}`, isin: asset.isin ?? asset.asset_id, ticker: asset.ticker }, filters.query)
  );
}
