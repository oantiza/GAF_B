import { describe, expect, test, vi } from "vitest";
import { cargasDeLaCartera } from "../src/adapters/carteraDelEmisor";
import {
  aCarteraDeLaApp,
  cruceDeTickers,
  fraseDeLasCarterasDelEmisor,
  indiceDeTickers,
  isinPorTicker,
  leerResumenDelEmisor,
  lineasDeLosTrozos,
  paresDeLasCarteras,
  paresDelCatalogo,
  procedenciaDeLaCartera,
  procedenciaDeLaCarteraDelEmisor,
  type CarteraDelEmisor,
  type LineaDelEmisor,
  type ResumenDelEmisor
} from "../src/core/carteraDelEmisor";
import { cuentaEnElSolapamiento, claseDeLinea } from "../src/core/lineaDeCartera";
import { calculateOverlap, situacionDeLaCartera } from "../src/core/overlap";
import { buildReportOverlap } from "../src/core/reportOverlap";
import type { BdbAssetHoldings, BdbHoldingPosition } from "../src/types/bdbAssets";

/**
 * La cartera completa del emisor de un ETF (decisión B-79 de Óscar, 11-11-2026, revisada el 14-11-2026). Lo que se prueba es lo que la
 * decisión y el encargo piden: que un ETF del que el proveedor solo da sus diez mayores pase a medirse, que `usable_for_measurement:
 * false` lo deje como estaba y que el ticker cruce con el ISIN sin falsos positivos. Desde el 14-11-2026 se pide igual dentro y fuera del
 * Modo cliente («con respecto a los ETF, no los dejes fuera»): lo que cambia en Modo cliente es que no se dice de quién es la cartera.
 */

const ETF = "IE00B5BMR087";
const FONDO = "LU1883318740";

const RESUMEN: ResumenDelEmisor = {
  source: "ishares",
  as_of: "2026-11-06",
  usable_for_measurement: true,
  positions_count: 4,
  chunk_count: 1
};

function cartera(lineas: LineaDelEmisor[], resumen: Partial<ResumenDelEmisor> = {}): CarteraDelEmisor {
  return { asset_id: ETF, resumen: { ...RESUMEN, positions_count: lineas.length, ...resumen }, lineas };
}

/* Lo que da iShares del S&P 500: ticker, divisa de cotización y valor de mercado; el peso, redondeado. */
const SP500: LineaDelEmisor[] = [
  { name: "NVIDIA CORP", ticker: "NVDA", weight: 0.4, market_value: 400, currency: "USD", position_type: "EQUITY" },
  { name: "APPLE INC", ticker: "AAPL", weight: 0.3, market_value: 300, currency: "USD", position_type: "EQUITY" },
  { name: "MICROSOFT CORP", ticker: "MSFT", weight: 0.29, market_value: 290, currency: "USD", position_type: "EQUITY" },
  { name: "S&P500 EMINI DEC 25", ticker: "ESZ5", weight: 0.01, market_value: 10, currency: "USD", position_type: "DERIVATIVE" }
];

const linea = (name: string, weight_pct: number, extra: Partial<BdbHoldingPosition> = {}): BdbHoldingPosition => ({ name, weight_pct, ...extra });

/* Lo que da el proveedor del mismo ETF: sus diez mayores, aquí dos, un 27 %. No llega a la mitad. */
const PROVEEDOR_DEL_ETF: BdbAssetHoldings = {
  asset_id: ETF,
  storage_mode: "SINGLE_DOCUMENT",
  as_of_date: "2026-09-30",
  holdings: [linea("NVIDIA Corp", 15, { isin: "US67066G1040" }), linea("Apple Inc", 12, { isin: "US0378331005" })]
};

/* Un fondo con la cartera entera, por ISIN, con ticker y divisa en parte de sus líneas, como Morningstar. */
const PROVEEDOR_DEL_FONDO: BdbAssetHoldings = {
  asset_id: FONDO,
  storage_mode: "SINGLE_DOCUMENT",
  holdings: [
    linea("NVIDIA Corp", 20, { isin: "US67066G1040", ticker: "NVDA", currency: "USD" }),
    linea("Apple Inc", 30, { isin: "US0378331005", ticker: "AAPL", currency: "USD" }),
    linea("Nestle SA", 50, { isin: "CH0038863350", ticker: "NESN", currency: "CHF" })
  ]
};

