import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { buildManualPortfolioReport, buildManualPortfolioSummary, getComparableAssets } from "../src/adapters/bdbAssetsAdapter";
import { OptimizationPreviewPanel } from "../src/components/OptimizationPreviewPanel";
import { PortfolioConstraintsPanel } from "../src/components/PortfolioConstraintsPanel";
import { PortfolioReport } from "../src/components/PortfolioReport";
import { ComposicionSubyacente, MayoresAcciones, PortfolioXray } from "../src/components/PortfolioXray";
import { buildLocalOptimizationPreview } from "../src/core/optimizationPreview";
import { checkPortfolioFeasibility } from "../src/core/portfolioConstraints";

/**
 * Modo cliente en Informes, Análisis y Optimizar (auditoría 16-10-2026, ALTA-14; decisiones 19 y 25).
 *
 * El diagnóstico de datos (comprobaciones, señales, avisos de calidad, notas de
 * «lectura local») es del asesor y no existe en modo cliente. Y la pantalla Informes
 * ya no pinta nada de eso: es la lista de documentos de la cartera.
 */
const POSITIONS = [
  { asset_id: "MOCK-FUND-MIXED", weight_percent: 40 },
  { asset_id: "MOCK-ETF-CASH", weight_percent: 20 },
  { asset_id: "MOCK-STOCK-TECH", weight_percent: 40 }
];

function render(node: ReactNode, clientMode: boolean): string {
  return renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: clientMode, children: node }));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

async function fixtures() {
  const report = await buildManualPortfolioReport(POSITIONS, "Cartera prueba");
  const assets = await getComparableAssets(POSITIONS.map((position) => position.asset_id));
  const summary = await buildManualPortfolioSummary(POSITIONS);
  const preview = buildLocalOptimizationPreview({ sourceKind: report.mode, positions: POSITIONS, assets, summary });
  const feasibility = checkPortfolioFeasibility({ positions: POSITIONS, assets });
  return { report, assets, preview, feasibility };
}

