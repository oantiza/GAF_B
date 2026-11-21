/**
 * La alternativa para navegadores sin acceso a carpetas (Firefox, Safari): abrir una cartera
 * desde un fichero elegido con `<input type="file">` y guardarla descargándola.
 *
 * Aquí no hay copias de seguridad ni sustitución segura: cada descarga es un fichero nuevo en
 * la carpeta de descargas del navegador, y el usuario decide dónde lo deja. Tampoco se guarda
 * nada en el navegador.
 */
import { descargar } from "../../core/descargaDeFicheros";
import type { Cartera } from "../motor/modelo";
import { leer, serializar, type CarteraLeida } from "./formato";
import { nombreDeFichero } from "./nombres";

export { nombreDeFichero } from "./nombres";

/** Lee una cartera de un fichero elegido por el usuario. Lanza `ErrorDeFormato` si no es una cartera. */
export async function abrirFichero(fichero: File): Promise<CarteraLeida> {
  return leer(await fichero.text());
}

/** Descarga la cartera como fichero. Devuelve el nombre propuesto. */
export function descargarCartera(cartera: Cartera): string {
  const nombre = nombreDeFichero(cartera);
  /* La descarga común suelta la dirección un minuto después: algunos navegadores la leen tras devolver `click()`. */
  descargar(new Blob([serializar(cartera)], { type: "application/json" }), nombre);
  return nombre;
}
