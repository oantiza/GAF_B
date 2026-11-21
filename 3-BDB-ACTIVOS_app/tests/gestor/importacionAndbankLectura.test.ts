/**
 * La lectura de los extractos de Andbank en el navegador: de texto a tablas, y de tablas a
 * movimientos, posiciones y operaciones. Los extractos son sintéticos (`andbankDeMuestra.ts`)
 * y cada cifra esperada sale de una cuenta a mano escrita junto a ella.
 */
import { describe, expect, it } from "vitest";
import { importadorDeAndbank } from "../../src/gestor/importacion/andbank";
import { leerImporteDeMovimiento, leerNumero } from "../../src/gestor/importacion/andbank/comun";
import { leerMovimientos } from "../../src/gestor/importacion/andbank/movimientos";
import { leerOperaciones } from "../../src/gestor/importacion/andbank/operaciones";
import { leerPosiciones } from "../../src/gestor/importacion/andbank/posiciones";
import { leerTexto, tablasDeHtml, tablasDeTextoDelimitado } from "../../src/gestor/importacion/lectura";
import {
  ISIN_BOLSA,
  ISIN_MIXTO,
  MOVIMIENTOS_COMPLETOS,
  OPERACIONES_COMPLETAS,
  POSICIONES_COMPLETAS,
  documento,
  filaDeMovimiento,
  filaDePosicion,
  filaDeSubtotal,
  tablaDeMovimientos,
  tablaDeMovimientosSinSaldos,
  tablaDePosiciones
} from "./andbankDeMuestra";

const BASE = { divisaBase: "EUR" };

describe("tablasDeHtml", () => {
  it("repite el valor de una celda con colspan y decodifica las entidades", () => {
    const tablas = tablasDeHtml(
      "<table><tr><th colspan=\"2\">Fechas</th><th>Valor</th></tr>"
      + "<tr><td>Operaci&oacute;n</td><td>Liquidaci&#243;n</td><td>A&amp;B&nbsp; <b>FI</b></td></tr></table>"
    );
    expect(tablas).toEqual([[
      ["Fechas", "Fechas", "Valor"],
      ["Operación", "Liquidación", "A&B FI"]
    ]]);
  });

  it("lee varias tablas de primer nivel, ignora las filas vacías y cuenta una tabla sin cerrar", () => {
    const tablas = tablasDeHtml(
      "<p>antes</p><table><tr><td>a</td></tr><tr><td> </td><td></td></tr></table>"
      + "<table><tr><td></td></tr></table>"
      + "<table><tr><td>b<table><tr><td>dentro</td></tr></table></td></tr><tr><td>c</td>"
    );
    // La segunda tabla no tiene filas con texto: no cuenta. La anidada no es una tabla aparte.
    expect(tablas).toEqual([[["a"]], [["b dentro"], ["c"]]]);
  });

  it("frena una celda demasiado grande, demasiadas columnas y demasiadas celdas", () => {
    expect(() => tablasDeHtml("<table><tr><td colspan=\"1000000000\">x</td></tr></table>")).toThrow("demasiado grande");
    expect(() => tablasDeHtml("<table><tr><td rowspan=\"65\">x</td></tr></table>")).toThrow("demasiado grande");
    const pocas = { celdaMaxima: 64, celdasPorFila: 4, celdasPorDocumento: 3 };
    // 3 + 3 = 6 columnas > 4.
    expect(() => tablasDeHtml("<table><tr><td colspan=\"3\">x</td><td colspan=\"3\">y</td></tr></table>", { ...pocas, celdasPorDocumento: 100 })).toThrow("demasiadas columnas");
    // 2 + 2 = 4 celdas > 3.
    expect(() => tablasDeHtml("<table><tr><td colspan=\"2\">x</td></tr><tr><td colspan=\"2\">y</td></tr></table>", pocas)).toThrow("demasiadas celdas");
  });
});

