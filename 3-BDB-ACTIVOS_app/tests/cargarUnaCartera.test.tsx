/**
 * Importar un fichero en Diseño y llevar a Diseño lo de Rendimiento o Posiciones, con la regla de guardar (decisión 113, lote T7).
 *
 * Al guardar, una cartera ya conservaba a Deoleo, Duro Felguera, Squirrel y las restricciones revisadas: cotizan, o un cliente puede tenerlas.
 * Al importar y al llevar a Diseño se caían, y a una clase cerrada de Amundi, a lo suspendido y a lo dado de baja se les llamaba «Índice no
 * invertible». Ahora entra lo mismo que se guarda, salvo lo que no tiene precio ni métricas (decisión 44), y lo que se queda fuera dice lo suyo.
 *
 * Las fixtures no usan ISIN de verdad: la regla mira la marca, nunca el ISIN.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PortfolioImportPanel } from "../src/components/PortfolioImportPanel";
import { entraAlCargarUnaCartera, NO_SE_ANADE_SIN_MEDIR } from "../src/core/accionDeCartera";
import { esUnIndice, seConservaEnLaCartera } from "../src/core/assetMapping";
import { buildSummaryFromAssets, createSavedLocalPortfolio } from "../src/core/portfolio";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import { positionsToPortfolio } from "../src/core/positionsToPortfolio";
import type { BdbAssetDetail, BdbQualityFlag } from "../src/types/bdbAssets";

function activo(asset_id: string, cambios: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return {
    asset_id,
    display_name: `Activo ${asset_id}`,
    isin: asset_id,
    instrument_type: "STOCK",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {},
    ...cambios
  } as unknown as BdbAssetDetail;
}
const conMarca = (asset_id: string, marca: BdbQualityFlag, cambios: Partial<BdbAssetDetail> = {}) =>
  activo(asset_id, { is_investable: false, quality_flags: [marca], ...cambios });

const ETF = activo("ETF-1", { display_name: "Un ETF", instrument_type: "ETF" });
/* Como Deoleo, Duro Felguera y Squirrel: cotizan, y su serie tiene saltos sin resolver (decisión 75). */
const CON_INCIDENCIA = conMarca("SERIE-1", "QUALITY_BLOCKED", { display_name: "Con incidencia en su serie" });
/* Como las 3 clases C de Amundi. */
const CERRADA = conMarca("CERRADA-1", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS", { display_name: "Clase cerrada", instrument_type: "FUND" });
const SUSPENDIDA = conMarca("SUSPENDIDA-1", "NON_INVESTABLE_SUSPENDED", { display_name: "Suspendida" });
const DE_BAJA = conMarca("BAJA-1", "NON_INVESTABLE_DELISTED", { display_name: "Dada de baja" });
const FUSIONADA = conMarca("FUSION-1", "NON_INVESTABLE_CORPORATE_ACTION", { display_name: "Fusionada" });
/* Como NH Hoteles en la base nueva: dejó de cotizar y el servidor no le pone ninguna marca. No es un índice. */
const SIN_MARCA = activo("SIN-MARCA-1", { display_name: "No invertible sin marca", is_investable: false });
const INDICE = activo("INDICE-1", { display_name: "Un índice", instrument_type: "INDEX", is_investable: false, role: "BENCHMARK", quality_flags: ["NON_INVESTABLE_BENCHMARK"] });
/* Como la CAM: nunca resuelta, sin precio ni métricas (decisión 44). */
const SIN_MEDIR = conMarca("SIN-MEDIR-1", "NON_INVESTABLE_NEVER_RESOLVED", { display_name: "Sin precio ni métricas" });
const TODOS = [ETF, CON_INCIDENCIA, CERRADA, SUSPENDIDA, DE_BAJA, FUSIONADA, SIN_MARCA, INDICE, SIN_MEDIR];

describe("una sola regla: lo que se guarda y lo que entra al cargar", () => {
  test.each([
    ["invertible", ETF, true, true],
    ["con incidencia en su serie", CON_INCIDENCIA, true, true],
    ["cerrada a nuevas suscripciones", CERRADA, true, true],
    ["suspendida", SUSPENDIDA, true, true],
    ["dada de baja", DE_BAJA, true, true],
    ["fusionada", FUSIONADA, true, true],
    ["no invertible sin marca", SIN_MARCA, false, false],
    ["un índice", INDICE, false, false],
    ["sin precio ni métricas", SIN_MEDIR, true, false]
  ])("%s: se guarda %s, entra al cargar %s", (_caso, asset, seGuarda, entra) => {
    expect(seConservaEnLaCartera(asset)).toBe(seGuarda);
    expect(entraAlCargarUnaCartera(asset)).toBe(entra);
  });

  test("al guardar se conserva exactamente lo que dice la regla, y lo único que entra al guardar y no al cargar es lo que no tiene precio", () => {
    const positions = TODOS.map((asset) => ({ asset_id: asset.asset_id, weight_percent: 100 / TODOS.length }));
    const guardada = createSavedLocalPortfolio({ sourceKind: "LOCAL_MOCK", name: "Prueba", positions, assets: TODOS });
    expect(guardada.positions.map((p) => p.asset_id)).toEqual(TODOS.filter(seConservaEnLaCartera).map((a) => a.asset_id));
    expect(TODOS.filter((a) => seConservaEnLaCartera(a) !== entraAlCargarUnaCartera(a)).map((a) => a.asset_id)).toEqual(["SIN-MEDIR-1"]);
  });

  test("un activo que llega sin marcas no rompe nada: si no es invertible, no se conserva", () => {
    const sinMarcas = { ...activo("SIN-LISTA-1", { is_investable: false }), quality_flags: undefined } as unknown as BdbAssetDetail;
    expect(seConservaEnLaCartera(sinMarcas)).toBe(false);
    expect(entraAlCargarUnaCartera(sinMarcas)).toBe(false);
    expect(positionsToPortfolio([{ id: "SIN-LISTA-1", amount: 10, asset: sinMarcas }, { id: "ETF-1", amount: 90, asset: ETF }]).excludedIds).toEqual(["SIN-LISTA-1"]);
  });

  test("un índice es lo que lo dice su tipo, su papel o su marca; lo que dejó de cotizar no", () => {
    expect(TODOS.filter(esUnIndice).map((a) => a.asset_id)).toEqual(["INDICE-1"]);
    expect(esUnIndice(activo("REF-1", { role: "BENCHMARK" }))).toBe(true);
  });
});

describe("importar un fichero en Diseño", () => {
  const FICHERO = [
    "asset_id,peso",
    "ETF-1,30",
    "SERIE-1,10",
    "CERRADA-1,10",
    "SUSPENDIDA-1,10",
    "BAJA-1,10",
    "SIN-MARCA-1,10",
    "INDICE-1,10",
    "SIN-MEDIR-1,10"
  ].join("\n");
  const importar = () =>
    buildLocalPortfolioImport({ sourceKind: "BBDD_LIVE_API", text: FICHERO, resolveAsset: (id) => TODOS.find((a) => a.asset_id === id) ?? null });

  test("lo que un cliente puede tener entra con su peso: la incidencia en su serie, la clase cerrada, lo suspendido y lo dado de baja", async () => {
    const resultado = await importar();
    expect(resultado.imported_positions.map((p) => [p.asset_id, p.weight_percent])).toEqual([
      ["ETF-1", 30],
      ["SERIE-1", 10],
      ["CERRADA-1", 10],
      ["SUSPENDIDA-1", 10],
      ["BAJA-1", 10]
    ]);
    expect(resultado.total_weight_percent).toBe(70);
  });

  test("lo que se queda fuera dice lo suyo: «Índice» solo un índice", async () => {
    const resultado = await importar();
    expect(resultado.rejected_positions.map((r) => [r.line_number, r.asset_id, r.reason, r.message])).toEqual([
      [7, "SIN-MARCA-1", "NON_INVESTABLE", "No invertible, excluido de la cartera importada."],
      [8, "INDICE-1", "NON_INVESTABLE_BENCHMARK", "Índice no invertible, excluido de la cartera importada."],
      [9, "SIN-MEDIR-1", "NON_INVESTABLE_NEVER_RESOLVED", NO_SE_ANADE_SIN_MEDIR]
    ]);
    expect(resultado.warnings).toContain("La suma de pesos importados es 70,0\u00a0%, distinta de 100 %.");
    expect(resultado.warnings).toContain("3 líneas rechazadas durante la importación.");
    const texto = JSON.stringify(resultado);
    expect(texto).not.toContain("queda fuera de la cartera importada");
    expect(texto).not.toContain("QUALITY_BLOCKED");
  });

  test("el panel: cada rechazo con su nombre, el recuento de índices solo de índices, y sin «Solo activos invertibles»", async () => {
    const html = renderToStaticMarkup(<PortfolioImportPanel importResult={await importar()} onImportText={async () => {}} />);
    expect(html).toContain("Línea 7: No invertible.");
    expect(html).toContain("Línea 8: Índice.");
    expect(html).toContain("Línea 9: Sin precio.");
    expect(html).toContain("1 índice rechazado por no ser invertible.");
    expect(html).toContain("Lo que no entra se dice, línea a línea.");
    expect(html).not.toContain("Solo activos invertibles");
    expect(html).not.toContain("Su serie");
  });

  test("sin índices, el recuento dice cuántas líneas, en singular si es una", async () => {
    const resultado = await buildLocalPortfolioImport({
      sourceKind: "BBDD_LIVE_API",
      text: "asset_id,peso\nETF-1,90\nSIN-MARCA-1,10",
      resolveAsset: (id) => TODOS.find((a) => a.asset_id === id) ?? null
    });
    const html = renderToStaticMarkup(<PortfolioImportPanel importResult={resultado} onImportText={async () => {}} />);
    expect(html).toContain("1 línea rechazada en la importación.");
    expect(html).not.toContain("índice rechazado");
  });
});

describe("llevar a Diseño lo de Rendimiento o Posiciones", () => {
  test("pasa lo mismo, con su importe, y el capital es lo que pasa", () => {
    const envio = positionsToPortfolio([
      { id: "ETF-1", amount: 50, asset: ETF },
      { id: "SERIE-1", amount: 10, asset: CON_INCIDENCIA },
      { id: "CERRADA-1", amount: 10, asset: CERRADA },
      { id: "SUSPENDIDA-1", amount: 10, asset: SUSPENDIDA },
      { id: "BAJA-1", amount: 10, asset: DE_BAJA },
      { id: "SIN-MARCA-1", amount: 5, asset: SIN_MARCA },
      { id: "INDICE-1", amount: 3, asset: INDICE },
      { id: "SIN-MEDIR-1", amount: 2, asset: SIN_MEDIR },
      { id: "NO-ESTA", amount: 1, asset: null }
    ]);
    /* 50 + 4 × 10 = 90 € pasan; 5 + 3 + 2 + 1 = 11 € se quedan fuera. 50 / 90 = 55,5556 % y 10 / 90 = 11,1111 %. */
    expect(envio.totalCapital).toBe(90);
    expect(envio.excludedIds).toEqual(["SIN-MARCA-1", "INDICE-1", "SIN-MEDIR-1", "NO-ESTA"]);
    expect(envio.excludedCapital).toBe(11);
    expect(envio.positions.map((p) => p.asset_id)).toEqual(["ETF-1", "SERIE-1", "CERRADA-1", "SUSPENDIDA-1", "BAJA-1"]);
    expect(envio.positions[0].weight_percent).toBeCloseTo(55.5556, 4);
    for (const posicion of envio.positions.slice(1)) expect(posicion.weight_percent).toBeCloseTo(11.1111, 4);
    expect(envio.positions.reduce((suma, p) => suma + p.weight_percent, 0)).toBeCloseTo(100, 10);
  });
});

describe("lo que entra se puede leer en Diseño", () => {
  test("el resumen de una cartera con todo lo que entra al cargar no se rompe, y lo suspendido dice lo suyo en español", () => {
    /* Antes, una posición suspendida rompía el resumen al leer una etiqueta que no existía: «Cannot read properties of undefined». */
    const positions = TODOS.filter(entraAlCargarUnaCartera).map((asset) => ({ asset_id: asset.asset_id, weight_percent: 100 / 6 }));
    expect(positions).toHaveLength(6);
    const resumen = buildSummaryFromAssets({ source: "BBDD_LIVE_API", manualPositions: positions, assets: TODOS });
    expect(resumen.warnings).toContain(
      "SUSPENDIDA-1: suspendido de cotización: no admite nuevas selecciones. La posición se conserva para consulta; queda excluida de nuevas propuestas de inversión."
    );
    expect(resumen.warnings.join(" ")).not.toMatch(/non investable/i);
  });
});
