/**
 * La ficha de activo en la plantilla única: tema interno en la pantalla normal y de cliente en Modo cliente, la identidad del
 * asesor en la cabecera, la evolución en el gráfico de líneas de la plantilla y las cifras del modelo tal cual. Se lee el PDF
 * generado.
 */
import { describe, expect, test } from "vitest";
import type { Documento, InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";
import { createFichaDeActivoPdfBlob, type FichaDeActivoPdfInput } from "../src/reports/fichaDeActivoPdf";
import type { EvolucionDeLaFicha } from "../src/types/fichaInstrumento";
import { IDENTIDAD_DE_PRUEBA, comprobarPlantilla, guardarSiSePide } from "./support/comprobarPlantilla";
import { extractPdfFontFaces, extractPdfPageTexts } from "./support/pdfText";

const HOY = new Date("2026-11-09T10:00:00Z");
const GENERADO = new Date(2026, 10, 9, 21, 52);

const FONDO: InstrumentoDeLaBase = {
  isin: "LU1295551144",
  raiz: { identity: { name: "Capital Group New Perspective Fund (LUX) B", currency: "EUR" }, instrument_type: "FUND" },
  tarjeta: {
    instrument_id: "LU1295551144",
    identity: { name: "Capital Group New Perspective Fund (LUX) B" },
    exposure: {
      asset_mix: { equity: 0.972, cash: 0.0267, other: 0.0012 },
      sectors: { technology: 0.3439, industrials: 0.1287 },
      equity_styles: { growth: 0.4198, blend: 0.4176, value: 0.1626 },
      market_caps: { large: 0.8625, mid: 0.1291, small: 0.0085 }
    }
  },
  calidad: undefined,
  bloques: {
    "declared/costs": { as_of: "2026-10-05", ongoing_charge: 0.0159, ongoing_charge_source: "KID", document_date: "2026-10-05" },
    "declared/exposure": {
      source: "MORNINGSTAR",
      as_of: "2026-09-30",
      confidence: "HIGH",
      equity_style_box: {
        large_value: 0.1318, large_blend: 0.3654, large_growth: 0.3653,
        mid_value: 0.0274, mid_blend: 0.0497, mid_growth: 0.052,
        small_value: 0.0035, small_blend: 0.0026, small_growth: 0.0023
      }
    },
    "declared/profile": { as_of: "2026-10-31", distribution_policy: "ACCUMULATING", objective: "The Fund's investment objective is to provide long-term growth of capital. ".repeat(12) }
  }
} as unknown as InstrumentoDeLaBase;

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
const ETF: InstrumentoDeLaBase = {
  isin: "IE00B3YCGJ38",
  raiz: { instrument_type: "ETF", identity: { name: "Invesco S&P 500 UCITS ETF", currency: "USD" } },
  tarjeta: { instrument_id: "IE00B3YCGJ38" },
  calidad: undefined,
  bloques: {
    "declared/issuer_data": DEL_EMISOR,
    "computed/premium_discount": { status: "PUBLISHED", as_of: "2026-11-03", observations: 247, mean: 0.000277, latest: -0.00066, nav_adjustment: "NONE" },
    "declared/target_market": {
      source: "issuer:invesco",
      target_market_as_of: "2026-09-30",
      investor_type: { retail: "YES", professional: "YES", eligible_counterparty: "YES" },
      knowledge: { basic: "YES", informed: "YES", advanced: "YES" },
      min_holding_period: { years: 5 }
    },
    "declared/costs": { as_of: "2026-10-31", ongoing_charge: 0.0005, ongoing_charge_source: "KID", document_date: "2026-08-21" },
    "declared/profile": { as_of: "2026-10-31", distribution_policy: "UNKNOWN" },
    "declared/regulatory": { as_of: "2026-10-31", sri: 4, kid_evidence: { document_date: "2026-08-21" } }
  }
};

/* Tres años de cierres de mes, con un hueco: la evolución que la pantalla tiene cargada. */
const FECHAS = Array.from({ length: 37 }, (_, i) => new Date(Date.UTC(2023, 9 + i, 28)).toISOString().slice(0, 10));
const EVOLUCION: EvolucionDeLaFicha = {
  procedencia: "Base 100 · mensual · EUR · 37 observaciones · oct 2023 – oct 2026",
  fechas: FECHAS,
  valores: FECHAS.map((_, i) => (i === 12 ? null : Math.round((100 + i * 1.6 + Math.sin(i / 2) * 4) * 10) / 10)),
  variacion: "+57,9 %"
};

function entrada(instrumento: InstrumentoDeLaBase, modoCliente: boolean, extra: Partial<FichaDeActivoPdfInput> = {}): FichaDeActivoPdfInput {
  return {
    ficha: componerFicha(instrumento, undefined, { modoCliente, hoy: HOY }),
    isin: instrumento.isin,
    modoCliente,
    generado: GENERADO,
    datosA: "2026-11-09T14:05:20.205Z",
    identidad: IDENTIDAD_DE_PRUEBA,
    ...extra
  };
}

async function generar(input: FichaDeActivoPdfInput, nombre?: string) {
  const bytes = Buffer.from(await (await createFichaDeActivoPdfBlob(input)).arrayBuffer());
  if (nombre) guardarSiSePide(bytes, "ficha-de-activo", nombre);
  const hojas = extractPdfPageTexts(bytes);
  return { bytes, hojas, texto: hojas.join(" ").replace(/\s+/g, " ") };
}

describe("la ficha de activo en la plantilla", () => {
  test("interna: tema interno, identidad del asesor, las fuentes de la plantilla y ninguna de antes", async () => {
    const { bytes } = await generar(entrada(FONDO, false, { evolucion: EVOLUCION }), "fondo-interno");
    comprobarPlantilla(bytes, { tema: "interno", documento: "Ficha de activo", identidad: "Marta Ruiz Alonso" });
    /* Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de antes) la plantilla vuelve a Fraunces y Roboto Flex; IBM Plex Sans y Source Serif 4, las de la plantilla de una sola tinta, salieron. */
    expect(extractPdfFontFaces(bytes).every((cara) => /^(Fraunces|RobotoFlex)-/.test(cara))).toBe(true);
    expect(extractPdfFontFaces(bytes).join(" ")).not.toMatch(/Newsreader|InstrumentSans|IBMPlexSans|SourceSerif4/);
  }, 30_000);

  test("en Modo cliente: tema de cliente, y sin la tira ni la disponibilidad sin medir (A-126)", async () => {
    const { bytes, texto } = await generar(entrada(FONDO, true, { evolucion: EVOLUCION }), "fondo-cliente");
    comprobarPlantilla(bytes, { tema: "cliente", documento: "Ficha de activo", identidad: "Marta Ruiz Alonso" });
    expect(texto).not.toContain("Qué puedes hacer con él");
    expect(texto).not.toContain("Sin medir");
  }, 30_000);

  test("sin identidad guardada, la cabecera queda sin membrete", async () => {
    const { bytes } = await generar(entrada(ETF, false, { identidad: {} }), "etf-interno-sin-identidad");
    comprobarPlantilla(bytes, { tema: "interno", documento: "Ficha de activo", identidad: null });
  }, 30_000);

  test("el ETF de cliente no lleva nada del emisor, como su modelo", async () => {
    const { bytes, texto } = await generar(entrada(ETF, true), "etf-cliente");
    comprobarPlantilla(bytes, { tema: "cliente", documento: "Ficha de activo", identidad: "Marta Ruiz Alonso" });
    expect(texto).not.toMatch(/issuer:invesco|Comisión de swap|Valor liquidativo del emisor/);
  }, 30_000);

  test("las cifras son las del modelo, tal cual: cada fila de cada sección sale con su valor", async () => {
    const input = entrada(FONDO, false);
    const { texto } = await generar(input);
    const sinLigaduras = (cadena: string) => cadena.replace(/f[il]/g, "").replace(/\s+/g, " ");
    const plano = sinLigaduras(texto);
    for (const seccion of input.ficha.secciones) {
      for (const fila of seccion.filas) if (!fila.larga) expect(plano, `${seccion.id}: ${fila.rotulo}`).toContain(sinLigaduras(fila.valor));
    }
    expect(texto).toContain("1,59 %");
    /* Lo que falta va en gris, la tinta 3, nunca en el ocre del informe interno: ningún texto del cuerpo usa el color del aviso. */
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/reports/fichaDeActivoPdf.tsx", "utf8")).not.toMatch(/PAPEL\.aviso/);
  }, 30_000);

  test("la evolución, en el gráfico de la plantilla: el activo con su último valor, la línea de 100 y el eje de fechas común", async () => {
    const { texto } = await generar(entrada(FONDO, false, { evolucion: EVOLUCION }));
    expect(texto).toContain("Evolución histórica");
    expect(texto).toContain("El activo");
    expect(texto).toContain("Base 100");
    const ultimo = EVOLUCION.valores[EVOLUCION.valores.length - 1]!;
    expect(texto).toContain(ultimo.toFixed(1).replace(".", ","));
    expect(texto).toMatch(/oct 2023|ene 2024/);
    expect(texto).toContain("Variación del periodo +57,9 %");
  }, 30_000);
});
