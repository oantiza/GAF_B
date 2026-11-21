// @vitest-environment happy-dom

/**
 * «Generar un borrador» (decisión 122): el contrato con el servidor, la tabla de renta variable que se dice antes de generar y la
 * pieza de pantalla, que primero enseña el borrador y solo lo usa cuando el asesor lo pide.
 */
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseBorrador, RENTA_VARIABLE_POR_NIVEL, type BorradorDeCartera } from "../src/adapters/generadorBackend";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { GeneradorDeBorrador } from "../src/components/GeneradorDeBorrador";
import { toAppError } from "../src/core/appError";
import { RISK_PROFILE_CONTRACTS } from "../src/core/riskProfilePreview";

const POSICION = {
  asset_id: "LU0000000001",
  nombre: "Amundi Funds - Global Equity A EUR (C)",
  bloque: "Renta variable global",
  peso_pct: 25,
  nota: 0.81,
  pilares: { calidad: 0.9, solidez: 0.8, consistencia: 0.7, coste: 0.4 },
  medidas: { sharpe_3a: 1.2 },
  gasto_corriente_pct: 1.93,
  patrimonio: 2.5e9,
  patrimonio_divisa: "EUR",
  anios: 22,
  indexado: false,
  candidatos_del_bloque: 13
};

const RESPUESTA = {
  metodo: "GENERADOR_V1",
  estado: "OK",
  nivel: 10,
  nombre_del_nivel: "Muy agresivo",
  renta_variable_pct: 100,
  num_fondos_pedidos: 4,
  minimo_de_fondos: 4,
  maximo_de_fondos: 19,
  incluir_indexados: false,
  ventana: { desde: "2021-10", hasta: "2026-10" },
  pesos: { calidad: 0.4, solidez: 0.3, consistencia: 0.2, coste: 0.1 },
  candidatos_por_bloque: { "Renta variable global": 13 },
  fuera_por_motivo: {},
  posiciones: [
    POSICION,
    { ...POSICION, asset_id: "LU0000000002", nombre: "DWS Invest II Global Equity", peso_pct: 25, nota: 0.75 },
    { ...POSICION, asset_id: "LU0000000003", nombre: "Goldman Sachs Europe CORE", bloque: "Renta variable Europa", peso_pct: 25 },
    { ...POSICION, asset_id: "LU0000000004", nombre: "BlackRock US Flexible", bloque: "Renta variable EE. UU.", peso_pct: 25 }
  ],
  avisos: [],
  gasto_corriente_medio_pct: 1.8
};

describe("el contrato del borrador", () => {
  test("la renta variable de cada nivel es la del servidor", () => {
    const python = readFileSync("functions_python/generador_de_carteras.py", "utf8");
    const tabla = /RENTA_VARIABLE_POR_NIVEL = \{([^}]*)\}/.exec(python)?.[1] ?? "";
    const servidor = Object.fromEntries([...tabla.matchAll(/(\d+):\s*(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]));
    expect(servidor).toEqual(RENTA_VARIABLE_POR_NIVEL);
    expect(Object.keys(servidor)).toHaveLength(10);
  });

  test("lee lo que manda el servidor, y no traga una respuesta rota", () => {
    const borrador = parseBorrador(RESPUESTA);
    expect(borrador.posiciones).toHaveLength(4);
    expect(borrador.posiciones[0].pilares.calidad).toBe(0.9);
    expect(borrador.ventana).toEqual({ desde: "2021-10", hasta: "2026-10" });
    expect(() => parseBorrador({ ...RESPUESTA, estado: "QUIZA" })).toThrow();
    expect(() => parseBorrador({ ...RESPUESTA, posiciones: [{ ...POSICION, peso_pct: "25" }] })).toThrow();
  });
});

