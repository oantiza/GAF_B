/**
 * La comparativa de carteras en seis hojas (decisión de Óscar del 10-11-2026, «Sí, con las cinco»). Se monta la entrada por la misma función
 * que las dos puertas (`entradaDeLaComparativa`) y se lee el TEXTO del PDF: costes de cada cartera y de cada fondo; la renta variable por
 * región de dentro de los fondos; las diferencias en frases; sin Calmar; y los cambios menores.
 *
 * Con `BDB_WRITE_PDF_PREVIEW=true` deja en `output/pdf/` los papeles de muestra para mirarlos en imagen.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { entradaDeLaComparativa } from "../src/core/entradaDeComparativa";
import { alignPortfolioComparison, type ComparisonHistory } from "../src/core/portfolioComparison";
import { costesEnFrases, createComparisonPdfBlob, diferenciasEnFrases, filasDeRentaVariable, seriesDeLaEvolucion } from "../src/reports/comparePdf";
import { estiloDeLasSeries, TRAZO_DE_LA_REFERENCIA, TRAZO_LARGO } from "../src/reports/plantilla/graficos";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import { comparisonFixture } from "./support/portfolioComparisonFixtures";
import { extractPdfPageTexts, lineasCon, lineasHuerfanasDeImpuestos } from "./support/pdfText";

/* ---------- Un catálogo de prueba: fondos, ETF y acciones con nombres del largo de los reales, quince categorías y su reparto por región. ---------- */
const CATEGORIAS = [
  "RV Global Cap. Grande Blend", "RV Europa Cap. Grande Blend", "RV Global Cap. Grande Growth", "RV Global Cap. Pequeña y Mediana", "RF Global",
  "RF Bonos Corporativos EUR", "Mixtos Flexibles EUR", "RV Sector Infraestructuras", "RV Sector Ecología", "Monetarios EUR",
  "RV EEUU Cap. Grande Blend", "RV Japón Cap. Grande", "RV Asia-Pacífico sin Japón", "RF Deuda Pública EUR", "RV Sector Salud",
  "RV Latinoamérica y mercados emergentes"
];
const NOMBRES = [
  "Neuberger Next Generation Connectivity Fund EUR A Accumulating Class - Unhedged", "Vanguard Global Stock Index Fund EUR Acc",
  "iShares Core MSCI World UCITS ETF USD (Acc)", "Fidelity Funds - Global Dividend Fund A-Acc-EUR", "Robeco Global Credits DH EUR",
  "Pictet - Water P EUR", "JPMorgan Funds - Global Bond Opportunities A (acc) EUR", "Carmignac Portfolio Patrimoine A EUR Acc",
  "Amundi Funds Euro Corporate Bond A EUR", "DWS Invest Global Infrastructure LC", "Amundi Euro Liquidity Short Term SRI",
  "Vanguard U.S. 500 Stock Index Fund EUR Acc", "Nomura Funds Ireland - Japan Strategic Value I EUR", "Schroder ISF Asian Opportunities A Acc EUR",
  "Lyxor Euro Government Bond UCITS ETF", "Bellevue Funds (Lux) - BB Adamant Medtech & Services B EUR"
];
const REGIONES: Array<Record<string, number>> = [
  { united_states: 62, eurozone: 18, japan: 8, asia_developed: 12 }, { eurozone: 70, united_kingdom: 20, europe_ex_euro: 10 },
  { united_states: 70, eurozone: 15, japan: 6, asia_emerging: 9 }, { latin_america: 55, united_states: 45 }
];

function ficha(i: number, accion = false): BdbAssetDetail {
  const renta = i % 5 === 4 || i % 5 === 8 ? "FIXED_INCOME" : i % 10 === 10 ? "MONEY_MARKET" : "EQUITY";
  return {
    asset_id: accion ? `ES${String(100000000 + i).padStart(10, "0")}` : `LU${String(900000000 + i).padStart(10, "0")}`,
    display_name: accion ? `Acción española ${i} S.A.` : NOMBRES[i % NOMBRES.length] + (i >= NOMBRES.length ? ` ${i}` : ""),
    instrument_type: accion ? "STOCK" : i % 4 === 2 ? "ETF" : "FUND",
    economic_asset_class: accion ? "EQUITY" : renta,
    category: accion ? undefined : CATEGORIAS[i % CATEGORIAS.length],
    region: "Global",
    currency: i % 3 === 2 ? "USD" : "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}, description: "",
    pms_exposure: accion || renta === "EQUITY" ? { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } : { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 },
    exposure_detail: accion ? undefined : { equity_regions: REGIONES[i % REGIONES.length] },
    costs: accion ? {} : { ongoing_charge: [0.0085, 0.0012, 0.0045, 0.0162, 0.002][i % 5] }
  } as unknown as BdbAssetDetail;
}

