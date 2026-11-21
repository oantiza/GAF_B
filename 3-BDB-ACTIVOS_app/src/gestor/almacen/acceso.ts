/**
 * Elegir la carpeta de carteras, saber si hay permiso sobre ella y recordarla entre visitas.
 *
 * QUÉ SE GUARDA EN EL NAVEGADOR, Y QUÉ NO. Para no pedirle la carpeta al usuario en cada
 * visita se guarda en IndexedDB SOLO el manejador de la carpeta (`FileSystemDirectoryHandle`),
 * que es la forma que da el navegador de conservar el acceso a una carpeta: es una referencia
 * a la carpeta, no su contenido. Ninguna cartera, ningún dato de un cliente y ningún ajuste
 * pasa por aquí. Esto no incumple el requisito de producto de que las carteras se guarden
 * solo como ficheros en el disco del usuario: lo que hay en IndexedDB no permite leer una
 * cartera sin el permiso del usuario sobre la carpeta, y borrarlo no pierde nada.
 *
 * POR USUARIO (auditoría 16-11-2026, GES-13; decisión de Óscar del 17-11-2026). La carpeta
 * sobrevive al cierre de sesión —la sesión caduca a los 30 minutos, y olvidarla obligaría a
 * elegirla en cada entrada—, pero se guarda con quién la eligió, el usuario de la sesión
 * (`uid`), y solo se le ofrece a esa persona: otro asesor que entre en el mismo navegador no
 * ve la carpeta del anterior. Cada usuario tiene su propia clave, `usuario:<uid>`, con
 * `{ dueno, carpeta }`. Sin sesión no hay a quién ofrecérsela, y no se recuerda.
 *
 * La carpeta recordada de antes de este cambio (clave `actual`, sin dueño) no se ofrece a
 * nadie: se olvida la primera vez que alguien mira si hay carpeta.
 *
 * Base de datos `gestor-carteras`, almacén `carpeta`. Si IndexedDB no existe o falla (ventana
 * privada, almacenamiento bloqueado), recordar y olvidar no hacen nada y `carpetaRecordada`
 * devuelve `undefined`: el usuario vuelve a elegir la carpeta, sin error.
 */

const BASE = "gestor-carteras";
const ALMACEN = "carpeta";
/** La clave de antes de recordar por usuario: una carpeta sin dueño, que ya no se ofrece. */
export const CLAVE_SIN_DUENO = "actual";

/** La clave de la carpeta de un usuario. */
export function claveDeLaCarpeta(usuario: string): string {
  return `usuario:${usuario}`;
}

/** Lo que se guarda: la carpeta y quién la eligió. */
interface CarpetaConDueno {
  dueno: string;
  carpeta: FileSystemDirectoryHandle;
}

/** La carpeta de un registro guardado, solo si es de ese usuario y es una carpeta. */
export function carpetaDelRegistro(valor: unknown, usuario: string): FileSystemDirectoryHandle | undefined {
  if (typeof valor !== "object" || valor === null) return undefined;
  const { dueno, carpeta } = valor as Partial<CarpetaConDueno>;
  if (dueno !== usuario || typeof carpeta !== "object" || carpeta === null) return undefined;
  return (carpeta as { kind?: unknown }).kind === "directory" ? carpeta : undefined;
}

/** Si este navegador puede leer y escribir en una carpeta (File System Access API). */
export function hayAccesoACarpetas(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/** Abre el diálogo del sistema para elegir la carpeta de carteras (lectura y escritura). `undefined` si el usuario cancela. */
export async function elegirCarpeta(): Promise<FileSystemDirectoryHandle | undefined> {
  if (!hayAccesoACarpetas()) return undefined;
  try {
    return await window.showDirectoryPicker!({ id: "gestor-carteras", mode: "readwrite" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return undefined;
    throw error;
  }
}

/** El estado del permiso de una carpeta ya elegida. Con `pedir`, se lo pide al usuario (necesita un gesto suyo). */
export async function permisoDe(carpeta: FileSystemDirectoryHandle, pedir: boolean): Promise<"concedido" | "por-pedir" | "denegado"> {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  /* Sin `queryPermission` no hay un permiso que consultar: el manejador vale mientras dure. */
  if (typeof carpeta.queryPermission !== "function") return "concedido";
  let estado = await carpeta.queryPermission(descriptor);
  if (estado === "prompt" && pedir && typeof carpeta.requestPermission === "function") {
    estado = await carpeta.requestPermission(descriptor);
  }
  return estado === "granted" ? "concedido" : estado === "denied" ? "denegado" : "por-pedir";
}

function abrirBase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolver) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolver(undefined);
        return;
      }
      const peticion = indexedDB.open(BASE, 1);
      peticion.onupgradeneeded = () => {
        if (!peticion.result.objectStoreNames.contains(ALMACEN)) peticion.result.createObjectStore(ALMACEN);
      };
      peticion.onsuccess = () => resolver(peticion.result);
      peticion.onerror = () => resolver(undefined);
      peticion.onblocked = () => resolver(undefined);
    } catch {
      resolver(undefined);
    }
  });
}

/** Una operación sobre el almacén `carpeta`. Nunca lanza: si algo falla, devuelve `undefined`. */
async function conAlmacen<T>(modo: IDBTransactionMode, operacion: (almacen: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const base = await abrirBase();
  if (base === undefined) return undefined;
  try {
    return await new Promise<T | undefined>((resolver) => {
      try {
        const transaccion = base.transaction(ALMACEN, modo);
        const peticion = operacion(transaccion.objectStore(ALMACEN));
        transaccion.oncomplete = () => resolver(peticion.result);
        transaccion.onerror = () => resolver(undefined);
        transaccion.onabort = () => resolver(undefined);
      } catch {
        resolver(undefined);
      }
    });
  } finally {
    base.close();
  }
}

/** Recuerda la carpeta elegida para la próxima visita de ese usuario. Solo el manejador, nunca su contenido. */
export async function recordarCarpeta(carpeta: FileSystemDirectoryHandle, usuario: string | undefined): Promise<void> {
  if (!usuario) return;
  const registro: CarpetaConDueno = { dueno: usuario, carpeta };
  await conAlmacen("readwrite", (almacen) => almacen.put(registro, claveDeLaCarpeta(usuario)));
}

/**
 * La carpeta que ese usuario eligió en una visita anterior, si la hay. Puede necesitar que se vuelva a pedir permiso.
 * De paso olvida la de antes de recordar por usuario, que no tiene dueño y no se ofrece a nadie.
 */
export async function carpetaRecordada(usuario: string | undefined): Promise<FileSystemDirectoryHandle | undefined> {
  if (!usuario) {
    await conAlmacen("readwrite", (almacen) => almacen.delete(CLAVE_SIN_DUENO));
    return undefined;
  }
  const valor: unknown = await conAlmacen("readwrite", (almacen) => {
    almacen.delete(CLAVE_SIN_DUENO);
    return almacen.get(claveDeLaCarpeta(usuario));
  });
  return carpetaDelRegistro(valor, usuario);
}

/** Deja de recordar la carpeta de ese usuario. La de los demás sigue. */
export async function olvidarCarpeta(usuario: string | undefined): Promise<void> {
  if (!usuario) return;
  await conAlmacen("readwrite", (almacen) => almacen.delete(claveDeLaCarpeta(usuario)));
}
