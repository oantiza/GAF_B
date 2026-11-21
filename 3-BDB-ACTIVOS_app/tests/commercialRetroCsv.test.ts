import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCommercialRetroPreview,
  diaDeHoyLocal,
  exportCommercialRetroCsv,
  parseCommercialRetroCsv,
  parseCommercialRetroExcel
} from "../src/core/commercialRetroCsv";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";
import { utils, write } from "xlsx";

/* S-15 (auditoría 29-09): el fixture se construye con SheetJS, el único
   lector/escritor de hojas de cálculo (antes se zipeaba OOXML a mano con fflate).
   Las celdas son texto con coma decimal, como el fichero compacto original. */
function buildRetroXlsx(): ArrayBuffer {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([
    ["isin", "retro_pct"],
    ["LU1021288268", "0,325"],
    ["LU1548497699", "0,572"]
  ]), "Retrocesiones");
  return write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("commercial retro CSV", () => {
  it("parses the compact isin and retro_pct format", () => {
    const parsed = parseCommercialRetroCsv([
      "isin;retro_pct",
      "LU1021288268;0,325",
      "LU1548497699;0,572"
    ].join("\n"));

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries.map((entry) => entry.retro_pct)).toEqual([0.325, 0.572]);
    expect(parsed.entries.every((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.as_of_date))).toBe(true);
  });

  it("does not require or validate as_of_date for compact imports", () => {
    const parsed = parseCommercialRetroCsv([
      "isin;retro_pct",
      "LU1021288268;0,325",
      "LU1548497699;0,572"
    ].join("\n"));

    expect(parsed.issues.map((issue) => issue.message)).not.toContain("Fecha as_of_date no válida; usa AAAA-MM-DD.");
    expect(parsed.entries).toHaveLength(2);
  });

  it("keeps comma decimals together when comma-separated compact rows are pasted", () => {
    const parsed = parseCommercialRetroCsv([
      "isin,retro_pct",
      "LU1021288268,0,325"
    ].join("\n"));

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries[0].retro_pct).toBe(0.325);
  });

  it("parses Excel files with the same compact format", async () => {
    const parsed = await parseCommercialRetroExcel(buildRetroXlsx());

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => [entry.isin, entry.retro_pct])).toEqual([
      ["LU1021288268", 0.325],
      ["LU1548497699", 0.572]
    ]);
  });

  it("parses semicolon, tab and comma separated rows with European decimals", () => {
    const parsed = parseCommercialRetroCsv([
      "isin;retro_pct;as_of_date;nota",
      "IE00B4L5Y983;0,45;2026-06-30;Clase limpia",
      "IE00B18GC888\t0,5\t2026-06-29\tBenchmark",
      "LU0404220724,1,25,2026-06-28,Nota con coma"
    ].join("\n"));

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries.map((entry) => entry.retro_pct)).toEqual([0.45, 0.5, 1.25]);
    expect(parsed.entries[2]).toMatchObject({
      isin: "LU0404220724",
      note: "Nota con coma"
    });
  });

  it("reports invalid rows and duplicated ISINs", () => {
    const parsed = parseCommercialRetroCsv([
      "BAD;0,45;2026-06-30;mal",
      "IE00B4L5Y983;101;2026-06-30;fuera rango",
      "IE00B4L5Y983;0,45;2026-06-30;ok",
      "IE00B4L5Y983;0,50;2026-06-30;duplicado"
    ].join("\n"));

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.issues.map((issue) => issue.message)).toEqual([
      "ISIN no válido.",
      "Retrocesión fuera de rango 0-100.",
      "ISIN duplicado en el import."
    ]);
  });

  it("builds create/update/unchanged preview rows", () => {
    const parsed = parseCommercialRetroCsv([
      "IE00B4L5Y983;0,45;2026-06-30;Clase limpia",
      "IE00B18GC888;0,55;2026-06-29;Benchmark",
      "LU0404220724;1,25;2026-06-28;Nuevo"
    ].join("\n"));
    const existing = new Map<string, CommercialRetroRecord>([
      ["IE00B4L5Y983", { isin: "IE00B4L5Y983", retro_pct: 0.45, as_of_date: "2026-06-30", source: "ADMIN_UI", note: "Clase limpia" }],
      ["IE00B18GC888", { isin: "IE00B18GC888", retro_pct: 0.5, as_of_date: "2026-06-29", source: "ADMIN_UI", note: "Benchmark" }]
    ]);

    const preview = buildCommercialRetroPreview(parsed.entries, existing);

    expect(preview.map((row) => row.action)).toEqual(["UNCHANGED", "UPDATE", "CREATE"]);
    expect(preview[1].changes).toContain("retro_pct 0.5 -> 0.55");
  });

  it("confirms a pending row even when the file brings the same percentage (ALTA-19.2)", () => {
    const parsed = parseCommercialRetroCsv([
      "IE00B4L5Y983;0,45;2026-06-30;Clase limpia",
      "IE00B18GC888;0,5;2026-07-31;Benchmark"
    ].join("\n"));
    const existing = new Map<string, CommercialRetroRecord>([
      ["IE00B4L5Y983", { isin: "IE00B4L5Y983", retro_pct: 0.45, as_of_date: "2026-06-30", source: "ADMIN_UI", note: "Clase limpia", status: "PENDING_CONFIRMATION" }],
      ["IE00B18GC888", { isin: "IE00B18GC888", retro_pct: 0.5, as_of_date: "2026-06-29", source: "ADMIN_UI", note: "Benchmark", status: "PENDING_CONFIRMATION" }]
    ]);

    const preview = buildCommercialRetroPreview(parsed.entries, existing);

    expect(preview.map((row) => row.action)).toEqual(["UPDATE", "UPDATE"]);
    expect(preview[0].changes).toEqual(["confirmar (pendiente)"]);
    // La fecha de vigencia acompaña a la confirmación cuando cambia.
    expect(preview[1].changes).toEqual(["confirmar (pendiente)", "as_of_date 2026-06-29 -> 2026-07-31"]);
    // Una fila ya confirmada con el mismo valor sigue sin reescribirse.
    const confirmed = new Map([...existing].map(([isin, record]) => [isin, { ...record, status: "CONFIRMED" as const }]));
    expect(buildCommercialRetroPreview(parsed.entries, confirmed).map((row) => row.action)).toEqual(["UNCHANGED", "UNCHANGED"]);
  });

  it("exports a semicolon CSV with Spanish decimal formatting", () => {
    const csv = exportCommercialRetroCsv([
      { isin: "IE00B4L5Y983", retro_pct: 0.45, as_of_date: "2026-06-30", source: "ADMIN_UI", note: "Clase limpia" }
    ]);

    expect(csv).toContain("isin;retro_pct");
    expect(csv).toContain("IE00B4L5Y983;0,45");
  });
});

describe("la fecha de hoy de una retrocesión es la del calendario del asesor, no la de Greenwich (PLA-09, FMT-19)", () => {
  const zona = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (zona === undefined) delete process.env.TZ;
    else process.env.TZ = zona;
  });

  it("a las 00:30 de Madrid del 14 de noviembre (23:30 UTC del 13), hoy es el 14", () => {
    process.env.TZ = "Europe/Madrid";
    expect(diaDeHoyLocal(new Date("2026-11-13T23:30:00Z"))).toBe("2026-11-14");
    /* En verano, UTC+2: a las 01:30 de Madrid del 15 de julio son las 23:30 UTC del 14. */
    expect(diaDeHoyLocal(new Date("2026-07-14T23:30:00Z"))).toBe("2026-07-15");
  });

  it("una importación sin fecha toma por vigencia el día de hoy de Madrid", () => {
    process.env.TZ = "Europe/Madrid";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T23:30:00Z"));
    const parsed = parseCommercialRetroCsv(["isin;retro_pct", "LU1021288268;0,325"].join("\n"));
    expect(parsed.entries.map((entry) => entry.as_of_date)).toEqual(["2026-11-14"]);
  });
});
