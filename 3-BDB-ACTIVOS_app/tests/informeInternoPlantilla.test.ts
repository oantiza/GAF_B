/**
 * El informe interno de la propuesta en la plantilla única (14-11-2026): tema interno, sin marca de entidad, con la identidad del asesor
 * cuando la hay, «Página x de y» y el sello en la cabecera y el pie de todas las hojas, y sus cifras principales con el formato común.
 * Y dos arreglos que se hicieron al pasarlo: el cono en euros sobre el capital medido (INF-19, segunda parte) y el día de la propuesta en
 * el calendario local (FMT-19).
 *
 * Con `INFORME_INTERNO_PDF=<carpeta>` escribe allí la muestra corta y la larga, para mirarlas.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { demoResponse } from "../src/adapters/demoBackend";
import { fetchPortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { cargarSeriesDeReferencia } from "../src/adapters/seriesDeReferencia";
import { importe, peso, porcentaje, puntos, rentabilidad } from "../src/core/formato";
import type { InternalReportInput } from "../src/core/internalPortfolioReport";
import { buildInternalReportModelWithLabels, capitalDelCono, createInternalPortfolioReportPdfBlob, diaDeLaPropuesta, disposicionDeLaMatriz, LETRA_MINIMA_DEL_PAPEL } from "../src/reports/internalPortfolioReportPdf";
import type { IdentidadDelAsesor } from "../src/reports/plantilla";
import { ABAJO_DEL_CUERPO, ARRIBA_DEL_CUERPO } from "../src/reports/plantilla/tema";
import type { BdbAssetDetail, BdbPortfolioReport } from "../src/types/bdbAssets";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";
import { extractPdfMetadata, extractPdfPageTexts, extractPdfTextBaselines } from "./support/pdfText";

vi.mock("../src/adapters/callableBackend", () => ({ callBackend: (name: string, data: unknown) => demoResponse(name, data) }));

/* El simulador genera las series desde «hoy»: con el reloj fijo, la muestra sale siempre igual. */
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-06T12:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

const SIN_IDENTIDAD: IdentidadDelAsesor = {};
const IDENTIDAD: IdentidadDelAsesor = { nombre: "Marta Ruiz Alonso", entidad: "Ruiz & Asociados", contacto: "marta.ruiz@ruizasociados.es" };

const idDe = (i: number) => `LU${String(1000000000 + i)}`;
const nombreDe = (i: number, largo: boolean) => (largo ? `Fondo internacional de prueba número ${i + 1} de nombre muy largo clase A acumulación cubierta EUR` : `Fondo de prueba ${i + 1}`);

