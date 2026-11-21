// @vitest-environment happy-dom

/**
 * Diseño de cartera, sobre la pantalla: lo que no se debe perder (hallazgos 47, 48, 13, 53 y 121).
 * Una cáscara hace de marco: posiciones y capital son suyos, como en la aplicación.
 */
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";
import type { PortfolioAmountUpdate } from "../src/core/portfolioAmounts";

vi.mock("../src/components/FrontierPanel", () => ({ FrontierPanel: () => null }));
vi.mock("../src/components/OptimizerPanel", () => ({ OptimizerPanel: () => null }));
vi.mock("../src/components/PortfolioHorizonPanel", () => ({ PortfolioHorizonPanel: () => null }));
vi.mock("../src/components/BacktestComparison", () => ({ BacktestComparison: () => null }));
vi.mock("../src/components/PortfolioAnalysisPanel", () => ({ PortfolioAnalysisPanel: () => null }));
vi.mock("../src/components/SuperSectorsDonut", () => ({ SuperSectorsDonut: () => null }));
/* El diálogo de sustituir tiene sus propias pruebas: aquí solo importa qué pide al elegir. */
vi.mock("../src/components/FundSwapModal", () => ({
  FundSwapModal: ({ onSwap }: { onSwap: (a: string, b: string, c: string, o: { preserveMode: string; targetEuros?: number }) => void }) =>
    createElement("button", { type: "button", onClick: () => onSwap("A", "Z", "Fondo Z", { preserveMode: "money", targetEuros: 50000 }) }, "Elegir conservando el importe")
}));

import { PortfolioBuilder } from "../src/components/PortfolioBuilder";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { disenoEnSesion, olvidarTrabajoDeCartera } from "../src/core/disenoEnSesion";

const TRES: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 50 },
  { asset_id: "B", weight_percent: 30 },
  { asset_id: "C", weight_percent: 20 }
];

/* Lo justo para que el paso Optimizar pinte su bloque. */
const PREVIEW = {
  status: "PREVIEW_ONLY",
  sourceKind: "LOCAL_MOCK",
  disclaimer: "",
  eligible_assets: [],
  excluded_assets: [],
  total_weight_percent: 100,
  validation_status: "VALID",
  metrics_boundary: { limitations: [] },
  metrics_available: [],
  metrics_missing: [],
  quality_warnings: [],
  portfolio_warnings: []
};

let root: Root;
let host: HTMLDivElement;
let estado: { positions: BdbManualPortfolioPosition[]; capital: number | undefined };
const llamadas = { onRemove: vi.fn(), onOpenReport: vi.fn(), onVerAnalisis: vi.fn(), onIrAlBuscador: vi.fn(), onCapitalChange: vi.fn(), onSwap: vi.fn(), onRestorePositions: vi.fn() };

function Marco({ inicial, capitalInicial }: { inicial: BdbManualPortfolioPosition[]; capitalInicial?: number }) {
  const [positions, setPositions] = useState(inicial);
  const [capital, setCapital] = useState<number | undefined>(capitalInicial);
  useEffect(() => {
    estado = { positions, capital };
  }, [positions, capital]);
  return createElement(PortfolioBuilder, {
    assets: positions.map((p) => ({
      asset_id: p.asset_id,
      display_name: `Fondo ${p.asset_id}`,
      economic_asset_class: "EQUITY",
      instrument_type: "FUND",
      metrics: {},
      quality_flags: [],
      warnings: []
    })) as unknown as BdbAssetDetail[],
    positions,
    summary: null,
    optimizationPreview: null,
    localOptimizationPreview: null,
    importResult: null,
    riskProfilePreview: null,
    riskProfiles: RISK_PROFILE_CONTRACTS,
    selectedRiskProfileId: null,
    portfolioNotice: null,
    initialCapital: capital,
    onCapitalChange: (valor: number) => {
      llamadas.onCapitalChange(valor);
      setCapital(valor);
    },
    onRemove: (id: string) => {
      llamadas.onRemove(id);
      setPositions((actuales) => actuales.filter((p) => p.asset_id !== id));
    },
    onRestorePosition: (posicion: BdbManualPortfolioPosition, indice: number) =>
      setPositions((actuales) => [...actuales.slice(0, indice), posicion, ...actuales.slice(indice)]),
    onOpenReport: llamadas.onOpenReport,
    onVerAnalisis: llamadas.onVerAnalisis,
    onIrAlBuscador: llamadas.onIrAlBuscador,
    onReset: () => undefined,
    onImportText: async () => undefined,
    onSaveLocalPortfolio: () => undefined,
    onRiskProfileChange: () => undefined,
    onWeightChange: (id: string, peso: number) =>
      setPositions((actuales) => actuales.map((p) => (p.asset_id === id ? { ...p, weight_percent: peso } : p))),
    onAmountsChange: (update: PortfolioAmountUpdate) => {
      setPositions(update.positions);
      setCapital(update.totalCapital);
    },
    onFindAlternatives: async () => [],
    onSwap: llamadas.onSwap,
    onRestorePositions: (anteriores: BdbManualPortfolioPosition[]) => {
      llamadas.onRestorePositions(anteriores);
      setPositions(anteriores);
    },
    localOptimizationPreview: PREVIEW,
    savedPortfolios: []
  } as never);
}

