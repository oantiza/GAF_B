// @vitest-environment happy-dom
/**
 * El guardado de una cartera abierta (`useCarteraAbierta`) frente a lo que hace perder trabajo:
 * cerrar o recargar la pestaña con cambios sin escribir (GES-01), otra pestaña que ha cambiado
 * la misma cartera (GES-02), una carpeta que falla a mitad de sesión (GES-03) y los cambios
 * grandes que tienen que dejar copia de lo que sustituyen (GES-10). Con el almacén de verdad
 * sobre una carpeta en memoria y un reloj inyectado.
 */
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const descargas = vi.hoisted(() => ({ descargar: vi.fn((cartera: { nombre: string }) => `${cartera.nombre}.cartera.json`) }));
vi.mock("../../src/gestor/almacen/descarga", () => ({ descargarCartera: descargas.descargar, nombreDeFichero: () => "x.cartera.json" }));
vi.mock("../../src/gestor/mercado/plataforma", () => ({ HAY_PLATAFORMA: false }));

import { ErrorDeAlmacen, type AlmacenDeCarteras } from "../../src/gestor/almacen/almacen";
import { almacenEnCarpeta } from "../../src/gestor/almacen/carpeta";
import { demostracion } from "../../src/gestor/demo/carteraDemo";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { useCarteraAbierta, salidaDelGestor, type CarteraAbierta } from "../../src/gestor/ui/estado/useCarteraAbierta";
import { VistaDeCartera } from "../../src/gestor/ui/VistaDeCartera";
import { activo, cartera, mov } from "./ayudas";
import { crearCarpetaFalsa, type CarpetaFalsa } from "./carpetaFalsa";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MINUTO = 60_000;
const FICHERO = "Familia García.cartera.json";
const COPIAS = "copias/aaaaaaaa-1111-4000-8000-000000000001/";

let reloj = Date.parse("2026-11-13T09:00:00Z");
let falsa: CarpetaFalsa;
let root: Root | undefined;
let vista: HTMLDivElement | undefined;
let abierta: CarteraAbierta;

beforeEach(() => {
  reloj = Date.parse("2026-11-13T09:00:00Z");
  falsa = crearCarpetaFalsa({ reloj: () => reloj });
  descargas.descargar.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vista?.remove();
  root = undefined;
});

function almacen(): AlmacenDeCarteras {
  return almacenEnCarpeta(falsa.carpeta, { ahora: () => new Date(reloj) });
}

const garcia = (): Cartera =>
  cartera([activo("ES0000000001", "FONDO")], [mov("aportacion", "2026-01-02", { id: "m-1", importe: "1000" })], { id: "aaaaaaaa-1111-4000-8000-000000000001", nombre: "Familia García" });

function Arnes({ inicial, deposito, fichero }: { inicial: Cartera; deposito: AlmacenDeCarteras | null; fichero: string | null }) {
  const resultado = useCarteraAbierta(inicial, deposito, fichero);
  /* La prueba lee el último estado del gancho; se publica después de cada render. */
  useLayoutEffect(() => {
    abierta = resultado;
  });
  return null;
}

async function montar(nodo: React.ReactNode) {
  vista = document.createElement("div");
  document.body.append(vista);
  root = createRoot(vista);
  await act(async () => root!.render(nodo));
}

async function esperar(condicion: () => boolean, ms = 3000) {
  const limite = Date.now() + ms;
  while (!condicion() && Date.now() < limite) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 10));
    });
  }
  expect(condicion()).toBe(true);
}

/** Lanza `beforeunload` y dice si la página pide confirmación para salir. */
function avisaAlSalir(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}

function anadir(id: string, opciones?: { copiaObligada?: boolean }) {
  act(() => abierta.cambiar("Añadir movimiento", (c) => ({ ...c, movimientos: [...c.movimientos, mov("aportacion", "2026-02-01", { id, importe: "50" })] }), opciones));
}

function idsEnDisco(): string[] {
  const texto = falsa.contenido(FICHERO);
  return texto === undefined ? [] : (JSON.parse(texto) as { cartera: Cartera }).cartera.movimientos.map((m) => m.id);
}

function boton(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
}

