// @vitest-environment happy-dom

/**
 * El buscador nuevo lleva a la ficha, que es para lo que existe una lista.
 *
 * Hasta el 02-11-2026 esta pantalla era una tabla sin salida: se podía ordenar y
 * filtrar y no se podía abrir nada. La ficha ya vive en `/activo/<ISIN>`, así que una
 * fila lleva allí por el mismo camino que usa el Buscador de siempre, y «Atrás» vuelve
 * a la lista.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listarTarjetas: vi.fn(), leerDocumento: vi.fn() }));

vi.mock("../src/adapters/baseNuevaLectura", () => ({
  BASE_NUEVA_DISPONIBLE: true,
  listarTarjetas: mocks.listarTarjetas,
  leerDocumento: mocks.leerDocumento
}));

import { olvidarCatalogoEnSesion } from "../src/adapters/catalogoEnSesion";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { ESTADO_INICIAL_DEL_BUSCADOR, hayCriteriosDeBusqueda } from "../src/core/estadoDelBuscador";
import { BuscadorNuevoPage } from "../src/pages/BuscadorNuevoPage";

const TARJETA = {
  instrument_id: "BE0943877671",
  instrument_type: "FUND",
  identity: { name: "DPAM B - Bonds Eur Government B EUR Cap", currency: "EUR" },
  classification: { category: "EAA Fund EUR Government Bond", asset_class: "FIXED_INCOME" },
  exposure: { equity_regions: { eurozone: 0.8, united_states: 0.2 } },
  metrics: { method: "EXTRACTOR_MONTHLY_V1", annualized_return: { "1y": 0.0423 } }
};

const OTRA = {
  instrument_id: "US78462F1030",
  instrument_type: "ETF",
  identity: { name: "SPDR S&P 500 ETF Trust", currency: "USD" },
  classification: { asset_class: "EQUITY" },
  metrics: { method: "EXTRACTOR_DAILY_V1" }
};

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  olvidarCatalogoEnSesion();
  mocks.listarTarjetas.mockReset();
  mocks.listarTarjetas.mockResolvedValue([TARJETA]);
  mocks.leerDocumento.mockReset();
  mocks.leerDocumento.mockResolvedValue({ availability: { state: "TRADING" } });
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

test("activar una fila abre la ficha de ESE instrumento", async () => {
  const abierta: string[] = [];
  await act(async () => {
    root!.render(createElement(BuscadorNuevoPage, { onAbrirFicha: (isin: string) => abierta.push(isin) }));
  });
  await act(async () => {
    await Promise.resolve();
  });

  const fila = host.querySelector<HTMLElement>(".tabla tbody tr");
  expect(fila, "la fila del instrumento").not.toBeNull();
  await act(async () => fila!.click());

  expect(abierta).toEqual(["BE0943877671"]);
});

test("sin quien abra la ficha, la fila no finge ser pulsable", async () => {
  /* La tabla la usan más pantallas. Una fila que parece un enlace y no lleva a ningún
     sitio es peor que una fila quieta. */
  await act(async () => {
    root!.render(createElement(BuscadorNuevoPage, {}));
  });
  await act(async () => {
    await Promise.resolve();
  });

  const fila = host.querySelector<HTMLElement>(".tabla tbody tr");
  expect(fila?.getAttribute("role")).not.toBe("button");
  expect(fila?.getAttribute("tabindex")).toBeNull();
});

