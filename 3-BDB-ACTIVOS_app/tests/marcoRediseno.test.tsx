// @vitest-environment happy-dom

/**
 * El marco del rediseño «Informe vivo» (13-11-2026, apartado 3 de `docs/frontend/SISTEMA_DISENO.md`): el menú en seis
 * grupos con entradas que son enlaces (MAR-09), la semántica del marco (MAR-23), la guarda que espera al permiso
 * (MAR-22, PLA-17), la propuesta en curso (DIS-19, DIR-04), el aviso que se anuncia (MAR-24) y los cables que el marco
 * pasa a las pantallas (ANA-12, ACT-01, ACT-05, ACT-12, PLA-11). Las pantallas son testigos.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const estado = vi.hoisted(() => ({
  admin: true,
  resuelto: true,
  buscador: [] as Array<Record<string, unknown>>,
  comparador: [] as Array<Record<string, unknown>>,
  avisosDePlanes: 0
}));

vi.mock("../src/auth/useIsAdmin", () => ({
  useIsAdmin: () => estado.admin && estado.resuelto,
  useAdminClaim: () => ({ isAdmin: estado.admin && estado.resuelto, resolved: estado.resuelto })
}));
vi.mock("../src/adapters/prefetchActivePortfolio", () => ({ prefetchActivePortfolio: async () => undefined }));

const testigo = (titulo: string) => () => createElement("h1", null, titulo);

vi.mock("../src/pages/MercadoPage", () => ({ MercadoPage: testigo("Mercado") }));
vi.mock("../src/pages/PortfolioBuilderPage", () => ({ PortfolioBuilderPage: testigo("Diseño") }));
vi.mock("../src/pages/CarterasGuardadasPage", () => ({ CarterasGuardadasPage: testigo("Guardadas") }));
vi.mock("../src/gestor/ui/GestorDeCarterasPage", () => ({ GestorDeCarterasPage: testigo("Carteras de clientes") }));
vi.mock("../src/pages/PosicionesPage", () => ({ PosicionesPage: testigo("Posiciones") }));
vi.mock("../src/pages/JubilacionPage", () => ({ JubilacionPage: testigo("Jubilación") }));
vi.mock("../src/pages/AdminPage", () => ({ AdminPage: testigo("Sistema") }));
vi.mock("../src/pages/SaludDelCatalogoPage", () => ({ SaludDelCatalogoPage: testigo("Salud del catálogo") }));
vi.mock("../src/components/ficha/FichaDeActivo", () => ({ FichaDeActivo: testigo("Ficha") }));
vi.mock("../src/pages/XrayPage", () => ({
  XrayPage: ({ onPortfolioNameChange }: { onPortfolioNameChange?: (nombre: string) => void }) =>
    createElement(
      "section",
      null,
      createElement("h1", null, "Análisis"),
      createElement("button", { type: "button", onClick: () => onPortfolioNameChange?.("Familia García") }, "Poner el nombre en el diálogo")
    )
}));
vi.mock("../src/pages/BuscadorNuevoPage", () => ({
  BuscadorNuevoPage: (props: Record<string, unknown>) => {
    estado.buscador.push(props);
    const alCambiar = props.alCambiarEstado as (estado: unknown) => void;
    return createElement(
      "section",
      null,
      createElement("h1", null, "Buscador"),
      createElement("button", { type: "button", onClick: () => alCambiar({ ...(props.estado as object), consulta: "x" }) }, "Teclear")
    );
  }
}));
vi.mock("../src/pages/AssetComparisonPage", () => ({
  AssetComparisonPage: (props: Record<string, unknown>) => {
    estado.comparador.push(props);
    return createElement("h1", null, "Comparador");
  }
}));
vi.mock("../src/pages/PlanesPage", async () => {
  const { useEffect, useState } = await import("react");
  return {
    PlanesPage: () => {
      const [hash, setHash] = useState(window.location.hash);
      useEffect(() => {
        const leer = () => {
          estado.avisosDePlanes += 1;
          setHash(window.location.hash);
        };
        window.addEventListener("hashchange", leer);
        window.addEventListener("popstate", leer);
        return () => {
          window.removeEventListener("hashchange", leer);
          window.removeEventListener("popstate", leer);
        };
      }, []);
      return createElement("section", null, createElement("h1", null, "Planes y EPSV"), createElement("p", { id: "vista" }, hash ? "ficha" : "lista"));
    }
  };
});

import { BdbActivosApp } from "../src/app/BdbActivosApp";
import { DEFAULT_DATA_SOURCE_KIND } from "../src/config/runtimeConfig";
import { readComparisonSelection, writeComparisonSelection } from "../src/core/comparisonSelection";
import { getBrowserDraftStorage } from "../src/core/draftStorage";
import { CURRENT_PORTFOLIO_STORAGE_KEY, serializeCurrentPortfolioDraft } from "../src/core/localPortfolioStorage";
import { NOMBRE_DE_LA_CASA } from "../src/core/marca";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  Object.assign(estado, { admin: true, resuelto: true, buscador: [], comparador: [], avisosDePlanes: 0 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function esperar(condicion: () => boolean, que: string) {
  for (let intento = 0; intento < 300; intento += 1) {
    if (condicion()) return;
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 10));
    });
  }
  throw new Error(`No aparece: ${que}`);
}

async function abrir(ruta: string) {
  window.history.replaceState(null, "", ruta);
  await act(async () => {
    root!.render(createElement(BdbActivosApp));
  });
  await esperar(() => host.querySelector("main h1") !== null, `el título en ${ruta}`);
}

const entrada = (nombre: string) => {
  const enlace = host.querySelector<HTMLAnchorElement>(`nav.rail-nav a[aria-label="${nombre}"]`);
  if (!enlace) throw new Error(`Falta la entrada «${nombre}»`);
  return enlace;
};
const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === texto);
/* Los pasos de la miga, separados como se leen; la barra que los separa la pinta el marco, oculta al lector. */
const migas = () =>
  [...host.querySelectorAll(".topbar-crumbs__paso > span:first-child, .topbar-crumbs__current")]
    .map((paso) => paso.textContent)
    .join(" / ");
