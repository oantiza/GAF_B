/**
 * De un fichero a tablas de texto. Lo usan todos los importadores.
 *
 * Un extracto llega como HTML (los `.xls` de Andbank son una página HTML en windows-1252),
 * como texto delimitado (un CSV) o como el texto que `core/importFileReader.ts` saca de un
 * libro de Excel. Aquí se convierte en tablas: filas de celdas de texto, sin interpretar
 * ningún número ni ninguna fecha. Todo es cálculo puro: ni DOM ni red, para que corra igual
 * en el navegador y en las pruebas.
 *
 * El analizador de HTML es propio y tolerante, y trae los tres límites de recursos del lector
 * del servidor (`functions_python/portfolio_real/parser.py`, en la etiqueta de Git
 * `referencia-portfolio-real-2026-11-17`): un fichero pequeño no puede
 * pedir millones de celdas con un `colspan` enorme.
 */
import { decodeImportBytes, readImportFileText } from "../../core/importFileReader";
import type { DocumentoLeido } from "./tipos";

/** Un error de lectura: el mensaje es para el usuario y dice qué hacer. */
export class ErrorDeLectura extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeLectura";
  }
}

export interface LimitesDeLectura {
  /** El mayor `colspan` o `rowspan` que se admite en una celda. */
  celdaMaxima: number;
  /** Las celdas que puede tener una fila, contando las que repite un `colspan`. */
  celdasPorFila: number;
  /** Las celdas de todo el documento. */
  celdasPorDocumento: number;
}

/** Los mismos que `MAX_CELL_SPAN`, `MAX_ROW_CELLS` y `MAX_DOCUMENT_CELLS` de `parser.py`. */
export const LIMITES_DE_LECTURA: LimitesDeLectura = {
  celdaMaxima: 64,
  celdasPorFila: 256,
  celdasPorDocumento: 100_000
};

const MENSAJE_CELDA_GRANDE = "El fichero contiene una celda demasiado grande. Carga el export original del banco.";
const MENSAJE_MUCHAS_COLUMNAS = "El fichero contiene demasiadas columnas. Carga el export original del banco.";
const MENSAJE_MUCHAS_CELDAS = "El fichero contiene demasiadas celdas. Exporta un periodo más corto.";

/* ------------------------------------------------------------------ entidades HTML */

/** Los nombres de las entidades de Latin-1, del 160 (`nbsp`) al 255 (`yuml`), en orden. */
const LATIN1 = (
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute " +
  "micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig " +
  "Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash " +
  "Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc " +
  "euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml " +
  "yacute thorn yuml"
).split(" ");

const ENTIDADES: ReadonlyMap<string, string> = new Map<string, string>([
  ...LATIN1.map((nombre, indice): [string, string] => [nombre, String.fromCharCode(160 + indice)]),
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", "\""],
  ["apos", "'"],
  ["euro", "€"],
  ["ndash", "–"],
  ["mdash", "—"],
  ["lsquo", "‘"],
  ["rsquo", "’"],
  ["ldquo", "“"],
  ["rdquo", "”"],
  ["hellip", "…"],
  ["bull", "•"],
  ["minus", "−"],
  ["thinsp", "\u2009"],
  ["ensp", "\u2002"],
  ["emsp", "\u2003"]
]);

/** Sustituye las entidades HTML por su carácter. Una entidad desconocida se deja como está. */
export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (entera, cuerpo: string) => {
    if (cuerpo.startsWith("#")) {
      const codigo = cuerpo[1] === "x" || cuerpo[1] === "X" ? Number.parseInt(cuerpo.slice(2), 16) : Number.parseInt(cuerpo.slice(1), 10);
      if (!Number.isFinite(codigo) || codigo <= 0 || codigo > 0x10ffff) return entera;
      return String.fromCodePoint(codigo);
    }
    return ENTIDADES.get(cuerpo) ?? entera;
  });
}

/* ------------------------------------------------------------------ HTML */

/** El valor entero de un atributo como lo lee Python con `int()`: si no es un entero, `undefined`. */
function atributoEntero(etiqueta: string, nombre: string): number | undefined {
  const encontrado = new RegExp(`\\s${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]*))`, "i").exec(etiqueta);
  if (!encontrado) return undefined;
  const valor = (encontrado[1] ?? encontrado[2] ?? encontrado[3] ?? "").trim();
  return /^[+-]?\d+$/.test(valor) ? Number.parseInt(valor, 10) : undefined;
}

