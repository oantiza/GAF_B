/**
 * Los colores con relleno del informe de cliente, los del papel de antes (commit 8da9cb9d), recuperados el 14-11-2026 por decisión
 * de Óscar:
 *  - el mapa del mundo, con un color por zona (`COLORES_DE_ZONA`): cada zona se pinta con el color de su cifra de debajo, y la
 *    tira de cifras lleva el mismo color en su filete. El color identifica la zona; la cifra va siempre escrita;
 *  - la matriz de solapamiento, con la rampa de bronce del tema de cliente (`RAMPA_DEL_TEMA.cliente`), con la cifra impresa en
 *    cada casilla: el tono no es la única señal.
 * Todos los colores de zona dan al menos 3:1 sobre blanco (son rellenos). Es puro: no importa @react-pdf.
 */
import type { CifraDelMapa } from "../../core/repartoDelInforme";
import { BLANCO_DESDE_EL_PASO, COLORES_DE_DATOS, PAPEL, RAMPA_DEL_TEMA, SIN_CLASIFICAR } from "../plantilla/tema";

/** Mezcla dos colores «#rrggbb»: `t` = 0 da `a`, `t` = 1 da `b`. */
export function mezcla(a: string, b: string, t: number): string {
  const canal = (color: string, i: number) => parseInt(color.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(canal(a, i) * (1 - t) + canal(b, i) * t).toString(16).padStart(2, "0"))
    .join("")}`;
}

/* ------------------------------------------------------------------------------------------------ La matriz */

/** Los siete tonos de la matriz de solapamiento, uno por paso de `pasoDeLaMatriz`: del crema del papel al bronce hondo. */
export const RAMPA_DE_LA_MATRIZ: readonly string[] = RAMPA_DEL_TEMA.cliente;

export { BLANCO_DESDE_EL_PASO };

/** La tinta de la cifra sobre un paso de la matriz. */
export const tintaSobreElPaso = (paso: number) => (paso >= BLANCO_DESDE_EL_PASO ? PAPEL.blanco : PAPEL.tinta);

/* ------------------------------------------------------------------------------------------------ El mapa */

/** El color de cada zona del mapa, los del informe de antes (`GEO_AREA_COLORS`). */
export const COLORES_DE_ZONA: Readonly<Record<string, string>> = {
  north_america: "#2F6B8A",
  latin_america: "#2D8C74",
  europe: "#A81E33",
  africa: "#C27B2D",
  middle_east: "#7A5C7E",
  asia: "#B58A2A",
  japan: "#E05A47",
  oceania: "#3D8C9E"
};

/** «Resto de zonas»: lo que no cabe en las cinco cifras de debajo del mapa. */
export const COLOR_DEL_RESTO = COLORES_DE_DATOS.acero;

/** Una zona sin peso: el gris claro de siempre. */
export const ZONA_SIN_PESO = "#E9EDF2";

/** El color de una cifra de debajo del mapa: el de su zona; «Resto de zonas», acero; lo que no tiene zona, gris. */
export function colorDeLaCifra(cifra: Pick<CifraDelMapa, "id" | "sinZona">): string {
  if (cifra.sinZona) return SIN_CLASIFICAR;
  if (cifra.id === "resto") return COLOR_DEL_RESTO;
  return COLORES_DE_ZONA[cifra.id] ?? COLOR_DEL_RESTO;
}

/**
 * El relleno de una zona del mapa: el color de su cifra de debajo. Una zona que se suma en «Resto de zonas» se pinta con el color del
 * resto: con el suyo, que no sale en la tira, el cliente vería colores sin explicar. Sin peso, el gris claro.
 */
export function rellenoDeLaZona(id: string, peso: number, cifras: ReadonlyArray<Pick<CifraDelMapa, "id" | "sinZona" | "zonas">>): string {
  if (!(peso > 0)) return ZONA_SIN_PESO;
  /* Una cifra que agrupa varias zonas (`zonas`) las pinta todas con su color. */
  const suya = cifras.find((cifra) => (cifra.zonas ? cifra.zonas.includes(id) : cifra.id === id));
  if (suya) return colorDeLaCifra(suya);
  return cifras.some((cifra) => cifra.id === "resto") ? COLOR_DEL_RESTO : COLORES_DE_ZONA[id] ?? COLOR_DEL_RESTO;
}
