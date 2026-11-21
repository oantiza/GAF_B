// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const capturado = vi.hoisted(() => ({ props: null as null | { cells: Array<{ rowIndex: number; columnIndex: number; value: number | null; noAplica?: boolean }>; items: Array<{ key: string; detalle?: string }> } }));
vi.mock("../src/charts/oaa", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/charts/oaa")>();
  return { ...original, OaaOverlapHeatmap: (props: NonNullable<typeof capturado.props>) => { capturado.props = props; return null; } };
});

import { OverlapHeatmap, type OverlapSeries } from "../src/charts/OverlapHeatmap";
import { OaaOverlapHeatmap } from "../src/charts/oaa/OaaOverlapHeatmap";
import { textoDeLaCasilla } from "../src/core/overlap";
import type { BdbAssetHoldings } from "../src/types/bdbAssets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cartera = (asset_id: string, pesos: number[]): BdbAssetHoldings => ({
  asset_id,
  storage_mode: "SINGLE_DOCUMENT",
  holdings: pesos.map((weight_pct, i) => ({ name: `Empresa ${i}`, isin: `ISIN${i}`, weight_pct }))
});
const serie = (asset_id: string, instrument_type: string, pesos: number[] | null): OverlapSeries => ({
  asset_id,
  display_name: asset_id,
  instrument_type,
  holdings: pesos ? cartera(asset_id, pesos) : null
});

describe("la matriz de solapamiento en pantalla (decisiones 6 y 10)", () => {
  test("con la muestra, los dos ETF de diez líneas no entran: la matriz son los seis que se miden, sin un N/D, y debajo va por qué", () => {
    capturado.props = null;
    const series = [
      serie("WORLD", "ETF", Array(10).fill(2.664)),
      serie("SP500", "ETF", Array(10).fill(3.779)),
      ...["F1", "F2", "F3", "F4", "F5"].map((id) => serie(id, "FUND", [100])),
      serie("PIMCO", "FUND", [527.254, -427.254])
    ];
    const html = renderToStaticMarkup(<OverlapHeatmap series={series} />);
    const { cells, items } = capturado.props!;
    /* Antes, 64 casillas y 28 sin cifra. */
    expect(items.map((item) => item.key)).toEqual(["F1", "F2", "F3", "F4", "F5", "PIMCO"]);
    expect(cells).toHaveLength(36);
    expect(cells.filter((c) => c.value === null)).toHaveLength(0);
    expect(cells.some((c) => c.noAplica)).toBe(false);
    /* Líneas, no posiciones (T12): la cuenta de posiciones del fondo es otra cifra, la que declara el proveedor. */
    expect(items[5].detalle).toBe("2 líneas · 100,0\u00a0% del fondo");
    expect(html).toContain("sumando el peso de sus líneas publicadas: la lista dice de cada uno cuántas son y qué peso suman");
    expect(html).toContain("Solo entran los fondos de los que se ha recibido al menos la mitad de su cartera");
    expect(html).not.toContain("posiciones publicadas");
    expect(html).not.toContain("N/D");
    expect(html).toContain("el solapamiento real puede ser mayor");
    expect(html).toContain("Fuera de la matriz:");
    expect(html).toContain("WORLD: publica el 26,6\u00a0% de su cartera.");
    expect(html).toContain("SP500: publica el 37,8\u00a0% de su cartera.");
    expect(html).not.toContain("acción");
    expect(html).not.toContain("Más de 100 %");
  });

  test("una acción y un fondo sin cartera no entran; con un solo fondo medible no hay matriz, y se dice por qué", () => {
    capturado.props = null;
    const html = renderToStaticMarkup(<OverlapHeatmap series={[
      serie("FONDO", "FUND", [100]),
      serie("SIN", "FUND", null),
      serie("ES0144580Y14", "STOCK", null)
    ]} />);
    expect(capturado.props).toBeNull();
    expect(html).toContain("No hay matriz de solapamiento: hacen falta dos fondos con al menos la mitad de su cartera publicada, y solo hay uno.");
    expect(html).toContain("Fuera de la matriz:");
    expect(html).toContain("SIN: no publica su cartera.");
    expect(html).toContain("Acción en directo, que no tiene cartera propia: ES0144580Y14.");
    expect(html).not.toContain("No aplica");
    expect(html).not.toContain("N/D");
  });

  test("con dos fondos medibles y acciones, la matriz es de los fondos y las acciones van en una línea; un fallo de carga dice que no se pudo leer", () => {
    capturado.props = null;
    const html = renderToStaticMarkup(<OverlapHeatmap series={[
      serie("A", "FUND", [60, 40]),
      serie("ES0144580Y14", "STOCK", null),
      serie("B", "FUND", [60, 40]),
      serie("US0378331005", "STOCK", null),
      { ...serie("CAIDO", "FUND", null), noSePudoLeer: true }
    ]} />);
    const { cells, items } = capturado.props!;
    expect(items.map((item) => item.key)).toEqual(["A", "B"]);
    expect(cells).toHaveLength(4);
    /* La misma cifra que antes: lo común de A y B, 100, porque son las mismas líneas. */
    expect(cells.find((c) => c.rowIndex === 0 && c.columnIndex === 1)?.value).toBe(100);
    expect(html).toContain("CAIDO: no se ha podido leer su cartera.");
    expect(html).toContain("Acciones en directo, que no tienen cartera propia: ES0144580Y14 y US0378331005.");
    expect(html).not.toContain("una acción no tiene subyacentes");
  });

  test("solo acciones: no aplica, y no promete que los datos vayan a llegar", () => {
    const html = renderToStaticMarkup(<OverlapHeatmap series={[serie("A", "STOCK", null), serie("B", "STOCK", null)]} />);
    expect(html).toContain("el solapamiento no aplica");
    expect(html).not.toContain("aparecerá");
  });
});

