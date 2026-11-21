/**
 * Una carpeta EN MEMORIA con el subconjunto de la File System Access API que usa el almacén:
 * `getFileHandle`, `getDirectoryHandle`, `removeEntry`, `values()`/`entries()`, `getFile()`
 * (con `text()`, `size` y `lastModified`) y `createWritable()` (con `write`, `close` y `abort`).
 *
 * Imita lo que importa del navegador:
 * - `createWritable()` escribe en un temporal y solo sustituye al fichero al cerrar; un
 *   `abort()` o un fallo lo descartan, y el fichero vivo no cambia;
 * - pedir un manejador con `create: true` crea ya el fichero vacío, como hace Chrome;
 * - los nombres no distinguen mayúsculas, como en Windows;
 * - los errores son `DOMException` con el nombre que da el navegador.
 *
 * Ganchos para las pruebas: que la siguiente escritura falle a mitad, que la siguiente se
 * cierre con el contenido dañado (para probar la comprobación posterior), y negar el permiso.
 */

interface NodoFichero {
  tipo: "fichero";
  nombre: string;
  contenido: string;
  modificado: number;
}

interface NodoCarpeta {
  tipo: "carpeta";
  nombre: string;
  hijos: Map<string, Nodo>;
}

type Nodo = NodoFichero | NodoCarpeta;

interface Estado {
  fallarEscritura: boolean;
  corromperEscritura: boolean;
  permisoNegado: boolean;
  reloj: () => number;
}

export interface CarpetaFalsa {
  carpeta: FileSystemDirectoryHandle;
  /** La siguiente escritura falla a mitad de `write`: el temporal queda a medias y se descarta. */
  fallarLaSiguienteEscritura(): void;
  /** La siguiente escritura se cierra con éxito pero deja en el disco un contenido dañado. */
  corromperLaSiguienteEscritura(): void;
  /** Toda operación lanza `NotAllowedError`, como cuando el usuario retira el permiso. */
  negarPermiso(negar?: boolean): void;
  /** El árbol entero: ruta relativa con «/» → contenido. Las carpetas vacías salen con la ruta acabada en «/». */
  volcar(): Record<string, string>;
  /** Escribe un fichero directamente (para preparar una prueba), creando las carpetas. */
  poner(ruta: string, contenido: string): void;
  /** El contenido de un fichero, o `undefined`. */
  contenido(ruta: string): string | undefined;
}

function error(nombre: string, mensaje: string): DOMException {
  return new DOMException(mensaje, nombre);
}

function clave(nombre: string): string {
  return nombre.toLowerCase();
}

function comprobarNombre(nombre: string): void {
  if (nombre === "" || nombre === "." || nombre === ".." || /[\\/]/.test(nombre)) throw new TypeError(`Nombre no válido: ${nombre}`);
}

function manejadorDeFichero(nodo: NodoFichero, padre: NodoCarpeta, estado: Estado): FileSystemFileHandle {
  const comprobar = () => {
    if (estado.permisoNegado) throw error("NotAllowedError", "Permiso denegado.");
    if (padre.hijos.get(clave(nodo.nombre)) !== nodo) throw error("NotFoundError", "El fichero ya no existe.");
  };
  const manejador = {
    kind: "file" as const,
    name: nodo.nombre,
    async isSameEntry(otro: FileSystemHandle) {
      return otro === manejador;
    },
    async getFile() {
      comprobar();
      return new File([nodo.contenido], nodo.nombre, { lastModified: nodo.modificado });
    },
    async createWritable() {
      comprobar();
      let temporal = "";
      let cerrado = false;
      return {
        async write(datos: unknown) {
          if (cerrado) throw new TypeError("El flujo está cerrado.");
          if (typeof datos !== "string") throw new TypeError("La carpeta falsa solo escribe texto.");
          if (estado.fallarEscritura) {
            estado.fallarEscritura = false;
            temporal += datos.slice(0, Math.floor(datos.length / 2));
            cerrado = true;
            throw error("InvalidStateError", "La escritura falló a mitad.");
          }
          temporal += datos;
        },
        async close() {
          if (cerrado) throw new TypeError("El flujo está cerrado.");
          cerrado = true;
          if (estado.permisoNegado) throw error("NotAllowedError", "Permiso denegado.");
          if (estado.corromperEscritura) {
            estado.corromperEscritura = false;
            temporal = temporal.slice(0, Math.floor(temporal.length / 3));
          }
          nodo.contenido = temporal;
          nodo.modificado = estado.reloj();
        },
        async abort() {
          cerrado = true;
          temporal = "";
        }
      };
    }
  };
  return manejador as unknown as FileSystemFileHandle;
}

