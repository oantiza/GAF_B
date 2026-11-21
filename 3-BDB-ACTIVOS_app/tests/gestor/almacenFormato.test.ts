import { describe, expect, it } from "vitest";
import {
  ErrorDeFormato,
  FORMATO,
  VERSION_ACTUAL,
  leer,
  leerConVersion,
  serializar,
  sinMarcaDeGuardado,
  type CodigoDeErrorDeFormato
} from "../../src/gestor/almacen/formato";
import type { Migraciones } from "../../src/gestor/almacen/migraciones/registro";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { activo, cartera, mov } from "./ayudas";

const GUARDADO = "2026-11-13T10:00:00.000Z";

function carteraCompleta(): Cartera {
  return cartera(
    [
      activo("ES0000000001", "FONDO"),
      activo("US0000000002", "BONO", "USD", {
        multiplicador: "0.01",
        bono: { cupon: "0.035", frecuencia: 2, vencimiento: "2030-06-15", base: "30/360" }
      })
    ],
    [
      mov("aportacion", "2026-01-02", { id: "m-1", importe: "10000", nota: "Alta" }),
      mov("compra", "2026-01-05", { id: "m-2", activoId: "ES0000000001", titulos: "12.5", precio: "100.25", importe: "-1253.13", comision: "0.005" }),
      mov("compra", "2026-02-05", {
        id: "m-3",
        activoId: "US0000000002",
        titulos: "5000",
        precio: "98.5",
        divisa: "USD",
        importe: "-4925",
        cambio: "1.0850",
        origen: { via: "importado", importacionId: "imp-1", fila: 4, textoOriginal: "COMPRA BONO" }
      })
    ],
    {
      cliente: { nombre: "Familia García" },
      preciosManuales: [{ activoId: "US0000000002", fecha: "2026-03-31", precio: "99.1" }],
      extractos: [{ id: "x-1", fecha: "2026-03-31", posiciones: [{ nombre: "Fondo", titulos: "12.5" }], efectivo: [{ divisa: "EUR", saldo: "3821.87" }] }],
      importaciones: [{ id: "imp-1", fecha: "2026-02-06T09:00:00.000Z", entidad: "Banco", documentos: [{ nombre: "extracto.pdf", tipo: "pdf" }], movimientos: 1 }],
      extensiones: { asignacionObjetivo: { renta_variable: "0.6", renta_fija: "0.4" }, bandas: [1, 2, 3] }
    }
  );
}

/** El texto de un fichero a partir de su objeto, para preparar casos malos. */
function texto(fichero: Record<string, unknown>): string {
  return JSON.stringify(fichero);
}

function ficheroDe(c: Cartera, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { formato: FORMATO, version: VERSION_ACTUAL, guardado: GUARDADO, cartera: c, ...extra };
}

function errorDe(tarea: () => unknown): ErrorDeFormato {
  try {
    tarea();
  } catch (error) {
    if (error instanceof ErrorDeFormato) return error;
    throw error;
  }
  throw new Error("No lanzó");
}

