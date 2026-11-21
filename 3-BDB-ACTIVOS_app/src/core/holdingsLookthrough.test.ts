import { describe, expect, it } from "vitest";
import { mockAssets } from "../data/mockAssets";
import { mockHoldingsByAssetId } from "../data/mockHoldings";
import { buildPortfolioLookThrough, origenDeLaLinea, resumenDeLoMirado } from "./holdingsLookthrough";
import type { BdbAssetDetail, BdbAssetHoldings } from "../types/bdbAssets";

const DEMO_POSITIONS = [
  { asset_id: "MOCK-ETF-WATER", weight_percent: 25 },
  { asset_id: "MOCK-STOCK-TECH", weight_percent: 20 },
  { asset_id: "MOCK-FUND-GLOBAL-BOND", weight_percent: 30 },
  { asset_id: "MOCK-FUND-MIXED", weight_percent: 20 },
  { asset_id: "MOCK-ETF-CASH", weight_percent: 5 }
];

describe("buildPortfolioLookThrough", () => {
  it("aggregates portfolio holdings and reports covered weight", async () => {
    const result = await buildPortfolioLookThrough({
      positions: DEMO_POSITIONS,
      assets: mockAssets,
      loadHoldings: async (assetId) => mockHoldingsByAssetId[assetId] ?? null
    });

    /* Con una acción al 20 %: antes se quedaba fuera, como si le faltara un dato (decisión 10). De los fondos, las líneas que traen:
       25 × 39,5 % + 30 × 48 % + 20 × 33 % + 5 × 95 % = 9,875 + 14,4 + 6,6 + 4,75 = 35,625; más 20 de la acción. */
    expect(result.seen_weight_percent).toBeCloseTo(55.625, 10);
    expect(result.covered_funds).toBe(4);
    expect(result.fund_positions).toBe(4);
    expect(result.direct_positions).toBe(1);

    const treasury = result.rows.find((row) => row.identifier === "US91282CGM73");

    expect(treasury?.weight_percent).toBeCloseTo(3.6, 6);
    expect(treasury?.fund_count).toBe(2);
  });

  it("carga los holdings en paralelo, no en cadena (DV6)", async () => {
    const assets = [
      { asset_id: "FUND-A", display_name: "Fund A", holdings_summary: { has_holdings: true } },
      { asset_id: "FUND-B", display_name: "Fund B", holdings_summary: { has_holdings: true } }
    ] as BdbAssetDetail[];
    const holdings: Record<string, BdbAssetHoldings> = {
      "FUND-A": {
        asset_id: "FUND-A",
        storage_mode: "SINGLE_DOCUMENT",
        holdings: [{ name: "Alpha", isin: "US0000000001", weight_pct: 50 }]
      },
      "FUND-B": {
        asset_id: "FUND-B",
        storage_mode: "SINGLE_DOCUMENT",
        holdings: [{ name: "Beta", isin: "US0000000002", weight_pct: 50 }]
      }
    };
    // Barrera: ninguna petición resuelve hasta que TODAS han arrancado. La
    // versión encadenada (una espera a la anterior) se quedaría colgada aquí.
    let started = 0;
    const gates: Array<() => void> = [];
    const loadHoldings = (assetId: string) =>
      new Promise<BdbAssetHoldings | null>((resolve) => {
        started += 1;
        gates.push(() => resolve(holdings[assetId] ?? null));
        if (started === 2) {
          gates.forEach((open) => open());
        }
      });

    const result = await buildPortfolioLookThrough({
      positions: [
        { asset_id: "FUND-A", weight_percent: 50 },
        { asset_id: "FUND-B", weight_percent: 50 }
      ],
      assets,
      loadHoldings
    });

    expect(result.covered_funds).toBe(2);
    expect(result.rows.map((row) => row.identifier)).toEqual(["US0000000001", "US0000000002"]);
  });

  it("un fondo que falla no rompe el resto y deja aviso (DV6)", async () => {
    const assets = [
      { asset_id: "FUND-A", display_name: "Fund A", holdings_summary: { has_holdings: true } },
      { asset_id: "FUND-B", display_name: "Fund B", holdings_summary: { has_holdings: true } }
    ] as BdbAssetDetail[];

    const result = await buildPortfolioLookThrough({
      positions: [
        { asset_id: "FUND-A", weight_percent: 60 },
        { asset_id: "FUND-B", weight_percent: 40 }
      ],
      assets,
      loadHoldings: async (assetId) => {
        if (assetId === "FUND-A") {
          throw new Error("backend caido");
        }
        return {
          asset_id: "FUND-B",
          storage_mode: "SINGLE_DOCUMENT",
          holdings: [{ name: "Beta", isin: "US0000000002", weight_pct: 100 }]
        };
      }
    });

    expect(result.covered_funds).toBe(1);
    expect(result.fund_positions).toBe(2);
    expect(result.seen_weight_percent).toBe(40);
    expect(result.warnings).toEqual(["Fund A: posiciones subyacentes no disponibles."]);
  });

  it("falls back to normalized holding name when ISIN is missing", async () => {
    const assets = [
      {
        asset_id: "FUND-A",
        display_name: "Fund A",
        holdings_summary: { has_holdings: true }
      },
      {
        asset_id: "FUND-B",
        display_name: "Fund B",
        holdings_summary: { has_holdings: true }
      }
    ] as BdbAssetDetail[];
    const holdings: Record<string, BdbAssetHoldings> = {
      "FUND-A": {
        asset_id: "FUND-A",
        storage_mode: "SINGLE_DOCUMENT",
        holdings: [{ name: "EUR Cash", ticker: "EUR", weight_pct: 10 }]
      },
      "FUND-B": {
        asset_id: "FUND-B",
        storage_mode: "SINGLE_DOCUMENT",
        holdings: [{ name: "eur cash", ticker: "EUR", weight_pct: 20 }]
      }
    };

    const result = await buildPortfolioLookThrough({
      positions: [
        { asset_id: "FUND-A", weight_percent: 50 },
        { asset_id: "FUND-B", weight_percent: 50 }
      ],
      assets,
      loadHoldings: async (assetId) => holdings[assetId] ?? null
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].weight_percent).toBe(15);
    expect(result.rows[0].fund_count).toBe(2);
  });
});

