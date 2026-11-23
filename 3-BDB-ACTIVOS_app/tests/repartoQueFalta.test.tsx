// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { PortfolioXray } from "../src/components/PortfolioXray";
import { bucketsDeLaMezcla, CLAVE_SIN_REPARTO_EN_LA_MEZCLA } from "../src/core/internalPortfolioReport";
import { buildReportFromAssets } from "../src/core/portfolio";
import { CLAVE_SIN_REPARTO, filasDeExposicion, fraseDeLoQueNoTieneReparto, repartoDeLaCartera } from "../src/core/radiografiaDeLaCartera";
import { fraseDeLoQueNoTieneRepartoEnElPapel } from "../src/core/repartoDelPapel";
import { esSinClasificar, riesgoPorClase } from "../src/core/riesgoPorClase";
import type { BdbAssetDetail, BdbPmsExposure } from "../src/types/bdbAssets";
import { pintar } from "./piezas/pintar";

/**
 * Dos decisiones de Óscar del 21-11-2026 sobre los repartos de Análisis.
 *
 * A-202: «Otros» es una clase (el oro, las materias primas, lo que un fondo declara como otros) y «Sin clasificar», una posición de la
 * que no se sabe la clase. No se juntan.
 *
 * A-203: un fondo que no declara su reparto de activos dice «Falta el dato». Hasta ese día el servidor le ponía el típico de su clase
 * (`CLASSIFICATION_FALLBACK`) y la exposición agregada lo sumaba como si fuera suyo. Ahora no aporta a ninguna clase, su peso va en su
 * propia fila y la frase de debajo dice qué posiciones son. Las cifras esperadas salen de una cuenta a mano.
 */
/** Las cifras llevan un espacio duro entre el número y su unidad. */
const plano = (texto: string | null | undefined) => (texto ?? "").replace(/\u00a0/g, " ");
let quitar: (() => void) | undefined;
afterEach(() => {
  quitar?.();
  quitar = undefined;
});

const SIN_REPARTO: BdbPmsExposure = { equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "NOT_AVAILABLE" };

function activo(asset_id: string, display_name: string, economic_asset_class: string, pms_exposure: BdbPmsExposure): BdbAssetDetail {
  return {
    asset_id, display_name, instrument_type: "FUND", economic_asset_class, coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE",
    quality_flags: [], warnings: [], metrics: {}, currency: "EUR", pms_exposure
  } as unknown as BdbAssetDetail;
}

/* 50 % de un fondo de bolsa que declara 90/0/10; 30 % de un fondo de renta fija que no declara nada; 20 % de un mixto que tampoco. */
const ACTIVOS = [
  activo("RV", "Fondo Bolsa Global", "EQUITY", { equity: 0.9, fixed_income: 0, cash: 0.1, alternative: 0, other: 0, source: "PORTFOLIO_EXPOSURE" }),
  activo("RF", "Fondo Bonos Sin Reparto", "FIXED_INCOME", SIN_REPARTO),
  activo("MX", "Fondo Mixto Sin Reparto", "MIXED", SIN_REPARTO)
];
const informe = () =>
  buildReportFromAssets({
    source: "BBDD_LIVE_API",
    portfolioName: "",
    manualPositions: [{ asset_id: "RV", weight_percent: 50 }, { asset_id: "RF", weight_percent: 30 }, { asset_id: "MX", weight_percent: 20 }],
    assets: ACTIVOS
  });

