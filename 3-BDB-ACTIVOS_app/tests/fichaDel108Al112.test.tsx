import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { componerFicha } from "../src/adapters/componerFicha";
import { columnasDeActivos, filasDeActivos, metodologiaDeLaComparativa, notasDeLaComparativa, puntoDeLaComparativa, type FuenteDeColumna } from "../src/adapters/comparativaDeActivos";
import { cifraDeLaTarjeta, componerFila } from "../src/adapters/componerLista";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { aDosCifras, importeNegociado, lineaDeLoNegociado } from "../src/core/loNegociado";
import { describeMetricsMethodology } from "../src/core/metricsMethodology";
import { fraseDeLaSerieValida, fraseDelHueco } from "../src/core/ventanaSinMedir";
import { filasDeComposicion } from "../src/adapters/tablaDeComposicion";
import { PlanoRiesgoRetorno } from "../src/components/tabla/PlanoRiesgoRetorno";
import { cifrasDelProveedorEnOtraDivisa } from "../src/core/medidaDeLaCartera";
import { candidateRanking, rotuloDeLaVentana } from "../src/core/metricsFrequency";
import { computePortfolioPreviewMetrics } from "../src/core/portfolio";
import type { BdbAssetDetail, BdbAssetSearchResult } from "../src/types/bdbAssets";

/** Las decisiones 108, 110, 111 y 112 en lo que se lee, con resultados escritos a mano. */

const BOLSAS: Record<string, string> = { AS: "Ámsterdam", MC: "Madrid", F: "Fráncfort" };
const bolsa = (codigo: string) => BOLSAS[codigo] ?? codigo;

