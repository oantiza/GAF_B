// @vitest-environment happy-dom

/**
 * La pantalla de Planes y EPSV, montada de verdad (decisión D-11).
 *
 * Lo que se vigila es lo que un cliente tendría delante: que cada producto dice si es un plan de pensiones o una
 * EPSV, que desde aquí no se puede añadir nada a una cartera, que la ficha y la comparación enseñan las cifras de la
 * base con sus salvedades, que un plan con el valor parado lo dice, y que en Modo cliente no se nombra al proveedor.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const base = vi.hoisted(() => ({ listarPlanes: vi.fn(), leerSerieDelPlan: vi.fn() }));
vi.mock("../src/adapters/planesDeLaBase", () => base);
vi.mock("../src/adapters/baseNuevaLectura", () => ({ BASE_NUEVA_DISPONIBLE: true }));
/* El gráfico tiene su propia pieza: aquí solo se mira con qué se le llama. */
vi.mock("../src/charts/oaa", () => ({
  OaaLineChart: ({ series, ariaLabel }: { series: Array<{ values: unknown[] }>; ariaLabel?: string }) => (
    <div aria-label={ariaLabel} data-grafico="evolucion" data-lineas={series.length}>
      {series[0]?.values.length ?? 0} puntos
    </div>
  )
}));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import type { PlanDePensiones, SerieDelPlan } from "../src/core/planes/modelo";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { PlanesPage } from "../src/pages/PlanesPage";

const EPSV: PlanDePensiones = {
  id: "F00000Q2PL",
  nombre: "March Moderado EPSV",
  tipo: "EPSV",
  empleoSimplificado: false,
  gestora: "March Gestión de Pensiones EGFP",
  categoria: "Mixtos Euros Defensivos PP",
  estrellas: 3,
  estrellasFecha: "2026-10-31",
  fechaInicio: "2013-06-10",
  patrimonio: 14480813,
  valor: { importe: 12.81215, fecha: "2026-11-10" },
  rentabilidad: { ytd: 0.0299, "1y": 0.0303, "3y": 0.0404, "5y": 0.0148 },
  rentabilidadFecha: "2026-11-10",
  volatilidad: { "3y": 0.0292779 },
  sharpe: 0.48996,
  comisionDeGestion: 0.015,
  consultado: "2026-11-13"
};

const PLAN: PlanDePensiones = {
  id: "F0GBR052AF",
  nombre: "Mundiplan Audaz Global PP",
  tipo: "PENSION_PLAN",
  empleoSimplificado: false,
  codigoDgsfp: "N1981",
  gestora: "AXA Pensiones EGFP",
  categoria: "RV Global PP",
  fechaInicio: "2000-07-14",
  valor: { importe: 23.61874, fecha: "2026-11-05" },
  rentabilidad: { "1y": 0.114, "3y": 0.1487 },
  rentabilidadFecha: "2026-11-05",
  volatilidad: { "3y": 0.1138652 },
  consultado: "2026-11-13"
};

/* BSG Prometeo PP el 13-11-2026: su último valor es de junio de 2024. */
const PARADO: PlanDePensiones = {
  id: "F0GBR0PARA",
  nombre: "BSG Prometeo PP",
  tipo: "PENSION_PLAN",
  empleoSimplificado: false,
  codigoDgsfp: "N4860",
  gestora: "GVC Gaesco Pensiones EGFP",
  categoria: "Mixtos Euros Moderados PP",
  fechaInicio: "2013-09-27",
  valor: { importe: 10.5, fecha: "2024-06-05" },
  rentabilidad: { "1y": 0.0748 },
  rentabilidadFecha: "2023-12-28",
  volatilidad: {},
  consultado: "2026-11-13"
};

const SERIE: SerieDelPlan = {
  desde: "2026-09-30",
  hasta: "2026-11-10",
  puntos: [
    { fecha: "2026-09-30", valor: 12.75 },
    { fecha: "2026-10-30", valor: 12.82 },
    { fecha: "2026-11-10", valor: 12.812 }
  ]
};

