/**
 * Dos o más pestañas guardando A LA VEZ la misma cartera (22-11-2026).
 *
 * Antes, cada almacén ponía en fila solo sus escrituras, y la comprobación de la huella no era
 * atómica: las dos pestañas la pasaban, la segunda escritura hacía fallar la verificación de la
 * primera, y la primera restituía el original encima de lo que la segunda acababa de dar por
 * guardado. Se perdía un guardado confirmado sin copia de la que recuperarlo.
 *
 * La regla que se prueba: todo guardado que dice «guardado» deja su versión en el fichero de la
 * cartera o en una de sus copias; el que no, falla con CONFLICTO; y nada restituye una versión
 * vieja encima de otra válida que haya escrito alguien de fuera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorDeAlmacen } from "../../src/gestor/almacen/almacen";
import { almacenEnCarpeta, PREFIJO_DEL_CERROJO, type GestorDeCerrojos } from "../../src/gestor/almacen/carpeta";
import { leer, serializar } from "../../src/gestor/almacen/formato";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { activo, cartera, mov } from "./ayudas";
import { crearCarpetaFalsa, type CarpetaFalsa } from "./carpetaFalsa";
import { crearCerrojosFalsos } from "./cerrojosFalsos";

const INICIO = Date.parse("2026-11-13T09:00:00Z");
const ID = "aaaaaaaa-1111-4000-8000-000000000001";
const FICHERO = "Familia García.cartera.json";
const COPIAS = `copias/${ID}/`;

let reloj = INICIO;
let falsa: CarpetaFalsa;

beforeEach(() => {
  reloj = INICIO;
  falsa = crearCarpetaFalsa({ reloj: () => reloj });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function garcia(): Cartera {
  return cartera([activo("ES0000000001", "FONDO")], [mov("aportacion", "2026-01-02", { id: "m-1", importe: "1000" })], {
    id: ID,
    nombre: "Familia García",
    cliente: { nombre: "Familia García" }
  });
}

function conOtroMovimiento(c: Cartera, id: string): Cartera {
  return { ...c, movimientos: [...c.movimientos, mov("aportacion", "2026-02-01", { id, importe: "50" })] };
}

function pestana(cerrojos: GestorDeCerrojos | null | undefined, carpeta: FileSystemDirectoryHandle = falsa.carpeta) {
  return almacenEnCarpeta(carpeta, cerrojos === undefined ? { ahora: () => new Date(reloj) } : { ahora: () => new Date(reloj), cerrojos });
}

/** Los movimientos de un fichero de cartera, o `undefined` si no se abre. */
function movimientosDe(texto: string | undefined): string[] | undefined {
  if (texto === undefined) return undefined;
  try {
    return leer(texto).cartera.movimientos.map((m) => m.id);
  } catch {
    return undefined;
  }
}

/** Dónde está la versión que lleva el movimiento `marca`: el fichero de la cartera o una copia suya. */
function dondeEsta(marca: string): string[] {
  return Object.entries(falsa.volcar())
    .filter(([ruta]) => ruta === FICHERO || ruta.startsWith(COPIAS))
    .filter(([, texto]) => movimientosDe(texto)?.includes(marca) === true)
    .map(([ruta]) => ruta);
}

function codigoDe(resultado: PromiseSettledResult<unknown>): string {
  if (resultado.status === "fulfilled") return "OK";
  return resultado.reason instanceof ErrorDeAlmacen ? resultado.reason.codigo : `otro: ${String(resultado.reason)}`;
}

/** N pestañas abren la misma versión y guardan cada una un movimiento suyo, todas a la vez. */
async function guardanALaVez(pestanas: Array<ReturnType<typeof pestana>>): Promise<string[]> {
  await pestana(null).guardar(garcia());
  reloj += 60_000;
  const abiertas = await Promise.all(pestanas.map(async (p) => (await p.abrir(FICHERO)).cartera));
  const resultados = await Promise.allSettled(pestanas.map((p, i) => p.guardar(conOtroMovimiento(abiertas[i], `pestana-${i}`))));
  return resultados.map(codigoDe);
}

/**
 * La carpeta, con una escritura de fuera justo después de que se cierre la siguiente escritura de `fichero`:
 * lo que haría otra pestaña sin cerrojos, otro equipo con la carpeta sincronizada u otro programa.
 */
