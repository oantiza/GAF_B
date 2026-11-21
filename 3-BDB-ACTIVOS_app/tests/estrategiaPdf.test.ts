/**
 * El papel de Estrategia: quién firma, de dónde salen sus cifras, de cuándo es y para quién sale
 * (decisiones 21 y 23 de Óscar, 04-11-2026; desde el 14-11-2026, en la plantilla única y sin marca de la casa). Se lee el PDF generado, hoja a hoja, porque lo que
 * se entrega es eso y no el código que lo escribe.
 *
 * El lector pierde las ligaduras «fi» y «fl» (`tests/support/pdfText.ts`), así que «cifras» se
 * busca por lo que la rodea.
 */
import { readFileSync } from "node:fs";
import { peso } from "../src/core/formato";
import { describe, expect, test } from "vitest";
import { createWeeklyReportPdfBlob, type AtrasoDelInforme } from "../src/reports/weeklyReportPdf";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import type { WeeklyReport } from "../src/types/weeklyReport";
import { extractPdfMetadata, extractPdfPageTexts } from "./support/pdfText";

const SEMANAL: WeeklyReport = WEEKLY_REPORT_MOCK;
const DIARIO: WeeklyReport = { ...WEEKLY_REPORT_MOCK, assetAllocation: undefined };
const VARIANTES: Array<[string, WeeklyReport, string]> = [
  ["diario", DIARIO, "DAILY_REPORT"],
  ["semanal", SEMANAL, "WEEKLY_REPORT"]
];

async function generar(informe: WeeklyReport, tipo = "WEEKLY_REPORT", atraso?: AtrasoDelInforme, conProveedor?: boolean) {
  const bytes = Buffer.from(await (await createWeeklyReportPdfBlob(informe, tipo, atraso, conProveedor)).arrayBuffer());
  const hojas = extractPdfPageTexts(bytes);
  return { bytes, hojas, texto: hojas.join("\n"), crudo: bytes.toString("latin1") };
}