let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  base.listarPlanes.mockResolvedValue([PARADO, EPSV, PLAN]);
  base.leerSerieDelPlan.mockResolvedValue(SERIE);
  /* Lo marcado y el filtro viven en memoria: cada prueba empieza como una sesión nueva, en la lista. */
  clearSessionCaches();
  window.history.replaceState(null, "", "/jubilacion/planes");
  const contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  root = createRoot(contenedor);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const montar = (modoCliente = false) =>
  act(async () =>
    root.render(
      <ClientModeProvider initialValue={modoCliente}>
        <PlanesPage />
      </ClientModeProvider>
    )
  );

const texto = () => document.body.textContent ?? "";
const filas = () => [...document.querySelectorAll("table.tabla tbody tr:not(.tabla__detalle)")];
const boton = (rotulo: string) => {
  const encontrado = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === rotulo);
  if (!encontrado) throw new Error(`Falta el botón «${rotulo}»`);
  return encontrado;
};
const pulsar = (rotulo: string) => act(async () => boton(rotulo).click());
/** «← Planes y EPSV», la vuelta a la lista desde una ficha o una comparación: un enlace, no un botón. */
const volverALaLista = () => act(async () => document.querySelector<HTMLAnchorElement>("a.planes-vuelta")!.click());
/** El botón «Comparar N planes» de la cabecera, si lo hay. */
const botonDeComparar = () => [...document.querySelectorAll<HTMLButtonElement>(".ui-page-header button")].find((b) => /^Comparar \d/.test(b.textContent ?? ""));

describe("la lista", () => {
  test("cada producto dice si es un plan de pensiones o una EPSV, y el recuento también", async () => {
    await montar();
    expect(filas()).toHaveLength(3);
    const porNombre = Object.fromEntries(filas().map((fila) => [fila.querySelector("a")?.textContent, fila.querySelector(".distintivo")?.textContent]));
    expect(porNombre).toEqual({ "BSG Prometeo PP": "Plan de pensiones", "March Moderado EPSV": "EPSV", "Mundiplan Audaz Global PP": "Plan de pensiones" });
    /* Lo que hay en el catálogo es la procedencia de la lista y va en la cabecera; junto a los filtros, cuántos quedan. */
    expect(document.querySelector(".ui-page-header__description")?.textContent).toBe("2 planes de pensiones y 1 EPSV · consultado el 13/11/2026 · Morningstar; la comisión, del buscador del banco");
    expect(document.querySelector(".planes-filtros__cuantos")?.textContent).toBe("3 de 3");
  });

  test("se puede quedar solo con las EPSV", async () => {
    await montar();
    /* Es un filtro, no un juego de pestañas: un grupo de botones, sin paneles a los que apuntar (MAR-14, DIR-10). */
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    for (const control of document.querySelectorAll("[aria-controls]")) {
      expect(document.getElementById(control.getAttribute("aria-controls")!), `«${control.textContent}» apunta a un elemento que existe`).not.toBeNull();
    }
    const grupo = document.querySelector('[role="group"][aria-label="Producto"]');
    expect([...(grupo?.querySelectorAll("button") ?? [])].map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["Todos", "true"],
      ["Planes de pensiones", "false"],
      ["EPSV", "false"]
    ]);
    await pulsar("EPSV");
    expect(filas().map((fila) => fila.querySelector("a")?.textContent)).toEqual(["March Moderado EPSV"]);
    expect(document.querySelector(".planes-filtros__cuantos")?.textContent).toBe("1 de 3");
  });

  test("las cifras son las de la base, y lo que no está se dice", async () => {
    await montar();
    const epsv = filas().find((fila) => fila.textContent?.includes("March Moderado EPSV"));
    /* Una rentabilidad es un resultado: lleva su signo y su color (antes, «3,03 %» sin signo ni color). */
    expect(epsv?.textContent).toContain("+3,03\u00a0%");
    expect(epsv?.querySelector(".cifra--sube")?.textContent).toBe("+2,99\u00a0%");
    /* La comisión es un coste: sin signo y sin color. */
    expect(epsv?.textContent).toContain("1,50\u00a0%");
    expect([...(epsv?.querySelectorAll(".cifra--sube, .cifra--baja") ?? [])].map((cifra) => cifra.textContent)).not.toContain("1,50\u00a0%");
    const plan = filas().find((fila) => fila.textContent?.includes("Mundiplan"));
    /* El banco no publica su comisión: falta, no se rellena. */
    expect(plan?.querySelector(".tabla__celda--falta")).not.toBeNull();
  });

  test("un plan no es cartera: desde aquí no se añade nada a ninguna", async () => {
    await montar();
    const botones = [...document.querySelectorAll("button")].map((b) => `${b.textContent} ${b.getAttribute("aria-label") ?? ""}`);
    expect(botones.filter((rotulo) => /cartera|añadir/i.test(rotulo))).toEqual([]);
  });

  test("un plan con el valor parado lo dice bajo su fila", async () => {
    await montar();
    expect(document.querySelector(".tabla__detalle")?.textContent).toBe("Sin valor publicado desde el 05/06/2024: sus cifras no describen el presente.");
    expect(document.querySelectorAll(".tabla__detalle")).toHaveLength(1);
  });

  test("si la base no contesta se dice, y no se enseña una lista vacía como si no hubiera planes", async () => {
    base.listarPlanes.mockRejectedValue(new Error("sin conexión"));
    await montar();
    expect(document.querySelector("table.tabla")).toBeNull();
    expect(texto()).not.toContain("No hay planes");
    expect(boton("Reintentar")).toBeDefined();
  });
});

