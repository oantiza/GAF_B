import { useEffect, useMemo, useState } from "react";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import {
  EMPTY_SWAP_FILTERS, filterSwapAlternatives, isHomogeneousAlternative, isSwapCandidate, motivoSinAlternativas, sectorComparable, sectorLegible, seVeSinPoderElegirse,
  type SwapAlternative, type SwapSearchFilters, type SwapSearchMode
} from "../core/fundSwapper";
import { NO_SE_ANADE_SIN_MEDIR } from "../core/accionDeCartera";
import { categoriaLegible } from "../core/etiquetasDeReparto";
import { effectiveCommercialRetroPct } from "../core/commercialRetroEffective";
import { importe, oFalta, porcentaje } from "../core/formato";
import { seEnsenaLaMetrica } from "../core/metricasPorInstrumento";
import { Ausencia } from "./ui/Ausencia";
import { useCommercialRetroData } from "../core/useCommercialRetroData";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { SegmentedControl, type SegmentedControlOption } from "./ui/SegmentedControl";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { useConfirm } from "./ui/useConfirm";
import {
  sortSwapAlternativesForPresentation,
  type SwapPreserveMode,
  type SwapSelectionOptions
} from "../core/fundSwapPresentation";
import { useClientMode } from "../app/ClientModeContext";
import { CLASS_LABELS, TYPE_LABELS, readableBackendLabel } from "../core/labels";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../core/textosDeCartera";
import { TablaDeAlternativas } from "./TablaDeAlternativas";

interface FundSwapModalProps {
  assets: BdbAssetDetail[];
  positions: BdbManualPortfolioPosition[];
  onFindAlternatives: (assetId: string, mode?: SwapSearchMode) => Promise<SwapAlternative[]>;
  onSwap: (oldId: string, newId: string, newLabel: string, options: SwapSelectionOptions) => void;
  onClose: () => void;
  initialSelectedAssetId?: string | null;
  totalCapital?: number;
}

const SEARCH_OPTIONS: readonly SegmentedControlOption<SwapSearchMode>[] = [
  { id: "homogeneous", label: "Alternativas homogéneas" },
  { id: "custom", label: "Elegir otro activo" }
];
const RESULTS_PER_PAGE = 20;

const PRESERVE_OPTIONS: readonly SegmentedControlOption<SwapPreserveMode>[] = [
  { id: "weight", label: "Mantener %" },
  { id: "money", label: "Mantener €" }
];

/** Lo que no se sabe de un fondo, dentro de una frase que dice qué cambia: «región: sin dato → Europa». Nunca «N/D». */
const SIN_DATO = "sin dato";

