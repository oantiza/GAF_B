/**
 * Decisión 120 (Óscar, 06-11-2026, opción A): la aplicación conoce las siete marcas de la revisión del histórico que el servidor añade a 85
 * fondos (`functions_python/fund_history_policies.json`). Las cinco que limitan la historia son avisos, con su nombre; las dos buenas noticias
 * dejan de contarse como aviso, en la lista y en la cuenta. Pantalla y papel dicen lo mismo, y ninguna cifra ni ninguna propuesta cambia: la
 * decisión es de decir, no de calcular.
 *
 * Los casos son los de las bases, medidos el 06-11-2026 con el camino de producción en 8092 y en 8082 (iguales en las dos): Goldman Sachs
 * Absolute Return Tracker (LU1103307408) trae HISTORY_CONTINUITY_UNVERIFIED y un aviso; AB American Growth (LU0232524495) trae
 * TOTAL_RETURN_RECONCILED y un aviso, que debe ser cero; Hamco Global Value (LU3038481936), PREDECESSOR_CONTINUITY_DOCUMENTED y un aviso,
 * que debe ser cero; NH Hoteles (ES0161560018), una acción, PRICE_FROZEN_DELISTED y MISSING_HOLDINGS, dos avisos, que son uno.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { demoResponse } from "../src/adapters/demoBackend";

const RESOLVE = vi.hoisted(() => ({ filas: [] as unknown[] }));
vi.mock("../src/adapters/callableBackend", () => ({
  callBackend: (name: string, data: unknown) => (name === "resolve_portfolio" ? Promise.resolve({ rows: RESOLVE.filas, warnings: [] }) : demoResponse(name, data))
}));

import { bdbLiveApiAdapterTestHelpers, resolveLiveApiPortfolioPositions } from "../src/adapters/bdbLiveApiAdapter";
import { parseLiveAssetDetailResponse } from "../src/adapters/bdbLiveApiContracts";
import { columnasDeComposicion, filasDeComposicion, textoDeCalidad } from "../src/adapters/tablaDeComposicion";
import { PortfolioDataDiagnostic } from "../src/components/PortfolioDataDiagnostic";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bloqueadoPorCalidadDelDato, historicalSelectionRestriction, isInvestableAsset, seConservaEnLaCartera } from "../src/core/assetMapping";
import { MARCAS_DE_LA_REVISION_DEL_HISTORICO, MARCAS_QUE_NO_SON_AVISO, QUALITY_FLAG_LABELS } from "../src/core/labels";
import { recuentoEnPantalla } from "../src/core/medidaDeLaCartera";
import { buildLocalOptimizationPreview } from "../src/core/optimizationPreview";
import { buildReportFromAssets, buildSummaryFromAssets } from "../src/core/portfolio";
import { createInternalPortfolioReportPdfBlob } from "../src/reports/internalPortfolioReportPdf";
import type { InternalReportInput } from "../src/core/internalPortfolioReport";
import type { BdbAssetDetail } from "../src/types/bdbAssets";
import { extractPdfPageTexts } from "./support/pdfText";

const CINCO = ["HISTORY_CONTINUITY_UNVERIFIED", "HISTORY_RESTRICTED_AFTER_REVIEW", "TOTAL_RETURN_UNVERIFIED", "HISTORY_SPLICED_SISTER_CLASS", "PRICE_FROZEN_DELISTED"];

/** Una respuesta de `get_asset_detail` o `compare_assets` como la del servidor: un aviso por marca, en inglés, y su cuenta. */
function delServidor(asset_id: string, instrument_type: string, marcas: string[], extra: Record<string, unknown> = {}) {
  return parseLiveAssetDetailResponse({
    asset_id, instrument_type, economic_asset_class: "EQUITY", is_investable: true, role: "INVESTABLE", coverage_status: "COMPLETE",
    identity: { display_name: `Activo ${asset_id}`, currency: "EUR" },
    metrics: { annualized_return_3y: 0.05, volatility_3y: 0.1, sharpe_3y: 0.4, metrics_method: "GEOMETRIC_CAGR" },
    pms_exposure: { equity: 1 },
    quality_flags: marcas,
    data_quality_summary: {
      coverage_status: "COMPLETE", has_identity: true, has_metrics: true, has_pms_exposure: true, has_costs: true, has_holdings_summary: true,
      has_fundamentals: false, has_history_years: false, quality_flags: marcas, warnings_count: marcas.length
    },
    ...extra
  })!;
}
const activo = (...args: Parameters<typeof delServidor>) => bdbLiveApiAdapterTestHelpers.mapDetail(delServidor(...args));

