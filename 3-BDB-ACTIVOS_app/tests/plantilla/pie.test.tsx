/**
 * El pie de la hoja con una entidad de nombre largo: la advertencia no se monta sobre «Página x de y».
 *
 * El número de página se escribe con `render`, después de repartir el ancho de la línea. Sin un ancho propio, su caja
 * medía cero y la advertencia, centrada en lo que creía libre, llegaba hasta donde luego se pintaba «Página 1 de 7». Se
 * vio en el primer informe real que pasó a la plantilla, con una entidad de 36 letras. La prueba mide dónde empieza cada
 * texto del pie y cuánto ocupa la advertencia con la letra de verdad, y exige aire entre los dos.
 *
 * Se mira en el tema interno: desde el 14-11-2026 el pie del de cliente dice para quién es, y el del interno firma con la entidad.
 */
import { describe, expect, test } from "vitest";
import { ADVERTENCIA_DEL_PIE, MEDIDAS } from "../../src/reports/plantilla";
import { extractPdfTextBaselines } from "../support/pdfText";
import { abrirFuente } from "./fuentesDeLaPlantilla";
import { SECCIONES_DE_MUESTRA, generarMuestra } from "./muestra";

const PRIMERA = SECCIONES_DE_MUESTRA.slice(0, 1);
const ENTIDAD_LARGA = "Asesores Independientes de Patrimonios del Norte, EAF";

/** Lo que ocupa un texto en la letra del pie, en puntos: la suma de los avances de sus glifos. */
function anchoEnElPie(texto: string): number {
  const fuente = abrirFuente("RobotoFlex-400.ttf");
  const avances = [...texto].reduce((suma, letra) => suma + fuente.glyphForCodePoint(letra.codePointAt(0)!).advanceWidth, 0);
  /* Roboto Flex tiene 2048 unidades por eme (IBM Plex Sans tenía 1000). */
  return (avances / fuente.unitsPerEm) * MEDIDAS.pie.letra;
}

describe("el pie de la hoja", () => {
  test.each([
    ["una entidad corta", "Ruiz & Asociados"],
    ["una entidad de nombre largo", ENTIDAD_LARGA]
  ])("con %s, la advertencia y «Página x de y» no se pisan", async (_caso, entidad) => {
    const bytes = await generarMuestra("interno", { identidad: { nombre: "Marta Ruiz Alonso", entidad }, secciones: PRIMERA });
    const pie = extractPdfTextBaselines(bytes)[0].filter((cadena) => cadena.y > 790);
    const advertencia = pie.find((cadena) => cadena.texto.includes(ADVERTENCIA_DEL_PIE.slice(0, 20)));
    const pagina = pie.find((cadena) => /Página \d+ de \d+/.test(cadena.texto));
    expect(advertencia).toBeDefined();
    expect(pagina).toBeDefined();
    /* La advertencia cabe en una línea en los dos casos: se mide entera. */
    expect(advertencia!.texto.trim()).toBe(ADVERTENCIA_DEL_PIE);
    const finDeLaAdvertencia = advertencia!.x + anchoEnElPie(ADVERTENCIA_DEL_PIE);
    expect(pagina!.x - finDeLaAdvertencia).toBeGreaterThanOrEqual(6);
    /* Y la firma, a su izquierda, tampoco la pisa. */
    const firma = pie.find((cadena) => cadena.texto.includes(entidad.slice(0, 12)));
    expect(firma).toBeDefined();
    expect(firma!.x).toBeLessThan(advertencia!.x);
  }, 30_000);
});
