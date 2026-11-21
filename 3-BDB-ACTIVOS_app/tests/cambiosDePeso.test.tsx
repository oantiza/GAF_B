/**
 * Las piezas que sustituyen a las tablas copiadas de Diseño de cartera (hallazgos 99 y 106): una columna se llama igual en
 * las tres pantallas, nombre e ISIN no salen pegados, hay fila Total, y el dinero se dice solo si el capital es de verdad.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { CambiosAplicados } from "../src/components/CambiosAplicados";
import { CambiosDePeso, CifrasDeLosCambios } from "../src/components/CambiosDePeso";
import { TablaDeAlternativas } from "../src/components/TablaDeAlternativas";
import { buildPortfolioOptimizationDiff } from "../src/core/portfolioOptimizationDiff";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const activo = (asset_id: string, display_name: string, ongoing_charge: number) =>
  ({ asset_id, display_name, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {}, costs: { ongoing_charge } }) as unknown as BdbAssetDetail;

const activoConMetricas = (asset_id: string, metrics: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ ...activo(asset_id, `Fondo ${asset_id}`, 0.01), metrics, ...extra }) as unknown as BdbAssetDetail;

const ACTIVOS = [activo("LU0000000001", "Fondo A", 0.01), activo("LU0000000002", "Fondo B", 0.02), activo("LU0000000003", "Fondo C", 0.005)];

const COMPARACION = buildPortfolioOptimizationDiff({
  source: "MÁX. SHARPE",
  before: [{ asset_id: "LU0000000001", weight_percent: 60 }, { asset_id: "LU0000000002", weight_percent: 40 }, { asset_id: "LU0000000003", weight_percent: 0 }],
  after: [{ asset_id: "LU0000000001", weight_percent: 45 }, { asset_id: "LU0000000002", weight_percent: 0 }, { asset_id: "LU0000000003", weight_percent: 55 }],
  assets: ACTIVOS,
  beforeMetrics: { expected_return: 0.0851, volatility: 0.1, sharpe: 0.7 },
  afterMetrics: { expected_return: 0.07, volatility: 0.083, sharpe: 0.85 }
});

/* `fmtEur` separa con un espacio duro: aquí se lee como se ve. */
const pintar = (nodo: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(nodo).replace(/\u00a0/g, " ");
const cabeceras = (html: string) =>
  [...html.matchAll(/<th[^>]*scope="col"[^>]*>(?:<button[^>]*>|<span[^>]*>)?([^<]*)/g)].map((m) => m[1]);

describe("la tabla de cambios de peso", () => {
  test("se llama igual en todas partes, y no hay «Original», «Optimizada», «Después» ni «Δ peso»", () => {
    const html = pintar(createElement(CambiosDePeso, { comparacion: COMPARACION }));
    expect(cabeceras(html)).toEqual(["Activo", "Movimiento", "Antes", "Propuesta", "Diferencia"]);
    for (const viejo of ["Original", "Optimizada", "Después", "Δ peso"]) expect(html).not.toContain(viejo);
  });

  test("nombre arriba e ISIN debajo, cifras a la derecha, el peso con un decimal y su diferencia en puntos con dos", () => {
    const html = pintar(createElement(CambiosDePeso, { comparacion: COMPARACION }));
    /* El ISIN va aparte dentro del apunte, para escribirse en la mono de las tablas de activos. */
    expect(html).toContain('<span class="tabla__apunte"><span class="tabla__isin">LU0000000003</span></span>');
    expect(html).toContain("tabla__celda--cifra");
    expect(html).toContain("45,0 %");
    expect(html).toContain("55,0 %");
    expect(html).toContain("−15,00 pp");
    expect(html).toContain("+55,00 pp");
  });

  test("un movimiento se dice en palabras: Entra, Sale, Sube, Baja", () => {
    const html = pintar(createElement(CambiosDePeso, { comparacion: COMPARACION }));
    for (const palabra of ["Entra", "Sale", "Baja"]) expect(html).toContain(palabra);
    expect(html).not.toMatch(/Peso [+−]/);
  });

  test("la fila Total suma lo que hay encima", () => {
    const html = pintar(createElement(CambiosDePeso, { comparacion: COMPARACION }));
    const pie = html.slice(html.indexOf("<tfoot>"));
    expect(pie).toContain("Total");
    expect(pie.match(/100,0 %/g)).toHaveLength(2);
    expect(pie).toContain("0,00 pp");
  });

  test("sin capital fijado, no hay columna de importe", () => {
    const html = pintar(createElement(CambiosDePeso, { comparacion: COMPARACION }));
    expect(html).not.toContain("Importe a mover");
    expect(html).not.toContain("€");
  });

  test("con capital fijado, cuánto se compra y se vende de cada uno, y el total cuadra", () => {
    const html = pintar(createElement(CambiosDePeso, { comparacion: COMPARACION, capital: 200000 }));
    expect(cabeceras(html)).toContain("Importe a mover");
    expect(html).toContain("−30.000,00 €");
    expect(html).toContain("−80.000,00 €");
    expect(html).toContain("+110.000,00 €");
    const pie = html.slice(html.indexOf("<tfoot>"));
    expect(pie).toContain("110.000,00 €");
    expect(pie).toContain("Compras 110.000,00 € · ventas 110.000,00 €");
  });

  test("con capital cero, tampoco: no hay nada que mover", () => {
    expect(pintar(createElement(CambiosDePeso, { comparacion: COMPARACION, capital: 0 }))).not.toContain("Importe a mover");
  });
});

describe("las cifras de la propuesta", () => {
  test("del optimizador: estimación del modelo, y en puntos", () => {
    const html = pintar(createElement(CifrasDeLosCambios, { comparacion: COMPARACION }));
    expect(html).toContain("Rentabilidad estimada por el modelo");
    expect(html).toContain("−1,51 pp");
    expect(html).toContain("Volatilidad estimada por el modelo");
    expect(html).toContain("−1,70 pp");
    expect(html).toContain("Sharpe del modelo");
    expect(html).toContain("+0,15");
    /* ANA-16: un nombre por cosa, «Coste corriente medio». */
    expect(html).toContain("Coste corriente medio");
    expect(html).not.toContain("ponderado");
    expect(html).not.toContain("Δ");
    expect(html).not.toContain("TER");
  });

  test("de Mejorar cartera: medida en la confirmación, no estimada por ningún modelo", () => {
    const html = pintar(createElement(CifrasDeLosCambios, { comparacion: COMPARACION, medida: "confirmacion" }));
    expect(html).toContain("Rentabilidad en la ventana de confirmación");
    expect(html).not.toContain("modelo");
  });

  test("una propuesta sin cifras del modelo no finge tenerlas; un coste que no se conoce dice que falta", () => {
    const sinNada = buildPortfolioOptimizationDiff({ source: "MEJORAR CARTERA", before: [{ asset_id: "X", weight_percent: 100 }], after: [{ asset_id: "Y", weight_percent: 100 }], assets: [] });
    const html = pintar(createElement(CifrasDeLosCambios, { comparacion: sinNada }));
    expect(html).not.toContain("Rentabilidad");
    expect(html).toContain("Falta el dato");
    expect(html).not.toContain("N/D");
  });
});

describe("las alternativas, una sola tabla en Sustituir y en Posiciones", () => {
  const conMetricas = (asset_id: string, extra: Record<string, unknown> = {}) =>
    activoConMetricas(asset_id, { annualized_return_3y: 0.0812, volatility_3y: 0.1234, sharpe_3y: 0.87, metrics_frequency: "WEEKLY" }, extra);
  const tabla = (modoCliente: boolean, alternativas = [{ asset: conMetricas("LU0000000009"), tier: 3 as const, score: 1 }], retroActual: number | null = 0.5) =>
    pintar(
      createElement(ClientModeProvider, {
        initialValue: modoCliente,
        children: createElement(TablaDeAlternativas, {
          alternativas,
          retrocesionActual: retroActual,
          retrocesiones: new Map([["LU0000000009", { isin: "LU0000000009", retro_pct: 0.75, as_of_date: "2026-11-01", source: "prueba" }]]),
          titulo: "Alternativas"
        })
      })
    );

  test("un nombre para cada cosa: «Mismo producto y clase», «Retrocesión», «Diferencia», y cada cifra con su formato", () => {
    const html = tabla(false);
    expect(html).toContain("Mismo producto y clase");
    expect(html).not.toContain("Misma clase");
    expect(cabeceras(html)).toEqual(["Alternativa", "Afinidad", "Rent. 3A", "Vol. 3A", "Sharpe 3A", "Retrocesión", "Diferencia"]);
    /* La rentabilidad, con dos decimales y su signo; la volatilidad y la retrocesión, con dos; la diferencia de dos retrocesiones, en puntos. */
    expect(html).toContain("+8,12 %");
    expect(html).toContain("12,34 %");
    expect(html).toContain("0,87");
    expect(html).toContain("0,75 %");
    expect(html).toContain("+0,25 pp");
  });

  test("no se puede ordenar por ninguna columna: el orden es el de la afinidad, y la retrocesión no lo toca", () => {
    expect(tabla(false)).not.toContain("<button");
  });

  test("el nombre entero, y debajo vehículo, clase e ISIN", () => {
    const html = tabla(false);
    expect(html).toContain("Fondo LU0000000009");
    expect(html).toContain("Fondo · Renta variable");
    expect(html).toContain("LU0000000009");
  });

  test("en Modo cliente, ni rastro de la retrocesión", () => {
    expect(tabla(true).toLocaleLowerCase("es")).not.toContain("retro");
  });

  /* MET-4: dos cierres distintos son dos grupos; la tabla lo dice debajo y cada fila lleva el suyo. */
  test("con cifras de cierres distintos, la tabla dice que va por grupos y en cuál está cada fila", () => {
    const de = (id: string, as_of: string) => ({ asset: conMetricas(id, { metrics: { annualized_return_3y: 0.1, metrics_method: "GEOMETRIC_CAGR", metrics_frequency: "WEEKLY", as_of } }), tier: 3 as const, score: 1, grupo: { metodo: "GEOMETRIC_CAGR", frecuencia: "WEEKLY", cierre: as_of } });
    const html = tabla(false, [de("LU0000000011", "2026-11-13"), de("LU0000000012", "2026-09-30")]);
    expect(html).toContain("Las alternativas van en 2 grupos porque sus cifras no se calculan igual o no son de la misma fecha");
    expect(html).toContain("Grupo 1: Fondo LU0000000011 (con datos semanales, a 13/11/2026; por rentabilidad a 3 años)");
    expect(html).toContain("Grupo 2: Fondo LU0000000012 (con datos semanales, a 30/09/2026; por rentabilidad a 3 años)");
    expect(html).toContain("Grupo 1 · ");
    expect(html).toContain("Grupo 2 · ");
    /* Con el mismo cierre, una sola lista: ni nota ni «Grupo». */
    const igual = tabla(false, [de("LU0000000011", "2026-11-13"), de("LU0000000012", "2026-11-13")]);
    expect(igual).not.toContain("van en");
    expect(igual).not.toContain("Grupo 1");
    /* Sin grupo en las filas (las acciones van por nombre), tampoco se dice nada. */
    const acciones = tabla(false, [{ ...de("ES0000000011", "2026-11-13"), grupo: undefined }, { ...de("ES0000000012", "2026-09-30"), grupo: undefined }]);
    expect(acciones).not.toContain("van en");
  });

  test("a una acción no le aplica el Sharpe; a un fondo sin dato, le falta: no se pintan igual", () => {
    const accion = activoConMetricas("ES0000000001", { annualized_return_3y: 0.1, volatility_3y: 0.2, sharpe_3y: 1.23 }, { instrument_type: "STOCK" });
    const sinDato = activoConMetricas("LU0000000002", {});
    const html = tabla(false, [{ asset: accion, tier: 1, score: 1 }, { asset: sinDato, tier: 1, score: 1 }]);
    expect(html).not.toContain("1,23");
    expect(html).toContain("No aplica");
    expect(html).toContain("Falta");
    expect(html).not.toContain("N/D");
  });
});

describe("Cambios aplicados", () => {
  const panel = (modoCliente: boolean) =>
    pintar(createElement(ClientModeProvider, { initialValue: modoCliente, children: createElement(CambiosAplicados, { comparacion: COMPARACION, onVolverALosPesosAnteriores: () => undefined }) }));

  test("ofrece volver atrás", () => {
    expect(panel(false)).toContain("Volver a los pesos anteriores");
    expect(panel(false)).toContain("Cambios aplicados · MÁX. SHARPE");
  });

  test("la retrocesión ponderada, solo fuera de Modo cliente", () => {
    /* «Media», como el coste corriente medio y la «Retrocesión media» de Posiciones y del informe interno: una palabra por concepto. */
    expect(panel(false)).toContain("Retrocesión media");
    expect(panel(false)).not.toContain("ponderada");
    expect(panel(true).toLocaleLowerCase("es")).not.toContain("retro");
  });
});
