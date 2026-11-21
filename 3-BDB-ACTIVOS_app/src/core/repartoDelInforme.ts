/**
 * El reparto de una cartera tal como lo leen los informes: la exposición por clase económica, la geografía de la renta variable
 * agrupada en las zonas del mapa, y las cifras que van bajo el mapa (INF-20).
 *
 * Vivían dentro del informe de cliente (`reports/informeDeCliente/datos.ts`), y la comparativa de propuestas las importaba de
 * otro informe. Aquí hay una sola definición, pura y sin @react-pdf, que importan los dos. Es un traslado: las mismas entradas
 * dan las mismas salidas (`tests/logicaDelPapelEnCore.test.ts`).
 */
import { aggregateToAreas, regionKeyToArea } from "../charts/worldMapGeo";
import type { BdbPortfolioReport } from "../types/bdbAssets";
import { NO_DECLARADO, SIN_SITUAR } from "./etiquetasDeReparto";
import { computePmsExposureDistribution } from "./portfolio";
import { esFilaSinDato, FUERA_DEL_REPARTO } from "./repartoDelPapel";

function safeNumber(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------------------------------------ La exposición */

/**
 * La exposición de la cartera por clase económica, en % de lo invertible: la del análisis (`xray.pms_exposure_percent`) si la trae;
 * sin ella, el recálculo local por la MISMA vía canónica que la pantalla (`computePmsExposureDistribution`).
 */
export function deriveExposure(report: BdbPortfolioReport) {
  const direct = report.xray?.pms_exposure_percent;
  if (direct) {
    return {
      equity: safeNumber(direct.equity) ?? 0,
      fixed_income: safeNumber(direct.fixed_income) ?? 0,
      cash: safeNumber(direct.cash) ?? 0,
      alternative: safeNumber(direct.alternative) ?? 0,
      real_asset: safeNumber(direct.real_asset) ?? 0,
      other: safeNumber(direct.other) ?? 0
    };
  }
  // S6a (P5): sin xray, el recálculo local usa la MISMA vía canónica que la pantalla.
  const distribution = computePmsExposureDistribution(report.positions.filter((position) => position.is_investable !== false));
  return distribution?.percent ?? { equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 };
}

/* ------------------------------------------------------------------------------------------------ La geografía */

export function buildReportGeography(rows: Array<{ key: string; weight_percent: number }>, equityLookThrough = false) {
  const totals = aggregateToAreas(rows);
  const sourceTotal = rows.reduce((sum, row) => sum + Math.max(0, safeNumber(row.weight_percent) ?? 0), 0);
  const mappedTotal = Object.values(totals).reduce((sum, value) => sum + Math.max(0, value), 0);
  // The residual must use the map's own classification. A region such as
  // Iberia is mapped to Europe and must not also appear as unassigned.
  const unassigned = Math.max(0, (equityLookThrough ? 100 : sourceTotal) - mappedTotal);
  /* Lo que el dato nombra y el mapa no sabe situar no es lo que no se declara: un fondo da sus regiones por país, y la ficha de otro dice «Global». */
  const sinSituar = Math.min(unassigned, rows
    .filter((row) => regionKeyToArea(row.key) === null && !esFilaSinDato(row.key))
    .reduce((sum, row) => sum + Math.max(0, safeNumber(row.weight_percent) ?? 0), 0));
  return { totals, unassigned, sinSituar, noDeclarado: unassigned - sinSituar };
}

/** Una cifra bajo el mapa. `sinZona`: lo que no es una zona del mapa (no declarado, sin situar, fuera del reparto). */
export interface CifraDelMapa {
  id: string;
  label: string;
  value: number;
  sinZona?: boolean;
  /**
   * Las zonas del mapa que pinta, cuando son varias: «Asia y Pacífico» del gestor de carteras es Asia, Japón y Oceanía, y no se
   * sabe cuánto va a cada una. Se pintan las tres con el color de la cifra (el de su `id`), sin repartir nada. Sin él, la cifra
   * pinta solo la zona de su `id`.
   */
  zonas?: readonly string[];
}

/**
 * Las cifras bajo el mapa: caben cinco. Lo que no quepa se suma en una sola, porque las cifras tienen que sumar lo mismo que la renta
 * variable: antes, con lo que no tiene zona, Oriente Medio se caía sin decirlo. «No declarado» y «Sin situar» solo salen si queda de verdad
 * algo sin zona.
 */
export function cifrasDelMapa(
  areas: ReadonlyArray<{ id: string; label: string; value: number }>,
  noDeclarado: number,
  sinSituar = 0,
  fueraDelReparto = 0
): CifraDelMapa[] {
  const sinZona: CifraDelMapa[] = [
    ...(noDeclarado > 0.05 ? [{ id: "unassigned", label: NO_DECLARADO, value: noDeclarado, sinZona: true }] : []),
    ...(sinSituar > 0.05 ? [{ id: "sin-situar", label: SIN_SITUAR, value: sinSituar, sinZona: true }] : []),
    ...(fueraDelReparto > 0.05 ? [{ id: "fuera-del-reparto", label: FUERA_DEL_REPARTO, value: fueraDelReparto, sinZona: true }] : [])
  ];
  const huecos = 5 - sinZona.length;
  const caben = areas.length > huecos ? huecos - 1 : huecos;
  const resto = areas.slice(caben).reduce((suma, area) => suma + area.value, 0);
  return [
    ...areas.slice(0, caben).map(({ id, label, value }) => ({ id, label, value })),
    ...(resto > 0 ? [{ id: "resto", label: "Resto de zonas", value: resto }] : []),
    ...sinZona
  ];
}
