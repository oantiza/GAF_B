// @vitest-environment happy-dom

/**
 * El nombre de un instrumento lleva a su ficha desde cualquier pantalla, con un enlace de verdad
 * (hallazgos 5 y 120), y la pestaña que se abre con otra delante lo dice (decisión 29).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { columnasDePosiciones, type OpcionesDeLaTabla, type PosicionCalculada } from "../src/adapters/tablaDePosiciones";
import { AbrirFichaContext } from "../src/app/AbrirFichaContext";
import { useOtraPestana } from "../src/app/useOtraPestana";
import { EnlaceAFicha } from "../src/components/ui/EnlaceAFicha";
import { activoParaLaAccion, accionDeCarteraBloqueada, etiquetaDeAccionDeCartera, motivoDeNoInvertible } from "../src/core/accionDeCartera";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

describe("el enlace", () => {
  async function pintar(abrir: ((id: string) => void) | null) {
    await act(async () => {
      root!.render(
        createElement(AbrirFichaContext.Provider, { value: abrir }, createElement(EnlaceAFicha, { isin: "IE00B4L5Y983", children: "iShares" }))
      );
    });
    return host.querySelector("a")!;
  }

  test("lleva a su dirección, y lo que dice es el nombre", async () => {
    const enlace = await pintar(null);
    expect(enlace.getAttribute("href")).toBe("/activo/IE00B4L5Y983");
    expect(enlace.textContent).toBe("iShares");
  });

  test("un clic normal abre la ficha sin recargar", async () => {
    const abiertas: string[] = [];
    const enlace = await pintar((id) => abiertas.push(id));
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      enlace.dispatchEvent(clic);
    });
    expect(abiertas).toEqual(["IE00B4L5Y983"]);
    expect(clic.defaultPrevented).toBe(true);
  });

  test.each(["ctrlKey", "metaKey", "shiftKey"])("con %s lo resuelve el navegador", async (tecla) => {
    const abiertas: string[] = [];
    const enlace = await pintar((id) => abiertas.push(id));
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true, [tecla]: true });
    await act(async () => {
      enlace.dispatchEvent(clic);
    });
    expect(abiertas).toEqual([]);
    expect(clic.defaultPrevented).toBe(false);
  });

  test("sin marco alrededor sigue siendo un enlace normal", async () => {
    const enlace = await pintar(null);
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      enlace.dispatchEvent(clic);
    });
    expect(clic.defaultPrevented).toBe(false);
  });

  test("no dispara la fila en la que vive", async () => {
    const filas: number[] = [];
    await act(async () => {
      root!.render(
        createElement(
          "div",
          { onClick: () => filas.push(1) },
          createElement(AbrirFichaContext.Provider, { value: () => undefined }, createElement(EnlaceAFicha, { isin: "X", children: "X" }))
        )
      );
    });
    await act(async () => host.querySelector("a")!.click());
    expect(filas).toEqual([]);
  });
});

describe("en Posiciones", () => {
  const OPCIONES: OpcionesDeLaTabla = {
    columnaDelActivo: "Activo",
    conCostes: false,
    conRetro: false,
    conDetalle: false,
    decimalesDelImporte: 0,
    eur: (valor) => String(valor),
    botonDeDetalle: () => null,
    botonDeAlternativas: () => null
  };
  const posicion = (activo: boolean): PosicionCalculada => ({
    id: "LU0996182563",
    amount: 1000,
    weight: 100,
    ongoingPct: null,
    costEur: null,
    retroPct: null,
    retroSourceLabel: null,
    cessionPct: null,
    incomeEur: null,
    asset: activo ? ({ display_name: "Un fondo" } as PosicionCalculada["asset"]) : null
  });
  const celda = (p: PosicionCalculada) => columnasDePosiciones(OPCIONES)[0].celda({ id: p.id, posicion: p });

  test("lo reconocido lleva a su ficha", () => {
    expect(celda(posicion(true)).enlaceAFicha).toBe("LU0996182563");
  });

  test("lo que no se ha reconocido no tiene ficha a la que ir", () => {
    expect(celda(posicion(false)).enlaceAFicha).toBeUndefined();
  });
});

describe("la regla de lo que se puede añadir", () => {
  const BAJA = { availability: { state: "DELISTED", since: "2026-09-21" } };

  test("lo que dejó de cotizar: el motivo, con su fecha, y el botón apagado con su nombre", () => {
    expect(motivoDeNoInvertible("ES0125140A14", "ERCROS", BAJA)).toBe(
      "ERCROS dejó de cotizar el 21/09/2026: no se añade a la cartera."
    );
    const activo = activoParaLaAccion("ES0125140A14", BAJA);
    expect(accionDeCarteraBloqueada(activo, false)).toBe(true);
    expect(etiquetaDeAccionDeCartera(activo, false)).toBe("No disponible");
  });

  test("gana la baja aunque la otra lectura lo dé por invertible: la ficha dice que dejó de cotizar", () => {
    const activo = activoParaLaAccion("ES0125140A14", BAJA, { is_investable: true, quality_flags: [] });
    expect(etiquetaDeAccionDeCartera(activo, false)).toBe("No disponible");
  });

  test("lo que nunca se resolvió no se añade, por su estado, y no dice que dejara de cotizar (decisión 44)", () => {
    const raiz = { availability: { state: "NEVER_RESOLVED", since: "2026-11-02" } };
    expect(motivoDeNoInvertible("ES0114400007", "CAM", raiz)).toBe("No se añade: sin precio ni métricas.");
    const activo = activoParaLaAccion("ES0114400007", raiz);
    expect(accionDeCarteraBloqueada(activo, false)).toBe(true);
    expect(etiquetaDeAccionDeCartera(activo, false)).toBe("No disponible");
    /* El mismo ISIN con otro estado se añade, y otro ISIN con este estado, no: no es una lista de ISIN. */
    expect(motivoDeNoInvertible("ES0114400007", "CAM", { availability: { state: "TRADING" } })).toBeNull();
    expect(motivoDeNoInvertible("IE00B4L5Y983", "iShares", raiz)).toBe("No se añade: sin precio ni métricas.");
  });

  test("gana el estado aunque la otra lectura lo dé por invertible: la base vieja no lo tiene", () => {
    const raiz = { availability: { state: "NEVER_RESOLVED" } };
    const activo = activoParaLaAccion("ES0114400007", raiz, { is_investable: true, quality_flags: [] });
    expect(accionDeCarteraBloqueada(activo, false)).toBe(true);
    expect(etiquetaDeAccionDeCartera(activo, false)).toBe("No disponible");
  });

  test.each([
    ["cerrada a nuevas suscripciones, como las clases C de Amundi", "NON_INVESTABLE_CLOSED_SUBSCRIPTIONS"],
    ["suspendida", "NON_INVESTABLE_SUSPENDED"],
    ["dada de baja", "NON_INVESTABLE_DELISTED"]
  ] as const)("%s: el botón dice «No disponible», y no «Benchmark» (decisión 113)", (_caso, marca) => {
    const activo = activoParaLaAccion("LU1883342880", undefined, { is_investable: false, role: "INVESTABLE", quality_flags: [marca] });
    expect(etiquetaDeAccionDeCartera(activo, false)).toBe("No disponible");
    expect(accionDeCarteraBloqueada(activo, false)).toBe(true);
  });

  test("un benchmark de verdad sigue diciendo «Benchmark»", () => {
    expect(etiquetaDeAccionDeCartera({ is_investable: false, role: "BENCHMARK", quality_flags: ["NON_INVESTABLE_BENCHMARK"] }, false)).toBe("Benchmark");
  });

  test("lo que no se ha podido medir no se bloquea: no se sabe, que es otra cosa", () => {
    const raiz = { availability: { state: "UNDETERMINED", since: "2026-11-05" } };
    expect(motivoDeNoInvertible("ES0171743901", "Prisa", raiz)).toBeNull();
    expect(accionDeCarteraBloqueada(activoParaLaAccion("ES0171743901", raiz), false)).toBe(false);
  });

  test("un instrumento corriente se añade", () => {
    const raiz = { availability: { state: "TRADING" } };
    expect(motivoDeNoInvertible("IE00B4L5Y983", "iShares", raiz)).toBeNull();
    expect(etiquetaDeAccionDeCartera(activoParaLaAccion("IE00B4L5Y983", raiz), false)).toBe("Añadir");
    expect(etiquetaDeAccionDeCartera(activoParaLaAccion("IE00B4L5Y983", raiz), true)).toBe("Añadido");
  });

  test("los dos fondos base de las carteras de referencia no se añaden", () => {
    expect(motivoDeNoInvertible("IE00B18GC888", "Vanguard Global Bond", {})).toContain("fondos base");
    expect(accionDeCarteraBloqueada(activoParaLaAccion("IE00B18GC888", {}), false)).toBe(true);
  });

  test("si la base no tiene el documento, no se inventa ningún motivo", () => {
    expect(motivoDeNoInvertible("IE00B4L5Y983", "iShares", undefined)).toBeNull();
  });
});

