/**
 * La plantilla genérica de importación: reconocimiento, lectura fila a fila, posiciones y la
 * plantilla descargable. Cada cifra esperada sale de una cuenta a mano escrita junto a ella.
 */
import { describe, expect, it } from "vitest";
import { xlsxCellToText } from "../../src/core/importFileReader";
import { d, leerCifra } from "../../src/gestor/motor/decimal";
import { construirLibro, titulosDe } from "../../src/gestor/motor/libro";
import { carteraVacia, type Activo } from "../../src/gestor/motor/modelo";
import { TIPOS, definicionDe } from "../../src/gestor/motor/movimientos/registro";
import { COLUMNAS_DE_MOVIMIENTOS, SINONIMOS_DE_TIPOS } from "../../src/gestor/importacion/plantilla/columnas";
import { importadorDePlantilla, hojasDeLaPlantilla, plantillaCsv } from "../../src/gestor/importacion/plantilla";
import { leerFecha } from "../../src/gestor/importacion/plantilla/leer";
import { activosCitados, resolverActivo } from "../../src/gestor/importacion/revision";
import type { DocumentoLeido, MovimientoPropuesto, ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";

const CABECERA = ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Importe", "Divisa", "Comisión", "Retención", "Nota"];

function documento(filas: Array<Array<string | number>>, nombre = "movimientos.csv"): DocumentoLeido {
  const tabla = filas.map((fila) => fila.map((celda) => String(celda)));
  return { nombre, texto: tabla.map((fila) => fila.join(";")).join("\n"), tablas: [tabla] };
}

function importar(doc: DocumentoLeido, divisaBase = "EUR"): ResultadoDeImportacion {
  return importadorDePlantilla.importar([{ documento: doc, tipo: "movimientos" }], { divisaBase });
}

/** Importa una sola fila bajo la cabecera de pruebas. */
function unaFila(valores: Record<string, string>): MovimientoPropuesto {
  const fila = CABECERA.map((columna) => valores[columna] ?? "");
  const resultado = importar(documento([CABECERA, fila]));
  expect(resultado.errores).toEqual([]);
  expect(resultado.movimientos).toHaveLength(1);
  return resultado.movimientos[0];
}

/**
 * Las hojas de la plantilla como las deja el lector de Excel (`xlsxCellToText`): el texto tal cual y cada número con coma
 * decimal. Antes se escribían con `String`, con el punto de JavaScript, que el lector real no produce; desde H1-07 (23-11-2026)
 * un fichero con solo puntos decimales se lee en inglés y lo avisa.
 */
function documentoDeLasHojas(soloMovimientos: boolean): DocumentoLeido {
  const hojas = hojasDeLaPlantilla().filter((hoja) => !soloMovimientos || hoja.nombre === "Movimientos");
  const tablas = hojas.map((hoja) => hoja.filas.map((fila) => fila.map((celda) => xlsxCellToText(celda))));
  return { nombre: "plantilla.xlsx", texto: "", tablas };
}

/** Un CSV de la plantilla, partido como lo haría un lector sencillo (la plantilla no lleva comillas). */
function documentoDelCsv(csv: string): DocumentoLeido {
  const sinBom = csv.replace(/^\uFEFF/, "");
  const filas = sinBom.split("\r\n").filter((linea) => linea !== "").map((linea) => linea.split(";"));
  return { nombre: "plantilla.csv", texto: sinBom, tablas: [filas] };
}

/** Comprueba la importación de la plantilla y devuelve el resultado. */
function comprobarIdaYVuelta(doc: DocumentoLeido): ResultadoDeImportacion {
  expect(importadorDePlantilla.reconocer(doc)).toEqual({ tipo: "movimientos", confianza: 0.5 });
  const resultado = importar(doc);
  expect(resultado.errores).toEqual([]);
  expect(resultado.avisos).toEqual([]);
  const enRevision = resultado.movimientos.filter((propuesto) => propuesto.requiereRevision).map((propuesto) => `fila ${propuesto.fila}: ${propuesto.avisos.join(" ")}`);
  expect(enRevision).toEqual([]);
  expect(resultado.movimientos.flatMap((propuesto) => propuesto.avisos)).toEqual([]);

  /* Válidos para el motor, en un contexto con los activos citados. */
  const activos = new Map<string, Activo>();
  for (const propuesto of resultado.movimientos) {
    for (const citado of [propuesto.activo, propuesto.destino]) {
      if (citado && !activos.has(citado.clave)) activos.set(citado.clave, { id: citado.clave, nombre: citado.nombre, tipo: citado.tipo ?? "OTRO", divisa: citado.divisa ?? "EUR", origen: "manual" });
    }
  }
  const contexto = { divisaBase: "EUR", activo: (id: string | undefined) => (id === undefined ? undefined : activos.get(id)) };
  for (const propuesto of resultado.movimientos) {
    expect(definicionDe(propuesto.movimiento.tipo)!.validar(propuesto.movimiento, contexto), `fila ${propuesto.fila}`).toEqual([]);
  }

  /* Un ejemplo de cada tipo registrado. */
  const presentes = new Set(resultado.movimientos.map((propuesto) => propuesto.movimiento.tipo));
  const faltan = TIPOS.filter((definicion) => !presentes.has(definicion.tipo)).map((definicion) => definicion.tipo);
  expect(faltan, `La plantilla no tiene ejemplo de: ${faltan.join(", ")}. Añádelo a EJEMPLOS_DE_MOVIMIENTOS.`).toEqual([]);
  return resultado;
}

describe("Plantilla descargable: ida y vuelta", () => {
  it("la hoja «Movimientos» se reconoce, se importa sin revisión y tiene un ejemplo de cada tipo", () => {
    const resultado = comprobarIdaYVuelta(documentoDeLasHojas(true));
    /* 23 filas de ejemplo: 21 tipos, más dos compras de más (el bono y la acción en dólares). */
    expect(resultado.movimientos).toHaveLength(23);
    expect(resultado.documentos).toEqual([{ nombre: "plantilla.xlsx", tipo: "movimientos", etiqueta: "Plantilla de movimientos", filas: 23 }]);
  });

  it("el Excel entero, con posiciones e instrucciones, da los mismos movimientos y un extracto", () => {
    const resultado = comprobarIdaYVuelta(documentoDeLasHojas(false));
    expect(resultado.movimientos).toHaveLength(23);
    expect(resultado.extractos).toHaveLength(1);
    const [extracto] = resultado.extractos;
    expect(extracto.fecha).toBe("2026-12-31");
    /* El precio es opcional (A-210): lo dan el fondo de bolsa (11,20 €) y Ejemplo Corp. en su divisa (60 × 105 = 6.300 USD,
       declarados como 6.000 EUR); el de renta fija, no. */
    expect(extracto.posiciones.map((posicion) => [posicion.activo.clave, posicion.titulos, posicion.valor, posicion.cotizacion, posicion.divisa])).toEqual([
      ["ZZ0000000045", "1000", "11200", "11.2", "EUR"],
      ["ZZ0000000037", "400", "10720", undefined, undefined],
      ["ZZ0000000029", "60", "6000", "105", "USD"]
    ]);
    expect(extracto.efectivo).toEqual([{ divisa: "EUR", saldo: "56677.7" }, { divisa: "USD", saldo: "4725" }]);
  });

  it("el CSV, leído de vuelta, da los mismos movimientos", () => {
    const desdeCsv = comprobarIdaYVuelta(documentoDelCsv(plantillaCsv()));
    const desdeHojas = importar(documentoDeLasHojas(true));
    const sinOrigen = (resultado: ResultadoDeImportacion) => resultado.movimientos.map(({ movimiento }) => ({ ...movimiento, origen: undefined }));
    expect(sinOrigen(desdeCsv)).toEqual(sinOrigen(desdeHojas));
  });

  it("la cartera de ejemplo cuadra con su hoja de posiciones", () => {
    const resultado = importar(documentoDeLasHojas(false));
    const cartera = carteraVacia({ nombre: "Ejemplo", ahora: "2026-01-01T00:00:00.000Z", id: "ejemplo" });
    const activos = new Map<string, Activo>();
    for (const propuesto of resultado.movimientos) {
      for (const citado of [propuesto.activo, propuesto.destino]) {
        if (citado && !activos.has(citado.clave)) {
          activos.set(citado.clave, { id: citado.clave, nombre: citado.nombre, tipo: citado.tipo ?? "OTRO", divisa: citado.divisa ?? "EUR", origen: "manual" });
        }
      }
    }
    cartera.activos = [...activos.values()];
    cartera.movimientos = resultado.movimientos.map((propuesto) => propuesto.movimiento);
    const libro = construirLibro(cartera);
    expect(libro.avisos.filter((aviso) => aviso.nivel === "error")).toEqual([]);
    /* EUR: 100.000 − 10.012 − 25.000 − 9.905 − 9.000 − 30 + 162 + 16,20 − 25 + 5.162 + 283,50 + 11 + 15 − 5.000 + 10.000 = 56.677,70. */
    expect(libro.final.efectivo.get("EUR")!.eq(d("56677.70"))).toBe(true);
    /* USD: 9.750 − 9.015 + 3.990 = 4.725. */
    expect(libro.final.efectivo.get("USD")!.eq(d("4725"))).toBe(true);
    /* Fondo RF: 1.000 − 200 (reembolso) − 400 (traspaso) = 400. Fondo bolsa: 1.000 del traspaso. */
    expect(titulosDe(libro.final, "ZZ0000000037").eq(400)).toBe(true);
    expect(titulosDe(libro.final, "ZZ0000000045").eq(1000)).toBe(true);
    /* Ejemplo Corp.: 50 × 2 (split) − 40 (venta) = 60. Holding: 262 del canje. */
    expect(titulosDe(libro.final, "ZZ0000000029").eq(60)).toBe(true);
    expect(titulosDe(libro.final, "ZZ0000000060").eq(262)).toBe(true);
    /* Lo que sale del todo: la acción canjeada, el bono amortizado y la acción entregada. */
    expect(titulosDe(libro.final, "ZZ0000000011").eq(0)).toBe(true);
    expect(titulosDe(libro.final, "ZZ0000000052").eq(0)).toBe(true);
    expect(titulosDe(libro.final, "ACCION ANTIGUA, S.A.").eq(0)).toBe(true);
  });

  it("ninguna cifra de la plantilla cambia al pasarla a texto, ni con punto ni con coma", () => {
    /* «1.085» se leería como 1.085 millares: la plantilla no puede llevar cifras así. */
    for (const hoja of hojasDeLaPlantilla()) {
      for (const fila of hoja.filas) {
        for (const celda of fila) {
          if (typeof celda !== "number") continue;
          expect(leerCifra(String(celda))?.eq(d(celda)), `${hoja.nombre}: ${celda}`).toBe(true);
          expect(leerCifra(String(celda).replace(".", ","))?.eq(d(celda)), `${hoja.nombre}: ${celda}`).toBe(true);
        }
      }
    }
  });

  it("la hoja de instrucciones lleva cada columna y cada tipo con su descripción del registro", () => {
    const instrucciones = hojasDeLaPlantilla().find((hoja) => hoja.nombre === "Instrucciones")!;
    const primeras = instrucciones.filas.map((fila) => fila[0]);
    for (const columna of COLUMNAS_DE_MOVIMIENTOS) expect(primeras).toContain(columna.nombre);
    for (const definicion of TIPOS) {
      const fila = instrucciones.filas.find((candidata) => candidata[0] === definicion.nombre);
      expect(fila?.[2], definicion.tipo).toBe(definicion.descripcion);
    }
    /* Compra: activo por ISIN o nombre (ninguna obligatoria sola), títulos e importe obligatorios. */
    const compra = instrucciones.filas.find((fila) => fila[0] === "Compra")!;
    expect(String(compra[3])).toContain("Títulos*");
    expect(String(compra[3])).toContain("Importe*");
    expect(String(compra[3])).toContain("ISIN,");
  });
});

describe("CSV de la plantilla", () => {
  it("lleva BOM, separador «;», fin de línea CRLF y cifras con coma", () => {
    const csv = plantillaCsv();
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
    const lineas = csv.slice(1).split("\r\n");
    expect(lineas[0]).toBe(COLUMNAS_DE_MOVIMIENTOS.map((columna) => columna.nombre).join(";"));
    expect(csv).not.toContain('"');
    /* La compra del bono: precio 98,5 y la retención del cupón 66,5. */
    expect(csv).toContain(";98,5;");
    expect(csv).toContain(";66,5;");
  });
});

describe("Reconocimiento", () => {
  it("reconoce la plantilla con un título encima de la cabecera", () => {
    const doc = documento([["Movimientos de la cuenta 1234"], [], ["Exportado el 13/11/2026"], CABECERA, ["02/01/2026", "Aportación", "", "", "", "", "1000"]]);
    expect(importadorDePlantilla.reconocer(doc)).toEqual({ tipo: "movimientos", confianza: 0.5 });
    expect(importar(doc).movimientos[0].fila).toBe(5);
  });

  it("reconoce cabeceras con sinónimos, mayúsculas, tildes y guiones bajos cambiados", () => {
    const cabecera = ["FECHA_OPERACION", "tipo de movimiento", "Codigo ISIN", "PARTICIPACIONES", "importe neto", "Comision"];
    const doc = documento([cabecera, ["08/01/2026", "SUSCRIPCION DE FONDO", "ZZ0000000037", "1000", "25000", "0"]]);
    expect(importadorDePlantilla.reconocer(doc)?.confianza).toBe(0.5);
    const [propuesto] = importar(doc).movimientos;
    expect(propuesto.movimiento).toMatchObject({ tipo: "suscripcion", fechaOperacion: "2026-01-08", activoId: "ZZ0000000037", titulos: "1000", importe: "-25000", comision: "0" });
    expect(propuesto.requiereRevision).toBe(false);
  });

  it("basta con Títulos en lugar de Importe", () => {
    expect(importadorDePlantilla.reconocer(documento([["Fecha", "Tipo", "ISIN", "Títulos"]]))).toBeDefined();
  });

  it("no reconoce un documento que no es la plantilla", () => {
    expect(importadorDePlantilla.reconocer(documento([["Fecha", "Concepto", "Importe", "Saldo"], ["02/01/2026", "Transferencia", "100", "100"]]))).toBeUndefined();
    expect(importadorDePlantilla.reconocer({ nombre: "vacio.csv", texto: "", tablas: [] })).toBeUndefined();
  });

  it("no busca la cabecera más allá de la fila 15", () => {
    const relleno = Array.from({ length: 15 }, (_, i) => [`Línea ${i + 1}`]);
    expect(importadorDePlantilla.reconocer(documento([...relleno, CABECERA]))).toBeUndefined();
  });
});

describe("Columnas que faltan", () => {
  it("dice qué columna falta y cuáles ha encontrado, sin movimientos", () => {
    const doc = documento([["Fecha", "ISIN", "Importe"], ["02/01/2026", "ZZ0000000011", "100"]]);
    expect(importadorDePlantilla.reconocer(doc)).toBeUndefined();
    const resultado = importar(doc);
    expect(resultado.movimientos).toEqual([]);
    expect(resultado.errores).toHaveLength(1);
    expect(resultado.errores[0]).toContain("falta la columna «Tipo»");
    expect(resultado.errores[0]).toContain("Columnas reconocidas: Fecha, ISIN, Importe");
  });

  it("si no hay nada parecido a una cabecera, lo dice", () => {
    const resultado = importar(documento([["hola"], ["adiós"]]));
    expect(resultado.movimientos).toEqual([]);
    expect(resultado.errores[0]).toContain("no encuentro la fila de cabecera");
  });
});

describe("El signo del importe lo pone el tipo", () => {
  it("una compra carga aunque el fichero traiga el importe en positivo", () => {
    expect(unaFila({ Fecha: "07/01/2026", Tipo: "Compra", ISIN: "ZZ0000000011", Títulos: "10", Importe: "200" }).movimiento.importe).toBe("-200");
  });

  it("una venta abona aunque el fichero traiga el importe en negativo, y los títulos van en positivo", () => {
    const { movimiento, requiereRevision } = unaFila({ Fecha: "07/01/2026", Tipo: "Venta", ISIN: "ZZ0000000011", Títulos: "-10", Importe: "-200" });
    expect(movimiento.importe).toBe("200");
    expect(movimiento.titulos).toBe("10");
    expect(requiereRevision).toBe(false);
  });

  it("en los intereses manda el signo del fichero", () => {
    expect(unaFila({ Fecha: "31/03/2026", Tipo: "Intereses", Importe: "-3,5" }).movimiento.importe).toBe("-3.5");
    expect(unaFila({ Fecha: "31/03/2026", Tipo: "Intereses", Importe: "3,5" }).movimiento.importe).toBe("3.5");
  });

  it("un tipo que no mueve efectivo no lleva importe, y avisa de que lo ignora", () => {
    const propuesto = unaFila({ Fecha: "15/04/2026", Tipo: "Dividendo en acciones", ISIN: "ZZ0000000011", Títulos: "25", Importe: "11" });
    expect(propuesto.movimiento.importe).toBeUndefined();
    expect(propuesto.avisos).toEqual(["El tipo «Dividendo en acciones» no usa la columna «Importe»: se ha ignorado."]);
    expect(propuesto.requiereRevision).toBe(false);
  });

  it("los sinónimos de tipo: «Ingreso» es una aportación, «Reintegro» una retirada, «Venta de fondo» un reembolso", () => {
    expect(unaFila({ Fecha: "02/01/2026", Tipo: "ingreso", Importe: "-100" }).movimiento).toMatchObject({ tipo: "aportacion", importe: "100" });
    expect(unaFila({ Fecha: "02/01/2026", Tipo: "REINTEGRO", Importe: "100" }).movimiento).toMatchObject({ tipo: "retirada", importe: "-100" });
    expect(unaFila({ Fecha: "02/01/2026", Tipo: "Venta de fondo", ISIN: "ZZ0000000037", Títulos: "5", Importe: "130" }).movimiento.tipo).toBe("reembolso");
    expect(unaFila({ Fecha: "02/01/2026", Tipo: "cambioDeDivisa", Importe: "100" }).movimiento.tipo).toBe("cambioDeDivisa");
  });
});

describe("Fechas y cifras", () => {
  it("lee las fechas en los cuatro formatos", () => {
    expect(leerFecha("13/11/2026")).toBe("2026-11-13");
    expect(leerFecha("13-11-2026")).toBe("2026-11-13");
    expect(leerFecha("2026-11-13")).toBe("2026-11-13");
    /* Serie de Excel: 1-1-2024 es el 45.292; + 366 (2024 es bisiesto) = 45.658 el 1-1-2025;
       + 365 = 46.023 el 1-1-2026; el 13 de noviembre es el día 317 del año: 46.023 + 316 = 46.339. */
    expect(leerFecha("46339")).toBe("2026-11-13");
    expect(leerFecha("2026-11-13 00:00:00")).toBe("2026-11-13");
    expect(leerFecha("31/02/2026")).toBeUndefined();
    expect(leerFecha("ayer")).toBeUndefined();
  });

  it("cada formato de fecha llega igual al movimiento", () => {
    for (const fecha of ["13/11/2026", "13-11-2026", "2026-11-13", "46339"]) {
      expect(unaFila({ Fecha: fecha, Tipo: "Aportación", Importe: "1" }).movimiento.fechaOperacion).toBe("2026-11-13");
    }
  });

  it("lee las cifras en formato español y en formato inglés", () => {
    expect(unaFila({ Fecha: "02/01/2026", Tipo: "Aportación", Importe: "1.234,56" }).movimiento.importe).toBe("1234.56");
    expect(unaFila({ Fecha: "02/01/2026", Tipo: "Aportación", Importe: "1,234.56" }).movimiento.importe).toBe("1234.56");
    expect(unaFila({ Fecha: "02/01/2026", Tipo: "Aportación", Importe: "1234.56" }).movimiento.importe).toBe("1234.56");
  });

  it("una cifra ilegible deja el campo en blanco, avisa y pide revisión", () => {
    const propuesto = unaFila({ Fecha: "02/01/2026", Tipo: "Aportación", Importe: "12,3,4" });
    expect(propuesto.movimiento.importe).toBeUndefined();
    expect(propuesto.requiereRevision).toBe(true);
    expect(propuesto.avisos[0]).toBe("La columna «Importe» dice «12,3,4», que no es una cifra: se ha dejado en blanco.");
    expect(propuesto.avisos).toContain("Falta el importe.");
  });

  it("una fecha ilegible con importe sale para revisión", () => {
    const propuesto = unaFila({ Fecha: "31/02/2026", Tipo: "Aportación", Importe: "100" });
    expect(propuesto.movimiento.fechaOperacion).toBe("");
    expect(propuesto.requiereRevision).toBe(true);
    expect(propuesto.avisos).toEqual(["No entiendo la fecha «31/02/2026». Formatos admitidos: dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd o el número de fecha de Excel."]);
  });
});

describe("Activos citados", () => {
  it("por ISIN: en mayúsculas y con el tipo que deduce el movimiento", () => {
    const propuesto = unaFila({ Fecha: "08/01/2026", Tipo: "Suscripción de fondo", ISIN: "zz0000000037", Nombre: "Fondo Ejemplo", Títulos: "10", Importe: "250" });
    expect(propuesto.activo).toEqual({ clave: "ZZ0000000037", isin: "ZZ0000000037", nombre: "Fondo Ejemplo", tipo: "FONDO" });
    expect(propuesto.movimiento.activoId).toBe("ZZ0000000037");
  });

  it("por nombre: sin tildes, en mayúsculas y con espacios simples; dos escrituras del mismo nombre son el mismo activo", () => {
    const doc = documento([
      CABECERA,
      ["05/01/2026", "Compra", "", "  Acción   Antigua ", "10", "", "100"],
      ["06/01/2026", "Dividendo", "", "accion antigua", "", "", "5"]
    ]);
    const [compra, dividendo] = importar(doc).movimientos;
    /* «Compra» a secas: la acción se supone, y lo dice la cita para que la revisión pregunte si el activo es nuevo. */
    expect(compra.activo).toEqual({ clave: "ACCION ANTIGUA", nombre: "Acción Antigua", tipo: "ACCION", tipoSupuesto: true });
    expect(dividendo.activo).toEqual({ clave: "ACCION ANTIGUA", nombre: "Acción Antigua" });
    expect(dividendo.movimiento.activoId).toBe("ACCION ANTIGUA");
    expect(dividendo.requiereRevision).toBe(false);
  });

  it("un ISIN con forma inválida: se cita por nombre y pide revisión", () => {
    const propuesto = unaFila({ Fecha: "07/01/2026", Tipo: "Compra", ISIN: "ES12345", Nombre: "Acción Rara", Títulos: "1", Importe: "10" });
    expect(propuesto.activo?.clave).toBe("ACCION RARA");
    expect(propuesto.activo?.isin).toBeUndefined();
    expect(propuesto.requiereRevision).toBe(true);
  });

  it("una compra sin activo sale para revisión con el error del motor", () => {
    const propuesto = unaFila({ Fecha: "07/01/2026", Tipo: "Compra", Títulos: "1", Importe: "10" });
    expect(propuesto.requiereRevision).toBe(true);
    expect(propuesto.avisos).toContain("Falta el activo.");
  });

  it("un bono comprado antes de su primer cupón es un bono, no una acción (P2-05)", () => {
    /* La compra va primero y solo deduce «acción»; el cupón de junio dice «bono», y manda en las dos filas. */
    const cabecera = ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Importe"];
    const doc = documento([
      cabecera,
      ["12/01/2026", "Compra", "ZZ0000000052", "Bono Ejemplo 2030", "10000", "98,5", "-9850"],
      ["15/06/2026", "Cupón", "ZZ0000000052", "Bono Ejemplo 2030", "", "", "350"]
    ]);
    const resultado = importar(doc);
    const [compra, cupon] = resultado.movimientos;
    expect(compra.activo?.tipo).toBe("BONO");
    expect(cupon.activo?.tipo).toBe("BONO");
    /* Y como bono nuevo se propone en % del nominal: 10.000 × 98,5 × 0,01 = 9.850 €, lo pagado. Con multiplicador 1, 985.000 €. */
    const [citado] = activosCitados([resultado]);
    const propuesto = resolverActivo(citado.citado, citado.apariciones, carteraVacia({ nombre: "x", ahora: "2026-01-01T00:00:00.000Z", id: "x" }), []).propuesto;
    expect(propuesto).toMatchObject({ tipo: "BONO", multiplicador: "0.01" });
  });

  it("una compra con cupón corrido es de un bono aunque no haya cupones en el documento", () => {
    const cabecera = ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Importe", "Cupón corrido"];
    const doc = documento([cabecera, ["12/01/2026", "Compra", "ZZ0000000052", "Bono Ejemplo 2030", "10000", "98,5", "-9900", "50"]]);
    expect(importar(doc).movimientos[0].activo?.tipo).toBe("BONO");
    /* Una compra sin más sigue deduciendo «acción», como antes. */
    expect(unaFila({ Fecha: "07/01/2026", Tipo: "Compra", ISIN: "ZZ0000000060", Nombre: "Acción X", Títulos: "1", Importe: "10" }).activo?.tipo).toBe("ACCION");
  });

  it("el destino de un traspaso es un fondo, con su fecha de llegada", () => {
    const cabecera = ["Fecha", "Tipo", "ISIN", "Títulos", "Valor", "ISIN destino", "Títulos destino", "Fecha destino"];
    const doc = documento([cabecera, ["11/05/2026", "Traspaso", "ZZ0000000037", "400", "10600", "ZZ0000000045", "1000", "13/05/2026"]]);
    const [propuesto] = importar(doc).movimientos;
    expect(propuesto.requiereRevision).toBe(false);
    expect(propuesto.destino).toEqual({ clave: "ZZ0000000045", isin: "ZZ0000000045", nombre: "ZZ0000000045", tipo: "FONDO" });
    expect(propuesto.movimiento.destino).toEqual({ activoId: "ZZ0000000045", titulos: "1000", fecha: "2026-05-13" });
  });
});

describe("Filas que no son movimientos de la lista", () => {
  it("un tipo desconocido entra como «Otro cargo o abono» y pide revisión", () => {
    const propuesto = unaFila({ Fecha: "02/01/2026", Tipo: "Abono especial", Importe: "-50" });
    expect(propuesto.movimiento.tipo).toBe("otroEfectivo");
    expect(propuesto.movimiento.importe).toBe("-50");
    expect(propuesto.requiereRevision).toBe(true);
    expect(propuesto.avisos[0]).toMatch(/^No reconozco el tipo «Abono especial»\. Se ha importado como «Otro cargo o abono» para que lo reclasifiques\. Tipos admitidos: Compra, Venta, /);
  });

  it("descarta las filas sin fecha ni importe y lo cuenta; ignora vacías, comentarios y totales", () => {
    const doc = documento([
      CABECERA,
      ["02/01/2026", "Aportación", "", "", "", "", "1000"],
      [],
      ["# Esto es un comentario", "", "", "", "", "", "5"],
      ["", "", "", "", "", "", "", "", "", "", "Solo una nota"],
      ["Total", "", "", "", "", "", "1000"],
      ["", "", "", "", "", "", "", "", "", "", "Otra nota suelta"]
    ]);
    const resultado = importar(doc);
    expect(resultado.movimientos).toHaveLength(1);
    expect(resultado.avisos).toEqual(["«movimientos.csv»: se han descartado 2 filas 5, 7, sin fecha ni importe."]);
    expect(resultado.documentos[0].filas).toBe(1);
  });

  it("ordena por fecha y, a igualdad, por fila, con identificadores deterministas", () => {
    const doc = documento([
      CABECERA,
      ["03/01/2026", "Retirada", "", "", "", "", "10"],
      ["02/01/2026", "Aportación", "", "", "", "", "100"],
      ["03/01/2026", "Comisión", "", "", "", "", "1"]
    ]);
    const movimientos = importar(doc).movimientos;
    expect(movimientos.map((propuesto) => [propuesto.movimiento.id, propuesto.fila])).toEqual([["plantilla-1", 3], ["plantilla-2", 2], ["plantilla-3", 4]]);
    expect(movimientos[0].movimiento.origen).toEqual({ via: "importado", documento: "movimientos.csv", fila: 3, textoOriginal: "02/01/2026; Aportación; ; ; ; ; 100" });
  });
});

describe("Hoja de posiciones", () => {
  it("se convierte en un extracto por fecha, con el efectivo aparte", () => {
    const doc: DocumentoLeido = {
      nombre: "plantilla.xlsx",
      texto: "",
      tablas: [
        [CABECERA, ["02/01/2026", "Aportación", "", "", "", "", "1000"]],
        [
          ["Posiciones a cierre"],
          ["Fecha", "ISIN", "Nombre", "Títulos", "Valor", "Divisa"],
          ["30/06/2026", "ZZ0000000011", "Acción Ejemplo", "500", "10.250,50", "EUR"],
          ["30/06/2026", "", "Efectivo", "", "1.234,5", ""],
          ["31/12/2026", "", "Acción sin ISIN", "10", "", ""],
          ["31/12/2026", "", "Efectivo", "", "200", "usd"],
          ["Total", "", "", "", "11485", ""]
        ]
      ]
    };
    const resultado = importar(doc);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.extractos).toEqual([
      {
        fecha: "2026-06-30",
        documento: "plantilla.xlsx",
        posiciones: [{ activo: { clave: "ZZ0000000011", isin: "ZZ0000000011", nombre: "Acción Ejemplo", divisa: "EUR" }, titulos: "500", valor: "10250.5" }],
        efectivo: [{ divisa: "EUR", saldo: "1234.5" }]
      },
      {
        fecha: "2026-12-31",
        documento: "plantilla.xlsx",
        posiciones: [{ activo: { clave: "ACCION SIN ISIN", nombre: "Acción sin ISIN" }, titulos: "10" }],
        efectivo: [{ divisa: "USD", saldo: "200" }]
      }
    ]);
    /* Filas útiles: 1 movimiento + 4 de posiciones. */
    expect(resultado.documentos[0].filas).toBe(5);
  });
});

describe("Sinónimos de tipos", () => {
  it("cada sinónimo apunta a un tipo registrado", () => {
    for (const tipo of Object.keys(SINONIMOS_DE_TIPOS)) expect(definicionDe(tipo), tipo).toBeDefined();
  });
});