describe("la comparación", () => {
  test("dos planes marcados, uno junto a otro, con lo que impide leerlos como iguales", async () => {
    await montar();
    /* Sin nada marcado, la cabecera no ofrece comparar; con uno, lo ofrece desactivado y dice por qué. */
    expect(botonDeComparar()).toBeUndefined();
    await pulsar("Comparar March Moderado EPSV");
    expect(botonDeComparar()?.textContent).toBe("Comparar 1 plan");
    expect(botonDeComparar()?.disabled).toBe(true);
    expect(botonDeComparar()?.title).toBe("Marca otro plan con «Comparar»: hacen falta dos para compararlos.");
    await pulsar("Comparar Mundiplan Audaz Global PP");
    expect(texto()).toContain("2/4");
    await pulsar("Comparar 2 planes");

    expect(window.location.hash).toBe("#comparar=F00000Q2PL,F0GBR052AF");
    expect(document.querySelector("h1")?.textContent).toBe("Comparación de 2 planes");
    const cabeceras = [...document.querySelectorAll("table.tabla--comparativa thead th")].map((th) => th.textContent);
    expect(cabeceras.slice(1)).toEqual(["March Moderado EPSVEPSV", "Mundiplan Audaz Global PPPlan de pensiones"]);
    expect(texto()).toContain("no tributan igual");
    expect(texto()).toContain("no son de la misma categoría");
    expect(texto()).toContain("No hay orden ni ganador");
  });

  test("arriba, la evolución de los dos en un mismo gráfico, en base 100 y diciendo que es un cálculo", async () => {
    await montar();
    await pulsar("Comparar March Moderado EPSV");
    await pulsar("Comparar Mundiplan Audaz Global PP");
    await pulsar("Comparar 2 planes");

    const grafico = document.querySelector('[data-grafico="evolucion"]');
    expect(grafico?.getAttribute("data-lineas")).toBe("2");
    expect(base.leerSerieDelPlan).toHaveBeenCalledWith("F00000Q2PL");
    expect(base.leerSerieDelPlan).toHaveBeenCalledWith("F0GBR052AF");
    /* La serie de prueba tiene septiembre, octubre y el 10 de noviembre; se consultó el 13: noviembre no entra. */
    expect(grafico?.textContent).toBe("2 puntos");
    expect(texto()).toContain("Base 100 en septiembre de 2026 · el último valor de cada mes, hasta octubre de 2026 · 2 meses");
    expect(texto()).toContain("Es el único cálculo de esta pantalla");
    expect(texto()).toContain("noviembre de 2026 no ha acabado y no entra");
  });

  test("un plan sin serie no se dibuja y se nombra; con uno solo no hay evolución que comparar", async () => {
    base.leerSerieDelPlan.mockImplementation(async (id: string) => (id === "F00000Q2PL" ? SERIE : undefined));
    await montar();
    await pulsar("Comparar March Moderado EPSV");
    await pulsar("Comparar Mundiplan Audaz Global PP");
    await pulsar("Comparar 2 planes");

    expect(document.querySelector('[data-grafico="evolucion"]')).toBeNull();
    expect(texto()).toContain("no hay evolución que comparar");
    expect(texto()).toContain("Mundiplan Audaz Global PP no se dibuja: no tiene serie.");
    /* La tabla sigue ahí: que falte el gráfico no se lleva la comparación. */
    expect(document.querySelector("table.tabla--comparativa")).not.toBeNull();
  });

  test("con cuatro marcados, «Comparar» de los demás dice por qué no se puede, y la ficha también (PLA-24)", async () => {
    const otros = ["F0GBR0OTR1", "F0GBR0OTR2"].map((id, i) => ({ ...PLAN, id, nombre: `Otro plan ${i + 1}` }));
    base.listarPlanes.mockResolvedValue([PARADO, EPSV, PLAN, ...otros]);
    await montar();
    for (const nombre of ["BSG Prometeo PP", "March Moderado EPSV", "Mundiplan Audaz Global PP", "Otro plan 1"]) await pulsar(`Comparar ${nombre}`);
    const quinto = boton("Comparar Otro plan 2");
    expect(quinto.disabled).toBe(true);
    expect(quinto.title).toBe("Ya hay 4 planes para comparar: quita uno para añadir otro.");
    expect(boton("Quitar BSG Prometeo PP de la comparación").title).toBe("");
    await act(async () => [...document.querySelectorAll<HTMLAnchorElement>("table.tabla a")].find((a) => a.textContent === "Otro plan 2")!.click());
    expect(document.querySelector("h1")?.textContent).toBe("Otro plan 2");
    expect(boton("Añadir a la comparación").title).toBe("Ya hay 4 planes para comparar: quita uno para añadir otro.");
  });

  test("una dirección que compara un plan que no está lo dice, y compara los demás (PLA-24)", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#comparar=F00000Q2PL,F0GBR052AF,F0GBR0NOES");
    await montar();
    expect(document.querySelector("h1")?.textContent).toBe("Comparación de 2 planes");
    expect(texto()).toContain("Uno de los planes de la dirección no está en el catálogo y no se compara: F0GBR0NOES.");
  });

  test("el botón de atrás vuelve a la lista con lo marcado", async () => {
    await montar();
    await pulsar("Comparar March Moderado EPSV");
    await pulsar("Comparar Mundiplan Audaz Global PP");
    await pulsar("Comparar 2 planes");
    await volverALaLista();
    expect(window.location.hash).toBe("");
    expect(filas()).toHaveLength(3);
    expect(texto()).toContain("2/4");
  });
});

