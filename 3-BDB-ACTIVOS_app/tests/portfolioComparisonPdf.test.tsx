import { describe, expect, test } from "vitest";
import { createComparisonPdfBlob } from "../src/reports/comparePdf";
import { comparisonFixture } from "./support/portfolioComparisonFixtures";
import { clasificacionQueFalta } from "../src/core/entradaDeComparativa";
import { alignPortfolioComparison, comparisonAllocations, comparisonMetrics } from "../src/core/portfolioComparison";
import { extractPdfPageTexts } from "./support/pdfText";
import { importe, porcentaje, ratio, rentabilidad } from "../src/core/formato";
import { comparisonConcentration, comparisonPositionRows, comparisonYearReturns } from "../src/core/portfolioComparisonReport";
import { comparisonAssets } from "./support/portfolioComparisonFixtures";
import { historiaDeTramo } from "./support/tramoCorto";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { writeFileSync, mkdirSync } from "node:fs";

test("el PDF conserva el periodo, los valores y la cobertura del gráfico comparativo", async () => {
  const result = alignPortfolioComparison(comparisonFixture("10Y"), comparisonFixture("10Y", "B"), "10Y");
  const blob = await createComparisonPdfBlob({ nameA: "ÁGUILA", nameB: "ÍNDICE ÑOÑO", periodLabel: result.periodLabel,
    a: { posiciones: 2, ret: result.metricsA.cagr!, vol: result.metricsA.volatility!, sharpe: result.metricsA.sharpe!, maxdd: result.metricsA.maxDrawdown },
    b: { posiciones: 2, ret: result.metricsB.cagr!, vol: result.metricsB.volatility!, sharpe: result.metricsB.sharpe!, maxdd: result.metricsB.maxDrawdown },
    history: { a: result.seriesA, b: result.seriesB, rangeLabel: result.rangeLabel },
    methodology: ["ÁGUILA: 80,0 % del peso representado.", "Fuera del cálculo: Activo joven (histórico insuficiente).", "ÁGUILA · Activo joven: tramo estimado con MSCI World NR, del 01/01/2016 al 01/01/2018."], classRows: [{ label: "Renta variable", a: 80, b: 90 }, { label: "Monetario", a: 20, b: 10 }] });
  const pages = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()));
  expect(pages.length).toBeGreaterThanOrEqual(5);
  expect(pages.join()).toContain("Evolución histórica");
  expect(pages[0]).toContain("10 años");
  expect(pages[0]).not.toContain("3A");
  /* Desde la plantilla única (14-11-2026), con el formato común: dos decimales y signo (antes, `fmtPct` con uno). El texto por hojas cambia el
     espacio duro por uno normal. */
  expect(pages.join()).toContain(rentabilidad(result.metricsA.cagr)!.replace(/\s/g, " "));
  // The minimal CMap reader intentionally omits fi/fl ligatures; assert the named exclusion.
  expect(pages.join()).toContain("Fuera del cálculo: Activo joven");
  expect(pages.join()).toContain("ÍNDICE ÑOÑO");
  // Auditoría 14-10 (MEDIA-18a): Roboto Flex tiene el menos tipográfico; los
  // negativos (eje de caídas, diferencias) no vuelven al guion ASCII.
  expect(pages.join(" ")).toMatch(/−\d+ %/);
  expect(pages.join(" ")).not.toMatch(/(^|[\s(])-\d+(,\d+)? ?%/);
  // Anexo, al pie de la hoja de método: notas agrupadas por cartera, sin el prefijo del nombre; las no atribuidas van en «Notas generales».
  const annex = pages[pages.length - 1];
  /* Desde el 10-11-2026 el anexo solo sale si hay algo que contar que la nota no dice: aquí, un tramo estimado. Las notas generales van en el método. */
  expect(annex).toContain("Anexo · Qué queda fuera de cada cartera");
  expect(annex).toContain("Qué se mide de cada cartera y cómo");
  expect(annex).toContain("A · ÁGUILA");
  expect(annex).toContain("tramo estimado con MSCI World NR");
  expect(annex).not.toContain("ÁGUILA · Activo joven");
  pages.forEach((page, index) => expect(page).toContain(`Página ${index + 1} de ${pages.length}`));
  // Genera un PDF completo: con la suite en paralelo, 5 s por defecto no siempre bastan.
}, 30000);

