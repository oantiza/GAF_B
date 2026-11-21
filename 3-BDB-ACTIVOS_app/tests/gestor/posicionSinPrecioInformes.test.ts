/**
 * Una posición sin precio, en el Excel y en el informe del asesor (decisión de Óscar del 20-11-2026). Dicen lo mismo que
 * la pantalla: sus cifras faltan —«Falta el dato» en el papel; en el Excel, celdas vacías, que es la norma del libro—,
 * los totales son los de las demás y dicen que no la incluyen, y las cifras de la cartera que la cuentan como cero lo
 * dicen. Antes: valor 0, peso 0, latente −1.000 € y −100 %, y ni una palabra.
 *
 * La cartera es la de `posicionSinPrecio.test.ts`: A vale 1.200 € (10 títulos a 120 €, que costaron 1.000 €), B es una
 * acción en dólares comprada pagando 1.000 € sin precio, y quedan 1.000 € de efectivo. Patrimonio que se puede valorar:
 * 2.200 €; A pesa 1.200 / 2.200 = 54,5 %. Con 3.000 € aportados, el resultado es 2.200 − 3.000 = −800 € y la rentabilidad,
 * 2/3 × 1,1 − 1 = −26,67 % (de 3.000 € a 2.000 € el día 3 y de 2.000 € a 2.200 € el 31).
 *
 * El informe del CLIENTE lo dice también desde la decisión A-197 (20-11-2026): las tres últimas pruebas.
 */
import { describe, expect, test } from "vitest";
import { read, utils, type WorkSheet } from "xlsx";
import { crearExcel, crearInformePdf } from "../../src/gestor/informes";
import type { DatosDelInforme } from "../../src/gestor/informes/tipos";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import { METRICAS } from "../../src/gestor/motor/metricas/registro";
import type { CondicionesDelBono, Movimiento } from "../../src/gestor/motor/modelo";
import type { DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";
import { paginasDe } from "./informesAyudas";

const FIN = "2025-01-31";
const mercado: DatosDeMercado = {
  precios: new Map([["A", serie(["2025-01-02", 100], [FIN, 120])]]),
  /* El cambio del dólar, desde el 04-01: B se compra el 03-01 pagando en euros, y sin cambio ese día su precio no se
     deduce de lo pagado (A-196). */
  cambios: new Map([["USD", serie(["2025-01-04", 1.25])]])
};
const A = activo("A");
const B = activo("B", "ACCION", "USD");
const C = activo("C", "ACCION", "USD");
const BASE: Movimiento[] = [
  mov("aportacion", "2025-01-02", { importe: "3000" }),
  mov("compra", "2025-01-02", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" })
];
const COMPRA_DE_B = mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" });
const datosDe = (activos: Array<ReturnType<typeof activo>>, movimientos: Movimiento[], nombre: string, periodo = { desde: "2025-01-01", hasta: FIN }): DatosDelInforme => {
  const c = cartera(activos, movimientos, { nombre });
  return { analisis: analizar(preparar(c, mercado, new Map(), FIN), periodo), cartera: c, generado: FIN };
};
const datos = datosDe([A, B], [...BASE, COMPRA_DE_B], "Cartera con una posición sin precio");
/* Con dos: C, otra acción en dólares, 10 títulos pagando 100 € sin precio. Quedan 900 € de efectivo: 1.200 + 900 = 2.100 €. */
const conDos = datosDe([A, B, C], [...BASE, COMPRA_DE_B, mov("compra", "2025-01-03", { activoId: "C", titulos: "10", importe: "-100" })], "Cartera con dos posiciones sin precio");
/* Sin ninguna: solo A. 1.200 € de A y 2.000 € de efectivo. */
const sinNinguna = datosDe([A], BASE, "Cartera con todos los precios");

const FALTA = "Falta el dato";
const COMO_CERO = "Cuenta Activo B como cero, porque no tiene precio.";
/* Lo que no puede salir cuando todas las posiciones tienen precio: las colas de las dos frases y sus formas sin nombres.
   No vale buscar «no incluye» o «como cero» a secas: otras frases de siempre las llevan con otro sentido. */
const DE_UNA_SIN_PRECIO = [FALTA, "que no tiene precio", "que no tienen precio", "porque no tiene precio", "porque no tienen precio", "sin precio"];
const filas = (hoja: WorkSheet) => utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: null });
const libroDe = async (d: DatosDelInforme) => read(Buffer.from(await (await crearExcel(d)).arrayBuffer()), { type: "buffer" });
/** Las posiciones de la hoja, cada una por el título de su columna. */
const posicionesDe = (hoja: WorkSheet) => {
  const [cabecera, ...resto] = filas(hoja) as [string[], ...unknown[][]];
  return (nombre: string) => Object.fromEntries(cabecera.map((titulo, i) => [titulo, resto.find((fila) => fila[0] === nombre)![i]]));
};
/** La última fila con algo escrito, que es donde va la nota de una hoja. */
const ultimaFila = (hoja: WorkSheet) => (filas(hoja) as unknown[][]).filter((fila) => fila.some((celda) => celda !== null)).at(-1)!;
const cuantas = (texto: string, frase: string) => texto.split(frase).length - 1;

