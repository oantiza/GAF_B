/**
 * Una palabra para cada cosa en el papel (decisión 66 de Óscar, 05-11-2026): «No declarado» y «Carteras de referencia». Lo impreso se
 * prueba en cada documento; esto vigila que ninguno vuelva a escribir la palabra de antes, también uno nuevo. Se mira el código sin
 * sus comentarios: lo que cuentan de cómo era no se imprime.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sinComentarios = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
/* Con la carpeta del informe de cliente, que desde la plantilla única tiene sus secciones aparte. */
const PAPELES = [
  ...readdirSync("src/reports").filter((fichero) => fichero.endsWith(".tsx")),
  ...readdirSync("src/reports/informeDeCliente").filter((fichero) => /\.tsx?$/.test(fichero)).map((fichero) => `informeDeCliente/${fichero}`)
];

describe("el papel", () => {
  test("hay papeles que mirar", () => {
    expect(PAPELES).toEqual(expect.arrayContaining(["informeDeClientePdf.tsx", "internalPortfolioReportPdf.tsx", "comparePdf.tsx"]));
  });

  test.each(PAPELES)("%s no escribe «Sin asignar», «Sin clasificar» ni «perfiles de referencia»", (fichero) => {
    const codigo = sinComentarios(readFileSync(`src/reports/${fichero}`, "utf8"));
    expect(codigo).not.toMatch(/[Ss]in asignar|[Ss]in clasificar/);
    expect(codigo).not.toMatch(/[Pp]erfil(es)? de referencia/);
    /* «Perfil» a secas tampoco, para esta idea: el del cliente es el perfil de riesgo, y ese no sale en ningún papel. */
    expect(codigo).not.toMatch(/\b(los|con los|ningún|la línea de) perfil(es)?\b/);
  });

  test("la frase del mapa tampoco, que se escribe fuera de los papeles", () => {
    expect(sinComentarios(readFileSync("src/core/lecturaDelMapa.ts", "utf8"))).not.toMatch(/(todos los|con los|línea de|el) perfil(es)?\b/);
  });
});
