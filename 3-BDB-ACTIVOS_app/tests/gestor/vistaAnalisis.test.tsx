// @vitest-environment happy-dom
/**
 * La pestaña «Análisis» de una cartera de cliente: que se reparte en cuatro vistas (Rentabilidad,
 * Composición, Ingresos y costes, Comprobaciones), que la vista elegida va en la dirección y se
 * recupera al recargar, que en cada una salen los bloques que proceden, en su orden y con su
 * título como encabezado; que las cifras que enseña son las del análisis, escritas con el módulo
 * común de formato; que no aparece jerga; y que lo que no procede no sale.
 */
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { importe, puntos, rentabilidad, porcentaje, titulos as escribirTitulos } from "../../src/core/formato";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import { metrica } from "../../src/gestor/motor/metricas/registro";
import { ValorDeMetrica } from "../../src/gestor/ui/piezas";
import { VistaAnalisis } from "../../src/gestor/ui/vistas/VistaAnalisis";
import { activo, cartera, mov, serie } from "./ayudas";
import { datosDeLaDemo, datosDeVista, panel, pintar, titulos, type Pintado } from "./vistaAnalisisDatos";

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
  window.history.replaceState(null, "", "/");
});

/** Abre la pestaña con una vista ya elegida en la dirección, como al recargar. */
function enLaDireccion(vista: string) {
  window.history.replaceState(null, "", `/cartera-real#pestana=analisis&vista=${vista}`);
}

/* Una cartera mínima: 10.000 € el 2 ene 2025 en un fondo a 100 €. Sin índice, sin bonos y sin ventas. */
const FONDO = activo("A", "FONDO");
const MERCADO: MercadoCargado = {
  datos: { precios: new Map([["A", serie(["2025-01-02", 100], ["2025-06-30", 105], ["2026-11-13", 110])]]), cambios: new Map() },
  fichas: new Map(),
  avisos: []
};
const MOVIMIENTOS = [
  mov("aportacion", "2025-01-02", { importe: "10000" }),
  mov("suscripcion", "2025-01-02", { activoId: "A", titulos: "100", precio: "100", importe: "-10000" })
];

/** Un número escrito en pantalla («+1,23 pp», «−0,4 pp») de vuelta a número. */
function leerNumero(texto: string): number {
  return Number(texto.replace(/−/g, "-").replace(/[^\d,+-]/g, "").replace(/\./g, "").replace(",", "."));
}

