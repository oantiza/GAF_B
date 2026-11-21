// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { usePestanaEnLaDireccion } from "../../src/core/usePestanaEnLaDireccion";
import { pintar, pulsar } from "./pintar";

/**
 * `usePestanaEnLaDireccion`: la pestaña va al final de la dirección (`#pestana=…`) sin pisar lo que ya haya allí, se
 * recupera al cargar y con «Atrás», y la inicial no se escribe.
 */
const PESTANAS = ["resumen", "exposicion", "datos"] as const;
type Pestana = (typeof PESTANAS)[number];

function Pantalla() {
  const [pestana, elegir] = usePestanaEnLaDireccion<Pestana>(PESTANAS, "resumen");
  return (
    <div>
      <output>{pestana}</output>
      {PESTANAS.map((p) => (
        <button key={p} onClick={() => elegir(p)} type="button">
          {p}
        </button>
      ))}
    </div>
  );
}

let quitar: (() => void) | undefined;

beforeEach(() => {
  window.history.replaceState(null, "", "/analisis");
});

afterEach(() => {
  quitar?.();
  quitar = undefined;
  window.history.replaceState(null, "", "/");
});

function pintarPantalla() {
  const vista = pintar(<Pantalla />);
  quitar = vista.quitar;
  const elegida = () => vista.host.querySelector("output")!.textContent;
  const boton = (p: Pestana) => [...vista.host.querySelectorAll("button")].find((b) => b.textContent === p)!;
  return { elegida, boton };
}

/** Lo que hace el navegador con «Atrás»: cambia la dirección y avisa con `popstate`. */
function irA(direccion: string) {
  act(() => {
    window.history.replaceState(null, "", direccion);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

describe("la pestaña en la dirección", () => {
  test("sin nada en la dirección, la inicial", () => {
    expect(pintarPantalla().elegida()).toBe("resumen");
  });

  test("se recupera al cargar", () => {
    window.history.replaceState(null, "", "/analisis#pestana=datos");
    expect(pintarPantalla().elegida()).toBe("datos");
  });

  test("lo que no es una pestaña se lee como la inicial", () => {
    window.history.replaceState(null, "", "/analisis#pestana=inventada");
    expect(pintarPantalla().elegida()).toBe("resumen");
  });

  test("elegir una la escribe en una entrada nueva del historial; la inicial no se escribe", () => {
    const { elegida, boton } = pintarPantalla();
    const antes = window.history.length;
    pulsar(boton("exposicion"));
    expect(elegida()).toBe("exposicion");
    expect(window.location.hash).toBe("#pestana=exposicion");
    expect(window.history.length).toBe(antes + 1);
    pulsar(boton("resumen"));
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/analisis");
  });

  test("convive con lo que ya hay tras el «#»", () => {
    window.history.replaceState(null, "", "/jubilacion/planes#plan=F00000Q2PL");
    const { boton } = pintarPantalla();
    pulsar(boton("datos"));
    expect(window.location.hash).toBe("#plan=F00000Q2PL&pestana=datos");
    pulsar(boton("exposicion"));
    expect(window.location.hash).toBe("#plan=F00000Q2PL&pestana=exposicion");
    pulsar(boton("resumen"));
    expect(window.location.hash).toBe("#plan=F00000Q2PL");
  });

  test("«Atrás» y «Adelante» la recuperan", () => {
    const { elegida, boton } = pintarPantalla();
    pulsar(boton("datos"));
    irA("/analisis#pestana=exposicion");
    expect(elegida()).toBe("exposicion");
    irA("/analisis");
    expect(elegida()).toBe("resumen");
  });

  test("si otro cambia el «#», también se entera", () => {
    const { elegida } = pintarPantalla();
    act(() => {
      window.history.replaceState(null, "", "/analisis#pestana=datos");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(elegida()).toBe("datos");
  });

  test("conserva el estado del historial que puso el enrutador del marco", () => {
    window.history.replaceState({ routeId: "analisis" }, "", "/analisis");
    const { boton } = pintarPantalla();
    pulsar(boton("datos"));
    expect(window.history.state).toEqual({ routeId: "analisis" });
  });
});
