// @vitest-environment happy-dom
/**
 * GES-01, lo que faltaba: salir de una cartera del gestor con cambios que se perderían desde fuera
 * del gestor (el menú, el envío a Diseño) pregunta antes, con las mismas opciones que
 * «← Carteras de clientes». Se monta el marco real; el gestor es la vista de una cartera de verdad,
 * abierta sin carpeta y sin descargar, que es el caso en que todo se perdería.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const descargas = vi.hoisted(() => ({ descargar: vi.fn((cartera: { nombre: string }) => `${cartera.nombre}.cartera.json`) }));
vi.mock("../../src/gestor/almacen/descarga", () => ({ descargarCartera: descargas.descargar, nombreDeFichero: () => "x.cartera.json" }));
vi.mock("../../src/gestor/mercado/plataforma", () => ({ HAY_PLATAFORMA: false }));
vi.mock("../../src/auth/useIsAdmin", () => ({
  useIsAdmin: () => false,
  /* El marco espera a saber si hay permiso (MAR-22): en estas pruebas ya se sabe. */
  useAdminClaim: () => ({ isAdmin: false, resolved: true })
}));

const testigo = (titulo: string) => () => createElement("section", null, createElement("h1", null, titulo));
vi.mock("../../src/pages/MercadoPage", () => ({ MercadoPage: testigo("Mercado") }));
vi.mock("../../src/pages/AssetComparisonPage", () => ({ AssetComparisonPage: testigo("Comparar activos") }));
vi.mock("../../src/pages/XrayPage", () => ({ XrayPage: testigo("Análisis") }));
vi.mock("../../src/pages/PortfolioBuilderPage", () => ({ PortfolioBuilderPage: testigo("Diseño de cartera") }));
vi.mock("../../src/pages/CarterasGuardadasPage", () => ({ CarterasGuardadasPage: testigo("Carteras guardadas") }));
vi.mock("../../src/pages/PosicionesPage", () => ({ PosicionesPage: testigo("Posiciones") }));
vi.mock("../../src/pages/BuscadorNuevoPage", () => ({ BuscadorNuevoPage: testigo("Buscador") }));
/* El gestor: una cartera abierta sin carpeta y nunca descargada, y un botón que hace lo que hace
   «Abrir estas posiciones en Diseño» de Comparar. */
vi.mock("../../src/gestor/ui/GestorDeCarterasPage", async () => {
  const { VistaDeCartera } = await import("../../src/gestor/ui/VistaDeCartera");
  const { activo, cartera, mov } = await import("./ayudas");
  const inicial = cartera([activo("ES0000000001", "FONDO")], [mov("aportacion", "2026-01-02", { id: "m-1", importe: "1000" })], { id: "aaaaaaaa-1111-4000-8000-000000000001", nombre: "Familia García" });
  return {
    GestorDeCarterasPage: ({ onSendToBuilder }: { onSendToBuilder?: (cartera: unknown) => void }) =>
      createElement(
        "div",
        null,
        createElement(VistaDeCartera, { alVolver: () => undefined, almacen: null, fichero: null, inicial }),
        createElement("button", { onClick: () => onSendToBuilder?.({ name: "Familia García", positions: [{ asset_id: "ES0000000001", weight_percent: 100, label: "Fondo" }], totalCapital: 1000 }), type: "button" }, "Enviar a Diseño (prueba)")
      )
  };
});

import { BdbActivosApp } from "../../src/app/BdbActivosApp";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  descargas.descargar.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function esperar(condicion: () => boolean, que: string) {
  for (let intento = 0; intento < 300; intento += 1) {
    if (condicion()) return;
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 10));
    });
  }
  throw new Error(`No aparece: ${que} — ${host.textContent?.slice(0, 400)}`);
}

const boton = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
const entrada = (nombre: string) => host.querySelector<HTMLAnchorElement>(`nav.rail-nav a[aria-label="${nombre}"]`)!;
const tituloDeLaPantalla = () => host.querySelector("main h1")?.textContent;