async function pintar(props: Record<string, unknown>) {
  await act(async () => {
    root!.render(createElement(BuscadorNuevoPage, props));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const textoDeFilas = () =>
  [...host.querySelectorAll(".tabla tbody tr")].map((f) => f.textContent ?? "");

const BAJA = {
  instrument_id: "ES0125140A14",
  instrument_type: "STOCK",
  identity: { name: "ERCROS", currency: "EUR" },
  classification: { asset_class: "EQUITY" },
  availability: { state: "DELISTED", since: "2026-09-21" }
};

test("lo que dejó de cotizar se marca con su fecha, sigue en la lista y no se ofrece añadirlo", async () => {
  mocks.listarTarjetas.mockResolvedValue([BAJA, TARJETA]);
  await pintar({ onAnadirACartera: () => undefined });
  expect(textoDeFilas().join(" ")).toContain("ERCROS");
  expect(host.querySelector(".buscador-nuevo__aviso")?.textContent).toBe("Dejó de cotizar el 21/09/2026: no se añade a la propuesta.");
  const botones = [...host.querySelectorAll<HTMLButtonElement>(".tabla__celda--acciones button")];
  const noDisponible = botones.find((b) => b.textContent === "No disponible");
  expect(noDisponible?.disabled).toBe(true);
  expect(noDisponible?.getAttribute("aria-label")).toBe("No disponible: ERCROS");
  /* El otro, el mismo de siempre, y sin consultar nada para saberlo. */
  expect(botones.find((b) => b.textContent === "Añadir")?.disabled).toBe(false);
  expect(mocks.leerDocumento).not.toHaveBeenCalled();
});

test("el nombre de cada botón de la fila contiene lo que se lee en él", async () => {
  /* WCAG 2.5.3: con «Añadir Amundi… a la propuesta» de nombre y «Añadir a la propuesta» a la vista, quien usa la voz
     dictaba lo que veía y el botón no respondía. El corazón del favorito no lleva texto: no entra. */
  mocks.listarTarjetas.mockResolvedValue([BAJA, TARJETA]);
  await pintar({ onAnadirACartera: () => undefined, onAlternarComparacion: () => undefined });
  const conTexto = [...host.querySelectorAll<HTMLButtonElement>(".tabla__celda--acciones .ui-button")];
  expect(conTexto.length).toBeGreaterThanOrEqual(4);
  for (const boton of conTexto) {
    const nombre = boton.getAttribute("aria-label") ?? "";
    expect(nombre.toLocaleLowerCase("es")).toContain((boton.textContent ?? "").toLocaleLowerCase("es"));
    expect(nombre.length).toBeGreaterThan((boton.textContent ?? "").length);
  }
});

test("lo que nunca se resolvió se ve, se marca y no se añade ni se compara, sin consultar nada (decisión 44)", async () => {
  mocks.listarTarjetas.mockResolvedValue([
    { ...BAJA, instrument_id: "ES0114400007", identity: { name: "CAM", currency: "EUR" }, availability: { state: "NEVER_RESOLVED", since: "2026-11-02" } },
    TARJETA
  ]);
  const anadidos: string[] = [];
  const comparados: string[] = [];
  await pintar({ onAnadirACartera: (isin: string) => anadidos.push(isin), onAlternarComparacion: (isin: string) => comparados.push(isin) });
  expect(textoDeFilas().join(" ")).toContain("CAM");
  expect(host.querySelector(".buscador-nuevo__aviso")?.textContent).toBe("No se añade: sin precio ni métricas.");
  const botones = [...host.querySelectorAll<HTMLButtonElement>(".tabla__celda--acciones button")];
  const noDisponible = botones.find((b) => b.textContent === "No disponible");
  expect(noDisponible?.disabled).toBe(true);
  expect(noDisponible?.getAttribute("aria-label")).toBe("No disponible: CAM");
  expect(botones.find((b) => b.getAttribute("aria-label") === "Comparar CAM")?.disabled).toBe(true);
  /* La otra fila sigue como siempre. */
  expect(botones.find((b) => b.textContent === "Añadir")?.disabled).toBe(false);
  expect(mocks.leerDocumento).not.toHaveBeenCalled();
});

test("si ya estaba en la comparación, el botón lo dice y se puede quitar", async () => {
  mocks.listarTarjetas.mockResolvedValue([
    { ...BAJA, instrument_id: "ES0114400007", identity: { name: "CAM", currency: "EUR" }, availability: { state: "NEVER_RESOLVED" } }
  ]);
  await pintar({ onAlternarComparacion: () => undefined, paraComparar: ["ES0114400007"] });
  /* Una casilla: el texto sigue diciendo «Comparar», y el estado lo dice `aria-pressed` (17-11-2026). */
  const quitar = [...host.querySelectorAll<HTMLButtonElement>(".tabla__celda--acciones button")].find((b) => b.textContent === "Comparar");
  expect(quitar?.getAttribute("aria-pressed")).toBe("true");
  expect(quitar?.disabled).toBe(false);
});

test("lo que no se ha podido medir no es una baja ni se bloquea", async () => {
  mocks.listarTarjetas.mockResolvedValue([
    { ...BAJA, instrument_id: "ES01717430J3", identity: { name: "Prisa", currency: "EUR" }, availability: { state: "UNDETERMINED", since: "2026-11-05" } }
  ]);
  await pintar({ onAnadirACartera: () => undefined });
  expect(host.querySelector(".buscador-nuevo__aviso")).toBeNull();
});

test("una tarjeta anterior que aún no dice si cotiza sigue preguntando al pulsar Añadir", async () => {
  mocks.listarTarjetas.mockResolvedValue([{ ...BAJA, availability: undefined }]);
  mocks.leerDocumento.mockResolvedValue({ availability: { state: "DELISTED", since: "2026-09-21" } });
  const anadidos: string[] = [];
  await pintar({ onAnadirACartera: (isin: string) => anadidos.push(isin) });
  const boton = [...host.querySelectorAll<HTMLButtonElement>(".tabla__celda--acciones button")].find((b) => b.textContent === "Añadir");
  await act(async () => boton!.click());
  await act(async () => {
    await Promise.resolve();
  });
  expect(anadidos).toEqual([]);
  expect(host.querySelector(".buscador-nuevo__aviso")?.textContent).toContain("dejó de cotizar");
});

test("sin manejadores no hay columna de acciones: no se pintan botones muertos", async () => {
  mocks.listarTarjetas.mockResolvedValue([TARJETA, OTRA]);
  await pintar({});
  expect(host.querySelector(".tabla__celda--acciones")).toBeNull();
});

test("pulsar una acción NO abre la ficha", async () => {
  /* La fila entera es pulsable y los botones viven dentro. Sin detener la propagación,
     añadir a cartera te saca de la lista, que es lo contrario de lo que pides al
     pulsarlo desde una lista. */
  mocks.listarTarjetas.mockResolvedValue([TARJETA]);
  const abierta: string[] = [];
  const anadidos: string[] = [];
  await pintar({
    onAbrirFicha: (isin: string) => abierta.push(isin),
    onAnadirACartera: (isin: string) => anadidos.push(isin)
  });

  const boton = [...host.querySelectorAll<HTMLButtonElement>(".tabla__celda--acciones button")].find(
    (b) => b.textContent === "Añadir"
  );
  expect(boton, "el botón de añadir").not.toBeUndefined();
  await act(async () => boton!.click());
  await act(async () => {
    await Promise.resolve();
  });

  expect(anadidos).toEqual(["BE0943877671"]);
  expect(abierta).toEqual([]);
});

test("añadir manda el NOMBRE con el ISIN: la cartera guarda la etiqueta que se ve", async () => {
  mocks.listarTarjetas.mockResolvedValue([TARJETA]);
  const recibido: Array<[string, string]> = [];
  await pintar({ onAnadirACartera: (isin: string, nombre: string) => recibido.push([isin, nombre]) });
  const boton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Añadir");
  await act(async () => boton!.click());
  await act(async () => {
    await Promise.resolve();
  });
  expect(recibido).toEqual([["BE0943877671", "DPAM B - Bonds Eur Government B EUR Cap"]]);
});

test("la clase de activo filtra por lo que el proveedor DECLARA", async () => {
  /* Y las opciones salen del dato: una clase que el catálogo no tiene no se ofrece. */
  mocks.listarTarjetas.mockResolvedValue([TARJETA, OTRA]);
  await pintar({});
  const select = [...host.querySelectorAll("select")].find((s) =>
    s.parentElement?.textContent?.includes("Clase de activo")
  );
  expect([...select!.options].map((o) => o.textContent)).toEqual([
    "Todas",
    "Renta fija",
    "Renta variable"
  ]);

  await act(async () => {
    select!.value = "EQUITY";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(textoDeFilas()).toHaveLength(1);
  expect(textoDeFilas()[0]).toContain("SPDR");
});

test("la región es la DOMINANTE, y quien no la declara tiene su propia opción", async () => {
  /* 544 de las 1.091 tarjetas no declaran `equity_regions`. Sin esa opción
     desaparecerían del filtro sin que nadie dijera por qué. */
  mocks.listarTarjetas.mockResolvedValue([TARJETA, OTRA]);
  await pintar({});
  const select = [...host.querySelectorAll("select")].find((s) =>
    s.parentElement?.textContent?.includes("Región dominante")
  );
  expect([...select!.options].map((o) => o.textContent)).toEqual([
    "Todas",
    "Europa, entera",
    "Europa · Eurozona",
    "No la declara"
  ]);

  await act(async () => {
    select!.value = "SIN_DECLARAR";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(textoDeFilas()).toHaveLength(1);
  expect(textoDeFilas()[0]).toContain("SPDR");
});

describe("Europa entera, las acciones por su país y la categoría (06-11-2026)", () => {
  /* Un fondo de toda Europa: su subzona mayor es la zona euro, pero es de Europa. Antes solo salía bajo «Eurozona». */
  const PANEUROPEO = {
    instrument_id: "LU0000000099",
    instrument_type: "FUND",
    identity: { name: "Fondo Europa Grandes Empresas", currency: "EUR" },
    classification: { category: "EAA Fund Europe Large-Cap Blend Equity", asset_class: "EQUITY" },
    exposure: { equity_regions: { eurozone: 0.4, europe_ex_euro: 0.35, united_kingdom: 0.25 } },
    metrics: { method: "EXTRACTOR_MONTHLY_V2" }
  };
  const ACCION_ESPANOLA = {
    instrument_id: "ES0144580Y14",
    instrument_type: "STOCK",
    identity: { name: "Iberdrola", currency: "EUR" },
    classification: { asset_class: "EQUITY", sector: "Utilities", exchange: "MC" },
    metrics: { method: "EXTRACTOR_DAILY_V2" }
  };

  const desplegable = (rotulo: string) =>
    [...host.querySelectorAll("select")].find((s) => s.parentElement?.textContent?.includes(rotulo))!;
  async function elegir(rotulo: string, valor: string) {
    await act(async () => {
      const select = desplegable(rotulo);
      select.value = valor;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  test("«Europa, entera» trae el fondo paneuropeo, el de la zona euro y la acción española; EE. UU. no", async () => {
    mocks.listarTarjetas.mockResolvedValue([TARJETA, PANEUROPEO, ACCION_ESPANOLA, OTRA]);
    await pintar({});
    await elegir("Región dominante", "zona:Europa");
    const filas = textoDeFilas();
    expect(filas).toHaveLength(3);
    expect(filas.some((f) => f.includes("Fondo Europa Grandes Empresas"))).toBe(true);
    expect(filas.some((f) => f.includes("Iberdrola"))).toBe(true);
    await elegir("Región dominante", "SIN_DECLARAR");
    expect(textoDeFilas()).toHaveLength(1);
  });

  test("la categoría se elige con su nombre en español y deja fuera lo que no la tiene", async () => {
    mocks.listarTarjetas.mockResolvedValue([TARJETA, PANEUROPEO, ACCION_ESPANOLA]);
    await pintar({});
    const opciones = [...desplegable("Categoría").options].map((o) => o.textContent);
    expect(opciones[0]).toBe("Todas");
    expect(opciones).toHaveLength(3);
    expect(opciones.some((o) => /EAA Fund/.test(o ?? ""))).toBe(false);
    await elegir("Categoría", desplegable("Categoría").options[1].value);
    expect(textoDeFilas()).toHaveLength(1);
  });
});

describe("al pulsar Añadir se consulta el instrumento", () => {
  const ACCION = {
    instrument_id: "ES0125140A14",
    instrument_type: "STOCK",
    identity: { name: "ERCROS", currency: "EUR" },
    classification: { asset_class: "EQUITY" }
  };

  async function pulsarAnadir(raiz: unknown) {
    mocks.listarTarjetas.mockResolvedValue([ACCION]);
    mocks.leerDocumento.mockResolvedValue(raiz);
    const anadidos: string[] = [];
    await pintar({ onAnadirACartera: (isin: string) => anadidos.push(isin) });
    const boton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Añadir");
    await act(async () => boton!.click());
    await act(async () => {
      await Promise.resolve();
    });
    return anadidos;
  }

  test("lo que dejó de cotizar no se añade, y se dice por qué y desde cuándo", async () => {
    const anadidos = await pulsarAnadir({ availability: { state: "DELISTED", since: "2026-09-21" } });
    expect(mocks.leerDocumento).toHaveBeenCalledWith("instruments/ES0125140A14");
    expect(anadidos).toEqual([]);
    expect(host.querySelector(".buscador-nuevo__aviso")?.textContent).toBe(
      "ERCROS dejó de cotizar el 21/09/2026: no se añade a la cartera."
    );
    const boton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "No disponible");
    expect(boton?.disabled).toBe(true);
  });

  test("una tarjeta de antes que no lo dice: al pulsar, lo que nunca se resolvió no se añade y se dice por qué (decisión 44)", async () => {
    const anadidos = await pulsarAnadir({ availability: { state: "NEVER_RESOLVED", since: "2026-11-02" } });
    expect(anadidos).toEqual([]);
    expect(host.querySelector(".buscador-nuevo__aviso")?.textContent).toBe("No se añade: sin precio ni métricas.");
    expect(host.textContent).not.toContain("dejó de cotizar");
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "No disponible")?.disabled).toBe(true);
  });

  test("uno de los fondos base de las carteras de referencia tampoco se añade", async () => {
    mocks.listarTarjetas.mockResolvedValue([{ ...ACCION, instrument_id: "IE00B18GC888", identity: { name: "Vanguard Global Bond", currency: "EUR" } }]);
    mocks.leerDocumento.mockResolvedValue({});
    const anadidos: string[] = [];
    await pintar({ onAnadirACartera: (isin: string) => anadidos.push(isin) });
    /* ACT-01: la regla común lo conoce por su ISIN, como la ficha, así que el botón ya sale bloqueado y el motivo
       se ve sin pulsar ni consultar nada. Antes se ofrecía «Añadir» y se bloqueaba al pulsarlo. */
    const boton = [...host.querySelectorAll<HTMLButtonElement>(".tabla__celda--acciones button")].find((b) => b.textContent === "Benchmark");
    expect(boton?.disabled).toBe(true);
    await act(async () => boton!.click());
    expect(anadidos).toEqual([]);
    expect(mocks.leerDocumento).not.toHaveBeenCalled();
    expect(host.querySelector(".buscador-nuevo__aviso")?.textContent).toContain("fondos base de las carteras de referencia");
  });

  test("si no se puede comprobar, no se añade a ciegas: se dice y se puede repetir", async () => {
    mocks.listarTarjetas.mockResolvedValue([ACCION]);
    mocks.leerDocumento.mockRejectedValueOnce(new Error("Failed to fetch"));
    const anadidos: string[] = [];
    await pintar({ onAnadirACartera: (isin: string) => anadidos.push(isin) });
    const pulsar = async () => {
      const boton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Añadir");
      await act(async () => boton!.click());
      await act(async () => {
        await Promise.resolve();
      });
    };
    await pulsar();
    expect(anadidos).toEqual([]);
    expect(host.querySelector(".buscador-nuevo__aviso")?.textContent).toContain("No hemos podido comprobar si ERCROS");
    await pulsar();
    expect(anadidos).toEqual(["ES0125140A14"]);
    expect(host.querySelector(".buscador-nuevo__aviso")).toBeNull();
  });
});

describe("el nombre es un enlace de verdad", () => {
  const enlace = () => host.querySelector<HTMLAnchorElement>(".tabla tbody .enlace-a-ficha");

  test("lleva a la dirección de su ficha", async () => {
    await pintar({ onAbrirFicha: () => undefined });
    expect(enlace()?.getAttribute("href")).toBe("/activo/BE0943877671");
    expect(enlace()?.textContent).toBe("DPAM B - Bonds Eur Government B EUR Cap");
  });

  test("un clic abre la ficha una sola vez, aunque la fila también responda", async () => {
    const abierta: string[] = [];
    await pintar({ onAbrirFicha: (isin: string) => abierta.push(isin) });
    await act(async () => enlace()!.click());
    expect(abierta).toEqual(["BE0943877671"]);
  });

  test("con Ctrl lo abre el navegador en otra pestaña, y esta no se mueve", async () => {
    const abierta: string[] = [];
    await pintar({ onAbrirFicha: (isin: string) => abierta.push(isin) });
    const evento = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => {
      enlace()!.dispatchEvent(evento);
    });
    expect(abierta).toEqual([]);
    expect(evento.defaultPrevented).toBe(false);
  });
});

describe("lo que el Buscador conserva y lo que enseña", () => {
  test("arranca por nombre, con su flecha", async () => {
    mocks.listarTarjetas.mockResolvedValue([OTRA, TARJETA]);
    await pintar({});
    expect(textoDeFilas()[0]).toContain("DPAM");
    const encabezado = host.querySelector('.tabla th[aria-sort="ascending"]');
    expect(encabezado?.textContent).toContain("Activo");
    expect(encabezado?.textContent).toContain("↑");
  });

  test("con el estado guardado vuelve donde estaba, y el catálogo no se lee otra vez", async () => {
    await pintar({});
    expect(mocks.listarTarjetas).toHaveBeenCalledTimes(1);
    await act(async () => root!.unmount());

    root = createRoot(host);
    await pintar({ estado: { ...ESTADO_INICIAL_DEL_BUSCADOR, busqueda: "dpam" }, alCambiarEstado: () => undefined });
    expect(mocks.listarTarjetas).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe("dpam");
    expect(textoDeFilas()).toHaveLength(1);
  });

  test("vuelve con su orden y su página, y al cambiar el filtro va a la primera", async () => {
    /* 25 filas por página (rediseño, paso 4): 90 filas son cuatro páginas. */
    const muchas = Array.from({ length: 90 }, (_, i) => ({
      ...TARJETA,
      instrument_id: `LU${String(i).padStart(10, "0")}`,
      identity: { name: `Fondo ${String(i).padStart(3, "0")}`, currency: "EUR" },
      classification: { ...TARJETA.classification, morningstar_rating: (i % 5) + 1 }
    }));
    mocks.listarTarjetas.mockResolvedValue(muchas);
    const cambios: Array<(previo: typeof ESTADO_INICIAL_DEL_BUSCADOR) => typeof ESTADO_INICIAL_DEL_BUSCADOR> = [];
    const estado = { ...ESTADO_INICIAL_DEL_BUSCADOR, tabla: { orden: "estrellas", sentido: -1 as const, pagina: 2 } };
    await pintar({ estado, alCambiarEstado: (cambio: (typeof cambios)[number]) => cambios.push(cambio) });
    expect(host.querySelector('.tabla th[aria-sort="descending"]')?.textContent).toContain("Morningstar");
    expect(host.querySelector(".tabla__paginas strong")?.textContent).toBe("2 de 4");
    /* Lo que no se puede hacer es devolverlo a la primera página solo por haberse vuelto a montar. */
    expect(cambios).toEqual([]);

    await pintar({
      estado: { ...estado, busqueda: "Fondo 0" },
      alCambiarEstado: (cambio: (typeof cambios)[number]) => cambios.push(cambio)
    });
    expect(cambios.at(-1)!(estado).tabla.pagina).toBe(1);
  });

  test("lo que responde exactamente va delante al ordenar por nombre; si se ordena por una cifra, manda la cifra (decisión 81)", async () => {
    /* La cifra por la que se ordena son las estrellas: 1, 3, 4 y 2. */
    const tarjeta = (instrument_id: string, name: string, ticker: string | undefined, estrellas: number) => ({
      ...TARJETA,
      instrument_id,
      identity: { name, currency: "EUR", ...(ticker ? { ticker } : {}) },
      classification: { ...TARJETA.classification, morningstar_rating: estrellas }
    });
    mocks.listarTarjetas.mockResolvedValue([
      tarjeta("IE00B4M6YD48", "Artisan Global Value Fund", undefined, 1),
      tarjeta("FR0000120578", "Sanofi SA", "SAN", 3),
      tarjeta("ES0113900J37", "Banco Santander S.A.", "SAN", 4),
      tarjeta("LU0104885248", "Pictet-Water R EUR", undefined, 2)
    ]);
    const nombres = () => [...host.querySelectorAll(".tabla tbody tr")].map((fila) => fila.querySelector("a")?.textContent);

    await pintar({ estado: { ...ESTADO_INICIAL_DEL_BUSCADOR, busqueda: "san" }, alCambiarEstado: () => undefined });
    expect(nombres()).toEqual(["Banco Santander S.A.", "Sanofi SA", "Artisan Global Value Fund"]);

    await pintar({
      estado: { ...ESTADO_INICIAL_DEL_BUSCADOR, busqueda: "san", tabla: { orden: "estrellas", sentido: 1 as const, pagina: 1 } },
      alCambiarEstado: () => undefined
    });
    expect(nombres()).toEqual(["Artisan Global Value Fund", "Sanofi SA", "Banco Santander S.A."]);

    await pintar({ estado: { ...ESTADO_INICIAL_DEL_BUSCADOR, busqueda: "Water Pictet" }, alCambiarEstado: () => undefined });
    expect(nombres()).toEqual(["Pictet-Water R EUR"]);
  });

  test("si la lista queda vacía, lo dice; y lo tecleado se puede limpiar de una vez", async () => {
    expect(hayCriteriosDeBusqueda(ESTADO_INICIAL_DEL_BUSCADOR)).toBe(false);
    expect(hayCriteriosDeBusqueda({ ...ESTADO_INICIAL_DEL_BUSCADOR, busqueda: "x" })).toBe(true);
    await pintar({});
    const buscar = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(buscar, "nada de nada");
      buscar.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("No hay activos que coincidan");
    const limpiar = [...host.querySelectorAll("button")].find((b) => b.textContent === "Limpiar búsqueda y filtros");
    await act(async () => limpiar!.click());
    expect(textoDeFilas()).toHaveLength(1);
  });

  test("las columnas de la lista son las mismas con Modo cliente y sin él (decisión A-172)", async () => {
    /* El coste corriente, el patrimonio y «Datos disponibles» salieron de la lista; esta última era la única que Modo cliente quitaba. */
    /* Lo que se ve: el nombre entero de un título corto va en un `sr-only` y no cuenta aquí. */
    const visible = (th: Element) => {
      const copia = th.cloneNode(true) as Element;
      copia.querySelectorAll(".sr-only").forEach((oculto) => oculto.remove());
      return copia.textContent ?? "";
    };
    const encabezados = () => [...host.querySelectorAll(".tabla thead th")].map((th) => visible(th).replace(/\u00a0/g, " ").replace(/[↑↓]/g, "").trim());
    /* Títulos cortos desde el 17-11-2026 (Óscar, sobre la captura del aspecto anterior). */
    const ESPERADAS = ["Activo", "Categoría", "Morningstar", "Divisa", "Rent. 1A", "Vol. 1A", "Vol. 3A", "Sharpe 3A"];
    await pintar({});
    expect(encabezados()).toEqual(ESPERADAS);
    await act(async () => root!.unmount());

    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(ClientModeProvider, { initialValue: true, children: createElement(BuscadorNuevoPage, {}) }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(encabezados()).toEqual(ESPERADAS);
  });

  test("marcar un favorito no cambia de página", async () => {
    /* 25 filas por página (rediseño, paso 4): 90 filas son cuatro páginas. */
    const muchas = Array.from({ length: 90 }, (_, i) => ({ ...TARJETA, instrument_id: `LU${String(i).padStart(10, "0")}`, identity: { name: `Fondo ${String(i).padStart(3, "0")}`, currency: "EUR" } }));
    mocks.listarTarjetas.mockResolvedValue(muchas);
    await pintar({ onAnadirACartera: () => undefined });
    const siguiente = [...host.querySelectorAll("button")].find((b) => b.textContent === "Siguiente");
    await act(async () => siguiente!.click());
    expect(host.querySelector(".tabla__paginas strong")?.textContent).toBe("2 de 4");
    await act(async () => host.querySelector<HTMLButtonElement>(".tabla__favorito")!.click());
    expect(host.querySelector(".tabla__paginas strong")?.textContent).toBe("2 de 4");
  });

  test("el corazón va delante del nombre, marca el favorito y no abre la ficha (17-11-2026)", async () => {
    const abiertas: string[] = [];
    await pintar({ onAbrirFicha: (isin: string) => abiertas.push(isin), onAnadirACartera: () => undefined });
    const corazon = host.querySelector<HTMLButtonElement>("tbody tr td:first-child .tabla__favorito");
    expect(corazon).not.toBeNull();
    expect(host.querySelector(".tabla__celda--acciones .tabla__favorito")).toBeNull();
    expect(corazon!.getAttribute("aria-pressed")).toBe("false");
    await act(async () => corazon!.click());
    expect(host.querySelector("tbody tr td:first-child .tabla__favorito")!.getAttribute("aria-pressed")).toBe("true");
    expect(abiertas).toEqual([]);
  });
});

/*
 * ACT-01 (auditoría de frontend, 13-11-2026): el Buscador decidía con una tercera regla. Ahora la fila pasa por la
 * regla común con lo que dice su tarjeta, y da la misma etiqueta y el mismo estado del botón que la ficha con esa raíz.
 */
describe("añadir a cartera desde el Buscador dice y permite lo mismo que la ficha", () => {
  const CASOS: Array<{ caso: string; isin: string; estado?: string; enCartera?: boolean; etiqueta: string; bloqueado: boolean }> = [
    { caso: "cotiza", isin: "ES0125140A14", estado: "TRADING", etiqueta: "Añadir", bloqueado: false },
    { caso: "ya en la cartera", isin: "ES0125140A14", estado: "TRADING", enCartera: true, etiqueta: "Añadido", bloqueado: true },
    { caso: "dejó de cotizar", isin: "ES0125140A14", estado: "DELISTED", etiqueta: "No disponible", bloqueado: true },
    { caso: "dejó de cotizar y está en la cartera", isin: "ES0125140A14", estado: "DELISTED", enCartera: true, etiqueta: "No disponible", bloqueado: true },
    { caso: "baja valorada a precio congelado (NH)", isin: "ES0161560018", estado: "DELISTED", etiqueta: "Añadir", bloqueado: false },
    { caso: "nunca resuelto", isin: "ES0114400007", estado: "NEVER_RESOLVED", etiqueta: "No disponible", bloqueado: true },
    { caso: "fondo base de las carteras de referencia", isin: "IE00B18GC888", estado: "TRADING", etiqueta: "Benchmark", bloqueado: true }
  ];

  test.each(CASOS)("$caso: «$etiqueta», bloqueado $bloqueado", async ({ isin, estado, enCartera = false, etiqueta, bloqueado }) => {
    const { activoParaLaAccion, accionDeCarteraBloqueada, etiquetaDeAccionDeCartera } = await import("../src/core/accionDeCartera");
    const raiz = { availability: { state: estado, since: "2026-09-21" } };
    /* Lo que da la ficha con esa raíz y sin el activo de la función. */
    const enLaFicha = activoParaLaAccion(isin, raiz, null);
    expect(etiquetaDeAccionDeCartera(enLaFicha, enCartera)).toBe(etiqueta);
    expect(accionDeCarteraBloqueada(enLaFicha, enCartera)).toBe(bloqueado);

    mocks.listarTarjetas.mockResolvedValue([{ ...TARJETA, instrument_id: isin, availability: raiz.availability }]);
    await pintar({ onAnadirACartera: () => undefined, enCartera: enCartera ? [isin] : [] });
    const accion = [...host.querySelectorAll<HTMLButtonElement>(".tabla__celda--acciones button")].find((b) => !b.classList.contains("tabla__favorito"))!;
    expect(accion.textContent).toBe(etiqueta);
    /* Lo que se lee va en corto (17-11-2026); el nombre accesible dice adónde va. */
    const { nombreDeAccionDeCartera } = await import("../src/core/accionDeCartera");
    expect(accion.getAttribute("aria-label")?.startsWith(`${nombreDeAccionDeCartera(enLaFicha, enCartera)}: `)).toBe(true);
    expect(accion.disabled).toBe(bloqueado);
  });
});

/* Decisión A-172: las estrellas de Morningstar en la lista, como en la comparativa de activos. */
describe("las estrellas de Morningstar de la lista", () => {
  const celdaDeEstrellas = (nombre: string) => {
    const fila = [...host.querySelectorAll(".tabla tbody tr")].find((f) => f.textContent?.includes(nombre));
    const indice = [...host.querySelectorAll(".tabla thead th")].findIndex((th) => th.textContent?.includes("Morningstar"));
    return fila?.querySelectorAll("td, th")[indice]?.textContent ?? "";
  };

  test("cuatro estrellas son cuatro llenas y una vacía; sin puntuación, falta el dato; y a una acción no le aplica", async () => {
    mocks.listarTarjetas.mockResolvedValue([
      { ...TARJETA, classification: { ...TARJETA.classification, morningstar_rating: 4 } },
      OTRA,
      { ...BAJA, availability: undefined, classification: { asset_class: "EQUITY", morningstar_rating: 5 } }
    ]);
    await pintar({});
    expect(celdaDeEstrellas("DPAM")).toBe("★★★★☆");
    expect(celdaDeEstrellas("SPDR")).toBe("Falta");
    expect(celdaDeEstrellas("ERCROS")).toBe("No aplica");
  });

  test("el primer clic en Morningstar pone arriba las que más tienen, y las que no tienen van al final", async () => {
    const con = (id: string, nombre: string, estrellas?: number) => ({
      ...TARJETA,
      instrument_id: id,
      identity: { name: nombre, currency: "EUR" },
      classification: { ...TARJETA.classification, ...(estrellas ? { morningstar_rating: estrellas } : {}) }
    });
    mocks.listarTarjetas.mockResolvedValue([con("A", "Dos", 2), con("B", "Ninguna"), con("C", "Cinco", 5), con("D", "Tres", 3)]);
    await pintar({});
    const cabecera = [...host.querySelectorAll<HTMLButtonElement>(".tabla thead button")].find((b) => b.textContent?.includes("Morningstar"))!;
    await act(async () => cabecera.click());
    expect([...host.querySelectorAll(".tabla tbody tr")].map((f) => f.querySelector("a")?.textContent)).toEqual(["Cinco", "Tres", "Dos", "Ninguna"]);
    /* Una sola escala, la de Morningstar: no se agrupa por método. */
    expect(host.querySelector(".tabla__grupo")).toBeNull();
  });
});

/* Rediseño, paso 4: la mesa de trabajo pasa a la cabecera, y la tabla enseña 25 filas por página. */
describe("la cabecera del Buscador", () => {
  test("comparar lo marcado y ver la propuesta son acciones de la cabecera", async () => {
    mocks.listarTarjetas.mockResolvedValue([TARJETA]);
    const abrirComparador = vi.fn();
    await pintar({ onAbrirComparador: abrirComparador, onAbrirCartera: () => undefined, enCartera: ["X"], paraComparar: ["A", "B"] });
    const acciones = [...host.querySelectorAll<HTMLButtonElement>(".ui-page-header .ui-action-toolbar button")];
    expect(acciones.map((b) => b.textContent)).toEqual(["Ver la propuesta (1)", "Comparar 2 activos"]);
    await act(async () => acciones[1].click());
    expect(abrirComparador).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".workspace-tray")).toBeNull();
  });

  test("sin nada marcado no se ofrece comparar, y la procedencia dice cuántos hay", async () => {
    mocks.listarTarjetas.mockResolvedValue([TARJETA]);
    await pintar({ onAbrirComparador: () => undefined, onAbrirCartera: () => undefined });
    const acciones = [...host.querySelectorAll<HTMLButtonElement>(".ui-page-header .ui-action-toolbar button")];
    expect(acciones.map((b) => b.textContent)).toEqual(["Ver la propuesta (0)"]);
    expect(host.querySelector(".ui-page-header__description")?.textContent).toMatch(/^1 activo del catálogo · /);
  });

  test("25 filas por página", async () => {
    mocks.listarTarjetas.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ ...TARJETA, instrument_id: `LU${String(i).padStart(10, "0")}`, identity: { name: `Fondo ${i}`, currency: "EUR" } }))
    );
    await pintar({});
    expect(host.querySelector(".tabla__paginas strong")?.textContent).toBe("1 de 2");
  });
});
