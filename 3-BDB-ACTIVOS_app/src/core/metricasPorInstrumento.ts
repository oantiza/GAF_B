import type { InstrumentType } from "../types/bdbAssets";

/**
 * Qué métricas se enseñan para cada tipo de instrumento. Una sola lista, y la leen las pantallas.
 *
 * Decidir que el Sharpe de una acción no se enseña (Óscar, 03-11-2026; §9 de
 * `METODO_PROPIO_METRICAS`) dejó la regla escrita en cuatro sitios y olvidada en otros cuatro: el
 * diálogo de sustitución y el Comparador enseñaban la cifra, y en la web, donde el servidor ya no la
 * manda, decían «N/D», que se lee como que falta lo que en realidad no aplica. Ahora, si un día se
 * decide lo mismo de otra métrica, se cambia aquí y no hay que ir a buscar pantallas.
 * `tests/metricasPorInstrumento.test.ts` recorre las pantallas y falla si una se la salta.
 *
 * **Decide lo que se enseña, no lo que se calcula ni cómo se ordena.** La cifra sigue guardada: la
 * retirada formal queda fuera por decisión de Óscar. Y `candidateRanking` no lee esta lista: a una
 * acción no se le aplica, sus alternativas van por nombre (decisión 16).
 *
 * **También la lee el papel, desde la decisión 83:** si el contrato dice que a ese tipo no le aplica, se escribe «No aplica», no cuenta como
 * dato que falta y no avisa. N/D queda para lo que falta de verdad. Que un informe lea una entrada nueva es un cambio de papel con su decisión:
 * lo que firma el asesor no se toca de rebote. La retrocesión de la salida interna de la Comparativa de activos le llega ya resuelta desde la pantalla.
 *
 * Las cinco últimas son de una cartera, no de un instrumento: se leen solo si lo que se mide es una sola acción (`esUnaSolaAccion`). Dos acciones
 * siguen siendo una cartera, y la beta, el VaR, la volatilidad y la caída no están aquí: esas se quedan.
 */
const NO_APLICA = {
  sharpe: {
    tipos: ["STOCK"],
    motivo: "De un componente importa lo que aporta a la cartera, no su nota aislada."
  },
  sortino: {
    tipos: ["STOCK"],
    motivo: "La misma razón que el Sharpe: mide el exceso sobre el tipo sin riesgo de una cartera, no de un componente."
  },
  morningstar: {
    tipos: ["STOCK"],
    motivo: "Las estrellas que trae este catálogo puntúan fondos y ETF frente a su categoría."
  },
  retrocesion: {
    tipos: ["STOCK"],
    motivo: "Una acción no tiene comisión de gestión de la que ceder una parte."
  },
  costeCorriente: {
    tipos: ["STOCK"],
    motivo: "Una acción no tiene gestora ni coste corriente."
  },
  patrimonio: {
    tipos: ["STOCK"],
    motivo: "Una acción no tiene patrimonio gestionado: lo suyo es la capitalización, que es otra cifra."
  },
  indicadorDeRiesgo: {
    tipos: ["STOCK"],
    motivo: "El SRI y el SRRI salen del KID y del KIID de un fondo o un ETF, y una acción no tiene ninguno de los dos."
  },
  calmar: {
    tipos: ["STOCK"],
    motivo: "La misma razón que el Sharpe: es una nota del conjunto, y de un componente importa lo que aporta a la cartera."
  },
  alfa: {
    tipos: ["STOCK"],
    motivo: "El contrato lo reserva a fondos y ETF: mide lo que añade quien gestiona, y una acción no tiene gestor."
  },
  ratioDeInformacion: {
    tipos: ["STOCK"],
    motivo: "El contrato lo reserva a fondos y ETF: mide si la separación del índice ha compensado, y una acción no sigue ninguno."
  },
  rentabilidadActiva: {
    tipos: ["STOCK"],
    motivo: "El contrato la reserva a fondos y ETF: es la diferencia con un índice que una acción no sigue."
  },
  trackingError: {
    tipos: ["STOCK"],
    motivo: "El contrato lo reserva a fondos y ETF: mide cuánto se separa de un índice que una acción no sigue."
  }
} as const satisfies Record<string, { tipos: readonly InstrumentType[]; motivo: string }>;

export type MetricaDeInstrumento = keyof typeof NO_APLICA;

/**
 * Si esta métrica se enseña para este tipo. Un tipo desconocido se enseña: no saber qué es un
 * instrumento no es motivo para decir que no le aplica, y lo que falte se dirá que falta.
 */
export function seEnsenaLaMetrica(
  metrica: MetricaDeInstrumento,
  tipo: InstrumentType | string | null | undefined
): boolean {
  return !(NO_APLICA[metrica].tipos as readonly string[]).includes(tipo ?? "");
}

/** Por qué no se enseña, para quien lo quiera escribir. Vacío si se enseña. */
export function motivoDeQueNoAplique(
  metrica: MetricaDeInstrumento,
  tipo: InstrumentType | string | null | undefined
): string {
  return seEnsenaLaMetrica(metrica, tipo) ? "" : NO_APLICA[metrica].motivo;
}

/** Las métricas de la lista. Sirve para recorrerla, y a la prueba para no quedarse ciega. */
export const METRICAS_DE_LA_LISTA = Object.keys(NO_APLICA) as MetricaDeInstrumento[];