/* Las redirecciones que hay guardadas de verdad son así: largas, y una por página consultada. */
const fuente = (title: string, i: number) => ({
  title,
  url: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/ENLACE${i}${"x".repeat(180)}`
});
const DOCE = ["federalreserve.gov", "morningstar.com", "fool.com", "morningstar.com", "admiralmarkets.com", "substack.com", "euronext.com", "euronext.com", "tradingview.com", "morningstar.com", "voiceofemirates.com", "qna.org.qa"].map(fuente);

describe("quién firma", () => {
  test.each(VARIANTES)("%s: el autor es lo que es, aunque lo guardado diga otra cosa", async (_nombre, informe, tipo) => {
    for (const author of ["Mesa de Analisis", "Comite de Inversiones", "Comité de Inversiones", "Redacción automática (IA)"]) {
      const { hojas, texto } = await generar({ ...informe, author }, tipo);
      expect(hojas[0]).toContain("Redacción automática (IA)");
      if (author !== "Redacción automática (IA)") expect(texto).not.toContain(author);
    }
  }, 60_000);

  test("la nota va junto a la firma, antes de empezar el contenido", async () => {
    const { hojas } = await generar(SEMANAL);
    const firma = hojas[0].indexOf("Redacción automática (IA)");
    const nota = hojas[0].indexOf("Sin revisión humana;");
    expect(firma).toBeGreaterThanOrEqual(0);
    expect(nota).toBeGreaterThan(firma);
    expect(hojas[0].slice(nota)).toContain("de fuentes web.");
    expect(nota).toBeLessThan(hojas[0].indexOf("Resumen y visión"));
  }, 30_000);

  test.each(VARIANTES)("%s en Modo cliente: fuera el proveedor; el autor y la nota se quedan, sin separador suelto (decisión 67)", async (_nombre, informe, tipo) => {
    const { hojas, texto, bytes } = await generar({ ...informe, provider: "Gemini con Google Search" }, tipo, undefined, false);
    expect(texto).not.toMatch(/Gemini|Google Search/);
    expect(bytes.toString("latin1")).not.toMatch(/Gemini/);
    expect(hojas[0]).toMatch(/Redacción automática \(IA\)\s+·\s+Sin revisión/);
  }, 30_000);

  test("el proveedor sigue saliendo, y si no consta la firma no deja un separador suelto", async () => {
    const conProveedor = await generar({ ...SEMANAL, provider: "Gemini con Google Search" });
    expect(conProveedor.hojas[0]).toMatch(/Redacción automática \(IA\)\s+·\s+Gemini con Google Search\s+·\s+Sin revisión/);
    const sinProveedor = await generar({ ...SEMANAL, provider: undefined });
    expect(sinProveedor.hojas[0]).toMatch(/Redacción automática \(IA\)\s+·\s+Sin revisión/);
  }, 30_000);

  /* Con el formato común de la presentación: el mes escrito y sin el día de la semana (antes, «lunes, 22 de junio de 2026»). */
  test("la fecha del informe sigue arriba", async () => {
    const { hojas } = await generar(SEMANAL);
    expect(hojas[0]).toMatch(/Informe semanal\s+·\s+22 de junio de 2026/);
    expect((await generar(DIARIO, "DAILY_REPORT")).hojas[0]).toMatch(/Informe diario\s+·\s+22 de junio de 2026/);
  }, 30_000);
});

describe("las fuentes", () => {
  test.each(VARIANTES)("%s: salen todas, con su enlace, también las de un dominio repetido", async (_nombre, informe, tipo) => {
    const { texto, crudo } = await generar({ ...informe, sources: DOCE }, tipo);
    expect(texto).toContain("Fuentes consultadas");
    expect(texto.match(/morningstar\.com/g)).toHaveLength(3);
    expect(texto.match(/euronext\.com/g)).toHaveLength(2);
    for (const { url } of DOCE) expect(crudo).toContain(`/URI (${url})`);
    expect(crudo.match(/\/URI \(/g)).toHaveLength(12);
  }, 30_000);

  test("enteras quiere decir enteras: el tope de doce es de la pantalla, no del papel", async () => {
    const dieciseis = Array.from({ length: 16 }, (_, i) => fuente(`fuente-${i}.com`, i));
    const { texto, crudo } = await generar({ ...SEMANAL, sources: dieciseis });
    for (let i = 0; i < 16; i += 1) expect(texto).toContain(`fuente-${i}.com`);
    expect(crudo.match(/\/URI \(/g)).toHaveLength(16);
  }, 30_000);

  test.each([
    ["no consta", undefined],
    ["consta vacía", []]
  ])("si la lista %s, se dice, igual que en el correo", async (_caso, sources) => {
    const { texto, crudo } = await generar({ ...SEMANAL, sources });
    expect(texto).toContain("Fuentes consultadas");
    expect(texto).toContain("Este informe no registra sus fuentes.");
    expect(crudo).not.toContain("/URI (");
  }, 30_000);

  test("con fuentes, no dice que no las hay", async () => {
    expect((await generar({ ...SEMANAL, sources: DOCE })).texto).not.toContain("no registra sus fuentes");
  }, 30_000);

  test("las fuentes y el cierre van juntos, tras el informe completo", async () => {
    const { texto } = await generar({ ...SEMANAL, sources: DOCE });
    const completo = texto.indexOf("Informe completo");
    const fuentes = texto.indexOf("Fuentes consultadas");
    const cierre = texto.indexOf("Informe informativo de estrategia");
    expect(completo).toBeGreaterThanOrEqual(0);
    expect(fuentes).toBeGreaterThan(completo);
    expect(cierre).toBeGreaterThan(fuentes);
  }, 30_000);
});

describe("si va pasado de fecha", () => {
  test.each(VARIANTES)("%s: el papel avisa con la misma frase que el correo", async (_nombre, informe, tipo) => {
    const { hojas } = await generar(informe, tipo, { atrasado: true, diasDeAtraso: 6 });
    expect(hojas[0]).toContain("Informe atrasado: tiene 6 días.");
  }, 30_000);

  test("un día, en singular; sin saber cuántos, sin cifra", async () => {
    expect((await generar(SEMANAL, "WEEKLY_REPORT", { atrasado: true, diasDeAtraso: 1 })).hojas[0]).toContain("Informe atrasado: tiene 1 día.");
    expect((await generar(SEMANAL, "WEEKLY_REPORT", { atrasado: true, diasDeAtraso: null })).hojas[0]).toMatch(/Informe atrasado\.(?!\d)/);
  }, 30_000);

  test("un informe al día no avisa, aunque tenga días", async () => {
    expect((await generar(SEMANAL, "WEEKLY_REPORT", { atrasado: false, diasDeAtraso: 3 })).texto).not.toContain("atrasado");
    expect((await generar(SEMANAL)).texto).not.toContain("atrasado");
  }, 30_000);
});

describe("para quién sale", () => {
  /* Más de una hoja: cabecera y pie se repiten, y se comprueban en cada una. La marca de la casa ya no sale: el sello es el del tema. */
  const LARGO = { narrative: "La renta variable mantiene el tono y los beneficios. ".repeat(160) };

  test.each(VARIANTES)("%s: el sello de su tema en cada hoja, y ni la casa ni BDB en ninguna", async (_nombre, informe, tipo) => {
    for (const [conProveedor, sello] of [[true, "Informe de estrategia USO INTERNO No entregar al cliente"], [false, "Informe de estrategia CONFIDENCIAL"]] as const) {
      const { hojas } = await generar({ ...informe, fullReport: LARGO, sources: DOCE }, tipo, undefined, conProveedor);
      expect(hojas.length).toBeGreaterThan(1);
      hojas.forEach((hoja, i) => {
        expect(hoja, `hoja ${i + 1}`).toContain(sello);
        expect(hoja, `hoja ${i + 1}`).not.toMatch(/\bBDB\b|Fundamental Intelligence|Independent|Private Bankers/);
      });
      expect(hojas.join("\n")).toMatch(/Generado el \d{1,2} de [a-z]+ de \d{4}\./);
    }
  }, 60_000);

  test("los metadatos: el asesor como autor (aquí, sin identidad guardada, ninguno), y lo que es en el asunto", async () => {
    const { bytes } = await generar(SEMANAL);
    expect(extractPdfMetadata(bytes, "Author")).toBeNull();
    expect(extractPdfMetadata(bytes, "Subject")).toBe("Redacción automática (IA). Sin revisión humana; cifras de fuentes web.");
    expect(extractPdfMetadata(bytes, "Title")).toBe("Informe semanal - Incertidumbre en tipos, foco en beneficios");
  }, 30_000);
});

describe("los pesos que escribe el modelo no salen en el papel (Óscar, 15-11-2026)", () => {
  /*
   * Los pesos de assetAllocation los propone el modelo y no salen de un cálculo ni de una decisión de la casa: en pantalla
   * van rotulados y en el PDF, que puede acabar delante de un cliente, no van. Esto antes vigilaba el aire entre la cifra y la
   * visión de esas tablas (decisión 42); sin tablas no hay columna que vigilar.
   */
  test("el PDF semanal no lleva ni la sección, ni sus títulos, ni ninguno de sus pesos, y la fuente no vuelve a leer assetAllocation", async () => {
    const { texto } = await generar(SEMANAL);
    for (const titulo of ["Asignación de activos", "Renta variable por región", "Estratégica", "Táctica"]) expect(texto).not.toContain(titulo);
    const asignacion = WEEKLY_REPORT_MOCK.assetAllocation!;
    expect(texto).not.toContain(asignacion.overview.slice(0, 40));
    for (const fila of asignacion.classes) expect(texto).not.toContain(fila.rationale);
    for (const fila of asignacion.regionsEquity) expect(texto).not.toContain(fila.rationale);
    for (const fila of [...asignacion.classes.flatMap((c) => [c.strategicWeight, c.tacticalWeight]), ...asignacion.regionsEquity.map((r) => r.weight)]) {
      expect(texto).not.toContain(peso(fila / 100)!);
    }
    expect(readFileSync("src/reports/weeklyReportPdf.tsx", "utf8")).not.toMatch(/assetAllocation|strategicWeight|tacticalWeight/);
  }, 30_000);
});

describe("las dos variantes", () => {
  test("ni el diario ni el semanal llevan asignación; el semanal sigue con sus indicadores y su texto", async () => {
    expect((await generar(DIARIO, "DAILY_REPORT")).texto).not.toContain("Asignación de activos");
    const semanal = (await generar(SEMANAL)).texto;
    expect(semanal).not.toContain("Asignación de activos");
    expect(semanal).toContain("Indicadores");
    expect(semanal).toContain("Informe completo");
  }, 30_000);
});