describe("la ficha", () => {
  test("se abre por su dirección, dice qué es y dibuja su serie tal como viene", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F00000Q2PL");
    await montar();
    expect(document.querySelector("h1")?.textContent).toBe("March Moderado EPSV");
    expect(texto()).toContain("Entidad de previsión social voluntaria (EPSV)");
    expect(base.leerSerieDelPlan).toHaveBeenCalledWith("F00000Q2PL");
    expect(document.querySelector('[data-grafico="evolucion"]')?.textContent).toBe("3 puntos");
    expect(texto()).toContain("del 30/09/2026 al 10/11/2026 · 3 valores");
    expect(texto()).toContain("no es una recomendación");
    /* Una EPSV no se registra en la DGSFP: no aplica, que no es lo mismo que faltar. */
    expect(document.querySelector(".ausencia--no-aplica")?.textContent).toBe("No aplica");
  });

  test("un plan con el valor parado lleva sus dos avisos arriba, con sus fechas", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F0GBR0PARA");
    await montar();
    const avisos = [...document.querySelectorAll(".aviso")].map((aviso) => aviso.textContent ?? "");
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toContain("05/06/2024");
    expect(avisos[1]).toContain("28/12/2023");
  });

  test("sin serie, se dice que no hay evolución que dibujar", async () => {
    base.leerSerieDelPlan.mockResolvedValue(undefined);
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F0GBR052AF");
    await montar();
    expect(document.querySelector('[data-grafico="evolucion"]')).toBeNull();
    expect(texto()).toContain("no hay evolución que dibujar");
  });

  test("el menú «Planes y EPSV» desde una ficha vuelve a la lista (PLA-11)", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F00000Q2PL");
    await montar();
    expect(document.querySelector("h1")?.textContent).toBe("March Moderado EPSV");
    /* Lo que hace el marco al pulsar el menú: deja la dirección de la sección, sin final, y vuelve a pintar la
       pantalla. En un navegador, `pushState` no dispara `popstate` ni `hashchange` (happy-dom sí dispara
       `hashchange`, y se calla aquí para que la prueba sea la del navegador): la pantalla tiene que leer la
       dirección cada vez que se pinta. */
    const callar = (evento: Event) => evento.stopImmediatePropagation();
    window.addEventListener("hashchange", callar, true);
    try {
      await act(async () => {
        window.history.pushState({ routeId: "planes" }, "", "/jubilacion/planes");
        await new Promise((listo) => setTimeout(listo, 10));
      });
      expect(document.querySelector("h1")?.textContent).toBe("March Moderado EPSV");
      await montar();
    } finally {
      window.removeEventListener("hashchange", callar, true);
    }
    expect(document.querySelector("h1")?.textContent).toBe("Planes y EPSV");
    expect(filas()).toHaveLength(3);
  });

  test("una dirección que pide un plan que no está lo dice, y no enseña otro", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F0GBR0NOES");
    await montar();
    expect(texto()).toContain("Ese plan no está en el catálogo");
    expect(document.querySelector("table")).toBeNull();
    await pulsar("Ver todos los planes");
    expect(filas()).toHaveLength(3);
  });
});

