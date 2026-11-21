/**
 * De los documentos a la cartera, de extremo a extremo: reconocer, importar, revisar,
 * aplicar, conciliar, volver a importar (duplicados) y deshacer.
 */
import { describe, expect, it } from "vitest";
import { importarReconocidos, reconocer } from "../../src/gestor/importacion/registro";
import { activoPropioPara, aplicarImportacion, deshacerImportacion, revisar, sugerenciasPorNombre, type DecisionSobreUnActivo } from "../../src/gestor/importacion/revision";
import type { ActivoDeCatalogo } from "../../src/gestor/mercado/fichas";
import { conciliar } from "../../src/gestor/motor/integridad";
import { construirLibro } from "../../src/gestor/motor/libro";
import { carteraVacia } from "../../src/gestor/motor/modelo";
import {
  ISIN_BOLSA,
  ISIN_ELECTRICA,
  ISIN_MIXTO,
  ISIN_TECNOLOGIA,
  MOVIMIENTOS_COMPLETOS,
  OPERACIONES_COMPLETAS,
  POSICIONES_COMPLETAS,
  documento
} from "./andbankDeMuestra";

const CATALOGO: ActivoDeCatalogo[] = [
  { isin: ISIN_BOLSA, nombre: "Fondo Bolsa Mundial", tipo: "FONDO", divisa: "EUR" },
  { isin: ISIN_TECNOLOGIA, nombre: "Tecnologia Global Inc", tipo: "ACCION", divisa: "USD", ticker: "TGI" },
  { isin: "LU0000009999", nombre: "Otro Fondo Mixto Europa", tipo: "FONDO", divisa: "EUR" }
];

const DOCUMENTOS = [documento("mov.xls", MOVIMIENTOS_COMPLETOS), documento("pos.xls", POSICIONES_COMPLETAS), documento("ops.xls", OPERACIONES_COMPLETAS)];
const vacia = () => carteraVacia({ nombre: "Importada", ahora: "2026-01-01T00:00:00.000Z", id: "c" });

function importarTodo() {
  const reconocidos = DOCUMENTOS.map(reconocer);
  return { reconocidos, resultados: importarReconocidos(reconocidos, { divisaBase: "EUR" }) };
}

describe("reconocer los documentos", () => {
  it("dice de qué entidad y de qué tipo es cada uno", () => {
    const { reconocidos } = importarTodo();
    expect(reconocidos.map((reconocido) => [reconocido.importador?.entidad, reconocido.tipo])).toEqual([
      ["Andbank", "movimientos"],
      ["Andbank", "posiciones"],
      ["Andbank", "operaciones"]
    ]);
  });

  it("si no reconoce un documento, dice qué se intentó", () => {
    const desconocido = reconocer(documento("carta.html", "<html><body><table><tr><td>Estimado cliente</td></tr></table></body></html>"));
    expect(desconocido.importador).toBeUndefined();
    expect(desconocido.intentos.some((intento) => intento.startsWith("Andbank:"))).toBe(true);
    expect(desconocido.intentos.some((intento) => intento.startsWith("Plantilla"))).toBe(true);
  });
});

describe("revisar lo que se va a cargar", () => {
  const { resultados } = importarTodo();

  it("un solo resultado para los tres documentos de la entidad, sin errores", () => {
    expect(resultados).toHaveLength(1);
    expect(resultados[0].errores).toEqual([]);
    expect(resultados[0].documentos.map((doc) => doc.tipo).sort()).toEqual(["movimientos", "operaciones", "posiciones"]);
  });

  it("identifica cada activo: en el catálogo por ISIN, nuevo con ISIN, o por decidir", () => {
    const revision = revisar(resultados, vacia(), CATALOGO);
    const estados = Object.fromEntries(revision.activos.map((activo) => [activo.citado.isin ?? activo.citado.nombre, activo.estado]));
    expect(estados[ISIN_BOLSA]).toBe("en-catalogo");
    expect(estados[ISIN_TECNOLOGIA]).toBe("en-catalogo");
    expect(estados[ISIN_ELECTRICA]).toBe("nuevo"); // trae ISIN y el catálogo no lo tiene: activo propio, con precio a mano
    expect(estados[ISIN_MIXTO]).toBe("nuevo");
    // El del catálogo se da de alta con su nombre y su divisa del catálogo.
    expect(revision.activos.find((activo) => activo.citado.isin === ISIN_TECNOLOGIA)?.propuesto).toMatchObject({ id: ISIN_TECNOLOGIA, origen: "catalogo", divisa: "USD" });
  });

  it("propone coincidencias del catálogo por nombre", () => {
    expect(sugerenciasPorNombre("FONDO BOLSA MUNDIAL CLASE A", CATALOGO).map((activo) => activo.isin)).toEqual([ISIN_BOLSA]);
    expect(sugerenciasPorNombre("TECNOLOGIA GLOBAL", CATALOGO).map((activo) => activo.isin)).toEqual([ISIN_TECNOLOGIA]);
    expect(sugerenciasPorNombre("NADA QUE VER", CATALOGO)).toEqual([]);
  });
});