interface Lado { fichas: BdbAssetDetail[]; fuera?: number; capital?: number; sinCoste?: number }

function lado(indices: number[], opciones: { acciones?: number[] } = {}): BdbAssetDetail[] {
  return indices.map((i) => ficha(i, opciones.acciones?.includes(i)));
}

function cartera(nombre: string, l: Lado) {
  const total = (l.fichas.length * (l.fichas.length + 1)) / 2;
  const positions: BdbManualPortfolioPosition[] = l.fichas.map((f, i) => ({ asset_id: f.asset_id, weight_percent: ((l.fichas.length - i) / total) * 100 }));
  return { name: nombre, positions, total_capital: l.capital };
}

function historia(id: "A" | "B", l: Lado): ComparisonHistory {
  const h = comparisonFixture("3Y", id);
  const ids = l.fichas.map((f) => f.asset_id);
  const medidos = ids.slice(0, ids.length - (l.fuera ?? 0));
  h.backtest.asset_ids = medidos;
  h.backtest.excluded_assets = ids.slice(medidos.length).map((asset_id, i) => ({ asset_id, reason: i % 2 ? "QUALITY_BLOCKED" : "INSUFFICIENT_HISTORY" }));
  return h;
}

function entrada(la: Lado, lb: Lado, identidad?: Parameters<typeof entradaDeLaComparativa>[0]["identidad"]) {
  const sinCoste = (l: Lado) => l.fichas.map((f, i) => (i < (l.sinCoste ?? 0) && f.instrument_type !== "STOCK" ? { ...f, costs: {} } : f));
  /* La ficha es la misma en las dos carteras; la de A, la última, manda: es la que estas pruebas dejan sin coste. */
  const assets = [...new Map([...sinCoste(lb), ...sinCoste(la)].map((f) => [f.asset_id, f])).values()];
  const ha = historia("A", la), hb = historia("B", lb);
  return entradaDeLaComparativa({
    a: cartera("Cartera Equilibrada de la familia", la),
    b: cartera("Propuesta de crecimiento", lb),
    cargada: { period: "3Y", a: ha, b: hb, result: alignPortfolioComparison(ha, hb, "3Y") },
    assets,
    identidad
  });
}

const plano = (texto: string) => texto.replace(/\s+/g, " ").replace(/fi/g, "");

/* Desde la plantilla única (14-11-2026) cada sección se reconoce por su número y su título («03 Dónde se separan las carteras»); antes, por su
   antetítulo en versales («03 · COMPOSICIÓN»). Y la tabla larga ya no abre hojas de «continuación»: repite su cabecera. */
const EVOLUCION = "01 Rentabilidad y evolución";
const RIESGO = "02 Qué riesgo acompaña al resultado";
const COMPOSICION = "Dónde se separan las carteras";
const POSICIONES = "04 Qué cambia en cada posición";
const METODO = "05 Qué se mide de cada cartera y cómo";
/* La cabecera de la tabla de posiciones, que sale en cada hoja que tiene filas suyas (sin la «fi» de «identificador»). */
const CABECERA_DE_POSICIONES = "Activo / identicador";

async function hojas(input: Parameters<typeof createComparisonPdfBlob>[0], guardarComo?: string): Promise<string[]> {
  const bytes = Buffer.from(await (await createComparisonPdfBlob(input)).arrayBuffer());
  if (guardarComo && process.env.BDB_WRITE_PDF_PREVIEW === "true") {
    fs.mkdirSync(path.resolve("output/pdf"), { recursive: true });
    fs.writeFileSync(path.resolve("output/pdf", `comparativa-${guardarComo}.pdf`), bytes);
  }
  return extractPdfPageTexts(bytes).map(plano);
}

const OCHO = lado([0, 1, 2, 3, 4, 5, 6, 7]);

