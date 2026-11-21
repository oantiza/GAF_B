import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import {
  avisoDeDivisas,
  avisosDeComprobar,
  avisosDeLaVistaPrevia,
  avisosDePantalla,
  cifrasDelProveedorEnOtraDivisa,
  cifrasMedidas,
  cifrasMidiendo,
  coberturaDeLaSimulacion,
  diferencialConLaReferencia,
  esUnaSolaAccion,
  estadoDeLaVolatilidad,
  fueraDeLaMedida,
  hayCifraDeCartera,
  idsConPeso,
  leerLaTira,
  metricasPorPosicion,
  motivoPorPocoPeso,
  motivoPorPocoPesoEnElPapel,
  motivoSinCifraDeCartera,
  notaDeLaSimulacion,
  pesoLegible,
  procedenciaDeLaMedida,
  procedenciaDeLaSimulacion,
  recuentoEnPantalla,
  riesgoParaElAnalisisIA,
  rotuloDeLaMedida,
  rotuloDeLaSerie,
  selloDeLaMedida,
  senalDeLoQueQuedaFuera,
  soloAcciones,
  universoDeLaComprobacion
} from "../src/core/medidaDeLaCartera";
import { computePortfolioPreviewMetrics } from "../src/core/portfolio";
import { riesgoMedidoDe } from "../src/core/riesgoMedido";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const posiciones: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 88 },
  { asset_id: "IE00B3XXRP09", weight_percent: 12 }
];
const activos = [
  { asset_id: "A", display_name: "Fondo A" },
  { asset_id: "IE00B3XXRP09", display_name: "Vanguard S&P 500 UCITS ETF" }
] as BdbAssetDetail[];

const horizonte = (parcial: Partial<PortfolioHorizon> = {}) =>
  ({
    window: "3Y",
    years: 3,
    referenceVersion: "2026-10",
    coverageWeightPercent: 88,
    extensions: [],
    frontier: null,
    backtest: {
      metrics: { cagr: 0.1192, volatility: 0.0776, sharpe: 1.18, max_drawdown: -0.1135, rf_rate: 0.028 },
      coverage: { first_date: "2023-10-20", last_date: "2026-10-23" },
      excluded_assets: [{ asset_id: "IE00B3XXRP09", reason: "QUALITY_BLOCKED" }]
    },
    ...parcial
  }) as unknown as PortfolioHorizon;