const recuadro = () => host.querySelector<HTMLButtonElement>(".topbar-chip");

function pulsar(elemento: HTMLElement, opciones: MouseEventInit = {}) {
  const evento = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...opciones });
  elemento.dispatchEvent(evento);
  return evento;
}

describe("el menú", () => {
  test("seis grupos con sus entradas, cada una un enlace con la dirección de su destino", async () => {
    await abrir("/mercado");
    const grupos = [...host.querySelectorAll("nav.rail-nav .rail-section")].map((grupo) => ({
      grupo: grupo.querySelector(".rail-section__label")?.textContent,
      entradas: [...grupo.querySelectorAll("a")].map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")])
    }));
    expect(grupos).toEqual([
      { grupo: "Mercado", entradas: [["Mercado", "/mercado"]] },
      { grupo: "Activos", entradas: [["Buscador", "/buscador"], ["Comparador", "/comparador"]] },
      {
        grupo: "Propuestas",
        entradas: [
          ["Diseño", "/cartera"],
          ["Análisis", "/analisis"],
          ["Informes", "/cartera/informes"],
          ["Guardadas", "/carteras-guardadas"]
        ]
      },
      { grupo: "Clientes", entradas: [["Carteras de clientes", "/cartera-real"], ["Posiciones", "/posiciones"]] },
      { grupo: "Planificación", entradas: [["Jubilación", "/jubilacion"], ["Planes y EPSV", "/jubilacion/planes"]] },
      { grupo: "Datos", entradas: [["Salud del catálogo", "/salud-catalogo"], ["Sistema", "/sistema"]] }
    ]);
    expect(host.querySelectorAll("nav.rail-nav button")).toHaveLength(0);
  });

  test("la entrada activa, y solo ella, lleva aria-current=\"page\"", async () => {
    await abrir("/analisis");
    const actuales = [...host.querySelectorAll("nav.rail-nav [aria-current]")];
    expect(actuales.map((a) => [a.getAttribute("aria-label"), a.getAttribute("aria-current")])).toEqual([["Análisis", "page"]]);
  });

  test("con una ficha abierta, el Buscador dice «location» y no «page» (MAR-23)", async () => {
    await abrir("/activo/LU1883318740");
    expect(entrada("Buscador").getAttribute("aria-current")).toBe("location");
    expect(entrada("Buscador").classList.contains("active")).toBe(true);
  });

  test("un clic normal navega sin recargar; con Ctrl, Cmd, Mayús o Alt no se intercepta", async () => {
    await abrir("/mercado");
    /* Se anota si la aplicación lo ha interceptado y, después, se detiene: happy-dom seguiría el enlace en esta
       misma ventana, que no es lo que hace un navegador con Ctrl+clic. */
    const interceptados: boolean[] = [];
    const anotar = (evento: Event) => {
      interceptados.push(evento.defaultPrevented);
      evento.preventDefault();
    };
    document.addEventListener("click", anotar);
    for (const modificador of ["ctrlKey", "metaKey", "shiftKey", "altKey"] as const) {
      await act(async () => {
        pulsar(entrada("Comparador"), { [modificador]: true });
      });
    }
    document.removeEventListener("click", anotar);
    expect(interceptados).toEqual([false, false, false, false]);
    expect(window.location.pathname).toBe("/mercado");

    const empuje = vi.spyOn(window.history, "pushState");
    let evento: MouseEvent | undefined;
    await act(async () => {
      evento = pulsar(entrada("Comparador"));
    });
    expect(evento!.defaultPrevented).toBe(true);
    expect(empuje).toHaveBeenCalledWith({ routeId: "comparador" }, "", "/comparador");
    await esperar(() => host.querySelector("main h1")?.textContent === "Comparador", "el Comparador");
    expect(window.location.pathname).toBe("/comparador");
  });

  test("las marcas de la semántica: navegación con nombre, grupos como listas con el suyo, sin `aside`", async () => {
    await abrir("/mercado");
    expect(host.querySelector("aside")).toBeNull();
    expect(host.querySelector("nav.rail-nav")?.getAttribute("aria-label")).toBe("Navegación principal");
    for (const lista of host.querySelectorAll("nav.rail-nav ul")) {
      const nombre = document.getElementById(lista.getAttribute("aria-labelledby") ?? "")?.textContent;
      expect(nombre).toBeTruthy();
    }
    expect(host.querySelector(".topbar-crumbs")?.tagName).toBe("P");
    expect(host.querySelector(".app-topbar nav")).toBeNull();
  });
});