function fuenteDelProveedor() {
  const porId = new Map([[ETF, PROVEEDOR_DEL_ETF], [FONDO, PROVEEDOR_DEL_FONDO]]);
  return {
    getAssetHoldings: vi.fn(async (id: string) => porId.get(id) ?? null),
    getAssetHoldingsMany: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, porId.get(id) ?? null] as const)))
  };
}

const ACTIVOS = [
  { asset_id: ETF, instrument_type: "ETF" as const, display_name: "iShares Core S&P 500", currency: "USD" },
  { asset_id: FONDO, instrument_type: "FUND" as const, display_name: "Amundi Global Equity Responsible", currency: "EUR" }
];

describe("un ETF con cartera del emisor pasa a medirse", () => {
  test("con la del proveedor no llega a la mitad, y con la del emisor entra en la matriz con cifra", async () => {
    expect(situacionDeLaCartera("ETF", PROVEEDOR_DEL_ETF).situacion).toBe("insuficiente");
    expect(calculateOverlap(PROVEEDOR_DEL_ETF, PROVEEDOR_DEL_FONDO).overlapPercent).toBeNull();

    const leer = vi.fn(async () => cartera(SP500));
    const cargas = cargasDeLaCartera(fuenteDelProveedor(), { activos: ACTIVOS, leer, catalogo: async () => [] });
    const porId = await cargas.getAssetHoldingsMany!([ETF, FONDO]);
    const delEtf = porId.get(ETF)!;

    expect(leer).toHaveBeenCalledTimes(1);
    expect(leer).toHaveBeenCalledWith(ETF);
    expect(delEtf.issuer_portfolio).toEqual({ source: "ishares", as_of: "2026-11-06", weighting: "MARKET_VALUE" });
    expect(situacionDeLaCartera("ETF", delEtf).situacion).toBe("medible");
    /* Por valor de mercado, NVIDIA 40 y Apple 30; con el fondo, min(40, 20) + min(30, 30). Microsoft no está en el fondo y el futuro no cuenta. */
    expect(calculateOverlap(delEtf, porId.get(FONDO)).overlapPercent).toBeCloseTo(50, 9);
    /* El fondo sigue con la suya. */
    expect(porId.get(FONDO)).toBe(PROVEEDOR_DEL_FONDO);

    const matriz = buildReportOverlap(
      [
        { asset_id: ETF, display_name: "iShares Core S&P 500", weight_percent: 60, instrument_type: "ETF" },
        { asset_id: FONDO, display_name: "Amundi Global Equity Responsible", weight_percent: 40, instrument_type: "FUND" }
      ],
      porId
    );
    expect(matriz.positions.map((p) => p.status)).toEqual(["available", "available"]);
    expect(matriz.positions[0].issuerPortfolio?.as_of).toBe("2026-11-06");
    expect(matriz.positions[0].asOfDate).toBe("2026-11-06");
    expect(matriz.positions[1].issuerPortfolio).toBeUndefined();
    expect(matriz.values[0][1]).toBeCloseTo(50, 9);
  });

  test("el peso es el valor de mercado de la línea sobre la suma de la lista: los pesos redondeados no suman lo que hay", () => {
    /* Como el Global Aggregate: los pesos declarados suman el 75,7 % y el valor de mercado cubre la lista entera. */
    const lineas: LineaDelEmisor[] = [
      { name: "TREASURY NOTE", weight: 0.4, market_value: 500, position_type: "FIXED_INCOME" },
      { name: "BUND", weight: 0.357, market_value: 500, position_type: "FIXED_INCOME" }
    ];
    const app = aCarteraDeLaApp(cartera(lineas));
    expect(app.holdings.map((h) => h.weight_pct)).toEqual([50, 50]);
    expect(app.issuer_portfolio?.weighting).toBe("MARKET_VALUE");
  });

  test("sin valor de mercado en todas las líneas, el peso declarado, y lo dice", () => {
    const app = aCarteraDeLaApp(cartera([
      { name: "ASML HOLDING NV", isin: "NL0010273215", weight: 0.6 },
      { name: "SAP SE", isin: "DE0007164600", weight: 0.4, market_value: 10 }
    ]));
    expect(app.holdings.map((h) => h.weight_pct)).toEqual([60, 40]);
    expect(app.issuer_portfolio?.weighting).toBe("DECLARED_WEIGHT");
  });

  test("los derivados y la liquidez del emisor no cuentan en el solapamiento; las acciones son acciones", () => {
    const app = aCarteraDeLaApp(cartera([
      ...SP500,
      { name: "USD CASH", weight: 0.01, market_value: 10, position_type: "CASH" }
    ]));
    const porNombre = new Map(app.holdings.map((h) => [h.name, h]));
    expect(cuentaEnElSolapamiento(porNombre.get("S&P500 EMINI DEC 25")!.holding_type_code)).toBe(false);
    expect(cuentaEnElSolapamiento(porNombre.get("USD CASH")!.holding_type_code)).toBe(false);
    expect(cuentaEnElSolapamiento(porNombre.get("APPLE INC")!.holding_type_code)).toBe(true);
    expect(claseDeLinea(porNombre.get("APPLE INC")!)).toBe("accion");
    expect(claseDeLinea(porNombre.get("S&P500 EMINI DEC 25")!)).toBe("otra");
  });

  test("la procedencia dice que es la del emisor y de qué fecha", () => {
    expect(procedenciaDeLaCarteraDelEmisor({ as_of: "2026-09-30" })).toBe("cartera del emisor, a 30/09/2026");
    expect(fraseDeLasCarterasDelEmisor([{ nombre: "Vanguard S&P 500", origen: { as_of: "2026-09-30" } }, { nombre: "Amundi" }])).toBe(
      "Cartera completa del emisor, no la del proveedor: Vanguard S&P 500, a 30/09/2026."
    );
    expect(fraseDeLasCarterasDelEmisor([{ nombre: "Amundi" }])).toBeNull();
  });
});

