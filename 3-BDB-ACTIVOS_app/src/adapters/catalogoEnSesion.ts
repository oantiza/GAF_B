import { listarTarjetas, type Documento } from "./baseNuevaLectura";

/**
 * Las tarjetas del catálogo, leídas una sola vez por sesión y guardadas en memoria.
 *
 * En la web publicada cada visita al Buscador eran 1.091 lecturas facturadas y 2,6 MB (medido el
 * 02-11-2026): ir a una ficha y volver costaba el catálogo entero otra vez. El catálogo no cambia
 * durante una sesión —se refresca a mano, y el refresco de datos se ve al recargar—, así que no hay
 * nada que ganar leyéndolo de nuevo.
 *
 * Es memoria y nada más: no toca el disco, y no lleva datos de ningún cliente. Un fallo no se guarda,
 * para que «Reintentar» vuelva a leer de verdad.
 */

let leidas: Documento[] | null = null;
let enCurso: Promise<Documento[]> | null = null;

/** Las tarjetas si ya se han leído en esta sesión: sirve para pintar sin pasar por «cargando». */
export function catalogoYaLeido(): Documento[] | null {
  return leidas;
}

export function leerCatalogoEnSesion(): Promise<Documento[]> {
  if (leidas !== null) return Promise.resolve(leidas);
  if (enCurso !== null) return enCurso;
  const lectura = listarTarjetas()
    .then((tarjetas) => {
      if (enCurso === lectura) leidas = tarjetas;
      return tarjetas;
    })
    .finally(() => {
      if (enCurso === lectura) enCurso = null;
    });
  enCurso = lectura;
  return lectura;
}

/** Al salir de la sesión, y entre pruebas. */
export function olvidarCatalogoEnSesion(): void {
  leidas = null;
  enCurso = null;
}
