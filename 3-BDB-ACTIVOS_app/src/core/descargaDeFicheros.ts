/**
 * Lo que se descarga, en un solo sitio: cómo se llama el fichero y cómo se ofrece al navegador (ANA-19, INF-25, INF-26).
 *
 * El nombre sigue la convención de «Carteras de clientes», que es la que lee bien una persona en un correo o en una carpeta:
 * el documento tal como lo imprime su cabecera, de quién o de qué es, y la fecha en ISO (o un periodo), separados por « - ».
 * «Informe de costes - Familia García - 2026-11-14.pdf». Lo que falta se omite sin dejar guiones sueltos, y las tildes y las
 * eñes se conservan: solo se cambia lo que Windows no admite.
 *
 * La descarga crea un enlace, lo pulsa y suelta la dirección del objeto un minuto después: soltarla en el acto corta la
 * descarga en algunos navegadores, que leen la dirección después de que `click()` haya vuelto.
 */
import { diaLocal } from "./fechaLocal";

/** Lo que Windows no admite en un nombre de fichero, y los nombres reservados de dispositivo. */
const PROHIBIDOS = /[<>:"/\\|?*]/g;
const RESERVADOS = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const sinControles = (texto: string) => [...texto].map((letra) => (letra.charCodeAt(0) < 32 ? " " : letra)).join("");

/** Sin lo que Windows no admite, sin espacios repetidos ni sobrantes. Es la limpieza de cada parte del nombre. */
function limpio(texto: string): string {
  return sinControles(texto.normalize("NFC")).replace(PROHIBIDOS, " ").replace(/\s+/g, " ").trim();
}

/**
 * Un nombre que Windows acepta: fuera los caracteres prohibidos y los de control, sin puntos ni espacios al final, nunca un
 * nombre reservado (`CON`, `PRN`…) ni vacío, y de 190 caracteres como mucho, para que quepa la extensión.
 */
export function sanearNombreDeFichero(nombre: string): string {
  let saneado = limpio(nombre).replace(/[. ]+$/, "");
  if (saneado === "" || RESERVADOS.test(saneado)) saneado = `_${saneado}`;
  /* Holgura para la extensión: un nombre completo no pasa de 200 caracteres. */
  return saneado.length > 190 ? saneado.slice(0, 190).trim() : saneado;
}

/** Un periodo, del primer día al último, en ISO: se escribe «2026-01-01 a 2026-11-13». */
export interface PeriodoDelFichero {
  desde: string;
  hasta: string;
}

export interface PartesDelNombre {
  /** El título del documento tal como lo imprime su cabecera: «Informe de costes». */
  documento: string;
  /** De quién o de qué es: el cliente, la propuesta, el activo, «A frente a B». */
  de?: string | null;
  /** La fecha que imprime el documento, en ISO («2026-11-14»), o el periodo que cubre. */
  fecha?: string | PeriodoDelFichero | null;
  /** Sin el punto. Por defecto, `pdf`. */
  extension?: string;
}

const fechaEscrita = (fecha: PartesDelNombre["fecha"]): string => {
  if (!fecha) return "";
  if (typeof fecha === "string") return fecha;
  return [fecha.desde, fecha.hasta].map(limpio).filter(Boolean).join(" a ");
};

/** «Informe de costes - Familia García - 2026-11-14.pdf». */
export function nombreDelFichero({ documento, de, fecha, extension = "pdf" }: PartesDelNombre): string {
  const partes = [documento, de ?? "", fechaEscrita(fecha)].map(limpio).filter(Boolean);
  return `${sanearNombreDeFichero(partes.join(" - "))}.${extension.replace(/^\./, "")}`;
}

/** El día de hoy, en la hora de quien descarga, en ISO: la fecha de un documento que no imprime ninguna. */
export function hoy(): string {
  return diaLocal(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10);
}

/** La fecha de un documento en ISO, si la que se da lo es («2026-11-14», o un instante «2026-11-14T…»); si no, la de hoy. */
export function diaDelDocumento(fecha: string | Date | null | undefined): string {
  if (fecha instanceof Date) return Number.isNaN(fecha.getTime()) ? hoy() : diaLocal(fecha.toISOString()) ?? hoy();
  const texto = fecha?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}($|T)/.test(texto)) return diaLocal(texto) ?? texto.slice(0, 10);
  return hoy();
}

/** Lo que tarda en soltarse la dirección del objeto: un minuto. */
export const ESPERA_ANTES_DE_SOLTAR_MS = 60_000;

/** Ofrece un contenido para guardar con un nombre. La dirección del objeto se suelta un minuto después, no en el acto. */
export function descargar(contenido: Blob, nombre: string): void {
  const url = URL.createObjectURL(contenido);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.rel = "noopener";
  enlace.style.display = "none";
  document.body.appendChild(enlace);
  try {
    enlace.click();
  } finally {
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), ESPERA_ANTES_DE_SOLTAR_MS);
  }
}