describe("un fondo sin reparto de activos no entra en la renta variable por región (A-211, con el sí de Óscar)", () => {
  /* La primera de A, de bolsa, sin reparto: pesa 8 / 36 = 22,2 % de A. Ni su renta variable ni sus regiones entran, y se dice. */
  const SIN_REPARTO = { equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "NOT_AVAILABLE" };
  const conUnoSinReparto = () => [{ ...OCHO[0], pms_exposure: SIN_REPARTO } as unknown as BdbAssetDetail, ...OCHO.slice(1)];

  test("la entrada lo deja fuera y lleva su peso", () => {
    const input = entrada({ fichas: conUnoSinReparto() }, { fichas: DIEZ });
    expect(input.rentaVariable!.a.sinRepartoPct).toBeCloseTo((8 / 36) * 100, 10);
    expect(input.rentaVariable!.b.sinRepartoPct).toBeUndefined();
  });

  test("el papel lo dice de A, y de B no dice nada", async () => {
    const texto = (await hojas(entrada({ fichas: conUnoSinReparto() }, { fichas: DIEZ }))).join(" ");
    expect(texto).toContain("Falta el dato: el 22,2 % de A no declara su reparto de activos, y no se sabe qué parte es renta variable; no entra en este reparto.");
    expect(texto).not.toContain("% de B no declara su reparto de activos");
  }, 30_000);
});
const DIEZ = lado([1, 2, 3, 8, 9, 10, 11, 12, 13, 14]);
/* El caso real del 10-11-2026: A con 8 y B con 10, ninguna en común (18 filas, tres con el nombre en dos líneas), 16 categorías (cuatro en
   dos líneas), 5 regiones, 2 divisas, sin capital y una posición fuera del cálculo en cada cartera. */
const OCHO_REAL = lado([0, 1, 2, 3, 4, 5, 6, 7]);
const DIEZ_REAL = lado([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);

describe("el caso real: 8 contra 10 sin nada en común, 16 categorías y una fuera en cada una", () => {
  /* Con la plantilla las 18 filas caben en la hoja de posiciones, y el método, que ya no cabe debajo, va en la suya: siguen siendo seis hojas. */
  test("seis hojas: la composición en una, las posiciones en otra y el método en la suya, sin tabla ni anexo repetidos", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO_REAL, fuera: 1 }, { fichas: DIEZ_REAL, fuera: 1 }), "real-8-y-10");
    expect(paginas).toHaveLength(6);
    expect(paginas.filter((p) => p.includes(`03 ${COMPOSICION}`))).toHaveLength(1);
    const composicion = paginas[3];
    for (const bloque of ["Por categoría", "Renta variable por región", "Divisa de los activos", "Concentración y coincidencias", "Latinoamérica"]) expect(composicion).toContain(bloque);
    expect(paginas[4]).toContain(POSICIONES);
    expect(paginas.join(" ")).not.toContain("continuación");
    expect(paginas[5]).toContain(METODO);
    /* La nota nombra la única de cada una que queda fuera: ni la tabla de la parte medida ni un anexo que la repita. */
    expect(paginas[5]).toMatch(/A · Mide el [\d,]+ % de la cartera \(7 de 8 posiciones\); queda fuera .+ por no tener historia suciente en este periodo\./);
    expect(paginas.join(" ")).not.toMatch(/PARTE MEDIDA|Peso de la cartera que se mide|Anexo · Qué queda fuera/);
  }, 30_000);

  test("la hoja de composición nunca se parte: su nota de origen está en el método, y una columna que no quepa pasa entera", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO_REAL, fuera: 1 }, { fichas: DIEZ_REAL, fuera: 1 }));
    const composicion = paginas.filter((p) => p.includes(COMPOSICION));
    expect(composicion).toHaveLength(1);
    /* Las tres notas de la columna derecha, con su largo real. */
    expect(composicion[0]).toMatch(/El reparto de la parte de renta variable de cada cartera, mirando dentro de los fondos\. La renta variable pesa el [\d,]+ % de A y el [\d,]+ % de B\./);
    expect(composicion[0]).toContain("La divisa de la cha no es la exposición cambiaria de dentro ni informa de sus coberturas. El histórico va en euros.");
    expect(composicion[0]).toMatch(/Peso coincidente: [\d,]+ % \(0 posiciones compartidas\)\. Cambio de asignación: el [\d,]+ % del capital se redistribuye\./);
    expect(composicion[0]).not.toContain("identicador de activo");
    expect(paginas.find((p) => p.includes(METODO))).toContain("coincidencia, por identicador de activo y no por lo que hay dentro.");
    /* Las dieciséis categorías en dos líneas y seis divisas: sigue en una hoja. */
    const conLargo = (largo: string) => (fichas: BdbAssetDetail[], desde: number) => fichas.map((f, i) => ({ ...f, category: `${largo} ${desde + i}`, currency: ["EUR", "USD", "GBP", "CHF", "JPY", "SEK"][i % 6] }));
    const dosLineas = conLargo("Categoría del proveedor de nombre largo");
    /*
     * Desde la plantilla única (14-11-2026) las filas de sus tablas son más altas, y con dieciséis categorías en dos líneas la de categorías ya
     * no cabe en la hoja: sigue en la siguiente con la cabecera de su tabla repetida y sin partir una fila. Antes la columna pasaba entera a otra
     * hoja, y con estas filas dejaba la de composición casi vacía. Lo que se afirma: o cabe, o la hoja siguiente sigue con una tabla de la
     * composición (su cabecera o su título), nunca con una nota suelta.
     */
    const dos = await hojas(entrada({ fichas: dosLineas(OCHO_REAL, 0) }, { fichas: dosLineas(DIEZ_REAL, 8) }), "composicion-dos-lineas");
    const tresLineas = conLargo("Categoría del proveedor con un nombre muy largo que ocupa tres líneas");
    const apretada = await hojas(entrada({ fichas: tresLineas(OCHO_REAL, 0) }, { fichas: tresLineas(DIEZ_REAL, 8) }), "composicion-apretada");
    for (const caso of [dos, apretada]) {
      const siguiente = caso[caso.findIndex((p) => p.includes(COMPOSICION)) + 1];
      if (!siguiente.includes(POSICIONES)) expect(siguiente).toMatch(/Categoría A B B − A|Región A B B − A|Divisa A B B − A|Concentración y coincidencias/);
    }
  }, 30_000);

  test("8 contra 4 (11 filas): el método no cabe debajo de once filas y va en su hoja", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO_REAL, fuera: 1 }, { fichas: lado([20, 21, 22, 23]) }), "8-y-4");
    expect(paginas).toHaveLength(6);
    expect(paginas[4]).toContain(POSICIONES);
    expect(paginas[4]).not.toContain(METODO);
    expect(paginas[5]).toContain(METODO);
  }, 30_000);

  test("nueve fuera del cálculo: la nota las cuenta y el anexo las nombra", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO_REAL, fuera: 4 }, { fichas: DIEZ_REAL, fuera: 5 }), "nueve-fuera");
    const todo = paginas.join(" ");
    expect(todo).toContain("detalladas en el anexo");
    expect(todo).toContain("Anexo · Qué queda fuera de cada cartera");
    expect(todo.match(/Anexo · Qué queda fuera de cada cartera/g)).toHaveLength(1);
  }, 30_000);
});

