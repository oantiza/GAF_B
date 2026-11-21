// @vitest-environment happy-dom
import { act } from "react";
import { readFileSync } from "node:fs";
import { URL as UrlDeNode } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Mensajes } from "../../src/components/ui/MensajeEfimero";
import { DURACION_DEL_MENSAJE_MS, useMensaje, vaciarLosMensajes } from "../../src/components/ui/useMensaje";
import { pintar, pulsar } from "./pintar";

/**
 * La pieza MensajeEfimero: «Guardado» llega a una región `aria-live="polite"` que está siempre en el documento, se va
 * sola a los cuatro segundos, espera mientras el foco está en ella y se puede cerrar con su botón.
 */
let quitar: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  quitar?.();
  quitar = undefined;
  act(() => vaciarLosMensajes());
  vi.useRealTimers();
});

function Guardar() {
  const { decir } = useMensaje();
  return (
    <button onClick={() => decir("Guardado")} type="button">
      Guardar
    </button>
  );
}

function pintarConRegion() {
  const vista = pintar(
    <>
      <Guardar />
      <Mensajes />
    </>
  );
  quitar = vista.quitar;
  const region = vista.host.querySelector(".mensajes")!;
  const guardar = vista.host.querySelector("button")!;
  return { vista, region, guardar };
}

describe("la pieza MensajeEfimero", () => {
  test("la región se anuncia con cortesía y está ahí antes de que llegue nada", () => {
    const { region } = pintarConRegion();
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });

  test("decir pone el mensaje, y se va solo a los cuatro segundos", () => {
    const { region, guardar } = pintarConRegion();
    pulsar(guardar);
    expect(region.querySelector(".mensaje__texto")?.textContent).toBe("Guardado");
    act(() => vi.advanceTimersByTime(DURACION_DEL_MENSAJE_MS - 1));
    expect(region.querySelectorAll(".mensaje")).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(region.querySelectorAll(".mensaje")).toHaveLength(0);
    expect(DURACION_DEL_MENSAJE_MS).toBe(4000);
  });

  test("se puede cerrar antes con su botón, que tiene nombre", () => {
    const { region, guardar } = pintarConRegion();
    pulsar(guardar);
    const cerrar = region.querySelector<HTMLButtonElement>(".mensaje__cerrar")!;
    expect(cerrar.tagName).toBe("BUTTON");
    expect(cerrar.getAttribute("aria-label")).toBe("Cerrar el mensaje");
    pulsar(cerrar);
    expect(region.querySelectorAll(".mensaje")).toHaveLength(0);
  });

  test("con el foco encima no se va; al salir, vuelve a contar", () => {
    const { region, guardar } = pintarConRegion();
    pulsar(guardar);
    const cerrar = region.querySelector<HTMLButtonElement>(".mensaje__cerrar")!;
    act(() => cerrar.focus());
    act(() => vi.advanceTimersByTime(DURACION_DEL_MENSAJE_MS * 3));
    expect(region.querySelectorAll(".mensaje")).toHaveLength(1);
    act(() => guardar.focus());
    act(() => vi.advanceTimersByTime(DURACION_DEL_MENSAJE_MS));
    /* El segundo «Guardado» no: el foco ha ido a Guardar, no se ha pulsado. Se ha ido el primero. */
    expect(region.querySelectorAll(".mensaje")).toHaveLength(0);
  });

  test("varios mensajes se apilan, cada uno con su cuenta", () => {
    const { region, guardar } = pintarConRegion();
    pulsar(guardar);
    act(() => vi.advanceTimersByTime(2000));
    pulsar(guardar);
    expect(region.querySelectorAll(".mensaje")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(2000));
    expect(region.querySelectorAll(".mensaje")).toHaveLength(1);
  });

  test("la región se monta una sola vez, en App", () => {
    const app = readFileSync(new UrlDeNode("../../src/App.tsx", import.meta.url), "utf8");
    expect(app.match(/<Mensajes \/>/g)).toHaveLength(1);
  });
});
