// @vitest-environment happy-dom

/**
 * Decisión 50: la radiografía de Carteras guardadas da la misma cifra que Análisis, para la misma cartera y la misma base.
 * Se pintan las dos pantallas con los mismos datos y se compara lo que escriben. Los resultados esperados se calculan aquí
 * a mano, no se copian de lo que da el código.
 *
 * La cartera: A, todo renta variable en EE. UU., pesa el 50 %. B, un mixto con un 50 % de renta variable, repartida a medias
 * entre EE. UU. y la zona euro, pesa el otro 50 %.
 *
 *   Renta variable de la cartera: 50 × 1 + 50 × 0,5 = 75.
 *   EE. UU.: (50 + 25 × 0,5) / 75 = 62,5 / 75 = 83,33 %. Zona euro: 12,5 / 75 = 16,67 %.
 *
 * Ponderando por el peso de la posición, como hacía la radiografía, un mixto contaba entero: EE. UU. (50 + 25) / 100 = 75 %.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { PortfolioXray } from "../src/components/PortfolioXray";
import { RadiografiaDeLaCartera } from "../src/components/RadiografiaDeLaCartera";
import { RegionAllocation } from "../src/components/RegionAllocation";
import { XrayMetricsStyle } from "../src/components/XrayMetricsStyle";
import { computeEquityRegionAllocation } from "../src/core/equityRegions";
import { computeEquitySectorAllocation } from "../src/core/equitySectors";
import { buildReportFromAssets } from "../src/core/portfolio";
import { auditarCartera, radiografiaDeLaCartera, sumaDeLaCartera } from "../src/core/radiografiaDeLaCartera";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const activo = (
  asset_id: string,
  equity: number,
  equity_regions: Record<string, number> | undefined,
  sectors: Record<string, number> | undefined,
  extra: Partial<BdbAssetDetail> = {}
) =>
  ({
    asset_id,
    display_name: asset_id,
    instrument_type: "FUND",
    economic_asset_class: equity >= 1 ? "EQUITY" : "MIXED",
    role: "INVESTABLE",
    is_investable: true,
    quality_flags: [],
    coverage_status: "COMPLETE",
    currency: "EUR",
    metrics: {},
    warnings: [],
    pms_exposure: { equity, fixed_income: 1 - equity, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" },
    exposure_detail: { equity_regions, sectors },
    ...extra
  }) as unknown as BdbAssetDetail;

const A = activo("A", 1, { united_states: 1 }, { technology: 1 });
const B = activo("B", 0.5, { united_states: 0.5, eurozone: 0.5 }, { technology: 0.5, energy: 0.5 });
const POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 50 },
  { asset_id: "B", weight_percent: 50 }
];

const conModo = (hijo: React.ReactElement) => createElement(ClientModeProvider, { initialValue: false, children: hijo });
const texto = (html: string) => {
  const raiz = document.createElement("div");
  raiz.innerHTML = html;
  return raiz;
};
/** La cifra de una fila, por su rótulo, en cualquiera de las dos tablas de la pantalla. */
const cifraDe = (raiz: HTMLElement, rotulo: string): string | undefined => {
  for (const fila of raiz.querySelectorAll("tr, li")) {
    const celdas = [...fila.children].map((celda) => (celda.textContent ?? "").replace(/\u00a0/g, " ").trim());
    if (celdas[0] === rotulo) return celdas[1];
  }
  return undefined;
};

const radiografia = (posiciones = POSICIONES, activos: BdbAssetDetail[] = [A, B]) =>
  texto(renderToStaticMarkup(conModo(createElement(RadiografiaDeLaCartera, { positions: posiciones, assets: activos, source: "BBDD_LIVE_API" }))));
const regionesDeAnalisis = (posiciones = POSICIONES, activos: BdbAssetDetail[] = [A, B]) =>
  texto(renderToStaticMarkup(conModo(createElement(RegionAllocation, { positions: posiciones, assets: activos }))));