describe("las seis hojas", () => {
  test("8 y 10 posiciones, sin capital: seis hojas, cada una con lo suyo", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ }), "8-y-10");
    /* Quince posiciones entre las dos caben en una hoja y el método va en la suya, o seguido si cabe: seis hojas como mucho. */
    expect(paginas.length).toBeLessThanOrEqual(6);
    expect(paginas[1]).toContain(EVOLUCION);
    expect(paginas[2]).toContain(RIESGO);
    expect(paginas[3]).toContain(`03 ${COMPOSICION}`);
    expect(paginas[3]).toContain("Concentración y coincidencias");
    expect(paginas[4]).toContain(POSICIONES);
    expect(paginas[5]).toContain(METODO);
    /* Con todo medido no hay nada fuera: sin anexo, y la nota de lo que se mide no se repite. */
    expect(paginas[5]).not.toContain("Anexo · Qué queda fuera de cada cartera");
    paginas.forEach((pagina, i) => expect(pagina).toContain(`Página ${i + 1} de ${paginas.length}`));
  }, 30_000);

  test("las demás combinaciones salen en las hojas que tocan", async () => {
    expect(await hojas(entrada({ fichas: OCHO, capital: 250_000 }, { fichas: DIEZ, capital: 400_000 }), "con-capital")).toHaveLength(6);
    /* A por debajo del 80 %: se queda, sin sus cifras; las dos por debajo: sin evolución ni riesgo, como siempre (decisiones 59 y 104). */
    const unaFalta = await hojas(entrada({ fichas: OCHO, fuera: 4 }, { fichas: DIEZ }), "a-por-debajo");
    expect(unaFalta).toHaveLength(6);
    const lasDos = await hojas(entrada({ fichas: OCHO, fuera: 4 }, { fichas: DIEZ, fuera: 5 }), "las-dos-por-debajo");
    /* Portada, composición, y posiciones y método con su anexo, seguidos o en dos hojas. */
    expect(lasDos.length).toBeLessThanOrEqual(4);
    expect(lasDos.join(" ")).toContain("Anexo · Qué queda fuera de cada cartera");
    expect(lasDos.join(" ")).not.toContain("Qué riesgo acompaña al resultado");
    expect(lasDos[1]).toContain(`01 ${COMPOSICION}`);
    expect(await hojas(entrada({ fichas: lado([20], { acciones: [20] }) }, { fichas: DIEZ }), "una-accion")).toHaveLength(6);
    const treinta = await hojas(entrada({ fichas: lado(Array.from({ length: 15 }, (_, i) => i)) }, { fichas: lado(Array.from({ length: 15 }, (_, i) => i + 15)) }), "30-posiciones");
    /* Treinta posiciones distintas: la tabla de posiciones sigue en otra hoja, con su cabecera repetida. */
    expect(treinta.filter((p) => p.includes(CABECERA_DE_POSICIONES))).toHaveLength(2);
    /* Con la cola de catorce filas no cabe el método debajo: va en su hoja. */
    expect(treinta).toHaveLength(7);
    await hojas(entrada({ fichas: lado(Array.from({ length: 15 }, (_, i) => i)) }, { fichas: DIEZ }), "15-categorias");
    await hojas(entrada({ fichas: OCHO, sinCoste: 2 }, { fichas: DIEZ }), "costes-incompletos");
  }, 90_000);
});

