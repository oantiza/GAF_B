/**
 * El reparto por región del gestor de carteras, en el mapa del mundo del informe de cliente (`MapaDelMundo`).
 *
 * El gestor reparte la renta variable en las cinco zonas grandes del Buscador (`ZONAS_DEL_BUSCADOR`), y el mapa tiene ocho
 * áreas. Tres zonas son un área cada una; «Asia y Pacífico» son tres (Asia, Japón y Oceanía) y «Oriente Medio y África», dos.
 * No se sabe cuánto va a cada área de una zona, así que no se reparte: se pintan todas las de la zona con su color, y la cifra de
 * debajo es la de la zona entera. Lo que no tiene zona («Sin clasificar», o un nombre que el mapa no conoce) va en la tira de
 * cifras, en gris, sin pintar nada.
 *
 * Es puro: recibe el reparto y devuelve lo que el mapa dibuja. No calcula ninguna cifra: cada una es el peso de su línea.
 */
import type { GeoAreaId } from "../../charts/worldMapGeo";
import type { CifraDelMapa } from "../../core/repartoDelInforme";
import type { ZonaDelBuscador } from "../../core/regionTaxonomy";
import type { Reparto } from "../motor/composicion";

/** Las áreas del mapa de cada zona del gestor. La primera da el color. */
export const AREAS_DE_LA_ZONA: Readonly<Record<ZonaDelBuscador, readonly GeoAreaId[]>> = {
  Europa: ["europe"],
  "Norteamérica": ["north_america"],
  "Iberoamérica": ["latin_america"],
  "Asia y Pacífico": ["asia", "japan", "oceania"],
  "Oriente Medio y África": ["middle_east", "africa"]
};

const areasDe = (nombre: string): readonly GeoAreaId[] | undefined => (AREAS_DE_LA_ZONA as Readonly<Record<string, readonly GeoAreaId[]>>)[nombre];

export interface RegionesEnElMapa {
  /** Peso (en %) que pinta cada área: el de su zona. Solo dice qué áreas llevan color; la cifra es la de la tira. */
  totales: Record<string, number>;
  /** La tira de cifras, en el orden del reparto (de más a menos peso, «Sin clasificar» al final), en %. */
  cifras: CifraDelMapa[];
}

export function regionesEnElMapa(reparto: Pick<Reparto, "lineas">): RegionesEnElMapa {
  const totales: Record<string, number> = {};
  const cifras = reparto.lineas.map((linea, i): CifraDelMapa => {
    const value = linea.peso * 100;
    const areas = areasDe(linea.nombre);
    if (!areas) return { id: `sin-zona-${i}`, label: linea.nombre, value, sinZona: true };
    for (const area of areas) totales[area] = (totales[area] ?? 0) + value;
    return { id: areas[0], label: linea.nombre, value, ...(areas.length > 1 ? { zonas: areas } : {}) };
  });
  return { totales, cifras };
}