describe("tablasDeTextoDelimitado y leerTexto", () => {
  it("una tabla por hoja visible; las hojas ocultas no se leen", () => {
    const texto = "## Hoja: Uno\na;b\n1;2\n## Hoja oculta: Dos\nx;y\n## Hoja: Tres\nc;d\n";
    expect(tablasDeTextoDelimitado(texto)).toEqual([[["a", "b"], ["1", "2"]], [["c", "d"]]]);
  });

  it("un CSV con comillas y con coma; leerTexto distingue HTML de texto delimitado", () => {
    expect(tablasDeTextoDelimitado("Nombre,Importe\n\"FONDO, FI\",\"1,5\"\n")).toEqual([[["Nombre", "Importe"], ["FONDO, FI", "1,5"]]]);
    expect(leerTexto("a.csv", "x;y\n1;2").tablas).toEqual([[["x", "y"], ["1", "2"]]]);
    expect(leerTexto("a.xls", "<table><tr><td>x</td></tr></table>").tablas).toEqual([[["x"]]]);
  });
});

describe("importes y cifras", () => {
  it("lee los importes del extracto de movimientos con la regla del banco", () => {
    expect(leerImporteDeMovimiento("1.234,56")?.toFixed()).toBe("1234.56");
    expect(leerImporteDeMovimiento("-180,00")?.toFixed()).toBe("-180");
    // Sin coma, los dos últimos dígitos son céntimos: 18000 / 100 = 180,00.
    expect(leerImporteDeMovimiento("18000")?.toFixed()).toBe("180");
    expect(leerImporteDeMovimiento("+100000")?.toFixed()).toBe("1000");
    expect(leerImporteDeMovimiento("")).toBeUndefined();
    expect(() => leerImporteDeMovimiento("1.234")).toThrow("ambiguo");
  });

  it("lee las cifras de posiciones y operaciones", () => {
    expect(leerNumero("1.234,56")?.toFixed()).toBe("1234.56");
    expect(leerNumero("12,3456")?.toFixed()).toBe("12.3456");
    expect(leerNumero("1932.40")?.toFixed()).toBe("1932.4");
    expect(leerNumero("TOTAL CARTERA")).toBeUndefined();
  });
});

