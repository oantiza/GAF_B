import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { puntosDeLaCaja } from "../src/charts/oaa/puntosDeLaCaja";
import { XrayMetricsStyle } from "../src/components/XrayMetricsStyle";
import { cajaDeEstilo, notasDeLaCaja, type CajaDeEstilo } from "../src/core/cajaDeEstilo";
import { SEQUENTIAL_RAMP } from "../src/core/theme";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

/*
 * La caja de estilo y tamaño (decisión 51 de Óscar, 05-11-2026). Los resultados están calculados a mano en cada
 * prueba, con la cuenta escrita al lado: ninguno sale de ejecutar el código.
 */

const NADA = { large_value: 0, large_blend: 0, large_growth: 0, mid_value: 0, mid_blend: 0, mid_growth: 0, small_value: 0, small_blend: 0, small_growth: 0 };

function fondo(id: string, rentaVariable: number, detalle: BdbAssetDetail["exposure_detail"] = {}): BdbAssetDetail {
  return {
    asset_id: id,
    display_name: id,
    instrument_type: "FUND",
    pms_exposure: { equity: rentaVariable, fixed_income: 1 - rentaVariable, cash: 0, alternative: 0, real_asset: 0, other: 0 },
    exposure_detail: detalle
  } as unknown as BdbAssetDetail;
}

const posiciones = (...filas: Array<[string, number]>) =>
  filas.map(([asset_id, weight_percent]) => ({ asset_id, weight_percent })) as unknown as BdbManualPortfolioPosition[];

function caja(activos: BdbAssetDetail[], filas: Array<[string, number]>): CajaDeEstilo {
  const resultado = cajaDeEstilo(posiciones(...filas), activos);
  if (!resultado) throw new Error("se esperaba renta variable");
  return resultado;
}

function celdasIguales(obtenidas: CajaDeEstilo["celdas"], esperadas: Partial<CajaDeEstilo["celdas"]>) {
  for (const [celda, valor] of Object.entries({ ...NADA, ...esperadas })) {
    expect(obtenidas[celda as keyof typeof NADA], celda).toBeCloseTo(valor, 9);
  }
}

describe("la caja suma las celdas de verdad", () => {
  test("ponderadas por la renta variable de cada fondo", () => {
    /* Pesos en RV: 60 × 1 = 60 y 40 × 0,5 = 20, sobre 80. Grande/valor y mediana/mixto: 60 × 0,5 / 80 = 37,5.
       Grande/crecimiento: 20 × 1 / 80 = 25. Suman 100. */
    const resultado = caja(
      [
        fondo("A", 1, { equity_style_box: { ...NADA, large_value: 0.5, mid_blend: 0.5 } }),
        fondo("B", 0.5, { equity_style_box: { ...NADA, large_growth: 1 } })
      ],
      [["A", 60], ["B", 40]]
    );
    celdasIguales(resultado.celdas, { large_value: 37.5, mid_blend: 37.5, large_growth: 25 });
    expect(resultado.conCeldas).toBeCloseTo(100, 9);
    expect(resultado.aproximada).toBe(0);
    expect(resultado.noDeclarada).toBe(0);
  });

  test("el fondo con celdas y con repartos manda por las celdas: una cartera de un fondo da sus nueve celdas", () => {
    /* Los dos repartos multiplicados dirían grande/valor 0,5 × 0,5 = 25; las celdas dicen 50. */
    const resultado = caja(
      [fondo("A", 0.8, {
        equity_style_box: { ...NADA, large_value: 0.5, small_growth: 0.5 },
        equity_styles: { value: 0.5, growth: 0.5 },
        market_caps: { large: 0.5, small: 0.5 }
      })],
      [["A", 100]]
    );
    celdasIguales(resultado.celdas, { large_value: 50, small_growth: 50 });
    expect(resultado.conCeldas).toBeCloseTo(100, 9);
    expect(resultado.aproximada).toBe(0);
  });

  test("un negativo es lo neto de cortos y resta, y la caja sigue sumando 100", () => {
    /* 90 × 0,8 + 10 × 1,3 = 85 en grande/valor; 90 × 0,2 = 18 en mediana/valor; 10 × −0,3 = −3 en pequeña/crecimiento. */
    const resultado = caja(
      [
        fondo("A", 1, { equity_style_box: { ...NADA, large_value: 0.8, mid_value: 0.2 } }),
        fondo("B", 1, { equity_style_box: { ...NADA, large_value: 1.3, small_growth: -0.3 } })
      ],
      [["A", 90], ["B", 10]]
    );
    celdasIguales(resultado.celdas, { large_value: 85, mid_value: 18, small_growth: -3 });
    expect(Object.values(resultado.celdas).reduce((total, valor) => total + valor, 0)).toBeCloseTo(100, 9);
    expect(notasDeLaCaja(resultado).cortos).toBe("Celdas netas de cortos: alguna sale en negativo");
  });

  test("los pesos no tienen que sumar 100: la caja es sobre la renta variable", () => {
    const activos = [
      fondo("A", 1, { equity_style_box: { ...NADA, large_value: 1 } }),
      fondo("B", 1, { equity_style_box: { ...NADA, small_value: 1 } })
    ];
    /* 30 y 10 de un 40: 75 y 25, igual que 75 y 25 de un 100. Una posición con peso 0 o sin activo no cuenta. */
    const resultado = caja(activos, [["A", 30], ["B", 10], ["A", 0], ["C", 50]]);
    celdasIguales(resultado.celdas, { large_value: 75, small_value: 25 });
    expect(resultado.conCeldas).toBeCloseTo(100, 9);
  });
});

