// @vitest-environment happy-dom

/**
 * Estrategia: quién firma y qué se comparte (decisiones 21 y 23 de Óscar, 04-11-2026). Lo redacta un
 * modelo con búsquedas web, y se dice; «Compartir» no sale sin confirmar que se ha leído; y lo que sale
 * lleva fecha, aviso si va atrasado, fuentes y la firma del asesor que lo envía, si la ha escrito (INF-05).
 */
import { readFileSync } from "node:fs";
import { URL as UrlDeNode } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/adapters/weeklyReportBackend", () => ({ fetchWeeklyReportResult: vi.fn() }));
vi.mock("../src/reports/weeklyReportPdf", () => ({ downloadWeeklyReportPdf: vi.fn().mockResolvedValue(undefined) }));

import { fetchWeeklyReportResult } from "../src/adapters/weeklyReportBackend";
import { downloadWeeklyReportPdf } from "../src/reports/weeklyReportPdf";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { avisoDeAtraso, mensajeDeEstrategia } from "../src/core/compartirEstrategia";
import { guardarIdentidad } from "../src/core/identidadDelAsesor";
import { WEEKLY_REPORT_MOCK } from "../src/data/weeklyReportMock";
import { StrategyPage } from "../src/pages/StrategyPage";

const INFORME = {
  summary: { headline: "Pausa de la Fed", narrative: "Sesión mixta." },
  sources: [
    { title: "morningstar.com", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA" },
    { title: "cnn.com", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB" },
    { title: "morningstar.com", url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/CCC" }
  ]
};

describe("lo que se comparte", () => {
  const mensaje = (o: Partial<Parameters<typeof mensajeDeEstrategia>[0]> = {}) =>
    mensajeDeEstrategia({ titulo: "Informe diario de mercados", fecha: "29 oct 2026", informe: INFORME, atrasado: false, diasDeAtraso: 0, ...o });

  /* INF-05: antes firmaba una casa escrita en el código («Independent Private Bankers»). Lo firma el asesor que lo envía. */
  test("firma con el nombre y la entidad del asesor, y la entidad va en el asunto", () => {
    const { asunto, cuerpo } = mensaje({ firma: { nombre: "Lucía Pérez", entidad: "Pérez Patrimonios" } });
    expect(asunto).toBe("Informe diario de mercados · Pérez Patrimonios");
    expect(cuerpo.endsWith("\n\nLucía Pérez\nPérez Patrimonios")).toBe(true);
    expect(`${asunto} ${cuerpo}`).not.toMatch(/BDB|Fundamental Intelligence|Private Bankers|Andbank/i);
  });

  test("solo con el nombre, firma el nombre y no inventa una entidad", () => {
    const { asunto, cuerpo } = mensaje({ firma: { nombre: "  Lucía Pérez ", entidad: "  " } });
    expect(asunto).toBe("Informe diario de mercados · Lucía Pérez");
    expect(cuerpo.endsWith("\n\nLucía Pérez")).toBe(true);
  });

  test("sin identidad, sin firma de entidad: el asunto es el título y el correo acaba en las fuentes", () => {
    for (const firma of [undefined, {}]) {
      const { asunto, cuerpo } = mensaje({ firma });
      expect(asunto).toBe("Informe diario de mercados");
      expect(cuerpo.endsWith("Fuentes consultadas: morningstar.com, cnn.com.")).toBe(true);
      expect(`${asunto} ${cuerpo}`).not.toMatch(/Private Bankers|Andbank|preparado por/i);
    }
  });

  test("el módulo no escribe el nombre de ninguna entidad", () => {
    const fuente = readFileSync(new UrlDeNode("../src/core/compartirEstrategia.ts", import.meta.url), "utf8");
    expect(fuente).not.toMatch(/private bankers|andbank/i);
  });

  test("lleva fecha, quién lo ha escrito, titular y texto", () => {
    const { cuerpo } = mensaje();
    expect(cuerpo).toContain("Informe diario de mercados · 29 oct 2026");
    expect(cuerpo).toContain("Redacción automática (IA). Sin revisión humana; cifras de fuentes web.");
    expect(cuerpo).toContain("Pausa de la Fed");
    expect(cuerpo).toContain("Sesión mixta.");
  });

  test("las fuentes van por su título, una vez cada una, y no sus redirecciones", () => {
    const { cuerpo } = mensaje();
    expect(cuerpo).toContain("Fuentes consultadas: morningstar.com, cnn.com.");
    expect(cuerpo).not.toContain("vertexaisearch");
  });

  test("si no registra fuentes, se dice", () => {
    expect(mensaje({ informe: { summary: INFORME.summary } }).cuerpo).toContain("Este informe no registra sus fuentes.");
  });

  test("avisa si va atrasado, y no si no lo va", () => {
    expect(mensaje({ atrasado: true, diasDeAtraso: 6 }).cuerpo).toContain("Informe atrasado: tiene 6 días.");
    expect(mensaje().cuerpo).not.toContain("atrasado");
    expect(avisoDeAtraso(true, 1)).toBe("Informe atrasado: tiene 1 día.");
    expect(avisoDeAtraso(true, null)).toBe("Informe atrasado.");
    expect(avisoDeAtraso(false, 9)).toBeNull();
  });

  test("con doce fuentes de las de verdad, el correo sigue cabiendo en un enlace", () => {
    const sources = Array.from({ length: 12 }, (_, i) => ({
      title: `fuente-${i}.com`,
      url: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${"x".repeat(400)}`
    }));
    const { asunto, cuerpo } = mensaje({ informe: { summary: { headline: "Titular", narrative: "n".repeat(300) }, sources } });
    expect(`mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`.length).toBeLessThan(2000);
  });
});

describe("la pantalla", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;
  const compartir = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    compartir.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: compartir });
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    host.remove();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "share");
  });

  const pintar = async (modoCliente = false, freshness: "CURRENT" | "STALE" = "STALE") => {
    vi.mocked(fetchWeeklyReportResult).mockResolvedValue({
      report: { ...WEEKLY_REPORT_MOCK, author: "Mesa de Analisis", provider: "Gemini con Google Search", sources: INFORME.sources },
      source: "test",
      freshness,
      age_days: 6,
      invalid_count: 0
    });
    await act(async () => {
      root!.render(
        <ClientModeProvider initialValue={modoCliente}>
          <StrategyPage embedded />
        </ClientModeProvider>
      );
    });
  };
  const boton = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

  test("el autor es lo que es, aunque el documento guardado diga otra cosa", async () => {
    await pintar();
    const descripcion = host.querySelector(".strategy-page .panel__subtitle")?.textContent ?? "";
    expect(descripcion).toContain("Redacción automática (IA)");
    expect(descripcion).toContain("Sin revisión humana; cifras de fuentes web.");
    expect(descripcion).toContain("Gemini con Google Search");
    expect(host.textContent).not.toContain("Mesa de");
  });

  test("Modo cliente: fuera el proveedor; el autor y la nota se quedan", async () => {
    await pintar(true);
    const descripcion = host.querySelector(".strategy-page .panel__subtitle")?.textContent ?? "";
    expect(descripcion).toContain("Redacción automática (IA)");
    expect(descripcion).toContain("Sin revisión humana; cifras de fuentes web.");
    expect(descripcion).not.toContain("Gemini");
  });

  test("«Compartir con cliente» no sale sin confirmar que se ha leído", async () => {
    await pintar();
    await act(async () => boton("Compartir con cliente")!.click());
    const dialogo = document.body.querySelector('[role="dialog"]');
    expect(dialogo?.textContent).toContain("¿Has leído este informe?");
    expect(dialogo?.textContent).toContain("Informe atrasado: tiene 6 días.");
    expect(compartir).not.toHaveBeenCalled();

    await act(async () => boton("Cancelar")!.click());
    expect(compartir).not.toHaveBeenCalled();

    await act(async () => boton("Compartir con cliente")!.click());
    await act(async () => boton("Lo he leído: compartir")!.click());
    expect(compartir).toHaveBeenCalledTimes(1);
    const { title, text } = compartir.mock.calls[0][0] as { title: string; text: string };
    /* Sin identidad guardada, el correo no firma ninguna entidad (INF-05). */
    expect(title).toBe("Informe diario de mercados");
    expect(`${title} ${text}`).not.toMatch(/Private Bankers|Andbank/i);
    expect(text).toContain("Fuentes consultadas: morningstar.com, cnn.com.");
    expect(text).toContain("Informe atrasado: tiene 6 días.");
    expect(text).toContain("Redacción automática (IA)");
  });

  test("INF-05: con la identidad del asesor guardada, el correo firma con ella", async () => {
    guardarIdentidad({ nombre: "Lucía Pérez", entidad: "Pérez Patrimonios" });
    try {
      await pintar();
      await act(async () => boton("Compartir con cliente")!.click());
      await act(async () => boton("Lo he leído: compartir")!.click());
      const { title, text } = compartir.mock.calls[0][0] as { title: string; text: string };
      expect(title).toBe("Informe diario de mercados · Pérez Patrimonios");
      expect(text.endsWith("Lucía Pérez\nPérez Patrimonios")).toBe(true);
    } finally {
      guardarIdentidad({});
    }
  });

  test("un informe al día no avisa de ningún atraso", async () => {
    await pintar(false, "CURRENT");
    await act(async () => boton("Compartir con cliente")!.click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).not.toContain("atrasado");
  });

  test("el PDF se descarga con el mismo atraso que enseña la pantalla", async () => {
    await pintar(false, "STALE");
    await act(async () => boton("Descargar el informe")!.click());
    expect(vi.mocked(downloadWeeklyReportPdf)).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: WEEKLY_REPORT_MOCK.id }),
      "DAILY_REPORT",
      { atrasado: true, diasDeAtraso: 6 },
      true
    );
  });

  test("un informe al día se descarga sin aviso, aunque tenga días", async () => {
    await pintar(false, "CURRENT");
    await act(async () => boton("Descargar el informe")!.click());
    expect(vi.mocked(downloadWeeklyReportPdf)).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: WEEKLY_REPORT_MOCK.id }),
      "DAILY_REPORT",
      { atrasado: false, diasDeAtraso: 6 },
      true
    );
  });

  test("en Modo cliente el PDF no nombra al proveedor, como la pantalla y el correo (decisión 67)", async () => {
    await pintar(true, "CURRENT");
    await act(async () => boton("Descargar el informe")!.click());
    expect(vi.mocked(downloadWeeklyReportPdf)).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: WEEKLY_REPORT_MOCK.id }),
      "DAILY_REPORT",
      { atrasado: false, diasDeAtraso: 6 },
      false
    );
  });

  test("las cifras son filas, y los riesgos llevan el número de su punto", async () => {
    await pintar();
    expect([...host.querySelectorAll(".strategy-kpi dt")].map((n) => n.textContent)).toEqual(["S&P 500", "Yield 10Y US", "VIX"]);
    expect(host.querySelector(".strategy-kpi dd .mercado-tendencia")?.getAttribute("aria-label")).toBe("Sube");
    expect(host.querySelector(".strategy-kpi i, .strategy-kpi .cifra--sube, .strategy-kpi .cifra--baja")).toBeNull();
    expect([...host.querySelectorAll(".strategy-risk-matrix li > span")].map((n) => n.textContent)).toEqual(["1", "2"]);
  });
});
