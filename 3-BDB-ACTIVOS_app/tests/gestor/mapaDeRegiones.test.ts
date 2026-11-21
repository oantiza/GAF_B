/**
 * El reparto por región del gestor, en el mapa del informe de cliente (16-11-2026). Cada cifra esperada es el peso de su línea por
 * cien, escrito a mano: el mapa no calcula nada, solo dice qué áreas pinta y con qué color.
 */
import { describe, expect, it } from "vitest";
import { GEO_AREAS } from "../../src/charts/worldMapGeo";
import { ZONAS_DEL_BUSCADOR } from "../../src/core/regionTaxonomy";
import { AREAS_DE_LA_ZONA, regionesEnElMapa } from "../../src/gestor/informes/mapaDeRegiones";
import { COLORES_DE_ZONA, ZONA_SIN_PESO, colorDeLaCifra, rellenoDeLaZona } from "../../src/reports/informeDeCliente/tinta";
import { SIN_CLASIFICAR } from "../../src/reports/plantilla/tema";

const linea = (nombre: string, peso: number) => ({ nombre, valor: peso * 1000, peso });

describe("regionesEnElMapa", () => {
  it("cada zona del gestor tiene áreas del mapa, y entre todas cubren el mapa entero sin repetir ninguna", () => {
    expect(Object.keys(AREAS_DE_LA_ZONA).sort()).toEqual([...ZONAS_DEL_BUSCADOR].sort());
    const areas = Object.values(AREAS_DE_LA_ZONA).flat();
    expect(new Set(areas).size).toBe(areas.length);
    expect([...areas].sort()).toEqual(GEO_AREAS.map((area) => area.id).sort());
  });

  it("la tira de cifras es el reparto en %, en su orden; las zonas de varias áreas las pintan todas", () => {
    const { totales, cifras } = regionesEnElMapa({
      lineas: [linea("Norteamérica", 0.653), linea("Europa", 0.214), linea("Asia y Pacífico", 0.117), linea("Iberoamérica", 0.016)]
    });
    expect(cifras.map((c) => [c.label, Math.round(c.value * 10) / 10])).toEqual([["Norteamérica", 65.3], ["Europa", 21.4], ["Asia y Pacífico", 11.7], ["Iberoamérica", 1.6]]);
    expect(cifras.find((c) => c.label === "Asia y Pacífico")).toMatchObject({ id: "asia", zonas: ["asia", "japan", "oceania"] });
    expect(cifras.find((c) => c.label === "Europa")?.zonas).toBeUndefined();
    /* Pintan las áreas con peso; África y Oriente Medio no tienen. */
    expect(Object.keys(totales).sort()).toEqual(["asia", "europe", "japan", "latin_america", "north_america", "oceania"]);
    expect(rellenoDeLaZona("japan", totales.japan, cifras)).toBe(COLORES_DE_ZONA.asia);
    expect(rellenoDeLaZona("oceania", totales.oceania, cifras)).toBe(COLORES_DE_ZONA.asia);
    expect(rellenoDeLaZona("africa", totales.africa ?? 0, cifras)).toBe(ZONA_SIN_PESO);
  });

  it("«Oriente Medio y África» pinta las dos con un solo color", () => {
    const { totales, cifras } = regionesEnElMapa({ lineas: [linea("Oriente Medio y África", 1)] });
    expect(rellenoDeLaZona("africa", totales.africa, cifras)).toBe(rellenoDeLaZona("middle_east", totales.middle_east, cifras));
    expect(colorDeLaCifra(cifras[0])).toBe(COLORES_DE_ZONA.middle_east);
  });

  it("lo que no tiene zona va en la tira, en gris, y no pinta nada", () => {
    const { totales, cifras } = regionesEnElMapa({ lineas: [linea("Europa", 0.6), linea("Global", 0.3), linea("Sin clasificar", 0.1)] });
    expect(Object.keys(totales)).toEqual(["europe"]);
    expect(cifras.map((c) => [c.label, c.sinZona === true])).toEqual([["Europa", false], ["Global", true], ["Sin clasificar", true]]);
    for (const cifra of cifras.slice(1)) expect(colorDeLaCifra(cifra)).toBe(SIN_CLASIFICAR);
    /* La tira suma lo mismo que el reparto. */
    expect(cifras.reduce((suma, c) => suma + c.value, 0)).toBeCloseTo(100, 10);
  });
});
