import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const adminState = vi.hoisted(() => ({ value: false as boolean }));

vi.mock("../src/auth/useIsAdmin", () => ({
  useIsAdmin: () => adminState.value,
  useAdminClaim: () => ({ isAdmin: adminState.value, resolved: true })
}));

import { ActivePortfolioChip, BdbActivosApp } from "../src/app/BdbActivosApp";

/**
 * El mapa del 02-11-2026 (decisión 1 del rediseño). Antes eran cuatro secciones de
 * asesoramiento con «Cartera» y «Cartera real» separadas, y «Posiciones globales» y
 * «Extracto externo» en secciones distintas siendo la misma pantalla.
 */
/* 13-11-2026: entra «Planificación», con Jubilación. Su entidad es el plan de un cliente, no un activo ni una cartera.
   El mismo día, «Planes y EPSV» (decisión D-11): patrimonio del cliente que no es cartera. */
/* 13-11-2026, rediseño: «Carteras» se parte en «Propuestas» (la cartera que se diseña) y «Clientes» (la real). */
const STANDARD_SECTIONS = ["Mercado", "Activos", "Propuestas", "Clientes", "Planificación"];
const STANDARD_ITEMS = [
  "Mercado",
  "Buscador",
  "Comparador",
  "Diseño",
  "Análisis",
  "Informes",
  "Guardadas",
  "Carteras de clientes",
  "Posiciones",
  "Jubilación",
  "Planes y EPSV"
];

function sidebarMarkup(html: string): string {
  return html.match(/<nav class="rail-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
}

function renderedSectionLabels(html: string): string[] {
  return Array.from(
    sidebarMarkup(html).matchAll(/class="rail-section__label"[^>]*>([^<]+)<\/div>/g),
    (match) => match[1]
  );
}

function renderedItemLabels(html: string): string[] {
  return Array.from(
    sidebarMarkup(html).matchAll(/<a\b[^>]*class="rail-link[^"]*"[^>]*>[\s\S]*?<span>([^<]+)<\/span>[\s\S]*?<\/a>/g),
    (match) => match[1]
  );
}

function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

describe("application navigation", () => {
  beforeEach(() => {
    adminState.value = false;
  });

  it("renders the advisor sections with their exact items (mapa 02-11-2026, y Planificación desde el 13-11)", () => {
    const html = renderToStaticMarkup(<BdbActivosApp />);

    expect(renderedSectionLabels(html)).toEqual(STANDARD_SECTIONS);
    expect(renderedItemLabels(html)).toEqual(STANDARD_ITEMS);
    expect(sidebarMarkup(html)).not.toContain("Sistema");
    expect(sidebarMarkup(html)).not.toContain("Mapa del programa");
  });

  it("una sola pantalla no aparece dos veces en el rail", () => {
    /* «Posiciones globales» y «Extracto externo» eran el mismo `PositionsWorkbench` en
       dos secciones. Si alguien devuelve una de las dos al rail, esto falla. */
    adminState.value = true;
    const items = renderedItemLabels(renderToStaticMarkup(<BdbActivosApp />));
    expect(new Set(items).size).toBe(items.length);
    expect(items).not.toContain("Posiciones globales");
    expect(items).not.toContain("Extracto externo");
  });

  it("la ficha NO es una entrada del rail, aunque tenga dirección propia", () => {
    /* Nadie pulsa «Ficha» sin un instrumento delante. Se llega desde el Buscador, el
       Comparador y la cartera, y la dirección `/activo/<ISIN>` la fija appRoutes. */
    adminState.value = true;
    expect(renderedItemLabels(renderToStaticMarkup(<BdbActivosApp />))).not.toContain("Ficha");
  });

  it("la sección de datos, solo para admin, lleva Salud del catálogo y Sistema", () => {
    adminState.value = true;
    const html = renderToStaticMarkup(<BdbActivosApp />);

    expect(renderedSectionLabels(html)).toEqual([...STANDARD_SECTIONS, "Datos"]);
    expect(renderedItemLabels(html)).toEqual([...STANDARD_ITEMS, "Salud del catálogo", "Sistema"]);
  });
});

describe("ActivePortfolioChip", () => {
  it("stays hidden while the active portfolio is empty", () => {
    const html = renderToStaticMarkup(<ActivePortfolioChip positions={[]} onOpen={() => undefined} />);

    expect(html).toBe("");
  });

  it("shows the active position count and total weight", () => {
    const html = renderToStaticMarkup(
      <ActivePortfolioChip
        positions={[
          { asset_id: "FUND-A", weight_percent: 40 },
          { asset_id: "ETF-B", weight_percent: 35 }
        ]}
        onOpen={() => undefined}
      />
    );

    // Rediseño del 13-11-2026: «Propuesta en curso», y sin nombre lo dice.
    expect(plainText(html)).toMatch(/Propuesta en curso\s*sin nombre\s*2\s*posiciones\s*·\s*75,0\s*%/);
    expect(html).toContain('type="button"');
  });

  it("shows the portfolio name when the active portfolio has one", () => {
    const html = renderToStaticMarkup(
      <ActivePortfolioChip
        positions={[{ asset_id: "FUND-A", weight_percent: 100 }]}
        name="Carmen Ruiz · propuesta equilibrada"
        onOpen={() => undefined}
      />
    );

    expect(plainText(html)).toContain("Carmen Ruiz · propuesta equilibrada");
    expect(plainText(html)).toMatch(/1\s*posición/);
  });

  it("dice «sin guardar» cuando toca, y no cuando no (DIS-19)", () => {
    const posiciones = [{ asset_id: "FUND-A", weight_percent: 100 }];
    const sin = renderToStaticMarkup(<ActivePortfolioChip positions={posiciones} name="Familia García" sinGuardar onOpen={() => undefined} />);
    const con = renderToStaticMarkup(<ActivePortfolioChip positions={posiciones} name="Familia García" onOpen={() => undefined} />);
    expect(plainText(sin)).toContain("sin guardar");
    expect(plainText(con)).not.toContain("sin guardar");
  });

  it("su nombre accesible es la frase entera, también donde el rótulo y el nombre no se ven (DIS-19, DIR-04)", () => {
    const html = renderToStaticMarkup(
      <ActivePortfolioChip
        positions={[{ asset_id: "FUND-A", weight_percent: 60 }, { asset_id: "ETF-B", weight_percent: 40 }]}
        name="Familia García"
        sinGuardar
        onOpen={() => undefined}
      />
    );
    /* El nombre accesible es el contenido (los puntos entre las partes los pone la hoja): sin `aria-label`, para que
       el texto visible esté siempre contenido en él (WCAG 2.5.3). */
    expect(html).not.toContain("aria-label");
    const contenido = plainText(html).replace(/\u00a0/g, " ");
    for (const parte of ["Propuesta en curso", "Familia García", "posiciones", "100,0 %", "sin guardar", "Abrir en Diseño de la propuesta"]) {
      expect(contenido).toContain(parte);
    }
  });

  it("con nombre y sin posiciones también sale: se está empezando una propuesta", () => {
    const html = renderToStaticMarkup(<ActivePortfolioChip positions={[]} name="Familia García" onOpen={() => undefined} />);
    expect(plainText(html)).toMatch(/Propuesta en curso\s*Familia García\s*0\s*posiciones/);
  });
});
