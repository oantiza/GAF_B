import type { BdbSavedLocalPortfolio } from "../types/bdbAssets";

/**
 * Quién se entera de que ha cambiado una cartera guardada. La lista la lleva cada pantalla que la
 * enseña, y se puede guardar desde fuera de ellas (el aviso de cambios sin guardar vive en el marco):
 * sin esto, una lista montada se quedaba sin la cartera recién guardada.
 *
 * Sin dependencias a propósito: lo lee el marco, que está en la carga inicial.
 *
 * DIS-03: el aviso viaja también a las otras pestañas de la aplicación por un `BroadcastChannel`, el mismo
 * mecanismo que `useOtraPestana`, en un canal propio: allí cualquier mensaje que no reconoce cuenta como una
 * despedida. El canal solo existe mientras las pestañas están abiertas y no escribe nada en disco. Lo que llega de
 * otra pestaña lleva `deOtraPestana`, para que quien lo oiga sepa que no lo ha hecho esta.
 */
export type AvisoDeCarteras =
  | { tipo: "guardada"; cartera: BdbSavedLocalPortfolio; deOtraPestana?: boolean }
  | { tipo: "eliminada"; id: string; deOtraPestana?: boolean };

export const CANAL_DE_CARTERAS_GUARDADAS = "gestor-activos.carteras-guardadas.v1";

const oyentes = new Set<(aviso: AvisoDeCarteras) => void>();
let canal: BroadcastChannel | null | undefined;

function repartir(aviso: AvisoDeCarteras): void {
  oyentes.forEach((oyente) => oyente(aviso));
}

/** Lo que llega por el canal es de otra pestaña, y se comprueba antes de repartirlo. */
function esAviso(dato: unknown): dato is AvisoDeCarteras {
  if (!dato || typeof dato !== "object") return false;
  const aviso = dato as Record<string, unknown>;
  if (aviso.tipo === "eliminada") return typeof aviso.id === "string";
  if (aviso.tipo !== "guardada" || !aviso.cartera || typeof aviso.cartera !== "object") return false;
  const cartera = aviso.cartera as Record<string, unknown>;
  return typeof cartera.portfolio_id === "string" && typeof cartera.updated_at === "string" && Array.isArray(cartera.positions);
}

function elCanal(): BroadcastChannel | null {
  if (canal !== undefined) return canal;
  if (typeof BroadcastChannel === "undefined") {
    canal = null;
    return canal;
  }
  canal = new BroadcastChannel(CANAL_DE_CARTERAS_GUARDADAS);
  /* Un canal abierto no debe tener viva a la página por sí solo (en Node, las pruebas). */
  (canal as unknown as { unref?: () => void }).unref?.();
  canal.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (esAviso(data)) repartir({ ...data, deOtraPestana: true });
  };
  return canal;
}

export function escucharCarterasGuardadas(oyente: (aviso: AvisoDeCarteras) => void): () => void {
  elCanal();
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function avisarCarterasGuardadas(aviso: AvisoDeCarteras): void {
  repartir(aviso);
  const mensaje = { ...aviso };
  delete mensaje.deOtraPestana;
  try {
    elCanal()?.postMessage(mensaje);
  } catch {
    /* Si el canal no puede llevarlo, esta pestaña ya se ha enterado: las otras lo verán al volver a leer. */
  }
}