describe("si no sirve para medir, el ETF sigue con lo del proveedor", () => {
  test("usable_for_measurement: false, como un sintético", async () => {
    const leer = vi.fn(async () => cartera([], { usable_for_measurement: false, not_usable_reason: "SUBSTITUTE_BASKET", chunk_count: 0, positions_count: 120 }));
    const cargas = cargasDeLaCartera(fuenteDelProveedor(), { activos: ACTIVOS, leer, catalogo: async () => [] });
    const porId = await cargas.getAssetHoldingsMany!([ETF, FONDO]);
    expect(leer).toHaveBeenCalledWith(ETF);
    expect(porId.get(ETF)).toBe(PROVEEDOR_DEL_ETF);
    expect(porId.get(ETF)?.issuer_portfolio).toBeUndefined();
    expect(calculateOverlap(porId.get(ETF), porId.get(FONDO)).overlapPercent).toBeNull();
  });

  test("una cartera que no ha llegado entera no se usa", () => {
    const resumen: ResumenDelEmisor = { ...RESUMEN, positions_count: 3, chunk_count: 2 };
    const trozo = (id: string, as_of: string, n: number) => ({ chunk_id: id, as_of, positions: Array.from({ length: n }, (_, i) => ({ name: `L${id}${i}`, weight: 0.1 })) });
    expect(lineasDeLosTrozos(resumen, [trozo("001", "2026-11-06", 1), trozo("000", "2026-11-06", 2)])?.map((l) => l.name)).toEqual(["L0000", "L0001", "L0010"]);
    expect(lineasDeLosTrozos(resumen, [trozo("000", "2026-11-06", 2)])).toBeNull();
    expect(lineasDeLosTrozos(resumen, [trozo("000", "2026-11-06", 2), trozo("001", "2026-11-05", 1)])).toBeNull();
    expect(lineasDeLosTrozos(resumen, [trozo("000", "2026-11-06", 2), trozo("001", "2026-11-06", 2)])).toBeNull();
  });

  test("un resumen que no dice ADVISOR_ONLY no se lee", () => {
    const documento = { source: "issuer:ishares", as_of: "2026-11-06", audience: "ADVISOR_ONLY", usable_for_measurement: true, positions_count: 4, chunk_count: 1 };
    expect(leerResumenDelEmisor(documento)?.source).toBe("ishares");
    expect(leerResumenDelEmisor({ ...documento, audience: "CLIENT" })).toBeNull();
    expect(leerResumenDelEmisor({ ...documento, audience: undefined })).toBeNull();
  });

  test("si la lectura del emisor falla, la matriz sigue con la del proveedor", async () => {
    const leer = vi.fn(async () => { throw new Error("permission-denied"); });
    const cargas = cargasDeLaCartera(fuenteDelProveedor(), { activos: ACTIVOS, leer, catalogo: async () => [] });
    expect((await cargas.getAssetHoldingsMany!([ETF, FONDO])).get(ETF)).toBe(PROVEEDOR_DEL_ETF);
  });
});

