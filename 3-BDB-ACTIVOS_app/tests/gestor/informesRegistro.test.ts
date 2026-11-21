/**
 * El registro de secciones y las piezas sin papel de los informes: la lista de movimientos del
 * periodo, los nombres de fichero y el reparto en hojas.
 */
import { describe, expect, test } from "vitest";
import { renderizarInforme } from "../../src/gestor/informes/documento";
import { repartirEnHojas } from "../../src/reports/plantilla/secciones";
import { movimientosDelPeriodo, nombreDelFichero, sanearNombreDeFichero } from "../../src/gestor/informes";
import { SECCIONES_DE_COSTES, SECCIONES_DEL_ASESOR, SECCIONES_DEL_CLIENTE, seccionesDe } from "../../src/gestor/informes/registro";
import type { DatosDelInforme, SeccionDeInforme } from "../../src/gestor/informes/tipos";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import { extractPdfPageTexts } from "../support/pdfText";
import { activo, cartera, mov } from "./ayudas";
import { datosDeLaDemo, HOY } from "./informesAyudas";

describe("el registro de secciones", () => {
  for (const [nombre, lista] of [["cliente", SECCIONES_DEL_CLIENTE], ["asesor", SECCIONES_DEL_ASESOR], ["costes", SECCIONES_DE_COSTES]] as const) {
    test(`informe «${nombre}»: id único y título en cada sección`, () => {
      expect(new Set(lista.map((s) => s.id)).size).toBe(lista.length);
      for (const seccion of lista) {
        expect(seccion.id).toMatch(/^[a-zA-Z]+$/);
        expect(seccion.titulo.trim().length).toBeGreaterThan(0);
        expect(typeof seccion.procede).toBe("function");
        expect(typeof seccion.Contenido).toBe("function");
      }
    });
  }

  test("el informe del cliente ya no lleva costes; el de costes lleva sus secciones en orden", () => {
    expect(SECCIONES_DEL_CLIENTE.map((s) => s.id)).not.toContain("costes");
    /* La portada es ahora la presentación de la primera hoja, con la plantilla única (antes, «portada»). */
    expect(SECCIONES_DE_COSTES.map((s) => s.id)).toEqual(["presentacion", "sinDatos", "resumen", "servicio", "operaciones", "productos", "impuestos", "metodo"]);
    expect(seccionesDe("costes")).toBe(SECCIONES_DE_COSTES);
    expect(seccionesDe("cliente")).toBe(SECCIONES_DEL_CLIENTE);
  });

  test("quitar una sección no rompe las demás: el informe sale sin ella y con el resto", async () => {
    const datos = datosDeLaDemo("anio");
    for (const [tipo, lista] of [["cliente", SECCIONES_DEL_CLIENTE], ["asesor", SECCIONES_DEL_ASESOR]] as const) {
      const quitada = lista.find((s) => s.id === (tipo === "cliente" ? "referencia" : "cerradas"))!;
      const resto = lista.filter((s) => s !== quitada);
      const texto = extractPdfPageTexts(Buffer.from(await (await renderizarInforme(tipo, datos, resto)).arrayBuffer())).join("\n");
      expect(texto).not.toContain(quitada.titulo);
      /* La presentación y la portada (desde el 14-11-2026, la del informe de cartera) no imprimen su título. */
      for (const seccion of resto.filter((s) => s.procede(datos) && s.comienzo !== "presentacion" && s.comienzo !== "portada")) expect(texto, seccion.id).toContain(seccion.titulo);
    }
    /* Dos PDF enteros, el del cliente con el mapa: con la suite en paralelo pasaba de los cinco segundos del defecto. */
  }, 30_000);

  test("una sección nueva se añade con su módulo y la lista: el documento la imprime con su título", async () => {
    const datos = datosDeLaDemo("anio");
    const nueva: SeccionDeInforme = { id: "deMuestra", titulo: "Sección de muestra", procede: () => true, Contenido: () => null };
    const texto = extractPdfPageTexts(Buffer.from(await (await renderizarInforme("cliente", datos, [...SECCIONES_DEL_CLIENTE, nueva])).arrayBuffer())).join("\n");
    expect(texto).toContain("Sección de muestra");
  });

  /* El reparto lo hace ahora la plantilla (`repartirEnHojas` de `src/reports/plantilla/secciones.tsx`), con las secciones del gestor. */
  test("el reparto en hojas: las seguidas comparten hoja; una nueva o un cambio de orientación abren otra", () => {
    const s = (id: string, extra: Partial<SeccionDeInforme> = {}): SeccionDeInforme => ({ id, titulo: id, procede: () => true, Contenido: () => null, ...extra });
    const tiras = repartirEnHojas([s("a", { comienzo: "presentacion" }), s("b"), s("c", { apaisada: true }), s("g", { apaisada: true }), s("d"), s("e", { comienzo: "nueva" }), s("f")]);
    expect(tiras.map((t) => [t.apaisada, t.secciones.map((x) => x.id).join("")])).toEqual([[false, "ab"], [true, "cg"], [false, "d"], [false, "ef"]]);
  });
});