describe("buildPortfolioLookThrough con carga batch (ola 3b)", () => {
  const assets = [
    { asset_id: "FUND-A", display_name: "Fund A", holdings_summary: { has_holdings: true } },
    { asset_id: "FUND-B", display_name: "Fund B", holdings_summary: { has_holdings: true } }
  ] as BdbAssetDetail[];
  const holdingsById: Record<string, BdbAssetHoldings> = {
    "FUND-A": {
      asset_id: "FUND-A",
      storage_mode: "SINGLE_DOCUMENT",
      holdings: [{ name: "Alpha", isin: "US0000000001", weight_pct: 50 }]
    },
    "FUND-B": {
      asset_id: "FUND-B",
      storage_mode: "SINGLE_DOCUMENT",
      holdings: [{ name: "Beta", isin: "US0000000002", weight_pct: 50 }]
    }
  };
  const positions = [
    { asset_id: "FUND-A", weight_percent: 50 },
    { asset_id: "FUND-B", weight_percent: 50 }
  ];

  it("prefiere la carga batch: una llamada con todos los ids y cero unitarias", async () => {
    const batchCalls: string[][] = [];
    let singleCalls = 0;

    const result = await buildPortfolioLookThrough({
      positions,
      assets,
      loadHoldings: async (assetId) => {
        singleCalls += 1;
        return holdingsById[assetId] ?? null;
      },
      loadHoldingsMany: async (assetIds) => {
        batchCalls.push([...assetIds]);
        return new Map(assetIds.map((id) => [id, holdingsById[id] ?? null]));
      }
    });

    expect(batchCalls).toEqual([["FUND-A", "FUND-B"]]);
    expect(singleCalls).toBe(0);
    expect(result.covered_funds).toBe(2);
    expect(result.rows.map((row) => row.identifier)).toEqual(["US0000000001", "US0000000002"]);
  });

  it("si el batch falla, degrada al fan-out unitario con el mismo resultado", async () => {
    let singleCalls = 0;

    const result = await buildPortfolioLookThrough({
      positions,
      assets,
      loadHoldings: async (assetId) => {
        singleCalls += 1;
        return holdingsById[assetId] ?? null;
      },
      loadHoldingsMany: async () => {
        throw new Error("batch no disponible");
      }
    });

    expect(singleCalls).toBe(2);
    expect(result.covered_funds).toBe(2);
  });
});

