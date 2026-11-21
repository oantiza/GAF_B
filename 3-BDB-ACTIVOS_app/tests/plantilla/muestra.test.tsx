/**
 * La muestra de la plantilla, generada en los dos temas y leída sobre el PDF: sellos en la cabecera y en el pie de todas
 * las hojas, «Página x de y» (también en las apaisadas), la cabecera de la tabla larga en cada hoja, ninguna fila
 * perdida ni repetida, el total acompañado, el formato de las cifras, ningún relleno degradado y ninguna palabra prohibida.
 *
 * Con `MUESTRA_PDF=<carpeta>` escribe allí `muestra-cliente.pdf` y `muestra-interno.pdf`, para mirarlos.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, test } from "vitest";
import { extractPdfPageTexts, extractPdfTextBaselines, extractPdfTextRuns } from "../support/pdfText";
import { generarMuestra } from "./muestra";
import type { TemaDeInforme } from "../../src/reports/plantilla";

const SELLO: Record<TemaDeInforme, string> = { cliente: "CONFIDENCIAL", interno: "USO INTERNO" };
const PDF: Partial<Record<TemaDeInforme, Buffer>> = {};
const ESPACIO_DURO = "\u{00A0}";
const MENOS = "\u{2212}";

beforeAll(async () => {
  for (const tema of ["cliente", "interno"] as const) {
    PDF[tema] = await generarMuestra(tema);
    const carpeta = process.env.MUESTRA_PDF;
    if (carpeta) {
      mkdirSync(carpeta, { recursive: true });
      writeFileSync(path.join(carpeta, `muestra-${tema}.pdf`), PDF[tema]!);
    }
  }
}, 60_000);

/** El alto de cada hoja, de su MediaBox. */
function altos(bytes: Buffer): number[] {
  return [...bytes.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => Number(m[2]));
}