const GOLDMAN = () => activo("LU1103307408", "FUND", ["HISTORY_CONTINUITY_UNVERIFIED"]);
const AB = () => activo("LU0232524495", "FUND", ["TOTAL_RETURN_RECONCILED"]);
const HAMCO = () => activo("LU3038481936", "FUND", ["PREDECESSOR_CONTINUITY_DOCUMENTED"]);
const NH = () => activo("ES0161560018", "STOCK", ["PRICE_FROZEN_DELISTED", "MISSING_HOLDINGS"]);
const LIMPIO = () => activo("LU0430492750", "FUND", []);

describe("los nombres: siete, y en un solo sitio", () => {
  test("las cinco que limitan la historia y las dos buenas noticias, con el nombre de Sistema › Calidad", () => {
    expect(Object.keys(MARCAS_DE_LA_REVISION_DEL_HISTORICO).sort()).toEqual([...CINCO, ...MARCAS_QUE_NO_SON_AVISO].sort());
    expect(QUALITY_FLAG_LABELS.HISTORY_CONTINUITY_UNVERIFIED).toBe("Continuidad de la clase pendiente");
    expect(QUALITY_FLAG_LABELS.HISTORY_RESTRICTED_AFTER_REVIEW).toBe("Histórico limitado a tramos revisados");
    expect(QUALITY_FLAG_LABELS.TOTAL_RETURN_UNVERIFIED).toBe("Rentabilidad total pendiente de conciliar");
    expect(QUALITY_FLAG_LABELS.HISTORY_SPLICED_SISTER_CLASS).toBe("Histórico empalmado con una clase hermana");
    expect(QUALITY_FLAG_LABELS.PRICE_FROZEN_DELISTED).toBe("Excluido de cotización: último precio prolongado plano hasta hoy");
    expect([...MARCAS_QUE_NO_SON_AVISO].sort()).toEqual(["PREDECESSOR_CONTINUITY_DOCUMENTED", "TOTAL_RETURN_RECONCILED"]);
  });

  test("cada nombre se escribe una sola vez en el código: no hay una segunda copia que se pueda quedar atrás", () => {
    const raiz = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const ficheros = (dir: string, out: string[] = []): string[] => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) ficheros(ruta, out);
        else if (/\.(ts|tsx)$/.test(nombre)) out.push(ruta);
      }
      return out;
    };
    const fuentes = ficheros(raiz).map((ruta) => ({ ruta, texto: readFileSync(ruta, "utf8") }));
    for (const nombre of Object.values(MARCAS_DE_LA_REVISION_DEL_HISTORICO)) {
      const donde = fuentes.filter((f) => f.texto.includes(`"${nombre}"`)).map((f) => f.ruta.split(/[\\/]/).at(-1));
      expect(donde, nombre).toEqual(["labels.ts"]);
    }
  });
});

