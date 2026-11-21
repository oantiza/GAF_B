/**
 * Lo que el importador no ha sabido clasificar no entra por defecto (decisión A-156 de Óscar, 16-11-2026, hallazgo GES-3).
 *
 * Un «Otro cargo o abono» cuenta como resultado de la cartera. Marcado por defecto, un ingreso del cliente con un rótulo
 * que el lector no conoce se convertía en rentabilidad. Fuera, la caja no cuadra con el banco, y eso se ve.
 */
import { describe, expect, it } from "vitest";
import { aplicarImportacion, revisar, sinClasificar } from "../../src/gestor/importacion/revision";
import type { MovimientoPropuesto, ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import { carteraVacia } from "../../src/gestor/motor/modelo";
import { elegidas, estaMarcada, estadoDeLaLinea, hayQueMirar } from "../../src/gestor/ui/importar/revisionDelAsistente";

const propuesto = (id: string, tipo: string, fecha: string, importe: string, revisar: boolean, avisos: string[] = []): MovimientoPropuesto => ({
  movimiento: { id, tipo, fechaOperacion: fecha, importe },
  avisos,
  requiereRevision: revisar,
  documento: "movimientos.xls",
  fila: 1,
  textoOriginal: `${fecha};${tipo};${importe}`
});

/* Cuatro apuntes de efectivo: el saldo inicial (que pide revisión y tiene que entrar), una aportación corriente, un abono
   que el lector no ha sabido clasificar y un cargo sin clasificar. */
const RESULTADO: ResultadoDeImportacion = {
  importadorId: "andbank",
  entidad: "Andbank",
  documentos: [{ nombre: "movimientos.xls", tipo: "movimientos", etiqueta: "Movimientos", filas: 4 }],
  movimientos: [
    propuesto("m0", "aportacion", "2025-01-02", "10000", true, ["El extracto empieza con un saldo de 10.000 €: se ha anotado como saldo inicial."]),
    propuesto("m1", "aportacion", "2025-02-03", "5000", false),
    propuesto("m2", "otroEfectivo", "2025-03-04", "20000", true, ["No reconozco el tipo «ABONO EN CUENTA»."]),
    propuesto("m3", "otroEfectivo", "2025-03-05", "-35", true, ["No reconozco el tipo «CARGO VARIOS»."])
  ],
  extractos: [],
  avisos: [],
  errores: []
};
const vacia = () => carteraVacia({ nombre: "Importada", ahora: "2026-01-01T00:00:00.000Z", id: "c" });

describe("lo sin clasificar no entra por defecto", () => {
  const revision = revisar([RESULTADO], vacia(), []);
  const linea = (id: string) => revision.lineas.find((candidata) => candidata.propuesto.movimiento.id === id)!;

  it("el abono y el cargo sin clasificar quedan sin marcar; el saldo inicial y la aportación, marcados", () => {
    expect(revision.lineas.map((l) => [l.propuesto.movimiento.id, l.porDefecto])).toEqual([["m0", true], ["m1", true], ["m2", false], ["m3", false]]);
    expect([revision.listas, revision.porRevisar]).toEqual([2, 2]);
    expect([...elegidas(revision, new Map())].sort()).toEqual(["m0", "m1"]);
    expect(sinClasificar(linea("m2").propuesto)).toBe(true);
    /* El saldo inicial pide revisión, pero no es un apunte sin clasificar: el libro lo necesita. */
    expect(sinClasificar(linea("m0").propuesto)).toBe(false);
  });

  it("se dicen «Sin clasificar», con lo que pasa si se marcan", () => {
    expect(estadoDeLaLinea(linea("m2"))).toEqual({
      etiqueta: "Sin clasificar",
      gravedad: "revisar",
      detalle: "No entra hasta que la marques. Si es dinero que el cliente pone o retira, cámbiale después el tipo: marcada cuenta como ganancia o pérdida."
    });
    expect(estadoDeLaLinea(linea("m0"))).toEqual({ etiqueta: "Revisar", gravedad: "revisar" });
    expect(estadoDeLaLinea(linea("m1"))).toEqual({ etiqueta: "Listo", gravedad: "listo" });
    expect(hayQueMirar(linea("m2"))).toBe(true);
  });

  it("el asesor puede marcarla, y entonces entra; sin marcarla, la caja se queda en lo que sí se ha clasificado", () => {
    expect(estaMarcada(linea("m2"), new Map([["m2", true]]))).toBe(true);
    /* Por defecto: 10.000 + 5.000 = 15.000 € de aportaciones, y ningún «otro». */
    const porDefecto = aplicarImportacion(vacia(), [RESULTADO], revision, elegidas(revision, new Map()), new Map(), "2026-01-01T00:00:00.000Z").cartera;
    expect(porDefecto.movimientos.map((m) => [m.tipo, m.importe])).toEqual([["aportacion", "10000"], ["aportacion", "5000"]]);
    /* Con las dos marcadas a mano entran como «Otro cargo o abono». */
    const conTodo = aplicarImportacion(vacia(), [RESULTADO], revision, elegidas(revision, new Map([["m2", true], ["m3", true]])), new Map(), "2026-01-01T00:00:00.000Z").cartera;
    expect(conTodo.movimientos.filter((m) => m.tipo === "otroEfectivo").map((m) => m.importe)).toEqual(["20000", "-35"]);
  });
});
