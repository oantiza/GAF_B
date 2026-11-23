/**
 * El separador decimal de la plantilla se decide por fichero (H1-07, decisión 4 de la auditoría consolidada del 22-11-2026;
 * aprobada por Óscar el 23-11-2026).
 *
 * `leerCifra` lee «1.085» como mil ochenta y cinco: es la convención española declarada (FMT-20, GES-22), y la entrada a mano
 * la sigue. Pero las instrucciones de la plantilla admiten «1234.56», y en un CSV escrito en inglés un cambio de «1.085»
 * entraba como 1.085 (mil ochenta y cinco) y un dividendo de «5.425» USD como 5.425 dólares, en «Listo». Ahora:
 * - alguna cifra con coma decimal → español, lo de siempre;
 * - alguna con punto decimal inequívoco y ninguna con coma → inglés: el punto es decimal;
 * - ninguna que decida → como siempre, pero la línea con una cifra ambigua queda «Revisar» con su «Leído como».
 * Cada cifra esperada sale de la cuenta escrita a su lado.
 */
import { describe, expect, it } from "vitest";
import { spreadsheetRowsToDelimitedText } from "../../src/core/importFileReader";
import { leerTexto } from "../../src/gestor/importacion/lectura";
import { importadorDePlantilla } from "../../src/gestor/importacion/plantilla";
import { separadorDeLasCifras } from "../../src/gestor/importacion/plantilla/leer";
import { revisar } from "../../src/gestor/importacion/revision";
import type { DocumentoLeido, ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import { leerCifra, leerCifraCon, pistaDelSeparador } from "../../src/gestor/motor/decimal";
import { carteraVacia } from "../../src/gestor/motor/modelo";
import { estadoDeLaLinea } from "../../src/gestor/ui/importar/revisionDelAsistente";

function importar(documento: DocumentoLeido): ResultadoDeImportacion {
  const resultado = importadorDePlantilla.importar([{ documento, tipo: "movimientos" }], { divisaBase: "EUR" });
  expect(resultado.errores).toEqual([]);
  return resultado;
}

const cifras = (resultado: ResultadoDeImportacion) =>
  resultado.movimientos.map(({ movimiento: m }) => ({ tipo: m.tipo, titulos: m.titulos, precio: m.precio, importe: m.importe, cambio: m.cambio }));

const vacia = () => carteraVacia({ nombre: "Importada", ahora: "2026-01-01T00:00:00.000Z", id: "c" });

/** Los avisos con espacios corrientes: el formato separa la cifra de su divisa con un espacio duro. */
const plano = (avisos: readonly string[]) => avisos.map((aviso) => aviso.replace(/\s/g, " "));

describe("qué dice cada cifra de su separador", () => {
  it("«1.085» y «1,085» admiten las dos lecturas; «12.5», «0.125», «1234.567» y «1,234.56» solo la del punto; «12,5» y «1.234,56», solo la de la coma", () => {
    for (const texto of ["1.085", "1,085", "105.125", "-5.425", "999,999"]) expect(pistaDelSeparador(texto), texto).toBe("ambigua");
    for (const texto of ["12.5", "0.125", "1234.567", "1234.56", "1.0850", "1,234.56", "1,234,567"]) expect(pistaDelSeparador(texto), texto).toBe("punto");
    for (const texto of ["12,5", "0,125", "1234,567", "1.234,56", "1.234.567", "1,0850"]) expect(pistaDelSeparador(texto), texto).toBe("coma");
    for (const texto of ["10000", "-1000", "", "USD", "07/01/2026"]) expect(pistaDelSeparador(texto), texto).toBe("ninguna");
  });

  it("con el punto decimal, «1.085» es 1,085 y «1,085», 1.085; con la coma, lo de siempre", () => {
    expect(leerCifraCon("1.085", "punto")!.toString()).toBe("1.085");
    expect(leerCifraCon("1,085", "punto")!.toString()).toBe("1085");
    expect(leerCifraCon("1,234.56", "punto")!.toString()).toBe("1234.56");
    expect(leerCifraCon("-5.425", "punto")!.toString()).toBe("-5.425");
    /* Con el punto decimal, una coma decimal no es una cifra. */
    expect(leerCifraCon("12,5", "punto")).toBeUndefined();
    expect(leerCifraCon("1.085", "coma")!.toString()).toBe("1085");
    expect(leerCifraCon("1.085,50", "coma")!.toString()).toBe("1085.5");
  });

  it("la entrada a mano no cambia: `leerCifra` sigue leyendo «1.085» como mil ochenta y cinco", () => {
    expect(leerCifra("1.085")!.toString()).toBe("1085");
    expect(leerCifra("12.5")!.toString()).toBe("12.5");
  });

  it("el fichero decide: coma si hay alguna, punto si solo hay punto, y sin indicios si solo hay ambiguas", () => {
    expect(separadorDeLasCifras(["1.085", "12,5"])).toMatchObject({ separador: "coma", sinIndicios: false, contradictorio: false });
    expect(separadorDeLasCifras(["1.085", "108.5"])).toMatchObject({ separador: "punto", sinIndicios: false, contradictorio: false });
    expect(separadorDeLasCifras(["1.085", "10000"])).toMatchObject({ separador: "coma", sinIndicios: true, contradictorio: false });
    expect(separadorDeLasCifras(["10000", ""])).toMatchObject({ separador: "coma", sinIndicios: false, contradictorio: false });
    expect(separadorDeLasCifras(["12.5", "12,5"])).toMatchObject({ separador: "coma", sinIndicios: false, contradictorio: true });
  });
});

describe("un CSV en inglés, con otros puntos decimales: «1.085» es 1,085", () => {
  /* Separador «,» y punto decimal, como lo exporta un bróker en inglés. «108.5» solo se lee con punto decimal: decide. */
  const csv = [
    "Fecha,Tipo,ISIN,Nombre,Títulos,Precio,Divisa del activo,Importe,Divisa,Cambio",
    "05/01/2026,Aportación,,,,,,10000,,",
    "07/01/2026,Compra de acciones,US0378331005,Apple,10,108.5,USD,-1000,,1.085",
    "09/01/2026,Dividendo,US0378331005,Apple,,,USD,5.425,USD,"
  ].join("\n");
  const resultado = importar(leerTexto("broker.csv", csv));

  it("el cambio es 1,085 y el dividendo, 5,425 USD; antes, 1.085 y 5.425", () => {
    expect(cifras(resultado)).toEqual([
      { tipo: "aportacion", titulos: undefined, precio: undefined, importe: "10000", cambio: undefined },
      { tipo: "compra", titulos: "10", precio: "108.5", importe: "-1000", cambio: "1.085" },
      { tipo: "dividendo", titulos: undefined, precio: undefined, importe: "5.425", cambio: undefined }
    ]);
    expect(resultado.avisos).toEqual([
      "«broker.csv»: las cifras vienen con punto decimal (hay una que solo se puede leer así) y se han leído todas así. Compruébalo: «1.085» se ha tomado como 1,085, y «1,085», como 1.085."
    ]);
  });

  it("y la compra cuadra: 10 × 108,5 = 1.085 USD, entre 1,085 USD por euro, son 1.000 €, lo que dice la fila", () => {
    const revision = revisar([resultado], vacia(), []);
    const compra = revision.lineas.find((linea) => linea.propuesto.movimiento.tipo === "compra")!;
    expect(compra.avisos).toEqual([]);
    expect(compra.porDefecto).toBe(true);
    /* Ninguna cifra ambigua pide revisión: el fichero ha decidido. */
    expect(revision.lineas.every((linea) => !linea.propuesto.requiereRevision)).toBe(true);
  });
});

describe("un CSV en español: «1.085,50» es 1.085,5, y «1.085», mil ochenta y cinco", () => {
  /* 10 × 108,55 = 1.085,50 €. La coma decimal decide, y «1.085» de la aportación no pide revisión. */
  const csv = [
    "Fecha;Tipo;ISIN;Nombre;Títulos;Precio;Importe",
    "05/01/2026;Aportación;;;;;1.085",
    "07/01/2026;Compra de acciones;ES0000000011;Acción A;10;108,55;-1.085,50"
  ].join("\r\n");
  const resultado = importar(leerTexto("plantilla.csv", csv));

  it("se lee como siempre, sin avisos", () => {
    expect(cifras(resultado)).toEqual([
      { tipo: "aportacion", titulos: undefined, precio: undefined, importe: "1085", cambio: undefined },
      { tipo: "compra", titulos: "10", precio: "108.55", importe: "-1085.5", cambio: undefined }
    ]);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.movimientos.every((propuesto) => !propuesto.requiereRevision && propuesto.avisos.length === 0)).toBe(true);
  });
});