describe("aviso al salir (GES-01)", () => {
  it("sin carpeta: con un cambio sin descargar avisa al cerrar la pestaña; tras descargar, ya no", async () => {
    await montar(<Arnes deposito={null} fichero={FICHERO} inicial={garcia()} />);
    expect(avisaAlSalir()).toBe(false);
    anadir("m-2");
    expect(abierta.guardado).toBe("sin-descargar");
    expect(abierta.cambiosQueSePerderian).toBe(true);
    expect(salidaDelGestor()?.sePerderian).toBe(true);
    expect(avisaAlSalir()).toBe(true);
    await act(async () => abierta.guardarAhora());
    expect(descargas.descargar).toHaveBeenCalledTimes(1);
    expect(abierta.cambiosQueSePerderian).toBe(false);
    expect(avisaAlSalir()).toBe(false);
  });

  it("con carpeta: avisa mientras el guardado está pendiente y deja de avisar cuando se ha escrito", async () => {
    const a = almacen();
    await a.guardar(garcia());
    await montar(<Arnes deposito={a} fichero={FICHERO} inicial={garcia()} />);
    expect(avisaAlSalir()).toBe(false);
    anadir("m-2");
    expect(abierta.guardado).toBe("pendiente");
    expect(avisaAlSalir()).toBe(true);
    /* Pendiente no se pierde: se escribe al salir. */
    expect(abierta.cambiosQueSePerderian).toBe(false);
    await esperar(() => abierta.guardado === "guardado");
    expect(idsEnDisco()).toEqual(["m-1", "m-2"]);
    expect(avisaAlSalir()).toBe(false);
  });

  it("la cartera de demostración no avisa: no se guarda por diseño", async () => {
    const demo = demostracion("2026-11-13").cartera;
    await montar(<Arnes deposito={null} fichero={null} inicial={demo} />);
    anadir("m-demo");
    expect(abierta.guardado).toBe("no-se-guarda");
    expect(abierta.cambiosQueSePerderian).toBe(false);
    expect(avisaAlSalir()).toBe(false);
  });

  it("con un guardado pendiente, «pagehide» lo escribe ya, sin esperar al temporizador", async () => {
    const a = almacen();
    await a.guardar(garcia());
    await montar(<Arnes deposito={a} fichero={FICHERO} inicial={garcia()} />);
    anadir("m-2");
    const antes = Date.now();
    window.dispatchEvent(new Event("pagehide"));
    await esperar(() => idsEnDisco().includes("m-2"), 500);
    /* El temporizador del guardado automático es de 700 ms: esto ha ido antes. */
    expect(Date.now() - antes).toBeLessThan(700);
  });

  it("prepararSalida escribe lo pendiente y dice que no se pierde nada", async () => {
    const a = almacen();
    await a.guardar(garcia());
    await montar(<Arnes deposito={a} fichero={FICHERO} inicial={garcia()} />);
    anadir("m-2");
    let sePerderian = true;
    await act(async () => {
      sePerderian = await abierta.prepararSalida();
    });
    expect(sePerderian).toBe(false);
    expect(idsEnDisco()).toEqual(["m-1", "m-2"]);
  });
});