describe("los movimientos del periodo", () => {
  test("excluyen el día de inicio (es el cierre desde el que se mide) e incluyen el día final", () => {
    const a = activo("A");
    const movimientos = [
      mov("aportacion", "2026-01-01", { id: "antes", importe: "1000" }),
      mov("aportacion", "2026-03-31", { id: "inicio", importe: "1000" }),
      mov("compra", "2026-04-01", { id: "primero", activoId: "A", titulos: "5", precio: "100", importe: "-500" }),
      mov("aportacion", "2026-06-30", { id: "final", importe: "1000", nota: "Última" }),
      mov("aportacion", "2026-07-01", { id: "despues", importe: "1000" })
    ];
    const c = cartera([a], movimientos);
    const preparado = preparar(c, { precios: new Map([["A", [{ fecha: "2026-01-01", valor: 100 }]]]), cambios: new Map() }, new Map(), "2026-07-31");
    const datos: DatosDelInforme = { analisis: analizar(preparado, { desde: "2026-03-31", hasta: "2026-06-30" }), cartera: c, generado: HOY };
    const lista = movimientosDelPeriodo(datos);
    expect(lista.map((m) => m.id)).toEqual(["primero", "final"]);
    expect(lista[0]).toMatchObject({ operacion: "Compra", activo: "Activo A", titulos: 5, precio: 100, importe: -500, divisa: "EUR", origen: "Manual", fechaValor: "2026-04-01" });
    expect(lista[1]).toMatchObject({ tipo: "aportacion", activo: "", nota: "Última", titulos: null });
  });
});

describe("los nombres de fichero", () => {
  test("llevan el tipo, la cartera y el periodo, sin caracteres que Windows no admite", () => {
    const datos = datosDeLaDemo("anio");
    /* El inicio, con la regla del rótulo (MOT-09 y DIR-08): el cierre desde el que se mide. */
    expect(nombreDelFichero("cliente", datos.analisis)).toBe("Informe del cliente - Cartera de demostración - 2025-12-31 a 2026-11-13.pdf");
    expect(nombreDelFichero("asesor", datos.analisis)).toBe("Informe del asesor - Cartera de demostración - 2025-12-31 a 2026-11-13.pdf");
    expect(nombreDelFichero("costes", datos.analisis)).toBe("Informe de costes - Cartera de demostración - 2025-12-31 a 2026-11-13.pdf");
    expect(nombreDelFichero("excel", datos.analisis)).toBe("Datos - Cartera de demostración - 2025-12-31 a 2026-11-13.xlsx");
    expect(sanearNombreDeFichero('García/López: "plan" <A|B>?*.')).toBe("García López  plan  A B".replace(/\s+/g, " "));
    expect(sanearNombreDeFichero("CON")).toBe("_CON");
  });
});