describe("mientras un fondo no trae celdas", () => {
  test("si trae los dos repartos, su producto, fondo a fondo y no el de la cartera", () => {
    /* Uno es todo grande/valor y otro todo pequeña/crecimiento, a medias: 50 y 50. El producto de los repartos de la
       CARTERA, que es lo de antes, repartiría un 25 en cada esquina y se inventaría grande/crecimiento y pequeña/valor. */
    const resultado = caja(
      [
        fondo("A", 1, { equity_styles: { value: 1 }, market_caps: { large: 1 } }),
        fondo("B", 1, { equity_styles: { growth: 1 }, market_caps: { small: 1 } })
      ],
      [["A", 50], ["B", 50]]
    );
    celdasIguales(resultado.celdas, { large_value: 50, small_growth: 50 });
    expect(resultado.aproximada).toBeCloseTo(100, 9);
    expect(resultado.conCeldas).toBe(0);
  });

  test("el producto de un fondo: 0,5 × 0,8, 0,5 × 0,8, 0,5 × 0,2 y 0,5 × 0,2", () => {
    const resultado = caja([fondo("A", 1, { equity_styles: { value: 0.5, growth: 0.5 }, market_caps: { large: 0.8, small: 0.2 } })], [["A", 100]]);
    celdasIguales(resultado.celdas, { large_value: 40, large_growth: 40, small_value: 10, small_growth: 10 });
  });

  test("un reparto al que le falta un trozo se reparte entre lo que declara, y esa parte ya es una aproximación", () => {
    /* Valor 0,6 y mixto 0,9: 0,4 y 0,6 de lo declarado. Grande entero: grande/valor 40, grande/mixto 60. */
    const resultado = caja([fondo("A", 1, { equity_styles: { value: 0.6, blend: 0.9 }, market_caps: { large: 1 } })], [["A", 100]]);
    celdasIguales(resultado.celdas, { large_value: 40, large_blend: 60 });
  });

  test("si no trae los dos, su parte es «No declarado»: uno solo no basta", () => {
    /* Solo estilo (30), solo tamaño (20), nada (10) y con celdas (40). */
    const resultado = caja(
      [
        fondo("SOLO_ESTILO", 1, { equity_styles: { value: 1 } }),
        fondo("SOLO_TAMANO", 1, { market_caps: { large: 1 } }),
        fondo("NADA", 1),
        fondo("CELDAS", 1, { equity_style_box: { ...NADA, large_value: 1 } })
      ],
      [["SOLO_ESTILO", 30], ["SOLO_TAMANO", 20], ["NADA", 10], ["CELDAS", 40]]
    );
    celdasIguales(resultado.celdas, { large_value: 40 });
    expect(resultado.noDeclarada).toBeCloseTo(60, 9);
    expect(resultado.aproximada).toBe(0);
  });

  test("una caja rota no se da por buena: sin las nueve, o si no suman 1, se lee por los repartos", () => {
    const ocho = Object.fromEntries(Object.entries(NADA).filter(([celda]) => celda !== "mid_blend"));
    const repartos = { equity_styles: { value: 1 }, market_caps: { large: 1 } };
    for (const rota of [{ ...ocho, large_value: 1 }, { ...NADA, large_value: 0.5 }, { ...NADA, large_value: Number.NaN }]) {
      const resultado = caja([fondo("A", 1, { equity_style_box: rota as Record<string, number>, ...repartos })], [["A", 100]]);
      expect(resultado.conCeldas).toBe(0);
      expect(resultado.aproximada).toBeCloseTo(100, 9);
      celdasIguales(resultado.celdas, { large_value: 100 });
    }
  });

  test("una acción no se reparte: entera a «No declarado», contando por su clase si no trae vector", () => {
    const accion = { asset_id: "ACC", instrument_type: "STOCK", economic_asset_class: "EQUITY" } as unknown as BdbAssetDetail;
    const resultado = caja([accion], [["ACC", 100]]);
    expect(resultado.noDeclarada).toBeCloseTo(100, 9);
    celdasIguales(resultado.celdas, {});
  });

  test("sin renta variable no hay caja, que no es lo mismo que no declararla", () => {
    expect(cajaDeEstilo(posiciones(["B", 100]), [fondo("B", 0)])).toBeNull();
    expect(cajaDeEstilo([], [])).toBeNull();
  });
});