test("informe limpio completo: distribuciones, diferencias, posiciones largas y segunda generación", async () => {
  const result = alignPortfolioComparison(comparisonFixture("10Y"), comparisonFixture("10Y", "B"), "10Y");
  const sampleAssets = [
    ["Global Quality EUR", "EQUITY", "Renta variable global", "Global", "EUR"],
    ["Europa Selección", "EQUITY", "Renta variable europea", "Europa", "EUR"],
    ["Tecnología Global", "EQUITY", "Renta variable tecnológica", "Global", "USD"],
    ["Bonos Euro Flexible", "FIXED_INCOME", "Renta fija flexible EUR", "Europa", "EUR"],
    ["Crédito Global", "FIXED_INCOME", "Renta fija high yield global", "Global", "EUR"],
    ["Liquidez EUR", "MONEY_MARKET", "Monetario", "Global", "EUR"]
  ].map(([display_name, economic_asset_class, category, region, currency], i) => ({ ...comparisonAssets[0], asset_id: `MUESTRA-${i + 1}`, display_name, economic_asset_class, category, region, currency } as BdbAssetDetail));
  const savedA = [30, 20, 10, 25, 5, 10].map((weight_percent, i) => ({ asset_id: sampleAssets[i].asset_id, weight_percent }));
  const savedB = [35, 10, 25, 10, 15, 5].map((weight_percent, i) => ({ asset_id: sampleAssets[i].asset_id, weight_percent }));
  const positions = comparisonPositionRows(savedA, savedB, sampleAssets);
  expect(comparisonConcentration(positions)?.overlap).toBe(70);
  const input = { nameA: "Cartera Alfa · Equilibrada", nameB: "Cartera Beta · Crecimiento", sample: true,
    periodLabel: result.periodLabel, riskFree: result.riskFree,
    a: { posiciones: 6, ret: result.metricsA.cagr! }, b: { posiciones: 6, ret: result.metricsB.cagr! },
    history: { a: result.seriesA, b: result.seriesB, rangeLabel: result.rangeLabel }, positions,
    classRows: comparisonAllocations(savedA, savedB, sampleAssets, "economic_asset_class", clasificacionQueFalta),
    categoryRows: comparisonAllocations(savedA, savedB, sampleAssets, "category", clasificacionQueFalta),
    coverage: { a: { weight: 80, included: 5, total: 6 }, b: { weight: 100, included: 6, total: 6 } },
    extendedHistory: true, methodology: ["Muestra de maquetación: series simuladas, sin datos de cliente.", "Cartera Alfa: 80,0 % del peso representado.", "Cartera Alfa · Fuera del cálculo: Europa Selección (histórico insuficiente).", "Ejemplo de cobertura ampliada mediante una referencia histórica en parte del periodo."] };
  const bytes = Buffer.from(await (await createComparisonPdfBlob(input)).arrayBuffer());
  if (process.env.COMPARISON_PDF_SAMPLE) {
    mkdirSync("output/pdf", { recursive: true });
    writeFileSync("output/pdf/comparador-carteras-informe-limpio-muestra.pdf", bytes);
  }
  const pages = extractPdfPageTexts(bytes), text = pages.join("\n");
  for (const title of ["Rentabilidad por año", "Caídas desde máximos", "Concentración y coincidencias", "Qué cambia en cada posición", "Mide el 80,0 % de la cartera", "80,0 %", "B − A", "100,0 %"]) expect(text).toContain(title);
  /* Decisión 42: sin capital declarado no hay un solo importe. Esta prueba pedía «100.000»: es lo que Óscar ha quitado. */
  expect(text).not.toContain("100.000");
  expect(text).not.toContain("€");
  expect(text).toContain("Rentabilidad y evolución");
  expect(text).not.toContain("valor del capital");
  expect(text).not.toMatch(/ANDBANK|BDB-ACTIVOS|NaN|Infinity/);
  /* Las dos letras de la plantilla. Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de antes) la plantilla vuelve a Fraunces y Roboto Flex; IBM Plex Sans y Source Serif 4, las de la plantilla de una sola tinta, salieron. */
  expect(bytes.toString("latin1")).toContain("RobotoFlex");
  expect(bytes.toString("latin1")).toContain("Fraunces");
  expect(bytes.toString("latin1")).not.toMatch(/IBMPlexSans|SourceSerif4/);
  /* Seis hojas y, a diez años, la de la rentabilidad por año: portada, evolución, años, riesgo, composición, posiciones, método con su anexo. */
  expect(pages).toHaveLength(7);
  /* Desde la plantilla única (14-11-2026) el método sigue a las seis posiciones en su hoja, y su anexo continúa en la última. */
  const metodo = pages.slice(5).join(" ");
  expect(metodo).toContain("Qué se mide de cada cartera y cómo");
  expect(metodo).toContain("Anexo · Qué queda fuera de cada cartera");
  expect(metodo).toContain("Europa Selección");
  expect(pages.join(" ")).not.toContain("Alcance y calidad");
  pages.forEach((page, index) => {
    expect(page).toContain(`Página ${index + 1} de ${pages.length}`);
    expect(page).toContain("CONFIDENCIAL");
    expect(page).not.toContain("INDEPENDENT PRIVATE BANKERS");
  });
  const longPositions = Array.from({ length: 29 }, (_, i) => ({ ...positions[0], id: `ISIN-${i}`, name: `ÁGUILA ÍNDICE ÑOÑO KÜMMEL ${i} · Fondo de inversión internacional de renta variable europea con selección activa de compañías`, a: 100 / 29, b: 100 / 29 }));
  const second = Buffer.from(await (await createComparisonPdfBlob({ ...input, nameA: "ÁGUILA ÍNDICE ÑOÑO KÜMMEL", positions: longPositions,
    methodology: Array.from({ length: 30 }, (_, i) => `Nota de cobertura ${i + 1}: este activo utiliza una referencia histórica en parte del periodo común y su peso se incluye en el cálculo con la metodología indicada.`) })).arrayBuffer());
  const longPages = extractPdfPageTexts(second);
  expect(longPages.join()).toContain("ÁGUILA ÍNDICE ÑOÑO KÜMMEL");
  expect(longPages.join()).toContain("ISIN-28");
  expect(longPages.join()).toContain("Nota de cobertura 30");
  longPages.forEach((page, index) => {
    expect(page).toContain(`Página ${index + 1} de ${longPages.length}`);
    expect(page).toContain("CONFIDENCIAL");
    expect(page).not.toContain("INDEPENDENT PRIVATE BANKERS");
  });
  if (process.env.COMPARISON_PDF_SAMPLE) writeFileSync("output/pdf/comparador-carteras-prueba-nombres-largos.pdf", second);
}, 60000);

