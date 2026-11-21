/**
 * Lo que todo documento pasado a la plantilla única tiene que cumplir sobre el PDF generado (encargo de la migración de
 * informes): ninguna marca de entidad ni texto roto, el sello de su tema en la cabecera y en el pie de cada hoja,
 * «Página x de N» en todas, y la identidad del asesor cuando la hay y su ausencia cuando no.
 *
 * Con `INFORMES_PDF=<carpeta>` las pruebas que lo usan escriben allí el PDF, para mirarlo.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { extractPdfMetadata, extractPdfPageTexts, extractPdfTextBaselines } from "./pdfText";

export type TemaDelPapel = "cliente" | "interno";

const SELLO: Record<TemaDelPapel, string> = { cliente: "CONFIDENCIAL", interno: "USO INTERNO" };

/** Lo que no puede imprimir ningún documento de la plantilla. */
export const PROHIBIDOS = ["Independent", "Private Bankers", "N/D", "NaN", "undefined"] as const;

/** Una identidad de prueba, sin logotipo: nombre, entidad y contacto. */
export const IDENTIDAD_DE_PRUEBA = { nombre: "Marta Ruiz Alonso", entidad: "Ruiz & Asociados", contacto: "marta.ruiz@ruizasociados.es" };

/** El alto de cada hoja, de su MediaBox. */
function altos(bytes: Buffer): number[] {
  return [...bytes.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => Number(m[2]));
}

/** Escribe el PDF en `INFORMES_PDF/<carpeta>/<nombre>.pdf`, si la variable está puesta. */
export function guardarSiSePide(bytes: Buffer, carpeta: string, nombre: string): void {
  const raiz = process.env.INFORMES_PDF;
  if (!raiz) return;
  const destino = path.join(raiz, carpeta);
  mkdirSync(destino, { recursive: true });
  writeFileSync(path.join(destino, `${nombre}.pdf`), bytes);
}

/**
 * Las comprobaciones comunes. `identidad`: el nombre del asesor, o `null` si el documento se generó sin identidad (y entonces no sale
 * ningún membrete ni autor). `portada`: la primera hoja es la portada a página completa.
 *
 * Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de antes) la cabecera es la del papel de antes: a la
 * izquierda el documento y el sello; a la derecha la identidad, con la entidad (o el nombre) en versalitas y debajo quién firma y
 * cómo contactar. Por eso el nombre se busca en el texto de la cabecera sin distinguir mayúsculas, y no como una cadena suelta. La
 * portada lleva arriba la identidad en versalitas, qué documento es y el sello; no lleva «No entregar al cliente» (la llevan solo
 * documentos de cliente) ni el nombre debajo de la identidad (lo dice en «Elaborado por»).
 */
export function comprobarPlantilla(
  bytes: Buffer,
  { tema, documento, identidad, portada = false }: { tema: TemaDelPapel; documento: string; identidad: string | null; portada?: boolean }
): void {
  const hojas = extractPdfPageTexts(bytes);
  expect(hojas.length).toBeGreaterThan(0);
  const todo = hojas.join("\n");
  for (const prohibido of PROHIBIDOS) expect(todo, prohibido).not.toContain(prohibido);
  const otro = tema === "cliente" ? SELLO.interno : SELLO.cliente;
  expect(todo).not.toContain(otro);

  const alturas = altos(bytes);
  extractPdfTextBaselines(bytes).forEach((cadenas, i) => {
    const esPortada = portada && i === 0;
    const sellos = cadenas.filter((c) => c.texto.trim() === SELLO[tema]);
    expect(sellos.some((c) => c.y < 60), `hoja ${i + 1}: sello en la cabecera`).toBe(true);
    expect(sellos.some((c) => c.y > alturas[i] - 40), `hoja ${i + 1}: sello en el pie`).toBe(true);
    const pie = cadenas.find((c) => /^Página \d+ de \d+$/.test(c.texto.trim()));
    expect(pie?.texto.trim(), `hoja ${i + 1}: número`).toBe(`Página ${i + 1} de ${hojas.length}`);
    expect(pie!.y, `hoja ${i + 1}: el número, abajo y dentro del papel`).toBeGreaterThan(alturas[i] - 40);
    expect(pie!.y).toBeLessThan(alturas[i]);
    const cabecera = cadenas.filter((c) => c.y < 60).map((c) => c.texto.trim());
    expect(cabecera, `hoja ${i + 1}: qué documento es`).toContain(documento);
    if (tema === "interno" && !esPortada) expect(cabecera, `hoja ${i + 1}`).toContain("No entregar al cliente");
    const membrete = cabecera.filter((texto) => texto !== documento && texto !== SELLO[tema] && texto !== "No entregar al cliente");
    if (identidad) {
      if (esPortada) expect(membrete.length, `hoja ${i + 1}: el membrete de la portada`).toBeGreaterThan(0);
      else expect(cabecera.join(" ").toLocaleLowerCase("es-ES"), `hoja ${i + 1}: el membrete`).toContain(identidad.toLocaleLowerCase("es-ES"));
    } else expect(membrete, `hoja ${i + 1}: sin membrete`).toEqual([]);
  });
  expect(extractPdfMetadata(bytes, "Author")).toBe(identidad);
}
