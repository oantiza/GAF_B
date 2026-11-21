// @vitest-environment happy-dom

/**
 * F-04 (auditoría 29-09): el capital «por defecto» de 100.000 € del shell llegaba
 * al PDF como una valoración real. Ahora el capital del borrador es `undefined`
 * hasta que alguien lo fija (usuario, extracto, cartera guardada); el Constructor
 * sigue enseñando 100.000 € para repartir importes, pero marcados como
 * de ejemplo y sin que viajen al informe ni a las carteras guardadas. La parte
 * del PDF (N/D sin capital) se prueba en pdfReports.test.ts, en entorno node.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";
import {
  CURRENT_PORTFOLIO_STORAGE_KEY,
  readCurrentPortfolioDraftCapitalFromStorage,
  readCurrentPortfolioDraftFromStorage,
  writeCurrentPortfolioDraftCapitalToStorage,
  writeCurrentPortfolioDraftToStorage
} from "../src/core/localPortfolioStorage";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key)
  };
}

function props(positions: BdbManualPortfolioPosition[], overrides: Record<string, unknown> = {}) {
  return {
    assets: [], positions, summary: null, optimizationPreview: null, localOptimizationPreview: null, importResult: null,
    riskProfilePreview: null, riskProfiles: RISK_PROFILE_CONTRACTS, selectedRiskProfileId: "RISK_5", portfolioNotice: null,
    onBack: () => undefined, onRemove: () => undefined, onOpenReport: () => undefined, onReset: () => undefined,
    onImportText: async () => undefined,
    onSaveLocalPortfolio: () => undefined, onRiskProfileChange: () => undefined, onWeightChange: () => undefined,
    onAddPosition: () => undefined, onFindAlternatives: async () => [], onSwap: () => undefined,
    onGenerate: async () => undefined, onAutoComplete: async () => false, savedPortfolios: [],
    ...overrides
  } as never;
}

describe("F-04: el capital no existe hasta que alguien lo fija", () => {
  test("sin capital persistido el borrador hidrata «sin fijar», no 100.000 €", () => {
    const storage = memoryStorage();
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", [{ asset_id: "A", weight_percent: 100 }]);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBeUndefined();
    expect(readCurrentPortfolioDraftCapitalFromStorage(memoryStorage(), "LOCAL_MOCK")).toBeUndefined();
  });

  test("un capital fijado se conserva y «sin fijar» lo borra del borrador sin tocar las posiciones", () => {
    const storage = memoryStorage();
    writeCurrentPortfolioDraftToStorage(storage, "LOCAL_MOCK", [{ asset_id: "A", weight_percent: 100 }]);
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", 100000);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBe(100000);
    writeCurrentPortfolioDraftCapitalToStorage(storage, "LOCAL_MOCK", undefined);
    expect(readCurrentPortfolioDraftCapitalFromStorage(storage, "LOCAL_MOCK")).toBeUndefined();
    expect(readCurrentPortfolioDraftFromStorage(storage, "LOCAL_MOCK")).toEqual([{ asset_id: "A", weight_percent: 100 }]);
    // Sin borrador, «sin fijar» no escribe nada.
    const vacio = memoryStorage();
    writeCurrentPortfolioDraftCapitalToStorage(vacio, "LOCAL_MOCK", undefined);
    expect(vacio.getItem(CURRENT_PORTFOLIO_STORAGE_KEY)).toBeNull();
  });

  test("el Constructor marca los 100.000 € como de ejemplo solo mientras el capital no está fijado", () => {
    const sinFijar = renderToStaticMarkup(createElement(PortfolioBuilder, props([{ asset_id: "A", weight_percent: 100 }])));
    const plano = (html: string) => html.replace(/\u00a0/g, " ");
    /* Rediseño del 14-11-2026: el aviso lleva su palabra («Capital sin fijar.») y la banda de los datos de la propuesta
       dice las posiciones, que el capital está sin fijar y la suma de pesos (antes, una línea bajo el título). */
    expect(plano(sinFijar)).toContain("Capital sin fijar.</strong> Los 100.000 € son de ejemplo");
    expect(plano(sinFijar)).toContain("Usar 100.000 € como capital real");
    expect(plano(sinFijar)).toMatch(/Posiciones<\/p><p class="respuesta__cifra"><span[^>]*>1<\/span><\/p><p class="respuesta__apunte">capital sin fijar/);
    expect(plano(sinFijar)).toMatch(/Suma de pesos<\/p><p class="respuesta__cifra"><span[^>]*>100,0 %<\/span>/);
    expect(sinFijar).toContain("Importe de ejemplo");
    const fijado = renderToStaticMarkup(
      createElement(PortfolioBuilder, props([{ asset_id: "A", weight_percent: 100 }], { initialCapital: 100000 }))
    );
    expect(plano(fijado)).not.toContain("Capital sin fijar");
    expect(fijado).not.toContain("capital sin fijar");
    expect(fijado).not.toContain("de ejemplo");
    expect(plano(fijado)).toMatch(/Posiciones<\/p><p class="respuesta__cifra"><span[^>]*>1<\/span><\/p><p class="respuesta__apunte">100.000 €/);
  });
});