describe("Modo cliente", () => {
  test("fuera del modo se nombra de quién es el dato", async () => {
    await montar(false);
    expect(texto()).toContain("Morningstar");
  });

  test("dentro no se nombra, ni en la lista ni en la ficha ni en la comparación; las fechas se quedan", async () => {
    await montar(true);
    expect(texto()).not.toMatch(/Morningstar|el banco en su buscador|según el banco/);
    expect(texto()).toContain("consultado el 13/11/2026");

    await pulsar("Comparar March Moderado EPSV");
    await pulsar("Comparar Mundiplan Audaz Global PP");
    await pulsar("Comparar 2 planes");
    expect(texto()).not.toMatch(/Morningstar|el banco en su buscador|según el banco/);
    expect(texto()).toContain("Consultado el 13/11/2026");

    await pulsar("Ficha de March Moderado EPSV");
    expect(document.querySelector("h1")?.textContent).toBe("March Moderado EPSV");
    expect(texto()).not.toMatch(/Morningstar|el banco en su buscador|según el banco/);
    expect(texto()).toContain("A 10/11/2026");
  });
});

/* ------------------------------------------------------------- El rediseño del 14-11-2026 --- */

/** Los datos de la banda de la ficha: rótulo, cifra y apunte de cada uno. */
const banda = () =>
  [...document.querySelectorAll(".respuesta .respuesta__dato")].map((dato) => [
    dato.querySelector(".respuesta__rotulo")?.textContent,
    dato.querySelector(".respuesta__cifra")?.textContent,
    dato.querySelector(".respuesta__apunte")?.textContent ?? null
  ]);

