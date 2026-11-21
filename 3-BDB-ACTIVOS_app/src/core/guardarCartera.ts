import { getAssetDataSource } from "../adapters/assetDataSource";
import { ConflictoAlGuardar, type MotivoDelConflicto } from "../adapters/conflictoAlGuardar";
import { backendListPortfolioResult, backendSavePortfolio, usesBackendPersistence } from "../adapters/portfolioBackend";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../types/bdbAssets";
import { appLogger } from "./appLogger";
import { avisarCarterasGuardadas } from "./carterasGuardadasAvisos";
import { getBrowserLocalStorage } from "./draftStorage";
import { readLocalPortfoliosFromStorage, writeLocalPortfoliosToStorage } from "./localPortfolioStorage";
import { errorDelHorizonte, errorDelNivelDePerfil, perfilYHorizonteDe, type PerfilYHorizonte } from "./perfilYHorizonte";
import { createSavedLocalPortfolio, deleteLocalPortfolio, saveLocalPortfolio } from "./portfolio";

/**
 * Escribir una cartera guardada: la cuenta o el navegador, según la fuente activa.
 *
 * Con un identificador que ya existe, sobrescribe. El servidor ya lo admitía
 * (`functions_python/portfolios/repository.py`: sobrescribir no cuenta para el tope de 200 y conserva
 * la fecha de alta; `almacen_base_nueva.py`: sustituye los objetivos de esa misma cartera), y lo que
 * faltaba era que alguien le mandara el identificador de la cartera abierta en vez de uno nuevo.
 *
 * DIS-03: en la cuenta, con `expectedUpdatedAt` el servidor solo sobrescribe si la guardada sigue con esa fecha de
 * modificación; si no, lanza `ConflictoAlGuardar`. En el navegador no hay servidor que lo compruebe.
 */
export async function persistirCartera(
  sourceKind: AssetDataSourceKind,
  cartera: BdbSavedLocalPortfolio,
  condicion: { expectedUpdatedAt?: string } = {}
): Promise<{ cartera: BdbSavedLocalPortfolio; avisos: string[]; enLaCuenta: boolean }> {
  if (usesBackendPersistence(sourceKind)) {
    const respuesta = await backendSavePortfolio(cartera, condicion);
    const guardada = respuesta.portfolio ?? cartera;
    avisarCarterasGuardadas({ tipo: "guardada", cartera: guardada });
    return { cartera: guardada, avisos: respuesta.warnings.map((aviso) => aviso.message), enLaCuenta: true };
  }
  const almacen = getBrowserLocalStorage();
  const actuales = readLocalPortfoliosFromStorage(almacen);
  writeLocalPortfoliosToStorage(almacen, saveLocalPortfolio(deleteLocalPortfolio(actuales, cartera.portfolio_id), cartera));
  avisarCarterasGuardadas({ tipo: "guardada", cartera });
  return { cartera, avisos: [], enLaCuenta: false };
}

/** Cómo está la guardada comparada con la que se abrió. */
export type EstadoDeLaGuardada = { estado: "igual" | "cambiada" | "eliminada" | "sin-comprobar" };

/**
 * DIS-03: antes de sobrescribir la abierta se vuelve a leer por el mismo camino que la lista de guardadas, y su
 * fecha de modificación tiene que ser la que tenía al abrirla. Si es otra, alguien la ha guardado desde otra
 * pestaña u otro equipo; si no está, la han eliminado. Si no se puede leer, no se da por igual.
 *
 * No es un control: entre esta lectura y el guardado otra escritura aún puede colarse. El que no deja pasar eso
 * es el del servidor: `guardarCartera` le manda la fecha con que se abrió (`expected_updated_at`) y él rechaza el
 * guardado si ya no es esa. Esta comprobación se queda porque un servidor anterior a ese control ignora el campo y
 * guarda sin mirar: con los dos, el de antes y el nuevo, el asesor recibe la pregunta antes de pisar nada.
 */
export async function comprobarLaGuardada(
  sourceKind: AssetDataSourceKind,
  abierta: { portfolio_id: string; updated_at: string }
): Promise<EstadoDeLaGuardada> {
  try {
    let guardadas: BdbSavedLocalPortfolio[];
    if (usesBackendPersistence(sourceKind)) {
      const { portfolios, discarded } = await backendListPortfolioResult();
      /* Está, pero no se puede leer: no se sabe cómo está. */
      if (discarded.some((descartada) => descartada.portfolio_id === abierta.portfolio_id)) return { estado: "sin-comprobar" };
      guardadas = portfolios;
    } else {
      guardadas = readLocalPortfoliosFromStorage(getBrowserLocalStorage());
    }
    const actual = guardadas.find((cartera) => cartera.portfolio_id === abierta.portfolio_id);
    if (!actual) return { estado: "eliminada" };
    return { estado: actual.updated_at === abierta.updated_at ? "igual" : "cambiada" };
  } catch (causa) {
    appLogger.warn("carteras guardadas: no se ha podido comprobar la abierta antes de guardar", causa);
    return { estado: "sin-comprobar" };
  }
}

