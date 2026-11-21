import { computeFrontier, type FrontierAsset, type FrontierResult } from "./frontier";
import { resolveMetricsFrequency, rotuloDeLaVentana } from "./metricsFrequency";
import type { BdbAssetDetail } from "../types/bdbAssets";
import type { FrontierHistoricalState } from "../types/portfolioFrontier";

const EPS = 1e-12;

/**
 * Devuelve la envolvente superior concava para dibujar la polilinea de frontera.
 * No modifica los puntos originales: solo filtra los que se usan para la curva.
 */
export function concaveFrontierEnvelope<T>(
  points: readonly T[],
  volatilityOf: (point: T) => number,
  returnOf: (point: T) => number
): T[] {
  const ordered = points
    .filter((point) => Number.isFinite(volatilityOf(point)) && Number.isFinite(returnOf(point)))
    .slice()
    .sort((a, b) => {
      const volDiff = volatilityOf(a) - volatilityOf(b);
      return Math.abs(volDiff) > EPS ? volDiff : returnOf(b) - returnOf(a);
    });

  const nondominated: T[] = [];
  let bestReturn = -Infinity;
  for (const point of ordered) {
    const ret = returnOf(point);
    if (ret <= bestReturn + EPS) {
      continue;
    }
    nondominated.push(point);
    bestReturn = ret;
  }

  const hull: T[] = [];
  for (const point of nondominated) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      const cross =
        (volatilityOf(b) - volatilityOf(a)) * (returnOf(point) - returnOf(b)) -
        (returnOf(b) - returnOf(a)) * (volatilityOf(point) - volatilityOf(b));
      if (cross <= EPS) {
        break;
      }
      hull.pop();
    }
    hull.push(point);
  }

  return hull;
}

/* ------------------------------------------------------------------------ */
/* B7 (decisión 30-09): la frontera aproximada se dibuja SIEMPRE que la       */
/* histórica no esté disponible (Constructor, Análisis e informe). Estas      */
/* piezas son las que comparten los tres consumidores.                       */
/* ------------------------------------------------------------------------ */

export const APPROXIMATE_FRONTIER_BADGE = "Frontera estimada por composición";

export interface ApproximateFrontierInputs {
  frontierAssets: FrontierAsset[];
  frequency: ReturnType<typeof resolveMetricsFrequency>;
  /** Huella por VALORES de las entradas (no identidad): misma huella, mismo resultado. */
  key: string;
}

/** Activos aptos para la estimación: invertibles, con retorno y vol 3A. */
export function buildApproximateFrontierInputs(assets: readonly BdbAssetDetail[]): ApproximateFrontierInputs {
  const frontierAssets: FrontierAsset[] = assets
    .filter(
      (a) =>
        a.is_investable &&
        typeof a.metrics?.volatility_3y === "number" &&
        a.metrics.volatility_3y > 0 &&
        typeof a.metrics?.annualized_return_3y === "number"
    )
    .map((a) => ({
      id: a.asset_id,
      name: a.display_name,
      expectedReturn: a.metrics.annualized_return_3y as number,
      volatility: a.metrics.volatility_3y as number,
      assetClass: a.economic_asset_class
    }));

  const ids = new Set(frontierAssets.map((asset) => asset.id));
  const frequency = resolveMetricsFrequency(
    assets.filter((asset) => ids.has(asset.asset_id)).map((asset) => rotuloDeLaVentana(asset.metrics, "3y").frequency)
  );
  /* La cartera no se sitúa en esta frontera: su punto sería una suma ponderada (decisiones 36 y 59). Por eso no dependen de los pesos ni
     la curva ni su huella. */
  const key = [
    frequency.frequency ?? "incompatible",
    frontierAssets.map((a) => `${a.id}:${a.expectedReturn}:${a.volatility}:${a.assetClass ?? ""}`).join("|")
  ].join("§");

  return { frontierAssets, frequency, key };
}