/**
 * Las tablas de un texto HTML: todas las de primer nivel, cada una como filas de celdas de
 * texto. Traslado de `_FirstTableParser` con `all_tables=True` de `parser.py`:
 *  - una celda con `colspan` repite su valor en tantas columnas;
 *  - el texto de una celda se limpia: entidades decodificadas, los trozos separados por
 *    etiquetas se unen con un espacio y los espacios se colapsan;
 *  - las filas sin ningún texto no cuentan, ni las tablas sin filas;
 *  - una tabla sin cerrar al final del texto cuenta igual.
 * Las tablas anidadas dentro de una celda no son tablas aparte: sus filas no se leen y su
 * texto queda en la celda que las contiene.
 *
 * Tres diferencias deliberadas con Python, por tolerancia: una fila o una celda que se abre
 * sin haber cerrado la anterior cierra la anterior (Python la perdía), y una fila sin cerrar
 * al acabar la tabla también cuenta.
 *
 * Lanza `ErrorDeLectura` si el texto supera alguno de los límites de recursos.
 */
export function tablasDeHtml(html: string, limites: LimitesDeLectura = LIMITES_DE_LECTURA): string[][][] {
  const tablas: string[][][] = [];
  let profundidad = 0;
  let filas: string[][] = [];
  let fila: string[] | undefined;
  let trozos: string[] | undefined;
  let colspan = 1;
  let celdasDelDocumento = 0;

  const cerrarCelda = () => {
    if (!fila || !trozos) return;
    const valor = trozos.join(" ").replace(/\s+/g, " ").trim();
    for (let i = 0; i < colspan; i += 1) fila.push(valor);
    trozos = undefined;
    colspan = 1;
  };
  const cerrarFila = () => {
    cerrarCelda();
    if (fila && fila.some((celda) => celda.trim() !== "")) filas.push(fila);
    fila = undefined;
  };
  const cerrarTabla = () => {
    cerrarFila();
    if (filas.length > 0) tablas.push(filas);
    filas = [];
  };

  const longitud = html.length;
  let posicion = 0;
  while (posicion < longitud) {
    const menor = html.indexOf("<", posicion);
    const finDelTexto = menor === -1 ? longitud : menor;
    if (finDelTexto > posicion && trozos) trozos.push(decodificarEntidades(html.slice(posicion, finDelTexto)));
    if (menor === -1) break;

    /* Comentarios, declaraciones e instrucciones: se saltan. */
    if (html.startsWith("<!--", menor)) {
      const fin = html.indexOf("-->", menor + 4);
      posicion = fin === -1 ? longitud : fin + 3;
      continue;
    }
    if (html.startsWith("<!", menor) || html.startsWith("<?", menor)) {
      const fin = html.indexOf(">", menor);
      posicion = fin === -1 ? longitud : fin + 1;
      continue;
    }
    const etiquetaEncontrada = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)\b[^>]*>?/.exec(html.slice(menor, menor + 4096));
    if (!etiquetaEncontrada) {
      /* Un «<» que no abre una etiqueta es texto. */
      if (trozos) trozos.push("<");
      posicion = menor + 1;
      continue;
    }
    const etiqueta = etiquetaEncontrada[0];
    const cierre = etiquetaEncontrada[1] === "/";
    const nombre = etiquetaEncontrada[2].toLowerCase();
    posicion = menor + etiqueta.length;

    /* El contenido de un script o de un estilo no es texto de la página. */
    if (!cierre && (nombre === "script" || nombre === "style")) {
      const fin = html.toLowerCase().indexOf(`</${nombre}`, posicion);
      if (fin === -1) {
        posicion = longitud;
      } else {
        const mayor = html.indexOf(">", fin);
        posicion = mayor === -1 ? longitud : mayor + 1;
      }
      continue;
    }

    if (nombre === "table") {
      if (!cierre) {
        profundidad += 1;
      } else if (profundidad > 0) {
        profundidad -= 1;
        if (profundidad === 0) cerrarTabla();
      }
      continue;
    }
    if (profundidad !== 1) continue;

    if (nombre === "tr") {
      if (cierre) {
        cerrarFila();
      } else {
        cerrarFila();
        fila = [];
      }
      continue;
    }
    if (nombre === "td" || nombre === "th") {
      if (cierre) {
        cerrarCelda();
        continue;
      }
      if (!fila) continue;
      cerrarCelda();
      const pedido = atributoEntero(etiqueta, "colspan");
      const nuevoColspan = Math.max(1, pedido ?? 1);
      const rowspan = atributoEntero(etiqueta, "rowspan") ?? 1;
      if (nuevoColspan > limites.celdaMaxima || rowspan > limites.celdaMaxima) throw new ErrorDeLectura(MENSAJE_CELDA_GRANDE);
      if (fila.length + nuevoColspan > limites.celdasPorFila) throw new ErrorDeLectura(MENSAJE_MUCHAS_COLUMNAS);
      celdasDelDocumento += nuevoColspan;
      if (celdasDelDocumento > limites.celdasPorDocumento) throw new ErrorDeLectura(MENSAJE_MUCHAS_CELDAS);
      colspan = nuevoColspan;
      trozos = [];
      continue;
    }
    /* Cualquier otra etiqueta (<br>, <b>, <span>…) separa trozos de texto, como en Python. */
  }
  if (profundidad > 0) cerrarTabla();
  return tablas;
}