async function montar(inicial: BdbManualPortfolioPosition[] = TRES, capitalInicial?: number) {
  await act(async () => {
    root.render(createElement(Marco, { inicial, capitalInicial }));
  });
}

async function desmontar() {
  await act(async () => root.unmount());
  root = createRoot(host);
}

const botones = () => [...document.querySelectorAll("button")];
const boton = (texto: string | RegExp) =>
  botones().find((b) => (typeof texto === "string" ? b.textContent === texto : texto.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;

async function pulsar(texto: string | RegExp) {
  const elegido = boton(texto);
  if (!elegido) throw new Error(`No aparece el botón ${texto}`);
  await act(async () => {
    elegido.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function teclea(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function escribeEnElCampo(etiqueta: string, ...teclas: string[]) {
  const input = document.querySelector(`input[aria-label="${etiqueta}"]`) as HTMLInputElement;
  await act(async () => input.focus());
  for (const valor of teclas) {
    await act(async () => teclea(input, valor));
  }
  await act(async () => input.blur());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearSessionCaches();
  Object.values(llamadas).forEach((llamada) => llamada.mockClear());
  /* El paso de Diseño va en la dirección (`#paso=…`) desde el rediseño: cada prueba empieza sin él. */
  window.history.replaceState(null, "", window.location.pathname);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("hallazgo 53: se conserva al cambiar de pantalla", () => {
  test("candados, modo y paso vuelven al remontar, como al ir al Buscador y volver", async () => {
    await montar();
    await act(async () => {
      document.querySelector(".portfolio-lock")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await pulsar("Proporcional");
    await pulsar(/^Siguiente: Comprobar/);
    await desmontar();
    await montar();
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Comprobar");
    expect(disenoEnSesion.read().locks).toEqual({ A: true });
    expect(disenoEnSesion.read().editMode).toBe("proportional");
    await pulsar("Componer");
    expect(document.querySelectorAll(".portfolio-lock.locked")).toHaveLength(1);
    expect(document.querySelector('[data-segment-id="proportional"]')?.classList.contains("active")).toBe(true);
  });

  test("al cambiar de cartera se olvida: los candados de un cliente no se aplican al siguiente", async () => {
    await montar();
    await act(async () => {
      document.querySelector(".portfolio-lock")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await desmontar();
    olvidarTrabajoDeCartera();
    await montar();
    expect(document.querySelectorAll(".portfolio-lock.locked")).toHaveLength(0);
  });
});

describe("hallazgos 48 y 13: el capital de ejemplo no pasa por real", () => {
  test("entrar y salir del campo no fija nada; teclear la misma cifra, sí", async () => {
    await montar();
    await escribeEnElCampo("Capital total en euros");
    expect(llamadas.onCapitalChange).not.toHaveBeenCalled();
    expect(estado.capital).toBeUndefined();
    await escribeEnElCampo("Capital total en euros", "1", "100.000");
    expect(llamadas.onCapitalChange).toHaveBeenCalledWith(100000);
    expect(estado.capital).toBe(100000);
  });

  test("el botón usa la cifra que hay, y al fijarla desaparece la nota", async () => {
    await montar();
    await pulsar(/Usar 100\.000.€ como capital real/);
    expect(estado.capital).toBe(100000);
    expect(document.querySelector('[data-testid="capital-ilustrativo"]')).toBeNull();
    expect(boton(/como capital real/)).toBeUndefined();
  });

  test("con el capital fijado, teclear la misma cifra no vuelve a avisar a nadie", async () => {
    await montar(TRES, 250000);
    await escribeEnElCampo("Capital total en euros", "1", "250.000");
    expect(llamadas.onCapitalChange).not.toHaveBeenCalled();
  });

  test("editar el importe de una fila pide fijarlo antes; si se cancela, nada cambia", async () => {
    await montar();
    await escribeEnElCampo("Importe en euros de Fondo A", "60.000");
    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo?.textContent).toContain("Capital sin fijar");
    expect(dialogo?.textContent).toContain("Editar un importe cambia el capital de la cartera.");
    expect(estado.capital).toBeUndefined();
    await pulsar("Cancelar");
    expect(estado.capital).toBeUndefined();
    expect(estado.positions[0].weight_percent).toBe(50);
  });

  test("si se confirma, se aplica: A pasa de 50.000 a 60.000 y el capital a 110.000", async () => {
    await montar();
    await escribeEnElCampo("Importe en euros de Fondo A", "60.000");
    await pulsar(/^Fijar 100\.000.€ y seguir/);
    expect(estado.capital).toBe(110000);
    expect(estado.positions[0].weight_percent).toBeCloseTo((60000 / 110000) * 100, 8);
  });

  test("con un candado, editar un importe también pide fijarlo, y luego el capital se queda en esos 100.000 €", async () => {
    await montar();
    await act(async () => {
      document.querySelectorAll(".portfolio-lock")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const fijadoAntes = estado.positions[1].weight_percent;
    await escribeEnElCampo("Importe en euros de Fondo A", "60.000");
    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo?.textContent).toContain("Con pesos fijados, un importe se traduce a peso sobre el capital de la cartera.");
    expect(dialogo?.textContent).not.toContain("cambia el capital");
    expect(estado.capital).toBeUndefined();
    await pulsar(/^Fijar 100\.000.€ y seguir/);
    expect(estado.capital).toBe(100000);
    expect(estado.positions[0].weight_percent).toBeCloseTo(60, 9);
    expect(estado.positions[1].weight_percent).toBe(fijadoAntes);
  });

  test("con todo fijado no hay nada que aplicar: se dice, y no pide fijar el capital", async () => {
    await montar();
    await act(async () => {
      document.querySelectorAll(".portfolio-lock")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      document.querySelectorAll(".portfolio-lock")[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const antes = estado.positions;
    await escribeEnElCampo("Importe en euros de Fondo A", "60.000");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(estado.capital).toBeUndefined();
    expect(estado.positions).toBe(antes);
    expect(document.querySelector('[data-testid="aviso-peso"]')?.textContent).toContain("en vez de 60.000");
  });

  test("con capital fijado, editar una fila no pregunta", async () => {
    await montar(TRES, 100000);
    await escribeEnElCampo("Importe en euros de Fondo A", "60.000");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(estado.capital).toBe(110000);
  });

  /* Rediseño del 14-11-2026: la aportación es «Añadir dinero», en la cabecera de Posiciones, y abre su diálogo; la
     pregunta del capital sale encima. */
  test("«Aplicar aportación» también lo pide, y hasta confirmar no dice que se haya aplicado", async () => {
    await montar();
    await pulsar("Añadir dinero");
    const ultimoDialogo = () => [...document.querySelectorAll('[role="dialog"]')].at(-1);
    await pulsar("Aplicar aportación");
    expect(ultimoDialogo()?.textContent).toContain("Una aportación se suma al capital");
    expect(estado.capital).toBeUndefined();
    await pulsar("Cancelar");
    expect(estado.capital).toBeUndefined();
    expect(document.body.textContent).not.toContain("aplicada");
    await pulsar("Aplicar aportación");
    await pulsar(/^Fijar 100\.000.€ y seguir/);
    expect(estado.capital).toBe(110000);
    expect(document.body.textContent).toContain("aplicada");
  });

  test("conservar el importe al sustituir pide fijar antes el capital: un ancla sobre euros de ejemplo recolocaría la posición", async () => {
    await montar();
    await act(async () => {
      document.querySelector('[aria-label="Sustituir Fondo A"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await pulsar("Elegir conservando el importe");
    expect(llamadas.onSwap).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Conservar el importe de una posición necesita un capital real.");
    await pulsar(/^Fijar 100\.000.€ y seguir/);
    expect(estado.capital).toBe(100000);
    expect(llamadas.onSwap).toHaveBeenCalledTimes(1);
  });

  test("la cartera vacía no tiene importes de los que avisar", async () => {
    await montar([]);
    expect(document.querySelector('[data-testid="capital-ilustrativo"]')).toBeNull();
  });

  /* DIS-16: el mismo formato que Posiciones: punto y coma, coma decimal y BOM, con cabeceras que el lector de
     importación reconoce. «Descargar en CSV» está en «Más». */
  test("el CSV sin capital deja la columna de importe vacía; con capital, la escribe", async () => {
    const leer = async () => {
      const creados: Blob[] = [];
      Object.assign(URL, { createObjectURL: (blob: Blob) => (creados.push(blob), "blob:x"), revokeObjectURL: () => undefined });
      await pulsar("Más");
      await pulsar(/^Descargar en CSV/);
      const bytes = new Uint8Array(await creados[0].arrayBuffer());
      return { bom: [...bytes.slice(0, 3)], texto: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) };
    };
    await montar();
    const sinCapital = await leer();
    expect(sinCapital.bom).toEqual([0xef, 0xbb, 0xbf]);
    expect(sinCapital.texto.split("\n")[0]).toBe("\uFEFFasset_id;Nombre;Peso;Euros");
    expect(sinCapital.texto.split("\n")[1]).toBe("A;Fondo A;50;");
    await desmontar();
    await montar([{ asset_id: "A", weight_percent: 12.5 }, { asset_id: "B", weight_percent: 87.5 }], 200000);
    const conCapital = await leer();
    expect(conCapital.texto.split("\n")[1]).toBe("A;Fondo A;12,5;25000");
  });
});

describe("hallazgo 47: quitar una posición deja «Deshacer» unos segundos", () => {
  test("vuelve a su sitio, con su candado", async () => {
    await montar();
    await act(async () => {
      document.querySelectorAll(".portfolio-lock")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      document.querySelector('[aria-label="Quitar Fondo B"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(llamadas.onRemove).toHaveBeenCalledWith("B");
    expect(estado.positions.map((p) => p.asset_id)).toEqual(["A", "C"]);
    expect(host.textContent).toContain("Se ha quitado «Fondo B».");
    await pulsar("Deshacer");
    expect(estado.positions.map((p) => p.asset_id)).toEqual(["A", "B", "C"]);
    expect(estado.positions[1].weight_percent).toBe(30);
    expect(boton("Deshacer")).toBeUndefined();
    expect(disenoEnSesion.read().locks).toEqual({ B: true });
  });

  test("a los pocos segundos desaparece", async () => {
    vi.useFakeTimers();
    await montar();
    await act(async () => {
      document.querySelector('[aria-label="Quitar Fondo A"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(boton("Deshacer")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(boton("Deshacer")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(boton("Deshacer")).toBeUndefined();
  });
});

describe("hallazgo 47: guardar, con un solo nombre", () => {
  async function montarConGuardado(overrides: Record<string, unknown>) {
    const onGuardar = vi.fn(async () => ({ ok: true, mensaje: "" }));
    await act(async () => {
      root.render(
        createElement(PortfolioBuilder, {
          assets: [],
          positions: TRES,
          summary: null,
          riskProfiles: RISK_PROFILE_CONTRACTS,
          selectedRiskProfileId: null,
          riskProfilePreview: null,
          savedPortfolios: [{ portfolio_id: "p9", name: "Otra", positions: [], created_at: "", updated_at: "", sourceKind: "LOCAL_MOCK" }],
          guardado: { abierta: null, sinGuardar: true, guardando: false },
          onGuardar,
          ...overrides
        } as never)
      );
    });
    return onGuardar;
  }

  const ABIERTA = { portfolio_id: "p1", created_at: "2026-01-01T00:00:00Z", updated_at: new Date().toISOString(), huella: "x" };

  test("con nombre, «Guardar» guarda sin preguntar nada más", async () => {
    const onGuardar = await montarConGuardado({ portfolioName: "Cliente" });
    await pulsar("Guardar");
    expect(onGuardar).toHaveBeenCalledTimes(1);
    expect(onGuardar).toHaveBeenCalledWith();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("sin nombre, lo pide en el único campo, y guarda con él", async () => {
    const onGuardar = await montarConGuardado({ portfolioName: "" });
    await pulsar("Guardar");
    expect(onGuardar).not.toHaveBeenCalled();
    const campo = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    await act(async () => teclea(campo, "Cliente nuevo"));
    await act(async () => {
      (document.querySelector('[role="dialog"] form') as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onGuardar).toHaveBeenCalledWith({ nombre: "Cliente nuevo", comoNueva: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("«Guardar como…» parte del nombre de la cartera, avisa si ya existe y crea otra", async () => {
    const onGuardar = await montarConGuardado({ portfolioName: "Cliente", guardado: { abierta: ABIERTA, sinGuardar: false, guardando: false } });
    /* Rediseño del 14-11-2026: «Guardar como…» va en «Más». */
    await pulsar("Más");
    await pulsar(/^Guardar como…/);
    const campo = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    expect(campo.value).toBe("Cliente");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Ya hay una propuesta");
    await act(async () => teclea(campo, "otra"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Ya hay una propuesta guardada con este nombre");
    await act(async () => teclea(campo, "Copia"));
    await act(async () => {
      (document.querySelector('[role="dialog"] form') as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onGuardar).toHaveBeenCalledWith({ nombre: "Copia", comoNueva: true });
  });

  test("si no se puede guardar, el diálogo se queda y dice por qué", async () => {
    const onGuardar = await montarConGuardado({ portfolioName: "Cliente" });
    onGuardar.mockResolvedValueOnce({ ok: false, mensaje: "No se ha podido guardar Copia." });
    await pulsar("Más");
    await pulsar(/^Guardar como…/);
    await act(async () => {
      (document.querySelector('[role="dialog"] form') as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("No se ha podido guardar Copia.");
  });

  test("junto al nombre: cambios sin guardar, guardada, o nada si no hay nada que decir", async () => {
    await montarConGuardado({ portfolioName: "Cliente" });
    expect(document.querySelector(".estado-de-guardado")?.textContent).toBe("Cambios sin guardar");
    expect(boton("Guardar")?.disabled).toBe(false);
    await montarConGuardado({ portfolioName: "Cliente", guardado: { abierta: ABIERTA, sinGuardar: false, guardando: false } });
    expect(document.querySelector(".estado-de-guardado")?.textContent).toMatch(/^Guardada hoy \d{2}:\d{2}$/);
    expect(boton("Guardar")?.disabled).toBe(true);
    await montarConGuardado({ positions: [], guardado: { abierta: null, sinGuardar: false, guardando: false } });
    expect(document.querySelector(".estado-de-guardado")).toBeNull();
  });
});

describe("hallazgo 47: volver a los pesos anteriores", () => {
  const ANTES = [
    { asset_id: "A", weight_percent: 40 },
    { asset_id: "B", weight_percent: 40 },
    { asset_id: "C", weight_percent: 20 }
  ];

  test("Antes/después lo ofrece; deja la cartera como estaba y el botón desaparece", async () => {
    disenoEnSesion.write({ ...disenoEnSesion.read(), step: "optimize", comparisonBaseline: { before: ANTES, source: "MÁX. SHARPE" } });
    await montar();
    await pulsar("Volver a los pesos anteriores");
    expect(llamadas.onRestorePositions).toHaveBeenCalledWith(ANTES);
    expect(estado.positions).toEqual(ANTES);
    expect(boton("Volver a los pesos anteriores")).toBeUndefined();
    expect(disenoEnSesion.read().comparisonBaseline).toBeNull();
  });
});

describe("hallazgo 121: el recorrido", () => {
  test("con todo al 0 %, el botón reparte a partes iguales y la suma es 100 exacto", async () => {
    await montar([
      { asset_id: "A", weight_percent: 0 },
      { asset_id: "B", weight_percent: 0 },
      { asset_id: "C", weight_percent: 0 }
    ]);
    expect(boton("Normalizar al 100 %")).toBeUndefined();
    await pulsar("Repartir a partes iguales");
    expect(estado.positions.map((p) => p.weight_percent)).toEqual([33.33, 33.33, 33.34]);
  });

  test("con pesos, sigue normalizando", async () => {
    await montar([
      { asset_id: "A", weight_percent: 30 },
      { asset_id: "B", weight_percent: 10 }
    ]);
    expect(boton("Repartir a partes iguales")).toBeUndefined();
    await pulsar("Normalizar al 100 %");
    expect(estado.positions.map((p) => p.weight_percent)).toEqual([75, 25]);
  });

  /* Rediseño del 14-11-2026: tras Simular, «Ver el análisis» y «Preparar los informes» (antes «Ver Análisis» e
     «Informe de cliente»). Y el paso va en la dirección. */
  test("cada paso lleva al siguiente, y tras Simular salen Análisis e Informes", async () => {
    await montar();
    await pulsar(/^Siguiente: Comprobar/);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Comprobar");
    await pulsar(/^Siguiente: Optimizar/);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Optimizar");
    await pulsar(/^Siguiente: Simular/);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Simular");
    expect(boton(/^Siguiente/)).toBeUndefined();
    expect(window.location.hash).toBe("#paso=simulate");
    await pulsar("Ver el análisis");
    expect(llamadas.onVerAnalisis).toHaveBeenCalledTimes(1);
    await pulsar("Preparar los informes");
    expect(llamadas.onOpenReport).toHaveBeenCalledTimes(1);
  });

  test("una cartera vacía tiene salida, y no hay paso siguiente", async () => {
    await montar([]);
    expect(boton(/^Siguiente/)).toBeUndefined();
    expect(botones().filter((b) => b.textContent === "Ir al Buscador").length).toBeGreaterThan(0);
    await pulsar("Ir al Buscador");
    expect(llamadas.onIrAlBuscador).toHaveBeenCalledTimes(1);
  });
});

describe("decisiones 14 y 15", () => {
  test("no hay preselección, ni auto-completar, ni mandos de riesgo al generar", async () => {
    await montar([]);
    for (const texto of ["Generar preselección", "Auto-completar", "Riesgo:", "Fondos ancla"]) {
      expect(host.textContent).not.toContain(texto);
    }
  });

  test("sin perfil elegido no se dice ningún nivel, ni en Estado ni en Comprobar", async () => {
    await act(async () => {
      root.render(
        createElement(PortfolioBuilder, {
          assets: [],
          positions: TRES,
          summary: { position_count: 3, validation_status: "VALID", non_investable_assets: [], weighted_metrics: {}, by_instrument_type: [], by_economic_asset_class: [], warnings: [] },
          riskProfiles: RISK_PROFILE_CONTRACTS,
          selectedRiskProfileId: null,
          riskProfilePreview: null,
          savedPortfolios: []
        } as never)
      );
    });
    expect(host.textContent).not.toMatch(/Nivel \d/);
    expect(host.textContent).not.toContain("señales de riesgo");
    await pulsar("Comprobar");
    /* Rediseño del 14-11-2026: el estado se lee en «Qué hay que revisar», arriba de Comprobar, y el perfil elegido se
       titula «Perfil de riesgo», con su diferencia con el de la propuesta en la procedencia. */
    expect(host.textContent).toContain("Perfil: sin elegir");
    expect(host.textContent).toContain("Perfil de riesgo");
    expect(host.textContent).toContain("No es el perfil de la propuesta");
    expect(host.textContent).not.toContain("Encaje de la cartera");
    expect((document.querySelector(".risk-profile-selector select") as HTMLSelectElement).value).toBe("");
    expect(host.textContent).not.toMatch(/idoneidad solo informativa/);
  });
});
