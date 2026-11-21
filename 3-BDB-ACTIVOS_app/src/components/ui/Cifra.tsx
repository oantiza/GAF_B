import * as formato from "../../core/formato";
import type { Signo } from "../../core/formato";
import type { ClaseDeAusencia } from "../../types/fichaInstrumento";
import { Ausencia } from "./Ausencia";

export type TipoDeCifra =
  | "importe"
  | "importeTitular"
  | "importeGrande"
  | "rentabilidad"
  | "porcentaje"
  | "peso"
  | "puntos"
  | "ratio"
  | "precio"
  | "titulos"
  | "numero";

/**
 * Una cifra en pantalla: su formato, su color y su ausencia, decididos en un solo sitio.
 *
 * Hoy cada pantalla elige por su cuenta cuántos decimales lleva una rentabilidad, si va de verde y qué escribe cuando
 * no hay dato (la auditoría contó 132 funciones de formato y siete maneras de decir que falta un dato). Esta pieza
 * lo decide con las reglas del apartado 6 de `SISTEMA_DISENO.md`:
 *
 * - **El formato** sale de `src/core/formato.ts`, el módulo único. Los porcentajes se reciben como fracción (0,1039
 *   es un 10,39 %).
 * - **El color** solo en lo que dice si se gana o se pierde: por defecto, en `rentabilidad` y `puntos`, y en nada
 *   más (un peso, una volatilidad, un coste o el importe de un movimiento no llevan color). Se pide con
 *   `colorDeSigno` donde haga falta, como en el resultado de un periodo. Sale de `signoDe` **sobre la cifra ya
 *   redondeada**: lo que se escribe «0,00 %» es un cero y no lleva color ni signo.
 * - **La ausencia**: si el valor no es una cifra (`null`, `undefined`, `NaN`, un infinito), se pinta la pieza
 *   `Ausencia`: «Falta el dato» por defecto, «No aplica» o «Sin pedir». Nunca un cero inventado.
 *
 * | `tipo`           | Ejemplo        | Notas                                              |
 * |------------------|----------------|----------------------------------------------------|
 * | `importe`        | `1.234,56 €`   | `divisa`, `decimales` (2), `conSigno`               |
 * | `importeTitular` | `201.298 €`    | Sin decimales: la cifra grande de una respuesta     |
 * | `importeGrande`  | `2.304,3 M€`   | En millones, `decimales` (1)                        |
 * | `rentabilidad`   | `+10,39 %`     | Siempre con signo y con color                       |
 * | `porcentaje`     | `7,80 %`       | Volatilidad, caída máxima, coste: sin color         |
 * | `peso`           | `24,0 %`       | Un decimal                                          |
 * | `puntos`         | `+1,25 pp`     | Diferencia entre dos porcentajes, con color         |
 * | `ratio`          | `1,18`         | Sharpe, beta                                        |
 * | `precio`         | `535,02 €`     | De dos a cuatro decimales; `divisa`                 |
 * | `titulos`        | `17,6642`      | Hasta seis decimales                                |
 * | `numero`         | `1.334`        | `decimales` (0), `conSigno`                          |
 *
 * ```tsx
 * <Cifra tipo="rentabilidad" valor={0.1039} />                 // «+10,39 %», en verde
 * <Cifra tipo="importe" valor={resultado} conSigno colorDeSigno />
 * <Cifra tipo="porcentaje" valor={null} ausencia="no-aplica" /> // «No aplica»
 * ```
 */
export interface CifraProps {
  tipo: TipoDeCifra;
  valor: number | null | undefined;
  /** Código ISO de la divisa, en importes y precios. «EUR» por defecto, que se escribe «€». */
  divisa?: string;
  /** Los decimales, donde el tipo los admite (`importe`, `importeGrande`, `porcentaje`, `rentabilidad`, `peso`, `ratio`, `numero`). */
  decimales?: number;
  /** El «+» delante de lo positivo. `rentabilidad` y `puntos` lo llevan siempre. */
  conSigno?: boolean;
  /** Verde si sube y rojo si baja. Por defecto, sí en `rentabilidad` y `puntos` y no en los demás. */
  colorDeSigno?: boolean;
  /** Qué ausencia se pinta si no hay cifra. `falta` por defecto. */
  ausencia?: ClaseDeAusencia;
  /** En una columna estrecha, «Falta» en vez de «Falta el dato». */
  estrecha?: boolean;
  className?: string;
}