describe("migas y título del documento", () => {
  test.each([
    ["/mercado", "Mercado", "Mercado"],
    ["/buscador", "Activos / Buscador", "Buscador"],
    ["/comparador", "Activos / Comparador", "Comparador"],
    ["/cartera", "Propuestas / Diseño de la propuesta", "Diseño de la propuesta"],
    ["/analisis", "Propuestas / Análisis", "Análisis"],
    ["/cartera/informes", "Propuestas / Informes", "Informes"],
    ["/carteras-guardadas", "Propuestas / Propuestas guardadas", "Propuestas guardadas"],
    ["/cartera-real", "Clientes / Carteras de clientes", "Carteras de clientes"],
    ["/posiciones", "Clientes / Posiciones", "Posiciones"],
    ["/jubilacion", "Planificación / Jubilación", "Jubilación"],
    ["/jubilacion/planes", "Planificación / Planes y EPSV", "Planes y EPSV"],
    ["/salud-catalogo", "Datos / Salud del catálogo", "Salud del catálogo"],
    ["/sistema", "Datos / Sistema", "Sistema"]
  ])("%s", async (ruta, miga, titulo) => {
    await abrir(ruta);
    expect(migas()).toBe(miga);
    expect(document.title).toBe(`${titulo} · ${NOMBRE_DE_LA_CASA}`);
  });

  test("una ficha: grupo, Buscador y ficha", async () => {
    await abrir("/activo/LU1883318740");
    expect(migas()).toBe("Activos / Buscador / Ficha de activo");
  });
});

describe("la guarda de las pantallas de datos (MAR-22, PLA-17)", () => {
  test("mientras se confirma el permiso, lo dice y no niega nada ni monta la pantalla", async () => {
    estado.resuelto = false;
    await abrir("/sistema");
    expect(host.querySelector("main")?.textContent).toContain("Comprobando permisos…");
    expect(host.textContent).not.toContain("reservada al administrador");
  });

  test("cuando llega el permiso, se abre la pantalla", async () => {
    estado.resuelto = false;
    await abrir("/sistema");
    estado.resuelto = true;
    await act(async () => root!.render(createElement(BdbActivosApp)));
    await esperar(() => !host.textContent?.includes("Comprobando permisos"), "la pantalla");
    expect(host.querySelector("main h1")?.textContent).toBe("Sistema");
  });

  test("resuelto sin permiso, dice que es del administrador", async () => {
    estado.admin = false;
    await abrir("/sistema");
    expect(host.textContent).toContain("Sección reservada al administrador");
  });
});

