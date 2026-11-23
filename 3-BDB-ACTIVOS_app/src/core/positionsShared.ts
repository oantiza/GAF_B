import type { BdbAssetDetail } from "../types/bdbAssets";
import type { ParteSinLeer } from "./appError";
import { celdaCsv } from "./celdaCsv";
import { descargar } from "./descargaDeFicheros";
import { oFalta, puntos } from "./formato";
import type { PositionImportEntry } from "./positionImport";

/**
 * U-09 (auditoría 29-09). Lo que Extracto externo y Posiciones globales
 * compartían por copia: fila resuelta, formato de la diferencia de
 * retrocesión, celda CSV, resolución de filas contra la fuente y descarga.
 * Los dos destinos siguen existiendo (decisión de producto: no se fusionan
 * sin Oscar); el código, no.
 */

export interface PositionRow {
  id: string;
  amount: number;
  asset: BdbAssetDetail | null;
  /** Lo que la base no pudo leer de esta posición: no es que no exista. Ver `AssetResolvedPosition.sinLeer`. */
  sinLeer?: ParteSinLeer[];
}

/**
 * Los tres estados de una posición (20-11-2026): reconocida en el catálogo, no reconocida (la base contestó y no la
 * tiene) y no se pudo leer (la base no contestó por ella: no consta que no exista, y se arregla volviendo a analizar).
 * Hasta ese día la tabla y el Excel solo tenían los dos primeros, y una posición sin leer salía «No reconocida».
 */
export type PositionRowStatus = "found" | "missing" | "unread";

/** El estado de una fila: con activo, reconocida; sin él, no se pudo leer si la base dijo que no la leyó, y si no, no reconocida. */
export function estadoDeLaPosicion(row: Pick<PositionRow, "asset" | "sinLeer">): PositionRowStatus {
  if (row.asset) return "found";
  return row.sinLeer && row.sinLeer.length > 0 ? "unread" : "missing";
}

/** Cómo se dice cada estado en la tabla y en el Excel. */
export const TEXTO_DEL_ESTADO: Record<PositionRowStatus, string> = {
  found: "Reconocida",
  missing: "No reconocida",
  unread: "No se pudo leer"
};
export type PositionFilterStatus = "all" | PositionRowStatus;
export type PositionSortDirection = "asc" | "desc";

/**
 * Diferencia de retrocesión, que es una resta de dos porcentajes: va en puntos, «+0,15 pp», con dos decimales, los
 * mismos que la columna Retrocesión de la misma tabla. Recibe puntos (0,15 es un 0,15 %). Si falta, «Falta el dato».
 */
export const RETRO_POINT_DIGITS = 2;

export function fmtRetroPoints(value: number | null | undefined): string {
  return oFalta(puntos(typeof value === "number" ? value / 100 : value));
}

export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  /* Una cifra no se neutraliza nunca: `-12.5` sale «-12,5». Un texto que una hoja leería como fórmula, sí (`celdaCsv`, P1-08). */
  return celdaCsv(typeof value === "number" ? String(value).replace(".", ",") : value);
}

export function resolveRowsFromAssets(entries: PositionImportEntry[], assets: BdbAssetDetail[]): PositionRow[] {
  const byKey = new Map<string, BdbAssetDetail>();
  assets.forEach((asset) => {
    byKey.set(asset.asset_id.toLowerCase(), asset);
    if (asset.isin) byKey.set(asset.isin.toLowerCase(), asset);
    if (asset.ticker) byKey.set(asset.ticker.toLowerCase(), asset);
  });
  return entries.map((entry) => ({
    id: entry.id,
    amount: entry.amount,
    asset: byKey.get(entry.id.toLowerCase()) ?? null
  }));
}

/** ¿La fila responde a la búsqueda libre (id, ISIN, ticker o nombre)? */
export function positionRowMatches(row: PositionRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.id, row.asset?.asset_id, row.asset?.isin, row.asset?.ticker, row.asset?.display_name]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

/**
 * Orden estable: empates por posición original; cadenas con `localeCompare("es")`.
 * `valueOf` devuelve el valor comparable de cada fila para la clave activa.
 */
export function sortPositionRows<T>(
  rows: T[],
  valueOf: (row: T) => string | number,
  direction: PositionSortDirection
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = valueOf(a.row);
      const bv = valueOf(b.row);
      let cmp: number;
      if (typeof av === "string" || typeof bv === "string") {
        cmp = String(av).localeCompare(String(bv), "es");
      } else {
        cmp = av - bv;
      }
      if (cmp === 0) {
        cmp = a.index - b.index;
      }
      return direction === "asc" ? cmp : -cmp;
    })
    .map((item) => item.row);
}

/** Genera el fichero CSV (BOM + `;`) y lo descarga con el nombre indicado. */
export function downloadCsv(lines: string[], fileName: string): void {
  downloadBlob(new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }), fileName);
}

/** La descarga común (`descargaDeFicheros.ts`): el enlace va al documento y la dirección se suelta un minuto después (INF-26). */
export function downloadBlob(blob: Blob, fileName: string): void {
  descargar(blob, fileName);
}
