import type { BdbAssetDataSourceKind, BdbAssetDetail, BdbManualPortfolioPosition, BdbManualPortfolioSummary, BdbPmsExposure } from "../types/bdbAssets";
import { computeEquityRegionAllocation, type EquityRegionAllocation } from "./equityRegions";
import { computeEquitySectorAllocation, type EquityBreakdownAllocation } from "./equitySectors";
import { oFalta, peso } from "./formato";
import { buildReportFromAssets, pesoSinReparto, roundPercent } from "./portfolio";
import { textoDeAusencia } from "./textoDeAusencia";
import { isWeightBalanced } from "./weightTolerance";

/**
 * Qué hay dentro de una cartera guardada. Decisión 50 de Óscar (05-11-2026): la misma cifra que Análisis, para la misma
 * cartera y la misma base. Por eso aquí no se calcula nada: se llama a las funciones que llama Análisis, con los activos
 * que lee Análisis (`getComparableAssets`).
 *
 * La radiografía de antes sumaba por el peso de cada posición, así que un mixto contaba entero en regiones y en sectores:
 * daba EE. UU. 64,3 % donde Análisis, que pondera por la renta variable de cada posición, daba 62,4 % con los mismos fondos.
 * Y leía las tarjetas de la base nueva, también en local, donde Análisis lee la de siempre.
 */

export interface FilaDeExposicion {
  clave: string;
  rotulo: string;
  /** El peso, sobre 100. Neto de cortos: puede ser un poco negativo, y entonces la otra pasa de 100. */
  peso: number;
}

/** La fila de la exposición que junta las posiciones sin reparto de activos (A-203): en pantalla la nombra `Ausencia`, «Falta el dato». */
export const CLAVE_SIN_REPARTO = "sin_reparto";

/**
 * «Exposición agregada»: lo que hay dentro de cada activo, sumado. Las mismas filas en Análisis y en Carteras guardadas.
 *
 * `xray.pms_exposure_percent` está en % de lo invertible, y es lo que lee el papel. En pantalla, si algo se queda fuera, se
 * pasa a porcentaje de la cartera con `parteInvertible` (`repartoDeLaCartera`): nada se reescala en silencio.
 *
 * «Otros» es una clase —el oro, las materias primas, lo que un fondo declara como otros—, y no lleva dentro lo que no se sabe
 * (A-202, Óscar, 21-11-2026). Lo que no tiene reparto —un fondo que no lo declara, una posición sin clase— va en su propia
 * fila, `CLAVE_SIN_REPARTO`, con `sinRepartoPct` (en % de lo invertible, como las demás), y no se reparte entre las otras (A-203).
 */
export function filasDeExposicion(exposicion: BdbPmsExposure, parteInvertible = 1, sinRepartoPct = 0): FilaDeExposicion[] {
  return [
    { clave: "equity", rotulo: "Renta variable", peso: exposicion.equity },
    { clave: "fixed_income", rotulo: "Renta fija", peso: exposicion.fixed_income },
    { clave: "cash", rotulo: "Liquidez", peso: exposicion.cash },
    { clave: "alternative", rotulo: "Alternativos", peso: exposicion.alternative },
    { clave: "real_asset", rotulo: "Activos reales", peso: exposicion.real_asset ?? 0 },
    { clave: "other", rotulo: "Otros", peso: exposicion.other },
    { clave: CLAVE_SIN_REPARTO, rotulo: "Falta el dato", peso: sinRepartoPct }
  ]
    .map((fila) => ({ ...fila, peso: fila.peso * parteInvertible }))
    /* Lo que al decimal es cero no se pinta, sea del signo que sea. Un −0,08 % sí, tal cual (decisión A-63). */
    .filter((fila) => Math.abs(fila.peso) > 0.05);
}

/**
 * «Falta el dato»: Fondo A y Fondo B no declaran su reparto de activos. La frase bajo la exposición agregada (A-203). Null si
 * no hay ninguna. Con más de tres, cuántas son.
 */
export function fraseDeLoQueNoTieneReparto(sinReparto: readonly { display_name: string }[] | undefined): string | null {
  const nombres = (sinReparto ?? []).map((posicion) => posicion.display_name);
  if (nombres.length === 0) return null;
  if (nombres.length > 3) return `«Falta el dato»: ${nombres.length} posiciones no declaran su reparto de activos, y no cuentan en ninguna clase.`;
  const lista = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return `«Falta el dato»: ${lista} ${nombres.length === 1 ? "no declara su" : "no declaran su"} reparto de activos, y no ${nombres.length === 1 ? "cuenta" : "cuentan"} en ninguna clase.`;
}

