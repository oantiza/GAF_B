/* Auditoría integral del 16-11-2026, hallazgo IMP-1. En el Constructor, un extracto del que el lector no acepta ninguna
   posición se leía después como «asset_id,peso», y en un extracto de dos columnas los importes rechazados entraban
   como pesos. La batería de aceptación de la cuarta pasada no lo veía: con el parser simple no hay capital y su
   comprobación se saltaba («basta con que no se inventen pesos», sin afirmarlo). Aquí se afirma. */
import { describe, expect, it } from "vitest";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import { looksLikeBrokerExport } from "../src/core/brokerPortfolioImport";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const LU = "LU1234567891";
const IE = "IE0098765432";

function activo(assetId: string): BdbAssetDetail {
  return {
    asset_id: assetId,
    display_name: `Activo ${assetId}`,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "FULL",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {}
  } as unknown as BdbAssetDetail;
}

const importar = (text: string) =>
  buildLocalPortfolioImport({ sourceKind: "LOCAL_MOCK", text, resolveAsset: (id) => (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(id) ? activo(id) : null) });

/* Las líneas rechazadas que son una posición. La cabecera del extracto también se rechaza, como línea sin peso: es de antes. */
const rechazadas = (r: Awaited<ReturnType<typeof importar>>) => r.rejected_positions.filter((linea) => linea.asset_id === LU || linea.asset_id === IE);

describe("IMP-1 · un importe que el lector del extracto rechaza no entra como peso", () => {
  it("importes en dólares sin contravalor: antes cargaban 60 % y 40 %, y como sumaban 100 no avisaba nadie", async () => {
    const texto = `ISIN;Importe\n${LU};60 USD\n${IE};40 USD`;
    expect(looksLikeBrokerExport(texto)).toBe(true);
    const r = await importar(texto);
    expect(r.imported_positions).toEqual([]);
    expect(r.total_weight_percent).toBe(0);
    expect(rechazadas(r).map((linea) => [linea.asset_id, linea.message])).toEqual([
      [LU, "Es un importe que el extracto no deja leer, no un peso: no se carga."],
      [IE, "Es un importe que el extracto no deja leer, no un peso: no se carga."]
    ]);
    expect(r.warnings).toContain("No hay posiciones válidas para cargar.");
    /* El motivo lo sigue diciendo el lector, con los identificadores. */
    expect(r.warnings.join(" ")).toContain(LU);
    expect(r.warnings.join(" ")).toContain(IE);
  });

  it("miles en formato inglés, que el lector declara ambiguos: antes cargaban 80 % y 5 %", async () => {
    const r = await importar(`ISIN;Importe\n${LU};80,000\n${IE};5,000`);
    expect(r.imported_positions).toEqual([]);
    expect(rechazadas(r).map((linea) => linea.asset_id)).toEqual([LU, IE]);
  });

  it("lo que sí son pesos sigue entrando: celdas con «%» bajo una cabecera de importe (sonda N13)", async () => {
    const r = await importar(`ISIN;Importe\n${LU};40%\n${IE};60%`);
    expect(r.imported_positions.map((p) => [p.asset_id, p.weight_percent])).toEqual([[LU, 40], [IE, 60]]);
    expect(r.total_weight_percent).toBe(100);
  });

  it("si solo una línea dice «%», solo esa es un peso", async () => {
    const r = await importar(`ISIN;Importe\n${LU};40%\n${IE};60 USD`);
    expect(r.imported_positions.map((p) => [p.asset_id, p.weight_percent])).toEqual([[LU, 40]]);
    expect(rechazadas(r).map((linea) => linea.asset_id)).toEqual([IE]);
  });

  it("el formato de pesos de siempre no cambia: sin cabecera de importe no es un extracto", async () => {
    const texto = `${LU};60\n${IE};40`;
    expect(looksLikeBrokerExport(texto)).toBe(false);
    const r = await importar(texto);
    expect(r.imported_positions.map((p) => [p.asset_id, p.weight_percent])).toEqual([[LU, 60], [IE, 40]]);
  });
});