function manejadorDeCarpeta(nodo: NodoCarpeta, estado: Estado): FileSystemDirectoryHandle {
  const permiso = () => {
    if (estado.permisoNegado) throw error("NotAllowedError", "Permiso denegado.");
  };
  const manejarHijo = (hijo: Nodo): FileSystemFileHandle | FileSystemDirectoryHandle =>
    hijo.tipo === "fichero" ? manejadorDeFichero(hijo, nodo, estado) : manejadorDeCarpeta(hijo, estado);
  async function* entradas(): AsyncGenerator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]> {
    permiso();
    for (const hijo of [...nodo.hijos.values()]) yield [hijo.nombre, manejarHijo(hijo)];
  }
  const manejador = {
    kind: "directory" as const,
    name: nodo.nombre,
    async isSameEntry(otro: FileSystemHandle) {
      return otro === manejador;
    },
    async getFileHandle(nombre: string, opciones?: { create?: boolean }) {
      permiso();
      comprobarNombre(nombre);
      const hijo = nodo.hijos.get(clave(nombre));
      if (hijo?.tipo === "carpeta") throw error("TypeMismatchError", "Es una carpeta.");
      if (hijo !== undefined) return manejadorDeFichero(hijo, nodo, estado);
      if (opciones?.create !== true) throw error("NotFoundError", `No existe ${nombre}.`);
      const nuevo: NodoFichero = { tipo: "fichero", nombre, contenido: "", modificado: estado.reloj() };
      nodo.hijos.set(clave(nombre), nuevo);
      return manejadorDeFichero(nuevo, nodo, estado);
    },
    async getDirectoryHandle(nombre: string, opciones?: { create?: boolean }) {
      permiso();
      comprobarNombre(nombre);
      const hijo = nodo.hijos.get(clave(nombre));
      if (hijo?.tipo === "fichero") throw error("TypeMismatchError", "Es un fichero.");
      if (hijo !== undefined) return manejadorDeCarpeta(hijo, estado);
      if (opciones?.create !== true) throw error("NotFoundError", `No existe ${nombre}.`);
      const nueva: NodoCarpeta = { tipo: "carpeta", nombre, hijos: new Map() };
      nodo.hijos.set(clave(nombre), nueva);
      return manejadorDeCarpeta(nueva, estado);
    },
    async removeEntry(nombre: string, opciones?: { recursive?: boolean }) {
      permiso();
      const hijo = nodo.hijos.get(clave(nombre));
      if (hijo === undefined) throw error("NotFoundError", `No existe ${nombre}.`);
      if (hijo.tipo === "carpeta" && hijo.hijos.size > 0 && opciones?.recursive !== true) {
        throw error("InvalidModificationError", "La carpeta no está vacía.");
      }
      nodo.hijos.delete(clave(nombre));
    },
    async resolve() {
      return null;
    },
    entries: entradas,
    async *keys() {
      for await (const [nombre] of entradas()) yield nombre;
    },
    async *values() {
      for await (const [, hijo] of entradas()) yield hijo;
    },
    [Symbol.asyncIterator]: entradas
  };
  return manejador as unknown as FileSystemDirectoryHandle;
}

function volcarNodo(nodo: NodoCarpeta, prefijo: string, salida: Record<string, string>): void {
  const hijos = [...nodo.hijos.values()].sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
  if (hijos.length === 0 && prefijo !== "") salida[prefijo] = "";
  for (const hijo of hijos) {
    if (hijo.tipo === "fichero") salida[`${prefijo}${hijo.nombre}`] = hijo.contenido;
    else volcarNodo(hijo, `${prefijo}${hijo.nombre}/`, salida);
  }
}

export function crearCarpetaFalsa(opciones: { nombre?: string; reloj?: () => number } = {}): CarpetaFalsa {
  const raiz: NodoCarpeta = { tipo: "carpeta", nombre: opciones.nombre ?? "Carteras", hijos: new Map() };
  const estado: Estado = { fallarEscritura: false, corromperEscritura: false, permisoNegado: false, reloj: opciones.reloj ?? (() => Date.now()) };

  const buscar = (ruta: string): Nodo | undefined => {
    let nodo: Nodo = raiz;
    for (const parte of ruta.split("/")) {
      if (nodo.tipo !== "carpeta") return undefined;
      const siguiente: Nodo | undefined = nodo.hijos.get(clave(parte));
      if (siguiente === undefined) return undefined;
      nodo = siguiente;
    }
    return nodo;
  };

  return {
    carpeta: manejadorDeCarpeta(raiz, estado),
    fallarLaSiguienteEscritura: () => {
      estado.fallarEscritura = true;
    },
    corromperLaSiguienteEscritura: () => {
      estado.corromperEscritura = true;
    },
    negarPermiso: (negar = true) => {
      estado.permisoNegado = negar;
    },
    volcar: () => {
      const salida: Record<string, string> = {};
      volcarNodo(raiz, "", salida);
      return salida;
    },
    poner: (ruta, contenido) => {
      const partes = ruta.split("/");
      const nombre = partes.pop()!;
      let carpeta = raiz;
      for (const parte of partes) {
        let siguiente = carpeta.hijos.get(clave(parte));
        if (siguiente === undefined) {
          siguiente = { tipo: "carpeta", nombre: parte, hijos: new Map() };
          carpeta.hijos.set(clave(parte), siguiente);
        }
        if (siguiente.tipo !== "carpeta") throw new Error(`${parte} es un fichero.`);
        carpeta = siguiente;
      }
      carpeta.hijos.set(clave(nombre), { tipo: "fichero", nombre, contenido, modificado: estado.reloj() });
    },
    contenido: (ruta) => {
      const nodo = buscar(ruta);
      return nodo?.tipo === "fichero" ? nodo.contenido : undefined;
    }
  };
}
