// @vitest-environment happy-dom

/**
 * Lo que Diseño de cartera dice cuando la suma no cuadra o el capital no es de nadie, y su título. Con el componente de
 * verdad: revisión del 05-11-2026.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function props(positions: BdbManualPortfolioPosition[], overrides: Record<string, unknown> = {}) {
  return {
    assets: [],
    positions,
    summary: null,
    optimizationPreview: null,
    localOptimizationPreview: null,
    importResult: null,
    riskProfilePreview: null,
    riskProfiles: RISK_PROFILE_CONTRACTS,
    selectedRiskProfileId: null,
    portfolioNotice: null,
    onRemove: () => undefined,
    onOpenReport: () => undefined,
    onReset: () => undefined,
    onImportText: async () => undefined,
    onSaveLocalPortfolio: () => undefined,
    onRiskProfileChange: () => undefined,
    onWeightChange: () => undefined,
    onAmountsChange: () => undefined,
    onFindAlternatives: async () => [],
    onSwap: () => undefined,
    savedPortfolios: [],
    ...overrides
  } as never;
}

const SUMA = (suma: number): BdbManualPortfolioPosition[] => [
  { asset_id: "A", weight_percent: suma - 40 },
  { asset_id: "B", weight_percent: 40 }
];

const descuadre = (suma: number, overrides: Record<string, unknown> = {}) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(PortfolioBuilder, props(SUMA(suma), overrides)));
  return (host.querySelector(".portfolio-edelta")?.textContent ?? "").replace(/\s/g, " ");
};

describe("lo que falta para cuadrar", () => {
  test("con capital fijado, en euros", () => {
    expect(descuadre(70, { initialCapital: 100000 })).toBe("Faltan 30.000 €");
    expect(descuadre(130, { initialCapital: 100000 })).toBe("Sobran 30.000 €");
  });

  /* Rediseño del 14-11-2026: la diferencia entre dos porcentajes son puntos porcentuales («Faltan 30,0 pp»; antes «%»). */
  test("con capital 0 no hay euros que comparar: en puntos, y nunca «Sobran −0 €»", () => {
    expect(descuadre(70, { initialCapital: 0 })).toBe("Faltan 30,0 pp");
    expect(descuadre(130, { initialCapital: 0 })).toBe("Sobran 30,0 pp");
  });

  test("sin capital, los euros serían de ejemplo: en puntos", () => {
    expect(descuadre(70)).toBe("Faltan 30,0 pp");
  });

  test("la suma de 100 cuadra", () => {
    expect(descuadre(100, { initialCapital: 100000 })).toBe("Cartera cuadrada");
  });
});

describe("escribir el capital", () => {
  const escribirCapital = async (valor: string) => {
    const onCapitalChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(PortfolioBuilder, props(SUMA(100), { initialCapital: 50000, onCapitalChange }))));
    const campo = host.querySelector<HTMLInputElement>('input[aria-label="Capital total en euros"]')!;
    await act(async () => campo.focus());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => campo.blur());
    const invalido = campo.getAttribute("aria-invalid");
    await act(async () => root.unmount());
    host.remove();
    return { onCapitalChange, invalido };
  };

  test("un 0 vuelve a «sin fijar», como dice Informes", async () => {
    const { onCapitalChange } = await escribirCapital("0");
    expect(onCapitalChange).toHaveBeenCalledWith(undefined);
    expect(onCapitalChange).not.toHaveBeenCalledWith(0);
  });

  test("un negativo no se fija: se marca como no válido", async () => {
    const { onCapitalChange, invalido } = await escribirCapital("-500");
    expect(invalido).toBe("true");
    expect(onCapitalChange).not.toHaveBeenCalled();
  });

  test("una cifra de verdad, se fija", async () => {
    const { onCapitalChange } = await escribirCapital("200.000");
    expect(onCapitalChange).toHaveBeenCalledWith(200000);
  });
});

describe("el título de la pantalla", () => {
  const cabecera = (portfolioName: string) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(PortfolioBuilder, props(SUMA(100), { portfolioName })));
    return { titulo: host.querySelector("h1")?.textContent };
  };

  test("un nombre hecho solo de espacios no deja la pantalla sin título", () => {
    expect(cabecera("   ").titulo).toBe("Diseño de la propuesta");
  });

  test("con nombre, el nombre, sin los espacios de los lados", () => {
    expect(cabecera("  Cliente  ").titulo).toBe("Cliente");
  });
});