describe("modo cliente: sin diagnóstico de datos en Análisis ni en Optimizar", () => {
  test("Radiografía: sin «Señales de datos»", async () => {
    const { report } = await fixtures();
    const props = { xray: report.xray };
    const advisor = render(createElement(PortfolioXray, props), false);
    expect(advisor).toContain("Señales de datos");
    expect(advisor).not.toContain("xray-dist-grid--single");
    const client = render(createElement(PortfolioXray, props), true);
    // Queda una sola lista en el bloque secundario: a todo el ancho.
    expect(client).toContain("xray-dist-grid--single");
    expect(client).not.toContain("Señales de datos");
    expect(client).not.toContain("lectura local");
    expect(client).toContain("Concentración por posición");
  });

  test("Restricciones de la cartera: solo para el asesor (decisión 6.13)", async () => {
    const { feasibility } = await fixtures();
    const advisor = render(createElement(PortfolioConstraintsPanel, { feasibility }), false);
    expect(advisor).toContain("Restricciones de la cartera");
    expect(advisor).toContain("Comprueba pesos");
    expect(render(createElement(PortfolioConstraintsPanel, { feasibility }), true)).toBe("");
  });

  test("Optimizar: sin métricas por posición ni avisos de calidad o de cartera, y con su frase de que no es el cálculo", async () => {
    const { preview } = await fixtures();
    const advisor = render(createElement(OptimizationPreviewPanel, { preview }), false);
    const client = render(createElement(OptimizationPreviewPanel, { preview }), true);
    for (const text of ["Métricas por posición", "Avisos de calidad", "Avisos de cartera"]) {
      expect(advisor).toContain(text);
      expect(client).not.toContain(text);
    }
    expect(client).toContain("Activos elegibles");
    /* Lo que hace falta para leerla bien se queda siempre: no es la cocina. */
    for (const html of [advisor, client]) {
      expect(html).toContain("No es el cálculo de la optimización");
      expect(html).not.toContain("Fuente de datos");
      expect(html).not.toContain("Vista previa");
    }
  });

  test("Informes: cada documento con su público, y lo de uso interno no existe en Modo cliente", async () => {
    const { report, feasibility } = await fixtures();
    const props = { report, feasibility, totalCapital: 100000 };
    const advisor = render(createElement(PortfolioReport, props), false);
    const client = render(createElement(PortfolioReport, props), true);
    /* Desde el 21-11-2026 (I2) para quién es cada documento lo dice su grupo: «Para el cliente», una vez, e «Internos». */
    for (const documento of ["Informe de la propuesta", "Costes de la propuesta", "Comparativa de propuestas", "Propuesta de cambio"]) {
      expect(advisor).toContain(documento);
      expect(client).toContain(documento);
    }
    expect(count(client, "Para el cliente")).toBe(1);
    for (const documento of ["Propuesta de mejora", "Informe interno del asesor", "Internos", "distintivo--interno", "retrocesiones"]) {
      expect(advisor).toContain(documento);
      expect(client).not.toContain(documento);
    }
  });

  test("Informes: la falsa vista previa ya no está, ni su marca, ni lo que se pintaba en ella", async () => {
    const { report, feasibility } = await fixtures();
    const html = render(createElement(PortfolioReport, { report, feasibility }), false);
    for (const texto of ["Vista previa", "BDB", "Fundamental Intelligence", "PDF de cliente", "Estructura de la cartera", "Composición subyacente", "Posiciones de la cartera", "Solo asesor", "Factibilidad multi-activo", "Señales de datos"]) {
      expect(html).not.toContain(texto);
    }
    expect(html).toContain("Los documentos que se pueden entregar de esta propuesta");
    /* Rediseño: los datos de los documentos van en la pieza `Campo`. La firma (nombre, entidad, contacto) ya no se escribe aquí:
       se enseña en una línea, «Firma de los informes», con «Cambiar»; «Elaborado por» y el correo desaparecen de la fila. */
    const rotulos = [...html.matchAll(/class="field__label"[^>]*>([^<]+)</g)].map(([, rotulo]) => rotulo);
    for (const campo of ["Nombre de la propuesta", "Capital", "Preparado para (opcional)", "Cartera de referencia", "Periodo"]) {
      expect(rotulos).toContain(campo);
    }
    for (const campo of ["Elaborado por", "Correo del responsable"]) expect(rotulos).not.toContain(campo);
    expect(html).toContain("Firma de los informes");
  });

  test("Informes: sin nombre, «Cartera sin nombre» solo en pantalla", async () => {
    const report = await buildManualPortfolioReport(POSITIONS);
    const { feasibility } = await fixtures();
    const html = render(createElement(PortfolioReport, { report, feasibility, portfolioName: "" }), false);
    /* Un campo vacío no enseña un valor de ejemplo que parezca rellenado: sin «placeholder». El «sin nombre» lo dice la cabecera. */
    expect(html).not.toContain('placeholder="Cartera sin nombre"');
    expect(html).toContain("Propuesta · sin nombre");
    expect(html).not.toContain(`value="${report.portfolio_name}"`);
  });

  test("Informes sin capital: lo dice, y ningún documento se queda sin salir por eso", async () => {
    const { report, feasibility } = await fixtures();
    const html = render(createElement(PortfolioReport, { report, feasibility, onIrADiseno: () => undefined }), false);
    expect(html).toContain("Capital sin fijar");
    expect(html).toContain("Fijar en Diseño");
    expect(html).toContain("Capital sin fijar: el informe saldrá en porcentajes.");
    expect(html).toContain("Capital sin fijar: el informe saldrá sin importes.");
    expect(html).not.toContain("Falta fijar el capital");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\s*Descargar informe de costes/);
    const conCapital = render(createElement(PortfolioReport, { report, feasibility, totalCapital: 250000 }), false);
    expect(conCapital).not.toContain("Capital sin fijar");
    expect(conCapital).not.toContain("saldrá en porcentajes");
    /* Un importe en un dato, con sus dos decimales (apartado 6). */
    expect(conCapital).toMatch(/250\.000,00\s€/);
  });

  test("Informes: lo que le falta a cada documento", async () => {
    const { report, feasibility } = await fixtures();
    const html = render(createElement(PortfolioReport, { report, feasibility, totalCapital: 100000 }), false);
    expect(html).toContain("Con los datos de muestra no hay histórico que comparar.");
    expect(html).toContain("Falta calcularla en Diseño, en Optimizar.");
    const enVivo = { ...report, mode: "BBDD_LIVE_API" as const };
    const sinCarteras = render(createElement(PortfolioReport, { report: enVivo, feasibility, totalCapital: 100000, savedPortfolios: [] }), false);
    expect(sinCarteras).toContain("Faltan dos carteras guardadas.");
    const dos = [{ portfolio_id: "a", sourceKind: "BBDD_LIVE_API" }, { portfolio_id: "b", sourceKind: "BBDD_LIVE_API" }] as never[];
    const conDos = render(createElement(PortfolioReport, { report: enVivo, feasibility, totalCapital: 100000, savedPortfolios: dos }), false);
    expect(conDos).not.toContain("Faltan dos carteras guardadas.");
    const conDosCliente = render(createElement(PortfolioReport, { report: enVivo, feasibility, totalCapital: 100000, savedPortfolios: dos }), true);
    expect(conDosCliente).toContain("sal de Modo cliente para elegirlas");
  });

  test("La estructura ya no lleva dentro la composición subyacente: va aparte, al final", async () => {
    const { report } = await fixtures();
    const html = render(createElement(PortfolioXray, { xray: report.xray }), false);
    expect(html).not.toContain("Composición subyacente");
    expect(html).not.toContain("Clase económica");
    expect(html).toContain("<h3>Producto</h3>");
    expect(html).toContain("<h3>Categoría</h3>");
  });

  test("La composición subyacente es la tabla del sistema, con las cifras a la derecha", () => {
    const lookThrough = {
      rows: [
        { key: "a", name: "NVIDIA Corp.", identifier: "US67066G1040", weight_percent: 2.57, fund_count: 3 },
        { key: "b", name: "CDX IG46 5Y ICE", identifier: null, weight_percent: 2.89, fund_count: 1 },
        { key: "c", name: "Iberdrola S.A.", identifier: "ES0144580Y14", weight_percent: 1.5, direct_weight_percent: 1, fund_count: 2 }
      ],
      fund_positions: 8,
      covered_funds: 8,
      direct_positions: 1,
      seen_weight_percent: 74.9,
      fund_portfolios: [{ asset_id: "IE00B4L5Y983", display_name: "iShares", lines: 10, published_weight_percent: 26.6, sufficient: false }],
      warnings: []
    } as never;
    const html = render(createElement(ComposicionSubyacente, { lookThrough }), false);
    expect(html).toContain('class="tabla tabla--activos"');
    expect(html).toContain("tabla__celda--cifra");
    expect(html).toContain("2,6\u00a0%");
    /* Una pata de derivado no tiene ISIN: no es un dato que nos falte, y no es un N/D. */
    expect(html).toContain("Sin identificador");
    expect(html).not.toContain("N/D");
    /* De dónde sale cada línea y qué se ha mirado, sacado del dato. */
    expect(html).toContain("Directa + 2 fondos");
    expect(html).toContain("3 fondos");
    expect(html).toContain("8 de 8 fondos publican cartera, uno de ellos menos de la mitad y 1 acción en directo. Se ha mirado el 74,9\u00a0% del peso de la cartera.");
  });

  test("La composición subyacente dice que sus pesos son brutos y no suma las patas", () => {
    const lookThrough = {
      rows: [{ key: "a", name: "EUROPEAN MONETARY UNION EURO Purchased", weight_percent: 6.07, fund_count: 1 }],
      fund_positions: 1,
      covered_funds: 1,
      direct_positions: 0,
      seen_weight_percent: 100,
      fund_portfolios: [],
      warnings: []
    } as never;
    const html = render(createElement(ComposicionSubyacente, { lookThrough }), false);
    expect(html).toContain("Pesos brutos, incluye derivados");
    expect(html).toContain("Además, derivados y divisa de los fondos: no se suman porque son importes nominales, no inversión directa.");
  });

  describe("Mayores acciones de la cartera", () => {
    const conAcciones = (equities: Record<string, unknown>) =>
      ({
        rows: [],
        equities: { rows: [], identified_weight_percent: 0, equity_exposure_percent: 0, unclassified_funds: [], ...equities },
        fund_positions: 8,
        covered_funds: 8,
        direct_positions: 0,
        seen_weight_percent: 82.1,
        fund_portfolios: [{ asset_id: "IE00B4L5Y983", display_name: "iShares", lines: 10, published_weight_percent: 26.6, sufficient: false }],
        warnings: []
      }) as never;
    const CON_DATO = conAcciones({
      rows: [{ key: "isin:US67066G1040", name: "NVIDIA Corp.", identifier: "US67066G1040", weight_percent: 2.57, fund_count: 3, source_asset_ids: [] }],
      identified_weight_percent: 32.15,
      equity_exposure_percent: 54.2
    });

    test("se enseña también en Modo cliente, con la nota y lo que se ha visto", () => {
      for (const modoCliente of [false, true]) {
        const html = render(createElement(MayoresAcciones, { lookThrough: CON_DATO }), modoCliente);
        expect(html).toContain("Mayores acciones de la cartera");
        expect(html).toContain("NVIDIA Corp.");
        expect(html).toContain("2,6\u00a0%");
        expect(html).toContain("Excluye derivados, divisa y efectivo; la renta fija se lee en Exposición agregada.");
        expect(html).toContain("Las acciones identificadas suman el 32,2\u00a0% de la cartera, que tiene un 54,2\u00a0% en renta variable.");
        expect(html).toContain("Se ha mirado el 82,1\u00a0% del peso de la cartera.");
      }
    });

    test("sin código en algún fondo, al cliente no se le enseña y al asesor se le dice cuál", () => {
      const sinCodigo = conAcciones({ unclassified_funds: ["Amundi Global"], rows: [{ key: "a", name: "NVIDIA", weight_percent: 1, fund_count: 1, source_asset_ids: [] }] });
      expect(render(createElement(MayoresAcciones, { lookThrough: sinCodigo }), true)).toBe("");
      const asesor = render(createElement(MayoresAcciones, { lookThrough: sinCodigo }), false);
      expect(asesor).toContain("No se pueden separar las acciones de esta cartera");
      expect(asesor).toContain("Amundi Global");
      expect(asesor).not.toContain("NVIDIA");
    });

    test("mientras carga, o si falla, el cliente no ve un hueco", () => {
      expect(render(createElement(MayoresAcciones, { loading: true }), true)).toBe("");
      expect(render(createElement(MayoresAcciones, { error: "falló" }), true)).toBe("");
      expect(render(createElement(MayoresAcciones, { loading: true }), false)).toContain("Cargando");
      expect(render(createElement(MayoresAcciones, { error: "falló" }), false)).toContain("falló");
    });

    test("una cartera sin acciones lo dice al asesor y al cliente no le enseña nada", () => {
      expect(render(createElement(MayoresAcciones, { lookThrough: conAcciones({}) }), true)).toBe("");
      expect(render(createElement(MayoresAcciones, { lookThrough: conAcciones({}) }), false)).toContain("Sin acciones identificadas");
    });
  });

  test("Señales de datos: lo que queda fuera del cálculo se dice", async () => {
    const { report } = await fixtures();
    const fuera = [{ assetId: "X", nombre: "Vanguard S&P 500 UCITS ETF", pesoPct: 12, motivo: "bloqueado por calidad del dato", porCalidad: true }];
    const html = render(createElement(PortfolioXray, { xray: report.xray, fueraDeLaMedida: fuera }), false);
    expect(html).toContain("1 posición fuera del cálculo por calidad del dato: Vanguard S&amp;P 500 UCITS ETF (12,0\u00a0%).");
  });
});
