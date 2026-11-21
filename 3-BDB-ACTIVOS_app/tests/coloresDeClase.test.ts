import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { colorDeLaClase, colorDeLaClasePorNombre } from "../src/core/coloresDeClase";
import { CLASS_LABELS } from "../src/core/labels";
import { CHART_PALETTE, CHART_REFERENCE_COLOR, CLASS_COLORS, UNCLASSIFIED_COLOR } from "../src/core/theme";

/**
 * El color de cada clase de activo (14-11-2026, Óscar: «le faltan colores en general»). El color sigue a la clase y es
 * el mismo en toda la aplicación: lo que se fija aquí es qué color lleva cada una, que dos clases distintas no
 * compartan color salvo los activos reales, y que lo que no es una clase con nombre vaya en gris. Los colores son los de
 * la dirección A (18-11-2026).
 */
const AZUL = "#2F5D8A";
const SALVIA = "#4E7D6A";
const GRIS_FRIO = "#8A8F98";
const LATON = "#A8824A";
const VIOLETA = "#8365B3";
const CACAO = "#553230";
const GRIS = "#B3AC9E";

describe("el color de cada clase de activo", () => {
  test("cada clase, su color: renta variable azul, renta fija salvia, monetario gris frío, alternativo latón, mixto violeta", () => {
    expect(colorDeLaClase("EQUITY")).toBe(AZUL);
    expect(colorDeLaClase("FIXED_INCOME")).toBe(SALVIA);
    expect(colorDeLaClase("MONEY_MARKET")).toBe(GRIS_FRIO);
    expect(colorDeLaClase("ALTERNATIVE")).toBe(LATON);
    expect(colorDeLaClase("MIXED")).toBe(VIOLETA);
  });

  test("los activos reales comparten el cacao: inmobiliario y materias primas", () => {
    expect([colorDeLaClase("REAL_ASSET"), colorDeLaClase("REAL_ASSETS"), colorDeLaClase("COMMODITIES")]).toEqual([CACAO, CACAO, CACAO]);
  });

  test("las claves de la exposición (en minúsculas) llevan el mismo color que la clase: la liquidez, el del monetario", () => {
    expect(colorDeLaClase("equity")).toBe(AZUL);
    expect(colorDeLaClase("fixed_income")).toBe(SALVIA);
    expect(colorDeLaClase("cash")).toBe(GRIS_FRIO);
    expect(colorDeLaClase("alternative")).toBe(LATON);
    expect(colorDeLaClase("real_asset")).toBe(CACAO);
  });

  test("lo que no es una clase con nombre va en gris: «Otros», lo desconocido y lo que falta", () => {
    expect([colorDeLaClase("OTHER"), colorDeLaClase("UNKNOWN"), colorDeLaClase("other"), colorDeLaClase(""), colorDeLaClase(null), colorDeLaClase(undefined)]).toEqual(
      Array.from({ length: 6 }, () => GRIS)
    );
  });

  test("salvo los activos reales, dos clases con nombre no comparten color", () => {
    const conNombre = Object.keys(CLASS_LABELS).filter((clave) => !["OTHER", "UNKNOWN", "REAL_ASSET", "COMMODITIES"].includes(clave));
    const colores = conNombre.map(colorDeLaClase);
    expect(new Set(colores).size).toBe(conNombre.length);
    expect(colores).not.toContain(GRIS);
  });

  test("por el nombre en pantalla sale el mismo color que por la clave", () => {
    for (const [clave, nombre] of Object.entries(CLASS_LABELS)) expect(colorDeLaClasePorNombre(nombre), nombre).toBe(colorDeLaClase(clave));
    expect(colorDeLaClasePorNombre("Liquidez")).toBe(GRIS_FRIO);
    expect(colorDeLaClasePorNombre("Efectivo")).toBe(GRIS_FRIO);
    expect(colorDeLaClasePorNombre("Alternativos")).toBe(LATON);
    expect(colorDeLaClasePorNombre("Sin clasificar")).toBe(GRIS);
    expect(colorDeLaClasePorNombre(null)).toBe(GRIS);
  });

  /* Dirección A (18-11-2026): la clase ya no toma su color de la paleta de series por posición. La renta variable no es
     la cartera ni la renta fija la referencia, aunque alguna coincida con una serie «demás». */
  test("los colores son los de su clase, con su token, y no los de la cartera ni la referencia", () => {
    expect([CLASS_COLORS.rentaVariable, CLASS_COLORS.rentaFija, CLASS_COLORS.liquidez, CLASS_COLORS.alternativos, CLASS_COLORS.mixto, CLASS_COLORS.activosReales]).toEqual([
      AZUL,
      SALVIA,
      GRIS_FRIO,
      LATON,
      VIOLETA,
      CACAO
    ]);
    expect(UNCLASSIFIED_COLOR).toBe(GRIS);
    expect(Object.keys(CLASS_LABELS).map(colorDeLaClase)).not.toContain(CHART_PALETTE[0]);
    expect(Object.keys(CLASS_LABELS).map(colorDeLaClase)).not.toContain(CHART_REFERENCE_COLOR);
    const tokens = readFileSync(path.resolve(process.cwd(), "src/styles/tokens.css"), "utf8").toLowerCase();
    for (const [nombre, color] of [
      ["renta-variable", AZUL],
      ["renta-fija", SALVIA],
      ["liquidez", GRIS_FRIO],
      ["alternativos", LATON],
      ["mixto", VIOLETA],
      ["activos-reales", CACAO],
      ["resto", GRIS]
    ]) {
      expect(tokens, `--clase-${nombre}`).toMatch(new RegExp(`--clase-${nombre}: ${color.toLowerCase()};`));
    }
  });
});
