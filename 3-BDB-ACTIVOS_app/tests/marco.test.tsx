// @vitest-environment happy-dom

/**
 * El marco: lo que se ve en todas las pantallas (lote L2 de la auditoría del 04-11-2026).
 * Se monta el shell real; las pantallas son testigos con su título, que es lo único que el marco
 * necesita de ellas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const estado = vi.hoisted(() => ({ admin: false }));

vi.mock("../src/auth/useIsAdmin", () => ({
  useIsAdmin: () => estado.admin,
  /* El marco espera a saber si hay permiso (MAR-22): en estas pruebas ya se sabe. */
  useAdminClaim: () => ({ isAdmin: estado.admin, resolved: true })
}));

const testigo = (titulo: string) => () => createElement("section", null, createElement("h1", null, titulo));

vi.mock("../src/pages/MercadoPage", () => ({ MercadoPage: testigo("Mercado") }));
vi.mock("../src/pages/AssetComparisonPage", () => ({ AssetComparisonPage: testigo("Comparar activos") }));
vi.mock("../src/pages/XrayPage", () => ({ XrayPage: testigo("Análisis") }));
vi.mock("../src/pages/PortfolioBuilderPage", () => ({ PortfolioBuilderPage: testigo("Diseño de cartera") }));
vi.mock("../src/pages/CarterasGuardadasPage", () => ({ CarterasGuardadasPage: testigo("Carteras guardadas") }));
/* La entrada «Rendimiento» es desde el 13-11-2026 el Gestor de carteras, que ocupa su ruta. */
vi.mock("../src/gestor/ui/GestorDeCarterasPage", () => ({ GestorDeCarterasPage: testigo("Gestor de carteras") }));
vi.mock("../src/pages/PosicionesPage", () => ({ PosicionesPage: testigo("Posiciones") }));
vi.mock("../src/pages/BuscadorNuevoPage", () => ({ BuscadorNuevoPage: testigo("Buscador") }));
vi.mock("../src/pages/AdminPage", () => ({ AdminPage: testigo("Sistema") }));
vi.mock("../src/pages/SaludDelCatalogoPage", () => ({ SaludDelCatalogoPage: testigo("Salud del catálogo") }));

import { BdbActivosApp } from "../src/app/BdbActivosApp";
import { MONOGRAMA_DE_LA_CASA, NOMBRE_DE_LA_CASA } from "../src/core/marca";

/* Desde `process.cwd()`: con happy-dom, `import.meta.url` no es una dirección de fichero. */
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  estado.admin = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  window.history.replaceState(null, "", "/");
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

async function abrir(ruta: string, envoltorio: (hijo: ReactNode) => ReactNode = (hijo) => hijo) {
  window.history.replaceState(null, "", ruta);
  await act(async () => {
    root!.render(envoltorio(createElement(BdbActivosApp)));
  });
  await esperar(() => host.querySelector("main h1") !== null, "el título de la pantalla");
}

const entrada = (nombre: string) => {
  const boton = host.querySelector<HTMLAnchorElement>(`nav.rail-nav a[aria-label="${nombre}"]`);
  if (!boton) throw new Error(`Falta la entrada «${nombre}» en el menú`);
  return boton;
};