describe("otra pestaña ha cambiado la cartera (GES-02)", () => {
  async function enConflicto() {
    await almacen().guardar(garcia());
    const otra = almacen();
    const mia = almacen();
    const deLaOtra = (await otra.abrir(FICHERO)).cartera;
    const enLaMia = (await mia.abrir(FICHERO)).cartera;
    await montar(<Arnes deposito={mia} fichero={FICHERO} inicial={enLaMia} />);
    reloj += MINUTO;
    await otra.guardar({ ...deLaOtra, movimientos: [...deLaOtra.movimientos, mov("aportacion", "2026-03-01", { id: "m-otra", importe: "70" })] });
    reloj += MINUTO;
    anadir("m-mia");
    await esperar(() => abierta.guardado === "error");
    return mia;
  }

  it("no pisa el disco, lo dice con el código de conflicto y cuenta como cambios que se perderían", async () => {
    await enConflicto();
    expect(abierta.codigoDeError).toBe("CONFLICTO");
    expect(abierta.errorDeGuardado).toMatch(/ha cambiado fuera de esta pestaña/);
    expect(idsEnDisco()).toEqual(["m-1", "m-otra"]);
    expect(abierta.cambiosQueSePerderian).toBe(true);
    /* En conflicto no se reintenta solo con cada cambio: cada intento haría otra copia. */
    const copias = Object.keys(falsa.volcar()).filter((ruta) => ruta.startsWith(COPIAS)).length;
    anadir("m-mia-2");
    await act(async () => new Promise((resolver) => setTimeout(resolver, 900)));
    expect(Object.keys(falsa.volcar()).filter((ruta) => ruta.startsWith(COPIAS)).length).toBe(copias);
    expect(idsEnDisco()).toEqual(["m-1", "m-otra"]);
  });

  it("«Recargar la versión del disco» trae lo de la otra pestaña y se puede deshacer", async () => {
    await enConflicto();
    await act(async () => abierta.recargarDelDisco());
    expect(abierta.cartera.movimientos.map((m) => m.id)).toEqual(["m-1", "m-otra"]);
    expect(abierta.guardado).toBe("guardado");
    expect(abierta.codigoDeError).toBeNull();
    expect(abierta.accionADeshacer).toBe("Recargar la versión del disco");
    /* Y desde aquí se guarda sin conflicto. */
    anadir("m-despues");
    await esperar(() => abierta.guardado === "guardado" && idsEnDisco().includes("m-despues"));
    expect(idsEnDisco()).toEqual(["m-1", "m-otra", "m-despues"]);
  });

  it("«Guardar como una cartera aparte» escribe lo de esta pestaña en otro fichero y no toca el original", async () => {
    await enConflicto();
    await act(async () => abierta.guardarComoCopia());
    expect(abierta.guardado).toBe("guardado");
    expect(abierta.cartera.id).not.toBe(garcia().id);
    expect(abierta.cartera.nombre).toBe("Familia García (copia)");
    expect(abierta.fichero).toBe("Familia García (copia).cartera.json");
    const copia = JSON.parse(falsa.contenido("Familia García (copia).cartera.json")!) as { cartera: Cartera };
    expect(copia.cartera.movimientos.map((m) => m.id)).toEqual(["m-1", "m-mia"]);
    expect(idsEnDisco()).toEqual(["m-1", "m-otra"]);
  });
});

describe("la carpeta falla a mitad de sesión (GES-03)", () => {
  it("con error de permiso: se puede descargar una copia y volver a dar permiso sin salir", async () => {
    const a = almacen();
    await a.guardar(garcia());
    await montar(<Arnes deposito={a} fichero={FICHERO} inicial={garcia()} />);
    falsa.negarPermiso();
    anadir("m-2");
    await esperar(() => abierta.guardado === "error");
    expect(abierta.codigoDeError).toBe("PERMISO");
    expect(abierta.cambiosQueSePerderian).toBe(true);
    act(() => abierta.descargarCopia());
    expect(descargas.descargar).toHaveBeenCalledTimes(1);
    expect((descargas.descargar.mock.calls[0][0] as unknown as Cartera).movimientos.map((m) => m.id)).toEqual(["m-1", "m-2"]);
    /* La carpeta falsa no tiene `queryPermission`: el permiso se da por concedido, como en un navegador sin él. */
    falsa.negarPermiso(false);
    await act(async () => abierta.volverADarPermiso());
    await esperar(() => abierta.guardado === "guardado");
    expect(idsEnDisco()).toEqual(["m-1", "m-2"]);
  });

  it("si el guardado de salida falla, no se traga el error: descarga una copia de rescate", async () => {
    const a = almacen();
    await a.guardar(garcia());
    await montar(<Arnes deposito={a} fichero={FICHERO} inicial={garcia()} />);
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    falsa.negarPermiso();
    anadir("m-2");
    await act(async () => root!.unmount());
    root = undefined;
    await esperar(() => descargas.descargar.mock.calls.length === 1);
    expect((descargas.descargar.mock.calls[0][0] as unknown as Cartera).movimientos.map((m) => m.id)).toEqual(["m-1", "m-2"]);
    expect(consola).toHaveBeenCalled();
    consola.mockRestore();
  });

  it("prepararSalida con la carpeta en error dice que se perderían cambios", async () => {
    const a = almacen();
    await a.guardar(garcia());
    await montar(<Arnes deposito={a} fichero={FICHERO} inicial={garcia()} />);
    falsa.negarPermiso();
    anadir("m-2");
    let sePerderian = false;
    await act(async () => {
      sePerderian = await abierta.prepararSalida();
    });
    expect(sePerderian).toBe(true);
    expect(abierta.guardado).toBe("error");
  });
});

