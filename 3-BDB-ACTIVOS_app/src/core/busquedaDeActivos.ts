/**
 * Cómo se encuentra un activo por lo que se teclea (decisión 81 de Óscar, 05-11-2026).
 *
 * Una sola regla para las dos búsquedas: el Buscador, que busca aquí en memoria sobre las tarjetas, y el selector del
 * Comparador, que pregunta al servidor (`functions_python/readmodel/busqueda.py`). Y «Elegir otro activo», al sustituir una posición,
 * con esta misma función (decisión 113). Se pliegan acentos y mayúsculas, se ignoran apóstrofos y puntos, y **cada palabra** tecleada
 * tiene que estar en el nombre, el ISIN o el símbolo, en cualquier orden, o ser una palabra entera de un nombre habitual. Así «Morgan
 * Stanley Global Brands» encuentra «Morgan Stanley Investment Funds - Global Brands Fund A», con lo que haya en medio, «Telefónica»
 * encuentra «Telefonica», y «Loreal» y «L'Oreal» encuentran a L'Oréal.
 *
 * Entera, porque un símbolo tiene que seguir dando lo mismo: dentro de «Iberia» está IBE, y su búsqueda traería también IAG.
 *
 * Son dos copias porque el sitio y las Functions se empaquetan por separado, y la lista tiene la suya en
 * `functions_python/readmodel/nombres_habituales.json`. `tests/busquedaDeActivos.test.ts` falla si la lista difiere, y los dos
 * lados pasan por los mismos casos de `functions_python/tests/fixtures/busqueda_de_activos.json`.
 */

/**
 * Los nombres por los que se pide un valor y que la base no usa. Van por ISIN, comprobado cada uno contra el nombre que tiene en
 * la base (05-11-2026), y por eso no dependen de cómo se llame allí: si un día se limpia el nombre, esto sigue valiendo. Google,
 * Facebook y L'Oreal no están en la lista: Óscar dijo que los añadiría él si quiere.
 */
export const NOMBRES_HABITUALES_POR_ISIN: Readonly<Record<string, readonly string[]>> = {
  ES0148396007: ["Inditex", "Zara"], // Industria de Diseño Textil
  ES0105027009: ["Logista"], // Compañía de Distribución Integral Logista
  ES01717430J3: ["Prisa"], // Promotora de Informaciones
  ES0116870314: ["Gas Natural"], // Naturgy Energy Group
  ES0177542018: ["Iberia"], // International Consolidated Airlines Group
  ES0173093024: ["Red Eléctrica"], // Redeia Corporación
  ES0169501022: ["PharmaMar"], // Pharma Mar
  ES0162600003: ["Duro Felguera"], // En bolsa, DURO FELGUE. INH. EO-05
  ES0126962069: ["Nextil"], // Nueva Expresión Textil
  ES0180918015: ["Sanjose"], // Grupo Empresarial San José
  NL0015001OI1: ["Mediaset"] // MFE-Mediaforeurope
};

/**
 * Cómo se escribe una gestora y cómo la llama la base, palabra por palabra y ya plegado: una gestora son muchos ISIN, y no van en la
 * lista de arriba. «JP Morgan» y «J.P. Morgan» no hacen falta: sin los puntos, «jp» y «morgan» ya están dentro de «jpmorgan», y así
 * sale también el fondo que la base llama «Best JP Morgan».
 */
export const VARIANTES_DE_GESTORA: Readonly<Record<string, string>> = {
  schroders: "schroder"
};

/** Lo que el buscador sabe de un activo. */
export interface ActivoBuscable {
  nombre: string;
  isin: string;
  ticker?: string | null;
}

/** Sin acentos y en minúsculas. También la ñ: «Diseño» encuentra el «Diseno» de la base. */
export function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Plegado y sin apóstrofos ni puntos: lo que se teclea y lo que hay en la base se comparan así. */
function comoSeBusca(texto: string): string {
  return plegar(texto).replace(/['’‘´`.]/g, "");
}

function palabrasDe(busqueda: string): string[] {
  return comoSeBusca(busqueda)
    .split(/\s+/)
    .filter(Boolean)
    /* `hasOwn`, porque lo escribe quien busca: «constructor» no es una variante, aunque un objeto lo tenga. */
    .map((palabra) => (Object.hasOwn(VARIANTES_DE_GESTORA, palabra) ? VARIANTES_DE_GESTORA[palabra] : palabra));
}

/** Si un activo responde a lo tecleado: cada palabra, en cualquier orden. Sin nada tecleado responden todos. */
export function coincideConLoTecleado(activo: ActivoBuscable, busqueda: string): boolean {
  const palabras = palabrasDe(busqueda);
  if (palabras.length === 0) return true;
  const donde = comoSeBusca([activo.nombre, activo.isin, activo.ticker ?? ""].join(" "));
  const habituales = (NOMBRES_HABITUALES_POR_ISIN[activo.isin] ?? []).flatMap((nombre) => comoSeBusca(nombre).split(" "));
  return palabras.every((palabra) => donde.includes(palabra) || habituales.includes(palabra));
}

/**
 * Si lo tecleado es exactamente su símbolo, su ISIN o su nombre habitual. Es lo que va delante al ordenar por nombre: «SAN» encontraba
 * primero Artisan, porque contiene esas tres letras y empieza por A, y Santander y Sanofi, que se llaman así en bolsa, salían después.
 */
export function esRespuestaExacta(activo: ActivoBuscable, busqueda: string): boolean {
  const texto = comoSeBusca(busqueda).trim().replace(/\s+/g, " ");
  if (texto === "") return false;
  return [activo.isin, activo.ticker ?? "", ...(NOMBRES_HABITUALES_POR_ISIN[activo.isin] ?? [])].some((campo) => comoSeBusca(campo) === texto);
}
