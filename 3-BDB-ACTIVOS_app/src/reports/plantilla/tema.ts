/**
 * El tema y las medidas de la plantilla única de informes.
 *
 * El 14-11-2026 Óscar vio la plantilla de una sola tinta y pidió recuperar el aspecto de los informes de antes («eran mucho
 * más bonitos»). La plantilla se queda —todos los documentos salen de las mismas piezas— y toma el aspecto del papel de
 * cliente de antes (`clientReportTheme.ts` y `papelDeCliente.tsx` del commit 8da9cb9d): tinta cálida, filetes de bronce,
 * granate en la identidad y en los totales, Fraunces en los títulos y en las cifras grandes, Roboto Flex en lo demás.
 *
 * Dos temas con la misma estructura, que solo cambian tres colores y el sello:
 *  - cliente: granate (#A81E33) como color del tema y bronce en las versalitas y en los filetes;
 *  - interno: el acero azul de los titulares del papel interno de antes (#3F6B82) y su gris acero (#62707A).
 * Impresos en blanco y negro, lo que los distingue es el sello de cada hoja («CONFIDENCIAL», o «USO INTERNO» con «No entregar
 * al cliente»): los dos colores dan grises parecidos.
 *
 * Ninguna pieza lleva bandas ni cabeceras rellenas de color (a Óscar no le gustan): el color va en filetes, en la tinta, en
 * las cifras y en los gráficos. Las tarjetas de cifras llevan el fondo gris muy claro que llevaban.
 *
 * Son constantes propias, NO referencias a `src/core/theme.ts`: un cambio de la pantalla no se cuela en el papel
 * (`tests/paletaDelPapel.test.ts`). Solo los dos colores con signo valen lo mismo que en la pantalla (`tests/plantilla/tema.test.ts`).
 *
 * Las medidas van en puntos.
 */

export type TemaDeInforme = "cliente" | "interno";

export interface ColoresDelTema {
  /** El color del informe: la identidad del asesor, los totales, el filete corto de la portada, la serie de la cartera. */
  color: string;
  /** El tono de las versalitas, los rótulos y las cabeceras de tabla. Texto: al menos 4,5:1 sobre blanco. */
  tono: string;
  /** El filete de color: el de las notas, el guion de las tarjetas, el aro del punto de la cartera. Al menos 3:1. */
  filete: string;
  /** Lo que dice el sello, en la cabecera y en el pie de cada hoja. */
  sello: string;
}

export const TEMAS: Readonly<Record<TemaDeInforme, ColoresDelTema>> = {
  cliente: { color: "#A81E33", tono: "#85704C", filete: "#9C8459", sello: "CONFIDENCIAL" },
  interno: { color: "#3F6B82", tono: "#62707A", filete: "#6B7A85", sello: "USO INTERNO" }
};

/** Lo que va bajo el nombre del documento en el informe interno, siempre. */
export const NO_ENTREGAR = "No entregar al cliente";

/** Los colores del papel, iguales en los dos temas: los de `CLIENT_REPORT_PALETTE` de antes. */
export const PAPEL = {
  blanco: "#FFFFFF",
  tinta: "#201E1B",
  /** La tinta del texto corrido y de las notas. */
  tinta2: "#6B6459",
  /** La tinta tenue de ejes, rótulos y textos legales (5,0:1). */
  tinta3: "#756F61",
  /** El filete fino de las tablas y de las tarjetas. Es un separador: no lleva información, y no se le pide 3:1. */
  filete: "#DCD3C4",
  /** El filete de la cabecera de una tabla y de los ejes. */
  fileteFuerte: "#C9BDA8",
  /** La rejilla de los gráficos y el filete entre filas: más claro que el de las tablas. */
  rejilla: "#E9E2D5",
  /** El fondo gris muy claro de las tarjetas de cifras, el de antes. */
  fondo: "#FBFCFD",
  /** El carril de una barra, debajo de su color. */
  carril: "#F0F3F7",
  /** Un resultado positivo: el verde de la pantalla (`--sube`), 5,35:1 sobre blanco. Se copia, no se importa (Óscar, 15-11-2026: que coincidan). */
  sube: "#0a7a53",
  /** Un resultado negativo: el rojo de la pantalla (`--baja`), 5,85:1 sobre blanco. */
  baja: "#c2261b",
  /** Lo que pide la atención del asesor. */
  aviso: "#8a5a00"
} as const;

