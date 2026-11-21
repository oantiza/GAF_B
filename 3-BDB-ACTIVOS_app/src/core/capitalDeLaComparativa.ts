import { importe as importeEscrito, numero, oFalta } from "./formato";
import { pesoEnElPapel } from "./parteMedida";
import { capitalValido } from "./portfolioComparisonReport";
import { textoDeAusencia } from "./textoDeAusencia";

/**
 * Lo que la Comparativa de carteras dice en euros (decisión 42 de Óscar, con el principio de la 5): ningún importe calculado
 * sobre un capital que nadie ha escrito. Hasta aquí imprimía siempre «sobre 100.000 €», también con otro capital fijado, porque
 * el documento no leía el de ninguna de las dos carteras.
 *
 * - **Sin capital en ninguna:** en porcentajes, sin euros. La tabla se queda en base 100, la del gráfico: no es dinero de nadie.
 * - **El mismo en las dos:** esos euros y su diferencia.
 * - **Uno distinto en cada una:** cada una con el suyo, y no se restan: la resta mediría sobre todo la diferencia de capital.
 * - **En una sola:** esa en euros. La otra no toma prestado el capital, como en la Propuesta de cambio.
 * - **Una cartera sin cifra (decisión 59), con su acumulada vacía:** «Falta el dato» en su columna y en la resta, tenga capital o no.
 *
 * El capital de una cartera es el de hoy y aquí se pone al principio del periodo, así que sigue siendo un ejemplo: lo que habría
 * pasado con esa cifra y los pesos de hoy, sin flujos. No es lo que ha ganado nadie, y la nota lo dice.
 */

export interface ImporteDeUnaCartera {
  capital: number;
  resultado: number;
  final: number;
}

export interface CapitalDeLaComparativa {
  a: ImporteDeUnaCartera | null;
  b: ImporteDeUnaCartera | null;
  /** B menos A, en euros. Solo si parten del mismo capital. */
  diferencia: number | null;
}

/** Dos capitales que no se separan ni medio céntimo son el mismo. */
const MEDIO_CENTIMO = 0.005;

const importeDe = (capital: number | null, acumulada: number | null | undefined): ImporteDeUnaCartera | null =>
  capital !== null && typeof acumulada === "number" && Number.isFinite(acumulada)
    ? { capital, resultado: capital * acumulada, final: capital * (1 + acumulada) }
    : null;

/** `acumulada` en decimal: 0,4 es un 40 %. Un capital de 0, negativo o que no es un número no es un capital. */
export function capitalDeLaComparativa(
  capitalA: number | null | undefined,
  capitalB: number | null | undefined,
  acumuladaA: number | null | undefined,
  acumuladaB: number | null | undefined
): CapitalDeLaComparativa {
  const a = importeDe(capitalValido(capitalA), acumuladaA);
  const b = importeDe(capitalValido(capitalB), acumuladaB);
  return { a, b, diferencia: a && b && Math.abs(a.capital - b.capital) < MEDIO_CENTIMO ? b.final - a.final : null };
}

export interface LecturaDelCapital {
  tituloDeLaHoja: string;
  tituloDeLaTabla: string;
  /** Si la tabla va en euros (hay un capital fijado y cifras para calcularlo) y no en base 100. Con euros, el papel la enseña siempre, también con pocos años (CMP-5). */
  enEuros: boolean;
  /** La primera columna de la tabla. Las otras son A, B y B − A. */
  rotulo: string;
  filas: Array<{ cells: string[] }>;
  nota: string;
}

const NO_APLICA = textoDeAusencia("no-aplica");
const FALTA = textoDeAusencia("falta");
const SIN_FIJAR = "Sin fijar";
const LO_QUE_NO_LLEVA = "sin flujos, fiscalidad ni costes adicionales a los ya reflejados en las series.";
const ES_UNA_SIMULACION = `Es una simulación, ${LO_QUE_NO_LLEVA}`;

