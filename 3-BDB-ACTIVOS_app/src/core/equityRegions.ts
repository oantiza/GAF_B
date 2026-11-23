import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { esAccion } from "./esAccion";
import { parteParaLaLectura } from "./portfolio";
import { zonasDeUnReparto } from "./regionTaxonomy";

export interface EquityRegionRow {
  key: string;
  weight_percent: number;
}

export type EquityRegionQuality = "lookthrough" | "none";

export interface EquityRegionAllocation {
  /** % sobre TODA la renta variable de la cartera: con `unclassified_weight_percent` suma 100. */
  rows: EquityRegionRow[];
  /** `lookthrough` si hay algo declarado que repartir; `none` si no. */
  quality: EquityRegionQuality;
  /** % de la RV que nadie declara: es el «No declarado». No se reparte ni se deduce de nada. */
  unclassified_weight_percent: number;
  /** Alguna posición trae el dato en la forma antigua, con Canadá y África dentro de «other», y no se han contado. */
  canadaYAfricaSinSeparar?: true;
}

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function addDist(acc: Map<string, number>, baseWeight: number, dist: Record<string, number>) {
  const sum = Object.values(dist).reduce((x, y) => x + (y || 0), 0);
  if (sum <= 0) return;
  Object.entries(dist).forEach(([key, value]) => {
    if ((value || 0) <= 0) return;
    acc.set(key, (acc.get(key) || 0) + baseWeight * (value / sum));
  });
}

/**
 * La zona de una acción. Una empresa no se reparte: su región es un dato de su ficha y va entera a su zona, como su
 * sector (decisión 11). No hay porcentaje que inventar, solo el nombre de la zona en la que está ese sitio.
 *
 * Las de la primera línea las escribe el servidor en la base nueva, por la bolsa en la que cotiza
 * (`REGION_POR_BOLSA`, `functions_python/readmodel/lector_base_nueva.py`); las demás son las que traen las acciones de
 * la base local, casi todas en países, medidas el 05-11-2026 sobre las 312. Una región que no esté aquí deja la acción
 * sin zona, que es lo que se sabe de ella. La divisa no es una región: un ADR cotiza en dólares y su empresa no está en
 * EE. UU., y un fondo del mercado indio en euros no invierte en la zona euro.
 *
 * «USA» e «Iberia» (España y Portugal, los dos del euro) entraron el 16-11-2026 (IMP-8). «Europe» sigue sin zona a
 * propósito: no dice si es del euro o de fuera, y ponerla en una sería inventar.
 */
const ZONA_DE_UNA_ACCION: Readonly<Record<string, string>> = {
  eurozona: "eurozone", reino_unido: "united_kingdom", europa_ex_euro: "europe_ex_euro", ee_uu: "united_states", canada: "canada",
  united_states: "united_states", usa: "united_states", united_kingdom: "united_kingdom", japon: "japan", japan: "japan",
  iberia: "eurozone",
  spain: "eurozone", germany: "eurozone", france: "eurozone", italy: "eurozone", netherlands: "eurozone", luxembourg: "eurozone", ireland: "eurozone",
  switzerland: "europe_ex_euro", australia: "australasia", singapore: "asia_developed"
};

function zonaDeUnaAccion(asset: BdbAssetDetail): string | null {
  return esAccion(asset.instrument_type) ? ZONA_DE_UNA_ACCION[norm(asset.region || "")] ?? null : null;
}

/**
 * Look-through geográfico de la Renta Variable: agrega `exposure_detail.equity_regions`
 * de cada activo ponderado por su exposición a equity. Fuente única para el mapa
 * (pantalla y PDF) y para RegionAllocation. Devuelve [] si ningún activo aporta regiones.
 *
 * Cada instrumento se lee con `zonasDeUnReparto` antes de normalizarlo: lo que venga dos veces no cuenta, y
 * dividir por una suma con solapes es lo que dejaba a un fondo con un 84 % en Asia en un 65 % (decisión 7).
 *
 * El peso en RV de cada activo es el canónico (`assetPmsShares`): su vector PMS
 * normalizado o, sin vector, su clase económica (una acción sin `pms_exposure`
 * cuenta entera). Un fondo que no declara su reparto de activos no entra (A-211, `parteParaLaLectura`): no se sabe
 * qué parte es renta variable, ni en pantalla ni en el papel. Los porcentajes son sobre TODA la RV; lo que nadie declara se
 * queda en `unclassified_weight_percent`, y una acción va entera a su zona
 * (`zonaDeUnaAccion`).
 *
 * Hasta el 05-11-2026, a quien no publicaba regiones se le repartía por escrito a mano (un fondo «Global», 55 % en
 * EE. UU., 20 % en la zona euro…) o por su divisa: un fondo de la India en euros salía 100 % zona euro. Es la misma
 * regla de la decisión 11: una cifra no se inventa.
 */
