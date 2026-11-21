// @vitest-environment happy-dom

/**
 * Decisión 75: Deoleo, Duro Felguera y Squirrel cotizan. Están fuera porque su serie tiene saltos sin resolver, y eso es lo que se
 * dice, al asesor y al cliente. «No invertible» queda para lo que ya no se puede comprar.
 *
 * Se prueba con los dos casos a la vez, en cada sitio que antes lo llamaba igual: la marca decide, nunca el ISIN.
 */
import { describe, expect, test } from "vitest";
import { columnasDeComposicion, filasDeComposicion } from "../src/adapters/tablaDeComposicion";
import { bdbLiveApiAdapterTestHelpers } from "../src/adapters/bdbLiveApiAdapter";
import { parseLiveAssetDetailResponse } from "../src/adapters/bdbLiveApiContracts";
import { accionDeCarteraBloqueada, avisoDeAccionDeCartera, etiquetaDeAccionDeCartera, nombreDeAccionDeCartera } from "../src/core/accionDeCartera";
import { bloqueadoPorCalidadDelDato, isInvestableAsset, rotuloDeLoQueNoEntra } from "../src/core/assetMapping";
import { backtestExclusionLabel, motivoDeFueraParaElCliente, serieNoDisponible } from "../src/core/backtestCoverage";
import { buildLocalOptimizationPreview } from "../src/core/optimizationPreview";
import { buildReportFromAssets, buildSummaryFromAssets } from "../src/core/portfolio";
import { checkPortfolioFeasibility } from "../src/core/portfolioConstraints";
import { textoEnPantalla } from "../src/core/glosarioDePantalla";
import { repartoDeLaCartera } from "../src/core/radiografiaDeLaCartera";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const activo = (asset_id: string, extra: Partial<BdbAssetDetail> = {}) =>
  ({
    asset_id,
    display_name: asset_id,
    instrument_type: "STOCK",
    economic_asset_class: "EQUITY",
    currency: "EUR",
    coverage_status: "COMPLETE",
    is_investable: true,
    role: "INVESTABLE",
    quality_flags: [],
    warnings: [],
    metrics: {},
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" },
    ...extra
  }) as unknown as BdbAssetDetail;

const DEOLEO = activo("DEOLEO", { is_investable: false, quality_flags: ["QUALITY_BLOCKED"] });
/* Como NH Hoteles en la base nueva: dejó de cotizar, y el servidor no le pone ninguna de las marcas que el sitio conoce. */
const NH = activo("NH", { is_investable: false, quality_flags: [] });
/* Como la CAM en la base nueva: nunca se resolvió, y no tiene precio ni métricas (decisión 44). */
const CAM = activo("CAM", { is_investable: false, quality_flags: ["NON_INVESTABLE_NEVER_RESOLVED"] });
const IBERDROLA = activo("IBE");

const pos = (asset_id: string, weight_percent: number) => ({ asset_id, weight_percent }) as BdbManualPortfolioPosition;

describe("la marca del servidor", () => {
  test("se reconoce, y lo bloqueado sigue sin poderse proponer", () => {
    expect(bloqueadoPorCalidadDelDato(DEOLEO)).toBe(true);
    expect(bloqueadoPorCalidadDelDato(NH)).toBe(false);
    expect(bloqueadoPorCalidadDelDato({})).toBe(false);
    expect(isInvestableAsset(DEOLEO)).toBe(false);
  });

  test("el adaptador la deja pasar, y no se confunde con un índice", () => {
    const raw = {
      asset_id: "ES0110047919", instrument_type: "STOCK", is_investable: false,
      identity: { display_name: "Deoleo S.A", currency: "EUR" }, quality_flags: ["QUALITY_BLOCKED", "MISSING_HOLDINGS"], metrics: {}
    };
    const detalle = bdbLiveApiAdapterTestHelpers.mapDetail(parseLiveAssetDetailResponse(raw)!);
    const resultado = bdbLiveApiAdapterTestHelpers.mapSearch(raw);
    for (const asset of [detalle, resultado]) {
      expect(asset.quality_flags).toContain("QUALITY_BLOCKED");
      expect(asset.quality_flags).not.toContain("NON_INVESTABLE_BENCHMARK");
      expect(asset.role).toBe("INVESTABLE");
      expect(asset.is_investable).toBe(false);
    }
  });

  test("con el servidor de hoy, que no la manda, dice lo de siempre: no condiciona el orden de publicar", () => {
    const sinMarca = activo("DEOLEO", { is_investable: false });
    expect(checkPortfolioFeasibility({ positions: [pos("DEOLEO", 100)], assets: [sinMarca] }).blocking_issues[0].message).toBe(
      "DEOLEO no es invertible según el contrato local."
    );
  });
});

