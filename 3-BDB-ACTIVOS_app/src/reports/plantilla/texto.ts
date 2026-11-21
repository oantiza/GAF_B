/**
 * El texto que viene de fuera (nombres de fondos, de clientes, del asesor, notas) listo para las fuentes de la plantilla.
 * Lo que tiene glifo sale tal cual; lo que no, se cambia por su equivalente («ł» → «l», «→» → «a», «≥» → «al menos») y
 * nunca desaparece en silencio: un tramo sin ninguna lectura latina (cirílico, chino…) se imprime como «(sin transcripción
 * latina)». Solo se quitan los caracteres que ya eran invisibles (espacios de anchura cero, guion blando, selectores de
 * variante).
 *
 * La lista de lo que pasa tal cual se midió con fontkit el 14-11-2026 sobre las fuentes de entonces (IBM Plex Sans y Source
 * Serif 4): ASCII, todo Latin-1, ı, Œ œ, las comillas y rayas tipográficas, •, …, ′ ″, ‹ ›, ⁄, €, ™, − y ∕. El mismo día la
 * plantilla volvió a Fraunces y Roboto Flex (el papel de antes), que tienen todo eso y más —el latino extendido, ≥ ≤ ≈ ≠—,
 * salvo las flechas ↑ ↓, que Fraunces no tiene: salieron de la lista y se leen como «+» y «−», igual que ▲ y ▼. Lo demás se
 * deja como estaba a propósito: ampliar la lista cambiaría lo que se imprime de nombres que hoy salen bien leídos.
 * `tests/plantilla/texto.test.ts` abre las seis fuentes y comprueba, carácter a carácter de todo el plano básico, que lo que
 * esta función deja pasar tiene glifo en todas.
 *
 * Los caracteres van escritos con su código (\u{…}) y no tal cual: los invisibles y los espacios raros no se ven en el
 * editor. Es puro: no importa @react-pdf.
 */

/** Lo que tiene glifo en las cuatro fuentes, como clase de expresión regular. El guion blando (U+00AD) no: es invisible. */
export const CARACTERES_DEL_PAPEL =
  "\\n\\r\\t\\u0020-\\u007E\\u00A0-\\u00AC\\u00AE-\\u00FF\\u0131\\u0152\\u0153\\u2013\\u2014\\u2018-\\u201A\\u201C-\\u201E" +
  "\\u2022\\u2026\\u2032\\u2033\\u2039\\u203A\\u2044\\u20AC\\u2122\\u2212\\u2215";

const NO_ADMITIDO = new RegExp(`[^${CARACTERES_DEL_PAPEL}]`, "gu");
const NO_ADMITIDO_UNO = new RegExp(`[^${CARACTERES_DEL_PAPEL}]`, "u");

/** Lo que se imprime en lugar de un tramo que no tiene ninguna lectura latina. */
export const SIN_TRANSCRIPCION = "(sin transcripción latina)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la misma firma que String.prototype.replace
type Sustitucion = string | ((coincidencia: string, ...grupos: any[]) => string);

/**
 * Una lectura en palabras: con espacio a los dos lados dentro de la línea, y sin espacio delante a principio de texto o
 * de línea («≈ 2 %» → «aprox. 2 %», no « aprox. 2 %»).
 */
const enPalabras = (palabras: string) => (_: string, inicio: string | undefined, desplazamiento: number) =>
  inicio !== undefined || desplazamiento === 0 ? `${inicio ?? ""}${palabras} ` : ` ${palabras} `;

const LETRAS_GRIEGAS: Record<string, string> = {
  α: "alfa", β: "beta", γ: "gamma", Γ: "gamma", δ: "delta", ε: "épsilon", ζ: "zeta", η: "eta", θ: "theta", Θ: "theta",
  ι: "iota", κ: "kappa", λ: "lambda", Λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", Ξ: "xi", π: "pi", Π: "pi", ρ: "rho",
  σ: "sigma", ς: "sigma", Σ: "suma", τ: "tau", υ: "ípsilon", φ: "phi", Φ: "phi", χ: "chi", ψ: "psi", Ψ: "psi",
  ω: "omega", Ω: "omega"
};