/** Una propuesta de `n` posiciones a partes iguales. `larga`: nombres largos, dos acciones y datos que faltan (coste, retrocesión, indicador). */
async function entrada(n: number, larga = false): Promise<InternalReportInput> {
  const ids = Array.from({ length: n }, (_, i) => idDe(i));
  const pesoDeCada = Math.round(10000 / n) / 100;
  const positions = ids.map((asset_id, i) => ({ asset_id, weight_percent: i === 0 ? Math.round((100 - pesoDeCada * (n - 1)) * 100) / 100 : pesoDeCada }));
  const esAccion = (i: number) => larga && i >= n - 2;
  const assets = ids.map((id, i) => ({
    asset_id: id, isin: id, display_name: nombreDe(i, larga), instrument_type: esAccion(i) ? "STOCK" : "FUND", economic_asset_class: i % 3 === 1 ? "FIXED_INCOME" : "EQUITY", currency: i % 5 === 4 ? "USD" : "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], description: "", category: "RV Global", region: "Global",
    metrics: { risk_score: larga && i % 7 === 3 ? undefined : 3, risk_score_source: "SRI_KID", annualized_return_1y: 0.05, annualized_return_3y: 0.04, volatility_3y: 0.08, sharpe_3y: 0.4, metrics_method: "EXTRACTOR_MONTHLY_V2" },
    pms_exposure: i % 3 === 1 ? { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 } : { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 },
    costs: esAccion(i) || (larga && i % 6 === 5) ? undefined : { ongoing_charge: 0.01, management_fee: 0.008 },
    holdings_summary: { has_holdings: !esAccion(i), positions_count: 40, top10_weight: 35, as_of_date: "2026-08-31" }
  })) as unknown as BdbAssetDetail[];
  const report = {
    portfolio_name: larga ? "Propuesta larga de prueba" : "Propuesta de prueba", mode: "BBDD_STATIC_EXPORT_SAMPLE",
    summary: { by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }], weighted_metrics: {} },
    positions: positions.map((p, i) => ({ ...p, display_name: assets[i].display_name, instrument_type: assets[i].instrument_type, economic_asset_class: assets[i].economic_asset_class, currency: assets[i].currency, coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], pms_exposure: assets[i].pms_exposure })),
    warnings: [], xray: { by_region: [{ key: "Global", weight_percent: 100 }], by_currency: [{ key: "EUR", weight_percent: 100 }], by_category: [], by_instrument_type: [{ key: "FUND", weight_percent: 100 }], by_economic_asset_class: [{ key: "EQUITY", weight_percent: 100 }] }, data_diagnostic: {}
  } as unknown as BdbPortfolioReport;
  /* En secuencia: a la vez, el import dinámico del backend se salta el mock. */
  const h3 = await fetchPortfolioHorizon(positions, "3Y");
  const h5 = await fetchPortfolioHorizon(positions, "5Y");
  const conTipo = (h: typeof h3, tipo: number) => ({ ...h, backtest: { ...h.backtest, metrics: { ...h.backtest.metrics, rf_rate: tipo }, risk_free: { ...h.backtest.risk_free!, risk_free_rate_policy: "WINDOW_AVERAGE" as const } } });
  const retro = new Map(ids.flatMap((id, i) => (i % 3 === 0 ? [[id, { isin: id, retro_pct: 0.8, as_of_date: "2026-05-14", source: "FILE_IMPORT" } as CommercialRetroRecord] as const] : [])));
  return {
    report, assets, positions, totalCapital: 250000, benchmarkId: "equilibrado", referencia: await cargarSeriesDeReferencia(),
    horizons: { "3Y": conTipo(h3, 0.0275), "5Y": conTipo(h5, 0.0212) }, horizonErrors: {}, lookThrough: null, overlap: null,
    retro: { status: "ok", records: retro }, feasibility: null, generatedAt: "2026-11-11T12:00:00Z", includeAssetSheets: true, improvement: null
  };
}

async function generar(e: InternalReportInput, identidad: IdentidadDelAsesor, nombre?: string): Promise<Buffer> {
  const bytes = Buffer.from(await (await createInternalPortfolioReportPdfBlob(e, identidad)).arrayBuffer());
  const carpeta = process.env.INFORME_INTERNO_PDF;
  if (carpeta && nombre) {
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(path.join(carpeta, nombre), bytes);
  }
  return bytes;
}

/** El alto de cada hoja, de su MediaBox. */
const altos = (bytes: Buffer) => [...bytes.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => Number(m[2]));
const normal = (texto: string) => texto.replace(/\s+/g, " ");

