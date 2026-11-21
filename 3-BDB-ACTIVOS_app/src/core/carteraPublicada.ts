import type { BdbAssetHoldings } from "../types/bdbAssets";
import { numero, oFalta, peso } from "./formato";
import { cuentaEnElSolapamiento } from "./lineaDeCartera";

/**
 * Cuánto se ha recibido de verdad de la cartera de un fondo. Es lo que decide si un solapamiento se puede dar
 * (decisión 6 de Óscar, 04-11-2026): sin esto, las 10 mayores posiciones de un ETF, un 27 % del fondo, se
 * reescalaban a 100 % y salía un 99 %.
 *
 * **Se suman las líneas que han llegado, y nada más sirve.** `holdings_count` dice 1.247 en la base nueva con 10
 * líneas recibidas, y `top10_weight` llega a 151,75 con los derivados de PIMCO.
 *
 * **La suma es con su signo.** Una cartera completa con derivados suma 100 neto y bastante más en bruto: PIMCO trae
 * +527 y −427, y Goldman +314 y −214. El bruto no es una parte del fondo, y además dejaría pasar una lista corta con
 * patas de los dos lados: AXA Euro Strategic Bonds trae 10 líneas, +59,6 y −58,5, que son un 1 %. Medido el
 * 05-11-2026 sobre las dos bases: con el neto, todos los fondos con menos de la mitad traen 10 líneas o menos, ninguno
 * con la cartera completa se queda fuera, y de los 761 de la base nueva, 539 suman entre 99,5 y 100,5.
 *
 * **Por encima de 100 no falta nada, pero tampoco es un «más que completo».** Lo hace el nominal de un derivado
 * (Invesco Commodity, 10 líneas, 108,3). Se escribe tal cual, porque es lo que dice el dato, y solo se recorta al
 * sumar lo que se ha visto de la cartera (`pesoVistoDelFondo`).
 */
export const PESO_MINIMO_PUBLICADO_PCT = 50;

export interface CarteraPublicada {
  /** Líneas recibidas, con peso y con algo que las identifique. */
  lineas: number;
  /**
   * De esas, las que son títulos: sin el efectivo, los derivados ni su contrapartida, con la lista del solapamiento
   * (`cuentaEnElSolapamiento`, decisión 87). Una línea sin código cuenta. Es contra lo que se mide la cuenta de posiciones
   * que declara el proveedor (`cuentaQueCuadra`).
   */
  titulos: number;
  /** Suma de sus pesos con su signo, en puntos porcentuales. */
  pesoPct: number;
  /** `false` si falta más de la mitad: exactamente la mitad no es «más de la mitad», y da cifra. */
  suficiente: boolean;
  /**
   * Los pesos de las diez primeras líneas, en el orden en que llegan y en puntos porcentuales. Con ellos el informe interno comprueba el peso
   * de las diez mayores que declara el proveedor, como la ficha con las diez filas que pinta (`diezMayoresQueCuadran`).
   */
  diezPrimeras: number[];
}

/** `null` si no ha llegado ninguna línea con peso: eso no es una cartera corta, es que no hay cartera. */
export function carteraPublicada(cartera: Pick<BdbAssetHoldings, "holdings"> | null | undefined): CarteraPublicada | null {
  let lineas = 0;
  let titulos = 0;
  let suma = 0;
  const diezPrimeras: number[] = [];
  for (const linea of cartera?.holdings ?? []) {
    if (!Number.isFinite(linea.weight_pct) || linea.weight_pct === 0) continue;
    if (!linea.isin?.trim() && !linea.name?.trim()) continue;
    lineas += 1;
    if (cuentaEnElSolapamiento(linea.holding_type_code)) titulos += 1;
    suma += linea.weight_pct;
    if (diezPrimeras.length < 10) diezPrimeras.push(linea.weight_pct);
  }
  if (lineas === 0) return null;
  /* Redondeado para que 16,67 + 16,67 + 16,66 sea 50 y no 49,99999999999999: el umbral no puede depender del orden
     en que se suman los decimales. */
  const pesoPct = Math.round(suma * 1e6) / 1e6;
  return { lineas, titulos, pesoPct, suficiente: pesoPct >= PESO_MINIMO_PUBLICADO_PCT, diezPrimeras };
}

/** La parte del fondo que se ha visto, de 0 a 100: es la que cuenta para decir cuánto de la cartera se ha mirado. */
export function pesoVistoDelFondo(publicada: Pick<CarteraPublicada, "pesoPct">): number {
  return Math.min(100, Math.max(0, publicada.pesoPct));
}

/**
 * «10 líneas · 26,6 % del fondo»: cuántas líneas y qué peso se han mirado, sacado del dato. Lo leen pantalla y papel.
 *
 * **Son líneas, no posiciones** (T12, 06-11-2026): Amundi Global Equity Responsible trae 182 líneas, que son sus 49 acciones y 133 de
 * efectivo, cuentas y contratos de divisa, y el proveedor declara 49 posiciones. Escrito «182 posiciones», el cliente que lo comparase con
 * la ficha del fondo leía una cifra que no es. La palabra es la del informe interno, cuya columna se llama «Líneas».
 */
export function rotuloDeCarteraPublicada(publicada: Pick<CarteraPublicada, "lineas" | "pesoPct">): string {
  return `${numero(publicada.lineas)} ${publicada.lineas === 1 ? "línea" : "líneas"} · ${oFalta(peso(publicada.pesoPct / 100))} del fondo`;
}
