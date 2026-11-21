// @vitest-environment happy-dom

/**
 * Lo que otros lotes vieron y dejaron dicho (05-11-2026). Los resultados esperados se calculan aquí a mano, en los comentarios, y no se
 * copian de lo que da el código.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rebased: vi.fn(), backend: { fetchHistoricalFrontier: vi.fn(), isRealFrontierEnabled: vi.fn(() => true) } }));
vi.mock("../src/adapters/optimizePortfolioBackend", () => mocks.backend);
vi.mock("../src/adapters/priceSeriesBackend", async (original) => ({
  ...(await original<typeof import("../src/adapters/priceSeriesBackend")>()),
  fetchRebasedSeries: mocks.rebased
}));
vi.mock("../src/charts/oaa", async (original) => ({
  ...(await original<typeof import("../src/charts/oaa")>()),
  OaaLineChart: () => null
}));

import { componerFicha } from "../src/adapters/componerFicha";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { AssetHistoryChart } from "../src/components/AssetHistoryChart";
import { OptimizerPanel } from "../src/components/OptimizerPanel";
import { PortfolioSummary } from "../src/components/PortfolioSummary";
import { PortfolioXray } from "../src/components/PortfolioXray";
import { RadiografiaDeLaCartera } from "../src/components/RadiografiaDeLaCartera";
import { XrayMetricsStyle } from "../src/components/XrayMetricsStyle";
import { serieNoDisponible } from "../src/core/backtestCoverage";
import { buildReportFromAssets } from "../src/core/portfolio";
import { checkPortfolioFeasibility } from "../src/core/portfolioConstraints";
import { filasDeExposicion, radiografiaDeLaCartera, repartoDeLaCartera } from "../src/core/radiografiaDeLaCartera";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const activo = (asset_id: string, extra: Record<string, unknown> = {}) =>
  ({
    asset_id,
    display_name: asset_id,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    role: "INVESTABLE",
    is_investable: true,
    quality_flags: [],
    coverage_status: "COMPLETE",
    currency: "EUR",
    category: "Una categoría",
    metrics: {},
    warnings: [],
    pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" },
    ...extra
  }) as unknown as BdbAssetDetail;

const RENTA_VARIABLE = activo("RV");
const BONOS = activo("RF", {
  economic_asset_class: "FIXED_INCOME",
  pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" }
});
/* Como la CAM: una acción con su clase, y sin precio ni métricas. Queda fuera «sin serie de precios», y no se dice «No invertible» (decisión 44). */
const NO_INVERTIBLE = activo("CAM", { instrument_type: "STOCK", is_investable: false, quality_flags: ["NON_INVESTABLE_NEVER_RESOLVED"], pms_exposure: undefined });

const pos = (asset_id: string, weight_percent: number) => ({ asset_id, weight_percent }) as BdbManualPortfolioPosition;
const conModo = (hijo: ReactElement, cliente = false) => createElement(ClientModeProvider, { initialValue: cliente, children: hijo });
const texto = (html: string) => {
  const raiz = document.createElement("div");
  raiz.innerHTML = html;
  return (raiz.textContent ?? "").replace(/\u00a0/g, " ");
};
const informe = (posiciones: BdbManualPortfolioPosition[], activos: BdbAssetDetail[]) =>
  buildReportFromAssets({ source: "BBDD_LIVE_API", portfolioName: "", manualPositions: posiciones, assets: activos });