/* ------------------------------------------------------------------ texto delimitado */

/** Las marcas de hoja que escribe `core/importFileReader.ts` (ver `core/delimitedText.ts`). */
const MARCA_DE_HOJA = /^## (Hoja|Hoja oculta|Filas ocultas|Hoja vacía|Notas del libro): (.+)$/;

/** El separador de un bloque de texto: el que más aparece en sus primeras líneas, de «;», tabulador y «,». */
function separadorDe(lineas: string[]): string {
  const muestra = lineas.filter((linea) => linea.trim() !== "").slice(0, 20).join("\n");
  const cuenta = (caracter: string) => muestra.split(caracter).length - 1;
  const candidatos: Array<[string, number]> = [[";", cuenta(";")], ["\t", cuenta("\t")], [",", cuenta(",")]];
  const mejor = candidatos.reduce((a, b) => (b[1] > a[1] ? b : a));
  return mejor[1] > 0 ? mejor[0] : ";";
}

/** Parte un bloque de texto delimitado en filas, respetando las comillas dobles de un CSV. */
function filasDelimitadas(texto: string, separador: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i];
    if (entreComillas) {
      if (caracter === "\"") {
        if (texto[i + 1] === "\"") {
          celda += "\"";
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        celda += caracter;
      }
      continue;
    }
    if (caracter === "\"" && celda.trim() === "") {
      entreComillas = true;
      celda = "";
    } else if (caracter === separador) {
      fila.push(celda);
      celda = "";
    } else if (caracter === "\n" || caracter === "\r") {
      if (caracter === "\r" && texto[i + 1] === "\n") i += 1;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else {
      celda += caracter;
    }
  }
  fila.push(celda);
  filas.push(fila);
  return filas
    .map((celdas) => celdas.map((valor) => valor.replace(/\s+/g, " ").trim()))
    .filter((celdas) => celdas.some((valor) => valor !== ""));
}

/**
 * Las tablas de un texto delimitado: un CSV (con «;», «,» o tabulador) o el texto que produce
 * `importFileReader` para un libro de Excel. Una tabla por hoja: si el texto trae marcas
 * «## Hoja: …», cada hoja visible es una tabla, y las hojas ocultas, las filas ocultas, las
 * hojas vacías y las notas del libro no se leen. Sin marcas, todo el texto es una tabla.
 */
export function tablasDeTextoDelimitado(texto: string): string[][][] {
  const lineas = texto.replace(/^\ufeff/, "").split(/\r\n|\n|\r/);
  const bloques: string[][] = [];
  /* Lo que va antes de la primera marca (todo, si no hay marcas) es un bloque más; tras una
     marca que no es de una hoja visible, las líneas no se leen hasta la siguiente marca. */
  let actual: string[] | undefined = [];
  for (const linea of lineas) {
    const marca = MARCA_DE_HOJA.exec(linea.trim());
    if (marca) {
      if (actual) bloques.push(actual);
      actual = marca[1] === "Hoja" ? [] : undefined;
      continue;
    }
    actual?.push(linea);
  }
  if (actual) bloques.push(actual);
  return bloques
    .map((bloque) => filasDelimitadas(bloque.join("\n"), separadorDe(bloque)))
    .filter((tabla) => tabla.length > 0);
}

/* ------------------------------------------------------------------ documento */

/** Si el texto es HTML: lleva una tabla HTML. */
function esHtml(texto: string): boolean {
  return /<table[\s>]/i.test(texto);
}

/**
 * Decide si el texto es HTML o delimitado y devuelve el documento leído. Lanza
 * `ErrorDeLectura` si el HTML supera los límites de recursos.
 */
export function leerTexto(nombre: string, texto: string): DocumentoLeido {
  const tablas = esHtml(texto) ? tablasDeHtml(texto) : tablasDeTextoDelimitado(texto);
  return { nombre, texto, tablas };
}

const EXPORT_DEL_BANCO = /\.(?:xls|html?)$/i;

/**
 * Lee un fichero del navegador. Un `.xls` que es HTML (Andbank) o un `.html` se leen en
 * windows-1252, como los exporta el banco; un `.xlsx` o un `.xls` binario los convierte
 * `readImportFileText` a texto delimitado (todas las hojas visibles, cada una tras su marca
 * `MARCA_DE_HOJA`, y cada una se lee como una tabla); cualquier otro texto se
 * decodifica mirando sus bytes (utf-8 si lo es; si no, windows-1252).
 */
export async function leerFichero(fichero: File): Promise<DocumentoLeido> {
  let texto: string;
  if (EXPORT_DEL_BANCO.test(fichero.name) || /\.xlsx$/i.test(fichero.name)) {
    texto = await readImportFileText(fichero, { encoding: "windows-1252" });
  } else {
    texto = decodeImportBytes(new Uint8Array(await fichero.arrayBuffer()));
  }
  return leerTexto(fichero.name, texto);
}
