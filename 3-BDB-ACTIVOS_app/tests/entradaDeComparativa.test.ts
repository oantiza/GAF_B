/**
 * Lo que recibe el papel de la Comparativa de carteras (decisiones 41 y 42), por las dos puertas: esta función es la que comparten.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { clasificacionQueFalta, entradaDeLaComparativa, motivoSinCifraEnLaComparativa, notasDeLaComparativa, notaSinElSharpe, sharpeDeUnaSolaAccion } from "../src/core/entradaDeComparativa";
import { alignPortfolioComparison, comparisonCoverage, type ComparisonHistory } from "../src/core/portfolioComparison";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import { comparisonAssets, comparisonFixture } from "./support/portfolioComparisonFixtures";

const ACCION = { asset_id: "ES0144580Y14", instrument_type: "STOCK" } as const;
const OTRA_ACCION = { asset_id: "US0378331005", instrument_type: "STOCK" } as const;
const FONDO = { asset_id: "A", instrument_type: "FUND" } as const;
const posicion = (asset_id: string, weight_percent = 100): BdbManualPortfolioPosition => ({ asset_id, weight_percent });

function historia(ids: string[], excluidos: string[] = []): ComparisonHistory {
  const fixture = comparisonFixture("3Y", "A");
  fixture.backtest.asset_ids = ids;
  fixture.backtest.excluded_assets = excluidos.map((asset_id) => ({ asset_id, reason: "INSUFFICIENT_HISTORY" }));
  return fixture;
}

describe("sharpeDeUnaSolaAccion: la regla de la tira de Análisis, sobre lo que de verdad se mide", () => {
  const assets = [ACCION, OTRA_ACCION, FONDO];
  test("una sola acción no lleva Sharpe", () => {
    expect(sharpeDeUnaSolaAccion(historia([ACCION.asset_id]), [posicion(ACCION.asset_id)], assets)).toBe(true);
  });
  test("una acción dentro de una cartera con fondos ya no es el Sharpe de una acción", () => {
    expect(sharpeDeUnaSolaAccion(historia([ACCION.asset_id, FONDO.asset_id]), [posicion(ACCION.asset_id, 10), posicion(FONDO.asset_id, 90)], assets)).toBe(false);
  });
  test("si el fondo se queda fuera de la simulación, lo medido es la acción: no sale", () => {
    expect(sharpeDeUnaSolaAccion(historia([ACCION.asset_id], [FONDO.asset_id]), [posicion(ACCION.asset_id, 90), posicion(FONDO.asset_id, 10)], assets)).toBe(true);
  });
  test("varias acciones son una cartera: como en la pantalla, sale", () => {
    expect(sharpeDeUnaSolaAccion(historia([ACCION.asset_id, OTRA_ACCION.asset_id]), [posicion(ACCION.asset_id, 50), posicion(OTRA_ACCION.asset_id, 50)], assets)).toBe(false);
  });
  test("sin simulación todavía, mira las posiciones que pesan; una al 0 % no cuenta", () => {
    expect(sharpeDeUnaSolaAccion(null, [posicion(ACCION.asset_id, 100), posicion(FONDO.asset_id, 0)], assets)).toBe(true);
    expect(sharpeDeUnaSolaAccion(undefined, [posicion(ACCION.asset_id, 50), posicion(FONDO.asset_id, 50)], assets)).toBe(false);
  });
  test("un tipo desconocido no es una acción", () => {
    expect(sharpeDeUnaSolaAccion(historia(["X"]), [posicion("X")], [])).toBe(false);
  });
});

describe("motivoSinCifraEnLaComparativa: el corte y las palabras de la tira de Análisis, cartera por cartera (decisión 59)", () => {
  const fichas = [{ asset_id: "A", display_name: "Activo A" }, { asset_id: "V", display_name: "Vanguard" }];
  const conA = (pesoA: number) => motivoSinCifraEnLaComparativa(historia(["A"], ["V"]), [posicion("A", pesoA), posicion("V", 100 - pesoA)], fichas);

  test.each([[79.9], [79.99], [40]])("con el %d %%, falta, y dice cuánto mide, cuánto hace falta y qué se queda fuera", (peso) => {
    expect(conA(peso)).toContain("para dar una cifra de la cartera hace falta al menos el 80 % del peso");
    expect(conA(peso)).toContain("Se queda fuera: Vanguard");
  });

  test("las cifras del motivo son las del dato", () => {
    /* En el papel, cada peso con un decimal, como en sus cuadros (decisión 80). El 80 % es la regla, y se escribe así. */
    expect(conA(40)).toBe("La simulación mide el 40,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se queda fuera: Vanguard (60,0\u00a0%).");
    expect(conA(79.99)).toContain("mide el 79,99\u00a0% del peso");
  });

  test.each([[80], [90], [100]])("con el %d %% da cifras", (peso) => {
    expect(conA(peso)).toBeNull();
  });

  test("un 80 % que la suma da en coma flotante es un 80", () => {
    /* 80 repartido en diecisiete trozos suma 79,99999999999999: si sumara 80, esto no probaría nada. */
    const trozos = Array.from({ length: 17 }, (_, i) => `F${i}`);
    const posiciones = [...trozos.map((id) => posicion(id, 80 / 17)), posicion("V", 20)];
    const lado = historia(trozos, ["V"]);
    expect(comparisonCoverage(lado, posiciones).weight).toBeLessThan(80);
    expect(motivoSinCifraEnLaComparativa(lado, posiciones, [])).toBeNull();
  });

  test("con más de tres nombres los cuenta, y manda al anexo", () => {
    const ids = ["M", "N", "O", "P"];
    const motivo = motivoSinCifraEnLaComparativa(historia(["A"], ids), [posicion("A", 40), ...ids.map((id) => posicion(id, 15))], fichas);
    expect(motivo).toBe("La simulación mide el 40,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se quedan fuera 4 posiciones (60,0\u00a0% del peso), detalladas en el anexo.");
  });

  test("la entrada lleva el de cada una", () => {
    const entrada = entradaDeLaComparativa({
      a: { name: "Cartera A", positions: [posicion("A", 40), posicion("V", 60)] },
      b: { name: "Cartera B", positions: [posicion("B", 80), posicion("cash", 20)] },
      cargada: { period: "3Y", a: historia(["A"], ["V"]), b: comparisonFixture("3Y", "B"), result: alignPortfolioComparison(historia(["A"], ["V"]), comparisonFixture("3Y", "B"), "3Y") },
      assets: comparisonAssets
    });
    expect(entrada.sinCifra.a).toContain("mide el 40,0\u00a0% del peso");
    expect(entrada.sinCifra.b).toBeNull();
  });
});