/** Los puntos de base 100, con su signo: lo único que se imprime sin un capital. Lo que redondea a cero va sin signo. Con dos decimales, como la rentabilidad acumulada que dicen: «+40,35» es un +40,35 %. */
const conSigno = (puntos: number): string => oFalta(numero(puntos, { decimales: 2, conSigno: true }));

/** Un valor de la base 100, con los dos decimales de su resultado. */
const enBase100 = (valor: number): string => oFalta(numero(valor, { decimales: 2 }));

/** Un importe de la tabla o de la nota, con sus céntimos. */
const euros = (cifra: number | null | undefined): string => oFalta(importeEscrito(cifra));

const enEuros = (cifra: number | undefined): string => (cifra === undefined ? SIN_FIJAR : euros(cifra));

function enBaseCien(
  acumuladaA: number | null | undefined,
  acumuladaB: number | null | undefined,
  hayCapital: boolean
): LecturaDelCapital {
  const a = typeof acumuladaA === "number" && Number.isFinite(acumuladaA) ? acumuladaA * 100 : null;
  const b = typeof acumuladaB === "number" && Number.isFinite(acumuladaB) ? acumuladaB * 100 : null;
  const diferencia = a !== null && b !== null ? conSigno(b - a) : FALTA;
  const final = (puntos: number | null) => (puntos === null ? FALTA : enBase100(100 + puntos));
  const inicial = (puntos: number | null) => (puntos === null ? FALTA : enBase100(100));
  const resultado = (puntos: number | null) => (puntos === null ? FALTA : conSigno(puntos));
  const dondeTermina = a !== null && b !== null
    ? `Sobre una base de 100, A termina en ${final(a)} y B en ${final(b)}, ${LO_QUE_NO_LLEVA}`
    : a !== null
      ? `Sobre una base de 100, A termina en ${final(a)}, ${LO_QUE_NO_LLEVA} De B falta el dato.`
      : b !== null
        ? `Sobre una base de 100, B termina en ${final(b)}, ${LO_QUE_NO_LLEVA} De A falta el dato.`
        : "Falta el dato de las dos.";
  return {
    tituloDeLaHoja: "Rentabilidad y evolución",
    tituloDeLaTabla: "Qué representa sobre una base de 100",
    enEuros: false,
    rotulo: "Base 100",
    filas: [
      { cells: ["Valor inicial", inicial(a), inicial(b), a !== null && b !== null ? conSigno(0) : FALTA] },
      { cells: ["Resultado acumulado", resultado(a), resultado(b), diferencia] },
      { cells: ["Valor final", final(a), final(b), diferencia] }
    ],
    nota: `${hayCapital ? "La cartera con capital fijado no da cifras: este documento va en porcentajes, sin importes." : "No se ha fijado un capital: este documento va en porcentajes, sin importes."} ${dondeTermina}`
  };
}

/**
 * Lo que imprime la hoja de la evolución, ya compuesto: el documento no calcula nada. `medido`: el peso que mide la simulación de cada cartera. Sus euros
 * son de esa parte llevada al 100 %, y la nota lo dice al lado de la cifra (decisión 80): la portada y el método no bastan.
 */
export function lecturaDelCapital(
  capitalA: number | null | undefined,
  capitalB: number | null | undefined,
  acumuladaA: number | null | undefined,
  acumuladaB: number | null | undefined,
  medido: { a?: number | null; b?: number | null } = {}
): LecturaDelCapital {
  const lectura = lecturaDeLosImportes(capitalA, capitalB, acumuladaA, acumuladaB);
  const { a, b } = capitalDeLaComparativa(capitalA, capitalB, acumuladaA, acumuladaB);
  const deEsaParte = (clave: string, importe: ImporteDeUnaCartera | null, peso: number | null | undefined) =>
    importe && typeof peso === "number" && peso < 99.99 ? [`${clave} mide el ${pesoEnElPapel(peso)} de su peso: sus euros son de esa parte, llevada al 100 %.`] : [];
  const partes = [...deEsaParte("A", a, medido.a), ...deEsaParte("B", b, medido.b)];
  return partes.length > 0 ? { ...lectura, nota: `${lectura.nota} ${partes.join(" ")}` } : lectura;
}

