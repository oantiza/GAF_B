import { esRespuestaExacta } from "./busquedaDeActivos";
import type { SwapAlternative } from "./fundSwapper";
import { compararGrupos } from "./metricsFrequency";

export type SwapPreserveMode = "weight" | "money";

export interface SwapSelectionOptions {
  preserveMode: SwapPreserveMode;
  targetEuros?: number;
}

/**
 * El orden de las alternativas al sustituir una posición: la afinidad, y dentro de ella el grupo de cifras comparables (MET-4: la nota solo se
 * compara entre cifras del mismo cálculo y cierre), la nota y el nombre. No mira
 * la retrocesión (decisión 17 de Óscar): si alguien pregunta por qué se eligió un fondo, la herramienta no ordenaba
 * por el ingreso propio. Lo que responde exactamente a lo tecleado va delante, como en las otras dos búsquedas: «SAN» es Santander, y
 * no Artisan por contener esas letras y estar en una afinidad mejor.
 */
export function sortSwapAlternativesForPresentation(alternatives: SwapAlternative[], busqueda = ""): SwapAlternative[] {
  const esExacta = ({ asset }: SwapAlternative) => esRespuestaExacta({ nombre: asset.display_name, isin: asset.isin ?? asset.asset_id, ticker: asset.ticker }, busqueda);
  return [...alternatives].sort(
    (a, b) => Number(esExacta(b)) - Number(esExacta(a)) || a.tier - b.tier || (a.grupo && b.grupo ? compararGrupos(a.grupo, b.grupo) : 0) || b.score - a.score || a.asset.display_name.localeCompare(b.asset.display_name, "es")
  );
}