describe("una acción en directo en la composición subyacente (decisión 10)", () => {
  const fondo = (asset_id: string, display_name = asset_id) =>
    ({ asset_id, display_name, instrument_type: "FUND", holdings_summary: { has_holdings: true } }) as BdbAssetDetail;
  const accion = (asset_id: string, display_name: string) =>
    ({ asset_id, isin: asset_id, display_name, instrument_type: "STOCK", holdings_summary: { has_holdings: false } }) as BdbAssetDetail;
  const lineas = (asset_id: string, filas: Array<{ name: string; isin?: string; weight_pct: number }>): BdbAssetHoldings =>
    ({ asset_id, storage_mode: "SINGLE_DOCUMENT", holdings: filas });
  const APPLE = "US0378331005";

  it("suma como línea propia a lo que llevan los fondos, y lo dice", async () => {
    /* A mano: 10 directos + 40 × 5 % + 50 × 2 % = 10 + 2 + 1 = 13. */
    const result = await buildPortfolioLookThrough({
      positions: [
        { asset_id: APPLE, weight_percent: 10 },
        { asset_id: "FUND-A", weight_percent: 40 },
        { asset_id: "FUND-B", weight_percent: 50 }
      ],
      assets: [accion(APPLE, "Apple Inc."), fondo("FUND-A"), fondo("FUND-B")],
      loadHoldings: async (id) => ({
        "FUND-A": lineas("FUND-A", [{ name: "Apple", isin: APPLE, weight_pct: 5 }, { name: "Beta", isin: "B", weight_pct: 95 }]),
        "FUND-B": lineas("FUND-B", [{ name: "APPLE INC", isin: APPLE, weight_pct: 2 }, { name: "Gamma", isin: "G", weight_pct: 98 }])
      })[id] ?? null
    });
    const fila = result.rows.find((row) => row.identifier === APPLE)!;
    expect(fila.weight_percent).toBeCloseTo(13, 10);
    expect(fila.direct_weight_percent).toBe(10);
    expect(fila.fund_count).toBe(2);
    expect(fila.name).toBe("Apple Inc.");
    expect(origenDeLaLinea(fila)).toBe("Directa + 2 fondos");
    /* Cuenta como cubierta, y no es un fondo. */
    expect(result.covered_funds).toBe(2);
    expect(result.fund_positions).toBe(2);
    expect(result.direct_positions).toBe(1);
    expect(result.seen_weight_percent).toBe(100);
    expect(result.warnings).toEqual([]);
  });

  it("sin fondos que la lleven es «Directa», y no pide cartera para ella", async () => {
    const pedidos: string[] = [];
    const result = await buildPortfolioLookThrough({
      positions: [{ asset_id: "ES0144580Y14", weight_percent: 100 }],
      assets: [accion("ES0144580Y14", "Iberdrola S.A.")],
      loadHoldings: async (id) => { pedidos.push(id); return null; }
    });
    expect(pedidos).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ identifier: "ES0144580Y14", weight_percent: 100, fund_count: 0, direct_weight_percent: 100 });
    expect(origenDeLaLinea(result.rows[0])).toBe("Directa");
    expect(result.seen_weight_percent).toBe(100);
    expect(resumenDeLoMirado(result)).toBe("1 acción en directo. Se ha mirado el 100,0\u00a0% del peso de la cartera.");
  });

  it("se casa solo por ISIN: un bono del mismo emisor o una línea con el mismo nombre no se le suman", async () => {
    const ACCION = "DE0005140008";
    /* A mano, con el fondo al 90 %: acción 10 + 90 × 1 % (su ISIN, otro nombre) = 10,9. El bono, 90 × 3 % = 2,7, y la línea sin ISIN, 90 × 2 % = 1,8, aparte. */
    const result = await buildPortfolioLookThrough({
      positions: [{ asset_id: ACCION, weight_percent: 10 }, { asset_id: "FUND-A", weight_percent: 90 }],
      assets: [accion(ACCION, "Deutsche Bank AG"), fondo("FUND-A")],
      loadHoldings: async () => lineas("FUND-A", [
        { name: "DEUTSCHE BANK AG", weight_pct: 2 },
        { name: "Deutsche Bank Aktiengesellschaft", isin: ACCION, weight_pct: 1 },
        { name: "Deutsche Bank AG", isin: "DE000A460QS4", weight_pct: 3 },
        { name: "Resto", isin: "R", weight_pct: 94 }
      ])
    });
    const fila = result.rows.find((row) => row.identifier === ACCION)!;
    expect(fila.weight_percent).toBeCloseTo(10.9, 10);
    expect(fila.name).toBe("Deutsche Bank AG");
    expect(origenDeLaLinea(fila)).toBe("Directa + 1 fondo");
    expect(result.rows.find((row) => row.identifier === "DE000A460QS4")?.weight_percent).toBeCloseTo(2.7, 10);
    expect(result.rows.find((row) => row.name === "DEUTSCHE BANK AG")?.weight_percent).toBeCloseTo(1.8, 10);
  });

  it("el efectivo de un fondo no se suma a una acción que se llame «CASH» (Prosegur Cash en la base vieja)", async () => {
    const result = await buildPortfolioLookThrough({
      positions: [{ asset_id: "ES0105229001", weight_percent: 10 }, { asset_id: "FUND-A", weight_percent: 90 }],
      assets: [accion("ES0105229001", "CASH"), fondo("FUND-A")],
      loadHoldings: async () => lineas("FUND-A", [{ name: "Cash", weight_pct: 5 }, { name: "Resto", isin: "R", weight_pct: 95 }])
    });
    expect(result.rows.find((row) => row.identifier === "ES0105229001")?.weight_percent).toBe(10);
    expect(result.rows.find((row) => row.name === "Cash")?.weight_percent).toBeCloseTo(4.5, 10);
  });

  it("un fondo sin cartera sigue bajando la cobertura: ahí sí falta el dato", async () => {
    const result = await buildPortfolioLookThrough({
      positions: [{ asset_id: "ES0144580Y14", weight_percent: 10 }, { asset_id: "FUND-C", weight_percent: 90 }],
      assets: [accion("ES0144580Y14", "Iberdrola S.A."), { ...fondo("FUND-C"), holdings_summary: { has_holdings: false } } as BdbAssetDetail],
      loadHoldings: async () => null
    });
    expect(result.seen_weight_percent).toBe(10);
    /* Y la frase lo dice: hay un fondo, y no publica. */
    expect(resumenDeLoMirado(result)).toBe("0 de 1 fondo publica cartera y 1 acción en directo. Se ha mirado el 10,0\u00a0% del peso de la cartera.");
  });

  it("peso 0, y un tipo desconocido, no se tratan como una acción", async () => {
    const result = await buildPortfolioLookThrough({
      positions: [{ asset_id: "ES0144580Y14", weight_percent: 0 }, { asset_id: "RARO", weight_percent: 100 }],
      assets: [accion("ES0144580Y14", "Iberdrola S.A."), { asset_id: "RARO", display_name: "Raro" } as BdbAssetDetail],
      loadHoldings: async () => null
    });
    expect(result.rows).toEqual([]);
    expect(result.direct_positions).toBe(0);
    expect(result.fund_positions).toBe(1);
    expect(result.seen_weight_percent).toBe(0);
  });

  it("una suma de pesos distinta de 100 no se normaliza: la tabla sigue sobre los pesos tal como están", async () => {
    const result = await buildPortfolioLookThrough({
      positions: [{ asset_id: "ES0144580Y14", weight_percent: 5 }, { asset_id: "FUND-A", weight_percent: 5 }],
      assets: [accion("ES0144580Y14", "Iberdrola S.A."), fondo("FUND-A")],
      loadHoldings: async () => lineas("FUND-A", [{ name: "Beta", isin: "B", weight_pct: 100 }])
    });
    expect(result.seen_weight_percent).toBe(10);
    expect(result.rows.map((row) => row.weight_percent)).toEqual([5, 5]);
  });
});

