import type { BdbHoldingPosition } from "../types/bdbAssets";

/**
 * Qué es una línea de la cartera de un fondo. Decisión 9 de Óscar (04-11-2026): se lee del código fino del proveedor y
 * **nunca del nombre**, con el riesgo que tendría clasificar mal delante del cliente. Lo que significa cada código, de dónde
 * sale y cómo se midió está en el contrato `instrument-declared-holdings.v2`, en `holding_type_code`.
 *
 * Hay tres vocabularios, porque cada base trae lo que trae:
 *
 * - **El código fino** (`E`, `CU`, `SI`…), que es lo que vale. Lo llevan todas las líneas de Morningstar en la base nueva desde
 *   el 05-11-2026, y solo 36.000 de las 148.000 de la base vieja, en su `instrument_type`.
 * - **La clase de la base vieja** (`equity`, `bond`, `other`), en el resto de sus líneas. Dice en qué página del proveedor venía,
 *   y en la de bolsa también hay CFD y opciones. Se distingue porque aquello no tiene ISIN y una acción sí: medido el 05-11-2026,
 *   tienen ISIN 38.557 de las 38.767 acciones, 0 de 941 CFD y 53 de 995 opciones.
 * - **La clase de la base nueva** (`EQUITY`, `FIXED_INCOME`, `CASH`, `OTHER`), lo único que tiene la nube hasta que se suba el
 *   catálogo. Es la misma página, pero esta se queda sin leer a propósito: es la que Óscar descartó como base de la tabla, porque
 *   lo que dice `EQUITY` no cierra la pregunta. Sí dice lo que no es una acción: en las otras tres no hay ninguna.
 *
 * Y un cuarto, que no es del proveedor: **la clase de la cartera del emisor** de un ETF (decisión B-79), que la
 * extractora traduce del literal del emisor con una tabla medida (`position_type` del contrato `instrument-issuer-holdings-chunk.v2`).
 * Viaja como código con el prefijo `EMISOR:` (`EMISOR:EQUITY`, `EMISOR:DERIVATIVE`…), para que no se pueda confundir con un código
 * fino de una o dos letras. Lo pone `core/carteraDelEmisor`.
 */

export type ClaseDeLinea = "accion" | "otra" | "sin-clase";

/** El prefijo de las clases de la cartera del emisor. */
export const PREFIJO_DEL_EMISOR = "EMISOR:";

const CODIGOS_DE_ACCION: ReadonlySet<string> = new Set(["E", "ER", "EU", "EQ", `${PREFIJO_DEL_EMISOR}EQUITY`]);

/** Los derivados, por su código: importes nominales y no inversión directa. Los grupos son los del contrato. */
const CODIGOS_DE_DERIVADO: ReadonlySet<string> = new Set([
  /* Sobre bolsa */ "SF", "DH", "DI", "DG", "SE", "EW", "EL", "EP", "EC",
  /* Divisa */ "CU", "CL", "CS", "CY", "CZ",
  /* Tipos y crédito */ "SI", "OS", "SJ", "TF", "DA", "BU", "DB", "DE", "DC", "DJ", "FD", "IS", "SR", "ST", "SX", "SY", "SN",
  /* La cartera del emisor: futuros, contado y plazo de divisa, permutas y derechos */ `${PREFIJO_DEL_EMISOR}DERIVATIVE`
]);

const CLASE_VIEJA_DE_BOLSA: ReadonlySet<string> = new Set(["equity", "Equity"]);
const CLASE_QUE_NO_ES_BOLSA: ReadonlySet<string> = new Set([
  /* Base vieja */ "bond", "Bond", "other", "Other", "Fund", "cash",
  /* Base nueva */ "FIXED_INCOME", "CASH", "OTHER"
]);

/** El código fino de la base vieja, que viaja en `instrument_type`. Sus clases y las de la base nueva son palabras. */
export function codigoFinoDeLaBaseVieja(instrumentType: string | undefined): string | undefined {
  return instrumentType && /^[A-Z0-9]{1,2}$/.test(instrumentType) ? instrumentType : undefined;
}

