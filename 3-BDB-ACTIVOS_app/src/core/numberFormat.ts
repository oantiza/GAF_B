/**
 * Parser numérico europeo ÚNICO (auditoría 11-08 §4b, T4c).
 *
 * Hasta la ola 2 había CUATRO copias divergentes de esta lógica
 * (brokerPortfolioImport, positionImport, portfolioImport y commercialRetroCsv);
 * cada una arreglaba un caso distinto y reintroducía los demás. Esta es la
 * versión canónica (la de brokerPortfolioImport.parseAmount corregida en la
 * ola 1, unificada con la guarda de grupos de tres de positionImport) y las
 * cuatro delegaciones apuntan aquí.
 *
 * Reglas, en orden:
 *  1. Se limpian símbolos (€, %, espacios… todo salvo dígitos, ".", "," y "-").
 *  2. Cadena vacía tras limpiar -> NaN.
 *  3. Coma Y punto presentes -> el separador de MÁS A LA DERECHA es el decimal
 *     y el otro son miles ("1.234,56" = 1234.56; "1,234.56" = 1234.56).
 *  4. Solo coma -> decimal español ("12,5" = 12.5).
 *  5. Solo puntos en grupos EXACTOS de tres -> miles europeos
 *     ("20.000" = 20000, "1.234.567" = 1234567, "-3.000" = -3000).
 *  6. Resto -> Number directo ("1000.50" = 1000.5, "0.5" = 0.5).
 *
 * N-02 (revisión del 17-10-2026): un texto con letras que no sean un símbolo o
 * un código de divisa NO es un número (NaN). Antes se borraban las letras y
 * «IE00B4L5Y983» daba 45.983, «LU1234567891» 1.234.567.891 y «Fondo 2030»
 * 2.030: una columna desalineada producía importes verosímiles. Tampoco son
 * números las fechas («15/10/2026»), las horas ni los paréntesis. El menos
 * tipográfico (U+2212) cuenta como signo.
 */
const CURRENCY_MARKS =
  /€|\$|£|¥|(?<![a-z])(?:euros?|eur|usd|gbp|chf|jpy|sek|nok|dkk|cad|aud|hkd|sgd|cny|mxn|brl|pln|czk|huf|zar|inr)(?![a-z])/gi;
const NUMBER_CHARS = /^[\d.,\s\u00a0\u202f%+'-]*$/;

export function parseEuropeanNumber(raw: string): number {
  const text = String(raw ?? "").replace(/\u2212/g, "-").replace(CURRENCY_MARKS, "");
  if (!NUMBER_CHARS.test(text)) return NaN;
  const s0 = text.replace(/[^0-9.,-]/g, "").trim();
  if (!s0) return NaN;
  const lastComma = s0.lastIndexOf(",");
  const lastDot = s0.lastIndexOf(".");
  let s = s0;
  if (lastComma > -1 && lastDot > -1) {
    // ambos presentes: el de más a la derecha es el decimal, el otro son miles
    s = lastComma > lastDot ? s0.replace(/\./g, "").replace(",", ".") : s0.replace(/,/g, "");
  } else if (lastComma > -1) {
    const commaCount = (s0.match(/,/g) ?? []).length;
    if (commaCount > 1) {
      /* Ola A2 (A2.8): varias comas sin punto solo son válidas como millares
         US en grupos exactos de tres («1,234,567»); cualquier otra cosa se
         deja tal cual para que Number() la rechace con NaN. */
      s = /^-?\d{1,3}(,\d{3})+$/.test(s0) ? s0.replace(/,/g, "") : s0;
    } else {
      // solo una coma -> decimal (formato es)
      s = s0.replace(",", ".");
    }
  } else if (lastDot > -1 && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s0)) {
    // Cuarta pasada (N3-12): «0.008» no son miles (ningún grupo de miles
    // empieza por cero): es 0,008, no 8.
    // solo puntos en grupos exactos de tres -> separador de miles europeo
    s = s0.replace(/\./g, "");
  }
  return Number(s);
}