describe("qué se ha mirado de verdad (decisión 6: «100 % del peso» no decía lo cierto)", () => {
  const fondo = (asset_id: string) =>
    ({ asset_id, display_name: asset_id, instrument_type: "FUND", holdings_summary: { has_holdings: true } }) as BdbAssetDetail;
  const unaLinea = (asset_id: string, weight_pct: number): BdbAssetHoldings =>
    ({ asset_id, storage_mode: "SINGLE_DOCUMENT", holdings: [{ name: asset_id, isin: asset_id, weight_pct }] });

  it("con la cartera de muestra: 2 de los 8 fondos no llegan a la mitad, y se ha mirado el 74,9 %", async () => {
    /* A mano: 24 × 26,64 % + 12 × 37,79 % + 64 = 6,3936 + 4,5348 + 64 = 74,9284. */
    const pesos: Array<[string, number, number]> = [
      ["IE00B4L5Y983", 24, 26.64], ["IE00B3XXRP09", 12, 37.79], ["LU1883318740", 10, 100], ["LU0329355670", 8, 100],
      ["IE00B11XZ103", 20, 100], ["LU0430492750", 10, 100], ["FR0013367265", 9, 100], ["LU1103307408", 7, 100]
    ];
    const result = await buildPortfolioLookThrough({
      positions: pesos.map(([asset_id, weight_percent]) => ({ asset_id, weight_percent })),
      assets: pesos.map(([id]) => fondo(id)),
      loadHoldings: async (id) => unaLinea(id, pesos.find(([x]) => x === id)![2])
    });
    expect(result.seen_weight_percent).toBeCloseTo(74.9284, 6);
    expect(result.fund_portfolios.filter((f) => !f.sufficient).map((f) => f.asset_id)).toEqual(["IE00B4L5Y983", "IE00B3XXRP09"]);
    expect(resumenDeLoMirado(result)).toBe("8 de 8 fondos publican cartera, 2 de ellos menos de la mitad. Se ha mirado el 74,9\u00a0% del peso de la cartera.");
  });

  it("una suma por encima de 100 no da más de lo que pesa el fondo, y una negativa no resta", async () => {
    const result = await buildPortfolioLookThrough({
      positions: [{ asset_id: "NOMINAL", weight_percent: 60 }, { asset_id: "CORTOS", weight_percent: 40 }],
      assets: [fondo("NOMINAL"), fondo("CORTOS")],
      loadHoldings: async (id) => (id === "NOMINAL"
        ? unaLinea(id, 108.27)
        : { asset_id: id, storage_mode: "SINGLE_DOCUMENT", holdings: [{ name: "Compra", isin: "C", weight_pct: 9.94 }, { name: "Venta", isin: "V", weight_pct: -12.23 }] })
    });
    expect(result.seen_weight_percent).toBe(60);
    expect(result.fund_portfolios.map((f) => [f.lines, f.published_weight_percent, f.sufficient])).toEqual([[1, 108.27, true], [2, -2.29, false]]);
    expect(resumenDeLoMirado(result)).toBe("2 de 2 fondos publican cartera, uno de ellos menos de la mitad. Se ha mirado el 60,0\u00a0% del peso de la cartera.");
  });
});