describe("lo que dice Comprobar", () => {
  const mensajes = (asset: BdbAssetDetail) =>
    checkPortfolioFeasibility({ positions: [pos("IBE", 90), pos(asset.asset_id, 10)], assets: [IBERDROLA, asset] }).blocking_issues.map((issue) => issue.message);

  test("Deoleo no se puede proponer, y NH no es invertible", () => {
    expect(mensajes(DEOLEO)).toEqual(["DEOLEO no se puede proponer."]);
    expect(mensajes(NH)).toEqual(["NH no es invertible según el contrato local."]);
  });

  test("en pantalla, sin la jerga del contrato", () => {
    expect(textoEnPantalla(mensajes(DEOLEO)[0])).toBe("DEOLEO no se puede proponer.");
    expect(textoEnPantalla(mensajes(NH)[0])).toBe("NH no es invertible.");
  });
});

describe("el motivo fuera del cálculo", () => {
  test("el asesor lee la calidad del dato y el cliente, la serie", () => {
    expect(backtestExclusionLabel("QUALITY_BLOCKED")).toBe("bloqueado por calidad del dato");
    expect(motivoDeFueraParaElCliente("QUALITY_BLOCKED")).toBe("Fuera del cálculo: incidencia en su serie de precios");
    expect(serieNoDisponible("QUALITY_BLOCKED")).toBe("Serie no disponible: bloqueado por calidad del dato.");
    expect(serieNoDisponible("QUALITY_BLOCKED", { modoCliente: true })).toBe("Serie no disponible: incidencia en su serie de precios.");
  });

  test("lo que ya no se puede comprar sigue diciendo que no es invertible", () => {
    expect(backtestExclusionLabel("NON_INVESTABLE")).toBe("no invertible");
    expect(motivoDeFueraParaElCliente("NON_INVESTABLE")).toBe("Fuera del cálculo: no es invertible");
  });
});