/**
 * La paleta de datos del papel de antes, para los repartos: un color por categoría, en este orden. Todos dan al menos 3:1 sobre
 * blanco (son rellenos, no texto). Más de ocho categorías vuelven a empezar: el nombre y la cifra van siempre escritos.
 */
export const COLORES_DE_DATOS = {
  acero: "#6B7A85",
  granate: "#A81E33",
  marino: "#173758",
  bronce: "#9C8459",
  oliva: "#5E6B57",
  arena: "#958B7A",
  ciruela: "#7A5C7E",
  marron: "#8C5A48"
} as const;

const ORDEN_DE_CATEGORIAS = [
  COLORES_DE_DATOS.acero,
  COLORES_DE_DATOS.granate,
  COLORES_DE_DATOS.marino,
  COLORES_DE_DATOS.bronce,
  COLORES_DE_DATOS.oliva,
  COLORES_DE_DATOS.arena,
  COLORES_DE_DATOS.ciruela,
  COLORES_DE_DATOS.marron
] as const;

/** El color de la categoría `i` de un reparto. */
export function colorDeCategoria(i: number): string {
  return ORDEN_DE_CATEGORIAS[((i % ORDEN_DE_CATEGORIAS.length) + ORDEN_DE_CATEGORIAS.length) % ORDEN_DE_CATEGORIAS.length];
}

/**
 * Lo que no entra en un reparto, «Otros» y lo que no tiene zona: un gris azulado, 3,44:1 sobre blanco. El papel lo tomó de la
 * pantalla el 15-11-2026 (antes llevaba uno suyo, `#838B92`) y se queda con él desde el 18-11-2026: la dirección A lo cambió en la
 * pantalla por una piedra clara (`#B3AC9E`, 2,26:1) que no llega al 3:1 que el papel exige a todo relleno que informa (Óscar).
 */
export const SIN_CLASIFICAR = "#808B9F";

/**
 * El reparto de una cartera por clase de activo. Renta fija, renta variable y liquidez llevan el color que tienen en la pantalla
 * (`CLASS_COLORS`, en `src/core/theme.ts`), para que una clase se reconozca igual en la aplicación y en el informe (Óscar,
 * 15-11-2026). «Otros» lleva el gris de arriba, no el del resto de la pantalla: Óscar lo eligió el 18-11-2026 entre tres opciones
 * medidas sobre el informe real (apartado 14.3 de `docs/frontend/SISTEMA_DISENO.md`). Son copias, no importaciones: un cambio de
 * pantalla no se cuela solo en el papel, y `tests/plantilla/tema.test.ts` comprueba que las tres clases siguen coincidiendo.
 */
export const COLOR_DE_CLASE = {
  rentaFija: "#4E7D6A",
  rentaVariable: "#2F5D8A",
  liquidez: "#8A8F98",
  otros: SIN_CLASIFICAR
} as const;

export interface PaletaDeSeries {
  /** La cartera: el color del tema. */
  cartera: string;
  /** La referencia (lo aportado, el índice): la tinta secundaria, a trazos. */
  referencia: string;
  /** Las demás, en orden y sin reciclar. */
  demas: readonly string[];
}

/** Las series de los gráficos de cada tema: la cartera en el color del tema, la referencia en la tinta secundaria, y después la paleta de datos. */
export const SERIES_DEL_TEMA: Readonly<Record<TemaDeInforme, PaletaDeSeries>> = {
  cliente: {
    cartera: TEMAS.cliente.color,
    referencia: PAPEL.tinta2,
    demas: [COLORES_DE_DATOS.marino, COLORES_DE_DATOS.oliva, COLORES_DE_DATOS.ciruela, COLORES_DE_DATOS.marron, COLORES_DE_DATOS.bronce]
  },
  interno: {
    cartera: TEMAS.interno.color,
    referencia: PAPEL.tinta2,
    demas: [COLORES_DE_DATOS.granate, COLORES_DE_DATOS.oliva, COLORES_DE_DATOS.ciruela, COLORES_DE_DATOS.marron, COLORES_DE_DATOS.bronce]
  }
};

/** Las series del tema de cliente: la paleta por defecto de quien no lee el tema. */
export const SERIES = SERIES_DEL_TEMA.cliente;