describe("un nombre para la casa (decisión 23)", () => {
  test("el menú dice Independent Private Bankers y, plegado, el monograma", async () => {
    await abrir("/mercado");
    const marca = host.querySelector(".rail-brand")!;
    expect(marca.querySelector(".rail-brand__mark")?.textContent).toBe(MONOGRAMA_DE_LA_CASA);
    expect(MONOGRAMA_DE_LA_CASA).toBe("IPB");
    expect(marca.querySelector(".rail-brand__text")?.textContent?.replace("Independent", "Independent ")).toBe(NOMBRE_DE_LA_CASA);
  });

  test("ni OAA, ni BDB Activos, ni Fundamental Intelligence en el texto del marco", async () => {
    await abrir("/mercado");
    const texto = `${host.querySelector(".app-rail")?.textContent} ${host.querySelector(".app-topbar")?.textContent} ${document.title}`;
    expect(texto).not.toMatch(/OAA|BDB|Fundamental Intelligence/);
  });

  test("las seis variantes del acceso llevan el nombre, y solo él", () => {
    const acceso = leer("src/auth/AuthGate.tsx");
    expect(acceso.match(/<span className="auth-brand">\{NOMBRE_DE_LA_CASA\}<\/span>/g)).toHaveLength(6);
    expect(acceso).not.toMatch(/auth-brand">[^{]/);
    expect(acceso).not.toContain("OAA");
  });

  test("la pestaña, antes de que arranque la aplicación", () => {
    expect(leer("index.html")).toContain(`<title>${NOMBRE_DE_LA_CASA}</title>`);
  });

  /* Dirección A (18-11-2026): el título de la tarjeta en la serifa seminegra del título de pantalla, y la tarjeta con la
     sombra mínima de las tarjetas de la aplicación, sobre el lienzo. */
  test("el acceso sale en la serifa de la dirección y en tarjeta", () => {
    const hoja = leer("src/styles/modules.css");
    expect(hoja).toMatch(/\.auth-card h1 \{\s*font-family: var\(--fuente-serifa\);[^}]*font-weight: var\(--peso-titulo-pagina\);/);
    expect(hoja.match(/\.auth-card \{[^}]*\}/)?.[0]).toContain("box-shadow: var(--sombra-tarjeta)");
  });
});

describe("la pestaña del navegador", () => {
  /* Rediseño del 13-11-2026: la pestaña lleva el título de la pantalla, que es el del menú salvo en dos. */
  test("cada pantalla, con el título que dice el modelo del menú", async () => {
    estado.admin = true;
    await abrir("/mercado");
    expect(document.title).toBe(`Mercado · ${NOMBRE_DE_LA_CASA}`);
    for (const [nombre, titulo] of [
      ["Comparador", "Comparador"],
      ["Diseño", "Diseño de la propuesta"],
      ["Análisis", "Análisis"],
      ["Informes", "Informes"],
      ["Guardadas", "Propuestas guardadas"],
      ["Carteras de clientes", "Carteras de clientes"],
      ["Posiciones", "Posiciones"],
      ["Sistema", "Sistema"]
    ]) {
      await act(async () => entrada(nombre).click());
      expect(document.title).toBe(`${titulo} · ${NOMBRE_DE_LA_CASA}`);
    }
  });
});

