/**
 * Lo que escribe el formato de pantalla del gestor (`src/gestor/ui/formato.ts`) para una tabla de cifras: positivas,
 * negativas, cero, lo que redondea a cero desde los dos lados, miles, millones, otra divisa y fechas. Fija la salida
 * carácter a carácter, para que el paso de su implementación al módulo único (`src/core/formato.ts`) no cambie nada
 * sin que se vea. Cada texto esperado está escrito a mano a partir de la regla.
 *
 * Se escribió primero con la salida de la implementación propia, y pasó con ella. Al delegar, cambió solo lo que
 * contradecía una regla del módulo único: el espacio antes de la unidad pasa a ser duro (regla 4; `\u00a0`); fuera
 * del euro se escribe el código ISO y no el símbolo («USD», no «$»; «GBP», no «£»); el porcentaje redondea la
 * escritura decimal (regla 7); y `fecha` escribe la fecha con barras. Cada cambio lleva su nota en la línea.
 */
import { describe, expect, it } from "vitest";
import { d } from "../../src/gestor/motor/decimal";
import {
  claseDelSigno,
  fecha,
  fechaCorta,
  fechaLarga,
  importe,
  importeConSigno,
  importeRedondo,
  porcentaje,
  porcentajeConSigno,
  precio,
  puntos,
  ratio,
  titulos,
  valorDeMetrica
} from "../../src/gestor/ui/formato";

const FALTA = "Falta el dato";