describe.each(["cliente", "interno"] as const)("la muestra, tema %s", (tema) => {
  const bytes = () => PDF[tema]!;
  const hojas = () => extractPdfPageTexts(bytes());

  test("es un PDF con hojas verticales y apaisadas", () => {
    expect(bytes().subarray(0, 4).toString()).toBe("%PDF");
    const cajas = [...bytes().toString("latin1").matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(cajas.length).toBe(hojas().length);
    expect(cajas.some(([ancho, alto]) => ancho > alto)).toBe(true);
    expect(cajas.some(([ancho, alto]) => ancho < alto)).toBe(true);
  });

  test("el sello sale en la cabecera y en el pie de todas las hojas", () => {
    const alturas = altos(bytes());
    extractPdfTextBaselines(bytes()).forEach((cadenas, i) => {
      const sellos = cadenas.filter((c) => c.texto.trim() === SELLO[tema]);
      expect(sellos.some((c) => c.y < 60), `hoja ${i + 1}: sello en la cabecera`).toBe(true);
      expect(sellos.some((c) => c.y > alturas[i] - 40), `hoja ${i + 1}: sello en el pie`).toBe(true);
    });
  });

  /* Desde el 14-11-2026 «Preparado para» va en el pie del de cliente (el papel de antes decía ahí para quién era). */
  test("«Preparado para» en el de cliente, «No entregar al cliente» en el interno, en cada hoja", () => {
    for (const texto of hojas()) {
      expect(texto).toContain("Informe de cartera");
      if (tema === "cliente") {
        expect(texto).toContain("Preparado para Familia García");
        expect(texto).not.toContain("No entregar al cliente");
      } else {
        expect(texto).toContain("No entregar al cliente");
        expect(texto).not.toContain("Preparado para");
      }
    }
  });

  test("cada hoja dice «Página x de N», también las apaisadas, en el pie", () => {
    const todas = hojas();
    const alturas = altos(bytes());
    extractPdfTextBaselines(bytes()).forEach((cadenas, i) => {
      const pie = cadenas.find((c) => /^Página \d+ de \d+$/.test(c.texto.trim()));
      expect(pie?.texto.trim(), `hoja ${i + 1}`).toBe(`Página ${i + 1} de ${todas.length}`);
      expect(pie!.y, `hoja ${i + 1}: dentro del papel y abajo`).toBeGreaterThan(alturas[i] - 40);
      expect(pie!.y).toBeLessThan(alturas[i]);
    });
  });

  test("la tabla larga repite su cabecera en cada hoja, y cada una de sus 70 filas sale una sola vez", () => {
    const conLaTabla = hojas().filter((texto) => /Posición \d{3}/.test(texto));
    expect(conLaTabla.length).toBeGreaterThanOrEqual(3);
    for (const texto of conLaTabla) expect(texto).toContain("Denominación");
    const vistas = conLaTabla.flatMap((texto) => [...texto.matchAll(/Posición (\d{3})/g)].map((m) => Number(m[1])));
    expect(vistas).toEqual(Array.from({ length: 70 }, (_, i) => i + 1));
  });

  test("la fila de total no se queda sola: sale en la hoja de las últimas filas", () => {
    const hoja = hojas().find((texto) => texto.includes("Total, 70 posiciones"));
    expect(hoja).toBeDefined();
    expect(hoja).toContain("Posición 070");
    expect(hoja).toContain("Posición 069");
  });

  test("las cifras salen con el formato del módulo común: espacio duro y menos tipográfico", () => {
    /* Las cadenas tal cual: el texto por hojas cambia todo espacio, también el duro, por uno normal. */
    const texto = extractPdfTextRuns(bytes()).flat().join("\n");
    expect(texto).toContain(`201.298${ESPACIO_DURO}€`);
    expect(texto).toContain(`+10,39${ESPACIO_DURO}%`);
    expect(texto).toContain(`${MENOS}2,66${ESPACIO_DURO}%`);
    expect(texto).toContain(`${MENOS}175,20${ESPACIO_DURO}€`);
    expect(texto).not.toMatch(/(^|[\s(])-\d/);
    expect(texto).not.toMatch(/\d [€%]/);
  });

  test("un dato que falta se dice con su frase", () => {
    expect(hojas().join("\n")).toContain("Falta el dato");
  });

  test("ningún texto prohibido: ni «N/D», ni «NaN», ni «undefined», ni marca de entidad", () => {
    const texto = hojas().join("\n");
    for (const prohibido of ["N/D", "NaN", "undefined", "null", "Independent", "Private Bankers", "Andbank"]) {
      expect(texto, prohibido).not.toContain(prohibido);
    }
  });

  /* El filete degradado de la plantilla de una sola tinta se retiró el 14-11-2026, con el aspecto de los informes de antes: el
     color va en filetes lisos, en la tinta y en los gráficos. */
  test("ya no lleva el filete degradado: ningún sombreado axial", () => {
    expect([...bytes().toString("latin1").matchAll(/\/ShadingType\s+2/g)].length).toBe(0);
  });

  test("el texto se extrae entero, también donde la fuente pone una ligadura («fi»)", () => {
    /*
     * Las fuentes componen «fi» como un solo glifo. El lector de `tests/support/pdfText.ts` no traduce esos glifos
     * («Renta fija» le sale «Renta ja»: lo dice su cabecera), pero el PDF sí los declara: su mapa `/ToUnicode` lleva el
     * glifo de la ligadura a las dos letras, «f» + «i» (<0066 0069>), y un lector de PDF copia «fija». Se comprueba ahí.
     */
    const flujos = [...bytes().toString("latin1").matchAll(/stream\r?\n/g)].map((m) => {
      const desde = m.index! + m[0].length;
      try {
        return inflateSync(bytes().subarray(desde, bytes().indexOf("endstream", desde))).toString("latin1");
      } catch {
        return "";
      }
    });
    const mapas = flujos.filter((flujo) => flujo.includes("beginbfchar") || flujo.includes("beginbfrange"));
    /* Un mapa por cara incrustada (Fraunces y Roboto Flex, en los pesos que usa la muestra). */
    expect(mapas.length).toBeGreaterThanOrEqual(4);
    expect(mapas.some((mapa) => /<0066 ?0069>/i.test(mapa))).toBe(true);
    expect(hojas().join("\n")).toContain("Rentabilidades pasadas no garantizan rentabilidades futuras");
  });
});
