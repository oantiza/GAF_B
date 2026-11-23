/**
 * El almacén de carteras sobre una carpeta del disco del usuario (File System Access API).
 *
 * Disposición de la carpeta:
 *
 *     <carpeta elegida>/
 *       Familia García.cartera.json        un fichero por cartera
 *       Cartera modelo 60-40.cartera.json
 *       ajustes.json                       nombre y logotipo del asesor
 *       copias/<id de la cartera>/2026-11-13T15-04-22Z.cartera.json
 *       papelera/…                         lo retirado, con sus copias en papelera/copias/
 *
 * ESCRITURA SEGURA. `createWritable()` escribe en un fichero temporal del navegador y solo
 * sustituye al fichero vivo cuando el flujo se cierra bien: si la escritura falla a mitad, el
 * fichero que había sigue intacto. Nunca se trunca el fichero vivo. Después de escribir se
 * vuelve a leer y se comprueba que es exactamente lo escrito y que `leer` lo abre; si no, se
 * restituye lo que había y se avisa.
 *
 * COPIAS. Antes de sustituir una cartera por un contenido distinto, si la última copia de esa
 * cartera tiene más de diez minutos (o no hay ninguna), se copia el contenido ANTERIOR a
 * `copias/<id>/`. Cada sesión de trabajo deja, como mínimo, la versión con la que empezó. Si la
 * copia no se puede hacer, no se guarda: antes no guardar que perder la versión anterior. Con
 * `copiaObligada` (cambios grandes y destructivos) se copia sin mirar los diez minutos.
 *
 * NO SE PISA LO DE OTRA PESTAÑA. El almacén recuerda la huella (el texto sin la marca de
 * guardado) de lo que leyó o escribió por última vez de cada cartera. Antes de escribir, si lo
 * que hay en el disco no es eso, alguien lo ha cambiado por fuera (otra pestaña, otro equipo con
 * la carpeta sincronizada): no se escribe, se copia SIEMPRE lo del disco a sus copias y se falla
 * con `CONFLICTO`. Una cartera que este almacén no ha leído ni escrito se guarda como siempre.
 *
 * UNA ESCRITURA CADA VEZ, AUNQUE HAYA VARIAS PESTAÑAS. Comprobar la huella y escribir no es
 * atómico: dos pestañas que guardasen a la vez pasarían las dos la comprobación. Por eso toda
 * escritura en la carpeta (guardar, retirar, recuperar y los ajustes) se hace con un cerrojo de la
 * Web Locks API compartido por todas las pestañas del navegador, y la segunda pestaña ya ve lo que
 * escribió la primera y falla con `CONFLICTO`. Sin `navigator.locks`, se queda la cola de esta
 * pestaña, como antes del 22-11-2026. Y si al volver a leer lo escrito resulta que en el disco hay
 * otra versión válida (la escribió alguien de fuera entretanto), no se restituye nada encima: se
 * deja lo que hay, la versión que esta pestaña intentaba guardar va a sus copias, y se falla con
 * `CONFLICTO`.
 *
 * NUNCA SE BORRA UNA CARTERA desde aquí: `retirar` la mueve a `papelera/` con sus copias. Lo
 * único que se elimina son copias que la retención ya no conserva y el fichero de nombre
 * antiguo cuando una cartera cambia de nombre (después de escribir y comprobar el nuevo).
 *
 * RECUPERAR es retirar al revés, y tampoco pisa nada: la cartera vuelve con el fichero de su
 * nombre y sus copias vuelven a `copias/<id>/`. Si en la carpeta ya está esa misma cartera, o
 * hay otra con su nombre, no se recupera y se dice (`YA_EXISTE`): lo que hay no se toca y lo
 * retirado sigue en la papelera.
 */
import type { Cartera } from "../motor/modelo";
import { permisoDe } from "./acceso";
import {
  ErrorDeAlmacen,
  type AjustesDelGestor,
  type AlmacenDeCarteras,
  type CarteraRetirada,
  type CodigoDeErrorDeAlmacen,
  type CopiaDeSeguridad,
  type OpcionesDeGuardado,
  type ResumenDeCartera
} from "./almacen";
import { copiasAConservar, fechaDeCopia, marcaDeTiempo, nombreDeCopia, ordenarCopias, tocaCopia } from "./copias";
import { ErrorDeFormato, leer, ordenarClaves, serializar, sinMarcaDeGuardado, type CarteraLeida, type Esquema } from "./formato";
import { EXTENSION_DE_CARTERA, esFicheroDeCartera, nombreDeFicheroPara, sanearNombre, sinExtension } from "./nombres";

/** Lo que el almacén usa de la Web Locks API (`navigator.locks`): un cerrojo exclusivo por nombre. */
export interface GestorDeCerrojos {
  request(nombre: string, tarea: () => Promise<unknown>): Promise<unknown>;
}