describe("la misma cifra que Análisis, con los mismos datos", () => {
  test("EE. UU. y la zona euro: 83,3 % y 16,7 %, y no el 75 % de ponderar por la posición", () => {
    const enAnalisis = regionesDeAnalisis();
    const enGuardadas = radiografia();
    expect(cifraDe(enAnalisis, "Estados Unidos")).toBe("83,3 %");
    expect(cifraDe(enGuardadas, "Estados Unidos")).toBe("83,3 %");
    expect(cifraDe(enAnalisis, "Zona Euro")).toBe("16,7 %");
    expect(cifraDe(enGuardadas, "Zona Euro")).toBe("16,7 %");
  });

  test("todas las filas del desglose de regiones, una a una", () => {
    const leerFilas = (raiz: HTMLElement) =>
      [...raiz.querySelectorAll(".geo-map-table tr")].map((fila) => (fila.textContent ?? "").replace(/\u00a0/g, " "));
    expect(leerFilas(radiografia())).toEqual(leerFilas(regionesDeAnalisis()));
    expect(leerFilas(radiografia())).toEqual(["América83,3 %", "Estados Unidos83,3 %", "Europa / O. Medio / África16,7 %", "Zona Euro16,7 %"]);
  });

  test("sectores, con la función de Análisis: Tecnología (50 + 12,5) / 75 y Energía 12,5 / 75", () => {
    const { sectores } = radiografiaDeLaCartera(POSICIONES, [A, B], "BBDD_LIVE_API");
    expect(sectores).toEqual(computeEquitySectorAllocation(POSICIONES, [A, B]));
    expect(sectores.rows.find((fila) => fila.key === "technology")?.weight_percent).toBeCloseTo((62.5 / 75) * 100, 8);
    expect(sectores.rows.find((fila) => fila.key === "energy")?.weight_percent).toBeCloseTo((12.5 / 75) * 100, 8);
    const enAnalisis = texto(renderToStaticMarkup(conModo(createElement(XrayMetricsStyle, { positions: POSICIONES, assets: [A, B] }))));
    const enGuardadas = radiografia();
    expect(cifraDe(enGuardadas, "Tecnología")).toBe("83,3 %");
    expect(cifraDe(enGuardadas, "Energía")).toBe("16,7 %");
    /* El aro de Análisis lleva los mismos sectores con la misma cifra. */
    expect(enAnalisis.textContent?.replace(/\u00a0/g, " ")).toContain("Tecnología");
    expect(enAnalisis.textContent?.replace(/\u00a0/g, " ")).toContain("83,3 %");
  });

  test("exposición agregada: 75 % de renta variable y 25 % de renta fija, la misma fila en las dos", () => {
    const { xray } = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "", manualPositions: POSICIONES, assets: [A, B] });
    const enAnalisis = texto(renderToStaticMarkup(conModo(createElement(PortfolioXray, { xray }))));
    const enGuardadas = radiografia();
    expect(cifraDe(enAnalisis, "Renta variable")).toBe("75,0 %");
    expect(cifraDe(enGuardadas, "Renta variable")).toBe("75,0 %");
    expect(cifraDe(enAnalisis, "Renta fija")).toBe("25,0 %");
    expect(cifraDe(enGuardadas, "Renta fija")).toBe("25,0 %");
  });

  test("el dato en la forma nueva da lo mismo en las dos: el mapa y la radiografía leen cada zona una sola vez", () => {
    const C = activo("C", 1, { japan: 0.5, asia_developed: 0.25, asia_emerging: 0.25 }, undefined);
    const posiciones = [{ asset_id: "C", weight_percent: 100 }];
    expect(cifraDe(radiografia(posiciones, [C]), "Japón")).toBe(cifraDe(regionesDeAnalisis(posiciones, [C]), "Japón"));
    expect(cifraDe(radiografia(posiciones, [C]), "Japón")).toBe("50,0 %");
  });

  test("el dato en la forma antigua: sin «Otras» ni «Asia emergente», y con la nota", () => {
    const D = activo("D", 1, { asia: 1, asia_emerging: 1, other: 1 }, undefined);
    const posiciones = [{ asset_id: "D", weight_percent: 100 }];
    const raiz = radiografia(posiciones, [D]);
    expect(cifraDe(raiz, "Asia, sin desglose")).toBe("100,0 %");
    expect(raiz.textContent).toContain("Canadá y África aún no se separan");
    expect(radiografiaDeLaCartera(posiciones, [D], "BBDD_LIVE_API").regiones).toEqual(computeEquityRegionAllocation(posiciones, [D]));
  });
});