export type ResultadoDeGuardado =
  | {
      ok: true;
      cartera: BdbSavedLocalPortfolio;
      /** Las posiciones que se han guardado de verdad: las no invertibles se quedan fuera. */
      positions: BdbManualPortfolioPosition[];
      mensaje: string;
      /** Hay algo que decir además de que se ha guardado: una posición fuera, un aviso del servidor. */
      conAvisos: boolean;
    }
  | {
      ok: false;
      mensaje: string;
      /** DIS-03: el servidor no ha guardado porque la guardada ha cambiado o ya no existe desde que se abrió. */
      conflicto?: MotivoDelConflicto;
    };

/**
 * Guarda el contenido de Diseño de cartera. `sobre` es la cartera abierta que se sobrescribe; sin ella
 * se crea otra. Los activos, si no se pasan, se piden: hacen falta para saber qué es invertible, y el
 * aviso de cambios sin guardar puede salir en una pantalla que no los tiene cargados.
 *
 * DIS-03: sobre una abierta, su `updated_at` va al servidor como condición, salvo con `forzar` («Sobrescribir de
 * todos modos»). Si el servidor la rechaza, el resultado lo dice en `conflicto`.
 */
export async function guardarCartera(peticion: {
  sourceKind: AssetDataSourceKind;
  nombre: string;
  positions: BdbManualPortfolioPosition[];
  capital: number | undefined;
  assets?: BdbAssetDetail[];
  sobre?: { portfolio_id: string; created_at: string; updated_at?: string } | null;
  /** Sobrescribe sin condición: el asesor ya ha decidido pisar lo que haya. */
  forzar?: boolean;
  /** Decisión 59: nivel de perfil y horizonte. Sin ellos, la cartera se guarda sin ninguno de los dos. */
  perfilYHorizonte?: PerfilYHorizonte;
}): Promise<ResultadoDeGuardado> {
  const { sourceKind, nombre, positions, capital, sobre, forzar = false, perfilYHorizonte = {} } = peticion;
  /* Una cartera no se guarda sin nombre: quien pide guardar se lo pide antes al asesor. */
  if (!nombre.trim()) return { ok: false, mensaje: "Escribe un nombre para la cartera." };
  /* Sobre una abierta, sin posiciones, la dejaría vacía para siempre: no hay deshacer. */
  if (sobre && positions.length === 0) {
    return { ok: false, mensaje: "Una cartera sin posiciones no se guarda encima de la guardada: se quedaría vacía. La guardada sigue como estaba." };
  }
  /* Un nivel o un horizonte que no valen no se guardan, ni se cambian por otro: se dice por qué. */
  const motivo = errorDelNivelDePerfil(perfilYHorizonte.risk_profile_level) ?? errorDelHorizonte(perfilYHorizonte.horizon_years);
  if (motivo) return { ok: false, mensaje: `No se ha guardado: ${motivo.charAt(0).toLowerCase()}${motivo.slice(1)}` };
  try {
    const assets =
      peticion.assets ?? (await getAssetDataSource(sourceKind).getComparableAssets(positions.map((posicion) => posicion.asset_id)));
    const cartera = {
      ...createSavedLocalPortfolio({
        sourceKind,
        name: nombre,
        positions,
        assets,
        totalCapital: capital,
        portfolioId: sobre?.portfolio_id,
        createdAt: sobre?.created_at
      }),
      ...perfilYHorizonteDe(perfilYHorizonte)
    };
    /* Una cartera que pierde todas sus posiciones al guardar no es una cartera: es que el catálogo no
       ha contestado, y sobrescribir la abierta con eso la borraría. */
    if (positions.length > 0 && cartera.positions.length === 0) {
      return { ok: false, mensaje: `No se ha guardado ${cartera.name}: ninguna de sus posiciones se ha podido comprobar en el catálogo.` };
    }
    const expectedUpdatedAt = sobre && !forzar ? sobre.updated_at : undefined;
    const { cartera: guardada, avisos, enLaCuenta } = await persistirCartera(sourceKind, cartera, { expectedUpdatedAt });
    const fuera = positions.length - cartera.positions.length;
    const detalle = [
      fuera === 1 ? "Una posición que no se puede proponer se queda sin guardar." : fuera > 1 ? `${fuera} posiciones que no se pueden proponer se quedan sin guardar.` : "",
      ...avisos
    ].filter(Boolean);
    const dondeQueda = enLaCuenta ? `${guardada.name} guardada en tu cuenta.` : `${guardada.name} guardada en este navegador.`;
    return {
      ok: true,
      cartera: guardada,
      positions: cartera.positions,
      mensaje: [dondeQueda, ...detalle].join(" "),
      conAvisos: detalle.length > 0
    };
  } catch (causa) {
    if (causa instanceof ConflictoAlGuardar) return { ok: false, conflicto: causa.motivo, mensaje: causa.message };
    appLogger.warn("carteras guardadas: fallo al guardar", causa);
    return { ok: false, mensaje: `No se ha podido guardar ${nombre}. Lo que hay en pantalla sigue sin guardar: inténtalo de nuevo.` };
  }
}
