/**
 * La firma que el asesor escribió en el diálogo de informes antes de que hubiera una identidad común para toda la
 * aplicación. Vivía en los ajustes de la carpeta de carteras (`AjustesDelGestor.asesor`); hoy la firma de todos los
 * informes es `src/core/identidadDelAsesor.ts`.
 *
 * Para que no se pierda lo ya escrito: si la identidad del navegador está **vacía** —nada guardado por el asesor, ni
 * nombre, ni entidad, ni contacto, ni logotipo— y los ajustes de la carpeta traen datos del asesor, se adoptan **una
 * vez** y se guardan en la identidad. Una identidad ya escrita no se pisa nunca, y en los ajustes de la carpeta no se
 * vuelve a escribir.
 *
 * El nombre visible de la cuenta, que la identidad propone cuando no hay nada guardado, no cuenta como escrito por el
 * asesor: se adopta la firma de la carpeta igual.
 */
import { auth } from "../../../firebase";
import { claveDeLaIdentidad, identidadLimpia, leerIdentidad, type IdentidadDelAsesor, type ResultadoDeGuardar } from "../../../core/identidadDelAsesor";
import type { AlmacenDeCarteras } from "../../almacen/almacen";

/** Las cuentas (o, sin cuenta, la sesión) que ya han adoptado la firma de una carpeta en esta visita. */
const yaAdoptada = new Set<string>();

/** Si el asesor ha escrito ya algo en su identidad: en el navegador, o en memoria si el navegador no deja guardar. */
export function identidadEscritaPorElAsesor(): boolean {
  const clave = claveDeLaIdentidad();
  if (clave) {
    try {
      if (globalThis.localStorage?.getItem(clave) != null) return true;
    } catch {
      /* Sin acceso al navegador, se mira lo que hay en memoria. */
    }
  }
  const actual = identidadLimpia(leerIdentidad());
  const nombreDeLaCuenta = (auth?.currentUser?.displayName ?? "").trim();
  return Boolean(actual.entidad || actual.contacto || actual.logotipo || (actual.nombre && actual.nombre !== nombreDeLaCuenta));
}

/**
 * Lee los ajustes de la carpeta y, si procede, guarda su firma en la identidad. Devuelve si la ha adoptado. Un fallo al
 * leer los ajustes no impide nada: la firma se puede escribir con «Cambiar».
 */
export async function adoptarLaFirmaDeLaCarpeta(
  almacen: Pick<AlmacenDeCarteras, "leerAjustes">,
  guardar: (identidad: IdentidadDelAsesor) => ResultadoDeGuardar,
  sigueVigente: () => boolean = () => true
): Promise<boolean> {
  const cuenta = claveDeLaIdentidad() ?? "";
  if (yaAdoptada.has(cuenta) || identidadEscritaPorElAsesor()) return false;
  let deLaCarpeta: IdentidadDelAsesor;
  try {
    deLaCarpeta = identidadLimpia((await almacen.leerAjustes()).asesor ?? {});
  } catch {
    return false;
  }
  if (!sigueVigente() || Object.keys(deLaCarpeta).length === 0) return false;
  /* Se vuelve a mirar: mientras se leía la carpeta, el asesor ha podido escribir su firma. */
  if (yaAdoptada.has(cuenta) || identidadEscritaPorElAsesor()) return false;
  yaAdoptada.add(cuenta);
  guardar(deLaCarpeta);
  return true;
}

/** Solo para las pruebas: olvida qué cuentas han adoptado ya la firma. */
export function olvidarLasAdopciones(): void {
  yaAdoptada.clear();
}