describe("de dónde salen las cifras, sacado del dato", () => {
  const fuera = fueraDeLaMedida(horizonte(), posiciones, activos);

  test("la línea de procedencia de la muestra, palabra por palabra", () => {
    expect(procedenciaDeLaMedida(horizonte(), fuera)).toBe(
      "Simulación con los pesos de hoy · del 20/10/2023 al 23/10/2026 · 88,0\u00a0% del peso · fuera: Vanguard S&P 500 UCITS ETF (12,0\u00a0%)"
    );
  });

  test("otra cartera, otras cifras: nada escrito a mano", () => {
    const otra = horizonte({ coverageWeightPercent: 100, backtest: { ...horizonte().backtest, excluded_assets: [], coverage: { first_date: "2021-01-08", last_date: "2026-01-09" } } as never });
    expect(procedenciaDeLaMedida(otra, [])).toBe("Simulación con los pesos de hoy · del 08/01/2021 al 09/01/2026 · 100,0\u00a0% del peso");
  });

  test("el sello no pierde lo que distinguía el anterior", () => {
    expect(selloDeLaMedida(horizonte())).toBe("Simulación con los pesos de hoy · precios observados");
    expect(selloDeLaMedida(horizonte({ extensions: [{}] as never }))).toBe("Simulación con los pesos de hoy · histórico ampliado");
    expect(selloDeLaMedida(horizonte({ referenceVersion: "demo-synthetic.v1" }))).toBe("Datos de muestra · series sintéticas");
  });

  test("la nota de la simulación", () => {
    expect(notaDeLaSimulacion(horizonte())).toBe(
      "Simulación: pesos de hoy desde 20/10/2023, sin reequilibrar, netos de gastos de los fondos, antes de asesoramiento e impuestos. Peso medido: 88,0\u00a0%."
    );
  });

  /* La nota afirma cuatro cosas de un cálculo que vive en el servidor. Si el cálculo cambia, esta prueba
     tiene que caerse antes de que la nota mienta. */
  test("cada palabra de la nota es cierta en el servidor", () => {
    const servidor = readFileSync(new URL("../functions_python/portfolio_horizon.py", import.meta.url), "utf8");
    // Los pesos de hoy desde el primer día, sin reequilibrar: niveles sobre el primero, por un peso fijo.
    expect(servidor).toContain("portfolio=(levels/levels[0] @ np.asarray([weights[a] for a in ids]))*100");
    // Sobre la parte con serie: el peso se normaliza a lo cubierto.
    expect(servidor).toContain("norm={a:weights[a]/covered for a in ids}");
    // No hay asesoramiento ni impuestos en ese cálculo.
    expect(servidor).not.toMatch(/\b(tax|impuesto|advisory|asesoramiento)\b/i);
  });

  test("un 79,6 % no se escribe como 80 %: ahí está el umbral", () => {
    expect(pesoLegible(79.6)).toBe("79,6\u00a0%");
    expect(pesoLegible(88)).toBe("88,0\u00a0%");
    expect(pesoLegible(87.98)).toBe("88,0\u00a0%");
  });

  test("ni un 79,96 %: lo que no llega al umbral nunca se escribe como si llegara", () => {
    expect(pesoLegible(79.96)).toBe("79,96\u00a0%");
    expect(pesoLegible(79.999)).toBe("79,99\u00a0%");
    expect(pesoLegible(80)).toBe("80,0\u00a0%");
    expect(pesoLegible(80.04)).toBe("80,0\u00a0%");
  });

  test("la curva dice de qué es: «Parte medida» si algo se queda fuera, y las cifras por debajo del 80 %", () => {
    expect(rotuloDeLaSerie(horizonte())).toBe("Parte medida (88,0\u00a0%)");
    expect(rotuloDeLaSerie(horizonte({ coverageWeightPercent: 100 }))).toBe("Cartera");
    expect(rotuloDeLaMedida("Volatilidad", 3, false, 70)).toBe("Volatilidad 3 años · parte medida (70,0\u00a0%)");
    expect(rotuloDeLaMedida("Volatilidad", 3, false, 88)).toBe("Volatilidad 3 años");
    expect(rotuloDeLaMedida("Volatilidad", 3)).toBe("Volatilidad 3 años");
  });

  test("lo que se queda fuera, con su nombre y su peso, y sin inventarlo si no se puede cruzar", () => {
    expect(fuera).toEqual([{ assetId: "IE00B3XXRP09", nombre: "Vanguard S&P 500 UCITS ETF", pesoPct: 12, motivo: "bloqueado por calidad del dato", porCalidad: true }]);
    const sinCruce = fueraDeLaMedida(horizonte(), [{ asset_id: "A", weight_percent: 100 }], activos);
    expect(sinCruce[0].pesoPct).toBeNull();
    expect(senalDeLoQueQuedaFuera(fuera)).toBe("1 posición fuera del cálculo por calidad del dato: Vanguard S&P 500 UCITS ETF (12,0\u00a0%).");
    expect(senalDeLoQueQuedaFuera([])).toBeNull();
    expect(senalDeLoQueQuedaFuera([{ ...fuera[0], porCalidad: false, motivo: "histórico insuficiente" }])).toBe("1 posición fuera del cálculo: Vanguard S&P 500 UCITS ETF (12,0\u00a0%).");
  });

});

describe("la tira de cifras", () => {
  const medido = riesgoMedidoDe(horizonte())!;

  test("cuatro cifras a 3 años con rótulos limpios: la rentabilidad con signo, todas con dos decimales", () => {
    expect(cifrasMedidas(medido, { anos: 3, tipoSinRiesgo: 0.028 })).toEqual([
      { label: "Rentabilidad anualizada 3 años", value: "+11,92\u00a0%" },
      { label: "Volatilidad 3 años", value: "7,76\u00a0%" },
      { label: "Sharpe 3 años", value: "1,18", note: "Tipo sin riesgo 2,80\u00a0%" },
      { label: "Caída máxima 3 años", value: "−11,35\u00a0%" }
    ]);
  });

  test("a 5 años, las mismas cuatro de la misma simulación", () => {
    const cifras = cifrasMedidas(medido, { anos: 5 });
    expect(cifras.map((c) => c.label)).toEqual(["Rentabilidad anualizada 5 años", "Volatilidad 5 años", "Sharpe 5 años", "Caída máxima 5 años"]);
    expect(cifrasMedidas(medido, { anos: 3 }).map((c) => c.label).join(" ")).not.toMatch(/ponderada|5 años/);
  });

  test("con histórico ampliado, el rótulo dice que es estimado", () => {
    expect(cifrasMedidas(medido, { anos: 3, ampliado: true })[0].label).toBe("Rentabilidad anualizada 3 años · estimado");
  });

  test("con una sola acción, el Sharpe no aplica, medido o midiendo: la cartera es la acción", () => {
    const motivo = "De un componente importa lo que aporta a la cartera, no su nota aislada.";
    expect(cifrasMedidas(medido, { anos: 3, unaSolaAccion: true })[2]).toEqual({ label: "Sharpe 3 años", value: "No aplica", note: motivo });
    expect(cifrasMidiendo(3, { unaSolaAccion: true })[2]).toEqual({ label: "Sharpe 3 años", value: "No aplica", note: motivo });
  });

  test("qué es una sola acción", () => {
    const accion = { asset_id: "A", instrument_type: "STOCK" } as BdbAssetDetail;
    const fondo = { asset_id: "F", instrument_type: "FUND" } as BdbAssetDetail;
    expect(esUnaSolaAccion(["A"], [accion, fondo])).toBe(true);
    expect(esUnaSolaAccion(["F"], [accion, fondo])).toBe(false);
    expect(esUnaSolaAccion(["A", "F"], [accion, fondo])).toBe(false);
    expect(esUnaSolaAccion(["X"], [accion, fondo])).toBe(false);
    expect(soloAcciones(["A"], [accion])).toBe(true);
    expect(soloAcciones([], [accion])).toBe(false);
    expect(idsConPeso([{ asset_id: "A", weight_percent: 100 }, { asset_id: "F", weight_percent: 0 }])).toEqual(["A"]);
  });

  test("sin ningún fondo dentro, la nota no habla de gastos de los fondos", () => {
    const nota = notaDeLaSimulacion(horizonte(), { sinFondos: true });
    expect(nota).not.toContain("gastos de los fondos");
    expect(nota).toContain("sin reequilibrar, antes de asesoramiento e impuestos.");
  });
});

