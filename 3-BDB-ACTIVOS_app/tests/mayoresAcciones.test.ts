import { describe, expect, test } from "vitest";
import { mapAssetHoldingsPayload } from "../src/adapters/assetHoldingsAdapter";
import { buildPortfolioLookThrough, resumenDeLasAcciones } from "../src/core/holdingsLookthrough";
import { claseDeLinea, codigoFinoDeLaBaseVieja, diezMayoresQueCuadran, esDerivadoPorSuCodigo, rotuloDeLinea } from "../src/core/lineaDeCartera";
import type { BdbAssetDetail, BdbAssetHoldings, BdbHoldingPosition } from "../src/types/bdbAssets";

/**
 * «Mayores acciones de la cartera» (decisión 9 de Óscar). Las cuentas de abajo están hechas a mano, y lo que protegen es que la
 * lista salga del código de cada línea y nunca del nombre: «Cash» es también una acción, Prosegur Cash, y «Morgan Stanley» es una
 * opción en la cartera de un fondo.
 */

const NVIDIA = "US67066G1040";
const APPLE = "US0378331005";

function activo(id: string, partes: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return {
    asset_id: id,
    isin: id,
    display_name: `Producto ${id}`,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    pms_exposure: { equity: 1 },
    holdings_summary: { has_holdings: true },
    ...partes
  } as unknown as BdbAssetDetail;
}

const linea = (name: string, weight_pct: number, partes: Partial<BdbHoldingPosition> = {}): BdbHoldingPosition => ({ name, weight_pct, ...partes });

async function mirar(cartera: Array<[BdbAssetDetail, number, BdbHoldingPosition[]]>) {
  const holdings = new Map<string, BdbAssetHoldings>(
    cartera.map(([asset, , lineas]) => [asset.asset_id, { asset_id: asset.asset_id, storage_mode: "SINGLE_DOCUMENT", holdings: lineas }])
  );
  return buildPortfolioLookThrough({
    positions: cartera.map(([asset, peso]) => ({ asset_id: asset.asset_id, weight_percent: peso })),
    assets: cartera.map(([asset]) => asset),
    loadHoldings: async (id) => holdings.get(id) ?? null
  });
}

describe("qué es una línea", () => {
  test("el código fino manda, y solo cuatro son acciones", () => {
    for (const codigo of ["E", "ER", "EU", "EQ"]) expect(claseDeLinea({ holding_type_code: codigo })).toBe("accion");
    for (const codigo of ["CU", "SI", "SJ", "SR", "OS", "TF", "CS", "SF", "DH", "DI", "EW", "P", "FO", "FE", "C", "B"]) {
      expect(claseDeLinea({ holding_type_code: codigo })).toBe("otra");
    }
    /* Una opción sobre divisa viene en la página de bolsa, con su ISIN si lo hay: lo que manda es el código. */
    expect(claseDeLinea({ holding_type_code: "DI", holding_type: "Equity", isin: "XS0000000001" })).toBe("otra");
  });

  test("la clase gruesa de la base vieja vale solo con ISIN: sin él, son los CFD y las opciones de esa página", () => {
    expect(claseDeLinea({ holding_type: "equity", isin: NVIDIA })).toBe("accion");
    expect(claseDeLinea({ holding_type: "Equity", isin: NVIDIA })).toBe("accion");
    expect(claseDeLinea({ holding_type: "equity" })).toBe("otra");
    expect(claseDeLinea({ holding_type: "bond", isin: "DE000BU22122" })).toBe("otra");
    expect(claseDeLinea({ holding_type: "other" })).toBe("otra");
  });

  test("la de la base nueva no cierra la pregunta: EQUITY es la que descartó Óscar, y las otras tres sí dicen que no es una acción", () => {
    expect(claseDeLinea({ holding_type: "EQUITY", isin: NVIDIA })).toBe("sin-clase");
    for (const clase of ["FIXED_INCOME", "CASH", "OTHER"]) expect(claseDeLinea({ holding_type: clase })).toBe("otra");
  });

  test("sin clase no se deduce nada, ni del nombre", () => {
    expect(claseDeLinea({})).toBe("sin-clase");
    expect(claseDeLinea({ holding_type: "unknown", isin: NVIDIA })).toBe("sin-clase");
  });

  test("el código de la base vieja viaja en `instrument_type`, y sus clases son palabras", () => {
    expect(codigoFinoDeLaBaseVieja("CU")).toBe("CU");
    expect(codigoFinoDeLaBaseVieja("12")).toBe("12");
    for (const clase of ["equity", "EQUITY", "FIXED_INCOME", "unknown", undefined]) expect(codigoFinoDeLaBaseVieja(clase)).toBeUndefined();
  });

  test("llega así por el adaptador, de cada base y de la nube de hoy", () => {
    const cartera = mapAssetHoldingsPayload("X", {
      holdings: [
        { holding_name: "Vieja con código", holding_weight: 5, holding_type: "Other", instrument_type: "CU" },
        { holding_name: "Vieja con clase", holding_weight: 4, instrument_type: "equity", isin: NVIDIA },
        { holding_name: "Nueva", holding_weight: 3, instrument_type: "EQUITY", holding_type_code: "E", isin: APPLE },
        { holding_name: "Nube sin subir", holding_weight: 2, instrument_type: "EQUITY", isin: APPLE }
      ]
    });
    expect(cartera?.holdings.map(claseDeLinea)).toEqual(["otra", "accion", "accion", "sin-clase"]);
  });

  test("qué es un derivado lo dice el código", () => {
    for (const codigo of ["CU", "SI", "OS", "SR", "TF", "SJ", "CS", "SF"]) expect(esDerivadoPorSuCodigo(codigo)).toBe(true);
    for (const codigo of ["E", "B", "C", "FO", undefined, null, 3]) expect(esDerivadoPorSuCodigo(codigo)).toBe(false);
  });
});

