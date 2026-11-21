/**
 * La tabla de categorías (decisiones 99, 100 y 101 de Óscar, 05-11-2026). Está escrita en el módulo, sin leer nada al ejecutarse,
 * y esta prueba la compara fila a fila con la copia del repositorio de la que sale: `docs/rediseno-2026-11/datos/categorias-2026-11-05.json`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CATEGORIAS_LEGIBLES, nombreDeCategoria } from "../src/core/categoriasLegibles";
import { categoriaLegible } from "../src/core/etiquetasDeReparto";

interface FilaDeLaTabla {
  original: string;
  propuesta: string;
}
const tabla = JSON.parse(readFileSync(new URL("../docs/rediseno-2026-11/datos/categorias-2026-11-05.json", import.meta.url), "utf8")) as {
  filas: FilaDeLaTabla[];
  solo_base_vieja: FilaDeLaTabla[];
  fusiones: { propuesta: string; originales: { original: string }[] }[];
};

/* La única que se aparta del JSON: la decisión 83 dice «Acciones» de la categoría de una acción, y la tabla proponía «Acción». */
const LO_QUE_MANDA_OTRA_DECISION: Record<string, string> = { accion: "Acciones" };

describe("la tabla de categorías", () => {
  test("es la del JSON, fila a fila y en su orden: las 145 de la base nueva y las 7 que solo trae la anterior", () => {
    expect(tabla.filas).toHaveLength(145);
    expect(tabla.solo_base_vieja).toHaveLength(7);
    const esperadas = [...tabla.filas, ...tabla.solo_base_vieja].map((fila) => [fila.original, LO_QUE_MANDA_OTRA_DECISION[fila.original] ?? fila.propuesta]);
    expect(CATEGORIAS_LEGIBLES.map(([original, legible]) => [original, legible])).toEqual(esperadas);
  });

  test("cada texto del proveedor da su nombre, y un nombre de la tabla se da a sí mismo: traducir dos veces no cambia nada", () => {
    for (const [original, legible] of CATEGORIAS_LEGIBLES) {
      expect(nombreDeCategoria(original)).toBe(legible);
      expect(nombreDeCategoria(legible)).toBe(legible);
    }
  });

  test("la misma categoría en los dos idiomas da un solo nombre: de 145 nombres a 125", () => {
    for (const fusion of tabla.fusiones) {
      for (const { original } of fusion.originales) expect(nombreDeCategoria(original)).toBe(fusion.propuesta);
    }
    expect(nombreDeCategoria("EAA Fund US Large-Cap Blend Equity")).toBe(nombreDeCategoria("RV USA Cap. Grande Blend"));
    expect(nombreDeCategoria("Large Blend")).toBe("RV USA Cap. Grande Blend");
    expect(new Set(tabla.filas.map((fila) => nombreDeCategoria(fila.original))).size).toBe(125);
  });

  test("por texto exacto, sin «contiene»: lo que excluye Japón no es Japón", () => {
    expect(nombreDeCategoria("EAA Fund Asia ex-Japan Equity")).toBe("RV Asia (ex-Japón)");
    expect(nombreDeCategoria("EAA Fund Asia-Pacific ex-Japan Equity")).toBe("RV Asia Pacífico (ex-Japón)");
    expect(nombreDeCategoria("EAA Fund Japan Large-Cap Blend Equity")).toBe("RV Japón Cap. Grande Blend");
    expect(nombreDeCategoria("EAA Fund US Large-Cap Growth Equity")).toBe("RV USA Cap. Grande Growth");
    expect(nombreDeCategoria("EAA Fund US Large-Cap Value Equity")).toBe("RV USA Cap. Grande Value");
  });

  test("los espacios no cuentan: el proveedor escribe un espacio y uno de no separación en «Cubierto EUR»", () => {
    const delProveedor = tabla.filas.find((fila) => fila.original.includes("Cubierto  EUR"));
    expect(delProveedor?.original).toBe("RF Diversificada Global - Cubierto  EUR");
    for (const escrito of ["RF Diversificada Global - Cubierto  EUR", "RF Diversificada Global - Cubierto  EUR", "RF Diversificada Global - Cubierto EUR", " RF Diversificada Global - Cubierto EUR "]) {
      expect(nombreDeCategoria(escrito)).toBe("RF Diversificada Global - EUR Cubierto");
    }
    expect(nombreDeCategoria("EAA Fund Global Diversified Bond - EUR Hedged")).toBe("RF Diversificada Global - EUR Cubierto");
  });

  test("lo que no está en la tabla sale con el texto del proveedor, sin «EAA Fund», hasta que se añada", () => {
    expect(nombreDeCategoria("EAA Fund Frontier Markets Equity")).toBe("Frontier Markets Equity");
    expect(nombreDeCategoria("EAA  Fund  Frontier Markets Equity")).toBe("Frontier Markets Equity");
    expect(nombreDeCategoria("Categoría nueva")).toBe("Categoría nueva");
    expect(categoriaLegible("EAA Fund Frontier Markets Equity")).toBe("Frontier Markets Equity");
  });

  test("categoriaLegible lee la tabla, y la de una acción es «Acciones» en cualquier caja (decisión 83)", () => {
    expect(categoriaLegible("EAA Fund Thematic Equity Ecology")).toBe("RV Sector Ecología");
    expect(categoriaLegible("EAA Fund Global Diversified Bond - EUR Hedged")).toBe("RF Diversificada Global - EUR Cubierto");
    for (const accion of ["accion", "Accion", "ACCION", "Acción"]) expect(categoriaLegible(accion)).toBe("Acciones");
    expect(categoriaLegible("ETF")).toBe("ETF");
    expect(categoriaLegible(null)).toBeUndefined();
    expect(categoriaLegible("   ")).toBeUndefined();
  });
});