describe("el reparto dice lo que no entra", () => {
  const POSICIONES = [pos("RV", 50), pos("RF", 40), pos("CAM", 10)];
  const ACTIVOS = [RENTA_VARIABLE, BONOS, NO_INVERTIBLE];

  test("con un 10 % no invertible: 50 de renta variable, 40 de renta fija y el 10 dicho, que suman 100", () => {
    const { summary, xray } = informe(POSICIONES, ACTIVOS);
    const reparto = repartoDeLaCartera(summary);
    expect(reparto.fuera).toEqual([{ clave: "sin_serie", rotulo: "Sin serie de precios", peso: 10, pesoSobreLaCartera: 10 }]);
    expect(reparto.parteInvertible).toBeCloseTo(0.9, 10);
    const filas = filasDeExposicion(xray.pms_exposure_percent, reparto.parteInvertible);
    expect(filas.map((fila) => fila.rotulo)).toEqual(["Renta variable", "Renta fija"]);
    expect(filas[0].peso).toBeCloseTo(50, 2);
    expect(filas[1].peso).toBeCloseTo(40, 2);
    expect(filas.reduce((suma, fila) => suma + fila.peso, 0) + reparto.fuera[0].pesoSobreLaCartera).toBeCloseTo(100, 2);
  });

  test("lo que lee el papel no se mueve: las clases siguen sumando 90 y la exposición 100 de lo invertible", () => {
    const { summary, xray } = informe(POSICIONES, ACTIVOS);
    expect(summary.by_economic_asset_class.reduce((suma, fila) => suma + fila.weight_percent, 0)).toBe(90);
    /* 50 / 90 y 40 / 90. */
    expect(xray.pms_exposure_percent.equity).toBeCloseTo(55.5556, 3);
    expect(xray.pms_exposure_percent.fixed_income).toBeCloseTo(44.4444, 3);
  });

  test("un fondo con una parte de cada: 45 % de 60/40 y 45 % de bonos, con el 10 fuera", () => {
    /* Renta variable: 45 × 0,6 = 27. Renta fija: 45 × 0,4 + 45 = 63. Suman 90, y el 10 que falta se dice. */
    const mezcla = activo("MIX", { pms_exposure: { equity: 0.6, fixed_income: 0.4, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" } });
    const { summary, xray } = informe([pos("MIX", 45), pos("RF", 45), pos("CAM", 10)], [mezcla, BONOS, NO_INVERTIBLE]);
    const filas = filasDeExposicion(xray.pms_exposure_percent, repartoDeLaCartera(summary).parteInvertible);
    expect(filas[0].peso).toBeCloseTo(27, 2);
    expect(filas[1].peso).toBeCloseTo(63, 2);
  });

  test("con todo dentro no cambia ninguna cifra ni aparece nada nuevo", () => {
    const { summary, xray } = informe([pos("RV", 60), pos("RF", 40)], [RENTA_VARIABLE, BONOS]);
    expect(summary).not.toHaveProperty("non_investable_weight_percent");
    expect(summary).not.toHaveProperty("not_found_weight_percent");
    const reparto = repartoDeLaCartera(summary);
    expect(reparto).toEqual({ fuera: [], parteInvertible: 1 });
    expect(filasDeExposicion(xray.pms_exposure_percent, reparto.parteInvertible).map((fila) => fila.peso)).toEqual([60, 40]);
  });

  test("lo que no está en el catálogo se dice aparte", () => {
    /* 60 dentro y 40 fuera: la renta variable es el 60 % de la cartera, y no el 100 %. */
    const { summary, xray } = informe([pos("RV", 60), pos("NO-ESTA", 40)], [RENTA_VARIABLE]);
    const reparto = repartoDeLaCartera(summary);
    expect(reparto.fuera).toEqual([{ clave: "fuera_del_catalogo", rotulo: "Fuera del catálogo", peso: 40, pesoSobreLaCartera: 40 }]);
    expect(filasDeExposicion(xray.pms_exposure_percent, reparto.parteInvertible)[0].peso).toBeCloseTo(60, 2);
  });

  test("con las dos cosas a la vez, cada una lo suyo", () => {
    const { summary } = informe([pos("RV", 70), pos("CAM", 20), pos("NO-ESTA", 10)], [RENTA_VARIABLE, NO_INVERTIBLE]);
    const reparto = repartoDeLaCartera(summary);
    expect(reparto.fuera.map((parte) => [parte.rotulo, parte.peso])).toEqual([["Sin serie de precios", 20], ["Fuera del catálogo", 10]]);
    expect(reparto.parteInvertible).toBeCloseTo(0.7, 10);
  });

  test("pesos que no suman 100: la exposición se lee sobre lo que suman las posiciones", () => {
    /* 40 + 40 = 80. Dentro, la mitad: renta variable 50 % y no invertible 50 %. Las filas por clase siguen con los pesos tal cual: 40. */
    const { summary, xray } = informe([pos("RV", 40), pos("CAM", 40)], [RENTA_VARIABLE, NO_INVERTIBLE]);
    const reparto = repartoDeLaCartera(summary);
    expect(reparto.fuera[0].peso).toBe(40);
    expect(reparto.fuera[0].pesoSobreLaCartera).toBeCloseTo(50, 10);
    expect(filasDeExposicion(xray.pms_exposure_percent, reparto.parteInvertible)[0].peso).toBeCloseTo(50, 2);
  });

  test("una cartera solo con lo no invertible no reparte nada, y lo dice", () => {
    const { summary, xray } = informe([pos("CAM", 100)], [NO_INVERTIBLE]);
    const reparto = repartoDeLaCartera(summary);
    expect(reparto.parteInvertible).toBe(0);
    expect(filasDeExposicion(xray.pms_exposure_percent, reparto.parteInvertible)).toEqual([]);
    const html = texto(renderToStaticMarkup(conModo(createElement(PortfolioXray, { xray, reparto }))));
    expect(html).toContain("Sin posiciones invertibles.");
    expect(html).toContain("Sin serie de precios: 100,0 % de la cartera");
    expect(html).not.toContain("Sin datos");
  });

  test("un peso cero no es una parte de la cartera", () => {
    const { summary } = informe([pos("RV", 100), pos("CAM", 0)], [RENTA_VARIABLE, NO_INVERTIBLE]);
    expect(repartoDeLaCartera(summary).fuera).toEqual([]);
    expect(summary).not.toHaveProperty("non_investable_weight_percent");
  });

  test("Diseño: el aro cierra el círculo con lo que no entra, y no lo cuenta como una clase", () => {
    const { summary } = informe(POSICIONES, ACTIVOS);
    const html = texto(renderToStaticMarkup(createElement(PortfolioSummary, {
      summary,
      variant: "side",
      totalCapital: 100000,
      fueraDelReparto: repartoDeLaCartera(summary).fuera
    })));
    expect(html).toContain("Renta variable50,0 %");
    expect(html).toContain("Renta fija40,0 %");
    expect(html).toContain("Sin serie de precios10,0 %");
    expect(html).toContain("3 posiciones · 2 clases");
    expect(html).toContain("Por producto · Fondo 90,0 % · Sin serie de precios 10,0 %");
  });

  test("Diseño, sin nada fuera: como siempre", () => {
    const { summary } = informe([pos("RV", 60), pos("RF", 40)], [RENTA_VARIABLE, BONOS]);
    const html = texto(renderToStaticMarkup(createElement(PortfolioSummary, { summary, variant: "side", totalCapital: 100000, fueraDelReparto: repartoDeLaCartera(summary).fuera })));
    expect(html).not.toContain("No invertible");
    expect(html).toContain("Por producto · Fondo 100,0 %");
  });

  test("Análisis, también delante del cliente: las filas en % de la cartera y lo que falta, en cada reparto", () => {
    const { summary, xray } = informe(POSICIONES, ACTIVOS);
    for (const cliente of [false, true]) {
      const html = texto(renderToStaticMarkup(conModo(createElement(PortfolioXray, { xray, reparto: repartoDeLaCartera(summary) }), cliente)));
      /* Producto, Categoría y Exposición agregada. */
      expect(html.split("Sin serie de precios: 10,0 % de la cartera").length - 1).toBe(3);
      expect(html).not.toContain("No invertible");
      expect(html).toContain("Renta variable50,0 %");
      expect(html).toContain("Renta fija40,0 %");
      expect(html).not.toContain("55,6 %");
    }
  });

  test("Carteras guardadas: igual que Análisis", () => {
    const html = texto(renderToStaticMarkup(conModo(createElement(RadiografiaDeLaCartera, { positions: POSICIONES, assets: ACTIVOS, source: "BBDD_LIVE_API" }))));
    expect(html).toContain("Renta variable50,0 %");
    expect(html).toContain("Sin serie de precios: 10,0 % de la cartera");
    expect(radiografiaDeLaCartera(POSICIONES, ACTIVOS, "BBDD_LIVE_API").fueraDelReparto).toHaveLength(1);
  });
});

describe("Optimizar habla como Comprobar", () => {
  test("con una posición no invertible no dice «según el contrato local»", () => {
    const posiciones = [pos("RV", 60), pos("CAM", 40)];
    const activos = [RENTA_VARIABLE, NO_INVERTIBLE];
    const feasibility = checkPortfolioFeasibility({ positions: posiciones, assets: activos });
    const html = texto(renderToStaticMarkup(createElement(OptimizerPanel, { assets: activos, positions: posiciones, feasibility })));
    expect(html).toContain("CAM no es invertible.");
    expect(html).not.toContain("contrato local");
    /* Esta es la frase de partida: el informe interno la imprime también en palabras de la pantalla (decisión 80). */
    expect(feasibility.blocking_issues[0].message).toBe("CAM no es invertible según el contrato local.");
  });
});

describe("el aro de sectores dice lo mismo que sus vecinos", () => {
  const conPosiciones = (posiciones: BdbManualPortfolioPosition[], activos: BdbAssetDetail[]) =>
    texto(renderToStaticMarkup(createElement(XrayMetricsStyle, { positions: posiciones, assets: activos })));

  test("sin renta variable: las cuatro casillas dicen «Sin renta variable en esta cartera» y ninguna «Sin datos.»", () => {
    const html = conPosiciones([pos("RF", 100)], [BONOS]);
    expect(html.split("Sin renta variable en esta cartera").length - 1).toBe(4);
    expect(html).not.toContain("Sin datos");
  });

  test("con renta variable y sin sectores declarados: lo no declarado, como Estilo y Tamaño", () => {
    const html = conPosiciones([pos("RV", 100)], [RENTA_VARIABLE]);
    expect(html.split("No declarado: 100,0 % de la renta variable").length - 1).toBe(4);
    expect(html).not.toContain("Sin datos");
  });

  test("con sectores declarados, sigue el aro", () => {
    const conSectores = activo("S", { exposure_detail: { sectors: { technology: 60, energy: 40 } } });
    const html = conPosiciones([pos("S", 100)], [conSectores]);
    expect(html).toContain("Tecnología");
    expect(html).not.toContain("Sin datos");
  });
});

describe("la ficha no enseña códigos", () => {
  function ficha(tipo: unknown, bloques: InstrumentoDeLaBase["bloques"] = {}) {
    return componerFicha({
      isin: "IE00B4ND3602",
      raiz: { instrument_type: tipo, identity: { name: "Un producto", currency: "USD" }, identifiers: { ticker: "X" } },
      tarjeta: { instrument_id: "IE00B4ND3602" },
      calidad: undefined,
      bloques
    } as InstrumentoDeLaBase);
  }

  test("los seis tipos del contrato, y lo que no esté en él, en palabras", () => {
    expect(ficha("FUND").tipo).toBe("FONDO DE INVERSIÓN");
    expect(ficha("ETF").tipo).toBe("ETF");
    expect(ficha("STOCK").tipo).toBe("ACCIÓN");
    expect(ficha("INDEX").tipo).toBe("ÍNDICE");
    expect(ficha("CURRENCY").tipo).toBe("LIQUIDEZ");
    expect(ficha("OTHER").tipo).toBe("OTRO PRODUCTO");
    expect(ficha("NUEVO_TIPO").tipo).toBe("OTRO PRODUCTO");
    expect(ficha(undefined).tipo).toBe("OTRO PRODUCTO");
  });

  test("el artículo SFDR: «Artículo 8» y no ARTICLE_8", () => {
    const articulo = (valor: string) =>
      ficha("FUND", { "declared/profile": { sfdr_article: valor, as_of: "2026-10-31" } }).secciones.find((s) => s.id === "perfil")?.filas.find((f) => f.rotulo === "Artículo SFDR")?.valor;
    expect(articulo("ARTICLE_6")).toBe("Artículo 6");
    expect(articulo("ARTICLE_8")).toBe("Artículo 8");
    expect(articulo("ARTICLE_9")).toBe("Artículo 9");
    expect(articulo("OTRA_COSA")).toBe("Falta el dato");
  });

  test("«no se acoge a los artículos 8 ni 9» solo si no aplica: si falta el dato, no se afirma", () => {
    const articulo = (absences: Array<{ path: string; reason: string }>) =>
      componerFicha({
        isin: "X",
        raiz: { instrument_type: "FUND", identity: { name: "Un fondo" } },
        tarjeta: { instrument_id: "X" },
        calidad: { absences },
        bloques: { "declared/profile": { as_of: "2026-10-31" } }
      } as unknown as InstrumentoDeLaBase).secciones.find((s) => s.id === "perfil")?.filas.find((f) => f.rotulo === "Artículo SFDR");
    const noAplica = articulo([{ path: "declared/profile.sfdr_article", reason: "NOT_APPLICABLE" }]);
    expect(noAplica?.valor).toBe("No aplica");
    expect(noAplica?.glosa).toBe("Este fondo no se acoge a los artículos 8 ni 9 del reglamento.");
    const falta = articulo([]);
    expect(falta?.valor).toBe("Falta el dato");
    expect(falta?.glosa).toBeUndefined();
  });

  test("la actividad de una acción dice que es texto del proveedor, en inglés; sin texto no lo dice", () => {
    const fila = (descripcion?: string) =>
      ficha("STOCK", { "declared/equity": { as_of: "2026-11-03", listing: { exchange: "MC" }, ...(descripcion ? { business_description: descripcion } : {}) } })
        .secciones.find((s) => s.id === "equity")?.filas.find((f) => f.rotulo === "Actividad");
    expect(fila("Banco Santander operates as a bank.")?.valor).toBe("Banco Santander operates as a bank.");
    expect(fila("Banco Santander operates as a bank.")?.glosa).toBe("Texto del proveedor, en inglés.");
    expect(fila()?.valor).toBe("Falta el dato");
    expect(fila()?.glosa).toBe("El proveedor no entrega ninguno de los tres para este valor.");
  });
});

describe("la gráfica de una ficha sin serie", () => {
  test("cada motivo en palabras de asesor, y un código desconocido no se enseña", () => {
    expect(serieNoDisponible("PRICE_SERIES_MISSING")).toBe("Serie no disponible: sin serie de precios.");
    expect(serieNoDisponible("NON_INVESTABLE")).toBe("Serie no disponible: este activo está fuera del análisis histórico.");
    expect(serieNoDisponible("FX_SERIES_MISSING")).toBe("Serie no disponible: sin conversión a euros.");
    expect(serieNoDisponible("FX_QUARANTINE")).toBe("Serie no disponible: sin conversión a euros fiable.");
    expect(serieNoDisponible("QUALITY_BLOCKED")).toBe("Serie no disponible: bloqueado por calidad del dato.");
    expect(serieNoDisponible("DISTRIBUTES_WITHOUT_PAYMENTS")).toBe("Serie no disponible: reparte y no tenemos todos los pagos.");
    expect(serieNoDisponible("INSUFFICIENT_HISTORY")).toBe("Serie no disponible: histórico insuficiente.");
    expect(serieNoDisponible("UN_CODIGO_NUEVO")).toBe("Serie no disponible para este periodo.");
    expect(serieNoDisponible(null)).toBe("Serie no disponible para este periodo.");
  });

  test("delante del cliente, sin la cocina", () => {
    const paraElCliente = (motivo: string) => serieNoDisponible(motivo, { modoCliente: true });
    expect(paraElCliente("QUALITY_BLOCKED")).toBe("Serie no disponible: incidencia en su serie de precios.");
    expect(paraElCliente("FX_SERIES_MISSING")).toBe("Serie no disponible: sin conversión a euros.");
    expect(paraElCliente("FX_QUARANTINE")).toBe("Serie no disponible: sin conversión a euros fiable.");
    expect(paraElCliente("NON_INVESTABLE")).toBe("Serie no disponible: este activo está fuera del análisis histórico.");
    expect(paraElCliente("UN_CODIGO_NUEVO")).toBe("Serie no disponible para este periodo.");
  });

  describe("pintada", () => {
    let host: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      mocks.rebased.mockReset();
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
    });
    afterEach(async () => {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    });
    const monta = async (motivo: string, cliente = false) => {
      mocks.rebased.mockResolvedValue({
        schema_version: "price-series.v1", base_currency: "EUR", window: "3Y", frequency: "DAILY", rebased_to: 100, dates: [], series: [],
        coverage: { requested_assets: 1, included_assets: 0, common_observations: 0, first_date: null, last_date: null },
        excluded_assets: [{ asset_id: "X", reason: motivo }]
      });
      await act(async () => {
        root.render(conModo(createElement(AssetHistoryChart, { asset: { asset_id: "X", display_name: "X", quality_flags: [] } }), cliente));
      });
      await act(async () => { await Promise.resolve(); });
      return host.textContent ?? "";
    };

    test("no sale el código ni «no invertible»", async () => {
      const dice = await monta("NON_INVESTABLE");
      expect(dice).toContain("Serie no disponible: este activo está fuera del análisis histórico.");
      expect(dice).not.toContain("NON_INVESTABLE");
      expect(dice).not.toContain("no invertible");
    });

    test("en Modo cliente, la frase del cliente", async () => {
      expect(await monta("QUALITY_BLOCKED", true)).toContain("Serie no disponible: incidencia en su serie de precios.");
    });

    test("un código que no conoce no se escribe, ni en minúsculas", async () => {
      const dice = await monta("OTRO_CODIGO_NUEVO");
      expect(dice).toContain("Serie no disponible para este periodo.");
      expect(dice.toLowerCase()).not.toContain("otro codigo");
    });
  });
});