export function FundSwapModal({
  assets,
  positions,
  onFindAlternatives,
  onSwap,
  onClose,
  initialSelectedAssetId,
  totalCapital
}: FundSwapModalProps) {
  const { enabled: clientMode } = useClientMode();
  const { confirm, confirmDialog } = useConfirm();
  /* DIS-28: aquí había un `investable` que filtraba por peso ≥ 0, y dejaba pasar todas: se sustituye cualquier posición. */
  const [selectedId, setSelectedId] = useState<string>(initialSelectedAssetId ?? positions[0]?.asset_id ?? "");
  const [searchMode, setSearchMode] = useState<SwapSearchMode>("homogeneous");
  const [filters, setFilters] = useState<SwapSearchFilters>(EMPTY_SWAP_FILTERS);
  const [visibleCount, setVisibleCount] = useState(RESULTS_PER_PAGE);
  const [preserveMode, setPreserveMode] = useState<SwapPreserveMode>("weight");
  const [result, setResult] = useState<{ key: string; alts: SwapAlternative[] }>({ key: "", alts: [] });
  const [alternativesError, setAlternativesError] = useState<unknown>(null);
  const [alternativesReloadKey, setAlternativesReloadKey] = useState(0);
  const selectedAsset = useMemo(() => assets.find((asset) => asset.asset_id === selectedId) ?? null, [assets, selectedId]);
  const selectedPosition = useMemo(
    () => positions.find((position) => position.asset_id === selectedId) ?? null,
    [positions, selectedId]
  );
  const esAccion = selectedAsset?.instrument_type === "STOCK";
  /* Lo que conserva «Mantener €»: el importe de hoy de la posición, si el capital está fijado. */
  const importeQueSeMantiene =
    typeof totalCapital === "number" && totalCapital > 0 && selectedPosition
      ? (selectedPosition.weight_percent / 100) * totalCapital
      : undefined;

  const requestKey = `${selectedId}:${searchMode}:${alternativesReloadKey}`;

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    let active = true;
    setAlternativesError(null);
    onFindAlternatives(selectedId, searchMode)
      .then((res) => {
        if (active) setResult({ key: requestKey, alts: res });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setResult({ key: requestKey, alts: [] });
        setAlternativesError(cause);
      });
    return () => {
      active = false;
    };
  }, [requestKey, searchMode, selectedId, onFindAlternatives]);

  const settled = result.key === requestKey;
  const loading = Boolean(selectedId) && !settled;
  const alts = useMemo(() => {
    if (!settled) return [];
    const excluded = new Set(positions.map((position) => position.asset_id));
    return result.alts.filter(({ asset }) =>
      !excluded.has(asset.asset_id)
      && (searchMode === "custom"
        ? isSwapCandidate(asset) || seVeSinPoderElegirse(asset)
        : selectedAsset && isHomogeneousAlternative(selectedAsset, asset))
    );
  }, [positions, result.alts, searchMode, selectedAsset, settled]);
  const filteredAlts = useMemo(
    () => searchMode === "custom" ? filterSwapAlternatives(alts, filters) : alts,
    [alts, filters, searchMode]
  );
  const facets = useMemo(() => {
    const base = filterSwapAlternatives(alts, { ...filters, query: "", category: "ALL", region: "ALL" });
    const categoryBase = filterSwapAlternatives(base, { ...EMPTY_SWAP_FILTERS, region: filters.region });
    const values = (rows: SwapAlternative[], valor: (asset: SwapAlternative["asset"]) => string | null | undefined) =>
      [...new Set(rows.map(({ asset }) => valor(asset)).filter((value): value is string => Boolean(value?.trim())))].sort((a, b) => a.localeCompare(b, "es"));
    /* Una opción por nombre de categoría (decisión 101): la misma en dos idiomas es una sola, y elegirla trae las dos. */
    return { regions: values(base, (asset) => asset.region), categories: values(categoryBase, (asset) => categoriaLegible(asset.category)) };
  }, [alts, filters]);

  /* Decisión 17: el orden no mira lo que cobra el asesor. La retrocesión queda como dato en su columna. */
  const sortedAlts = useMemo(
    () => sortSwapAlternativesForPresentation(filteredAlts, searchMode === "custom" ? filters.query : ""),
    [filteredAlts, filters.query, searchMode]
  );
  const retroAssets = useMemo(
    () => [...(selectedAsset ? [selectedAsset] : []), ...sortedAlts.slice(0, visibleCount).map((alt) => alt.asset)],
    [selectedAsset, sortedAlts, visibleCount]
  );
  const { records: retros, error: retroError, retry: retryRetro } = useCommercialRetroData(clientMode ? [] : retroAssets);
  const currentRetro = selectedAsset ? effectiveCommercialRetroPct(selectedAsset.asset_id, retros) : null;

  function changeFilters(update: Partial<SwapSearchFilters>) {
    setFilters((current) => ({ ...current, ...update }));
    setVisibleCount(RESULTS_PER_PAGE);
  }

  function changeSearchMode(mode: SwapSearchMode) {
    setSearchMode(mode);
    setFilters({ ...EMPTY_SWAP_FILTERS, instrumentType: selectedAsset?.instrument_type ?? "ALL" });
    setVisibleCount(RESULTS_PER_PAGE);
  }

  async function handleApplySwap(alt: SwapAlternative) {
    const a = alt.asset;
    if (!isSwapCandidate(a) || positions.some((position) => position.asset_id === a.asset_id)) return;
    if (searchMode === "homogeneous" && (!selectedAsset || !isHomogeneousAlternative(selectedAsset, a))) return;
    const divergences = selectedAsset
      ? [
          selectedAsset.economic_asset_class !== a.economic_asset_class
            ? `clase: ${CLASS_LABELS[selectedAsset.economic_asset_class]} → ${CLASS_LABELS[a.economic_asset_class]}`
            : null,
          selectedAsset.instrument_type !== a.instrument_type
            ? `producto: ${TYPE_LABELS[selectedAsset.instrument_type]} → ${TYPE_LABELS[a.instrument_type]}`
            : null,
          selectedAsset.currency !== a.currency ? `divisa: ${selectedAsset.currency} → ${a.currency}` : null,
          (selectedAsset.region ?? "") !== (a.region ?? "") ? `región: ${selectedAsset.region ?? SIN_DATO} → ${a.region ?? SIN_DATO}` : null,
          esAccion && a.instrument_type === "STOCK" && sectorComparable(selectedAsset) !== sectorComparable(a)
            ? `sector: ${sectorLegible(selectedAsset) ?? SIN_DATO} → ${sectorLegible(a) ?? SIN_DATO}`
            : null,
          /* Por el nombre que se enseña: la misma categoría en dos idiomas no es un cambio (decisión 101). */
          (categoriaLegible(selectedAsset.category) ?? "") !== (categoriaLegible(a.category) ?? "")
            ? `categoría: ${categoriaLegible(selectedAsset.category) ?? SIN_DATO} → ${categoriaLegible(a.category) ?? SIN_DATO}`
            : null
        ].filter((item): item is string => Boolean(item))
      : [];

    if (
      divergences.length > 0 &&
      !(await confirm({
        title: "La sustitución cambia estas características",
        message: `${divergences.join("\n")}\n\n¿Quieres aplicar igualmente la sustitución?`,
        confirmLabel: "Aplicar la sustitución"
      }))
    ) {
      return;
    }

    const targetEuros = preserveMode === "money" ? importeQueSeMantiene : undefined;
    onSwap(selectedId, a.asset_id, a.display_name, { preserveMode, targetEuros });
    onClose();
  }

  return (
    <ModalDialog labelledBy="fund-swap-modal-title" onClose={onClose} size="lg" className="swap-dialog">
        <DialogHeader
          titleId="fund-swap-modal-title"
          eyebrow="Cartera"
          title={searchMode === "homogeneous" ? "Alternativas homogéneas" : "Elegir otro activo"}
          onClose={onClose}
          actions={
            <SegmentedControl
              options={PRESERVE_OPTIONS}
              value={preserveMode}
              onChange={setPreserveMode}
              label="Qué se mantiene al sustituir"
            />
          }
        />

        <DialogBody>
          <Campo className="swap-position-field" rotulo="Posición a sustituir">
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setSearchMode("homogeneous");
                setFilters(EMPTY_SWAP_FILTERS);
                setVisibleCount(RESULTS_PER_PAGE);
              }}
            >
              {positions.length === 0 ? <option value="">Sin posiciones</option> : null}
              {positions.map((p) => (
                <option key={p.asset_id} value={p.asset_id}>{assets.find((asset) => asset.asset_id === p.asset_id)?.display_name ?? p.label ?? p.asset_id}</option>
              ))}
            </select>
          </Campo>
          {/* DIS-26: «Mantener %» y «Mantener €» dejan hoy el mismo peso; la diferencia es para después, y se dice antes de pulsar. */}
          {preserveMode === "money" ? (
            <p className="field__hint">
              {importeQueSeMantiene !== undefined
                ? `La nueva posición queda con importe fijo: conserva sus ${oFalta(importe(importeQueSeMantiene))} si cambia el capital, y no se reescala.`
                : "La nueva posición queda con importe fijo: conserva su importe si cambia el capital, y no se reescala."}
            </p>
          ) : null}
          <div className="swap-search-mode">
            <SegmentedControl options={SEARCH_OPTIONS} value={searchMode} onChange={changeSearchMode} label="Cómo buscar la sustitución" />
            <p className="field__hint">
              {searchMode === "homogeneous"
                ? esAccion
                  ? sectorLegible(selectedAsset)
                    ? `Acciones de su sector: ${sectorLegible(selectedAsset)}. Muy afín si además son de su región.`
                    : "Sin el sector de esta acción no se puede proponer un equivalente."
                  : `Mismo producto y clase de activo${selectedAsset ? `: ${TYPE_LABELS[selectedAsset.instrument_type]} · ${CLASS_LABELS[selectedAsset.economic_asset_class]}` : ""}.`
                : "Elige el producto y la clase de activo que buscas. Puedes sustituir por un activo de otro tipo."}
            </p>
          </div>
          {searchMode === "custom" ? (
            <div className="swap-search-filters">
              <Campo className="swap-search-query" rotulo="Nombre, ISIN o ticker">
                <input type="search" value={filters.query} onChange={(event) => changeFilters({ query: event.target.value })} placeholder="Buscar en el catálogo" />
              </Campo>
              <Campo rotulo="Producto">
                <select value={filters.instrumentType} onChange={(event) => changeFilters({ ...EMPTY_SWAP_FILTERS, query: filters.query, instrumentType: event.target.value as SwapSearchFilters["instrumentType"] })}>
                  <option value="ALL">Todos los productos</option>
                  <option value="FUND">Fondos</option><option value="ETF">ETF</option><option value="STOCK">Acciones</option>
                </select>
              </Campo>
              <Campo rotulo="Clase de activo">
                <select value={filters.assetClass} onChange={(event) => changeFilters({ assetClass: event.target.value as SwapSearchFilters["assetClass"], category: "ALL", region: "ALL" })}>
                  <option value="ALL">Todas las clases</option>
                  {Object.entries(CLASS_LABELS).map(([value, label]) => <option key={value} value={value}>{value === "UNKNOWN" ? "Sin clasificar" : label}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Categoría">
                <select value={filters.category} onChange={(event) => changeFilters({ category: event.target.value })}>
                  <option value="ALL">Todas las categorías</option>
                  {facets.categories.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Región">
                <select value={filters.region} onChange={(event) => changeFilters({ region: event.target.value, category: "ALL" })}>
                  <option value="ALL">Todas las regiones</option>
                  {facets.regions.map((value) => <option key={value} value={value}>{readableBackendLabel(value)}</option>)}
                </select>
              </Campo>
            </div>
          ) : null}
          {!clientMode ? <div className="swap-retro-controls"><p className="field__hint">
            Retrocesión actual: {!seEnsenaLaMetrica("retrocesion", selectedAsset?.instrument_type) ? <Ausencia clase="no-aplica" /> : currentRetro != null ? <strong>{oFalta(porcentaje(currentRetro / 100))}</strong> : <Ausencia clase="falta" />}
          </p></div> : null}

          {!clientMode && retroError ? <AsyncErrorBanner error={retroError} onRetry={retryRetro} /> : null}

          {loading ? (
            <p className="ui-async-state">Buscando alternativas…</p>
          ) : alternativesError ? (
            <AsyncErrorBanner
              error={alternativesError}
              onRetry={() => setAlternativesReloadKey((current) => current + 1)}
            />
          ) : !sortedAlts || sortedAlts.length === 0 ? (
            <div className="ui-empty-state">
              <p>{searchMode === "homogeneous" ? `${motivoSinAlternativas(selectedAsset)} Puedes usar «Elegir otro activo».` : "No hay activos que coincidan con estos filtros. Prueba otra clase o producto, o modifica la búsqueda."}</p>
            </div>
          ) : (
            <div className="swap-results">
              <p className="cmp-note">
                {esAccion
                  ? "Por afinidad y, dentro de ella, por nombre: el orden no mira la rentabilidad pasada. Las cifras de riesgo de distinta frecuencia no son directamente comparables."
                  : "La afinidad prima en el orden. Dentro de ella, solo se ordenan entre sí las alternativas con cifras del mismo cálculo y de la misma fecha de cierre: por Sharpe a 3 años si todas lo tienen y, si no, por rentabilidad a 3 años. Si no coinciden, la lista va por grupos y se dice debajo. Las cifras de riesgo de distinta frecuencia no son directamente comparables."}
              </p>
              <TablaDeAlternativas
                accion={(alt) =>
                  seVeSinPoderElegirse(alt.asset) ? (
                    NO_SE_ANADE_SIN_MEDIR
                  ) : (
                    <Button size="sm" aria-label={`Cambiar por ${alt.asset.display_name}`} onClick={() => void handleApplySwap(alt)}>
                      Cambiar
                    </Button>
                  )
                }
                alternativas={sortedAlts.slice(0, visibleCount)}
                retrocesionActual={currentRetro}
                retrocesiones={retros}
                titulo="Alternativas de sustitución"
              />
            </div>
          )}
          {!loading && !alternativesError && sortedAlts.length > 0 ? (
            <div className="swap-results-footer" aria-live="polite">
              <span>{Math.min(visibleCount, sortedAlts.length)} de {sortedAlts.length} alternativas</span>
              {visibleCount < sortedAlts.length ? <Button variant="secondary" size="sm" onClick={() => setVisibleCount((count) => count + RESULTS_PER_PAGE)}>Mostrar más</Button> : null}
            </div>
          ) : null}
        </DialogBody>

        {/* «Cambiar» aplica en el momento y cambiar de fondo es vender uno y comprar otro: se dice antes de pulsar. */}
        <DialogFooter nota={SIN_COMISIONES_NI_IMPUESTOS}>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
        {confirmDialog}
    </ModalDialog>
  );
}