describe("la caja de las dos formas a la vez", () => {
  /* 50 con celdas, 30 por producto, 20 sin nada. Grande/valor: 50 + 30 × 0,5 × 0,5 = 57,5; las otras tres, 30 × 0,25 = 7,5. */
  const activos = [
    fondo("CELDAS", 1, { equity_style_box: { ...NADA, large_value: 1 } }),
    fondo("PRODUCTO", 1, { equity_styles: { value: 0.5, blend: 0.5 }, market_caps: { large: 0.5, mid: 0.5 } }),
    fondo("NADA", 1)
  ];
  const filas: Array<[string, number]> = [["CELDAS", 50], ["PRODUCTO", 30], ["NADA", 20]];

  test("instrumento a instrumento", () => {
    const resultado = caja(activos, filas);
    celdasIguales(resultado.celdas, { large_value: 57.5, large_blend: 7.5, mid_value: 7.5, mid_blend: 7.5 });
    expect(resultado.conCeldas).toBeCloseTo(50, 9);
    expect(resultado.aproximada).toBeCloseTo(30, 9);
    expect(resultado.noDeclarada).toBeCloseTo(20, 9);
    /* Las celdas y lo no declarado cierran el 100. */
    expect(Object.values(resultado.celdas).reduce((total, valor) => total + valor, 0) + resultado.noDeclarada).toBeCloseTo(100, 9);
  });

  test("la pantalla dice la parte a la que afecta, porque es parcial", () => {
    const html = renderToStaticMarkup(createElement(XrayMetricsStyle, { assets: activos, positions: posiciones(...filas) }));
    const texto = html.slice(html.indexOf("<h3>Estilo y tamaño</h3>"), html.indexOf("<h3>Sectores de la renta variable</h3>"));
    expect(texto).toContain("Aproximación: producto de los dos repartos, en el 30,0\u00a0% de la renta variable");
    expect(texto).toContain('<span class="ausencia ausencia--falta">No declarado: 20,0\u00a0% de la renta variable</span>');
  });
});

describe("las notas", () => {
  const conTodo = (conCeldas: number, aproximada: number, noDeclarada: number): CajaDeEstilo => ({ celdas: NADA, conCeldas, aproximada, noDeclarada });

  test("con toda la caja aproximada, la nota sola: es lo de hoy con la nube sin subir", () => {
    expect(notasDeLaCaja(conTodo(0, 100, 0))).toEqual({
      aproximacion: "Aproximación: producto de los dos repartos",
      cortos: null,
      noDeclarada: null
    });
  });

  test("con todas las celdas de verdad la nota desaparece sola", () => {
    expect(notasDeLaCaja(conTodo(100, 0, 0))).toEqual({ aproximacion: null, cortos: null, noDeclarada: null });
  });

  test("lo aproximado y lo no declarado, sin celdas: la aproximación no se acota, porque es todo lo que se ve", () => {
    expect(notasDeLaCaja(conTodo(0, 88, 12))).toEqual({
      aproximacion: "Aproximación: producto de los dos repartos",
      cortos: null,
      noDeclarada: 12
    });
  });

  test("una parte que se escribiría «0,0 %» no se dice", () => {
    expect(notasDeLaCaja(conTodo(99.97, 0.03, 0)).aproximacion).toBeNull();
    expect(notasDeLaCaja(conTodo(99.97, 0, 0.03)).noDeclarada).toBeNull();
  });

  test("sin nada que dibujar solo queda decir cuánto falta, y sin renta variable no hay nada que decir", () => {
    expect(notasDeLaCaja(conTodo(0, 0, 100))).toEqual({ aproximacion: null, cortos: null, noDeclarada: 100 });
    expect(notasDeLaCaja(null)).toEqual({ aproximacion: null, cortos: null, noDeclarada: null });
  });
});

