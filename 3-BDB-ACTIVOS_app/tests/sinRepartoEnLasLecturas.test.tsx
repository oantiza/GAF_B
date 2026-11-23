// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { RadiografiaDeLaCartera } from "../src/components/RadiografiaDeLaCartera";
import { RegionAllocation } from "../src/components/RegionAllocation";
import { XrayMetricsStyle } from "../src/components/XrayMetricsStyle";
import { cajaDeEstilo } from "../src/core/cajaDeEstilo";
import { rentaVariablePorRegionDe } from "../src/core/entradaDeComparativa";
import { computeEquityRegionAllocation, repartoDeclarado } from "../src/core/equityRegions";
import { computeEquitySectorAllocation } from "../src/core/equitySectors";
import { perfilDeRentaFija } from "../src/core/perfilDeRentaFija";
import { parteParaLaLectura, pesoSinReparto } from "../src/core/portfolio";
import { fraseDelSinRepartoEnLaLectura } from "../src/core/radiografiaDeLaCartera";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbPmsExposure } from "../src/types/bdbAssets";
import { pintar } from "./piezas/pintar";

/**
 * A-211 (Óscar, 21-11-2026): un fondo que no declara su reparto de activos no aporta a las lecturas por dentro —regiones,
 * sectores, estilo y tamaño, perfil de renta fija—, como desde la A-203 no aporta a la exposición agregada. Hasta ese día cada
 * una lo pesaba por su clase: un fondo de bolsa sin reparto entraba entero en las regiones de la renta variable, que es justo el
 * reparto que no se conoce. Ahora su peso se dice aparte, con la pieza `Ausencia`. Con el sí de Óscar del mismo día, también en el
 * papel: las frases del informe de cliente, el interno y la comparativa las prueban sus propias pruebas de texto del PDF.
 *
 * La cartera, con las cifras a mano:
 *   RV  40 % fondo de bolsa con reparto (renta variable 0,9, liquidez 0,1): EE. UU. 70 y Japón 30; tecnología 60 y salud 40;
 *       caja grande mezcla; renta variable 40 × 0,9 = 36.
 *   BV  20 % fondo de bonos con reparto (renta fija 1): duración modificada 3, grado de inversión 0,8.
 *   XB  25 % fondo de bolsa SIN reparto: zona euro 100; salud 100; caja grande crecimiento.
 *   XF  15 % fondo de bonos SIN reparto: duración modificada 7.
 *
 *   Fuera (la regla):     EE. UU. 25,2 / 36 = 70 %, Japón 30 %; tecnología 21,6 / 36 = 60 %, salud 40 %; caja grande mezcla 100 %;
 *                         renta fija 20 % de la cartera, duración 3. Sin reparto: (25 + 15) / 100 = 40 % de la cartera.
 *   Por su clase (antes de la A-211): renta variable 36 + 25 = 61. EE. UU. 25,2 / 61 = 41,311 %, Japón 10,8 / 61 = 17,705 %, zona euro
 *                         25 / 61 = 40,984 %; tecnología 21,6 / 61 = 35,410 %, salud 39,4 / 61 = 64,590 %; renta fija
 *                         20 + 15 = 35 %, duración (20 × 3 + 15 × 7) / 35 = 165 / 35 = 4,7143.
 */
const plano = (texto: string | null | undefined) => (texto ?? "").replace(/\u00a0/g, " ");
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

const SIN_REPARTO: BdbPmsExposure = { equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "NOT_AVAILABLE" };
const reparto = (partes: Partial<BdbPmsExposure>): BdbPmsExposure => ({ equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE", ...partes });

function fondo(asset_id: string, economic_asset_class: string, pms_exposure: BdbPmsExposure, extra: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return {
    asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND", economic_asset_class, coverage_status: "COMPLETE", is_investable: true,
    role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}, currency: "EUR", pms_exposure, ...extra
  } as unknown as BdbAssetDetail;
}

const ACTIVOS: BdbAssetDetail[] = [
  fondo("RV", "EQUITY", reparto({ equity: 0.9, cash: 0.1 }), {
    exposure_detail: { equity_regions: { united_states: 70, japan: 30 }, sectors: { technology: 60, healthcare: 40 }, equity_style_box: { large_value: 0, large_blend: 1, large_growth: 0, mid_value: 0, mid_blend: 0, mid_growth: 0, small_value: 0, small_blend: 0, small_growth: 0 } }
  } as Partial<BdbAssetDetail>),
  fondo("BV", "FIXED_INCOME", reparto({ fixed_income: 1 }), { fixed_income_profile: { modified_duration: 3, investment_grade_pct: 0.8 } } as Partial<BdbAssetDetail>),
  fondo("XB", "EQUITY", SIN_REPARTO, {
    exposure_detail: { equity_regions: { eurozone: 100 }, sectors: { healthcare: 100 }, equity_style_box: { large_value: 0, large_blend: 0, large_growth: 1, mid_value: 0, mid_blend: 0, mid_growth: 0, small_value: 0, small_blend: 0, small_growth: 0 } }
  } as Partial<BdbAssetDetail>),
  fondo("XF", "FIXED_INCOME", SIN_REPARTO, { fixed_income_profile: { modified_duration: 7 } } as Partial<BdbAssetDetail>)
];
const POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "RV", weight_percent: 40 },
  { asset_id: "BV", weight_percent: 20 },
  { asset_id: "XB", weight_percent: 25 },
  { asset_id: "XF", weight_percent: 15 }
] as BdbManualPortfolioPosition[];
const filas = (rows: Array<{ key: string; weight_percent: number }>) => Object.fromEntries(rows.map((row) => [row.key, Math.round(row.weight_percent * 1000) / 1000]));