/* Auditoría 27-07 (T2/P7): computeFrontier corría síncrono en cada arrastre
   de peso y en cada montaje. Caché de módulo por huella de entradas,
   compartida entre montajes y con el PDF; el cálculo es determinista, así que
   cachear no cambia ningún número. */
const approximateFrontierCache = new Map<string, FrontierResult | null>();
const APPROXIMATE_FRONTIER_CACHE_MAX = 24;

export function hasCachedApproximateFrontier(key: string): boolean {
  return approximateFrontierCache.has(key);
}

export function computeApproximateFrontier(inputs: ApproximateFrontierInputs): FrontierResult | null {
  if (approximateFrontierCache.has(inputs.key)) {
    return approximateFrontierCache.get(inputs.key) ?? null;
  }
  const result = !inputs.frequency.compatible
    ? null
    : computeFrontier(inputs.frontierAssets);
  approximateFrontierCache.set(inputs.key, result);
  if (approximateFrontierCache.size > APPROXIMATE_FRONTIER_CACHE_MAX) {
    const oldest = approximateFrontierCache.keys().next().value;
    if (oldest !== undefined) {
      approximateFrontierCache.delete(oldest);
    }
  }
  return result;
}

/* El adaptador nombra el campo que no pudo leer, y el punto de la cartera llega vacío cuando ninguna posición con peso
   entra en el cálculo: lo normal, que aún no haya pesos. Un nombre de campo no se escribe en pantalla. */
const CAMPO_DEL_PUNTO_DE_LA_CARTERA = "current_portfolio";

export const MOTIVO_SIN_PESOS = "asigna pesos a la cartera para calcular la histórica";
export const MOTIVO_SIN_PUNTO_DE_LA_CARTERA = "la cartera no se pudo situar en la histórica";

/**
 * Sin ningún peso asignado la histórica no se pide (A-135): el servidor la calcularía sin el punto de la cartera, el
 * sitio descartaría la respuesta y cada cambio en la composición lanzaría otro cálculo. Este es el estado que va en su
 * lugar, con la misma frase que ya daba la pantalla cuando esa respuesta llegaba.
 */
const FRASE_SIN_PESOS = "Asigna pesos a la cartera para calcular la frontera histórica.";
export const HISTORICA_SIN_PESOS: FrontierHistoricalState = { status: "error", message: FRASE_SIN_PESOS };


/** El cálculo histórico respondió sin el punto de la cartera. */
export function faltaElPuntoDeLaCartera(message: string): boolean {
  return (message || "").includes(CAMPO_DEL_PUNTO_DE_LA_CARTERA);
}

/**
 * Motivo (corto, en minúscula) por el que se enseña la estimada en lugar de la histórica.
 * `hayPeso` dice si alguna posición tiene peso: es lo que separa «faltan los pesos» de «los que tienen peso no entran».
 */
export function approximateFrontierReason(state: FrontierHistoricalState, hayPeso: boolean): string {
  switch (state.status) {
    case "loading":
      return "calculando la histórica con series reales";
    case "error":
      if (state.message === FRASE_SIN_PESOS) return MOTIVO_SIN_PESOS;
      if (faltaElPuntoDeLaCartera(state.message)) return hayPeso ? MOTIVO_SIN_PUNTO_DE_LA_CARTERA : MOTIVO_SIN_PESOS;
      return state.message;
    case "unauthenticated":
      return "inicia sesión para calcular la histórica";
    case "idle":
      return "la histórica no está disponible en este entorno";
    case "result":
      return "";
  }
}

/** Distintivo «Frontera estimada por composición · motivo». */
export function approximateFrontierBadge(reason?: string): string {
  const trimmed = reason?.trim().replace(/\.$/, "");
  return trimmed ? `${APPROXIMATE_FRONTIER_BADGE} · ${trimmed}` : APPROXIMATE_FRONTIER_BADGE;
}