describe("cuando no hay caja, la pantalla no dibuja una cuadrícula en blanco", () => {
  const cajaEnPantalla = (activos: BdbAssetDetail[], filas: Array<[string, number]>) => {
    const html = renderToStaticMarkup(createElement(XrayMetricsStyle, { assets: activos, positions: posiciones(...filas) }));
    return html.slice(html.indexOf("<h3>Estilo y tamaño</h3>"), html.indexOf("<h3>Sectores de la renta variable</h3>"));
  };

  test("sin renta variable no aplica, y lo dice como sus vecinas", () => {
    const texto = cajaEnPantalla([fondo("BONOS", 0)], [["BONOS", 100]]);
    expect(texto).toContain('<span class="ausencia ausencia--no-aplica">Sin renta variable en esta cartera</span>');
    expect(texto).not.toContain("oaa-chart-frame");
    expect(texto).not.toContain("No declarado");
  });

  test("con renta variable y sin ningún reparto falta, y dice cuánto: no es lo mismo que no aplicar", () => {
    const texto = cajaEnPantalla([fondo("MUDO", 1)], [["MUDO", 100]]);
    expect(texto).toContain('<span class="ausencia ausencia--falta">No declarado: 100,0\u00a0% de la renta variable</span>');
    expect(texto).not.toContain("oaa-chart-frame");
    expect(texto).not.toContain("Sin renta variable");
  });

  test("con algo que dibujar, sí se dibuja", () => {
    const texto = cajaEnPantalla([fondo("A", 1, { equity_style_box: { ...NADA, large_value: 1 } })], [["A", 100]]);
    expect(texto).toContain("oaa-chart-frame");
    expect(texto).not.toContain("ausencia");
  });
});

describe("el dibujo", () => {
  test("una celda negativa no rompe la rampa: primer tono y su cifra", () => {
    const puntos = puntosDeLaCaja({ ...NADA, large_value: 85, mid_value: 18, small_growth: -3 }, 54);
    const negativa = puntos.find((punto) => punto.id === "small-growth");
    const cero = puntos.find((punto) => punto.id === "large-blend");
    expect(negativa?.value).toBe(-3);
    expect(negativa?.fill).toBeDefined();
    expect(negativa?.fill).toBe(cero?.fill);
    expect(puntos.find((punto) => punto.id === "large-value")?.fill).not.toBe(cero?.fill);
    expect(puntos).toHaveLength(9);
  });

  /* 14-11-2026: el color va por tramos absolutos de peso, los mismos de la ficha. Antes cada casilla se medía contra la
     mayor, y nueve casillas iguales salían las nueve en el tono más oscuro. */
  test("el color dice cuánta renta variable hay en la casilla, no cuánto se parece a la mayor", () => {
    /* Nueve casillas iguales, 11,1 % cada una: todas en el tramo del 10 al 25 %. */
    const iguales = Object.fromEntries(Object.keys(NADA).map((celda) => [celda, 100 / 9])) as typeof NADA;
    expect([...new Set(puntosDeLaCaja(iguales, 54).map((punto) => punto.fill))]).toEqual([SEQUENTIAL_RAMP[3]]);
    /* 60, 30, 8 y 2 %: desde el 50 %, del 25 al 50 % y, las dos últimas, menos del 10 %. Lo vacío, el primer tono. */
    const puntos = puntosDeLaCaja({ ...NADA, large_growth: 60, large_blend: 30, mid_growth: 8, small_value: 2 }, 54);
    const color = (id: string) => puntos.find((punto) => punto.id === id)?.fill;
    expect(["large-growth", "large-blend", "mid-growth", "small-value", "mid-value"].map(color)).toEqual([
      SEQUENTIAL_RAMP[7],
      SEQUENTIAL_RAMP[5],
      SEQUENTIAL_RAMP[1],
      SEQUENTIAL_RAMP[1],
      SEQUENTIAL_RAMP[0]
    ]);
  });

  test("Grande arriba y Valor a la izquierda", () => {
    const puntos = puntosDeLaCaja(NADA, 54);
    expect(puntos.find((punto) => punto.id === "large-value")).toMatchObject({ x: 0, y: 2, rowLabel: "Grande", columnLabel: "Valor" });
    expect(puntos.find((punto) => punto.id === "small-growth")).toMatchObject({ x: 2, y: 0, rowLabel: "Pequeña", columnLabel: "Crecim." });
  });
});
