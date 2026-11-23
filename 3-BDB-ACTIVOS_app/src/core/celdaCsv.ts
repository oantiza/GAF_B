/**
 * Una celda de CSV que una hoja de cálculo no ejecuta como fórmula (inyección de fórmulas, P1-08 de la auditoría del
 * 20-11-2026, aprobado por Óscar el 21-11-2026).
 *
 * Excel, LibreOffice y Google Sheets leen como fórmula una celda que empieza por `=`, `+`, `-` o `@`, y algunos también la
 * que empieza por un tabulador o un retorno de carro seguido de uno de ellos. Un nombre de fondo, un aviso o un texto que
 * llega de un extracto o de la base puede empezar así, y abrir el CSV ejecutaría lo que lleve. La convención de OWASP es
 * anteponer una comilla simple: la hoja enseña el texto tal cual y no lo evalúa.
 *
 * **Lo que no se toca: un número.** «-12,5», «-1.234,56» o «-0.5» empiezan por `-` y son cifras de verdad: con la comilla
 * delante la hoja las leería como texto, no sumaría la columna, y el CSV de retrocesiones, que se vuelve a importar, dejaría
 * de leerse. Una celda que, quitados los espacios de los lados, es entera un número —con signo, dígitos, separadores de
 * miles o decimales y, si acaso, exponente— no es una fórmula: una hoja la lee como número y no ejecuta nada. Todo lo demás
 * que empiece por uno de esos caracteres, aunque lleve cifras («-1+1», «+34 600 000 000», «=1»), se neutraliza.
 */

/** Los caracteres con los que empieza una fórmula, en la lista de OWASP. */
const COMIENZO_DE_FORMULA = /^[=+\-@\t\r]/;

/** Un número entero escrito en una celda: signo, dígitos con puntos o comas entre ellos y un exponente opcional. */
const ES_UN_NUMERO = /^[-+]?\d+(?:[.,]\d+)*(?:[eE][-+]?\d+)?$/;

/** El texto de la celda, con una comilla simple delante si una hoja de cálculo lo leería como fórmula. */
export function neutralizarFormula(texto: string): string {
  const sinEspacios = texto.replace(/^ +/, "");
  if (!COMIENZO_DE_FORMULA.test(texto) && !COMIENZO_DE_FORMULA.test(sinEspacios)) return texto;
  if (ES_UN_NUMERO.test(texto.trim())) return texto;
  return `'${texto}`;
}

/** Entre comillas dobles si lleva separador, comillas o un salto de línea; ya neutralizada. */
export function celdaCsv(texto: string): string {
  const seguro = neutralizarFormula(texto);
  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}
