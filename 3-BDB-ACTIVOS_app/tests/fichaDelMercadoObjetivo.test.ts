/**
 * Decisión 58: «Para quién está pensado (según el fabricante)», del documento `declared/target_market`.
 *
 * Los documentos de abajo son SIMULADOS con la forma exacta del contrato `instrument-declared-target-market.v2` y con los valores que
 * midió `INFORME_EMT_EET_2026-11-09.md` en los 23 ETF (5 años, minorista y profesional, conocimiento básico, capital en riesgo, canal
 * B en los cuatro). La URL y la huella son de relleno: la base local aún no tiene ninguno escrito.
 */
import { describe, expect, test } from "vitest";
import type { Documento, InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { caducado, enAnos, seccionDelMercadoObjetivo } from "../src/adapters/fichaDelMercadoObjetivo";

const HOY = new Date("2026-11-09T10:00:00Z");
const HUELLA = "a".repeat(64);

const TIPICO = {
  investor_type: { retail: "YES", professional: "YES", eligible_counterparty: "YES" },
  knowledge: { basic: "YES", informed: "YES", advanced: "YES" },
  loss_capacity: { no_loss: "NO", no_guarantee: "YES" },
  objectives: { capital_growth: "YES", income: "YES" },
  min_holding_period: { years: 5 },
  esg_preferences_considered: "NEUTRAL",
  distribution: { execution_only: "B", appropriateness: "B", advice: "B", portfolio_management: "B" }
};

const DE_ISHARES: Documento = {
  source: "issuer:ishares",
  source_url: "https://example.invalid/emt/ishares.xlsx",
  sha256: HUELLA,
  template_version: "V4",
  file_generated_at: "2026-10-15",
  target_market_as_of: "2026-09-30",
  ...TIPICO
};
const DE_VANGUARD: Documento = {
  ...DE_ISHARES,
  source: "issuer:vanguard",
  template_version: "V4.2",
  target_market_as_of: "2026-06-30",
  objectives: { capital_growth: "YES", income: "NEUTRAL" }
};
const DE_INVESCO: Documento = {
  ...DE_ISHARES,
  source: "issuer:invesco",
  template_version: "V4.2",
  target_market_as_of: "2026-03-31",
  min_holding_period: { years: 3 }
};

function instrumento(bloques: InstrumentoDeLaBase["bloques"]): InstrumentoDeLaBase {
  return {
    isin: "IE00B4L5Y983",
    raiz: { instrument_type: "ETF", identity: { name: "Un ETF de prueba", currency: "USD" } },
    tarjeta: { instrument_id: "IE00B4L5Y983", available_sections: ["target_market"] },
    calidad: undefined,
    bloques
  };
}

/** El documento sin esas claves: lo que el emisor dejó vacío no llega. */
const sin = (documento: Documento, ...claves: string[]): Documento =>
  Object.fromEntries(Object.entries(documento).filter(([clave]) => !claves.includes(clave)));

const seccion = (mercado: Documento | undefined, otros: InstrumentoDeLaBase["bloques"] = {}, hoy = HOY) =>
  seccionDelMercadoObjetivo(instrumento({ ...otros, ...(mercado ? { "declared/target_market": mercado } : {}) }), hoy);
const fila = (s: ReturnType<typeof seccion>, rotulo: string) => s?.filas.find((f) => f.rotulo === rotulo);
const todoElTexto = (s: ReturnType<typeof seccion>) =>
  JSON.stringify([s?.titulo, s?.procedencia, s?.filas, s?.aviso, s?.nota]);

describe("sin documento", () => {
  test("no hay sección, ni vacía", () => {
    expect(seccion(undefined)).toBeUndefined();
    expect(seccion(undefined, { "declared/regulatory": { sri: 4, recommended_holding_years: 5 } })).toBeUndefined();
  });

  test("un documento que solo trae lo obligatorio no pinta una cabecera sin nada debajo", () => {
    const { source, source_url, sha256, template_version, target_market_as_of } = DE_ISHARES;
    expect(seccion({ source, source_url, sha256, template_version, target_market_as_of })).toBeUndefined();
  });
});

describe("los tres emisores", () => {
  test.each([
    [DE_ISHARES, "iShares", "30/09/2026", "5 años"],
    [DE_VANGUARD, "Vanguard", "30/06/2026", "5 años"],
    [DE_INVESCO, "Invesco", "31/03/2026", "3 años"]
  ])("%#: el emisor nombrado, la fecha del mercado objetivo y el horizonte", (documento, emisor, fecha, horizonte) => {
    const s = seccion(documento);
    expect(s?.titulo).toBe("Para quién está pensado (según el fabricante)");
    expect(s?.procedencia.map((t) => t.texto).join("")).toBe(`Declarado por ${emisor} · ${fecha}`);
    expect(fila(s, "Horizonte mínimo recomendado")).toMatchObject({
      valor: horizonte,
      destacada: true,
      glosa: `Según ${emisor}, en su mercado objetivo.`
    });
  });

  test("el caso típico: cliente y conocimiento en una línea, sin aviso, y pérdidas y canal en la nota", () => {
    const s = seccion(DE_ISHARES);
    expect(fila(s, "Tipo de cliente y conocimiento")).toMatchObject({
      valor: "Minorista, profesional y contraparte elegible; sin experiencia previa",
      larga: true
    });
    expect(s?.aviso).toBeUndefined();
    expect(s?.nota).toBe(
      "Capacidad de pérdidas: capital en riesgo, sin garantía; no es para quien no puede asumir pérdidas. " +
        "Canal: cualquiera, a minoristas y profesionales."
    );
  });

  test("ni la plantilla, ni códigos del EMT, ni la huella, ni los objetivos a la vista", () => {
    for (const documento of [DE_ISHARES, DE_VANGUARD, DE_INVESCO]) {
      const texto = todoElTexto(seccion(documento));
      expect(texto).not.toMatch(/\bEMT\b|\bEET\b|V4|\b0\d{4}\b|NEUTRAL|YES|example\.invalid|aaaa/);
      expect(texto).not.toMatch(/renta|crecimiento|sostenib/i);
    }
  });
});

describe("NEUTRAL es «el fabricante no se pronuncia», y vacío se omite", () => {
  test("un tipo de cliente callado se dice entre paréntesis", () => {
    const s = seccion({ ...DE_VANGUARD, investor_type: { retail: "NEUTRAL", professional: "YES" } });
    expect(fila(s, "Tipo de cliente y conocimiento")?.valor).toBe(
      "Profesional (sobre minoristas, el fabricante no se pronuncia); sin experiencia previa"
    );
  });

  test("todo callado", () => {
    const s = seccion({
      ...DE_VANGUARD,
      investor_type: { retail: "NEUTRAL", professional: "NEUTRAL", eligible_counterparty: "NEUTRAL" },
      knowledge: { basic: "NEUTRAL", informed: "NEUTRAL", advanced: "NEUTRAL" },
      loss_capacity: { no_loss: "NEUTRAL", no_guarantee: "NEUTRAL" }
    });
    expect(fila(s, "Tipo de cliente y conocimiento")?.valor).toBe(
      "Sobre minoristas, profesionales y contrapartes elegibles, el fabricante no se pronuncia; " +
        "sobre el conocimiento necesario, el fabricante no se pronuncia"
    );
    expect(s?.nota).toContain("sobre la garantía de capital, el fabricante no se pronuncia");
    expect(s?.aviso).toBeUndefined();
  });

  test("un básico callado con el informado en sí", () => {
    const s = seccion({ ...DE_ISHARES, knowledge: { basic: "NEUTRAL", informed: "YES", advanced: "YES" } });
    expect(fila(s, "Tipo de cliente y conocimiento")?.valor).toBe(
      "Minorista, profesional y contraparte elegible; con conocimiento medio o alguna experiencia " +
        "(sobre el inversor básico, el fabricante no se pronuncia)"
    );
  });

  test("lo que el documento no trae no se escribe: ni fila, ni frase, ni un «no se pronuncia» inventado", () => {
    const s = seccion(sin(DE_ISHARES, "investor_type", "knowledge", "loss_capacity", "distribution"));
    expect(s?.filas.map((f) => f.rotulo)).toEqual(["Horizonte mínimo recomendado"]);
    expect(s?.nota).toBeUndefined();
    expect(todoElTexto(s)).not.toContain("no se pronuncia");
  });

  test("sin plazo, sin fila de horizonte", () => {
    expect(fila(seccion(sin(DE_ISHARES, "min_holding_period")), "Horizonte mínimo recomendado")).toBeUndefined();
  });
});

describe("el mercado objetivo negativo", () => {
  test("un NO a minoristas lleva aviso destacado y se dice en la línea", () => {
    const s = seccion({ ...DE_ISHARES, investor_type: { retail: "NO", professional: "YES", eligible_counterparty: "YES" } });
    expect(s?.aviso?.[0]).toEqual({ texto: "iShares no lo piensa para clientes minoristas.", fuerte: true });
    expect(fila(s, "Tipo de cliente y conocimiento")?.valor).toBe(
      "Profesional y contraparte elegible, no para minoristas; sin experiencia previa"
    );
  });

  test("un NO al conocimiento básico lleva aviso, y la línea dice cuál basta", () => {
    const s = seccion({ ...DE_INVESCO, knowledge: { basic: "NO", informed: "NO", advanced: "YES" } });
    expect(s?.aviso?.[0].texto).toBe("Invesco no lo piensa para quien solo tiene conocimiento básico.");
    expect(fila(s, "Tipo de cliente y conocimiento")?.valor).toBe(
      "Minorista, profesional y contraparte elegible; con conocimiento avanzado o experiencia en el sector"
    );
  });

  test("los dos NO van en un solo aviso", () => {
    const s = seccion({
      ...DE_ISHARES,
      investor_type: { retail: "NO", professional: "YES" },
      knowledge: { basic: "NO", informed: "YES" }
    });
    expect(s?.aviso?.[0].texto).toBe("iShares no lo piensa para clientes minoristas ni para quien solo tiene conocimiento básico.");
  });

  test("NEUTRAL no es NO: no hay aviso", () => {
    const s = seccion({ ...DE_ISHARES, investor_type: { retail: "NEUTRAL" }, knowledge: { basic: "NEUTRAL" } });
    expect(s?.aviso).toBeUndefined();
  });

  test("un NO en otra casilla (profesional, avanzado) no lleva aviso", () => {
    const s = seccion({ ...DE_ISHARES, investor_type: { retail: "YES", professional: "NO" } });
    expect(s?.aviso).toBeUndefined();
  });
});

describe("el periodo, en años y en código", () => {
  test.each([
    [{ years: 5 }, "5 años"],
    [{ years: 1 }, "1 año"],
    [{ years: 0.92 }, "0,92 años"],
    [{ years: 2.5 }, "2,5 años"],
    [{ years: 0 }, "0 años"]
  ])("%j → %s", (periodo, texto) => {
    expect(fila(seccion({ ...DE_ISHARES, min_holding_period: periodo }), "Horizonte mínimo recomendado")?.valor).toBe(texto);
  });

  test.each([
    ["V", "Muy corto plazo"],
    ["S", "Corto plazo"],
    ["M", "Medio plazo"],
    ["L", "Largo plazo"],
    ["H", "Hasta el vencimiento"]
  ])("el código %s se escribe «%s», sin años inventados", (codigo, texto) => {
    const f = fila(seccion({ ...DE_VANGUARD, min_holding_period: { code: codigo } }), "Horizonte mínimo recomendado");
    expect(f?.valor).toBe(texto);
    expect(f?.glosa).toBe("Según Vanguard, en su mercado objetivo, que lo da como plazo y no en años.");
  });

  test("un código que el contrato no conoce no se pinta", () => {
    expect(fila(seccion({ ...DE_VANGUARD, min_holding_period: { code: "X" } }), "Horizonte mínimo recomendado")).toBeUndefined();
  });

  test("enAnos", () => {
    expect(enAnos(10)).toBe("10 años");
  });
});

describe("el KID manda en el horizonte", () => {
  const REGULATORIO = { sri: 4, recommended_holding_years: 5, kid_evidence: { document_date: "2026-08-21" } };

  test("si coinciden, el KID con su fecha y el fabricante dice lo mismo", () => {
    expect(fila(seccion(DE_ISHARES, { "declared/regulatory": REGULATORIO }), "Horizonte mínimo recomendado")).toMatchObject({
      valor: "5 años",
      glosa: "Del KID de 21/08/2026; iShares dice lo mismo en su mercado objetivo."
    });
  });

  test("si difieren, manda el KID y se dice lo del fabricante", () => {
    expect(fila(seccion(DE_INVESCO, { "declared/regulatory": REGULATORIO }), "Horizonte mínimo recomendado")).toMatchObject({
      valor: "5 años",
      glosa: "Del KID de 21/08/2026, que manda. Invesco, en su mercado objetivo, recomienda 3 años."
    });
  });

  test("frente a un código, se dicen los dos", () => {
    const f = fila(
      seccion({ ...DE_VANGUARD, min_holding_period: { code: "L" } }, { "declared/regulatory": REGULATORIO }),
      "Horizonte mínimo recomendado"
    );
    expect(f?.glosa).toBe("Del KID de 21/08/2026, que manda. Vanguard, en su mercado objetivo, lo da sin años: largo plazo.");
  });

  test("el KID sin fecha no toma otra", () => {
    const f = fila(seccion(DE_ISHARES, { "declared/regulatory": { recommended_holding_years: 6 } }), "Horizonte mínimo recomendado");
    expect(f).toMatchObject({ valor: "6 años", glosa: "Del KID, sin fecha, que manda. iShares, en su mercado objetivo, recomienda 5 años." });
  });

  test("sin plazo del fabricante, el del KID solo", () => {
    expect(fila(seccion(sin(DE_ISHARES, "min_holding_period"), { "declared/regulatory": REGULATORIO }), "Horizonte mínimo recomendado")?.glosa).toBe(
      "Del KID de 21/08/2026."
    );
  });

  test("un regulatorio sin plazo, que es lo que hay hoy en la base, deja el del fabricante", () => {
    expect(fila(seccion(DE_ISHARES, { "declared/regulatory": { sri: 4 } }), "Horizonte mínimo recomendado")?.glosa).toBe(
      "Según iShares, en su mercado objetivo."
    );
  });
});

describe("la caducidad", () => {
  test("con más de 12 meses, la nota lo dice primero", () => {
    const s = seccion({ ...DE_ISHARES, target_market_as_of: "2025-10-31" });
    expect(s?.nota?.startsWith("Este mercado objetivo tiene más de 12 meses: iShares puede haberlo revisado después.")).toBe(true);
    expect(s?.procedencia.map((t) => t.texto).join("")).toBe("Declarado por iShares · 31/10/2025");
  });

  test("con menos, nada", () => {
    expect(seccion({ ...DE_ISHARES, target_market_as_of: "2025-12-31" })?.nota).not.toContain("12 meses");
  });

  test("el día que cumple el año aún no, y el siguiente sí", () => {
    expect(caducado("2025-11-09", HOY)).toBe(false);
    expect(caducado("2025-11-08", HOY)).toBe(true);
    expect(caducado("no es una fecha", HOY)).toBe(false);
  });
});

describe("el canal, cuando no es el mismo en los cuatro", () => {
  test("se agrupa por a quién", () => {
    const s = seccion({
      ...DE_ISHARES,
      distribution: { execution_only: "P", appropriateness: "B", advice: "B", portfolio_management: "N" }
    });
    expect(s?.nota).toContain(
      "Canal: con test de conveniencia y asesoramiento, a minoristas y profesionales; solo ejecución, solo a profesionales; gestión de carteras, a ninguno."
    );
  });

  test("ninguno en los cuatro", () => {
    const s = seccion({
      ...DE_ISHARES,
      distribution: { execution_only: "N", appropriateness: "N", advice: "N", portfolio_management: "N" }
    });
    expect(s?.nota).toContain("Canal: ninguno.");
  });
});
