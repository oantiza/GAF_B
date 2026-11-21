/**
 * El optimizador debe funcionar con las carteras reales (auditoría 06-09-2026, B1).
 *
 * El panel enviaba TODAS las posiciones y su objetivo por defecto enrutaba a un cálculo
 * que el backend acotaba a 10 activos: con las carteras de Andbank (38-39 posiciones) el
 * botón «Optimizar» fallaba siempre. Aquí se fija la selección. Desde las decisiones 40 y 61
 * (05-11-2026), todos los objetivos salen del motor regularizado, con el mismo tope.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  buildDisplayedHistoricalFrontierRequest,
  buildOptimizerFrontierRequest,
  OPTIMIZER_MAX_ASSETS
} from "../src/core/historicalFrontierRequest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

/** Cartera de 39 posiciones con pesos decrecientes, como el extracto real. */
const positions: BdbManualPortfolioPosition[] = Array.from({ length: 39 }, (_, index) => ({
  asset_id: `LU${String(index).padStart(10, "0")}`,
  label: `Fondo ${index + 1}`,
  weight_percent: Number(((39 - index) / 780 * 100).toFixed(4))
}));

const assets = positions.map((position) => ({
  asset_id: position.asset_id,
  display_name: position.label,
  instrument_type: "FUND",
  economic_asset_class: "EQUITY",
  currency: "EUR",
  is_investable: true,
  role: "INVESTABLE",
  quality_flags: [],
  warnings: [],
  metrics: { volatility_3y: 0.1, annualized_return_3y: 0.05 }
})) as unknown as BdbAssetDetail[];

describe("tope de activos del optimizador", () => {
  test("el tope de la pantalla es el del servidor", () => {
    const main = readFileSync(new URL("../functions_python/main.py", import.meta.url), "utf8");
    expect(main).toContain(`CAP_OPTIMIZE_ASSETS = ${OPTIMIZER_MAX_ASSETS}`);
  });

  test("con más de 40 pide 40 y declara lo que deja fuera", () => {
    const muchas: BdbManualPortfolioPosition[] = Array.from({ length: 45 }, (_, index) => ({
      asset_id: `LU${String(index).padStart(10, "0")}`,
      label: `Fondo ${index + 1}`,
      weight_percent: Number(((45 - index) / 1035 * 100).toFixed(4))
    }));
    const fichas = muchas.map((position) => ({ ...assets[0], asset_id: position.asset_id, display_name: position.label })) as BdbAssetDetail[];
    const request = buildOptimizerFrontierRequest({ assets: fichas, positions: muchas });
    expect(request).not.toBeNull();
    expect(request!.assetIds).toHaveLength(OPTIMIZER_MAX_ASSETS);
    // Entran las mayores por peso: son las cuarenta primeras de la cartera.
    expect(request!.assetIds).toEqual(muchas.slice(0, 40).map((position) => position.asset_id));
    expect(request!.selectionExclusions).toHaveLength(5);
    expect(request!.selectionExclusions![0].reasonLabel).toBe("Límite de 40 activos por cálculo");
    // Los pesos enviados se renormalizan sobre lo incluido…
    const enviado = Object.values(request!.currentWeights ?? {}).reduce((total, weight) => total + weight, 0);
    expect(enviado).toBeCloseTo(1, 6);
    // …y la cartera original viaja aparte para poder medir la cobertura.
    expect(Object.keys(request!.portfolioWeightsPercent ?? {})).toHaveLength(45);
  });

  test("la cartera de 39 va completa", () => {
    const request = buildOptimizerFrontierRequest({ assets, positions });
    expect(request!.assetIds).toHaveLength(39);
    expect(request!.selectionExclusions).toEqual([]);
  });

  /* El motivo distingue los tres casos: un ETF invertible al que solo le falta la
     ventana de 3 años no puede aparecer como «no invertible» (caso real del iShares
     Energy Storage & Hydrogen, cuyo proveedor solo publica un año). */
  const conUnoSinMetricas = assets.map((asset, index) => {
    if (index === 0) return { ...asset, metrics: { volatility_1y: 0.39, annualized_return_1y: 1.46 } } as BdbAssetDetail;
    if (index === 1) return { ...asset, is_investable: false } as BdbAssetDetail;
    return asset;
  });

  test("la frontera estimada dice por qué deja fuera a cada uno", () => {
    const request = buildDisplayedHistoricalFrontierRequest({ assets: conUnoSinMetricas, positions });
    expect(request!.assetIds).not.toContain(positions[0].asset_id);
    expect(request!.selectionExclusions).toContainEqual({
      assetId: positions[0].asset_id,
      reasonLabel: "Sin métricas a 3 años"
    });
    expect(request!.selectionExclusions).toContainEqual({
      assetId: positions[1].asset_id,
      reasonLabel: "No invertible"
    });
  });

  /* Decisión 40: el motor trabaja con la serie, y quien no cubre la ventana lo dice el servidor con su motivo, como en
     Simular. Si la pantalla quitara por su cuenta a quien no tiene métricas, serían otros activos y otra cartera: pasaba
     en la base nueva con el Goldman de la muestra, 7 de 8 aquí y 8 de 8 en Simular. */
  test("sin métricas a 3 años también entra: quien mira la serie es el servidor", () => {
    const request = buildOptimizerFrontierRequest({ assets: conUnoSinMetricas, positions });
    expect(request!.assetIds).toContain(positions[0].asset_id);
    expect(request!.selectionExclusions).not.toContainEqual(expect.objectContaining({ reasonLabel: "Sin métricas a 3 años" }));
    expect(request!.selectionExclusions).toContainEqual({ assetId: positions[1].asset_id, reasonLabel: "No invertible" });
  });

  test("una posición cuya ficha no está cargada lo dice, en vez de llamarla no invertible", () => {
    const request = buildOptimizerFrontierRequest({
      assets: assets.slice(0, 5),
      positions
    });
    expect(request!.selectionExclusions).toContainEqual({
      assetId: positions[6].asset_id,
      reasonLabel: "Sin ficha cargada en la fuente activa"
    });
  });

  test("una cartera sin dos activos aptos no produce petición", () => {
    expect(buildOptimizerFrontierRequest({ assets: [], positions })).toBeNull();
  });
});