describe("el extracto de movimientos", () => {
  it("lee las filas con su clase, su concepto y los títulos posiblemente cortados", () => {
    const extracto = leerMovimientos([documento("mov.xls", MOVIMIENTOS_COMPLETOS)]);
    expect(extracto.filas).toHaveLength(13);
    const suscripcion = extracto.filas[4];
    expect(suscripcion).toMatchObject({ clase: "SUSCRIPCION", nombreActivo: "FONDO MIXTO PRUDENTE EURO", titulosCortados: true, fila: 7 });
    // La cabecera es la fila 1, el «Saldo Inicio» la 2 y la suscripción la quinta de datos: 2 + 5 = 7.
    expect(suscripcion.titulos?.toFixed()).toBe("40");
    expect(extracto.filas[1]).toMatchObject({ clase: "TRANSFERENCIA", nombreActivo: undefined });
    expect(extracto.filas[7].clase).toBe("INTERES");
    expect(extracto.filas[12].saldo.toFixed()).toBe("42747.75");
  });

  it("un saldo que no cuadra es un error que dice la fila", () => {
    const filas = [
      filaDeMovimiento("12/11/2020", "TRANSFERENCIA", "EFECTIVO", "+100000", "+100000"),
      filaDeMovimiento("13/11/2020", "DIVIDENDO", "FONDO CONTROL", "+278,36", "1.278,39"),
      filaDeMovimiento("14/11/2020", "COMISION", "FONDO CONTROL", "-115", "+127724")
    ];
    // 1.000,00 + 278,36 = 1.278,36, y el extracto dice 1.278,39. Fila 3: la cabecera es la 1.
    expect(() => leerMovimientos([documento("mov.xls", tablaDeMovimientosSinSaldos(filas))])).toThrow(
      "El saldo no cuadra en la fila 3 del extracto de movimientos «mov.xls»: sumando los importes sale 1.278,36 €, y el extracto dice 1.278,39 €."
    );
  });

  const A = tablaDeMovimientos("0,00", "01/01/2024", [
    filaDeMovimiento("02/01/2024", "TRANSFERENCIA", "EFECTIVO", "+1.000,00", "1.000,00"),
    filaDeMovimiento("05/02/2024", "COMISION MANTENIMIENTO", "COMISION", "-10,00", "990,00")
  ], "990,00", "04/02/2024");
  const B = tablaDeMovimientos("1.000,00", "04/02/2024", [
    filaDeMovimiento("05/02/2024", "COMISION MANTENIMIENTO", "COMISION", "-10,00", "990,00"), // la fila que se repite
    filaDeMovimiento("05/03/2024", "LIQUIDACION INTERESES", "INTERESES", "+2,50", "992,50")
  ], "992,50", "04/03/2024");
  const C = tablaDeMovimientos("990,00", "04/03/2024", [
    filaDeMovimiento("05/03/2024", "LIQUIDACION INTERESES", "INTERESES", "+2,50", "992,50"), // la fila que se repite
    filaDeMovimiento("10/04/2024", "TRANSFERENCIA", "EFECTIVO", "-500,00", "492,50")
  ], "492,50");

  it("encadena dos y tres extractos que se solapan, en cualquier orden y en varios documentos", () => {
    const dos = leerMovimientos([documento("mov.xls", B + A)]);
    expect(dos.filas.map((fila) => fila.fechaOperacion)).toEqual(["2024-01-02", "2024-02-05", "2024-03-05"]);
    const tres = leerMovimientos([documento("uno.xls", A + B), documento("dos.xls", C)]);
    expect(tres.filas.map((fila) => fila.fechaOperacion)).toEqual(["2024-01-02", "2024-02-05", "2024-03-05", "2024-04-10"]);
    // 1.000 − 10 + 2,50 − 500 = 492,50.
    expect(tres.filas[3].saldo.toFixed()).toBe("492.5");
    expect(tres.filas[3].documento).toBe("dos.xls");
    expect(tres.saldoInicial.toFixed()).toBe("0");
  });

  it("un extracto que no encadena por el saldo es un error", () => {
    const otro = tablaDeMovimientos("800,00", "04/03/2024", [
      filaDeMovimiento("05/03/2024", "LIQUIDACION INTERESES", "INTERESES", "+2,50", "802,50"), // 800 + 2,50
      filaDeMovimiento("10/04/2024", "TRANSFERENCIA", "EFECTIVO", "-500,00", "302,50") // 802,50 − 500
    ], "302,50");
    // La historia de A pasa por 0, 1.000 y 990: ninguno es 800.
    expect(() => leerMovimientos([documento("mov.xls", A + otro)])).toThrow("no encadenan: el que empieza el 04/03/2024 parte de un saldo de 800,00 €");
  });

  it("un primer extracto con saldo distinto de cero no es un error: devuelve su saldo inicial", () => {
    const extracto = leerMovimientos([documento("mov.xls", B)]);
    expect(extracto.saldoInicial.toFixed()).toBe("1000");
    expect(extracto.fechaSaldoInicial).toBe("2024-02-04");
  });
});

describe("el extracto de posiciones", () => {
  it("da la clase de cada bloque, comprueba los subtotales y toma la mayor fecha de cotización", () => {
    const extracto = leerPosiciones(documento("pos.xls", POSICIONES_COMPLETAS));
    expect(extracto.posiciones.map((posicion) => [posicion.isin, posicion.clase])).toEqual([
      ["ES0000000019", "ACCION_NAC"],
      ["US0000000027", "ACCION_INTL"],
      [ISIN_MIXTO, "FONDO_INTL"],
      [ISIN_BOLSA, "FONDO_INTL"]
    ]);
    // En dólares, el valor es el contravalor en euros: 1.800,00, no los 2.100,00 USD.
    expect(extracto.posiciones[1].valor.toFixed()).toBe("1800");
    expect(extracto.fecha).toBe("2025-09-30");
    expect(extracto.avisos).toEqual([]);
  });

  it("un subtotal que no cuadra es un error", () => {
    const mal = POSICIONES_COMPLETAS.replace("<td>5.260,00</td>", "<td>5.270,00</td>");
    // 750 + 1.800 + 2.710 = 5.260,00, y el extracto dice 5.270,00.
    expect(() => leerPosiciones(documento("pos.xls", mal))).toThrow(
      "El subtotal de posiciones no cuadra para el total de la cartera: sumando las posiciones sale 5.260,00 €, y el extracto dice 5.270,00 €."
    );
  });

  it("un extracto que termina sin el subtotal de su bloque es un error", () => {
    const sinSubtotal = tablaDePosiciones([
      filaDePosicion({ producto: "FONDO SUELTO", isin: "LU0000000068", divisa: "EUR", titulos: "1", costeMedio: "1", precio: "1", fecha: "01/01/2026", coste: "1,00", valor: "1,00", plusvalia: "0,00", contravalor: "1,00" })
    ]);
    expect(() => leerPosiciones(documento("pos.xls", sinSubtotal))).toThrow("termina con posiciones sin el subtotal de su bloque");
  });

  it("si títulos por precio no cuadra con el valor, avisa y omite los títulos", () => {
    const extracto = leerPosiciones(documento("pos.xls", tablaDePosiciones([
      // 10 × 5 = 50, y el valor dice 60: la diferencia, 10, pasa de max(0,05; 0,06).
      filaDePosicion({ producto: "FONDO RARO", isin: "LU0000000076", divisa: "EUR", titulos: "10", costeMedio: "5", precio: "5", fecha: "01/01/2026", coste: "50,00", valor: "60,00", plusvalia: "10,00", contravalor: "60,00" }),
      filaDeSubtotal("TOTAL FONDOS INTERNACIONALES", "60,00")
    ])));
    expect(extracto.posiciones[0].titulos).toBeUndefined();
    expect(extracto.avisos).toEqual(["Posición LU0000000076 (FONDO RARO): títulos por precio no cuadra con el valor de mercado; se omiten los títulos."]);
  });
});

