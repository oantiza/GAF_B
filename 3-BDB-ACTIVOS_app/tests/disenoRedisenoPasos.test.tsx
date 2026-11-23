// @vitest-environment happy-dom

/**
 * Diseño de la propuesta, rediseño del 14-11-2026 («Informe vivo»): la banda de los datos de la propuesta, a la vista en
 * los cuatro pasos; los pasos como pestañas, con el paso en la dirección; las herramientas de edición en la cabecera de
 * Posiciones, con sus diálogos; el orden de Comprobar; y el optimizador, que arranca en el periodo común (DIS-06).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbOptimizationPreview } from "../src/types/bdbAssets";

const horizonte = vi.hoisted(() => ({ data: undefined as unknown, error: undefined as string | undefined }));
vi.mock("../src/core/usePortfolioHorizon", () => ({
  usePortfolioHorizon: () => ({ window: "3Y", data: horizonte.data, error: horizonte.error, retry: () => undefined })
}));
vi.mock("../src/components/PortfolioImprovementPanel", () => ({
  PortfolioImprovementPanel: () => createElement("section", { "data-panel": "equivalentes" })
}));
vi.mock("../src/components/BacktestComparison", () => ({ BacktestComparison: () => createElement("section", { "data-panel": "comparativa" }) }));
vi.mock("../src/components/PortfolioAnalysisPanel", () => ({ PortfolioAnalysisPanel: () => createElement("section", { "data-panel": "analisis" }) }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { OptimizerPanel } from "../src/components/OptimizerPanel";
import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { setAnalysisWindow } from "../src/core/analysisPreferences";
import { disenoEnSesion, olvidarTrabajoDeCartera } from "../src/core/disenoEnSesion";
import { buildLocalPortfolioImport } from "../src/core/portfolioImport";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";
import { saltosDeNivel } from "./support/saltosDeNivel";

const DOS: BdbManualPortfolioPosition[] = [
  { asset_id: "LU0000000001", weight_percent: 60 },
  { asset_id: "IE0000000002", weight_percent: 40 }
];
const activo = (asset_id: string) =>
  ({ asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {} }) as unknown as BdbAssetDetail;

const PREVIEW = {
  status: "PREVIEW_ONLY",
  sourceKind: "BBDD_LIVE_API",
  metrics_boundary: { mode: "PREVIEW_ONLY", source_label: "", limitations: [] },
  total_weight_percent: 100,
  validation_status: "VALID",
  eligible_assets: [],
  excluded_assets: [],
  quality_warnings: [],
  metrics_available: [],
  metrics_missing: [],
  portfolio_warnings: [],
  disclaimer: ""
} as unknown as BdbOptimizationPreview;

const SUMMARY = {
  position_count: 2,
  is_valid: true,
  validation_status: "VALID",
  non_investable_assets: [],
  weighted_metrics: {},
  by_instrument_type: [],
  by_economic_asset_class: [],
  warnings: []
};

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  horizonte.data = undefined;
  horizonte.error = undefined;
  olvidarTrabajoDeCartera();
  setAnalysisWindow("3Y");
  window.history.replaceState(null, "", "/cartera");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function pintar(nodo: Parameters<Root["render"]>[0]) {
  await act(async () => root!.render(nodo));
}

function constructor(positions: BdbManualPortfolioPosition[] = DOS, extra: Record<string, unknown> = {}) {
  return createElement(PortfolioBuilder, {
    assets: positions.map((p) => activo(p.asset_id)),
    positions,
    summary: SUMMARY,
    optimizationPreview: null,
    localOptimizationPreview: PREVIEW,
    importResult: null,
    riskProfilePreview: null,
    riskProfiles: RISK_PROFILE_CONTRACTS,
    selectedRiskProfileId: null,
    portfolioNotice: null,
    onRemove: () => undefined,
    onOpenReport: () => undefined,
    onReset: () => undefined,
    onImportText: async () => undefined,
    onSaveLocalPortfolio: () => undefined,
    onRiskProfileChange: () => undefined,
    onWeightChange: () => undefined,
    onAmountsChange: () => undefined,
    onFindAlternatives: async () => [],
    onSwap: () => undefined,
    onBuildImprovementCandidates: async () => ({}) as never,
    onApplyImprovement: () => undefined,
    onPerfilYHorizonteChange: () => undefined,
    savedPortfolios: [],
    ...extra
  } as never);
}

const banda = () => host.querySelector<HTMLElement>('[aria-label="Datos de la propuesta"]');
const pestana = (nombre: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === nombre)!;
const elegida = () => host.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
const titulos = () => [...host.querySelectorAll("h2")].map((titulo) => titulo.textContent ?? "");
const boton = (texto: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === texto);
const sinEspacios = (texto: string | null | undefined) => (texto ?? "").replace(/\u00a0/g, " ");

describe("la banda de los datos de la propuesta", () => {
  test("los cuatro campos que se editan, cada uno con su rótulo, y las dos cifras que no", async () => {
    await pintar(constructor(DOS, { initialCapital: 250000, portfolioName: "Familia García" }));
    const campos = [...banda()!.querySelectorAll<HTMLLabelElement>("label.field__label")].map((rotulo) => rotulo.textContent);
    expect(campos).toEqual(["Nombre", "Capital", "Perfil de riesgo", "Horizonte"]);
    for (const rotulo of banda()!.querySelectorAll<HTMLLabelElement>("label.field__label")) {
      expect(document.getElementById(rotulo.htmlFor)).not.toBeNull();
    }
    const texto = sinEspacios(banda()!.textContent);
    expect(texto).toContain("Posiciones2250.000 €");
    expect(texto).toContain("Suma de pesos100,0 %Cartera cuadrada");
    /* D1 (21-11-2026): «Normalizar» ya no aparece y desaparece: vive al pie de la tabla, desactivado y diciendo por qué. */
    expect(banda()!.querySelector("button")).toBeNull();
    const normalizar = host.querySelector<HTMLButtonElement>(".portfolio-table tfoot button");
    expect(normalizar?.textContent).toBe("Normalizar al 100 %");
    expect(normalizar?.disabled).toBe(true);
    expect(normalizar?.title).toBe("La cartera ya suma 100 %: no hay nada que normalizar.");
  });

  test("si los pesos no suman 100, la suma va en ocre con lo que falta en pp y «Normalizar» a su lado", async () => {
    await pintar(constructor([{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 46.5 }]));
    const suma = banda()!.querySelector(".diseno-datos__suma--descuadre");
    expect(sinEspacios(suma?.textContent)).toContain("96,5 %");
    expect(sinEspacios(suma?.textContent)).toContain("Faltan 3,5 pp");
    /* En Componer, «Normalizar» está al pie de la tabla, junto al total (D1, 21-11-2026); en los demás pasos, junto a la suma. */
    expect(suma?.querySelector("button")).toBeNull();
    const pie = host.querySelector(".portfolio-table tfoot tr");
    expect(sinEspacios(pie?.textContent)).toMatch(/^TotalNormalizar al 100 %96,5 %/);
    expect(pie?.querySelector("button")?.disabled).toBe(false);
    await act(async () => pestana("Comprobar").click());
    expect(banda()!.querySelector(".diseno-datos__suma--descuadre button")?.textContent).toBe("Normalizar al 100 %");
  });

  test("se queda a la vista en los cuatro pasos", async () => {
    await pintar(constructor());
    for (const paso of ["Comprobar", "Optimizar", "Simular", "Componer"]) {
      await act(async () => pestana(paso).click());
      expect(elegida()).toBe(paso);
      expect(banda()).not.toBeNull();
    }
  });

  test("la cabecera: «Propuesta», el nombre o «Diseño de la propuesta», «Guardar» principal y el resto en «Más»", async () => {
    await pintar(constructor());
    expect(host.querySelector(".ui-eyebrow")?.textContent).toBe("Propuesta");
    expect(host.querySelector("h1")?.textContent).toBe("Diseño de la propuesta");
    const acciones = host.querySelector(".portfolio-header-actions")!;
    expect(acciones.querySelector(".ui-button--primary")?.textContent).toBe("Guardar");
    await act(async () => [...acciones.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Más")!.click());
    const items = [...acciones.querySelectorAll('[role="menuitem"] > span')].map((item) => item.textContent);
    expect(items).toEqual(["Guardar como…", "Nueva propuesta", "Ver los costes", "Buscar alternativas", "Descargar en CSV"]);
  });
});