describe("cada pestaña, su cartera", () => {
  /* Un canal de verdad entre «pestañas» del mismo proceso: lo que se dice en uno llega a los demás. */
  class CanalDePrueba {
    static abiertos = new Set<CanalDePrueba>();
    onmessage: ((evento: MessageEvent) => void) | null = null;
    nombre: string;
    constructor(nombre: string) {
      this.nombre = nombre;
      CanalDePrueba.abiertos.add(this);
    }
    postMessage(data: unknown) {
      for (const otro of CanalDePrueba.abiertos) {
        if (otro !== this && otro.nombre === this.nombre) otro.onmessage?.({ data } as MessageEvent);
      }
    }
    close() {
      CanalDePrueba.abiertos.delete(this);
    }
  }

  const Testigo = ({ id }: { id: string }) => createElement("output", { id }, String(useOtraPestana()));

  beforeEach(() => {
    CanalDePrueba.abiertos.clear();
    vi.stubGlobal("BroadcastChannel", CanalDePrueba);
  });

  test("solo la que se abre con otra delante lo sabe, y deja de saberlo si la otra se cierra", async () => {
    const hostPrimera = document.createElement("div");
    const primera = createRoot(hostPrimera);
    await act(async () => primera.render(createElement(Testigo, { id: "primera" })));
    expect(hostPrimera.textContent).toBe("false");

    await act(async () => root!.render(createElement(Testigo, { id: "segunda" })));
    expect(host.textContent).toBe("true");
    /* La primera sigue igual: su cartera es la que era, y no hay nada que avisarle. */
    expect(hostPrimera.textContent).toBe("false");

    await act(async () => primera.unmount());
    expect(host.textContent).toBe("false");
  });

  test("con tres pestañas, las que ya estaban no cambian: solo las nuevas lo saben", async () => {
    const hostPrimera = document.createElement("div");
    const primera = createRoot(hostPrimera);
    await act(async () => primera.render(createElement(Testigo, { id: "primera" })));
    await act(async () => root!.render(createElement(Testigo, { id: "segunda" })));
    const hostTercera = document.createElement("div");
    const tercera = createRoot(hostTercera);
    await act(async () => tercera.render(createElement(Testigo, { id: "tercera" })));
    expect(hostPrimera.textContent).toBe("false");
    expect(host.textContent).toBe("true");
    expect(hostTercera.textContent).toBe("true");
    /* Si se cierra la primera, la segunda ya no tiene a nadie delante; la tercera sigue teniendo a la segunda. */
    await act(async () => primera.unmount());
    expect(host.textContent).toBe("false");
    expect(hostTercera.textContent).toBe("true");
    await act(async () => tercera.unmount());
  });

  test("por el canal no viaja nada de la cartera, y no se escribe nada en disco", async () => {
    const dichos: unknown[] = [];
    const escribe = vi.spyOn(Storage.prototype, "setItem");
    const original = CanalDePrueba.prototype.postMessage;
    CanalDePrueba.prototype.postMessage = function (data: unknown) {
      dichos.push(data);
      original.call(this, data);
    };
    await act(async () => root!.render(createElement(Testigo, { id: "una" })));
    CanalDePrueba.prototype.postMessage = original;
    expect(dichos.length).toBeGreaterThan(0);
    for (const dicho of dichos) expect(Object.keys(dicho as object).sort()).toEqual(["id", "tipo"]);
    expect(escribe).not.toHaveBeenCalled();
    escribe.mockRestore();
  });

  test("sin canal en el navegador no pasa nada: no se avisa", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    await act(async () => root!.render(createElement(Testigo, { id: "sola" })));
    expect(host.textContent).toBe("false");
  });
});

test("el pintor de la tabla convierte el nombre en enlace solo si la celda lo pide", async () => {
  const { TablaDeDatos } = await import("../src/components/tabla/TablaDeDatos");
  const html = renderToStaticMarkup(
    createElement(TablaDeDatos<{ id: string }>, {
      filas: [{ id: "a" }],
      columnas: [
        { id: "uno", titulo: "Uno", celda: () => ({ texto: "Con enlace", enlaceAFicha: "LU1" }) },
        { id: "dos", titulo: "Dos", celda: () => ({ texto: "Sin enlace" }) }
      ],
      titulo: "Prueba"
    })
  );
  expect(html).toContain('href="/activo/LU1"');
  expect(html).toContain("Sin enlace");
  expect(html.match(/<a /g)).toHaveLength(1);
});
