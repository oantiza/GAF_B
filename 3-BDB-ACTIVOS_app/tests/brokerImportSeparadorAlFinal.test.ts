/**
 * IMP-6 (auditoría integral del 16-11-2026): una fila con el separador al final no se descarta.
 *
 * Una línea que acaba en «;» deja una celda vacía de más. La regla de anchura la contaba como un campo, descartaba la
 * fila por «más columnas que la cabecera» y, si todas las filas acababan así y la cabecera no, se quedaba sin extracto.
 * Los pesos esperados salen de la cuenta escrita junto a cada uno.
 */
import { describe, expect, test } from "vitest";
import { brokerExportToCanonicalImport } from "../src/core/brokerPortfolioImport";

const SANTANDER = "ES0113900J37";
const IBERDROLA = "ES0144580Y14";
/* 1.000 € y 2.000 €: 1.000 / 3.000 = 33,3333 % y 2.000 / 3.000 = 66,6667 %. */
const LOS_DOS = `asset_id,weight\n${SANTANDER},33.3333\n${IBERDROLA},66.6667`;

describe("IMP-6 · el separador al final de la línea no es un campo de más", () => {
  test("una sola fila con el separador al final entra como las demás, sin aviso", () => {
    const leido = brokerExportToCanonicalImport(`ISIN;Nombre;Importe EUR\n${SANTANDER};Banco Santander;1000,00;\n${IBERDROLA};Iberdrola;2000,00\n`);
    /* Antes: solo Iberdrola, al 100 %, y un aviso de «más columnas que la cabecera». */
    expect(leido.text).toBe(LOS_DOS);
    expect(leido.warnings).toEqual([]);
  });

  test("con todas las filas así y la cabecera sin él, el extracto se lee entero", () => {
    const leido = brokerExportToCanonicalImport(`ISIN;Nombre;Importe EUR\n${SANTANDER};Banco Santander;1000,00;\n${IBERDROLA};Iberdrola;2000,00;\n`);
    /* Antes no se importaba ninguna fila. */
    expect(leido.text).toBe(LOS_DOS);
    expect(leido.warnings).toEqual([]);
  });

  test("varios separadores al final tampoco cuentan", () => {
    const leido = brokerExportToCanonicalImport(`ISIN;Nombre;Importe EUR\n${SANTANDER};Banco Santander;1000,00;;;\n${IBERDROLA};Iberdrola;2000,00\n`);
    expect(leido.text).toBe(LOS_DOS);
  });

  test("separado por tabuladores, igual", () => {
    const leido = brokerExportToCanonicalImport(`ISIN\tNombre\tImporte EUR\n${SANTANDER}\tBanco Santander\t1000,00\t\n${IBERDROLA}\tIberdrola\t2000,00\t\n`);
    expect(leido.text).toBe(LOS_DOS);
  });
});

describe("IMP-6 · lo que sigue descartándose, y por qué", () => {
  test("un separador de miles sin comillas: parte el importe en dos celdas con contenido", () => {
    const leido = brokerExportToCanonicalImport(`ISIN,Nombre,Importe EUR\n${SANTANDER},Banco Santander,1,000.00\n${IBERDROLA},Iberdrola,2000.00\n`);
    expect(leido.text).toBe(`asset_id,weight\n${IBERDROLA},100.0000`);
    expect(leido.warnings.join(" ")).toContain(`1 fila tiene más columnas que la cabecera (${SANTANDER})`);
  });

  test("separado por comas, una celda vacía de más se sigue contando: puede ser medio importe (N46)", () => {
    /* «80,000.00» sin comillas, con la columna «Divisa» vacía: [ISIN, nombre, «80», «000.00», «»]. Son cinco celdas para
       cuatro columnas; sin contar la vacía serían cuatro y la fila entraría con 80 € en vez de 80.000. */
    const leido = brokerExportToCanonicalImport(`ISIN,Nombre,Importe EUR,Divisa\n${SANTANDER},Banco Santander,80,000.00,\n${IBERDROLA},Iberdrola,2000.00,\n`);
    expect(leido.text).toBe(`asset_id,weight\n${IBERDROLA},100.0000`);
    expect(leido.warnings.join(" ")).toContain(`1 fila tiene más columnas que la cabecera (${SANTANDER})`);
  });

  test("y por eso, separado por comas, una fila con la coma al final se sigue descartando, con su aviso", () => {
    /* Es el límite de este arreglo: aquí no se puede distinguir de lo anterior, y descartar una fila diciéndolo es
       mejor que leer un importe a medias. */
    const leido = brokerExportToCanonicalImport(`ISIN,Nombre,Importe EUR\n${SANTANDER},Banco Santander,1000.00,\n${IBERDROLA},Iberdrola,2000.00\n`);
    expect(leido.text).toBe(`asset_id,weight\n${IBERDROLA},100.0000`);
    expect(leido.warnings.join(" ")).toContain(`1 fila tiene más columnas que la cabecera (${SANTANDER})`);
  });
});
