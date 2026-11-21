/**
 * Las series de los dos fondos base de las carteras de referencia, por la misma callable que el
 * Comparador (`get_price_series`), a 10 años y en diario: 10 años es el mayor periodo que se compara.
 *
 * Una sola petición por sesión, la compartan las pantallas que la compartan y también los PDF. Un fallo
 * no se guarda: la siguiente pantalla vuelve a pedirlas. Si no llegan, quien las usa dice «Cartera de
 * referencia no disponible»: no hay datos de repuesto a los que caer.
 */
import { BASE_RENTA_FIJA_ISIN, BASE_RENTA_VARIABLE_ISIN, type SeriesBaseDeReferencia } from "../core/benchmarkProfiles";
import { registerSessionCache } from "../core/sessionCaches";
import { SharedRequestCache } from "../core/sharedRequestCache";
import { fetchRebasedSeries, type RebasedSeriesResponse } from "./priceSeriesBackend";

/** Los datos se refrescan a mano: basta con volver a pedirlas cada hora en una sesión larga. */
const VIGENCIA_MS = 60 * 60_000;

/** De la respuesta del servidor a las dos series. Sin los dos fondos no hay mezcla que calcular. */
export function seriesBaseDeLaRespuesta(respuesta: RebasedSeriesResponse | null): SeriesBaseDeReferencia {
  const deFondo = (isin: string) => {
    const serie = respuesta?.series.find((candidata) => candidata.asset_id === isin);
    if (!respuesta || !serie || serie.values.length !== respuesta.dates.length || serie.values.length < 2) {
      throw new Error("Cartera de referencia no disponible: falta la serie de uno de sus fondos.");
    }
    return respuesta.dates.map((date, indice) => ({ date, value: serie.values[indice] }));
  };
  return { rf: deFondo(BASE_RENTA_FIJA_ISIN), rv: deFondo(BASE_RENTA_VARIABLE_ISIN) };
}

const cache = new SharedRequestCache<SeriesBaseDeReferencia>(1, VIGENCIA_MS, 1);
registerSessionCache(() => cache.clear());

export function cargarSeriesDeReferencia(signal?: AbortSignal): Promise<SeriesBaseDeReferencia> {
  return cache.get(
    "series-base",
    () =>
      fetchRebasedSeries([BASE_RENTA_FIJA_ISIN, BASE_RENTA_VARIABLE_ISIN], "10Y", "DAILY", "NONE").then(seriesBaseDeLaRespuesta),
    signal
  );
}

/** Para los PDF: un informe se genera aunque las series no lleguen, y dice que faltan. */
export function seriesDeReferenciaOAusencia(): Promise<SeriesBaseDeReferencia | null> {
  return cargarSeriesDeReferencia().catch(() => null);
}
