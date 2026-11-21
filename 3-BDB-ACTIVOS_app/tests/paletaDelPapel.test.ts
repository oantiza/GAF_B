import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * El papel no se toca de rebote. Tres PDF importaban la paleta de pantalla y cambiaron de
 * color el 03-11-2026 sin que nadie lo decidiera; ninguna prueba lo vio.
 *
 * Desde el 14-11-2026 los papeles de antes (`clientReportTheme`, `pdfTheme`, `papelDeCliente`, `paletaDelPapel`) ya no existen:
 * todos los informes salen de la plantilla única. Lo que se sigue vigilando es lo mismo, en todo lo que compone un PDF: los ficheros
 * de `src/reports/` y de sus carpetas (la plantilla, el informe de cliente) y los informes de Carteras de clientes, en
 * `src/gestor/informes/`.
 */
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const REPORTS = fileURLToPath(new URL("../src/reports/", import.meta.url));

function ficherosDe(carpeta: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) ficherosDe(ruta, salida);
    else if (/\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** Todo lo que compone un PDF, con su ruta desde `src/`. */
const DEL_PAPEL = [...ficherosDe(REPORTS), ...ficherosDe(join(SRC, "gestor", "informes"))].map((ruta) => ({
  ruta: relative(SRC, ruta).split("\\").join("/"),
  fuente: readFileSync(ruta, "utf8")
}));

describe("los informes no dependen de la paleta de pantalla", () => {
  test("hay ficheros que mirar en las tres partes: reports, sus carpetas y los informes del gestor", () => {
    const rutas = DEL_PAPEL.map(({ ruta }) => ruta);
    expect(rutas.some((ruta) => /^reports\/[^/]+$/.test(ruta))).toBe(true);
    expect(rutas.some((ruta) => ruta.startsWith("reports/plantilla/"))).toBe(true);
    expect(rutas.some((ruta) => ruta.startsWith("gestor/informes/"))).toBe(true);
  });

  test("ningún informe importa core/theme ni core/coloresDeClase", () => {
    const culpables = DEL_PAPEL.filter(({ fuente }) => /from\s+"[^"]*core\/(theme|coloresDeClase)"/.test(fuente)).map(({ ruta }) => ruta);
    expect(culpables).toEqual([]);
  });

  test("ningún informe toma los colores de zona de la pantalla", () => {
    const culpables = DEL_PAPEL.filter(({ fuente }) => /\b(zoneColor|ZONE_CHIP)\b/.test(fuente)).map(({ ruta }) => ruta);
    expect(culpables).toEqual([]);
  });

  /* Lo único que tomaba, los tramos de la matriz de solapamiento, se fue con la matriz (10-11-2026): ahora no toma nada, ni con color ni sin él. */
  /* Desde la plantilla única el informe vive también en su carpeta `informeDeCliente/`: se miran todos sus ficheros, y que no importa
     ni la paleta de pantalla ni las de los papeles de antes. */
  test("el informe de cliente no toma nada de los gráficos de pantalla", () => {
    const carpeta = REPORTS + "informeDeCliente/";
    const fuentes = [REPORTS + "informeDeClientePdf.tsx", ...readdirSync(carpeta).map((nombre) => carpeta + nombre)].map((ruta) => readFileSync(ruta, "utf8"));
    for (const fuente of fuentes) {
      expect(fuente).not.toMatch(/from\s+"[^"]*charts\/oaa\//);
      expect(fuente).not.toMatch(/from\s+"[^"]*(core\/theme|clientReportTheme|pdfTheme|paletaDelPapel|papelDeCliente)"/);
    }
  });

  /* Desde el 14-11-2026 el informe de costes, la comparativa de propuestas, la propuesta de cambio y la simulación de jubilación salen de la
     plantilla única: su letra y sus colores son los de la plantilla, no importan ninguno de los papeles de antes y no llevan colores propios.
     (Hasta entonces esta prueba exigía que el informe de costes importara el tema del papel de cliente.) */
  test.each(["costsPdf.tsx", "comparePdf.tsx", "propuestaDeCambioPdf.tsx", "jubilacionPdf.tsx"])("%s sale de la plantilla única y no lleva colores propios", (fichero) => {
    const fuente = readFileSync(REPORTS + fichero, "utf8");
    expect(fuente).toMatch(/from\s+"\.\/plantilla"/);
    expect(fuente).not.toMatch(/from\s+"[^"]*(core\/theme|clientReportTheme|pdfTheme|paletaDelPapel|papelDeCliente)"/);
    expect(fuente).not.toMatch(/PDF_FONT|refreshOaaPdfFonts|refreshClientReportFonts|Fraunces|Roboto|Newsreader|InstrumentSans|Instrument Sans/);
    expect(fuente).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
  });
});