describe("el menú (decisiones 25 y 27)", () => {
  test("Análisis va antes que Informes, y las direcciones no cambian", async () => {
    await abrir("/cartera");
    const nombres = [...host.querySelectorAll(".rail-section")].find((s) => s.textContent?.startsWith("Propuestas"))!;
    expect([...nombres.querySelectorAll("a")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Diseño",
      "Análisis",
      "Informes",
      "Guardadas"
    ]);
    await act(async () => entrada("Informes").click());
    expect(window.location.pathname).toBe("/cartera/informes");
    await act(async () => entrada("Análisis").click());
    expect(window.location.pathname).toBe("/analisis");
  });

  test("en tablet, el nombre corto bajo el icono; el enlace se sigue llamando como la entrada", async () => {
    await abrir("/cartera");
    const cortos = [...host.querySelectorAll(".rail-link__corto")].map((c) => c.textContent);
    expect(cortos).toEqual(["Mercado", "Buscador", "Comparador", "Diseño", "Análisis", "Informes", "Guardadas", "Clientes", "Posiciones", "Jubilación", "Planes"]);
    /* 88 px de barra a 12 px de letra: ninguno pasa de diez letras, que es lo que mide «Comparador». */
    expect(Math.max(...cortos.map((c) => c?.length ?? 0))).toBeLessThanOrEqual(10);
    expect(host.querySelector(".rail-link__corto")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("teclado", () => {
  test("«Saltar al contenido» es lo primero, y lleva al contenido sin tocar la dirección", async () => {
    await abrir("/carteras-guardadas");
    const salto = host.querySelector<HTMLAnchorElement>(".app-shell a, .app-shell button")!;
    expect(salto.textContent).toBe("Saltar al contenido");
    await act(async () => salto.click());
    expect(document.activeElement?.id).toBe("contenido-principal");
    expect(window.location.pathname).toBe("/carteras-guardadas");
    expect(window.location.hash).toBe("");
  });

  test("al entrar, el foco no se mueve: la primera parada es el salto", async () => {
    await abrir("/mercado");
    expect(document.activeElement).toBe(document.body);
  });

  test("al navegar, el foco va al título de la pantalla", async () => {
    await abrir("/mercado");
    const boton = entrada("Comparador");
    boton.focus();
    await act(async () => boton.click());
    await esperar(() => document.activeElement?.tagName === "H1", "el foco en el título");
    expect(document.activeElement?.textContent).toBe("Comparar activos");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });

  test("no le quita el foco a quien ya lo ha movido", async () => {
    await abrir("/mercado");
    const boton = entrada("Comparador");
    boton.focus();
    const otro = document.createElement("input");
    document.body.appendChild(otro);
    await act(async () => boton.click());
    otro.focus();
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 30));
    });
    expect(document.activeElement).toBe(otro);
    otro.remove();
  });
});

describe("la hoja de impresión", () => {
  const hoja = leer("src/styles/impresion.css").replace(/\/\*[\s\S]*?\*\//g, "");

  test("una sola columna a todo el ancho, sin menú ni barra", () => {
    expect(hoja).toMatch(/\.app-rail,\s*\.app-topbar,\s*\.salto-al-contenido\s*\{\s*display: none;/);
    expect(hoja).toMatch(/\.app-shell,\s*\.app-main\s*\{\s*display: block;/);
    expect(hoja).toMatch(/\.app-shell \.app-content\s*\{[^}]*max-width: none;/);
  });

  test("las tablas sin recorte y sin partir filas", () => {
    expect(hoja).toMatch(/:is\(div, section, article, figure, ul, dl\)\s*\{\s*overflow: visible;/);
    expect(hoja).toMatch(/\.app-content table\s*\{[^}]*min-width: 0;/);
    expect(hoja).toMatch(/\.app-content tr\s*\{\s*break-inside: avoid;/);
  });

  test("los gráficos se ajustan al ancho sin colapsar ni crecer", () => {
    /* Recharts mete el gráfico en una caja de 0 × 0 en línea: sin esta regla, salía en blanco. */
    expect(hoja).toMatch(/\.recharts-responsive-container > div,\s*\.app-shell \.app-content \.recharts-wrapper\s*\{\s*width: 100% !important;/);
    /* Solo encoge: a toda la hoja, un gráfico de media columna tapaba lo que venía debajo. */
    expect(hoja).toMatch(/\.recharts-surface\s*\{\s*width: auto !important;\s*max-width: 100%;/);
    /* El marco conserva su alto: sin él, el gráfico colapsa a cero en cuanto alguien vuelve a medir. */
    expect(hoja).not.toMatch(/\.oaa-chart-frame\s*\{/);
  });

  test("las pilas van en bloque: partidas entre dos hojas, lo de detrás se quedaba encima", () => {
    expect(hoja).toMatch(/:is\(\.stack, \.grid, \.panel, \.panel__body[^)]*\)\s*\{\s*display: block;/);
  });

  test("se carga la última y es la única regla de impresión", () => {
    const shell = leer("src/app/BdbActivosApp.tsx");
    expect(shell.indexOf('"../styles/impresion.css"')).toBeGreaterThan(shell.indexOf('"../styles/modules.css"'));
    for (const otra of ["base", "layout", "components", "charts", "modules", "ficha", "tabla"]) {
      expect(leer(`src/styles/${otra}.css`), otra).not.toMatch(/@media print/);
    }
  });
});