describe("el informe interno, en la plantilla", () => {
  let corta: Buffer;
  let larga: Buffer;
  let sinIdentidad: Buffer;
  let entradaCorta: InternalReportInput;

  beforeAll(async () => {
    entradaCorta = await entrada(4);
    corta = await generar(entradaCorta, IDENTIDAD, "interno-corta.pdf");
    larga = await generar(await entrada(40, true), IDENTIDAD, "interno-larga.pdf");
    sinIdentidad = await generar(entradaCorta, SIN_IDENTIDAD);
  }, 180_000);

  test("ningún texto prohibido: ni marca de entidad, ni «N/D», ni «NaN», ni «undefined»", () => {
    for (const bytes of [corta, larga, sinIdentidad]) {
      const texto = extractPdfPageTexts(bytes).join("\n");
      for (const prohibido of ["Independent", "Private Bankers", "Andbank", "N/D", "NaN", "undefined", "p.p."]) expect(texto, prohibido).not.toContain(prohibido);
    }
  });

  test("el sello «USO INTERNO» en la cabecera y en el pie de todas las hojas, también las apaisadas", () => {
    for (const bytes of [corta, larga]) {
      const alturas = altos(bytes);
      /* Hay hojas apaisadas: las de las tablas anchas. */
      expect(alturas.some((alto) => alto < 600)).toBe(true);
      extractPdfTextBaselines(bytes).forEach((cadenas, i) => {
        const sellos = cadenas.filter((c) => c.texto.trim() === "USO INTERNO");
        expect(sellos.some((c) => c.y < 60), `hoja ${i + 1}: cabecera`).toBe(true);
        expect(sellos.some((c) => c.y > alturas[i] - 40), `hoja ${i + 1}: pie`).toBe(true);
      });
    }
  });

  test("«Página 1 de N» … «Página N de N», y bajo el nombre del documento, «No entregar al cliente»", () => {
    for (const bytes of [corta, larga]) {
      const hojas = extractPdfPageTexts(bytes);
      hojas.forEach((hoja, i) => {
        expect(hoja).toContain(`Página ${i + 1} de ${hojas.length}`);
        expect(hoja).toContain("Informe interno del asesor");
        expect(hoja).toContain("No entregar al cliente");
      });
    }
  });

  test("la identidad del asesor cuando la hay, en la cabecera, el pie y el autor; y sin ella, la cabecera sin membrete", () => {
    const con = extractPdfTextBaselines(corta)[0];
    /* Desde el 14-11-2026 (el aspecto de los informes de antes) la cabecera lleva la entidad arriba y, debajo, quién firma y su contacto. */
    expect(con.filter((c) => c.y < 60).map((c) => c.texto.trim())).toEqual(expect.arrayContaining(["Ruiz & Asociados", "Marta Ruiz Alonso · marta.ruiz@ruizasociados.es"]));
    expect(con.filter((c) => c.y > 800).map((c) => c.texto.trim())[0]).toBe("Ruiz & Asociados ·");
    expect(extractPdfMetadata(corta, "Author")).toBe("Marta Ruiz Alonso");
    const sin = extractPdfTextBaselines(sinIdentidad)[0];
    expect(sin.filter((c) => c.y < 60).map((c) => c.texto.trim())).toEqual(["Informe interno del asesor", "USO INTERNO", "No entregar al cliente"]);
    expect(extractPdfMetadata(sinIdentidad, "Author")).toBeNull();
  });

  test("sin portada: la primera hoja presenta, abre con las cifras a 3 años y lleva el índice", () => {
    const primera = normal(extractPdfPageTexts(corta)[0]);
    for (const dentro of ["Documento de trabajo · uso interno del asesor", "Propuesta de prueba", "Fecha de generación 11 de noviembre de 2026", "Capital declarado 250.000 €", "Rentabilidad anualizada · 3 años", "Contenido", "Resumen ejecutivo Página 2", "Cómo leer este documento"]) {
      expect(primera, dentro).toContain(dentro);
    }
  });

  test("las cifras principales son las del cálculo, con el formato común", () => {
    const m = buildInternalReportModelWithLabels(entradaCorta);
    const h3 = m.horizons.find((h) => h.window === "3Y")!.horizon.backtest.metrics;
    const h5 = m.horizons.find((h) => h.window === "5Y")!.horizon.backtest.metrics;
    const texto = normal(extractPdfPageTexts(corta).join(" "));
    const c = (cifra: string | null) => cifra!.replace(/\s/g, " ");
    /* La rentabilidad, con dos decimales y su signo; la volatilidad y la caída, con dos y sin color; en la tabla del resumen, las dos ventanas. */
    expect(texto).toContain(`Rentabilidad anualizada ${c(rentabilidad(h3.cagr))} ${c(rentabilidad(h5.cagr))}`);
    expect(texto).toContain(`Volatilidad ${c(porcentaje(h3.volatility))} ${c(porcentaje(h5.volatility))}`);
    expect(texto).toContain(`Caída máxima ${c(porcentaje(h3.max_drawdown))} ${c(porcentaje(h5.max_drawdown))}`);
    /* El peso con un decimal; el importe de la tabla, con dos; el coste anual, cifra titular, sin decimales: 4 × 25 % al 1 % de 250.000 € = 2.500 €. */
    expect(texto).toContain(`Total ${c(peso(1))} ${c(importe(250000))}`);
    expect(m.costs.annualCostEur).toBeCloseTo(2500, 8);
    expect(texto).toContain("Coste anual estimado 2.500 €");
    /* La rentabilidad activa es una diferencia entre dos porcentajes: en «pp», con su signo, en las cifras clave y frente a la referencia. */
    const activa = (w: "3Y" | "5Y") => c(puntos(m.horizons.find((h) => h.window === w)!.relative!.activeReturn));
    expect(texto).toContain(`Rentabilidad activa ${activa("3Y")} ${activa("5Y")}`);
    expect(texto.split(`Rentabilidad activa ${activa("3Y")} ${activa("5Y")}`).length - 1).toBe(2);
  });

  test("las ventanas se escriben con palabras: ni «1A», ni «3A», ni «5A»", () => {
    for (const bytes of [corta, larga]) {
      const texto = normal(extractPdfPageTexts(bytes).join(" "));
      expect(texto).not.toMatch(/\b\d+ ?A\b/);
    }
    const posiciones = normal(extractPdfPageTexts(corta).find((h) => h.includes("Sección 2 · Posiciones"))!);
    for (const rotulo of ["Rent. 1 año", "Rent. 3 años", "Rent. 5 años", "Vol. 3 años", "Sharpe 3 años", "Caída 5 años"]) expect(posiciones, rotulo).toContain(rotulo);
  });

  test("la tabla larga de posiciones repite su cabecera y no pierde ni repite filas", () => {
    const hojas = extractPdfPageTexts(larga).map(normal);
    const dePosiciones = hojas.filter((h) => h.includes("Sección 2 · Posiciones"));
    expect(dePosiciones.length).toBeGreaterThan(1);
    for (const hoja of dePosiciones) expect(hoja).toContain("Clase · tipo");
    const vistos = dePosiciones.flatMap((h) => [...h.matchAll(/LU1000000(\d{3})/g)].map((x) => Number(x[1])));
    expect(vistos).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });
});

