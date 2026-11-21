/**
 * Las pestañas de una cartera de cliente y las vistas de su Análisis, tal como van en la dirección
 * (`#pestana=analisis&vista=comprobaciones`): así se puede recargar, compartir y volver con «Atrás».
 * Las lee y las escribe `usePestanaEnLaDireccion`; aquí solo están sus nombres y el atajo para abrir
 * el Análisis directamente en una de sus vistas («Ver el análisis», «Comprobaciones»).
 */
import type { VistaDeLaCartera } from "./tipos";

export const PESTANAS_DE_LA_CARTERA: readonly VistaDeLaCartera[] = ["resumen", "cuentas", "movimientos", "analisis", "comparar"];

export type VistaDelAnalisis = "rentabilidad" | "composicion" | "ingresos" | "comprobaciones";

export const VISTAS_DEL_ANALISIS: readonly VistaDelAnalisis[] = ["rentabilidad", "composicion", "ingresos", "comprobaciones"];

/** La clave de la vista del Análisis en la dirección. La de la pestaña es la de siempre, «pestana». */
export const CLAVE_DE_LA_VISTA = "vista";

/**
 * Deja escrita en la dirección la vista del Análisis con la que se abrirá, sin añadir una entrada al historial: la
 * añade el cambio de pestaña que viene justo después. La primera vista no se escribe, como hace
 * `usePestanaEnLaDireccion` con su pestaña inicial.
 */
export function ponerLaVistaDelAnalisis(vista: VistaDelAnalisis): void {
  const prefijo = `${CLAVE_DE_LA_VISTA}=`;
  const resto = window.location.hash.replace(/^#/, "").split("&").filter((trozo) => trozo && !trozo.startsWith(prefijo));
  const trozos = vista === VISTAS_DEL_ANALISIS[0] ? resto : [...resto, `${prefijo}${encodeURIComponent(vista)}`];
  const hash = trozos.length ? `#${trozos.join("&")}` : "";
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
}
