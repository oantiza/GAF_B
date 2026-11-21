import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { PortfolioHorizon } from "../src/adapters/portfolioHorizon";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { SaludYControl } from "../src/components/SaludYControl";
import { checkPortfolioFeasibility } from "../src/core/portfolioConstraints";
import { evaluatePortfolioHealth } from "../src/core/portfolioHealth";
import { leerSaludYControl, type EntradaDeSalud } from "../src/core/saludYControl";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

/* La cartera de muestra de la auditoría, reducida: un fondo fuera de la serie por calidad del dato y
   otro que aporta más riesgo que peso. Cifras de resultado conocido. */
const activo = (id: string, nombre: string, clase = "EQUITY"): BdbAssetDetail =>
  ({ asset_id: id, display_name: nombre, instrument_type: "FUND", economic_asset_class: clase, is_investable: true, role: "INVESTABLE", quality_flags: [], metrics: { volatility_3y: 0.1 } }) as unknown as BdbAssetDetail;

const assets = [
  activo("ISHARES", "iShares Core MSCI World"),
  activo("VANGUARD", "Vanguard S&P 500"),
  activo("BONOS", "Bonos Euro", "FIXED_INCOME"),
  activo("CREDITO", "Crédito Euro", "FIXED_INCOME"),
  activo("MIXTO", "Mixto Global", "MIXED"),
  activo("ISHARES2", "Otro de renta variable"),
  activo("VANGUARD2", "Y otro de renta variable")
];
const positions: BdbManualPortfolioPosition[] = [
  { asset_id: "ISHARES", weight_percent: 24 },
  { asset_id: "VANGUARD", weight_percent: 12 },
  { asset_id: "BONOS", weight_percent: 20 },
  { asset_id: "CREDITO", weight_percent: 20 },
  { asset_id: "MIXTO", weight_percent: 24 }
];

const horizonte = (cobertura: number, aportaciones: { asset_id: string; weight_pct: number; risk_pct: number }[] | null = []) =>
  ({
    window: "3Y",
    years: 3,
    referenceVersion: "test",
    coverageWeightPercent: cobertura,
    extensions: [],
    frontier: aportaciones === null ? null : { riskContributions: aportaciones },
    frontierUnavailableReason: aportaciones === null ? "La frontera necesita al menos dos activos." : undefined,
    backtest: {
      asset_ids: ["ISHARES", "BONOS", "MIXTO"],
      excluded_assets: cobertura < 100 ? [{ asset_id: "VANGUARD", reason: "QUALITY_BLOCKED" }] : [],
      metrics: { cagr: 0.1192, volatility: 0.0776, sharpe: 1.18, max_drawdown: -0.1135, rf_rate: 0.028 },
      coverage: { first_date: "2023-10-20", last_date: "2026-10-23" }
    }
  }) as unknown as PortfolioHorizon;

const feasibility = checkPortfolioFeasibility({ positions: positions.filter((p) => p.asset_id !== "NADA"), assets });

function leer(entrada: Partial<EntradaDeSalud> & { riesgoMedido?: boolean }) {
  const h = entrada.horizonte === undefined ? horizonte(88) : entrada.horizonte;
  const posiciones = entrada.positions ?? positions;
  const salud = evaluatePortfolioHealth({
    positions: posiciones,
    assets,
    riskContributions: h?.frontier?.riskContributions,
    riesgoMedido: entrada.midiendo ? undefined : entrada.riesgoMedido ?? true
  });
  return leerSaludYControl({ positions: posiciones, assets, feasibility, salud, midiendo: false, ...entrada, horizonte: h });
}

const fila = (lectura: ReturnType<typeof leer>, rotulo: string) => lectura.filas.find((item) => item.rotulo === rotulo);