describe("decisión 42: los euros de la Comparativa", () => {
  const result = alignPortfolioComparison(comparisonFixture("10Y"), comparisonFixture("10Y", "B"), "10Y");
  const corta = alignPortfolioComparison(comparisonFixture("3Y"), comparisonFixture("3Y", "B"), "3Y");
  const entrada = (r: typeof result, extra: Partial<Parameters<typeof createComparisonPdfBlob>[0]> = {}) => ({
    nameA: "Alfa", nameB: "Beta", periodLabel: r.periodLabel, riskFree: r.riskFree,
    a: { posiciones: 2 }, b: { posiciones: 2 }, history: { a: r.seriesA, b: r.seriesB, rangeLabel: r.rangeLabel },
    classRows: [{ label: "Renta variable", a: 80, b: 90 }, { label: "Monetario", a: 20, b: 10 }], ...extra
  });
  const textoDe = async (input: Parameters<typeof createComparisonPdfBlob>[0]) => extractPdfPageTexts(Buffer.from(await (await createComparisonPdfBlob(input)).arrayBuffer()));
  /* El extractor pierde el espacio duro del importe: se compara sin espacios. */
  const junto = (texto: string) => texto.replace(/\s+/g, "");
  const finalDe = (capital: number, acumulada: number) => (importe(capital * (1 + acumulada)) ?? "").replace(/\s+/g, "");

  test("sin capital, con la tabla larga: en base 100 y sin un euro, por muchos años que haya", async () => {
    const paginas = await textoDe(entrada(result));
    const hoja = paginas[1];
    expect(hoja).toContain("Rentabilidad y evolución");
    expect(hoja).toContain("Qué representa sobre una base de 100");
    expect(hoja).toContain("No se ha jado un capital: este documento va en porcentajes");
    expect(paginas.join(" ")).not.toContain("€");
    expect(paginas.join(" ")).not.toContain("100.000");
  }, 30_000);

  test("sin capital, con la tabla corta: tampoco; la hoja lleva la frase", async () => {
    const paginas = await textoDe(entrada(corta));
    expect(paginas[1]).toContain("Rentabilidad por año");
    expect(paginas[1]).toContain("No se ha jado un capital");
    expect(paginas.join(" ")).not.toContain("€");
  }, 30_000);

  test("con el mismo capital: sobre esa cifra, nunca sobre 100.000", async () => {
    const paginas = await textoDe(entrada(result, { capitalA: 250_000, capitalB: 250_000 }));
    const hoja = junto(paginas[1]);
    expect(hoja).toContain(junto("Qué representa sobre 250.000,00 €"));
    expect(hoja).toContain(junto(`A termina en ${importe(250_000 * (1 + result.metricsA.cumulative))}`));
    expect(hoja).toContain(finalDe(250_000, result.metricsB.cumulative));
    expect(paginas.join(" ")).not.toContain("100.000");
    expect(paginas[1]).toContain("Rentabilidad y valor del capital");
    expect(paginas[1]).toContain("Es una simulación");
  }, 30_000);

  test("con capitales distintos: cada una el suyo, sin resta en euros", async () => {
    const paginas = await textoDe(entrada(result, { capitalA: 250_000, capitalB: 100_000 }));
    const hoja = junto(paginas[1]);
    expect(hoja).toContain(finalDe(250_000, result.metricsA.cumulative));
    expect(hoja).toContain(finalDe(100_000, result.metricsB.cumulative));
    expect(paginas[1]).toContain("No aplica");
    expect(paginas[1]).toContain("No se restan, porque parten de capitales distintos.");
  }, 30_000);

  test("con capital en una sola, la otra no lo toma prestado, y se dice", async () => {
    const paginas = await textoDe(entrada(result, { capitalA: 250_000 }));
    const hoja = junto(paginas[1]);
    expect(hoja).toContain(finalDe(250_000, result.metricsA.cumulative));
    expect(hoja).not.toContain(finalDe(250_000, result.metricsB.cumulative));
    expect(paginas[1]).toContain("Sin jar");
    expect(paginas[1]).toContain("B no lo tiene y no toma prestado el de A");
    const alReves = await textoDe(entrada(corta, { capitalB: 100_000 }));
    expect(junto(alReves[1])).toContain(finalDe(100_000, corta.metricsB.cumulative));
    expect(alReves[1]).toContain("A no lo tiene y no toma prestado el de B");
  }, 30_000);

  /*
   * CMP-5 (17-11-2026): con un capital fijado los importes salen siempre. Antes, con cinco años o menos la hoja traía la tabla por año y,
   * de los euros, solo una frase. Cuenta a mano de la frase: capital × (1 + acumulada), sobre la acumulada que imprime el propio papel.
   */
  test("con la tabla corta y un capital: la tabla por año y la de importes, en la misma hoja y sin hoja de más", async () => {
    const sin = await textoDe(entrada(corta));
    const con = await textoDe(entrada(corta, { capitalA: 250_000, capitalB: 250_000 }));
    expect(con[1]).toContain("Rentabilidad por año");
    expect(junto(con[1])).toContain(junto("Qué representa sobre 250.000,00 €"));
    for (const fila of ["Capital inicial", "Resultado acumulado", "Capital nal"]) expect(con[1]).toContain(fila);
    expect(junto(con[1])).toContain(finalDe(250_000, corta.metricsA.cumulative));
    expect(junto(con[1])).toContain(finalDe(250_000, corta.metricsB.cumulative));
    expect(con).toHaveLength(sin.length);
    /* Sin capital, ni una tabla de importes ni un euro. */
    expect(sin.join(" ")).not.toContain("Capital inicial");
  }, 30_000);

  test("con la tabla corta y capitales distintos o en una sola: cada una con el suyo, también en tabla", async () => {
    const distintos = await textoDe(entrada(corta, { capitalA: 250_000, capitalB: 100_000 }));
    expect(distintos[1]).toContain("Qué representa sobre el capital de cada cartera");
    expect(junto(distintos[1])).toContain(finalDe(100_000, corta.metricsB.cumulative));
    const una = await textoDe(entrada(corta, { capitalA: 250_000 }));
    expect(una[1]).toContain("Capital inicial");
    expect(una[1]).toContain("Sin jar");
  }, 30_000);

  test("un capital de 0 no es un capital", async () => {
    const paginas = await textoDe(entrada(corta, { capitalA: 0, capitalB: 0 }));
    expect(paginas.join(" ")).not.toContain("€");
    expect(paginas[1]).toContain("No se ha jado un capital");
  }, 30_000);

  test("la nota más larga cabe con cinco años en la tabla: ninguna hoja de más", async () => {
    /* Cuatro años y medio: 5 filas, las máximas que van en la misma hoja que la nota. */
    const puntos = (factor: number) => Array.from({ length: 1640 }, (_, i) => ({ date: new Date(Date.UTC(2022, 2, 1) + i * 86_400_000).toISOString().slice(0, 10), value: 100 * Math.exp(i * factor) }));
    const a = puntos(.00018), b = puntos(.00022);
    const base = { nameA: "Alfa", nameB: "Beta", periodLabel: "periodo disponible", riskFree: .02, a: { posiciones: 2 }, b: { posiciones: 2 }, history: { a, b, rangeLabel: "1 mar 2022 a 26 ago 2026" }, classRows: [{ label: "Renta variable", a: 80, b: 90 }] };
    expect(comparisonYearReturns(a, b)).toHaveLength(5);
    const sinCapital = await textoDe(base);
    const conUna = await textoDe({ ...base, capitalA: 12_345_678.9 });
    expect(conUna).toHaveLength(sinCapital.length);
    expect(conUna[1]).toContain("Ejemplo con el capital jado en A");
    expect(conUna[2]).not.toContain("Ejemplo con el capital");
  }, 30_000);
});