export function claseDeLinea(linea: Pick<BdbHoldingPosition, "holding_type_code" | "holding_type" | "isin">): ClaseDeLinea {
  const codigo = linea.holding_type_code?.trim().toUpperCase();
  if (codigo) return CODIGOS_DE_ACCION.has(codigo) ? "accion" : "otra";
  const clase = linea.holding_type?.trim() ?? "";
  if (CLASE_VIEJA_DE_BOLSA.has(clase)) return linea.isin?.trim() ? "accion" : "otra";
  return CLASE_QUE_NO_ES_BOLSA.has(clase) ? "otra" : "sin-clase";
}

/**
 * Las líneas que son, a su vez, un fondo: abiertos (`FO`), ETF y ETC (`FE`), cerrados (`FC`) y otras instituciones
 * (`EX`), según el contrato de la cartera. Los monetarios (`FM`) no entran: son liquidez, y la decisión 87 los cuenta
 * como títulos. De las 798 carteras de fondos medidas el 16-11-2026, 1.286 líneas son de estas.
 */
const CODIGOS_DE_FONDO: ReadonlySet<string> = new Set(["FO", "FE", "FC", "EX"]);

/** Si el código dice que la línea es otro fondo, cuya cartera no se abre. Sin código no se afirma nada. */
export function esFondoPorSuCodigo(codigo: unknown): boolean {
  return typeof codigo === "string" && CODIGOS_DE_FONDO.has(codigo.trim().toUpperCase());
}

/** Si el código dice que la línea es un derivado. Sin código no se afirma nada, ni se mira el nombre. */
export function esDerivadoPorSuCodigo(codigo: unknown): boolean {
  return typeof codigo === "string" && CODIGOS_DE_DERIVADO.has(codigo.trim().toUpperCase());
}

/**
 * Lo que no cuenta como título en el solapamiento entre dos fondos (decisión 87 de Óscar, 05-11-2026: se cuentan solo títulos). Es la
 * única lista de lo que se deja fuera, y va por grupos, con lo que dice de cada código el contrato:
 *
 * - **Los derivados** (`CODIGOS_DE_DERIVADO`): su peso es un nominal, no inversión. De aquel 3,21 % entre PIMCO y Goldman, 2,64 puntos
 *   eran dos futuros sobre deuda.
 * - **Sus contrapartidas en efectivo**, `CQ` y `OT`: la pata que compensa el nominal de un derivado. Se llaman igual en todos los fondos
 *   («Cash Offset») y cruzaban por el nombre.
 * - **El efectivo**: `C`, efectivo; `CH` y `CD`, cuentas y depósitos; `QQ`, cuentas en un depositario, y `CA`, colateral. Un saldo no es
 *   un título que dos fondos compartan, y cruzaba por llamarse igual: «Cash», «Euro», «US Dollars».
 *
 * Se quedan los pagarés (`CP`), los repos (`CR`) y los fondos monetarios (`FM`), que el contrato pone en liquidez pero no son efectivo: los
 * pagarés y los monetarios son títulos de un emisor, y las líneas de repo se llaman como el bono al que van ligadas.
 *
 * **Una línea sin código cuenta**, y su nombre no se mira (decisión 9): en esos fondos la cifra se queda como antes.
 */
const CODIGOS_QUE_NO_SON_TITULOS: ReadonlySet<string> = new Set([
  ...CODIGOS_DE_DERIVADO,
  /* Contrapartida en efectivo de un derivado */ "CQ", "OT",
  /* Efectivo, cuentas, depósitos y colateral */ "C", "CH", "CD", "QQ", "CA",
  /* La liquidez de la cartera del emisor: efectivo, colateral y los fondos monetarios del propio emisor, que su tabla no separa. Los
     monetarios dejan de contar, cuando con el código fino (`FM`) cuentan: es lo que permite el dato. */ `${PREFIJO_DEL_EMISOR}CASH`
]);

/** Si una línea entra en el solapamiento: todo lo que su código no diga que es un derivado, su contrapartida o efectivo. */
export function cuentaEnElSolapamiento(codigo: unknown): boolean {
  return !(typeof codigo === "string" && CODIGOS_QUE_NO_SON_TITULOS.has(codigo.trim().toUpperCase()));
}

