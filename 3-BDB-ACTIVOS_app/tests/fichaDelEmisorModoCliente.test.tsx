/**
 * Decisión 53, completada en pantalla el 09-11-2026: en Modo cliente no sale nada del emisor. La ficha de un ETF con bloque del emisor
 * y mercado objetivo, compuesta por `componerFicha` y pintada por `FichaInstrumento` con el modo encendido y apagado: encendido, ni
 * «Valor liquidativo del emisor» (con la prima), ni «Lo que dice el emisor», ni la comisión de swap, ni la fuente de la política que
 * rellena el emisor, ni «Para quién está pensado»; las demás secciones siguen. Apagado, todo está como estaba. Desde la decisión B-65 la
 * política que rellena el emisor sí sale en el Perfil con el modo encendido, sin nombrar la fuente; la comisión de swap, no.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Documento, InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";
import { FichaInstrumento } from "../src/components/ficha/FichaInstrumento";
import { SE_OCULTA } from "../src/core/modoCliente";

const HOY = new Date("2026-11-09T10:00:00Z");
const ISIN = "IE00B3YCGJ38";

const DEL_EMISOR: Documento = {
  source: "issuer:invesco",
  as_of: "2026-11-08",
  costs: { ongoing_charge: 0.0005, swap_fee: 0.000718 },
  distribution_policy: { value: "ACCUMULATING", text: "Accumulating" },
  replication: { type: "SYNTHETIC", method: "Synthetic" },
  index: { name: "S&P 500® Total Return (Net) Index" },
  nav: { series_class: "ISSUER_NAV_DERIVED", currency: "USD", last_date: "2026-11-05", last_value: 14.7862 },
  holdings: { as_of: "2026-11-04", positions_count: 629, top10_weight: 0.424, nature: "SUBSTITUTE_BASKET" }
};
const PRIMA: Documento = { status: "PUBLISHED", as_of: "2026-11-03", observations: 247, mean: 0.000277, latest: -0.00066, nav_adjustment: "NONE" };
const MERCADO: Documento = {
  source: "issuer:invesco",
  target_market_as_of: "2026-09-30",
  investor_type: { retail: "YES", professional: "YES", eligible_counterparty: "YES" },
  knowledge: { basic: "YES", informed: "YES", advanced: "YES" },
  min_holding_period: { years: 5 }
};

const BLOQUES: InstrumentoDeLaBase["bloques"] = {
  "declared/issuer_data": DEL_EMISOR,
  "computed/premium_discount": PRIMA,
  "declared/target_market": MERCADO,
  "declared/costs": { as_of: "2026-10-31", ongoing_charge: 0.0005, ongoing_charge_source: "KID", document_date: "2026-08-21" },
  "declared/profile": { as_of: "2026-10-31", distribution_policy: "UNKNOWN" },
  "declared/regulatory": { as_of: "2026-10-31", sri: 4, kid_evidence: { document_date: "2026-08-21" } }
};

function pinta(modoCliente: boolean, bloques: InstrumentoDeLaBase["bloques"] = BLOQUES) {
  const ficha = componerFicha(
    {
      isin: ISIN,
      raiz: { instrument_type: "ETF", identity: { name: "Invesco S&P 500 UCITS ETF", currency: "USD" } },
      tarjeta: { instrument_id: ISIN },
      calidad: undefined,
      bloques
    },
    undefined,
    { modoCliente, hoy: HOY }
  );
  return { ficha, ids: ficha.secciones.map((s) => s.id), html: renderToStaticMarkup(<FichaInstrumento ficha={ficha} />) };
}

const DEL_EMISOR_IDS = ["vl-emisor", "datos-emisor", "mercado-objetivo"];
const TEXTOS_DEL_EMISOR = [
  "Valor liquidativo del emisor",
  "Prima o descuento",
  "Lo que dice el emisor",
  "Comisión de swap",
  "Del emisor (Invesco)",
  "Para quién está pensado"
];

describe("la ficha de un ETF con bloque del emisor (decisión 53)", () => {
  test("fuera del Modo cliente, todo lo del emisor está, como estaba", () => {
    const { ids, html } = pinta(false);
    for (const id of DEL_EMISOR_IDS) expect(ids, id).toContain(id);
    for (const texto of TEXTOS_DEL_EMISOR) expect(html, texto).toContain(texto);
  });

  test("en Modo cliente no se compone ni se pinta nada del emisor", () => {
    const { ids, html } = pinta(true);
    for (const id of DEL_EMISOR_IDS) expect(ids, id).not.toContain(id);
    for (const texto of TEXTOS_DEL_EMISOR) expect(html, texto).not.toContain(texto);
    expect(html).not.toMatch(/Invesco\b(?! S&amp;P 500 UCITS ETF)/);
  });

  test("en Modo cliente las demás secciones siguen", () => {
    const fuera = pinta(false).ids.filter((id) => !DEL_EMISOR_IDS.includes(id) && id !== "calidad");
    const { ficha, ids } = pinta(true);
    expect(fuera.length).toBeGreaterThan(2);
    for (const id of fuera) expect(ids, id).toContain(id);
    const coste = ficha.secciones.find((s) => s.id === "coste");
    expect(coste?.filas.map((f) => f.rotulo)).toContain("Coste corriente");
  });

  test("en Modo cliente la política que rellena el emisor sale en el Perfil, sin su fuente, y el swap sigue oculto (decisión B-65)", () => {
    const { ficha, html } = pinta(true);
    const politica = ficha.secciones.find((s) => s.id === "perfil")?.filas.find((f) => f.rotulo === "Política de reparto");
    expect(politica).toMatchObject({ valor: "Acumulación" });
    expect(politica?.ausencia).toBeUndefined();
    expect(politica?.glosa).toBeUndefined();
    expect(html).toContain('<div class="ficha__fila"><span class="ficha__rotulo">Política de reparto</span><span class="ficha__valor">Acumulación</span></div>');
    expect(html).not.toContain("Del emisor");
    expect(html).not.toContain("El proveedor no la declara");
    expect(html).not.toContain("Comisión de swap");
    expect(html).not.toContain("0,0718");
    expect(ficha.secciones.find((s) => s.id === "coste")?.filas.map((f) => f.rotulo)).not.toContain("Comisión de swap");
  });

  test("fuera del Modo cliente la política del emisor sale con su fuente", () => {
    const politica = pinta(false).ficha.secciones.find((s) => s.id === "perfil")?.filas.find((f) => f.rotulo === "Política de reparto");
    expect(politica).toMatchObject({ valor: "Acumulación" });
    expect(politica?.glosa).toContain("Del emisor (Invesco)");
  });

  test("su entrada en la lista de Modo cliente cita las decisiones B-53 y B-65", () => {
    expect(SE_OCULTA.datosDelEmisor).toContain("decisión B-53");
    expect(SE_OCULTA.datosDelEmisor).toContain("decisión B-65");
    expect(SE_OCULTA.datosDelEmisor).toMatch(/Valor liquidativo del emisor.*Lo que dice el emisor/);
  });
});

/** El HTML de una sección sola, por su título: de su cabecera al cierre de su `<section>`. */
function htmlDeLaSeccion(html: string, titulo: string): string {
  const inicio = html.lastIndexOf("<section", html.indexOf(`>${titulo}<`));
  return html.slice(inicio, html.indexOf("</section>", inicio));
}
const htmlDelPerfil = (html: string) => htmlDeLaSeccion(html, "Perfil");