export interface OpcionesDelAlmacen {
  /** El reloj. Las pruebas lo inyectan para simular el paso del tiempo. */
  ahora?: () => Date;
  /**
   * Los cerrojos compartidos entre pestañas. Por defecto, `navigator.locks`; con `null`, o si el
   * navegador no los tiene, las escrituras solo van en fila dentro de esta pestaña.
   */
  cerrojos?: GestorDeCerrojos | null;
}

/** El prefijo del cerrojo de escritura de una carpeta de carteras. */
export const PREFIJO_DEL_CERROJO = "gestor-cartera:";

function cerrojosDelNavegador(): GestorDeCerrojos | null {
  const navegador = (globalThis as { navigator?: { locks?: GestorDeCerrojos } }).navigator;
  return typeof navegador?.locks?.request === "function" ? navegador.locks : null;
}

export const FICHERO_DE_AJUSTES = "ajustes.json";
export const CARPETA_DE_COPIAS = "copias";
export const CARPETA_DE_PAPELERA = "papelera";
export const FORMATO_DE_AJUSTES = "gestor-carteras-ajustes";

const ESQUEMA_DE_AJUSTES: Esquema = {
  claves: ["formato", "version", "guardado", "ajustes"],
  campos: {
    ajustes: {
      claves: ["asesor", "extensiones"],
      campos: { asesor: { claves: ["nombre", "entidad", "contacto", "logotipo"] } }
    }
  }
};

/* ------------------------------------------------------------------ errores */

function nombreDelError(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) return undefined;
  return typeof error.name === "string" ? error.name : undefined;
}

type Accion = "leer" | "escribir";

/** Traduce un error del navegador a un `ErrorDeAlmacen` con un mensaje que se puede enseñar. */
function traducir(error: unknown, accion: Accion, fichero?: string): Error {
  if (error instanceof ErrorDeAlmacen || error instanceof ErrorDeFormato) return error;
  const crear = (codigo: CodigoDeErrorDeAlmacen, mensaje: string) => new ErrorDeAlmacen(codigo, mensaje, { cause: error });
  switch (nombreDelError(error)) {
    case "NotAllowedError":
    case "SecurityError":
      return crear(
        "PERMISO",
        accion === "escribir"
          ? "No hay permiso para escribir en la carpeta de carteras. Vuelve a elegirla."
          : "No hay permiso para leer la carpeta de carteras. Vuelve a elegirla."
      );
    case "NotFoundError":
      return fichero === undefined
        ? crear("CARPETA_NO_DISPONIBLE", "La carpeta de carteras ya no está disponible: puede que se haya movido, renombrado o borrado, o que esté en una unidad desconectada. Vuelve a elegirla.")
        : crear("NO_ENCONTRADO", `No se encuentra «${fichero}» en la carpeta de carteras. Puede que se haya movido o borrado fuera de la aplicación.`);
    case "QuotaExceededError":
      return crear("ESCRITURA", "No queda espacio en el disco para guardar. El fichero que había sigue intacto.");
    case "NoModificationAllowedError":
    case "InvalidModificationError":
    case "InvalidStateError":
      return crear("ESCRITURA", "El fichero está bloqueado o lo ha cambiado otro programa mientras se guardaba. El fichero que había sigue intacto; vuelve a intentarlo.");
    default:
      return accion === "escribir"
        ? crear("ESCRITURA", "No se pudo escribir en la carpeta de carteras. El fichero que había sigue intacto.")
        : crear("LECTURA", "No se pudo leer la carpeta de carteras.");
  }
}

async function protegido<T>(accion: Accion, tarea: () => Promise<T>, fichero?: string): Promise<T> {
  try {
    return await tarea();
  } catch (error) {
    throw traducir(error, accion, fichero);
  }
}

/* ------------------------------------------------------------------ disco */

function noEsta(error: unknown): boolean {
  const nombre = nombreDelError(error);
  return nombre === "NotFoundError" || nombre === "TypeMismatchError";
}

async function manejadorDeFichero(carpeta: FileSystemDirectoryHandle, nombre: string): Promise<FileSystemFileHandle | undefined> {
  try {
    return await carpeta.getFileHandle(nombre);
  } catch (error) {
    if (noEsta(error)) return undefined;
    throw error;
  }
}

async function subcarpeta(carpeta: FileSystemDirectoryHandle, nombre: string, crear: boolean): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await carpeta.getDirectoryHandle(nombre, { create: crear });
  } catch (error) {
    if (!crear && noEsta(error)) return undefined;
    throw error;
  }
}

interface Leido {
  texto: string;
  bytes: number;
  modificado: number;
}

async function leerTexto(carpeta: FileSystemDirectoryHandle, nombre: string): Promise<Leido | undefined> {
  const manejador = await manejadorDeFichero(carpeta, nombre);
  if (manejador === undefined) return undefined;
  const fichero = await manejador.getFile();
  return { texto: await fichero.text(), bytes: fichero.size, modificado: fichero.lastModified };
}