/** Las divisas que se leen en el nombre de una línea, por su código: lo que no sea uno de estos no se toma por divisa. */
const CODIGOS_DE_DIVISA: ReadonlySet<string> = new Set([
  "EUR", "USD", "GBP", "CHF", "JPY", "SEK", "NOK", "DKK", "CZK", "PLN", "HUF", "RON", "TRY", "CAD", "AUD", "NZD", "CNY", "CNH", "HKD", "SGD",
  "KRW", "TWD", "INR", "IDR", "MYR", "THB", "PHP", "BRL", "MXN", "CLP", "COP", "PEN", "ZAR", "ILS", "SAR", "AED"
]);

/** Hasta dos divisas, en el orden en que las dice el nombre: «EUR/SEK_260904 Purchased» dice EUR/SEK, y «CURRENCY CONTRACT - EUR Purchased», EUR. */
function divisasDelNombre(nombre: string): string {
  const leidas = nombre.split(/[^A-Za-z]+/).map((trozo) => trozo.toUpperCase()).filter((trozo) => CODIGOS_DE_DIVISA.has(trozo));
  return [...new Set(leidas)].slice(0, 2).join("/");
}

/**
 * Cómo se llama una línea de la Cartera de la ficha cuando su nombre es de trabajo del proveedor (decisión 93): `null`, si se queda con el
 * suyo. El tipo sale del código, como manda la decisión 9, y **nunca del nombre**; del nombre solo se lee qué divisa dice, si la dice con su
 * código. Una línea sin código se queda como está, por sucio que sea su nombre.
 *
 * Toda pata de forward (`CU`) se llama igual, y no solo las que acaban en «Purchased»: «Ct 1 Eur/Usd Ah» tampoco se lee mejor. La permuta
 * (`CS`) no dice divisa: en «CCS USD R USSOFR/JPYMUTKCALM» solo se lee la mitad, y diría USD de una permuta dólar-yen. Las de efectivo y
 * depósito solo cambian con guion bajo, que es lo que delata un nombre de sistema como «Eur_Es0821008990951300063302», el número de una cuenta:
 * «Cash» o «Cc. (Eur) En Banco Inversis, S.A.» ya se leen.
 */
export function rotuloDeLinea(nombre: string, codigo: unknown): string | null {
  const tipo = typeof codigo === "string" ? codigo.trim().toUpperCase() : "";
  if (tipo === "CU") return `Contrato de divisa ${divisasDelNombre(nombre)}`.trim();
  if (tipo === "CS") return "Permuta de divisas";
  if (!nombre.includes("_")) return null;
  if (tipo === "C") return `Efectivo ${divisasDelNombre(nombre)}`.trim();
  if (tipo === "CD") return "Cuenta o depósito";
  return null;
}

/**
 * Lo que `declared/holdings` dice que pesan las diez mayores, si cuadra con sus diez primeras filas. Con la tolerancia de medio
 * punto, medido el 05-11-2026 sobre las carteras de la base nueva, no cuadra en 309 de 748: el proveedor calcula esa cifra con sus
 * mayores títulos, sin efectivo ni derivados, y las filas los llevan. PIMCO dice 23,71 % con una primera fila de 30,36 %.
 */
export const TOLERANCIA_DE_LAS_DIEZ_MAYORES = 0.005;

export function diezMayoresQueCuadran(pesoDeclarado: unknown, pesosDeLasFilas: readonly unknown[]): number | undefined {
  if (typeof pesoDeclarado !== "number" || !Number.isFinite(pesoDeclarado)) return undefined;
  const pesos = pesosDeLasFilas.filter((peso): peso is number => typeof peso === "number" && Number.isFinite(peso));
  if (pesos.length === 0 || pesos.length !== pesosDeLasFilas.length) return undefined;
  const suma = pesos.reduce((total, peso) => total + peso, 0);
  /* El margen es de la coma flotante: 0,2 + 0,105 no da exactamente 0,305, y el umbral no puede depender de eso. */
  return Math.abs(suma - pesoDeclarado) <= TOLERANCIA_DE_LAS_DIEZ_MAYORES + 1e-9 ? pesoDeclarado : undefined;
}