describe("el titular son hechos, sin adjetivo", () => {
  test("sin alertas dice sobre cuánto se ha medido, y nombra lo que se queda fuera", () => {
    const lectura = leer({});
    expect(lectura.titular).toBe("Sin alertas en lo medido · 88,0\u00a0% del peso");
    expect(lectura.estado).toBe("sin-alertas");
    expect(lectura.fuera).toHaveLength(1);
    expect(lectura.fuera[0]).toMatchObject({ nombre: "Vanguard S&P 500", pesoPct: 12, porCalidad: true });
  });

  test("la contribución al riesgo cuenta desde la primera medición, no al abrir otra pestaña", () => {
    const lectura = leer({ horizonte: horizonte(88, [
      { asset_id: "ISHARES", weight_pct: 27.27, risk_pct: 44.48 },
      { asset_id: "BONOS", weight_pct: 45.45, risk_pct: 25.52 },
      { asset_id: "MIXTO", weight_pct: 27.28, risk_pct: 30 }
    ]) });
    expect(lectura.titular).toBe("1 alerta en lo medido · 88,0\u00a0% del peso");
    expect(lectura.alertas).toHaveLength(1);
    /* «De la parte medida»: el 27,3 % choca con el 24 % de la tabla si no se dice de qué es. */
    expect(lectura.alertas[0].texto).toBe("iShares Core MSCI World aporta 44,5\u00a0% del riesgo con 27,3\u00a0% de la parte medida.");
    expect(lectura.alertas[0].umbral).toBe("Aviso si una posición aporta más del 40 % del riesgo");
    expect(fila(lectura, "Mayor aportación al riesgo")).toMatchObject({ cifra: "44,5\u00a0%", revisar: true });
  });

  test("con menos del 80 % medido, a revisar y por qué (decisión 20)", () => {
    const lectura = leer({ horizonte: horizonte(79.6) });
    expect(lectura.estado).toBe("a-revisar");
    expect(lectura.titular).toBe("A revisar · solo se ha medido el 79,6\u00a0% del peso");
    expect(lectura.porQue).toContain("Por debajo del 80 %");
    expect(fila(lectura, "Peso medido")).toMatchObject({ cifra: "79,6\u00a0%", revisar: true });
  });

  test("con el 80 % justo se da por medido: el umbral no se mueve", () => {
    const lectura = leer({ horizonte: horizonte(80) });
    expect(lectura.titular).toBe("Sin alertas en lo medido · 80,0\u00a0% del peso");
  });

  test("mientras se mide no hay aprobado, y lo que ya se sabe se dice", () => {
    expect(leer({ horizonte: null, midiendo: true }).titular).toBe("Midiendo el riesgo");
    const concentrada = [{ asset_id: "ISHARES", weight_percent: 45 }, { asset_id: "BONOS", weight_percent: 55 }];
    expect(leer({ horizonte: null, midiendo: true, positions: concentrada }).titular).toBe("2 alertas · midiendo el riesgo");
  });

  test("sin simulación no hay aprobado: la suma ponderada ya no se da por medida (decisión 36)", () => {
    const sinRiesgo = leer({ horizonte: null, riesgoMedido: false });
    expect(sinRiesgo.estado).toBe("a-revisar");
    expect(sinRiesgo.titular).toBe("A revisar · el riesgo de la cartera no está medido");
    expect(JSON.stringify(sinRiesgo)).not.toMatch(/composición|estimad/i);
  });

  test("mientras se mide, la volatilidad dice «Midiendo…», sin una cifra que luego cambie", () => {
    const lectura = leer({ horizonte: null, midiendo: true });
    expect(fila(lectura, "Volatilidad")).toEqual({ rotulo: "Volatilidad", cifra: "Midiendo…", revisar: false });
  });

  test("por debajo del 80 % la volatilidad falta, con cuánto se ha medido", () => {
    const lectura = leer({ horizonte: horizonte(40), riesgoMedido: false });
    expect(fila(lectura, "Volatilidad")).toMatchObject({ ausencia: "falta", nota: "La simulación mide el 40,0\u00a0% del peso; hace falta al menos el 80 %.", revisar: false });
    expect(fila(lectura, "Volatilidad")?.cifra).toBeUndefined();
    expect(lectura.titular).toBe("A revisar · solo se ha medido el 40,0\u00a0% del peso");
  });

  test("el corte: con 79,9 falta, con 80 hay cifra", () => {
    expect(fila(leer({ horizonte: horizonte(79.9), riesgoMedido: false }), "Volatilidad")?.ausencia).toBe("falta");
    expect(fila(leer({ horizonte: horizonte(80) }), "Volatilidad 3 años")).toMatchObject({ cifra: "7,76\u00a0%" });
  });

  test("un 80 % justo en coma flotante: «80 %», con cifra y sin «Revisar»", () => {
    const lectura = leer({ horizonte: horizonte(79.99999999999999) });
    expect(fila(lectura, "Peso medido")).toMatchObject({ cifra: "80,0\u00a0%", revisar: false });
    expect(fila(lectura, "Volatilidad 3 años")).toMatchObject({ cifra: "7,76\u00a0%" });
  });

  test("con 0 % no es un fallo: el peso medido es 0 % y reintentar no lo arregla", () => {
    const lectura = leer({ horizonte: null, riesgoMedido: false, sinSerie: true });
    expect(lectura.estado).toBe("a-revisar");
    expect(lectura.titular).toBe("A revisar · no se ha medido ninguna posición");
    expect(lectura.porQue).toContain("no mide ninguna posición");
    expect(lectura.porQue).not.toContain("reintentar");
    expect(fila(lectura, "Peso medido")).toMatchObject({ cifra: "0,0\u00a0%", revisar: true });
    expect(fila(lectura, "Volatilidad")?.ausencia).toBe("falta");
  });

  test("con todos los pesos a 0 no dice que haya fallado nada", () => {
    const posicionesSinPeso = [{ asset_id: "ISHARES", weight_percent: 0 }, { asset_id: "BONOS", weight_percent: 0 }];
    const lectura = leer({ horizonte: null, riesgoMedido: false, positions: posicionesSinPeso });
    expect(lectura.titular).toBe("A revisar · el riesgo de la cartera no está medido");
    expect(lectura.porQue).toBe("Ninguna posición tiene peso.");
    expect(fila(lectura, "Peso medido")?.nota).toBe("Ninguna posición tiene peso.");
  });
});