describe("1 · los costes", () => {
  test("en la portada, la media de cada cartera y su diferencia; en las posiciones, el de cada fondo", async () => {
    const input = entrada({ fichas: OCHO }, { fichas: DIEZ });
    const paginas = await hojas(input);
    const portada = paginas[0];
    expect(portada).toContain("Coste corriente de cada cartera");
    expect(portada).toMatch(/A · \d,\d\d % al año, unos \d+ € por cada 10\.000 €\./);
    /* En «pp», como toda diferencia entre dos porcentajes (14-11-2026; antes, «puntos»). */
    expect(portada).toMatch(/B cuesta \d,\d\d pp (más|menos) al año que A\./);
    expect(portada).toContain("No incluye: custodia, intermediación");
    const posiciones = paginas.find((p) => p.includes(POSICIONES))!;
    expect(posiciones).toContain("Coste corriente");
    expect(posiciones).toContain("0,85 %");
    expect(posiciones).toContain("1,62 %");
    const metodo = paginas.find((p) => p.includes(METODO))!;
    expect(metodo).toContain("Las cifras de rentabilidad son netas de los gastos de los fondos y antes de asesoramiento e impuestos.");
    expect(paginas.join(" ")).not.toContain("No se han estimado costes");
  }, 30_000);

  test("si de una no hay media, se dice de esa y no hay diferencia; una acción dice «No aplica»", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO, sinCoste: 2 }, { fichas: lado([20, 15], { acciones: [20] }) }));
    expect(paginas[0]).toContain("A · falta el dato. Falta el coste de 2 de las 8 posiciones, y sin él no se da una media.");
    expect(paginas[0]).toContain("Sin la media de A no se da una diferencia.");
    expect(paginas[0]).not.toMatch(/B cuesta/);
    expect(paginas.find((p) => p.includes(POSICIONES))).toContain("No aplica");
    expect(costesEnFrases(undefined).diferencia).toBe("Sin la media de ninguna de las dos no se da una diferencia.");
  }, 30_000);
});

describe("2 · la renta variable por región, la del informe de cliente", () => {
  test("de dentro de los fondos, con los nombres del informe de cliente y cuánto pesa la renta variable; ya no la región de la ficha", async () => {
    const input = entrada({ fichas: OCHO }, { fichas: DIEZ });
    const hoja = (await hojas(input)).find((p) => p.includes(`03 ${COMPOSICION}`))!;
    expect(hoja).toContain("Renta variable por región");
    expect(hoja).toMatch(/La renta variable pesa el \d+,\d % de A y el \d+,\d % de B\./);
    for (const zona of ["Norteamérica", "Europa", "Japón"]) expect(hoja).toContain(zona);
    /* La tabla de regiones ya no lleva la «Global» de la ficha: la palabra solo sale en las categorías. */
    const regiones = hoja.slice(hoja.indexOf("Renta variable por región"), hoja.indexOf("Divisa de los activos"));
    expect(regiones).not.toContain("Global");
    expect(hoja).not.toContain("Por región");
  }, 30_000);

  test("una cartera sin renta variable dice «No aplica»; lo que no declara región, «No declarado»", () => {
    const filas = filasDeRentaVariable({ a: { filas: [], pesoPct: 0 }, b: { filas: [{ key: "united_states", weight_percent: 60 }], pesoPct: 50 } });
    expect(filas).toEqual([{ label: "Norteamérica", a: null, b: 60 }, { label: "No declarado", a: null, b: 40 }]);
  });
});

/* Desde el 14-11-2026 una diferencia entre dos porcentajes va en «pp» y con dos decimales en todas partes, también en la frase (sin el signo,
   que lo dicen «más» y «menos»), y la caída es «caída máxima» (INF-18). Antes, «puntos» con un decimal y «mayor caída» (10-11-2026). */