describe("el resumen de la cartera", () => {
  const resumen = (posiciones: BdbManualPortfolioPosition[], activos: BdbAssetDetail[]) =>
    buildSummaryFromAssets({ source: "BBDD_LIVE_API", manualPositions: posiciones, assets: activos });

  test("separa lo que está fuera por su serie de lo que no es invertible, con los pesos a mano", () => {
    const s = resumen([pos("IBE", 80), pos("DEOLEO", 15), pos("NH", 5)], [IBERDROLA, DEOLEO, NH]);
    expect(s.non_investable_assets).toEqual(["DEOLEO", "NH"]);
    expect(s.non_investable_weight_percent).toBe(20);
    expect(s.quality_blocked_assets).toEqual(["DEOLEO"]);
    expect(s.quality_blocked_weight_percent).toBe(15);
    expect(s.warnings).toContain("DEOLEO tiene una incidencia en su serie de precios, y no entra en las métricas ni en el reparto.");
    expect(s.warnings.join(" ")).not.toMatch(/DEOLEO es benchmark/);
    expect(s.warnings).toContain("NH es benchmark/no invertible y no contribuye a métricas ni allocation invertible.");
  });

  test("sin nada bloqueado no añade ningún campo", () => {
    const s = resumen([pos("IBE", 100)], [IBERDROLA]);
    expect("quality_blocked_assets" in s).toBe(false);
    expect("quality_blocked_weight_percent" in s).toBe(false);
  });

  test("el reparto dice cada parte, y lo que entra es lo mismo: 80 de 100", () => {
    const reparto = repartoDeLaCartera(resumen([pos("IBE", 80), pos("DEOLEO", 15), pos("NH", 5)], [IBERDROLA, DEOLEO, NH]));
    expect(reparto.fuera.map((parte) => [parte.rotulo, parte.peso])).toEqual([
      ["No invertible", 5],
      ["Incidencia en su serie de precios", 15]
    ]);
    expect(reparto.parteInvertible).toBeCloseTo(0.8, 10);
  });

  test("la CAM, que nunca se resolvió, está fuera «sin serie de precios», y no se la llama «No invertible» (decisión 44)", () => {
    /* 80 + 10 + 10: NH, que dejó de cotizar, sigue siendo «No invertible»; la CAM no tiene serie. Entra el 80. */
    const s = resumen([pos("IBE", 80), pos("CAM", 10), pos("NH", 10)], [IBERDROLA, CAM, NH]);
    expect(s.non_investable_weight_percent).toBe(20);
    expect(s.never_resolved_weight_percent).toBe(10);
    const reparto = repartoDeLaCartera(s);
    expect(reparto.fuera.map((parte) => [parte.rotulo, parte.peso])).toEqual([["No invertible", 10], ["Sin serie de precios", 10]]);
    expect(reparto.parteInvertible).toBeCloseTo(0.8, 10);
    /* Con solo la CAM fuera, ni «No invertible» ni un cero. */
    expect(repartoDeLaCartera(resumen([pos("IBE", 90), pos("CAM", 10)], [IBERDROLA, CAM])).fuera.map((parte) => parte.rotulo)).toEqual(["Sin serie de precios"]);
  });

  test("con solo Deoleo no sale «No invertible» ni un cero", () => {
    const reparto = repartoDeLaCartera(resumen([pos("IBE", 90), pos("DEOLEO", 10)], [IBERDROLA, DEOLEO]));
    expect(reparto.fuera.map((parte) => parte.rotulo)).toEqual(["Incidencia en su serie de precios"]);
    expect(reparto.parteInvertible).toBeCloseTo(0.9, 10);
  });

  test("las señales del análisis tampoco lo llaman índice", () => {
    const senales = (posiciones: BdbManualPortfolioPosition[], activos: BdbAssetDetail[]) =>
      buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "", manualPositions: posiciones, assets: activos }).xray.data_risk_signals;
    expect(senales([pos("IBE", 90), pos("DEOLEO", 10)], [IBERDROLA, DEOLEO])).toContain("Posiciones con una incidencia en su serie de precios, excluidas de la lectura.");
    expect(senales([pos("IBE", 90), pos("DEOLEO", 10)], [IBERDROLA, DEOLEO])).not.toContain("Índices y activos no invertibles excluidos de la lectura.");
    expect(senales([pos("IBE", 90), pos("NH", 10)], [IBERDROLA, NH])).toContain("Índices y activos no invertibles excluidos de la lectura.");
    const conLosDos = senales([pos("IBE", 80), pos("DEOLEO", 10), pos("NH", 10)], [IBERDROLA, DEOLEO, NH]);
    expect(conLosDos).toContain("Índices y activos no invertibles excluidos de la lectura.");
    expect(conLosDos).toContain("Posiciones con una incidencia en su serie de precios, excluidas de la lectura.");
  });
});

