/**
 * Dónde va el nombre de cada punto de un mapa (riesgo y rentabilidad), para que ninguno pise a otro ni a un punto.
 *
 * Cada punto escribía su nombre a su derecha, sin mirar a los demás. Con la cartera a un paso de una cartera de
 * referencia —lo normal: se la compara con la que más se le parece— los dos nombres caían uno encima del otro y no se
 * leía ninguno («juilibradoParte medida (88 %)», en Análisis, el 14-11-2026). Aquí cada nombre prueba cuatro sitios,
 * por orden: a la derecha, a la izquierda, encima y debajo de su punto, y se queda con el primero que cabe en el
 * gráfico y no toca ni un nombre ya puesto ni otro punto. Se colocan primero los que más importan.
 */

export interface PuntoConNombre {
  id: string;
  /** El centro del punto, en píxeles del dibujo. */
  x: number;
  y: number;
  /** El radio de su marca. */
  radio: number;
  /** Lo que ocupa su nombre a lo ancho, en píxeles. */
  ancho: number;
  /** Cuanto mayor, antes elige sitio: la cartera, por delante de las referencias. */
  prioridad: number;
}

export interface NombreColocado {
  id: string;
  /** Dónde se ancla el texto (`x`, y la línea base `y`) y hacia dónde crece. */
  x: number;
  y: number;
  ancla: "start" | "end" | "middle";
}

interface Caja {
  izquierda: number;
  derecha: number;
  arriba: number;
  abajo: number;
}

export interface AreaDelMapa {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** El alto de una línea de 12 px: lo que sube sobre la línea base y lo que baja. */
const SUBE = 10;
const BAJA = 3;
/** El aire entre la marca y su nombre. */
const AIRE = 5;
/** El aire que un nombre guarda con otro nombre y con la marca de otro punto. */
const HOLGURA = 2;

function cajaDelNombre(nombre: NombreColocado, ancho: number): Caja {
  const izquierda = nombre.ancla === "start" ? nombre.x : nombre.ancla === "end" ? nombre.x - ancho : nombre.x - ancho / 2;
  return { izquierda, derecha: izquierda + ancho, arriba: nombre.y - SUBE, abajo: nombre.y + BAJA };
}

/** Un punto que no lleva nombre, pero ocupa su sitio: los activos sueltos del mapa. */
export type PuntoSinNombre = Pick<PuntoConNombre, "x" | "y" | "radio">;

/* La holgura la lleva el nombre que busca sitio, una vez: aquí va la marca tal cual. */
function cajaDelPunto(punto: PuntoSinNombre): Caja {
  const { radio } = punto;
  return { izquierda: punto.x - radio, derecha: punto.x + radio, arriba: punto.y - radio, abajo: punto.y + radio };
}

/** Cuánto se pisan dos cajas, en píxeles cuadrados; 0 si no se tocan. */
function solape(una: Caja, otra: Caja): number {
  const ancho = Math.min(una.derecha, otra.derecha) - Math.max(una.izquierda, otra.izquierda);
  const alto = Math.min(una.abajo, otra.abajo) - Math.max(una.arriba, otra.arriba);
  return ancho > 0 && alto > 0 ? ancho * alto : 0;
}

/** Cuánto se sale una caja del área del gráfico, en píxeles cuadrados. */
function fuera(caja: Caja, area: AreaDelMapa): number {
  const ancho = caja.derecha - caja.izquierda;
  const alto = caja.abajo - caja.arriba;
  const dentroAncho = Math.max(0, Math.min(caja.derecha, area.x + area.width) - Math.max(caja.izquierda, area.x));
  const dentroAlto = Math.max(0, Math.min(caja.abajo, area.y + area.height) - Math.max(caja.arriba, area.y));
  return ancho * alto - dentroAncho * dentroAlto;
}

/** Los cuatro sitios que prueba un nombre, por orden de preferencia. */
function candidatos(punto: PuntoConNombre): NombreColocado[] {
  const { id, x, y, radio } = punto;
  return [
    { id, x: x + radio + AIRE, y: y + 4, ancla: "start" },
    { id, x: x - radio - AIRE, y: y + 4, ancla: "end" },
    { id, x, y: y - radio - AIRE, ancla: "middle" },
    { id, x, y: y + radio + AIRE + SUBE, ancla: "middle" }
  ];
}

/**
 * El sitio de cada nombre, en el mismo orden en que entraron los puntos. Si ningún sitio queda limpio, el que menos
 * pisa: un nombre algo montado se sigue leyendo mejor que uno que falta.
 */
export function colocarNombres(puntos: readonly PuntoConNombre[], area: AreaDelMapa, sinNombre: readonly PuntoSinNombre[] = []): NombreColocado[] {
  const orden = puntos
    .map((punto, indice) => ({ punto, indice }))
    .sort((a, b) => b.punto.prioridad - a.punto.prioridad || a.punto.x - b.punto.x || a.indice - b.indice);
  const puestas: Caja[] = [];
  const salida = new Array<NombreColocado>(puntos.length);
  for (const { punto, indice } of orden) {
    const ajenos = [...puntos.filter((otro) => otro !== punto), ...sinNombre].map(cajaDelPunto);
    let mejor: { nombre: NombreColocado; caja: Caja; coste: number } | null = null;
    for (const nombre of candidatos(punto)) {
      const caja = cajaDelNombre(nombre, punto.ancho);
      const conAire: Caja = { izquierda: caja.izquierda - HOLGURA, derecha: caja.derecha + HOLGURA, arriba: caja.arriba - HOLGURA, abajo: caja.abajo + HOLGURA };
      const coste =
        fuera(caja, area) * 4 +
        puestas.reduce((suma, puesta) => suma + solape(conAire, puesta), 0) * 2 +
        ajenos.reduce((suma, ajeno) => suma + solape(conAire, ajeno), 0);
      if (!mejor || coste < mejor.coste - 1e-9) mejor = { nombre, caja, coste };
      if (coste === 0) break;
    }
    if (!mejor) continue;
    puestas.push(mejor.caja);
    salida[indice] = mejor.nombre;
  }
  return salida;
}