describe("la pieza de pantalla", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

  async function pintar(props: Partial<Parameters<typeof GeneradorDeBorrador>[0]> = {}) {
    const onGenerar = props.onGenerar ?? vi.fn(async () => parseBorrador(RESPUESTA));
    const onUsar = props.onUsar ?? vi.fn();
    await act(async () => {
      root.render(<GeneradorDeBorrador perfiles={RISK_PROFILE_CONTRACTS} sustituye={false} {...props} onGenerar={onGenerar} onUsar={onUsar} />);
    });
    return { onGenerar, onUsar };
  }

  test("cada nivel dice su renta variable antes de generar", async () => {
    await pintar();
    const opciones = [...host.querySelectorAll("option")].map((o) => o.textContent);
    expect(opciones).toHaveLength(10);
    expect(opciones[0]).toBe("Nivel 1 - Preservación · 0\u00a0% de renta variable");
    expect(opciones[9]).toBe("Nivel 10 - Muy agresivo · 100\u00a0% de renta variable");
  });

  test("pide lo elegido, enseña el borrador y solo lo usa cuando se pulsa", async () => {
    const { onGenerar, onUsar } = await pintar();
    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = "10";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const casilla = host.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    await act(async () => casilla.click());
    await act(async () => boton("Generar borrador")!.click());
    expect(onGenerar).toHaveBeenCalledWith({ nivel: 10, num_fondos: 8, incluir_indexados: true });
    expect(host.textContent).toContain("Nivel 10 · Muy agresivo · 100\u00a0% de renta variable · 4 fondos · gasto corriente medio 1,80\u00a0%");
    expect(host.textContent).toContain("Borrador automático: no es una recomendación.");
    expect(host.textContent).toContain("Amundi Funds - Global Equity A EUR (C)");
    expect(host.textContent).toContain("81 de 100");
    expect(onUsar).not.toHaveBeenCalled();
    await act(async () => boton("Usar este borrador")!.click());
    expect(onUsar).toHaveBeenCalledTimes(1);
  });

  test("con posiciones, el botón dice que las sustituye", async () => {
    await pintar({ sustituye: true });
    await act(async () => boton("Generar borrador")!.click());
    expect(boton("Sustituir la cartera por este borrador")).toBeDefined();
  });

  test("si faltan fondos, lo dice con el mínimo y no ofrece usar nada", async () => {
    const faltan: BorradorDeCartera = { ...parseBorrador(RESPUESTA), estado: "FALTAN_FONDOS", posiciones: [], minimo_de_fondos: 6, maximo_de_fondos: 17,
      aviso: "El nivel 4 necesita al menos 6 fondos para no pasar del 25 % en ninguno ni mezclar partes de la cartera." };
    await pintar({ onGenerar: vi.fn(async () => faltan) });
    await act(async () => boton("Generar borrador")!.click());
    expect(host.textContent).toContain("necesita al menos 6 fondos");
    expect(host.textContent).toContain("Pide entre 6 y 17.");
    expect(boton("Usar este borrador")).toBeUndefined();
  });

  test("un número que no vale no deja generar", async () => {
    const { onGenerar } = await pintar();
    const numero = host.querySelector<HTMLInputElement>("input[type=number]")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(numero, "0");
      numero.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(boton("Generar borrador")!.disabled).toBe(true);
    expect(host.textContent).toContain("Un número entero del 1 al 30.");
    /* MAR-10: el aviso queda enlazado a su campo, que lo lee al llegar a él. */
    expect(document.getElementById(numero.getAttribute("aria-describedby")!)?.textContent).toBe("Un número entero del 1 al 30.");
    expect(onGenerar).not.toHaveBeenCalled();
  });

  test("el error del servidor se dice tal cual", async () => {
    await pintar({ onGenerar: vi.fn(async () => { throw new Error("El generador necesita la base nueva: la base de siempre no guarda el patrimonio de los fondos."); }) });
    await act(async () => boton("Generar borrador")!.click());
    expect(host.textContent).toContain("El generador necesita la base nueva");
  });

  /* 14-11-2026, visto por Óscar en local, donde el generador no puede trabajar: la pantalla decía «La operación no se
     puede ejecutar en el estado actual de los datos» y se callaba lo que el servidor explicaba. La prueba de arriba no
     lo veía porque lanza un error suelto; el que llega de verdad lo fabrica `toAppError` con la respuesta de la
     Function, y guarda las palabras del servidor en el detalle. */
  const MOTIVO = "El generador necesita la base nueva: la base de siempre no guarda el patrimonio de los fondos.";
  /* Como lo lanza el SDK de Firebase: un `Error` con su código, que `callBackend` pasa por `toAppError`. */
  const rechazoDelServidor = () => toAppError(Object.assign(new Error(MOTIVO), { code: "functions/failed-precondition" }));

  test("cuando el servidor dice que con estos datos no se puede, se lee su motivo y no la frase común del código", async () => {
    /* Desde el 15-11-2026 el texto del servidor es el mensaje del error; el genérico solo queda en Modo cliente. */
    expect(rechazoDelServidor().message).toBe(MOTIVO);
    expect(rechazoDelServidor().detail).toBeUndefined();
    await pintar({ onGenerar: vi.fn(async () => { throw rechazoDelServidor(); }) });
    await act(async () => boton("Generar borrador")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(MOTIVO);
  });

  test("en Modo cliente el motivo del servidor no se enseña: es cocina del asesor", async () => {
    await act(async () => {
      root.render(
        <ClientModeProvider initialValue>
          <GeneradorDeBorrador onGenerar={vi.fn(async () => { throw rechazoDelServidor(); })} onUsar={vi.fn()} perfiles={RISK_PROFILE_CONTRACTS} sustituye={false} />
        </ClientModeProvider>
      );
    });
    await act(async () => boton("Generar borrador")!.click());
    const aviso = host.querySelector('[role="alert"]')?.textContent ?? "";
    expect(aviso).toBe("La operación no se puede ejecutar en el estado actual de los datos.");
    expect(host.textContent).not.toContain("base nueva");
  });
});