describe("copia obligada en los cambios grandes (GES-10)", () => {
  it("un cambio con copiaObligada deja copia de lo sustituido aunque la última sea de hace 2 minutos", async () => {
    const a = almacen();
    await a.guardar(garcia());
    reloj += MINUTO; // 09:01: primera copia, por el guardado normal
    await montar(<Arnes deposito={a} fichero={FICHERO} inicial={garcia()} />);
    anadir("m-2");
    await esperar(() => abierta.guardado === "guardado" && idsEnDisco().includes("m-2"));
    reloj += 2 * MINUTO; // 09:03
    const antes = falsa.contenido(FICHERO);
    act(() => abierta.cambiar("Borrar movimiento", (c) => ({ ...c, movimientos: c.movimientos.filter((m) => m.id !== "m-1") }), { copiaObligada: true }));
    await esperar(() => abierta.guardado === "guardado" && !idsEnDisco().includes("m-1"));
    expect(falsa.contenido(`${COPIAS}2026-11-13T09-03-00Z.cartera.json`)).toBe(antes);
  });

  it("retirar guarda antes lo de pantalla con copia obligada y lo lleva todo a la papelera", async () => {
    const a = almacen();
    await a.guardar(garcia());
    await montar(<Arnes deposito={a} fichero={FICHERO} inicial={garcia()} />);
    reloj += MINUTO;
    anadir("m-2");
    await act(async () => abierta.retirar());
    const arbol = falsa.volcar();
    expect(arbol[FICHERO]).toBeUndefined();
    const enPapelera = JSON.parse(arbol[`papelera/${FICHERO}`]) as { cartera: Cartera };
    expect(enPapelera.cartera.movimientos.map((m) => m.id)).toEqual(["m-1", "m-2"]);
    expect(Object.keys(arbol).some((ruta) => ruta.startsWith(`papelera/${COPIAS}`))).toBe(true);
    /* Al desmontar no se vuelve a crear el fichero retirado. */
    await act(async () => root!.unmount());
    root = undefined;
    await act(async () => new Promise((resolver) => setTimeout(resolver, 20)));
    expect(falsa.contenido(FICHERO)).toBeUndefined();
  });
});

describe("guardados que se solapan (P2-12)", () => {
  /**
   * El almacén de verdad, pero cada escritura espera a que la prueba la suelte. Cuenta cuántas hay a la vez.
   * Soltarlas en orden inverso es el caso malo: la versión vieja acaba la última.
   */
  function conCompuertas(real: AlmacenDeCarteras) {
    const esperando: Array<() => void> = [];
    let enCurso = 0;
    let maximo = 0;
    const deposito: AlmacenDeCarteras = {
      ...real,
      guardar: async (cartera, opciones) => {
        enCurso += 1;
        maximo = Math.max(maximo, enCurso);
        await new Promise<void>((soltar) => esperando.push(soltar));
        try {
          return await real.guardar(cartera, opciones);
        } finally {
          enCurso -= 1;
        }
      }
    };
    return { deposito, esperando, maximo: () => maximo };
  }

  it("dos guardados seguidos no escriben a la vez, y en el disco queda el último", async () => {
    const real = almacen();
    await real.guardar(garcia());
    const { deposito, esperando, maximo } = conCompuertas(real);
    await montar(<Arnes deposito={deposito} fichero={FICHERO} inicial={garcia()} />);
    anadir("m-2");
    act(() => void abierta.guardarAhora());
    anadir("m-3");
    act(() => void abierta.guardarAhora());
    await act(async () => new Promise((resolver) => setTimeout(resolver, 20)));
    /* El segundo espera al primero: solo hay una escritura en curso. */
    expect(esperando).toHaveLength(1);
    /* Se sueltan siempre las últimas en llegar: si hubiera dos a la vez, la de m-2 acabaría después que la de m-3. */
    await esperar(() => {
      esperando.pop()?.();
      return esperando.length === 0 && abierta.guardado === "guardado";
    });
    expect(maximo()).toBe(1);
    expect(idsEnDisco()).toEqual(["m-1", "m-2", "m-3"]);
  });

  it("conectar una carpeta con cambios en pantalla no descarga un rescate: los escribe en la carpeta", async () => {
    await montar(<Arnes deposito={null} fichero={null} inicial={garcia()} />);
    anadir("m-2");
    expect(abierta.guardado).toBe("sin-descargar");
    const a = almacen();
    await act(async () => root!.render(<Arnes deposito={a} fichero={null} inicial={garcia()} />));
    await esperar(() => abierta.guardado === "guardado");
    expect(descargas.descargar).not.toHaveBeenCalled();
    expect(idsEnDisco()).toEqual(["m-1", "m-2"]);
  });

  it("al desmontar con un guardado en curso, la escritura de salida espera a la suya y no repite", async () => {
    const real = almacen();
    await real.guardar(garcia());
    const { deposito, esperando, maximo } = conCompuertas(real);
    await montar(<Arnes deposito={deposito} fichero={FICHERO} inicial={garcia()} />);
    anadir("m-2");
    act(() => void abierta.guardarAhora());
    await act(async () => root!.unmount());
    root = undefined;
    await act(async () => new Promise((resolver) => setTimeout(resolver, 20)));
    expect(esperando).toHaveLength(1);
    esperando.pop()!();
    await esperar(() => idsEnDisco().includes("m-2"));
    await act(async () => new Promise((resolver) => setTimeout(resolver, 20)));
    /* Lo de salida ya estaba escrito: no hay una segunda escritura, ni rescate. */
    expect(esperando).toHaveLength(0);
    expect(maximo()).toBe(1);
    expect(descargas.descargar).not.toHaveBeenCalled();
  });
});