describe("la ficha, con su respuesta", () => {
  test("la banda dice lo que da el proveedor, cada cifra con su fecha; las rentabilidades con signo y color, la comisión sin él", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F00000Q2PL");
    await montar();
    expect(banda()).toEqual([
      /* El valor de la participación, con los cinco decimales que da el proveedor, como en el bloque «El plan» (FMT-06):
         la banda lo escribía con cuatro («12,8122») y la tabla de debajo con cinco. */
      ["Valor de la participación", "12,81215 €", "a 10/11/2026"],
      ["Rentabilidad a 1 año", "+3,03 %", "a 10/11/2026"],
      ["Rentabilidad anualizada a 3 años", "+4,04 %", "a 10/11/2026"],
      ["Rentabilidad anualizada a 5 años", "+1,48 %", "a 10/11/2026"],
      ["Comisión de gestión", "1,50 %", "la que publica el banco"]
    ]);
    expect(document.querySelectorAll(".respuesta__dato--principal")).toHaveLength(1);
    const cifras = [...document.querySelectorAll(".respuesta .cifra")];
    expect(cifras.filter((cifra) => cifra.classList.contains("cifra--sube")).map((cifra) => cifra.textContent)).toEqual(["+3,03 %", "+4,04 %", "+1,48 %"]);
    /* Después de la banda, los bloques en su orden: el plan, la evolución, la rentabilidad y el riesgo. */
    expect([...document.querySelectorAll("h2.panel__title")].map((h) => h.textContent)).toEqual(["El plan", "Evolución del valor de la participación", "Rentabilidad", "Riesgo y ratios"]);
  });

  test("lo que el proveedor no da se dice, y una rentabilidad atrasada lo dice en su apunte", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F0GBR0PARA");
    await montar();
    const porRotulo = Object.fromEntries(banda().map(([rotulo, cifra, apunte]) => [rotulo, [cifra, apunte]]));
    /* Del 28/12/2023 al 13/11/2026 van 1.051 días. */
    expect(porRotulo["Rentabilidad a 1 año"]).toEqual(["+7,48 %", "a 28/12/2023, 1.051 días antes de la consulta"]);
    /* Un plan de 2013 sin rentabilidad a 3 años: falta, no «no aplica»; y el banco no publica su comisión. */
    expect(porRotulo["Rentabilidad anualizada a 3 años"]).toEqual(["Falta el dato", null]);
    expect(porRotulo["Comisión de gestión"]).toEqual(["Falta el dato", null]);
    /* Y los dos avisos de arriba se quedan. */
    expect(document.querySelectorAll(".aviso")).toHaveLength(2);
  });

  test("el valor de la participación del bloque «El plan» lleva sus cinco decimales y su punto de millar (FMT-06)", async () => {
    base.listarPlanes.mockResolvedValue([{ ...PLAN, valor: { importe: 1234.56789, fecha: "2026-11-05" } }]);
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F0GBR052AF");
    await montar();
    const fila = [...document.querySelectorAll(".rows__item")].find((item) => item.querySelector(".rows__label")?.textContent === "Valor de la participación");
    expect(fila?.querySelector(".rows__value")?.textContent).toBe("1.234,56789 € · 05/11/2026");
  });

  test("«← Planes y EPSV» es un enlace a la lista, y vuelve a ella con lo marcado", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F00000Q2PL");
    await montar();
    const enlace = document.querySelector<HTMLAnchorElement>("a.planes-vuelta");
    expect(enlace?.textContent).toBe("← Planes y EPSV");
    expect(enlace?.getAttribute("href")).toBe("/jubilacion/planes");
    await pulsar("Añadir a la comparación");
    await volverALaLista();
    expect(window.location.hash).toBe("");
    expect(filas()).toHaveLength(3);
    expect(botonDeComparar()?.textContent).toBe("Comparar 1 plan");
  });

  test("desde la ficha, con este y otro marcados, se va a la comparación", async () => {
    await montar();
    await pulsar("Comparar Mundiplan Audaz Global PP");
    await act(async () => [...document.querySelectorAll<HTMLAnchorElement>("table.tabla a")].find((a) => a.textContent === "March Moderado EPSV")!.click());
    /* Sin marcar este, la ficha no ofrece comparar: compararía otros planes, no el que se está viendo. */
    expect(botonDeComparar()).toBeUndefined();
    await pulsar("Añadir a la comparación");
    await pulsar("Comparar 2 planes");
    expect(window.location.hash).toBe("#comparar=F0GBR052AF,F00000Q2PL");
    expect(document.querySelector("h1")?.textContent).toBe("Comparación de 2 planes");
  });
});

