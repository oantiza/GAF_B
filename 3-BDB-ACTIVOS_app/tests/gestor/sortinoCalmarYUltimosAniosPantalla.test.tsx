// @vitest-environment happy-dom
/**
 * Las cifras nuevas en la pestaña «Análisis»: Sortino y Calmar debajo del Sharpe, en «Riesgo», y el apartado «Últimos
 * años» en «Rentabilidad». Que salen en la cartera de demostración con su valor, escrito con el módulo común de formato;
 * que cuando no hay valor sale su motivo con su clase de ausencia; y que «Últimos años» no depende del periodo elegido.
 */
import { afterEach, describe, expect, it } from "vitest";
import { fecha, ratio, rentabilidad } from "../../src/core/formato";
import { VistaAnalisis } from "../../src/gestor/ui/vistas/VistaAnalisis";
import { BloqueRiesgo } from "../../src/gestor/ui/analisis/BloqueRiesgo";
import { datosDeLaDemo, panel, pintar, type Pintado } from "./vistaAnalisisDatos";

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
  window.history.replaceState(null, "", "/");
});

/** Las filas de un bloque: rótulo (sin la nota) → texto del valor, y la nota si la hay. */
function filas(bloque: HTMLElement): Map<string, { valor: HTMLElement; nota: string | undefined }> {
  const mapa = new Map<string, { valor: HTMLElement; nota: string | undefined }>();
  for (const fila of bloque.querySelectorAll<HTMLElement>(".rows__item")) {
    const rotulo = fila.querySelector(".rows__label")!;
    const nombre = [...rotulo.childNodes].filter((nodo) => nodo.nodeType === 3).map((nodo) => nodo.textContent).join("").trim();
    mapa.set(nombre, { valor: fila.querySelector<HTMLElement>(".rows__value")!, nota: rotulo.querySelector(".gestor-fila__nota")?.textContent ?? undefined });
  }
  return mapa;
}

describe("con la cartera de demostración, desde el inicio", () => {
  const datos = datosDeLaDemo();
  const { analisis } = datos;

  it("«Riesgo» lleva Sortino y Calmar debajo del Sharpe, con su valor y su ayuda", async () => {
    window.history.replaceState(null, "", "/cartera-real#pestana=analisis&vista=rentabilidad");
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    const bloque = panel(pintado.vista, "Riesgo");
    const rotulos = [...filas(bloque).keys()];
    expect(rotulos).toEqual(["Volatilidad", "Caída máxima", "Ratio de Sharpe", "Ratio de Sortino", "Ratio de Calmar"]);
    const riesgo = analisis.riesgo!;
    expect(riesgo.sortino).not.toBeNull();
    expect(riesgo.calmar).not.toBeNull();
    const leidas = filas(bloque);
    expect(leidas.get("Ratio de Sortino")!.valor.textContent).toBe(ratio(riesgo.sortino));
    expect(leidas.get("Ratio de Calmar")!.valor.textContent).toBe(ratio(riesgo.calmar));
    /* La nota del Calmar dice de qué dos cifras sale. */
    expect(leidas.get("Ratio de Calmar")!.nota).toContain(rentabilidad(riesgo.rentabilidadAnualizada));
    /* Cada una con su nota emergente («?»). */
    expect(bloque.querySelectorAll(".nota-emergente__boton")).toHaveLength(5);
  });

  it("«Rentabilidad» lleva «Últimos años»: un año, tres y cinco, con sus fechas, su anualizada y el motivo si no llega", async () => {
    window.history.replaceState(null, "", "/cartera-real#pestana=analisis&vista=rentabilidad");
    pintado = await pintar(<VistaAnalisis datos={datos} />);
    const bloque = panel(pintado.vista, "Rentabilidad");
    expect(bloque.textContent).toContain("Últimos años, sin depender del periodo elegido");
    const leidas = filas(bloque);
    const [uno, tres, cinco] = analisis.ultimosAnios;
    /* La demostración tiene tres años de historia: el último año y los 3 años salen; los 5 años no. */
    expect(uno.acumulada).not.toBeNull();
    expect(tres.acumulada).not.toBeNull();
    expect(cinco.acumulada).toBeNull();

    const fila1 = leidas.get("Último año")!;
    expect(fila1.valor.textContent).toBe(rentabilidad(uno.acumulada));
    expect(fila1.valor.querySelector(".cifra")!.className).toMatch(/cifra--(sube|baja)/);
    expect(fila1.nota).toBe(`Del ${fecha(uno.desde)} al ${fecha(uno.hasta)}`);
    expect(fila1.valor.querySelector(".gestor-fila__anual")).toBeNull();

    const fila3 = leidas.get("Últimos 3 años")!;
    expect(fila3.valor.textContent).toBe(`${rentabilidad(tres.acumulada)}${rentabilidad(tres.anualizada)} al año`);
    expect(fila3.valor.querySelector(".gestor-fila__anual")!.textContent).toBe(`${rentabilidad(tres.anualizada)} al año`);
    expect(fila3.nota).toBe(`Del ${fecha(tres.desde)} al ${fecha(tres.hasta)}`);

    const fila5 = leidas.get("Últimos 5 años")!;
    const ausencia = fila5.valor.querySelector(".ausencia")!;
    expect(ausencia.textContent).toBe("La cartera no tiene todavía 5 años de historia.");
    expect(ausencia.className).toBe("ausencia ausencia--no-aplica");
    expect(fila5.nota).toBeUndefined();
    expect(fila5.valor.querySelector(".gestor-fila__anual")).toBeNull();
  });

  it("«Últimos años» es el mismo con cualquier periodo: llega hasta el último día valorado", async () => {
    const delAnio = datosDeLaDemo("anio").analisis;
    expect(delAnio.ultimosAnios).toEqual(analisis.ultimosAnios);
    /* Y el de 3 años coincide con la rentabilidad del periodo «3 años», que mide lo mismo con la misma serie. */
    const tresAnios = datosDeLaDemo("3a").analisis;
    expect(tresAnios.periodo.desde).toBe(analisis.ultimosAnios[1].desde);
    expect(analisis.ultimosAnios[1].acumulada).toBeCloseTo(tresAnios.rentabilidad!.twr, 12);
    expect(analisis.ultimosAnios[1].anualizada).toBeCloseTo(tresAnios.rentabilidad!.twrAnualizada!, 12);
  });
});