describe("decisión 41: el Sharpe de una cartera que es una sola acción", () => {
  const result = alignPortfolioComparison(comparisonFixture("3Y"), comparisonFixture("3Y", "B"), "3Y");
  const entrada = (extra: Partial<Parameters<typeof createComparisonPdfBlob>[0]> = {}) => ({
    nameA: "Alfa", nameB: "Beta", periodLabel: result.periodLabel, riskFree: .02,
    a: { posiciones: 1 }, b: { posiciones: 2 }, history: { a: result.seriesA, b: result.seriesB, rangeLabel: result.rangeLabel },
    classRows: [{ label: "Renta variable", a: 100, b: 90 }], ...extra
  });
  const hojas = async (input: Parameters<typeof createComparisonPdfBlob>[0]) => extractPdfPageTexts(Buffer.from(await (await createComparisonPdfBlob(input)).arrayBuffer())).map((p) => p.replace(/\s+/g, " ").replace(/(\p{L})- (\p{L})/gu, "$1$2"));
  const conA = comparisonMetrics(result.seriesA, .02), conB = comparisonMetrics(result.seriesB, .02);

  test("con una cartera normal, las cifras y las frases de siempre", async () => {
    const paginas = await hojas(entrada());
    const riesgo = paginas.find((p) => p.includes("Qué riesgo acompaña"))!;
    expect(riesgo).toContain(`Sharpe ${ratio(conA.sharpe)} ${ratio(conB.sharpe)}`);
    expect(riesgo).toContain("Rentabilidad y Sharpe: una cifra mayor");
    expect(paginas.join(" ")).not.toContain("Calmar");
    expect(riesgo).toContain("Tipo sin riesgo: 2,00 %");
    expect(riesgo).not.toContain("No aplica");
    expect(paginas.find((p) => p.includes("Qué se mide de cada cartera"))).toContain("Sharpe = (rentabilidad anualizada");
    expect(paginas.join(" ")).not.toMatch(/\bCAGR\b|Tasa sin riesgo/);
  }, 30_000);

  test("con una sola acción en A: esa columna y la diferencia dicen «No aplica», y B conserva su cifra", async () => {
    const paginas = await hojas(entrada({ sharpeNoAplica: { a: true, b: false } }));
    const riesgo = paginas.find((p) => p.includes("Qué riesgo acompaña"))!;
    expect(riesgo).toContain(`Sharpe No aplica ${ratio(conB.sharpe)} No aplica`);
    expect(riesgo).not.toContain(`${ratio(conA.sharpe)} ${ratio(conB.sharpe)}`);
    expect(riesgo).toContain("Sharpe: no aplica si lo que se mide es una sola acción. De un componente importa lo que aporta a la cartera, no su nota aislada.");
    expect(riesgo).toContain("Tipo sin riesgo");
    expect(riesgo).not.toContain("Calmar");
    expect(paginas.find((p) => p.includes("Qué se mide de cada cartera"))).toContain("Sharpe = (rentabilidad anualizada");
  }, 30_000);

  test("con una sola acción en las dos: ni se lee ni se calcula un Sharpe que no sale", async () => {
    const paginas = await hojas(entrada({ sharpeNoAplica: { a: true, b: true } }));
    const riesgo = paginas.find((p) => p.includes("Qué riesgo acompaña"))!;
    expect(riesgo).toContain("Sharpe No aplica No aplica No aplica");
    expect(riesgo).toContain("Rentabilidad: una cifra mayor");
    expect(riesgo).not.toContain("Calmar");
    expect(riesgo).not.toContain("Tipo sin riesgo");
    expect(paginas.find((p) => p.includes("Qué se mide de cada cartera"))).not.toContain("Sharpe");
  }, 30_000);

  /* CMP-5 (17-11-2026): un Sharpe que no sale no se explica. Sin tipo sin riesgo del periodo, `sharpe` es nulo en las dos y la fila dice «Falta el dato». */
  test("sin tipo sin riesgo: la fila no trae cifra y el papel no explica cómo se lee el Sharpe ni da el tipo", async () => {
    const paginas = await hojas(entrada({ riskFree: null }));
    const riesgo = paginas.find((p) => p.includes("Qué riesgo acompaña"))!;
    expect(riesgo).toContain("Falta el dato");
    expect(riesgo).toContain("Rentabilidad: una cifra mayor");
    expect(riesgo).not.toContain("Rentabilidad y Sharpe");
    expect(riesgo).not.toContain("Tipo sin riesgo");
    expect(paginas.find((p) => p.includes("Qué se mide de cada cartera"))).not.toContain("Sharpe =");
  }, 30_000);

  /* El Calmar salió del papel el 10-11-2026. Una cartera sin ninguna caída lo dice en su peor episodio, y nada se divide por cero. */
  test("una cartera sin ninguna caída: «Sin caída» en su episodio, y ningún Calmar", async () => {
    const fechas = result.seriesB.map((p) => p.date);
    const siempreSube = fechas.map((date, i) => ({ date, value: 100 * Math.exp(i * .0002) }));
    const paginas = await hojas(entrada({ history: { a: siempreSube, b: result.seriesB, rangeLabel: result.rangeLabel } }));
    const riesgo = paginas.find((p) => p.includes("Qué riesgo acompaña"))!;
    expect(riesgo).toContain("Sin caída");
    expect(paginas.join(" ")).not.toMatch(/Calmar|sin caída, N\/D/);
  }, 30_000);
});

