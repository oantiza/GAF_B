// @vitest-environment happy-dom
/**
 * El color de la ficha y de Planes (14-11-2026, Óscar: «le faltan colores en general… ¿están todos los datos que salían
 * antes?»).
 *
 * - G14: en «Qué se puede hacer con él», cada aptitud con su distintivo: «Se puede» en verde, «No se puede» porque falta un
 *   dato en ocre, y «No aplica» sin distintivo, como la ausencia que es.
 * - Pestaña «Cartera»: los repartos cuyas filas traen su peso en número (regiones, sectores, estilo, tamaño) se dibujan como
 *   partes de un todo con su barra, con el mismo rótulo y la misma cifra; cada región en el color de su zona del mapa. La
 *   Composición, que no trae el peso en número, sigue en filas, con el punto del color de cada clase.
 * - El Resumen: «En qué invierte» con los mismos colores que la sección de la que sale.
 * - G15: la insignia de la EPSV vuelve a llevar color (el índigo de la marca); el plan de pensiones, gris.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { seccionDeRegiones } from "../src/adapters/componerFicha";
import { FichaInstrumento } from "../src/components/ficha/FichaInstrumento";
import { partesDeLaSeccion, partesDelResumen, zonaDeLaRegion } from "../src/components/ficha/mapaDeLaFicha";
import { InsigniaDeProducto } from "../src/components/planes/InsigniaDeProducto";
import { colorDeLaClasePorNombre } from "../src/core/coloresDeClase";
import * as formato from "../src/core/formato";
import { ZONE_CHIP } from "../src/core/regionTaxonomy";
import type { FichaInstrumento as ModeloDeFicha, SeccionDeFicha } from "../src/types/fichaInstrumento";
import { ACCION_DE_MUESTRA, FONDO_DE_MUESTRA } from "./fixtures/fichasDeMuestra";

const dom = (html: string) => {
  const nodo = document.createElement("div");
  nodo.innerHTML = html;
  return nodo;
};
const pinta = (ficha: ModeloDeFicha) => dom(renderToStaticMarkup(<FichaInstrumento ficha={ficha} />));

/* Un reparto como lo compone `componerFicha`: cada fila con su cifra escrita y su peso en número. */
const conPeso = (id: string, titulo: string, partes: Array<[string, number]>): SeccionDeFicha => ({
  id,
  titulo,
  procedencia: [{ texto: "Taxonomía del proveedor · 30 sep 2026" }],
  filas: partes.map(([rotulo, peso]) => ({ rotulo, valor: formato.peso(peso) ?? "", peso }))
});

/* La forma nueva del dato: Japón dice que lo es, y «other» es entonces una parte sin zona. */
const REGIONES: SeccionDeFicha = {
  id: "regiones",
  titulo: "Regiones",
  procedencia: [{ texto: "Taxonomía del proveedor · 30 sep 2026" }],
  ...seccionDeRegiones({ eurozone: 0.5, united_states: 0.3, japan: 0.15, other: 0.05 })
};
const SECTORES = conPeso("sectores", "Sectores", [["Tecnología", 0.4], ["Financieras", 0.35], ["Salud", 0.25]]);
const TAMANOS = conPeso("tamanos", "Tamaño", [["Grande", 0.7], ["Mediana", 0.3]]);

const FONDO: ModeloDeFicha = {
  ...FONDO_DE_MUESTRA,
  secciones: [
    ...FONDO_DE_MUESTRA.secciones.filter((s) => !["regiones", "sectores"].includes(s.id)),
    REGIONES,
    SECTORES,
    TAMANOS
  ]
};

const seccion = (html: HTMLElement, id: string) => html.querySelector<HTMLElement>(`#ficha-seccion-${id}`)!;
const partesPintadas = (nodo: Element) =>
  [...nodo.querySelectorAll<HTMLElement>("ul.partes > li")].map((li) => ({
    nombre: li.querySelector(".partes__nombre")!.firstChild!.textContent,
    cifra: li.querySelector(".partes__cifra")!.textContent,
    color: li.style.getPropertyValue("--parte-color"),
    apagada: li.classList.contains("partes__parte--apagada"),
    apunte: li.querySelector(".partes__apunte")?.textContent ?? null
  }));

