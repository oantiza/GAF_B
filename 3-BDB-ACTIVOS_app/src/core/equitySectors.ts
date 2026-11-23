import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { repartoDeclarado } from "./equityRegions";

export interface EquityBreakdownRow {
  key: string;
  weight_percent: number;
}

export type EquityBreakdownQuality = "lookthrough" | "none";

export interface EquityBreakdownAllocation {
  /** % sobre TODA la renta variable de la cartera: con `unclassified_weight_percent` suma 100. */
  rows: EquityBreakdownRow[];
  /** `lookthrough` si hay algo publicado que repartir; `none` si no. */
  quality: EquityBreakdownQuality;
  /** % de la RV sin sector (ni desglose ni ficha). Es el «No declarado» del donut. */
  unclassified_weight_percent: number;
}

function normText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Sector propio de la ficha del activo (backend: Yahoo/Finnhub/Morningstar)
 * normalizado a las claves de la casa. Es DATO, no estimación. Devuelve null si
 * el texto no se reconoce.
 */
export function normalizeBackendSector(sector: string | undefined): string | null {
  if (!sector) return null;
  /* «consumerDefensive»: lo que viene junto se separa antes de perder las mayúsculas. */
  const text = normText(sector.replace(/([a-z])([A-Z])/g, "$1 $2")).replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const EXACT: Record<string, string> = {
    "technology": "technology",
    "information technology": "technology",
    "communication services": "communication_services",
    "communications": "communication_services",
    "telecommunications": "communication_services",
    "healthcare": "healthcare",
    "health care": "healthcare",
    "financial services": "financial_services",
    "financials": "financial_services",
    "financial": "financial_services",
    "consumer defensive": "consumer_defensive",
    "consumer staples": "consumer_defensive",
    "consumer cyclical": "consumer_cyclical",
    "consumer discretionary": "consumer_cyclical",
    "energy": "energy",
    "utilities": "utilities",
    "industrials": "industrials",
    "industrial": "industrials",
    "basic materials": "basic_materials",
    "materials": "basic_materials",
    "real estate": "real_estate",
    /* Las industrias que la base anterior guarda como sector. El grupo es el que la base nueva da a esos mismos
       valores: medido el 05-11-2026 cruzando las dos. */
    "aerospace defense": "industrials",
    "electrical equipment": "industrials",
    "industrial conglomerates": "industrials",
    "machinery": "industrials",
    "hotels restaurants leisure": "consumer_cyclical",
    "retail": "consumer_cyclical",
    "textiles apparel luxury goods": "consumer_cyclical",
    "beverages": "consumer_defensive",
    "consumer products": "consumer_defensive",
    "tobacco": "consumer_defensive"
  };
  if (EXACT[text]) return EXACT[text];
  // Industrias frecuentes de Finnhub que no llegan como sector GICS.
  if (/semiconductor|software|hardware|computing/.test(text)) return "technology";
  if (/pharmaceutical|biotechnolog|medical/.test(text)) return "healthcare";
  if (/\bbank|insurance|asset management|capital markets/.test(text)) return "financial_services";
  if (/telecom|media|entertainment/.test(text)) return "communication_services";
  /* Antes que el gas (IMP-8, auditoría del 16-11-2026): «Gas Utilities», «Electric Utilities» y «Multi-Utilities» son
     del sector de servicios públicos, y por la palabra «gas» una distribuidora de gas caía en Energía. */
  if (/utilit/.test(text)) return "utilities";
  if (/oil|gas\b|petroleum/.test(text)) return "energy";
  if (/mining|chemical|steel|paper/.test(text)) return "basic_materials";
  if (/\breit\b|real estate/.test(text)) return "real_estate";
  return null;
}

/**
 * Un reparto por sectores con las claves de la casa, que es como lo lee todo lo demás. Sin esto, una misma cartera sumaba cada sector en dos
 * filas: en la base vieja, dos fondos los guardan con otro nombre, LU0591059224 como el proveedor («Technology», «Financial Services») y
 * LU1493953001 todo junto («financialServices»), y un 41 % de tecnología salía aparte como «Technology». Medido el 05-11-2026: en la vieja son
 * esos dos de 1.097, y en la nueva ninguno de 1.104. Las acciones no: ya traen la clave de la casa. Lo que no se reconoce se queda con
 * su nombre, porque inventar un sector es inventar.
 */
export function sectoresDeLaCasa(reparto: Readonly<Record<string, number>> | null | undefined): Record<string, number> | undefined {
  if (!reparto) return undefined;
  const salida: Record<string, number> = {};
  for (const [clave, peso] of Object.entries(reparto)) {
    const casa = normalizeBackendSector(clave) ?? clave;
    salida[casa] = (salida[casa] ?? 0) + peso;
  }
  return salida;
}

/**
 * Desglose sectorial de la RV, solo con lo publicado (`repartoDeclarado`): filas en % de toda la RV y la parte sin
 * sector declarada aparte. El desglose del fondo manda sobre el sector de su ficha, y el de la ficha es el de una
 * acción. Ya no se deduce de palabras del nombre: «Global» o «index» repartían un fondo en «Multisector» y sus
 * porcentajes escritos a mano.
 */
export function computeEquitySectorAllocation(
  positions: readonly BdbManualPortfolioPosition[],
  assets: readonly BdbAssetDetail[]
): EquityBreakdownAllocation {
  /* A-211: un fondo sin reparto de activos no entra (`repartoDeclarado`). */
  return repartoDeclarado(positions, assets, (asset) => {
    const dist = asset.exposure_detail?.sectors;
    if (dist && Object.values(dist).reduce((x, y) => x + (y || 0), 0) > 0) return dist;
    const sector = normalizeBackendSector(asset.sector);
    return sector ? { [sector]: 100 } : null;
  });
}
