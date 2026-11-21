import { beforeEach, describe, expect, it } from "vitest";
import { ErrorDeAlmacen } from "../../src/gestor/almacen/almacen";
import { almacenEnCarpeta } from "../../src/gestor/almacen/carpeta";
import { serializar } from "../../src/gestor/almacen/formato";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { activo, cartera, mov } from "./ayudas";
import { crearCarpetaFalsa, type CarpetaFalsa } from "./carpetaFalsa";

const INICIO = Date.parse("2026-11-13T09:00:00Z");
const MINUTO = 60_000;

let reloj = INICIO;
let falsa: CarpetaFalsa;

beforeEach(() => {
  reloj = INICIO;
  falsa = crearCarpetaFalsa({ reloj: () => reloj });
});

function almacen() {
  return almacenEnCarpeta(falsa.carpeta, { ahora: () => new Date(reloj) });
}

function garcia(extra: Partial<Cartera> = {}): Cartera {
  return cartera([activo("ES0000000001", "FONDO")], [mov("aportacion", "2026-01-02", { id: "m-1", importe: "1000" })], {
    id: "aaaaaaaa-1111-4000-8000-000000000001",
    nombre: "Familia García",
    cliente: { nombre: "Familia García" },
    ...extra
  });
}

/** La misma cartera con un movimiento más: un contenido distinto. */
function conOtroMovimiento(c: Cartera, id: string): Cartera {
  return { ...c, movimientos: [...c.movimientos, mov("aportacion", "2026-02-01", { id, importe: "50" })] };
}

async function rechazo(promesa: Promise<unknown>): Promise<ErrorDeAlmacen> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeAlmacen) return error;
    throw error;
  }
  throw new Error("No falló");
}

const FICHERO = "Familia García.cartera.json";
const COPIAS = "copias/aaaaaaaa-1111-4000-8000-000000000001/";

