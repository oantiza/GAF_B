/**
 * A-210 (decisión de Óscar del 21-11-2026): la hoja «Posiciones» de la plantilla lleva una columna opcional de precio, en la
 * divisa del activo, con esa divisa al lado en «Divisa». Se lee como el «Precio de mercado» de Andbank (A-205): la posición
 * se valora a ese precio en vez de deducirlo del valor en euros. Sin la columna, todo como antes.
 *
 * La cartera es la de A-205: 100 acciones en dólares que entran a 90 $ el 02-01-2026, con el dólar a 1,125 por euro ese día y a
 * 1,10 el 05-01, y una hoja de posiciones del 05-01 que declara 9.000 € de valor y, si lleva la columna, 99,55 $ de precio.
 *
 *   con el precio:      99,55 $; 100 × 99,55 / 1,10 = 9.955 / 1,10 = 9.050,00 €
 *   sin él (como antes): 9.000 × 1,10 / 100 = 99,00 $; 100 × 99 / 1,10 = 9.000,00 €
 *
 * Y un bono, porque la plantilla da su precio en % del nominal, como en la hoja de movimientos, y la posición declarada lo
 * guarda por título, como Andbank: 98,5 % × 0,01 = 0,985 por unidad de nominal. Un bono no toma precio de un extracto al
 * valorarse, pero sí al proponer su posición inicial: al 98,5 % con la columna, y sin ella, de su valor, 9.900 / (10.000 ×
 * 0,01) = 99 %.
 *
 * Cada cifra esperada sale de esas cuentas, no del motor.
 */