/** Divisas sin glifo: su código ISO. */
const DIVISAS: Record<string, string> = {
  "₹": "INR", "₽": "RUB", "₺": "TRY", "₩": "KRW", "₿": "BTC", "₪": "ILS", "₫": "VND", "₴": "UAH", "฿": "THB",
  "₦": "NGN", "₱": "PHP", "₡": "CRC", "₲": "PYG", "₵": "GHS", "₸": "KZT", "₼": "AZN", "₾": "GEL", "₭": "LAK", "₮": "MNT"
};
const SIGNOS_DE_DIVISA = Object.keys(DIVISAS).join("");

/** Fracciones sin glifo (½ ¼ ¾ sí lo tienen). */
const FRACCIONES: Record<string, string> = {
  "⅓": "1/3", "⅔": "2/3", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅛": "1/8",
  "⅜": "3/8", "⅝": "5/8", "⅞": "7/8"
};

/** Superíndices sin glifo (¹ ² ³ sí lo tienen). */
const SUPERINDICES: Record<string, string> = { "⁰": "0", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/** Un hueco dentro de la línea: espacio, tabulador o espacio duro, nunca el salto de línea. */
const HUECO = "[ \\t\\u00A0]*";

const ESPACIO_DURO = "\u{00A0}";
const VINETA = "\u{2022}";
const MENOS = "\u{2212}";

/** Las sustituciones con lectura, en orden. Lo que no está aquí lo recoge la red final (`aLoAdmitido`). */
const SUSTITUCIONES: ReadonlyArray<readonly [RegExp, Sustitucion]> = [
  /* Invisibles: guion blando, anchura cero, marca de orden, selectores de variante. Quitarlos no quita nada que se viera. */
  [/\u{00AD}|\u{200B}|\u{200C}|\u{200D}|\u{2060}|\u{FEFF}|\u{FE0E}|\u{FE0F}/gu, ""],
  /* Una flecha a principio de línea es una viñeta; dentro de la línea, «A → B» se lee «A a B». */
  [new RegExp(`(^|\\n)${HUECO}[\\u2192\\u27F6\\u2794\\u279C\\u21D2\\u2190\\u27F5\\u21D0]${HUECO}`, "g"), `$1${VINETA} `],
  [new RegExp(`${HUECO}[\\u2192\\u27F6\\u2794\\u279C\\u21D2]${HUECO}`, "g"), " a "],
  [new RegExp(`${HUECO}[\\u2190\\u27F5\\u21D0]${HUECO}`, "g"), " desde "],
  /* Fraunces no tiene flechas verticales: una subida es «+» y una bajada «−», como los triángulos de más abajo. */
  [/[↑↗]/gu, "+"],
  [/[↓↘]/gu, MENOS],
  [new RegExp(`(^|\\n)?${HUECO}\\u2248${HUECO}`, "g"), enPalabras("aprox.")],
  [new RegExp(`(^|\\n)?${HUECO}\\u2265${HUECO}`, "g"), enPalabras("al menos")],
  [new RegExp(`(^|\\n)?${HUECO}\\u2264${HUECO}`, "g"), enPalabras("como máximo")],
  [new RegExp(`(^|\\n)?${HUECO}\\u2260${HUECO}`, "g"), enPalabras("distinto de")],
  [new RegExp(`${HUECO}\\u2030`, "g"), " por mil"],
  [/∞/gu, "infinito"],
  [/∑/gu, "suma"],
  /* Una letra griega suelta, con su lectura; Δ, como «diferencia». Una palabra griega entera no se lee letra a letra. */
  [new RegExp(`(?<!\\p{Script=Greek})\\u0394(?!\\p{Script=Greek})${HUECO}`, "gu"), "Dif. "],
  [/(?<!\p{Script=Greek})\p{Script=Greek}(?!\p{Script=Greek})/gu, (letra: string) => LETRAS_GRIEGAS[letra] ?? letra],
  [new RegExp(`[${SIGNOS_DE_DIVISA}](?=\\d)`, "gu"), (signo: string) => `${DIVISAS[signo]} `],
  [new RegExp(`[${SIGNOS_DE_DIVISA}]`, "gu"), (signo: string) => DIVISAS[signo]],
  [/(\d?)([⅓-⅞])/gu, (_: string, cifra: string, fraccion: string) => `${cifra ? `${cifra} ` : ""}${FRACCIONES[fraccion]}`],
  [/[⁰⁴-⁹]/gu, (superindice: string) => SUPERINDICES[superindice]],
  /* Espacios: los finos y el de cifra, a espacio duro; los demás anchos, a espacio; los separadores de línea, a salto. */
  [/\u{2007}|\u{2009}|\u{200A}|\u{202F}/gu, ESPACIO_DURO],
  [/[\u{2000}-\u{2006}\u{2008}\u{205F}\u{3000}]/gu, " "],
  [/[\u{2028}\u{2029}]/gu, "\n"],
  [/[‐‑‒]/gu, "-"],
  [/―/gu, "—"],
  [/ʼ|ʻ|‛/gu, "’"],
  [/‟/gu, "“"],
  /* Símbolos: viñetas a «•», triángulos a su signo, marcas a palabra. */
  [/[●■□◆▪★☆◦‣⁃]/gu, VINETA],
  [/[▲▴]/gu, "+"],
  [/[▼▾]/gu, MENOS],
  [/[✓✔✅]/gu, "sí"],
  [/[✗✘❌]/gu, "no"],
  [new RegExp(`\\u26A0${HUECO}`, "g"), "Aviso: "],
  /* Controles: un hueco, no un carácter que la fuente no tiene. */
  // eslint-disable-next-line no-control-regex -- se buscan justamente los controles
  [/[\u{0000}-\u{0008}\u{000B}\u{000C}\u{000E}-\u{001F}\u{007F}-\u{009F}]/gu, " "]
];

/** Letras sin descomposición que tienen una lectura cercana. */
const LETRAS: Record<string, string> = {
  ł: "l", Ł: "L", đ: "d", Đ: "D", ħ: "h", Ħ: "H", ŀ: "l", Ŀ: "L", ŧ: "t", Ŧ: "T", ŋ: "n", Ŋ: "N", ĸ: "k", ſ: "s",
  ƒ: "f", ǝ: "e", ə: "e", Ə: "E", "†": "*", "‡": "**", "№": "n.º", "℃": "°C"
};

/** Marca interna de un carácter sin lectura (uno de uso privado): se junta con sus vecinos y se cambia por `SIN_TRANSCRIPCION`. */
const SIN_LECTURA = "\u{E000}";

/** Red final: su lectura, la letra base (sin el acento que la fuente no tiene: «č» → «c», «ș» → «s») o la marca. */
function aLoAdmitido(caracter: string): string {
  const lectura = LETRAS[caracter];
  if (lectura !== undefined) return lectura;
  const base = caracter.normalize("NFKD").replace(/\p{M}/gu, "");
  if (base && !NO_ADMITIDO_UNO.test(base)) return base;
  return SIN_LECTURA;
}

/**
 * El texto listo para el papel. Úsalo con todo lo que no se escribe en el código; las piezas de la plantilla ya lo
 * aplican a todo lo que imprimen, así que quien las usa no tiene que acordarse.
 */
export function sanearTexto(valor: string): string {
  let texto = valor.normalize("NFC");
  for (const [patron, sustitucion] of SUSTITUCIONES) {
    texto = typeof sustitucion === "string" ? texto.replace(patron, sustitucion) : texto.replace(patron, sustitucion);
  }
  texto = texto.replace(NO_ADMITIDO, aLoAdmitido);
  return texto.replace(/\u{E000}(?:[ \t\u{00A0}]*\u{E000})*/gu, SIN_TRANSCRIPCION);
}

/** Si un carácter suelto tiene glifo en las cuatro fuentes. */
export function tieneGlifo(caracter: string): boolean {
  return !NO_ADMITIDO_UNO.test(caracter);
}