/*
 * INF-22 e INF-28: la paginación con 3 y con 40 posiciones, y ninguna letra por debajo de 6 pt. Se mira el PDF de verdad: la línea base y
 * el cuerpo impreso de cada cadena (`extractPdfTextBaselines`, con la escala de los gráficos), contra el cuerpo de la hoja de la plantilla.
 */
describe("INF-22 e INF-28: las hojas del interno con 3 y con 40 posiciones", () => {
  let tres: Buffer;
  let cuarenta: Buffer;

  beforeAll(async () => {
    tres = await generar(await entrada(3), IDENTIDAD, "interno-3.pdf");
    cuarenta = await generar(await entrada(40, true), IDENTIDAD, "interno-40.pdf");
  }, 240_000);

  /** Lo que se imprime en el cuerpo de cada hoja: ni la cabecera ni el pie. */
  const cuerpos = (bytes: Buffer) => {
    const alturas = altos(bytes);
    return extractPdfTextBaselines(bytes).map((cadenas, i) => ({
      alto: alturas[i],
      cadenas: cadenas.filter((c) => c.texto.trim() !== "" && c.y > ARRIBA_DEL_CUERPO - 4 && c.y < alturas[i] - 30)
    }));
  };

  /** La sección de cada hoja, por el rótulo fijo de arriba («Sección 2 · Posiciones», «Anexo · fichas»); la primera no lleva. */
  const seccionDe = (cadenas: Array<{ texto: string }>) => cadenas.map((c) => c.texto.trim()).find((t) => /^(Sección \d|Anexo ·)/.test(t)) ?? "";

  /*
   * Dentro de una sección, ninguna hoja que sigue en la siguiente queda con menos de un tercio ocupado: es lo que dejaba un salto forzado o un
   * bloque entero que no cabía (INF-22). La última hoja de cada sección sí puede quedar corta, porque cada sección abre hoja a propósito,
   * con su rótulo fijo arriba; con estas muestras quedan así (medido el 14-11-2026, y dicho en el cierre del bloque): con 3 posiciones, la
   * cola del resumen (los puntos a revisar, 23 %), 4.1 sin subyacentes (19 %) y 8.1 sin frontera (14 %); con 40, 4.1 y 8.1 igual.
   */
  test("dentro de una sección, ninguna hoja queda con menos de un tercio de su alto ocupado", () => {
    for (const [cuantas, bytes] of [[3, tres], [40, cuarenta]] as const) {
      const hojas = cuerpos(bytes);
      hojas.slice(0, -1).forEach(({ alto, cadenas }, i) => {
        if (seccionDe(hojas[i + 1].cadenas) !== seccionDe(cadenas)) return;
        const hasta = Math.max(...cadenas.map((c) => c.y));
        const ocupado = (hasta - ARRIBA_DEL_CUERPO) / (alto - ABAJO_DEL_CUERPO - ARRIBA_DEL_CUERPO);
        expect(ocupado, `${cuantas} posiciones, hoja ${i + 1} de ${hojas.length} (${seccionDe(cadenas)})`).toBeGreaterThanOrEqual(1 / 3);
      });
    }
  });

  test("la matriz de 40 posiciones no deja sus parejas solas en una hoja: van con la lectura, antes de la matriz", () => {
    const hojas = extractPdfPageTexts(cuarenta).map(normal);
    const conParejas = hojas.findIndex((h) => h.includes("Las diez parejas más correlacionadas"));
    const conMatriz = hojas.findIndex((h) => h.includes("Matriz de correlación ·"));
    expect(conParejas).toBeGreaterThanOrEqual(0);
    /* «diversifican» sin su «fi»: el lector de texto pierde la ligadura. */
    expect(hojas[conParejas]).toMatch(/Pares que más diversi(fi)?can/);
    expect(conParejas).toBeLessThanOrEqual(conMatriz);
  });

  test("ningún bloque se sale de su hoja ni deja su título solo al pie", () => {
    for (const [cuantas, bytes] of [[3, tres], [40, cuarenta]] as const) {
      cuerpos(bytes).forEach(({ alto, cadenas }, i) => {
        /* Un bloque entero más alto que la hoja se dibuja por debajo del cuerpo, encima del pie: ahí no puede haber nada. */
        const fuera = cadenas.filter((c) => c.y > alto - ABAJO_DEL_CUERPO + 4);
        expect(fuera.map((c) => c.texto), `${cuantas} posiciones, hoja ${i + 1}`).toEqual([]);
        /* Lo último del cuerpo no es un título (los títulos van de 10,5 pt arriba): un título solo al pie es un bloque partido. */
        const ultima = cadenas.reduce((baja, c) => (c.y > baja.y ? c : baja), cadenas[0]);
        expect(ultima.puntos, `${cuantas} posiciones, hoja ${i + 1}: «${ultima.texto}»`).toBeLessThan(10.5);
      });
    }
  });

  test("INF-28: con 40 posiciones ninguna letra del papel baja de 6 pt, y bajo la matriz van las diez parejas", () => {
    const pequenas = extractPdfTextBaselines(cuarenta).flatMap((cadenas, i) => cadenas.filter((c) => c.texto.trim() !== "" && c.puntos < 6 - 1e-6).map((c) => `hoja ${i + 1}: «${c.texto}» a ${c.puntos.toFixed(2)} pt`));
    expect(pequenas).toEqual([]);
    const texto = normal(extractPdfPageTexts(cuarenta).join(" "));
    expect(texto).toContain("Las diez parejas más correlacionadas");
    expect(texto).toContain("Con borde y sin tono: falta el dato.");
    /* Con tres, la matriz lleva su cifra en cada casilla, y no hace falta la tabla. */
    expect(normal(extractPdfPageTexts(tres).join(" "))).not.toContain("Las diez parejas más correlacionadas");
    expect(extractPdfTextBaselines(tres).flat().filter((c) => c.texto.trim() !== "" && c.puntos < 6 - 1e-6)).toEqual([]);
  });

  test("el vocabulario: «Por producto» para fondo, ETF o acción, y «Coste corriente medio», sin «ponderado»", () => {
    const texto = normal(extractPdfPageTexts(tres).join(" "));
    expect(texto).toContain("Por producto");
    expect(texto).not.toContain("Tipo de activo");
    expect(texto).toContain("Coste corriente medio");
    expect(texto).not.toMatch(/Coste corriente (medio )?ponderado|medio ponderado/);
  });

  test("INF-28: la disposición de la matriz, a mano", () => {
    /* 40 posiciones en 511 pt: columna de nombres de 132 y casillas de (511 − 132 − 4) / 40 = 9,375 pt; nombres a 6 y sin cifra. */
    expect(disposicionDeLaMatriz(40, 511, [["0,50"]])).toEqual({ labelW: 132, cell: 9.375, letraDelNombre: 6, conCifras: false });
    /* 16 posiciones: casillas de (511 − 168 − 4) / 16 = 21,1875; «−0,25» a 6 pt mide 5 × 6 × 0,56 = 16,8 y cabe. */
    expect(disposicionDeLaMatriz(16, 511, [["−0,25"]])).toEqual({ labelW: 168, cell: 21.1875, letraDelNombre: 6.2, conCifras: true });
    /* El solapamiento escribe «al menos»: 8 × 6 × 0,56 = 26,88 pt, que cabe en la casilla de 30 con 11 fondos y no con 13. */
    expect(disposicionDeLaMatriz(11, 511, [["al menos", "3,2"]], 30).conCifras).toBe(true);
    expect(disposicionDeLaMatriz(13, 511, [["al menos", "3,2"]], 30).conCifras).toBe(false);
    expect(LETRA_MINIMA_DEL_PAPEL).toBe(6);
  });
});