describe("guardar, abrir y listar", () => {
  it("guarda y vuelve a abrir la misma cartera", async () => {
    const a = almacen();
    const c = garcia();
    const { fichero, copia } = await a.guardar(c);
    expect(fichero).toBe(FICHERO);
    expect(copia).toBeUndefined();
    expect(Object.keys(falsa.volcar())).toEqual([FICHERO]);
    expect(falsa.contenido(FICHERO)).toBe(serializar(c, new Date(INICIO).toISOString()));
    const leida = await a.abrir(FICHERO);
    expect(leida.cartera).toEqual(c);
    /* Otro almacén sobre la misma carpeta (otra visita) la abre igual. */
    expect((await almacen().abrir(FICHERO)).cartera).toEqual(c);
    expect(a.nombre).toBe("Carteras");
    expect(a.clase).toBe("carpeta");
  });

  it("lista las carteras de la raíz; un fichero corrupto sale con su error y no rompe la lista", async () => {
    const a = almacen();
    await a.guardar(garcia({ modificada: "2026-11-10T08:00:00.000Z" }));
    await a.guardar(cartera([], [], { id: "bbbbbbbb-2222", nombre: "Modelo 60-40", modificada: "2026-11-12T08:00:00.000Z" }));
    falsa.poner("Rota.cartera.json", "{ esto no se puede leer");
    falsa.poner("De otra versión.cartera.json", JSON.stringify({ formato: "gestor-carteras", version: 9, cartera: { id: "zz" } }));
    falsa.poner("notas.txt", "no es una cartera");
    falsa.poner("copias/xx/2026-11-13T08-00-00Z.cartera.json", serializar(garcia()));

    const lista = await a.listar();
    expect(lista.map((r) => r.fichero)).toEqual([
      /* Los ilegibles llevan la fecha del fichero (la del reloj, 13-11 09:00), posterior a las dos carteras. */
      "De otra versión.cartera.json",
      "Rota.cartera.json",
      "Modelo 60-40.cartera.json",
      FICHERO
    ]);
    const [otraVersion, rota, modelo, familia] = lista;
    expect(rota.error).toMatch(/no es un JSON válido/);
    expect(rota.nombre).toBe("Rota");
    expect(otraVersion.error).toMatch(/formato 9/);
    expect(otraVersion.id).toBe("zz");
    expect(modelo).toMatchObject({ id: "bbbbbbbb-2222", nombre: "Modelo 60-40", divisaBase: "EUR", movimientos: 0 });
    expect(modelo.error).toBeUndefined();
    expect(familia).toMatchObject({ nombre: "Familia García", cliente: "Familia García", movimientos: 1, modificada: "2026-11-10T08:00:00.000Z" });
  });

  it("dos carteras con el mismo nombre no se pisan", async () => {
    const a = almacen();
    const primera = garcia();
    const segunda = cartera([], [], { id: "bbbbbbbb-2222-4000-8000-000000000002", nombre: "Familia García" });
    expect((await a.guardar(primera)).fichero).toBe(FICHERO);
    expect((await a.guardar(segunda)).fichero).toBe("Familia García (bbbbbbbb).cartera.json");
    /* Volver a guardar cada una va a su fichero, también desde otra visita sin memoria. */
    expect((await a.guardar(conOtroMovimiento(segunda, "m-9"))).fichero).toBe("Familia García (bbbbbbbb).cartera.json");
    expect((await almacen().guardar(conOtroMovimiento(primera, "m-8"))).fichero).toBe(FICHERO);
    expect((await almacen().abrir(FICHERO)).cartera.id).toBe(primera.id);
    expect((await almacen().abrir("Familia García (bbbbbbbb).cartera.json")).cartera.id).toBe(segunda.id);
    /* Windows no distingue mayúsculas: «FAMILIA GARCÍA» choca con el mismo fichero. */
    const tercera = cartera([], [], { id: "cccccccc-3333", nombre: "FAMILIA GARCÍA" });
    expect((await a.guardar(tercera)).fichero).toBe("FAMILIA GARCÍA (cccccccc).cartera.json");
  });

  it("al cambiar de nombre se escribe el fichero nuevo y se quita el antiguo; las copias siguen por id", async () => {
    const a = almacen();
    const c = garcia();
    await a.guardar(c);
    reloj += MINUTO;
    const { fichero, copia } = await a.guardar({ ...c, nombre: "García Pérez" });
    expect(fichero).toBe("García Pérez.cartera.json");
    expect(copia?.carteraId).toBe(c.id);
    const arbol = falsa.volcar();
    expect(Object.keys(arbol).sort()).toEqual([`${COPIAS}2026-11-13T09-01-00Z.cartera.json`, "García Pérez.cartera.json"].sort());
    /* La copia es la versión con el nombre antiguo. */
    expect((await a.leerCopia(copia!)).cartera.nombre).toBe("Familia García");
    /* Y desde otra visita, guardar con el nombre nuevo sigue en el mismo fichero. */
    reloj += MINUTO;
    expect((await almacen().guardar(conOtroMovimiento({ ...c, nombre: "García Pérez" }, "m-2"))).fichero).toBe("García Pérez.cartera.json");
  });

  it("guardar sin cambios no reescribe el fichero ni hace copia", async () => {
    const a = almacen();
    const c = garcia();
    await a.guardar(c);
    const antes = falsa.contenido(FICHERO);
    reloj += 30 * MINUTO;
    const resultado = await a.guardar(structuredClone(c));
    expect(resultado).toEqual({ fichero: FICHERO });
    expect(falsa.contenido(FICHERO)).toBe(antes);
    expect(await a.copias(c.id)).toEqual([]);
  });

  it("abrir un fichero que no está: NO_ENCONTRADO", async () => {
    const error = await rechazo(almacen().abrir("No existe.cartera.json"));
    expect(error.codigo).toBe("NO_ENCONTRADO");
    expect(error.message).toBe("No se encuentra «No existe.cartera.json» en la carpeta de carteras.");
  });
});

