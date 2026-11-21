import { categoriaLegible, regionLegible } from "../core/etiquetasDeReparto";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { NO_SE_ANADE_SIN_MEDIR, sinPrecioNiMetricas } from "../core/accionDeCartera";
import { loadAssetPickerResults } from "../core/assetComparisonCatalog";
import { buildUniverseNotice, hasMoreUniverse } from "../core/searchUniverse";
import { appLogger } from "../core/appLogger";
import { numero } from "../core/formato";
import { CLASS_LABELS } from "../core/labels";
import { AssetSearchFilters, type AssetFilterValue } from "./AssetSearchFilters";
import { Button } from "./ui/Button";
import type { BdbAssetSearchResult, InstrumentType } from "../types/bdbAssets";
import type { AssetDataSourceKind } from "../types/assetDataSource";

/** Página que se pide al backend — igual al cap del servidor (CAP_SEARCH_LIMIT).
    Antes el picker pedía 300, el servidor recortaba a 200 en silencio y la
    lista pintaba 80 con un contador que decía otra cosa (T7.3, familia D1). */
const PICKER_PAGE_LIMIT = 200;
const PICKER_QUERY_LIMIT = 60;
/** Lo que se espera desde la última tecla antes de preguntar al servidor (ACT-12). */
const ESPERA_ENTRE_TECLAS_MS = 250;

function filterToInstrumentTypes(filter: AssetFilterValue): InstrumentType[] | undefined {
  return filter === "ALL" ? undefined : [filter];
}

/**
 * El nombre de una clase de activo en el filtro (ACT-19): el de toda la aplicación (`CLASS_LABELS`), con una excepción.
 * Lo que la base no clasifica se llama «Sin clasificar», como en el cambio de fondo: con «Otros» saldría dos veces en la
 * lista, junto a lo que sí está clasificado como otros.
 */
function rotuloDeClase(clase: string): string {
  return clase === "UNKNOWN" ? "Sin clasificar" : (CLASS_LABELS[clase] ?? clase);
}

export function AssetPickerErrorFeedback({ message }: { message: string | null }) {
  return message ? <p className="asset-picker-error" role="alert">{message}</p> : null;
}

export interface AssetPickerFilterState {
  activeFilter: AssetFilterValue;
  region: string;
  assetClass: string;
  category: string;
}

interface AssetPickerProps {
  sourceKind: AssetDataSourceKind;
  selectedIds: string[];
  max: number;
  onPick: (asset: BdbAssetSearchResult) => void;
  filters?: AssetPickerFilterState;
  initialActiveFilter?: AssetFilterValue;
  onFiltersChange?: (filters: AssetPickerFilterState) => void;
}