function conEscrituraDeFuera(fichero: string, ajeno: () => string): { carpeta: FileSystemDirectoryHandle; armar(): void } {
  let armada = false;
  const ligado = <T extends object>(objeto: T, clave: string | symbol) => {
    const valor: unknown = Reflect.get(objeto, clave);
    return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objeto) : valor;
  };
  const carpeta = new Proxy(falsa.carpeta, {
    get(raiz, clave) {
      if (clave !== "getFileHandle") return ligado(raiz, clave);
      return async (nombre: string, opciones?: FileSystemGetFileOptions) => {
        const manejador = await raiz.getFileHandle(nombre, opciones);
        if (nombre !== fichero) return manejador;
        return new Proxy(manejador, {
          get(m, c) {
            if (c !== "createWritable") return ligado(m, c);
            return async () => {
              const flujo = await m.createWritable();
              return new Proxy(flujo, {
                get(f, k) {
                  if (k !== "close") return ligado(f, k);
                  return async () => {
                    await f.close();
                    if (armada) {
                      armada = false;
                      falsa.poner(fichero, ajeno());
                    }
                  };
                }
              });
            };
          }
        });
      };
    }
  });
  return {
    carpeta,
    armar: () => {
      armada = true;
    }
  };
}

describe("con cerrojos entre pestañas (Web Locks)", () => {
  it("dos pestañas que guardan a la vez: la primera guarda, la segunda da CONFLICTO y no pisa nada", async () => {
    const { cerrojos, pedidos } = crearCerrojosFalsos();
    const [a, b] = [pestana(cerrojos), pestana(cerrojos)];
    expect(await guardanALaVez([a, b])).toEqual(["OK", "CONFLICTO"]);
    /* El fichero tiene lo de la primera; lo de la segunda sigue en su pestaña (no se escribió). */
    expect(movimientosDe(falsa.contenido(FICHERO))).toEqual(["m-1", "pestana-0"]);
    expect(dondeEsta("pestana-1")).toEqual([]);
    /* Y lo que la segunda encontró en el disco queda también en una copia. */
    expect(dondeEsta("pestana-0").filter((r) => r.startsWith(COPIAS))).toHaveLength(1);
    /* Las dos pidieron el mismo cerrojo, el de la carpeta. */
    expect(pedidos).toEqual([`${PREFIJO_DEL_CERROJO}Carteras`, `${PREFIJO_DEL_CERROJO}Carteras`]);
  });

  it("cuatro pestañas a la vez: una guarda, tres dan CONFLICTO, y lo guardado está en el fichero", async () => {
    const { cerrojos } = crearCerrojosFalsos();
    const pestanas = [0, 1, 2, 3].map(() => pestana(cerrojos));
    const codigos = await guardanALaVez(pestanas);
    expect(codigos.filter((c) => c === "OK")).toHaveLength(1);
    expect(codigos.filter((c) => c === "CONFLICTO")).toHaveLength(3);
    const guardada = codigos.indexOf("OK");
    expect(dondeEsta(`pestana-${guardada}`)).toContain(FICHERO);
  });

  it("la que dio CONFLICTO guarda después de recargar, y no se pierde ninguna de las dos", async () => {
    const { cerrojos } = crearCerrojosFalsos();
    const [a, b] = [pestana(cerrojos), pestana(cerrojos)];
    await guardanALaVez([a, b]);
    reloj += 60_000;
    const recargada = (await b.abrir(FICHERO)).cartera;
    await b.guardar(conOtroMovimiento(recargada, "otra-vez"));
    expect(movimientosDe(falsa.contenido(FICHERO))).toEqual(["m-1", "pestana-0", "otra-vez"]);
  });

  it("retirar en una pestaña mientras otra guarda: van una detrás de otra y no se pierde nada", async () => {
    const { cerrojos } = crearCerrojosFalsos();
    const [a, b] = [pestana(cerrojos), pestana(cerrojos)];
    await pestana(null).guardar(garcia());
    const abierta = (await a.abrir(FICHERO)).cartera;
    await b.abrir(FICHERO);
    reloj += 60_000;
    const resultados = await Promise.allSettled([a.guardar(conOtroMovimiento(abierta, "m-a")), b.retirar(FICHERO)]);
    expect(resultados.map(codigoDe)).toEqual(["OK", "OK"]);
    /* Lo guardado se retiró entero: la cartera con m-a está en la papelera. */
    const papelera = Object.entries(falsa.volcar()).filter(([ruta]) => ruta.startsWith("papelera/") && !ruta.startsWith("papelera/copias/"));
    expect(papelera.map(([, texto]) => movimientosDe(texto))).toEqual([["m-1", "m-a"]]);
  });

  it("sin pasar cerrojos, el almacén usa los del navegador (navigator.locks)", async () => {
    const { cerrojos, pedidos } = crearCerrojosFalsos();
    vi.stubGlobal("navigator", { locks: cerrojos });
    expect(await guardanALaVez([pestana(undefined), pestana(undefined)])).toEqual(["OK", "CONFLICTO"]);
    expect(pedidos).toHaveLength(2);
  });

  it.skipIf(typeof (globalThis as { navigator?: { locks?: unknown } }).navigator?.locks !== "object")(
    "con los cerrojos de verdad del entorno (Node 24 trae navigator.locks), el mismo resultado",
    async () => {
      expect(await guardanALaVez([pestana(undefined), pestana(undefined)])).toEqual(["OK", "CONFLICTO"]);
      expect(movimientosDe(falsa.contenido(FICHERO))).toEqual(["m-1", "pestana-0"]);
    }
  );
});

