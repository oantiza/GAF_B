import { useMemo } from "react";
import { OaaDonutChart, breakdownQualityProps } from "../charts/oaa";
import { computeEquitySectorAllocation } from "../core/equitySectors";
import { pesoSinReparto } from "../core/portfolio";
import { fraseDelSinRepartoEnLaLectura } from "../core/radiografiaDeLaCartera";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { Ausencia } from "./ui/Ausencia";
import { Panel } from "./ui/Panel";
import { NO_DECLARADO } from "./xrayBreakdownLabels";

/**
 * Súper-sectores de renta variable (Cíclico / Sensible / Defensivo).
 * Pieza única del antiguo Resumen, recolocada en el Constructor con la
 * fusión de la ola 3b (§5.4) — la agregación y los colores son los mismos.
 */
const SUPER_SECTORS: { key: string; sectors: string[] }[] = [
  { key: "Cíclico", sectors: ["basic_materials", "consumer_cyclical", "financial_services", "real_estate"] },
  { key: "Sensible", sectors: ["communication_services", "energy", "industrials", "technology"] },
  { key: "Defensivo", sectors: ["consumer_defensive", "healthcare", "utilities"] }
];

interface SuperSectorsDonutProps {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
}

export function SuperSectorsDonut({ positions, assets }: SuperSectorsDonutProps) {
  const sectorAllocation = useMemo(() => computeEquitySectorAllocation(positions, assets), [assets, positions]);
  /* A-211: un fondo sin reparto de activos no entra en los sectores, y se dice. */
  const sinReparto = useMemo(() => fraseDelSinRepartoEnLaLectura(pesoSinReparto(positions, assets), "renta variable"), [assets, positions]);

  const superSectors = useMemo(() => {
    if (sectorAllocation.rows.length === 0) return [] as { key: string; weight_percent: number }[];
    const acc = new Map<string, number>();
    sectorAllocation.rows.forEach((sector) => {
      const group = SUPER_SECTORS.find((item) => item.sectors.includes(sector.key));
      acc.set(group?.key ?? "Otros RV", (acc.get(group?.key ?? "Otros RV") || 0) + sector.weight_percent);
    });
    const rows = Array.from(acc.entries())
      .map(([key, weight_percent]) => ({ key, weight_percent }))
      .filter((row) => row.weight_percent > 0.05)
      .sort((a, b) => b.weight_percent - a.weight_percent);
    // E3 (pasada 28-07): el donut debe cerrar el círculo — el peso de RV sin
    // sector conocido se enseña como «No declarado» (gris del resto, rol «Otros»),
    // no se omite. Solo cuando HAY sectores clasificados: sin ellos el donut
    // entero no se pinta y no procede un aro 100 % sin información.
    const classified = rows.reduce((sum, row) => sum + row.weight_percent, 0);
    const remainder = 100 - classified;
    if (rows.length > 0 && remainder > 0.05) {
      rows.push({ key: NO_DECLARADO, weight_percent: remainder });
    }
    return rows;
  }, [sectorAllocation.rows]);

  /* El color lo decide el aro por el orden y el papel (apartado 7 del sistema): «No declarado» va en el gris del
     resto, nunca en un color de serie, porque no es una categoría: es la ausencia de dato. */
  const chartRows = superSectors.map((row) => ({
    key: row.key,
    label: row.key,
    value: row.weight_percent
  }));

  if (chartRows.length === 0) {
    return null;
  }

  return (
    <Panel
      subtitulo="Cíclico, sensible y defensivo de la renta variable subyacente."
      titulo="Sectores de la renta variable"
    >
      <OaaDonutChart
        data={chartRows}
        height={218}
        innerRadius={52}
        outerRadius={78}
        {...breakdownQualityProps(sectorAllocation.quality)}
      />
      {sinReparto ? (
        <p className="xray-dist-pie">
          <Ausencia clase="falta" motivo={sinReparto} />
        </p>
      ) : null}
    </Panel>
  );
}