describe("el cruce por ticker", () => {
  const indice = indiceDeTickers(paresDeLasCarteras([PROVEEDOR_DEL_FONDO]));

  test("pasa a ISIN con el mismo ticker, la misma divisa y una palabra del nombre en común", () => {
    expect(isinPorTicker({ name: "APPLE INC", ticker: "AAPL", currency: "USD" }, indice)).toBe("US0378331005");
    /* «ASML NA» es el ticker con su bolsa: cuenta la primera palabra. */
    expect(isinPorTicker({ name: "NESTLE SA", ticker: "NESN SW", currency: "CHF" }, indice)).toBe("CH0038863350");
  });

  test("sin falsos positivos: otra divisa, otro nombre, dos candidatos o nada con qué comprobar", () => {
    /* «1211» es BYD en Hong Kong y una minera saudí en el proveedor. */
    const conColision = indiceDeTickers([
      { ticker: "1211", isin: "SA123GA0ITH7", name: "Saudi Arabian Mining Co", currency: "SAR" },
      { ticker: "NDA", isin: "DE0006766504", name: "Aurubis AG", currency: "EUR" },
      { ticker: "SAN", isin: "ES0113900J37", name: "Banco Santander SA", currency: "EUR" },
      { ticker: "SAN", isin: "FR0000120578", name: "Sanofi SA", currency: "EUR" },
      { ticker: "SANX", isin: "ES0000000001", name: "Santander Uno", currency: "EUR" },
      { ticker: "SANX", isin: "ES0000000002", name: "Santander Dos", currency: "EUR" }
    ]);
    expect(isinPorTicker({ name: "BYD H", ticker: "1211", currency: "HKD" }, conColision)).toBeUndefined();
    expect(isinPorTicker({ name: "NORDEA BANK ABP", ticker: "NDA", currency: "EUR" }, conColision)).toBeUndefined();
    expect(isinPorTicker({ name: "SANOFI", ticker: "SAN", currency: "EUR" }, conColision)).toBe("FR0000120578");
    expect(isinPorTicker({ name: "SANTANDER", ticker: "SANX", currency: "EUR" }, conColision)).toBeUndefined();
    expect(isinPorTicker({ name: "APPLE INC", ticker: "AAPL" }, indice)).toBeUndefined();
  });

  test("sin divisa, como Vanguard, vale el país del ISIN", () => {
    expect(isinPorTicker({ name: "Apple Inc", ticker: "AAPL", issuer_country: "US" }, indice)).toBe("US0378331005");
    expect(isinPorTicker({ name: "Apple Inc", ticker: "AAPL", issuer_country: "IE" }, indice)).toBeUndefined();
  });

  test("las acciones del catálogo también dan parejas, y las líneas que no cruzan siguen por su nombre", () => {
    const tarjetas = [
      { instrument_id: "US5949181045", instrument_type: "STOCK", identity: { name: "Microsoft Corp", ticker: "MSFT", currency: "USD" } },
      { instrument_id: "IE00B4L5Y983", instrument_type: "ETF", identity: { name: "iShares Core MSCI World", ticker: "IWDA", currency: "USD" } }
    ];
    expect(paresDelCatalogo(tarjetas).map((par) => par.isin)).toEqual(["US5949181045"]);
    const app = aCarteraDeLaApp(cartera(SP500), indiceDeTickers([...paresDeLasCarteras([PROVEEDOR_DEL_FONDO]), ...paresDelCatalogo(tarjetas)]));
    expect(app.holdings.map((h) => h.isin)).toEqual(["US67066G1040", "US0378331005", "US5949181045", undefined]);
    const cruce = cruceDeTickers(cartera(SP500), indice);
    expect([cruce.soloTicker, cruce.cruzan]).toEqual([3, 2]);
    expect(cruce.pesoQueCruzaPct).toBeCloseTo(70, 9);
  });

  test("las cargas leen el catálogo solo si alguna línea del emisor llega sin ISIN", async () => {
    const catalogo = vi.fn(async () => []);
    const conIsin = cartera([{ name: "ASML HOLDING NV", isin: "NL0010273215", ticker: "ASML NA", weight: 1 }]);
    await cargasDeLaCartera(fuenteDelProveedor(), { activos: ACTIVOS, leer: async () => conIsin, catalogo }).getAssetHoldingsMany!([ETF, FONDO]);
    expect(catalogo).not.toHaveBeenCalled();
    await cargasDeLaCartera(fuenteDelProveedor(), { activos: ACTIVOS, leer: async () => cartera(SP500), catalogo }).getAssetHoldingsMany!([ETF, FONDO]);
    expect(catalogo).toHaveBeenCalledTimes(1);
  });
});

