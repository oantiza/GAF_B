import { metricFrequencyLabel } from "./metricsFrequency";
import { metricsMethodLabel } from "./labels";

/**
 * Si las cifras que se ponen en la misma columna salen del mismo cálculo.
 *
 * `metrics.v1.2` declara con qué metodología se obtuvo cada ventana. Hasta que
 * existió esa etiqueta, el comparador ponía juntas la cifra trailing de
 * Morningstar de un fondo y la que calcula BDB sobre la serie diaria de una
 * acción, y las presentaba como comparables (auditoría 03-09, hallazgo 02).
 *
 * Solo cuentan los activos que tienen la cifra: uno sin Sharpe no aporta
 * metodología ninguna, y contarlo daría un aviso falso.
 */
export interface MethodologyInput {
  value: number | null | undefined;
  method?: string;
  frequency?: string;
}

export interface MethodologyNotice {
  /** Hay más de una metodología entre las cifras presentes. */
  mixed: boolean;
  /** Alguna de esas cifras no dice con qué método se calculó, así que no se puede afirmar que sean comparables. */
  sinDeclarar: boolean;
  /** Nota al pie de la sección, con la metodología cuando es única. */
  footnote: string;
}

const FOOTNOTE_BASE = "Volatilidad y rentabilidad anualizadas.";

const DATOS_POR_FRECUENCIA: Record<string, string> = { DAILY: "diarios", WEEKLY: "semanales", MONTHLY: "mensuales" };

/**
 * De qué sale una cifra, dicho para quien la lee: con qué datos y en qué divisa, sin el código del método ni el nombre
 * de quien la calcula. La frecuencia es la que la cifra declara y «en euros» lo dice la etiqueta de su método: lo que
 * no se declara, se dice que no está.
 */
export function calculoEnPalabras({ method, frequency }: Pick<MethodologyInput, "method" | "frequency">): string {
  if (!method) return "sin método declarado";
  if (method === "TRAILING_PROVIDER") return "con la cifra del proveedor";
  if (method === "PROPIA_Y_PROVEEDOR") return "con datos propios y, donde no llegan, con la cifra del proveedor";
  const datos = DATOS_POR_FRECUENCIA[frequency ?? ""];
  const enEuros = metricsMethodLabel(method).includes("en euros") ? " en euros" : "";
  return datos ? `con datos ${datos}${enEuros}` : `con datos de frecuencia no declarada${enEuros}`;
}

const enUnaLista = (partes: readonly string[]) =>
  partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}` : partes.join("");

const tieneCifra = (row: MethodologyInput) => typeof row.value === "number" && Number.isFinite(row.value);

/* La etiqueta del método está en femenino porque habla de la cifra, y así la lee el panel del plano. El pie dice «Sharpe 3A: …». */
const dichoDelSharpe = (etiqueta: string) => etiqueta.replace(/^calculada\b/, "calculado");

/**
 * `cifrasDelPie` son las cifras de las que el pie dice qué observaciones traen, si son más que las de esta fila: un
 * informe imprime una tabla entera, y una acción, que no tiene Sharpe, sí tiene rentabilidad y volatilidad.
 */
export function describeMetricsMethodology(
  rows: readonly MethodologyInput[],
  metricLabel = "Sharpe 3A",
  cifrasDelPie: readonly MethodologyInput[] = rows
): MethodologyNotice {
  const withValue = rows.filter(tieneCifra);
  const methods = [...new Set(withValue.map((row) => row.method ?? ""))];

  const frequencies = [...new Set(withValue.map((row) => row.frequency))];
  const observaciones = [...new Set(cifrasDelPie.filter(tieneCifra).map((row) => metricFrequencyLabel(row.frequency)))];
  const frequencyNote = observaciones.length > 0 ? ` Observaciones: ${enUnaLista(observaciones)}.` : "";
  const mixedFrequencies = frequencies.length > 1;

  /*
   * Dos cifras cuyo metodo NO se conoce no son «el mismo metodo»: son dos incognitas.
   *
   * Hasta el 03-11-2026 las dos caian en la misma cadena vacia, el conjunto tenia un solo
   * elemento y esta funcion decia que no habia mezcla. Medido ese dia: BHP y DWS ESG
   * Stiftungsfonds quedaban en la misma fila, con metodos distintos de verdad, y sin aviso.
   * Era una comprobacion que no podia fallar justo donde mas falta: dos etiquetas DISTINTAS
   * se cazaban y dos DESCONOCIDAS no.
   *
   * Con una sola cifra no hay nada que comparar, asi que no se avisa. Con dos o mas y alguna
   * sin metodo, lo que no se puede es AFIRMAR que sean comparables, y en este proyecto un dato
   * que no esta se dice que no esta.
   */
  const sinMetodo = withValue.filter((row) => (row.method ?? "") === "").length;
  const noSePuedeAfirmar = withValue.length > 1 && sinMetodo > 0;

  if (methods.length <= 1) {
    const only = methods[0];
    return {
      mixed: mixedFrequencies || noSePuedeAfirmar,
      sinDeclarar: noSePuedeAfirmar,
      footnote: only
        ? `${metricLabel}: ${dichoDelSharpe(metricsMethodLabel(only))}. ${FOOTNOTE_BASE}${frequencyNote}`
        : FOOTNOTE_BASE + frequencyNote
    };
  }

  return {
    mixed: true,
    sinDeclarar: noSePuedeAfirmar,
    footnote: FOOTNOTE_BASE + frequencyNote
  };
}
