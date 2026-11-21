// @vitest-environment happy-dom

/**
 * El ciclo de vida de la cartera activa (hallazgo 47): qué pasa cuando algo va a sustituir una cartera con
 * cambios sin guardar. Se prueba el recorrido entero del marco, con su diálogo de verdad.
 */
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useCicloDeCartera, type CicloDeCartera } from "../src/app/useCicloDeCartera";
import { avisarCarterasGuardadas } from "../src/core/carterasGuardadasAvisos";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { disenoEnSesion } from "../src/core/disenoEnSesion";
import { OPEN_PORTFOLIO_STORAGE_KEY } from "../src/core/localPortfolioStorage";
import type { BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

const guardado = vi.hoisted(() => ({ guardarCartera: vi.fn(), comprobarLaGuardada: vi.fn() }));
vi.mock("../src/core/guardarCartera", () => ({ guardarCartera: guardado.guardarCartera, comprobarLaGuardada: guardado.comprobarLaGuardada }));

const POSICIONES: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 60 },
  { asset_id: "B", weight_percent: 40 }
];

const GUARDADA: BdbSavedLocalPortfolio = {
  portfolio_id: "p1",
  name: "Cliente",
  created_at: "2026-11-01T10:00:00.000Z",
  updated_at: "2026-11-01T10:00:00.000Z",
  sourceKind: "LOCAL_MOCK",
  positions: POSICIONES,
  total_capital: 250000
};

let root: Root;
let host: HTMLDivElement;
let ciclo: CicloDeCartera;
let contenido: { positions: BdbManualPortfolioPosition[]; capital: number | undefined; nombre: string };
let ponerPosiciones: (posiciones: BdbManualPortfolioPosition[]) => void;

function Marco({ inicial }: { inicial: BdbManualPortfolioPosition[] }) {
  const [positions, setPositions] = useState(inicial);
  const [capital, setCapital] = useState<number | undefined>(undefined);
  const [nombre, setNombre] = useState("");
  const delMarco = useCicloDeCartera({ sourceKind: "LOCAL_MOCK", positions, capital, nombre, setPositions, setCapital, setNombre });
  useEffect(() => {
    ciclo = delMarco;
    contenido = { positions, capital, nombre };
    ponerPosiciones = setPositions;
  }, [delMarco, positions, capital, nombre]);
  return createElement("div", null, delMarco.dialogo);
}

async function montar(inicial: BdbManualPortfolioPosition[] = POSICIONES) {
  await act(async () => {
    root.render(createElement(Marco, { inicial }));
  });
}

