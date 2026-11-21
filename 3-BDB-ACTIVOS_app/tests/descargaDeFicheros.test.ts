// @vitest-environment happy-dom
/**
 * ANA-19, INF-25 e INF-26: una sola función para el nombre de lo que se descarga y una sola para descargarlo
 * (`src/core/descargaDeFicheros.ts`). Los nombres esperados están escritos a mano, con la convención de «Carteras de clientes»:
 * documento - de quién o de qué - fecha, sin guiones sueltos, con tildes y eñes.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { descargar, diaDelDocumento, ESPERA_ANTES_DE_SOLTAR_MS, hoy, nombreDelFichero, sanearNombreDeFichero } from "../src/core/descargaDeFicheros";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("el nombre del fichero", () => {
  test.each([
    ["el ejemplo del encargo", { documento: "Informe de costes", de: "Familia García", fecha: "2026-11-14" }, "Informe de costes - Familia García - 2026-11-14.pdf"],
    ["tildes y eñes se conservan", { documento: "Simulación de jubilación", de: "Íñigo Muñoz Peña", fecha: "2026-11-14" }, "Simulación de jubilación - Íñigo Muñoz Peña - 2026-11-14.pdf"],
    ["sin cliente: ni el hueco ni el guion", { documento: "Informe de costes", fecha: "2026-11-14" }, "Informe de costes - 2026-11-14.pdf"],
    ["con un cliente vacío, igual", { documento: "Informe de costes", de: "   ", fecha: "2026-11-14" }, "Informe de costes - 2026-11-14.pdf"],
    ["sin fecha", { documento: "Plantilla de movimientos", extension: "csv" }, "Plantilla de movimientos.csv"],
    ["con periodo", { documento: "Informe del cliente", de: "Familia García", fecha: { desde: "2026-01-01", hasta: "2026-11-13" } }, "Informe del cliente - Familia García - 2026-01-01 a 2026-11-13.pdf"],
    ["con otra extensión", { documento: "Datos", de: "Familia García", fecha: "2026-11-14", extension: "xlsx" }, "Datos - Familia García - 2026-11-14.xlsx"],
    ["la extensión con su punto vale igual", { documento: "Datos", fecha: "2026-11-14", extension: ".xlsx" }, "Datos - 2026-11-14.xlsx"],
    ["lo que Windows no admite pasa a espacio", { documento: "Comparativa de propuestas", de: "Cartera 60/40: \"prudente\" <A|B>?*", fecha: "2026-11-14" }, "Comparativa de propuestas - Cartera 60 40 prudente A B - 2026-11-14.pdf"],
    ["un «de» hecho solo de prohibidos no deja guiones sueltos", { documento: "Informe de cartera", de: "/:*?", fecha: "2026-11-14" }, "Informe de cartera - 2026-11-14.pdf"],
    ["los controles y los espacios repetidos, fuera", { documento: "Informe  de\tcartera", de: "Familia\nGarcía ", fecha: "2026-11-14" }, "Informe de cartera - Familia García - 2026-11-14.pdf"],
    ["la comparativa de dos", { documento: "Comparativa de activos", de: "Fondo A frente a Fondo B", fecha: "2026-11-14" }, "Comparativa de activos - Fondo A frente a Fondo B - 2026-11-14.pdf"]
  ])("%s", (_caso, partes, esperado) => {
    expect(nombreDelFichero(partes)).toBe(esperado);
  });

  test("un nombre muy largo se corta antes de la extensión, que no se pierde", () => {
    const nombre = nombreDelFichero({ documento: "Informe de cartera", de: "Fondo ".repeat(60), fecha: "2026-11-14" });
    expect(nombre.endsWith(".pdf")).toBe(true);
    expect(nombre.length).toBeLessThanOrEqual(200);
  });

  test("el saneado, el mismo que tenía «Carteras de clientes»", () => {
    expect(sanearNombreDeFichero('García/López: "plan" <A|B>?*.')).toBe("García López plan A B");
    expect(sanearNombreDeFichero("CON")).toBe("_CON");
    expect(sanearNombreDeFichero("")).toBe("_");
    expect(sanearNombreDeFichero("Cartera...  ")).toBe("Cartera");
  });

  test("la fecha del documento: la ISO que imprime, o la de hoy si lo que imprime no es una fecha ISO", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
    expect(hoy()).toBe("2026-11-14");
    expect(diaDelDocumento("2026-11-05")).toBe("2026-11-05");
    expect(diaDelDocumento("2026-11-05T12:00:00Z")).toBe("2026-11-05");
    expect(diaDelDocumento(new Date("2026-11-09T12:00:00Z"))).toBe("2026-11-09");
    expect(diaDelDocumento("13 de octubre de 2026")).toBe("2026-11-14");
    expect(diaDelDocumento(undefined)).toBe("2026-11-14");
  });
});

describe("la descarga", () => {
  test("pulsa un enlace con el nombre, lo quita y suelta la dirección un minuto después, no antes", () => {
    vi.useFakeTimers();
    const crear = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:prueba");
    const soltar = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let pulsado: { nombre: string; direccion: string; enElDocumento: boolean } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      pulsado = { nombre: this.download, direccion: this.href, enElDocumento: document.body.contains(this) };
    });
    const contenido = new Blob(["hola"], { type: "text/plain" });
    descargar(contenido, "Informe de costes - Familia García - 2026-11-14.pdf");
    expect(crear).toHaveBeenCalledWith(contenido);
    expect(pulsado).toEqual({ nombre: "Informe de costes - Familia García - 2026-11-14.pdf", direccion: "blob:prueba", enElDocumento: true });
    expect(document.querySelectorAll("a")).toHaveLength(0);
    /* Soltarla en el acto corta la descarga en algunos navegadores. */
    expect(soltar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ESPERA_ANTES_DE_SOLTAR_MS - 1);
    expect(soltar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(soltar).toHaveBeenCalledWith("blob:prueba");
    expect(ESPERA_ANTES_DE_SOLTAR_MS).toBe(60_000);
  });

  test("si el clic falla, el enlace se quita igual y la dirección se suelta a su tiempo", () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:prueba");
    const soltar = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(() => descargar(new Blob(["x"]), "x.csv")).toThrow("bloqueado");
    expect(document.querySelectorAll("a")).toHaveLength(0);
    vi.advanceTimersByTime(ESPERA_ANTES_DE_SOLTAR_MS);
    expect(soltar).toHaveBeenCalledTimes(1);
  });
});