describe("notaSinElSharpe: sin Sharpe en ninguna de las dos, las notas no lo explican", () => {
  test("cada frase que habla del Sharpe queda sin él, y lo demás se conserva", () => {
    expect(notaSinElSharpe("Se han ajustado las dos series a sus fechas comunes y recalculado las métricas. Falta el Sharpe: no hay una tasa sin riesgo para ese mismo intervalo."))
      .toBe("Se han ajustado las dos series a sus fechas comunes y recalculado las métricas.");
    expect(notaSinElSharpe("Falta el Sharpe: las dos carteras no tienen una tasa sin riesgo comparable.")).toBeNull();
    expect(notaSinElSharpe("La volatilidad, el Sharpe y el mapa quedan sin dato porque faltan semanas consecutivas con fechas comunes."))
      .toBe("La volatilidad y el mapa quedan sin dato porque faltan semanas consecutivas con fechas comunes.");
    expect(notaSinElSharpe("Hay semanas sin fechas comunes: la volatilidad y el Sharpe se calculan solo entre semanas consecutivas."))
      .toBe("Hay semanas sin fechas comunes: la volatilidad se calcula solo entre semanas consecutivas.");
    expect(notaSinElSharpe("La tasa sin riesgo utiliza cobertura parcial o una tasa de respaldo; el Sharpe es aproximado.")).toBeNull();
    expect(notaSinElSharpe("Las métricas anualizadas y el mapa quedan sin dato: las fechas comunes no llegan a tres semanas.")).toBe("Las métricas anualizadas y el mapa quedan sin dato: las fechas comunes no llegan a tres semanas.");
  });

  test("ninguna nota que escribe la comparación deja el Sharpe dentro: si alguien añade otra, esto falla", () => {
    const fuente = readFileSync(new URL("../src/core/portfolioComparison.ts", import.meta.url), "utf8");
    const frases = [...fuente.matchAll(/notes\.push\("([^"]*Sharpe[^"]*)"\)/g)].map((encaje) => encaje[1]);
    expect(frases.length).toBeGreaterThanOrEqual(5);
    for (const frase of frases) expect(notaSinElSharpe(frase) ?? "").not.toMatch(/Sharpe/);
  });
});