const boton = (texto: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;

/** Pide la guardia y espera a que el diálogo, que se carga aparte, esté en pantalla. */
async function pedirGuardia(accion: () => void) {
  await act(async () => ciclo.conGuardia(accion));
  for (let intento = 0; intento < 50 && !document.querySelector('[role="dialog"]'); intento += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function pulsar(texto: string) {
  const elegido = boton(texto);
  if (!elegido) throw new Error(`No aparece el botón ${texto}`);
  await act(async () => {
    elegido.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  clearSessionCaches();
  guardado.guardarCartera.mockReset();
  /* Lo normal: la guardada sigue como se abrió. Los casos en que no, en «dos pestañas o dos equipos». */
  guardado.comprobarLaGuardada.mockReset();
  guardado.comprobarLaGuardada.mockResolvedValue({ estado: "igual" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("la guardia", () => {
  test("sin nada que perder, la acción pasa sin preguntar", async () => {
    await montar([]);
    const accion = vi.fn();
    await act(async () => ciclo.conGuardia(accion));
    expect(accion).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("una cartera abierta y sin tocar tampoco pregunta", async () => {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }, GUARDADA));
    expect(ciclo.sinGuardar).toBe(false);
    const accion = vi.fn();
    await act(async () => ciclo.conGuardia(accion));
    expect(accion).toHaveBeenCalledTimes(1);
  });

  test("con cambios pregunta, con el nombre de la cartera y las tres salidas", async () => {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }, GUARDADA));
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 300000, nombre: "Cliente" }));
    const accion = vi.fn();
    await pedirGuardia(accion);
    expect(accion).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("La cartera Cliente tiene cambios sin guardar");
    for (const texto of ["Guardar y continuar", "Descartar", "Cancelar"]) expect(boton(texto)).toBeTruthy();
    await pulsar("Cancelar");
    expect(accion).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("«Cancelar» arranca con el foco: un Intro de más no se lleva la cartera", async () => {
    await montar();
    await pedirGuardia(() => undefined);
    expect(document.activeElement?.textContent).toBe("Cancelar");
    await pulsar("Cancelar");
  });

  test("«Descartar» sigue sin guardar", async () => {
    await montar();
    const accion = vi.fn();
    await pedirGuardia(accion);
    await pulsar("Descartar");
    expect(accion).toHaveBeenCalledTimes(1);
    expect(guardado.guardarCartera).not.toHaveBeenCalled();
  });

  test("«Guardar y continuar» guarda y después sigue", async () => {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }));
    guardado.guardarCartera.mockResolvedValue({ ok: true, cartera: GUARDADA, positions: POSICIONES, mensaje: "ok" });
    const accion = vi.fn();
    await pedirGuardia(accion);
    await pulsar("Guardar y continuar");
    expect(guardado.guardarCartera).toHaveBeenCalledTimes(1);
    expect(guardado.guardarCartera.mock.calls[0][0]).toMatchObject({ nombre: "Cliente", capital: 250000, sobre: null });
    expect(accion).toHaveBeenCalledTimes(1);
    expect(ciclo.abierta?.portfolio_id).toBe("p1");
    expect(ciclo.sinGuardar).toBe(false);
  });

  test("si guardar falla, el diálogo se queda, dice por qué, y la acción no sigue", async () => {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }));
    guardado.guardarCartera.mockResolvedValue({ ok: false, mensaje: "No se ha podido guardar Cliente." });
    const accion = vi.fn();
    await pedirGuardia(accion);
    await pulsar("Guardar y continuar");
    expect(accion).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("No se ha podido guardar Cliente.");
    expect(ciclo.sinGuardar).toBe(true);
    await pulsar("Cancelar");
  });

  test("una cartera sin nombre lo pide antes de guardar: no se guarda «sin nombre»", async () => {
    await montar();
    await pedirGuardia(() => undefined);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("La cartera activa tiene cambios sin guardar");
    expect(boton("Guardar y continuar")?.disabled).toBe(true);
    await pulsar("Cancelar");
  });
});

describe("guardar y abrir", () => {
  test("«Guardar» manda el identificador de la abierta; «Guardar como…», ninguno", async () => {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }, GUARDADA));
    guardado.guardarCartera.mockResolvedValue({ ok: true, cartera: GUARDADA, positions: POSICIONES, mensaje: "ok" });
    await act(async () => {
      await ciclo.guardar();
    });
    expect(guardado.guardarCartera.mock.calls[0][0].sobre).toMatchObject({ portfolio_id: "p1", created_at: GUARDADA.created_at });
    await act(async () => {
      await ciclo.guardar({ nombre: "Otra", comoNueva: true });
    });
    expect(guardado.guardarCartera.mock.calls[1][0].sobre).toBeNull();
    expect(guardado.guardarCartera.mock.calls[1][0].nombre).toBe("Otra");
    expect(contenido.nombre).toBe("Otra");
  });

  test("si una posición no invertible se queda fuera, lo de la pantalla no consta como guardado", async () => {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }));
    guardado.guardarCartera.mockResolvedValue({ ok: true, cartera: GUARDADA, positions: [POSICIONES[0]], mensaje: "ok" });
    await act(async () => {
      await ciclo.guardar();
    });
    expect(ciclo.abierta?.portfolio_id).toBe("p1");
    expect(ciclo.sinGuardar).toBe(true);
  });

  test("qué cartera está abierta sobrevive a recargar: la siguiente vez no se guarda una copia", async () => {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }, GUARDADA));
    expect(JSON.parse(localStorage.getItem(OPEN_PORTFOLIO_STORAGE_KEY) ?? "{}").portfolio_id).toBe("p1");
    await act(async () => root.unmount());
    root = createRoot(host);
    await montar();
    expect(ciclo.abierta?.portfolio_id).toBe("p1");
  });

  test("si se elimina la abierta, lo de la pantalla se queda y ya no parte de ninguna", async () => {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }, GUARDADA));
    await act(async () => avisarCarterasGuardadas({ tipo: "eliminada", id: "otra" }));
    expect(ciclo.abierta?.portfolio_id).toBe("p1");
    await act(async () => avisarCarterasGuardadas({ tipo: "eliminada", id: "p1" }));
    expect(ciclo.abierta).toBeNull();
    expect(contenido.positions).toHaveLength(2);
    expect(ciclo.sinGuardar).toBe(true);
    expect(localStorage.getItem(OPEN_PORTFOLIO_STORAGE_KEY)).toBeNull();
  });
});