describe("la pantalla de la cartera ante los fallos (GES-01, GES-02, GES-03)", () => {
  /** Un almacén cuya escritura falla siempre con `codigo`. Con `fichero` nulo la vista guarda nada más abrir. */
  function queFalla(codigo: "PERMISO" | "CONFLICTO") {
    const pedirPermiso = vi.fn(async () => true);
    const deposito: AlmacenDeCarteras = { ...almacen(), guardar: () => Promise.reject(new ErrorDeAlmacen(codigo, `Fallo de prueba: ${codigo}.`)), pedirPermiso };
    return { deposito, pedirPermiso };
  }

  it("con un error de permiso enseña «Descargar una copia ahora» activo y «Volver a dar permiso»", async () => {
    const { deposito, pedirPermiso } = queFalla("PERMISO");
    await montar(<VistaDeCartera alVolver={() => undefined} almacen={deposito} fichero={null} inicial={garcia()} />);
    await esperar(() => boton("Descargar una copia ahora") !== undefined);
    expect(boton("Descargar una copia ahora")!.disabled).toBe(false);
    expect(boton("Reintentar")).toBeDefined();
    await act(async () => boton("Descargar una copia ahora")!.click());
    expect(descargas.descargar).toHaveBeenCalledTimes(1);
    await act(async () => boton("Volver a dar permiso")!.click());
    expect(pedirPermiso).toHaveBeenCalledTimes(1);
  });

  it("con un conflicto ofrece recargar la versión del disco o guardar como una cartera aparte", async () => {
    const { deposito } = queFalla("CONFLICTO");
    await montar(<VistaDeCartera alVolver={() => undefined} almacen={deposito} fichero={null} inicial={garcia()} />);
    await esperar(() => boton("Recargar la versión del disco") !== undefined);
    expect(boton("Guardar como una cartera aparte")).toBeDefined();
    expect(boton("Descargar una copia ahora")).toBeDefined();
    expect(document.body.textContent).toMatch(/ha cambiado fuera de esta pestaña/);
  });

  it("«← Carteras de clientes» con la carpeta en error pregunta antes de salir y ofrece descargar", async () => {
    const { deposito } = queFalla("PERMISO");
    const alVolver = vi.fn();
    await montar(<VistaDeCartera alVolver={alVolver} almacen={deposito} fichero={null} inicial={garcia()} />);
    await esperar(() => boton("Descargar una copia ahora") !== undefined);
    await act(async () => boton("← Carteras de clientes")!.click());
    await esperar(() => boton("Descargar una copia y salir") !== undefined);
    expect(alVolver).not.toHaveBeenCalled();
    await act(async () => boton("Descargar una copia y salir")!.click());
    await esperar(() => alVolver.mock.calls.length === 1);
    expect(descargas.descargar).toHaveBeenCalledTimes(1);
  });

  it("«← Carteras de clientes» sin cambios sale sin preguntar", async () => {
    const a = almacen();
    await a.guardar(garcia());
    const alVolver = vi.fn();
    await montar(<VistaDeCartera alVolver={alVolver} almacen={a} fichero={FICHERO} inicial={garcia()} />);
    await act(async () => boton("← Carteras de clientes")!.click());
    await esperar(() => alVolver.mock.calls.length === 1);
  });
});