/**
 * Decisión 36: sin serie que cubra al menos el 80 % del peso no hay cifra de cartera, ninguna. Los resultados se escriben a mano:
 * con Vanguard al 60 % y JPMorgan al 40 %, y el Vanguard fuera, la simulación mide el 40 %.
 */
describe("sin serie que cubra el 80 % del peso, ninguna cifra de cartera (decisión 36)", () => {
  const vanguard60: BdbManualPortfolioPosition[] = [
    { asset_id: "IE00B3XXRP09", weight_percent: 60 },
    { asset_id: "LU0430492750", weight_percent: 40 }
  ];
  const lasDos = [
    { asset_id: "IE00B3XXRP09", display_name: "Vanguard S&P 500 UCITS ETF" },
    { asset_id: "LU0430492750", display_name: "JPMorgan Euro Aggregate Bond" }
  ] as BdbAssetDetail[];
  const medida = (coverageWeightPercent: number) => horizonte({ coverageWeightPercent });
  const leer = (h: PortfolioHorizon | null, extra: Partial<Parameters<typeof leerLaTira>[0]> = {}) =>
    leerLaTira({ horizonte: h, fuera: fueraDeLaMedida(h, vanguard60, lasDos), midiendo: false, hayPeso: true, anos: 3, ...extra });
  const textoDe = (lectura: ReturnType<typeof leerLaTira>) => JSON.stringify(lectura);
  /* Lo que se ha retirado no vuelve por ningún camino. */
  const LO_RETIRADO = /ponderada|estimad|media de activos|composición|Con dato|con dato/i;

  test("el corte: 79,9 sin cifra, 80 con cifra", () => {
    expect(hayCifraDeCartera(79.9)).toBe(false);
    expect(hayCifraDeCartera(80)).toBe(true);
    expect(leer(medida(79.9)).estado).toBe("falta");
    expect(leer(medida(80)).estado).toBe("medida");
    /* Con 80 %, las cuatro cifras de la simulación; con 79,9 %, ninguna: la lectura no lleva ni una casilla. */
    const con80 = leer(medida(80));
    expect(con80.estado === "medida" && con80.cifras.map((c) => c.value)).toEqual(["+11,92\u00a0%", "7,76\u00a0%", "1,18", "−11,35\u00a0%"]);
    expect(leer(medida(79.9))).not.toHaveProperty("cifras");
  });

  test("un 80 % justo que el servidor cuenta en coma flotante sigue siendo un 80", () => {
    /* 100 * 0,7999999999999999 / 0,9999999999999999, ocho posiciones de un 10 % entre diez. */
    expect(hayCifraDeCartera(79.99999999999999)).toBe(true);
    expect(leer(medida(79.99999999999999)).estado).toBe("medida");
    expect(pesoLegible(79.99999999999999)).toBe("80,0\u00a0%");
    /* Lo que de verdad no llega no se redondea para llegar: un 79,99 sigue sin cifra. */
    expect(hayCifraDeCartera(79.99)).toBe(false);
    expect(leer(medida(79.99)).estado).toBe("falta");
  });

  test("Vanguard 60 + JPMorgan 40: dice cuánto mide y qué se queda fuera, en una frase para el asesor y para el cliente", () => {
    const lectura = leer(horizonte({
      coverageWeightPercent: 40,
      backtest: { ...horizonte().backtest, excluded_assets: [{ asset_id: "IE00B3XXRP09", reason: "QUALITY_BLOCKED" }] } as never
    }));
    expect(lectura).toEqual({
      estado: "falta",
      procedencia: "Simulación con los pesos de hoy · del 20/10/2023 al 23/10/2026 · 40,0\u00a0% del peso",
      motivo: "La simulación mide el 40,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se queda fuera: Vanguard S&P 500 UCITS ETF (60,0\u00a0%)."
    });
    /* «Bloqueado por calidad del dato» es cocina: no está en la frase. */
    expect(textoDe(lectura)).not.toContain("calidad");
    expect(textoDe(lectura)).not.toMatch(LO_RETIRADO);
  });

  test("varias fuera: se nombran todas, en plural", () => {
    const fuera = [
      { assetId: "A", nombre: "Fondo A", pesoPct: 30, motivo: "", porCalidad: false },
      { assetId: "B", nombre: "Fondo B", pesoPct: 25, motivo: "", porCalidad: false }
    ];
    const lectura = leerLaTira({ horizonte: medida(45), fuera, midiendo: false, hayPeso: true, anos: 3 });
    expect(lectura.estado === "falta" && lectura.motivo).toContain("Se quedan fuera: Fondo A (30,0\u00a0%), Fondo B (25,0\u00a0%).");
  });

  test("con 0 %: el servidor dice que los datos no dan, y es «Falta el dato», no un fallo", () => {
    const lectura = leer(null, { sinSerie: true });
    expect(lectura.estado).toBe("falta");
    expect(lectura.estado === "falta" && lectura.motivo).toBe(
      "Con los datos de hoy, la simulación no mide ninguna posición, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se queda fuera toda la cartera."
    );
    expect(textoDe(lectura)).not.toMatch(LO_RETIRADO);
  });

  test("si la simulación falla, se dice que se puede reintentar y tampoco hay cifra", () => {
    const lectura = leer(null, { medicionFallida: true });
    expect(lectura.estado === "falta" && lectura.motivo).toContain("se puede reintentar");
    expect(lectura).not.toHaveProperty("cifras");
    expect(textoDe(lectura)).not.toMatch(LO_RETIRADO);
  });

  test("mientras se mide, «Midiendo…» y ninguna cifra que luego cambie", () => {
    const lectura = leer(null, { midiendo: true });
    expect(lectura.estado).toBe("midiendo");
    expect(lectura.estado === "midiendo" && lectura.cifras).toEqual(cifrasMidiendo(3));
    expect(cifrasMidiendo(5).map((c) => `${c.label}: ${c.value}`)).toEqual([
      "Rentabilidad anualizada 5 años: Midiendo…",
      "Volatilidad 5 años: Midiendo…",
      "Sharpe 5 años: Midiendo…",
      "Caída máxima 5 años: Midiendo…"
    ]);
    expect(textoDe(lectura)).not.toMatch(/\d+,\d/);
    expect(textoDe(lectura)).not.toMatch(LO_RETIRADO);
  });

  test("con todos los pesos a 0 no hay nada que simular: no se dice que haya fallado", () => {
    const lectura = leer(null, { hayPeso: false });
    expect(lectura.estado === "falta" && lectura.motivo).toBe("Ninguna posición tiene peso: sin pesos no hay cartera que simular.");
  });

  test("con el 80 % medido pero sin todas sus cifras no dice que falte peso", () => {
    const rota = horizonte({ coverageWeightPercent: 90, backtest: { ...horizonte().backtest, metrics: { cagr: 0.1, volatility: 0.1, sharpe: Number.NaN, max_drawdown: -0.1, rf_rate: 0.02 } } as never });
    const lectura = leer(rota);
    expect(lectura.estado === "falta" && lectura.motivo).toBe("La simulación mide el 90,0\u00a0% del peso, pero no ha podido calcular todas sus cifras.");
  });

  test("una acción sola y un fondo solo medidos al 100 %: cuatro casillas; el Sharpe de la acción no aplica", () => {
    const entera = horizonte({ coverageWeightPercent: 100, backtest: { ...horizonte().backtest, excluded_assets: [] } as never });
    const fondo = leer(entera);
    const accion = leer(entera, { unaSolaAccion: true, sinFondos: true });
    expect(fondo.estado === "medida" && fondo.cifras[2].value).toBe("1,18");
    expect(accion.estado === "medida" && accion.cifras[2].value).toBe("No aplica");
    expect(accion.estado === "medida" && accion.nota).not.toContain("gastos de los fondos");
    expect(fondo.estado === "medida" && fondo.nota).toContain("netos de gastos de los fondos");
  });

  test("con una posición fuera y más del 80 % medido, las cifras se quedan y la línea dice quién falta", () => {
    const lectura = leer(horizonte());
    expect(lectura.estado).toBe("medida");
    expect(lectura.procedencia).toBe("Simulación con los pesos de hoy · del 20/10/2023 al 23/10/2026 · 88,0\u00a0% del peso · fuera: Vanguard S&P 500 UCITS ETF (60,0\u00a0%)");
  });

  test("el rótulo de la parte medida lee el mismo corte: un 80 % en coma flotante no es «parte medida»", () => {
    expect(rotuloDeLaMedida("Volatilidad", 3, false, 79.9)).toBe("Volatilidad 3 años · parte medida (79,9\u00a0%)");
    expect(rotuloDeLaMedida("Volatilidad", 3, false, 80)).toBe("Volatilidad 3 años");
    expect(rotuloDeLaMedida("Volatilidad", 3, false, 79.99999999999999)).toBe("Volatilidad 3 años");
  });

  test("la diferencia con la referencia: 109,3 frente a 137,5 son −28,2 con la cartera medida, y nada con una parte", () => {
    expect(diferencialConLaReferencia(109.3, 137.5, 88)).toBeCloseTo(-28.2, 10);
    expect(diferencialConLaReferencia(109.3, 137.5, 80)).toBeCloseTo(-28.2, 10);
    expect(diferencialConLaReferencia(137.5, 109.3, 100)).toBeCloseTo(28.2, 10);
    expect(diferencialConLaReferencia(109.3, 137.5, 79.9)).toBeNull();
    expect(diferencialConLaReferencia(109.3, 137.5, 40)).toBeNull();
  });

  test("la frase del poco peso, la misma donde se diga", () => {
    expect(motivoPorPocoPeso(79.6)).toBe("La simulación mide el 79,6\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso.");
    expect(motivoPorPocoPeso(79.96)).toContain("79,96\u00a0%");
  });

  test("Análisis IA recibe lo medido o que no está medido, nunca la suma ponderada", () => {
    const conCifras = riesgoParaElAnalisisIA(medida(88));
    expect(conCifras).toMatchObject({ riesgo_de_la_cartera: { anos: 3, peso_medido_pct: 88, volatilidad: 0.0776, sharpe: 1.18 } });
    expect(riesgoParaElAnalisisIA(medida(88), { unaSolaAccion: true }).riesgo_de_la_cartera).not.toHaveProperty("sharpe");
    expect(riesgoParaElAnalisisIA(medida(79.9)).riesgo_de_la_cartera).toBe(
      "Sin medir. La simulación mide el 79,9\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso."
    );
    expect(riesgoParaElAnalisisIA(null).riesgo_de_la_cartera).toBe("Sin medir: no hay simulación de la cartera.");
  });
});