describe("3 · las diferencias de la portada, en frases, en pp y con dos decimales", () => {
  test("las variantes: más, menos, lo mismo, más y menos honda", () => {
    expect(diferenciasEnFrases({ ret: 0.05, vol: 0.08, maxdd: -0.10 }, { ret: 0.132, vol: 0.136, maxdd: -0.177 }))
      .toBe("B rindió 8,20\u00a0puntos porcentuales (pp) más al año que A, osciló 5,60\u00a0pp más y su caída máxima fue 7,70\u00a0pp más honda.");
    expect(diferenciasEnFrases({ ret: 0.08, vol: 0.10, maxdd: -0.2 }, { ret: 0.06, vol: 0.07, maxdd: -0.15 }))
      .toBe("B rindió 2,00\u00a0puntos porcentuales (pp) menos al año que A, osciló 3,00\u00a0pp menos y su caída máxima fue 5,00\u00a0pp menos honda.");
    /* Con dos decimales, 0,04 pp ya no es «lo mismo»; 0,004 pp sí, porque redondea a 0,00. */
    expect(diferenciasEnFrases({ ret: 0.08, vol: 0.1, maxdd: -0.2 }, { ret: 0.0804, vol: 0.1, maxdd: -0.2 }))
      .toBe("B rindió 0,04\u00a0puntos porcentuales (pp) más al año que A, osciló lo mismo y su caída máxima fue igual de honda.");
    expect(diferenciasEnFrases({ ret: 0.08, vol: 0.1, maxdd: -0.2 }, { ret: 0.08004, vol: 0.10004, maxdd: -0.20004 }))
      .toBe("B rindió lo mismo al año que A, osciló lo mismo y su caída máxima fue igual de honda.");
    expect(diferenciasEnFrases({ ret: 0.08 }, { ret: 0.09 })).toBeNull();
  });

  test("la frase y la tabla de riesgo escriben la misma cifra igual, y el papel no dice «mayor caída» ni «Máxima caída»", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ }));
    /* La primera vez la unidad va escrita entera, con su abreviatura: es un documento para el cliente. */
    const frase = /B rindió (\d+,\d\d) puntos porcentuales \(pp\) (más|menos) al año que A/.exec(paginas[0]);
    expect(frase).not.toBeNull();
    const riesgo = paginas.find((p) => p.includes(RIESGO))!;
    /* En la tabla, con su signo: «+1,74 pp» si «más», «−1,74 pp» si «menos». */
    expect(riesgo).toContain(`${frase![2] === "más" ? "+" : "−"}${frase![1]} pp`);
    expect(paginas.join(" ")).not.toMatch(/mayor caída|Máxima caída|máxima caída fue|\d puntos (más|menos)/);
  }, 30_000);

  test("en papel, la frase y no las tres cifras con signo; la lectura no la repite", async () => {
    const portada = (await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ })))[0];
    expect(portada).toMatch(/B rindió \d+,\d\d puntos porcentuales \(pp\) (más|menos) al año que A, osciló/);
    expect(portada).not.toMatch(/Diferencia de rentabilidad anualizada|Positivo: B sufrió|Menor cifra: menos oscilación/);
    expect(portada.match(/rindió/g)).toHaveLength(1);
  }, 30_000);
});

describe("las métricas, nunca en la portada (Óscar, 15-11-2026)", () => {
  test("la primera hoja no lleva tarjetas de cifras: la rentabilidad anualizada y la volatilidad de cada cartera van en la hoja de riesgo", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ }));
    /* La primera hoja presenta y dice las diferencias en una frase, sin los rótulos de las cuatro tarjetas. */
    expect(paginas[0]).toContain("Las diferencias, de un vistazo");
    expect(paginas[0]).not.toMatch(/[AB] · Rentabilidad anualizada|[AB] · Volatilidad/);
    /* Las cifras no se pierden: siguen en la tabla de «Qué riesgo acompaña al resultado». */
    const riesgo = paginas.find((pagina) => pagina.includes("Qué riesgo acompaña al resultado"))!;
    expect(riesgo).toBeDefined();
    expect(riesgo).toContain("Rentabilidad anualizada");
    expect(riesgo).toContain("Volatilidad");
    expect(paginas.indexOf(riesgo)).toBeGreaterThan(0);
  }, 30_000);
});

