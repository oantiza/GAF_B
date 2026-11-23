import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { oFalta, peso } from "./formato";
import { parteParaLaLectura } from "./portfolio";

export const FILAS_DE_LA_CAJA = ["large", "mid", "small"] as const;
export const COLUMNAS_DE_LA_CAJA = ["value", "blend", "growth"] as const;
export type FilaDeLaCaja = (typeof FILAS_DE_LA_CAJA)[number];
export type ColumnaDeLaCaja = (typeof COLUMNAS_DE_LA_CAJA)[number];
export type CeldaDeLaCaja = `${FilaDeLaCaja}_${ColumnaDeLaCaja}`;

const CELDAS = FILAS_DE_LA_CAJA.flatMap((fila) => COLUMNAS_DE_LA_CAJA.map((columna) => `${fila}_${columna}` as CeldaDeLaCaja));

/** La misma que la plataforma exige a las nueve celdas para escribirlas (`TOLERANCIA_DEL_REPARTO`). */
const TOLERANCIA_DE_LA_SUMA = 0.01;

/** Por debajo de esto una parte no se dice: saldría «0,0 %». Es el mismo corte que el de los repartos de la renta variable. */
const PARTE_MINIMA = 0.05;

export interface CajaDeEstilo {
  /** % de TODA la renta variable de la cartera en cada celda: con `noDeclarada` suman 100. Una celda neta de cortos puede salir negativa. */
  celdas: Record<CeldaDeLaCaja, number>;
  /** % de la renta variable que sale de las nueve celdas de verdad de cada fondo. */
  conCeldas: number;
  /** % que sale del producto de los dos repartos, porque su fondo no trae celdas. */
  aproximada: number;
  /** % que no está en la caja: su fondo no trae celdas ni los dos repartos. */
  noDeclarada: number;
}

/**
 * Las nueve celdas, si son nueve números y suman 1 con la tolerancia de la plataforma. Si no, no se pueden tomar por un reparto.
 * La usan la radiografía, fondo a fondo, y la ficha del fondo (decisión A-123), que lee el bloque `declared/exposure` tal cual.
 */
export function nueveCeldas(caja: Readonly<Record<string, unknown>> | null | undefined): Record<CeldaDeLaCaja, number> | null {
  if (!caja || typeof caja !== "object") return null;
  const valores = CELDAS.map((celda) => caja[celda]);
  if (!valores.every((valor): valor is number => typeof valor === "number" && Number.isFinite(valor))) return null;
  const suma = valores.reduce((total, valor) => total + valor, 0);
  if (Math.abs(suma - 1) > TOLERANCIA_DE_LA_SUMA) return null;
  return Object.fromEntries(CELDAS.map((celda, indice) => [celda, valores[indice]])) as Record<CeldaDeLaCaja, number>;
}

/** El tramo de color de una casilla: 0, nada que pintar; de 1 a 4, los cuatro tramos de peso. */
export type TramoDeLaCaja = 0 | 1 | 2 | 3 | 4;

/**
 * El tramo de color de una casilla, por la parte de la renta variable que hay en ella (fracción, no %): 0, nada que
 * pintar —lo que se escribiría «0,0 %», o una celda neta de cortos—; 1, menos del 10 %; 2, del 10 al 25 %; 3, del 25 al
 * 50 %; 4, desde el 50 %. Son los cuatro tramos con los que el sector sombrea la caja de estilo.
 *
 * Son absolutos a propósito (14-11-2026): el mismo color dice lo mismo en dos fondos, y en la cartera. Antes la
 * radiografía medía cada casilla contra la mayor, y un fondo repartido por igual salía oscuro en todas partes. La usan
 * la ficha, la radiografía y la ficha en papel.
 */
export function tramoDeLaCaja(fraccion: number): TramoDeLaCaja {
  if (!(fraccion >= PARTE_MINIMA / 100)) return 0;
  if (fraccion < 0.1) return 1;
  if (fraccion < 0.25) return 2;
  if (fraccion < 0.5) return 3;
  return 4;
}

/** Las nueve celdas de un fondo de la cartera. */
const celdasDelFondo = (asset: BdbAssetDetail) => nueveCeldas(asset.exposure_detail?.equity_style_box);

/** Un reparto suelto, en fracciones de lo que declara. Sin nada positivo en esas claves, no hay reparto. */
function repartoDelFondo<K extends string>(reparto: Record<string, number> | undefined, claves: readonly K[]): Record<K, number> | null {
  if (!reparto) return null;
  const positivo = (clave: K) => Math.max(0, reparto[clave] || 0);
  const suma = claves.reduce((total, clave) => total + positivo(clave), 0);
  if (suma <= 0) return null;
  return Object.fromEntries(claves.map((clave) => [clave, positivo(clave) / suma])) as Record<K, number>;
}

