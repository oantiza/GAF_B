/**
 * Auditoría · arreglos de los informes del gestor: la nota de los precios del informe del cliente
 * (INF-11) y el Excel (INF-29).
 */
import { describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import { crearExcel } from "../../src/gestor/informes";
import { notaDeLosPrecios } from "../../src/gestor/informes/secciones/cliente/notas";
import type { Analisis } from "../../src/gestor/motor/analisis";
import { METRICAS } from "../../src/gestor/motor/metricas/registro";
import { FUENTE } from "../../src/gestor/motor/valoracion";
import { datosDeLaDemo } from "./informesAyudas";

const conPosiciones = (fuentes: Array<[string, number]>) => ({ posiciones: fuentes.map(([nombre, fuente]) => ({ activo: { nombre }, fuente })) }) as unknown as Analisis;

describe("INF-11 · el informe del cliente dice de dónde sale cada precio que no es de mercado", () => {
  it("todas de mercado: lo dice así", () => {
    expect(notaDeLosPrecios(conPosiciones([["Fondo A", FUENTE.mercado]]))).toBe("Los precios proceden de fuentes de mercado.");
  });

  it("con el precio del extracto del banco y sin precio: los nombra, y ya no dice que todos son de mercado", () => {
    const nota = notaDeLosPrecios(conPosiciones([["Fondo A", FUENTE.mercado], ["Bono B", FUENTE.extracto], ["Activo C", FUENTE.sinPrecio]]));
    expect(nota).toContain("Los demás precios proceden de fuentes de mercado.");
    expect(nota).toContain("Con el precio del extracto del banco, más reciente que el de mercado: Bono B.");
    expect(nota).toContain("Sin precio, y por eso cuentan como cero: Activo C.");
    expect(nota).not.toMatch(/^Los precios proceden/);
  });
});

describe("INF-29 · el Excel: el filtro de Resumen abarca solo las métricas, y los puntos van en puntos", () => {
  it("el filtro acaba en la última métrica y la diferencia con la referencia lleva formato de puntos", async () => {
    const datos = datosDeLaDemo("inicio");
    const libro = read(Buffer.from(await (await crearExcel(datos)).arrayBuffer()), { type: "buffer", cellNF: true });
    const resumen = libro.Sheets.Resumen;
    /* Cabecera en la fila 1 y una fila por métrica: la última, en la fila METRICAS.length + 1. */
    expect(resumen["!autofilter"]?.ref).toBe(`A1:C${METRICAS.length + 1}`);
    const i = METRICAS.findIndex((m) => m.formato === "puntos");
    const celda = resumen[`B${i + 2}`] as { v: number; z?: string };
    const valor = METRICAS[i].valor(datos.analisis)!;
    /* «pp», como en el resto de la app (apartado 6 de SISTEMA_DISENO.md); antes, «p.p.». */
    expect(celda.z).toBe('0.00" pp"');
    expect(celda.v).toBeCloseTo(valor * 100, 10); // en puntos: una fracción de 0,0123 son 1,23 pp
    expect(utils.sheet_to_json<unknown[]>(resumen, { header: 1 }).length).toBeGreaterThan(METRICAS.length + 1);
  });
});
