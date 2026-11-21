/**
 * Decisión 69 de Óscar (05-11-2026): el servidor guarda la dirección final de cada fuente. Quien lee no lo sabe: el
 * papel y el correo leen `title` y `url`, venga de donde venga, y lo que el servidor añade para saber cuáles quedan
 * (`redirect_url`, `link_issue`) no llega a imprimirse. El sitio publicado hoy tiene que poder leerlo igual.
 */
import { describe, expect, test } from "vitest";
import { parseWeeklyReportResponse } from "../src/adapters/weeklyReportBackend";
import { mensajeDeEstrategia } from "../src/core/compartirEstrategia";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { createWeeklyReportPdfBlob } from "../src/reports/weeklyReportPdf";
import type { WeeklyReport } from "../src/types/weeklyReport";
import { extractPdfPageTexts } from "./support/pdfText";

const GOOGLE = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";
const LARGA = `https://www.example.com/informe/${"a".repeat(1900)}`;

const DEL_SERVIDOR = [
  { title: "europa.eu", url: "https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp261029.en.html?id=1&y=2", redirect_url: `${GOOGLE}AAA` },
  { title: "bls.gov", url: "https://www.bls.gov/news.release/cpi.nr0.htm", redirect_url: `${GOOGLE}BBB`, link_issue: "HTTP_403" },
  { title: "wikipedia.org", url: "https://es.wikipedia.org/wiki/Banco_(finanzas)", redirect_url: `${GOOGLE}CCC` },
  { title: "elpais.com", url: "https://elpais.com/econom%C3%ADa/a%C3%B1o%20nuevo.html", redirect_url: `${GOOGLE}DDD` },
  { title: "example.com", url: LARGA, redirect_url: `${GOOGLE}EEE` },
  { title: "caducado.com", url: `${GOOGLE}FFF`, link_issue: "TIMEOUT" }
];

function respuestaDelServidor(sources: object[], generation: object) {
  return {
    schema_version: "strategy-report-response.v2",
    source: "FIRESTORE_LIVE",
    freshness: "CURRENT",
    age_days: 0,
    invalid_count: 0,
    report: { ...WEEKLY_REPORT_MOCK, sources, generation }
  };
}

const LEIDO = parseWeeklyReportResponse(
  respuestaDelServidor(DEL_SERVIDOR, {
    generated_at: "2026-11-05T07:00:00Z",
    grounded: true,
    research_model: "research",
    report_model: "writer",
    source_count: 6,
    source_resolution: { total: 7, final: 3, unconfirmed: 1, unresolved: 2, duplicates_removed: 1, seconds: 3.4, reasons: { HTTP_403: 1, TIMEOUT: 1 } }
  })
);
const INFORME: WeeklyReport = LEIDO.report as WeeklyReport;

async function generar(informe: WeeklyReport) {
  const bytes = Buffer.from(await (await createWeeklyReportPdfBlob(informe, "WEEKLY_REPORT")).arrayBuffer());
  const hojas = extractPdfPageTexts(bytes);
  return { hojas, texto: hojas.join("\n"), crudo: bytes.toString("latin1") };
}

describe("lo que llega del servidor", () => {
  test("se lee igual, con la dirección final en `url`, y lo demás se queda fuera", () => {
    expect(INFORME.sources).toEqual(DEL_SERVIDOR.map(({ title, url }) => ({ title, url })));
    expect(INFORME.generation?.source_count).toBe(6);
  });

  test("lo guardado antes, sin marcas, también", () => {
    const antes = parseWeeklyReportResponse(respuestaDelServidor([{ title: "cnn.com", url: `${GOOGLE}AAA` }], { source_count: 1 }));
    expect(antes.report?.sources).toEqual([{ title: "cnn.com", url: `${GOOGLE}AAA` }]);
  });
});

describe("el papel", () => {
  test("enlaza a la dirección final e imprime el mismo título", async () => {
    const { texto, crudo } = await generar(INFORME);
    for (const { title } of DEL_SERVIDOR) expect(texto).toContain(title);
    expect(crudo.match(/\/URI \(/g)).toHaveLength(DEL_SERVIDOR.length);
    expect(crudo).toContain(`/URI (${DEL_SERVIDOR[0].url})`);
    expect(crudo).toContain(`/URI (${DEL_SERVIDOR[1].url})`);
    expect(crudo).toContain(`/URI (${DEL_SERVIDOR[3].url})`);
    expect(crudo).toContain(`/URI (${LARGA})`);
    expect(crudo).toContain(`/URI (${GOOGLE}FFF)`);
    /* Un paréntesis no rompe el enlace: en el PDF va escapado. */
    expect(crudo).toContain("/URI (https://es.wikipedia.org/wiki/Banco_\\(finanzas\\))");
  }, 30_000);

  test("no imprime nada de lo que el servidor guarda para saber cuáles quedan", async () => {
    const { texto, crudo } = await generar(INFORME);
    expect(texto).not.toMatch(/HTTP_403|TIMEOUT|redirect_url|link_issue/);
    for (const clave of ["AAA", "BBB", "CCC", "DDD", "EEE"]) expect(crudo).not.toContain(`${GOOGLE}${clave}`);
  }, 30_000);

  test("el texto de las hojas no depende de adónde apunte el enlace", async () => {
    const fechaDeHoy = (hojas: string[]) => hojas.join("\n").replace(/Generado por[\s\S]*?\./, "");
    const conGoogle = await generar({ ...INFORME, sources: DEL_SERVIDOR.map(({ title }, i) => ({ title, url: `${GOOGLE}${i}` })) });
    const conFinal = await generar(INFORME);
    expect(conFinal.hojas).toHaveLength(conGoogle.hojas.length);
    expect(fechaDeHoy(conFinal.hojas)).toBe(fechaDeHoy(conGoogle.hojas));
  }, 60_000);
});

describe("el correo", () => {
  const cuerpo = (sources: WeeklyReport["sources"]) =>
    mensajeDeEstrategia({ titulo: "Informe semanal", fecha: "5 nov 2026", informe: { summary: INFORME.summary, sources }, atrasado: false, diasDeAtraso: 0 }).cuerpo;

  test("nombra las fuentes por su título: no cambia nada y no lleva enlaces", () => {
    const conGoogle = cuerpo(DEL_SERVIDOR.map(({ title }, i) => ({ title, url: `${GOOGLE}${i}` })));
    expect(cuerpo(INFORME.sources)).toBe(conGoogle);
    expect(conGoogle).toContain("Fuentes consultadas: europa.eu, bls.gov, wikipedia.org, elpais.com, example.com, caducado.com.");
    expect(conGoogle).not.toContain("http");
  });
});
