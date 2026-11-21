// @vitest-environment happy-dom

/**
 * Decisiones 59 y B-66 en pantalla: «La cartera frente al mercado objetivo y el horizonte declarados» en Comprobar, de la lectura de la base (con
 * un lector falso y documentos SIMULADOS con la forma del contrato) al panel. Lo que se fija: que pinta los avisos por
 * posición con su peso, el negativo destacado y la nota de nivel 1 una sola vez; que dice cuántas posiciones quedan sin
 * datos; que en Modo cliente no existe ni se lee nada (decisión 53); y que ningún informe en papel lo importa.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../src/types/bdbAssets";

const base = vi.hoisted(() => ({ documentos: {} as Record<string, Record<string, unknown>>, pedidas: [] as string[] }));

vi.mock("../src/adapters/baseNuevaLectura", () => ({
  BASE_NUEVA_DISPONIBLE: true,
  leerDocumento: async (ruta: string) => {
    base.pedidas.push(ruta);
    return base.documentos[ruta];
  }
}));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { olvidarMercadosObjetivoLeidos } from "../src/adapters/mercadoObjetivoDeLaCartera";
import { AvisosDelMercadoObjetivo } from "../src/components/AvisosDelMercadoObjetivo";
import type { PerfilYHorizonte } from "../src/core/perfilYHorizonte";

const HOY = new Date("2026-11-09T10:00:00Z");

function mercado(cambios: Record<string, unknown> = {}) {
  return {
    source: "issuer:ishares",
    target_market_as_of: "2026-09-30",
    investor_type: { retail: "YES", professional: "YES", eligible_counterparty: "YES" },
    knowledge: { basic: "YES", informed: "YES", advanced: "YES" },
    loss_capacity: { no_loss: "NO", no_guarantee: "YES" },
    min_holding_period: { years: 5 },
    ...cambios
  };
}

function conMercado(isin: string, documento: Record<string, unknown>, kid?: number) {
  base.documentos[`instruments/${isin}/read/card`] = { available_sections: kid === undefined ? ["target_market"] : ["target_market", "regulatory"] };
  base.documentos[`instruments/${isin}/declared/target_market`] = documento;
  if (kid !== undefined) base.documentos[`instruments/${isin}/declared/regulatory`] = { recommended_holding_years: kid };
}

const POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "IE00B4L5Y983", weight_percent: 40 },
  { asset_id: "IE00COMPLEJO", weight_percent: 5 },
  { asset_id: "IE00VIEJO000", weight_percent: 25 },
  { asset_id: "ES0000000ACC", weight_percent: 30 }
];
const ACTIVOS = [
  { asset_id: "IE00B4L5Y983", display_name: "iShares Core MSCI World" },
  { asset_id: "IE00COMPLEJO", display_name: "Un ETF apalancado" },
  { asset_id: "IE00VIEJO000", display_name: "Un ETF de 2025" },
  { asset_id: "ES0000000ACC", display_name: "Una acción" }
] as unknown as BdbAssetDetail[];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(HOY);
  localStorage.clear();
  olvidarMercadosObjetivoLeidos();
  base.documentos = {};
  base.pedidas = [];
  conMercado("IE00B4L5Y983", mercado(), 5);
  conMercado("IE00COMPLEJO", mercado({ knowledge: { basic: "NO", informed: "YES", advanced: "YES" }, min_holding_period: { code: "L" } }));
  conMercado("IE00VIEJO000", mercado({ target_market_as_of: "2025-09-30", loss_capacity: { no_loss: "NEUTRAL" } }), 2);
  /* La acción no tiene mercado objetivo: su tarjeta no lo declara. */
  base.documentos["instruments/ES0000000ACC/read/card"] = { available_sections: ["equity"] };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function pintar(perfilYHorizonte: PerfilYHorizonte, modoCliente = false, posiciones = POSICIONES) {
  await act(async () => {
    root.render(
      <ClientModeProvider initialValue={modoCliente}>
        <AvisosDelMercadoObjetivo assets={ACTIVOS} perfilYHorizonte={perfilYHorizonte} positions={posiciones} />
      </ClientModeProvider>
    );
  });
  /* Las lecturas son promesas: se dejan terminar. */
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const filas = () => [...host.querySelectorAll(".avisos-mercado-objetivo > li")];

describe("los avisos en Comprobar", () => {
  test("cartera de nivel 1 a 3 años: R1, R2 destacado y primero, R3 con su fecha y la nota de pérdidas una vez", async () => {
    await pintar({ risk_profile_level: 1, horizon_years: 3 });
    const texto = host.textContent ?? "";

    expect(host.querySelector("h2")?.textContent).toBe("La cartera frente al mercado objetivo y el horizonte declarados");
    expect(texto).toContain("con mercado objetivo 3, solo con horizonte del KID 0, sin datos 1 de 4 posiciones");
    expect(texto).not.toContain("objetivo del fabricante · ");
    expect(texto).toContain("3 posiciones avisan");

    const nombres = filas().map((fila) => fila.querySelector(".avisos-mercado-objetivo__nombre")?.textContent);
    expect(nombres).toEqual(["Un ETF apalancado", "iShares Core MSCI World", "Un ETF de 2025"]);
    expect(filas().map((fila) => fila.querySelector(".avisos-mercado-objetivo__peso")?.textContent)).toEqual(["5,0\u00a0%", "40,0\u00a0%", "25,0\u00a0%"]);

    const destacado = host.querySelector(".avisos-mercado-objetivo__aviso--destacado");
    expect(destacado?.textContent).toBe("iShares no lo piensa para quien solo tiene conocimiento básico: es su mercado objetivo negativo.");
    /* El del código L no lleva R1: no se le inventan años. */
    expect(filas()[0].querySelectorAll(".avisos-mercado-objetivo__aviso")).toHaveLength(1);

    expect(filas()[1].textContent).toContain("La cartera se ha definido a 3 años y este fondo recomienda 5 años, según su KID.");
    expect(filas()[2].textContent).toMatch(/Su mercado objetivo es del 30\/09\/2025: tiene más de 12 meses/);
    /* El de 2 años en el KID no llega a R1 con una cartera a 3. */
    expect(filas()[2].textContent).not.toContain("La cartera se ha definido");

    const notas = host.querySelectorAll('[data-testid="nota-de-perdidas"]');
    expect(notas).toHaveLength(1);
    /* La pinta la pieza `Aviso` (MAR-21): sin título, el lector de pantalla oye delante su palabra, «Aviso.». */
    expect(notas[0].textContent).toBe(
      "Aviso. La cartera es de nivel 1 (Preservación): 2 de 4 posiciones (45,0\u00a0% del peso) no son compatibles con un cliente que no pueda asumir pérdidas, según su fabricante. De 1 posición no hay mercado objetivo, y no se cuentan."
    );

    expect(texto).toContain("De 1 posición no hay mercado objetivo ni horizonte del KID en la base");
    expect(texto).toContain("1 posición da su horizonte como plazo y no en años, o no lo da: no se compara.");
    expect(texto).toContain("No evalúa idoneidad.");
  });

  test("sin nivel ni horizonte, solo el mercado objetivo negativo y la fecha; y dice que no compara el horizonte", async () => {
    await pintar({});
    expect(host.querySelector('[data-testid="nota-de-perdidas"]')).toBeNull();
    expect(host.textContent).not.toContain("La cartera se ha definido");
    expect(filas()).toHaveLength(2);
    expect(host.textContent).toContain("La cartera no tiene horizonte definido, así que no se compara con el que recomienda cada fondo.");
  });

  test("decisión B-66: un fondo con solo el KID avisa de R1, se cuenta aparte y no se presenta como mercado objetivo comprobado", async () => {
    base.documentos["instruments/LU00SOLOKID0/read/card"] = { available_sections: ["regulatory"] };
    base.documentos["instruments/LU00SOLOKID0/declared/regulatory"] = { recommended_holding_years: 7 };
    await pintar({ risk_profile_level: 1, horizon_years: 3 }, false, [
      { asset_id: "IE00B4L5Y983", weight_percent: 40 },
      { asset_id: "LU00SOLOKID0", weight_percent: 30 },
      { asset_id: "ES0000000ACC", weight_percent: 30 }
    ]);
    const texto = host.textContent ?? "";
    expect(texto).toContain("con mercado objetivo 1, solo con horizonte del KID 1, sin datos 1 de 3 posiciones");
    const fila = filas().find((f) => f.querySelector(".avisos-mercado-objetivo__nombre")?.textContent === "LU00SOLOKID0");
    expect(fila?.textContent).toContain("La cartera se ha definido a 3 años y este fondo recomienda 7 años, según su KID.");
    expect(fila?.querySelectorAll(".avisos-mercado-objetivo__aviso")).toHaveLength(1);
    expect(texto).toContain("De 1 posición solo hay el horizonte del KID: se compara el horizonte, pero no hay mercado objetivo del fabricante que comprobar.");
    /* La nota de nivel 1 no lo cuenta: no tiene mercado objetivo. */
    expect(host.querySelector('[data-testid="nota-de-perdidas"]')?.textContent).toContain("De 2 posiciones no hay mercado objetivo");
    expect(base.pedidas).not.toContain("instruments/LU00SOLOKID0/declared/target_market");
  });

  test("con nivel 2 no hay nota de pérdidas", async () => {
    await pintar({ risk_profile_level: 2, horizon_years: 10 });
    expect(host.querySelector('[data-testid="nota-de-perdidas"]')).toBeNull();
  });

  test("en Modo cliente no existe, ni se pregunta a la base (decisión 53)", async () => {
    await pintar({ risk_profile_level: 1, horizon_years: 3 }, true);
    expect(host.innerHTML).toBe("");
    expect(base.pedidas).toEqual([]);
  });
});

describe("fuera del papel (decisión 53)", () => {
  /* En happy-dom `import.meta.url` no es un fichero: la raíz es donde corre la suite. */
  const RAIZ = process.cwd();
  const ficheros = (carpeta: string): string[] =>
    readdirSync(carpeta).flatMap((nombre) => {
      const ruta = join(carpeta, nombre);
      return statSync(ruta).isDirectory() ? ficheros(ruta) : [ruta];
    });

  test("ningún informe lee los avisos del mercado objetivo ni su cableado", () => {
    for (const ruta of ficheros(join(RAIZ, "src", "reports"))) {
      const codigo = readFileSync(ruta, "utf8");
      expect(codigo, ruta).not.toMatch(/avisosDelMercadoObjetivo|AvisosDelMercadoObjetivo|mercadoObjetivoDeLaCartera|target_market/);
    }
  });
});
