/**
 * Decisión 58, en pantalla: la sección «Para quién está pensado (según el fabricante)» compuesta por `componerFicha` y pintada por
 * `FichaInstrumento`, con un documento SIMULADO (la base local aún no tiene ninguno). Lo que se fija: que sale junto al indicador
 * regulatorio, que el aviso del mercado objetivo negativo se pinta destacado y solo entonces, que sin documento no hay rastro, que
 * en Modo cliente no sale, y que ningún informe en papel la lee (decisión 53).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Documento, InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";
import { FichaInstrumento } from "../src/components/ficha/FichaInstrumento";

const HOY = new Date("2026-11-09T10:00:00Z");

const MERCADO: Documento = {
  source: "issuer:ishares",
  source_url: "https://example.invalid/emt/ishares.xlsx",
  sha256: "b".repeat(64),
  template_version: "V4",
  target_market_as_of: "2026-09-30",
  investor_type: { retail: "YES", professional: "YES", eligible_counterparty: "YES" },
  knowledge: { basic: "YES", informed: "YES", advanced: "YES" },
  loss_capacity: { no_loss: "NO", no_guarantee: "YES" },
  objectives: { capital_growth: "YES", income: "YES" },
  min_holding_period: { years: 5 },
  esg_preferences_considered: "NEUTRAL",
  distribution: { execution_only: "B", appropriateness: "B", advice: "B", portfolio_management: "B" }
};

function pinta(bloques: InstrumentoDeLaBase["bloques"], modoCliente = false) {
  const ficha = componerFicha(
    {
      isin: "IE00B4L5Y983",
      raiz: { instrument_type: "ETF", identity: { name: "iShares Core MSCI World UCITS ETF", currency: "USD" } },
      tarjeta: { instrument_id: "IE00B4L5Y983" },
      calidad: undefined,
      bloques
    },
    undefined,
    { modoCliente, hoy: HOY }
  );
  return { ficha, html: renderToStaticMarkup(<FichaInstrumento ficha={ficha} />) };
}

const REGULATORIO: Documento = { as_of: "2026-10-31", sri: 4, kid_evidence: { document_date: "2026-08-21" } };

describe("en la ficha", () => {
  test("sale con su título, su fuente y su fecha, justo después del indicador regulatorio", () => {
    const { ficha, html } = pinta({ "declared/regulatory": REGULATORIO, "declared/target_market": MERCADO });
    const ids = ficha.secciones.map((s) => s.id);
    expect(ids.indexOf("mercado-objetivo")).toBe(ids.indexOf("regulatorio") + 1);
    expect(html).toContain("Para quién está pensado (según el fabricante)");
    expect(html).toContain("<b>Declarado por iShares</b><span> · 30/09/2026</span>");
    expect(html).toContain("Horizonte mínimo recomendado");
    expect(html).toContain('<span class="ficha__valor ficha__valor--destacado">5 años</span>');
    expect(html).toContain("Minorista, profesional y contraparte elegible; sin experiencia previa");
    expect(html).toContain("Canal: cualquiera, a minoristas y profesionales.");
  });

  test("sin mercado objetivo negativo no hay aviso en la sección", () => {
    const { html } = pinta({ "declared/target_market": MERCADO });
    expect(html).not.toContain('class="ficha__aviso"');
  });

  test("con un NO a minoristas, el aviso destacado va bajo la procedencia y antes de las filas", () => {
    const { html } = pinta({
      "declared/target_market": { ...MERCADO, investor_type: { retail: "NO", professional: "YES", eligible_counterparty: "YES" } }
    });
    const seccion = html.slice(html.indexOf("Para quién está pensado"));
    const aviso = seccion.indexOf('<p class="ficha__aviso"><b>iShares no lo piensa para clientes minoristas.</b>');
    expect(aviso).toBeGreaterThan(0);
    expect(aviso).toBeLessThan(seccion.indexOf("Horizonte mínimo recomendado"));
  });

  test("sin documento, ni la sección ni un estado vacío", () => {
    const { ficha, html } = pinta({ "declared/regulatory": REGULATORIO });
    expect(ficha.secciones.some((s) => s.id === "mercado-objetivo")).toBe(false);
    expect(html).not.toMatch(/Para quién|Horizonte mínimo|fabricante/);
  });

  test("en Modo cliente no sale: es un dato del emisor para el asesor", () => {
    const { ficha, html } = pinta({ "declared/target_market": MERCADO }, true);
    expect(ficha.secciones.some((s) => s.id === "mercado-objetivo")).toBe(false);
    expect(html).not.toContain("Para quién está pensado");
  });

  test("ni «EMT», ni códigos numéricos, ni respuestas en inglés en pantalla", () => {
    const { html } = pinta({ "declared/regulatory": REGULATORIO, "declared/target_market": MERCADO });
    const seccion = html.slice(html.indexOf("Para quién está pensado"));
    const texto = seccion.slice(0, seccion.indexOf("</section>")).replace(/<[^>]+>/g, " ");
    expect(texto).not.toMatch(/\bEMT\b|\bEET\b|\b0\d{4}\b|\bYES\b|\bNEUTRAL\b|\bV4\b/);
  });
});

describe("fuera del papel (decisión 53)", () => {
  const RAIZ = fileURLToPath(new URL("..", import.meta.url));
  const ficheros = (carpeta: string): string[] =>
    readdirSync(carpeta).flatMap((nombre) => {
      const ruta = join(carpeta, nombre);
      return statSync(ruta).isDirectory() ? ficheros(ruta) : [ruta];
    });

  test("ningún informe lee el mercado objetivo", () => {
    for (const ruta of ficheros(join(RAIZ, "src", "reports"))) {
      const codigo = readFileSync(ruta, "utf8");
      expect(codigo, ruta).not.toMatch(/target_market|fichaDelMercadoObjetivo|mercado-objetivo/);
    }
  });
});