describe("el export de operaciones", () => {
  it("lee la cabecera de dos filas: la fecha de operación y la de liquidación", () => {
    const operaciones = leerOperaciones([documento("ops.xls", OPERACIONES_COMPLETAS)]);
    // 11 operaciones y el ejercicio de los derechos, añadido al final del juego de muestra.
    expect(operaciones).toHaveLength(12);
    expect(operaciones[0]).toMatchObject({ fechaOperacion: "2025-01-10", fechaLiquidacion: "2025-01-14", tipo: "COMPRA", isin: "ES0000000019", divisa: "EUR", orden: 1 });
    expect(operaciones[0].precio?.toFixed()).toBe("12.3456");
    expect(operaciones[0].importe.toFixed()).toBe("1234.56");
    expect(operaciones[8]).toMatchObject({ traspaso: "SALE", isin: ISIN_MIXTO });
    expect(operaciones[9]).toMatchObject({ traspaso: "ENTRA", isin: ISIN_BOLSA });
  });

  it("un traspaso con títulos, precio e importe que no cuadran es un error", () => {
    const mal = OPERACIONES_COMPLETAS.replace("<td>15.90</td><td>1590.00</td>", "<td>15.00</td><td>1590.00</td>");
    // 100 × 15,00 = 1.500, y el importe dice 1.590: la diferencia pasa de max(0,05; 1,59).
    expect(() => leerOperaciones([documento("ops.xls", mal)])).toThrow("no cuadran entre sí");
  });
});

describe("el reconocimiento", () => {
  it("reconoce los tres documentos de Andbank con confianza alta", () => {
    expect(importadorDeAndbank.reconocer(documento("mov.xls", MOVIMIENTOS_COMPLETOS))).toEqual({ tipo: "movimientos", confianza: 0.9 });
    expect(importadorDeAndbank.reconocer(documento("pos.xls", POSICIONES_COMPLETAS))).toEqual({ tipo: "posiciones", confianza: 0.9 });
    expect(importadorDeAndbank.reconocer(documento("ops.xls", OPERACIONES_COMPLETAS))).toEqual({ tipo: "operaciones", confianza: 0.9 });
  });

  it("no reconoce un documento ajeno", () => {
    expect(importadorDeAndbank.reconocer(leerTexto("otro.csv", "Fecha;Descripción;Importe\n01/01/2026;Compra;-10,00"))).toBeUndefined();
  });

  it("un error de formato no lanza: va en errores y sin movimientos", () => {
    const mal = POSICIONES_COMPLETAS.replace("<td>5.260,00</td>", "<td>5.270,00</td>");
    const resultado = importadorDeAndbank.importar([{ documento: documento("pos.xls", mal), tipo: "posiciones" }], BASE);
    expect(resultado.movimientos).toEqual([]);
    expect(resultado.errores).toHaveLength(1);
    expect(resultado.errores[0]).toContain("no cuadra para el total de la cartera");
  });
});