describe("un CSV sin indicios: se lee como siempre, y la línea ambigua queda «Revisar» con su «Leído como»", () => {
  /* Solo enteros y «5.425»: nada dice si el punto es de millares o decimal. */
  const csv = [
    "Fecha;Tipo;ISIN;Nombre;Títulos;Precio;Divisa del activo;Importe;Divisa",
    "05/01/2026;Aportación;;;;;;10000;",
    "07/01/2026;Compra de acciones;US0378331005;Apple;10;100;USD;-1000;",
    "09/01/2026;Dividendo;US0378331005;Apple;;;USD;5.425;USD"
  ].join("\r\n");
  const resultado = importar(leerTexto("sin-indicios.csv", csv));
  const dividendo = resultado.movimientos.find((propuesto) => propuesto.movimiento.tipo === "dividendo")!;

  it("el dividendo se lee 5.425 USD, como hoy, pero pide revisión y dice cómo se ha leído y cuál sería la otra lectura", () => {
    expect(dividendo.movimiento.importe).toBe("5425");
    expect(dividendo.requiereRevision).toBe(true);
    expect(plano(dividendo.avisos)).toEqual([
      "Leído como 5.425,00: la columna «Importe» dice «5.425», y el fichero no deja ver si usa la coma o el punto decimal. Se ha tomado con el punto de millares, como se escribe en español; si es 5,425, corrígelo."
    ]);
    /* Las demás no tienen nada ambiguo: no piden revisión. */
    expect(resultado.movimientos.filter((propuesto) => propuesto.requiereRevision)).toHaveLength(1);
    expect(resultado.avisos).toEqual([]);
  });

  it("en la revisión dice «Revisar»", () => {
    const revision = revisar([resultado], vacia(), []);
    const linea = revision.lineas.find((candidata) => candidata.propuesto.movimiento.tipo === "dividendo")!;
    expect(estadoDeLaLinea(linea)).toEqual({ etiqueta: "Revisar", gravedad: "revisar" });
  });

  it("«1,085» sin indicios también: se toma con la coma decimal, y la otra lectura sería 1.085,00", () => {
    const conComa = importar(leerTexto("coma.csv", ["Fecha;Tipo;Importe", "05/01/2026;Aportación;\"1,085\""].join("\r\n")));
    expect(conComa.movimientos[0].movimiento.importe).toBe("1.085");
    expect(plano(conComa.movimientos[0].avisos)).toEqual([
      "Leído como 1,085: la columna «Importe» dice «1,085», y el fichero no deja ver si usa la coma o el punto decimal. Se ha tomado con la coma decimal, como se escribe en español; si es 1.085,00, corrígelo."
    ]);
  });
});