import { describe, expect, it } from "vitest";
import { importadorDePlantilla } from "../../src/gestor/importacion/plantilla";
import { aplicarImportacion, revisar } from "../../src/gestor/importacion/revision";
import type { DocumentoLeido, ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import type { ActivoDeCatalogo } from "../../src/gestor/mercado/fichas";
import { carteraVacia, type Activo, type Cartera } from "../../src/gestor/motor/modelo";
import { FUENTE, valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { comprobar, proponerPosicionesIniciales } from "../../src/gestor/ui/importar/comprobacion";
import { elegidas } from "../../src/gestor/ui/importar/revisionDelAsistente";
import { serie } from "./ayudas";

const DIA = "2026-01-05";
const ISIN = "US0000000043";
const ISIN_BONO = "ES0000000052";
const CATALOGO: ActivoDeCatalogo[] = [{ isin: ISIN, nombre: "Accion americana", tipo: "ACCION", divisa: "USD" }];
const BONO: Activo = { id: "B", isin: ISIN_BONO, nombre: "Bono de prueba", tipo: "BONO", divisa: "EUR", multiplicador: "0.01", origen: "manual" };
const MERCADO: DatosDeMercado = { precios: new Map(), cambios: new Map([["USD", serie(["2026-01-02", 1.125], [DIA, 1.1])]]) };

const MOVIMIENTOS = [
  ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Divisa del activo"],
  ["02/01/2026", "Entrada de títulos", ISIN, "Accion americana", "100", "90", "USD"],
  ["02/01/2026", "Entrada de títulos", ISIN_BONO, "Bono de prueba", "10000", "97", "EUR"]
];
const SIN_PRECIO = [
  ["Fecha", "ISIN", "Nombre", "Títulos", "Valor", "Divisa"],
  ["05/01/2026", ISIN, "Accion americana", "100", "9000", "USD"],
  ["05/01/2026", ISIN_BONO, "Bono de prueba", "10000", "9800", "EUR"]
];
const CON_PRECIO = [
  ["Fecha", "ISIN", "Nombre", "Títulos", "Valor", "Precio", "Divisa"],
  ["05/01/2026", ISIN, "Accion americana", "100", "9.000", "99,55", "USD"],
  ["05/01/2026", ISIN_BONO, "Bono de prueba", "10000", "9800", "98,5", "EUR"]
];

function importar(posiciones: string[][]): ResultadoDeImportacion {
  const doc: DocumentoLeido = { nombre: "plantilla.xlsx", texto: "", tablas: [MOVIMIENTOS, posiciones] };
  return importadorDePlantilla.importar([{ documento: doc, tipo: "movimientos" }], { divisaBase: "EUR" });
}

/** De la plantilla a la cartera, con la acción del catálogo y el bono decidido con su multiplicador. */
function aplicar(posiciones: string[][]): Cartera {
  const resultados = [importar(posiciones)];
  expect(resultados[0].errores).toEqual([]);
  const vacia = carteraVacia({ nombre: "Plantilla", ahora: "2026-01-01T00:00:00.000Z", id: "c" });
  const decisiones = new Map([[ISIN_BONO, BONO]]);
  const revision = revisar(resultados, vacia, CATALOGO, decisiones);
  const elegidas = new Set(revision.lineas.filter((linea) => linea.movimiento && linea.errores.length === 0).map((linea) => linea.propuesto.movimiento.id));
  expect(elegidas.size).toBe(2);
  return aplicarImportacion(vacia, resultados, revision, elegidas, decisiones, "2026-11-21T10:00:00.000Z").cartera;
}

describe("la lectura de la hoja «Posiciones»", () => {
  it("sin la columna, como antes: ni precio ni cotización", () => {
    const resultado = importar(SIN_PRECIO);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.extractos[0].posiciones.map((posicion) => ({ ...posicion, activo: posicion.activo.clave }))).toEqual([
      { activo: ISIN, titulos: "100", valor: "9000" },
      { activo: ISIN_BONO, titulos: "10000", valor: "9800" }
    ]);
  });

  it("con ella, la cotización tal como se escribe, con su divisa", () => {
    const resultado = importar(CON_PRECIO);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.extractos[0].posiciones.map((posicion) => ({ ...posicion, activo: posicion.activo.clave }))).toEqual([
      { activo: ISIN, titulos: "100", valor: "9000", cotizacion: "99.55", divisa: "USD" },
      { activo: ISIN_BONO, titulos: "10000", valor: "9800", cotizacion: "98.5", divisa: "EUR" }
    ]);
  });

  it("un precio que no se entiende, que no es positivo o sin su divisa se deja fuera con un aviso, y la fila entra", () => {
    const filas = [
      CON_PRECIO[0],
      ["05/01/2026", ISIN, "Accion americana", "100", "9000", "noventa", "USD"],
      ["05/01/2026", ISIN, "Accion americana", "100", "9000", "0", "USD"],
      ["05/01/2026", ISIN, "Accion americana", "100", "9000", "99,55", ""]
    ];
    const resultado = importar(filas);
    expect(resultado.avisos).toEqual([
      "«plantilla.xlsx», posiciones, fila 2: la columna «Precio» dice «noventa», que no es una cifra; la posición se lee sin precio.",
      "«plantilla.xlsx», posiciones, fila 3: el precio ha de ser mayor que cero; la posición se lee sin precio.",
      "«plantilla.xlsx», posiciones, fila 4: hay precio pero falta su divisa en «Divisa»; la posición se lee sin precio."
    ]);
    const posiciones = resultado.extractos[0].posiciones;
    expect(posiciones).toHaveLength(3);
    for (const posicion of posiciones) {
      expect(posicion.cotizacion).toBeUndefined();
      expect(posicion.precio).toBeUndefined();
      expect(posicion.valor).toBe("9000");
    }
  });
});