describe("serializar y leer", () => {
  it("ida y vuelta idéntica", () => {
    const c = carteraCompleta();
    const leida = leer(serializar(c, GUARDADO));
    expect(leida.cartera).toEqual(c);
    expect(leida.versionOriginal).toBe(1);
    expect(leida.migrada).toBe(false);
  });

  it("es determinista byte a byte, salvo la línea de guardado", () => {
    const c = carteraCompleta();
    expect(serializar(c, GUARDADO)).toBe(serializar(structuredClone(c), GUARDADO));
    /* Las mismas claves en otro orden dan el mismo texto. */
    const desordenada = Object.fromEntries(Object.entries(structuredClone(c)).reverse()) as unknown as Cartera;
    desordenada.movimientos = desordenada.movimientos.map((m) => Object.fromEntries(Object.entries(m).reverse()) as unknown as typeof m);
    expect(serializar(desordenada, GUARDADO)).toBe(serializar(c, GUARDADO));
    /* Otra hora de guardado solo cambia esa línea. */
    const otra = serializar(c, "2027-01-01T00:00:00.000Z");
    expect(otra).not.toBe(serializar(c, GUARDADO));
    expect(sinMarcaDeGuardado(otra)).toBe(sinMarcaDeGuardado(serializar(c, GUARDADO)));
  });

  it("escribe con sangría de dos espacios, LF, salto final y claves en orden legible", () => {
    const t = serializar(carteraCompleta(), GUARDADO);
    expect(t.endsWith("}\n")).toBe(true);
    expect(t).not.toContain("\r");
    expect(t.startsWith(`{\n  "formato": "gestor-carteras",\n  "version": 1,\n  "guardado": "${GUARDADO}",\n  "cartera": {\n    "id": "cartera-de-prueba",\n    "nombre": "Cartera de prueba",\n    "divisaBase": "EUR",`)).toBe(true);
    /* En un movimiento, la identidad primero y el origen al final. */
    const m3 = t.indexOf('"id": "m-3"');
    expect(t.indexOf('"tipo": "compra"', m3)).toBeGreaterThan(m3);
    expect(t.indexOf('"fechaOperacion"', m3)).toBeLessThan(t.indexOf('"activoId"', m3));
    expect(t.indexOf('"origen"', m3)).toBeGreaterThan(t.indexOf('"cambio"', m3));
    /* Las extensiones van al final de la cartera, con sus claves alfabéticas. */
    expect(t.indexOf('"extensiones"')).toBeGreaterThan(t.indexOf('"importaciones"'));
    expect(t.indexOf('"renta_fija"')).toBeLessThan(t.indexOf('"renta_variable"'));
  });

  it("conserva las extensiones y los campos desconocidos al leer y al escribir", () => {
    const c = carteraCompleta() as Cartera & Record<string, unknown>;
    c.campoDelFuturo = { algo: [1, "dos"] };
    (c.movimientos[0] as unknown as Record<string, unknown>).marca = "rojo";
    (c.activos[0] as unknown as Record<string, unknown>).riesgo = 4;
    const leida = leer(serializar(c, GUARDADO)).cartera as Cartera & Record<string, unknown>;
    expect(leida.campoDelFuturo).toEqual({ algo: [1, "dos"] });
    expect((leida.movimientos[0] as unknown as Record<string, unknown>).marca).toBe("rojo");
    expect((leida.activos[0] as unknown as Record<string, unknown>).riesgo).toBe(4);
    expect(leida.extensiones).toEqual({ asignacionObjetivo: { renta_variable: "0.6", renta_fija: "0.4" }, bandas: [1, 2, 3] });
    /* Y una segunda vuelta da el mismo texto. */
    expect(serializar(leida, GUARDADO)).toBe(serializar(c, GUARDADO));
  });

  it("rellena vacías las listas que faltan y la fecha de modificación con la del guardado", () => {
    const c = carteraCompleta() as unknown as Record<string, unknown>;
    delete c.preciosManuales;
    delete c.extractos;
    delete c.importaciones;
    delete c.modificada;
    const leida = leer(texto(ficheroDe(c as unknown as Cartera))).cartera;
    expect(leida.preciosManuales).toEqual([]);
    expect(leida.extractos).toEqual([]);
    expect(leida.importaciones).toEqual([]);
    expect(leida.modificada).toBe(GUARDADO);
  });

  it("admite un BOM al principio del fichero", () => {
    expect(leer(`\uFEFF${serializar(carteraCompleta(), GUARDADO)}`).cartera.id).toBe("cartera-de-prueba");
  });
});