describe("lo que una ficha no trae, en el papel (decisión 66): «No declarado» solo donde es cierto", () => {
  const fondo = { asset_id: "F", instrument_type: "FUND" } as const;
  const accion = { asset_id: "X", instrument_type: "STOCK" } as const;

  test("un fondo sin el dato no lo declara; una acción no tiene categoría de fondo; lo que no ha llegado falta", () => {
    expect(clasificacionQueFalta(fondo, "category")).toBe("No declarado");
    expect(clasificacionQueFalta(fondo, "region")).toBe("No declarado");
    expect(clasificacionQueFalta(accion, "category")).toBe("Acciones");
    expect(clasificacionQueFalta(accion, "region")).toBe("Falta el dato");
    expect(clasificacionQueFalta(undefined, "category")).toBe("Falta el dato");
    expect(clasificacionQueFalta(undefined, "region")).toBe("Falta el dato");
    expect(clasificacionQueFalta(undefined, "economic_asset_class")).toBe("Falta el dato");
  });

  const ficha = (asset_id: string, cambios: Partial<BdbAssetDetail>) => ({ ...comparisonAssets[0], asset_id, ...cambios }) as BdbAssetDetail;
  const fichas = [
    ficha("FONDO", { category: undefined, region: undefined }),
    ficha("ACCION", { instrument_type: "STOCK", category: undefined, region: undefined }),
    ficha("OTRO", { category: "Renta variable global", region: "Europa" })
  ];
  const a = { name: "A", positions: [posicion("FONDO", 40), posicion("ACCION", 30), posicion("SIN-FICHA", 30)] };
  const b = { name: "B", positions: [posicion("OTRO", 100)] };

  test("en la Comparativa, cada peso con su palabra, a mano: 40 + 30 + 30 = 100", () => {
    const entrada = entradaDeLaComparativa({
      a,
      b,
      cargada: { period: "3Y", a: comparisonFixture("3Y", "A"), b: comparisonFixture("3Y", "B"), result: alignPortfolioComparison(comparisonFixture("3Y", "A"), comparisonFixture("3Y", "B"), "3Y") },
      assets: fichas
    });
    const pesos = (filas: Array<{ label: string; a: number }>) => Object.fromEntries(filas.filter((fila) => fila.a > 0).map((fila) => [fila.label, fila.a]));
    /* La que no tiene ficha no entra en el reparto, y va en su propia fila (decisión 85). A una acción sin región sí le falta el dato. */
    expect(pesos(entrada.categoryRows)).toEqual({ "No declarado": 40, Acciones: 30, "Fuera del reparto": 30 });
    /* La región ya no es la de la ficha (10-11-2026): es la renta variable de dentro de los fondos. Fondo y acción son renta variable (70 %), lo que
       no tiene ficha no se sabe qué es; y ninguno de los dos publica su reparto por región, así que no hay filas: el papel dirá «No declarado». */
    expect("regionRows" in entrada).toBe(false);
    expect(entrada.rentaVariable.a).toEqual({ filas: [], pesoPct: 70 });
    expect(pesos(entrada.classRows)).toMatchObject({ "Fuera del reparto": 30 });
    /* Y en su línea y en la tabla de divisas. */
    const sinFicha = entrada.positions.find((fila) => fila.id === "SIN-FICHA");
    expect(sinFicha).toMatchObject({ category: "Fuera del catálogo", currency: "Fuera del reparto" });
    expect(JSON.stringify(entrada)).not.toContain("Sin clasificar");
  });

});