/* Hasta el 14-11-2026 este bloque era «en Modo cliente no se pide»: con el modo puesto, las cargas eran las del proveedor tal cual y
   el ETF quedaba fuera de la matriz. Óscar decidió que el ETF no se queda fuera del solapamiento en ningún sitio, así que las cargas ya
   no preguntan por el modo: no tienen esa opción. Lo que el Modo cliente oculta es de quién es la cartera, y eso lo prueba
   `procedenciaDeLaCartera`. */
describe("las cargas no dependen del Modo cliente, y lo que ve un cliente no nombra al emisor", () => {
  test("las cargas no tienen opción de Modo cliente: con un ETF, siempre pueden traer la del emisor", async () => {
    const leer = vi.fn(async () => cartera(SP500));
    const cargas = cargasDeLaCartera(fuenteDelProveedor(), { activos: ACTIVOS, leer, catalogo: async () => [] });
    expect(cargas.puedeTraerLaDelEmisor).toBe(true);
    const porId = await cargas.getAssetHoldingsMany!([ETF, FONDO]);
    expect(porId.get(ETF)?.issuer_portfolio?.source).toBe("ishares");
    expect(leer).toHaveBeenCalledTimes(1);
  });

  test("la procedencia: «cartera del emisor» para el asesor y «cartera completa» para el cliente, las dos con su fecha", () => {
    const origen = { as_of: "2026-11-06" };
    expect(procedenciaDeLaCartera(origen, true)).toBe("cartera del emisor, a 06/11/2026");
    expect(procedenciaDeLaCartera(origen, true)).toBe(procedenciaDeLaCarteraDelEmisor(origen));
    expect(procedenciaDeLaCartera(origen, false)).toBe("cartera completa, a 06/11/2026");
    expect(procedenciaDeLaCartera(origen, false)).not.toMatch(/emisor/i);
  });

  test("sin ningún ETF tampoco se pide nada", async () => {
    const leer = vi.fn(async () => cartera(SP500));
    const cargas = cargasDeLaCartera(fuenteDelProveedor(), { activos: [ACTIVOS[1]], leer });
    await cargas.getAssetHoldingsMany!([FONDO]);
    expect(cargas.puedeTraerLaDelEmisor).toBe(false);
    expect(leer).not.toHaveBeenCalled();
  });
});