describe("decisión 59: la cartera que mide menos del 80 % de su peso, cartera por cartera", () => {
  const FALTA = "Falta el dato";
  const MOTIVO_B = "La simulación mide el 40 % del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se queda fuera: Vanguard (60 %).";
  const MOTIVO_A = "La simulación mide el 30 % del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se queda fuera: Vanguard (70 %).";
  const result = alignPortfolioComparison(comparisonFixture("3Y"), comparisonFixture("3Y", "B"), "3Y");
  const entrada = (sinCifra: { a: string | null; b: string | null }, extra: Partial<Parameters<typeof createComparisonPdfBlob>[0]> = {}) => ({
    nameA: "Cartera Alfa", nameB: "Cartera Beta", periodLabel: result.periodLabel, riskFree: result.riskFree, sinCifra,
    a: { posiciones: 2 }, b: { posiciones: 2 }, history: { a: result.seriesA, b: result.seriesB, rangeLabel: result.rangeLabel },
    coverage: { a: { weight: 100, included: 2, total: 2 }, b: { weight: 40, included: 1, total: 2 } },
    classRows: [{ label: "Renta variable", a: 80, b: 90 }, { label: "Renta fija", a: 20, b: 10 }],
    positions: [{ id: "A", name: "Activo A", category: "RV", currency: "EUR", a: 80, b: 0 }, { id: "B", name: "Activo B", category: "RV", currency: "EUR", a: 20, b: 100 }],
    ...extra
  });
  const hojasDe = async (input: Parameters<typeof createComparisonPdfBlob>[0]) => extractPdfPageTexts(Buffer.from(await (await createComparisonPdfBlob(input)).arrayBuffer())).map((hoja) => hoja.replace(/\s+/g, " "));
  const metricasA = comparisonMetrics(result.seriesA, result.riskFree);
  const metricasB = comparisonMetrics(result.seriesB, result.riskFree);
  /* Desde la plantilla única (14-11-2026), con el formato común: la rentabilidad con dos decimales y signo, la volatilidad y la caída con dos (antes, `fmtPct` con uno). */
  const ren = (cifra: number | null | undefined) => (rentabilidad(cifra) ?? "").replace(/\s+/g, " ");
  const pct = (cifra: number | null | undefined) => (porcentaje(cifra) ?? "").replace(/\s+/g, " ");

  test("con la B por debajo: su columna y la resta faltan, la A sigue con sus cifras, y el motivo está en las tres hojas de cifras", async () => {
    const hojas = await hojasDe(entrada({ a: null, b: MOTIVO_B }));
    const todo = hojas.join(" ");
    expect(hojas[0]).toContain(`Falta el dato de B. ${MOTIVO_B}`);
    expect(hojas[0]).toContain("Sin esa cifra no se comparan rentabilidad ni riesgo.");
    expect(hojas[1]).toContain(`B: ${MOTIVO_B}`);
    expect(hojas[2]).toContain(`B: ${MOTIVO_B}`);
    expect(hojas[1]).toContain(`Acumulada A ${ren(metricasA.cumulative)}`);
    expect(hojas[1]).toContain(`Acumulada B ${FALTA}`);
    expect(hojas[2]).toContain(`Volatilidad ${pct(metricasA.volatility)} ${FALTA} ${FALTA}`);
    expect(hojas[2]).toContain("Mapa: falta el dato de B");
    /* Ninguna cifra de B, en ningún sitio. */
    for (const cifra of [ren(metricasB.cagr), pct(metricasB.volatility), pct(metricasB.maxDrawdown), ren(metricasB.cumulative)]) {
      expect(todo).not.toContain(` ${cifra} `);
    }
    /* Ninguna diferencia: ni en la portada, ni por años, ni en el riesgo. */
    expect(hojas.slice(1, 3).join(" ")).not.toMatch(/[+−]\d+,\d+ pp/);
    expect(hojas[0]).not.toContain("Diferencia de CAGR");
  }, 30000);

  test("con la A por debajo, lo mismo al revés", async () => {
    const hojas = await hojasDe(entrada({ a: MOTIVO_A, b: null }));
    expect(hojas[0]).toContain(`Falta el dato de A. ${MOTIVO_A}`);
    expect(hojas[1]).toContain(`Acumulada A ${FALTA}`);
    expect(hojas[1]).toContain(`Acumulada B ${ren(metricasB.cumulative)}`);
    expect(hojas[2]).toContain(`Volatilidad ${FALTA} ${pct(metricasB.volatility)} ${FALTA}`);
  }, 30000);

  test("con las dos por debajo: sigue teniendo sentido, porque compara su composición, y no enseña hojas de cifras vacías", async () => {
    const hojas = await hojasDe(entrada({ a: MOTIVO_A, b: MOTIVO_B }));
    const todo = hojas.join(" ");
    expect(hojas[0]).toContain("Falta el dato de las dos.");
    expect(hojas[0]).toContain(`A: ${MOTIVO_A}`);
    expect(hojas[0]).toContain(`B: ${MOTIVO_B}`);
    expect(hojas[0]).toContain("este documento compara su composición");
    expect(todo).not.toContain("Qué riesgo acompaña al resultado");
    expect(todo).not.toContain("Evolución histórica");
    expect(todo).not.toContain("Tasa sin riesgo común");
    expect(todo).not.toContain("CAGR anualizado");
    expect(todo).toContain("Dónde se separan las carteras");
    expect(todo).toContain("Qué cambia en cada posición");
    expect(hojas[1]).toContain("01 Dónde se separan las carteras");
  }, 30000);

  test("el peso que no llega no se escribe como si llegara", async () => {
    const hojas = await hojasDe(entrada({ a: null, b: MOTIVO_B }, { coverage: { a: { weight: 100, included: 2, total: 2 }, b: { weight: 79.99, included: 1, total: 2 } } }));
    expect(hojas[0]).toContain("B · Mide el 79,99 % de la cartera");
    expect(hojas.join(" ")).not.toContain("Mide el 80,0 %");
  }, 30000);

  test("sin motivo, como siempre: cifras, diferencias y su nota", async () => {
    const hojas = await hojasDe(entrada({ a: null, b: null }));
    /* Ninguna cifra de cartera falta. Esta entrada, hecha a mano, no trae costes ni regiones: eso sí dice que falta, y en su sitio. */
    expect(hojas.slice(1, 3).join(" ")).not.toContain(FALTA);
    expect(hojas[0]).not.toContain("Falta el dato de");
    /* En «pp» y con dos decimales, como la tabla, desde el 14-11-2026 (antes, «puntos» con uno). */
    expect(hojas[0]).toMatch(/B rindió \d+,\d\d\spuntos porcentuales \(pp\) (más|menos) al año que A/);
    expect(hojas[2]).toContain(`Volatilidad ${pct(metricasA.volatility)} ${pct(metricasB.volatility)}`);
  }, 30000);
});

