/**
 * El primer paso del asistente de importación, sin React: leer cada fichero que suelta el
 * usuario, reconocer qué es y decirlo en una línea. Todo ocurre en el navegador: el fichero
 * no sale del equipo.
 */
import { ErrorDeLectura, leerFichero } from "../../importacion/lectura";
import { importarReconocidos, reconocer } from "../../importacion/registro";
import type { Reconocimiento, ResultadoDeImportacion } from "../../importacion/tipos";

/** Las extensiones que se admiten, para el selector de ficheros y para avisar de las demás. */
export const EXTENSIONES_ADMITIDAS = [".xls", ".xlsx", ".csv", ".html", ".htm", ".txt"] as const;

export type EstadoDelFichero = "leyendo" | "reconocido" | "no-reconocido" | "ilegible";

export interface FicheroDelAsistente {
  /** Identificador dentro del asistente, para quitarlo de la lista. */
  id: string;
  nombre: string;
  /** Tamaño en bytes y fecha de modificación: con el nombre, distinguen un fichero repetido. */
  bytes: number;
  modificado: number;
  estado: EstadoDelFichero;
  reconocimiento?: Reconocimiento;
  /** Si no se pudo leer: el mensaje, en lenguaje llano. */
  error?: string;
}

export function admitido(nombre: string): boolean {
  const minusculas = nombre.toLowerCase();
  return EXTENSIONES_ADMITIDAS.some((extension) => minusculas.endsWith(extension));
}

/** Si un fichero ya está en la lista (mismo nombre, tamaño y fecha). */
export function yaEstaEnLaLista(fichero: Pick<File, "name" | "size" | "lastModified">, lista: readonly FicheroDelAsistente[]): boolean {
  return lista.some((otro) => otro.nombre === fichero.name && otro.bytes === fichero.size && otro.modificado === fichero.lastModified);
}

/** La línea de un fichero aún sin leer. */
export function ficheroPendiente(fichero: File, id: string): FicheroDelAsistente {
  return { id, nombre: fichero.name, bytes: fichero.size, modificado: fichero.lastModified, estado: "leyendo" };
}

/** Lee un fichero y lo reconoce. No lanza: un fallo de lectura queda en `error`. */
export async function leerYReconocer(fichero: File, id: string): Promise<FicheroDelAsistente> {
  const base = ficheroPendiente(fichero, id);
  if (!admitido(fichero.name)) {
    return { ...base, estado: "ilegible", error: `No se leen ficheros de este tipo. Se admiten ${EXTENSIONES_ADMITIDAS.join(", ")}.` };
  }
  try {
    const documento = await leerFichero(fichero);
    const reconocimiento = reconocer(documento);
    return { ...base, estado: reconocimiento.importador ? "reconocido" : "no-reconocido", reconocimiento };
  } catch (error) {
    const mensaje = error instanceof ErrorDeLectura || error instanceof Error ? error.message : "";
    return { ...base, estado: "ilegible", error: mensaje || "No se ha podido leer el fichero." };
  }
}

/** Qué es un documento reconocido: «Andbank · Movimientos de la cuenta de efectivo». */
export function queEs(fichero: FicheroDelAsistente): string | undefined {
  const reconocimiento = fichero.reconocimiento;
  if (!reconocimiento?.importador) return undefined;
  return `${reconocimiento.importador.entidad} · ${reconocimiento.etiqueta ?? reconocimiento.tipo ?? "documento"}`;
}

export function reconocidos(ficheros: readonly FicheroDelAsistente[]): Reconocimiento[] {
  return ficheros.filter((fichero) => fichero.estado === "reconocido" && fichero.reconocimiento).map((fichero) => fichero.reconocimiento!);
}

/** Si se puede pasar a la revisión: algún documento reconocido y ninguno a medio leer. */
export function sePuedeContinuar(ficheros: readonly FicheroDelAsistente[]): boolean {
  return ficheros.some((fichero) => fichero.estado === "reconocido") && !ficheros.some((fichero) => fichero.estado === "leyendo");
}

/** Lo que proponen los documentos reconocidos: un resultado por entidad. */
export function resultadosDe(ficheros: readonly FicheroDelAsistente[], divisaBase: string): ResultadoDeImportacion[] {
  return importarReconocidos(reconocidos(ficheros), { divisaBase });
}