describe("la decisión 47 en la matriz", () => {
  test("cada par con lo común real; el mismo fondo, 100; y si un par pasa de 100, se dice por qué", () => {
    capturado.props = null;
    const conLineas = (asset_id: string, lineas: Array<[string, number]>): OverlapSeries => ({
      asset_id,
      display_name: asset_id,
      instrument_type: "FUND",
      holdings: { asset_id, storage_mode: "SINGLE_DOCUMENT", holdings: lineas.map(([name, weight_pct]) => ({ name, isin: name, weight_pct })) }
    });
    const html = renderToStaticMarkup(<OverlapHeatmap series={[
      conLineas("CLASE_A", [["Forward", 250], ["Bonos", 80], ["Ventas", -230]]),
      conLineas("CLASE_B", [["Forward", 250], ["Bonos", 80], ["Ventas", -230]]),
      conLineas("OTRO", [["Bonos", 3.21], ["Resto", 96.79]])
    ]} />);
    const { cells } = capturado.props!;
    const casilla = (i: number, j: number) => cells.find((c) => c.rowIndex === i && c.columnIndex === j)!;
    expect(casilla(0, 1).value).toBeCloseTo(330, 10);
    expect(casilla(0, 2).value).toBeCloseTo(3.21, 10);
    expect(casilla(0, 0).value).toBe(100);
    expect(casilla(2, 2).value).toBe(100);
    /* Sin código el forward no se quita (decisión 87), y la nota ya no culpa solo a los derivados: con su código no cuentan. */
    expect(html).toContain("«Más de 100 %»: lo común pasa del 100 % porque los dos fondos invierten más que su patrimonio");
    expect(html).not.toContain("Sin comunes");
  });
});

describe("las decisiones 87 y 88 en la matriz", () => {
  const conCodigos = (asset_id: string, lineas: Array<[string, number, string | undefined]>): OverlapSeries => ({
    asset_id,
    display_name: asset_id,
    instrument_type: "FUND",
    holdings: { asset_id, storage_mode: "SINGLE_DOCUMENT", holdings: lineas.map(([name, weight_pct, holding_type_code]) => ({ name, weight_pct, holding_type_code })) }
  });

  test("dos fondos que solo comparten efectivo y un futuro dicen «sin comunes», y la nota dice qué significa", () => {
    capturado.props = null;
    /* Como Robeco y Goldman: dos líneas de divisa que cruzan por el nombre, «CANADIAN DOLLAR» y «JAPANESE YEN», más un futuro. */
    const html = renderToStaticMarkup(<OverlapHeatmap series={[
      conCodigos("ROBECO", [["CANADIAN DOLLAR", 0.4, "CH"], ["JAPANESE YEN", 0.2, "CH"], ["Long Gilt Future", 1.7, "TF"], ["Bono", 97.7, "B"]]),
      conCodigos("GOLDMAN", [["CANADIAN DOLLAR", 0.001, "C"], ["JAPANESE YEN", 0.0001, "C"], ["Long Gilt Future", 2.1, "TF"], ["Otro bono", 97.9, "B"]])
    ]} />);
    const { cells } = capturado.props!;
    expect(cells.find((c) => c.rowIndex === 0 && c.columnIndex === 1)?.value).toBe(0);
    expect(textoDeLaCasilla(0, false).texto).toBe("sin comunes");
    expect(html).toContain("Sin comunes: ningún título publicado coincide, por ISIN o por nombre; no prueba que no compartan nada.");
    expect(html).toContain("No cuentan los derivados, sus contrapartidas ni el efectivo");
  });

  test("sin código, la misma línea de efectivo sigue contando: no se mira el nombre (decisión 9)", () => {
    capturado.props = null;
    const html = renderToStaticMarkup(<OverlapHeatmap series={[
      conCodigos("A", [["Cash", 0.05, undefined], ["Bono", 99.95, "B"]]),
      conCodigos("B", [["Cash", 0.08, undefined], ["Otro bono", 99.92, "B"]])
    ]} />);
    const { cells } = capturado.props!;
    expect(cells.find((c) => c.rowIndex === 0 && c.columnIndex === 1)?.value).toBeCloseTo(0.05, 10);
    expect(textoDeLaCasilla(0.05, false)).toEqual({ texto: "comunes < 0,1\u00a0%", dosLineas: ["comunes", "< 0,1\u00a0%"] });
    expect(html).not.toContain("Sin comunes");
  });
});

