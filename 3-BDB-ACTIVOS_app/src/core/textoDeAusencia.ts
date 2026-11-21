import type { ClaseDeAusencia } from "../types/fichaInstrumento";

/**
 * Los tres textos fijos con que la aplicación dice que un dato no está, en pantalla y en el papel (el papel, con
 * `oFalta` de `formato.ts`, que usa estas mismas palabras). Cuándo usar cada uno lo cuenta la pieza que los pinta,
 * `src/components/ui/Ausencia.tsx`.
 *
 * Está aparte de la pieza para quien compone sin pintar: `CeldaDeTabla.texto` y
 * `FilaDeFicha.valor` llevan la cadena y la clase por separado, y sus adaptadores no deberían
 * importar un componente para saber cómo se escribe «Falta el dato».
 */
const TEXTO: Record<ClaseDeAusencia, string> = {
  "no-aplica": "No aplica",
  falta: "Falta el dato",
  "sin-pedir": "Sin pedir"
};

const TEXTO_ESTRECHO: Record<ClaseDeAusencia, string> = {
  ...TEXTO,
  falta: "Falta"
};

export function textoDeAusencia(clase: ClaseDeAusencia, opciones: { estrecha?: boolean } = {}): string {
  return (opciones.estrecha ? TEXTO_ESTRECHO : TEXTO)[clase];
}

/**
 * Lo que se dice donde iría la simulación cuando ninguna posición tiene peso (INF-5, auditoría del 16-11-2026). No es
 * una espera ni un fallo: no hay qué medir. Vive aquí y no junto al gancho del análisis porque las pruebas de pantalla
 * sustituyen ese módulo entero.
 */
export const SIN_PESOS_NO_HAY_SIMULACION = "Ninguna posición tiene peso: no hay nada que medir todavía.";
