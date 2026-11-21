import { expect, test } from "vitest";
import { buildReportGeography, cifrasDelMapa, COLORES_DE_ZONA, colorDeLaCifra, rellenoDeLaZona, ZONA_SIN_PESO } from "../src/reports/informeDeClientePdf";

test("Iberia is counted once in the geographic distribution", () => {
  const result = buildReportGeography([
    { key: "eurozone", weight_percent: 64.9 },
    { key: "Iberia", weight_percent: 35.1 }
  ], true);
  expect(result.totals.europe).toBeCloseTo(100);
  expect(result.unassigned).toBe(0);
});

test("unmapped regions and missing equity coverage remain visible", () => {
  const result = buildReportGeography([
    { key: "eurozone", weight_percent: 60 },
    { key: "unknown", weight_percent: 20 }
  ], true);
  expect(result.totals.europe).toBe(60);
  expect(result.unassigned).toBe(40);
  expect(Object.values(result.totals).reduce((sum, value) => sum + value, result.unassigned)).toBe(100);
  /* «unknown» no nombra nada: es lo mismo que lo que no llega. */
  expect(result.noDeclarado).toBe(40);
  expect(result.sinSituar).toBe(0);
});

const zona = (id: string, value: number) => ({ id, label: id, value, color: "#000" });

test("las cifras bajo el mapa suman lo mismo que la renta variable (decisión 7)", () => {
  /* La forma nueva puede llenar las ocho zonas del mapa, y solo caben cinco cifras. */
  const ocho = [zona("na", 64), zona("eu", 15), zona("asia", 9), zona("jp", 4), zona("oc", 3), zona("la", 2), zona("me", 2), zona("af", 1)];
  const cifras = cifrasDelMapa(ocho, 0);
  expect(cifras.map((c) => c.id)).toEqual(["na", "eu", "asia", "jp", "resto"]);
  expect(cifras[4].value).toBe(8);
  expect(cifras.reduce((suma, c) => suma + c.value, 0)).toBe(100);
});

test("con cinco zonas salen las cinco, sin «Resto»: la forma antigua de la muestra", () => {
  const cinco = [zona("na", 63.9), zona("asia", 18.5), zona("eu", 15.2), zona("la", 1.6), zona("me", 0.8)];
  expect(cifrasDelMapa(cinco, 0).map((c) => c.id)).toEqual(["na", "asia", "eu", "la", "me"]);
});

/*
 * Puertas finales del 06-11, papel-1: ningún color del mapa puede quedarse sin explicar. Cada zona tiene su color y las del resto toman el de
 * «Resto de zonas». Desde el paso 9 del rediseño el mapa fue en una sola tinta índigo, por tramos de peso; el 14-11-2026 Óscar pidió recuperar
 * el aspecto de los informes de antes, y el mapa vuelve a un color por zona. Las cifras de debajo siguen sumando lo mismo, con el resto a mano.
 */
const ZONAS_DE_LA_MUESTRA = ([["north_america", 64.8], ["europe", 14.6], ["asia", 13.9], ["japan", 3.5], ["latin_america", 1.5], ["oceania", 0.65], ["middle_east", 0.55], ["africa", 0.4]] as const)
  .map(([id, value]) => ({ id, label: id, value }));

test("cada zona se pinta con el color de su cifra, y las que van en «Resto» con el del resto; las cifras suman con el resto (papel-1)", () => {
  const cifras = cifrasDelMapa(ZONAS_DE_LA_MUESTRA, 0);
  /* 1,5 + 0,65 + 0,55 + 0,4 = 3,1. */
  expect(cifras.map((c) => [c.id, Math.round(c.value * 10) / 10])).toEqual([["north_america", 64.8], ["europe", 14.6], ["asia", 13.9], ["japan", 3.5], ["resto", 3.1]]);
  const relleno = Object.fromEntries(ZONAS_DE_LA_MUESTRA.map((zona) => [zona.id, rellenoDeLaZona(zona.id, zona.value, cifras)]));
  const resto = colorDeLaCifra({ id: "resto" });
  expect(relleno).toEqual({
    north_america: COLORES_DE_ZONA.north_america,
    europe: COLORES_DE_ZONA.europe,
    asia: COLORES_DE_ZONA.asia,
    japan: COLORES_DE_ZONA.japan,
    latin_america: resto,
    oceania: resto,
    middle_east: resto,
    africa: resto
  });
  /* Ningún color del mapa se queda sin su cifra en la tira (y en la leyenda, que nombra las mismas). */
  const deLaTira = cifras.map(colorDeLaCifra);
  for (const color of Object.values(relleno)) expect(deLaTira).toContain(color);
  /* Una zona sin peso, en el gris claro. */
  expect(rellenoDeLaZona("africa", 0, cifras)).toBe(ZONA_SIN_PESO);
});