describe("cada fila con su medida y su umbral, sin A, OK, Baja ni Alta", () => {
  test("las filas de la decisión 18", () => {
    const lectura = leer({});
    expect(fila(lectura, "Mayor posición")).toEqual({ rotulo: "Mayor posición", cifra: "24,0\u00a0%", nota: "vigilar desde 25 %", revisar: false });
    expect(fila(lectura, "Diversificación")).toMatchObject({ cifra: "3 clases · 5 posiciones", revisar: false });
    expect(fila(lectura, "Volatilidad 3 años")).toMatchObject({ cifra: "7,76\u00a0%", revisar: false });
    expect(fila(lectura, "Peso medido")).toMatchObject({ cifra: "88,0\u00a0%", nota: "12,0\u00a0% fuera del cálculo; a revisar por debajo del 80 %", revisar: false });
    expect(fila(lectura, "Restricciones")).toMatchObject({ cifra: "Se cumplen", nota: "Que los pesos sumen 100 % y que cada activo exista y sea invertible.", revisar: false });
    for (const item of lectura.filas) expect(item.cifra ?? "").not.toMatch(/^(A|B|C|OK|Baja|Media|Alta)$/);
  });

  test.each([
    [24, "vigilar desde 25 %", false],
    [25, "vigilar si pasa del 25 %", false],
    [30, "vigilar: pasa del 25 %; crítico si pasa del 40 %", true],
    [40, "vigilar: pasa del 25 %; crítico si pasa del 40 %", true],
    [45, "crítico: pasa del 40 %", true]
  ])("una posición del %s %% lee el umbral de 25 y 40, y las fronteras exactas no disparan", (peso, nota, revisar) => {
    /* El resto, en diez posiciones pequeñas: la mayor es la que se prueba. */
    const resto = Array.from({ length: 10 }, (_, i) => ({ asset_id: `R${i}`, weight_percent: (100 - peso) / 10 }));
    const lectura = leer({ positions: [{ asset_id: "ISHARES", weight_percent: peso }, ...resto] });
    expect(fila(lectura, "Mayor posición")).toMatchObject({ nota, revisar });
  });

  test("los umbrales se dicen en palabras, no en códigos", () => {
    const lectura = leer({ positions: [{ asset_id: "ISHARES", weight_percent: 45 }, { asset_id: "BONOS", weight_percent: 30 }, { asset_id: "MIXTO", weight_percent: 25 }] });
    const umbrales = lectura.alertas.map((alerta) => alerta.umbral);
    expect(umbrales).toContain("Crítico si una posición pesa más del 40 %");
    expect(umbrales).toContain("Aviso si una posición pesa más del 25 %");
    expect(umbrales.join(" ")).not.toMatch(/WARN|FAIL/);
    expect(lectura.alertas.find((alerta) => alerta.palabra === "Crítico")?.texto).toContain("iShares Core MSCI World");
  });

  test("un solo activo medido no tiene reparto del riesgo: no aplica, no falta", () => {
    const uno = { ...horizonte(100, null), backtest: { ...horizonte(100, null).backtest, asset_ids: ["ISHARES"] } } as unknown as PortfolioHorizon;
    expect(fila(leer({ horizonte: uno }), "Mayor aportación al riesgo")).toMatchObject({ ausencia: "no-aplica" });
    expect(fila(leer({ horizonte: horizonte(100, null) }), "Mayor aportación al riesgo")).toMatchObject({ ausencia: "falta", nota: "La frontera necesita al menos dos activos." });
  });
});