describe("el adaptador: las cinco se conservan como aviso, las dos buenas noticias no cuentan", () => {
  test("Goldman: la marca llega, con su nombre en español, y su cuenta sigue en uno", () => {
    const goldman = GOLDMAN();
    expect(goldman.quality_flags).toEqual(["HISTORY_CONTINUITY_UNVERIFIED"]);
    expect(goldman.warnings).toEqual([
      { code: "HISTORY_CONTINUITY_UNVERIFIED", severity: "LOW", message: "Aviso de datos: Continuidad de la clase pendiente.", asset_id: "LU1103307408" }
    ]);
    expect(goldman.data_quality_summary).toMatchObject({ quality_flags: ["HISTORY_CONTINUITY_UNVERIFIED"], warnings_count: 1 });
  });

  test.each(CINCO)("%s se conserva, en la ficha y en el buscador", (marca) => {
    const detalle = activo("X", "FUND", [marca]);
    expect(detalle.quality_flags).toEqual([marca]);
    expect(detalle.warnings[0].message).toBe(`Aviso de datos: ${QUALITY_FLAG_LABELS[marca]}.`);
    expect(detalle.warnings[0].message).not.toMatch(/Data quality|_/);
    const busqueda = bdbLiveApiAdapterTestHelpers.mapSearch({ asset_id: "X", instrument_type: "FUND", quality_flags: [marca], is_investable: true, role: "INVESTABLE" });
    expect(busqueda.quality_flags).toEqual([marca]);
  });

  test("AB American Growth y Hamco: «1 aviso» pasa a cero, sin marca ni aviso", () => {
    for (const fondo of [AB(), HAMCO()]) {
      expect(fondo.quality_flags, fondo.asset_id).toEqual([]);
      expect(fondo.warnings, fondo.asset_id).toEqual([]);
      expect(fondo.data_quality_summary, fondo.asset_id).toMatchObject({ quality_flags: [], warnings_count: 0 });
      expect(textoDeCalidad(fondo.data_quality_summary), fondo.asset_id).toBe("Completa · 0 avisos");
    }
  });

  test("una buena noticia con otros avisos solo resta la suya", () => {
    const fondo = activo("X", "FUND", ["TOTAL_RETURN_RECONCILED", "MISSING_HOLDINGS", "PARTIAL_COVERAGE"]);
    expect(fondo.quality_flags).toEqual(["MISSING_HOLDINGS", "PARTIAL_COVERAGE"]);
    expect(fondo.data_quality_summary).toMatchObject({ quality_flags: ["MISSING_HOLDINGS", "PARTIAL_COVERAGE"], warnings_count: 2 });
  });

  test("NH Hoteles, una acción: dos avisos del servidor son uno, el de su precio, como ya se quitaba la cartera que no le aplica", () => {
    const nh = NH();
    expect(nh.quality_flags).toEqual(["PRICE_FROZEN_DELISTED"]);
    expect(nh.data_quality_summary).toMatchObject({ quality_flags: ["PRICE_FROZEN_DELISTED"], warnings_count: 1 });
  });

  test("las filas de resolve_portfolio, igual", async () => {
    RESOLVE.filas = [
      { asset_id: "LU1103307408", instrument_type: "FUND", quality_flags: ["HISTORY_CONTINUITY_UNVERIFIED"], is_investable: true, role: "INVESTABLE" },
      { asset_id: "LU0232524495", instrument_type: "FUND", quality_flags: ["TOTAL_RETURN_RECONCILED"], is_investable: true, role: "INVESTABLE" }
    ];
    const filas = await resolveLiveApiPortfolioPositions([{ asset_id: "LU1103307408", amount: 1 }, { asset_id: "LU0232524495", amount: 1 }]);
    expect(filas.map((fila) => fila.asset?.quality_flags)).toEqual([["HISTORY_CONTINUITY_UNVERIFIED"], []]);
    expect(filas.every((fila) => fila.asset?.is_investable)).toBe(true);
  });
});

describe("decir, no calcular: ninguna regla decide por estas marcas", () => {
  test.each(CINCO)("con %s un fondo sigue siendo invertible, proponible y medible", (marca) => {
    const fondo = activo("X", "FUND", [marca]);
    expect(isInvestableAsset(fondo)).toBe(true);
    expect(historicalSelectionRestriction(fondo)).toBeUndefined();
    expect(bloqueadoPorCalidadDelDato(fondo)).toBe(false);
    expect(seConservaEnLaCartera(fondo)).toBe(true);
  });

  test("la cartera con Goldman: los mismos elegibles, el mismo reparto, la misma validez que sin la marca", () => {
    const posiciones = [{ asset_id: "LU1103307408", weight_percent: 40 }, { asset_id: "LU0232524495", weight_percent: 30 }, { asset_id: "LU0430492750", weight_percent: 30 }];
    const conMarcas = [GOLDMAN(), AB(), LIMPIO()];
    const sinMarcas = conMarcas.map((a) => ({ ...a, quality_flags: [], warnings: [] }) as BdbAssetDetail);
    const resumen = (assets: BdbAssetDetail[]) => buildSummaryFromAssets({ source: "BBDD_LIVE_API", manualPositions: posiciones, assets });
    const sin = resumen(sinMarcas);
    const con = resumen(conMarcas);
    expect(con).toEqual(sin);
    const vista = (assets: BdbAssetDetail[], summary: typeof con) => buildLocalOptimizationPreview({ sourceKind: "BBDD_LIVE_API", positions: posiciones, assets, summary });
    expect(vista(conMarcas, con).eligible_assets.map((a) => [a.asset_id, a.weight_percent])).toEqual(vista(sinMarcas, sin).eligible_assets.map((a) => [a.asset_id, a.weight_percent]));
    expect(vista(conMarcas, con).excluded_assets).toEqual([]);
  });
});