describe("un Excel con celdas numéricas no cambia", () => {
  it("1,085 y 5,425 llegan con coma decimal («1,0850»), y se leen 1,085 y 5,425 sin pedir revisión", () => {
    /* `xlsxCellToText` escribe 1.085 como «1,0850»: coma decimal, que decide el fichero. */
    const texto = spreadsheetRowsToDelimitedText([
      ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Divisa del activo", "Importe", "Divisa", "Cambio"],
      ["05/01/2026", "Aportación", null, null, null, null, null, 10000, null, null],
      ["07/01/2026", "Compra de acciones", "US0378331005", "Apple", 10, 108.5, "USD", -1000, null, 1.085],
      ["09/01/2026", "Dividendo", "US0378331005", "Apple", null, null, "USD", 5.425, "USD", null]
    ]);
    const resultado = importar(leerTexto("plantilla.xlsx", texto));
    expect(cifras(resultado).map(({ precio, importe, cambio }) => [precio, importe, cambio])).toEqual([
      [undefined, "10000", undefined],
      ["108.5", "-1000", "1.085"],
      [undefined, "5.425", undefined]
    ]);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.movimientos.every((propuesto) => !propuesto.requiereRevision)).toBe(true);
  });
});

describe("un fichero que se contradice", () => {
  it("con «12,5» y «12.5» se lee con la coma decimal, como siempre, y se avisa", () => {
    const resultado = importar(leerTexto("mezcla.csv", ["Fecha;Tipo;Importe", "05/01/2026;Aportación;12,5", "06/01/2026;Aportación;12.5", "07/01/2026;Aportación;1.085"].join("\r\n")));
    expect(resultado.movimientos.map((propuesto) => propuesto.movimiento.importe)).toEqual(["12.5", "12.5", "1085"]);
    expect(resultado.avisos).toEqual([
      "«mezcla.csv»: hay cifras que solo pueden llevar coma decimal (1) y otras que solo pueden llevar punto decimal (1). Se han leído con la coma decimal, como se escribe en español, y «1.085» se ha tomado como 1.085,00: revisa el fichero."
    ]);
  });
});
