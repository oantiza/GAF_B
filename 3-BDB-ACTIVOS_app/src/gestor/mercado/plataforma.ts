/**
 * La plataforma como fuente de datos de mercado: lee la base nueva con el lector que ya usa
 * la app (`adapters/baseNuevaLectura.ts`), que en desarrollo va al emulador y en producción
 * al proyecto con la sesión del asesor. Solo lectura, y solo datos de mercado.
 */
import { leerCatalogoEnSesion } from "../../adapters/catalogoEnSesion";
import { BASE_NUEVA_DISPONIBLE, leerDocumento } from "../../adapters/baseNuevaLectura";
import type { FuenteDeMercado } from "./cargar";
import { activoDeCatalogo, type ActivoDeCatalogo } from "./fichas";

/** Si esta instalación tiene camino a la plataforma. Si no, el gestor funciona con precios a mano. */
export const HAY_PLATAFORMA = BASE_NUEVA_DISPONIBLE;

export const fuenteDeLaPlataforma: FuenteDeMercado = {
  preciosDelAnio: (isin, anio) => leerDocumento(`instruments/${isin}/price_series/${anio}`),
  cambiosDelAnio: (divisa, anio) => leerDocumento(`fx_rates/${divisa}_${anio}`),
  libreDeRiesgoDelAnio: (anio) => leerDocumento(`reference_rates/ESTR_${anio}`),
  tarjeta: (isin) => leerDocumento(`instruments/${isin}/read/card`)
};

let catalogo: Promise<ActivoDeCatalogo[]> | undefined;

/** El catálogo de la plataforma, leído una vez por sesión, para buscar activos por nombre, ISIN o símbolo. */
export function catalogoDeActivos(): Promise<ActivoDeCatalogo[]> {
  if (!HAY_PLATAFORMA) return Promise.resolve([]);
  if (!catalogo) {
    catalogo = leerCatalogoEnSesion()
      .then((tarjetas) => tarjetas.map(activoDeCatalogo).filter((activo): activo is ActivoDeCatalogo => activo !== undefined))
      .catch((error: unknown) => {
        catalogo = undefined;
        throw error;
      });
  }
  return catalogo;
}
