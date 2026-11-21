import type { BdbAssetHoldings, InstrumentType } from "../types/bdbAssets";
import { carteraPublicada, type CarteraPublicada } from "./carteraPublicada";
import { esAccion } from "./esAccion";
import { oFalta, peso } from "./formato";
import { holdingKey } from "./holdingsLookthrough";
import { cuentaEnElSolapamiento, esDerivadoPorSuCodigo } from "./lineaDeCartera";
import { textoDeAusencia } from "./textoDeAusencia";

export interface OverlapResult {
  /**
   * `null` si no se puede medir, que no es lo mismo que un 0 %. Es lo común que se ha visto, en puntos del patrimonio: un mínimo,
   * y por encima de 100 no es una parte de la cartera. Se escribe con `cotaDelSolapamiento`, no con un formato de porcentaje.
   */
  overlapPercent: number | null;
  commonTop: Array<{ name: string; weight: number }>;
}

/**
 * Qué se puede decir de una posición en la matriz: `medible` da cifra; `insuficiente` y `sin_cartera`, «N/D»;
 * `no_aplica` es una acción, que no tiene subyacentes y no es un dato que falte; `sintetica` es un ETF que replica su índice con una
 * permuta (swap): su cartera es ese contrato y no las acciones, y no hay títulos que medir. No es que no publique.
 */
export type SituacionDeLaCartera = "medible" | "insuficiente" | "sin_cartera" | "no_aplica" | "sintetica";

/**
 * Si la réplica que da el proveedor (Morningstar, `identificacion.replicacion`: «Synthetic Replication») es sintética. Nunca la del emisor
 * (B-53). Sin dato, `false`: no se afirma nada.
 */
export function esReplicaSintetica(replica: unknown): boolean {
  return typeof replica === "string" && /synthetic|sint[eé]tic/i.test(replica);
}

/** Toda la cartera publicada son líneas de derivado o de permuta, por su código (decisión 9: nunca por el nombre). Sin líneas, `false`. */
export function carteraSoloDeDerivados(cartera: Pick<BdbAssetHoldings, "holdings"> | null | undefined): boolean {
  const lineas = (cartera?.holdings ?? []).filter((linea) => Number.isFinite(linea.weight_pct) && linea.weight_pct !== 0 && (linea.isin?.trim() || linea.name?.trim()));
  return lineas.length > 0 && lineas.every((linea) => esDerivadoPorSuCodigo(linea.holding_type_code));
}

/**
 * Una posición es sintética si su réplica del proveedor lo es y, por la regla de la mitad, no se mediría; o, sin ese dato, si toda su
 * cartera publicada son derivados. No cambia la regla de la mitad ni ninguna cifra de los demás: solo la razón que se da.
 */
export function situacionDeLaCartera(
  tipo: InstrumentType | string | null | undefined,
  cartera: Pick<BdbAssetHoldings, "holdings"> | null | undefined,
  replica?: string | null
): { situacion: SituacionDeLaCartera; publicada: CarteraPublicada | null } {
  if (esAccion(tipo)) return { situacion: "no_aplica", publicada: null };
  const publicada = carteraPublicada(cartera);
  const sintetica = esReplicaSintetica(replica);
  if (!publicada) return { situacion: sintetica ? "sintetica" : "sin_cartera", publicada: null };
  if (carteraSoloDeDerivados(cartera) || (sintetica && !publicada.suficiente)) return { situacion: "sintetica", publicada };
  return { situacion: publicada.suficiente ? "medible" : "insuficiente", publicada };
}

/** Los títulos de un fondo con su peso real: los derivados, sus contrapartidas y el efectivo no entran (decisión 87, `cuentaEnElSolapamiento`). */
function pesosReales(cartera: BdbAssetHoldings): Map<string, { weight: number; name: string }> {
  const positivo = (peso: number) => (Number.isFinite(peso) ? Math.max(0, peso) : 0);
  const pesos = new Map<string, { weight: number; name: string }>();
  for (const h of cartera.holdings) {
    if (!cuentaEnElSolapamiento(h.holding_type_code)) continue;
    const key = holdingKey(h);
    if (!key) continue;
    const weight = positivo(h.weight_pct);
    const existing = pesos.get(key);
    if (existing) {
      existing.weight += weight;
    } else {
      pesos.set(key, { weight, name: h.name });
    }
  }
  return pesos;
}