describe("la lista, rediseñada", () => {
  test("enseña 25 filas por página", async () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ ...PLAN, id: `F0GBR0X${String(i).padStart(3, "0")}`, nombre: `Plan ${String(i + 1).padStart(2, "0")}` }));
    base.listarPlanes.mockResolvedValue(muchos);
    await montar();
    expect(filas()).toHaveLength(25);
    expect(document.querySelector(".planes-filtros__cuantos")?.textContent).toBe("30 de 30");
  });

  test("lo marcado se quita desde el menú de la cabecera, uno a uno o todos", async () => {
    await montar();
    await pulsar("Comparar March Moderado EPSV");
    await pulsar("Comparar Mundiplan Audaz Global PP");
    const menu = boton("Para comparar, 2/4");
    await act(async () => menu.click());
    const opciones = () => [...document.querySelectorAll<HTMLButtonElement>("[role='menuitem']")];
    expect(opciones().map((opcion) => opcion.textContent)).toEqual(["Quitar March Moderado EPSV", "Quitar Mundiplan Audaz Global PP", "Quitar todos"]);
    await act(async () => opciones()[0].click());
    expect(botonDeComparar()?.textContent).toBe("Comparar 1 plan");
    expect(boton("Comparar March Moderado EPSV").getAttribute("aria-pressed")).toBe("false");
    await act(async () => boton("Para comparar, 1/4").click());
    await act(async () => opciones().find((opcion) => opcion.textContent === "Quitar todos")!.click());
    expect(botonDeComparar()).toBeUndefined();
  });

  test("mientras llega el catálogo enseña la forma de la tabla y lo dice", async () => {
    base.listarPlanes.mockReturnValue(new Promise(() => undefined));
    await montar();
    expect(document.querySelector("[aria-busy='true'] .esqueleto")).not.toBeNull();
    expect(document.querySelector("[role='status']")?.textContent).toBe("Leyendo los planes…");
    expect(document.querySelector("table.tabla")).toBeNull();
  });

  test("sin coincidencias, el estado vacío dice qué hacer y deja limpiar los filtros", async () => {
    await montar();
    await act(async () => {
      const buscar = document.querySelector<HTMLInputElement>("input[type='search']")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(buscar, "ningún plan se llama así");
      buscar.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(texto()).toContain("No hay planes que coincidan");
    const limpiar = [...document.querySelectorAll<HTMLButtonElement>(".ui-empty-state button")].find((b) => b.textContent === "Limpiar búsqueda y filtros");
    expect(limpiar).toBeDefined();
    await act(async () => limpiar!.click());
    expect(filas()).toHaveLength(3);
  });

  test("cada filtro tiene su rótulo enlazado (MAR-10)", async () => {
    await montar();
    for (const rotulo of ["Buscar", "Categoría", "Gestora"]) {
      const etiqueta = [...document.querySelectorAll<HTMLLabelElement>(".planes-filtros label.field__label")].find((label) => label.textContent === rotulo);
      expect(etiqueta && document.getElementById(etiqueta.htmlFor), `«${rotulo}» nombra a su control`).toBeTruthy();
    }
    expect(document.querySelector('[role="group"][aria-label="Producto"]')).not.toBeNull();
  });
});