describe("lo visto en el papel el 14-11-2026: los nombres, el orden de las columnas y el trazo de B", () => {
  test("en la portada, «Propuesta A» y «Propuesta B», como en la pantalla; «Cartera» se queda donde describe lo de dentro", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ }));
    expect(paginas[0]).toContain("Propuesta A Cartera Equilibrada de la familia");
    expect(paginas[0]).toContain("Propuesta B Propuesta de crecimiento");
    expect(paginas[0]).not.toMatch(/Cartera A |Cartera B /);
  }, 30_000);

  test("las tablas, en el orden común: A · B · Diferencia", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ }));
    const todo = paginas.join(" ");
    for (const cabecera of ["Métrica del periodo A B B − A", "Año / fechas efectivas A B B − A", "Categoría A B B − A", "Indicador A B B − A", "Peso A Peso B B − A Coste corriente"]) {
      expect(todo, cabecera).toContain(cabecera);
    }
  }, 30_000);

  test("INF-18: la entrada rotula la caída «Caída máxima», nunca «Máxima caída»", () => {
    expect(entrada({ fichas: OCHO }, { fichas: DIEZ }).maxddLabel).toMatch(/^Caída máxima · /);
  });

  test("INF-09: B va a trazos largos en el gráfico y en su leyenda; A, continua", () => {
    const punto = (date: string, value: number) => ({ date, value });
    const { series } = seriesDeLaEvolucion([punto("2026-01-02", 100), punto("2026-01-09", 101)], [punto("2026-01-02", 100), punto("2026-01-09", 99)]);
    expect(series.map((serie) => serie.aTrazosLargos ?? false)).toEqual([false, true]);
    const [a, b] = estiloDeLasSeries(series);
    expect(a.trazo).toBeUndefined();
    expect(b.trazo).toBe(TRAZO_LARGO);
    /* Distinto del de la referencia, que va a trazos cortos: tres trazos que se leen en gris. */
    expect(TRAZO_LARGO).not.toBe(TRAZO_DE_LA_REFERENCIA);
    expect(a.color).not.toBe(b.color);
  });
});

describe("4 · sin el ratio de Calmar", () => {
  test("ni en la tabla de riesgo ni en el método", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ }));
    expect(paginas.join(" ")).not.toContain("Calmar");
    const riesgo = paginas.find((p) => p.includes("Qué riesgo acompaña"))!;
    for (const cifra of ["Rentabilidad anualizada", "Volatilidad", "Sharpe", "Caída máxima del periodo"]) expect(riesgo).toContain(cifra);
  }, 30_000);
});

describe("5 · los cambios menores", () => {
  /* Desde la plantilla única (14-11-2026) los puntos salen del módulo común de formato, con dos decimales en todo el documento (`puntos`);
     antes, con uno (decisión del 10-11-2026). Lo que se afirma sigue siendo que es uno solo en todo el documento. */
  test("los puntos de diferencia, con el mismo número de decimales en todo el documento", async () => {
    const todo = (await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ }))).join(" ");
    expect(todo).toMatch(/[+−]\d+,\d\d pp/);
    expect(todo).not.toMatch(/(^|[^\d])\d+,\d pp/);
  }, 30_000);

  test("todas las categorías cuando caben, sin «Resto de grupos»", async () => {
    const hoja = (await hojas(entrada({ fichas: lado(Array.from({ length: 15 }, (_, i) => i)) }, { fichas: DIEZ }))).find((p) => p.includes(`03 ${COMPOSICION}`))!;
    for (const categoria of CATEGORIAS.slice(0, 15)) expect(hoja).toContain(plano(categoria));
    expect(hoja).not.toMatch(/Resto de grupos|Otros \d+ grupos/);
  }, 30_000);

  /* Desde la plantilla única (14-11-2026) el cliente va en la cabecera de cada hoja («Preparado para…») y quien lo elabora en el membrete,
     en vez de los rótulos «Cliente» y «Elaborado por» de la portada. */
  test("el cliente y quien lo elabora, solo si llegan", async () => {
    const con = await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ }, { cliente: "Familia Ejemplo", responsable: { name: "Marta López", email: "marta@asesoria.es" } }));
    for (const hoja of con) {
      expect(hoja).toContain("Preparado para Familia Ejemplo");
      expect(hoja).toContain("Marta López");
      expect(hoja).toContain("marta@asesoria.es");
    }
    const sin = (await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ })))[0];
    expect(sin).not.toMatch(/Preparado para|Marta López|Oscar Antiza/);
  }, 30_000);

  test("lo que se mide, con las palabras del informe de cliente", async () => {
    const todo = (await hojas(entrada({ fichas: OCHO, fuera: 1 }, { fichas: DIEZ }))).join(" ");
    expect(todo).toMatch(/A · Mide el \d+,\d % de la cartera \(7 de 8 posiciones\); queda fuera .+ \(\d+,\d %\) por no tener historia suciente en este periodo\./);
    expect(todo).toContain("B · Mide el 100,0 % de la cartera (10 de 10 posiciones).");
    expect(todo).not.toMatch(/peso representado|Peso representado|se normalizan/);
  }, 30_000);

  test("tres indicadores de concentración; fuera el número efectivo y las posiciones exclusivas; composición y concentración en una hoja", async () => {
    const paginas = await hojas(entrada({ fichas: OCHO }, { fichas: DIEZ }));
    const hoja = paginas.find((p) => p.includes(`03 ${COMPOSICION}`))!;
    for (const indicador of ["Posiciones con peso", "Mayor posición", "Cinco mayores posiciones", "Peso coincidente", "Cambio de asignación"]) expect(hoja).toContain(indicador);
    expect(paginas.join(" ")).not.toMatch(/Número efectivo|Posiciones exclusivas/);
    expect(paginas.filter((p) => p.includes(COMPOSICION))).toHaveLength(1);
  }, 30_000);
});

