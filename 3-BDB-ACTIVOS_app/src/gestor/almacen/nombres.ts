/**
 * Nombres de fichero de las carteras: el nombre de la cartera, saneado para que Windows lo
 * acepte, más la extensión `.cartera.json`.
 *
 * Reglas de Windows que se aplican (valen también para macOS y Linux, que son más laxos):
 * - fuera los caracteres `\ / : * ? " < > |` y los de control, que se cambian por un espacio;
 * - sin puntos ni espacios al final (Windows los quita en silencio y el nombre deja de cuadrar);
 * - sin punto al principio (en macOS y Linux sería un fichero oculto);
 * - ni un nombre reservado de dispositivo (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…`COM9`,
 *   `LPT1`…`LPT9`), que Windows reserva aunque lleve extensión: «CON.cartera.json» no se puede
 *   crear. Se le antepone «Cartera »;
 * - longitud acotada: la parte del nombre, a 120 caracteres, para que con la extensión y un
 *   sufijo quede muy por debajo de los 255 que admite un nombre en NTFS.
 */
import type { Cartera } from "../motor/modelo";

export const EXTENSION_DE_CARTERA = ".cartera.json";

/** La longitud máxima de la parte del nombre, sin extensión ni sufijo. */
export const LONGITUD_MAXIMA = 120;

const NOMBRE_POR_DEFECTO = "Cartera sin nombre";
const RESERVADOS = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i;
// eslint-disable-next-line no-control-regex
const PROHIBIDOS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

function recortarExtremos(texto: string): string {
  return texto.replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
}

/** Sanea un texto para usarlo como nombre de fichero en Windows. Nunca devuelve vacío. */
export function sanearNombre(texto: string): string {
  let nombre = recortarExtremos(texto.normalize("NFC").replace(PROHIBIDOS, " ").replace(/\s+/g, " "));
  /* Se corta por caracteres completos (puntos de código), no por unidades UTF-16: un emoji o
     una letra fuera del plano básico no se parten por la mitad. */
  const caracteres = Array.from(nombre);
  if (caracteres.length > LONGITUD_MAXIMA) nombre = recortarExtremos(caracteres.slice(0, LONGITUD_MAXIMA).join(""));
  if (nombre === "") return NOMBRE_POR_DEFECTO;
  /* Windows mira el nombre hasta el primer punto: «NUL.algo» también está reservado. */
  const raiz = nombre.split(".")[0].trim();
  if (RESERVADOS.test(raiz)) nombre = `Cartera ${nombre}`;
  return nombre;
}

/** El nombre de fichero que le corresponde a un nombre de cartera, con un sufijo opcional. */
export function nombreDeFicheroPara(nombre: string, sufijo?: string): string {
  const base = sanearNombre(nombre);
  return sufijo === undefined ? `${base}${EXTENSION_DE_CARTERA}` : `${base} (${sanearNombre(sufijo)})${EXTENSION_DE_CARTERA}`;
}

/** El nombre de fichero que le corresponde a una cartera (el mismo saneado que usa la carpeta). */
export function nombreDeFichero(cartera: Pick<Cartera, "nombre">): string {
  return nombreDeFicheroPara(cartera.nombre);
}

export function esFicheroDeCartera(nombre: string): boolean {
  return nombre.toLowerCase().endsWith(EXTENSION_DE_CARTERA);
}

/** El nombre sin la extensión `.cartera.json`. */
export function sinExtension(nombre: string): string {
  return esFicheroDeCartera(nombre) ? nombre.slice(0, -EXTENSION_DE_CARTERA.length) : nombre;
}
