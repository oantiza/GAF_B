/**
 * Auditoría integral del 16-11-2026, hallazgo GES-6. Un extracto de posiciones que declara el mismo valor en varias filas
 * (15 títulos, en dos filas de 10 y 5) daba dos diferencias falsas al conciliar, y al proponer las posiciones iniciales
 * entraba solo la primera fila: 10 títulos y 120 € en vez de 15 y 180 €.
 *
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { revisar } from "../../src/gestor/importacion/revision";
import type { ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import { conciliar, posicionesPorActivo } from "../../src/gestor/motor/integridad";
import type { Activo, ExtractoDeclarado } from "../../src/gestor/motor/modelo";
import { valorar } from "../../src/gestor/motor/valoracion";
import { comprobar, proponerPosicionesIniciales } from "../../src/gestor/ui/importar/comprobacion";
import { elegidas } from "../../src/gestor/ui/importar/revisionDelAsistente";
import { activo, cartera, mov } from "./ayudas";

describe("GES-6 · conciliar: el mismo valor en varias filas es una sola posición", () => {
  /* El libro tiene 15 títulos de A, comprados a 10 € con 150 € aportados. */
  const c = cartera(
    [activo("A"), activo("B")],
    [mov("aportacion", "2024-01-01", { importe: "150" }), mov("compra", "2024-01-01", { activoId: "A", titulos: "15", precio: "10", importe: "-150" })]
  );
  const extracto = (posiciones: ExtractoDeclarado["posiciones"]): ExtractoDeclarado => ({ id: "e", fecha: "2024-01-10", posiciones, efectivo: [] });

  test("10 + 5 en dos filas cuadra con los 15 del libro, y cuenta como una posición comprobada", () => {
    const dosFilas = extracto([{ activoId: "A", nombre: "Activo A", titulos: "10", valor: "120" }, { activoId: "A", nombre: "Activo A", titulos: "5", valor: "60" }]);
    const conciliacion = conciliar(c, dosFilas);
    expect(conciliacion.diferencias).toEqual([]);
    expect(conciliacion.cuadra).toBe(true);
    expect(conciliacion.comprobadas).toBe(1);
    /* La suma: 10 + 5 = 15 títulos y 120 + 60 = 180 €. */
    expect(posicionesPorActivo(c, dosFilas)).toEqual([{ activoId: "A", nombre: "Activo A", titulos: "15", valor: "180" }]);
  });

  test("si de verdad falta algo, la diferencia es una y sobre el total: 15 en el libro frente a 12 + 6 = 18 declarados", () => {
    const conciliacion = conciliar(c, extracto([{ activoId: "A", nombre: "Activo A", titulos: "12" }, { activoId: "A", nombre: "Activo A", titulos: "6" }]));
    expect(conciliacion.diferencias.map((diferencia) => [diferencia.activoId, diferencia.enElLibro.toString(), diferencia.enElExtracto.toString(), diferencia.diferencia.toString()])).toEqual([
      ["A", "15", "18", "-3"]
    ]);
  });

  test("por ISIN se agrupa igual; el valor de la suma falta si falta el de una fila; y otro activo no se mezcla", () => {
    const conIsin = cartera([activo("A", "ACCION", "EUR", { isin: "ES0000000001" })], []);
    const filas = extracto([
      { isin: "ES0000000001", nombre: "Uno", titulos: "10", valor: "120" },
      { isin: "ES0000000001", nombre: "Uno", titulos: "5" },
      { isin: "ES0000000002", nombre: "Otro", titulos: "3", valor: "30" },
      { isin: "ES0000000002", nombre: "Otro", titulos: "4", valor: "40" }
    ]);
    expect(posicionesPorActivo(conIsin, filas)).toEqual([
      { isin: "ES0000000001", nombre: "Uno", titulos: "15" },
      { isin: "ES0000000002", nombre: "Otro", titulos: "7", valor: "70" }
    ]);
  });
});

describe("GES-6 · posiciones iniciales: entra la posición entera, no su primera fila", () => {
  const fondo: Activo = { id: "ES0000000001", isin: "ES0000000001", nombre: "FONDO X", tipo: "FONDO", divisa: "EUR", origen: "manual" };

  function importar(filas: Array<{ titulos: string; valor: string }>) {
    const vacia = cartera([fondo], []);
    const resultado: ResultadoDeImportacion = {
      importadorId: "andbank",
      entidad: "Andbank",
      documentos: [],
      avisos: [],
      errores: [],
      movimientos: [{ movimiento: { id: "p1", tipo: "aportacion", fechaOperacion: "2024-01-02", importe: "0.01" }, avisos: [], requiereRevision: false, documento: "d", fila: 1, textoOriginal: "" }],
      extractos: [{ fecha: "2024-01-10", documento: "pos", efectivo: [], posiciones: filas.map((fila) => ({ activo: { clave: fondo.isin!, isin: fondo.isin, nombre: fondo.nombre, tipo: "FONDO" as const }, ...fila })) }]
    };
    const revision = revisar([resultado], vacia, []);
    const marcadas = elegidas(revision, new Map());
    const antes = comprobar(vacia, [resultado], revision, marcadas, new Map());
    const iniciales = proponerPosicionesIniciales(antes, revision, marcadas, new Map());
    const despues = comprobar(vacia, [resultado], revision, marcadas, new Map(), iniciales.propuestas);
    const valoracion = valorar(despues.cartera, { precios: new Map(), cambios: new Map() }, { hasta: "2024-01-10" });
    return { iniciales, despues, patrimonio: valoracion.valor[valoracion.valor.length - 1] };
  }

  test("15 títulos por 180 € en una fila: se proponen 15 a 12 €, y el patrimonio es 180,01 €", () => {
    const { iniciales, despues, patrimonio } = importar([{ titulos: "15", valor: "180" }]);
    expect(iniciales.propuestas.map((propuesta) => [propuesta.movimiento.titulos, propuesta.movimiento.precio])).toEqual([["15", "12"]]);
    expect(despues.cuadra).toBe(true);
    /* 15 × 12 = 180 €, más el céntimo aportado. */
    expect(patrimonio).toBeCloseTo(180.01, 9);
  });

  test("los mismos 15 títulos en dos filas de 10 y 5 dan lo mismo: antes, 10 títulos y 120,01 €, sin cuadrar", () => {
    const { iniciales, despues, patrimonio } = importar([{ titulos: "10", valor: "120" }, { titulos: "5", valor: "60" }]);
    /* (120 + 60) / (10 + 5) = 12 € por título. */
    expect(iniciales.propuestas.map((propuesta) => [propuesta.movimiento.titulos, propuesta.movimiento.precio])).toEqual([["15", "12"]]);
    expect(despues.cuadra).toBe(true);
    expect(patrimonio).toBeCloseTo(180.01, 9);
  });
});