describe("decisiones 80, 85 y 89: lo que queda de la Comparativa de carteras", () => {
  const result = alignPortfolioComparison(comparisonFixture("3Y", "A"), comparisonFixture("3Y", "B"), "3Y");
  const entrada = (extra: Partial<Parameters<typeof createComparisonPdfBlob>[0]> = {}) => ({
    nameA: "Alfa", nameB: "Beta", periodLabel: result.periodLabel, riskFree: .0193,
    a: { posiciones: 1 }, b: { posiciones: 2 }, history: { a: result.seriesA, b: result.seriesB, rangeLabel: result.rangeLabel },
    classRows: [{ label: "Renta variable", a: 90, b: 90 }, { label: "Fuera del reparto", a: 10, b: 10 }], ...extra
  });
  const hojas = async (input: Parameters<typeof createComparisonPdfBlob>[0]) => extractPdfPageTexts(Buffer.from(await (await createComparisonPdfBlob(input)).arrayBuffer())).map((p) => p.replace(/\s+/g, " "));

  test("el tipo de respaldo sale con su cifra y solo si ocurre", async () => {
    /* El lector de texto pierde la ligadura de «fijo». */
    const riesgo = (await hojas(entrada({ tipoDeRespaldo: .0193 }))).find((p) => p.includes("Qué riesgo acompaña"))!;
    expect(riesgo).toMatch(/Sharpe con un tipo \S*jo de respaldo \(1,93 %\): no se pudo leer el €STR del periodo\./);
    expect((await hojas(entrada({ tipoDeRespaldo: null }))).join(" ")).not.toContain("respaldo");
  }, 30_000);

  test("lo que no entra lleva su frase por cartera, y no es «la clase donde más cambia»", async () => {
    const paginas = await hojas(entrada({ fueraDelReparto: { a: "Fuera del reparto: CAM, CUOTAS PARTICIPATIVAS, 10,0 % de la cartera.", b: null } }));
    expect(paginas.join(" ")).toContain("A · Fuera del reparto: CAM, CUOTAS PARTICIPATIVAS, 10,0 % de la cartera.");
    expect(paginas.join(" ")).not.toContain("B · Fuera del reparto");
    expect(paginas.join(" ")).toContain("Fuera del reparto A 10,0 % B 10,0 %");
  }, 30_000);

  test("«comparten 1 posición», en singular, y sin palabras de cocina", async () => {
    /* A mano: comparten X; coinciden min(30, 40) = 30; cambia (10 + 70 + 60) / 2 = 70. */
    const positions = [{ id: "X", name: "Compartida", category: "Renta variable", currency: "EUR", a: 30, b: 40 }, { id: "Y", name: "Solo en A", category: "Renta variable", currency: "EUR", a: 70, b: 0 }, { id: "Z", name: "Solo en B", category: "Renta variable", currency: "EUR", a: 0, b: 60 }];
    const paginas = await hojas(entrada({ positions }));
    const todo = paginas.join(" ");
    expect(todo).toContain("Las carteras comparten 1 posición y un 30,0 % del peso.");
    expect(todo).toContain("1 posición compartida");
    expect(todo).not.toContain("1 posiciones");
    expect(todo).toContain("costes de operación");
    expect(todo).not.toContain("costes de transacción");
    expect(todo).not.toContain("calidad del dato");
  }, 30_000);
});

