import type { ComparisonAlternative, PatrimonialComparison } from "../adapters/macroReferenceBackend";
import { xirr, yearsBetween } from "./xirr";

/**
 * Las cuentas del Comparador patrimonial, sin pantalla, para poder probarlas con resultados conocidos.
 *
 * Hasta el 04-11-2026 esta pestaña abría con dos aportaciones, un valor final y una TIR de 6,11 %
 * escritos en el componente, sin rótulo de ejemplo. Delante del cliente se leían como suyos, y una
 * cifra que ve un cliente no se inventa. Ahora abre vacía y el ejemplo se carga a petición.
 */

export interface AportacionPatrimonial {
  id: number;
  /** Fecha ISO; vacía mientras no se haya escrito. */
  date: string;
  /** `null` mientras no se haya escrito: no es un cero, es que no está. */
  amount: number | null;
}

export interface ResultadoPatrimonial {
  capital: number;
  tir: number | null;
  years: number;
  start: string;
  end: string;
  /**
   * La fecha de una aportación posterior a la fecha final, si la hay. Con esas fechas no hay cifra: una TIR
   * de una aportación que aún no se ha hecho no significa nada, y `xirr` la calcula igual.
   */
  posterior: string | null;
}

/** Las filas con las dos cosas. Una fila a medias no cuenta, y `filasAMedias` lo dice. */
export function aportacionesValidas(flows: readonly AportacionPatrimonial[]) {
  return flows.flatMap((flow) =>
    flow.date && flow.amount !== null && flow.amount > 0 ? [{ date: flow.date, amount: flow.amount }] : []
  );
}

/** Cuántas filas llevan fecha o importe, pero no los dos. */
export function filasAMedias(flows: readonly AportacionPatrimonial[]): number {
  return flows.filter((flow) => Boolean(flow.date) !== (flow.amount !== null && flow.amount > 0)).length;
}

/**
 * La TIR de lo aportado frente al valor final, con la convención de `xirr` (año de 365,2425 días).
 * Sin una aportación completa y un valor final no hay nada que calcular: `start` vacío lo dice.
 */
export function resultadoPatrimonial(
  flows: readonly AportacionPatrimonial[],
  finalValue: number | null,
  finalDate: string
): ResultadoPatrimonial {
  const valid = aportacionesValidas(flows).sort((left, right) => left.date.localeCompare(right.date));
  const capital = valid.reduce((sum, flow) => sum + flow.amount, 0);
  /* Las fechas son ISO: se comparan como texto. La más tardía es la que se nombra. */
  const posterior = finalDate ? (valid.filter((flow) => flow.date > finalDate).at(-1)?.date ?? null) : null;
  if (valid.length === 0 || finalValue === null || finalValue <= 0 || !finalDate || posterior) {
    return { capital, tir: null, years: 0, start: "", end: finalDate, posterior };
  }
  return {
    capital,
    posterior,
    tir: xirr([
      ...valid.map((flow) => ({ date: new Date(flow.date), amount: -flow.amount })),
      { date: new Date(finalDate), amount: finalValue }
    ]),
    years: yearsBetween(new Date(valid[0].date), new Date(finalDate)),
    start: valid[0].date,
    end: finalDate
  };
}

/**
 * El ejemplo que se carga con «Cargar ejemplo». Cifras inventadas para enseñar la pantalla, y por eso
 * cada una sale rotulada. La fecha final es fija para que el ejemplo dé siempre lo mismo: con la de
 * hoy, su TIR cambiaba cada día.
 */
export const EJEMPLO_PATRIMONIAL = {
  flows: [
    { id: 1, date: "2021-01-15", amount: 50000 },
    { id: 2, date: "2023-06-15", amount: 20000 }
  ],
  finalValue: 95000,
  finalDate: "2026-11-04"
} as const;

/**
 * Si en los campos queda algún dato del ejemplo. Mientras quede uno, lo que sale de ellos sigue
 * siendo un ejemplo, aunque se hayan cambiado los otros; deja de serlo cuando ya no queda ninguno.
 */