describe("el motivo que lee el papel: la misma función que la tira de Análisis (decisión 59)", () => {
  const fuera = (nombre: string, pesoPct: number) => ({ assetId: nombre, nombre, pesoPct, motivo: "", porCalidad: false });
  const MOTIVO_40 = "La simulación mide el 40,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se queda fuera: Vanguard (60,0\u00a0%).";

  test("el corte, el de la tira: 79,9 y 79,99 sin cifra, 80 y 79,99999999999999 con cifra", () => {
    const motivo = (peso: number) => motivoSinCifraDeCartera(horizonte({ coverageWeightPercent: peso }), []);
    expect(motivo(79.9)).toContain("mide el 79,9\u00a0% del peso");
    expect(motivo(79.99)).toContain("mide el 79,99\u00a0% del peso");
    expect(motivo(80)).toBeNull();
    expect(motivo(79.99999999999999)).toBeNull();
    expect(motivo(100)).toBeNull();
    expect(motivo(0)).toContain("mide el 0,0\u00a0% del peso");
  });

  test("dice lo mismo que la tira, palabra por palabra", () => {
    const h = horizonte({ coverageWeightPercent: 40 });
    const lectura = leerLaTira({ horizonte: h, fuera: [fuera("Vanguard", 60)], midiendo: false, hayPeso: true, anos: 3 });
    expect(lectura.estado === "falta" && lectura.motivo).toBe(MOTIVO_40);
    expect(motivoSinCifraDeCartera(h, [fuera("Vanguard", 60)])).toBe(MOTIVO_40);
  });

  test("llega al 80 % y la simulación no da una cifra: ausencia, también aquí", () => {
    const rota = horizonte({ coverageWeightPercent: 90, backtest: { ...horizonte().backtest, metrics: { cagr: 0.1, volatility: 0.1, sharpe: Number.NaN, max_drawdown: -0.1, rf_rate: 0.02 } } as never });
    expect(motivoSinCifraDeCartera(rota, [])).toBe("La simulación mide el 90,0\u00a0% del peso, pero no ha podido calcular todas sus cifras.");
  });

  test("sin simulación, y sin pesos, también lo dice", () => {
    expect(motivoSinCifraDeCartera(null, [])).toBe("No se ha podido simular la cartera, y sin simulación no hay cifra de la cartera.");
    expect(motivoSinCifraDeCartera(undefined, [], { hayPeso: false })).toBe("Ninguna posición tiene peso: sin pesos no hay cartera que simular.");
  });

  test("en una hoja no caben todos: hasta tres nombres se escriben; con más, se cuentan, con su peso, y dice dónde se detallan", () => {
    const tres = [fuera("A", 20), fuera("B", 20), fuera("C", 20)];
    expect(motivoPorPocoPesoEnElPapel(40, tres, "detalladas en el anexo")).toContain("Se quedan fuera: A (20,0\u00a0%), B (20,0\u00a0%), C (20,0\u00a0%).");
    const cuatro = [...tres.slice(1), fuera("C", 10), fuera("D", 10)];
    expect(motivoPorPocoPesoEnElPapel(40, cuatro, "detalladas en la sección 10")).toBe("La simulación mide el 40,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80 % del peso. Se quedan fuera 4 posiciones (60,0\u00a0% del peso), detalladas en la sección 10.");
    /* Tres nombres de 100 caracteres tampoco caben: el tope es el de la frase de `parteMedida`. */
    const largos = [fuera("N".repeat(100), 20), fuera("M".repeat(100), 20), fuera("O".repeat(100), 20)];
    expect(motivoPorPocoPesoEnElPapel(40, largos, "detalladas en el anexo")).toContain("Se quedan fuera 3 posiciones (60,0\u00a0% del peso)");
  });
});