/* INF-31 (auditoría de frontend, 13-11-2026): el gráfico de la evolución va en base 100, y la nota de debajo decía «Valores en euros»,
   que se leía como si el eje fuera en euros. Es la divisa en la que se calcula. */
test("bajo la evolución en base 100, la nota dice base 100 y que se calcula en euros", async () => {
  const result = alignPortfolioComparison(comparisonFixture("10Y"), comparisonFixture("10Y", "B"), "10Y");
  const blob = await createComparisonPdfBlob({ nameA: "Alfa", nameB: "Beta", periodLabel: result.periodLabel,
    a: { posiciones: 2, ret: result.metricsA.cagr!, vol: result.metricsA.volatility!, sharpe: result.metricsA.sharpe!, maxdd: result.metricsA.maxDrawdown },
    b: { posiciones: 2, ret: result.metricsB.cagr!, vol: result.metricsB.volatility!, sharpe: result.metricsB.sharpe!, maxdd: result.metricsB.maxDrawdown },
    history: { a: result.seriesA, b: result.seriesB, rangeLabel: result.rangeLabel },
    methodology: [], classRows: [{ label: "Renta variable", a: 80, b: 90 }, { label: "Monetario", a: 20, b: 10 }] });
  const texto = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" ");
  expect(texto).not.toContain("Valores en euros");
  expect(texto).toContain("Base 100, calculado en euros");
}, 30000);