describe("VistaAnalisis con la cartera de demostración", () => {
  const datos = datosDeLaDemo();
  const { analisis } = datos;

  it("se reparte en cuatro vistas, y cada una enseña sus bloques en su orden, con su título como encabezado", async () => {
    const esperados: Record<string, string[]> = {
      rentabilidad: ["Rentabilidad", "Frente a la referencia", "Riesgo", "Rentabilidad por meses y años"],
      composicion: ["Composición", "Contribución de cada posición", "Posiciones cerradas", "Bonos"],
      ingresos: ["Ingresos y costes del periodo"],
      comprobaciones: ["Comprobaciones"]
    };
    for (const [vista, bloques] of Object.entries(esperados)) {
      enLaDireccion(vista);
      pintado = await pintar(<VistaAnalisis datos={datos} />);
      expect(titulos(pintado.vista)).toEqual(bloques);
      for (const titulo of pintado.vista.querySelectorAll(".panel__title")) expect(titulo.tagName).toBe("H2");
      await pintado.desmontar();
      pintado = undefined;
    }
  });

  it("sin nada en la dirección abre «Rentabilidad»; elegir otra vista la escribe en la dirección y la enseña", async () => {
    window.history.replaceState(null, "", "/cartera-real#pestana=analisis");
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    const grupo = pintado.vista.querySelector('[aria-label="Qué parte del análisis"]')!;
    const opciones = [...grupo.querySelectorAll("button")];
    expect(opciones.map((opcion) => opcion.textContent)).toEqual(["Rentabilidad", "Composición", "Ingresos y costes", "Comprobaciones"]);
    expect(opciones[0].getAttribute("aria-checked") ?? opciones[0].getAttribute("aria-pressed")).toBe("true");
    expect(titulos(pintado.vista)[0]).toBe("Rentabilidad");

    await act(async () => opciones[3].click());
    expect(window.location.hash).toBe("#pestana=analisis&vista=comprobaciones");
    expect(titulos(pintado.vista)).toEqual(["Comprobaciones"]);

    /* Volver a la primera la quita de la dirección: una dirección sin vista es la primera. */
    await act(async () => opciones[0].click());
    expect(window.location.hash).toBe("#pestana=analisis");
  });

  it("con el teclado: las flechas llevan el foco a la vista de al lado, y pulsarla la elige", async () => {
    window.history.replaceState(null, "", "/cartera-real#pestana=analisis");
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    const primera = pintado.vista.querySelector<HTMLButtonElement>('[aria-label="Qué parte del análisis"] button')!;
    primera.focus();
    await act(async () => {
      primera.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe("Composición");
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(titulos(pintado.vista)[0]).toBe("Composición");
  });

  it("las cifras clave son las del análisis, escritas con el módulo común de formato", async () => {
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    const { vista } = pintado;
    expect(panel(vista, "Rentabilidad").textContent).toContain(rentabilidad(analisis.rentabilidad!.twr));
    expect(panel(vista, "Riesgo").textContent).toContain(porcentaje(analisis.riesgo!.volatilidad!));

    /* El total de un año de la tabla de meses, con su signo y dos decimales. */
    const anio = analisis.porMeses[analisis.porMeses.length - 2];
    const fila = [...panel(vista, "Rentabilidad por meses y años").querySelectorAll("tbody tr")].find((tr) => tr.querySelector("th")?.textContent === String(anio.anio))!;
    expect(fila.lastElementChild!.textContent).toBe(`${rentabilidad(anio.total)}${anio.parcial ? "*" : ""}`);
    /* Doce casillas de mes: las que tienen cifra llevan su rentabilidad con su signo, y el fondo de su signo. Desde el
       14-11-2026 (Óscar: recuperar el color y los datos de antes del rediseño) ese fondo tiene cinco intensidades,
       `gestor-mes--sube-1` a `-5` y `gestor-mes--baja-1` a `-5`, en vez de un solo fondo suave por signo: aquí se sigue
       comprobando el signo; la escala la prueba `tests/gestor/mesesConIntensidad.test.tsx`. */
    const casillas = [...fila.querySelectorAll("td")].slice(0, 12);
    anio.meses.forEach((mes, i) => {
      expect(casillas[i].textContent).toBe(mes ? `${rentabilidad(mes.rentabilidad)}${mes.parcial ? "*" : ""}` : "");
      if (mes && mes.rentabilidad > 0.00005) expect(casillas[i].className).toMatch(/\bgestor-mes--sube-[1-5]\b/);
      if (mes && mes.rentabilidad < -0.00005) expect(casillas[i].className).toMatch(/\bgestor-mes--baja-[1-5]\b/);
    });
    await pintado.desmontar();

    /* El total realizado, al pie de las posiciones cerradas, en la vista «Composición». */
    enLaDireccion("composicion");
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    expect(analisis.realizado).not.toBeNull();
    expect(panel(pintado.vista, "Posiciones cerradas").querySelector("tfoot")!.textContent).toContain(importe(analisis.realizado!, { conSigno: true }));
  });

  it("la columna de contribución suma la rentabilidad del periodo", async () => {
    enLaDireccion("composicion");
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    const bloque = panel(pintado.vista, "Contribución de cada posición");
    const cabeceras = [...bloque.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    const columna = cabeceras.findIndex((texto) => texto.startsWith("Contribución"));
    expect(columna).toBeGreaterThan(0);
    const filas = [...bloque.querySelectorAll("tbody tr")];
    /* Una fila por posición con resultado en el periodo, más la del efectivo y las comisiones. */
    expect(filas.length).toBe(analisis.desglose!.posiciones.length + 1);
    expect(filas.some((tr) => tr.textContent?.includes("Efectivo y comisiones de la cuenta"))).toBe(true);
    const mostradas = filas.map((tr) => leerNumero(tr.children[columna].textContent ?? ""));
    /* Cada cifra se enseña con dos decimales de punto: la suma de lo enseñado no se aleja más que el redondeo. */
    const suma = mostradas.reduce((total, valor) => total + valor, 0);
    expect(Math.abs(suma - analisis.rentabilidad!.twr * 100)).toBeLessThanOrEqual(0.005 * filas.length + 1e-9);
    /* Y el pie dice exactamente la rentabilidad. */
    expect(analisis.desglose!.contribucionTotal).toBeCloseTo(analisis.rentabilidad!.twr, 10);
    expect(bloque.querySelector("tfoot")!.textContent).toContain(puntos(analisis.rentabilidad!.twr));
  });

  it("no usa jerga, ni siquiera en las notas emergentes, en ninguna de las cuatro vistas", async () => {
    let notas = 0;
    for (const vista of ["rentabilidad", "composicion", "ingresos", "comprobaciones"]) {
      enLaDireccion(vista);
      pintado = await pintar(<VistaAnalisis datos={datos} />);
      const botones = [...pintado.vista.querySelectorAll<HTMLButtonElement>(".nota-emergente__boton")];
      notas += botones.length;
      for (const boton of botones) {
        await act(async () => boton.click());
        expect(pintado.vista.textContent ?? "").not.toMatch(/\bTWR\b|\bTIR\b/);
      }
      const texto = pintado.vista.textContent ?? "";
      expect(texto).not.toMatch(/\bTWR\b|\bTIR\b/);
      expect(texto).not.toMatch(/drawdown|FIFO/i);
      expect(texto).not.toMatch(/NaN|undefined|Infinity/);
      expect(texto).not.toMatch(/Máxima caída|Rentabilidad anual\b|Gastos corrientes/);
      await pintado.desmontar();
      pintado = undefined;
    }
    expect(notas).toBeGreaterThan(5);
  });
});

describe("una métrica sin valor", () => {
  /* El año en curso de la demostración: 317 días. No se anualiza ni tiene Sharpe, y no es que falte nada. */
  const { analisis } = datosDeLaDemo("anio");

  it("se pinta como «no aplica» cuando el periodo es corto, no como un dato que falta", async () => {
    pintado = await pintar(
      <>
        <ValorDeMetrica analisis={analisis} metrica={metrica("rentabilidadAnualizada")} />
        <ValorDeMetrica analisis={analisis} metrica={metrica("sharpe")} />
      </>
    );
    const ausencias = [...pintado.vista.querySelectorAll(".ausencia")];
    expect(ausencias.map((nodo) => nodo.textContent)).toEqual(["El periodo no llega a un año.", "Hace falta al menos un año de historia."]);
    for (const nodo of ausencias) expect(nodo.className).toBe("ausencia ausencia--no-aplica");
  });

  it("se pinta como dato que falta cuando lo que falta es el tipo sin riesgo", async () => {
    const sinTipo = { ...datosDeLaDemo().analisis, riesgo: { ...datosDeLaDemo().analisis.riesgo!, sharpe: null, motivoSinSharpe: "Falta el tipo libre de riesgo (€STR) del periodo.", sharpeFaltaUnDato: true } };
    pintado = await pintar(<ValorDeMetrica analisis={sinTipo} metrica={metrica("sharpe")} />);
    expect(pintado.vista.querySelector(".ausencia")!.className).toBe("ausencia ausencia--falta");
  });
});

describe("el color de una métrica", () => {
  const { analisis } = datosDeLaDemo();

  it("una rentabilidad y un resultado van con su color; la caída máxima, la volatilidad y las aportaciones, en tinta", async () => {
    const clases = async (id: string) => {
      pintado = await pintar(<ValorDeMetrica analisis={analisis} metrica={metrica(id)} />);
      const clase = pintado.vista.querySelector(".cifra")!.className;
      await pintado.desmontar();
      pintado = undefined;
      return clase;
    };
    expect(await clases("rentabilidad")).toMatch(/cifra--(sube|baja)/);
    expect(await clases("resultado")).toMatch(/cifra--(sube|baja)/);
    expect(await clases("maximaCaida")).toBe("cifra");
    expect(await clases("volatilidad")).toBe("cifra");
    expect(await clases("aportacionesNetas")).toBe("cifra");
  });
});

describe("VistaAnalisis con una cartera sencilla", () => {
  it("sin referencia, sin bonos y sin ventas: esos bloques no salen y la referencia se elige en el propio bloque", async () => {
    const datos = datosDeVista(cartera([FONDO], MOVIMIENTOS), MERCADO);
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    expect(titulos(pintado.vista)[0]).toBe("Rentabilidad");
    expect(panel(pintado.vista, "Frente a la referencia").textContent).toContain("La cartera no se compara con ninguna referencia.");
    expect(panel(pintado.vista, "Frente a la referencia").querySelector("select")?.value).toBe("");
    await pintado.desmontar();

    enLaDireccion("composicion");
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    const presentes = titulos(pintado.vista);
    expect(presentes).not.toContain("Posiciones cerradas");
    expect(presentes).not.toContain("Bonos");
    await pintado.desmontar();

    /* Sin extractos: se dice para qué sirven. */
    enLaDireccion("comprobaciones");
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    expect(panel(pintado.vista, "Comprobaciones").textContent).toContain("Al importar los extractos del banco");
  });

  it("con una cartera vacía, el estado vacío", async () => {
    pintado = await pintar(<VistaAnalisis datos={datosDeVista(cartera([], []), MERCADO)} />);
    expect(pintado.vista.querySelector(".ui-empty-state h2")?.textContent).toBe("Aún no hay nada que analizar");
    expect(titulos(pintado.vista)).toEqual([]);
  });

  it("con un extracto que no cuadra, la tabla de diferencias", async () => {
    /* El libro tiene 100 participaciones y 0 € de efectivo; el extracto dice 90 y 0 €: diferencia de 10 participaciones. */
    const conExtracto = cartera([FONDO], MOVIMIENTOS, {
      extractos: [{ id: "x1", fecha: "2025-06-30", entidad: "Banco de prueba", posiciones: [{ activoId: "A", nombre: "Activo A", titulos: "90" }], efectivo: [{ divisa: "EUR", saldo: "0" }] }]
    });
    enLaDireccion("comprobaciones");
    pintado = await pintar(<VistaAnalisis datos={datosDeVista(conExtracto, MERCADO)} />);
    const bloque = panel(pintado.vista, "Comprobaciones");
    expect(bloque.textContent).toContain("Extracto del 30/06/2025 · Banco de prueba");
    expect(bloque.textContent).toContain("No cuadra. Hay una diferencia en 2 líneas comprobadas.");
    const fila = bloque.querySelector("tbody tr")!;
    expect([...fila.children].map((celda) => celda.textContent)).toEqual(["Activo A (títulos)", escribirTitulos(100), escribirTitulos(90), escribirTitulos(10)]);
  });
});