describe("la cartera que sale de la plantilla", () => {
  /* Un bono no toma precio de un extracto en la valoración, con columna o sin ella (`preciosEfectivos`: su valor declarado
     lleva el cupón corrido): sigue al 97 % de su entrada, 9.700 €. Su precio cuenta en las posiciones iniciales, más abajo. */
  it("con el precio, la posición en dólares vale 99,55 $ y 9.050,00 €; el bono guarda 0,985 por unidad de nominal", () => {
    const cartera = aplicar(CON_PRECIO);
    const [accion, bono] = cartera.extractos[0].posiciones;
    /* La acción, por título tal cual (multiplicador 1); el bono, 98,5 × 0,01 = 0,985 por unidad de nominal, como lo da Andbank. */
    expect([accion.activoId, accion.precio, accion.divisa]).toEqual([ISIN, "99.55", "USD"]);
    expect([bono.activoId, bono.precio, bono.divisa]).toEqual(["B", "0.985", "EUR"]);
    const v = valorar(cartera, MERCADO, { hasta: DIA });
    const k = v.indice.get(DIA)!;
    expect(v.porActivo.get(ISIN)!.precio[k]).toBeCloseTo(99.55, 10);
    expect(v.porActivo.get(ISIN)!.fuente[k]).toBe(FUENTE.extracto);
    expect(v.porActivo.get("B")!.precio[k]).toBeCloseTo(97, 10);
    /* 9.050 + 9.700 = 18.750 €. El día 2: 100 × 90 / 1,125 = 8.000 € y 9.700 € del bono, 17.700 €. */
    expect(v.valor[k]).toBeCloseTo(18750, 8);
    expect(v.valor[0]).toBeCloseTo(17700, 8);
  });

  it("sin la columna, como antes: 99,00 $ y 9.000,00 €", () => {
    const cartera = aplicar(SIN_PRECIO);
    for (const posicion of cartera.extractos[0].posiciones) {
      expect(posicion.precio).toBeUndefined();
      expect(posicion.divisa).toBeUndefined();
    }
    const v = valorar(cartera, MERCADO, { hasta: DIA });
    const k = v.indice.get(DIA)!;
    expect(v.porActivo.get(ISIN)!.precio[k]).toBeCloseTo(99, 10);
    /* 9.000 + 9.700 = 18.700 €. */
    expect(v.valor[k]).toBeCloseTo(18700, 8);
  });
});

describe("las posiciones iniciales que propone la importación", () => {
  /* Solo una aportación en movimientos, y la hoja de posiciones con dos activos que el libro no tiene: 10 acciones en dólares
     (450 € de valor; con la columna, 50 $) y 10.000 de nominal del bono (9.900 € de valor; con la columna, 98,5 %). */
  const SOLO_APORTACION = [["Fecha", "Tipo", "Importe"], ["02/01/2026", "Aportación", "1000"]];
  const posiciones = (conPrecio: boolean) => [
    ["Fecha", "ISIN", "Nombre", "Títulos", "Valor", ...(conPrecio ? ["Precio"] : []), "Divisa"],
    ["05/01/2026", ISIN, "Accion americana", "10", "450", ...(conPrecio ? ["50"] : []), "USD"],
    ["05/01/2026", ISIN_BONO, "Bono de prueba", "10000", "9900", ...(conPrecio ? ["98,5"] : []), "EUR"]
  ];
  function propuestas(conPrecio: boolean) {
    const doc: DocumentoLeido = { nombre: "plantilla.xlsx", texto: "", tablas: [SOLO_APORTACION, posiciones(conPrecio)] };
    const resultados = [importadorDePlantilla.importar([{ documento: doc, tipo: "movimientos" }], { divisaBase: "EUR" })];
    const vacia = carteraVacia({ nombre: "Plantilla", ahora: "2026-01-01T00:00:00.000Z", id: "c" });
    const decisiones = new Map([[ISIN_BONO, BONO]]);
    const revision = revisar(resultados, vacia, CATALOGO, decisiones);
    const marcadas = elegidas(revision, new Map());
    const antes = comprobar(vacia, resultados, revision, marcadas, decisiones, [], "2026-11-21T10:00:00.000Z");
    return proponerPosicionesIniciales(antes, revision, marcadas, decisiones);
  }

  it("con el precio, la acción en dólares se propone a 50 $ y el bono al 98,5 %", () => {
    const { propuestas: lista, sinProponer } = propuestas(true);
    expect(sinProponer).toEqual([]);
    expect(lista.map((propuesta) => [propuesta.activo.isin, propuesta.movimiento.titulos, propuesta.movimiento.precio])).toEqual([
      [ISIN, "10", "50"],
      [ISIN_BONO, "10000", "98.5"]
    ]);
  });

  it("sin él, como antes: la acción en dólares no se propone, y el bono sale de su valor, 9.900 / (10.000 × 0,01) = 99 %", () => {
    const { propuestas: lista, sinProponer } = propuestas(false);
    expect(lista.map((propuesta) => [propuesta.activo.isin, propuesta.movimiento.titulos, propuesta.movimiento.precio])).toEqual([[ISIN_BONO, "10000", "99"]]);
    expect(sinProponer).toHaveLength(1);
    expect(sinProponer[0]).toContain("cotiza en USD");
  });
});