describe("sustituir la cartera", () => {
  test("olvida el trabajo de la anterior: los candados de un cliente no se aplican al siguiente", async () => {
    await montar();
    disenoEnSesion.write({ ...disenoEnSesion.read(), locks: { A: true }, step: "optimize" });
    const generacion = ciclo.generacion;
    await act(async () => ciclo.sustituir({ positions: [], capital: undefined, nombre: "" }));
    expect(disenoEnSesion.read().locks).toEqual({});
    expect(disenoEnSesion.read().step).toBe("compose");
    expect(ciclo.generacion).toBe(generacion + 1);
    expect(contenido).toEqual({ positions: [], capital: undefined, nombre: "" });
  });
});

describe("cerrar la pestaña", () => {
  const cerrar = () => {
    const evento = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(evento);
    return evento.defaultPrevented;
  };

  test("avisa si hay cambios sin guardar, y solo entonces", async () => {
    await montar();
    expect(cerrar()).toBe(true);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }, GUARDADA));
    expect(ciclo.sinGuardar).toBe(false);
    expect(cerrar()).toBe(false);
  });
});

describe("«Guardar y continuar» no sigue a ciegas", () => {
  async function conCambios() {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }, GUARDADA));
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 300000, nombre: "Cliente" }));
  }

  test("si lo guardado trae un aviso, lo enseña y la acción espera", async () => {
    await conCambios();
    guardado.guardarCartera.mockResolvedValue({
      ok: true,
      cartera: GUARDADA,
      positions: [POSICIONES[0]],
      mensaje: "Cliente guardada en este navegador. Una posición no invertible se queda sin guardar.",
      conAvisos: true
    });
    const accion = vi.fn();
    await pedirGuardia(accion);
    await pulsar("Guardar y continuar");
    expect(accion).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Una posición no invertible se queda sin guardar.");
    await pulsar("Continuar");
    expect(accion).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("«Quedarme aquí» no sustituye nada", async () => {
    await conCambios();
    guardado.guardarCartera.mockResolvedValue({ ok: true, cartera: GUARDADA, positions: POSICIONES, mensaje: "Aviso del servidor.", conAvisos: true });
    const accion = vi.fn();
    await pedirGuardia(accion);
    await pulsar("Guardar y continuar");
    await pulsar("Quedarme aquí");
    expect(accion).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("sin avisos, sigue sola", async () => {
    await conCambios();
    guardado.guardarCartera.mockResolvedValue({ ok: true, cartera: GUARDADA, positions: POSICIONES, mensaje: "Guardada.", conAvisos: false });
    const accion = vi.fn();
    await pedirGuardia(accion);
    await pulsar("Guardar y continuar");
    expect(accion).toHaveBeenCalledTimes(1);
  });

  test("sin posiciones no ofrece guardar: dejaría vacía la cartera guardada", async () => {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }, GUARDADA));
    await act(async () => ponerPosiciones([]));
    const accion = vi.fn();
    await pedirGuardia(accion);
    expect(boton("Guardar y continuar")).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("no hay nada que guardar");
    await pulsar("Descartar");
    expect(accion).toHaveBeenCalledTimes(1);
    expect(guardado.guardarCartera).not.toHaveBeenCalled();
  });

  test("Intro en el nombre guarda y continúa, solo si hay nombre", async () => {
    await montar();
    guardado.guardarCartera.mockResolvedValue({ ok: true, cartera: GUARDADA, positions: POSICIONES, mensaje: "Guardada.", conAvisos: false });
    const accion = vi.fn();
    await pedirGuardia(accion);
    const formulario = document.querySelector('[role="dialog"] form') as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(guardado.guardarCartera).not.toHaveBeenCalled();
    const campo = formulario.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "Cliente nuevo");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      formulario.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(guardado.guardarCartera).toHaveBeenCalledTimes(1);
    expect(accion).toHaveBeenCalledTimes(1);
  });
});

