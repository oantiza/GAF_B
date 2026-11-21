/**
 * El lector de la cartera completa que publica el emisor de un ETF (decisión B-79 de Óscar, 11-11-2026), y el único sitio de la
 * aplicación que la pide.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ SE USA, Y PARA QUÉ NO
 *
 * Los datos del emisor son de uso interno (B-53). Su cartera completa sirve para una cosa que sí ve el cliente y para otra que no:
 *
 * - **El solapamiento, en todas partes** (decisión de Óscar del 14-11-2026, «con respecto a los ETF, no los dejes fuera», que revisa la
 *   B-79): la matriz de Análisis, también en Modo cliente, las frases y la matriz del **informe de cliente**, y la 4.2 del informe
 *   interno. Sin ella, un ETF que solo publica sus diez mayores quedaba fuera de la matriz, y el par que más se pisa de una cartera
 *   (dos ETF de bolsa mundial y americana, por ejemplo) no salía en el papel del cliente. Lo que el cliente ve es la **cifra** de
 *   solapamiento, que es un cálculo nuestro: no ve la cartera del emisor ni quién la publica (`procedenciaDeLaCartera`).
 * - **La composición por dentro, solo para el asesor**: la 4.1 del informe interno (los subyacentes agregados). Ningún otro papel de
 *   cliente la recibe: la comparativa de carteras, el informe de costes, la propuesta de cambio, la ficha en PDF.
 *
 * Las reglas de Firestore no lo pueden separar, porque el Modo cliente es la misma sesión del asesor. Lo separa el código:
 *
 * - Ningún papel lee aquí. El informe de cliente **recibe** su solapamiento ya medido de la pantalla que lo pide (Análisis o
 *   Informes), que es quien llama a `cargasDeLaCartera`; el interno, lo mismo. `tests/barreraCarteraDelEmisor.test.ts` recorre lo
 *   que importa cada papel, también lo que importan sus importaciones, y falla si alguno llega aquí o a `core/carteraDelEmisor`.
 *   Y solo este fichero puede nombrar `issuer_holdings`.
 *
 * La lectura es de la base nueva, por el mismo camino que la ficha (`baseNuevaLectura`: REST contra el emulador en desarrollo, el SDK en
 * la web publicada). En la nube esos documentos aún no están: `nube:subir` los deja fuera salvo `--con-cartera-del-emisor`, que es una
 * aprobación aparte. Sin documento, el ETF sigue con la cartera del proveedor, y lo mismo si su lectura falla: la del emisor mejora una
 * cifra, y su falta no puede romper la matriz.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { appLogger } from "../core/appLogger";
import {
  aCarteraDeLaApp,
  indiceDeTickers,
  leerResumenDelEmisor,
  lineasDeLosTrozos,
  paresDeLasCarteras,
  paresDelCatalogo,
  sirveParaMedir,
  type CarteraDelEmisor,
  type ParDeIdentificadores
} from "../core/carteraDelEmisor";
import type { AssetDataSource } from "../types/assetDataSource";
import type { BdbAssetDetail, BdbAssetHoldings } from "../types/bdbAssets";
import { BASE_NUEVA_DISPONIBLE, leerDocumento, listarColeccion, type Documento } from "./baseNuevaLectura";
import { leerCatalogoEnSesion } from "./catalogoEnSesion";

const RESUMEN = "declared/issuer_holdings";
const TROZOS = "issuer_holdings_chunks";
const ES_ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/**
 * La cartera del emisor de un instrumento, o `null` si no la tiene. Si no sirve para medir (un sintético, una lista recortada) vuelve
 * el resumen sin líneas, con su motivo: no se leen trozos, porque no los hay.
 */
export async function leerCarteraDelEmisor(isin: string): Promise<CarteraDelEmisor | null> {
  if (!BASE_NUEVA_DISPONIBLE) return null;
  const resumen = leerResumenDelEmisor(await leerDocumento(`instruments/${isin}/${RESUMEN}`));
  if (!resumen) return null;
  if (!resumen.usable_for_measurement || resumen.chunk_count === 0) return { asset_id: isin, resumen, lineas: [] };
  const trozos = await listarColeccion(`instruments/${isin}/${TROZOS}`);
  const lineas = lineasDeLosTrozos(resumen, trozos.map(({ documento }) => documento));
  return lineas === null ? { asset_id: isin, resumen, lineas: [], incompleta: true } : { asset_id: isin, resumen, lineas };
}

type Cargas = Pick<AssetDataSource, "getAssetHoldings" | "getAssetHoldingsMany">;

/** Las cargas, y si pueden traer alguna cartera del emisor: `false` sin ningún ETF. */
export type CargasDeLaCartera = Cargas & { puedeTraerLaDelEmisor: boolean };

export interface OpcionesDeLasCargas {
  /** Las posiciones con su tipo: solo un ETF se busca en la cartera del emisor, y las acciones dan parejas ticker–ISIN. */
  activos: ReadonlyArray<Pick<BdbAssetDetail, "asset_id" | "instrument_type" | "isin" | "ticker" | "currency" | "display_name">>;
  /** Para las pruebas. */
  leer?: (isin: string) => Promise<CarteraDelEmisor | null>;
  /** Las tarjetas del catálogo, de donde salen las parejas ticker–ISIN de sus acciones. Para las pruebas. */
  catalogo?: () => Promise<readonly Documento[]>;
}