describe("el Excel", () => {
  test("Posiciones: las cifras que la posición no tiene por no tener precio van vacías; el coste y lo cobrado se dan", async () => {
    const de = posicionesDe((await libroDe(datos)).Sheets.Posiciones);
    const b = de("Activo B");
    /* Lo dice la fuente; las celdas, vacías: en una hoja de datos, lo que falta no es un texto ni un cero. */
    expect(b["Fuente del precio"]).toBe("Sin precio");
    /* Antes: precio y valor 0, peso 0, latente −1.000 €, −100 %, resultado del periodo −1.000 € y contribución −33,33 puntos. */
    for (const columna of ["Precio", "Antigüedad (días)", "Valor", "Peso", "Latente", "Latente %", "Resultado del periodo", "Contribución"]) expect(b[columna], columna).toBeNull();
    expect(b.Coste).toBe(1000);
    /* Lo cobrado es dinero, y se da: nada. */
    expect(b["Ingresos del periodo"]).toBe(0);
    /* La que sí lo tiene, con sus cifras: 1.200 € de valor, 6/11 de peso, +200 € y +20 %, y 200 / 3.000 de contribución. */
    const a = de("Activo A");
    expect(a.Valor).toBe(1200);
    expect(a.Peso as number).toBeCloseTo(6 / 11, 12);
    expect(a.Latente).toBe(200);
    expect(a["Latente %"] as number).toBeCloseTo(0.2, 12);
    expect(a["Resultado del periodo"] as number).toBeCloseTo(200, 9);
    expect(a["Contribución"] as number).toBeCloseTo(200 / 3000, 12);
  });

  test("Posiciones, con dos sin precio y con un dividendo cobrado por una de ellas", async () => {
    const dos = posicionesDe((await libroDe(conDos)).Sheets.Posiciones);
    for (const nombre of ["Activo B", "Activo C"]) for (const columna of ["Precio", "Valor", "Peso", "Latente", "Latente %", "Resultado del periodo", "Contribución"]) expect(dos(nombre)[columna], `${nombre} · ${columna}`).toBeNull();
    expect(dos("Activo C").Coste).toBe(100);
    /* B cobra un dividendo de 50 € el 20-01: es dinero, y se da, aunque su resultado del periodo siga sin conocerse. */
    const conDividendo = datosDe([A, B], [...BASE, COMPRA_DE_B, mov("dividendo", "2025-01-20", { activoId: "B", importe: "50" })], "Cartera con un dividendo");
    const b = posicionesDe((await libroDe(conDividendo)).Sheets.Posiciones)("Activo B");
    expect(b["Ingresos del periodo"]).toBe(50);
    expect(b["Resultado del periodo"]).toBeNull();
    expect(conDividendo.analisis.posiciones.find((p) => p.activo.id === "B")).toMatchObject({ ingresosDelPeriodo: 50, resultadoDelPeriodo: null, contribucion: null });
    /* Y el efectivo los tiene: 1.000 + 50, con los 1.200 € de A. */
    expect(conDividendo.analisis.patrimonio).toBeCloseTo(2250, 9);
  });

  test("Resumen: cada cifra lleva su salvedad tras la ayuda", async () => {
    const resumen = filas((await libroDe(datos)).Sheets.Resumen) as unknown[][];
    const de = (nombre: string) => resumen.find((fila) => fila[0] === nombre)!;
    const ayuda = (id: string) => METRICAS.find((m) => m.id === id)!.ayuda;
    /* El patrimonio y el resultado latente no la incluyen: 1.200 + 1.000 = 2.200 €, y el latente de A, +200 €. */
    expect(de("Patrimonio")[1]).toBe(2200);
    expect(de("Patrimonio")[2]).toBe(`${ayuda("patrimonio")} No incluye Activo B, que no tiene precio.`);
    expect(de("Resultado latente")[1]).toBe(200);
    expect(de("Resultado latente")[2]).toBe(`${ayuda("resultadoLatente")} No incluye Activo B, que no tiene precio.`);
    /* El resultado y la rentabilidad sí la cuentan, y como cero: 2.200 − 3.000 = −800 €, y 2/3 × 1,1 − 1 = −26,67 %. */
    expect(de("Resultado")[1]).toBeCloseTo(-800, 9);
    expect(de("Resultado")[2]).toBe(`${ayuda("resultado")} ${COMO_CERO}`);
    expect(de("Rentabilidad")[1]).toBeCloseTo((2 / 3) * 1.1 - 1, 12);
    expect(de("Rentabilidad")[2]).toBe(`${ayuda("rentabilidad")} ${COMO_CERO}`);
    /* Lo que es dinero movido no lleva nada detrás de su ayuda, ni lo que no se da (un mes no se anualiza). */
    expect(de("Aportaciones netas")[2]).toBe(ayuda("aportacionesNetas"));
    expect(de("Rentabilidad anual")[2]).toBe(ayuda("rentabilidadAnualizada"));
  });

  test("Resumen, en un periodo sin cifras: ninguna salvedad, tampoco la del patrimonio", async () => {
    /* Del 31 al 31 de enero no hay un día completo que medir: la hoja no da ninguna cifra, y no le cuelga ninguna frase. */
    const sinCifras = datosDe([A, B], [...BASE, COMPRA_DE_B], "Cartera sin periodo", { desde: FIN, hasta: FIN });
    expect(sinCifras.analisis.rentabilidad).toBeUndefined();
    expect(sinCifras.analisis.sinPrecio).toHaveLength(1);
    const resumen = filas((await libroDe(sinCifras)).Sheets.Resumen) as unknown[][];
    for (const m of METRICAS) expect(resumen.find((fila) => fila[0] === m.nombre)![2], m.id).toBe(m.formato === "puntos" ? `${m.ayuda} (Diferencia en puntos porcentuales.)` : m.ayuda);
  });

  test("las hojas que salen de la serie del valor y la del reparto lo dicen en su última fila", async () => {
    const libro = await libroDe(datos);
    expect(ultimaFila(libro.Sheets["Composición"])[0]).toBe("El reparto no incluye Activo B, que no tiene precio.");
    expect(ultimaFila(libro.Sheets["Rentabilidad mensual"])[0]).toBe("Estas cifras cuentan Activo B como cero, porque no tiene precio.");
    expect(ultimaFila(libro.Sheets["Ingresos y costes"])[0]).toBe("El patrimonio medio cuenta Activo B como cero, porque no tiene precio. Los porcentajes de esta hoja son sobre ese patrimonio.");
    /* El filtro de la rentabilidad mensual cubre la cabecera y su único año, no la nota: de la A a la O (año, doce meses, total e incompleto). */
    expect(libro.Sheets["Rentabilidad mensual"]["!autofilter"]?.ref).toBe("A1:O2");
  });

  test("con todas con precio, ninguna hoja dice nada de esto", async () => {
    const libro = await libroDe(sinNinguna);
    for (const nombre of libro.SheetNames) {
      const texto = (filas(libro.Sheets[nombre]) as unknown[][]).flat().filter((celda): celda is string => typeof celda === "string").join(" | ");
      for (const frase of DE_UNA_SIN_PRECIO) expect(texto, `${nombre} · ${frase}`).not.toContain(frase);
    }
    expect(ultimaFila(libro.Sheets["Rentabilidad mensual"])[0]).toBe(2025);
  });
});