describe("Sortino y Calmar sin valor", () => {
  it("en un periodo de menos de un año salen con su motivo, como «no aplica»", async () => {
    const { analisis } = datosDeLaDemo("anio");
    pintado = await pintar(<BloqueRiesgo analisis={analisis} />);
    const leidas = filas(pintado.vista);
    for (const rotulo of ["Ratio de Sortino", "Ratio de Calmar"]) {
      const ausencia = leidas.get(rotulo)!.valor.querySelector(".ausencia")!;
      expect(ausencia.textContent, rotulo).toBe("Hace falta al menos un año de historia.");
      expect(ausencia.className, rotulo).toBe("ausencia ausencia--no-aplica");
    }
  });

  it("sin €STR, el Sortino sale como dato que falta y el Calmar sigue saliendo", async () => {
    const base = datosDeLaDemo().analisis;
    const motivo = "Falta el tipo libre de riesgo (€STR) del periodo.";
    const sinTipo = { ...base, riesgo: { ...base.riesgo!, sharpe: null, motivoSinSharpe: motivo, sharpeFaltaUnDato: true, sortino: null, motivoSinSortino: motivo, sortinoFaltaUnDato: true } };
    pintado = await pintar(<BloqueRiesgo analisis={sinTipo} />);
    const leidas = filas(pintado.vista);
    const ausencia = leidas.get("Ratio de Sortino")!.valor.querySelector(".ausencia")!;
    expect(ausencia.textContent).toBe(motivo);
    expect(ausencia.className).toBe("ausencia ausencia--falta");
    expect(leidas.get("Ratio de Calmar")!.valor.textContent).toBe(ratio(base.riesgo!.calmar));
  });

  it("el motivo largo de «ninguna semana por debajo» se pinta entero", async () => {
    const base = datosDeLaDemo().analisis;
    const motivo = "Ninguna semana ha quedado por debajo del tipo sin riesgo: no hay desviación a la baja que medir.";
    const sinBajas = { ...base, riesgo: { ...base.riesgo!, sortino: null, motivoSinSortino: motivo } };
    pintado = await pintar(<BloqueRiesgo analisis={sinBajas} />);
    const ausencia = filas(pintado.vista).get("Ratio de Sortino")!.valor.querySelector(".ausencia")!;
    expect(ausencia.textContent).toBe(motivo);
    expect(ausencia.className).toBe("ausencia ausencia--no-aplica");
  });
});