describe("cómo se pinta la casilla (OaaOverlapHeatmap)", () => {
  async function pintar(node: React.ReactElement) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(node));
    const html = host.innerHTML;
    await act(async () => root.unmount());
    host.remove();
    return html;
  }

  test("la lista lleva el detalle bajo el nombre", async () => {
    const html = await pintar(<OaaOverlapHeatmap
      items={[{ key: "a", label: "Fondo A", color: "#143D66", detalle: "10 líneas · 26,6 % del fondo" }, { key: "b", label: "Iberdrola", color: "#B9862F", detalle: "No aplica: es una acción" }]}
      cells={[{ rowKey: "a", columnKey: "b", rowLabel: "Fondo A", columnLabel: "Iberdrola", rowIndex: 0, columnIndex: 1, value: null, commonTop: [], noAplica: true }]}
    />);
    expect(html).toContain("oaa-heatmap-index__detalle");
    expect(html).toContain("10 líneas · 26,6 % del fondo");
    expect(html).toContain("No aplica: es una acción");
  });

  test("una cifra dice «al menos» en dos líneas; lo que pasa de 100, «más de 100 %»; la diagonal, 100,0 %, sin más; sin cifra, «Falta»", () => {
    expect(textoDeLaCasilla(3.21, false)).toEqual({ texto: "al menos 3,2\u00a0%", dosLineas: ["al menos", "3,2\u00a0%"] });
    /* Decisión 88: el «al menos 0,0 %» de la decisión 47 se va. Sin nada común, «sin comunes»; con algo que no llega a una décima,
       «comunes < 0,1 %», como R-co y PIMCO con la muestra (0,079). */
    expect(textoDeLaCasilla(0, false)).toEqual({ texto: "sin comunes", dosLineas: ["sin", "comunes"] });
    expect(textoDeLaCasilla(0.07928, false)).toEqual({ texto: "comunes < 0,1\u00a0%", dosLineas: ["comunes", "< 0,1\u00a0%"] });
    expect(textoDeLaCasilla(0.1, false)).toEqual({ texto: "al menos 0,1\u00a0%", dosLineas: ["al menos", "0,1\u00a0%"] });
    expect(textoDeLaCasilla(347.8, false)).toEqual({ texto: "más de 100\u00a0%", dosLineas: ["más de", "100\u00a0%"] });
    expect(textoDeLaCasilla(100, true)).toEqual({ texto: "100,0\u00a0%", dosLineas: null });
    expect(textoDeLaCasilla(null, false)).toEqual({ texto: "Falta", dosLineas: null });
    expect(textoDeLaCasilla(null, true)).toEqual({ texto: "Falta", dosLineas: null });
  });
});

describe("IMP-7: las fechas de las carteras que se comparan", () => {
  const conFecha = (id: string, as_of_date: string | undefined): OverlapSeries => ({ ...serie(id, "FUND", [60, 40]), holdings: { ...cartera(id, [60, 40]), as_of_date } });

  test("con fechas separadas por más de un mes, la pantalla las nombra; con menos, no dice nada", () => {
    capturado.props = null;
    /* 30-jun → 1-ago: 32 días. */
    const lejos = renderToStaticMarkup(<OverlapHeatmap series={[conFecha("A", "2026-06-30"), conFecha("B", "2026-08-01")]} />);
    expect(lejos).toContain("la de A, del 30/06/2026, y la de B, del 01/08/2026 (32 días)");
    /* 30-jun → 31-jul: 31 días. */
    const cerca = renderToStaticMarkup(<OverlapHeatmap series={[conFecha("A", "2026-06-30"), conFecha("B", "2026-07-31")]} />);
    expect(cerca).not.toContain("fechas separadas");
    expect(cerca).not.toContain("No consta");
  });

  test("si de una no consta la fecha, lo dice", () => {
    const html = renderToStaticMarkup(<OverlapHeatmap series={[conFecha("A", "2026-06-30"), conFecha("B", undefined)]} />);
    expect(html).toContain("No consta la fecha de la cartera de B");
  });
});