describe("entradaDeLaComparativa", () => {
  const carteras = {
    a: { name: "Cartera A", positions: [posicion("A", 80), posicion("cash", 20)], total_capital: 250_000 },
    b: { name: "Cartera B", positions: [posicion("B", 80), posicion("cash", 20)] }
  };
  const cargada = (a: ComparisonHistory, b: ComparisonHistory) => ({ period: "3Y" as const, a, b, result: alignPortfolioComparison(a, b, "3Y") });

  test("lleva el capital de cada una tal como se guardó, y la que no lo tiene no lo toma prestado", () => {
    const entrada = entradaDeLaComparativa({ ...carteras, cargada: cargada(comparisonFixture("3Y", "A"), comparisonFixture("3Y", "B")), assets: comparisonAssets });
    expect(entrada.capitalA).toBe(250_000);
    expect(entrada.capitalB).toBeUndefined();
    expect(entrada.sharpeNoAplica).toEqual({ a: false, b: false });
  });

  test("una cartera que es una acción lo dice, y las notas solo pierden el Sharpe si no sale en ninguna", () => {
    const acciones = comparisonAssets.map((asset) => ({ ...asset, instrument_type: "STOCK" })) as BdbAssetDetail[];
    const unaSola = (id: string) => { const fixture = comparisonFixture("3Y", id); fixture.backtest.asset_ids = [id]; fixture.backtest.excluded_assets = []; fixture.backtest.warnings = ["RISK_FREE_RATE_PARTIAL"]; return fixture; };
    const entrada = entradaDeLaComparativa({
      a: { name: "Cartera A", positions: [posicion("A")] },
      b: { name: "Cartera B", positions: [posicion("B")] },
      cargada: cargada(unaSola("A"), unaSola("B")),
      assets: acciones
    });
    expect(entrada.sharpeNoAplica).toEqual({ a: true, b: true });
    expect(entrada.methodology.join(" ")).not.toContain("Sharpe");

    const conFondo = entradaDeLaComparativa({
      a: { name: "Cartera A", positions: [posicion("A")] },
      b: { name: "Cartera B", positions: [posicion("B")] },
      cargada: cargada(unaSola("A"), unaSola("B")),
      assets: acciones.map((asset) => (asset.asset_id === "B" ? { ...asset, instrument_type: "FUND" as const } : asset))
    });
    expect(conFondo.sharpeNoAplica).toEqual({ a: true, b: false });
    expect(conFondo.methodology.join(" ")).toContain("El tipo sin riesgo solo se conoce en parte de la ventana o es uno de respaldo; el Sharpe es aproximado.");
    expect(conFondo.methodology.join(" ")).not.toMatch(/\btasa\b/);
    /* En papel, lo que se mide con las palabras del informe de cliente, y no «peso representado» (10-11-2026). */
    expect(conFondo.methodology).toContain("Cartera A: Mide el 100,0\u00a0% de la cartera (1 de 1 posición).");
    expect(conFondo.methodology.join(" ")).not.toContain("peso representado");
  });

  test("«accion» y las regiones de la base salen con las palabras de la pantalla", () => {
    const assets = comparisonAssets.map((asset) => (asset.asset_id === "A" ? { ...asset, category: "accion", region: "Eurozone" } : asset));
    const entrada = entradaDeLaComparativa({ ...carteras, cargada: cargada(comparisonFixture("3Y", "A"), comparisonFixture("3Y", "B")), assets });
    /* En su línea y en el reparto que las suma, la misma palabra: «Acciones» (decisión 83). */
    expect(entrada.positions.find((fila) => fila.id === "A")?.category).toBe("Acciones");
    expect(entrada.categoryRows.map((fila) => fila.label)).toContain("Acciones");
    expect(entrada.categoryRows.map((fila) => fila.label)).not.toContain("Accion");
    /* La región de la ficha ya no llega al papel: la renta variable por región se mira dentro de los fondos (10-11-2026). */
    expect("regionRows" in entrada).toBe(false);
    expect(JSON.stringify([entrada.categoryRows, entrada.classRows, entrada.positions, entrada.rentaVariable])).not.toMatch(/Eurozone|Eurozona/);
  });

  test("el tramo ampliado dice el nombre y una fecha legible, no el código ni la fecha ISO", () => {
    const a = { ...comparisonFixture("3Y", "A"), extensionNotes: ["IE00B4L5Y983: tramo estimado con MSCI World NR, del 2023-10-26 al 2025-02-07."] };
    const b = comparisonFixture("3Y", "B");
    const notas = notasDeLaComparativa(
      { name: "Cartera A", positions: [{ asset_id: "IE00B4L5Y983", weight_percent: 100, label: "iShares Core MSCI World" }] },
      { name: "Cartera B", positions: [posicion("B")] },
      cargada(a, b)
    );
    expect(notas).toContain("Cartera A · iShares Core MSCI World: tramo estimado con MSCI World NR, del 26/10/2023 al 07/02/2025.");
    expect(notas.join(" ")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    /* Guardada sin etiqueta, el nombre sale de la ficha; sin ficha tampoco, queda el identificador: no se inventa otro. */
    const sinEtiqueta = (assets: Array<{ asset_id: string; display_name: string }>) => notasDeLaComparativa(
      { name: "Cartera A", positions: [posicion("IE00B4L5Y983")] }, { name: "Cartera B", positions: [posicion("B")] }, cargada(a, b), assets
    ).join(" ");
    expect(sinEtiqueta([{ asset_id: "IE00B4L5Y983", display_name: "iShares de la ficha" }])).toContain("Cartera A · iShares de la ficha: tramo estimado");
    expect(sinEtiqueta([])).toContain("Cartera A · IE00B4L5Y983: tramo estimado");
  });
});
