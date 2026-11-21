// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CostsModal } from "../src/components/CostsModal";
import { calculatePortfolioCosts } from "../src/core/portfolioCosts";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { importe, importeTitular } from "../src/core/formato";
import { costAssets, costPositions } from "./support/portfolioCostFixtures";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
// B4 / R-07: estos tests ejercitan la pantalla CON acceso a retrocesiones; el gate real
// depende de la sesion de Firebase (.env), asi que se fija aqui de forma explicita.
vi.mock("../src/auth/useCommercialRetroAccess", () => ({ useCommercialRetroAccess: () => "granted" }));
vi.mock("../src/adapters/commercialRetroStore", () => ({
  getCommercialRetroForAssets: mocks.load,
  saveCommercialRetro: mocks.save,
  assetCommercialRetroKey: (asset: { asset_id: string } | undefined) => asset?.asset_id ?? null
}));
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(new Map());
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
/* El cuadro recuerda durante la sesión la comisión y el supuesto de rentabilidad: cada prueba empieza en una sesión nueva. */
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); clearSessionCaches(); });
/* Rediseño (14-11-2026): las cifras del cuadro van en la banda `Respuesta` y las de la comisión, en filas con filete; antes, en
   `KpiStrip`. El ayudante lee las dos y devuelve el texto de la cifra. */