/**
 * Lo que una lectura por dentro deja fuera (A-211): «Falta el dato: el 7,0 % de la cartera no declara su reparto de activos, y no
 * se sabe qué parte es renta variable». `pesoPct`, de `pesoSinReparto`, en % de la cartera. Null si no hay nada que decir. La
 * pinta la pieza `Ausencia`, como el «No declarado» de al lado.
 */
export function fraseDelSinRepartoEnLaLectura(pesoPct: number, de: "renta variable" | "renta fija" | "renta variable ni renta fija"): string | null {
  if (!(pesoPct >= 0.05)) return null;
  return `${textoDeAusencia("falta")}: el ${oFalta(peso(pesoPct / 100))} de la cartera no declara su reparto de activos, y no se sabe qué parte es ${de}`;
}

/** Una parte de la cartera que no entra en los repartos por clase, producto, categoría, divisa y exposición. */
export interface ParteFueraDelReparto {
  clave: "no_invertible" | "sin_serie" | "serie_con_incidencia" | "fuera_del_catalogo";
  rotulo: string;
  /** En la escala de las filas de esos repartos, que son los pesos tal cual. */
  peso: number;
  /** En % de lo que suman las posiciones de la cartera: la escala de la exposición agregada. */
  pesoSobreLaCartera: number;
}

export interface RepartoDeLaCartera {
  /** Lo que no entra. Vacío si entra todo, que es casi siempre. */
  fuera: ParteFueraDelReparto[];
  /** La fracción de la cartera que sí entra, de 0 a 1. Sin posiciones con peso, 1: no hay nada que corregir. */
  parteInvertible: number;
}

/**
 * Lo que se queda fuera de los repartos de la cartera. Los repartos solo suman lo invertible (`core/portfolio`): con un 10 %
 * en una posición no invertible, las clases llegaban al 90 % sin decirlo y la exposición agregada se reescalaba al 100 %. Y
 * sectores y regiones sí lo cuentan, como «No declarado». Esta función no cambia lo que lee el papel: lo dice la pantalla.
 *
 * Se lee del resumen y no de las posiciones con los activos: es de la misma lectura que las filas. Con la cartera recién
 * cambiada y los activos aún por llegar, un activo nuevo saldría un instante como «Fuera del catálogo».
 */
export function repartoDeLaCartera(
  resumen: Pick<BdbManualPortfolioSummary, "total_weight_percent" | "non_investable_weight_percent" | "quality_blocked_weight_percent" | "never_resolved_weight_percent" | "not_found_weight_percent"> | null | undefined
): RepartoDeLaCartera {
  /* Lo que está fuera por su serie cotiza y se puede comprar: no se suma a «No invertible» (decisión 75). */
  const porSuSerie = resumen?.quality_blocked_weight_percent ?? 0;
  /* Lo que nunca se resolvió, como la CAM, está fuera «sin serie de precios», porque esa es la causa: «no invertible» solo lo dice lo que va a
     proponer (decisión 44). El papel lo junta todo en «Fuera del reparto»: la suma no cambia. */
  const sinSerie = resumen?.never_resolved_weight_percent ?? 0;
  /* Al cuarto decimal, como los pesos del resumen: restar dos pesos iguales no deja un resto binario que pinte «No invertible: 0,0 %». */
  const noInvertible = roundPercent((resumen?.non_investable_weight_percent ?? 0) - porSuSerie - sinSerie);
  const sinCatalogo = resumen?.not_found_weight_percent ?? 0;
  const total = resumen?.total_weight_percent ?? 0;
  if (total <= 0 || noInvertible + sinSerie + porSuSerie + sinCatalogo <= 0) return { fuera: [], parteInvertible: 1 };
  const parte = (clave: ParteFueraDelReparto["clave"], rotulo: string, peso: number): ParteFueraDelReparto[] =>
    peso > 0 ? [{ clave, rotulo, peso, pesoSobreLaCartera: (peso / total) * 100 }] : [];
  return {
    fuera: [
      ...parte("no_invertible", "No invertible", noInvertible),
      ...parte("sin_serie", "Sin serie de precios", sinSerie),
      ...parte("serie_con_incidencia", "Incidencia en su serie de precios", porSuSerie),
      ...parte("fuera_del_catalogo", "Fuera del catálogo", sinCatalogo)
    ],
    parteInvertible: Math.max(0, total - noInvertible - sinSerie - porSuSerie - sinCatalogo) / total
  };
}

