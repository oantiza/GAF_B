import { createSessionSlot } from "./sessionCaches";

/**
 * Qué dos carteras se están comparando en «Comparar carteras».
 *
 * Con Modo cliente, A y B se eligen antes de entrar y el desplegable solo enseña esas dos (decisión 19
 * de Óscar): las demás carteras guardadas son de otros clientes. Eso exige que la elección no se pierda
 * al cambiar de pantalla o de pestaña, que es lo que hace esta ranura. Vive en memoria y solo guarda
 * los dos identificadores, como el trabajo a medias de Diseño: muere con la sesión.
 */
export interface EleccionDeCarteras {
  a: string;
  b: string;
}

export const eleccionDeCarteras = createSessionSlot<EleccionDeCarteras>(() => ({ a: "", b: "" }));

/**
 * Qué dos composiciones se enseñan en la Propuesta de cambio: una guardada o la activa, a cada lado. Es otra ranura que la de
 * Comparar carteras porque aquí importa cuál es cuál: «Actual» y «Propuesta» no son A y B. La misma regla de Modo cliente: se
 * eligen antes de entrar.
 */
export interface EleccionDeLaPropuesta {
  actual: string;
  propuesta: string;
}

export const eleccionDeLaPropuesta = createSessionSlot<EleccionDeLaPropuesta>(() => ({ actual: "", propuesta: "" }));

/** La cartera abierta en Diseño, que no tiene por qué estar guardada. */
export const CARTERA_ACTIVA = "__cartera-activa__";

/** El periodo de «Comparar carteras». Tampoco cambia al volver de otra pantalla (hallazgo 53). */
export const periodoDeLaComparacion = createSessionSlot<"3Y" | "5Y" | "10Y">(() => "3Y");

/** La pestaña del Comparador en la que se estaba: volver de otra pantalla no la cambia. */
export const pestanaDelComparador = createSessionSlot<"assets" | "portfolios" | "wealth">(() => "assets");

export interface LoQueFaltaEnLaComparacion {
  /** Tiene cifra: su curva y su punto se dibujan. */
  dibujaA: boolean;
  dibujaB: boolean;
  /** Ninguna de las dos la tiene: lo único que queda por comparar es la composición. */
  soloComposicion: boolean;
  /** Qué falta y por qué, para el aviso de arriba. */
  aviso: string | null;
  notaDeLaCurva: string | null;
  notaDelMapa: string | null;
}

/**
 * Lo que enseña Comparar carteras según cuál de las dos tiene cifra (decisión 104). `motivoA` y `motivoB` son por qué no la tiene, o null si la tiene.
 *
 * Por debajo del 80 % del peso medido la tabla decía «Falta» y la curva y el punto del mapa enseñaban justo eso que faltaba, al lado de una cartera
 * entera. Las frases son las del papel (`comparePdf.tsx`), salvo que esto es una pantalla y no un documento: una por debajo no se lleva la curva de la
 * otra, y con las dos se compara la composición.
 */
export function loQueFaltaEnLaComparacion(motivoA: string | null, motivoB: string | null): LoQueFaltaEnLaComparacion {
  if (motivoA === null && motivoB === null) {
    return { dibujaA: true, dibujaB: true, soloComposicion: false, aviso: null, notaDeLaCurva: null, notaDelMapa: null };
  }
  if (motivoA !== null && motivoB !== null) {
    return {
      dibujaA: false,
      dibujaB: false,
      soloComposicion: true,
      aviso: `Falta el dato de las dos. A: ${motivoA} B: ${motivoB} Sin esas cifras no se comparan rentabilidad ni riesgo: aquí se compara su composición.`,
      notaDeLaCurva: null,
      notaDelMapa: null
    };
  }
  const cual = motivoA !== null ? "A" : "B";
  return {
    dibujaA: motivoA === null,
    dibujaB: motivoB === null,
    soloComposicion: false,
    aviso: `Falta el dato de ${cual}. ${motivoA ?? motivoB} Sin esa cifra no se comparan rentabilidad ni riesgo. Las cifras de ${cual === "A" ? "B" : "A"} son de su propio periodo.`,
    notaDeLaCurva: `Falta el dato de ${cual}: su curva no se dibuja.`,
    notaDelMapa: `Mapa: falta el dato de ${cual}, y una cartera sola no se compara con nada.`
  };
}

/** Si la simulación de una cartera no mide ninguna posición, y por qué lo dice el servidor. */
export interface LadoSinMedida {
  sinMedida: boolean;
  motivo?: string;
}

/**
 * Lo que dice el diálogo de la Comparativa de carteras, en Informes, si una de las dos, o las dos, no miden ninguna posición: la frase del informe de
 * cliente (decisión 105), diciendo cuál. El papel es de dos carteras con su simulación, así que no sale, y reintentar no lo arregla; en Comparar
 * carteras el botón ya se apaga y lo dice. `null` si las dos miden algo. El motivo es el del servidor, uno por cartera: si dicen lo mismo, una vez.
 */
export function sinMedidaEnLaComparativa(a: LadoSinMedida, b: LadoSinMedida): { frase: string; motivo?: string } | null {
  if (!a.sinMedida && !b.sinMedida) return null;
  const deQuien = a.sinMedida && b.sinMedida ? "de la cartera A ni de la B" : `de la cartera ${a.sinMedida ? "A" : "B"}`;
  const motivoA = a.sinMedida ? a.motivo : undefined;
  const motivoB = b.sinMedida ? b.motivo : undefined;
  return {
    frase: `No se puede generar este informe: con los datos de hoy, la simulación no mide ninguna posición ${deQuien}.`,
    motivo: motivoA && motivoB && motivoA !== motivoB ? `A: ${motivoA} B: ${motivoB}` : (motivoA ?? motivoB)
  };
}

/** Las carteras que ofrecen los dos desplegables. Las de otros clientes no salen con Modo cliente. */
export function carterasQueSeOfrecen<T extends { portfolio_id: string }>(
  todas: readonly T[],
  eleccion: EleccionDeCarteras,
  seVenLasDemas: boolean
): T[] {
  return seVenLasDemas
    ? [...todas]
    : todas.filter((cartera) => cartera.portfolio_id === eleccion.a || cartera.portfolio_id === eleccion.b);
}
