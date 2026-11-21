/**
 * Las fuentes de la plantilla, comprobadas sobre PDF generados y no sobre el código. Desde el 14-11-2026 (decisión de Óscar:
 * recuperar el aspecto de los informes de antes) son Fraunces (300, 400 y 600) y Roboto Flex (400, 500 y 600), los TTF del papel
 * de cliente de antes; hasta ese día eran IBM Plex Sans y Source Serif 4, en WOFF, que salieron de la carpeta.
 *  - @react-pdf incrusta los TTF (con su programa de fuente) y el texto se extrae;
 *  - un documento con varios pesos lleva una cara por peso: cada fichero se llama por dentro como lo que es, y pdfkit no
 *    reutiliza una por otra (decisión A-127);
 *  - dos documentos seguidos conservan todas las letras: el segundo no pierde las que el primero no usó.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DocumentoDeInforme, Hoja, Parrafo, Presentacion, renderizarInforme } from "../../src/reports/plantilla";
import { extractPdfFontFaces, extractPdfPageTexts } from "../support/pdfText";
import { SANS_DE_LA_PLANTILLA, WOFF_DE_LA_PLANTILLA as WOFF, abrirFuente } from "./fuentesDeLaPlantilla";
import { generarMuestra } from "./muestra";

async function documento(titulo: string, parrafo: string): Promise<Buffer> {
  const blob = await renderizarInforme(
    <DocumentoDeInforme tema="cliente" documento="Prueba de letras">
      <Hoja>
        <Presentacion titulo={titulo} contexto="Contexto" />
        <Parrafo>{parrafo}</Parrafo>
      </Hoja>
    </DocumentoDeInforme>
  );
  return Buffer.from(await blob.arrayBuffer());
}

describe("las fuentes de la plantilla", () => {
  test("las seis fuentes se llaman por dentro distinto, con el peso que declaran", () => {
    const fuentes = WOFF.map((fichero) => {
      const fuente = abrirFuente(fichero);
      return { fichero, tipo: fuente.type, postscript: fuente.postscriptName, peso: fuente["OS/2"].usWeightClass };
    });
    expect(fuentes).toEqual([
      { fichero: "Fraunces-Light.ttf", tipo: "TTF", postscript: "Fraunces-Light", peso: 300 },
      { fichero: "Fraunces-Regular.ttf", tipo: "TTF", postscript: "Fraunces-Regular", peso: 400 },
      { fichero: "Fraunces-SemiBold.ttf", tipo: "TTF", postscript: "Fraunces-SemiBold", peso: 600 },
      { fichero: "RobotoFlex-400.ttf", tipo: "TTF", postscript: "RobotoFlex-Regular", peso: 400 },
      { fichero: "RobotoFlex-500.ttf", tipo: "TTF", postscript: "RobotoFlex-Medium", peso: 500 },
      { fichero: "RobotoFlex-600.ttf", tipo: "TTF", postscript: "RobotoFlex-SemiBold", peso: 600 }
    ]);
  });

  /* La antigua `tests/fuentesDelPapel.test.tsx` recorría la carpeta entera: una fuente nueva mal nombrada fallaba sin que nadie la
     añadiera a una lista. Desde que se retiraron los papeles de antes (14-11-2026) en la carpeta solo están las de la plantilla, y así
     se exige: una fuente nueva entra en `WOFF_DE_LA_PLANTILLA`, y con ella en la prueba de arriba. */
  test("en la carpeta de fuentes solo están las seis de la plantilla y sus dos licencias", () => {
    expect(readdirSync(fileURLToPath(new URL("../../src/assets/fonts/", import.meta.url))).sort()).toEqual(
      [...WOFF, "OFL-Fraunces.txt", "OFL-RobotoFlex.txt"].sort()
    );
  });

  /* Fraunces tiene cifras de ancho propio: por eso solo va en cifras sueltas (tarjetas, totales), nunca en una columna. */
  test("las cifras del 0 al 9 tienen el mismo ancho en Roboto Flex, la letra de las columnas de cifras", () => {
    for (const fichero of SANS_DE_LA_PLANTILLA) {
      const fuente = abrirFuente(fichero);
      const anchos = new Set([..."0123456789"].map((cifra) => fuente.glyphForCodePoint(cifra.codePointAt(0)!).advanceWidth));
      expect(anchos.size, fichero).toBe(1);
    }
  });

  test("la muestra incrusta las dos familias, una cara por peso, con su programa de fuente", async () => {
    const bytes = await generarMuestra("cliente");
    const caras = extractPdfFontFaces(bytes);
    expect(caras).toEqual(expect.arrayContaining(["Fraunces-Regular", "RobotoFlex-Regular", "RobotoFlex-Medium", "RobotoFlex-SemiBold"]));
    expect(caras.every((cara) => /^(Fraunces|RobotoFlex)-/.test(cara))).toBe(true);
    expect(new Set(caras).size).toBe(caras.length);
    /* Cada cara lleva su fichero de fuente incrustado (un subconjunto), no solo el nombre. */
    expect([...bytes.toString("latin1").matchAll(/\/FontFile[23]?\s+\d+\s+0\s+R/g)].length).toBe(caras.length);
  }, 30_000);

  test("dos documentos seguidos conservan todas las letras del segundo", async () => {
    const nuevas = ["ÁGUILA ÍNDICE", "ÑOÑO KÜMMEL", "ÚNICO ÖSTER Ç"];
    await documento("Fondo Alfa", "Fondo Beta");
    const segundo = extractPdfPageTexts(await documento(nuevas[0], `${nuevas[1]} ${nuevas[2]}`)).join("\n");
    for (const texto of nuevas) expect(segundo, `perdió letras en «${texto}»`).toContain(texto);
    const tercero = extractPdfPageTexts(await documento(nuevas[0], `${nuevas[1]} ${nuevas[2]}`)).join("\n");
    expect(tercero).toBe(segundo);
  }, 30_000);
});