describe("108. La línea de lo que se negocia", () => {
  test("el redondeo de «unos»: dos cifras significativas, uno solo para todos", () => {
    expect(aDosCifras(56145.05)).toBe(56000);
    expect(aDosCifras(2828.8)).toBe(2800);
    expect(aDosCifras(3800)).toBe(3800);
    expect(aDosCifras(146920812.5)).toBe(150000000);
    expect(aDosCifras(95.4)).toBe(95);
    expect(aDosCifras(999500)).toBe(1000000);
    expect(aDosCifras(0)).toBe(0);
  });

  test("el importe, con su moneda: el símbolo cuando no hay duda, y el millón como en el patrimonio", () => {
    expect(importeNegociado(56145.05, "USD")).toBe("56.000\u00a0$");
    expect(importeNegociado(2828.8, "EUR")).toBe("2.800\u00a0€");
    expect(importeNegociado(146920812.5, "EUR")).toBe("150\u00a0M€");
    expect(importeNegociado(1234567, "GBP")).toBe("1,2\u00a0M£");
    expect(importeNegociado(12718839529, "USD")).toBe("13.000\u00a0M$");
    expect(importeNegociado(328027580, "CHF")).toBe("330\u00a0M\u00a0CHF");
    expect(importeNegociado(999500, "EUR")).toBe("1\u00a0M€");
    expect(importeNegociado(4000, "CAD")).toBe("4.000\u00a0CAD");
  });

  test("la línea de Óscar, tal cual", () => {
    const linea = lineaDeLoNegociado(
      { exchange: "AS", currency: "USD", as_of: "2026-11-04", sessions: 255, sessions_without_volume: 4, median_traded_value: 56145.05, median_sessions: 251 },
      bolsa
    );
    expect(linea.texto).toBe("Ámsterdam · unos 56.000\u00a0$ al día · 4 de 255 sesiones sin volumen");
    expect(linea.falta).toBe(false);
    expect(linea.glosa).toContain("04/11/2026");
    expect(linea.glosa).not.toContain("desdoblamiento");
  });

  test("sin adjetivos ni umbral: Desa dice lo mismo que un valor grande, con sus cifras", () => {
    expect(lineaDeLoNegociado({ exchange: "MC", currency: "EUR", as_of: "2026-11-04", sessions: 255, sessions_without_volume: 130, median_traded_value: 3800, median_sessions: 125 }, bolsa).texto)
      .toBe("Madrid · unos 3.800\u00a0€ al día · 130 de 255 sesiones sin volumen");
    expect(lineaDeLoNegociado({ exchange: "MC", currency: "EUR", as_of: "2026-11-03", sessions: 255, sessions_without_volume: 0, median_traded_value: 90631103.94, median_sessions: 255 }, bolsa).texto)
      .toBe("Madrid · unos 91\u00a0M€ al día · 0 de 255 sesiones sin volumen");
  });

  test("el proveedor no da volumen: «Falta el dato», con la plaza, y no un cero", () => {
    const linea = lineaDeLoNegociado({ exchange: "MC", currency: "EUR", as_of: "2026-11-03", sessions: 261 }, bolsa);
    expect(linea.texto).toBe("Madrid · Falta el dato");
    expect(linea.falta).toBe(true);
  });

  test("todas las sesiones a cero con el precio parado sí se dice: no se negocia", () => {
    const linea = lineaDeLoNegociado({ exchange: "MC", currency: "EUR", as_of: "2026-11-03", sessions: 255, sessions_without_volume: 255 }, bolsa);
    expect(linea.texto).toBe("Madrid · 255 de 255 sesiones sin volumen");
    expect(linea.falta).toBe(false);
  });

  test("sin bloque, «Falta el dato»; con un desdoblamiento, la glosa dice de cuántas es la mediana", () => {
    expect(lineaDeLoNegociado(undefined, bolsa).texto).toBe("Falta el dato");
    const conDesdoble = lineaDeLoNegociado({ exchange: "US", currency: "USD", as_of: "2026-11-03", sessions: 251, sessions_without_volume: 0, median_traded_value: 1190785107, median_sessions: 146 }, bolsa);
    expect(conDesdoble.texto).toBe("US · unos 1.200\u00a0M$ al día · 0 de 251 sesiones sin volumen");
    expect(conDesdoble.glosa).toContain("146 sesiones posteriores a un salto del cierre sin ajustar");
  });

  const ficha = (tipo: string, clase: string, trading?: Record<string, unknown>) =>
    componerFicha({
      isin: "IE000DR59CI3",
      raiz: { identity: { name: "Un activo", currency: "USD" }, instrument_type: tipo },
      tarjeta: { instrument_id: "IE000DR59CI3", identity: { name: "Un activo" } },
      calidad: undefined,
      bloques: { "declared/quote": { as_of: "2026-11-03", price: 9.76, price_class: clase, currency: "USD", ...(trading ? { trading } : {}) } }
    });
  const filaDe = (f: ReturnType<typeof componerFicha>) => f.secciones.find((s) => s.id === "precio")?.filas.find((x) => x.rotulo === "Negociación");
  const STOR = { exchange: "AS", currency: "USD", as_of: "2026-11-04", sessions: 255, sessions_without_volume: 4, median_traded_value: 56145.05, median_sessions: 251 };

  test("en la ficha de un ETF y de una acción, con su fila", () => {
    expect(filaDe(ficha("ETF", "MARKET_PRICE", STOR))?.valor).toBe("Ámsterdam · unos 56.000\u00a0$ al día · 4 de 255 sesiones sin volumen");
    expect(filaDe(ficha("STOCK", "MARKET_PRICE", { ...STOR, exchange: "MC", currency: "EUR" }))?.valor).toContain("Madrid · unos 56.000\u00a0€");
    expect(filaDe(ficha("ETF", "MARKET_PRICE"))).toMatchObject({ valor: "Falta el dato", ausencia: "falta" });
  });

  test("un fondo no lleva esa línea", () => {
    expect(filaDe(ficha("FUND", "NAV"))).toBeUndefined();
  });
});

/* ---- la ficha de un fondo con cifras nuestras y del proveedor ---- */

