/**
 * Los anchos con que se fotografía y se mide la aplicación: los comparten la batería (`capturaInterfaz.mjs`) y el
 * recorrido de la auditoría (`auditoriaFrontend.mjs`), para que no puedan discrepar.
 *
 * Son píxeles LÓGICOS, que es lo que ve el CSS: el monitor de 32" de Óscar es 4K escalado al 150 %, así que da 2.560.
 */

/** Los seis anchos de trabajo (02-11-2026). No se añaden ni se quitan sin decisión de Óscar. */
export const ANCHOS_DE_TRABAJO = {
  xl: [2560, 1440], // monitor de 32" o 27"
  l: [1920, 1080], // monitor de 24"
  d: [1440, 900], // portátil
  p: [1280, 800], // portátil pequeño, o media pantalla del 32"
  t: [1024, 768], // tableta apaisada
  tp: [768, 1024] // tableta vertical, el mínimo
};

/**
 * La pasada estrecha (19-11-2026): los cuatro anchos donde cambia la disposición, que es donde el contenido más aprieta
 * porque acaba de ganar una columna, una pestaña o un menú más ancho. Son cortes de `tests/cortesDeAncho.test.ts`.
 *
 * Ninguno de los seis anchos de trabajo cae entre 1.025 y 1.239 px, que es donde el menú mide 224 px y no 248: ahí se
 * cortaban el subtítulo de la casa y los nombres del calendario de Mercado sin que ninguna pasada lo viera. Y el
 * contenido no crece con la ventana: a 1.025 px mide 127 px menos que a 1.024, y a 1.240, 39 menos que a 1.239.
 */
export const PASADA_ESTRECHA = ["1025", "1100", "1180", "1240"];

/** Hasta este ancho la aplicación es una tableta, y se mide con dedo. */
export const ANCHO_DE_TABLETA = 1024;

const ANCHO_MINIMO = 600;
const ANCHO_MAXIMO = 4000;

/**
 * Un ancho pedido, ya resuelto. Se puede pedir por su nombre (`d`, `tp`…) o por sus píxeles (`1100`); con una «d»
 * detrás (`1180d`) se mide con dedo, que es como lo ve un iPad en horizontal. Hasta 1.024 px va siempre con dedo.
 */
export function anchoDe(clave) {
  const nombre = String(clave).trim();
  if (Object.hasOwn(ANCHOS_DE_TRABAJO, nombre)) {
    const [ancho, alto] = ANCHOS_DE_TRABAJO[nombre];
    return { clave: nombre, ancho, alto, conDedo: ancho <= ANCHO_DE_TABLETA };
  }
  const medida = nombre.match(/^(\d{3,4})(d?)$/);
  if (medida) {
    const ancho = Number(medida[1]);
    if (ancho >= ANCHO_MINIMO && ancho <= ANCHO_MAXIMO) {
      /* Si son los píxeles de un ancho de trabajo, su mismo alto: `1440` es el portátil, igual que `d`. Lo demás, más
         alto que ancho solo en lo que es una tableta vertical, y apaisado en el resto. El alto cuenta: decide si la
         página desplaza, y con eso si lleva barra. */
      const deTrabajo = Object.values(ANCHOS_DE_TRABAJO).find(([suAncho]) => suAncho === ancho);
      return { clave: nombre, ancho, alto: deTrabajo ? deTrabajo[1] : ancho < 900 ? 1024 : 800, conDedo: medida[2] === "d" || ancho <= ANCHO_DE_TABLETA };
    }
  }
  throw new Error(
    `No sé qué ancho es «${nombre}». Valen ${Object.keys(ANCHOS_DE_TRABAJO).join(", ")}, «estrecha» (${PASADA_ESTRECHA.join(", ")}) ` +
      `o un ancho en píxeles entre ${ANCHO_MINIMO} y ${ANCHO_MAXIMO}, con una «d» detrás si es con dedo (1180d).`
  );
}

/**
 * Lo que distingue a un ancho de otro: sus píxeles, con una «d» si es con dedo más allá de la tableta. El recorrido
 * nombra así sus fotos y las filas de su informe; la batería nombra las suyas con la clave que se le pidió (`d`, `tp`).
 */
export const marcaDeAncho = ({ ancho, conDedo }) => `${ancho}${conDedo && ancho > ANCHO_DE_TABLETA ? "d" : ""}`;

/**
 * La lista de anchos de una orden: `l,d,tp`, `estrecha`, `1100,1180d`… Sin repetidos y en el orden pedido. Dos formas
 * de pedir lo mismo (`t` y `1024`, o `1024` y `1024d`) cuentan como una: llevarían la misma marca, y la segunda pisaría
 * las fotos y las filas del informe de la primera.
 */
export function resolverAnchos(argumento, porDefecto) {
  const pedidos = String(argumento || porDefecto)
    .split(",")
    .map((trozo) => trozo.trim())
    .filter(Boolean)
    .flatMap((trozo) => (trozo === "estrecha" ? PASADA_ESTRECHA : [trozo]));
  if (pedidos.length === 0) throw new Error("No se ha pedido ningún ancho.");
  const marcas = new Set();
  return pedidos.map(anchoDe).filter((pedido) => {
    const marca = marcaDeAncho(pedido);
    if (marcas.has(marca)) return false;
    marcas.add(marca);
    return true;
  });
}