describe("la comparación, con el formato común", () => {
  test("las rentabilidades llevan su signo escrito", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#comparar=F00000Q2PL,F0GBR052AF");
    await montar();
    const fila = [...document.querySelectorAll("table.tabla--comparativa tbody tr")].find((tr) => tr.querySelector("th")?.textContent === "Rentabilidad 1 año");
    expect([...(fila?.querySelectorAll("td") ?? [])].map((td) => td.textContent)).toEqual(["+3,03 %", "+11,40 %"]);
    expect(document.querySelector<HTMLAnchorElement>("a.planes-vuelta")?.textContent).toBe("← Planes y EPSV");
  });
});

/* Dirección A (18-11-2026): las tres notas de lectura salen en toda comparación y se pintan como notas, debajo de la
   tabla; a la tabla solo le llegan los avisos de lo que pasa entre esos planes. Tres barras de aviso seguidas daban peso
   de alarma a lo rutinario. */
describe("la comparación: avisos en la tabla y notas de lectura aparte", () => {
  /* El principio de cada nota de lectura (`notasDeLectura`, con el proveedor nombrado fuera del Modo cliente). */
  const LECTURA = ["La rentabilidad, la volatilidad y los ratios los calcula Morningstar", "Alfa, beta, R² y ratio de información", "La comisión de gestión es la que publica"];
  /** La tabla con sus avisos: el bloque que monta `TablaComparativa`, que es el padre del marco desplazable. */
  const bloqueDeLaTabla = () => document.querySelector("table.tabla--comparativa")!.closest(".tabla__marco")!.parentElement!;
  const avisosDeLaTabla = () => [...bloqueDeLaTabla().querySelectorAll(":scope > p.tabla__aviso")].map((p) => p.textContent ?? "");
  /* Las del bloque «Plan a plan»: la evolución comparada, encima, lleva sus propias notas en otro `.planes-notas`. */
  const notasDeLectura = () => {
    const notas = bloqueDeLaTabla().nextElementSibling;
    expect(notas?.classList.contains("planes-notas")).toBe(true);
    return [...notas!.querySelectorAll(":scope > p.cmp-note")].map((p) => p.textContent ?? "");
  };

  test("dos planes de categoría distinta: el aviso de las categorías va con la tabla y las tres notas, aparte", async () => {
    window.history.replaceState(null, "", "/jubilacion/planes#comparar=F00000Q2PL,F0GBR052AF");
    await montar();
    expect(avisosDeLaTabla().some((aviso) => aviso.startsWith("Los planes no son de la misma categoría"))).toBe(true);
    const notas = notasDeLectura();
    expect(notas).toHaveLength(3);
    LECTURA.forEach((principio, indice) => expect(notas[indice].startsWith(principio)).toBe(true));
    const dentro = bloqueDeLaTabla().textContent ?? "";
    for (const principio of LECTURA) expect(dentro).not.toContain(principio);
  });

  test("dos planes de la misma categoría, tipo y fechas: la tabla no lleva ningún aviso y las tres notas siguen", async () => {
    /* Mismo tipo, misma categoría, mismas fechas de valor y de rentabilidad, y consultados 8 días después del valor
       (menos de los 45 que avisan): no hay nada que avisar entre ellos. */
    const GEMELO: PlanDePensiones = { ...PLAN, id: "F0GBR0GEME", nombre: "Mundiplan Audaz Global II PP", codigoDgsfp: "N1982" };
    base.listarPlanes.mockResolvedValue([PLAN, GEMELO]);
    window.history.replaceState(null, "", "/jubilacion/planes#comparar=F0GBR052AF,F0GBR0GEME");
    await montar();
    expect(document.querySelector("h1")?.textContent).toBe("Comparación de 2 planes");
    expect(avisosDeLaTabla()).toEqual([]);
    const notas = notasDeLectura();
    expect(notas).toHaveLength(3);
    LECTURA.forEach((principio, indice) => expect(notas[indice].startsWith(principio)).toBe(true));
  });
});