/** El color de la serie `i` (0 es la cartera) entre las que no son referencia. Más de seis: gris, como «Otros». */
export function colorDeSerie(i: number, tema: TemaDeInforme = "cliente"): string {
  const paleta = SERIES_DEL_TEMA[tema];
  if (i === 0) return paleta.cartera;
  return paleta.demas[i - 1] ?? SIN_CLASIFICAR;
}

/**
 * Los siete tonos de la matriz de solapamiento, uno por paso: «sin comunes», y de menos del 10 % a 80 % o más. En el de cliente,
 * del crema del papel al bronce hondo (`CLIENT_REPORT_OVERLAP_RAMP` de antes); en el interno, la misma escalera en acero. La cifra
 * va en tinta hasta el quinto paso y en blanco desde `BLANCO_DESDE_EL_PASO`: las dos dan al menos 4,5:1 (`tests/plantilla/tema.test.ts`).
 */
export const RAMPA_DEL_TEMA: Readonly<Record<TemaDeInforme, readonly string[]>> = {
  cliente: ["#F7F3EC", "#EFE7D8", "#E3D6BE", "#D0BD9A", "#B89D72", "#86694A", "#5F4A33"],
  interno: ["#F2F5F7", "#E2E9ED", "#CCD8DF", "#AEC1CC", "#8FA7B5", "#4F6E80", "#34505F"]
};

/** Desde qué paso de la rampa la cifra va en blanco. */
export const BLANCO_DESDE_EL_PASO = 5;

/** El color de una cifra con signo. Sin signo, o neutra, la tinta. */
export function colorDelSigno(signo: "sube" | "baja" | "neutro" | null | undefined): string {
  return signo === "sube" ? PAPEL.sube : signo === "baja" ? PAPEL.baja : PAPEL.tinta;
}

/** La hoja A4, en puntos. */
export const A4 = { ancho: 595.28, alto: 841.89 } as const;

/** Las medidas del papel de antes (`papelDeCliente.tsx` y el informe de cliente de 8da9cb9d), en puntos. */
export const MEDIDAS = {
  margenLateral: 45,
  cabecera: {
    /** Del borde de arriba a la primera línea de la cabecera. */
    arriba: 26,
    /** Alto que reserva la cabecera: sus dos líneas y el logotipo. */
    alto: 20,
    /** El logotipo, de alto. */
    logotipo: 20,
    separacionDelLogotipo: 7,
    /** El nombre del documento. */
    documento: 7,
    sello: { letra: 7, espaciado: 1.8, separacion: 10 },
    /** La identidad del asesor, arriba a la derecha. */
    identidad: 7.7,
    espaciadoDeLaIdentidad: 0.6,
    /** La segunda línea: quién y cómo contactar. */
    destinatario: 7
  },
  cuerpo: { bajoLaCabecera: 10, letra: 9.3, interlineado: 1.4 },
  presentacion: { contexto: 7.7, titulo: 30, entradilla: 10.5 },
  portada: { titulo: 45, destinatario: 18.5, rotulo: 7, valor: 10.5 },
  cifras: { rotulo: 6.3, cifra: 18.5, principal: 22, apunte: 7, ausencia: 10.5, separacion: 7 },
  seccion: { pagina: 19.5, titulo: 14.5, numero: 7.7, filete: 0.75, aireEncima: 14, procedencia: 7.7 },
  tabla: { celda: 8.5, cabecera: 6.3, rellenoVertical: 5.5, rellenoHorizontal: 7.5, filete: 0.65, apunte: 6.8, total: 10.5 },
  nota: { filete: 1.5, sangria: 11, letra: 8.5, interlineado: 1.4 },
  pie: { letra: 6.8, filete: 0.65, aire: 6, abajo: 27 }
} as const;

/** Donde empieza el cuerpo: lo que reserva la cabecera y el aire bajo ella. */
export const ARRIBA_DEL_CUERPO = MEDIDAS.cabecera.arriba + MEDIDAS.cabecera.alto + MEDIDAS.cuerpo.bajoLaCabecera;

/** Lo que reserva el pie abajo: su distancia al borde, su línea de texto, su aire y el que deja al cuerpo. */
export const ABAJO_DEL_CUERPO = MEDIDAS.pie.abajo + MEDIDAS.pie.letra * 1.3 + MEDIDAS.pie.aire + MEDIDAS.pie.filete + 12;

/** El ancho útil de una hoja, de margen a margen. */
export function anchoUtil(apaisada: boolean): number {
  return (apaisada ? A4.alto : A4.ancho) - 2 * MEDIDAS.margenLateral;
}
