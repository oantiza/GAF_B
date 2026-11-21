/**
 * Dónde va cada etiqueta del final de las líneas de un gráfico, para que ninguna pise a otra.
 *
 * Dos líneas pueden acabar casi en el mismo sitio —en el Comparador, un fondo y su benchmark acababan
 * a 13 px—, y entonces sus etiquetas chocan. Se separan lo justo: los solapados se agrupan y el grupo
 * se reparte alrededor de la media de sus posiciones, así cada etiqueta se aleja lo menos posible de
 * su línea. Devuelve las posiciones en el mismo orden en que entraron.
 */
export function separarEtiquetas(
  posiciones: readonly number[],
  separacion: number,
  minimo: number,
  maximo: number
): number[] {
  type Grupo = { originales: number[]; indices: number[] };
  const centro = (grupo: Grupo) => grupo.originales.reduce((suma, y) => suma + y, 0) / grupo.originales.length;
  const alto = (grupo: Grupo) => (grupo.indices.length - 1) * separacion;

  const grupos: Grupo[] = posiciones
    .map((y, indice) => ({ y, indice }))
    .sort((a, b) => a.y - b.y)
    .map(({ y, indice }) => ({ originales: [y], indices: [indice] }));

  for (let indice = 0; indice < grupos.length - 1; ) {
    const [uno, otro] = [grupos[indice], grupos[indice + 1]];
    const finDelUno = centro(uno) + alto(uno) / 2;
    const inicioDelOtro = centro(otro) - alto(otro) / 2;
    if (inicioDelOtro - finDelUno < separacion - 1e-9) {
      grupos.splice(indice, 2, {
        originales: [...uno.originales, ...otro.originales],
        indices: [...uno.indices, ...otro.indices]
      });
      /* Al fundirse se mueve el centro, y puede alcanzar al de arriba: se vuelve a mirar. */
      indice = Math.max(0, indice - 1);
    } else {
      indice += 1;
    }
  }

  const salida = new Array<number>(posiciones.length);
  let ultima = Number.NEGATIVE_INFINITY;
  for (const grupo of grupos) {
    /* Dentro del gráfico, aunque eso acerque el grupo al de al lado. */
    const inicio = Math.max(minimo, Math.min(centro(grupo) - alto(grupo) / 2, maximo - alto(grupo)));
    grupo.indices.forEach((original, orden) => {
      const y = Math.max(inicio + orden * separacion, ultima + separacion);
      salida[original] = y;
      ultima = y;
    });
  }
  return salida;
}

/** El nombre de la etiqueta directa no pasa de aquí: lo entero está en la leyenda. */
const LARGO_DEL_NOMBRE_FINAL = 16;

function recortar(texto: string, largo: number): string {
  return texto.length > largo ? `${texto.slice(0, largo - 1).trimEnd()}…` : texto;
}

/**
 * El nombre que cabe al final de la línea. Si no cabe entero, pierde primero el paréntesis del final, que es un
 * apunte y está en la leyenda («Parte medida (88 %)» es «Parte medida», no «Parte medida (8…»); y si aún no cabe, se
 * recorta.
 */
export function nombreAlFinalDeLaLinea(nombre: string): string {
  if (nombre.length <= LARGO_DEL_NOMBRE_FINAL) return nombre;
  const sinApunte = nombre.replace(/\s*\([^()]*\)\s*$/, "");
  return recortar(sinApunte || nombre, LARGO_DEL_NOMBRE_FINAL);
}

/**
 * Lo que se escribe al final de una línea: su nombre corto y su último valor. Si la línea va sola, solo el valor: el
 * título del gráfico ya dice de quién es, y el nombre de un fondo, recortado, no añadía nada («Amundi Funds -… 150,8»).
 * Un nombre corto dado a mano («1», «B») se escribe siempre. Entre el nombre y el valor va « · »: con un espacio,
 * «2 163,6» se leía como un millar.
 */
export function textoAlFinalDeLaLinea(serie: { label: string; etiquetaFinal?: string }, valor: string, sola: boolean): string {
  if (sola && serie.etiquetaFinal === undefined) return valor;
  return `${serie.etiquetaFinal ?? nombreAlFinalDeLaLinea(serie.label)} · ${valor}`;
}
