/**
 * DIS-03: el aviso de «guardada» y de «eliminada» solo lo oía la pestaña que lo daba. Borrar la abierta en otra
 * pestaña no la desvinculaba, y el siguiente «Guardar» la volvía a escribir. Ahora viaja también a las demás
 * pestañas por un `BroadcastChannel`, que solo existe mientras están abiertas y no escribe nada en disco.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CANAL_DE_CARTERAS_GUARDADAS,
  avisarCarterasGuardadas,
  escucharCarterasGuardadas,
  type AvisoDeCarteras
} from "../src/core/carterasGuardadasAvisos";
import type { BdbSavedLocalPortfolio } from "../src/types/bdbAssets";

const GUARDADA: BdbSavedLocalPortfolio = {
  portfolio_id: "p1",
  name: "Cliente",
  created_at: "2026-11-01T10:00:00.000Z",
  updated_at: "2026-11-13T10:00:00.000Z",
  sourceKind: "LOCAL_MOCK",
  positions: [{ asset_id: "A", weight_percent: 100 }]
};

/** Lo que llega por el canal a quien escucha, en cuanto pasa el mensaje. */
async function esperar(condicion: () => boolean) {
  for (let intento = 0; intento < 50 && !condicion(); intento += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

const otras: BroadcastChannel[] = [];
afterEach(() => {
  otras.splice(0).forEach((canal) => canal.close());
});

describe("los avisos de carteras guardadas llegan a las otras pestañas", () => {
  test("lo que avisa otra pestaña llega aquí, marcado como de fuera", async () => {
    const oyente = vi.fn();
    const dejar = escucharCarterasGuardadas(oyente);
    const otraPestana = new BroadcastChannel(CANAL_DE_CARTERAS_GUARDADAS);
    otras.push(otraPestana);
    otraPestana.postMessage({ tipo: "eliminada", id: "p1" } satisfies AvisoDeCarteras);
    await esperar(() => oyente.mock.calls.length > 0);
    dejar();
    expect(oyente).toHaveBeenCalledWith({ tipo: "eliminada", id: "p1", deOtraPestana: true });
  });

  test("lo que se avisa aquí llega a la otra pestaña, y aquí también, sin marca de fuera", async () => {
    const oyente = vi.fn();
    const dejar = escucharCarterasGuardadas(oyente);
    const otraPestana = new BroadcastChannel(CANAL_DE_CARTERAS_GUARDADAS);
    otras.push(otraPestana);
    const recibido: unknown[] = [];
    otraPestana.onmessage = ({ data }) => recibido.push(data);
    avisarCarterasGuardadas({ tipo: "guardada", cartera: GUARDADA });
    await esperar(() => recibido.length > 0);
    dejar();
    expect(oyente).toHaveBeenCalledTimes(1);
    expect(oyente).toHaveBeenCalledWith({ tipo: "guardada", cartera: GUARDADA });
    expect(recibido).toEqual([{ tipo: "guardada", cartera: GUARDADA }]);
  });

  test("lo que llega por el canal sin la forma de un aviso no se reparte", async () => {
    const oyente = vi.fn();
    const dejar = escucharCarterasGuardadas(oyente);
    const otraPestana = new BroadcastChannel(CANAL_DE_CARTERAS_GUARDADAS);
    otras.push(otraPestana);
    otraPestana.postMessage({ tipo: "hola", id: "x" });
    otraPestana.postMessage({ tipo: "guardada" });
    otraPestana.postMessage({ tipo: "eliminada", id: "p2" });
    await esperar(() => oyente.mock.calls.length > 0);
    dejar();
    expect(oyente.mock.calls).toEqual([[{ tipo: "eliminada", id: "p2", deOtraPestana: true }]]);
  });
});