describe("la propuesta en curso", () => {
  test("el recuadro dice «Propuesta en curso», el nombre, el recuento y la suma", async () => {
    const borrador = serializeCurrentPortfolioDraft({
      sourceKind: DEFAULT_DATA_SOURCE_KIND,
      positions: [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }],
      name: "Familia García"
    });
    localStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, borrador);
    sessionStorage.setItem(CURRENT_PORTFOLIO_STORAGE_KEY, borrador);
    await abrir("/cartera-real");
    expect(recuadro()?.textContent?.replace(/\u00a0/g, " ")).toMatch(/^Propuesta en curso(Familia García)?.*2 posiciones · 100,0 %/);
    /* Sin etiqueta aparte: el nombre accesible es el contenido, que lleva también a dónde va. */
    expect(recuadro()?.hasAttribute("aria-label")).toBe(false);
    expect(recuadro()?.textContent).toContain("Abrir en Diseño de la propuesta");
  });

  test("ANA-12: el nombre escrito en el diálogo de Análisis se queda en la propuesta en curso", async () => {
    await abrir("/analisis");
    /* Sin propuesta, el recuadro lo dice (M4, 21-11-2026). */
    expect(recuadro()?.textContent).toMatch(/^Sin propuestaEmpezar/);
    await act(async () => boton("Poner el nombre en el diálogo")!.click());
    expect(recuadro()?.textContent).toContain("Familia García");
    expect(recuadro()?.hasAttribute("aria-label")).toBe(false);
  });

  test("MAR-24: el aviso de la pestaña vive en una región que ya está montada, vacía", async () => {
    await abrir("/mercado");
    const region = host.querySelector(".app-topbar [role='status']");
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe("");
  });
});

describe("lo que el marco pasa a las pantallas", () => {
  test("ACT-01: el Buscador recibe la fuente de datos", async () => {
    await abrir("/buscador");
    expect(estado.buscador.at(-1)?.sourceKind).toBe(DEFAULT_DATA_SOURCE_KIND);
  });

  test("ACT-12: lo que está en la propuesta conserva su referencia si las posiciones no cambian", async () => {
    await abrir("/buscador");
    const antes = estado.buscador.at(-1)?.enCartera;
    const pintados = estado.buscador.length;
    await act(async () => boton("Teclear")!.click());
    expect(estado.buscador.length).toBeGreaterThan(pintados);
    expect(estado.buscador.at(-1)?.enCartera).toBe(antes);
  });

  test("ACT-05: con cinco guardados, quitar uno quita; añadir un sexto no hace nada; añadir uno que está no lo quita", async () => {
    const almacen = getBrowserDraftStorage(DEFAULT_DATA_SOURCE_KIND);
    writeComparisonSelection(almacen, ["A", "B", "C", "D", "E"]);
    await abrir("/comparador");
    const ultimo = () => estado.comparador.at(-1)!;
    expect(ultimo().assetIds).toEqual(["A", "B", "C", "D", "E"]);

    await act(async () => (ultimo().onAdd as (id: string) => void)("F"));
    expect(ultimo().assetIds).toEqual(["A", "B", "C", "D", "E"]);

    await act(async () => (ultimo().onAdd as (id: string) => void)("C"));
    expect(ultimo().assetIds).toEqual(["A", "B", "C", "D", "E"]);

    await act(async () => (ultimo().onRemove as (id: string) => void)("B"));
    expect(ultimo().assetIds).toEqual(["A", "C", "D", "E"]);
    await act(async () => (ultimo().onRemove as (id: string) => void)("B"));
    expect(ultimo().assetIds).toEqual(["A", "C", "D", "E"]);
    expect(readComparisonSelection(almacen)).toEqual(["A", "C", "D", "E"]);
  });

  test("PLA-11: pulsar el destino en el que se está vuelve a su inicio, y «Atrás» vuelve a la ficha", async () => {
    await abrir("/jubilacion/planes#plan=N1234");
    expect(host.querySelector("#vista")?.textContent).toBe("ficha");
    const empuje = vi.spyOn(window.history, "pushState");
    await act(async () => entrada("Planes y EPSV").click());
    expect(window.location.pathname).toBe("/jubilacion/planes");
    expect(window.location.hash).toBe("");
    expect(empuje).toHaveBeenCalledWith({ routeId: "planes" }, "", "/jubilacion/planes");
    expect(estado.avisosDePlanes).toBeGreaterThan(0);
    expect(host.querySelector("#vista")?.textContent).toBe("lista");

    /* Lo que hace «Atrás»: el navegador devuelve la dirección anterior y emite popstate. */
    await act(async () => {
      window.history.replaceState(null, "", "/jubilacion/planes#plan=N1234");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(host.querySelector("#vista")?.textContent).toBe("ficha");
  });

  test("sin nada tras el `#`, pulsar el destino en el que se está no apila otra entrada", async () => {
    await abrir("/posiciones");
    const empuje = vi.spyOn(window.history, "pushState");
    await act(async () => entrada("Posiciones").click());
    expect(empuje).not.toHaveBeenCalled();
  });
});