/**
 * La caja de estilo y tamaño de la cartera (decisión 51), en % de toda su renta variable y fondo a fondo:
 *
 *  - el fondo que trae las nueve celdas suma esas celdas, ponderadas por su renta variable;
 *  - el que no las trae pero sí los dos repartos suma el producto de los dos, y esa parte es una aproximación:
 *    trata estilo y tamaño como independientes, y en un fondo no lo son;
 *  - el que no trae ni eso se queda en `noDeclarada`. No se deduce de su nombre.
 *
 * El peso en renta variable es el canónico (`assetPmsShares`), el mismo de los repartos de al lado, y un fondo sin reparto de
 * activos no entra (A-211). Devuelve `null` si la cartera no tiene renta variable medida, que no es lo mismo que no
 * declararla: si hay un fondo sin reparto, lo dice la pantalla (`pesoSinReparto`).
 */
export function cajaDeEstilo(
  positions: readonly BdbManualPortfolioPosition[],
  assets: readonly BdbAssetDetail[]
): CajaDeEstilo | null {
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const acumulado = Object.fromEntries(CELDAS.map((celda) => [celda, 0])) as Record<CeldaDeLaCaja, number>;
  let rentaVariable = 0;
  let conCeldas = 0;
  let aproximada = 0;
  for (const position of positions) {
    const weight = position.weight_percent || 0;
    const asset = byId.get(position.asset_id);
    if (weight <= 0 || !asset) continue;
    /* A-211: un fondo sin reparto de activos no entra: no se sabe qué parte es renta variable. */
    const peso = weight * (parteParaLaLectura(asset, "equity") ?? 0);
    if (peso <= 0) continue;
    rentaVariable += peso;
    const celdas = celdasDelFondo(asset);
    if (celdas) {
      for (const celda of CELDAS) acumulado[celda] += peso * celdas[celda];
      conCeldas += peso;
      continue;
    }
    const estilo = repartoDelFondo(asset.exposure_detail?.equity_styles, COLUMNAS_DE_LA_CAJA);
    const tamano = repartoDelFondo(asset.exposure_detail?.market_caps, FILAS_DE_LA_CAJA);
    if (!estilo || !tamano) continue;
    for (const fila of FILAS_DE_LA_CAJA) {
      for (const columna of COLUMNAS_DE_LA_CAJA) acumulado[`${fila}_${columna}`] += peso * tamano[fila] * estilo[columna];
    }
    aproximada += peso;
  }
  if (rentaVariable <= 0) return null;
  const enPorcentaje = (valor: number) => (valor / rentaVariable) * 100;
  return {
    celdas: Object.fromEntries(CELDAS.map((celda) => [celda, enPorcentaje(acumulado[celda])])) as Record<CeldaDeLaCaja, number>,
    conCeldas: enPorcentaje(conCeldas),
    aproximada: enPorcentaje(aproximada),
    noDeclarada: Math.max(0, enPorcentaje(rentaVariable - conCeldas - aproximada))
  };
}

export const NOTA_DE_APROXIMACION = "Aproximación: producto de los dos repartos";
export const NOTA_DE_CORTOS = "Celdas netas de cortos: alguna sale en negativo";

export interface NotasDeLaCaja {
  aproximacion: string | null;
  cortos: string | null;
  /** La parte de la renta variable que no está en la caja, si hay que decirla. La escribe la pantalla, con las de al lado. */
  noDeclarada: number | null;
}

/** Si hay algo que dibujar. Si no, saldría una cuadrícula en blanco, y lo que hay que decir es lo que falta. */
export const hayAlgoQueDibujar = (caja: CajaDeEstilo): boolean => caja.conCeldas + caja.aproximada > PARTE_MINIMA;

/**
 * Lo que la caja tiene que decir de sí misma. La nota de la aproximación lleva la parte a la que afecta solo si
 * es parcial: si no hay ninguna celda de verdad, lo es todo lo que se ve y no hay nada que acotar.
 */
export function notasDeLaCaja(caja: CajaDeEstilo | null): NotasDeLaCaja {
  if (!caja) return { aproximacion: null, cortos: null, noDeclarada: null };
  if (!hayAlgoQueDibujar(caja)) return { aproximacion: null, cortos: null, noDeclarada: caja.noDeclarada };
  const aproximacion =
    caja.aproximada <= PARTE_MINIMA
      ? null
      : caja.conCeldas <= PARTE_MINIMA
        ? NOTA_DE_APROXIMACION
        : `${NOTA_DE_APROXIMACION}, en el ${oFalta(peso(caja.aproximada / 100))} de la renta variable`;
  return {
    aproximacion,
    cortos: Object.values(caja.celdas).some((valor) => valor <= -PARTE_MINIMA) ? NOTA_DE_CORTOS : null,
    noDeclarada: caja.noDeclarada > PARTE_MINIMA ? caja.noDeclarada : null
  };
}
