import { fecha, numero, oFalta } from "./formato";
import { textoDeAusencia } from "./textoDeAusencia";

/**
 * Lo que se negocia de un ETF o una acción, en una línea sin adjetivos e igual para todos (decisión 108 de Óscar, 05-11-2026):
 * «Ámsterdam · unos 56.000 $ al día · 4 de 255 sesiones sin volumen». Sin umbral: juzga el asesor. Lo calcula el extractor
 * (`core/negociacion.py`) y viaja en `declared/quote.trading`. Es el volumen de una sola plaza, y por eso se dice cuál.
 */
export interface LoNegociado {
  exchange: string;
  currency?: string;
  as_of: string;
  sessions: number;
  /** Ausente si el proveedor no da volumen: ACCION IBEX 35 trae las 261 sesiones a cero con el precio moviéndose. */
  sessions_without_volume?: number;
  median_traded_value?: number;
  median_sessions?: number;
}

const SIMBOLO: Readonly<Record<string, string>> = { EUR: "€", USD: "$", GBP: "£" };
/** Espacio duro: la cifra y su unidad no se separan al saltar de línea (regla 4 del formato único). */
const NB = "\u00a0";

/**
 * El redondeo de «unos», uno solo: dos cifras significativas. 56.145 son unos 56.000, 2.829 unos 2.800 y 146.920.812 unos 150 M. Más cifras
 * dirían una precisión que una mediana de un año de una plaza no tiene, y es lo mismo para un valor pequeño que para uno grande.
 */
export function aDosCifras(importe: number): number {
  if (!Number.isFinite(importe) || importe <= 0) return 0;
  const orden = 10 ** (Math.floor(Math.log10(importe)) - 1);
  return Math.round(importe / orden) * orden;
}

/** «56.000 $», «2.800 €», «150 M€», «1,2 M£», «330 M CHF». El millón se escribe como en el patrimonio de la ficha. */
export function importeNegociado(importe: number, divisa: string): string {
  const redondeado = aDosCifras(importe);
  const simbolo = SIMBOLO[divisa];
  if (redondeado >= 1e6) {
    const millones = redondeado / 1e6;
    return `${oFalta(numero(millones, { decimales: Number.isInteger(millones) ? 0 : 1 }))}${NB}M${simbolo ?? `${NB}${divisa}`}`;
  }
  return `${oFalta(numero(redondeado))}${NB}${simbolo ?? divisa}`;
}

export interface LineaDeLoNegociado {
  texto: string;
  /** El proveedor no da volumen, o no hay dato: se pinta como lo que falta. */
  falta: boolean;
  /** De qué periodo es, y lo que hay que saber para leerla. */
  glosa?: string;
}

/** La línea. `nombreDeLaBolsa` es el mismo de la fila «Bolsa» de la ficha: un código que no conozca se enseña tal cual. */
export function lineaDeLoNegociado(dato: LoNegociado | undefined, nombreDeLaBolsa: (codigo: string) => string): LineaDeLoNegociado {
  if (dato === undefined) return { texto: textoDeAusencia("falta"), falta: true };
  const plaza = nombreDeLaBolsa(dato.exchange);
  if (dato.sessions_without_volume === undefined) {
    return { texto: `${plaza} · ${textoDeAusencia("falta")}`, falta: true, glosa: "El proveedor no da volumen de esta cotización." };
  }
  const sesiones = `${oFalta(numero(dato.sessions_without_volume))} de ${oFalta(numero(dato.sessions))} sesiones sin volumen`;
  const importe =
    dato.median_traded_value !== undefined && dato.currency !== undefined
      ? `unos ${importeNegociado(dato.median_traded_value, dato.currency)} al día · `
      : "";
  const conVolumen = dato.sessions - dato.sessions_without_volume;
  const desdoblada = importe !== "" && dato.median_sessions !== undefined && dato.median_sessions < conVolumen;
  const base = `Últimos 12 meses, hasta el ${oFalta(fecha(dato.as_of))}${importe === "" ? "" : ": mediana de volumen por cierre de las sesiones con volumen"}. Solo de esta plaza.`;
  return {
    texto: `${plaza} · ${importe}${sesiones}`,
    falta: false,
    glosa: desdoblada ? `${base} La mediana es de las ${oFalta(numero(dato.median_sessions))} sesiones posteriores a un salto del cierre sin ajustar, como el de un desdoblamiento.` : base
  };
}