describe("cada sitio que lo nombra en una fila", () => {
  test("el rótulo, de asesor y de cliente", () => {
    expect(rotuloDeLoQueNoEntra(DEOLEO, false)).toBe("Bloqueado por calidad del dato");
    expect(rotuloDeLoQueNoEntra(DEOLEO, true)).toBe("Incidencia en su serie de precios");
    expect(rotuloDeLoQueNoEntra(NH, false)).toBe("No invertible");
    expect(rotuloDeLoQueNoEntra(NH, true)).toBe("No invertible");
  });

  test("la composición de Análisis", () => {
    const posiciones = [pos("DEOLEO", 10), pos("NH", 10), pos("CAM", 10)];
    const activos = [DEOLEO, NH, CAM];
    const posicionesDelInforme = buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "", manualPositions: posiciones, assets: activos }).positions;
    const filas = filasDeComposicion({ positions: posiciones, assets: activos, posicionesDelInforme }).filter((fila) => !fila.cabeceraDeGrupo);
    const apunte = (id: string, clientMode: boolean) =>
      columnasDeComposicion({ clientMode, conImporte: false, conLimites: false, midiendo: false })
        .find((columna) => columna.id === "clase")!
        .celda(filas.find((fila) => fila.id === id)!).apunte;
    expect(apunte("DEOLEO", false)).toBe("Bloqueado por calidad del dato");
    expect(apunte("DEOLEO", true)).toBe("Incidencia en su serie de precios");
    expect(apunte("NH", false)).toBe("No invertible");
    /* La CAM: lo que la deja fuera es que no tiene serie (decisión 44), al asesor y al cliente. */
    expect(apunte("CAM", false)).toBe("Sin serie de precios");
    expect(apunte("CAM", true)).toBe("Sin serie de precios");
  });

  test("la comprobación previa de Optimizar", () => {
    const posiciones = [pos("IBE", 80), pos("DEOLEO", 10), pos("NH", 10)];
    const activos = [IBERDROLA, DEOLEO, NH];
    const previa = buildLocalOptimizationPreview({
      sourceKind: "BBDD_LIVE_API",
      positions: posiciones,
      assets: activos,
      summary: buildSummaryFromAssets({ source: "BBDD_LIVE_API", manualPositions: posiciones, assets: activos })
    });
    expect(previa.excluded_assets.map((fuera) => [fuera.asset_id, fuera.reason])).toEqual([
      ["DEOLEO", "QUALITY_BLOCKED"],
      ["NH", "NON_INVESTABLE_BENCHMARK"]
    ]);
    expect(previa.portfolio_warnings).toContain("Lo que tiene una incidencia en su serie de precios queda fuera de la optimización.");
  });

  /* Decisión de Óscar del 14-11-2026 (ACT-01): lo bloqueado por calidad del dato se puede añadir, y se avisa. Antes esta
     prueba exigía «No se puede proponer» y el botón bloqueado; el Buscador, que no veía la marca, lo añadía sin decir nada. */
  test("el botón de la ficha: una acción que cotiza no es un «Benchmark», se puede añadir y lleva su aviso", () => {
    expect(etiquetaDeAccionDeCartera(DEOLEO, false)).toBe("Añadir");
    expect(accionDeCarteraBloqueada(DEOLEO, false)).toBe(false);
    expect(avisoDeAccionDeCartera(DEOLEO)).toBe("Sin datos fiables para medirlo");
    /* Ya dentro, el botón dice «Añadido» y no se pulsa; el aviso sigue. */
    expect(etiquetaDeAccionDeCartera(DEOLEO, true)).toBe("Añadido");
    expect(accionDeCarteraBloqueada(DEOLEO, true)).toBe(true);
    /* Lo que el servidor manda «no invertible» sin esa marca sigue sin ser una posición, y no avisa de nada. */
    expect(etiquetaDeAccionDeCartera(NH, false)).toBe("Benchmark");
    expect(accionDeCarteraBloqueada(NH, false)).toBe(true);
    expect(avisoDeAccionDeCartera(NH)).toBeNull();
    /* Lo que no está disponible no se añade, y por eso no avisa: la CAM, o lo bloqueado que además está suspendido. */
    expect(accionDeCarteraBloqueada(CAM, false)).toBe(true);
    expect(avisoDeAccionDeCartera(CAM)).toBeNull();
    const bloqueadoYSuspendido = { is_investable: false, quality_flags: ["QUALITY_BLOCKED", "NON_INVESTABLE_SUSPENDED"] as const };
    expect(etiquetaDeAccionDeCartera({ ...bloqueadoYSuspendido, quality_flags: [...bloqueadoYSuspendido.quality_flags] }, false)).toBe("No disponible");
    expect(accionDeCarteraBloqueada({ ...bloqueadoYSuspendido, quality_flags: [...bloqueadoYSuspendido.quality_flags] }, false)).toBe(true);
    expect(avisoDeAccionDeCartera({ ...bloqueadoYSuspendido, quality_flags: [...bloqueadoYSuspendido.quality_flags] })).toBeNull();
    expect(etiquetaDeAccionDeCartera({ is_investable: true, quality_flags: [] }, false)).toBe("Añadir");
    /* En corto en el botón; la frase entera, en su nombre y en el aviso del ratón (17-11-2026). */
    expect(nombreDeAccionDeCartera({ is_investable: true, quality_flags: [] }, false)).toBe("Añadir a la propuesta");
    expect(nombreDeAccionDeCartera({ is_investable: true, quality_flags: [] }, true)).toBe("Añadido a la propuesta");
    expect(nombreDeAccionDeCartera({ role: "BENCHMARK", is_investable: true, quality_flags: [] }, false)).toBe("Benchmark");
    expect(avisoDeAccionDeCartera({ is_investable: true, quality_flags: [] })).toBeNull();
  });
});