describe("los pasos van en la dirección", () => {
  test("elegir un paso lo escribe en la dirección, y «Atrás» vuelve al anterior", async () => {
    await pintar(constructor());
    expect(window.location.hash).toBe("");
    await act(async () => pestana("Comprobar").click());
    expect(window.location.hash).toBe("#paso=check");
    await act(async () => pestana("Optimizar").click());
    expect(window.location.hash).toBe("#paso=optimize");
    await act(async () => {
      window.history.back();
      await new Promise((listo) => setTimeout(listo, 20));
    });
    expect(elegida()).toBe("Comprobar");
  });

  test("al recargar con un paso en la dirección, se abre en ese paso", async () => {
    window.history.replaceState(null, "", "/cartera#paso=simulate");
    await pintar(constructor());
    expect(elegida()).toBe("Simular");
  });

  test("sin paso en la dirección, se vuelve al de la sesión y se escribe sin añadir una entrada al historial", async () => {
    disenoEnSesion.write({ ...disenoEnSesion.read(), step: "check" });
    const entradas = window.history.length;
    await pintar(constructor());
    expect(elegida()).toBe("Comprobar");
    expect(window.location.hash).toBe("#paso=check");
    expect(window.history.length).toBe(entradas);
  });

  test("la ruta de Optimizar manda sobre la dirección", async () => {
    window.history.replaceState(null, "", "/cartera/optimizacion#paso=check");
    await pintar(constructor(DOS, { initialPanel: "optimization" }));
    expect(elegida()).toBe("Optimizar");
  });

  test("lo que no es un paso se lee como Componer", async () => {
    window.history.replaceState(null, "", "/cartera#paso=otro");
    await pintar(constructor());
    expect(elegida()).toBe("Componer");
  });
});