const textoDe = (trozos: readonly { texto: string }[] | undefined) => (trozos ?? []).map((t) => t.texto).join("");

describe("la procedencia del Perfil cuando la política la rellena el emisor", () => {
  const SOLO_FOLLETO: InstrumentoDeLaBase["bloques"] = {
    ...BLOQUES,
    "declared/profile": { as_of: "2026-10-31", distribution_policy: "ACCUMULATING" }
  };

  test.each([false, true])("con la política del folleto dice «Del folleto», con su fecha (Modo cliente: %s)", (modoCliente) => {
    const { ficha, html } = pinta(modoCliente, SOLO_FOLLETO);
    const perfil = ficha.secciones.find((s) => s.id === "perfil");
    expect(textoDe(perfil?.procedencia)).toMatch(/^Del folleto · /);
    expect(htmlDelPerfil(html)).toContain("Del folleto");
  });

  test("fuera del Modo cliente, con la fila del emisor, dice «Del folleto y del emisor» con la fecha del folleto", () => {
    const { ficha, html } = pinta(false);
    const perfil = ficha.secciones.find((s) => s.id === "perfil");
    const conSoloElFolleto = pinta(false, SOLO_FOLLETO).ficha.secciones.find((s) => s.id === "perfil");
    expect(textoDe(perfil?.procedencia)).toBe(textoDe(conSoloElFolleto?.procedencia).replace("Del folleto", "Del folleto y del emisor"));
    expect(htmlDelPerfil(html)).toContain("Del folleto y del emisor");
    expect(htmlDelPerfil(html)).toContain("Del emisor (Invesco)");
  });

  test("en Modo cliente, con la fila del emisor, dice «Documentación del instrumento» y no nombra al emisor ni al folleto", () => {
    const { ficha, html } = pinta(true);
    const perfil = ficha.secciones.find((s) => s.id === "perfil");
    const conSoloElFolleto = pinta(true, SOLO_FOLLETO).ficha.secciones.find((s) => s.id === "perfil");
    expect(textoDe(perfil?.procedencia)).toBe(textoDe(conSoloElFolleto?.procedencia).replace("Del folleto", "Documentación del instrumento"));
    const seccion = htmlDelPerfil(html);
    expect(seccion).toContain("Documentación del instrumento");
    expect(seccion).toContain("Acumulación");
    for (const texto of ["emisor", "Emisor", "fabricante", "Fabricante", "Invesco", "Del folleto"]) expect(seccion, texto).not.toContain(texto);
  });

  test("sin bloque del folleto no sale el Perfil, aunque el emisor traiga la política", () => {
    const { "declared/profile": perfil, ...sinFolleto } = BLOQUES;
    expect(perfil).toBeDefined();
    expect(pinta(false, sinFolleto).ids).not.toContain("perfil");
    expect(pinta(true, sinFolleto).ids).not.toContain("perfil");
  });
});