async function abrirElGestor() {
  window.history.replaceState(null, "", "/cartera-real");
  await act(async () => {
    root!.render(createElement(BdbActivosApp));
  });
  await esperar(() => tituloDeLaPantalla() === "Familia García", "la cartera abierta");
}

describe("salir de una cartera del gestor desde el marco (GES-01)", { timeout: 20_000 }, () => {
  it("otra entrada del menú no navega hasta responder, y «Seguir en la cartera» deja todo como estaba", async () => {
    await abrirElGestor();
    await act(async () => entrada("Mercado").click());
    await esperar(() => boton("Descargar una copia y salir") !== undefined, "la pregunta de salida");
    expect(window.location.pathname).toBe("/cartera-real");
    expect(tituloDeLaPantalla()).toBe("Familia García");
    await act(async () => boton("No descargar")!.click());
    await esperar(() => boton("Seguir en la cartera") !== undefined, "la segunda pregunta");
    await act(async () => boton("Seguir en la cartera")!.click());
    await act(async () => new Promise((listo) => setTimeout(listo, 20)));
    expect(window.location.pathname).toBe("/cartera-real");
    expect(tituloDeLaPantalla()).toBe("Familia García");
    expect(descargas.descargar).not.toHaveBeenCalled();
    /* Y la siguiente salida vuelve a preguntar: seguir no ha descartado nada. */
    await act(async () => entrada("Mercado").click());
    await esperar(() => boton("Descargar una copia y salir") !== undefined, "la pregunta otra vez");
  });

  it("«Descargar una copia y salir» descarga una sola copia y lleva a la entrada pulsada", async () => {
    await abrirElGestor();
    await act(async () => entrada("Mercado").click());
    await esperar(() => boton("Descargar una copia y salir") !== undefined, "la pregunta de salida");
    await act(async () => boton("Descargar una copia y salir")!.click());
    await esperar(() => tituloDeLaPantalla() === "Mercado", "Mercado");
    expect(window.location.pathname).toBe("/mercado");
    /* Una: la que se ha pedido. Al cerrar la cartera no se descarga otra de rescate. */
    expect(descargas.descargar).toHaveBeenCalledTimes(1);
  });

  it("«Salir sin guardar» navega sin descargar nada", async () => {
    await abrirElGestor();
    await act(async () => entrada("Mercado").click());
    await esperar(() => boton("No descargar") !== undefined, "la pregunta de salida");
    await act(async () => boton("No descargar")!.click());
    await esperar(() => boton("Salir sin guardar") !== undefined, "la segunda pregunta");
    await act(async () => boton("Salir sin guardar")!.click());
    await esperar(() => tituloDeLaPantalla() === "Mercado", "Mercado");
    expect(descargas.descargar).not.toHaveBeenCalled();
  });

  it("el envío a Diseño también pregunta antes, y con «Seguir en la cartera» no se envía", async () => {
    await abrirElGestor();
    await act(async () => boton("Enviar a Diseño (prueba)")!.click());
    await esperar(() => boton("No descargar") !== undefined, "la pregunta de salida");
    await act(async () => boton("No descargar")!.click());
    await esperar(() => boton("Seguir en la cartera") !== undefined, "la segunda pregunta");
    await act(async () => boton("Seguir en la cartera")!.click());
    await act(async () => new Promise((listo) => setTimeout(listo, 20)));
    expect(window.location.pathname).toBe("/cartera-real");
    expect(tituloDeLaPantalla()).toBe("Familia García");
  });

  it("fuera de una cartera abierta, el menú navega en el acto", async () => {
    window.history.replaceState(null, "", "/mercado");
    await act(async () => {
      root!.render(createElement(BdbActivosApp));
    });
    await esperar(() => tituloDeLaPantalla() === "Mercado", "Mercado");
    await act(async () => entrada("Posiciones").click());
    expect(tituloDeLaPantalla()).toBe("Posiciones");
  });
});