describe("una sola lectura de la misma posición", () => {
  test("con la suma en 70 %, la fila y la alerta miden sobre lo asignado, y dicen también el peso escrito (A-164)", () => {
    /* iShares 40 + Bonos 30: 40 / 70 = 57,1 % de lo asignado, que pasa del 40 % y es crítico. Antes la fila y la
       alerta leían el 40 escrito, un aviso; y antes de eso, cada una una cifra. Ahora las dos, la misma. */
    const lectura = leer({ positions: [{ asset_id: "ISHARES", weight_percent: 40 }, { asset_id: "BONOS", weight_percent: 30 }] });
    expect(fila(lectura, "Mayor posición")).toMatchObject({ cifra: "57,1\u00a0%", nota: "40,0\u00a0% escrito, sobre lo asignado; crítico: pasa del 40 %", revisar: true });
    const alerta = lectura.alertas.find((candidata) => candidata.clave.startsWith("POSITION_WEIGHT"))!;
    expect(alerta.palabra).toBe("Crítico");
    /* Bonos, 30 / 70 = 42,9 %, también pasa. */
    expect(lectura.alertas.filter((candidata) => candidata.clave.startsWith("POSITION_WEIGHT"))).toHaveLength(2);
  });

  test("con la suma en 100 % no cambia nada: la cifra es el peso escrito y la nota no añade nada", () => {
    const lectura = leer({ positions: [{ asset_id: "ISHARES", weight_percent: 40 }, { asset_id: "BONOS", weight_percent: 30 }, { asset_id: "VANGUARD", weight_percent: 30 }] });
    expect(fila(lectura, "Mayor posición")).toMatchObject({ cifra: "40,0\u00a0%", nota: "vigilar: pasa del 25 %; crítico si pasa del 40 %", revisar: true });
  });

  test("una clase con peso 0 no diversifica", () => {
    const lectura = leer({ positions: [{ asset_id: "ISHARES", weight_percent: 100 }, { asset_id: "BONOS", weight_percent: 0 }] });
    expect(fila(lectura, "Diversificación")).toMatchObject({ cifra: "1 clase · 2 posiciones", nota: "vigilar con menos de 2 clases", revisar: true });
  });
});

