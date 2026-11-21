// @vitest-environment happy-dom

/**
 * Decisión 59 en pantalla: los dos controles de Diseño de cartera, la cartera abierta que queda con cambios
 * sin guardar al tocarlos, y la cifra en Carteras guardadas. «Sin definir» se ve; nada viene puesto.
 */
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

const backend = vi.hoisted(() => ({ list: vi.fn() }));
const guardado = vi.hoisted(() => ({ guardarCartera: vi.fn() }));

vi.mock("../src/adapters/portfolioBackend", () => ({
  usesBackendPersistence: () => true,
  backendListPortfolioResult: backend.list,
  backendSavePortfolio: vi.fn(),
  backendDeletePortfolio: vi.fn()
}));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({ getComparableAssets: async () => [] })
}));
/* DIS-03: antes de sobrescribir, el ciclo comprueba que la guardada no ha cambiado. Aquí no ha cambiado. */
vi.mock("../src/core/guardarCartera", () => ({ guardarCartera: guardado.guardarCartera, comprobarLaGuardada: async () => ({ estado: "igual" }) }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { useCicloDeCartera, type CicloDeCartera } from "../src/app/useCicloDeCartera";
import { PerfilYHorizonteDeLaCartera } from "../src/components/PerfilYHorizonteDeLaCartera";
import { CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY } from "../src/core/localPortfolioStorage";
import type { PerfilYHorizonte } from "../src/core/perfilYHorizonte";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { CarterasGuardadasPage } from "../src/pages/CarterasGuardadasPage";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  clearSessionCaches();
  backend.list.mockReset();
  guardado.guardarCartera.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const selector = () => host.querySelector<HTMLSelectElement>('select[aria-label="Nivel de perfil de riesgo de la cartera"]')!;
const campo = () => host.querySelector<HTMLInputElement>('input[aria-label="Horizonte de la cartera en años"]')!;

async function elegirNivel(valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(selector(), valor);
    selector().dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function escribirHorizonte(texto: string, confirmar: "blur" | "enter" = "blur") {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo(), texto);
    campo().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    if (confirmar === "enter") campo().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    else campo().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("los dos controles", () => {
  let recibido: PerfilYHorizonte[];

  function Controles({ inicial }: { inicial: PerfilYHorizonte }) {
    const [valor, setValor] = useState(inicial);
    return createElement(PerfilYHorizonteDeLaCartera, {
      valor,
      onChange: (siguiente: PerfilYHorizonte) => {
        recibido.push(siguiente);
        setValor(siguiente);
      }
    });
  }

  let montaje = 0;
  /* Cada montaje es otro componente: el estado del anterior no pasa. */
  async function montar(inicial: PerfilYHorizonte = {}) {
    recibido = [];
    montaje += 1;
    await act(async () => root.render(createElement(Controles, { inicial, key: montaje })));
  }

  test("sin nada puesto, los dos dicen «Sin definir»", async () => {
    await montar();
    expect(selector().value).toBe("");
    expect(selector().selectedOptions[0].textContent).toBe("Sin definir");
    expect(campo().value).toBe("");
    expect(campo().placeholder).toBe("Sin definir");
    expect(host.textContent).not.toContain("años");
    expect([...selector().options].map((opcion) => opcion.value)).toEqual(["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  });

  test("el nivel se elige de la escala de diez y se puede volver a «Sin definir», sin dejar la clave", async () => {
    await montar();
    await elegirNivel("5");
    expect(recibido.at(-1)).toEqual({ risk_profile_level: 5 });
    expect(selector().selectedOptions[0].textContent).toBe("5 · Equilibrado");
    await elegirNivel("");
    expect(recibido.at(-1)).toEqual({});
    expect("risk_profile_level" in recibido.at(-1)!).toBe(false);
  });

  test("elegir el nivel no pone horizonte, ni escribir el horizonte pone nivel", async () => {
    await montar();
    await elegirNivel("9");
    expect(campo().value).toBe("");
    await escribirHorizonte("3");
    expect(recibido.at(-1)).toEqual({ risk_profile_level: 9, horizon_years: 3 });
    await montar();
    await escribirHorizonte("7");
    expect(recibido.at(-1)).toEqual({ horizon_years: 7 });
    expect(selector().value).toBe("");
  });

  test("el horizonte admite coma, con Intro o al salir, y vaciarlo lo quita", async () => {
    await montar();
    await escribirHorizonte("2,5", "enter");
    expect(recibido.at(-1)).toEqual({ horizon_years: 2.5 });
    expect(campo().value).toBe("2,5");
    expect(host.textContent).toContain("años");
    await escribirHorizonte("");
    expect(recibido.at(-1)).toEqual({});
  });

  test("cero, negativo o texto se rechazan con el motivo, y no cambian lo guardado", async () => {
    await montar({ horizon_years: 5 });
    await escribirHorizonte("0");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("El horizonte debe ser mayor que cero años.");
    expect(campo().getAttribute("aria-invalid")).toBe("true");
    await escribirHorizonte("cinco años");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("El horizonte debe ser un número de años.");
    expect(recibido).toEqual([]);
    await escribirHorizonte("6");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(recibido).toEqual([{ horizon_years: 6 }]);
  });

  test("si el valor cambia desde fuera (otra cartera), el campo lo sigue", async () => {
    await montar({ risk_profile_level: 2, horizon_years: 4 });
    expect(selector().value).toBe("2");
    expect(campo().value).toBe("4");
  });
});

describe("la cartera abierta", () => {
  const POSICIONES: BdbManualPortfolioPosition[] = [{ asset_id: "LU0000000001", weight_percent: 100 }];
  const GUARDADA: BdbSavedLocalPortfolio = {
    portfolio_id: "p1",
    name: "Cliente",
    created_at: "2026-11-01T10:00:00.000Z",
    updated_at: "2026-11-01T10:00:00.000Z",
    sourceKind: "LOCAL_MOCK",
    positions: POSICIONES,
    risk_profile_level: 4,
    horizon_years: 3
  };
  let ciclo: CicloDeCartera;

  function Marco() {
    const [positions, setPositions] = useState(POSICIONES);
    const [capital, setCapital] = useState<number | undefined>(undefined);
    const [nombre, setNombre] = useState("Cliente");
    const delMarco = useCicloDeCartera({ sourceKind: "LOCAL_MOCK", positions, capital, nombre, setPositions, setCapital, setNombre });
    useEffect(() => {
      ciclo = delMarco;
    }, [delMarco]);
    return null;
  }

  async function montar() {
    await act(async () => root.render(createElement(Marco)));
  }

  test("abrirla trae los suyos; cambiarlos deja cambios sin guardar; deshacerlo los quita", async () => {
    await montar();
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: undefined, nombre: "Cliente", perfilYHorizonte: { risk_profile_level: 4, horizon_years: 3 } }, GUARDADA));
    expect(ciclo.perfilYHorizonte).toEqual({ risk_profile_level: 4, horizon_years: 3 });
    expect(ciclo.sinGuardar).toBe(false);
    await act(async () => ciclo.fijarPerfilYHorizonte({ risk_profile_level: 6, horizon_years: 3 }));
    expect(ciclo.sinGuardar).toBe(true);
    await act(async () => ciclo.fijarPerfilYHorizonte({ risk_profile_level: 4, horizon_years: 3 }));
    expect(ciclo.sinGuardar).toBe(false);
  });

  test("«Guardar» los manda con la cartera, y lo guardado manda: si no vuelven, siguen sin guardar", async () => {
    await montar();
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: undefined, nombre: "Cliente" }, { ...GUARDADA, risk_profile_level: undefined, horizon_years: undefined }));
    await act(async () => ciclo.fijarPerfilYHorizonte({ horizon_years: 5 }));
    guardado.guardarCartera.mockResolvedValueOnce({ ok: true, cartera: { ...GUARDADA, risk_profile_level: undefined, horizon_years: 5 }, positions: POSICIONES, mensaje: "ok", conAvisos: false });
    await act(async () => void (await ciclo.guardar()));
    expect(guardado.guardarCartera).toHaveBeenCalledWith(expect.objectContaining({ perfilYHorizonte: { horizon_years: 5 }, sobre: expect.objectContaining({ portfolio_id: "p1" }) }));
    expect(ciclo.sinGuardar).toBe(false);
    /* Unas Functions sin desplegar descartan los campos: la pantalla no puede decir que se han guardado. */
    await act(async () => ciclo.fijarPerfilYHorizonte({ horizon_years: 8 }));
    guardado.guardarCartera.mockResolvedValueOnce({ ok: true, cartera: { ...GUARDADA, risk_profile_level: undefined, horizon_years: undefined }, positions: POSICIONES, mensaje: "ok", conAvisos: false });
    await act(async () => void (await ciclo.guardar()));
    expect(ciclo.sinGuardar).toBe(true);
  });

  test("otra cartera, una importación o «Nueva cartera» no heredan los de la anterior; se recuerdan al recargar", async () => {
    await montar();
    await act(async () => ciclo.fijarPerfilYHorizonte({ risk_profile_level: 8 }));
    expect(JSON.parse(localStorage.getItem(CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY) ?? "{}")).toMatchObject({ risk_profile_level: 8 });
    await act(async () => root.render(createElement("div")));
    await montar();
    expect(ciclo.perfilYHorizonte).toEqual({ risk_profile_level: 8 });
    await act(async () => ciclo.sustituir({ positions: [], capital: undefined, nombre: "" }));
    expect(ciclo.perfilYHorizonte).toEqual({});
    expect(localStorage.getItem(CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY)).toBeNull();
  });
});

describe("Carteras guardadas", () => {
  const cartera = (id: string, extra: Partial<BdbSavedLocalPortfolio>): BdbSavedLocalPortfolio => ({
    portfolio_id: id,
    name: `Cliente ${id}`,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: `2026-11-0${id === "a" ? 2 : 1}T10:00:00Z`,
    sourceKind: "BBDD_LIVE_API",
    positions: [{ asset_id: "LU0000000001", weight_percent: 100 }],
    ...extra
  });

  test("cada cartera dice su perfil y su horizonte, o que están sin definir; abrirla los lleva a Diseño", async () => {
    backend.list.mockResolvedValue({ portfolios: [cartera("a", { risk_profile_level: 3, horizon_years: 5 }), cartera("b", {})], discarded: [] });
    const sustituir = vi.fn();
    const ciclo = { abierta: null, sinGuardar: false, guardando: false, generacion: 0, conGuardia: (accion: () => void) => accion(), sustituir, guardar: vi.fn(), dialogo: null };
    await act(async () =>
      root.render(
        createElement(ClientModeProvider, {
          initialValue: false,
          children: createElement(CarterasGuardadasPage, { sourceKind: "BBDD_LIVE_API", ciclo: ciclo as unknown as CicloDeCartera, onIrA: () => undefined })
        })
      )
    );
    await act(async () => new Promise((listo) => setTimeout(listo, 0)));
    const cabecera = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(cabecera).toEqual(expect.arrayContaining(["Perfil", "Horizonte"]));
    const filas = [...host.querySelectorAll("tbody tr")];
    expect(filas[0].querySelector("td .tabla__apunte")?.textContent).toBe("Moderado bajo");
    expect(filas[0].textContent).toContain("5 años");
    expect([...filas[1].querySelectorAll(".tabla__celda--no-aplica")].map((celda) => celda.textContent)).toEqual(
      expect.arrayContaining(["Sin definir", "Sin definir"])
    );
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Abrir Cliente a en Diseño de cartera")!.click());
    expect(sustituir).toHaveBeenCalledWith(
      expect.objectContaining({ perfilYHorizonte: { risk_profile_level: 3, horizon_years: 5 } }),
      expect.objectContaining({ portfolio_id: "a" })
    );
  });
});