describe("el informe del asesor", () => {
  test("la tabla de posiciones dice «Falta el dato» en las siete cifras de B; los totales son los de A, y lo dicen", async () => {
    const { paginas } = await paginasDe(await crearInformePdf("asesor", datos), "asesor-con-una-posicion-sin-precio");
    const hoja = paginas.find((pagina) => pagina.includes("Total posiciones (2)"))!;
    const filaDeB = hoja.slice(hoja.indexOf("Activo B"), hoja.indexOf("Total posiciones (2)"));
    const total = hoja.slice(hoja.indexOf("Total posiciones (2)"), hoja.indexOf("Activo B no tiene precio"));
    /* De B: precio, valor, peso, latente, su porcentaje, resultado del periodo y contribución. Y su coste. */
    expect(cuantas(filaDeB, FALTA)).toBe(7);
    expect(filaDeB).toContain("1.000,00 €");
    expect(filaDeB).not.toContain("Sin precio · del día");
    /* Ni lo pagado como perdido ni sus puntos: antes, 0,00 €, 0,0 %, −1.000,00 €, −100,00 % y −33,33 pp. */
    for (const antes of ["−100,00 %", "0,00 USD", "−1.000,00 €", "33,33"]) expect(hoja, antes).not.toContain(antes);
    /* El total, celda a celda: 1.200,00 € de valor y 54,5 % de peso, que son los de A; 2.000,00 € de coste, que cuenta a las
       dos; y el latente, el resultado del periodo y la contribución de A: +200,00 €, +200,00 € y +6,67 pp. Nada falta. */
    expect(total.trim().split(/\s+/).join(" ")).toBe("Total posiciones (2) 1.200,00 € 54,5 % 2.000,00 € +200,00 € +200,00 € +6,67 pp");
    expect(hoja).toContain(
      "Activo B no tiene precio: su valor, su peso, su resultado latente, su resultado del periodo y su contribución no se conocen. Los totales no la incluyen, salvo el del coste, que sí la cuenta."
    );
    expect(hoja).toContain("Patrimonio a la fecha: 2.200,00 € (posiciones más efectivo). No incluye Activo B, que no tiene precio.");
  });

  test("el resumen agrupa las salvedades, y cada sección que sale de la serie del valor lo dice", async () => {
    const { paginas } = await paginasDe(await crearInformePdf("asesor", datos), "asesor-con-una-posicion-sin-precio");
    const texto = paginas.join("\n");
    /* Bajo las métricas: las dos cifras que no la incluyen, y las cuatro que se dan en un mes y la cuentan como cero. */
    expect(texto).toContain("Patrimonio y Resultado latente: ninguna incluye Activo B, que no tiene precio.");
    expect(texto).toContain("Resultado, Rentabilidad, Rentabilidad del cliente y Caída máxima: cada una cuenta Activo B como cero, porque no tiene precio.");
    /* En «Rentabilidad y riesgo», una vez y arriba; en «Composición» y en «Ingresos y costes», con su frase. */
    expect(cuantas(texto, "Estas cifras cuentan Activo B como cero, porque no tiene precio. Vale para toda esta sección.")).toBe(1);
    expect(cuantas(texto, "El reparto no incluye Activo B, que no tiene precio.")).toBe(1);
    expect(cuantas(texto, "El patrimonio medio cuenta Activo B como cero, porque no tiene precio. Los porcentajes de esta sección son sobre ese patrimonio.")).toBe(1);
    expect(texto).not.toMatch(/undefined|NaN|\[object|Infinity/);
  });

  test("con dos sin precio, en plural", async () => {
    const { paginas } = await paginasDe(await crearInformePdf("asesor", conDos), "asesor-con-dos-posiciones-sin-precio");
    const texto = paginas.join("\n");
    const hoja = paginas.find((pagina) => pagina.includes("Total posiciones (3)"))!;
    expect(hoja).toContain(
      "Activo B y Activo C no tienen precio: el valor, el peso, el resultado latente, el resultado del periodo y la contribución de cada una no se conocen. Los totales no las incluyen, salvo el del coste, que sí las cuenta."
    );
    /* 1.200 € de A y 900 € de efectivo; el coste, 1.000 + 1.000 + 100; A pesa 1.200 / 2.100 = 57,1 %. */
    expect(hoja).toContain("Patrimonio a la fecha: 2.100,00 € (posiciones más efectivo). No incluye Activo B ni Activo C, que no tienen precio.");
    const total = hoja.slice(hoja.indexOf("Total posiciones (3)"), hoja.indexOf("Activo B y Activo C no tienen precio"));
    expect(total.trim().split(/\s+/).join(" ")).toBe("Total posiciones (3) 1.200,00 € 57,1 % 2.100,00 € +200,00 € +200,00 € +6,67 pp");
    expect(cuantas(hoja.slice(hoja.indexOf("Activo B"), hoja.indexOf("Total posiciones (3)")), FALTA)).toBe(14);
    expect(texto).toContain("Patrimonio y Resultado latente: ninguna incluye Activo B ni Activo C, que no tienen precio.");
    expect(texto).toContain("cada una cuenta Activo B y Activo C como cero, porque no tienen precio.");
  });

  test("si además no se conoce su coste, el total del coste no se da y la nota no dice que la cuenta", async () => {
    /* B, en dólares, pagada con 800 libras de una cuenta en libras, y el mercado no trae el cambio de la libra: no tiene
       precio ni coste en euros. La tabla dice que faltan sus ocho cifras, y el total del coste, también. Las libras entran
       y salen enteras, así que el efectivo son los 2.000 € que quedan de los 3.000: el patrimonio que se puede valorar es
       1.200 + 2.000 = 3.200 €, y A pesa 1.200 / 3.200 = 37,5 %. */
    const sinCoste = datosDe(
      [A, B],
      [...BASE, mov("aportacion", "2025-01-02", { importe: "800", divisa: "GBP" }), mov("compra", "2025-01-03", { activoId: "B", titulos: "10", divisa: "GBP", importe: "-800" })],
      "Cartera con una posición sin precio ni coste"
    );
    const { paginas } = await paginasDe(await crearInformePdf("asesor", sinCoste), "asesor-con-una-posicion-sin-precio-ni-coste");
    const hoja = paginas.find((pagina) => pagina.includes("Total posiciones (2)"))!;
    expect(cuantas(hoja.slice(hoja.indexOf("Activo B"), hoja.indexOf("Total posiciones (2)")), FALTA)).toBe(8);
    const total = hoja.slice(hoja.indexOf("Total posiciones (2)"), hoja.indexOf("Activo B no tiene precio"));
    expect(total.trim().split(/\s+/).join(" ")).toBe(`Total posiciones (2) 1.200,00 € 37,5 % ${FALTA} +200,00 € +200,00 € +6,67 pp`);
    expect(hoja).toContain("su contribución no se conocen. Los totales no la incluyen.");
    expect(hoja).not.toContain("salvo el del coste");
  });

  test("si ninguna tiene precio, los totales que no se pueden dar lo dicen: no se inventa un 0,00 €", async () => {
    /* Solo B: 1.000 € aportados y pagados por ella. De la tabla solo se conoce el coste. */
    const soloB = datosDe([B], [mov("aportacion", "2025-01-02", { importe: "1000" }), mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" })], "Cartera con una sola posición, sin precio");
    const { paginas } = await paginasDe(await crearInformePdf("asesor", soloB), "asesor-con-una-sola-posicion-sin-precio");
    const hoja = paginas.find((pagina) => pagina.includes("Total posiciones (1)"))!;
    const total = hoja.slice(hoja.indexOf("Total posiciones (1)"), hoja.indexOf("Activo B no tiene precio"));
    /* Valor, peso, [coste], latente, resultado del periodo y contribución. */
    expect(total.trim().split(/\s+/).join(" ")).toBe(`Total posiciones (1) ${FALTA} ${FALTA} 1.000,00 € ${FALTA} ${FALTA} ${FALTA}`);
  });

  test("con todas con precio, el informe no dice nada de esto", async () => {
    const { paginas } = await paginasDe(await crearInformePdf("asesor", sinNinguna), "asesor-con-todos-los-precios");
    const texto = paginas.join("\n");
    for (const frase of [...DE_UNA_SIN_PRECIO, "ninguna incluye", "cada una cuenta"]) expect(texto, frase).not.toContain(frase);
    /* Y el total de la tabla es el de su única fila: 1.200 € de 3.200 € son el 37,5 %. */
    const hoja = paginas.find((pagina) => pagina.includes("Total posiciones (1)"))!;
    expect(hoja).toContain("Total posiciones (1) 1.200,00 € 37,5 % 1.000,00 € +200,00 € +200,00 € +6,67 pp");
  });
});

describe("el informe del cliente dice lo que falta (A-197)", () => {
  test("una posición sin precio sale en su lista con «Falta el dato», y cada cifra que la cuenta como cero lo dice", async () => {
    /*
     * Decisión de Óscar del 20-11-2026 («Decirlo siempre»): hasta entonces la posición no salía entre «sus posiciones» y lo
     * único que la nombraba era la nota de los precios. El patrimonio y lo perdido no cambian —2.200 € y −800 €, los de la
     * serie del valor—: cambia que lo dicen.
     */
    const { paginas } = await paginasDe(await crearInformePdf("cliente", datos), "cliente-con-una-posicion-sin-precio");
    const texto = paginas.join("\n").split(/\s+/).join(" ");
    expect(texto).toContain("su cartera vale 2.200,00 €. Esa cifra no incluye Activo B, que no tiene precio.");
    expect(texto).toContain("Sin precio: no se puede valorar.");
    expect(texto).toContain(FALTA);
    /* «Cómo ha ido», «De dónde viene» y «Riesgo» salen de la serie del valor, y cada una lo dice debajo. */
    const comoCero = "Estas cifras cuentan Activo B como cero, porque no tiene precio.";
    expect(texto.split(comoCero).length - 1).toBe(3);
    expect(texto).toContain("800,00 €");
    /* La nota de los precios sigue. */
    expect(texto).toContain("Sin precio, y por eso cuentan como cero: Activo B.");
    expect(texto).not.toMatch(/undefined|NaN|\[object|Infinity/);
  });

  test("con todas con precio, no dice nada de esto", async () => {
    const { paginas } = await paginasDe(await crearInformePdf("cliente", sinNinguna), "cliente-con-todos-los-precios");
    const texto = paginas.join("\n").split(/\s+/).join(" ");
    for (const frase of [...DE_UNA_SIN_PRECIO, "Esa cifra no incluye", "Estas cifras cuentan"]) expect(texto, frase).not.toContain(frase);
  });

  test("con un bono sin precio: sale en su lista sin valor, y no cuenta su cupón corrido", async () => {
    /*
     * Un bono sin precio valía su cupón corrido y salía en «Posiciones» con ese valor y la nota «Sin precio: cuenta como
     * cero.»; desde la A-193 vale cero entero, y desde la A-197 sale en la lista con «Falta el dato». Es el bono de
     * `posicionSinPrecio.test.ts`: 1.000 de nominal en dólares al 5 %, comprado el 02-01-2025 pagando 900 € sin escribir el
     * precio, con 2.000 € aportados. El 12-04-2025 su cupón corrido son 1.000 × 5 % × 100 / 365 = 13,6986 $, que con el
     * dólar a 1,25 son 10,96 €. Antes, «su cartera vale 1.110,96 €» (1.100 de efectivo más el cupón); ahora, 1.100,00 €.
     */
    const condiciones: CondicionesDelBono = { cupon: "0.05", frecuencia: 1, vencimiento: "2030-01-02", base: "ACT/ACT" };
    const BONO = activo("BON", "BONO", "USD", { multiplicador: "0.01", bono: condiciones });
    const c = cartera([BONO], [mov("aportacion", "2025-01-02", { importe: "2000" }), mov("compra", "2025-01-02", { activoId: "BON", titulos: "1000", importe: "-900" })], { nombre: "Cartera con un bono sin precio" });
    const DIA = "2025-04-12";
    const soloElCambio: DatosDeMercado = { precios: new Map(), cambios: new Map([["USD", serie(["2025-01-03", 1.25])]]) };
    const delBono: DatosDelInforme = { analisis: analizar(preparar(c, soloElCambio, new Map(), DIA), { desde: "2025-01-01", hasta: DIA }), cartera: c, generado: DIA };
    expect(delBono.analisis.patrimonio).toBe(1100);
    const { paginas } = await paginasDe(await crearInformePdf("cliente", delBono), "cliente-con-un-bono-sin-precio");
    const texto = paginas.join("\n").split(/\s+/).join(" ");
    expect(texto).toContain("su cartera vale 1.100,00 €. Esa cifra no incluye Activo BON, que no tiene precio.");
    for (const antes of ["1.110,96 €", "10,96 €", "Sin precio: cuenta como cero."]) expect(texto, antes).not.toContain(antes);
    expect(texto).toContain("Sin precio: no se puede valorar.");
    expect(texto).toContain("Sin precio, y por eso cuentan como cero: Activo BON.");
    expect(texto).not.toMatch(/undefined|NaN|\[object|Infinity/);
  });
});