/**
 * Solapamiento entre dos fondos: Σ_k min(w_ik, w_jk), con el peso real de cada línea positiva y sin reescalar (decisión 47 de
 * Óscar, 05-11-2026). Antes lo recibido se llevaba a 100 %: Seilern, con 10 líneas y un 50 %, salía casi al doble, y PIMCO, con
 * +527 % de largos, se dividía entre 5,27 (con Goldman daba 0,97 % donde sin reescalar da 3,21 %).
 *
 * **Solo títulos** (decisión 87, 05-11-2026): no entran los derivados, sus contrapartidas ni el efectivo, si su código lo dice
 * (`cuentaEnElSolapamiento`). De aquel 3,21 % entre PIMCO y Goldman, 2,64 puntos eran dos futuros sobre deuda. Deja de contar el
 * futuro que dos fondos llevan a la vez, que sí es exposición común: es lo que se aceptó. Una línea sin código sigue contando.
 *
 * **Es un mínimo:** solo suma lo que se ha visto, y se escribe «al menos» (`cotaDelSolapamiento`).
 *
 * **Por encima de 100 no es una parte de la cartera.** Con los derivados dentro lo hacía su nominal: con el mismo fondo en dos clases, la
 * suma era su bruto, y 78 pares de la base nueva pasaban de 100,5. Sin ellos quedan 7, por lo que dice `NOTA_MAS_DE_100`. El número se
 * conserva, porque el par sigue siendo alto, y se escribe «más de 100 %»: un «al menos 347 %» no significa nada.
 *
 * **El mismo fondo son 100 %**, sea lo que sea lo que sumen sus líneas: PIMCO contra sí mismo sumaría 527 y Seilern, 50.
 *
 * **Si a cualquiera de los dos le falta más de la mitad de su cartera, no hay cifra** (`carteraPublicada` dice cómo se
 * sabe). La regla vive aquí para que valga en pantalla y en los dos papeles: quien llame no puede saltársela, y un fondo
 * corto contra sí mismo tampoco da 100 %.
 */
export function calculateOverlap(
  holdingsA: BdbAssetHoldings | null | undefined,
  holdingsB: BdbAssetHoldings | null | undefined
): OverlapResult {
  if (!holdingsA || !holdingsB || !carteraPublicada(holdingsA)?.suficiente || !carteraPublicada(holdingsB)?.suficiente) {
    return { overlapPercent: null, commonTop: [] };
  }

  const mapA = pesosReales(holdingsA);
  const mapB = pesosReales(holdingsB);

  let overlapPercent = 0;
  const commonAssets: Array<{ name: string; weight: number }> = [];

  /* Una línea es común si pesa algo en los dos: una venta en uno de ellos pesa 0 y no lo es. Así «sin comunes» es justo una suma de 0. */
  for (const [key, valA] of mapA.entries()) {
    const valB = mapB.get(key);
    if (valB) {
      const minWeight = Math.min(valA.weight, valB.weight);
      if (!(minWeight > 0)) continue;
      overlapPercent += minWeight;
      commonAssets.push({ name: valA.name, weight: minWeight });
    }
  }

  commonAssets.sort((a, b) => b.weight - a.weight);

  return {
    overlapPercent: holdingsA.asset_id === holdingsB.asset_id ? 100 : overlapPercent,
    commonTop: commonAssets.slice(0, 3)
  };
}

/**
 * Hasta aquí, pasar de 100 es el redondeo del proveedor y no los derivados: de los 761 fondos con cartera de la base nueva, 539 suman
 * entre 99,5 y 100,5. Dos clases de un fondo sin derivados que sumen 100,00001 no pueden decir «más de 100 %».
 */
const TOPE_DEL_REDONDEO = 100.5;

/** Si esta cifra pasa de 100 de verdad, y no por el redondeo: es lo que decide el rótulo y la nota que lo explica (`NOTA_MAS_DE_100`). */
export function pasaDeCien(valor: number | null | undefined): boolean {
  return valor != null && valor > TOPE_DEL_REDONDEO;
}

/** Lo que se escribe de una cifra de solapamiento entre dos fondos, partido para una casilla estrecha. */
export interface CotaDelSolapamiento {
  antes: "al menos" | "más de" | "sin" | "comunes";
  cifra: string;
  /**
   * La segunda línea es una palabra, «comunes», y no una cifra: en papel va al tamaño de la primera, porque al de las cifras no cabe
   * en la casilla (cliente con 15 posiciones, 22,9 pt en 22; interno, 25,6 pt en 21).
   */
  palabra?: true;
}

/** Las décimas enteras de un mínimo, siempre hacia abajo. La coma flotante no se lleva una: 3,2 × 10 no puede quedar en 31,999… */
function decimasHaciaAbajo(valor: number): number {
  return Math.floor(Math.min(valor, 100) * 10 + 1e-9);
}

/** «sin comunes»: ningún título publicado coincide. Lo común es una suma de pesos positivos, así que eso es justo un 0. */
export function sinComunes(valor: number | null | undefined): boolean {
  return valor === 0;
}

/** «comunes < 0,1 %»: alguno coincide, y lo que suman no llega a una décima. */
export function noLlegaAUnaDecima(valor: number | null | undefined): boolean {
  return valor != null && valor > 0 && decimasHaciaAbajo(valor) === 0;
}