describe("lo que se cuenta en pantalla", () => {
  const posicion = (asset_id: string, extra: Record<string, unknown> = {}) =>
    ({ asset_id, is_investable: true, quality_flags: [], coverage_status: "COMPLETE", performance_preview: { available: true }, ...extra }) as never;
  const fuera = [{ assetId: "V", nombre: "Vanguard", pesoPct: 12, motivo: "bloqueado", porCalidad: true }];

  test("lo que se queda fuera del cálculo y un aviso en la ficha cuentan, y lo de fuera no es completo", () => {
    const posiciones = [
      posicion("V"),
      posicion("G", { data_quality_summary: { coverage_status: "COMPLETE", warnings_count: 1 } }),
      posicion("A")
    ];
    expect(recuentoEnPantalla(posiciones, fuera)).toEqual({ conAvisos: 2, completas: 2, conMetricas: 2 });
    expect(recuentoEnPantalla(posiciones, [])).toEqual({ conAvisos: 1, completas: 3, conMetricas: 3 });
  });

  test("un índice no invertible no entra en el recuento", () => {
    expect(recuentoEnPantalla([posicion("I", { is_investable: false, quality_flags: ["X"] })], [])).toEqual({ conAvisos: 0, completas: 0, conMetricas: 0 });
  });
});

