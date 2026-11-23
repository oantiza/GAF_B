import type { BdbManualPortfolioSummary, BdbPortfolioAllocationBucket, BdbPortfolioReport } from "../types/bdbAssets";
import { esAccion } from "./esAccion";
import { CATEGORIA_DE_UNA_ACCION, NO_DECLARADO } from "./etiquetasDeReparto";
import { pesoEnElPapel } from "./parteMedida";
import { repartoDeLaCartera } from "./radiografiaDeLaCartera";

/**
 * Lo que dice el papel de lo que no entra en un reparto (decisión 85 de Óscar, 05-11-2026): un reparto se da en % de toda la
 * cartera y suma 100, y lo que no entra va en su propia fila, con su nombre, y no se reparte entre los demás. Es lo que ya hace la
 * pantalla, y con la misma lectura (`repartoDeLaCartera`). Sectores y regiones siguen en % de la renta variable, como en pantalla.
 *
 * La fila se llama «Fuera del reparto» y no «No invertible»: de lo que se queda fuera hay acciones que cotizan (decisión 75) y clases
 * cerradas que siguen existiendo para quien las tiene. Una cartera en la que entra todo no cambia ni una cifra: `parteInvertible` es 1.
 */
export const FUERA_DEL_REPARTO = "Fuera del reparto";
/** Una posición que la fuente no conoce. No tiene ficha, y por eso no tiene nada más que decir de ella que su identificador. */
export const FUERA_DEL_CATALOGO = "Fuera del catálogo";

export interface PosicionFueraDelReparto {
  assetId: string;
  nombre: string;
  /** Su peso, en % de lo que suman las posiciones de la cartera. */
  pesoPct: number;
}

export interface FueraDelRepartoEnElPapel {
  /** De 0 a 1: lo que entra. `xray.pms_exposure_percent` suma 100 de lo invertible, y se lleva a toda la cartera con esto. */
  parteInvertible: number;
  posiciones: PosicionFueraDelReparto[];
  /** En la escala de `by_*`, que son los pesos tal cual: lo que falta para llegar a lo que suma la cartera. */
  peso: number;
  /** En % de lo que suman las posiciones. */
  pesoPct: number;
}

/** Las posiciones que no están en el catálogo, con el nombre con que se guardaron. Solo las conoce el resumen, y solo si hay. */
export function posicionesFueraDelCatalogo(resumen: Pick<BdbManualPortfolioSummary, "not_found_positions"> | null | undefined) {
  return resumen?.not_found_positions ?? [];
}

/** Lo que se queda fuera de los repartos de este informe. Nada, casi siempre. */
export function fueraDelRepartoDelInforme(report: Pick<BdbPortfolioReport, "summary" | "positions">): FueraDelRepartoEnElPapel {
  const { fuera, parteInvertible } = repartoDeLaCartera(report.summary);
  const peso = fuera.reduce((suma, parte) => suma + parte.peso, 0);
  if (peso <= 0) return { parteInvertible: 1, posiciones: [], peso: 0, pesoPct: 0 };
  const total = report.summary.total_weight_percent;
  const posiciones = [
    ...(report.positions ?? [])
      .filter((posicion) => !posicion.is_investable && posicion.weight_percent > 0)
      .map((posicion) => ({ assetId: posicion.asset_id, nombre: posicion.display_name, pesoPct: (posicion.weight_percent / total) * 100 })),
    ...posicionesFueraDelCatalogo(report.summary).map((posicion) => ({
      assetId: posicion.asset_id,
      nombre: posicion.label || posicion.asset_id,
      pesoPct: (posicion.weight_percent / total) * 100
    }))
  ].sort((a, b) => b.pesoPct - a.pesoPct);
  return { parteInvertible, posiciones, peso, pesoPct: (peso / total) * 100 };
}

/** Las filas de un reparto en la escala de los pesos, con la de lo que no entra al final. Sin nada fuera, las mismas filas. */
export function conLaFilaDeFuera(filas: readonly BdbPortfolioAllocationBucket[], fuera: Pick<FueraDelRepartoEnElPapel, "peso">): BdbPortfolioAllocationBucket[] {
  return fuera.peso > 0 ? [...filas, { key: FUERA_DEL_REPARTO, weight_percent: fuera.peso }] : [...filas];
}

/** Con tres nombres cabe en la hoja: es el mismo tope que la frase de `parteMedida`. */
const NOMBRES_QUE_CABEN = 3;

/**
 * «Fuera del reparto: CAM, CUOTAS PARTICIPATIVAS, 10,0 % de la cartera.» Null si entra todo. Con más de tres posiciones cuenta cuántas
 * son y dice dónde se detallan, porque la hoja que la lleva no se estira.
 */
export function fraseDeLoQueNoEntra(fuera: FueraDelRepartoEnElPapel, dondeSeDetallan = "detalladas en el anexo"): string | null {
  const { posiciones } = fuera;
  if (fuera.pesoPct <= 0) return null;
  const total = `${pesoEnElPapel(fuera.pesoPct)} de la cartera`;
  if (posiciones.length === 0) return `${FUERA_DEL_REPARTO}: ${total}.`;
  if (posiciones.length === 1) return `${FUERA_DEL_REPARTO}: ${posiciones[0].nombre}, ${total}.`;
  if (posiciones.length > NOMBRES_QUE_CABEN) return `${FUERA_DEL_REPARTO}: ${posiciones.length} posiciones, ${total}, ${dondeSeDetallan}.`;
  const nombres = posiciones.map((posicion) => `${posicion.nombre} (${pesoEnElPapel(posicion.pesoPct)})`);
  return `${FUERA_DEL_REPARTO}: ${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}, ${total}.`;
}