export function computeEquityRegionAllocation(
  positions: BdbManualPortfolioPosition[],
  assets: BdbAssetDetail[]
): EquityRegionAllocation {
  const byId = new Map(assets.map((a) => [a.asset_id, a]));
  const acc = new Map<string, number>();
  let wsum = 0;
  let declaredWeight = 0;
  let canadaYAfricaSinSeparar = false;
  positions.forEach((p) => {
    const w = p.weight_percent || 0;
    const asset = byId.get(p.asset_id);
    if (w <= 0 || !asset) return;
    /* A-211: un fondo sin reparto de activos no aporta; su peso lo dice la pantalla aparte (`pesoSinReparto`). */
    const eqW = w * (parteParaLaLectura(asset, "equity") ?? 0);
    if (eqW <= 0) return;
    const reparto = zonasDeUnReparto(asset.exposure_detail?.equity_regions);
    const situado = Object.values(reparto.zonas).reduce((x, y) => x + y, 0);
    wsum += eqW;
    if (reparto.canadaYAfricaSinSeparar) canadaYAfricaSinSeparar = true;
    if (situado > 0) {
      /* Lo que de verdad no tiene zona no se reparte entre las demás: se queda sin clasificar, y se dice. */
      const pesoSituado = eqW * (situado / (situado + reparto.sinZona));
      addDist(acc, pesoSituado, reparto.zonas);
      declaredWeight += pesoSituado;
      return;
    }
    const zona = zonaDeUnaAccion(asset);
    if (zona) {
      addDist(acc, eqW, { [zona]: 100 });
      declaredWeight += eqW;
    }
  });
  const salida = finishEquityBreakdown(acc, wsum, declaredWeight);
  return canadaYAfricaSinSeparar ? { ...salida, canadaYAfricaSinSeparar: true } : salida;
}

/**
 * Un reparto de la RV que solo reparte lo publicado (decisión 11): sectores, estilo y tamaño. Una posición que no lo
 * declara no recibe ninguno: su peso se queda en `unclassified_weight_percent`, que es el «No declarado». No se deduce
 * de su nombre, de su categoría ni de su proveedor, y una acción no sale «86 % grande, 14 % mediana». El peso en RV es
 * el canónico (`assetPmsShares`), y por eso cuenta una acción sin vector y un mixto cuenta por su parte. Un fondo sin
 * reparto de activos no entra, como en las regiones (A-211).
 */
export function repartoDeclarado(
  positions: readonly BdbManualPortfolioPosition[],
  assets: readonly BdbAssetDetail[],
  leer: (asset: BdbAssetDetail) => Record<string, number> | null | undefined
): EquityRegionAllocation {
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const acc = new Map<string, number>();
  let equityWeight = 0;
  let declaredWeight = 0;
  positions.forEach((position) => {
    const weight = position.weight_percent || 0;
    const asset = byId.get(position.asset_id);
    if (weight <= 0 || !asset) return;
    const eqW = weight * (parteParaLaLectura(asset, "equity") ?? 0);
    if (eqW <= 0) return;
    equityWeight += eqW;
    const dist = leer(asset);
    const sum = dist ? Object.values(dist).reduce((x, y) => x + (y || 0), 0) : 0;
    if (!dist || sum <= 0) return;
    addDist(acc, eqW, dist);
    declaredWeight += eqW;
  });
  return finishEquityBreakdown(acc, equityWeight, declaredWeight);
}

/**
 * Cierre común de los desgloses de RV (regiones y sectores): filas en % de toda
 * la RV, y aparte lo que no se declara.
 */
function finishEquityBreakdown(
  acc: Map<string, number>,
  equityWeight: number,
  declaredWeight: number
): EquityRegionAllocation {
  if (equityWeight <= 0) return { rows: [], quality: "none", unclassified_weight_percent: 0 };
  const rows = Array.from(acc.entries())
    .map(([key, v]) => ({ key, weight_percent: (v / equityWeight) * 100 }))
    .filter((r) => r.weight_percent > 0.05)
    .sort((a, b) => b.weight_percent - a.weight_percent);
  const noDeclarado = (Math.max(0, equityWeight - declaredWeight) / equityWeight) * 100;
  return {
    rows,
    quality: rows.length === 0 ? "none" : "lookthrough",
    unclassified_weight_percent: noDeclarado > 0.05 ? noDeclarado : 0
  };
}