function fondo(partes: {
  metricas?: Record<string, unknown>;
  retornos?: Record<string, unknown>;
  riesgo?: Record<string, unknown>;
  tarjeta?: Record<string, unknown>;
}): InstrumentoDeLaBase {
  return {
    isin: "LU1383852487",
    raiz: { identity: { name: "Un fondo", currency: "EUR" }, instrument_type: "FUND" },
    tarjeta: { instrument_id: "LU1383852487", identity: { name: "Un fondo" }, metrics: partes.tarjeta ?? {} },
    calidad: undefined,
    bloques: {
      "computed/metrics": { method: "EXTRACTOR_MONTHLY_V2", as_of: "2026-10-31", computed_at: "2026-11-05", ...(partes.metricas ?? {}) },
      "declared/provider_returns": { as_of: "2026-09-30", trailing_return: partes.retornos ?? {} },
      "declared/provider_risk": { as_of: "2026-10-31", ...(partes.riesgo ?? {}) }
    }
  };
}
const seccion = (f: ReturnType<typeof componerFicha>, id: string) => f.secciones.find((s) => s.id === id);

describe("110. Sin cifra nuestra, la del proveedor, con su nombre", () => {
  const allianz = fondo({
    metricas: { annualized_return: { "1y": 0.02 }, volatility: { "1y": 0.00197 }, sharpe: { "1y": -0.3768 } },
    retornos: { "1y": { fund: 0.02 }, "3y": { fund: 0.02978901 }, "5y": { fund: 0.02179793 }, "10y": { fund: 0.00954905 } },
    riesgo: { volatility: { "1y": { fund: 0.00197 }, "3y": { fund: 0.00296 }, "5y": { fund: 0.00492 } }, sharpe: { "1y": { fund: -0.226 }, "10y": { fund: 0.317 } } }
  });

  test("la ficha enseña las ventanas que nuestra serie no alcanza, y dice que son suyas", () => {
    const f = componerFicha(allianz);
    const rentabilidad = seccion(f, "rentabilidad");
    expect(rentabilidad?.filas.map((x) => [x.rotulo, x.valor])).toEqual([["3 años", "+2,98\u00a0%"], ["5 años", "+2,18\u00a0%"], ["10 años", "+0,95\u00a0%"]]);
    expect(rentabilidad?.procedencia?.[0]?.texto).toContain("Cifras del proveedor");
  });

  test("y en el riesgo, a 5 y a 10 años si las hay, con la fila de 1 año, que es nuestra, fuera", () => {
    const riesgo = seccion(componerFicha(allianz), "riesgo");
    expect(riesgo?.filas.map((x) => [x.rotulo, x.valor])).toEqual([
      ["Volatilidad 3 años", "0,30\u00a0%"],
      ["Volatilidad 5 años", "0,49\u00a0%"],
      ["Sharpe 10 años", "0,32"]
    ]);
    expect(riesgo?.procedencia?.[0]?.texto).toContain("Cifras del proveedor");
  });

  test("en la tarjeta: la nuestra, y donde no la hay la suya, marcada", () => {
    const tarjeta = { metrics: { annualized_return: { "1y": 0.02 }, provider: { annualized_return: { "3y": 0.0298 } } } };
    expect(cifraDeLaTarjeta(tarjeta, "annualized_return", "1y")).toEqual({ valor: 0.02, delProveedor: false });
    expect(cifraDeLaTarjeta(tarjeta, "annualized_return", "3y")).toEqual({ valor: 0.0298, delProveedor: true });
    expect(cifraDeLaTarjeta(tarjeta, "annualized_return", "5y")).toEqual({ valor: undefined, delProveedor: false });
  });

  test("el Buscador ordena esa fila con las del proveedor, no con las nuestras", () => {
    const fila = componerFila({ instrument_id: "X", metrics: { method: "EXTRACTOR_MONTHLY_V2", ytd_return: 0.1, provider: { method: "TRAILING_PROVIDER", annualized_return: { "1y": 0.1462 }, volatility: { "1y": 0.1409 }, sharpe: { "1y": 0.39 } } } });
    expect(fila.rentabilidad1a).toBe(0.1462);
    expect(fila.escala).toBe("TRAILING_PROVIDER");
    const propia = componerFila({ instrument_id: "Y", metrics: { method: "EXTRACTOR_MONTHLY_V2", annualized_return: { "1y": 0.02 }, volatility: { "1y": 0.01 }, sharpe: { "1y": 0.5 }, provider: { method: "TRAILING_PROVIDER", sharpe: { "10y": 0.3 } } } });
    expect(propia.escala).toBe("EXTRACTOR_MONTHLY_V2");
  });

  const activo = (id: string): BdbAssetSearchResult => ({ asset_id: id, display_name: id, instrument_type: "FUND", currency: "EUR", metrics: {} } as unknown as BdbAssetSearchResult);
  const fuentes: FuenteDeColumna[] = [
    { activo: activo("allianz"), tarjeta: { metrics: { source: "COMPUTED", method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", annualized_return: { "1y": 0.02 }, provider: { method: "TRAILING_PROVIDER", as_of: "2026-10-31", returns_as_of: "2026-09-30", annualized_return: { "3y": 0.0298 }, volatility: { "3y": 0.003 } } } } },
    { activo: activo("otro"), tarjeta: { metrics: { source: "COMPUTED", method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", annualized_return: { "1y": 0.05, "3y": 0.06 }, volatility: { "3y": 0.1 } } } }
  ];
  const columnas = columnasDeActivos(fuentes);
  const filas = filasDeActivos(fuentes, { modoCliente: false });
  const fila = (id: string) => filas.find((f) => f.id === id)!;

  test("en el Comparador, la celda dice de quién es y con qué fecha, y la de al lado no", () => {
    const celda = fila("annualized_return-3y").celda(columnas[0]!);
    expect(celda.texto).toBe("+2,98\u00a0%");
    expect(celda.apunte).toBe("Del proveedor · a 30/09/2026");
    expect(fila("annualized_return-3y").celda(columnas[1]!).apunte).toBeUndefined();
    expect(fila("volatility-3y").celda(columnas[0]!).apunte).toBe("Del proveedor · a 31/10/2026");
    expect(fila("annualized_return-1y").celda(columnas[0]!).apunte).toBeUndefined();
  });

  test("dos cifras de método distinto en la misma fila se marcan «no comparable» (decisión 42), aunque la columna diga otro método", () => {
    const de = (id: string) => columnas.map((c) => ({ value: fila(id).valor?.(c), method: fila(id).metodoDe?.(c)?.metodo ?? c.metodo, frequency: fila(id).metodoDe?.(c)?.frecuencia ?? c.frecuencia }));
    expect(describeMetricsMethodology(de("annualized_return-3y")).mixed).toBe(true);
    expect(describeMetricsMethodology(de("annualized_return-1y")).mixed).toBe(false);
    const informe = metodologiaDeLaComparativa(columnas, filas);
    expect(informe.noComparable?.columnas).toEqual(["annualized_return-3y", "volatility-3y"]);
    expect(informe.noComparable?.calculoDe["allianz"]).toBe("con la cifra del proveedor");
    expect(informe.noComparable?.calculoDe["otro"]).toBe("con datos mensuales en euros");
  });

  test("el plano no pone esas coordenadas en el panel de las nuestras", () => {
    expect(puntoDeLaComparativa(columnas[0]!, filas).metodo).toBe("TRAILING_PROVIDER");
    expect(puntoDeLaComparativa(columnas[1]!, filas).metodo).toBe("EXTRACTOR_MONTHLY_V2");
  });
});

describe("110. Lo que lee una ventana, lee el rótulo de esa ventana", () => {
  /* Vanguard S&P 500, de la cartera de muestra: suyas son las cifras a 10 años, y las de 3 años son nuestras, como las de los demás. */
  const VANGUARD_METRICAS = {
    metrics_method: "PROPIA_Y_PROVEEDOR",
    metrics_by_window: {
      "1y": { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY" },
      "3y": { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY" },
      "10y": { method: "TRAILING_PROVIDER", frequency: "PROVIDER" }
    },
    annualized_return_3y: 0.2,
    volatility_3y: 0.14,
    sharpe_3y: 1.28
  };
  const ALLIANZ_METRICAS = {
    metrics_method: "PROPIA_Y_PROVEEDOR",
    metrics_by_window: {
      "1y": { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY" },
      "3y": { method: "TRAILING_PROVIDER", frequency: "PROVIDER" }
    },
    annualized_return_3y: 0.0298,
    volatility_3y: 0.003,
    sharpe_3y: 1.2
  };
  const PROPIAS = { metrics_method: "EXTRACTOR_MONTHLY_V2", metrics_frequency: "MONTHLY", annualized_return_3y: 0.1, volatility_3y: 0.12, sharpe_3y: 0.9 };
  const detalle = (id: string, metrics: object, currency = "EUR"): BdbAssetDetail =>
    ({ asset_id: id, display_name: id, instrument_type: "FUND", currency, economic_asset_class: "EQUITY", is_investable: true, quality_flags: [], metrics }) as unknown as BdbAssetDetail;
  const posicion = (id: string, peso: number) => ({ asset_id: id, weight_percent: peso });

  test("sin mezcla, el rótulo del activo; con mezcla, el de la ventana, y nada si esa ventana no tiene cifras", () => {
    expect(rotuloDeLaVentana(PROPIAS, "3y")).toEqual({ method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY" });
    expect(rotuloDeLaVentana(VANGUARD_METRICAS, "3y")).toEqual({ method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY" });
    expect(rotuloDeLaVentana(VANGUARD_METRICAS, "10y")).toEqual({ method: "TRAILING_PROVIDER", frequency: "PROVIDER" });
    expect(rotuloDeLaVentana(VANGUARD_METRICAS, "5y")).toEqual({});
    expect(rotuloDeLaVentana(undefined, "3y")).toEqual({ method: undefined, frequency: undefined });
  });

  test("un fondo con solo la cifra a 10 años del proveedor no deja a su cartera sin volatilidad estimada", () => {
    const assets = [detalle("a", PROPIAS), detalle("v", VANGUARD_METRICAS)];
    const { metrics } = computePortfolioPreviewMetrics({ manualPositions: [posicion("a", 50), posicion("v", 50)], assets });
    expect(metrics.volatility_comparable).toBe(true);
    expect(metrics.volatility_3y).toEqual(expect.any(Number));
  });

  test("con la volatilidad a 3 años del proveedor sí, como con un fondo que solo tiene las suyas", () => {
    const assets = [detalle("a", PROPIAS), detalle("z", ALLIANZ_METRICAS)];
    const { metrics } = computePortfolioPreviewMetrics({ manualPositions: [posicion("a", 50), posicion("z", 50)], assets });
    expect(metrics.volatility_comparable).toBe(false);
    expect(metrics.volatility_3y).toBeUndefined();
  });

  test("el orden de las alternativas sigue por Sharpe si los de 3 años salen del mismo cálculo", () => {
    const de = (metrics: object) => ({ asset_id: "x", display_name: "x", metrics }) as unknown as BdbAssetSearchResult;
    expect(candidateRanking([de(PROPIAS), de(VANGUARD_METRICAS)]).label).toBe("Sharpe 3A comparable");
    /* MET-4: con el de 3 años del proveedor ya no se ordena por rentabilidad mezclando, sino por grupos: dos cálculos, dos grupos. */
    const mezcla = candidateRanking([de(PROPIAS), de(ALLIANZ_METRICAS)]);
    expect(mezcla.label).toBe("por grupos comparables");
    expect(mezcla.grupos).toHaveLength(2);
  });

  test("la tabla de composición dice de quién es la volatilidad a 3 años", () => {
    const filas = filasDeComposicion({
      positions: [posicion("a", 40), posicion("v", 30), posicion("z", 30)],
      assets: [detalle("a", PROPIAS), detalle("v", VANGUARD_METRICAS), detalle("z", ALLIANZ_METRICAS)]
    } as unknown as Parameters<typeof filasDeComposicion>[0]);
    const del = (id: string) => filas.flatMap((grupo) => ("filas" in grupo ? (grupo as unknown as { filas: { id: string; volatilidadDelProveedor?: boolean }[] }).filas : [grupo as unknown as { id: string; volatilidadDelProveedor?: boolean }])).find((f) => f.id === id)?.volatilidadDelProveedor;
    expect(del("a")).toBe(false);
    expect(del("v")).toBe(false);
    expect(del("z")).toBe(true);
  });

  test("el aviso de divisas nombra a quien lleva una cifra del proveedor en otra moneda, también si solo es una ventana", () => {
    const assets = [detalle("v", VANGUARD_METRICAS, "USD"), detalle("a", PROPIAS, "USD"), detalle("z", ALLIANZ_METRICAS)];
    const nombres = cifrasDelProveedorEnOtraDivisa([posicion("v", 40), posicion("a", 30), posicion("z", 30)], assets).map((cifra) => cifra.assetId);
    expect(nombres).toEqual(["v"]);
  });

  test("el plano pone a Allianz AT2 en el panel de sus cifras, no en el del método de su columna", () => {
    const columnas = [
      { id: "z", nombre: "Allianz AT2", metodo: "EXTRACTOR_MONTHLY_V2", frecuencia: "MONTHLY" },
      { id: "m", nombre: "M&G Asian", metodo: "EXTRACTOR_MONTHLY_V2", frecuencia: "MONTHLY" },
      { id: "i", nombre: "iShares World", metodo: "EXTRACTOR_MONTHLY_V2", frecuencia: "MONTHLY" }
    ];
    const puntos: Record<string, { metodo: string; volatilidad: number; rentabilidad: number }> = {
      z: { metodo: "TRAILING_PROVIDER", volatilidad: 0.003, rentabilidad: 0.0298 },
      m: { metodo: "EXTRACTOR_MONTHLY_V2", volatilidad: 0.156, rentabilidad: 0.236 },
      i: { metodo: "EXTRACTOR_MONTHLY_V2", volatilidad: 0.119, rentabilidad: 0.202 }
    };
    const html = renderToStaticMarkup(
      <PlanoRiesgoRetorno columnas={columnas as never} ventana="3 años" puntoDe={(columna) => ({ id: columna.id, nombre: columna.nombre, ...puntos[columna.id]! })} />
    );
    expect(html).toContain("Un panel por método");
    expect(html).toContain("su método es otro");
  });
});

describe("111 y 112. Lo que falta, y por qué", () => {
  test("las dos frases", () => {
    expect(fraseDeLaSerieValida("2018-10-26", ["10y"])).toBe("Falta el dato a 10 años: su serie solo vale desde el 26/10/2018, y ese periodo empieza antes.");
    expect(fraseDeLaSerieValida("2018-10-26", [])).toBeUndefined();
    expect(fraseDeLaSerieValida(undefined, ["10y"])).toBeUndefined();
    expect(fraseDeLaSerieValida("2026-02-01", ["ytd", "1y"])).toBe("Falta el dato en lo que va de año y a 1 año: su serie solo vale desde el 01/02/2026, y ese periodo empieza antes.");
    expect(fraseDelHueco({ from: "2018-07-18", to: "2022-09-07", windows: ["5y", "10y"] })).toBe("Falta el dato a 5 y 10 años: su serie no tiene puntos del 18/07/2018 al 07/09/2022.");
    expect(fraseDelHueco({ from: "2022-11-25", to: "2023-02-24", windows: ["1y", "3y", "5y"] })).toBe("Falta el dato a 1, 3 y 5 años: su serie no tiene puntos del 25/11/2022 al 24/02/2023.");
  });

  test("un hueco: la columna sigue, dice que falta y por qué, y la cifra del proveedor sale aparte", () => {
    const ab = fondo({
      metricas: {
        annualized_return: { "1y": 0.0295, "3y": 0.1529 },
        volatility: { "1y": 0.14, "3y": 0.16 },
        max_drawdown: { "1y": -0.1439, "3y": -0.2588 },
        inputs: { series_gaps: [{ from: "2018-07-18", to: "2022-09-07", days: 1512, windows: ["5y", "10y"] }] }
      },
      retornos: { "5y": { fund: 0.0932 }, "10y": { fund: 0.1474 } }
    });
    const f = componerFicha(ab);
    const tabla = seccion(f, "metricas")?.tabla;
    expect(tabla?.columnas).toEqual(["", "1 año", "3 años", "5 años", "10 años"]);
    const caida = tabla?.filas.find((x) => x[0] === "Caída máxima");
    expect(caida?.[3]).toEqual({ texto: "Falta el dato", ausencia: "falta" });
    expect(caida?.[4]).toEqual({ texto: "Falta el dato", ausencia: "falta" });
    expect(seccion(f, "metricas")?.nota).toContain("Falta el dato a 5 y 10 años: su serie no tiene puntos del 18/07/2018 al 07/09/2022.");
    /* No dice «Sin historia», que sería falso: la serie llega. */
    expect(seccion(f, "metricas")?.nota).not.toContain("Sin historia");
    expect(seccion(f, "rentabilidad")?.filas.map((x) => [x.rotulo, x.valor])).toEqual([["5 años", "+9,32\u00a0%"], ["10 años", "+14,74\u00a0%"]]);
  });

  const asian = fondo({
    metricas: { annualized_return: { "5y": 0.05, "10y": 0.0964 }, volatility: { "5y": 0.15, "10y": 0.162 }, max_drawdown: { "5y": -0.3, "10y": -0.35 }, sharpe: { "5y": 0.2 } },
    retornos: { "10y": { fund: 0.1023 } },
    riesgo: { sharpe: { "10y": { fund: 0.5 } } },
    tarjeta: { series_valid_from: "2018-10-26", windows_before_series_valid_from: ["10y"], annualized_return: { "5y": 0.05 } }
  });

  test("M&G Asian: la cifra a 10 años no se enseña, ni la nuestra ni la del proveedor, y dice por qué", () => {
    const f = componerFicha(asian);
    const tabla = seccion(f, "metricas")?.tabla;
    const rentabilidad = tabla?.filas.find((x) => x[0] === "Rentabilidad anualizada");
    expect(rentabilidad?.[1]).toBe("+5,00\u00a0%");
    expect(rentabilidad?.[2]).toEqual({ texto: "Falta el dato", ausencia: "falta" });
    expect(JSON.stringify(f)).not.toContain("9,64");
    expect(JSON.stringify(f)).not.toContain("10,23");
    expect(seccion(f, "metricas")?.nota).toContain("Falta el dato a 10 años: su serie solo vale desde el 26/10/2018, y ese periodo empieza antes.");
    /* El €STR no es el motivo aquí. */
    expect(seccion(f, "metricas")?.nota).not.toContain("€STR");
    expect(seccion(f, "rentabilidad")).toBeUndefined();
    expect(seccion(f, "riesgo")).toBeUndefined();
  });

  test("el Comparador dice lo mismo, con el nombre del activo", () => {
    const activo = { asset_id: "asian", display_name: "M&G Asian", instrument_type: "FUND", metrics: {} } as unknown as BdbAssetSearchResult;
    const conFecha: FuenteDeColumna = { activo, tarjeta: { metrics: { series_valid_from: "2018-10-26", windows_before_series_valid_from: ["10y"], method: "EXTRACTOR_MONTHLY_V2", annualized_return: { "5y": 0.05 } } } };
    expect(notasDeLaComparativa([conFecha])).toEqual(["M&G Asian. Falta el dato a 10 años: su serie solo vale desde el 26/10/2018, y ese periodo empieza antes."]);
    const filas = filasDeActivos([conFecha], { modoCliente: false });
    const columnas = columnasDeActivos([conFecha]);
    expect(filas.find((f) => f.id === "annualized_return-10y")?.celda(columnas[0]!).texto).toBe("Falta el dato");
    expect(notasDeLaComparativa([{ activo, tarjeta: { metrics: { method: "X" } } }, { activo }])).toEqual([]);
  });
});
