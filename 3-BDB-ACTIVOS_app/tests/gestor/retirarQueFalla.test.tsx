// @vitest-environment happy-dom
/**
 * Retirar una cartera cuando la carpeta falla (auditoría de frontend, GES-13).
 *
 * «Retirar la cartera» no manejaba su error: si mover el fichero a la papelera fallaba, la promesa se rechazaba sin
 * que nadie la recogiera y la pantalla se quedaba como si no hubiera pasado nada. Ahora dice que no se retiró,
 * enseña el motivo y deja la cartera donde estaba, entera.
 */
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../src/gestor/almacen/descarga", () => ({ descargarCartera: () => "x.cartera.json", nombreDeFichero: () => "x.cartera.json" }));
vi.mock("../../src/gestor/mercado/plataforma", () => ({ HAY_PLATAFORMA: false }));

import { ErrorDeAlmacen, type AlmacenDeCarteras } from "../../src/gestor/almacen/almacen";
import { almacenEnCarpeta } from "../../src/gestor/almacen/carpeta";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { useCarteraAbierta, type CarteraAbierta } from "../../src/gestor/ui/estado/useCarteraAbierta";
import { activo, cartera, mov } from "./ayudas";
import { crearCarpetaFalsa, type CarpetaFalsa } from "./carpetaFalsa";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FICHERO = "Familia García.cartera.json";
const reloj = Date.parse("2026-11-13T09:00:00Z");

let falsa: CarpetaFalsa;
let root: Root | undefined;
let vista: HTMLDivElement | undefined;
let abierta: CarteraAbierta;

beforeEach(() => {
  falsa = crearCarpetaFalsa({ reloj: () => reloj });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vista?.remove();
  root = undefined;
});

const garcia = (): Cartera =>
  cartera([activo("ES0000000001", "FONDO")], [mov("aportacion", "2026-01-02", { id: "m-1", importe: "1000" })], { id: "aaaaaaaa-1111-4000-8000-000000000001", nombre: "Familia García" });

function Arnes({ inicial, deposito }: { inicial: Cartera; deposito: AlmacenDeCarteras }) {
  const resultado = useCarteraAbierta(inicial, deposito, FICHERO);
  useLayoutEffect(() => {
    abierta = resultado;
  });
  return null;
}

async function montar(deposito: AlmacenDeCarteras) {
  vista = document.createElement("div");
  document.body.append(vista);
  root = createRoot(vista);
  await act(async () => root!.render(<Arnes deposito={deposito} inicial={garcia()} />));
}

/** El almacén de verdad sobre una carpeta en memoria, salvo que mover a la papelera falla. */
async function almacenQueNoRetira(causa: unknown): Promise<AlmacenDeCarteras> {
  const deVerdad = almacenEnCarpeta(falsa.carpeta, { ahora: () => new Date(reloj) });
  await deVerdad.guardar(garcia());
  return { ...deVerdad, retirar: () => Promise.reject(causa) };
}

it("GES-13: si mover la cartera a la papelera falla, dice que no se retiró y enseña el motivo", async () => {
  await montar(await almacenQueNoRetira(new ErrorDeAlmacen("PERMISO", "No hay permiso para escribir en la carpeta.")));

  let retirada: boolean | undefined;
  await act(async () => {
    retirada = await abierta.retirar();
  });

  expect(retirada).toBe(false);
  expect(abierta.errorDeGuardado).toBe("No hay permiso para escribir en la carpeta.");
});

it("GES-13: tras el fallo la cartera sigue en su sitio, entera, y nada ha ido a la papelera", async () => {
  await montar(await almacenQueNoRetira(new ErrorDeAlmacen("PERMISO", "No hay permiso para escribir en la carpeta.")));

  await act(async () => {
    await abierta.retirar();
  });

  const arbol = falsa.volcar();
  const enSuSitio = JSON.parse(arbol[FICHERO]) as { cartera: Cartera };
  expect(enSuSitio.cartera.movimientos.map((m) => m.id)).toEqual(["m-1"]);
  expect(Object.keys(arbol).some((ruta) => ruta.startsWith("papelera/"))).toBe(false);
});

it("GES-13: un fallo que no trae mensaje se dice con palabras propias, no con un texto vacío", async () => {
  await montar(await almacenQueNoRetira("sin más"));

  let retirada: boolean | undefined;
  await act(async () => {
    retirada = await abierta.retirar();
  });

  expect(retirada).toBe(false);
  expect(abierta.errorDeGuardado).toBe("No se ha podido retirar la cartera.");
});