/*
 * DIS-03: «Guardar» sobrescribía la abierta sin mirar si había cambiado desde que se abrió: dos pestañas o dos
 * equipos se pisaban sin aviso. Ahora se vuelve a leer antes, y si ha cambiado o ya no existe, se pregunta.
 */
describe("dos pestañas o dos equipos: «Guardar» no pisa en silencio", () => {
  async function abiertaConCambios() {
    await montar([]);
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 250000, nombre: "Cliente" }, GUARDADA));
    await act(async () => ponerPosiciones([{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }]));
    guardado.guardarCartera.mockResolvedValue({ ok: true, cartera: { ...GUARDADA, updated_at: "2026-11-13T12:00:00.000Z" }, positions: POSICIONES, mensaje: "ok" });
  }

  /** Pulsa «Guardar» y espera a que salga la pregunta, que se carga aparte. */
  async function guardarYEsperarPregunta(): Promise<{ enCurso: Promise<{ ok: boolean; mensaje: string }> }> {
    let enCurso!: Promise<{ ok: boolean; mensaje: string }>;
    await act(async () => {
      enCurso = ciclo.guardar();
    });
    for (let intento = 0; intento < 50 && !document.querySelector('[role="dialog"]'); intento += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    /* En un objeto: una promesa devuelta tal cual por una función async se esperaría con ella. */
    return { enCurso };
  }

  test("si sigue como se abrió, sobrescribe sin preguntar, comparando su fecha de modificación", async () => {
    await abiertaConCambios();
    await act(async () => {
      await ciclo.guardar();
    });
    expect(guardado.comprobarLaGuardada).toHaveBeenCalledWith("LOCAL_MOCK", expect.objectContaining({ portfolio_id: "p1", updated_at: GUARDADA.updated_at }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(guardado.guardarCartera.mock.calls[0][0].sobre).toMatchObject({ portfolio_id: "p1" });
  });

  test("«Guardar como…» no la comprueba: no la toca", async () => {
    await abiertaConCambios();
    await act(async () => {
      await ciclo.guardar({ nombre: "Otra", comoNueva: true });
    });
    expect(guardado.comprobarLaGuardada).not.toHaveBeenCalled();
  });

  /* Rediseño del 14-11-2026: el botón dice «propuesta», como el resto de Diseño (antes, «cartera»). */
  test("si ha cambiado, pregunta; «Guardar como una propuesta nueva» no la toca", async () => {
    await abiertaConCambios();
    guardado.comprobarLaGuardada.mockResolvedValue({ estado: "cambiada" });
    const { enCurso } = await guardarYEsperarPregunta();
    expect(guardado.guardarCartera).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("ha cambiado desde que la abriste");
    for (const texto of ["Guardar como una propuesta nueva", "Sobrescribir de todos modos", "Cancelar"]) expect(boton(texto)).toBeTruthy();
    await pulsar("Guardar como una propuesta nueva");
    const resultado = await enCurso;
    expect(resultado.ok).toBe(true);
    expect(guardado.guardarCartera).toHaveBeenCalledTimes(1);
    expect(guardado.guardarCartera.mock.calls[0][0].sobre).toBeNull();
  });

  test("si ha cambiado, «Sobrescribir de todos modos» la sobrescribe", async () => {
    await abiertaConCambios();
    guardado.comprobarLaGuardada.mockResolvedValue({ estado: "cambiada" });
    const { enCurso } = await guardarYEsperarPregunta();
    await pulsar("Sobrescribir de todos modos");
    await enCurso;
    expect(guardado.guardarCartera.mock.calls[0][0].sobre).toMatchObject({ portfolio_id: "p1" });
  });

  test("«Cancelar» no guarda nada y lo dice", async () => {
    await abiertaConCambios();
    guardado.comprobarLaGuardada.mockResolvedValue({ estado: "cambiada" });
    const { enCurso } = await guardarYEsperarPregunta();
    await pulsar("Cancelar");
    const resultado = await enCurso;
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain("No se ha guardado");
    expect(guardado.guardarCartera).not.toHaveBeenCalled();
    expect(ciclo.sinGuardar).toBe(true);
  });

  test("si ya no existe, no ofrece sobrescribirla: solo guardarla como nueva", async () => {
    await abiertaConCambios();
    guardado.comprobarLaGuardada.mockResolvedValue({ estado: "eliminada" });
    const { enCurso } = await guardarYEsperarPregunta();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("ya no existe");
    expect(boton("Sobrescribir de todos modos")).toBeUndefined();
    await pulsar("Guardar como una propuesta nueva");
    await enCurso;
    expect(guardado.guardarCartera.mock.calls[0][0].sobre).toBeNull();
  });

  test("si no se ha podido comprobar, tampoco sobrescribe sin preguntar", async () => {
    await abiertaConCambios();
    guardado.comprobarLaGuardada.mockResolvedValue({ estado: "sin-comprobar" });
    const { enCurso } = await guardarYEsperarPregunta();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("No se ha podido comprobar");
    await pulsar("Cancelar");
    await enCurso;
    expect(guardado.guardarCartera).not.toHaveBeenCalled();
  });

  test("si otra pestaña la ha guardado, pregunta aunque la lectura llegue con la lista de antes", async () => {
    await abiertaConCambios();
    await act(async () =>
      avisarCarterasGuardadas({ tipo: "guardada", cartera: { ...GUARDADA, updated_at: "2026-11-13T11:00:00.000Z" }, deOtraPestana: true })
    );
    const { enCurso } = await guardarYEsperarPregunta();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("ha cambiado desde que la abriste");
    await pulsar("Cancelar");
    await enCurso;
    expect(guardado.guardarCartera).not.toHaveBeenCalled();
  });

  test("tras la comprobación previa, «Sobrescribir de todos modos» guarda sin condición", async () => {
    await abiertaConCambios();
    guardado.comprobarLaGuardada.mockResolvedValue({ estado: "cambiada" });
    const { enCurso } = await guardarYEsperarPregunta();
    await pulsar("Sobrescribir de todos modos");
    await enCurso;
    expect(guardado.guardarCartera.mock.calls[0][0]).toMatchObject({ sobre: { portfolio_id: "p1" }, forzar: true });
  });

  /* El control del servidor: lo que se cuela entre la comprobación previa y el guardado lo rechaza él. */
  const CONFLICTO_CAMBIADA = { ok: false, conflicto: "cambiada", mensaje: "No se ha guardado: la cartera guardada ha cambiado desde que la abriste." };
  const CONFLICTO_ELIMINADA = { ok: false, conflicto: "eliminada", mensaje: "No se ha guardado: la cartera guardada ya no existe." };

  test("sin elegir nada, manda como condición la fecha de modificación con que se abrió", async () => {
    await abiertaConCambios();
    await act(async () => {
      await ciclo.guardar();
    });
    expect(guardado.guardarCartera.mock.calls[0][0].sobre).toMatchObject({ portfolio_id: "p1", updated_at: GUARDADA.updated_at });
    expect(guardado.guardarCartera.mock.calls[0][0].forzar).toBeFalsy();
  });

  test("si el servidor la rechaza porque ha cambiado, pregunta con el mismo diálogo; «Sobrescribir de todos modos» guarda sin condición", async () => {
    await abiertaConCambios();
    guardado.guardarCartera.mockResolvedValueOnce(CONFLICTO_CAMBIADA);
    const { enCurso } = await guardarYEsperarPregunta();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("ha cambiado desde que la abriste");
    expect(guardado.guardarCartera).toHaveBeenCalledTimes(1);
    await pulsar("Sobrescribir de todos modos");
    const resultado = await enCurso;
    expect(resultado.ok).toBe(true);
    expect(guardado.guardarCartera).toHaveBeenCalledTimes(2);
    expect(guardado.guardarCartera.mock.calls[1][0]).toMatchObject({ sobre: { portfolio_id: "p1" }, forzar: true });
    expect(ciclo.abierta?.updated_at).toBe("2026-11-13T12:00:00.000Z");
  });

  test("si el servidor dice que ya no existe, solo ofrece guardarla como nueva", async () => {
    await abiertaConCambios();
    guardado.guardarCartera.mockResolvedValueOnce(CONFLICTO_ELIMINADA);
    const { enCurso } = await guardarYEsperarPregunta();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("ya no existe");
    expect(boton("Sobrescribir de todos modos")).toBeUndefined();
    await pulsar("Guardar como una propuesta nueva");
    await enCurso;
    expect(guardado.guardarCartera.mock.calls[1][0].sobre).toBeNull();
  });

  test("ante el rechazo del servidor, «Cancelar» no guarda nada más y lo dice", async () => {
    await abiertaConCambios();
    guardado.guardarCartera.mockResolvedValueOnce(CONFLICTO_CAMBIADA);
    const { enCurso } = await guardarYEsperarPregunta();
    await pulsar("Cancelar");
    const resultado = await enCurso;
    expect(resultado.ok).toBe(false);
    expect(resultado.mensaje).toContain("No se ha guardado");
    expect(guardado.guardarCartera).toHaveBeenCalledTimes(1);
    expect(ciclo.sinGuardar).toBe(true);
  });

  test("dos guardados seguidos desde la misma pantalla no chocan: el segundo usa la fecha que devolvió el servidor", async () => {
    await abiertaConCambios();
    /* Un servidor con el control: solo escribe si la condición es la fecha de lo que tiene, y devuelve la nueva. */
    let enElServidor = GUARDADA.updated_at;
    let reloj = 0;
    guardado.guardarCartera.mockImplementation(async (peticion: { sobre?: { updated_at?: string } | null; forzar?: boolean }) => {
      if (peticion.sobre && !peticion.forzar && peticion.sobre.updated_at !== enElServidor) return CONFLICTO_CAMBIADA;
      reloj += 1;
      enElServidor = `2026-11-14T10:00:0${reloj}.000Z`;
      return { ok: true, cartera: { ...GUARDADA, updated_at: enElServidor }, positions: contenido.positions, mensaje: "ok" };
    });
    await act(async () => {
      await ciclo.guardar();
    });
    await act(async () => ponerPosiciones([{ asset_id: "A", weight_percent: 70 }, { asset_id: "B", weight_percent: 30 }]));
    let segundo!: { ok: boolean };
    await act(async () => {
      segundo = await ciclo.guardar();
    });
    expect(segundo.ok).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(guardado.guardarCartera.mock.calls[1][0].sobre.updated_at).toBe("2026-11-14T10:00:01.000Z");
  });

  test("lo que guarda esta misma pestaña no cuenta como un cambio de fuera", async () => {
    await abiertaConCambios();
    await act(async () => {
      await ciclo.guardar();
    });
    await act(async () => ciclo.sustituir({ positions: POSICIONES, capital: 350000, nombre: "Cliente" }, { ...GUARDADA, updated_at: "2026-11-13T12:00:00.000Z" }));
    await act(async () =>
      avisarCarterasGuardadas({ tipo: "guardada", cartera: { ...GUARDADA, updated_at: "2026-11-13T12:00:00.000Z" } })
    );
    await act(async () => {
      await ciclo.guardar();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(guardado.guardarCartera).toHaveBeenCalledTimes(2);
  });
});