describe("lo que no está, se dice", () => {
  const BONOS = activo("BONOS", 0, undefined, undefined, { economic_asset_class: "FIXED_INCOME" });
  const SIN_DATOS = activo("X", 1, undefined, undefined);

  test("lo que no se declara va aparte, con la pieza Ausencia: 50 de 100 de renta variable", () => {
    const posiciones = [{ asset_id: "A", weight_percent: 50 }, { asset_id: "X", weight_percent: 50 }];
    const raiz = radiografia(posiciones, [A, SIN_DATOS]);
    const ausencias = [...raiz.querySelectorAll(".ausencia--falta")].map((n) => (n.textContent ?? "").replace(/\u00a0/g, " "));
    expect(ausencias).toEqual(["No declarado: 50,0 % de la renta variable", "No declarado: 50,0 % de la renta variable"]);
    expect(cifraDe(raiz, "Estados Unidos")).toBe("50,0 %");
  });

  test("un fondo de bonos no es una laguna: sin renta variable no aplica, y no dice que falte", () => {
    const raiz = radiografia([{ asset_id: "BONOS", weight_percent: 100 }], [BONOS]);
    const noAplica = [...raiz.querySelectorAll(".ausencia--no-aplica")].map((n) => n.textContent);
    expect(noAplica).toEqual(["Sin renta variable en esta cartera", "Sin renta variable en esta cartera"]);
    expect(raiz.querySelector(".ausencia--falta")).toBeNull();
  });

  test("una posición que el catálogo no conoce no cuenta, y se nombra", () => {
    const posiciones = [{ asset_id: "A", weight_percent: 50 }, { asset_id: "ZZ", weight_percent: 50 }];
    const raiz = radiografia(posiciones, [A]);
    expect(raiz.textContent).toContain("No cuenta aquí, porque no está en el catálogo: ZZ.");
    expect(radiografiaDeLaCartera(posiciones, [A], "BBDD_LIVE_API").fuera).toEqual(["ZZ"]);
  });
});

describe("la auditoría de una cartera guardada", () => {
  const BONOS = activo("BONOS", 0, undefined, undefined, { economic_asset_class: "FIXED_INCOME" });
  const SIN_SECTORES = activo("S", 1, { united_states: 1 }, undefined);

  test("los sectores se miden sobre la renta variable: un fondo de bonos no los debe", () => {
    /* A 70 + Bonos 30: toda la renta variable los declara. Ponderando por la posición salía «explica el 70 %». */
    const auditoria = auditarCartera([{ asset_id: "A", weight_percent: 70 }, { asset_id: "BONOS", weight_percent: 30 }], [A, BONOS]);
    expect(auditoria.sectoresDeclaradosPct).toBe(100);
    expect(auditoria.fuera).toEqual([]);
  });

  test("lo que no los declara, sí baja: 60 de A y 40 de un fondo de bolsa sin sectores", () => {
    const auditoria = auditarCartera([{ asset_id: "A", weight_percent: 60 }, { asset_id: "S", weight_percent: 40 }], [A, SIN_SECTORES]);
    expect(auditoria.sectoresDeclaradosPct).toBeCloseTo(60, 8);
  });

  test("sin renta variable no hay cifra: no aplica, no es un cero", () => {
    expect(auditarCartera([{ asset_id: "BONOS", weight_percent: 100 }], [BONOS]).sectoresDeclaradosPct).toBeNull();
  });

  test("lo que el catálogo no conoce se cuenta: no es un cero, es una posición desconocida", () => {
    expect(auditarCartera([{ asset_id: "A", weight_percent: 50 }, { asset_id: "Z", weight_percent: 50 }], [A]).fuera).toEqual(["Z"]);
  });

  test("si cuadra, con la tolerancia del proyecto", () => {
    expect(sumaDeLaCartera([{ weight_percent: 60 }, { weight_percent: 40 }])).toEqual({ suma: 100, cuadrada: true });
    expect(sumaDeLaCartera([{ weight_percent: 90 }]).cuadrada).toBe(false);
    expect(sumaDeLaCartera([{ weight_percent: 99.99 }]).cuadrada).toBe(true);
    expect(sumaDeLaCartera([{ weight_percent: 33.33 }, { weight_percent: 33.33 }, { weight_percent: 33.33 }])).toEqual({ suma: 99.99, cuadrada: true });
  });
});