async function existe(carpeta: FileSystemDirectoryHandle, nombre: string): Promise<boolean> {
  return (await manejadorDeFichero(carpeta, nombre)) !== undefined;
}

/**
 * Escribe un fichero entero con `createWritable()`, que escribe en un temporal y sustituye al
 * cerrar. Si falla, se aborta el flujo (el fichero vivo no cambia) y, si el fichero no existía,
 * se quita el vacío que el navegador crea al pedir el manejador.
 */
async function escribirTexto(carpeta: FileSystemDirectoryHandle, nombre: string, texto: string): Promise<void> {
  const existia = await existe(carpeta, nombre);
  const manejador = await carpeta.getFileHandle(nombre, { create: true });
  let flujo: FileSystemWritableFileStream | undefined;
  try {
    flujo = await manejador.createWritable();
    await flujo.write(texto);
    await flujo.close();
  } catch (error) {
    if (flujo !== undefined) await flujo.abort().catch(() => undefined);
    if (!existia) await carpeta.removeEntry(nombre).catch(() => undefined);
    throw error;
  }
}

async function ficherosDe(carpeta: FileSystemDirectoryHandle): Promise<FileSystemFileHandle[]> {
  const ficheros: FileSystemFileHandle[] = [];
  for await (const manejador of carpeta.values()) {
    if (manejador.kind === "file") ficheros.push(manejador);
  }
  return ficheros.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Windows no distingue mayúsculas en los nombres: «a.json» y «A.json» son el mismo fichero. */
function mismoNombre(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** El id de la cartera de un texto, sin validar nada más. */
function idDelTexto(texto: string): string | undefined {
  try {
    const datos: unknown = JSON.parse(texto.replace(/^\uFEFF/, ""));
    if (typeof datos !== "object" || datos === null) return undefined;
    const cartera = (datos as { cartera?: unknown }).cartera;
    if (typeof cartera !== "object" || cartera === null) return undefined;
    const id = (cartera as { id?: unknown }).id;
    return typeof id === "string" && id !== "" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** El nombre de la cartera de un texto, sin validar nada más. */
function nombreDelTexto(texto: string): string | undefined {
  try {
    const nombre = (JSON.parse(texto.replace(/^\uFEFF/, "")) as { cartera?: { nombre?: unknown } }).cartera?.nombre;
    return typeof nombre === "string" ? nombre : undefined;
  } catch {
    return undefined;
  }
}

/** Dos nombres de cartera que se leen igual: sin espacios de los lados y sin distinguir mayúsculas. */
function mismoNombreDeCartera(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function movimientosDelTexto(texto: string): number | undefined {
  try {
    const datos = JSON.parse(texto) as { cartera?: { movimientos?: unknown } };
    const movimientos = datos.cartera?.movimientos;
    return Array.isArray(movimientos) ? movimientos.length : undefined;
  } catch {
    return undefined;
  }
}

function bytesDe(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

function mensajeDe(error: unknown): string {
  if (error instanceof ErrorDeFormato || error instanceof ErrorDeAlmacen) return error.message;
  return "No se pudo leer el fichero.";
}

/** El nombre de la subcarpeta de copias de una cartera: su id, saneado por si acaso. */
function carpetaDeLasCopias(carteraId: string): string {
  return sanearNombre(carteraId);
}

/* ------------------------------------------------------------------ el almacén */

export function almacenEnCarpeta(carpeta: FileSystemDirectoryHandle, opciones: OpcionesDelAlmacen = {}): AlmacenDeCarteras {
  const ahora = opciones.ahora ?? (() => new Date());
  const cerrojos = opciones.cerrojos === undefined ? cerrojosDelNavegador() : opciones.cerrojos;

  /** Dónde está cada cartera abierta o guardada en esta sesión: id → nombre del fichero. */
  const ubicaciones = new Map<string, string>();

  /** Lo último que esta pestaña leyó o escribió de cada cartera: id → texto sin la marca de guardado. */
  const huellas = new Map<string, string>();

  /* Las escrituras van de una en una: dos guardados seguidos (un autoguardado y uno a mano)
     no se pisan a mitad. */
  let cola: Promise<unknown> = Promise.resolve();
  function enCola<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = cola.then(tarea, tarea);
    cola = resultado.catch(() => undefined);
    return resultado;
  }

  /*
   * Y entre pestañas, con un cerrojo de la Web Locks API. Es uno por carpeta y no uno por cartera:
   * guardar una cartera con nombre nuevo, o recuperarla, mira los nombres de las demás, y dos
   * carteras distintas que se escribiesen a la vez con el mismo nombre se pisarían. La carpeta se
   * reconoce por su nombre (el navegador no da su ruta): dos carpetas que se llamen igual
   * comparten cerrojo, que solo hace que esperen una a otra unos milisegundos.
   */
  function enExclusiva<T>(tarea: () => Promise<T>): Promise<T> {
    return enCola(() => (cerrojos === null ? tarea() : (cerrojos.request(`${PREFIJO_DEL_CERROJO}${carpeta.name}`, tarea) as Promise<T>)));
  }

  /**
   * El fichero que hoy guarda la cartera `id`, con su texto. Primero el que se conoce de esta
   * sesión (si sigue siendo de esa cartera), después el nombre que le tocaría y, si no, se
   * busca en toda la carpeta.
   */
  async function ubicar(id: string, candidato: string): Promise<{ fichero: string; texto: string } | undefined> {
    for (const nombre of [ubicaciones.get(id), candidato]) {
      if (nombre === undefined) continue;
      const leido = await leerTexto(carpeta, nombre);
      if (leido !== undefined && idDelTexto(leido.texto) === id) return { fichero: nombre, texto: leido.texto };
    }
    ubicaciones.delete(id);
    for (const manejador of await ficherosDe(carpeta)) {
      if (!esFicheroDeCartera(manejador.name)) continue;
      const texto = await (await manejador.getFile()).text();
      if (idDelTexto(texto) === id) return { fichero: manejador.name, texto };
    }
    return undefined;
  }

  /**
   * El nombre de fichero donde se escribe la cartera: el de su nombre si está libre o ya es
   * suyo; si lo ocupa OTRA cartera, el mismo con el principio del id; y, en el caso
   * improbable de que también esté ocupado, con el id entero o un número.
   */
  async function elegirDestino(cartera: Cartera, origen: string | undefined): Promise<string> {
    const candidatos = [
      nombreDeFicheroPara(cartera.nombre),
      nombreDeFicheroPara(cartera.nombre, cartera.id.slice(0, 8)),
      nombreDeFicheroPara(cartera.nombre, cartera.id)
    ];
    for (let n = 2; n <= 99; n += 1) candidatos.push(nombreDeFicheroPara(cartera.nombre, `${cartera.id.slice(0, 8)}-${n}`));
    for (const candidato of candidatos) {
      if (origen !== undefined && mismoNombre(candidato, origen)) return origen;
      if (!(await existe(carpeta, candidato))) return candidato;
    }
    throw new ErrorDeAlmacen("ESCRITURA", `No se encuentra un nombre de fichero libre para la cartera «${cartera.nombre}».`);
  }

  async function copiasDe(carteraId: string, conDetalle: boolean): Promise<CopiaDeSeguridad[]> {
    const raiz = await subcarpeta(carpeta, CARPETA_DE_COPIAS, false);
    const suya = raiz === undefined ? undefined : await subcarpeta(raiz, carpetaDeLasCopias(carteraId), false);
    if (suya === undefined) return [];
    const copias: CopiaDeSeguridad[] = [];
    for (const manejador of await ficherosDe(suya)) {
      if (!esFicheroDeCartera(manejador.name)) continue;
      const fichero = await manejador.getFile();
      const copia: CopiaDeSeguridad = {
        carteraId,
        fichero: manejador.name,
        fecha: fechaDeCopia(manejador.name) ?? new Date(fichero.lastModified).toISOString(),
        bytes: fichero.size
      };
      if (conDetalle) {
        const movimientos = movimientosDelTexto(await fichero.text());
        if (movimientos !== undefined) copia.movimientos = movimientos;
      }
      copias.push(copia);
    }
    return ordenarCopias(copias);
  }

  /** Copia `anterior` a las copias de la cartera si toca (o siempre, si es obligada), y aplica la retención. */
  async function quizaCopiar(carteraId: string, anterior: string, momento: Date, obligada = false): Promise<CopiaDeSeguridad | undefined> {
    const existentes = await copiasDe(carteraId, false);
    if (!obligada && !tocaCopia(existentes, momento)) return undefined;
    const raiz = await subcarpeta(carpeta, CARPETA_DE_COPIAS, true);
    const suya = (await subcarpeta(raiz!, carpetaDeLasCopias(carteraId), true))!;
    let nombre = nombreDeCopia(momento);
    for (let desempate = 2; await existe(suya, nombre); desempate += 1) nombre = nombreDeCopia(momento, desempate);
    await escribirTexto(suya, nombre, anterior);
    const comprobado = await leerTexto(suya, nombre);
    if (comprobado?.texto !== anterior) {
      throw new ErrorDeAlmacen("ESCRITURA", "No se pudo hacer la copia de seguridad de la versión anterior, así que la cartera no se ha guardado. El fichero que había sigue intacto.");
    }
    const copia: CopiaDeSeguridad = { carteraId, fichero: nombre, fecha: fechaDeCopia(nombre) ?? momento.toISOString(), bytes: bytesDe(anterior) };
    const movimientos = movimientosDelTexto(anterior);
    if (movimientos !== undefined) copia.movimientos = movimientos;

    const conservar = new Set(copiasAConservar([...existentes, copia], momento).map((c) => c.fichero));
    for (const vieja of existentes) {
      /* Si una copia vieja no se puede quitar, se queda: sobra, pero no hace daño. */
      if (!conservar.has(vieja.fichero)) await suya.removeEntry(vieja.fichero).catch(() => undefined);
    }
    return copia;
  }

  async function guardarSinCola(cartera: Cartera, opciones: OpcionesDeGuardado): Promise<{ fichero: string; copia?: CopiaDeSeguridad }> {
    if (typeof cartera.id !== "string" || cartera.id.trim() === "") {
      throw new ErrorDeAlmacen("ESCRITURA", "La cartera no tiene identificador y no se puede guardar.");
    }
    const momento = ahora();
    const texto = serializar(cartera, momento.toISOString());
    /* Nunca se escribe algo que luego no se pueda abrir. */
    try {
      leer(texto);
    } catch (error) {
      throw new ErrorDeAlmacen("ESCRITURA", `La cartera no se ha guardado porque no se podría volver a abrir: ${mensajeDe(error)}`);
    }

    const origen = await ubicar(cartera.id, nombreDeFicheroPara(cartera.nombre));
    const destino = await elegirDestino(cartera, origen?.fichero);
    const enSuSitio = origen !== undefined && mismoNombre(origen.fichero, destino);
    const sinCambios = origen !== undefined && sinMarcaDeGuardado(origen.texto) === sinMarcaDeGuardado(texto);
    if (enSuSitio && sinCambios) {
      ubicaciones.set(cartera.id, destino);
      huellas.set(cartera.id, sinMarcaDeGuardado(texto));
      return { fichero: destino };
    }

    /* Lo del disco no es lo que esta pestaña leyó o escribió: alguien lo ha cambiado por fuera. */
    const conocida = huellas.get(cartera.id);
    if (origen !== undefined && !sinCambios && conocida !== undefined && sinMarcaDeGuardado(origen.texto) !== conocida) {
      let copiado = true;
      try {
        await quizaCopiar(cartera.id, origen.texto, momento, true);
      } catch {
        copiado = false;
      }
      throw new ErrorDeAlmacen(
        "CONFLICTO",
        `La cartera «${cartera.nombre}» ha cambiado fuera de esta pestaña (en otra pestaña, en otro equipo o en otro programa) desde que la abriste. No se ha guardado, para no pisar esos cambios${copiado ? "; lo que hay en el disco queda también en sus copias de seguridad" : ""}.`
      );
    }

    const copia = origen !== undefined && !sinCambios ? await quizaCopiar(cartera.id, origen.texto, momento, opciones.copiaObligada === true) : undefined;

    try {
      await escribirTexto(carpeta, destino, texto);
    } catch (error) {
      const traducido = traducir(error, "escribir");
      throw new ErrorDeAlmacen(
        traducido instanceof ErrorDeAlmacen ? traducido.codigo : "ESCRITURA",
        `No se pudo guardar la cartera «${cartera.nombre}». ${traducido.message}`,
        { cause: error }
      );
    }

    if (!(await escritoBien(destino, texto))) {
      /* Si lo que hay ahora es otra versión que se abre bien, no es lo nuestro estropeado: lo ha escrito alguien de fuera
         entretanto. Restituir lo anterior, o quitar el fichero, borraría esa versión; se deja como está, y lo que esta
         pestaña quería guardar va a las copias de la cartera, para que no se pierda. La huella no cambia: hasta recargar,
         los siguientes guardados también darán CONFLICTO. */
      if (await hayOtraVersion(destino, texto, enSuSitio ? origen.texto : undefined)) {
        let copiado = true;
        try {
          await quizaCopiar(cartera.id, texto, momento, true);
        } catch {
          copiado = false;
        }
        throw new ErrorDeAlmacen(
          "CONFLICTO",
          `La cartera «${cartera.nombre}» ha cambiado fuera de esta pestaña (en otra pestaña, en otro equipo o en otro programa) mientras se guardaba. No se da por guardada, y lo que hay ahora en el disco no se ha tocado${copiado ? "; lo que intentabas guardar queda en sus copias de seguridad" : ""}.`
        );
      }
      /* Se deja todo como estaba: el contenido anterior si el fichero ya existía, y nada si era nuevo. */
      if (enSuSitio) await escribirTexto(carpeta, destino, origen.texto).catch(() => undefined);
      else await carpeta.removeEntry(destino).catch(() => undefined);
      throw new ErrorDeAlmacen(
        "VERIFICACION",
        `La cartera «${cartera.nombre}» se escribió, pero al volver a leerla no se pudo abrir, así que no se da por guardada. Se ha dejado el fichero como estaba${copia === undefined ? "" : " y hay una copia de la versión anterior"}. Vuelve a intentarlo.`
      );
    }

    /* Cambio de nombre: el fichero antiguo se quita solo después de comprobar el nuevo. Si no se
       puede quitar, quedan dos ficheros de la misma cartera, que es molesto pero no pierde nada. */
    if (origen !== undefined && !enSuSitio) await carpeta.removeEntry(origen.fichero).catch(() => undefined);
    ubicaciones.set(cartera.id, destino);
    huellas.set(cartera.id, sinMarcaDeGuardado(texto));
    return copia === undefined ? { fichero: destino } : { fichero: destino, copia };
  }

  async function escritoBien(nombre: string, texto: string): Promise<boolean> {
    try {
      const releido = await leerTexto(carpeta, nombre);
      if (releido?.texto !== texto) return false;
      leer(releido.texto);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Si en `nombre` hay ahora una versión que no es la que esta escritura dejó (`escrito`) ni la que había antes
   * (`anterior`): un fichero de cartera que se abre bien, o ningún fichero donde antes había uno. Un contenido que no
   * se abre es lo nuestro estropeado al escribir, y eso sí se puede restituir.
   */
  async function hayOtraVersion(nombre: string, escrito: string, anterior: string | undefined): Promise<boolean> {
    let actual: Leido | undefined;
    try {
      actual = await leerTexto(carpeta, nombre);
    } catch {
      return false;
    }
    if (actual === undefined) return anterior !== undefined;
    if (actual.texto === escrito || actual.texto === anterior) return false;
    try {
      leer(actual.texto);
      return true;
    } catch {
      return false;
    }
  }

  /** Un nombre libre en `destino`: el mismo, o con la fecha y hora y, si hace falta, un número. */
  async function nombreLibre(destino: FileSystemDirectoryHandle, nombre: string, momento: Date): Promise<string> {
    if (!(await existe(destino, nombre))) return nombre;
    const base = `${sinExtension(nombre)} ${marcaDeTiempo(momento)}`;
    const extension = esFicheroDeCartera(nombre) ? EXTENSION_DE_CARTERA : "";
    let libre = `${base}${extension}`;
    for (let n = 2; await existe(destino, libre); n += 1) libre = `${base}-${n}${extension}`;
    return libre;
  }

  /** Copia un fichero a otra carpeta, comprueba la copia y quita el original. */
  async function mover(desde: FileSystemDirectoryHandle, nombre: string, hacia: FileSystemDirectoryHandle, momento: Date, adonde = "a la papelera"): Promise<void> {
    const leido = await leerTexto(desde, nombre);
    if (leido === undefined) return;
    const yaEsta = await leerTexto(hacia, nombre);
    if (yaEsta?.texto !== leido.texto) {
      const destino = await nombreLibre(hacia, nombre, momento);
      await escribirTexto(hacia, destino, leido.texto);
      if ((await leerTexto(hacia, destino))?.texto !== leido.texto) {
        throw new ErrorDeAlmacen("ESCRITURA", `No se pudo mover «${nombre}» ${adonde}. No se ha quitado nada.`);
      }
    }
    await desde.removeEntry(nombre);
  }

  async function retirarSinCola(fichero: string): Promise<void> {
    const leido = await leerTexto(carpeta, fichero);
    if (leido === undefined) throw new ErrorDeAlmacen("NO_ENCONTRADO", `No se encuentra «${fichero}» en la carpeta de carteras.`);
    const momento = ahora();
    const papelera = (await subcarpeta(carpeta, CARPETA_DE_PAPELERA, true))!;

    /* Primero las copias, después la cartera: si algo falla a mitad, la cartera sigue en su
       sitio y lo movido está en la papelera, sin pérdida. */
    const id = idDelTexto(leido.texto);
    if (id !== undefined) {
      const raiz = await subcarpeta(carpeta, CARPETA_DE_COPIAS, false);
      const nombreDeSusCopias = carpetaDeLasCopias(id);
      const suyas = raiz === undefined ? undefined : await subcarpeta(raiz, nombreDeSusCopias, false);
      if (raiz !== undefined && suyas !== undefined) {
        const copiasEnPapelera = (await subcarpeta(papelera, CARPETA_DE_COPIAS, true))!;
        const destino = (await subcarpeta(copiasEnPapelera, nombreDeSusCopias, true))!;
        for (const manejador of await ficherosDe(suyas)) await mover(suyas, manejador.name, destino, momento);
        await raiz.removeEntry(nombreDeSusCopias, { recursive: true }).catch(() => undefined);
      }
    }

    const destino = await nombreLibre(papelera, fichero, momento);
    await escribirTexto(papelera, destino, leido.texto);
    if ((await leerTexto(papelera, destino))?.texto !== leido.texto) {
      throw new ErrorDeAlmacen("ESCRITURA", `No se pudo mover «${fichero}» a la papelera. La cartera sigue en su sitio.`);
    }
    await carpeta.removeEntry(fichero);
    if (id !== undefined && ubicaciones.get(id) === fichero) ubicaciones.delete(id);
    if (id !== undefined) huellas.delete(id);
  }

  /** Lo que se sabe de cada fichero de cartera de una carpeta, con la fecha del fichero. Uno que no se lee va con su motivo. */
  async function resumenesDe(donde: FileSystemDirectoryHandle): Promise<Array<{ resumen: ResumenDeCartera; modificado: number }>> {
    const resumenes: Array<{ resumen: ResumenDeCartera; modificado: number }> = [];
    for (const manejador of await ficherosDe(donde)) {
      if (!esFicheroDeCartera(manejador.name)) continue;
      let texto = "";
      let modificado = 0;
      try {
        const fichero = await manejador.getFile();
        modificado = fichero.lastModified;
        texto = await fichero.text();
        const { cartera } = leer(texto);
        const resumen: ResumenDeCartera = {
          fichero: manejador.name,
          id: cartera.id,
          nombre: cartera.nombre,
          divisaBase: cartera.divisaBase,
          movimientos: cartera.movimientos.length,
          modificada: cartera.modificada !== "" ? cartera.modificada : new Date(modificado).toISOString()
        };
        if (cartera.cliente?.nombre !== undefined) resumen.cliente = cartera.cliente.nombre;
        resumenes.push({ resumen, modificado });
      } catch (error) {
        resumenes.push({
          resumen: {
            fichero: manejador.name,
            id: idDelTexto(texto) ?? "",
            nombre: sinExtension(manejador.name),
            divisaBase: "",
            movimientos: 0,
            modificada: new Date(modificado).toISOString(),
            error: mensajeDe(error)
          },
          modificado
        });
      }
    }
    return resumenes;
  }

  async function recuperarSinCola(fichero: string): Promise<{ fichero: string; nombre: string }> {
    const papelera = await subcarpeta(carpeta, CARPETA_DE_PAPELERA, false);
    const leido = papelera === undefined ? undefined : await leerTexto(papelera, fichero);
    if (papelera === undefined || leido === undefined) throw new ErrorDeAlmacen("NO_ENCONTRADO", `No se encuentra «${fichero}» entre las carteras retiradas.`);
    let cartera: Cartera;
    try {
      cartera = leer(leido.texto).cartera;
    } catch (error) {
      throw new ErrorDeAlmacen("LECTURA", `«${fichero}» no se puede abrir, así que no se ha recuperado: ${mensajeDe(error)}`);
    }
    const destino = nombreDeFicheroPara(cartera.nombre);

    /* No se pisa nada: ni el fichero de su nombre, ni otra cartera que se llame igual, ni la misma cartera, que dejaría dos
       ficheros con el mismo identificador compartiendo sus copias de seguridad. */
    for (const manejador of await ficherosDe(carpeta)) {
      if (!esFicheroDeCartera(manejador.name)) continue;
      const texto = await (await manejador.getFile()).text();
      const nombre = nombreDelTexto(texto);
      if (idDelTexto(texto) === cartera.id) {
        throw new ErrorDeAlmacen("YA_EXISTE", `La cartera «${cartera.nombre}» ya está en la carpeta, en «${manejador.name}». No se ha recuperado la de la papelera, para no tener dos veces la misma cartera.`);
      }
      if (mismoNombre(manejador.name, destino) || (nombre !== undefined && mismoNombreDeCartera(nombre, cartera.nombre))) {
        throw new ErrorDeAlmacen(
          "YA_EXISTE",
          `Ya hay en la carpeta una cartera que se llama «${nombre ?? sinExtension(manejador.name)}», y no se pisa: cambia el nombre de la que hay, o retírala, y vuelve a intentarlo. La retirada sigue en la papelera.`
        );
      }
    }

    const momento = ahora();
    /* Primero las copias, después la cartera, como al retirarla: si algo falla a mitad, la cartera sigue en la papelera y
       lo movido está en sus copias, sin pérdida. Volver a intentarlo no duplica una copia que ya volvió. */
    const copiasEnPapelera = await subcarpeta(papelera, CARPETA_DE_COPIAS, false);
    const nombreDeSusCopias = carpetaDeLasCopias(cartera.id);
    const suyas = copiasEnPapelera === undefined ? undefined : await subcarpeta(copiasEnPapelera, nombreDeSusCopias, false);
    if (copiasEnPapelera !== undefined && suyas !== undefined) {
      const raiz = (await subcarpeta(carpeta, CARPETA_DE_COPIAS, true))!;
      const vuelta = (await subcarpeta(raiz, nombreDeSusCopias, true))!;
      for (const manejador of await ficherosDe(suyas)) await mover(suyas, manejador.name, vuelta, momento, "a las copias de la cartera");
      await copiasEnPapelera.removeEntry(nombreDeSusCopias, { recursive: true }).catch(() => undefined);
    }

    await escribirTexto(carpeta, destino, leido.texto);
    if (!(await escritoBien(destino, leido.texto))) {
      await carpeta.removeEntry(destino).catch(() => undefined);
      throw new ErrorDeAlmacen("VERIFICACION", `«${cartera.nombre}» se escribió en la carpeta, pero al volver a leerla no se pudo abrir, así que no se ha recuperado. Sigue en la papelera.`);
    }
    await papelera.removeEntry(fichero);
    return { fichero: destino, nombre: cartera.nombre };
  }

  return {
    clase: "carpeta",
    nombre: carpeta.name,

    /* En la cola, detrás de las escrituras: la lista que se pide al volver de una cartera ve su último guardado (GES-27). */
    listar: () =>
      enCola(() => protegido("leer", async () => {
        const resumenes = (await resumenesDe(carpeta)).map(({ resumen }) => resumen);
        const instante = (r: ResumenDeCartera) => {
          const ms = Date.parse(r.modificada);
          return Number.isFinite(ms) ? ms : 0;
        };
        return resumenes.sort((a, b) => instante(b) - instante(a) || (a.fichero < b.fichero ? -1 : 1));
      })),

    abrir: (fichero) =>
      protegido(
        "leer",
        async () => {
          const leido = await leerTexto(carpeta, fichero);
          if (leido === undefined) throw new ErrorDeAlmacen("NO_ENCONTRADO", `No se encuentra «${fichero}» en la carpeta de carteras.`);
          const resultado: CarteraLeida = leer(leido.texto);
          ubicaciones.set(resultado.cartera.id, fichero);
          huellas.set(resultado.cartera.id, sinMarcaDeGuardado(leido.texto));
          return resultado;
        },
        fichero
      ),

    guardar: (cartera, opcionesDeGuardado = {}) => protegido("escribir", () => enExclusiva(() => guardarSinCola(cartera, opcionesDeGuardado))),

    pedirPermiso: async () => (await permisoDe(carpeta, true)) === "concedido",

    retirar: (fichero) => protegido("escribir", () => enExclusiva(() => retirarSinCola(fichero)), fichero),

    retiradas: () =>
      enCola(() =>
        protegido("leer", async () => {
          const papelera = await subcarpeta(carpeta, CARPETA_DE_PAPELERA, false);
          if (papelera === undefined) return [];
          const retiradas: CarteraRetirada[] = (await resumenesDe(papelera)).map(({ resumen, modificado }) => ({ ...resumen, retirada: new Date(modificado).toISOString() }));
          return retiradas.sort((a, b) => (a.retirada < b.retirada ? 1 : a.retirada > b.retirada ? -1 : a.fichero < b.fichero ? -1 : 1));
        })
      ),

    recuperar: (fichero) => protegido("escribir", () => enExclusiva(() => recuperarSinCola(fichero)), fichero),

    copias: (carteraId) => protegido("leer", () => copiasDe(carteraId, true)),

    leerCopia: (copia) =>
      protegido(
        "leer",
        async () => {
          const raiz = await subcarpeta(carpeta, CARPETA_DE_COPIAS, false);
          const suya = raiz === undefined ? undefined : await subcarpeta(raiz, carpetaDeLasCopias(copia.carteraId), false);
          const leido = suya === undefined ? undefined : await leerTexto(suya, copia.fichero);
          if (leido === undefined) throw new ErrorDeAlmacen("NO_ENCONTRADO", `No se encuentra la copia «${copia.fichero}».`);
          return leer(leido.texto);
        },
        copia.fichero
      ),

    leerAjustes: () =>
      protegido("leer", async () => {
        const leido = await leerTexto(carpeta, FICHERO_DE_AJUSTES);
        if (leido === undefined) return {};
        let datos: unknown;
        try {
          datos = JSON.parse(leido.texto.replace(/^\uFEFF/, ""));
        } catch {
          datos = undefined;
        }
        if (typeof datos !== "object" || datos === null || (datos as { formato?: unknown }).formato !== FORMATO_DE_AJUSTES) {
          throw new ErrorDeAlmacen("LECTURA", "El fichero de ajustes del gestor (ajustes.json) no se puede leer. Si lo guardas de nuevo desde la aplicación, se rehace.");
        }
        const ajustes = (datos as { ajustes?: unknown }).ajustes;
        return typeof ajustes === "object" && ajustes !== null && !Array.isArray(ajustes) ? (ajustes as AjustesDelGestor) : {};
      }),

    guardarAjustes: (ajustes) =>
      protegido("escribir", () =>
        enExclusiva(async () => {
          const fichero = { formato: FORMATO_DE_AJUSTES, version: 1, guardado: ahora().toISOString(), ajustes };
          const texto = `${JSON.stringify(ordenarClaves(fichero, ESQUEMA_DE_AJUSTES), null, 2)}\n`;
          await escribirTexto(carpeta, FICHERO_DE_AJUSTES, texto);
          if ((await leerTexto(carpeta, FICHERO_DE_AJUSTES))?.texto !== texto) {
            throw new ErrorDeAlmacen("VERIFICACION", "Los ajustes se escribieron, pero al volver a leerlos no coinciden. Vuelve a intentarlo.");
          }
        })
      )
  };
}
