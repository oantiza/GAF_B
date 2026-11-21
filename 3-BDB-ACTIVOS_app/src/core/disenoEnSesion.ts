import { createSessionSlot, type SessionSlot } from "./sessionCaches";
import type { PortfolioMetricSnapshot } from "./portfolioOptimizationDiff";
import type { BdbManualPortfolioPosition, BdbRiskProfileId } from "../types/bdbAssets";

/**
 * El trabajo a medias de la cartera activa (hallazgo 53): lo que antes se perdía al ir al Buscador a
 * añadir un fondo y volver. Candados, modo, paso, perfil elegido, tabla Antes/después, resultado de
 * optimizar.
 *
 * Vive en memoria, como lo de Posiciones: son datos de un cliente, nunca van al almacenamiento del
 * navegador ni al servidor, y mueren con la sesión o con la pestaña (`createSessionSlot`).
 *
 * También mueren al cambiar de cartera: los candados de un cliente no se le aplican al siguiente. Por
 * eso todas estas ranuras se crean con `ranuraDeCartera` y `olvidarTrabajoDeCartera` las vacía de una
 * vez cuando algo sustituye la cartera activa.
 */

const ranuras: SessionSlot<unknown>[] = [];

export function ranuraDeCartera<T>(inicial: () => T): SessionSlot<T> {
  const ranura = createSessionSlot(inicial);
  ranuras.push(ranura as SessionSlot<unknown>);
  return ranura;
}

export function olvidarTrabajoDeCartera(): void {
  ranuras.forEach((ranura) => ranura.reset());
}

/** Los cuatro pasos de Diseño de cartera. */
export type PasoDeDiseno = "compose" | "check" | "optimize" | "simulate";

/** La cartera de antes de aplicar una propuesta: lo que enseña Antes/después y a lo que se vuelve. */
export interface LineaBaseDeCambios {
  before: BdbManualPortfolioPosition[];
  /** La cartera como la dejó la propuesta: si la de ahora no coincide, ha cambiado después. */
  aplicada?: BdbManualPortfolioPosition[];
  source: string;
  beforeMetrics?: PortfolioMetricSnapshot;
  afterMetrics?: PortfolioMetricSnapshot;
}

export interface DisenoEnSesion {
  locks: Record<string, boolean>;
  editMode: "free" | "proportional";
  step: PasoDeDiseno;
  comparisonBaseline: LineaBaseDeCambios | null;
}

export const disenoEnSesion = ranuraDeCartera<DisenoEnSesion>(() => ({
  locks: {},
  editMode: "free",
  step: "compose",
  comparisonBaseline: null
}));

/** El perfil que ha elegido el asesor: `null` mientras no elija ninguno (decisión 14). */
export const perfilEnSesion = ranuraDeCartera<BdbRiskProfileId | null>(() => null);
