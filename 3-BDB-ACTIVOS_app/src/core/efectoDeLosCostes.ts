import { esSoloDeAcciones, type calculatePortfolioCosts, type calculatePortfolioManagementFee } from "./portfolioCosts";

/**
 * Cuánto menos tendría el cliente al cabo de 5 y 10 años por lo que cuesta su cartera (Óscar, 11-11-2026). Solo en el cuadro de
 * Costes de la pantalla: no va a ningún papel.
 *
 * - Sin costes: K × (1 + r)^T. Con costes: K × ((1 + r) × (1 − c))^T. La diferencia, en euros y en porcentaje del resultado sin
 *   costes, que es 1 − (1 − c)^T: no depende ni del capital ni de la rentabilidad supuesta.
 * - **r es un supuesto del asesor**, la misma para todo y antes de costes: 5 % si no dice otra. **No es la rentabilidad pasada de la
 *   cartera**: una cifra que repite el pasado promete, como pasó con el cono del informe interno (A-140).
 * - **c es el coste corriente medio ponderado**, más la comisión de gestión de la cartera si el asesor la ha indicado en el cuadro.
 *   Se descuenta cada año sobre el patrimonio, que es como lo cobra un fondo. No entran la entrada (suscripción) máxima, que es un
 *   máximo de folleto y rara vez se cobra; ni los costes de operación, que solo se conocen en parte; ni las retrocesiones, que ya van
 *   dentro del coste de cada fondo: sumarlas sería contar dos veces.
 * - Si falta el coste de un fondo, no se calcula: con un hueco tratado como cero, la cifra diría que la cartera cuesta menos.
 *   Con solo acciones, no aplica, salvo que el asesor haya indicado la comisión de gestión: entonces c es solo esa comisión. Con
 *   un coste cero, las dos cifras coinciden.
 */

/** La rentabilidad supuesta de partida, anual y antes de costes. */
export const RENTABILIDAD_SUPUESTA_POR_DEFECTO = 0.05;
/** Lo que admite el campo: un supuesto de largo plazo, no una previsión. */
export const RENTABILIDAD_SUPUESTA_MINIMA = 0;
export const RENTABILIDAD_SUPUESTA_MAXIMA = 0.15;
/** Los dos horizontes que se enseñan, en años. */
export const HORIZONTES_DEL_EFECTO = [5, 10] as const;

export interface FilaDelEfecto {
  anos: number;
  sinCostes: number;
  conCostes: number;
  /** Lo que se deja por el camino, en euros. */
  diferencia: number;
  /** La diferencia sobre el resultado sin costes: 1 − (1 − c)^T. */
  diferenciaPct: number;
}

export type EfectoDeLosCostes =
  | { estado: "calculado"; capital: number; rentabilidad: number; coste: number; costeDeLosProductos: number; gestion: number | null; soloGestion: boolean; filas: FilaDelEfecto[] }
  | { estado: "no-aplica"; motivo: string }
  | { estado: "falta"; motivo: string };

/** Lo que crece un capital a una tasa anual compuesta. La fórmula escrita, sin más. */
export function valorFinal(capital: number, rentabilidad: number, coste: number, anos: number): number {
  return capital * ((1 + rentabilidad) * (1 - coste)) ** anos;
}

/** La rentabilidad que ha escrito el asesor, en fracción; `null` si no es un número dentro de lo que admite el campo. */
export function rentabilidadSupuesta(entrada: string): number | null {
  if (entrada.trim() === "") return null;
  const valor = Number(entrada.replace(",", "."));
  if (!Number.isFinite(valor)) return null;
  const fraccion = valor / 100;
  return fraccion >= RENTABILIDAD_SUPUESTA_MINIMA && fraccion <= RENTABILIDAD_SUPUESTA_MAXIMA ? fraccion : null;
}

export function efectoDeLosCostes(entrada: {
  costs: Pick<ReturnType<typeof calculatePortfolioCosts>, "rows" | "missing" | "acciones" | "avgCostPct">;
  /** El capital sobre el que se lee: el declarado, o el de ejemplo si no lo hay. */
  capital: number;
  /** La comisión de gestión de la cartera, si el asesor la ha activado en el cuadro. */
  gestion: { enabled: boolean; fee: Pick<ReturnType<typeof calculatePortfolioManagementFee>, "valid" | "rate"> | null };
  /** La rentabilidad supuesta, en fracción; `null` si el campo no tiene una válida. */
  rentabilidad: number | null;
}): EfectoDeLosCostes {
  const { costs, capital, gestion, rentabilidad } = entrada;
  if (costs.rows.length === 0) return { estado: "falta", motivo: "No hay posiciones en cartera." };
  /* Solo acciones (Dirección, 11-11-2026): sin comisión de gestión no hay coste que proyectar; con ella, c es solo esa comisión, porque
     una acción no tiene coste corriente y en la media cuenta como cero. */
  const soloAcciones = esSoloDeAcciones(costs);
  if (soloAcciones && !gestion.enabled) return { estado: "no-aplica", motivo: "Una acción no tiene coste corriente: no hay coste que proyectar." };
  if (costs.missing > 0) {
    return {
      estado: "falta",
      motivo: costs.rows.length === 1
        ? "Falta el coste corriente de la única posición, y sin él no se calcula."
        : `Falta el coste corriente de ${costs.missing} de las ${costs.rows.length} posiciones, y sin él no se calcula: contarlo como cero diría que la cartera cuesta menos.`
    };
  }
  const costeDeLosProductos = costs.avgCostPct;
  if (costeDeLosProductos == null || !Number.isFinite(costeDeLosProductos) || costeDeLosProductos < 0) {
    return { estado: "falta", motivo: "Falta el coste corriente medio de la cartera." };
  }
  let tasaDeGestion: number | null = null;
  if (gestion.enabled) {
    const rate = gestion.fee?.valid ? gestion.fee.rate : null;
    if (rate == null || !Number.isFinite(rate) || rate < 0) {
      return { estado: "falta", motivo: "La comisión de gestión de la cartera está activada pero su importe no es válido o está pendiente." };
    }
    tasaDeGestion = rate;
  }
  if (rentabilidad == null || !Number.isFinite(rentabilidad)) {
    return { estado: "falta", motivo: "Indica una rentabilidad supuesta entre el 0 % y el 15 % anual." };
  }
  if (!Number.isFinite(capital) || capital <= 0) return { estado: "falta", motivo: "Falta el capital sobre el que leerlo." };
  const coste = costeDeLosProductos + (tasaDeGestion ?? 0);
  if (coste >= 1) return { estado: "falta", motivo: "El coste anual llega al 100 %: no hay nada que proyectar." };
  const filas = HORIZONTES_DEL_EFECTO.map((anos) => {
    const sinCostes = valorFinal(capital, rentabilidad, 0, anos);
    const conCostes = valorFinal(capital, rentabilidad, coste, anos);
    const diferencia = sinCostes - conCostes;
    return { anos, sinCostes, conCostes, diferencia, diferenciaPct: sinCostes > 0 ? diferencia / sinCostes : 0 };
  });
  return { estado: "calculado", capital, rentabilidad, coste, costeDeLosProductos, gestion: tasaDeGestion, soloGestion: soloAcciones, filas };
}