function kpi(label: string) {
  const enLaBanda = [...document.querySelectorAll(".respuesta__dato")].find((e) => !e.closest("[hidden]") && e.querySelector(".respuesta__rotulo")?.textContent === label);
  /* El módulo de formato separa la cifra de su unidad con un espacio duro: se lee como un espacio. */
  const plano = (texto: string | null | undefined) => texto?.replace(/\u00a0/g, " ");
  if (enLaBanda) return plano(enLaBanda.querySelector(".respuesta__cifra")?.textContent);
  return plano([...document.querySelectorAll(".analisis-filas__fila")].find((e) => !e.closest("[hidden]") && e.querySelector("dt")?.textContent === label)?.querySelector("dd")?.textContent);
}
async function tab(label: string) { await act(async () => ([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((e) => e.textContent === label)!).click()); }
async function toggleManagement() { await act(async () => (document.querySelector('.costs-management-section input[type="checkbox"]') as HTMLInputElement).click()); }
async function enterManagement(value: string) {
  await act(async () => {
    const input = document.querySelector('.costs-management-controls input') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** EuroAmountInput confirma en blur: foco, escribir y salir del campo. */
async function commitEuroManagement(value: string) {
  const field = () => document.querySelector('.costs-management-controls input') as HTMLInputElement;
  await act(async () => field().focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => field().blur());
}

describe("análisis de costes en pantalla", () => {
  const conOperacion = costAssets.map((asset, i) => ({
    ...asset,
    costs: i < 4
      ? { ...asset.costs, ongoing_charge_source: "KID" as const, transaction_costs: .002, transaction_costs_source: "KID" as const, document_url: "https://ejemplo.invalid/kid.pdf", document_date: "2026-08-19" }
      : { ...asset.costs, ongoing_charge_source: "PROVIDER" as const }
  }));

  test("los costes de operación salen aparte, sin columnas nuevas, y dicen de qué parte del peso son", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={conOperacion} totalCapital={100000} onClose={() => {}} />));
    const texto = document.body.textContent!;
    expect(texto).toContain("Costes de operación de los fondos:");
    expect(texto).toContain("No entran en el coste corriente");
    expect(texto).toContain("Del KID,");
    expect(texto).toContain("no tiene el dato");
    expect(texto).toContain("Cada cifra sale del KID del producto");
    /* Las columnas son las de antes: a 768 ya corta dos. */
    expect([...document.querySelectorAll(".costs-table thead th")].map((th) => th.textContent).slice(0, 6)).toEqual(["Activo", "Peso", "Capital", "Coste corriente", "Gestión del activo", "Coste anual"]);
  });

  test("en Modo cliente sale la cifra, y no de dónde sale: la fuente es cocina (decisión 19)", async () => {
    window.localStorage.setItem("bdb-activos.client-mode.v1", "true");
    const { ClientModeProvider } = await import("../src/app/ClientModeContext");
    await act(async () => root.render(<ClientModeProvider><CostsModal positions={costPositions} assets={conOperacion} totalCapital={100000} onClose={() => {}} /></ClientModeProvider>));
    const texto = document.body.textContent!;
    window.localStorage.removeItem("bdb-activos.client-mode.v1");
    expect(texto).toContain("Costes de operación de los fondos:");
    expect(texto).not.toMatch(/KID|proveedor/i);
  });

  test("cabecera, filas y total usan solo coste corriente y el mismo capital normalizado", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    expect(kpi("Coste corriente medio")).toBe("1,76 %");
    expect(kpi("Coste corriente anual")).toMatch(/1\.758,26\s*€/);
    const total = document.querySelector("table tfoot")!.textContent!.replace(/\u00a0/g, " ");
    expect(total).toContain("100,0 %");
    /* Los importes de una tabla, con dos decimales (apartado 6): «100.000,00 €», antes «100.000 €». */
    expect(total).toMatch(/100\.000,00\s*€/);
    expect(total).toMatch(/1\.758,26\s*€/);
    /* El aviso es ahora la pieza `Aviso`, y la cifra lleva espacio duro antes del «%». */
    expect(document.querySelector(".aviso")?.textContent?.replace(/\u00a0/g, " ")).toContain("181,25 %");
    expect(document.body.textContent).toContain("La comisión de gestión de cada activo se muestra como información y no se suma");
    expect(kpi("Ingreso anual estimado")).toBeUndefined();
  });
  test("una retrocesión guardada de 0.738 es 0,738 %, no 738 %, incluido al guardar", async () => {
    const record = { isin: costAssets[0].asset_id, retro_pct: .738, as_of_date: "2026-09-07", source: "CSV_IMPORT" };
    mocks.load.mockResolvedValue(new Map([[record.isin, record]]));
    mocks.save.mockResolvedValue(record);
    const positions = [{ ...costPositions[0], weight_percent: 200 }];
    await act(async () => root.render(<CostsModal positions={positions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    await tab("Retrocesiones");
    expect(kpi("Ingreso anual estimado")).toMatch(/738,00\s*€/);
    expect(kpi("Retrocesión media conocida")).toBe("0,74 %");
    expect(document.querySelector(".costs-retro-section tbody")?.textContent).toContain("Base comercial");
    const save = [...document.querySelectorAll("button")].find((e) => e.textContent === "Guardar")!;
    await act(async () => save.click());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ retro_pct: .738 }));
    await tab("Costes");
    expect(kpi("Coste corriente medio")).toBe("1,59 %");
  });
  describe("sin capital declarado (decisión 5)", () => {
    const boton = () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Descargar el informe")) as HTMLButtonElement;
    const cabeceras = (selector: string) => [...document.querySelectorAll(`${selector} thead th`)].map((th) => th.textContent);

    test("el informe se puede descargar y el cuadro va en porcentajes, sin capital ni euros de nadie", async () => {
      await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} onClose={vi.fn()} />));
      expect(boton().disabled).toBe(false);
      expect(document.body.textContent).not.toContain("Falta fijar");
      expect(document.body.textContent).toContain("Capital sin fijar");
      expect(document.querySelector(".costs-capital strong")).toBeNull();
      /* 1,76 % de media, calculado a mano en `portfolioCosts.test.ts`, es 176 € por cada 10.000 €. */
      expect(kpi("Coste corriente anual")).toMatch(/^1,76 % al año, unos 176\s*€ por cada 10\.000\s*€$/);
      expect(kpi("Coste corriente medio")).toBeUndefined();
      expect(cabeceras(".costs-table:not(.costs-retro-table)")).toEqual(["Activo", "Peso", "Coste corriente", "Gestión del activo"]);
      const pie = document.querySelector("#costs-panel-costs tfoot")!.textContent!.replace(/\u00a0/g, " ");
      expect(pie).toContain("1,76 %");
      expect(pie).not.toContain("€");
      expect(document.querySelector("#costs-panel-costs tbody")!.textContent).not.toContain("€");
      expect(document.body.textContent).not.toContain("Coste anual = capital");
    });

    test("un capital de 0 € o inválido es lo mismo que no tenerlo", async () => {
      for (const capital of [0, -5, Number.NaN]) {
        await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={capital} onClose={vi.fn()} />));
        expect(document.body.textContent).toContain("Capital sin fijar");
        expect(kpi("Coste corriente anual")).toContain("por cada 10.000");
      }
    });

    test("Retrocesiones: ni ingreso, ni capital, ni coeficiente, y la media sigue saliendo, ponderada por el peso", async () => {
      const record = { isin: costAssets[0].asset_id, retro_pct: 1, as_of_date: "2026-09-07", source: "CSV_IMPORT" };
      mocks.load.mockResolvedValue(new Map([[record.isin, record]]));
      const positions = [{ asset_id: costAssets[0].asset_id, weight_percent: 25 }, { asset_id: costAssets[1].asset_id, weight_percent: 75 }];
      await act(async () => root.render(<CostsModal positions={positions} assets={costAssets} onClose={vi.fn()} />));
      await tab("Retrocesiones");
      expect(kpi("Ingreso anual estimado")).toBeUndefined();
      /* Solo se conoce la del 25 %: la media de lo conocido es su 1 %, y lo conocido es un 25 % del peso. */
      expect(kpi("Retrocesión media conocida")).toBe("1,00 %");
      expect(kpi("Retrocesiones conocidas")).toBe("25 %");
      expect(cabeceras(".costs-retro-table")).toEqual(["Activo", "Peso", "Retrocesión %", "Origen", "Guardar"]);
      expect(document.querySelector("#costs-panel-retro .costs-margin-input")).toBeNull();
      const panel = document.querySelector("#costs-panel-retro")!.textContent!;
      expect(panel).toContain("no se estima ningún ingreso");
      expect(panel).not.toContain("€");
    });

    test("con capital, el mismo cuadro sigue dando euros, capital e ingreso", async () => {
      await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={vi.fn()} />));
      expect(boton().disabled).toBe(false);
      expect(document.body.textContent).not.toContain("Capital sin fijar");
      expect(cabeceras(".costs-table:not(.costs-retro-table)")).toEqual(["Activo", "Peso", "Capital", "Coste corriente", "Gestión del activo", "Coste anual"]);
      expect(cabeceras(".costs-retro-table")).toEqual(["Activo", "Capital", "Retrocesión %", "Origen", "Ingreso anual", "Guardar"]);
      expect(document.querySelector(".costs-margin-input")).not.toBeNull();
    });

    test("la comisión de gestión, sin capital, va solo en porcentaje y entra en la frase", async () => {
      await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} onClose={vi.fn()} />));
      await toggleManagement();
      expect((document.querySelector('.costs-management-controls option[value="euros"]') as HTMLOptionElement).disabled).toBe(true);
      expect(kpi("Coste con gestión")).toBe("No disponible");
      await enterManagement("0.5");
      expect(kpi("Gestión de cartera")).toBe("0,50 %");
      expect(kpi("Coste con gestión")).toMatch(/^2,26 % al año, unos 226\s*€ por cada 10\.000\s*€$/);
      expect(kpi("Gestión de cartera · coste anual")).toBeUndefined();
    });
  });

  test("costes desconocidos se muestran N/D y no como un total gratuito", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={[]} totalCapital={100000} onClose={() => {}} />));
    expect(kpi("Coste corriente medio")).toBe("Falta el dato");
    expect(kpi("Coste corriente anual identificado")).toBe("Falta el dato");
    // ANA-28: con su plural, no «posición(es)».
    expect(document.body.textContent).toContain("8 posiciones sin coste corriente válido");
  });
  test("con una acción: en su fila «No aplica», la media cuenta como cero y no hay aviso de datos por completar", async () => {
    const fondo = (asset_id: string) => ({ ...costAssets[0], asset_id, isin: asset_id, display_name: asset_id, costs: { ongoing_charge: .01 } });
    const accion = { ...costAssets[0], asset_id: "ES0144580Y14", isin: "ES0144580Y14", display_name: "Iberdrola S.A.", instrument_type: "STOCK" as const, costs: undefined };
    const positions = [{ asset_id: "F1", weight_percent: 40 }, { asset_id: "F2", weight_percent: 30 }, { asset_id: "ES0144580Y14", weight_percent: 30 }];
    await act(async () => root.render(<CostsModal positions={positions} assets={[fondo("F1"), fondo("F2"), accion]} totalCapital={100000} onClose={() => {}} />));
    expect(kpi("Coste corriente medio")).toBe("0,70 %");
    expect(kpi("Coste corriente anual")).toMatch(/700,00\s*€/);
    expect(kpi("Costes conocidos")).toBe("100 %");
    const fila = [...document.querySelectorAll(".costs-table tbody tr")].find((tr) => tr.textContent?.includes("Iberdrola"))!;
    /* Coste corriente, gestión del activo y coste anual: ni un 0 %, ni un N/D. */
    expect([...fila.querySelectorAll("td")].slice(3).map((td) => td.textContent)).toEqual(["No aplica", "No aplica", "No aplica"]);
    expect(document.body.textContent).toContain("No incluye custodia ni corretaje");
    expect(document.body.textContent).not.toContain("hasta completar los datos");
  });
  describe("una cartera solo de acciones no sale gratis", () => {
    const accion = (asset_id: string, display_name: string) => ({ ...costAssets[0], asset_id, isin: asset_id, display_name, instrument_type: "STOCK" as const, costs: undefined });
    const acciones = [accion("ES0144580Y14", "Iberdrola S.A."), accion("US5949181045", "Microsoft")];
    const positions = [{ asset_id: "ES0144580Y14", weight_percent: 60 }, { asset_id: "US5949181045", weight_percent: 40 }];
    const texto = () => document.querySelector(".costs-tab-panel")!.textContent ?? "";

    test("con capital: dice «No aplica» donde decía 0,00 % y 0,00 €, con lo que no incluye", async () => {
      await act(async () => root.render(<CostsModal positions={positions} assets={acciones} totalCapital={100000} onClose={() => {}} />));
      expect(kpi("Coste corriente anual")).toBe("No aplica");
      expect(kpi("Coste corriente medio")).toBe("No aplica");
      expect(kpi("Costes conocidos")).toBe("No aplica");
      const total = [...document.querySelector(".costs-table tfoot")!.querySelectorAll("td")].map((td) => td.textContent?.replace(/\u00a0/g, " "));
      expect(total).toEqual(["Total", "100,0 %", expect.stringMatching(/^100\.000/), "No aplica", "", "No aplica"]);
      expect(texto()).not.toMatch(/(?<!\d)0,00\s*(%|€)/);
      expect(texto()).toContain("no hay media que dar. No incluye custodia ni corretaje.");
      expect(texto()).not.toContain("en la media cuenta como cero");
    });

    test("sin capital, lo mismo: ni un cero ni unos euros por cada 10.000", async () => {
      await act(async () => root.render(<CostsModal positions={positions} assets={acciones} onClose={() => {}} />));
      expect(kpi("Coste corriente anual")).toBe("No aplica");
      expect(texto()).not.toMatch(/(?<!\d)0,00\s*(%|€)/);
      expect(texto()).toContain("No incluye custodia ni corretaje.");
    });

    test("el cálculo no cambia, que es lo que lee el papel; y con un fondo, la media vuelve a ser una cifra", async () => {
      const costs = calculatePortfolioCosts(positions, acciones, 100000);
      expect(costs.avgCostPct).toBe(0);
      expect(costs.totalCostEur).toBe(0);
      expect(costs.acciones).toBe(2);
      const fondo = { ...costAssets[0], asset_id: "F1", costs: { ongoing_charge: .01 } };
      await act(async () => root.render(<CostsModal positions={[{ asset_id: "F1", weight_percent: 50 }, { asset_id: "ES0144580Y14", weight_percent: 50 }]} assets={[fondo, acciones[0]]} totalCapital={100000} onClose={() => {}} />));
      /* 50 % al 1 % y 50 % a cero: 0,50 %, y 500 € sobre 100.000. */
      expect(kpi("Coste corriente medio")).toBe("0,50 %");
      expect(kpi("Coste corriente anual")).toMatch(/500,00\s*€/);
    });
  });

  test("con un 1 % en Iberdrola, la media deja de ser N/D", async () => {
    const accion = { ...costAssets[0], asset_id: "ES0144580Y14", isin: "ES0144580Y14", display_name: "Iberdrola S.A.", instrument_type: "STOCK" as const, costs: undefined };
    const positions = [{ asset_id: "F1", weight_percent: 99 }, { asset_id: "ES0144580Y14", weight_percent: 1 }];
    await act(async () => root.render(<CostsModal positions={positions} assets={[{ ...costAssets[0], asset_id: "F1", costs: { ongoing_charge: .01 } }, accion]} totalCapital={100000} onClose={() => {}} />));
    expect(kpi("Coste corriente medio")).toBe("0,99 %");
    expect(kpi("Coste corriente anual")).toMatch(/990,00\s*€/);
  });
  test("un fondo sin coste junto a una acción sigue dejando la media en N/D, con su aviso", async () => {
    const accion = { ...costAssets[0], asset_id: "ES0144580Y14", isin: "ES0144580Y14", display_name: "Iberdrola S.A.", instrument_type: "STOCK" as const, costs: undefined };
    const positions = [{ asset_id: "F1", weight_percent: 70 }, { asset_id: "ES0144580Y14", weight_percent: 30 }];
    await act(async () => root.render(<CostsModal positions={positions} assets={[{ ...costAssets[0], asset_id: "F1", costs: undefined }, accion]} totalCapital={100000} onClose={() => {}} />));
    expect(kpi("Coste corriente medio")).toBe("Falta el dato");
    expect(document.body.textContent).toContain("1 posición sin coste corriente válido");
    expect(document.body.textContent).toContain("hasta completar los datos");
    expect(document.body.textContent).toContain("No incluye custodia ni corretaje");
    /* INF-3 (auditoría 16-11-2026): el total en euros de la tabla es solo lo identificado, y lo dice el rótulo de su fila. */
    expect(document.querySelector("tfoot td")?.textContent).toBe("Total · coste anual identificado");
  });

  test("con el coste de todas las posiciones, el total de la tabla no lleva la marca de identificado", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    expect(document.querySelector("tfoot td")?.textContent).toBe("Total");
  });
  test("sin acciones no sale la nota de las acciones", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    expect(document.body.textContent).not.toContain("custodia");
  });
  test("un cambio de capital actualiza los importes sin volver a consultar retrocesiones", async () => {
    for (const capital of [100000, 200000]) {
      await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={capital} onClose={() => {}} />));
    }
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(kpi("Coste corriente medio")).toBe("1,76 %");
    expect(kpi("Coste corriente anual")).toMatch(/3\.516,53\s*€/);
  });
  test("la gestión es opcional: permite añadirla y retirarla sin alterar el coste corriente ni guardar retrocesiones", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    expect(document.querySelector(".costs-management-controls")).toBeNull();
    await toggleManagement();
    expect(kpi("Coste anual con gestión")).toBe("Falta el dato");
    await enterManagement("0.5");
    expect(kpi("Gestión de cartera · coste anual")).toMatch(/500,00\s*€/);
    expect(kpi("Coste con gestión (%)")).toBe("2,26 %");
    expect(kpi("Coste anual con gestión")).toMatch(/2\.258,26\s*€/);
    expect(kpi("Coste corriente medio")).toBe("1,76 %");
    expect(kpi("Coste corriente anual")).toMatch(/1\.758,26\s*€/);
    await toggleManagement();
    expect(kpi("Coste anual con gestión")).toBeUndefined();
    expect(kpi("Coste corriente medio")).toBe("1,76 %");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  test("el importe anual en euros usa EuroAmountInput: millares europeos y nunca negativo", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    await toggleManagement();
    await act(async () => {
      const select = document.querySelector('.costs-management-controls select') as HTMLSelectElement;
      select.value = "euros"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Auditoría 14-10 (MEDIA-21): nada de type="number" para un importe; vacío hasta confirmar.
    const field = document.querySelector('.costs-management-controls input') as HTMLInputElement;
    expect(field.type).toBe("text");
    expect(field.value).toBe("");
    expect(kpi("Coste anual con gestión")).toBe("Falta el dato");
    // «1.500» son mil quinientos euros (en un type="number" el navegador lo leía como 1,5).
    await commitEuroManagement("1.500");
    expect(kpi("Gestión de cartera · coste anual")).toMatch(/1\.500,00\s*€/);
    expect(kpi("Coste anual con gestión")).toMatch(/3\.258,26\s*€/);
    await commitEuroManagement("750");
    expect(kpi("Gestión de cartera · coste anual")).toMatch(/750,00\s*€/);
    expect(kpi("Coste anual con gestión")).toMatch(/2\.508,26\s*€/);
    // El campo aplica el mínimo 0: un importe negativo no llega al cálculo.
    await commitEuroManagement("-1");
    expect(kpi("Gestión de cartera · coste anual")).toMatch(/0,00\s*€/);
    expect(document.querySelector(".costs-management-controls p.field__error")).toBeNull();
  });
  test("rechaza un porcentaje de gestión negativo o mayor que 100", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    await toggleManagement();
    await enterManagement("-1");
    expect(document.querySelector(".costs-management-controls p.field__error")?.textContent).toContain("entre 0 y 100");
    expect(kpi("Coste anual con gestión")).toBe("Falta el dato");
  });
  test("recalcula el porcentaje sobre el nuevo capital sin recargar datos comerciales", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    await toggleManagement(); await enterManagement("0.5");
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={200000} onClose={() => {}} />));
    expect(kpi("Gestión de cartera · coste anual")).toMatch(/1\.000,00\s*€/);
    expect(kpi("Coste anual con gestión")).toMatch(/4\.516,53\s*€/);
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  test("costes y retrocesiones tienen paneles separados y solo uno es visible", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Costes");
    expect(document.querySelector('#costs-panel-retro')?.hasAttribute('hidden')).toBe(true);
    await tab("Retrocesiones");
    expect(document.querySelector('#costs-panel-costs')?.hasAttribute('hidden')).toBe(true);
    expect(kpi("Coste corriente anual")).toBeUndefined();
    expect(kpi("Ingreso anual estimado")).toBe("Falta el dato");
    expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
  });
  test("cambiar de pestaña conserva la comisión manual y los porcentajes comerciales sin guardarlos", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    await toggleManagement(); await enterManagement("0.5");
    await tab("Retrocesiones");
    await act(async () => {
      const input = document.querySelector('.costs-retro-input') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0.738");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await tab("Costes");
    expect(kpi("Gestión de cartera · coste anual")).toMatch(/500,00\s*€/);
    expect(kpi("Coste anual con gestión")).toMatch(/2\.258,26\s*€/);
    await tab("Retrocesiones");
    expect((document.querySelector('.costs-retro-input') as HTMLInputElement).value).toBe("0.738");
    expect(kpi("Retrocesión media conocida")).toBe("0,74 %");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  test("las pestañas permiten navegación por teclado y apuntan a su panel accesible", async () => {
    await act(async () => root.render(<CostsModal positions={costPositions} assets={costAssets} totalCapital={100000} onClose={() => {}} />));
    await act(async () => {
      document.querySelector('#costs-tab-costs')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    const selected = document.querySelector('[role="tab"][aria-selected="true"]')!;
    expect(selected.textContent).toBe("Retrocesiones");
    const panel = document.getElementById(selected.getAttribute('aria-controls')!)!;
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(panel.getAttribute('aria-labelledby')).toBe(selected.id);
  });
});

describe("el efecto de los costes con el tiempo, en el cuadro (Óscar, 11-11-2026)", () => {
  const fondoAl = (asset_id: string, ongoing_charge?: number) => ({ ...costAssets[0], asset_id, isin: asset_id, display_name: `Fondo ${asset_id}`, costs: ongoing_charge === undefined ? undefined : { ongoing_charge } });
  const accion = (asset_id: string) => ({ ...costAssets[0], asset_id, isin: asset_id, display_name: `Acción ${asset_id}`, instrument_type: "STOCK" as const, costs: undefined });
  const unFondo = [fondoAl("F1", 0.01)];
  const enUno = [{ asset_id: "F1", weight_percent: 100 }];
  const bloque = () => [...document.querySelectorAll("section.panel")].find((s) => s.querySelector(".panel__title")?.textContent === "Efecto de los costes con el tiempo") as HTMLElement | undefined;
  const plano = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ");
  const filas = () => [...bloque()!.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => plano(c.textContent)));
  async function rentabilidad(valor: string) {
    await act(async () => {
      const input = bloque()!.querySelector("input") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  test("1 % al 5 % sobre 100.000 €: la tabla de 5 y 10 años, con la procedencia bajo el título", async () => {
    await act(async () => root.render(<CostsModal positions={enUno} assets={unFondo} totalCapital={100000} onClose={() => {}} />));
    expect(bloque()).toBeDefined();
    expect(bloque()!.querySelector("h3")?.textContent).toBe("Efecto de los costes con el tiempo");
    expect(plano(bloque()!.querySelector(".panel__subtitle")?.textContent)).toBe(plano(`Sobre el capital analizado, ${importe(100000)} · rentabilidad supuesta del 5 % anual antes de costes, la misma para todo · coste de 1,00 % al año`));
    expect((bloque()!.querySelector("input") as HTMLInputElement).value).toBe("5");
    /* Las cifras fijas de `efectoDeLosCostes.test.ts`, escritas como las escribe la pantalla. */
    expect(filas()).toEqual([
      ["5 años", importe(127_628.1563), importe(121_373.1067), importe(6_255.0496), "4,9 %"].map(plano),
      ["10 años", importe(162_889.4627), importe(147_314.3103), importe(15_575.1524), "9,6 %"].map(plano)
    ]);
    const nota = plano(bloque()!.querySelector(".field__hint")?.textContent);
    expect(nota).toContain("Una ilustración, no una previsión: la rentabilidad es un supuesto, no la de esta cartera");
    expect(nota).toContain("No entran la entrada (suscripción) máxima, que es un máximo de folleto y rara vez se cobra, ni los costes de operación, que solo se conocen en parte; tampoco las retrocesiones, que ya van dentro del coste de cada fondo.");
  });

  test("la rentabilidad la pone el asesor: con un 7 % cambian los euros y no el porcentaje; vacía, se dice por qué no hay cifra", async () => {
    await act(async () => root.render(<CostsModal positions={enUno} assets={unFondo} totalCapital={100000} onClose={() => {}} />));
    await rentabilidad("7");
    expect(plano(bloque()!.querySelector(".panel__subtitle")?.textContent)).toContain("rentabilidad supuesta del 7 % anual antes de costes");
    expect(filas()[1]).toEqual(["10 años", importe(100000 * 1.07 ** 10), importe(100000 * (1.07 * 0.99) ** 10), importe(100000 * (1.07 ** 10 - (1.07 * 0.99) ** 10)), "9,6 %"].map(plano));
    await rentabilidad("");
    expect(bloque()!.querySelector("table")).toBeNull();
    expect(bloque()!.querySelector(".ausencia--falta")?.textContent).toBe("Indica una rentabilidad supuesta entre el 0 % y el 15 % anual.");
    expect(bloque()!.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
  });

  test("sin capital, por cada 10.000 € de ejemplo, como el resto del cuadro", async () => {
    await act(async () => root.render(<CostsModal positions={enUno} assets={unFondo} onClose={() => {}} />));
    expect(plano(bloque()!.querySelector(".panel__subtitle")?.textContent)).toContain(plano(`Por cada ${importeTitular(10000)} de ejemplo, no el capital de esta cartera`));
    expect(filas()[1]).toEqual(["10 años", importe(16_288.94627), importe(14_731.43103), importe(1_557.51524), "9,6 %"].map(plano));
  });

  test("con la comisión de gestión de la cartera, el coste la lleva y lo dice", async () => {
    await act(async () => root.render(<CostsModal positions={enUno} assets={unFondo} totalCapital={100000} onClose={() => {}} />));
    await toggleManagement();
    expect(bloque()!.querySelector(".ausencia--falta")?.textContent).toBe("La comisión de gestión de la cartera está activada pero su importe no es válido o está pendiente.");
    await enterManagement("0.5");
    expect(plano(bloque()!.querySelector(".panel__subtitle")?.textContent)).toContain("coste de 1,50 % al año, con la gestión de la cartera");
    expect(filas()[1]).toEqual(["10 años", importe(162_889.4627), importe(140_041.0298), importe(22_848.4329), "14,0 %"].map(plano));
  });

  test("con un fondo sin coste no se calcula; con solo acciones, no aplica; con coste cero, las dos cifras coinciden", async () => {
    await act(async () => root.render(<CostsModal positions={[{ asset_id: "F1", weight_percent: 60 }, { asset_id: "F2", weight_percent: 40 }]} assets={[fondoAl("F1", 0.01), fondoAl("F2")]} totalCapital={100000} onClose={() => {}} />));
    expect(bloque()!.querySelector("table")).toBeNull();
    expect(bloque()!.querySelector(".ausencia--falta")?.textContent).toBe("Falta el coste corriente de 1 de las 2 posiciones, y sin él no se calcula: contarlo como cero diría que la cartera cuesta menos.");

    await act(async () => root.render(<CostsModal positions={[{ asset_id: "ES1", weight_percent: 100 }]} assets={[accion("ES1")]} totalCapital={100000} onClose={() => {}} />));
    expect(bloque()!.querySelector("table")).toBeNull();
    expect(bloque()!.querySelector("input")).toBeNull();
    expect(bloque()!.querySelector(".ausencia--no-aplica")?.textContent).toBe("No aplica");

    await act(async () => root.render(<CostsModal positions={enUno} assets={[fondoAl("F1", 0)]} totalCapital={100000} onClose={() => {}} />));
    for (const [, sin, con, diferencia, pct] of filas()) {
      expect(con).toBe(sin);
      expect(diferencia).toBe(plano(importe(0)));
      expect(pct).toBe("0,0 %");
    }
  });

  test("solo acciones con 0,5 % de gestión: se proyecta la gestión, y la procedencia lo dice; sin ella, «No aplica»", async () => {
    await act(async () => root.render(<CostsModal positions={[{ asset_id: "ES1", weight_percent: 100 }]} assets={[accion("ES1")]} totalCapital={100000} onClose={() => {}} />));
    expect(bloque()!.querySelector(".ausencia--no-aplica")?.textContent).toBe("No aplica");
    await toggleManagement();
    await enterManagement("0.5");
    expect(plano(bloque()!.querySelector(".panel__subtitle")?.textContent)).toContain("coste de 0,50 % al año, solo el de la gestión de la cartera: las acciones no tienen coste corriente");
    expect(filas()[1]).toEqual(["10 años", importe(162_889.4627), importe(154_925.8181), importe(7_963.6446), "4,9 %"].map(plano));
  });

  test("en Modo cliente sale igual, sin la mención de las retrocesiones", async () => {
    window.localStorage.setItem("bdb-activos.client-mode.v1", "true");
    const { ClientModeProvider } = await import("../src/app/ClientModeContext");
    await act(async () => root.render(<ClientModeProvider><CostsModal positions={enUno} assets={unFondo} totalCapital={100000} onClose={() => {}} /></ClientModeProvider>));
    window.localStorage.removeItem("bdb-activos.client-mode.v1");
    expect(filas()).toHaveLength(2);
    expect(bloque()!.querySelector("input")).not.toBeNull();
    expect(plano(bloque()!.textContent)).not.toMatch(/retroces/i);
  });
});