export function quedaAlgoDelEjemplo(
  flows: readonly AportacionPatrimonial[],
  finalValue: number | null,
  finalDate: string
): boolean {
  return (
    finalValue === EJEMPLO_PATRIMONIAL.finalValue ||
    finalDate === EJEMPLO_PATRIMONIAL.finalDate ||
    flows.some((flow) =>
      EJEMPLO_PATRIMONIAL.flows.some(
        (ejemplo) => ejemplo.date === flow.date || ejemplo.amount === flow.amount
      )
    )
  );
}

/**
 * El día de hoy en la hora de quien mira, en ISO. `toISOString` da el de Greenwich: pasada la medianoche
 * en España, la fecha final de esta pantalla salía con el día anterior.
 */
export function hoyEnHoraLocal(ahora: Date = new Date()): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/**
 * El día 1 del mes de una fecha ISO. El IPC es mensual y el servidor se lo pide al INE desde el día que se le
 * da: desde el 15 de enero, el dato de enero no llega y esa aportación se queda sin deflactar. Con una sola
 * aportación, la TIR real salía igual que la nominal.
 */
export function primerDiaDelMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

/**
 * La huella de lo que se ha calculado. Lo que devuelve el servidor es de estos datos y de ningún otro: si
 * cambian, sus cifras no se pintan. Una fila a medias no cuenta en el cálculo, ni aquí.
 */
export function huellaDeLosDatos(
  flows: readonly AportacionPatrimonial[],
  finalValue: number | null,
  finalDate: string,
  tipoDelDeposito: number | null
): string {
  const ordenadas = aportacionesValidas(flows).sort(
    (a, b) => a.date.localeCompare(b.date) || a.amount - b.amount
  );
  return JSON.stringify({ ordenadas, finalValue, finalDate, tipoDelDeposito });
}

/** Valor final y TIR de una alternativa en el modo elegido. Las TIR, en puntos porcentuales, como llegan. */
export function valoresDelModo(alternativa: ComparisonAlternative, neto: boolean) {
  return neto
    ? { value: alternativa.valor_final_neto, nominal: alternativa.tir_nominal_neta_pct, real: alternativa.tir_real_neta_pct }
    : { value: alternativa.valor_final_bruto, nominal: alternativa.tir_nominal_bruta_pct, real: alternativa.tir_real_bruta_pct };
}

export interface CifrasDelModo {
  /** De qué lado del impuesto son las cifras. Sin cálculo del servidor, no hay lado que decir. */
  modo: "neto" | "bruto" | null;
  valorFinal: number | null;
  /** En tanto por uno. */
  tirNominal: number | null;
  tirReal: number | null;
  valorReal: number | null;
  enLetras: number | null;
  ventaja: number | null;
}

/**
 * La franja entera en un solo modo. El valor final y el valor real se quedaban en bruto con «Neto de
 * impuestos» marcado, junto a una TIR neta, y la ventaja se restaba de un valor neto que no estaba escrito.
 */
export function cifrasDelModo(entrada: {
  comparison: PatrimonialComparison | null;
  neto: boolean;
  finalValue: number | null;
  tirLocal: number | null;
  inflacionAnualPct: number | null | undefined;
  anos: number;
  /** La aproximación con el tipo medio de Letras, para cuando el servidor no trae la comparativa. */
  letrasAproximado: number | null;
}): CifrasDelModo {
  const { comparison, neto, finalValue, tirLocal, inflacionAnualPct, anos, letrasAproximado } = entrada;
  const cartera = comparison ? valoresDelModo(comparison.cartera, neto) : null;
  const letras = comparison ? valoresDelModo(comparison.letras, neto) : null;
  const valorFinal = typeof cartera?.value === "number" ? cartera.value : finalValue;
  const enLetras = typeof letras?.value === "number" ? letras.value : letrasAproximado;
  return {
    modo: comparison ? (neto ? "neto" : "bruto") : null,
    valorFinal,
    tirNominal: typeof cartera?.nominal === "number" ? cartera.nominal / 100 : tirLocal,
    tirReal: typeof cartera?.real === "number" ? cartera.real / 100 : null,
    valorReal:
      typeof inflacionAnualPct === "number" && anos > 0 && valorFinal !== null
        ? valorFinal / Math.pow(1 + inflacionAnualPct / 100, anos)
        : null,
    enLetras,
    ventaja: enLetras !== null && valorFinal !== null ? valorFinal - enLetras : null
  };
}