describe("Componer", () => {
  test("las herramientas de edición van en la cabecera de Posiciones", async () => {
    await pintar(constructor());
    const posiciones = [...host.querySelectorAll("section.panel")].find((seccion) => seccion.querySelector("h2")?.textContent === "Posiciones")!;
    const cabecera = posiciones.querySelector(".panel__actions")!;
    expect([...cabecera.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Libre", "Proporcional", "Añadir dinero", "Repartir por clase"]);
  });

  test("«Añadir dinero» y «Repartir por clase» abren su diálogo, con su título", async () => {
    await pintar(constructor());
    await act(async () => boton("Añadir dinero")!.click());
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Añadir dinero");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("usa «Repartir por clase»");
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Cerrar"]')!.click());
    await act(async () => boton("Repartir por clase")!.click());
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Repartir por clase");
  });

  /* 14-11-2026 (Óscar: recuperar el color y los datos de antes del rediseño): «Rentabilidad y riesgo» vuelve a llevar la frontera
     compacta sobre sus cifras, y el estado vuelve a ser un bloque «Estado» con sus filas, con el recuento al pie. Lo que lleva cada
     uno se comprueba en `colorEnPropuestasYAnalisis.test.tsx`. */
  test("el lateral: el reparto, «Rentabilidad y riesgo» y el estado, con el recuento al pie", async () => {
    await pintar(constructor());
    const lateral = host.querySelector('aside[aria-label="Reparto, riesgo y estado de la propuesta"]')!;
    const enElLateral = [...lateral.querySelectorAll("h2")].map((t) => t.textContent);
    expect(enElLateral).toContain("Reparto por clase");
    expect(enElLateral).toContain("Rentabilidad y riesgo");
    expect(enElLateral).toContain("Estado");
    expect(lateral.querySelector(".diseno-estado")?.textContent).toMatch(/revisar/);
  });

  test("con la propuesta vacía, un solo estado vacío y un solo «Ir al Buscador»", async () => {
    await pintar(constructor([], { onIrAlBuscador: () => undefined }));
    expect(titulos()).toContain("Empieza tu propuesta");
    expect(titulos()).not.toContain("Posiciones");
    expect([...document.querySelectorAll("button")].filter((b) => b.textContent === "Ir al Buscador")).toHaveLength(1);
  });
});

describe("Comprobar, Optimizar y Simular", () => {
  test("Comprobar empieza por lo que hay que revisar, y sigue en el orden decidido", async () => {
    await pintar(constructor());
    await act(async () => pestana("Comprobar").click());
    const orden = titulos();
    const en = (titulo: string) => orden.indexOf(titulo);
    expect(en("Qué hay que revisar")).toBe(0);
    expect(en("Validación")).toBeGreaterThan(en("Qué hay que revisar"));
    expect(en("Restricciones de la cartera")).toBeGreaterThan(en("Validación"));
    expect(en("Perfil de riesgo")).toBeGreaterThan(en("Restricciones de la cartera"));
  });

  test("lo que hay que revisar no sale en Modo cliente, igual que antes el estado", async () => {
    await pintar(createElement(ClientModeProvider, { initialValue: true, children: constructor() }));
    await act(async () => pestana("Comprobar").click());
    expect(titulos()).not.toContain("Qué hay que revisar");
  });

  test("en Optimizar, la frontera del periodo común antes de calcular y la comprobación previa plegada", async () => {
    await pintar(constructor());
    await act(async () => pestana("Optimizar").click());
    expect(titulos()).toContain("Optimizar cartera");
    expect(titulos()).toContain("Frontera eficiente");
    const previa = [...host.querySelectorAll("h2")].find((t) => t.textContent === "Comprobación previa: activos invertibles con peso");
    expect(previa?.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  });

  /* 14-11-2026: Simular vuelve a dibujar la frontera dentro de la simulación (se comprueba en `colorEnPropuestasYAnalisis.test.tsx`);
     sigue sin editar pesos. */
  test("Simular no edita pesos, y acaba en Análisis e Informes", async () => {
    await pintar(constructor(DOS, { onVerAnalisis: () => undefined }));
    await act(async () => pestana("Simular").click());
    expect(titulos()).not.toContain("Repartir por clase");
    expect(titulos()).toContain("Simulación histórica y proyección");
    const siguiente = host.querySelector('nav[aria-label="Siguiente paso"]');
    expect([...siguiente!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Ver el análisis", "Preparar los informes"]);
  });
});

/* MAR-32: `h1` la pantalla, `h2` cada bloque, `h3` lo que va dentro; en ningún paso se salta un nivel, tampoco con la
   propuesta vacía ni en los diálogos, que son su propio documento (título `h2`). */
describe("los niveles de encabezado (MAR-32)", () => {
  test("en ninguno de los cuatro pasos se salta un nivel", async () => {
    await pintar(constructor());
    for (const paso of ["Componer", "Comprobar", "Optimizar", "Simular"]) {
      await act(async () => pestana(paso).click());
      expect(host.querySelector("h1")?.textContent, paso).toBe("Diseño de la propuesta");
      expect(saltosDeNivel(host), paso).toEqual([]);
    }
  });

  test("con la propuesta vacía, y en los diálogos de Componer", async () => {
    await pintar(constructor([]));
    expect(saltosDeNivel(host), "vacía").toEqual([]);
    await pintar(constructor());
    for (const herramienta of ["Añadir dinero", "Repartir por clase"]) {
      await act(async () => boton(herramienta)!.click());
      const dialogo = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialogo.querySelector("h2")?.textContent, herramienta).toBe(herramienta);
      expect(saltosDeNivel(dialogo), herramienta).toEqual([]);
      await act(async () => dialogo.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click());
    }
  });
});

describe("el CSV de Diseño se vuelve a importar (DIS-16)", () => {
  const resolver = async (assetId: string) => (["LU0000000001", "IE0000000002"].includes(assetId) ? activo(assetId) : null);

  test("el formato nuevo, con BOM, punto y coma y coma decimal", async () => {
    const resultado = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["\uFEFFasset_id;Nombre;Peso;Euros", 'LU0000000001;"Fondo; con punto y coma";62,5;62500', "IE0000000002;Fondo IE0000000002;37,5;"].join("\n"),
      resolveAsset: resolver
    });
    expect(resultado.rejected_positions).toEqual([]);
    expect(resultado.imported_positions.map((p) => [p.asset_id, p.weight_percent])).toEqual([
      ["LU0000000001", 62.5],
      ["IE0000000002", 37.5]
    ]);
  });

  test("y el antiguo, con comas", async () => {
    const resultado = await buildLocalPortfolioImport({
      sourceKind: "LOCAL_MOCK",
      text: ["asset_id,nombre,peso_percent,importe_eur", 'LU0000000001,"Fondo A",62.5,62500', "IE0000000002,Fondo B,37.5,"].join("\n"),
      resolveAsset: resolver
    });
    expect(resultado.rejected_positions).toEqual([]);
    expect(resultado.imported_positions.map((p) => p.weight_percent)).toEqual([62.5, 37.5]);
  });
});

describe("el optimizador arranca en el periodo común (DIS-06)", () => {
  const optimizador = () =>
    createElement(OptimizerPanel, { assets: DOS.map((p) => activo(p.asset_id)), positions: DOS });
  const periodo = () => host.querySelector<HTMLSelectElement>('select[aria-describedby="optimizer-periodo-hint"]')!;

  test("con el periodo común en 5 años, abre en 5 años, con los mismos rótulos que el resto", async () => {
    setAnalysisWindow("5Y");
    await pintar(optimizador());
    expect(periodo().value).toBe("5Y");
    expect([...periodo().options].map((opcion) => opcion.textContent)).toEqual([
      "1 año · distinto del común",
      "3 años · distinto del común",
      "5 años · el común",
      "10 años · distinto del común"
    ]);
    expect(host.querySelector("#optimizer-periodo-hint")?.textContent).toContain("el común de análisis, 5 años");
  });

  test("si cambia el periodo común y aquí no se había elegido otro, lo sigue", async () => {
    await pintar(optimizador());
    expect(periodo().value).toBe("3Y");
    await act(async () => setAnalysisWindow("5Y"));
    expect(periodo().value).toBe("5Y");
  });

  test("1 o 10 años se pueden elegir, y se dice que no es el común", async () => {
    await pintar(optimizador());
    await act(async () => {
      periodo().value = "10Y";
      periodo().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(periodo().value).toBe("10Y");
    expect(host.querySelector("#optimizer-periodo-hint")?.textContent).toContain("10 años, distinto del común de análisis (3 años)");
  });
});
