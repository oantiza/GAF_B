import { useMemo } from "react";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { GeoDistributionMap } from "../charts/GeoDistributionMap";
import { computeEquityRegionAllocation } from "../core/equityRegions";
import { oFalta, peso } from "../core/formato";
import { NOTA_CANADA_Y_AFRICA } from "../core/regionTaxonomy";
import { NO_DECLARADO } from "./xrayBreakdownLabels";
import { Ausencia } from "./ui/Ausencia";
import { Panel } from "./ui/Panel";

interface RegionAllocationProps {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  /**
   * `side` (B″): bloque de la columna lateral del Constructor — título
   * «Renta variable por región», mapa apilado y barras por macro-zona.
   */
  variant?: "default" | "side";
}

/**
 * Distribución geográfica de la cartera como mapa coroplético (GeoDistributionMap). Reparte solo lo que declara cada
 * activo: lo demás se dice, «No declarado», con la pieza Ausencia y una sola vez por panel. Las filas son % de TODA la RV.
 */
export function RegionAllocation({ positions, assets, variant = "default" }: RegionAllocationProps) {
  const allocation = useMemo(() => computeEquityRegionAllocation(positions, assets), [positions, assets]);
  const rows = allocation.rows;
  const noDeclarado = allocation.unclassified_weight_percent;
  /* Mientras el dato venga en la forma antigua (decisión 7). Desaparece sola con la próxima pasada del extractor. */
  const nota = allocation.canadaYAfricaSinSeparar ? NOTA_CANADA_Y_AFRICA : null;

  const body =
    rows.length > 0 ? (
      <GeoDistributionMap
        rows={rows}
        layout={variant === "side" ? "stacked" : "wide"}
        unclassifiedPercent={noDeclarado}
        nota={nota}
      />
    ) : noDeclarado > 0 ? (
      <Ausencia clase="falta" motivo={`${NO_DECLARADO}: ${oFalta(peso(noDeclarado / 100))} de la renta variable`} />
    ) : (
      <Ausencia clase="no-aplica" motivo="Sin renta variable en esta cartera" />
    );

  if (variant === "side") {
    return (
      <Panel
        className="region-allocation--side"
        subtitulo={`Lo que declara cada activo · intensidad = peso${nota ? ` · ${nota}` : ""}`}
        titulo="Renta variable por región"
        tituloId="region-allocation-side-title"
      >
        {body}
      </Panel>
    );
  }

  return (
    <Panel subtitulo="Lo que declara cada activo, en % de la renta variable." titulo="Distribución geográfica">
      {body}
    </Panel>
  );
}
