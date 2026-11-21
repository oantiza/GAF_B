import { useEffect, useState } from "react";
import { appLogger } from "../core/appLogger";
import { soloLasParadas } from "../core/serieParada";
import { diaLocal } from "../core/fechaLocal";
import { BASE_NUEVA_DISPONIBLE, leerAnioDeLaSerie, type Documento } from "./baseNuevaLectura";

/**
 * De dónde sale la fecha del último dato de la serie de una posición (decisión B-78): del `last_date` del documento de su último año en
 * `instruments/{id}/price_series/{año}`, buscado por id desde el año del documento hacia atrás (`ANIOS_HACIA_ATRAS`), por el mismo camino que la ficha y los avisos del mercado objetivo (`baseNuevaLectura`: REST al emulador
 * en desarrollo, el SDK con la sesión del asesor en producción, donde las reglas abren `instruments/{id}/**`). Es la serie con la que el
 * servidor simula la cartera.
 *
 * **No cambia ningún contrato ni toca Functions.** `asset-for-bdb` trae `latest_value_date`, que es la fecha del último valor liquidativo y no
 * la de la serie, y `metrics_latest.last_date` se queda en el servidor. Una serie viva cuesta una lectura (dos en enero, antes de su primer
 * dato del año); una parada desde 2022, cinco en 2026. Una vez por sesión.
 *
 * Lo que no se puede leer se queda sin fecha, y una posición sin fecha no avisa: no se afirma que esté parada.
 */

/** Cuántos años, contando el del documento, se buscan hacia atrás. Una serie parada hace más, o sin ningún año, se queda sin fecha y no avisa. */
export const ANIOS_HACIA_ATRAS = 15;

type LectorDeUnAnio = (id: string, anio: number) => Promise<Documento | undefined>;

/**
 * El último dato de la serie de un instrumento, «AAAA-MM-DD»: el `last_date` del año más reciente que exista, desde `desdeAnio` hacia atrás.
 * Null si la base contesta y no tiene ninguno en el tope; lanza si no contesta.
 */
export async function leerFinDeLaSerie(id: string, desdeAnio: number, leer: LectorDeUnAnio = leerAnioDeLaSerie): Promise<string | null> {
  /* Un identificador que no puede ser una ruta de la base no es de un instrumento suyo. */
  if (!id || id.includes("/") || !Number.isInteger(desdeAnio)) return null;
  for (let anio = desdeAnio; anio > desdeAnio - ANIOS_HACIA_ATRAS; anio--) {
    const documento = await leer(id, anio);
    if (documento) {
      const ultima = documento["last_date"];
      return typeof ultima === "string" ? ultima : null;
    }
  }
  return null;
}

/** Lo ya leído en esta sesión. Un fallo no se guarda, para que la siguiente vez se intente de nuevo. */
const leidos = new Map<string, string | null>();

/** Solo para las pruebas. */
export function olvidarFinesDeSerieLeidos(): void {
  leidos.clear();
}

/** Las fechas que se conocen, por posición. Las que no se han podido leer, o no tienen serie, no están. */
export async function finesDeSerie(ids: readonly string[], generadoEn: string, leer?: LectorDeUnAnio, disponible = BASE_NUEVA_DISPONIBLE): Promise<Map<string, string>> {
  const dia = diaLocal(generadoEn);
  if (!disponible || !dia) return new Map();
  const desdeAnio = Number(dia.slice(0, 4));
  const pares = await Promise.all(
    [...new Set(ids)].map(async (id): Promise<readonly [string, string | null]> => {
      try {
        if (!leidos.has(id)) leidos.set(id, await leerFinDeLaSerie(id, desdeAnio, leer));
        return [id, leidos.get(id) ?? null];
      } catch (causa) {
        appLogger.warn("No se pudo leer el final de la serie de una posición", causa);
        return [id, null];
      }
    })
  );
  return new Map(pares.filter((par): par is readonly [string, string] => par[1] !== null));
}

/** Las posiciones con la serie parada, posición → último dato: lo que reciben los documentos. Sin ninguna, un mapa vacío y el papel no cambia. */
export async function seriesParadas(ids: readonly string[], generadoEn: string): Promise<ReadonlyMap<string, string>> {
  return soloLasParadas(await finesDeSerie(ids, generadoEn), generadoEn);
}

const NINGUNA: ReadonlyMap<string, string> = new Map();

/** Lo mismo para una pantalla. Vacío mientras no ha llegado: un aviso de menos durante un instante, nunca uno falso. */
export function useSeriesParadas(ids: readonly string[], activo = true): ReadonlyMap<string, string> {
  const clave = [...new Set(ids)].sort().join(",");
  const [resultado, setResultado] = useState<{ clave: string; paradas: ReadonlyMap<string, string> } | null>(null);

  useEffect(() => {
    if (!activo || !clave) return;
    let vivo = true;
    void seriesParadas(clave.split(","), new Date().toISOString()).then((paradas) => {
      if (vivo) setResultado({ clave, paradas });
    });
    return () => {
      vivo = false;
    };
  }, [clave, activo]);

  return activo && resultado?.clave === clave ? resultado.paradas : NINGUNA;
}