describe("por qué no hay volatilidad", () => {
  test("con todos los pesos a 0 no hay métodos distintos: no hay dato", () => {
    const activos = [
      { asset_id: "A", instrument_type: "FUND", economic_asset_class: "EQUITY", role: "INVESTABLE", is_investable: true, quality_flags: [], metrics: { volatility_3y: 0.1, metrics_frequency: "WEEKLY" } },
      { asset_id: "B", instrument_type: "FUND", economic_asset_class: "EQUITY", role: "INVESTABLE", is_investable: true, quality_flags: [], metrics: { volatility_3y: 0.2, metrics_frequency: "DAILY" } }
    ] as unknown as BdbAssetDetail[];
    const sinPeso = computePortfolioPreviewMetrics({ manualPositions: [{ asset_id: "A", weight_percent: 0 }, { asset_id: "B", weight_percent: 0 }], assets: activos }).metrics;
    expect(estadoDeLaVolatilidad(sinPeso)).toBe("sin_dato");
    const conPeso = computePortfolioPreviewMetrics({ manualPositions: [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }], assets: activos }).metrics;
    expect(estadoDeLaVolatilidad(conPeso)).toBe("metodos_distintos");
  });
});

describe("la comprobación previa de Optimizar no se contradice", () => {
  const conTodo = ["annualized_return_3y", "volatility_3y", "sharpe_3y", "max_drawdown_5y", "max_drawdown_hist", "risk_score"];

  test("una sola lista: cuántas posiciones tienen cada métrica, en el orden de la lectura", () => {
    const fondo = { instrument_type: "FUND", metrics_available: conTodo } as never;
    const sinCaida = { instrument_type: "FUND", metrics_available: conTodo.filter((clave) => clave !== "max_drawdown_5y") } as never;
    expect(metricasPorPosicion([fondo, fondo, sinCaida]).map((m) => `${m.etiqueta} ${m.con}/${m.de}`)).toEqual([
      "Rentabilidad anualizada 3 años 3/3",
      "Volatilidad 3 años 3/3",
      "Sharpe 3 años 3/3",
      "Caída máxima 5 años 2/3",
      "Caída máxima histórica 3/3",
      "Indicador de riesgo 3/3"
    ]);
  });

  test("el Sharpe de una acción no cuenta, ni arriba ni abajo: no se enseña, así que no le falta", () => {
    const accion = { instrument_type: "STOCK", metrics_available: conTodo.filter((clave) => clave !== "sharpe_3y") } as never;
    const fondo = { instrument_type: "FUND", metrics_available: conTodo } as never;
    const sharpe = metricasPorPosicion([accion, fondo]).find((m) => m.clave === "sharpe_3y");
    expect(sharpe).toMatchObject({ con: 1, de: 1 });
    expect(metricasPorPosicion([accion]).some((m) => m.clave === "sharpe_3y")).toBe(false);
  });

  test("«Elegibles» descuenta lo que la simulación deja fuera, y dice por qué", () => {
    const elegible = (asset_id: string) => ({ asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND", economic_asset_class: "EQUITY", weight_percent: 50, metrics_available: [], metrics_missing: [], quality_warnings: [] });
    const preview = { eligible_assets: [elegible("A"), elegible("B")], excluded_assets: [{ asset_id: "C", display_name: "Índice C", weight_percent: 10, reason: "NON_INVESTABLE_BENCHMARK" }] } as never;
    const horizonte = { years: 3, backtest: { excluded_assets: [{ asset_id: "B", reason: "QUALITY_BLOCKED" }] } } as never;
    const motivo = () => "No invertible";
    const sinSimulacion = universoDeLaComprobacion(preview, null, motivo);
    expect(sinSimulacion.elegibles.map((a) => a.asset_id)).toEqual(["A", "B"]);
    expect(sinSimulacion.excluidos).toEqual([{ asset_id: "C", display_name: "Índice C", motivo: "No invertible" }]);
    const conSimulacion = universoDeLaComprobacion(preview, horizonte, motivo);
    expect(conSimulacion.elegibles.map((a) => a.asset_id)).toEqual(["A"]);
    expect(conSimulacion.excluidos.map((a) => a.asset_id)).toEqual(["C", "B"]);
    expect(conSimulacion.excluidos[1].motivo).toBe("Fuera de la simulación a 3 años");
    expect(conSimulacion.excluidos[1].diagnostico).toBeTruthy();
  });

  test("el 0 % de métodos distintos no se dice como si faltara el dato", () => {
    const conLasDos = ["annualized_return_3y", "volatility_3y"];
    expect(avisosDeLaVistaPrevia(["Metricas parciales (0% de la cartera).", "Otro."], conLasDos)).toEqual([
      "Las posiciones usan métodos distintos: el riesgo de la cartera se mide en la simulación.",
      "Otro."
    ]);
    /* Si de verdad falta la volatilidad, el aviso es cierto y se queda. */
    expect(avisosDeLaVistaPrevia(["Metricas parciales (0% de la cartera)."], ["annualized_return_3y"])).toEqual(["Métricas parciales (0 % de la cartera)."]);
    expect(avisosDeLaVistaPrevia(["Metricas parciales (60% de la cartera)."], conLasDos)).toEqual(["Métricas parciales (60 % de la cartera)."]);
  });
});

describe("«Mezcla de divisas sin convertir», solo si queda algo sin convertir", () => {
  const activo = (asset_id: string, currency: string, metrics_method: string) =>
    ({ asset_id, display_name: `Fondo ${asset_id}`, currency, instrument_type: "FUND", role: "INVESTABLE", is_investable: true, quality_flags: [], metrics: { metrics_method } }) as unknown as BdbAssetDetail;
  const pos = (asset_id: string, weight_percent = 50) => ({ asset_id, weight_percent });
  const MEZCLA = "Mezcla de divisas sin convertir.";

  test("una clase en dólares con métricas propias está en euros: no hay aviso", () => {
    const enOtra = cifrasDelProveedorEnOtraDivisa([pos("A")], [activo("A", "USD", "EXTRACTOR_MONTHLY_V2")]);
    expect(enOtra).toEqual([]);
    expect(avisosDeLaVistaPrevia([MEZCLA, "Otro."], [], enOtra)).toEqual(["Otro."]);
    expect(avisosDeComprobar([MEZCLA, "Otro."], undefined, enOtra)).toEqual(["Otro."]);
  });

  test("una cifra del proveedor en euros, tampoco", () => {
    expect(cifrasDelProveedorEnOtraDivisa([pos("A")], [activo("A", "EUR", "TRAILING_PROVIDER")])).toEqual([]);
  });

  test("una cifra del proveedor en otra divisa, sí, y dice cuál", () => {
    const enOtra = cifrasDelProveedorEnOtraDivisa([pos("A"), pos("B")], [activo("A", "USD", "TRAILING_PROVIDER"), activo("B", "EUR", "TRAILING_PROVIDER")]);
    expect(enOtra).toEqual([{ assetId: "A", nombre: "Fondo A", divisa: "USD" }]);
    const aviso = "Cifras del proveedor en otra divisa, sin convertir: Fondo A (USD).";
    expect(avisoDeDivisas(enOtra)).toBe(aviso);
    expect(avisosDeLaVistaPrevia([MEZCLA], [], enOtra)).toEqual([aviso]);
    expect(avisosDeComprobar([MEZCLA], undefined, enOtra)).toEqual([aviso]);
  });

  test("en Análisis sin simulación, tampoco se dice si no queda nada sin convertir", () => {
    expect(avisosDePantalla([MEZCLA, "Otro."], undefined, undefined, [])).toEqual(["Otro."]);
    const enOtra = [{ assetId: "A", nombre: "Fondo A", divisa: "USD" }];
    expect(avisosDePantalla([MEZCLA], undefined, undefined, enOtra)).toEqual(["Cifras del proveedor en otra divisa, sin convertir: Fondo A (USD)."]);
    /* Con simulación, sus cifras están en euros; pero «Volatilidad sola» sigue leyendo la del proveedor. */
    expect(avisosDePantalla([MEZCLA], undefined, 88, enOtra)).toEqual(["Cifras del proveedor en otra divisa, sin convertir: Fondo A (USD)."]);
    expect(avisosDePantalla([MEZCLA], undefined, 88, [])).toEqual([]);
  });

  test("una posición sin peso no cuenta", () => {
    expect(cifrasDelProveedorEnOtraDivisa([pos("A", 0)], [activo("A", "USD", "TRAILING_PROVIDER")])).toEqual([]);
  });

  test("Comprobar dice lo mismo que Optimizar sobre el 0 % de métodos distintos", () => {
    expect(avisosDeComprobar(["Metricas parciales (0% de la cartera)."], { volatility_comparable: false })).toEqual([
      "Las posiciones usan métodos distintos: el riesgo de la cartera se mide en la simulación."
    ]);
    expect(avisosDeComprobar(["Metricas parciales (60% de la cartera)."], { volatility_comparable: true })).toEqual(["Métricas parciales (60 % de la cartera)."]);
  });
});

describe("la simulación se dice igual en el título y en Estado", () => {
  const horizonte = (extra: Record<string, unknown> = {}) =>
    ({
      referenceVersion: "x",
      extensions: [],
      coverageWeightPercent: 88,
      backtest: {
        asset_ids: ["A", "B", "C", "D", "E", "F", "G"],
        excluded_assets: [{ asset_id: "H", reason: "QUALITY_BLOCKED" }],
        coverage: { requested_assets: 8, first_date: "2023-10-20", last_date: "2026-10-23" }
      },
      ...extra
    }) as unknown as PortfolioHorizon;

  test("la cobertura: activos y peso", () => {
    expect(coberturaDeLaSimulacion(horizonte())).toBe("7 de 8 activos · 88,0\u00a0% del peso");
  });

  test("la línea bajo el título, sin fecha de ordenador", () => {
    expect(procedenciaDeLaSimulacion(horizonte())).toBe("Simulación con los pesos de hoy · del 20/10/2023 al 23/10/2026 · 7 de 8 activos · 88,0\u00a0% del peso");
  });

  test("con tramos estimados, lo dice", () => {
    expect(procedenciaDeLaSimulacion(horizonte({ extensions: [{ assetId: "A" }] }))).toContain("histórico ampliado");
  });

  test("con datos de muestra, no se dice simulación con los pesos de hoy", () => {
    const linea = procedenciaDeLaSimulacion(horizonte({ referenceVersion: "demo-synthetic.v1" }));
    expect(linea).toContain("Datos de muestra");
    expect(linea).not.toContain("pesos de hoy");
  });

  test("la nota no repite el peso medido donde ya está bajo el título", () => {
    expect(notaDeLaSimulacion(horizonte())).toContain("Peso medido: 88,0\u00a0%.");
    expect(notaDeLaSimulacion(horizonte(), { sinCobertura: true })).not.toContain("Peso medido");
  });
});

describe("los avisos de la cartera", () => {
  const avisos = ["Metricas parciales (0% de la cartera).", "Mezcla de divisas sin convertir.", "Otro aviso."];

  test("el 0 % de métodos distintos no se enseña: se enseña la cobertura medida", () => {
    expect(avisosDePantalla(avisos, { volatility_comparable: false }, 88)).toEqual(["Métricas medidas sobre el 88,0\u00a0% de la cartera.", "Otro aviso."]);
  });

  test("sin medida todavía, el 0 % tampoco, y la mezcla de divisas se queda", () => {
    expect(avisosDePantalla(avisos, { volatility_comparable: false }, undefined)).toEqual(["Mezcla de divisas sin convertir.", "Otro aviso."]);
  });

  test("unas métricas parciales de verdad se quedan, con su tilde", () => {
    expect(avisosDePantalla(["Metricas parciales (60% de la cartera)."], { volatility_comparable: true }, undefined)).toEqual(["Métricas parciales (60 % de la cartera)."]);
  });
});

describe("Comprobar no cuenta como faltante lo que a una acción no le aplica (decisión 83)", () => {
  const accion = { instrument_type: "STOCK", metrics_available: ["annualized_return_3y", "volatility_3y"] } as Parameters<typeof metricasPorPosicion>[0][number];
  const fondo = { instrument_type: "FUND", metrics_available: ["annualized_return_3y", "volatility_3y", "sharpe_3y", "risk_score"] } as Parameters<typeof metricasPorPosicion>[0][number];

  test("con una acción y un fondo, el indicador es de 1 de 1, no de 1 de 2", () => {
    const indicador = metricasPorPosicion([accion, fondo]).find((m) => m.clave === "risk_score");
    expect(indicador).toMatchObject({ con: 1, de: 1 });
  });

  test("con solo acciones, ni está ni falta; la rentabilidad sigue contando", () => {
    const lista = metricasPorPosicion([accion]);
    expect(lista.some((m) => m.clave === "risk_score")).toBe(false);
    expect(lista.find((m) => m.clave === "annualized_return_3y")).toMatchObject({ con: 1, de: 1 });
  });

  test("a un fondo sin él sí le falta", () => {
    const sinIndicador = { ...fondo, metrics_available: ["annualized_return_3y"] };
    expect(metricasPorPosicion([sinIndicador]).find((m) => m.clave === "risk_score")).toMatchObject({ con: 0, de: 1 });
  });
});
