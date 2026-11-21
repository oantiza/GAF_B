/**
 * Lo que el informe de estrategia guardó sin tildes y la pantalla y el papel escriben con ellas.
 *
 * El prompt pedía los títulos de sección y la región «Japon» sin tilde, y los informes ya guardados los llevan
 * así. No se reescribe el texto del modelo: solo los títulos conocidos (los cuatro del informe semanal y el del
 * diario que lleva tilde), por coincidencia exacta de la línea de título, y la región «Japon». Lo guardado no se
 * toca; se corrige al pintarlo.
 */

const TITULOS_CON_TILDE: Record<string, string> = {
  "Cierre y lectura de la sesion": "Cierre y lectura de la sesión",
  "Macroeconomia y geopolitica": "Macroeconomía y geopolítica",
  "Escenarios estrategicos": "Escenarios estratégicos",
  "Valoraciones y mercados": "Valoraciones y mercados",
  "Posicionamiento y conclusiones": "Posicionamiento y conclusiones"
};

/** Una línea de título Markdown («### Título»), y nada más que el título. */
const LINEA_DE_TITULO = /^(#{1,6}[ \t]+)(.+?)([ \t\r]*)$/gm;

/** Escribe con tilde los títulos de sección conocidos; el resto del Markdown queda como está. */
export function conTildesEnLosTitulos(markdown: string): string {
  return markdown.replace(LINEA_DE_TITULO, (linea, marca: string, titulo: string, cola: string) => {
    const corregido = Object.prototype.hasOwnProperty.call(TITULOS_CON_TILDE, titulo) ? TITULOS_CON_TILDE[titulo] : titulo;
    return corregido === titulo ? linea : `${marca}${corregido}${cola}`;
  });
}

/** «Japon» (lo guardado) y «Japón» (lo que pide el prompt desde ahora) se escriben siempre «Japón». */
export function regionDeEstrategia(region: string): string {
  return region === "Japon" ? "Japón" : region;
}
