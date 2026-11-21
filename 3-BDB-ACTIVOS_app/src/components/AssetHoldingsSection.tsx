import { useAsyncData } from "../core/useAsyncData";
import { fecha, oFalta, peso } from "../core/formato";
import { holdingTypeLabel } from "../core/labels";
import { carteraPublicada } from "../core/carteraPublicada";
import { alcanceDeLaCartera } from "../core/cuentaDePosiciones";
import type { BdbAssetDetail, BdbAssetHoldings } from "../types/bdbAssets";
import { Ausencia } from "./ui/Ausencia";

interface AssetHoldingsSectionProps {
  asset: BdbAssetDetail;
  loadHoldings?: (assetId: string) => Promise<BdbAssetHoldings | null>;
}

/** Un peso, en puntos (35 = 35 %): un decimal, como todo peso. */
function formatHoldingWeight(value: number): string {
  return oFalta(peso(value / 100));
}

export function AssetHoldingsSection({ asset, loadHoldings }: AssetHoldingsSectionProps) {
  const hasHoldings = Boolean(asset.holdings_summary?.has_holdings);
  const load = useAsyncData<BdbAssetHoldings | null>(
    () => (loadHoldings ? loadHoldings(asset.asset_id) : Promise.resolve(null)),
    [asset.asset_id, loadHoldings],
    { enabled: hasHoldings && Boolean(loadHoldings), initialData: null }
  );

  if (!hasHoldings) {
    return null;
  }

  const holdings = load.data;
  const rows = holdings?.holdings.slice(0, 10) ?? [];
  const asOf = holdings?.as_of_date ?? asset.holdings_summary?.as_of_date;
  /* Hallazgo 20: cuántas posiciones tiene de verdad, si llegan solo las principales y cuánto patrimonio cubren. Lo dice la lista que ha
     llegado y, si no, el resumen del activo. Sin servidor al día, nada. */
  const deLaLista = holdings && (holdings.list_scope ?? holdings.securities_count ?? holdings.coverage) !== undefined;
  const alcance = alcanceDeLaCartera(deLaLista ? holdings : asset.holdings_summary, {
    lineas: holdings?.holdings.length,
    titulos: carteraPublicada(holdings)?.titulos
  });

  return (
    <section className="asset-detail-section asset-holdings-section" aria-labelledby="asset-holdings-title">
      <div className="asset-holdings-header">
        <div>
          <h2 className="asset-detail-titulo" id="asset-holdings-title">Principales posiciones subyacentes</h2>
          <p className="asset-detail-muted">
            {asOf && fecha(asOf) ? `Cartera a ${fecha(asOf)}` : "Fecha de la cartera no disponible"}
            {asset.holdings_summary?.top10_weight !== undefined
              ? ` · peso neto de las 10 mayores ${formatHoldingWeight(asset.holdings_summary.top10_weight)}`
              : ""}
            {alcance ? ` · ${alcance}` : ""}
          </p>
        </div>
      </div>

      {!loadHoldings ? (
        <p className="asset-detail-muted">Las posiciones subyacentes completas no están publicadas.</p>
      ) : load.loading ? (
        <div className="loading-note">
          <span className="loading-dot" aria-hidden="true" />
          Cargando posiciones subyacentes…
        </div>
      ) : load.error ? (
        <p className="asset-detail-muted">No se pudieron cargar las posiciones subyacentes.</p>
      ) : rows.length > 0 ? (
        <div aria-label="Posiciones subyacentes (tabla desplazable)" className="report-table-wrapper asset-holdings-table-wrapper" role="group" tabIndex={0}>
          <table className="report-table asset-holdings-table" aria-label="Posiciones subyacentes">
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">ISIN / ticker</th>
                <th scope="col">Peso</th>
                <th scope="col">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((holding) => (
                <tr key={holding.holding_id ?? `${holding.name}-${holding.isin ?? holding.ticker ?? ""}`}>
                  <td>{holding.name}</td>
                  <td>{holding.isin ?? holding.ticker ?? <Ausencia clase="falta" />}</td>
                  <td>
                    {formatHoldingWeight(holding.weight_pct)}
                  </td>
                  <td>{holding.holding_type ? holdingTypeLabel(holding.holding_type) : <Ausencia clase="falta" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="asset-detail-muted">Posiciones subyacentes completas no disponibles para esta ficha.</p>
      )}
    </section>
  );
}