describe("aplicar, conciliar, duplicados y deshacer", () => {
  const { resultados } = importarTodo();
  const revision = revisar(resultados, vacia(), CATALOGO);
  const todas = new Set(revision.lineas.filter((linea) => linea.movimiento && linea.errores.length === 0).map((linea) => linea.propuesto.movimiento.id));
  const { cartera, importacion } = aplicarImportacion(vacia(), resultados, revision, todas, new Map(), "2026-11-13T10:00:00.000Z");

  it("los movimientos entran en el libro con su marca de importación y sin errores", () => {
    expect(cartera.movimientos.length).toBe(todas.size);
    expect(cartera.movimientos.length).toBeGreaterThan(10);
    expect(cartera.movimientos.every((movimiento) => movimiento.origen?.importacionId === importacion.id && movimiento.origen.via === "importado")).toBe(true);
    expect(importacion.movimientos).toBe(todas.size);
    expect(construirLibro(cartera).avisos).toEqual([]);
    expect(cartera.importaciones).toHaveLength(1);
  });

  it("la cartera cuadra con lo que declaran los extractos: títulos y efectivo", () => {
    expect(cartera.extractos.length).toBe(2); // uno de posiciones y otro de efectivo
    for (const extracto of cartera.extractos) {
      const conciliacion = conciliar(cartera, extracto);
      expect(conciliacion.diferencias.map((dif) => `${dif.concepto}: libro ${dif.enElLibro.toFixed()} / extracto ${dif.enElExtracto.toFixed()}`)).toEqual([]);
    }
  });

  it("importar los mismos documentos otra vez no propone nada nuevo: todo son duplicados", () => {
    const otraVez = revisar(resultados, cartera, CATALOGO);
    expect(otraVez.listas).toBe(0);
    expect(otraVez.duplicadas).toBe(todas.size);
    expect(otraVez.activos.every((activo) => activo.estado === "en-cartera")).toBe(true);
  });

  it("deshacer la importación deja la cartera como estaba", () => {
    const deshecha = deshacerImportacion(cartera, importacion.id, "2026-11-13T11:00:00.000Z");
    expect(deshecha.movimientos).toEqual([]);
    expect(deshecha.activos).toEqual([]);
    expect(deshecha.extractos).toEqual([]);
    expect(deshecha.importaciones).toEqual([]);
  });

  it("dejar fuera un activo deja fuera sus movimientos y nada más", () => {
    const decisiones = new Map<string, DecisionSobreUnActivo>([[ISIN_ELECTRICA, "omitir"]]);
    const sinElectrica = revisar(resultados, vacia(), CATALOGO, decisiones);
    const fuera = sinElectrica.lineas.filter((linea) => linea.propuesto.activo?.clave === ISIN_ELECTRICA);
    expect(fuera.length).toBeGreaterThan(0);
    expect(fuera.every((linea) => !linea.porDefecto && linea.motivo === "Se ha dejado fuera su activo.")).toBe(true);
    expect(sinElectrica.listas).toBe(revision.listas - fuera.filter((linea) => revision.lineas.find((otra) => otra.propuesto === linea.propuesto)?.porDefecto).length);
  });

  it("un activo que solo viene por nombre se puede dar de alta como propio", () => {
    const propio = activoPropioPara({ clave: "ACCION RARA", nombre: "Acción Rara, S.A.", tipo: "ACCION" }, "EUR");
    expect(propio).toMatchObject({ nombre: "Acción Rara, S.A.", tipo: "ACCION", divisa: "EUR", origen: "manual" });
    expect(propio.id.startsWith("propio-")).toBe(true);
  });
});