describe("las lecturas por dentro dejan fuera al fondo sin reparto (A-211)", () => {
  test("regiones: EE. UU. 70 % y Japón 30 % de la renta variable medida; sin zona euro, que solo traía el fondo sin reparto", () => {
    const regiones = computeEquityRegionAllocation(POSICIONES, ACTIVOS);
    expect(filas(regiones.rows)).toEqual({ united_states: 70, japan: 30 });
    expect(regiones.unclassified_weight_percent).toBe(0);
  });

  test("sectores, estilo y caja: lo del fondo de bolsa con reparto, entero", () => {
    expect(filas(computeEquitySectorAllocation(POSICIONES, ACTIVOS).rows)).toEqual({ technology: 60, healthcare: 40 });
    const caja = cajaDeEstilo(POSICIONES, ACTIVOS)!;
    expect(caja.celdas.large_blend).toBeCloseTo(100, 10);
    expect(caja.celdas.large_growth).toBe(0);
    expect(caja.conCeldas).toBeCloseTo(100, 10);
    /* Estilo y tamaño sueltos: nadie los declara, y lo no declarado es el 100 % de la renta variable medida, no de 61. */
    expect(repartoDeclarado(POSICIONES, ACTIVOS, (a) => a.exposure_detail?.equity_styles).unclassified_weight_percent).toBeCloseTo(100, 10);
  });

  test("perfil de renta fija: el 20 % de la cartera, con duración 3 y cobertura entera", () => {
    const perfil = perfilDeRentaFija(POSICIONES, ACTIVOS)!;
    expect(perfil.pesoEnLaCartera).toBeCloseTo(20, 10);
    expect(perfil.duracionModificada).toEqual({ valor: 3, cobertura: 100 });
    expect(perfil.gradoDeInversion.valor).toBeCloseTo(0.8, 10);
  });

  test("su peso se dice: el 40 % de la cartera", () => {
    expect(pesoSinReparto(POSICIONES, ACTIVOS)).toBeCloseTo(40, 10);
    expect(plano(fraseDelSinRepartoEnLaLectura(40, "renta variable"))).toBe(
      "Falta el dato: el 40,0 % de la cartera no declara su reparto de activos, y no se sabe qué parte es renta variable"
    );
    expect(fraseDelSinRepartoEnLaLectura(0, "renta fija")).toBeNull();
  });

  test("la comparativa de carteras, que es pantalla y papel, sigue la misma regla y lleva el peso aparte", () => {
    const rv = rentaVariablePorRegionDe(POSICIONES, ACTIVOS);
    expect(filas(rv.filas)).toEqual({ united_states: 70, japan: 30 });
    /* La renta variable medida: 40 × 0,9 = 36 % de la cartera, y no los 61 de antes. */
    expect(rv.pesoPct).toBeCloseTo(36, 10);
    expect(rv.sinRepartoPct).toBeCloseTo(40, 10);
  });

  test("un fondo con reparto neto (C-29) pesa por su clase neta", () => {
    const neto = fondo("NE", "EQUITY", reparto({ equity: 3.198, cash: -2.198 }));
    expect(parteParaLaLectura(neto, "equity")).toBeCloseTo(3.198, 10);
    expect(parteParaLaLectura(ACTIVOS[2], "equity")).toBeNull();
    /* Una acción sin vector sigue contando entera por su clase: su clase es lo que es. */
    const accion = { ...fondo("AC", "EQUITY", undefined as unknown as BdbPmsExposure), instrument_type: "STOCK" } as BdbAssetDetail;
    expect(parteParaLaLectura(accion, "equity")).toBe(1);
  });
});

describe("en pantalla", () => {
  const FRASE = "Falta el dato: el 40,0 % de la cartera no declara su reparto de activos, y no se sabe qué parte es renta variable";

  test("Análisis › Estilo, sectores y renta fija lo dice una vez, con la pieza Ausencia", () => {
    const vista = pintar(<XrayMetricsStyle assets={ACTIVOS} positions={POSICIONES} />);
    quitar = vista.quitar;
    const avisos = [...vista.host.querySelectorAll(".ausencia--falta")].map((nodo) => plano(nodo.textContent)).filter((texto) => texto.includes("reparto de activos"));
    expect(avisos).toEqual([`${FRASE} ni renta fija`]);
  });

  test("con solo fondos sin reparto no dice «Sin renta variable» ni «Sin renta fija»: dice que falta el dato", () => {
    const solo = POSICIONES.filter((p) => p.asset_id.startsWith("X"));
    const vista = pintar(<XrayMetricsStyle assets={ACTIVOS} positions={solo} />);
    quitar = vista.quitar;
    const texto = plano(vista.host.textContent);
    expect(texto).not.toContain("Sin renta variable en esta cartera");
    expect(texto).not.toContain("Sin renta fija en esta cartera");
    expect(texto).toContain("Falta el dato: el 100,0 % de la cartera no declara su reparto de activos, y no se sabe qué parte es renta variable ni renta fija");
  });

  test("Distribución geográfica y Carteras guardadas, bajo las regiones y los sectores", () => {
    const regiones = pintar(<RegionAllocation assets={ACTIVOS} positions={POSICIONES} />);
    expect(plano(regiones.host.querySelector(".ausencia--falta")?.textContent)).toBe(FRASE);
    regiones.quitar();
    const guardada = pintar(<RadiografiaDeLaCartera assets={ACTIVOS} positions={POSICIONES} source="BBDD_LIVE_API" />);
    quitar = guardada.quitar;
    const enLaLectura = [...guardada.host.querySelectorAll(".ausencia--falta")].map((nodo) => plano(nodo.textContent)).filter((texto) => texto === FRASE);
    /* Una en «Por sector» y otra en «Por región». */
    expect(enLaLectura).toHaveLength(2);
  });
});