describe("nadie descarga a mano", () => {
  test("ningún fichero de la aplicación crea ni suelta direcciones de objeto por su cuenta", async () => {
    const { readdirSync, readFileSync: leer } = await import("node:fs");
    const { join } = await import("node:path");
    const todos = (carpeta: string): string[] =>
      readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) =>
        entrada.isDirectory() ? todos(join(carpeta, entrada.name)) : /\.tsx?$/.test(entrada.name) && !/\.test\./.test(entrada.name) ? [join(carpeta, entrada.name).replace(/\\/g, "/")] : []
      );
    const aMano = todos("src").filter((ruta) => ruta !== "src/core/descargaDeFicheros.ts" && /createObjectURL|revokeObjectURL/.test(leer(ruta, "utf8")));
    /* El último era la exportación de retrocesiones (`AdminRetrocessions.tsx`), que soltaba la dirección en el acto. */
    expect(aMano).toEqual([]);
  });

  test("los informes, el gestor y las posiciones descargan con la función común", async () => {
    const { readFileSync } = await import("node:fs");
    const ficheros = [
      "src/reports/assetComparePdf.tsx", "src/reports/comparePdf.tsx", "src/reports/costsPdf.tsx", "src/reports/fichaDeActivoPdf.tsx",
      "src/reports/improvementProposalPdf.tsx", "src/reports/informeDeClientePdf.tsx", "src/reports/internalPortfolioReportPdf.tsx",
      "src/reports/jubilacionPdf.tsx", "src/reports/propuestaDeCambioPdf.tsx", "src/reports/weeklyReportPdf.tsx",
      "src/gestor/informes/index.ts", "src/gestor/almacen/descarga.ts", "src/gestor/ui/importar/plantilla.ts", "src/core/positionsShared.ts",
      "src/components/AdminRetrocessions.tsx"
    ];
    for (const fichero of ficheros) {
      const fuente = readFileSync(fichero, "utf8");
      expect(fuente, fichero).not.toMatch(/createObjectURL|revokeObjectURL|\.download\s*=/);
      expect(fuente, fichero).toMatch(/descargar\(/);
    }
  });
});
