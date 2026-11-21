/**
 * El Excel de datos, leído de vuelta con SheetJS: las hojas que tiene que tener, sus
 * cabeceras y sus cifras clave, que son las del análisis y van como números, no como texto.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { read, utils, type WorkSheet } from "xlsx";
import { crearExcel } from "../../src/gestor/informes";
import { HOJAS_DEL_EXCEL } from "../../src/gestor/informes/excel/registro";
import { METRICAS } from "../../src/gestor/motor/metricas/registro";
import { datosDeLaDemo, datosVacios, SALIDA } from "./informesAyudas";

async function libroDe(blob: Blob, nombre: string) {
  const bytes = Buffer.from(await blob.arrayBuffer());
  mkdirSync(SALIDA, { recursive: true });
  writeFileSync(`${SALIDA}${nombre}.xlsx`, bytes);
  return read(bytes, { type: "buffer", cellNF: true, cellStyles: true });
}

const filas = (hoja: WorkSheet) => utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: null });
const celda = (hoja: WorkSheet, ref: string) => hoja[ref] as { t: string; v: unknown; z?: string } | undefined;

describe("el Excel de datos", () => {
  const datos = datosDeLaDemo("inicio");
  const a = datos.analisis;

  test("tiene las hojas esperadas, en orden", async () => {
    const libro = await libroDe(await crearExcel(datos), "datos-inicio");
    expect(libro.SheetNames).toEqual(["Resumen", "Posiciones", "Efectivo", "Movimientos", "Rentabilidad mensual", "Ingresos y costes", "Posiciones cerradas", "Composición", "Conciliación"]);
    expect(HOJAS_DEL_EXCEL.map((hoja) => hoja.nombre)).toEqual(libro.SheetNames);
  });

  test("las cifras clave son las del análisis, como números con su formato", async () => {
    const libro = await libroDe(await crearExcel(datos), "datos-inicio");
    /* Resumen: una fila por métrica del registro, en su orden; el valor es un número donde lo hay. */
    const resumen = libro.Sheets.Resumen;
    expect(filas(resumen)[0]).toEqual(["Métrica", "Valor", "Qué es"]);
    METRICAS.forEach((m, i) => {
      expect(celda(resumen, `A${i + 2}`)?.v).toBe(m.nombre);
      const valor = m.valor(a);
      if (valor !== null) {
        expect(celda(resumen, `B${i + 2}`)?.t, m.id).toBe("n");
        /* Una diferencia en puntos va en puntos (INF-29): la fracción × 100. */
        expect(celda(resumen, `B${i + 2}`)?.v as number, m.id).toBeCloseTo(m.formato === "puntos" ? valor * 100 : valor, 10);
      }
    });
    expect(celda(resumen, "B2")?.z).toBe("#,##0.00");
    expect(celda(resumen, "B4")?.z).toBe("0.00%");

    /* Posiciones: una fila por posición; el valor y el peso, números. */
    const posiciones = filas(libro.Sheets.Posiciones);
    expect(posiciones[0]).toContain("Valor");
    /* Fondo, ETF, acción o bono: «Producto», como en la pantalla (14-11-2026; antes, «Tipo»). El «Tipo» de un movimiento es otra cosa. */
    expect((posiciones[0] as string[]).slice(0, 4)).toEqual(["Activo", "ISIN", "Producto", "Divisa"]);
    expect(posiciones.length).toBe(a.posiciones.length + 1);
    const columnaDelValor = (posiciones[0] as string[]).indexOf("Valor");
    a.posiciones.forEach((p, i) => {
      expect(posiciones[i + 1][0]).toBe(p.activo.nombre);
      /* Las de la demostración tienen todas precio: con `null`, la comparación con NaN fallaría. */
      expect(posiciones[i + 1][columnaDelValor] as number).toBeCloseTo(p.valor ?? Number.NaN, 8);
    });

    /* Movimientos: todos los del periodo, con la fecha como fecha de Excel. */
    const movimientos = libro.Sheets.Movimientos;
    const lista = filas(movimientos);
    expect(lista[0]).toEqual(["Fecha operación", "Fecha valor", "Tipo", "Activo", "ISIN", "Títulos", "Precio", "Importe", "Divisa", "Comisión", "Gastos", "Retención", "Cupón corrido", "Cambio", "Valor", "Destino", "Nota", "Origen", "Id"]);
    expect(lista.length - 1).toBe(datos.cartera.movimientos.filter((m) => m.fechaOperacion > a.periodo.desde && m.fechaOperacion <= a.periodo.hasta).length);
    expect(celda(movimientos, "A2")?.t).toBe("n");
    expect(celda(movimientos, "A2")?.z).toBe("dd/mm/yyyy");
    /* La primera aportación: 150.000 € el día de inicio de la demostración (13-11-2023, serie 45243 en Excel). */
    expect(celda(movimientos, "A2")?.v).toBe(45243);
    expect(celda(movimientos, "H2")?.v).toBe(150000);

    /* Rentabilidad mensual: años en filas, doce meses y el total del año. */
    const mensual = filas(libro.Sheets["Rentabilidad mensual"]);
    /* Los meses, como en la pantalla y en los ejes: una sola lista, en minúsculas (FMT-09). */
    expect(mensual[0]).toEqual(["Año", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic", "Total", "Año incompleto"]);
    a.porMeses.forEach((anio, i) => {
      expect(mensual[i + 1][0]).toBe(anio.anio);
      expect(mensual[i + 1][13] as number).toBeCloseTo(anio.total, 12);
    });

    /* Ingresos y costes, cerradas, efectivo y conciliación. */
    const ingresos = filas(libro.Sheets["Ingresos y costes"]);
    const totales = ingresos.find((fila) => fila[0] === "Costes totales")!;
    expect(totales[1] as number).toBeCloseTo(a.ingresosYCostes.costesTotales, 8);
    expect(totales[2] as number).toBeCloseTo(a.ingresosYCostes.costesTotalesPct!, 12);
    const cerradas = filas(libro.Sheets["Posiciones cerradas"]);
    expect(cerradas.at(-1)![5] as number).toBeCloseTo(a.realizado!, 8);
    const efectivo = filas(libro.Sheets.Efectivo);
    expect(efectivo.at(-1)![3] as number).toBeCloseTo(a.efectivo.total, 8);
    const conciliacion = filas(libro.Sheets["Conciliación"]);
    expect(conciliacion[1][3]).toBe("Sí");

    /* Anchos de columna puestos en todas las hojas. */
    for (const nombre of libro.SheetNames) expect((libro.Sheets[nombre]["!cols"] ?? []).length, nombre).toBeGreaterThan(0);
  });

  test("con una cartera vacía no lanza y no inventa ceros", async () => {
    const libro = await libroDe(await crearExcel(datosVacios()), "datos-vacia");
    expect(libro.SheetNames).toHaveLength(9);
    const resumen = libro.Sheets.Resumen;
    METRICAS.forEach((_, i) => expect(celda(resumen, `B${i + 2}`)?.t).toBe("s"));
    expect(filas(libro.Sheets.Movimientos)).toHaveLength(1);
  });
});
