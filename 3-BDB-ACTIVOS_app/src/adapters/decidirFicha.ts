/**
 * Qué se pinta al abrir `/activo/<ISIN>`, a partir de lo que han contestado las dos lecturas.
 *
 * Es una decisión y se prueba como tal, sin pantalla. Antes de esto la pantalla enseñaba la ficha
 * anterior mientras llegaba la nueva, y cualquier fallo se resolvía cayendo a ella: se veían dos fichas
 * seguidas, y una caída de la red no se distinguía de un instrumento que no existe.
 *
 * | Base nueva  | La otra lectura | Se pinta                                                |
 * |-------------|-----------------|---------------------------------------------------------|
 * | lo conoce   | da igual        | La ficha, en cuanto contesta: no espera a la otra       |
 * | no contesta | da igual        | «No hemos podido leer», aunque la otra lo tenga         |
 * | esperando   | da igual        | «Cargando la ficha…» y nada más                         |
 * | no lo conoce| lo conoce       | La ficha anterior: es lo único que hay de ese activo    |
 * | no lo conoce| no lo conoce    | «No encontramos este instrumento»                       |
 * | no lo conoce| no contesta     | «No hemos podido leer»: no se puede afirmar que no está |
 * | no lo conoce| esperando       | «Cargando la ficha…»                                    |
 *
 * La ficha anterior solo sale, por tanto, por una razón: que la base nueva no conozca el instrumento.
 * Nunca de paso, y nunca porque la lectura haya fallado.
 */
export type LecturaDeLaBaseNueva<I> =
  | { estado: "esperando" }
  | { estado: "no-contesta" }
  | { estado: "no-lo-conoce" }
  | { estado: "lo-conoce"; instrumento: I };

export type LecturaDelActivo<A> =
  | { estado: "esperando" }
  | { estado: "no-contesta" }
  | { estado: "no-lo-conoce" }
  | { estado: "lo-conoce"; activo: A };

export type PantallaDeFicha<I, A> =
  | { pantalla: "cargando" }
  | { pantalla: "no-se-pudo-leer" }
  | { pantalla: "no-existe" }
  | { pantalla: "anterior"; activo: A }
  | { pantalla: "ficha"; instrumento: I; activo: A | null };

export function decidirFicha<I, A>(
  baseNueva: LecturaDeLaBaseNueva<I>,
  activo: LecturaDelActivo<A>
): PantallaDeFicha<I, A> {
  if (baseNueva.estado === "lo-conoce") {
    return {
      pantalla: "ficha",
      instrumento: baseNueva.instrumento,
      activo: activo.estado === "lo-conoce" ? activo.activo : null
    };
  }
  if (baseNueva.estado === "no-contesta") return { pantalla: "no-se-pudo-leer" };
  if (baseNueva.estado === "esperando") return { pantalla: "cargando" };
  switch (activo.estado) {
    case "esperando":
      return { pantalla: "cargando" };
    case "no-contesta":
      return { pantalla: "no-se-pudo-leer" };
    case "no-lo-conoce":
      return { pantalla: "no-existe" };
    case "lo-conoce":
      return { pantalla: "anterior", activo: activo.activo };
  }
}