test("con cinco zonas no hay resto; con «No declarado» caben cuatro y la quinta pasa al resto (papel-1)", () => {
  const cinco = ZONAS_DE_LA_MUESTRA.slice(0, 5);
  expect(cifrasDelMapa(cinco, 0).map((c) => c.id)).not.toContain("resto");
  const conNoDeclarado = cifrasDelMapa(cinco, 10);
  expect(conNoDeclarado.map((c) => c.id)).toEqual(["north_america", "europe", "asia", "resto", "unassigned"]);
  /* Lo que no tiene zona no es una zona del mapa: no se pinta, y lo dice su cifra. */
  expect(conNoDeclarado.find((c) => c.id === "unassigned")?.sinZona).toBe(true);
});

test("lo que el dato nombra y el mapa no sabe situar no es lo que no se declara (decisión 66)", () => {
  /* Un fondo de la base vieja da sus regiones por país: lo declara, y «vietnam» no está en ninguna zona del mapa. */
  const result = buildReportGeography([
    { key: "eurozone", weight_percent: 70 },
    { key: "vietnam", weight_percent: 10 }
  ], true);
  expect(result.sinSituar).toBe(10);
  expect(result.noDeclarado).toBe(20);
  expect(result.unassigned).toBe(30);
  const cifras = cifrasDelMapa([zona("eu", 70)], result.noDeclarado, result.sinSituar);
  expect(cifras.map((c) => [c.label, c.value])).toEqual([["eu", 70], ["No declarado", 20], ["Sin situar", 10]]);
  expect(cifras.reduce((suma, c) => suma + c.value, 0)).toBe(100);
  /* Sin nada de eso, ninguna de las dos filas. */
  expect(cifrasDelMapa([zona("eu", 100)], 0, 0).map((c) => c.label)).toEqual(["eu"]);
});

test("las dos filas quitan sitio a las zonas, y la suma sigue dando 100", () => {
  const cinco = [zona("na", 40), zona("asia", 15), zona("eu", 13), zona("la", 1), zona("me", 1)];
  const cifras = cifrasDelMapa(cinco, 20, 10);
  expect(cifras).toHaveLength(5);
  expect(cifras.map((c) => c.label)).toEqual(["na", "asia", "Resto de zonas", "No declarado", "Sin situar"]);
  expect(cifras.reduce((suma, c) => suma + c.value, 0)).toBe(100);
});

test("«No declarado» solo sale si queda algo sin zona, y no se come a Oriente Medio sin decirlo", () => {
  const cinco = [zona("na", 60), zona("asia", 15), zona("eu", 13), zona("la", 1), zona("me", 1)];
  const cifras = cifrasDelMapa(cinco, 10);
  expect(cifras.map((c) => c.id)).toEqual(["na", "asia", "eu", "resto", "unassigned"]);
  expect(cifras[4].label).toBe("No declarado");
  expect(cifras.reduce((suma, c) => suma + c.value, 0)).toBe(100);
  /* Un resto de redondeo no es una parte sin zona. */
  expect(cifrasDelMapa([zona("na", 100)], 0.04).map((c) => c.id)).toEqual(["na"]);
  /* Cuatro zonas y «No declarado» caben sin «Resto». */
  expect(cifrasDelMapa(cinco.slice(0, 4), 11).map((c) => c.id)).toEqual(["na", "asia", "eu", "la", "unassigned"]);
});

test("la región de un fondo con su nombre en español también es Europa: «Eurozona», «Europa ex-euro» y «Europa emergente»", () => {
  /* Sin renta variable, el mapa lee la región de la ficha, y el servidor la escribe en español (`readmodel/mappers.py`). Antes, «Sin situar». */
  const result = buildReportGeography([
    { key: "Eurozona", weight_percent: 60 },
    { key: "Europa ex-euro", weight_percent: 30 },
    { key: "Europa emergente", weight_percent: 10 }
  ]);
  expect(result.totals.europe).toBe(100);
  expect(result.sinSituar).toBe(0);
  expect(result.unassigned).toBe(0);
});

test("raw allocations retain their source denominator", () => {
  const result = buildReportGeography([
    { key: "Iberia", weight_percent: 20 },
    { key: "unclassified", weight_percent: 10 }
  ]);
  expect(result.totals.europe).toBe(20);
  expect(result.unassigned).toBe(10);
  expect(result.noDeclarado).toBe(10);
});

test("sin reparto por regiones, «Global» lo dice la ficha y «N/D» no: uno está sin situar y el otro sin declarar", () => {
  const result = buildReportGeography([
    { key: "Europa", weight_percent: 50 },
    { key: "Global", weight_percent: 30 },
    { key: "N/D", weight_percent: 20 }
  ]);
  expect(result.totals.europe).toBe(50);
  expect(result.sinSituar).toBe(30);
  expect(result.noDeclarado).toBe(20);
});
