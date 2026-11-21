/**
 * INF-20: la lógica que vivía dentro de los informes pasa a `src/core/`, en módulos puros, y los informes la importan de ahí. Es un
 * traslado: las mismas entradas dan las mismas salidas, y hay una sola definición. Las cifras esperadas están escritas a mano.
 *
 * Lo que ya tenía su prueba sigue con ella, ahora contra `core/` a través del informe que la reexporta (`pdfReportGeography.test.ts`,
 * `informeDeClienteSeisHojas.test.ts`); aquí se afirma que es la misma función, la exposición (que no tenía prueba) y la palabra de la
 * correlación con sus umbrales.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import * as palabra from "../src/core/palabraDeLaCorrelacion";
import * as reparto from "../src/core/repartoDelInforme";
import * as riesgo from "../src/core/riesgoDeLaReferencia";
import * as informeDeCliente from "../src/reports/informeDeClientePdf";
import type { BdbPortfolioReport } from "../src/types/bdbAssets";

const fuente = (fichero: string) => readFileSync(fichero, "utf8");

describe("una sola definición, en core", () => {
  test("el informe de cliente reexporta las de core: son las mismas funciones", () => {
    expect(informeDeCliente.buildReportGeography).toBe(reparto.buildReportGeography);
    expect(informeDeCliente.cifrasDelMapa).toBe(reparto.cifrasDelMapa);
    expect(informeDeCliente.fraseDelRiesgoDeLaReferencia).toBe(riesgo.fraseDelRiesgoDeLaReferencia);
    expect(informeDeCliente.COCIENTE_DE_RIESGO_MAXIMO).toBe(1.25);
    expect(informeDeCliente.COCIENTE_DE_RIESGO_MINIMO).toBe(0.8);
  });

  test("ningún informe las define ni las importa de otro informe; los módulos de core no traen @react-pdf", () => {
    const datos = fuente("src/reports/informeDeCliente/datos.ts");
    for (const definicion of [/function buildReportGeography/, /function cifrasDelMapa/, /function deriveExposure/, /function fraseDelRiesgoDeLaReferencia/, /= 1\.25/]) expect(datos).not.toMatch(definicion);
    expect(fuente("src/reports/comparePdf.tsx")).not.toMatch(/from "\.\/informeDeClientePdf"/);
    const interno = fuente("src/reports/internalPortfolioReportPdf.tsx");
    expect(interno).not.toMatch(/>= 0\.7\b|>= 0\.4\b|>= 0\.15\b|< 0\.4\b/);
    for (const modulo of ["src/core/repartoDelInforme.ts", "src/core/riesgoDeLaReferencia.ts", "src/core/palabraDeLaCorrelacion.ts"]) expect(fuente(modulo)).not.toMatch(/from "@react-pdf|from "\.\.\/reports/);
  });
});

describe("la exposición por clase económica", () => {
  test("la del análisis, si la trae: lo que no es número cuenta cero", () => {
    const report = { positions: [], xray: { pms_exposure_percent: { equity: 60, fixed_income: 30, cash: 10, alternative: Number.NaN, real_asset: undefined, other: 0 } } } as unknown as BdbPortfolioReport;
    expect(reparto.deriveExposure(report)).toEqual({ equity: 60, fixed_income: 30, cash: 10, alternative: 0, real_asset: 0, other: 0 });
  });

  test("sin análisis, la de las posiciones invertibles por la vía de la pantalla; sin nada que repartir, ceros", () => {
    /* A mano: 75 % en un fondo 100 % renta variable y 25 % en uno 100 % renta fija; la posición no invertible no entra. */
    const report = {
      positions: [
        { asset_id: "A", weight_percent: 75, is_investable: true, pms_exposure: { equity: 1, fixed_income: 0, cash: 0, alternative: 0, other: 0 } },
        { asset_id: "B", weight_percent: 25, is_investable: true, pms_exposure: { equity: 0, fixed_income: 1, cash: 0, alternative: 0, other: 0 } },
        { asset_id: "C", weight_percent: 50, is_investable: false, pms_exposure: { equity: 0, fixed_income: 0, cash: 1, alternative: 0, other: 0 } }
      ]
    } as unknown as BdbPortfolioReport;
    const exposicion = reparto.deriveExposure(report);
    expect(exposicion.equity).toBeCloseTo(75, 9);
    expect(exposicion.fixed_income).toBeCloseTo(25, 9);
    expect(exposicion.cash).toBeCloseTo(0, 9);
    expect(reparto.deriveExposure({ positions: [] } as unknown as BdbPortfolioReport)).toEqual({ equity: 0, fixed_income: 0, cash: 0, alternative: 0, real_asset: 0, other: 0 });
  });
});

describe("la geografía y la regla 1,25 / 0,80, las mismas salidas", () => {
  test("lo que el mapa no sabe situar no es lo que no se declara", () => {
    /* A mano: 60 en Norteamérica, 20 en «Global» (sin zona y con dato: sin situar), y el resto hasta 100, no declarado. */
    const geografia = reparto.buildReportGeography([{ key: "united_states", weight_percent: 60 }, { key: "Global", weight_percent: 20 }], true);
    expect(geografia.totals.north_america).toBeCloseTo(60, 9);
    expect(geografia.unassigned).toBeCloseTo(40, 9);
    expect(geografia.sinSituar).toBeCloseTo(20, 9);
    expect(geografia.noDeclarado).toBeCloseTo(20, 9);
  });

  test("en el límite justo no se dice; pasado, sí", () => {
    expect(riesgo.fraseDelRiesgoDeLaReferencia(0.125, 0.1)).toBeNull();
    expect(riesgo.fraseDelRiesgoDeLaReferencia(0.08, 0.1)).toBeNull();
    expect(riesgo.fraseDelRiesgoDeLaReferencia(0.13, 0.1)).toMatch(/^La referencia elegida oscila menos/);
    expect(riesgo.fraseDelRiesgoDeLaReferencia(0.07, 0.1)).toMatch(/^La referencia elegida oscila más/);
  });
});

describe("la palabra de una correlación", () => {
  test.each([
    [0.9, "alta"], [0.7, "alta"], [0.6999, "media"], [0.4, "media"], [0.3999, "baja"], [0.15, "baja"], [0.1499, "muy baja"], [-0.5, "muy baja"]
  ] as const)("%s es «%s»", (valor, esperada) => {
    expect(palabra.palabraDeLaCorrelacion(valor)).toBe(esperada);
  });

  test("sin cifra, ninguna palabra", () => {
    for (const valor of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(palabra.palabraDeLaCorrelacion(valor)).toBeNull();
  });

  test("los umbrales, los de siempre", () => {
    expect([palabra.CORRELACION_ALTA, palabra.CORRELACION_MEDIA, palabra.CORRELACION_BAJA]).toEqual([0.7, 0.4, 0.15]);
  });

  test("las parejas más altas: cada pareja una vez, sin la diagonal ni las casillas sin cifra, de mayor a menor", () => {
    const ids = ["A", "B", "C", "D"];
    const matriz = [
      [1, 0.2, 0.9, null],
      [0.2, 1, 0.5, 0.9],
      [0.9, 0.5, 1, -0.1],
      [null, 0.9, -0.1, 1]
    ];
    expect(palabra.parejasMasAltas(ids, matriz, 3)).toEqual([{ a: "A", b: "C", valor: 0.9 }, { a: "B", b: "D", valor: 0.9 }, { a: "B", b: "C", valor: 0.5 }]);
    expect(palabra.parejasMasAltas(ids, matriz, 10)).toHaveLength(5);
  });
});