describe("sin cerrojos (navegador sin navigator.locks): la cola de cada pestaña, como antes", () => {
  it("el cruce del 22-11: ningún guardado que diga «guardado» se pierde, y el otro da CONFLICTO con su versión en las copias", async () => {
    const [a, b] = [pestana(null), pestana(null)];
    const codigos = await guardanALaVez([a, b]);
    /* Antes: ["VERIFICACION", "OK"] y el fichero y su copia con el ORIGINAL, sin el movimiento de ninguna de las dos. */
    expect(codigos).toEqual(["CONFLICTO", "OK"]);
    expect(movimientosDe(falsa.contenido(FICHERO))).toEqual(["m-1", "pestana-1"]); // la que dijo «guardado», en el fichero
    expect(dondeEsta("pestana-0")).toEqual([expect.stringMatching(new RegExp(`^${COPIAS}`))]); // la otra, en una copia
  });
});

describe("la restitución no pisa una versión de fuera", () => {
  it("si al releer hay otra versión válida, se deja, lo nuestro va a las copias y se avisa con CONFLICTO", async () => {
    const deFuera = serializar(conOtroMovimiento(garcia(), "m-de-fuera"), "2026-11-13T09:01:30.000Z");
    const { carpeta, armar } = conEscrituraDeFuera(FICHERO, () => deFuera);
    const a = pestana(null, carpeta);
    await a.guardar(garcia());
    reloj += 60_000;
    armar();
    const resultado = await Promise.allSettled([a.guardar(conOtroMovimiento(garcia(), "m-nuestro"))]);
    expect(codigoDe(resultado[0])).toBe("CONFLICTO");
    expect((resultado[0] as PromiseRejectedResult).reason.message).toMatch(/mientras se guardaba.*queda en sus copias de seguridad/);
    /* Lo de fuera sigue en el fichero, intacto; lo nuestro, en una copia identificada; y el original, en otra. */
    expect(falsa.contenido(FICHERO)).toBe(deFuera);
    expect(dondeEsta("m-nuestro")).toEqual([expect.stringMatching(new RegExp(`^${COPIAS}2026-11-13T09-01-00Z`))]);
    expect(Object.keys(falsa.volcar()).filter((r) => r.startsWith(COPIAS))).toHaveLength(2);
    /* Hasta recargar, esta pestaña no escribe encima de lo de fuera. */
    reloj += 60_000;
    const otra = await Promise.allSettled([a.guardar(conOtroMovimiento(garcia(), "m-otro"))]);
    expect(codigoDe(otra[0])).toBe("CONFLICTO");
    expect(falsa.contenido(FICHERO)).toBe(deFuera);
  });

  it("una cartera nueva cuyo fichero escribe otra entretanto: no se quita, y la nueva queda en sus copias", async () => {
    const otraId = "bbbbbbbb-2222-4000-8000-000000000002";
    const deOtra = serializar({ ...garcia(), id: otraId }, "2026-11-13T09:00:30.000Z");
    const { carpeta, armar } = conEscrituraDeFuera(FICHERO, () => deOtra);
    armar();
    const resultado = await Promise.allSettled([pestana(null, carpeta).guardar(conOtroMovimiento(garcia(), "m-nueva"))]);
    expect(codigoDe(resultado[0])).toBe("CONFLICTO");
    expect(falsa.contenido(FICHERO)).toBe(deOtra);
    expect(dondeEsta("m-nueva")).toHaveLength(1);
    expect(dondeEsta("m-nueva")[0]).toMatch(new RegExp(`^${COPIAS}`));
  });

  it("un fichero estropeado al escribir sí se restituye (lo de siempre, VERIFICACION)", async () => {
    const a = pestana(null);
    await a.guardar(garcia());
    const antes = falsa.contenido(FICHERO);
    reloj += 60_000;
    await a.guardar(conOtroMovimiento(garcia(), "m-2")); // primera copia
    const despues = falsa.contenido(FICHERO);
    expect(despues).not.toBe(antes);
    reloj += 60_000;
    falsa.corromperLaSiguienteEscritura();
    const resultado = await Promise.allSettled([a.guardar(conOtroMovimiento(conOtroMovimiento(garcia(), "m-2"), "m-3"))]);
    expect(codigoDe(resultado[0])).toBe("VERIFICACION");
    expect(falsa.contenido(FICHERO)).toBe(despues);
  });
});
