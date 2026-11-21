// @vitest-environment happy-dom
/**
 * Una posición sin precio, en la pantalla (decisión de Óscar del 20-11-2026): Cuentas escribe «Falta el dato» en su precio,
 * su valor, su peso, su resultado y su porcentaje —antes, 0,00 €, 0,0 %, −1.000,00 € y −100,00 %—, y cada total que no la
 * cuenta lo dice: el pie de la tabla, el total del bloque, el patrimonio del titular y lo que pasa a Diseño. Y cada cifra
 * que sí la cuenta, y como cero, también: el resultado, las rentabilidades y el riesgo, en la cabecera, en el Resumen, en
 * Análisis y en Comparar.
 *
 * La cartera es la de `posicionSinPrecio.test.ts`, con sus cuentas: 3.000 € aportados; A, 10 títulos a 100 € que valen 120 €
 * (1.200 €); B, una acción en dólares comprada pagando 1.000 € sin precio; 1.000 € de efectivo. El patrimonio que se puede
 * valorar es 1.200 + 1.000 = 2.200 €, y A pesa 1.200 / 2.200 = 54,5 %.
 */
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import { analizar } from "../../src/gestor/motor/analisis";
import { RespuestaDeLaCartera } from "../../src/gestor/ui/RespuestaDeLaCartera";
import { BloqueComposicion } from "../../src/gestor/ui/analisis/BloqueComposicion";
import { BloqueContribucion } from "../../src/gestor/ui/analisis/BloqueContribucion";
import { BloqueIngresosYCostes } from "../../src/gestor/ui/analisis/BloqueIngresosYCostes";
import { BloqueMeses } from "../../src/gestor/ui/analisis/BloqueMeses";
import { BloqueReferencia } from "../../src/gestor/ui/analisis/BloqueReferencia";
import { BloqueRentabilidad } from "../../src/gestor/ui/analisis/BloqueRentabilidad";
import { BloqueRiesgo } from "../../src/gestor/ui/analisis/BloqueRiesgo";
import { LlevarADiseno } from "../../src/gestor/ui/comparar/LlevarADiseno";
import { notasDeLaComparada } from "../../src/gestor/ui/comparar/notas";
import { VistaComparar } from "../../src/gestor/ui/vistas/VistaComparar";
import { VistaCuentas } from "../../src/gestor/ui/vistas/VistaCuentas";
import { VistaResumen } from "../../src/gestor/ui/vistas/VistaResumen";
import { activo, cartera, mov, serie, serieDiaria } from "./ayudas";
import { datosDeVista, panel, pintar, type Pintado } from "./vistaAnalisisDatos";

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

const ESPACIO_DURO = String.fromCharCode(0xa0);
const plano = (texto: string | null | undefined) => (texto ?? "").replaceAll(ESPACIO_DURO, " ").trim();