describe("las mayores acciones", () => {
  test("suma lo de los fondos y lo directo, y no cuenta nada más", async () => {
    /* ETF 40 % con NVIDIA 5 % → 2,00. Fondo 40 % con NVIDIA 2,5 % → 1,00. Directa 20 %. NVIDIA: 3,00; Apple, solo en el fondo: 40 × 4 % = 1,60. */
    const resultado = await mirar([
      [activo("ETF", { instrument_type: "ETF" } as never), 40, [linea("NVIDIA Corp.", 5, { isin: NVIDIA, holding_type: "unknown" })]],
      [
        activo("FONDO"),
        40,
        [
          linea("NVIDIA Corp", 2.5, { isin: NVIDIA, holding_type_code: "E" }),
          linea("Apple Inc", 4, { isin: APPLE, holding_type_code: "E" }),
          linea("EUROPEAN MONETARY UNION EURO Purchased", 30, { holding_type_code: "CU" }),
          linea("3 Month Euribor Future", 15, { isin: "GB00J8WDXS35", holding_type_code: "SJ" }),
          linea("CFD on Trainline PLC", 1, { holding_type_code: "SF" }),
          linea("Germany 2.1%", 8, { isin: "DE000BU22122", holding_type_code: "BT" })
        ]
      ],
      [activo("ES0144580Y14", { instrument_type: "STOCK", display_name: "Iberdrola" } as never), 20, []]
    ]);
    const filas = resultado.equities.rows;
    expect(filas.map((f) => f.name)).toEqual(["Iberdrola", "NVIDIA Corp.", "Apple Inc"]);
    expect(filas[0].weight_percent).toBe(20);
    expect(filas[0].direct_weight_percent).toBe(20);
    expect(filas[1].weight_percent).toBeCloseTo(3, 10);
    expect(filas[1].fund_count).toBe(2);
    expect(filas[2].weight_percent).toBeCloseTo(1.6, 10);
    expect(resultado.equities.identified_weight_percent).toBeCloseTo(24.6, 10);
    /* Las tres posiciones son renta variable al 100 %, y eso es lo que se compara. */
    expect(resultado.equities.equity_exposure_percent).toBeCloseTo(100, 10);
    expect(resultado.equities.unclassified_funds).toEqual([]);
    /* La tabla de siempre sigue siendo la misma: el forward sigue en ella, y es lo que lee el papel. */
    expect(resultado.rows.map((f) => f.name)).toContain("EUROPEAN MONETARY UNION EURO Purchased");
  });

  test("una acción y un nombre iguales no se confunden: lo que no es acción no entra aunque se llame como ella", async () => {
    const resultado = await mirar([
      [activo("FONDO"), 100, [linea("Cash", 10, { holding_type_code: "C" }), linea("Morgan Stanley", 5, { holding_type_code: "DH" })]]
    ]);
    expect(resultado.equities.rows).toEqual([]);
    expect(resultado.equities.identified_weight_percent).toBe(0);
  });

  test("una venta en corto resta de la misma acción; si queda en negativo, no es una de las mayores", async () => {
    /* 50 % × (10 − 4) = 3,00 de NVIDIA; Apple 50 % × −2 = −1,00; la suma identificada, 2,00. */
    const resultado = await mirar([
      [
        activo("LARGO_CORTO"),
        50,
        [
          linea("NVIDIA Corp", 10, { isin: NVIDIA, holding_type_code: "E" }),
          linea("NVIDIA Corp", -4, { isin: NVIDIA, holding_type_code: "E" }),
          linea("Apple Inc", -2, { isin: APPLE, holding_type_code: "E" })
        ]
      ]
    ]);
    expect(resultado.equities.rows.map((f) => [f.name, f.weight_percent])).toEqual([["NVIDIA Corp", 3]]);
    expect(resultado.equities.identified_weight_percent).toBeCloseTo(2, 10);
  });

  test("una fila sin clase cuenta como acción solo en un ETF de renta variable", async () => {
    const resultado = await mirar([
      [activo("ETF_RV", { instrument_type: "ETF" } as never), 50, [linea("NVIDIA", 8, { isin: NVIDIA })]],
      [
        activo("ETF_RF", { instrument_type: "ETF", economic_asset_class: "FIXED_INCOME", pms_exposure: { fixed_income: 1 } } as never),
        50,
        [linea("Un bono", 8, { isin: "DE000BU22122" })]
      ]
    ]);
    expect(resultado.equities.rows.map((f) => f.name)).toEqual(["NVIDIA"]);
    /* El de renta fija no tiene nada que pueda faltar: no impide la tabla. */
    expect(resultado.equities.unclassified_funds).toEqual([]);
    expect(resultado.equities.equity_exposure_percent).toBeCloseTo(50, 10);
  });

  test("un fondo con renta variable sin código impide la tabla: es la nube hasta que se suba el catálogo", async () => {
    const resultado = await mirar([
      [activo("ETF", { instrument_type: "ETF" } as never), 50, [linea("NVIDIA", 8, { isin: NVIDIA })]],
      [activo("AMUNDI", { display_name: "Amundi Global" }), 30, [linea("NVIDIA", 3, { isin: NVIDIA, holding_type: "EQUITY" }), linea("Un bono", 2, { holding_type: "FIXED_INCOME" })]],
      [activo("BONOS", { economic_asset_class: "FIXED_INCOME", pms_exposure: { fixed_income: 1 } } as never), 20, [linea("Un bono", 2, { holding_type: "FIXED_INCOME" })]]
    ]);
    expect(resultado.equities.unclassified_funds).toEqual(["Amundi Global"]);
  });

  test("lo que se ha visto se dice, sin escribir ninguna cifra a mano", async () => {
    const resultado = await mirar([
      [activo("ETF", { instrument_type: "ETF" } as never), 60, [linea("NVIDIA", 5, { isin: NVIDIA }), linea("Apple", 5, { isin: APPLE })]],
      [activo("BONOS", { economic_asset_class: "FIXED_INCOME", pms_exposure: { fixed_income: 1 } } as never), 40, [linea("Un bono", 100, { holding_type: "bond" })]]
    ]);
    expect(resumenDeLasAcciones(resultado)).toBe(
      "Las acciones identificadas suman el 6,0\u00a0% de la cartera, que tiene un 60,0\u00a0% en renta variable. De un fondo que solo publica sus mayores posiciones no se ve el resto: cada peso es un mínimo."
    );
  });

  test("una cartera sin acciones no se inventa ninguna, y un peso a cero no cuenta", async () => {
    const vacia = await mirar([[activo("BONOS", { economic_asset_class: "FIXED_INCOME", pms_exposure: { fixed_income: 1 } } as never), 100, [linea("Un bono", 100, { holding_type_code: "B" })]]]);
    expect(vacia.equities).toEqual({ rows: [], identified_weight_percent: 0, equity_exposure_percent: 0, unclassified_funds: [] });
    const conCero = await mirar([[activo("ETF", { instrument_type: "ETF" } as never), 0, [linea("NVIDIA", 5, { isin: NVIDIA })]]]);
    expect(conCero.equities.rows).toEqual([]);
  });
});