describe("decisión B-78: una posición cuyos datos se quedaron en una fecha", () => {
  const conParadas = (la: Lado, lb: Lado, seriesParadas: ReadonlyMap<string, string>) => {
    const ha = historia("A", la), hb = historia("B", lb);
    return entradaDeLaComparativa({
      a: cartera("Cartera Equilibrada de la familia", la),
      b: cartera("Propuesta de crecimiento", lb),
      cargada: { period: "3Y", a: ha, b: hb, result: alignPortfolioComparison(ha, hb, "3Y") },
      assets: [...new Map([...lb.fichas, ...la.fichas].map((f) => [f.asset_id, f])).values()],
      seriesParadas
    });
  };

  test("va entre las notas generales del método, con su nombre y su fecha; sin ninguna, nada", () => {
    const parada = OCHO[2];
    expect(conParadas({ fichas: OCHO }, { fichas: DIEZ }, new Map([[parada.asset_id, "2025-11-28"]])).methodology.at(-1)).toBe(`${parada.display_name}: sus datos llegan hasta el 28/11/2025.`);
    expect(conParadas({ fichas: OCHO }, { fichas: DIEZ }, new Map()).methodology.join(" ")).not.toContain("sus datos llegan hasta");
    /* Una que no está en ninguna de las dos no se nombra. */
    expect(conParadas({ fichas: OCHO }, { fichas: DIEZ }, new Map([["OTRO", "2025-11-28"]])).methodology.join(" ")).not.toContain("sus datos llegan hasta");
  });

  test.each([
    ["ocho y diez con posiciones en común", { fichas: OCHO }, { fichas: DIEZ }],
    ["tres y tres", { fichas: lado([0, 1, 2]) }, { fichas: lado([1, 2, 3]) }]
  ])("con %s, la nota sale en el método y no añade ninguna hoja", async (_caso, la, lb) => {
    const parada = la.fichas[1];
    const sin = await hojas(conParadas(la, lb, new Map()));
    const con = await hojas(conParadas(la, lb, new Map([[parada.asset_id, "2025-11-28"]])));
    expect(con).toHaveLength(sin.length);
    expect(con.find((p) => p.includes("Qué se mide de cada cartera"))).toContain("sus datos llegan hasta el 28/11/2025.");
  }, 30_000);
});

describe("las comisiones de entrada (suscripción) y salida (reembolso), en la comparativa (Óscar, 11-11-2026)", () => {
  test.each([
    ["8 contra 10, el caso real", () => entrada({ fichas: OCHO_REAL, fuera: 1 }, { fichas: DIEZ_REAL, fuera: 1 }), 6],
    ["8 contra 10 con capital", () => entrada({ fichas: OCHO, capital: 200_000 }, { fichas: DIEZ, capital: 200_000 }), null],
    ["con un fondo sin coste en A", () => entrada({ fichas: OCHO, sinCoste: 1 }, { fichas: DIEZ }), null]
  ] as const)("%s: el nombre nuevo, «impuestos.» nunca sola", async (_caso, input, hojasEsperadas) => {
    const bytes = Buffer.from(await (await createComparisonPdfBlob(input())).arrayBuffer());
    const paginas = extractPdfPageTexts(bytes).map(plano);
    if (hojasEsperadas != null) expect(paginas).toHaveLength(hojasEsperadas);
    expect(paginas.join(" ")).toContain("comisiones de entrada (suscripción) y salida (reembolso) ni impuestos.");
    expect(paginas.join(" ")).not.toMatch(/entrada y salida|suscripción o reembolso/);
    expect(lineasHuerfanasDeImpuestos(bytes)).toEqual([]);
    expect(lineasCon(bytes, "ni impuestos.").filter((l) => !l.includes("(reembolso) ni impuestos."))).toEqual([]);
  }, 30_000);
});