describe("escritura segura", () => {
  it("una escritura que falla a mitad no deja el fichero vivo corrupto ni pierde la versión anterior", async () => {
    const a = almacen();
    await a.guardar(garcia());
    reloj += MINUTO;
    const c = conOtroMovimiento(garcia(), "m-1b");
    await a.guardar(c); // hace la primera copia
    const antes = falsa.contenido(FICHERO);
    /* Dentro de los 10 minutos no toca otra copia: la escritura que falla es la del propio fichero. */
    reloj += MINUTO;
    falsa.fallarLaSiguienteEscritura();
    const error = await rechazo(a.guardar(conOtroMovimiento(c, "m-2")));
    expect(error.codigo).toBe("ESCRITURA");
    expect(error.message).toMatch(/^No se pudo guardar la cartera «Familia García»\. .*El fichero que había sigue intacto/);
    expect(falsa.contenido(FICHERO)).toBe(antes);
    expect((await a.abrir(FICHERO)).cartera).toEqual(c);
    /* Y el siguiente intento sale bien. */
    await a.guardar(conOtroMovimiento(c, "m-2"));
    expect((await a.abrir(FICHERO)).cartera.movimientos).toHaveLength(3);
  });

  it("si falla la escritura de una cartera nueva, no queda un fichero vacío", async () => {
    falsa.fallarLaSiguienteEscritura();
    await rechazo(almacen().guardar(garcia()));
    expect(falsa.volcar()).toEqual({});
  });

  it("si la copia de seguridad no se puede hacer, no se guarda", async () => {
    const a = almacen();
    const c = garcia();
    await a.guardar(c);
    const antes = falsa.contenido(FICHERO);
    reloj += MINUTO;
    falsa.fallarLaSiguienteEscritura(); // la primera escritura es la de la copia
    const error = await rechazo(a.guardar(conOtroMovimiento(c, "m-2")));
    expect(error.codigo).toBe("ESCRITURA");
    expect(falsa.contenido(FICHERO)).toBe(antes);
  });

  it("si al releer el fichero no se puede abrir, avisa y deja el que había", async () => {
    const a = almacen();
    await a.guardar(garcia());
    reloj += MINUTO;
    const c = conOtroMovimiento(garcia(), "m-1b");
    await a.guardar(c); // hace la primera copia; la siguiente escritura será la del fichero
    const antes = falsa.contenido(FICHERO);
    reloj += MINUTO;
    falsa.corromperLaSiguienteEscritura();
    const error = await rechazo(a.guardar(conOtroMovimiento(c, "m-2")));
    expect(error.codigo).toBe("VERIFICACION");
    expect(error.message).toMatch(/no se da por guardada/);
    expect(falsa.contenido(FICHERO)).toBe(antes);
  });

  it("si el permiso se retira, el error lo dice claro", async () => {
    const a = almacen();
    await a.guardar(garcia());
    falsa.negarPermiso();
    const alGuardar = await rechazo(a.guardar(conOtroMovimiento(garcia(), "m-2")));
    expect(alGuardar.codigo).toBe("PERMISO");
    expect(alGuardar.message).toBe("No hay permiso para escribir en la carpeta de carteras. Vuelve a elegirla.");
    const alListar = await rechazo(a.listar());
    expect(alListar.codigo).toBe("PERMISO");
    expect(alListar.message).toBe("No hay permiso para leer la carpeta de carteras. Vuelve a elegirla.");
    falsa.negarPermiso(false);
    expect(await a.listar()).toHaveLength(1);
  });
});

describe("copias de seguridad", () => {
  it("la primera sobrescritura deja copia de la versión anterior, y leerCopia la devuelve", async () => {
    const a = almacen();
    const v1 = garcia();
    await a.guardar(v1);
    const textoV1 = falsa.contenido(FICHERO);
    reloj += MINUTO;
    const { copia } = await a.guardar(conOtroMovimiento(v1, "m-2"));
    expect(copia).toEqual({
      carteraId: v1.id,
      fichero: "2026-11-13T09-01-00Z.cartera.json",
      fecha: "2026-11-13T09:01:00.000Z",
      movimientos: 1,
      bytes: new TextEncoder().encode(textoV1).length
    });
    expect(falsa.contenido(`${COPIAS}2026-11-13T09-01-00Z.cartera.json`)).toBe(textoV1);
    expect((await a.leerCopia(copia!)).cartera).toEqual(v1);
    expect(await a.copias(v1.id)).toEqual([copia]);
  });

  it("dos guardados en menos de 10 minutos no duplican copia; pasados 10, sí", async () => {
    const a = almacen();
    let c = garcia();
    await a.guardar(c);
    reloj += MINUTO; // 09:01: primera copia (de la versión de las 09:00)
    c = conOtroMovimiento(c, "m-2");
    expect((await a.guardar(c)).copia).toBeDefined();
    reloj += 5 * MINUTO; // 09:06: la última copia tiene 5 minutos
    c = conOtroMovimiento(c, "m-3");
    expect((await a.guardar(c)).copia).toBeUndefined();
    reloj += 6 * MINUTO; // 09:12: la última copia tiene 11 minutos
    const textoAnterior = falsa.contenido(FICHERO);
    c = conOtroMovimiento(c, "m-4");
    const { copia } = await a.guardar(c);
    expect(copia?.fichero).toBe("2026-11-13T09-12-00Z.cartera.json");
    expect(falsa.contenido(`${COPIAS}2026-11-13T09-12-00Z.cartera.json`)).toBe(textoAnterior);
    const copias = await a.copias(c.id);
    expect(copias.map((x) => [x.fichero, x.movimientos])).toEqual([
      ["2026-11-13T09-12-00Z.cartera.json", 3],
      ["2026-11-13T09-01-00Z.cartera.json", 1]
    ]);
  });

  it("la retención se aplica al hacer cada copia: un día con 25 copias se queda en 20", async () => {
    const a = almacen();
    let c = garcia();
    await a.guardar(c);
    for (let i = 0; i < 25; i += 1) {
      reloj += 11 * MINUTO;
      c = conOtroMovimiento(c, `m-x${i}`);
      await a.guardar(c);
    }
    const copias = await a.copias(c.id);
    expect(copias).toHaveLength(20);
    /* Se quedan las 20 últimas: de la 6.ª a la 25.ª (09:00 + 6 × 11 min = 10:06; 09:00 + 25 × 11 min = 13:35). */
    expect(copias[0].fecha).toBe("2026-11-13T13:35:00.000Z");
    expect(copias[19].fecha).toBe("2026-11-13T10:06:00.000Z");
  });
});