describe("G14: lo que se puede hacer con él", () => {
  const aptitudes = (html: HTMLElement) =>
    [...html.querySelectorAll(".ficha__aptitudes .ficha__fila")].map((fila) => ({
      rotulo: fila.querySelector(".ficha__rotulo")!.textContent,
      distintivo: fila.querySelector(".ficha__rotulo .distintivo")?.className ?? null,
      palabra: fila.querySelector(".ficha__rotulo .distintivo")?.textContent ?? null
    }));

  test("«Se puede» en verde y «No se puede» porque falta, en ocre; el rótulo dice lo mismo que antes", () => {
    const filas = aptitudes(pinta(FONDO_DE_MUESTRA));
    expect(filas[0]).toEqual({ rotulo: "Se puede comparar su coste", distintivo: "distintivo distintivo--favorable", palabra: "Se puede" });
    const falta = filas.find((f) => f.rotulo === "No se puede medir con nuestras métricas")!;
    expect(falta).toEqual({ rotulo: "No se puede medir con nuestras métricas", distintivo: "distintivo distintivo--aviso", palabra: "No se puede" });
    /* Ni rojo: que falte un dato pide atención, no es un resultado en contra. */
    expect(filas.some((f) => f.distintivo?.includes("desfavorable"))).toBe(false);
  });

  test("«No aplica» sin distintivo, con la ausencia de siempre; la reserva, en gris", () => {
    const accion = pinta(ACCION_DE_MUESTRA);
    const noAplica = [...accion.querySelectorAll(".ficha__aptitudes .ficha__fila")].find((f) => f.textContent?.includes("comparar su coste"))!;
    expect(noAplica.className).toBe("ficha__fila ficha__fila--no-aplica");
    expect(noAplica.querySelector(".distintivo")).toBeNull();
    expect(noAplica.querySelector(".ficha__rotulo")!.textContent).toBe("No se puede comparar su coste");

    const conReserva = pinta({ ...FONDO_DE_MUESTRA, aptitudes: [{ rotulo: "Medir su alfa", valor: "+3,72 % a 1 año · contra un índice del proveedor", estado: "reserva" }] });
    expect(aptitudes(conReserva)).toEqual([{ rotulo: "Se puede medir su alfa", distintivo: "distintivo distintivo--neutro", palabra: "Se puede" }]);
  });
});

