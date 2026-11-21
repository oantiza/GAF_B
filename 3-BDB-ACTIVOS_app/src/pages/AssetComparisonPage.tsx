import { useEffect, useMemo, useRef, useState } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { AssetComparison } from "../components/AssetComparison";
import type { AssetFilterValue } from "../components/AssetSearchFilters";
import type { CarteraActivaParaComparar } from "../components/PortfolioComparator";
import type { BdbAssetDetail, BdbAssetSearchResult } from "../types/bdbAssets";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import { useAsyncData } from "../core/useAsyncData";
import { LoadingState } from "../components/ui/AsyncState";

/** Lo que contestó la lectura, con los ids que se le pidieron. */
interface RespuestaDeComparables {
  pedidos: string[];
  activos: BdbAssetDetail[];
}

/** El valor de partida, antes de que conteste la lectura: se compara por identidad. */
const SIN_RESPUESTA: RespuestaDeComparables = { pedidos: [], activos: [] };

interface AssetComparisonPageProps {
  assetIds: string[];
  sourceKind: AssetDataSourceKind;
  onRemove: (assetId: string) => void;
  onAdd: (assetId: string) => void;
  // Auditoría 11-08 (F1.3): la página solo media — pasa a AssetComparison el
  // handler de añadir a cartera de AssetSearch y los ids ya en cartera.
  onAddToPortfolio?: (asset: BdbAssetSearchResult) => void;
  portfolioAssetIds?: string[];
  carteraActiva?: CarteraActivaParaComparar;
  onIrACarterasGuardadas?: () => void;
  initialInstrumentFilter: AssetFilterValue;
}

export function AssetComparisonPage({
  assetIds,
  sourceKind,
  onRemove,
  onAdd,
  onAddToPortfolio,
  portfolioAssetIds,
  carteraActiva,
  onIrACarterasGuardadas,
  initialInstrumentFilter
}: AssetComparisonPageProps) {
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);
  const load = useAsyncData<RespuestaDeComparables>(
    () => dataSource.getComparableAssets(assetIds).then((activos) => ({ pedidos: assetIds, activos })),
    [assetIds, dataSource],
    { initialData: SIN_RESPUESTA }
  );
  const assets = load.data?.activos ?? SIN_RESPUESTA.activos;
  /* ACT-04: `useAsyncData` no marca «cargando» hasta su efecto, así que en el primer pintado se
     montaba el comparador vacío (con sus dos búsquedas), se desmontaba al empezar la carga y se
     volvía a montar al llegar. Lo que cuenta es si ya ha contestado: mientras no, se espera. */
  const aunSinRespuesta = load.data === SIN_RESPUESTA && !load.error;

  /* ACT-05: un id guardado que el catálogo ya no devuelve no se ve en pantalla ni se puede quitar,
     pero ocupaba sitio en el marco. Se quita de la selección (una sola vez por id) y se dice. Solo
     cuenta lo que se pidió en la respuesta que hay: un activo recién añadido aún no se ha pedido. */
  const depurados = useRef(new Set<string>());
  const [quitados, setQuitados] = useState<string[]>([]);
  useEffect(() => {
    if (!load.data || load.data === SIN_RESPUESTA || load.error) return;
    const pedidos = new Set(load.data.pedidos);
    const devueltos = new Set(
      load.data.activos.flatMap((asset) => [asset.asset_id, asset.isin]).filter(Boolean).map((id) => String(id).toUpperCase())
    );
    const perdidos = assetIds.filter(
      (id) => pedidos.has(id) && !devueltos.has(id.toUpperCase()) && !depurados.current.has(id)
    );
    if (perdidos.length === 0) return;
    for (const id of perdidos) {
      depurados.current.add(id);
      onRemove(id);
    }
    setQuitados((previos) => [...previos, ...perdidos]);
  }, [load.data, load.error, assetIds, onRemove]);

  if (assetIds.length > 0 && aunSinRespuesta) {
    return <LoadingState>Cargando activos seleccionados…</LoadingState>;
  }

  return (
    <>
      {load.error ? <AsyncErrorBanner error={load.error} onRetry={load.retry} /> : null}
      {quitados.length > 0 ? (
        <p className="asset-detail-muted" role="status">
          {quitados.length === 1
            ? `${quitados[0]} ya no está en el catálogo y se ha quitado de la comparación.`
            : `${quitados.join(", ")} ya no están en el catálogo y se han quitado de la comparación.`}
        </p>
      ) : null}
      <AssetComparison
        assets={assets}
        sourceKind={sourceKind}
        initialInstrumentFilter={initialInstrumentFilter}
        onAdd={onAdd}
        onAddToPortfolio={onAddToPortfolio}
        portfolioAssetIds={portfolioAssetIds}
        carteraActiva={carteraActiva}
        onIrACarterasGuardadas={onIrACarterasGuardadas}
        onRemove={onRemove}
      />
    </>
  );
}