describe("copia obligada (GES-10)", () => {
  it("con copiaObligada se copia lo que se sustituye aunque la última copia tenga menos de 10 minutos", async () => {
    const a = almacen();
    let c = garcia();
    await a.guardar(c);
    reloj += MINUTO; // 09:01: primera copia
    c = conOtroMovimiento(c, "m-2");
    await a.guardar(c);
    reloj += 2 * MINUTO; // 09:03: la última copia tiene 2 minutos; sin obligar, no tocaría
    const antes = falsa.contenido(FICHERO);
    c = conOtroMovimiento(c, "m-3");
    const { copia } = await a.guardar(c, { copiaObligada: true });
    expect(copia?.fichero).toBe("2026-11-13T09-03-00Z.cartera.json");
    expect(falsa.contenido(`${COPIAS}2026-11-13T09-03-00Z.cartera.json`)).toBe(antes);
    expect((await a.copias(c.id)).map((x) => x.fichero)).toEqual(["2026-11-13T09-03-00Z.cartera.json", "2026-11-13T09-01-00Z.cartera.json"]);
  });

  it("copiaObligada no hace copia si no hay nada que sustituir (cartera nueva o sin cambios)", async () => {
    const a = almacen();
    const c = garcia();
    expect((await a.guardar(c, { copiaObligada: true })).copia).toBeUndefined();
    expect((await a.guardar(structuredClone(c), { copiaObligada: true })).copia).toBeUndefined();
    expect(await a.copias(c.id)).toEqual([]);
  });
});