/**
 * «al menos 3,2 %» o «más de 100 %». Se redondea siempre hacia abajo: un mínimo redondeado hacia arriba deja de serlo, y 0,6 no es
 * «al menos 1 %» ni 39,97 es «al menos 40,0 %» en un informe que dice que no llega al 40.
 *
 * **Por debajo de una décima** (decisión 88 de Óscar, 05-11-2026), donde antes se leía «al menos 0,0 %»: «sin comunes» si ningún título
 * coincide, y «comunes < 0,1 %» si alguno coincide y no llega. Ninguno de los dos dice que no compartan nada: el mismo emisor con otro
 * ISIN no cruza, y puede faltar hasta la mitad de la cartera (`NOTA_SIN_COMUNES`).
 */
/**
 * El límite de «más de 100 %» no es una cifra medida, es el todo: se escribe entero, como lo cita `NOTA_MAS_DE_100`, con el espacio duro de
 * `formato` para que el «%» no se quede solo al saltar de línea. Las cifras medidas son pesos, con un decimal (`peso`).
 */
const CIEN_POR_CIEN = `100${String.fromCharCode(0xa0)}%`;

export function cotaDelSolapamiento(valor: number): CotaDelSolapamiento {
  if (pasaDeCien(valor)) return { antes: "más de", cifra: CIEN_POR_CIEN };
  if (sinComunes(valor)) return { antes: "sin", cifra: "comunes", palabra: true };
  if (noLlegaAUnaDecima(valor)) return { antes: "comunes", cifra: `< ${oFalta(peso(0.001))}` };
  return { antes: "al menos", cifra: oFalta(peso(decimasHaciaAbajo(valor) / 1000)) };
}

/** Lo mismo, en una línea: «al menos 3,2 %», «más de 100 %», «sin comunes», «comunes < 0,1 %». */
export function textoDelSolapamiento(valor: number): string {
  const { antes, cifra } = cotaDelSolapamiento(valor);
  return `${antes} ${cifra}`;
}

/** Lo que dice una casilla de la matriz: el mismo fondo son 100 %, que no es un mínimo; sin cifra, «Falta», que cabe en la casilla; el resto, en dos líneas. */
export function textoDeLaCasilla(valor: number | null | undefined, mismoFondo: boolean): { texto: string; dosLineas: [string, string] | null } {
  if (valor == null || !Number.isFinite(valor)) return { texto: textoDeAusencia("falta", { estrecha: true }), dosLineas: null };
  if (mismoFondo) return { texto: oFalta(peso(valor / 100)), dosLineas: null };
  const { antes, cifra } = cotaDelSolapamiento(valor);
  return { texto: `${antes} ${cifra}`, dosLineas: [antes, cifra] };
}

/** Lo mismo, dentro de una frase: «comparten al menos el 3,2 %», «comparten más del 100 %», «comparten menos del 0,1 %». */
export function solapamientoEnUnaFrase(valor: number): string {
  const { antes, cifra } = cotaDelSolapamiento(valor);
  if (antes === "más de") return `más del ${cifra}`;
  if (antes === "al menos") return `al menos el ${cifra}`;
  return `menos del ${oFalta(peso(0.001))}`;
}

/**
 * Qué quiere decir «sin comunes», en pantalla y al pie de la matriz del interno. Dice «título» y no «línea», como decía la decisión 88,
 * porque con la 87 una línea de efectivo o un derivado puede coincidir y no contar: con la muestra, Robeco y Goldman comparten dos
 * líneas de divisa, «CANADIAN DOLLAR» y «JAPANESE YEN», y dicen «sin comunes».
 */
export const NOTA_SIN_COMUNES = "Sin comunes: ningún título publicado coincide, por ISIN o por nombre; no prueba que no compartan nada.";

/** Lo mismo en la leyenda de la hoja 6 del informe de cliente, con su forma: «X = …». */
export const LEYENDA_SIN_COMUNES = "Sin comunes = ningún título publicado coincide; no prueba que no compartan nada.";

/**
 * Por qué una casilla puede decir «más de 100 %». Pantalla y papel lo dicen con estas palabras.
 *
 * Ya no es el nominal de los derivados que trae su código, que no cuenta (decisión 87). Medido el 05-11-2026 con este código, pasan de
 * 100,5 en la base nueva 7 pares de 162.735, y son dos clases del mismo fondo que invierte más que su patrimonio: sus títulos suman de
 * 100,7 a 103,7, con el efectivo en negativo (de −0,7 a −3,7 puntos netos) o, en uno, forwards de divisa que netean −1,3. En la base
 * vieja, 38 de 159.330, con líneas sin código: lo sigue haciendo el nominal de unos derivados que el dato no distingue.
 */
export const NOTA_MAS_DE_100 = "«Más de 100 %»: lo común pasa del 100 % porque los dos fondos invierten más que su patrimonio, con efectivo en negativo o con derivados; no es una parte de la cartera.";
