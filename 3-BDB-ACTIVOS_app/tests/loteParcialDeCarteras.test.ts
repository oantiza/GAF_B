/**
 * UI-2 (auditoría integral del 16-11-2026): una lectura en lote parcial se rotulaba «sin posiciones subyacentes».
 *
 * Al mirar una cartera por dentro, las carteras de todos sus fondos se piden en una sola llamada. Si esa llamada vuelve
 * sin la de alguno, el aviso decía que el fondo no tiene posiciones subyacentes, que es afirmar algo de él; lo que ha
 * pasado es que no ha llegado. Ahora los que no llegan se piden de uno en uno.
 */
import { describe, expect, test } from "vitest";
import { buildPortfolioLookThrough } from "../src/core/holdingsLookthrough";
import type { BdbAssetDetail, BdbAssetHoldings } from "../src/types/bdbAssets";

const fondo = (id: string): BdbAssetDetail => ({
  asset_id: id, isin: id, display_name: `Fondo ${id}`, instrument_type: "FUND", economic_asset_class: "EQUITY",
  pms_exposure: { equity: 1 }, holdings_summary: { has_holdings: true }
} as unknown as BdbAssetDetail);
/** Una cartera de una sola acción, al 100 % del fondo. */
const cartera = (id: string, accion: string): BdbAssetHoldings => ({
  asset_id: id, storage_mode: "SINGLE_DOCUMENT", holdings: [{ name: accion, weight_pct: 100, holding_type_code: "E", isin: `US${accion}` }]
} as unknown as BdbAssetHoldings);

const POSICIONES = [{ asset_id: "A", weight_percent: 60 }, { asset_id: "B", weight_percent: 40 }];
const ACTIVOS = [fondo("A"), fondo("B")];

async function mirar(deUnoEnUno: (id: string) => Promise<BdbAssetHoldings | null>) {
  const pedidos: string[] = [];
  const resultado = await buildPortfolioLookThrough({
    positions: POSICIONES,
    assets: ACTIVOS,
    /* El lote trae la cartera de A y no la de B. */
    loadHoldingsMany: async () => new Map<string, BdbAssetHoldings | null>([["A", cartera("A", "APPLE")], ["B", null]]),
    loadHoldings: async (id) => { pedidos.push(id); return deUnoEnUno(id); }
  });
  return { resultado, pedidos };
}

describe("el fondo que no llega en el lote se pide aparte", () => {
  test("si entonces llega, se mira como los demás y no hay aviso", async () => {
    const { resultado, pedidos } = await mirar(async (id) => cartera(id, "NVIDIA"));
    /* Solo se vuelve a pedir el que faltaba. */
    expect(pedidos).toEqual(["B"]);
    expect(resultado.warnings.filter((aviso) => aviso.includes("Fondo B"))).toEqual([]);
    expect(resultado.covered_funds).toBe(2);
  });

  test("si falla, se dice que no están disponibles, no que el fondo no tiene", async () => {
    const { resultado } = await mirar(async () => { throw new Error("sin red"); });
    expect(resultado.warnings).toContain("Fondo B: posiciones subyacentes no disponibles.");
    expect(resultado.warnings.join(" ")).not.toContain("Fondo B: sin posiciones subyacentes.");
    expect(resultado.covered_funds).toBe(1);
  });

  test("si de uno en uno también viene vacío, entonces sí: sin posiciones subyacentes", async () => {
    const { resultado } = await mirar(async () => null);
    expect(resultado.warnings).toContain("Fondo B: sin posiciones subyacentes.");
  });
});
