/**
 * Los informes con paginación declarada deben poder imprimirla.
 *
 * Auditoría 06-09-2026 (B3): los cuatro informes OAA declaraban un pie con
 * `render={({ pageNumber, totalPages }) => …}` y ninguno lo imprimía. Causa: el
 * `lineHeight` sin unidad del estilo `page` se remultiplica por el tamaño de letra en
 * cada pasada de maquetación de una página que contiene nodos `render`
 * (1,4 → 13,3 → 126 → 1.200…), y el pie —posicionado con `bottom`— acaba fuera del
 * papel. Verificado con pdftotext sobre el informe semanal: antes, cero pies; después,
 * «Página 1 de 2» y «Página 2 de 2».
 *
 * Ola 1.1 (punto 5): la prueba sustantiva ya no mira el código, mira el PDF.
 * `extractPdfPageTexts` descomprime los flujos del documento generado y traduce los
 * glifos con el CMap `/ToUnicode` de cada fuente, así que el pie se lee HOJA POR HOJA
 * tal como saldría impreso: si un informe deja de numerar, o numera mal, se ve aquí.
 * Las dos comprobaciones sobre el código se quedan como guardia de la causa concreta
 * —el `lineHeight` sin unidad en el estilo `page`—, que con los interlineados ahora
 * declarados por estilo de texto puede no llegar a manifestarse en cada informe.
 */
import { describe, expect, test } from "vitest";
import { extractPdfPageTexts } from "./support/pdfText";
import * as fs from "node:fs";
import * as path from "node:path";
import { createComparisonPdfBlob } from "../src/reports/comparePdf";
import { createWeeklyReportPdfBlob } from "../src/reports/weeklyReportPdf";
import { propuestaDeCambio } from "../src/core/propuestaDeCambio";
import { createPropuestaDeCambioPdfBlob } from "../src/reports/propuestaDeCambioPdf";
import { ACTIVOS, ACTUAL, historia, PROPUESTA, SERIE_ACTUAL, SERIE_PROPUESTA } from "./support/propuestaFixtures";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";

/**
 * Dónde se numera el pie con la prop `render` de @react-pdf. Desde el 14-11-2026 todos los informes salen de la plantilla única, y el
 * número lo pone su hoja (`src/reports/plantilla/hoja.tsx`), con el estilo `hoja` de la página. Hasta ese día la lista nombraba los
 * papeles de antes (`papelDeCliente.tsx` fue el último), retirados con el «Análisis rápido de extractos».
 */
const CON_RENDER = ["plantilla/hoja.tsx"];

function fuente(fichero: string): string {
  return fs.readFileSync(path.resolve("src/reports", fichero), "utf8");
}

function estiloDePagina(src: string): string {
  const match = /^\s*hoja: \{([^}]*)\}/m.exec(src);
  expect(match).not.toBeNull();
  return match![1];
}

const compareInput = {
  nameA: "Cartera actual",
  nameB: "Propuesta",
  a: { posiciones: 8, ret: 0.061, vol: 0.082, sharpe: 0.74, maxdd: -0.11 },
  b: { posiciones: 9, ret: 0.068, vol: 0.079, sharpe: 0.86, maxdd: -0.09 },
  maxddLabel: "Máx. caída 5A",
  classRows: [
    { label: "Renta variable", a: 45, b: 52 },
    { label: "Renta fija", a: 40, b: 33 }
  ]
};

const propuesta = propuestaDeCambio({
  actual: ACTUAL,
  propuesta: PROPUESTA,
  periodo: "3Y",
  historiaActual: historia(["LU0000000001", "LU0000000002"], SERIE_ACTUAL),
  historiaPropuesta: historia(["LU0000000001", "LU0000000003", "ES0144580Y14"], SERIE_PROPUESTA),
  assets: ACTIVOS,
  capital: 100000,
  motivo: "Bajar el coste corriente.",
  generadoEn: "2026-11-05T09:00:00Z"
});

describe("paginación de los informes PDF", () => {
  test("los informes que numeran con `render` no llevan lineHeight en el estilo de página", () => {
    for (const fichero of CON_RENDER) {
      const src = fuente(fichero);
      expect(src, `${fichero} debería numerar con render`).toMatch(/render=\{\(\{ pageNumber/);
      expect(estiloDePagina(src), fichero).not.toMatch(/lineHeight/);
    }
  });

  test("el interlineado sigue declarado, ahora en los estilos de texto", () => {
    for (const fichero of CON_RENDER) {
      expect(fuente(fichero).match(/lineHeight: [\d.]+/g)?.length ?? 0, fichero).toBeGreaterThan(2);
    }
  });

  test("cada hoja del PDF generado imprime su propio pie, con el total real", async () => {
    const informes: Array<[string, Blob]> = [
      ["semanal", await createWeeklyReportPdfBlob(WEEKLY_REPORT_MOCK, "SEMANAL")],
      ["comparativa", await createComparisonPdfBlob(compareInput)],
      ["propuesta de cambio", await createPropuestaDeCambioPdfBlob(propuesta)]
    ];
    for (const [nombre, blob] of informes) {
      const bytes = Buffer.from(await blob.arrayBuffer());
      expect(bytes.subarray(0, 4).toString(), nombre).toBe("%PDF");
      const hojas = extractPdfPageTexts(bytes);
      expect(hojas.length, nombre).toBeGreaterThan(0);
      hojas.forEach((texto, indice) => {
        const pie = /Página (\d+) de (\d+)/.exec(texto);
        expect(pie, `${nombre}: la hoja ${indice + 1} no imprime el pie`).not.toBeNull();
        expect(Number(pie![1]), `${nombre}: número de hoja ${indice + 1}`).toBe(indice + 1);
        expect(Number(pie![2]), `${nombre}: total en la hoja ${indice + 1}`).toBe(hojas.length);
      });
    }
  }, 30_000);
});
