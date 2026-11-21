/**
 * Cómo escriben los gráficos sus cifras y sus fechas: sobre el módulo común `src/core/formato.ts`, que no se toca desde
 * aquí. Lo que falta no se escribe «N/D»: se dice «Falta el dato» (`src/core/textoDeAusencia.ts`).
 */
import { fecha, fechaDeEje, numero, oFalta, peso, porcentaje, rentabilidad } from "../../core/formato";
import { textoDeAusencia } from "../../core/textoDeAusencia";

/** Lo que escribe un gráfico donde falta una cifra. */
export const FALTA_EL_DATO = textoDeAusencia("falta");

function cifraDe(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Un porcentaje desde una fracción (0,078 → «7,8 %»), con los decimales que se pidan. Para ejes y cifras sin signo. */
export function pctDecimal(value: unknown, digits = 1): string {
  return oFalta(porcentaje(cifraDe(value), { decimales: digits }), FALTA_EL_DATO);
}

/** Un porcentaje desde puntos (24 → «24,0 %»). */
export function pctPoint(value: unknown, digits = 1): string {
  const cifra = cifraDe(value);
  return oFalta(porcentaje(cifra === null ? null : cifra / 100, { decimales: digits }), FALTA_EL_DATO);
}

export function chartNumber(value: unknown, digits = 1): string {
  return oFalta(numero(cifraDe(value), { decimales: digits }), FALTA_EL_DATO);
}

export function base100(value: unknown, digits = 1): string {
  return chartNumber(value, digits);
}

/** Rentabilidad desde una fracción: dos decimales y siempre con signo, «+10,39 %». */
export function rentabilidadDelGrafico(value: unknown): string {
  return oFalta(rentabilidad(cifraDe(value)), FALTA_EL_DATO);
}

/** Volatilidad o caída desde una fracción: dos decimales, sin signo de más, «7,80 %», «−11,40 %». */
export function volatilidadDelGrafico(value: unknown): string {
  return oFalta(porcentaje(cifraDe(value)), FALTA_EL_DATO);
}

/** Peso desde puntos, con un decimal: 24 → «24,0 %». */
export function pesoDelGrafico(value: unknown): string {
  const cifra = cifraDe(value);
  return oFalta(peso(cifra === null ? null : cifra / 100), FALTA_EL_DATO);
}

/** La marca de un eje en porcentaje, desde una fracción, sin decimales: «10 %». */
export function pctDeEje(value: unknown): string {
  return pctDecimal(value, 0);
}

/* MEDIA-09 (auditoría 16-10-2026): una fecha «solo día» se pinta como el día del dato en cualquier huso. Desde el paso 2
   del rediseño, con el módulo común: el eje escribe «nov 2026» (`fechaDeEje`), nunca «nov 26». */
export function compactDate(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw) return "";
  return fechaDeEje(raw) ?? raw;
}

/**
 * Las fechas del eje: la primera de cada mes, una por mes (decisión 113). El eje escribe el mes y el año, así que con varias fechas de un
 * mismo mes salía «ene 26, ene 26»: en historias cortas y, a 1.440 píxeles, en cualquier ficha a un año. Se compara lo que se escribe, para
 * que dos etiquetas iguales no puedan salir por ningún camino, sea cual sea el ancho.
 */
export function primeraFechaDeCadaMes(fechas: readonly string[]): string[] {
  const vistos = new Set<string>();
  return fechas.filter((fecha) => {
    const mes = compactDate(fecha);
    if (vistos.has(mes)) return false;
    vistos.add(mes);
    return true;
  });
}

/** La fecha de la nota emergente y de la tabla alternativa: «13/11/2026». */
export function tooltipDate(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw) return "";
  return fecha(raw) ?? raw;
}
