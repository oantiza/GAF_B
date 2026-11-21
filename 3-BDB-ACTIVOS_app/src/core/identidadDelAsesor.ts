import { useEffect, useState } from "react";
import { auth } from "../firebase";
import { registerSessionCache } from "./sessionCaches";

/**
 * Los datos del asesor en los informes —nombre, entidad o despacho, contacto y logotipo—, escritos una sola vez y
 * leídos por todos los informes (decisión 6 del apartado 11 de `docs/frontend/SISTEMA_DISENO.md`: el membrete es el
 * del asesor, sin marca de entidad).
 *
 * Se guardan **en este navegador y por cuenta**: `localStorage`, con una clave que lleva el identificador de la cuenta
 * con la que se ha entrado, para que otra cuenta en el mismo navegador no herede la firma de la anterior. No es un dato
 * de ningún cliente, es del asesor; nada va a la base.
 *
 * Si el navegador no deja guardar (modo privado, cuota), vale en memoria hasta recargar o cambiar de cuenta, y
 * `guardarIdentidad` lo dice en lo que devuelve. Sin nada guardado, empieza con el nombre visible de la cuenta y lo
 * demás vacío: nunca un nombre escrito en el código.
 */
export interface IdentidadDelAsesor {
  nombre?: string;
  entidad?: string;
  contacto?: string;
  /** Logotipo como data URL (PNG o JPEG). La misma forma que `AjustesDelGestor["asesor"]`. */
  logotipo?: string;
}

export interface ResultadoDeGuardar {
  /** Lo que ha quedado guardado: sin espacios de más y sin campos vacíos. */
  identidad: IdentidadDelAsesor;
  /** `false` si el navegador no ha dejado guardarlo: vale en memoria hasta recargar la página. */
  persistida: boolean;
}

/* Los mismos límites que el diálogo de informes del gestor: copiados, no importados. */
export const MAXIMO_DEL_LOGOTIPO = 300 * 1024;
export const TIPOS_DEL_LOGOTIPO: readonly string[] = ["image/png", "image/jpeg"];

const CAMPOS = ["nombre", "entidad", "contacto", "logotipo"] as const;
const PREFIJO = "gestor-activos:identidad-del-asesor:";

/** Lo que se guardó cuando el navegador no dejó guardarlo, por clave de cuenta. Se vacía al cambiar de cuenta. */
const enMemoria = new Map<string, IdentidadDelAsesor>();
const oyentes = new Set<() => void>();

function avisar(): void {
  oyentes.forEach((oyente) => oyente());
}

registerSessionCache(() => {
  enMemoria.clear();
  avisar();
});

function cuenta(): { uid: string; nombre: string } {
  const usuario = auth?.currentUser as { uid?: string | null; displayName?: string | null } | null | undefined;
  return { uid: usuario?.uid ?? "", nombre: usuario?.displayName?.trim() ?? "" };
}

/** La clave de la cuenta con la que se ha entrado; `null` sin cuenta, que solo guarda en memoria. */
export function claveDeLaIdentidad(): string | null {
  const { uid } = cuenta();
  return uid ? `${PREFIJO}${uid}` : null;
}

/** La identidad sin espacios de más y sin campos vacíos. */
export function identidadLimpia(identidad: IdentidadDelAsesor): IdentidadDelAsesor {
  const resultado: IdentidadDelAsesor = {};
  for (const campo of CAMPOS) {
    const valor = identidad[campo];
    const recortado = typeof valor === "string" ? valor.trim() : "";
    if (recortado) resultado[campo] = recortado;
  }
  return resultado;
}

export function faltaElNombre(identidad: IdentidadDelAsesor): boolean {
  return !identidad.nombre?.trim();
}

function leerDelNavegador(clave: string): IdentidadDelAsesor | null {
  try {
    const texto = globalThis.localStorage?.getItem(clave);
    if (texto == null) return null;
    const leido: unknown = JSON.parse(texto);
    return leido && typeof leido === "object" ? identidadLimpia(leido as IdentidadDelAsesor) : null;
  } catch {
    return null;
  }
}

/** La identidad de la cuenta con la que se ha entrado; sin nada guardado, el nombre visible de la cuenta. */
export function leerIdentidad(): IdentidadDelAsesor {
  const clave = claveDeLaIdentidad() ?? "";
  const guardada = enMemoria.get(clave) ?? (clave ? leerDelNavegador(clave) : null);
  if (guardada) return { ...guardada };
  const { nombre } = cuenta();
  return nombre ? { nombre } : {};
}

/** Guarda la identidad de la cuenta con la que se ha entrado, recortando espacios y quitando lo vacío. */
export function guardarIdentidad(identidad: IdentidadDelAsesor): ResultadoDeGuardar {
  const limpia = identidadLimpia(identidad);
  const clave = claveDeLaIdentidad();
  let persistida = false;
  if (clave) {
    try {
      const almacen = globalThis.localStorage;
      if (almacen) {
        almacen.setItem(clave, JSON.stringify(limpia));
        persistida = true;
      }
    } catch {
      persistida = false;
    }
  }
  if (persistida && clave) enMemoria.delete(clave);
  else enMemoria.set(clave ?? "", limpia);
  avisar();
  return { identidad: { ...limpia }, persistida };
}

/** Avisa cuando la identidad cambia: aquí, en otra pestaña o al cambiar de cuenta. Devuelve cómo dejar de escuchar. */
export function escucharIdentidad(oyente: () => void): () => void {
  oyentes.add(oyente);
  const deOtraPestana = (evento: StorageEvent) => {
    const clave = claveDeLaIdentidad();
    if (evento.key !== null && evento.key !== clave) return;
    if (clave) enMemoria.delete(clave);
    oyente();
  };
  globalThis.addEventListener?.("storage", deOtraPestana);
  return () => {
    oyentes.delete(oyente);
    globalThis.removeEventListener?.("storage", deOtraPestana);
  };
}

/** El motivo, en lenguaje llano, por el que un fichero no vale como logotipo; `null` si vale. */
export function problemaDelLogotipo(fichero: { type: string; size: number }): string | null {
  if (!TIPOS_DEL_LOGOTIPO.includes(fichero.type)) return "El logotipo tiene que ser una imagen PNG o JPEG.";
  if (fichero.size > MAXIMO_DEL_LOGOTIPO) {
    return `El logotipo ocupa ${Math.ceil(fichero.size / 1024)} KB y el máximo es 300 KB. Redúcelo o guárdalo como JPEG.`;
  }
  return null;
}

export function useIdentidadDelAsesor() {
  const [identidad, setIdentidad] = useState<IdentidadDelAsesor>(leerIdentidad);
  useEffect(() => {
    const releer = () => setIdentidad(leerIdentidad());
    releer();
    return escucharIdentidad(releer);
  }, []);
  return { identidad, guardar: guardarIdentidad };
}