const CON_COLOR_POR_DEFECTO: ReadonlySet<TipoDeCifra> = new Set(["rentabilidad", "puntos"]);

/** El texto de la cifra, por el módulo de formato. `null` si no hay cifra. */
function textoDeCifra(tipo: TipoDeCifra, valor: number | null | undefined, opciones: Pick<CifraProps, "divisa" | "decimales" | "conSigno"> = {}): string | null {
  const { divisa, decimales, conSigno } = opciones;
  switch (tipo) {
    case "importe":
      return formato.importe(valor, { divisa, decimales, conSigno });
    case "importeTitular":
      return formato.importeTitular(valor, { divisa, conSigno });
    case "importeGrande":
      return formato.importeGrande(valor, { divisa, decimales, conSigno });
    case "rentabilidad":
      /* Siempre con signo. Con otros decimales, el mismo porcentaje con signo. */
      return decimales === undefined ? formato.rentabilidad(valor) : formato.porcentaje(valor, { decimales, conSigno: true });
    case "porcentaje":
      return formato.porcentaje(valor, { decimales, conSigno });
    case "peso":
      return decimales === undefined ? formato.peso(valor) : formato.porcentaje(valor, { decimales });
    case "puntos":
      return formato.puntos(valor);
    case "ratio":
      return decimales === undefined && !conSigno ? formato.ratio(valor) : formato.numero(valor, { decimales: decimales ?? 2, conSigno });
    case "precio":
      return formato.precio(valor, { divisa });
    case "titulos":
      return formato.titulos(valor);
    case "numero":
      return formato.numero(valor, { decimales, conSigno });
  }
}

/**
 * El signo de la cifra tal como se escribe: `signoDe` con los decimales que tiene el valor en la unidad en que se
 * recibe. Una rentabilidad con dos decimales de porcentaje son cuatro de fracción; un importe en millones con un
 * decimal, un decimal de millón.
 */
function signoDeCifra(tipo: TipoDeCifra, valor: number | null | undefined, decimales?: number): Signo | null {
  switch (tipo) {
    case "importe":
      return formato.signoDe(valor, decimales ?? 2);
    case "importeTitular":
      return formato.signoDe(valor, 0);
    case "importeGrande":
      return formato.signoDe(typeof valor === "number" ? valor / 1e6 : valor, decimales ?? 1);
    case "rentabilidad":
    case "porcentaje":
      return formato.signoDe(valor, (decimales ?? 2) + 2);
    case "puntos":
      return formato.signoDe(valor, 4);
    case "peso":
      return formato.signoDe(valor, (decimales ?? 1) + 2);
    case "ratio":
      return formato.signoDe(valor, decimales ?? 2);
    case "precio":
      return formato.signoDe(valor, 4);
    case "titulos":
      return formato.signoDe(valor, 6);
    case "numero":
      return formato.signoDe(valor, decimales ?? 0);
  }
}

/* Escritas enteras para que el censo de CSS vea su uso. */
const CLASE_DEL_SIGNO: Record<Signo, string> = {
  sube: "cifra--sube",
  baja: "cifra--baja",
  neutro: ""
};

export function Cifra({
  tipo,
  valor,
  divisa,
  decimales,
  conSigno,
  colorDeSigno = CON_COLOR_POR_DEFECTO.has(tipo),
  ausencia = "falta",
  estrecha = false,
  className = ""
}: CifraProps) {
  const texto = textoDeCifra(tipo, valor, { divisa, decimales, conSigno });
  if (texto === null) return <Ausencia clase={ausencia} estrecha={estrecha} />;
  const signo = colorDeSigno ? signoDeCifra(tipo, valor, decimales) : null;
  const clases = ["cifra", signo ? CLASE_DEL_SIGNO[signo] : "", className].filter(Boolean).join(" ");
  return <span className={clases}>{texto}</span>;
}