const MERCADO: MercadoCargado = {
  datos: { precios: new Map([["A", serie(["2025-01-02", 100], ["2025-01-31", 120])]]), cambios: new Map([["USD", serie(["2025-01-04", 1.25])]]) },
  fichas: new Map(),
  avisos: []
};
const movimientos = (...mas: ReturnType<typeof mov>[]) => [
  mov("aportacion", "2025-01-02", { importe: "3000" }),
  mov("compra", "2025-01-02", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
  mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" }),
  ...mas
];
const CON_UNA = cartera([activo("A"), activo("B", "ACCION", "USD")], movimientos());
/* Con dos: C, otra acción en dólares, 10 títulos pagando 100 € sin precio. Queda 900 € de efectivo: 1.200 + 900 = 2.100 €. */
const CON_DOS = cartera([activo("A"), activo("B", "ACCION", "USD"), activo("C", "ACCION", "USD")], movimientos(mov("compra", "2025-01-03", { activoId: "C", titulos: "10", importe: "-100" })));

/** Lo que dice cada celda de una fila, por el título de su columna: su texto y, si lo es, que es una ausencia. */
function fila(tabla: HTMLElement, nombre: string): Record<string, { texto: string; falta: boolean; apunte: string }> {
  const titulos = [...tabla.querySelectorAll("thead th")].map((th) => plano(th.querySelector("button")?.childNodes[0]?.textContent ?? th.textContent));
  const tr = [...tabla.querySelectorAll("tbody tr")].find((candidata) => candidata.querySelector("th")?.textContent?.startsWith(nombre));
  if (!tr) throw new Error(`No hay una fila «${nombre}».`);
  return Object.fromEntries(
    [...tr.children].map((celda, i) => {
      const ausencia = celda.querySelector(".tabla__ausencia");
      return [titulos[i], { texto: plano(ausencia?.textContent ?? celda.childNodes[0]?.textContent), falta: ausencia !== null, apunte: plano(celda.querySelector(".tabla__apunte")?.textContent) }];
    })
  );
}

/** El pie de la tabla, por el título de su columna: el texto y su apunte. */
function pie(tabla: HTMLElement): Record<string, { texto: string; apunte: string }> {
  const titulos = [...tabla.querySelectorAll("thead th")].map((th) => plano(th.querySelector("button")?.childNodes[0]?.textContent ?? th.textContent));
  const celdas = [...tabla.querySelectorAll("tfoot tr.tabla__pie > *")];
  return Object.fromEntries(celdas.map((celda, i) => [titulos[i], { texto: plano(celda.childNodes[0]?.textContent), apunte: plano(celda.querySelector(".tabla__apunte")?.textContent) }]));
}

describe("Cuentas: la fila de una posición sin precio", () => {
  it("dice «Falta el dato» en su precio, su valor, su peso, su resultado y su porcentaje, con la pieza; su coste se da", async () => {
    pintado = await pintar(<VistaCuentas datos={datosDeVista(CON_UNA, MERCADO)} />);
    const b = fila(panel(pintado.vista, "Cuenta de valores"), "Activo B");
    for (const columna of ["Precio", "Valor", "Peso", "Resultado latente", "%"]) {
      expect(b[columna], columna).toMatchObject({ texto: "Falta el dato", falta: true });
    }
    expect(b.Precio.apunte).toBe("Sin precio");
    expect(b.Coste).toMatchObject({ texto: "1.000,00 €", falta: false });
    /* En ningún sitio de la fila queda el −100 % ni la pérdida de todo lo pagado. */
    const texto = plano([...panel(pintado.vista, "Cuenta de valores").querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Activo B"))?.textContent);
    expect(texto).not.toContain("100,00 %");
    expect(texto).not.toContain("−1.000,00");
  });

  it("la que sí tiene precio no cambia: 1.200,00 €, 54,5 %, +200,00 € y +20,00 %", async () => {
    pintado = await pintar(<VistaCuentas datos={datosDeVista(CON_UNA, MERCADO)} />);
    const a = fila(panel(pintado.vista, "Cuenta de valores"), "Activo A");
    expect(a.Precio).toMatchObject({ texto: "120,00 €", falta: false });
    expect(a.Valor.texto).toBe("1.200,00 €");
    expect(a.Peso.texto).toBe("54,5 %");
    expect(a.Coste.texto).toBe("1.000,00 €");
    expect(plano(panel(pintado.vista, "Cuenta de valores").textContent)).toContain("+200,00 €");
    expect(plano(panel(pintado.vista, "Cuenta de valores").textContent)).toContain("+20,00 %");
  });

  it("va la última, se ordene la tabla como se ordene: lo que falta no es el valor más bajo", async () => {
    /* Tres filas: A vale 1.200 €; Z, 10 títulos a 10 € cuya serie acaba en 0 €, vale 0,00 € y tiene precio; B no tiene
       precio. De menor a mayor valor, un cero que no lo es pondría a B la primera. */
    const conUnaACero = cartera(
      [activo("A"), activo("B", "ACCION", "USD"), activo("Z")],
      movimientos(mov("compra", "2025-01-02", { activoId: "Z", titulos: "10", precio: "10", importe: "-100" }))
    );
    const mercado: MercadoCargado = { ...MERCADO, datos: { ...MERCADO.datos, precios: new Map([...MERCADO.datos.precios, ["Z", serie(["2025-01-02", 10], ["2025-01-31", 0])]]) } };
    pintado = await pintar(<VistaCuentas datos={datosDeVista(conUnaACero, mercado)} />);
    const tabla = () => panel(pintado!.vista, "Cuenta de valores");
    const nombres = () => [...tabla().querySelectorAll("tbody tr th")].map((th) => plano(th.childNodes[0]?.textContent));
    const pulsar = async (titulo: string) => {
      /* El título es el texto suelto del botón: la flecha del orden, cuando la hay, va en su propio elemento. */
      const tituloDe = (boton: HTMLButtonElement) => plano([...boton.childNodes].filter((nodo) => nodo.nodeType === 3).map((nodo) => nodo.textContent).join(""));
      const boton = [...tabla().querySelectorAll<HTMLButtonElement>("thead th button")].find((candidato) => tituloDe(candidato) === titulo);
      if (!boton) throw new Error(`No hay cabecera «${titulo}».`);
      await act(async () => boton.click());
    };
    /* Tal como llega: de más a menos valor, y la que no tiene precio al final. */
    expect(nombres()).toEqual(["Activo A", "Activo Z", "Activo B"]);
    /* Por valor, en un sentido y en el otro: B sigue la última las dos veces. */
    await pulsar("Valor");
    const primero = nombres();
    await pulsar("Valor");
    const segundo = nombres();
    expect([primero, segundo].map((orden) => orden.slice(0, 2)).sort()).toEqual([["Activo A", "Activo Z"], ["Activo Z", "Activo A"]]);
    expect(primero[2]).toBe("Activo B");
    expect(segundo[2]).toBe("Activo B");
  });
});

describe("Cuentas: los totales dicen lo que no incluyen", () => {
  const DE_SIEMPRE = "El coste es lo pagado por los títulos que quedan, con sus comisiones, empezando a vender por los más antiguos. El resultado latente es el valor menos ese coste; no está materializado.";
  /** La nota del bloque: una sola, que antes eran dos párrafos pegados. */
  const nota = (bloque: HTMLElement) => {
    const notas = [...bloque.querySelectorAll("p.cmp-note")].map((parrafo) => plano(parrafo.textContent));
    expect(notas).toHaveLength(1);
    return notas[0];
  };

  it("el pie suma lo que se puede valorar y lo dice bajo su rótulo; el coste sí la cuenta", async () => {
    pintado = await pintar(<VistaCuentas datos={datosDeVista(CON_UNA, MERCADO)} />);
    const total = pie(panel(pintado.vista, "Cuenta de valores"));
    /* Bajo el rótulo, que es la celda ancha y vale para toda la fila: bajo la cifra ensanchaba la columna y la tabla no
       cabía a 1.024 px. Con las mismas palabras que el total del bloque. */
    expect(total.Activo).toEqual({ texto: "Total invertido", apunte: "No incluye una posición sin precio" });
    expect(total.Valor).toEqual({ texto: "1.200,00 €", apunte: "" });
    /* 1.200 / 2.200. */
    expect(total.Peso.texto).toBe("54,5 %");
    /* Los 1.000 € de A y los 1.000 € de B. */
    expect(total.Coste.texto).toBe("2.000,00 €");
    /* El latente es el de A, 1.200 − 1.000: antes sumaba el −1.000 € de B y salía −800,00 €. */
    expect(total["Resultado latente"].texto).toBe("+200,00 €");
  });

  it("el total del bloque y la nota de debajo lo dicen con su nombre", async () => {
    pintado = await pintar(<VistaCuentas datos={datosDeVista(CON_UNA, MERCADO)} />);
    const bloque = panel(pintado.vista, "Cuenta de valores");
    expect(plano(bloque.textContent)).toContain("2.200,00 € en total · no incluye una posición sin precio");
    expect(nota(bloque)).toBe(
      `${DE_SIEMPRE} Activo B no tiene precio: su valor, su peso y su resultado no se conocen hasta que se le ponga uno. Los totales de la tabla y el patrimonio no la incluyen, salvo el del coste, que sí la cuenta.`
    );
  });

  it("con dos, en plural y nombrando a las dos", async () => {
    pintado = await pintar(<VistaCuentas datos={datosDeVista(CON_DOS, MERCADO)} />);
    const bloque = panel(pintado.vista, "Cuenta de valores");
    expect(pie(bloque).Activo).toEqual({ texto: "Total invertido", apunte: "No incluye 2 posiciones sin precio" });
    expect(pie(bloque).Valor).toEqual({ texto: "1.200,00 €", apunte: "" });
    /* Los 1.000 € de A, los 1.000 € de B y los 100 € de C. */
    expect(pie(bloque).Coste.texto).toBe("2.100,00 €");
    expect(plano(bloque.textContent)).toContain("2.100,00 € en total · no incluye 2 posiciones sin precio");
    expect(nota(bloque)).toBe(
      `${DE_SIEMPRE} Activo B y Activo C no tienen precio: el valor, el peso y el resultado de cada una no se conocen hasta que tenga uno. Los totales de la tabla y el patrimonio no las incluyen, salvo el del coste, que sí las cuenta.`
    );
  });

  it("con todas con precio no se dice nada de esto", async () => {
    const todas = cartera([activo("A")], movimientos().slice(0, 2));
    pintado = await pintar(<VistaCuentas datos={datosDeVista(todas, MERCADO)} />);
    const bloque = panel(pintado.vista, "Cuenta de valores");
    expect(plano(bloque.textContent)).not.toContain("sin precio");
    expect(plano(bloque.textContent)).not.toContain("no tiene precio");
    expect(pie(bloque).Activo).toEqual({ texto: "Total invertido", apunte: "" });
    expect(pie(bloque).Valor).toEqual({ texto: "1.200,00 €", apunte: "" });
    expect(pie(bloque)["Resultado latente"].texto).toBe("+200,00 €");
    expect(nota(bloque)).toBe(DE_SIEMPRE);
  });

  it("si ninguna tiene precio, los totales que no se pueden dar lo dicen: no se inventa un 0,00 €", async () => {
    /* Solo B: 1.000 € aportados y pagados por ella. No hay nada que sumar en el valor, el peso ni el latente. */
    const soloB = cartera([activo("B", "ACCION", "USD")], [mov("aportacion", "2025-01-02", { importe: "1000" }), mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" })]);
    pintado = await pintar(<VistaCuentas datos={datosDeVista(soloB, MERCADO)} />);
    const tabla = panel(pintado.vista, "Cuenta de valores");
    const total = pie(tabla);
    const pieConPieza = [...tabla.querySelectorAll("tfoot tr.tabla__pie .tabla__ausencia")].map((ausencia) => plano(ausencia.textContent));
    /* Tres celdas con la pieza de ausencia: valor, peso y latente. El coste sí se da. */
    expect(pieConPieza).toEqual(["Falta el dato", "Falta el dato", "Falta el dato"]);
    expect(total.Coste.texto).toBe("1.000,00 €");
    /* El pie no escribe ningún cero: cada total que no se puede dar dice que falta. El total del bloque sí dice 0,00 €, y es
       verdad: no queda efectivo, y a B no la incluye. */
    for (const columna of ["Valor", "Peso", "Resultado latente"]) expect(total[columna].texto, columna).toBe("Falta el dato");
    expect(plano(tabla.textContent)).toContain("0,00 € en total · no incluye una posición sin precio");
  });

  it("si además no se conoce su coste, el total del coste lo dice y la nota no promete que lo cuenta", async () => {
    /* B, en dólares, pagada con 800 libras de una cuenta en libras, y el mercado no trae el cambio de la libra: no tiene
       precio (lo pagado no está en su divisa) ni coste en euros. */
    const sinCoste = cartera(
      [activo("A"), activo("B", "ACCION", "USD")],
      [
        mov("aportacion", "2025-01-02", { importe: "3000" }),
        mov("compra", "2025-01-02", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" }),
        mov("aportacion", "2025-01-02", { importe: "800", divisa: "GBP" }),
        mov("compra", "2025-01-03", { activoId: "B", titulos: "10", divisa: "GBP", importe: "-800" })
      ]
    );
    pintado = await pintar(<VistaCuentas datos={datosDeVista(sinCoste, MERCADO)} />);
    const bloque = panel(pintado.vista, "Cuenta de valores");
    expect(fila(bloque, "Activo B").Coste).toMatchObject({ texto: "Falta el dato", falta: true });
    const pieConPieza = [...bloque.querySelectorAll("tfoot tr.tabla__pie .tabla__ausencia")].map((ausencia) => plano(ausencia.textContent));
    /* Del pie, solo el coste falta: el valor y el latente son los de A. */
    expect(pieConPieza).toEqual(["Falta el dato"]);
    expect(pie(bloque).Valor.texto).toBe("1.200,00 €");
    expect(pie(bloque)["Resultado latente"].texto).toBe("+200,00 €");
    expect(nota(bloque)).toBe(`${DE_SIEMPRE} Activo B no tiene precio: su valor, su peso y su resultado no se conocen hasta que se le ponga uno. Los totales de la tabla y el patrimonio no la incluyen.`);
  });
});

describe("el titular de la cartera y lo que pasa a Diseño", () => {
  it("el patrimonio dice, junto a su cifra, lo que no incluye", async () => {
    pintado = await pintar(<RespuestaDeLaCartera datos={datosDeVista(CON_UNA, MERCADO)} />);
    const patrimonio = pintado.vista.querySelector(".respuesta__dato--principal")!;
    expect(plano(patrimonio.querySelector(".respuesta__cifra")?.textContent)).toBe("2.200 €");
    /* Sin el nombre, que en la banda no cabe: está en Cuentas, en el análisis y en la comprobación de la cartera. */
    expect(plano(patrimonio.querySelector(".respuesta__apunte")?.textContent)).toBe("a 13/11/2026 · 1.200 € en valores y 1.000 € en efectivo. No incluye una posición sin precio.");
  });

  it("con todas con precio, el apunte del patrimonio es el de siempre", async () => {
    pintado = await pintar(<RespuestaDeLaCartera datos={datosDeVista(cartera([activo("A")], movimientos().slice(0, 2)), MERCADO)} />);
    /* 1.200 € de A y 2.000 € de efectivo. */
    expect(plano(pintado.vista.querySelector(".respuesta__dato--principal .respuesta__apunte")?.textContent)).toBe("a 13/11/2026 · 1.200 € en valores y 2.000 € en efectivo");
  });

  /*
   * Lo que sí la cuenta, y como cero: el resultado y las dos rentabilidades. A 31-01-2025 la cartera vale 2.200 € con
   * 3.000 € aportados: resultado, 2.200 − 3.000 = −800 €. Rentabilidad: de 3.000 € a 2.000 € el día 3, al pagar B (× 2/3),
   * y de 2.000 € a 2.200 € el 31 (× 1,1): 2/3 × 1,1 − 1 = −26,67 %. Con una sola aportación el primer día, la del cliente
   * es la misma: 2.200 / 3.000 − 1.
   */
  const FIN_DE_ENERO = "2025-01-31";
  const datosDelTitular = (vista: HTMLElement) =>
    [...vista.querySelectorAll(".respuesta__dato")].map((dato) => ({
      rotulo: plano(dato.querySelector(".respuesta__rotulo")?.childNodes[0]?.textContent),
      cifra: plano(dato.querySelector(".respuesta__cifra")?.textContent),
      apunte: plano(dato.querySelector(".respuesta__apunte")?.textContent)
    }));

  it("el resultado y las dos rentabilidades dicen, bajo su cifra, que la cuentan como cero", async () => {
    pintado = await pintar(<RespuestaDeLaCartera datos={datosDeVista(CON_UNA, MERCADO, FIN_DE_ENERO)} />);
    expect(datosDelTitular(pintado.vista)).toEqual([
      { rotulo: "Patrimonio", cifra: "2.200 €", apunte: "a 31/01/2025 · 1.200 € en valores y 1.000 € en efectivo. No incluye una posición sin precio." },
      { rotulo: "Resultado del periodo", cifra: "−800 €", apunte: "del 02/01/2025 al 31/01/2025. La posición sin precio cuenta como cero." },
      /* Un mes no se anualiza y no hay referencia: el apunte es solo la salvedad. */
      { rotulo: "Rentabilidad de la cartera", cifra: "−26,67 %", apunte: "La posición sin precio cuenta como cero." },
      { rotulo: "Rentabilidad del cliente", cifra: "−26,67 %", apunte: "cuenta cuándo aportó: 3.000 € en el periodo. La posición sin precio cuenta como cero." }
    ]);
  });

  it("con dos, en plural", async () => {
    pintado = await pintar(<RespuestaDeLaCartera datos={datosDeVista(CON_DOS, MERCADO, FIN_DE_ENERO)} />);
    const [patrimonio, resultado, cartera2, cliente] = datosDelTitular(pintado.vista);
    /* 1.200 € de A y 900 € de efectivo. */
    expect(patrimonio).toEqual({ rotulo: "Patrimonio", cifra: "2.100 €", apunte: "a 31/01/2025 · 1.200 € en valores y 900 € en efectivo. No incluye 2 posiciones sin precio." });
    for (const dato of [resultado, cartera2, cliente]) expect(dato.apunte.endsWith("Las 2 posiciones sin precio cuentan como cero."), dato.rotulo).toBe(true);
  });

  it("una cifra que no se da no lleva la salvedad: ya dice que falta", async () => {
    /* El mismo libro mirado en un periodo de un solo día, del 31 al 31 de enero: hay patrimonio —y no incluye a B—, pero
       no hay un día completo que medir, ni resultado ni rentabilidad que dar. Junto a un «Falta el dato» no se escribe
       que cuenta nada como cero. */
    const datos = datosDeVista(CON_UNA, MERCADO, FIN_DE_ENERO);
    const sinPeriodo = analizar(datos.preparado, { desde: FIN_DE_ENERO, hasta: FIN_DE_ENERO });
    expect(sinPeriodo.rentabilidad).toBeUndefined();
    expect(sinPeriodo.sinPrecio).toHaveLength(1);
    pintado = await pintar(<RespuestaDeLaCartera datos={{ ...datos, analisis: sinPeriodo }} />);
    const [patrimonio, ...demas] = datosDelTitular(pintado.vista);
    expect(patrimonio.apunte.endsWith("No incluye una posición sin precio.")).toBe(true);
    expect(demas).toHaveLength(3);
    for (const dato of demas) expect(dato.apunte, dato.rotulo).not.toContain("cuenta como cero");
  });

  it("con todas con precio, cada apunte es el de siempre", async () => {
    /* Solo A: 3.000 € aportados, 2.000 € de efectivo y 1.200 € de A. Gana 200 €: 3.200 / 3.000 − 1 = +6,67 %. */
    pintado = await pintar(<RespuestaDeLaCartera datos={datosDeVista(cartera([activo("A")], movimientos().slice(0, 2)), MERCADO, FIN_DE_ENERO)} />);
    expect(datosDelTitular(pintado.vista)).toEqual([
      { rotulo: "Patrimonio", cifra: "3.200 €", apunte: "a 31/01/2025 · 1.200 € en valores y 2.000 € en efectivo" },
      { rotulo: "Resultado del periodo", cifra: "+200 €", apunte: "del 02/01/2025 al 31/01/2025" },
      { rotulo: "Rentabilidad de la cartera", cifra: "+6,67 %", apunte: "" },
      { rotulo: "Rentabilidad del cliente", cifra: "+6,67 %", apunte: "cuenta cuándo aportó: 3.000 € en el periodo" }
    ]);
  });

  it("«Llevar a una propuesta» dice que la del catálogo sin precio no pasa: antes se descartaba sin decirlo", async () => {
    const delCatalogo = cartera(
      [activo("A", "FONDO", "EUR", { origen: "catalogo", isin: "XA0000000001" }), activo("B", "ACCION", "USD", { origen: "catalogo", isin: "XB0000000002" })],
      movimientos()
    );
    pintado = await pintar(<LlevarADiseno analisis={datosDeVista(delCatalogo, MERCADO).analisis} onSendToBuilder={() => undefined} />);
    const nota = plano(pintado.vista.querySelector("p.cmp-note")?.textContent);
    expect(nota).toContain("Pasan 1 posición del catálogo");
    expect(nota).toContain("No pasa, porque no tiene precio: Activo B.");
  });

  it("con dos del catálogo sin precio, en plural; y una propia sin precio se dice una vez, como propia", async () => {
    /* A, B y C son del catálogo; D es propia. B, C y D son acciones en dólares compradas sin precio. */
    const mezcla = cartera(
      [
        activo("A", "FONDO", "EUR", { origen: "catalogo", isin: "XA0000000001" }),
        activo("B", "ACCION", "USD", { origen: "catalogo", isin: "XB0000000002" }),
        activo("C", "ACCION", "USD", { origen: "catalogo", isin: "XC0000000003" }),
        activo("D", "ACCION", "USD")
      ],
      movimientos(mov("compra", "2025-01-03", { activoId: "C", titulos: "10", importe: "-100" }), mov("compra", "2025-01-03", { activoId: "D", titulos: "10", importe: "-100" }))
    );
    pintado = await pintar(<LlevarADiseno analisis={datosDeVista(mezcla, MERCADO).analisis} onSendToBuilder={() => undefined} />);
    expect(plano(pintado.vista.querySelector("p.cmp-note")?.textContent)).toBe(
      "Crea una propuesta nueva en Diseño con estas posiciones; la cartera del cliente no cambia. Pasan 1 posición del catálogo, con sus pesos a 13/11/2026. El efectivo no pasa. No pasan, porque no son del catálogo: Activo D. No pasan, porque no tienen precio: Activo B, Activo C."
    );
  });
});

describe("Análisis → Composición: la contribución de cada posición y el reparto", () => {
  const FIN_DE_ENERO = "2025-01-31";

  it("de la que no tiene precio no se dan el resultado, lo que viene del precio y de la divisa, ni la contribución: antes, −1.000,00 € y −33,33 pp", async () => {
    const datos = datosDeVista(CON_UNA, MERCADO, FIN_DE_ENERO);
    pintado = await pintar(<BloqueContribucion activos={datos.abierta.cartera.activos} analisis={datos.analisis} />);
    const bloque = panel(pintado.vista, "Contribución de cada posición");
    const b = fila(bloque, "Activo B");
    for (const columna of ["Resultado", "De precio", "De divisa", "Contribución"]) expect(b[columna], columna).toMatchObject({ texto: "Falta el dato", falta: true });
    /* Lo cobrado es dinero, y se da: no ha cobrado nada. */
    expect(b["De ingresos"].falta).toBe(false);
    expect(b["Posición"].apunte).toBe("Sin precio");
    const texto = plano([...bloque.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Activo B"))?.textContent);
    expect(texto).not.toContain("1.000,00");
    expect(texto).not.toContain("33,33");
  });

  it("la que sí lo tiene, con sus cifras: +200,00 € y +6,67 pp", async () => {
    /* A gana 200 €. El día 31 la cartera pasa de 2.000 € a 2.200 € (+10 %), todo de A, y venía de 3.000 € a 2.000 €
       (× 2/3): 10 % × 2/3 = 6,67 puntos, que es 200 / 3.000. */
    const datos = datosDeVista(CON_UNA, MERCADO, FIN_DE_ENERO);
    pintado = await pintar(<BloqueContribucion activos={datos.abierta.cartera.activos} analisis={datos.analisis} />);
    const a = fila(panel(pintado.vista, "Contribución de cada posición"), "Activo A");
    expect(a.Resultado).toMatchObject({ texto: "+200,00 €", falta: false });
    expect(a["Contribución"]).toMatchObject({ texto: "+6,67 pp", falta: false });
  });

  it("la fila de toda la cartera la sigue contando como cero, y la nota lo dice: −800,00 € y −26,67 pp", async () => {
    const datos = datosDeVista(CON_UNA, MERCADO, FIN_DE_ENERO);
    pintado = await pintar(<BloqueContribucion activos={datos.abierta.cartera.activos} analisis={datos.analisis} />);
    const bloque = panel(pintado.vista, "Contribución de cada posición");
    const total = pie(bloque);
    expect(total.Resultado.texto).toBe("−800,00 €");
    expect(total["Contribución"].texto).toBe("−26,67 pp");
    expect([...bloque.querySelectorAll("p.cmp-note")].map((nota) => plano(nota.textContent))).toContain(
      "Activo B no tiene precio: su resultado y su contribución no se conocen. La fila de toda la cartera la cuenta como cero, y por eso las demás filas no suman lo que dice."
    );
  });

  it("con dos, la nota en plural; con todas con precio, sin nota", async () => {
    const dos = datosDeVista(CON_DOS, MERCADO, FIN_DE_ENERO);
    pintado = await pintar(<BloqueContribucion activos={dos.abierta.cartera.activos} analisis={dos.analisis} />);
    expect([...pintado.vista.querySelectorAll("p.cmp-note")].map((nota) => plano(nota.textContent))).toContain(
      "Activo B y Activo C no tienen precio: su resultado y su contribución no se conocen. La fila de toda la cartera las cuenta como cero, y por eso las demás filas no suman lo que dice."
    );
    await pintado.desmontar();
    const todas = datosDeVista(cartera([activo("A")], movimientos().slice(0, 2)), MERCADO, FIN_DE_ENERO);
    pintado = await pintar(<BloqueContribucion activos={todas.abierta.cartera.activos} analisis={todas.analisis} />);
    expect(plano(pintado.vista.textContent)).not.toContain("no tiene precio");
    expect(pintado.vista.querySelectorAll("p.cmp-note")).toHaveLength(1);
  });

  it("el reparto de la composición dice que no la incluye", async () => {
    pintado = await pintar(<BloqueComposicion analisis={datosDeVista(CON_UNA, MERCADO, FIN_DE_ENERO).analisis} />);
    const bloque = panel(pintado.vista, "Composición");
    /* Sobre lo que se puede valorar: 1.200 € de A y 1.000 € de efectivo. */
    expect(plano(bloque.textContent)).toContain("A 31/01/2025, sobre 2.200 €");
    expect(plano(bloque.querySelector("p.cmp-note")?.textContent).endsWith("no se reparte a ojo. El reparto no incluye Activo B, que no tiene precio.")).toBe(true);
    await pintado.desmontar();
    pintado = await pintar(<BloqueComposicion analisis={datosDeVista(cartera([activo("A")], movimientos().slice(0, 2)), MERCADO, FIN_DE_ENERO).analisis} />);
    expect(plano(pintado.vista.textContent)).not.toContain("no incluye");
  });
});

describe("las cifras que la cuentan como cero lo dicen donde se leen", () => {
  /* La cartera de siempre a 31-01-2025: resultado −800 €, rentabilidad −26,67 %, caída máxima −33,33 % (de 3.000 € a
     2.000 € el día 3) y resultado latente +200 €, el de A. Sus cuentas, en `posicionSinPrecio.test.ts`. */
  const FIN_DE_ENERO = "2025-01-31";
  const COMO_CERO = "Cuenta Activo B como cero, porque no tiene precio.";
  const DEL_BLOQUE = "Estas cifras cuentan Activo B como cero, porque no tiene precio.";
  const conB = () => datosDeVista(CON_UNA, MERCADO, FIN_DE_ENERO);
  const sinB = () => datosDeVista(cartera([activo("A")], movimientos().slice(0, 2)), MERCADO, FIN_DE_ENERO);
  /** Cada fila de un bloque por su rótulo: la cifra y las notas que lleva debajo. */
  const filas = (vista: HTMLElement) =>
    Object.fromEntries(
      [...vista.querySelectorAll(".rows__item")].map((item) => [
        plano(item.querySelector(".rows__label")?.childNodes[0]?.textContent),
        { cifra: plano(item.querySelector(".rows__value")?.textContent), notas: [...item.querySelectorAll(".gestor-fila__nota")].map((nota) => plano(nota.textContent)) }
      ])
    );
  const notas = (vista: HTMLElement) => [...vista.querySelectorAll("p.cmp-note")].map((nota) => plano(nota.textContent));

  it("Análisis → Rentabilidad: cada fila que la cuenta lleva la salvedad bajo su nota; la que no se da y lo que es dinero, no", async () => {
    pintado = await pintar(<BloqueRentabilidad analisis={conB().analisis} />);
    const f = filas(pintado.vista);
    expect(f["Rentabilidad de la cartera"]).toEqual({ cifra: "−26,67 %", notas: [COMO_CERO] });
    expect(f["Rentabilidad del cliente"]).toEqual({ cifra: "−26,67 %", notas: ["En el periodo", COMO_CERO] });
    expect(f.Resultado).toEqual({ cifra: "−800,00 €", notas: [COMO_CERO] });
    /* El latente no la cuenta: es el de A, y dice que no la incluye. */
    expect(f["Resultado latente"]).toEqual({ cifra: "+200,00 €", notas: ["De lo que sigue en cartera, a 31/01/2025", "No incluye Activo B, que no tiene precio."] });
    /* Un mes no se anualiza: no hay cifra, y no hay salvedad. Las aportaciones son dinero movido. */
    expect(f["Rentabilidad anualizada"].notas).toEqual([]);
    expect(f["Aportaciones netas"]).toEqual({ cifra: "3.000,00 €", notas: [] });
  });

  it("«Últimos años» y la rentabilidad de la cartera frente a su referencia también la llevan: son la misma cifra con otro rótulo", async () => {
    /* A 13-11-2026 la cartera tiene más de un año: «Último año» se da, del 13-11-2025 al 13-11-2026. Y con un índice de
       referencia que tiene dato cada día, el bloque de la referencia compara. */
    const conIndice: MercadoCargado = { ...MERCADO, referencia: { nombre: "Índice", serie: serieDiaria("2025-01-01", "2026-11-13", 100, 104) } };
    /* La cartera tiene elegida esa referencia: sin una elegida, el bloque solo ofrece elegirla. */
    const conReferencia = cartera(CON_UNA.activos, CON_UNA.movimientos, { referencia: { activoId: "INDICE", nombre: "Índice" } });
    const datos = datosDeVista(conReferencia, conIndice);
    pintado = await pintar(<BloqueRentabilidad analisis={datos.analisis} />);
    expect(filas(pintado.vista)["Último año"].notas).toEqual(["Del 13/11/2025 al 13/11/2026", COMO_CERO]);
    await pintado.desmontar();
    pintado = await pintar(<BloqueReferencia abierta={datos.abierta} analisis={datos.analisis} cargando={false} />);
    const f = filas(pintado.vista);
    expect(f["Rentabilidad de la cartera"].notas).toEqual([COMO_CERO]);
    expect(f["Rentabilidad de la referencia"].notas).toEqual([]);
    expect(f["Frente a la referencia"].notas).toEqual([COMO_CERO]);
  });

  it("Análisis → Riesgo: la caída máxima la lleva; la volatilidad, que con un mes no se da, no", async () => {
    pintado = await pintar(<BloqueRiesgo analisis={conB().analisis} />);
    const f = filas(pintado.vista);
    expect(f["Caída máxima"].cifra).toBe("−33,33 %");
    expect(f["Caída máxima"].notas.at(-1)).toBe(COMO_CERO);
    expect(f.Volatilidad.notas).toEqual([]);
  });

  it("con todas con precio, ninguna fila lleva nada de esto", async () => {
    pintado = await pintar(<BloqueRentabilidad analisis={sinB().analisis} />);
    expect(plano(pintado.vista.textContent)).not.toContain("como cero");
    expect(plano(pintado.vista.textContent)).not.toContain("No incluye");
    expect(filas(pintado.vista)["Resultado latente"]).toEqual({ cifra: "+200,00 €", notas: ["De lo que sigue en cartera, a 31/01/2025"] });
  });

  it("la tabla de meses lo dice debajo: el mes de la compra sale como una pérdida", async () => {
    pintado = await pintar(<BloqueMeses analisis={conB().analisis} />);
    expect(notas(pintado.vista).at(-1)).toBe(DEL_BLOQUE);
    await pintado.desmontar();
    pintado = await pintar(<BloqueMeses analisis={sinB().analisis} />);
    expect(plano(pintado.vista.textContent)).not.toContain("como cero");
  });

  it("Ingresos y costes: los porcentajes son sobre un patrimonio medio que la cuenta como cero", async () => {
    pintado = await pintar(<BloqueIngresosYCostes analisis={conB().analisis} />);
    expect(notas(pintado.vista)).toContain("El patrimonio medio cuenta Activo B como cero, porque no tiene precio. Los porcentajes de este bloque son sobre ese patrimonio.");
    await pintado.desmontar();
    pintado = await pintar(<BloqueIngresosYCostes analisis={sinB().analisis} />);
    expect(plano(pintado.vista.textContent)).not.toContain("como cero");
  });

  it("el Resumen: bajo la evolución y bajo el desglose del resultado; y en las principales posiciones, por qué falta", async () => {
    pintado = await pintar(<VistaResumen datos={conB()} />);
    expect(notas(panel(pintado.vista, "Evolución del patrimonio"))).toEqual([DEL_BLOQUE]);
    expect(notas(panel(pintado.vista, "De dónde viene el resultado"))).toEqual([DEL_BLOQUE]);
    const principales = [...pintado.vista.querySelectorAll('ul[aria-label="Principales posiciones"] li')].map((parte) => ({
      nombre: plano(parte.querySelector(".partes__nombre")?.childNodes[0]?.textContent),
      apunte: plano(parte.querySelector(".partes__apunte")?.textContent),
      cifra: plano(parte.querySelector(".partes__cifra")?.textContent)
    }));
    /* A, con su valor y su peso (1.200 / 2.200); B, sin ninguno de los dos, y dice por qué. Antes: «0 €» y «0,0 %». */
    expect(principales).toEqual([
      { nombre: "Activo A", apunte: "1.200 €", cifra: "54,5 %" },
      { nombre: "Activo B", apunte: "Sin precio", cifra: "Falta el dato" }
    ]);
    /* Y el reparto por clase de ese mismo bloque dice lo que deja fuera, como el de Análisis. */
    expect(notas(panel(pintado.vista, "En qué está invertida"))).toEqual(["El reparto no incluye Activo B, que no tiene precio."]);
    await pintado.desmontar();
    pintado = await pintar(<VistaResumen datos={sinB()} />);
    expect(plano(pintado.vista.textContent)).not.toContain("como cero");
    expect(plano(pintado.vista.textContent)).not.toContain("Sin precio");
  });

  it("Comparar: bajo la tabla, la columna de esta cartera dice que la cuenta como cero", async () => {
    pintado = await pintar(<VistaComparar datos={conB()} />);
    expect(notas(panel(pintado.vista, "Comparación"))).toContain("Esta cartera cuenta Activo B como cero, porque no tiene precio.");
    await pintado.desmontar();
    pintado = await pintar(<VistaComparar datos={sinB()} />);
    expect(plano(pintado.vista.textContent)).not.toContain("como cero");
  });

  it("Comparar: la columna de una cartera con una posición sin precio lo dice en sus notas", () => {
    const comparada = { clave: "otra", nombre: "Otra cartera", clase: "gestor" as const, analisis: conB().analisis, noEncontrados: [], sinComprar: [], sinHistoria: false, avisos: [] };
    expect(notasDeLaComparada(comparada, "EUR")).toEqual(["«Otra cartera» cuenta Activo B como cero, porque no tiene precio."]);
    expect(notasDeLaComparada({ ...comparada, analisis: sinB().analisis }, "EUR")).toEqual([]);
  });
});