describe("INF-19, segunda parte: el cono en euros, sobre el capital medido", () => {
  test("el capital del cono: capital × cobertura; con todo medido, el declarado; sin cobertura ni capital, ninguno", () => {
    /* A mano: 250.000 × 0,85 = 212.500. */
    expect(capitalDelCono(250000, 85)).toEqual({ base: 212500, sobreTodo: false });
    expect(capitalDelCono(250000, 100)).toEqual({ base: 250000, sobreTodo: true });
    expect(capitalDelCono(250000, 99.96)?.sobreTodo).toBe(true);
    expect(capitalDelCono(250000, 120)).toEqual({ base: 250000, sobreTodo: true });
    for (const cobertura of [undefined, null, Number.NaN, 0, -5]) expect(capitalDelCono(250000, cobertura)).toBeNull();
    expect(capitalDelCono(null, 85)).toBeNull();
    expect(capitalDelCono(0, 85)).toBeNull();
  });

  test("en el papel: con el 85 % medido, el percentil 50 a 3 años es el del capital medido, y lo dice", async () => {
    const e = await entrada(4);
    const conCobertura = (h: NonNullable<InternalReportInput["horizons"]["3Y"]>) => ({ ...h, coverageWeightPercent: 85 });
    const texto = normal(extractPdfPageTexts(await generar({ ...e, horizons: { "3Y": conCobertura(e.horizons["3Y"]!), "5Y": conCobertura(e.horizons["5Y"]!) } }, SIN_IDENTIDAD)).join(" "));
    /* A mano: 212.500 × 1,0275³ = 212.500 × 1,084789546875 = 230.517,78 €. Antes, sobre todo el capital: 250.000 × 1,084789546875 = 271.197 €. */
    expect(texto).toContain("Cono estadístico del capital medido a 3 años");
    expect(texto).toContain("Percentil 50: 230.518 €");
    expect(texto).not.toContain("271.197");
    expect(texto).toContain("En euros, sobre el capital medido: el 85,0 % del capital declarado, la parte que mide la serie.");
    /* El VaR sigue la misma regla, y ya lo hacía. */
    expect(texto).toMatch(/sobre el 85,0 % medido del capital/);
  }, 60_000);

  test("con todo medido, sobre el capital declarado, como antes: 250.000 × 1,0275³ = 271.197 €", async () => {
    const texto = normal(extractPdfPageTexts(await generar(await entrada(4), SIN_IDENTIDAD)).join(" "));
    expect(texto).toContain("Cono estadístico del capital declarado a 3 años");
    expect(texto).toContain("Percentil 50: 271.197 €");
    expect(texto).not.toContain("capital medido");
  }, 60_000);
});

describe("FMT-19: el día en que se calculó la propuesta, en el calendario local", () => {
  test("a las 00:30 de Madrid es ya el día siguiente al de Greenwich", () => {
    const instante = "2026-11-12T23:30:00Z";
    expect(instante.slice(0, 10)).toBe("2026-11-12");
    expect(diaDeLaPropuesta(instante, "Europe/Madrid")).toBe("2026-11-13");
    expect(diaDeLaPropuesta("2026-11-12T10:00:00Z", "Europe/Madrid")).toBe("2026-11-12");
    expect(diaDeLaPropuesta(null)).toBeNull();
  });
});
