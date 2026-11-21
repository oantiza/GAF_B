import { NO_DECLARADO } from "../core/etiquetasDeReparto";
import { EQUITY_BREAKDOWN_LABELS } from "../core/labels";

/** Clave de la porción sin dato: ausencia, no una categoría. */
export const UNCLASSIFIED_KEY = "sin_clasificar";
/** Lo que no publican: desde la decisión 11 no se estima nada, así que eso es lo único que puede pasar. */
export { NO_DECLARADO };

function titleCase(s: string): string {
  return s
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** Etiqueta legible de una clave de sector, estilo o tamaño de la RV. */
export function breakdownLabel(key: string): string {
  if (key === UNCLASSIFIED_KEY) return NO_DECLARADO;
  return EQUITY_BREAKDOWN_LABELS[key] ?? titleCase(key);
}

/**
 * Porciones del aro de sectores de Análisis. Las filas son % de TODA la RV (núcleo, `computeEquitySectorAllocation`), así que
 * sin la porción «No declarado» el aro repartía el 100 % entre filas que sumaban menos e inflaba cada sector (revisión 14-10,
 * ronda 2). «No declarado» va al final: es ausencia de dato.
 *
 * Sin colores (rediseño, 14-11-2026): el aro los decide por el orden y por el papel de cada porción —las de nombre propio, en el
 * orden de la paleta; «No declarado» y «Otros», en gris— y agrupa en «Otros» lo que pase de seis categorías
 * (`repartoConOtros` de `charts/oaa/chartTheme.ts`). Antes este fichero pintaba a mano lo mismo con otro criterio.
 */
export function sectorDonutSlices(rows: Array<{ key: string; weight_percent: number }>, unclassifiedPercent: number) {
  if (rows.length === 0) return [];
  return [
    ...rows.map((row) => ({ key: row.key, label: breakdownLabel(row.key), value: row.weight_percent })),
    ...(unclassifiedPercent > 0.05 ? [{ key: UNCLASSIFIED_KEY, label: NO_DECLARADO, value: unclassifiedPercent }] : [])
  ];
}
