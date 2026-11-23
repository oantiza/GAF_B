/**
 * Una línea cuyo importe no cuadra con sus títulos y su precio no entra por defecto (decisión 1 de la auditoría consolidada
 * del 22-11-2026, H2-19; aprobada por Óscar el 23-11-2026). Sigue el patrón de A-156: desmarcada, contada «por revisar», y
 * el asesor puede marcarla. No bloquea.
 *
 * Antes la guarda del 2 % (`descuadreDelImporte`) ponía el aviso y la línea quedaba «Revisar», pero marcada: el resumen
 * decía «5 movimientos listos» con dos de ellos en «Revisar», y un ×100 entraba con solo pulsar «Importar».
 *
 * Las cuentas, a mano (todo en euros, acciones sin multiplicador):
 * - Aportación de 10.000 €: no tiene títulos ni precio; la guarda no mira.
 * - A: 100 × 98,5 = 9.850 €, y la fila dice 9.850 €. Cuadra.
 * - B: 100 × 10 = 1.000 €; 1.000 × 1,02 = 1.020 € es lo más que se admite; la fila dice 1.015 € (un 1,5 %). Cuadra.
 * - C: 100 × 10 = 1.000 €; la fila dice 1.030 € (un 3 %, más que el 2 %). No cuadra.
 * - D: 10 × 250 = 2.500 €; la fila dice 25 € (cien veces menos, unos peniques leídos como libras). No cuadra.
 * Listas: la aportación, A y B = 3. Por revisar: C y D = 2. Antes: 5 listas y 0 por revisar.
 */
import { describe, expect, it } from "vitest";
import { importadorDePlantilla } from "../../src/gestor/importacion/plantilla";
import { aplicarImportacion, revisar } from "../../src/gestor/importacion/revision";
import type { DocumentoLeido, ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import { carteraVacia, type Cartera } from "../../src/gestor/motor/modelo";
import { elegidas, estaMarcada, estadoDeLaLinea, hayQueMirar, resumenDeLaRevision, seleccionable } from "../../src/gestor/ui/importar/revisionDelAsistente";

const CABECERA = ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Importe"];
const FILAS = [
  CABECERA,
  ["05/01/2026", "Aportación", "", "", "", "", "10000"],
  ["07/01/2026", "Compra de acciones", "ES0000000011", "Acción A", "100", "98,5", "-9850"],
  ["08/01/2026", "Compra de acciones", "ES0000000029", "Acción B", "100", "10", "-1015"],
  ["09/01/2026", "Compra de acciones", "ES0000000037", "Acción C", "100", "10", "-1030"],
  ["12/01/2026", "Compra de acciones", "ES0000000045", "Acción D", "10", "250", "-25"]
];

function importar(): ResultadoDeImportacion {
  const documento: DocumentoLeido = { nombre: "plantilla.xlsx", texto: "", tablas: [FILAS] };
  const resultado = importadorDePlantilla.importar([{ documento, tipo: "movimientos" }], { divisaBase: "EUR" });
  expect(resultado.errores).toEqual([]);
  return resultado;
}

const vacia = (): Cartera => carteraVacia({ nombre: "Importada", ahora: "2026-01-01T00:00:00.000Z", id: "c" });

describe("una línea con el importe descuadrado entra desmarcada (decisión 1, H2-19)", () => {
  const resultado = importar();
  const revision = revisar([resultado], vacia(), []);
  const deLaAccion = (letra: string) => revision.lineas.find((linea) => linea.propuesto.activo?.nombre === `Acción ${letra}`)!;

  it("las dos que no cuadran no van marcadas, y el resumen las cuenta por revisar: 3 listas y 2 por revisar", () => {
    expect(revision.lineas.map((linea) => [linea.propuesto.activo?.nombre ?? linea.propuesto.movimiento.tipo, linea.porDefecto, linea.conDescuadre])).toEqual([
      ["aportacion", true, false],
      ["Acción A", true, false],
      ["Acción B", true, false],
      ["Acción C", false, true],
      ["Acción D", false, true]
    ]);
    expect([revision.listas, revision.porRevisar, revision.duplicadas]).toEqual([3, 2, 0]);
    expect(resumenDeLaRevision(revision)).toBe("3 movimientos listos · 2 por revisar");
    expect(elegidas(revision, new Map()).size).toBe(3);
  });

  it("dicen «Revisar» y que no entran hasta marcarlas, con el aviso de las dos cifras", () => {
    for (const letra of ["C", "D"]) {
      const linea = deLaAccion(letra);
      expect(estadoDeLaLinea(linea)).toEqual({ etiqueta: "Revisar", gravedad: "revisar", detalle: "No entra hasta que la marques: el importe no cuadra con los títulos y el precio." });
      expect(hayQueMirar(linea)).toBe(true);
      expect(seleccionable(linea)).toBe(true);
    }
    /* 100 × 10 = 1.000 €, frente a 1.030 €. */
    /* El formato separa la cifra del «€» con un espacio duro: se compara con espacios corrientes. */
    expect(deLaAccion("C").avisos.map((aviso) => aviso.replace(/\s/g, " "))).toEqual(["El importe no cuadra con los títulos y el precio: con 100 títulos a 10,00 € sería 1.000,00 €, y la fila dice 1.030,00 €."]);
    /* La que cuadra dentro del 2 % sigue «Listo», sin aviso. */
    expect(estadoDeLaLinea(deLaAccion("B"))).toEqual({ etiqueta: "Listo", gravedad: "listo" });
  });

  it("el asesor puede marcarlas, y entonces entran; sin marcarlas, entran las otras tres", () => {
    const porDefecto = aplicarImportacion(vacia(), [resultado], revision, elegidas(revision, new Map()), new Map(), "2026-11-23T10:00:00.000Z").cartera;
    /* 10.000 de aportación y −9.850 y −1.015 de compras. */
    expect(porDefecto.movimientos.map((m) => m.importe)).toEqual(["10000", "-9850", "-1015"]);

    const marcas = new Map([[deLaAccion("D").propuesto.movimiento.id, true]]);
    expect(estaMarcada(deLaAccion("D"), marcas)).toBe(true);
    expect(estaMarcada(deLaAccion("C"), marcas)).toBe(false);
    const conD = aplicarImportacion(vacia(), [resultado], revision, elegidas(revision, marcas), new Map(), "2026-11-23T10:00:00.000Z").cartera;
    expect(conD.movimientos.map((m) => m.importe)).toEqual(["10000", "-9850", "-1015", "-25"]);
  });
});