/** Las parejas de las acciones en directo de la cartera: su ISIN, su ticker y su divisa son los del catálogo de la aplicación. */
function paresDeLosActivos(activos: OpcionesDeLasCargas["activos"]): ParDeIdentificadores[] {
  return activos.flatMap((activo) => {
    const isin = (activo.isin ?? activo.asset_id).trim().toUpperCase();
    return activo.instrument_type === "STOCK" && activo.ticker?.trim()
      ? [{ ticker: activo.ticker, isin, name: activo.display_name, ...(activo.currency ? { currency: activo.currency.toUpperCase() } : {}) }]
      : [];
  });
}

/**
 * Las cargas de cartera con las que se mide el solapamiento (Análisis, el informe de cliente y el informe interno): las del proveedor,
 * y para cada ETF con cartera del emisor que sirva para medir, esa en su lugar. Igual dentro y fuera del Modo cliente, desde el
 * 14-11-2026: lo que cambia en Modo cliente es que la pantalla no dice de quién es la cartera, no la cifra.
 *
 * El cruce por ticker necesita ver las demás carteras, así que la carga de verdad es en lote: la suelta es un lote de uno. Las acciones del
 * catálogo solo se leen si alguna cartera del emisor trae líneas con ticker y sin ISIN, y una vez por sesión (`catalogoEnSesion`).
 */
export function cargasDeLaCartera(fuente: Cargas, opciones: OpcionesDeLasCargas): CargasDeLaCartera {
  const delProveedor: CargasDeLaCartera = {
    getAssetHoldings: fuente.getAssetHoldings,
    getAssetHoldingsMany: fuente.getAssetHoldingsMany,
    puedeTraerLaDelEmisor: false
  };
  if (!fuente.getAssetHoldings && !fuente.getAssetHoldingsMany) return delProveedor;
  /* La base nueva guarda cada instrumento por su ISIN: un id que no lo es (los de la muestra local) no tiene cartera del emisor que pedir. */
  const etf = new Set(
    opciones.activos.filter((activo) => activo.instrument_type === "ETF" && ES_ISIN.test(activo.asset_id)).map((activo) => activo.asset_id)
  );
  if (etf.size === 0) return delProveedor;

  const leer = opciones.leer ?? leerCarteraDelEmisor;
  const catalogo = opciones.catalogo ?? leerCatalogoEnSesion;
  const leidas = new Map<string, Promise<CarteraDelEmisor | null>>();
  const delEmisor = (isin: string): Promise<CarteraDelEmisor | null> => {
    let lectura = leidas.get(isin);
    if (!lectura) {
      lectura = leer(isin).catch((causa: unknown) => {
        appLogger.warn(`cartera del emisor de ${isin} no disponible: se usa la del proveedor`, causa);
        return null;
      });
      leidas.set(isin, lectura);
    }
    return lectura;
  };

  /* Una suelta va por la carga suelta del proveedor: es a la que caen quienes llaman cuando el lote falla, y no puede volver al lote. */
  async function proveedor(ids: string[]): Promise<Map<string, BdbAssetHoldings | null>> {
    if (ids.length === 1 && fuente.getAssetHoldings) return new Map([[ids[0], await fuente.getAssetHoldings(ids[0])]]);
    if (fuente.getAssetHoldingsMany) return fuente.getAssetHoldingsMany(ids);
    const filas = await Promise.all(ids.map(async (id) => [id, await fuente.getAssetHoldings!(id)] as const));
    return new Map(filas);
  }

  async function enLote(ids: string[]): Promise<Map<string, BdbAssetHoldings | null>> {
    const [delProveedorPorId, carteras] = await Promise.all([
      proveedor(ids),
      Promise.all(ids.filter((id) => etf.has(id)).map(delEmisor))
    ]);
    const usables = carteras.filter(sirveParaMedir);
    if (usables.length === 0) return delProveedorPorId;
    const conTicker = usables.some((cartera) => cartera.lineas.some((linea) => !linea.isin && linea.ticker));
    const tarjetas = conTicker
      ? await catalogo().catch((causa: unknown) => {
          appLogger.warn("catálogo no disponible para cruzar tickers: esas líneas cruzan por su nombre", causa);
          return [] as readonly Documento[];
        })
      : [];
    const indice = indiceDeTickers([
      ...paresDeLasCarteras(delProveedorPorId.values()),
      ...paresDeLosActivos(opciones.activos),
      ...paresDelCatalogo(tarjetas)
    ]);
    const salida = new Map(delProveedorPorId);
    for (const cartera of usables) salida.set(cartera.asset_id, aCarteraDeLaApp(cartera, indice));
    return salida;
  }

  return {
    getAssetHoldings: async (id) => (await enLote([id])).get(id) ?? null,
    getAssetHoldingsMany: enLote,
    puedeTraerLaDelEmisor: true
  };
}