describe("errores de formato", () => {
  const casos: Array<[string, () => string, CodigoDeErrorDeFormato, RegExp]> = [
    ["no es JSON", () => "{ esto no es json", "NO_ES_JSON", /no es un JSON válido/],
    ["es JSON pero no una cartera", () => texto({ hola: "mundo" }), "NO_ES_UNA_CARTERA", /no es una cartera del gestor/],
    ["es otro formato", () => texto({ formato: "otra-cosa", version: 1, cartera: {} }), "NO_ES_UNA_CARTERA", /no es una cartera del gestor/],
    ["una lista", () => "[1, 2]", "NO_ES_UNA_CARTERA", /no es una cartera del gestor/],
    ["versión no entera", () => texto({ formato: FORMATO, version: 1.5, cartera: {} }), "ESTRUCTURA", /versión del formato/],
    ["versión cero", () => texto({ formato: FORMATO, version: 0, cartera: {} }), "ESTRUCTURA", /versión del formato/],
    [
      "versión posterior",
      () => texto({ formato: FORMATO, version: 3, cartera: {} }),
      "VERSION_POSTERIOR",
      /^Esta cartera se guardó con una versión más nueva del gestor \(formato 3\)\. Actualiza la aplicación para abrirla\.$/
    ]
  ];
  for (const [nombre, preparar, codigo, mensaje] of casos) {
    it(nombre, () => {
      const error = errorDe(() => leer(preparar()));
      expect(error.codigo).toBe(codigo);
      expect(error.message).toMatch(mensaje);
    });
  }

  it("SIN_MIGRACION cuando falta una migración (versión 1 con versión actual 2 y sin registro)", () => {
    const error = errorDe(() => leerConVersion(serializar(carteraCompleta(), GUARDADO), {}, 2));
    expect(error.codigo).toBe("SIN_MIGRACION");
    expect(error.message).toBe("Esta cartera está guardada con el formato 1 y esta versión del gestor no sabe pasarla del formato 1 al 2.");
  });
});

describe("estructura inválida: el mensaje nombra el campo y el elemento", () => {
  function conCambio(cambiar: (c: Record<string, unknown>) => void): string {
    const c = structuredClone(carteraCompleta()) as unknown as Record<string, unknown>;
    cambiar(c);
    return texto(ficheroDe(c as unknown as Cartera));
  }
  const movimientos = (c: Record<string, unknown>) => c.movimientos as Array<Record<string, unknown>>;

  const casos: Array<[string, (c: Record<string, unknown>) => void, string]> = [
    ["sin id", (c) => delete c.id, "La cartera no tiene identificador."],
    ["sin nombre", (c) => delete c.nombre, "La cartera no tiene nombre."],
    ["sin divisa base", (c) => (c.divisaBase = ""), "La cartera no tiene divisa base."],
    ["sin cuentas", (c) => delete c.cuentas, "La cartera no tiene sus cuentas de efectivo y de valores."],
    ["cuenta de valores sin nombre", (c) => ((c.cuentas as Record<string, unknown>).valores = {}), "La cuenta de valores de la cartera no tiene nombre."],
    ["movimientos no es una lista", (c) => (c.movimientos = { a: 1 }), "La lista de movimientos de la cartera no es una lista."],
    ["un movimiento sin fecha", (c) => delete movimientos(c)[2].fechaOperacion, "El movimiento 3 no tiene fecha de operación."],
    ["un movimiento con fecha imposible", (c) => (movimientos(c)[1].fechaOperacion = "2026-02-30"), "El movimiento 2 tiene una fecha de operación que no es un día válido."],
    ["un movimiento sin tipo", (c) => delete movimientos(c)[0].tipo, "El movimiento 1 no tiene tipo."],
    ["un movimiento sin id", (c) => (movimientos(c)[0].id = ""), "El movimiento 1 no tiene identificador."],
    ["un importe con coma", (c) => (movimientos(c)[1].importe = "1.253,13"), "El movimiento 2 tiene un importe que no es un número decimal válido («1.253,13»)."],
    ["un precio numérico", (c) => (movimientos(c)[1].precio = 100.25), "El movimiento 2 tiene un precio que no es un número decimal válido (100.25)."],
    ["un multiplicador mal", (c) => ((c.activos as Array<Record<string, unknown>>)[1].multiplicador = "1e-2"), "El activo 2 tiene un multiplicador que no es un número decimal válido («1e-2»)."],
    ["un saldo de extracto mal", (c) => (((c.extractos as Array<Record<string, unknown>>)[0].efectivo as Array<Record<string, unknown>>)[0].saldo = "mucho"), "El saldo de efectivo 1 del extracto 1 tiene un saldo que no es un número decimal válido («mucho»)."],
    ["un precio manual sin fecha", (c) => delete (c.preciosManuales as Array<Record<string, unknown>>)[0].fecha, "El precio manual 1 no tiene una fecha válida."]
  ];
  for (const [nombre, cambiar, mensaje] of casos) {
    it(nombre, () => {
      const error = errorDe(() => leer(conCambio(cambiar)));
      expect(error.codigo).toBe("ESTRUCTURA");
      expect(error.message).toBe(mensaje);
    });
  }

  it("no valida la semántica de cada tipo: una compra sin títulos se lee", () => {
    const t = conCambio((c) => delete movimientos(c)[1].titulos);
    expect(leer(t).cartera.movimientos[1].titulos).toBeUndefined();
  });
});