describe("Análisis: la cuenta y su diagnóstico dicen cuál", () => {
  const posiciones = [{ asset_id: "LU1103307408", weight_percent: 40 }, { asset_id: "LU0232524495", weight_percent: 30 }, { asset_id: "LU0430492750", weight_percent: 30 }];
  const assets = () => [GOLDMAN(), AB(), LIMPIO()];

  test("resultado conocido: un aviso, el de Goldman, con su nombre; AB no cuenta", () => {
    const informe = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "Prueba", manualPositions: posiciones, assets: assets() });
    expect(recuentoEnPantalla(informe.positions, []).conAvisos).toBe(1);
    expect(informe.data_diagnostic.quality_flags).toEqual([{ flag: "HISTORY_CONTINUITY_UNVERIFIED", count: 1 }]);
    expect(informe.warnings).toContain("LU1103307408 · Continuidad de la clase pendiente.");
    expect(informe.warnings.join(" ")).not.toMatch(/conciliada|LU0232524495/);
    expect(informe.xray.data_risk_signals).toContain("1 posiciones invertibles con avisos de calidad.");
  });

  test("la tabla cuenta «1 aviso» para Goldman y «0 avisos» para AB, y el diagnóstico de debajo dice cuál; en Modo cliente ninguno de los dos sale", () => {
    const a = assets();
    const informe = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "Prueba", manualPositions: posiciones, assets: a });
    const filas = filasDeComposicion({ positions: posiciones, assets: a, posicionesDelInforme: informe.positions });
    const calidad = columnasDeComposicion({ clientMode: false, conImporte: false, conLimites: false, midiendo: false }).find((c) => c.id === "calidad")!;
    const celda = (id: string) => calidad.celda(filas.find((f) => f.id === id)!);
    expect(celda("LU1103307408")).toEqual({ texto: "Completa · 1 aviso", valor: "Completa · 1 aviso" });
    expect(celda("LU0232524495")).toEqual({ texto: "Completa · 0 avisos", valor: "Completa · 0 avisos" });
    expect(columnasDeComposicion({ clientMode: true, conImporte: false, conLimites: false, midiendo: false }).map((c) => c.id)).not.toContain("calidad");
    /* El diagnóstico ya no manda a la tabla a buscar un nombre que no tiene: lo dice él. */
    const html = renderToStaticMarkup(createElement(PortfolioDataDiagnostic, { diagnostic: informe.data_diagnostic, posiciones: informe.positions }));
    expect(html).toContain("Continuidad de la clase pendiente (1)");
    expect(html).toContain("LU1103307408 · Continuidad de la clase pendiente.");
    expect(html).not.toContain("se ven en la tabla de composición");
    expect(html).not.toMatch(/conciliada/);
  });

  test("una buena noticia con otros avisos: la tabla cuenta solo los otros", () => {
    expect(textoDeCalidad(activo("X", "FUND", ["TOTAL_RETURN_RECONCILED", "MISSING_HOLDINGS", "PARTIAL_COVERAGE"]).data_quality_summary)).toBe("Completa · 2 avisos");
    expect(textoDeCalidad(GOLDMAN().data_quality_summary)).toBe("Completa · 1 aviso");
  });
});

describe("el informe interno dice lo mismo que la pantalla", () => {
  const posiciones = [{ asset_id: "LU1103307408", weight_percent: 60 }, { asset_id: "LU0232524495", weight_percent: 40 }];

  async function texto(assets: BdbAssetDetail[]) {
    const report = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "Prueba", manualPositions: posiciones, assets });
    const input: InternalReportInput = {
      report, assets, positions: posiciones, totalCapital: 100000, benchmarkId: "equilibrado", horizons: {}, horizonErrors: {},
      lookThrough: null, overlap: null, retro: { status: "denied", records: new Map() }, regionRows: [], feasibility: null,
      generatedAt: "2026-11-06T12:00:00Z", includeAssetSheets: true
    };
    return extractPdfPageTexts(Buffer.from(await (await createInternalPortfolioReportPdfBlob(input)).arrayBuffer())).join(" ").replace(/\s+/g, " ");
  }

  /* El texto que se saca del PDF pierde la ligadura «fi»: «ficha» sale «cha». */
  test("Goldman y AB: «1 de 2 posiciones tienen avisos», el de Goldman con su nombre, y ni rastro de la buena noticia", async () => {
    const papel = await texto([GOLDMAN(), AB()]);
    expect(papel).toMatch(/1 de 2 posiciones tienen avisos de calidad en la (fi)?cha\./);
    expect(papel).not.toMatch(/Ninguna (fi)?cha trae avisos de calidad\./);
    expect(papel).toContain("Continuidad de la clase pendiente");
    expect(papel).toContain("1 posición con avisos de calidad del dato (detalle en Calidad y trazabilidad).");
    expect(papel).not.toMatch(/conciliada|Data quality|HISTORY_|TOTAL_RETURN/);
  }, 40_000);

  test("con la buena noticia sola, ninguna ficha trae avisos", async () => {
    const papel = await texto([LIMPIO(), AB()].map((a, i) => ({ ...a, asset_id: posiciones[i].asset_id }) as BdbAssetDetail));
    expect(papel).toMatch(/Ninguna (fi)?cha trae avisos de calidad\./);
    expect(papel).not.toMatch(/conciliada|con avisos de calidad del dato/);
  }, 40_000);
});