export interface RadiografiaDeLaCartera {
  exposicion: FilaDeExposicion[];
  /** El peso, de 0 a 100, que cuenta por su clase de activo porque no trae desglose. */
  porSuClasePct: number;
  /** La frase de lo que no tiene reparto (A-203), o null. Su peso ya va en `exposicion`, en la fila `CLAVE_SIN_REPARTO`. */
  sinReparto: string | null;
  /** En % de toda la renta variable, con lo que nadie declara aparte. */
  sectores: EquityBreakdownAllocation;
  /** % de la cartera sin reparto de activos, que no entra en sectores ni en regiones (A-211). */
  sinRepartoPct: number;
  regiones: EquityRegionAllocation;
  /** Las posiciones con peso que la fuente no conoce. No cuentan en nada de lo anterior, y se dice. */
  fuera: string[];
  /** Lo que no entra en la exposición agregada, para que sus filas lleguen al 100 % diciéndolo. */
  fueraDelReparto: ParteFueraDelReparto[];
}

const posicionesFuera = (positions: readonly BdbManualPortfolioPosition[], assets: readonly BdbAssetDetail[]) => {
  const conocidos = new Set(assets.map((asset) => asset.asset_id));
  return positions.filter((posicion) => !conocidos.has(posicion.asset_id)).map((posicion) => posicion.asset_id);
};

export function radiografiaDeLaCartera(
  positions: BdbManualPortfolioPosition[],
  assets: BdbAssetDetail[],
  source: BdbAssetDataSourceKind
): RadiografiaDeLaCartera {
  const { xray, summary } = buildReportFromAssets({ source, portfolioName: "", manualPositions: positions, assets });
  const reparto = repartoDeLaCartera(summary);
  return {
    exposicion: filasDeExposicion(xray.pms_exposure_percent, reparto.parteInvertible, xray.pms_exposure_sin_reparto_percent ?? 0),
    porSuClasePct: (xray.pms_exposure_fallback_percent ?? 0) * reparto.parteInvertible,
    sinReparto: fraseDeLoQueNoTieneReparto(xray.pms_exposure_sin_reparto),
    sectores: computeEquitySectorAllocation(positions, assets),
    sinRepartoPct: pesoSinReparto(positions, assets),
    regiones: computeEquityRegionAllocation(positions, assets),
    fuera: posicionesFuera(positions, assets),
    fueraDelReparto: reparto.fuera
  };
}

export interface SumaDeLaCartera {
  /** La suma de sus pesos, en porcentaje. */
  suma: number;
  /** Con la tolerancia única de la aplicación (`weightTolerance`). */
  cuadrada: boolean;
}

export function sumaDeLaCartera(positions: readonly Pick<BdbManualPortfolioPosition, "weight_percent">[]): SumaDeLaCartera {
  const suma = Number(positions.reduce((total, posicion) => total + (posicion.weight_percent || 0), 0).toFixed(4));
  return { suma, cuadrada: isWeightBalanced(suma) };
}

export interface AuditoriaDeCartera {
  /** Posiciones que la fuente no conoce. */
  fuera: string[];
  /**
   * Qué parte de la renta variable declara sus sectores, de 0 a 100. `null` si la cartera no tiene renta variable: ahí no
   * hay nada que declarar, y no es un dato que falte.
   */
  sectoresDeclaradosPct: number | null;
}

/**
 * Lo que se le puede preguntar a una cartera guardada antes de analizarla: si conocemos todas sus posiciones y cuánto de su
 * renta variable puede explicar una radiografía por sector. Se mide como la radiografía, sobre la renta variable: un fondo de
 * bonos no declara sectores porque no tiene acciones, y contarlo como una laguna hacía que «explica el 70 %» de una cartera
 * con un 30 % en bonos pareciera un defecto de los datos.
 */
export function auditarCartera(positions: BdbManualPortfolioPosition[], assets: BdbAssetDetail[]): AuditoriaDeCartera {
  const sectores = computeEquitySectorAllocation(positions, assets);
  const hayRentaVariable = sectores.rows.length > 0 || sectores.unclassified_weight_percent > 0;
  return {
    fuera: posicionesFuera(positions, assets),
    sectoresDeclaradosPct: hayRentaVariable ? 100 - sectores.unclassified_weight_percent : null
  };
}
