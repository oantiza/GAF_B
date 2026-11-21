/**
 * La identidad del asesor es un dato: con todo, con solo el nombre y sin nada. Lo que falta no se inventa: sin logotipo
 * no hay imagen, sin entidad la cabecera dice el nombre, y sin nada la cabecera solo dice qué documento es. Nunca
 * «undefined» ni una marca de entidad.
 *
 * Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de antes) la cabecera es la del papel de antes:
 * a la izquierda el documento y el sello; a la derecha la entidad (o el nombre) en el color del tema y, debajo, quién firma y
 * cómo contactar. El pie del de cliente dice para quién es; el del interno, o el de cliente sin destinatario, quién firma.
 */
import { describe, expect, test } from "vitest";
import { extractPdfMetadata, extractPdfPageTexts, extractPdfTextBaselines } from "../support/pdfText";
import { IDENTIDAD_DE_MUESTRA, SECCIONES_DE_MUESTRA, generarMuestra } from "./muestra";
import type { IdentidadDelAsesor, TemaDeInforme } from "../../src/reports/plantilla";

/* Solo la primera hoja: basta para la cabecera y el pie, y va más deprisa. */
const PRIMERA = SECCIONES_DE_MUESTRA.slice(0, 1);

async function primeraHoja(identidad: IdentidadDelAsesor, tema: TemaDeInforme = "cliente") {
  const bytes = await generarMuestra(tema, { identidad, secciones: PRIMERA });
  const cadenas = extractPdfTextBaselines(bytes)[0];
  return {
    bytes,
    texto: extractPdfPageTexts(bytes)[0],
    cabecera: cadenas.filter((c) => c.y < 60).map((c) => c.texto.trim()),
    pie: cadenas.filter((c) => c.y > 800).map((c) => c.texto.trim()),
    imagenes: [...bytes.toString("latin1").matchAll(/\/Subtype\s*\/Image/g)].length
  };
}

describe("la identidad del asesor", () => {
  test("con todos los datos: logotipo, la entidad arriba y debajo nombre y contacto; el pie dice para quién; el autor es el asesor", async () => {
    const hoja = await primeraHoja(IDENTIDAD_DE_MUESTRA);
    expect(hoja.imagenes).toBeGreaterThanOrEqual(1);
    expect(hoja.cabecera).toEqual(["Informe de cartera", "CONFIDENCIAL", "Ruiz & Asociados", "Marta Ruiz Alonso · marta.ruiz@ruizasociados.es"]);
    expect(hoja.pie[0]).toBe("Preparado para Familia García ·");
    expect(hoja.pie[1]).toBe("CONFIDENCIAL");
    expect(extractPdfMetadata(hoja.bytes, "Author")).toBe("Marta Ruiz Alonso");
  }, 30_000);

  test("en el interno: «No entregar al cliente» bajo el documento, y el pie firma con la entidad", async () => {
    const hoja = await primeraHoja(IDENTIDAD_DE_MUESTRA, "interno");
    expect(hoja.cabecera).toEqual(["Informe de cartera", "USO INTERNO", "No entregar al cliente", "Ruiz & Asociados", "Marta Ruiz Alonso · marta.ruiz@ruizasociados.es"]);
    expect(hoja.pie[0]).toBe("Ruiz & Asociados ·");
    expect(hoja.pie[1]).toBe("USO INTERNO");
  }, 30_000);

  test("con solo el nombre: sin imagen y sin segunda línea; el nombre es la identidad", async () => {
    const hoja = await primeraHoja({ nombre: "  Marta Ruiz Alonso " });
    expect(hoja.imagenes).toBe(0);
    expect(hoja.cabecera).toEqual(["Informe de cartera", "CONFIDENCIAL", "Marta Ruiz Alonso"]);
    const interno = await primeraHoja({ nombre: "  Marta Ruiz Alonso " }, "interno");
    expect(interno.pie[0]).toBe("Marta Ruiz Alonso ·");
  }, 30_000);

  test("sin ningún dato: la cabecera solo dice qué documento es y el sello; el pie, para quién y el sello", async () => {
    const hoja = await primeraHoja({ nombre: " ", entidad: "", logotipo: "https://ejemplo.invalid/logo.svg" });
    expect(hoja.imagenes).toBe(0);
    expect(hoja.cabecera).toEqual(["Informe de cartera", "CONFIDENCIAL"]);
    expect(hoja.pie.slice(0, 2)).toEqual(["Preparado para Familia García ·", "CONFIDENCIAL"]);
    const interno = await primeraHoja({ nombre: " ", entidad: "" }, "interno");
    expect(interno.pie[0]).toBe("USO INTERNO");
    expect(extractPdfMetadata(hoja.bytes, "Author")).toBeNull();
    for (const prohibido of ["undefined", "null", "Independent", "Private Bankers"]) expect(hoja.texto).not.toContain(prohibido);
  }, 30_000);
});