describe("«diez mayores» solo si cuadra con sus filas", () => {
  test("con medio punto de tolerancia, y el borde cuenta", () => {
    expect(diezMayoresQueCuadran(0.2778, [0.1, 0.1, 0.0778])).toBe(0.2778);
    expect(diezMayoresQueCuadran(0.3, [0.2, 0.105])).toBe(0.3);
    expect(diezMayoresQueCuadran(0.3, [0.2, 0.1051])).toBeUndefined();
  });

  test("PIMCO dice 23,71 % con una primera fila de 30,36 %: eso no se puede leer", () => {
    expect(diezMayoresQueCuadran(0.2371, [0.3036, 0.2373, 0.1509])).toBeUndefined();
  });

  test("sin el dato, o con una fila sin peso, no se afirma nada", () => {
    expect(diezMayoresQueCuadran(undefined, [0.1])).toBeUndefined();
    expect(diezMayoresQueCuadran(0.1, [])).toBeUndefined();
    expect(diezMayoresQueCuadran(0.1, [0.1, undefined])).toBeUndefined();
  });
});

describe("cómo se llama una línea en la Cartera de la ficha (decisión 93)", () => {
  test.each([
    ["EUR/SEK_260904 Purchased", "Contrato de divisa EUR/SEK"],
    ["EUR/SEK_260914_5 Purchased", "Contrato de divisa EUR/SEK"],
    ["CURRENCY CONTRACT - EUR Purchased", "Contrato de divisa EUR"],
    ["Buy EUR Sell USD on 15/10/2026 with SCFX-A Purchased", "Contrato de divisa EUR/USD"],
    ["Sell INR Buy USD on 15/10/2026 fixing on 12/10/2026 to USD@F1_2 Purc", "Contrato de divisa INR/USD"],
    ["Ct 261015 Eur/Usd D1", "Contrato de divisa EUR/USD"],
    ["Ovct 260724 Usd/Eur", "Contrato de divisa USD/EUR"],
    ["EUR/USD FWD 20261016 USD Purchased", "Contrato de divisa EUR/USD"],
    ["FORWARD US DOLLAR Purchased", "Contrato de divisa"],
    ["EUROPEAN MONETARY UNION EURO Purchased", "Contrato de divisa"],
    ["Oact02021100", "Contrato de divisa"]
  ])("pata de forward: %s", (nombre, rotulo) => {
    expect(rotuloDeLinea(nombre, "CU")).toBe(rotulo);
    expect(rotuloDeLinea(nombre, " cu ")).toBe(rotulo);
  });

  test("una permuta de divisas no dice divisa: del nombre solo se leería la mitad", () => {
    expect(rotuloDeLinea("CCS USD R USSOFR/JPYMUTKCALM-35.65 CBK Purchased", "CS")).toBe("Permuta de divisas");
  });

  test.each([
    ["Eur_Es0821008990951300063302", "C", "Efectivo EUR"],
    ["Currency Cash CASH_USD", "C", "Efectivo USD"],
    ["CASH_EUR STATE STREET BANK", "C", "Efectivo EUR"],
    ["610284_Cash_Agr", "CD", "Cuenta o depósito"]
  ])("el efectivo con nombre de sistema: %s", (nombre, codigo, rotulo) => {
    expect(rotuloDeLinea(nombre, codigo)).toBe(rotulo);
  });

  test.each([
    ["Cash and cash Equilavents", "C"],
    ["Cc. (Eur) En Banco Inversis, S.A.", "C"],
    ["CURRENCY CONTRACT - USD", "CD"],
    ["Ferrari N V", "E"],
    ["Cuenta_rara", "CH"],
    ["LCH PAY 204530903_204530902", "SR"],
    ["EUR/USD-BONY-16-APR-2026 (BK OTC) (EUR USD) Purchased", undefined],
    ["BOUGHT EUR/SOLD USD Purchased", null],
    ["BOUGHT EUR/SOLD USD Purchased", 7]
  ])("se queda con su nombre: %s (%s)", (nombre, codigo) => {
    expect(rotuloDeLinea(nombre, codigo)).toBeNull();
  });

  test("del nombre solo se leen códigos de divisa, no palabras de tres letras", () => {
    expect(rotuloDeLinea("BK OTC FWD VS BBH", "CU")).toBe("Contrato de divisa");
  });
});