describe("el titular cuenta lo que se pinta «Revisar»", () => {
  const unaClase = [
    { asset_id: "ISHARES", weight_percent: 25 },
    { asset_id: "VANGUARD", weight_percent: 25 },
    { asset_id: "ISHARES2", weight_percent: 25 },
    { asset_id: "VANGUARD2", weight_percent: 25 }
  ];

  test("«Sin alertas» no va encima de una fila en «Revisar»", () => {
    const lectura = leer({ positions: unaClase, horizonte: horizonte(100) });
    expect(fila(lectura, "Diversificación")?.revisar).toBe(true);
    expect(lectura.alertas).toHaveLength(0);
    expect(lectura.titular).toBe("1 alerta en lo medido · 100,0\u00a0% del peso");
    expect(lectura.estado).toBe("con-alertas");
  });

  test("la mayor posición no cuenta dos veces: ya está en la lista de alertas con su nombre", () => {
    const lectura = leer({ positions: [{ asset_id: "ISHARES", weight_percent: 30 }, { asset_id: "BONOS", weight_percent: 35 }, { asset_id: "MIXTO", weight_percent: 35 }], horizonte: horizonte(100) });
    expect(lectura.alertas).toHaveLength(3);
    expect(lectura.titular).toBe("3 alertas en lo medido · 100,0\u00a0% del peso");
  });
});

describe("por qué no hay riesgo", () => {
  test("un fallo se dice sin hablar de ninguna estimación: la misma lectura en pantalla y en el informe interno (decisión 59)", () => {
    const lectura = leer({ horizonte: null, riesgoMedido: false, medicionFallida: true });
    expect(lectura.titular).toBe("A revisar · la simulación ha fallado");
    expect(lectura.porQue).toBe("Es un fallo al calcularla, no de los datos: se puede reintentar.");
    expect(fila(lectura, "Peso medido")?.nota).toBe("La simulación ha fallado: se puede reintentar.");
    expect(fila(lectura, "Volatilidad")?.nota).toBe("La simulación ha fallado: se puede reintentar.");
    expect(JSON.stringify(lectura)).not.toMatch(/composición|estimad/i);
  });

  test("las restricciones hablan como la pantalla: un activo que no existe no está «en la fuente de datos activa»", () => {
    const posiciones = [{ asset_id: "ISHARES", weight_percent: 90 }, { asset_id: "XX0000000000", weight_percent: 10 }];
    const lectura = leer({ positions: posiciones, feasibility: checkPortfolioFeasibility({ positions: posiciones, assets }) });
    const detalle = fila(lectura, "Restricciones")?.detalle?.join(" ") ?? "";
    expect(detalle).toContain("XX0000000000 no está en el catálogo.");
    expect(detalle).not.toContain("fuente de datos");
  });
});

describe("cómo se pinta", () => {
  const pinta = (clientMode: boolean, lectura = leer({})) =>
    renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: clientMode, children: createElement(SaludYControl, { lectura }) }));

  test("el titular es un veredicto, no un título: el título es el de la sección", () => {
    const html = pinta(false);
    /* Rediseño: el bloque se llama como pregunta lo que contesta, «Qué conviene mirar» (maqueta de Análisis). */
    expect(html).toMatch(/<h2[^>]*>\s*Qué conviene mirar/);
    expect(html).toContain("Sin alertas en lo medido");
    expect(html).not.toContain("saludable");
    expect(html).not.toContain("Cartera a revisar");
  });

  test("lo que se queda fuera se dice en los dos modos; el motivo, solo al asesor", () => {
    const frase = "fuera de la simulación con la que se mide la cartera";
    expect(pinta(false)).toContain(frase);
    expect(pinta(true)).toContain(frase);
    expect(pinta(false)).toContain("Motivo: bloqueado por calidad del dato.");
    expect(pinta(true)).not.toContain("Motivo");
  });
});