describe("de dónde sale una línea", () => {
  it("sale del dato", () => {
    expect(origenDeLaLinea({ fund_count: 1 })).toBe("1 fondo");
    expect(origenDeLaLinea({ fund_count: 3 })).toBe("3 fondos");
    expect(origenDeLaLinea({ fund_count: 0, direct_weight_percent: 5 })).toBe("Directa");
    expect(origenDeLaLinea({ fund_count: 1, direct_weight_percent: 5 })).toBe("Directa + 1 fondo");
    expect(origenDeLaLinea({ fund_count: 2, direct_weight_percent: 5 })).toBe("Directa + 2 fondos");
  });
});

describe("un fondo que lleva dentro otro fondo (decisión A-165, hallazgo IMP-5)", () => {
  const fondo = (asset_id: string, display_name = asset_id) =>
    ({ asset_id, display_name, instrument_type: "FUND", holdings_summary: { has_holdings: true } }) as BdbAssetDetail;
  const cartera = (asset_id: string, filas: Array<{ name: string; isin?: string; weight_pct: number; holding_type_code?: string }>): BdbAssetHoldings =>
    ({ asset_id, storage_mode: "SINGLE_DOCUMENT", holdings: filas });
  /* F tiene un 40 % en un ETF y un 60 % en dos acciones. G no lleva fondos. */
  const carteras: Record<string, BdbAssetHoldings> = {
    F: cartera("F", [
      { name: "ETF Mundo", isin: "IE00ETF00001", weight_pct: 40, holding_type_code: "FE" },
      { name: "Acción Uno", isin: "US0000000001", weight_pct: 35, holding_type_code: "E" },
      { name: "Acción Dos", isin: "US0000000002", weight_pct: 25, holding_type_code: "E" }
    ]),
    G: cartera("G", [
      { name: "Acción Uno", isin: "US0000000001", weight_pct: 50, holding_type_code: "E" },
      { name: "Bono", isin: "DE0000000001", weight_pct: 50, holding_type_code: "BT" }
    ])
  };
  const mirar = (positions: Array<{ asset_id: string; weight_percent: number }>) =>
    buildPortfolioLookThrough({ positions, assets: [fondo("F"), fondo("G")], loadHoldings: async (id) => carteras[id] ?? null });

  it("la línea se marca, y su peso no cuenta como mirado", async () => {
    /* F al 50 % y G al 50 %. De F se mira el 60 % que no es el ETF: 50 × 60 % = 30. De G, todo: 50. Mirado, 80; el ETF
       dentro de F es 50 × 40 % = 20 de la cartera, recibido pero sin abrir. Antes se decía «100 %». */
    const result = await mirar([{ asset_id: "F", weight_percent: 50 }, { asset_id: "G", weight_percent: 50 }]);
    expect(result.seen_weight_percent).toBeCloseTo(80, 10);
    expect(result.unopened_funds_weight_percent).toBeCloseTo(20, 10);
    const etf = result.rows.find((row) => row.identifier === "IE00ETF00001")!;
    expect(etf).toMatchObject({ weight_percent: 20, fund_count: 1, fund_not_opened: true });
    expect(origenDeLaLinea(etf)).toBe("1 fondo · fondo sin mirar por dentro");
    /* Una acción que llevan los dos sigue siendo una línea corriente: 50 × 35 % + 50 × 50 % = 42,5. */
    const uno = result.rows.find((row) => row.identifier === "US0000000001")!;
    expect(uno.weight_percent).toBeCloseTo(42.5, 10);
    expect(uno.fund_not_opened).toBeUndefined();
    expect(origenDeLaLinea(uno)).toBe("2 fondos");
    expect(result.fund_portfolios.find((p) => p.asset_id === "F")).toMatchObject({ published_weight_percent: 100, sufficient: true, funds_inside_weight_percent: 40 });
    expect(result.fund_portfolios.find((p) => p.asset_id === "G")!.funds_inside_weight_percent).toBeUndefined();
    expect(resumenDeLoMirado(result)).toBe(
      "2 de 2 fondos publican cartera. Se ha mirado el 80,0 % del peso de la cartera. Otro 20,0 % son fondos que llevan dentro los fondos de la cartera: no se miran por dentro."
    );
  });

  it("sin fondos dentro no cambia nada, y los monetarios siguen contando", async () => {
    const result = await mirar([{ asset_id: "G", weight_percent: 100 }]);
    expect(result.seen_weight_percent).toBe(100);
    expect(result.unopened_funds_weight_percent).toBeUndefined();
    expect(resumenDeLoMirado(result)).toBe("1 de 1 fondo publica cartera. Se ha mirado el 100,0 % del peso de la cartera.");
    /* Un monetario (`FM`) es liquidez: no es un fondo que haya que abrir. */
    const conMonetario = await buildPortfolioLookThrough({
      positions: [{ asset_id: "H", weight_percent: 100 }],
      assets: [fondo("H")],
      loadHoldings: async () => cartera("H", [{ name: "Monetario", isin: "LU0000000009", weight_pct: 30, holding_type_code: "FM" }, { name: "Acción Uno", isin: "US0000000001", weight_pct: 70, holding_type_code: "E" }])
    });
    expect(conMonetario.seen_weight_percent).toBe(100);
    expect(conMonetario.rows.every((row) => !row.fund_not_opened)).toBe(true);
  });

  it("lo que un fondo tiene en otros fondos no puede descontar más de lo que se ha recibido de él", async () => {
    /* Solo llegan dos líneas, las dos fondos, que suman el 30 % de su cartera: de ese fondo no se ha mirado nada. */
    const result = await buildPortfolioLookThrough({
      positions: [{ asset_id: "K", weight_percent: 100 }],
      assets: [fondo("K")],
      loadHoldings: async () => cartera("K", [{ name: "Fondo A", isin: "LU0000000011", weight_pct: 20, holding_type_code: "FO" }, { name: "Fondo B", isin: "LU0000000012", weight_pct: 10, holding_type_code: "FC" }])
    });
    expect(result.seen_weight_percent).toBe(0);
    expect(result.unopened_funds_weight_percent).toBeCloseTo(30, 10);
  });
});