/** Barra de búsqueda + filtros (replica del buscador) reutilizable para añadir activos. */
export function AssetPicker({
  sourceKind,
  selectedIds,
  max,
  onPick,
  filters,
  initialActiveFilter = "ALL",
  onFiltersChange
}: AssetPickerProps) {
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);
  const [query, setQuery] = useState("");
  const [internalFilters, setInternalFilters] = useState<AssetPickerFilterState>(() => ({
    activeFilter: initialActiveFilter,
    region: "ALL",
    assetClass: "ALL",
    category: "ALL"
  }));
  const [results, setResults] = useState<BdbAssetSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const filterState = filters ?? internalFilters;
  const { activeFilter, region, assetClass, category } = filterState;
  /* Búsqueda viva (revisión 14-10, ronda 2): cada búsqueda nueva —texto,
     filtro o fuente— avanza el contador. «Cargar más» lo captura al pedir y lo
     compara al volver; antes comparaba la consulta consigo misma dentro del
     mismo cierre, nunca cortaba, y la página de un filtro anterior se añadía a
     la lista nueva con su cursor y su total. Es el patrón de liveSearchKey en
     AssetSearch, con la marca puesta en el mismo efecto que vacía la lista. */
  const liveSearch = useRef(0);

  function updateFilters(patch: Partial<AssetPickerFilterState>) {
    const next = { ...filterState, ...patch };
    if (!filters) setInternalFilters(next);
    onFiltersChange?.(next);
  }

  useEffect(() => {
    let active = true;
    liveSearch.current += 1;
    setResults([]);
    setSearchError(null);
    setSearchTotal(null);
    setSearchCursor(null);
    const limit = query.trim() ? PICKER_QUERY_LIMIT : PICKER_PAGE_LIMIT;
    const searchOptions = {
      query,
      instrumentTypes: filterToInstrumentTypes(activeFilter),
      limit
    };
    // Mismo patrón que el buscador (D1): página con total honesto y cursor
    // si la fuente lo ofrece; si no, carga simple sin total conocido.
    const buscar = () => {
      const request = dataSource.searchAssetsPage
        ? dataSource.searchAssetsPage(searchOptions).then((page) => {
            if (active) {
              setResults(page.results);
              setSearchTotal(page.totalMatches);
              setSearchCursor(page.nextCursor);
            }
          })
        : loadAssetPickerResults(dataSource, searchOptions).then((result) => {
            if (active) {
              setResults(result.results);
              setSearchError(result.error);
            }
          });
      request.catch((error: unknown) => {
        if (active) {
          setSearchError(error instanceof Error ? error.message : "No se pudo completar la búsqueda.");
          setResults([]);
          setSearchTotal(null);
          setSearchCursor(null);
        }
      });
    };
    /* ACT-12: con texto, se espera a que se deje de teclear; «santander» eran nueve llamadas a la
       Function. Sin texto (la lista de partida, o un cambio de filtro) se pide en el acto. */
    const espera = query.trim() ? window.setTimeout(buscar, ESPERA_ENTRE_TECLAS_MS) : null;
    if (espera === null) buscar();
    return () => {
      active = false;
      if (espera !== null) window.clearTimeout(espera);
    };
  }, [query, activeFilter, dataSource]);

  async function handleLoadMore() {
    if (!dataSource.searchAssetsPage || !searchCursor || isLoadingMore) {
      return;
    }
    const signature = liveSearch.current;
    setIsLoadingMore(true);
    try {
      const page = await dataSource.searchAssetsPage({
        query,
        instrumentTypes: filterToInstrumentTypes(activeFilter),
        limit: PICKER_PAGE_LIMIT,
        cursor: searchCursor
      });
      if (liveSearch.current !== signature) {
        return;
      }
      setResults((current) => {
        const seen = new Set(current.map((asset) => asset.asset_id));
        return [...current, ...page.results.filter((asset) => !seen.has(asset.asset_id))];
      });
      setSearchTotal(page.totalMatches);
      setSearchCursor(page.nextCursor);
    } catch (cause) {
      if (liveSearch.current !== signature) {
        return; // el fallo es de una búsqueda que ya no está en pantalla
      }
      appLogger.warn("selector de activos: no se pudo cargar la página siguiente", cause);
      setSearchError("No se pudo cargar el resto del catálogo; reinténtalo.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  // Categoria (clase) y subcategoria solo aplican cuando el proveedor las informa.
  const showTipo = activeFilter === "ALL" || activeFilter === "FUND" || activeFilter === "ETF";

  const regionOptions = useMemo(
    () => Array.from(new Set(results.map((a) => a.region).filter((v): v is string => Boolean(v)))).sort((a, b) => regionLegible(a).localeCompare(regionLegible(b), "es")),
    [results]
  );
  /* ACT-19: las clases salen del dato, como en el Buscador, y no de una lista escrita a mano que dejaba fuera el
     inmobiliario y lo sin clasificar: una clase que la lista no tiene no se ofrece, y una nueva aparece sola. La elegida
     se queda en la lista aunque la búsqueda nueva no la traiga, para que el desplegable diga qué filtra. */
  const classOptions = useMemo(() => {
    const vistas = new Set<string>(results.map((a) => a.economic_asset_class).filter(Boolean));
    if (assetClass !== "ALL") vistas.add(assetClass);
    const opciones = [...vistas];
    return opciones.sort((a, b) => rotuloDeClase(a).localeCompare(rotuloDeClase(b), "es"));
  }, [results, assetClass]);
  /* Una opción por nombre (decisión 101): la misma categoría en dos idiomas es una sola, y elegirla trae los activos de las dos. */
  const categoryOptions = useMemo(
    () => Array.from(new Set(results.map((a) => categoriaLegible(a.category)).filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b, "es")),
    [results]
  );

  const visible = useMemo(
    () =>
      results.filter(
        (a) =>
          (region === "ALL" || a.region === region) &&
          (assetClass === "ALL" || !showTipo || a.economic_asset_class === assetClass) &&
          (category === "ALL" || !showTipo || categoriaLegible(a.category) === category)
      ),
    [results, region, assetClass, category, showTipo]
  );

  const atMax = selectedIds.length >= max;
  // T7.3: aviso honesto del universo — «cargados X de Y» o «puede estar
  // recortada» — con el resto alcanzable por cursor, igual que el buscador.
  const universeNotice = buildUniverseNotice(
    results.length,
    searchTotal,
    query.trim() ? PICKER_QUERY_LIMIT : PICKER_PAGE_LIMIT
  );
  const canLoadMore = Boolean(dataSource.searchAssetsPage) && hasMoreUniverse(searchCursor, results.length, searchTotal);

  return (
    <div className="asset-picker">
      <div className="asset-search-controls">
        <label className="asset-search-input">
          <span>Buscar</span>
          <input
            type="search"
            placeholder="Nombre, ticker o ISIN"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="asset-search-select">
          <span>Región</span>
          <select value={region} onChange={(event) => updateFilters({ region: event.target.value })}>
            <option value="ALL">Todas</option>
            {regionOptions.map((value) => (
              <option key={value} value={value}>
                {regionLegible(value)}
              </option>
            ))}
          </select>
        </label>
        {showTipo ? (
          <label className="asset-search-select">
            <span>Clase de activo</span>
            <select value={assetClass} onChange={(event) => updateFilters({ assetClass: event.target.value })}>
              <option value="ALL">Todas</option>
              {classOptions.map((value) => (
                <option key={value} value={value}>
                  {rotuloDeClase(value)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {showTipo && categoryOptions.length > 0 ? (
          <label className="asset-search-select">
            <span>Categoría</span>
            <select value={category} onChange={(event) => updateFilters({ category: event.target.value })}>
              <option value="ALL">Todas</option>
              {categoryOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {/* En su propia fila: junto a los campos se cortaba sin ninguna señal. */}
        <div className="asset-search-select asset-search-tipo">
          <span>Producto</span>
          <AssetSearchFilters
            activeFilter={activeFilter}
            onFilterChange={(nextFilter) => updateFilters({ activeFilter: nextFilter })}
          />
        </div>
      </div>

      <AssetPickerErrorFeedback message={searchError} />

      <p className="asset-picker-count">
        {numero(visible.length)} activos
        {universeNotice ? <em> · {universeNotice}</em> : null}
        {canLoadMore ? (
          <Button
            onClick={() => void handleLoadMore()}
            size="sm"
            variant="quiet"
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "Cargando…" : `Cargar ${PICKER_PAGE_LIMIT} más`}
          </Button>
        ) : null}
      </p>

      <ul className="asset-picker-list">
        {visible.map((a) => {
          const already = selectedIds.includes(a.asset_id);
          /* Se ve y se marca, y no se elige (decisión 44): en esta fila no hay nada que comparar. */
          const sinMedir = sinPrecioNiMetricas(a);
          return (
            <li key={a.asset_id}>
              <button
                type="button"
                className="asset-picker-row"
                disabled={already || atMax || sinMedir}
                onClick={() => onPick(a)}
              >
                {/* Como una fila de las tablas de activos (Óscar, 17-11-2026): el nombre con su ISIN en la mono debajo, y la
                    categoría y la región en gris, cada una en su columna. */}
                <span className="apk-name">
                  {a.display_name}
                  <span className="apk-isin">{a.isin ?? a.ticker ?? a.asset_id}</span>
                  {sinMedir ? <span className="apk-motivo">{NO_SE_ANADE_SIN_MEDIR}</span> : null}
                </span>
                <span className="apk-class">{categoriaLegible(a.category) ?? CLASS_LABELS[a.economic_asset_class] ?? a.economic_asset_class}</span>
                {/* ACT-19: la región, con el mismo nombre que en el desplegable de arriba, no con su código. */}
                <span className="apk-region">{a.region ? regionLegible(a.region) : ""}</span>
                <span className="apk-add">{already ? "✓" : sinMedir ? "–" : "+"}</span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 ? <li className="asset-picker-empty">Sin resultados con esos filtros.</li> : null}
      </ul>
    </div>
  );
}