describe("el formato del gestor", () => {
  it.each([
    ["importe(1234.56)", importe(1234.56), "1.234,56\u00a0€"],
    ["importe(-1234.56)", importe(-1234.56), "−1.234,56\u00a0€"],
    ["importe(0)", importe(0), "0,00\u00a0€"],
    ["importe(-0)", importe(-0), "0,00\u00a0€"],
    ["importe(0.004)", importe(0.004), "0,00\u00a0€"],
    ["importe(-0.004)", importe(-0.004), "0,00\u00a0€"],
    ["importe(0.005)", importe(0.005), "0,01\u00a0€"],
    ["importe(-0.005)", importe(-0.005), "−0,01\u00a0€"],
    ["importe(1000)", importe(1000), "1.000,00\u00a0€"],
    ["importe(1234567.891)", importe(1234567.891), "1.234.567,89\u00a0€"],
    /* Antes \u00ab1.234,56 $\u00bb y \u00ab\u2212120,00 \u00a3\u00bb: fuera del euro, el c\u00f3digo ISO (\u00ab$\u00bb no dice de qu\u00e9 pa\u00eds es el d\u00f3lar). */
    ["importe(1234.56, \"USD\")", importe(1234.56, "USD"), "1.234,56\u00a0USD"],
    ["importe(-120, \"GBP\")", importe(-120, "GBP"), "−120,00\u00a0GBP"],
    ["importe(5000, \"CHF\")", importe(5000, "CHF"), "5.000,00\u00a0CHF"],
    ["importe(1234.5, \"EUR\", 0)", importe(1234.5, "EUR", 0), "1.235\u00a0€"],
    ["importe(NaN)", importe(Number.NaN), FALTA],
    ["importeRedondo(201297.99)", importeRedondo(201297.99), "201.298\u00a0€"],
    ["importeRedondo(1234567)", importeRedondo(1234567), "1.234.567\u00a0€"],
    ["importeRedondo(2.5)", importeRedondo(2.5), "3\u00a0€"],
    ["importeRedondo(-2.5)", importeRedondo(-2.5), "−3\u00a0€"],
    ["importeRedondo(-0.4)", importeRedondo(-0.4), "0\u00a0€"],
    ["importeConSigno(1234.5)", importeConSigno(1234.5), "+1.234,50\u00a0€"],
    ["importeConSigno(-1234.5)", importeConSigno(-1234.5), "−1.234,50\u00a0€"],
    ["importeConSigno(0)", importeConSigno(0), "0,00\u00a0€"],
    ["importeConSigno(0.004)", importeConSigno(0.004), "0,00\u00a0€"],
    ["importeConSigno(-0.004)", importeConSigno(-0.004), "0,00\u00a0€"],
    ["importeConSigno(0.005)", importeConSigno(0.005), "+0,01\u00a0€"],
    ["importeConSigno(100, \"USD\")", importeConSigno(100, "USD"), "+100,00\u00a0USD"],
    ["importeConSigno(1234.5, \"EUR\", 0)", importeConSigno(1234.5, "EUR", 0), "+1.235\u00a0€"],
    ["importeConSigno(NaN)", importeConSigno(Number.NaN), FALTA],
    ["porcentaje(0.1039)", porcentaje(0.1039), "10,39\u00a0%"],
    ["porcentaje(-0.114)", porcentaje(-0.114), "−11,40\u00a0%"],
    ["porcentaje(0)", porcentaje(0), "0,00\u00a0%"],
    ["porcentaje(0.00004)", porcentaje(0.00004), "0,00\u00a0%"],
    ["porcentaje(-0.00004)", porcentaje(-0.00004), "0,00\u00a0%"],
    /* Antes \u00ab0,03 %\u00bb: se multiplicaba por 100 (0,034999\u2026). Regla 7: se redondea la escritura decimal 0,035. */
    ["porcentaje(0.00035)", porcentaje(0.00035), "0,04\u00a0%"],
    ["porcentaje(12.3456)", porcentaje(12.3456), "1.234,56\u00a0%"],
    ["porcentaje(0.471, 1)", porcentaje(0.471, 1), "47,1\u00a0%"],
    ["porcentaje(-0.0004, 1)", porcentaje(-0.0004, 1), "0,0\u00a0%"],
    ["porcentaje(NaN)", porcentaje(Number.NaN), FALTA],
    ["porcentajeConSigno(0.1039)", porcentajeConSigno(0.1039), "+10,39\u00a0%"],
    ["porcentajeConSigno(-0.0254)", porcentajeConSigno(-0.0254), "−2,54\u00a0%"],
    ["porcentajeConSigno(0)", porcentajeConSigno(0), "0,00\u00a0%"],
    ["porcentajeConSigno(0.00004)", porcentajeConSigno(0.00004), "0,00\u00a0%"],
    ["porcentajeConSigno(-0.00004)", porcentajeConSigno(-0.00004), "0,00\u00a0%"],
    ["porcentajeConSigno(0.0001)", porcentajeConSigno(0.0001), "+0,01\u00a0%"],
    ["porcentajeConSigno(0.471, 1)", porcentajeConSigno(0.471, 1), "+47,1\u00a0%"],
    ["puntos(0.0125)", puntos(0.0125), "+1,25\u00a0pp"],
    ["puntos(-0.0123)", puntos(-0.0123), "−1,23\u00a0pp"],
    ["puntos(0)", puntos(0), "0,00\u00a0pp"],
    ["puntos(0.00004)", puntos(0.00004), "0,00\u00a0pp"],
    ["puntos(-0.00004)", puntos(-0.00004), "0,00\u00a0pp"],
    ["puntos(0.00211)", puntos(0.00211), "+0,21\u00a0pp"],
    ["puntos(0.0125, 1)", puntos(0.0125, 1), "+1,3\u00a0pp"],
    ["puntos(NaN)", puntos(Number.NaN), FALTA],
    ["ratio(1.18)", ratio(1.18), "1,18"],
    ["ratio(-0.456)", ratio(-0.456), "−0,46"],
    ["ratio(-0.001)", ratio(-0.001), "0,00"],
    ["ratio(1234.56)", ratio(1234.56), "1.234,56"],
    ["ratio(1234.5, 0)", ratio(1234.5, 0), "1.235"],
    ["ratio(NaN)", ratio(Number.NaN), FALTA],
    ["titulos(17.6642)", titulos(17.6642), "17,6642"],
    ["titulos(1051)", titulos(1051), "1.051"],
    ["titulos(d(\"523.1261\"))", titulos(d("523.1261")), "523,1261"],
    ["titulos(0.000001)", titulos(0.000001), "0,000001"],
    ["titulos(-0.0000001)", titulos(-0.0000001), "0"],
    ["titulos(-3.5)", titulos(-3.5), "−3,5"],
    ["titulos(1234567.5)", titulos(1234567.5), "1.234.567,5"],
    ["precio(535.02)", precio(535.02), "535,02"],
    ["precio(3.4)", precio(3.4), "3,40"],
    ["precio(12.34567)", precio(12.34567), "12,3457"],
    ["precio(1234.5)", precio(1234.5), "1.234,50"],
    ["precio(181.3171, \"EUR\")", precio(181.3171, "EUR"), "181,3171\u00a0€"],
    ["precio(1.0834, \"USD\")", precio(1.0834, "USD"), "1,0834\u00a0USD"],
    ["precio(250, \"GBX\")", precio(250, "GBX"), "250,00\u00a0GBX"],
    ["precio(NaN, \"USD\")", precio(Number.NaN, "USD"), FALTA],
    /* Antes «13 nov 2026» y «1 mar 2026», que no es ninguna forma del apartado 6: la fecha de tabla y detalle va con barras. */
    ["fecha(\"2026-11-13\")", fecha("2026-11-13"), "13/11/2026"],
    ["fecha(\"2026-03-01\")", fecha("2026-03-01"), "01/03/2026"],
    ["fechaLarga(\"2026-03-01\")", fechaLarga("2026-03-01"), "1 de marzo de 2026"],
    ["fechaLarga(\"2026-11-13\")", fechaLarga("2026-11-13"), "13 de noviembre de 2026"],
    ["fechaCorta(\"2026-03-01\")", fechaCorta("2026-03-01"), "01/03/2026"],
    ["fechaCorta(\"2026-11-13\")", fechaCorta("2026-11-13"), "13/11/2026"],
    ["valorDeMetrica(0.1039, porcentaje, con signo)", valorDeMetrica(0.1039, "porcentaje", "EUR", true), "+10,39\u00a0%"],
    ["valorDeMetrica(0.078, porcentaje, sin signo)", valorDeMetrica(0.078, "porcentaje", "EUR", false), "7,80\u00a0%"],
    ["valorDeMetrica(1234.5, importe, USD)", valorDeMetrica(1234.5, "importe", "USD", false), "1.234,50\u00a0USD"],
    ["valorDeMetrica(-50, importe, con signo)", valorDeMetrica(-50, "importe", "EUR", true), "−50,00\u00a0€"],
    ["valorDeMetrica(0.0125, puntos)", valorDeMetrica(0.0125, "puntos", "EUR", false), "+1,25\u00a0pp"],
    ["valorDeMetrica(1.18, ratio)", valorDeMetrica(1.18, "ratio", "EUR", true), "1,18"]
  ])("%s", (_llamada, texto, esperado) => {
    expect(texto).toBe(esperado);
  });

  it.each([
    ["claseDelSigno(0.0123)", claseDelSigno(0.0123), "gestor-sube"],
    ["claseDelSigno(-0.0123)", claseDelSigno(-0.0123), "gestor-baja"],
    ["claseDelSigno(12.3)", claseDelSigno(12.3), "gestor-sube"],
    ["claseDelSigno(0)", claseDelSigno(0), ""],
    ["claseDelSigno(0.00004)", claseDelSigno(0.00004), ""],
    ["claseDelSigno(-0.00004)", claseDelSigno(-0.00004), ""],
    ["claseDelSigno(0.0006)", claseDelSigno(0.0006), "gestor-sube"],
    ["claseDelSigno(-0.0006)", claseDelSigno(-0.0006), "gestor-baja"],
    ["claseDelSigno(-0.4, 0)", claseDelSigno(-0.4, 0), "gestor-baja"],
    ["claseDelSigno(-0.004, 0)", claseDelSigno(-0.004, 0), ""],
    ["claseDelSigno(null)", claseDelSigno(null), ""],
    ["claseDelSigno(undefined)", claseDelSigno(undefined), ""],
    ["claseDelSigno(NaN)", claseDelSigno(Number.NaN), ""]
  ])("%s", (_llamada, clase, esperada) => {
    expect(clase).toBe(esperada);
  });
});