function lecturaDeLosImportes(
  capitalA: number | null | undefined,
  capitalB: number | null | undefined,
  acumuladaA: number | null | undefined,
  acumuladaB: number | null | undefined
): LecturaDelCapital {
  const { a, b, diferencia } = capitalDeLaComparativa(capitalA, capitalB, acumuladaA, acumuladaB);
  const capitalDeA = capitalValido(capitalA);
  const capitalDeB = capitalValido(capitalB);
  if (!a && !b) return enBaseCien(acumuladaA, acumuladaB, capitalDeA !== null || capitalDeB !== null);
  /* Una cartera con capital y sin cifra: su capital es un dato, y lo que saldría de él es lo que falta. */
  const faltaEnA = !a && capitalDeA !== null;
  const faltaEnB = !b && capitalDeB !== null;
  const resultadoDe = (importe: number | undefined, falta: boolean) => (falta ? FALTA : enEuros(importe));
  const filas = (resta: { inicial: string; cifra: string }) => [
    { cells: ["Capital inicial", faltaEnA ? euros(capitalDeA) : enEuros(a?.capital), faltaEnB ? euros(capitalDeB) : enEuros(b?.capital), resta.inicial] },
    { cells: ["Resultado acumulado", resultadoDe(a?.resultado, faltaEnA), resultadoDe(b?.resultado, faltaEnB), resta.cifra] },
    { cells: ["Capital final", resultadoDe(a?.final, faltaEnA), resultadoDe(b?.final, faltaEnB), resta.cifra] }
  ];
  const tituloDeLaHoja = "Rentabilidad y valor del capital";
  if (a && b && diferencia !== null) {
    return {
      tituloDeLaHoja,
      tituloDeLaTabla: `Qué representa sobre ${euros(a.capital)}`,
      enEuros: true,
      rotulo: "Capital fijado",
      filas: filas({ inicial: euros(0), cifra: euros(diferencia) }),
      nota: `Ejemplo sobre ${euros(a.capital)} iniciales, el capital fijado en las dos carteras: A termina en ${euros(a.final)} y B en ${euros(b.final)}. Diferencia: ${euros(diferencia)}. ${ES_UNA_SIMULACION}`
    };
  }
  const sinResta = filas(faltaEnA || faltaEnB ? { inicial: FALTA, cifra: FALTA } : { inicial: NO_APLICA, cifra: NO_APLICA });
  const comun = { tituloDeLaHoja, tituloDeLaTabla: "Qué representa sobre el capital de cada cartera", enEuros: true, rotulo: "Capital fijado", filas: sinResta };
  if (a && b) {
    return {
      ...comun,
      nota: `Ejemplo con el capital fijado en cada cartera: A parte de ${euros(a.capital)} y termina en ${euros(a.final)}; B parte de ${euros(b.capital)} y termina en ${euros(b.final)}. No se restan, porque parten de capitales distintos. ${ES_UNA_SIMULACION}`
    };
  }
  const [con, sin, importe] = a ? (["A", "B", a] as const) : (["B", "A", b as ImporteDeUnaCartera] as const);
  if (faltaEnA || faltaEnB) {
    return {
      ...comun,
      nota: `Ejemplo con el capital fijado en ${con}: parte de ${euros(importe.capital)} y termina en ${euros(importe.final)}. De ${sin} falta el dato, y no se calcula nada sobre su capital. ${ES_UNA_SIMULACION}`
    };
  }
  return {
    ...comun,
    nota: `Ejemplo con el capital fijado en ${con}, la única que lo tiene: parte de ${euros(importe.capital)} y termina en ${euros(importe.final)}. ${sin} no lo tiene y no toma prestado el de ${con}: va en porcentajes. ${ES_UNA_SIMULACION}`
  };
}