describe("cadena de migraciones", () => {
  /* Un fichero de la «versión 1», escrito a mano como texto: no sale de `serializar`. */
  const FICHERO_V1 = `{
  "formato": "gestor-carteras",
  "version": 1,
  "guardado": "2026-01-01T00:00:00.000Z",
  "cartera": {
    "id": "c-1",
    "titulo": "Cartera antigua",
    "divisaBase": "EUR",
    "creada": "2026-01-01T00:00:00.000Z",
    "modificada": "2026-01-01T00:00:00.000Z",
    "cuentas": { "efectivo": { "nombre": "Efectivo" }, "valores": { "nombre": "Valores" } },
    "movimientos": [{ "id": "m-1", "tipo": "aportacion", "fecha": "2026-01-02", "importe": "100" }],
    "extensiones": { "nota": "se conserva" }
  }
}
`;
  /* Ejemplos inventados: la 1→2 renombra `titulo` a `nombre`; la 2→3 renombra la `fecha` de cada movimiento a `fechaOperacion`. */
  const v1aV2 = (f: Record<string, unknown>) => {
    const { titulo, ...resto } = f.cartera as Record<string, unknown>;
    return { ...f, cartera: { ...resto, nombre: titulo } };
  };
  const v2aV3 = (f: Record<string, unknown>) => {
    const c = f.cartera as Record<string, unknown>;
    const movimientos = (c.movimientos as Array<Record<string, unknown>>).map(({ fecha, ...resto }) => ({ ...resto, fechaOperacion: fecha }));
    return { ...f, cartera: { ...c, movimientos } };
  };

  it("un fichero de la versión 1 llega a la versión 3 con las dos migraciones", () => {
    const migraciones: Migraciones = { 1: v1aV2, 2: v2aV3 };
    const leida = leerConVersion(FICHERO_V1, migraciones, 3);
    expect(leida.versionOriginal).toBe(1);
    expect(leida.migrada).toBe(true);
    expect(leida.cartera.nombre).toBe("Cartera antigua");
    expect(leida.cartera.movimientos[0].fechaOperacion).toBe("2026-01-02");
    expect(leida.cartera.extensiones).toEqual({ nota: "se conserva" });
    expect(leida.cartera.activos).toEqual([]);
  });

  it("si falta la migración intermedia, SIN_MIGRACION", () => {
    const error = errorDe(() => leerConVersion(FICHERO_V1, { 1: v1aV2 }, 3));
    expect(error.codigo).toBe("SIN_MIGRACION");
    expect(error.message).toContain("del formato 2 al 3");
  });

  it("sin migrar, el mismo fichero no pasa la estructura y dice por qué", () => {
    const error = errorDe(() => leer(FICHERO_V1));
    expect(error.codigo).toBe("ESTRUCTURA");
    expect(error.message).toBe("La cartera no tiene nombre.");
  });

  it("una migración que falla se explica", () => {
    const error = errorDe(() =>
      leerConVersion(FICHERO_V1, { 1: () => { throw new Error("dato raro"); } }, 2)
    );
    expect(error.codigo).toBe("ESTRUCTURA");
    expect(error.message).toBe("No se pudo pasar la cartera del formato 1 al 2 (dato raro).");
  });
});
