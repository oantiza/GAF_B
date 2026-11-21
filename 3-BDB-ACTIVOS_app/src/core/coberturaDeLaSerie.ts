import { fecha } from "./formato";
import { aniosEnPalabras } from "./glosarioDePantalla";

/**
 * Si una serie dibujada cubre la ventana que se ha pedido. El botón dice «3A» aunque la serie empiece hace dos años, y lo que
 * se lee es que son tres. Inmocemento empieza en noviembre de 2024.
 *
 * Se mira el calendario y no el número de observaciones, que depende de la frecuencia. El año es el del proyecto (365,2425
 * días). La holgura de 15 días es porque el servidor corta por el último dato y un fondo de valor liquidativo semanal, tras un
 * puente, puede empezar días después del corte: eso no es «no llega».
 */
const DIAS_POR_ANO = 365.2425;
const HOLGURA_EN_DIAS = 15;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

const VENTANAS: Record<string, number> = { "1Y": 1, "3Y": 3, "5Y": 5, "10Y": 10 };

/** «Desde 12/11/2024 · no llega a 3 años», o null si la serie cubre la ventana o no hay con qué decirlo. */
export function avisoDeVentana(fechas: readonly string[], ventana: string): string | null {
  const anos = VENTANAS[ventana];
  const primera = fechas[0];
  const ultima = fechas[fechas.length - 1];
  if (!anos || !primera || !ultima) return null;
  const dias = (Date.parse(ultima) - Date.parse(primera)) / MS_POR_DIA;
  if (!Number.isFinite(dias) || dias >= anos * DIAS_POR_ANO - HOLGURA_EN_DIAS) return null;
  const desde = fecha(primera);
  return desde ? `Desde ${desde} · no llega a ${aniosEnPalabras(anos)}` : null;
}