describe("Cartera: las partes, dibujadas", () => {
  test("cada región en el color de su zona del mapa; lo que no tiene zona, apagado", () => {
    expect(zonaDeLaRegion("Eurozona")).toBe("emea");
    expect(zonaDeLaRegion("Estados Unidos")).toBe("america");
    expect(zonaDeLaRegion("Japón")).toBe("asia");
    expect(zonaDeLaRegion("Latinoamérica")).toBe("america");
    expect(zonaDeLaRegion("Oriente Medio")).toBe("emea");
    expect(zonaDeLaRegion("Sin zona")).toBeUndefined();

    const partes = partesPintadas(seccion(pinta(FONDO), "regiones"));
    expect(partes).toEqual([
      { nombre: "Eurozona", cifra: formato.peso(0.5), color: ZONE_CHIP.emea, apagada: false, apunte: null },
      { nombre: "Estados Unidos", cifra: formato.peso(0.3), color: ZONE_CHIP.america, apagada: false, apunte: null },
      { nombre: "Japón", cifra: formato.peso(0.15), color: ZONE_CHIP.asia, apagada: false, apunte: null },
      { nombre: "Sin zona", cifra: formato.peso(0.05), color: "", apagada: true, apunte: null }
    ]);
    /* La procedencia sigue bajo el título, y no queda ninguna fila suelta. */
    expect(seccion(pinta(FONDO), "regiones").textContent).toContain("Taxonomía del proveedor · 30 sep 2026");
    expect(seccion(pinta(FONDO), "regiones").querySelector(".ficha__fila")).toBeNull();
  });

  test("«de la cual emergente» no es otra parte del todo: va como apunte de Asia", () => {
    const antigua: SeccionDeFicha = { id: "regiones", titulo: "Regiones", procedencia: [], ...seccionDeRegiones({ asia: 0.8445, asia_emerging: 0.353718, eurozone: 0.1555 }) };
    expect(partesDeLaSeccion(antigua)).toEqual([
      { nombre: "Asia", fraccion: 0.8445, apunte: `de la cual emergente, ${formato.peso(0.353718)}`, color: ZONE_CHIP.asia },
      { nombre: "Eurozona", fraccion: 0.1555, color: ZONE_CHIP.emea }
    ]);
  });

  test("sectores y tamaño, con su barra en el índigo de la pieza y la misma cifra que su fila", () => {
    for (const [id, origen] of [["sectores", SECTORES], ["tamanos", TAMANOS]] as const) {
      const partes = partesPintadas(seccion(pinta(FONDO), id));
      expect(partes.map((p) => [p.nombre, p.cifra])).toEqual(origen.filas.map((f) => [f.rotulo, f.valor]));
      expect(partes.every((p) => p.color === "" && !p.apagada)).toBe(true);
    }
  });

  test("una sección sin el peso en número, o con un dato que falta, se queda en filas", () => {
    /* La de muestra no trae `peso`: como siempre. */
    const html = pinta(FONDO_DE_MUESTRA);
    expect(seccion(html, "sectores").querySelector("ul.partes")).toBeNull();
    expect(seccion(html, "sectores").querySelectorAll(".ficha__fila").length).toBe(10);
    const conHueco: SeccionDeFicha = { ...SECTORES, filas: [...SECTORES.filas, { rotulo: "Energía", valor: "Falta el dato", ausencia: "falta", peso: 0 }] };
    expect(partesDeLaSeccion(conHueco)).toBeNull();
    /* La caja de estilo no es un reparto en partes. */
    expect(partesDeLaSeccion({ ...SECTORES, id: "caja-de-estilo" })).toBeNull();
  });

  test("la Composición sigue en filas, con el punto del color de cada clase delante de su nombre", () => {
    const composicion = seccion(pinta(FONDO), "composicion");
    expect(composicion.querySelector("ul.partes")).toBeNull();
    const conPunto = [...composicion.querySelectorAll(".ficha__fila")].map((fila) => ({
      rotulo: fila.querySelector(".ficha__rotulo")!.textContent,
      punto: (fila.querySelector(".clase-con-color__punto") as HTMLElement | null)?.style.background ?? null
    }));
    expect(conPunto).toEqual([
      { rotulo: "Renta variable", punto: colorDeLaClasePorNombre("Renta variable") },
      { rotulo: "Efectivo", punto: colorDeLaClasePorNombre("Efectivo") },
      /* Lo que falta no lleva color: no hay clase que pintar. */
      { rotulo: "Alternativos e inmobiliario", punto: null }
    ]);
  });

  test("Resumen: «En qué invierte» con el color de la sección de la que sale", () => {
    expect(partesDelResumen(FONDO)!.partes).toEqual([
      { nombre: "Eurozona", fraccion: 0.5, color: ZONE_CHIP.emea },
      { nombre: "Estados Unidos", fraccion: 0.3, color: ZONE_CHIP.america },
      { nombre: "Japón", fraccion: 0.15, color: ZONE_CHIP.asia },
      { nombre: "Sin zona", fraccion: 0.05, apagada: true }
    ]);
    const resumen = pinta(FONDO).querySelector("#ficha-panel-resumen")!;
    expect(partesPintadas(resumen).map((p) => p.color)).toEqual([ZONE_CHIP.emea, ZONE_CHIP.america, ZONE_CHIP.asia, ""]);
    /* Sin regiones, salen los sectores, en el índigo de la pieza. */
    const sinRegiones: ModeloDeFicha = { ...FONDO, secciones: FONDO.secciones.filter((s) => s.id !== "regiones") };
    expect(partesDelResumen(sinRegiones)!.partes.every((p) => p.color === undefined && !p.apagada)).toBe(true);
  });
});

describe("G15: la insignia del producto en Planes", () => {
  test("EPSV en el índigo de la marca; plan de pensiones, en gris; siempre con su palabra", () => {
    expect(renderToStaticMarkup(<InsigniaDeProducto plan={{ tipo: "EPSV" }} />)).toBe('<span class="distintivo distintivo--marca">EPSV</span>');
    expect(renderToStaticMarkup(<InsigniaDeProducto plan={{ tipo: "PENSION_PLAN" }} />)).toBe(
      '<span class="distintivo distintivo--neutro">Plan de pensiones</span>'
    );
  });
});