test("con menos de un año común, el papel da la rentabilidad del periodo con sus fechas y el Sharpe no aplica (15-11-2026)", async () => {
  /* A: de 100 a 106 en 119 días; B: de 100 a 103. B − A = −3,00 pp en el periodo, no «al año». */
  const result = alignPortfolioComparison(historiaDeTramo(119, 0.06, "A"), historiaDeTramo(119, 0.03, "B"), "10Y");
  const blob = await createComparisonPdfBlob({ nameA: "CORTA A", nameB: "CORTA B", periodLabel: result.periodLabel,
    a: { posiciones: 2, maxdd: result.metricsA.maxDrawdown }, b: { posiciones: 2, maxdd: result.metricsB.maxDrawdown },
    history: { a: result.seriesA, b: result.seriesB, rangeLabel: result.rangeLabel }, riskFree: 0.02,
    methodology: [], classRows: [{ label: "Renta variable", a: 80, b: 90 }, { label: "Monetario", a: 20, b: 10 }] });
  const texto = extractPdfPageTexts(Buffer.from(await blob.arrayBuffer())).join(" ").replace(/\s+/g, " ");
  expect(texto).toContain("Rentabilidad del periodo, del 07/05/2026 al 03/09/2026");
  expect(texto).toContain("+6,00 %");
  expect(texto).toContain("+3,00 %");
  expect(texto).toContain("B rindió 3,00 puntos porcentuales (pp) menos en el periodo que A");
  expect(texto).not.toContain("al año que A");
  expect(texto).not.toContain("Rentabilidad anualizada por días naturales");
  expect(texto).toContain("un periodo tan corto no se anualiza");
  /* Ni 19,58 % ni ninguna otra anualización de un +6 % en 119 días. */
  expect(texto).not.toContain("19,58");
  expect(texto).toMatch(/Sharpe No aplica No aplica No aplica/);
  /* La fila de la anualizada sigue en el papel, en «No aplica», como en la pantalla del comparador. */
  expect(texto).toMatch(/Rentabilidad anualizada No aplica No aplica No aplica/);
}, 30000);