describe("la procedencia de Rentas cuando la política la rellena el emisor", () => {
  const REGISTROS: Documento = { as_of: "2026-10-31", payments: [], yield_12m: 0, records_checked: true };
  const CON_REGISTROS: InstrumentoDeLaBase["bloques"] = { ...BLOQUES, "declared/distributions": REGISTROS };
  const SOLO_FOLLETO: InstrumentoDeLaBase["bloques"] = {
    ...CON_REGISTROS,
    "declared/profile": { as_of: "2026-10-31", distribution_policy: "ACCUMULATING" }
  };
  const rentas = (modoCliente: boolean, bloques: InstrumentoDeLaBase["bloques"]) => {
    const { ficha, html } = pinta(modoCliente, bloques);
    return { seccion: ficha.secciones.find((s) => s.id === "rentas"), html: htmlDeLaSeccion(html, "Rentas") };
  };

  test.each([false, true])("con la política del folleto dice «Registros de reparto del proveedor», con su fecha (Modo cliente: %s)", (modoCliente) => {
    const { seccion, html } = rentas(modoCliente, SOLO_FOLLETO);
    expect(textoDe(seccion?.procedencia)).toMatch(/^Registros de reparto del proveedor · /);
    expect(html).toContain("Registros de reparto del proveedor");
  });

  test("fuera del Modo cliente, con la fila del emisor, nombra la mezcla con la fecha de los registros", () => {
    const { seccion, html } = rentas(false, CON_REGISTROS);
    const conSoloElFolleto = rentas(false, SOLO_FOLLETO).seccion;
    expect(textoDe(seccion?.procedencia)).toBe(
      textoDe(conSoloElFolleto?.procedencia).replace("Registros de reparto del proveedor", "Registros de reparto del proveedor y política del emisor")
    );
    expect(html).toContain("Registros de reparto del proveedor y política del emisor");
    expect(html).toContain("Del emisor (Invesco)");
  });

  test("en Modo cliente, con la fila del emisor, dice «Registros de reparto y documentación del instrumento» y no nombra al emisor", () => {
    const { seccion, html } = rentas(true, CON_REGISTROS);
    const conSoloElFolleto = rentas(true, SOLO_FOLLETO).seccion;
    expect(textoDe(seccion?.procedencia)).toBe(
      textoDe(conSoloElFolleto?.procedencia).replace("Registros de reparto del proveedor", "Registros de reparto y documentación del instrumento")
    );
    expect(html).toContain("Registros de reparto y documentación del instrumento");
    expect(html).toContain("Acumulación");
    for (const texto of ["emisor", "Emisor", "fabricante", "Fabricante", "Invesco", "Del folleto"]) expect(html, texto).not.toContain(texto);
  });
});
