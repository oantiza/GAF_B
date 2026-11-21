import type { BdbAssetDetail } from "../types/bdbAssets";
import type { CommercialRetroRecord } from "../types/commercialRetro";
import { esAccion } from "./esAccion";

export const COMMERCIAL_RETRO_SOURCE_LABEL = "Base comercial";

export interface EffectiveCommercialRetro {
  record: CommercialRetroRecord;
  pct: number;
  rate: number;
  source: "commercial_retro";
  sourceLabel: typeof COMMERCIAL_RETRO_SOURCE_LABEL;
}

export function isValidCommercialRetroPct(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * Lo más que puede valer una retrocesión de un fondo, en tanto por uno: lo que el fondo cobra. Auditoría del 16-11-2026
 * (RET-2). Una retrocesión es la parte de la comisión de gestión que la gestora cede, así que como porcentaje del
 * patrimonio no puede superarla. En la base conviven dos escalas —0,338 junto a 46—, y un 46 es casi seguro un
 * porcentaje de la comisión: usado tal cual, 100.000 € en un fondo que cobra un 1,5 % daban 46.000 € de ingreso al año.
 *
 * El tope es lo mayor que la ficha diga que cobra el fondo: sus gastos corrientes, que incluyen la comisión de gestión y
 * la de distribución si la hay, o la comisión de gestión si es lo único que trae. Es el tope más holgado a propósito:
 * lo que se busca es un error de escala, no afinar. `null` si la ficha no trae ninguna de las dos: sin con qué
 * comparar, no se juzga.
 */
export function topeDeLaRetrocesion(comisionDeGestion: number | null | undefined, gastosCorrientes: number | null | undefined): { tope: number; frenteA: "comisión de gestión" | "gastos corrientes" } | null {
  const valido = (valor: number | null | undefined): valor is number => typeof valor === "number" && Number.isFinite(valor) && valor > 0;
  const gestion = valido(comisionDeGestion) ? comisionDeGestion : null;
  const corrientes = valido(gastosCorrientes) ? gastosCorrientes : null;
  if (corrientes !== null && (gestion === null || corrientes >= gestion)) return { tope: corrientes, frenteA: "gastos corrientes" };
  return gestion !== null ? { tope: gestion, frenteA: "comisión de gestión" } : null;
}

/** Si una retrocesión (en tanto por uno) cabe en lo que cobra el fondo. Sin tope conocido, cabe. */
export function retrocesionCreible(rate: number, tope: number | null): boolean {
  return tope === null || rate <= tope + 1e-9;
}

/** Lo que la ficha dice que cobra un fondo, en tanto por uno: lo que hace falta para el tope de su retrocesión. */
export interface LoQueCobraElFondo {
  comisionDeGestion: number | null;
  gastosCorrientes: number | null;
}

/** Lo que cobra un fondo según su ficha. `null` en una acción: no tiene gestora, y un coste que traiga no se cree. */
export function loQueCobraElFondo(asset: Pick<BdbAssetDetail, "instrument_type" | "costs"> | null | undefined): LoQueCobraElFondo | null {
  if (!asset || esAccion(asset.instrument_type)) return null;
  const valido = (valor: number | null | undefined) => (typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : null);
  return { comisionDeGestion: valido(asset.costs?.management_fee), gastosCorrientes: valido(asset.costs?.ongoing_charge) };
}

export interface RetrocesionQueSupera {
  isin: string;
  /** La retrocesión guardada, en puntos porcentuales, como está en la base. */
  pct: number;
  /** Lo que cobra el fondo, en tanto por uno. */
  tope: number;
  frenteA: "comisión de gestión" | "gastos corrientes";
}

/**
 * Los registros cuya retrocesión supera lo que cobra su fondo, de mayor a menor. Decisión A-167 de Óscar (16-11-2026):
 * la retrocesión dudosa no se tapa en cada pantalla, se corrige en los datos, y esta es la lista de lo que hay que
 * mirar. Es la misma regla con la que el informe interno deja de usar una (`topeDeLaRetrocesion`).
 *
 * Entran también las pendientes de confirmar: están en la base, y son justo las que alguien tiene que mirar. No entra
 * un fondo cuya ficha no dice lo que cobra: sin con qué comparar no se juzga, y por eso la lista puede quedarse corta.
 */
export function retrocesionesQueSuperanLoQueCobra(
  records: readonly CommercialRetroRecord[],
  loQueCobra: ReadonlyMap<string, LoQueCobraElFondo>
): RetrocesionQueSupera[] {
  const lista: RetrocesionQueSupera[] = [];
  for (const record of records) {
    if (!isValidCommercialRetroPct(record.retro_pct)) continue;
    const cobra = loQueCobra.get(record.isin);
    const tope = cobra ? topeDeLaRetrocesion(cobra.comisionDeGestion, cobra.gastosCorrientes) : null;
    if (!tope || retrocesionCreible(record.retro_pct / 100, tope.tope)) continue;
    lista.push({ isin: record.isin, pct: record.retro_pct, tope: tope.tope, frenteA: tope.frenteA });
  }
  return lista.sort((a, b) => b.pct - a.pct || a.isin.localeCompare(b.isin));
}

export function resolveEffectiveCommercialRetro(
  assetId: string | null | undefined,
  recordsByAssetId: ReadonlyMap<string, CommercialRetroRecord>
): EffectiveCommercialRetro | null {
  if (!assetId) return null;
  const record = recordsByAssetId.get(assetId);
  if (!record || record.status === "PENDING_CONFIRMATION" || !isValidCommercialRetroPct(record.retro_pct)) return null;
  return {
    record,
    pct: record.retro_pct,
    rate: record.retro_pct / 100,
    source: "commercial_retro",
    sourceLabel: COMMERCIAL_RETRO_SOURCE_LABEL
  };
}

export function effectiveCommercialRetroPct(
  assetId: string | null | undefined,
  recordsByAssetId: ReadonlyMap<string, CommercialRetroRecord>
): number | null {
  return resolveEffectiveCommercialRetro(assetId, recordsByAssetId)?.pct ?? null;
}