/**
 * «Sin reparto declarado: Fondo X, 7,0 % de la cartera; no cuenta en la composición global.» (A-203, Óscar, 21-11-2026). Un fondo que
 * no declara su reparto de activos ya no se reparte por su clase, y las cifras de la composición global suman menos de 100: esta
 * frase dice por qué. Null si no hay ninguno. Los pesos del análisis son de lo invertible; `parteInvertible` los lleva a la cartera.
 */
export function fraseDeLoQueNoTieneRepartoEnElPapel(report: Pick<BdbPortfolioReport, "xray">, parteInvertible: number): string | null {
  const posiciones = report.xray?.pms_exposure_sin_reparto ?? [];
  const pesoPct = (report.xray?.pms_exposure_sin_reparto_percent ?? 0) * parteInvertible;
  if (posiciones.length === 0 || pesoPct <= 0) return null;
  const total = `${pesoEnElPapel(pesoPct)} de la cartera`;
  const cola = "no cuenta en la composición global.";
  if (posiciones.length > NOMBRES_QUE_CABEN) return `Sin reparto declarado: ${posiciones.length} posiciones, ${total}; ${cola}`;
  if (posiciones.length === 1) return `Sin reparto declarado: ${posiciones[0].display_name}, ${total}; ${cola}`;
  const nombres = posiciones.map((posicion) => `${posicion.display_name} (${pesoEnElPapel(posicion.weight_percent * parteInvertible)})`);
  return `Sin reparto declarado: ${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}, ${total}; ${cola}`;
}

/**
 * «Falta el dato: el 40,0 % de la cartera no declara su reparto de activos, y no se sabe qué parte es renta variable; no entra en este
 * reparto.» (A-211, que llega al papel con el sí de Óscar del 21-11-2026). La frase de la pantalla (`fraseDelSinRepartoEnLaLectura`),
 * cerrada para el papel: bajo las regiones y los sectores de la renta variable, que ya no pesan por su clase un fondo sin reparto.
 * `pesoPct`, en % de la cartera; `deQuien`, «de la cartera» o «de A» en la comparativa. Null si no hay nada que decir.
 */
export function fraseDelSinRepartoEnElPapel(pesoPct: number, deQuien = "de la cartera"): string | null {
  if (!(pesoPct >= 0.05)) return null;
  return `Falta el dato: el ${pesoEnElPapel(pesoPct)} ${deQuien} no declara su reparto de activos, y no se sabe qué parte es renta variable; no entra en este reparto.`;
}

/**
 * La categoría de un reparto: una fila que suma todas las acciones se llama «Acciones», no «Acción» (decisión 83), traiga «accion» como la
 * base vieja o nada como la nueva. Lo que no es de eso, tal cual.
 */
export const CATEGORIA_DE_LAS_ACCIONES = CATEGORIA_DE_UNA_ACCION;
export function categoriaDeUnReparto(categoria: string): string {
  return /^acci[oó]n$/i.test(categoria.trim()) ? CATEGORIA_DE_LAS_ACCIONES : categoria;
}

/** Una fila de un reparto que no dice nada: lo que no consta, se llame como se llame en el dato. */
export function esFilaSinDato(clave: string): boolean {
  const normalizada = clave
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^a-z0-9]+/g, "");
  return !normalizada || ["nd", "na", "unknown", "unclassified", "sinclasificar", "nodisponible"].includes(normalizada);
}

/**
 * El reparto por categoría del papel. Una acción no tiene categoría de fondo, y la base nueva no le pone ninguna (305 de 305): no es que no la
 * declare, y no se llama «No declarado» (decisiones 66 y 83). Lo que no consta de un fondo, sí. Si no se separan, «N/D» o «Sin clasificar» dirían
 * que le falta a la acción lo que nunca tendrá.
 */
export function filasPorCategoria(report: Pick<BdbPortfolioReport, "positions" | "xray">): BdbPortfolioAllocationBucket[] {
  const filas = Array.isArray(report.xray?.by_category) ? report.xray.by_category : [];
  const sinDato = filas.filter((fila) => esFilaSinDato(fila.key)).reduce((suma, fila) => suma + Math.max(0, fila.weight_percent), 0);
  /* Solo las que el reparto cuenta: lo que no entra va en su propia fila. */
  const acciones = (report.positions ?? [])
    .filter((posicion) => posicion.is_investable && esAccion(posicion.instrument_type) && esFilaSinDato(posicion.category ?? ""))
    .reduce((suma, posicion) => suma + Math.max(0, posicion.weight_percent), 0);
  const noDeclarado = sinDato - acciones;
  return [
    ...filas.filter((fila) => !esFilaSinDato(fila.key) && fila.weight_percent > 0.001).map((fila) => ({ ...fila, key: categoriaDeUnReparto(fila.key) })),
    ...(acciones > 0.05 ? [{ key: CATEGORIA_DE_LAS_ACCIONES, weight_percent: acciones }] : []),
    ...(noDeclarado > 0.05 ? [{ key: NO_DECLARADO, weight_percent: noDeclarado }] : [])
  ];
}