describe("dos pestañas con la misma cartera (GES-02)", () => {
  it("la segunda no pisa lo que escribió la primera: falla con CONFLICTO y deja copia de lo del disco", async () => {
    await almacen().guardar(garcia());
    const pestana1 = almacen();
    const pestana2 = almacen();
    const enLa1 = (await pestana1.abrir(FICHERO)).cartera;
    const enLa2 = (await pestana2.abrir(FICHERO)).cartera;

    reloj += MINUTO; // 09:01: la pestaña 1 guarda (y hace la copia del original)
    await pestana1.guardar(conOtroMovimiento(enLa1, "m-de-la-1"));
    const deLa1 = falsa.contenido(FICHERO);

    reloj += 2 * MINUTO; // 09:03: dentro de los 10 minutos, la pestaña 2 guarda lo suyo
    const error = await rechazo(pestana2.guardar(conOtroMovimiento(enLa2, "m-de-la-2")));
    expect(error.codigo).toBe("CONFLICTO");
    expect(error.message).toMatch(/ha cambiado fuera de esta pestaña/);
    /* El fichero sigue con lo de la pestaña 1. */
    expect(falsa.contenido(FICHERO)).toBe(deLa1);
    /* Y lo del disco queda también en una copia, aunque la anterior tenga 2 minutos. */
    expect(falsa.contenido(`${COPIAS}2026-11-13T09-03-00Z.cartera.json`)).toBe(deLa1);
  });

  it("tras recargar lo del disco, la segunda pestaña ya guarda", async () => {
    await almacen().guardar(garcia());
    const pestana1 = almacen();
    const pestana2 = almacen();
    await pestana1.abrir(FICHERO);
    await pestana2.abrir(FICHERO);
    reloj += MINUTO;
    await pestana1.guardar(conOtroMovimiento(garcia(), "m-de-la-1"));
    reloj += MINUTO;
    await rechazo(pestana2.guardar(conOtroMovimiento(garcia(), "m-de-la-2")));
    const recargada = (await pestana2.abrir(FICHERO)).cartera;
    expect(recargada.movimientos.map((m) => m.id)).toEqual(["m-1", "m-de-la-1"]);
    reloj += MINUTO;
    await pestana2.guardar(conOtroMovimiento(recargada, "m-de-la-2"));
    expect((await almacen().abrir(FICHERO)).cartera.movimientos.map((m) => m.id)).toEqual(["m-1", "m-de-la-1", "m-de-la-2"]);
  });

  it("si lo que hay en el disco ya es lo que se quiere guardar, no es un conflicto", async () => {
    await almacen().guardar(garcia());
    const pestana1 = almacen();
    const pestana2 = almacen();
    await pestana1.abrir(FICHERO);
    await pestana2.abrir(FICHERO);
    const igual = conOtroMovimiento(garcia(), "m-2");
    reloj += MINUTO;
    await pestana1.guardar(igual);
    reloj += MINUTO;
    expect((await pestana2.guardar(structuredClone(igual))).fichero).toBe(FICHERO);
  });
});

describe("retirar", () => {
  it("mueve la cartera y sus copias a la papelera, sin borrar nada", async () => {
    const a = almacen();
    const c = garcia();
    await a.guardar(c);
    reloj += MINUTO;
    await a.guardar(conOtroMovimiento(c, "m-2"));
    const vivo = falsa.contenido(FICHERO);
    const copia = falsa.contenido(`${COPIAS}2026-11-13T09-01-00Z.cartera.json`);
    reloj += MINUTO;
    await a.retirar(FICHERO);
    expect(falsa.volcar()).toEqual({
      "copias/": "",
      [`papelera/${COPIAS}2026-11-13T09-01-00Z.cartera.json`]: copia,
      [`papelera/${FICHERO}`]: vivo
    });
    expect(await a.listar()).toEqual([]);
    expect(await a.copias(c.id)).toEqual([]);
  });

  it("si en la papelera ya hay un fichero con ese nombre, añade fecha y hora", async () => {
    const a = almacen();
    await a.guardar(garcia());
    await a.retirar(FICHERO);
    reloj += MINUTO;
    await a.guardar(garcia({ id: "otra-cartera" }));
    await a.retirar(FICHERO);
    expect(Object.keys(falsa.volcar())).toEqual([`papelera/Familia García 2026-11-13T09-01-00Z.cartera.json`, `papelera/${FICHERO}`]);
  });

  it("también retira un fichero que no se puede leer", async () => {
    falsa.poner("Rota.cartera.json", "basura");
    await almacen().retirar("Rota.cartera.json");
    expect(falsa.volcar()).toEqual({ "papelera/Rota.cartera.json": "basura" });
  });
});

describe("ajustes", () => {
  it("sin fichero, vacíos; ida y vuelta; un fichero dañado se dice", async () => {
    const a = almacen();
    expect(await a.leerAjustes()).toEqual({});
    const ajustes = {
      asesor: { nombre: "Ana Pérez", entidad: "Asesores SL", contacto: "ana@example.com", logotipo: "data:image/png;base64,iVBORw0KGgo=" },
      extensiones: { tema: "claro" }
    };
    await a.guardarAjustes(ajustes);
    expect(await a.leerAjustes()).toEqual(ajustes);
    expect(await almacen().leerAjustes()).toEqual(ajustes);
    expect(falsa.contenido("ajustes.json")).toMatch(/^\{\n {2}"formato": "gestor-carteras-ajustes",\n {2}"version": 1,/);
    falsa.poner("ajustes.json", "{roto");
    const error = await rechazo(a.leerAjustes());
    expect(error.codigo).toBe("LECTURA");
  });

  it("los ajustes no aparecen en la lista de carteras", async () => {
    const a = almacen();
    await a.guardarAjustes({ asesor: { nombre: "Ana" } });
    expect(await a.listar()).toEqual([]);
  });
});