describe("la exposición agregada de una cartera con fondos sin reparto (A-203)", () => {
  test("los dos fondos sin reparto no aportan a ninguna clase: 45 % renta variable, 5 % liquidez y 50 % sin reparto", () => {
    const { xray } = informe();
    /* 0,5 × 0,9 = 45; 0,5 × 0,1 = 5. Antes: renta fija 30 y «otros» 20, que no eran de nadie. */
    expect(xray.pms_exposure_percent.equity).toBeCloseTo(45, 4);
    expect(xray.pms_exposure_percent.cash).toBeCloseTo(5, 4);
    expect(xray.pms_exposure_percent.fixed_income).toBe(0);
    expect(xray.pms_exposure_percent.other).toBe(0);
    expect(xray.pms_exposure_sin_reparto_percent).toBeCloseTo(50, 4);
    expect(xray.pms_exposure_sin_reparto).toEqual([
      { asset_id: "RF", display_name: "Fondo Bonos Sin Reparto", weight_percent: 30 },
      { asset_id: "MX", display_name: "Fondo Mixto Sin Reparto", weight_percent: 20 }
    ]);
    /* La cobertura del vector, como siempre: solo el de bolsa trae el suyo. */
    expect(xray.pms_exposure_coverage_percent).toBeCloseTo(50, 4);
    expect(xray.pms_exposure_fallback_percent).toBe(0);
  });

  test("las filas llegan al 100 % con la de lo que falta, y «Otros» ya no dice «sin clasificar»", () => {
    const { xray, summary } = informe();
    const filas = filasDeExposicion(xray.pms_exposure_percent, repartoDeLaCartera(summary).parteInvertible, xray.pms_exposure_sin_reparto_percent);
    expect(filas.map((fila) => [fila.clave, Math.round(fila.peso * 100) / 100])).toEqual([
      ["equity", 45],
      ["cash", 5],
      [CLAVE_SIN_REPARTO, 50]
    ]);
    const conOtros = filasDeExposicion({ equity: 60, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 40 });
    expect(conOtros.find((fila) => fila.clave === "other")?.rotulo).toBe("Otros");
  });

  test("la frase nombra las posiciones; con más de tres, cuántas son", () => {
    expect(fraseDeLoQueNoTieneReparto(informe().xray.pms_exposure_sin_reparto)).toBe(
      "«Falta el dato»: Fondo Bonos Sin Reparto y Fondo Mixto Sin Reparto no declaran su reparto de activos, y no cuentan en ninguna clase."
    );
    expect(fraseDeLoQueNoTieneReparto([{ display_name: "Uno" }])).toBe("«Falta el dato»: Uno no declara su reparto de activos, y no cuenta en ninguna clase.");
    expect(fraseDeLoQueNoTieneReparto([{ display_name: "A" }, { display_name: "B" }, { display_name: "C" }, { display_name: "D" }])).toBe(
      "«Falta el dato»: 4 posiciones no declaran su reparto de activos, y no cuentan en ninguna clase."
    );
    expect(fraseDeLoQueNoTieneReparto([])).toBeNull();
  });

  test("en Análisis, la fila dice «Falta el dato» con la pieza, en ocre, y la frase va debajo", () => {
    const { xray, summary } = informe();
    const vista = pintar(<PortfolioXray reparto={repartoDeLaCartera(summary)} xray={xray} />);
    quitar = vista.quitar;
    const bloque = [...vista.host.querySelectorAll(".xray-dist-block")].find((b) => b.querySelector("h3")?.textContent === "Exposición agregada")!;
    expect([...bloque.querySelectorAll("li")].map((fila) => plano(fila.textContent))).toEqual(["Renta variable45,0 %", "Liquidez5,0 %", "Falta el dato50,0 %"]);
    expect(bloque.querySelector("li:last-child .ausencia--falta")?.textContent).toBe("Falta el dato");
    expect(bloque.textContent).toContain("Fondo Bonos Sin Reparto y Fondo Mixto Sin Reparto no declaran su reparto de activos");
    /* Ninguna clase inventada: ni renta fija ni «Otros». */
    expect(bloque.textContent).not.toContain("Renta fija");
    expect(bloque.textContent).not.toContain("Otros");
  });

  test("el papel: la frase del informe de cliente y la fila de la mezcla del interno", () => {
    const report = informe();
    expect(plano(fraseDeLoQueNoTieneRepartoEnElPapel(report, 1))).toBe(
      "Sin reparto declarado: Fondo Bonos Sin Reparto (30,0 %) y Fondo Mixto Sin Reparto (20,0 %), 50,0 % de la cartera; no cuenta en la composición global."
    );
    /* Con un 10 % fuera del reparto, los pesos de lo invertible se llevan a la cartera: 50 × 0,9 = 45. */
    expect(plano(fraseDeLoQueNoTieneRepartoEnElPapel({ xray: { ...report.xray, pms_exposure_sin_reparto: [report.xray.pms_exposure_sin_reparto![0]] } }, 0.9))).toBe(
      "Sin reparto declarado: Fondo Bonos Sin Reparto, 45,0 % de la cartera; no cuenta en la composición global."
    );
    expect(fraseDeLoQueNoTieneRepartoEnElPapel({ xray: { ...report.xray, pms_exposure_sin_reparto: undefined, pms_exposure_sin_reparto_percent: undefined } }, 1)).toBeNull();

    const filas = bucketsDeLaMezcla({ equity: 45, cash: 5, fixed_income: 0 }, { equity: "Renta variable", cash: "Liquidez" }, { parteInvertible: 1, pesoPct: 0 }, 50);
    expect(filas.map((fila) => [fila.key, fila.label, fila.weight])).toEqual([
      ["equity", "Renta variable", 0.45],
      ["cash", "Liquidez", 0.05],
      [CLAVE_SIN_REPARTO_EN_LA_MEZCLA, "Falta el dato", 0.5]
    ]);
    /* Sin nada sin reparto, las mismas filas de antes. */
    expect(bucketsDeLaMezcla({ equity: 100 }, { equity: "Renta variable" }, { parteInvertible: 1, pesoPct: 0 }).map((fila) => fila.key)).toEqual(["equity"]);
  });
});

describe("«Otros» y «Sin clasificar» no se juntan (A-202)", () => {
  test("solo es «Sin clasificar» lo que no tiene clase: sin clave, UNKNOWN o sin ficha; OTHER y COMMODITIES son clases", () => {
    expect(["", "  ", "UNKNOWN", "unknown", "SIN_CLASIFICAR"].map(esSinClasificar)).toEqual([true, true, true, true, true]);
    expect(esSinClasificar(null)).toBe(true);
    expect(esSinClasificar(undefined)).toBe(true);
    expect(["OTHER", "COMMODITIES", "MIXED", "EQUITY"].map(esSinClasificar)).toEqual([false, false, false, false]);
  });

  test("en el riesgo por clase, el oro es «Otros» y una posición sin clase, o sin ficha, «Sin clasificar», al final", () => {
    const activos = [
      { asset_id: "ORO", economic_asset_class: "OTHER" },
      { asset_id: "RARO", economic_asset_class: "UNKNOWN" }
    ] as unknown as BdbAssetDetail[];
    const clases = riesgoPorClase(
      [
        { asset_id: "ORO", weight_pct: 40, risk_pct: 30 },
        { asset_id: "RARO", weight_pct: 35, risk_pct: 50 },
        { asset_id: "SIN_FICHA", weight_pct: 25, risk_pct: 20 }
      ] as never,
      activos
    )!;
    /* 50 + 20 = 70 de lo que no se sabe; 30 del oro. */
    expect(clases.map((clase) => [clase.rotulo, clase.riesgoPct, clase.posiciones])).toEqual([
      ["Otros", 30, 1],
      ["Sin clasificar", 70, 2]
    ]);
  });
});
