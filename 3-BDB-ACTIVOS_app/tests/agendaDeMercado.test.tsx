// @vitest-environment happy-dom

/**
 * La agenda de Mercado (hallazgos 24, 93 y 121 de la auditoría del 04-11-2026).
 *
 * Lo que tiene que quedar: que un fallo no se lea como «no hay», que el importe de una fecha ex futura
 * se diga como lo que es —el último dividendo, ya pasado— y que lo cargado no se pierda al cambiar de
 * pestaña. Las cifras de las pruebas son las de la medición contra Yahoo de ese día.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dividendos: vi.fn(), resultados: vi.fn(), calendario: vi.fn() }));
vi.mock("../src/adapters/dividendsCalendarBackend", () => ({ fetchDividendsCalendar: mocks.dividendos }));
vi.mock("../src/adapters/earningsCalendarBackend", () => ({ fetchEarningsCalendar: mocks.resultados }));
vi.mock("../src/adapters/economicCalendarBackend", () => ({ fetchEconomicCalendar: mocks.calendario }));

import { ClientModeProvider } from "../src/app/ClientModeContext";
import { DividendsPanel } from "../src/components/DividendsPanel";
import { EarningsPanel } from "../src/components/EarningsPanel";
import { EconomicCalendarPanel } from "../src/components/EconomicCalendarPanel";
import {
  escribirImporte,
  faseDeAgenda,
  filasDeDividendos,
  importeEsDelUltimoPago,
  notaDeLaFuente,
  notaDelImporte,
  procedenciaDeAgenda,
  procedenciaDeLosTipos
} from "../src/core/agendaDeMercado";
import { clearSessionCaches } from "../src/core/sessionCaches";

describe("fase de la agenda", () => {
  const fase = (o: Partial<Parameters<typeof faseDeAgenda>[0]>) =>
    faseDeAgenda({ cargando: false, error: null, origen: "YAHOO_LIVE", cuantos: 0, ...o });

  test("sin filas y con la fuente respondiendo, no hay nada previsto", () => {
    expect(fase({})).toBe("vacia");
  });

  test.each(["ERROR", "NOT_CONFIGURED", "INVALID_REQUEST"])("el origen %s es un fallo, no un periodo vacío", (origen) => {
    expect(fase({ origen })).toBe("fallo");
  });

  test("sin respuesta, o con error, también", () => {
    expect(fase({ origen: null })).toBe("fallo");
    expect(fase({ error: new Error("x") })).toBe("fallo");
  });

  test("con filas hay datos, y mientras carga no se afirma nada", () => {
    expect(fase({ cuantos: 3 })).toBe("datos");
    expect(fase({ cuantos: 3, cargando: true })).toBe("cargando");
  });
});

describe("dividendos", () => {
  test("cada fila, por fecha ex, y solo lo que el título promete", () => {
    const filas = filasDeDividendos(
      [
        { code: "IBE.MC", name: "Iberdrola", ex_date: "2027-01-12", amount: 0.427, currency: "EUR" },
        { code: "SAB.MC", name: "Banco Sabadell", ex_date: "2026-12-24", amount: 0.5, currency: "EUR" },
        { code: "REP.MC", name: "Repsol", ex_date: "2027-01-12", amount: 0.551, currency: "EUR" },
        { code: "NOESTA.MC", name: "No está en el IBEX", ex_date: "2026-12-01", amount: 1, currency: "EUR" }
      ],
      "2026-12-24"
    );
    expect(filas.map((f) => f.codigo)).toEqual(["SAB", "IBE", "REP"]);
    expect(filas[0]).toMatchObject({ esHoy: true, importe: 0.5, fechaDePago: null, fechaDelImporte: null });
    expect(filas[1].esHoy).toBe(false);
  });

  test("un importe que no está no es un cero", () => {
    const [fila] = filasDeDividendos([{ code: "IBE.MC", ex_date: "2027-01-12", amount: null }], "2026-11-04");
    expect(fila.importe).toBeNull();
    expect(fila.nombre).toBeNull();
  });

  test("el dinero lleva dos decimales como mínimo y no se redondea a dos", () => {
    expect(escribirImporte(0.5, "EUR")).toBe("0,50\u00a0€");
    expect(escribirImporte(0.427, "EUR")).toBe("0,427\u00a0€");
    expect(escribirImporte(0.005, "EUR")).toBe("0,005\u00a0€");
    expect(escribirImporte(0.133605, "EUR")).toBe("0,1336\u00a0€");
    expect(escribirImporte(1.2, "USD")).toBe("1,20\u00a0USD");
  });

  test("solo con Yahoo el importe es el último pago: EODHD y FMP traen el de esa fecha", () => {
    expect(importeEsDelUltimoPago("YAHOO_LIVE")).toBe(true);
    expect(importeEsDelUltimoPago("EODHD_LIVE")).toBe(false);
    expect(importeEsDelUltimoPago("FMP_LIVE")).toBe(false);
    expect(importeEsDelUltimoPago(null)).toBe(false);
  });

  test("la nota dice que no anticipa el próximo, y que falta la fecha mientras falte", () => {
    const sinFecha = filasDeDividendos([{ code: "IBE.MC", ex_date: "2027-01-12", amount: 0.427 }], "2026-11-04");
    const conFecha = filasDeDividendos(
      [{ code: "IBE.MC", ex_date: "2027-01-12", amount: 0.427, amount_ex_date: "2026-07-06" }],
      "2026-11-04"
    );
    expect(notaDelImporte(sinFecha, "YAHOO_LIVE")).toContain("no anticipa el próximo");
    expect(notaDelImporte(sinFecha, "YAHOO_LIVE")).toContain("aún no recibe su fecha");
    expect(notaDelImporte(conFecha, "YAHOO_LIVE")).not.toContain("aún no recibe su fecha");
    expect(notaDelImporte(sinFecha, "FMP_LIVE")).toBe("Importe anunciado por la fuente para esa fecha ex.");
  });
});

describe("lo que avisa la fuente", () => {
  const PARCIAL = "Yahoo respondio para 20 de 35 componentes; pueden faltar anuncios.";

  test("el aviso de cobertura se queda; en Modo cliente, sin nombrar al proveedor", () => {
    expect(notaDeLaFuente(PARCIAL, true)).toBe(PARCIAL);
    expect(notaDeLaFuente(PARCIAL, false)).toBe("La fuente respondio para 20 de 35 componentes; pueden faltar anuncios.");
    expect(notaDeLaFuente("Cobertura parcial de Yahoo: se consultaron 20 de 35 componentes.", false)).toBe(
      "Cobertura parcial de la fuente: se consultaron 20 de 35 componentes."
    );
  });

  test("lo que no añade nada no se escribe", () => {
    expect(notaDeLaFuente("Sin datos en el rango.", true)).toBeNull();
    expect(notaDeLaFuente(undefined, true)).toBeNull();
  });
});

describe("procedencia", () => {
  test("la de la agenda: proveedor y periodo, o solo el periodo si el proveedor no se dice", () => {
    expect(procedenciaDeAgenda("Yahoo Finance", "2026-11-04", "2027-02-02")).toBe("Yahoo Finance · del 04/11/2026 al 02/02/2027");
    expect(procedenciaDeAgenda(null, "2026-11-04", "2027-02-02")).toBe("Del 04/11/2026 al 02/02/2027");
    expect(procedenciaDeAgenda(null)).toBeNull();
  });

  const tipos = (estr: string | null, resto: string | null) => [
    { etiqueta: "€STR", fecha: estr },
    { etiqueta: "Facilidad de depósito", fecha: resto },
    { etiqueta: "Operaciones de financiación", fecha: resto },
    { etiqueta: "Facilidad marginal de crédito", fecha: resto }
  ];

  test("la de los tipos: «el resto» es la fecha que comparten más series", () => {
    expect(procedenciaDeLosTipos(tipos("2026-11-03", "2026-11-04"))).toBe(
      "Banco Central Europeo · €STR a 03/11/2026, el resto a 04/11/2026"
    );
  });

  test("todas el mismo día, una sola fecha", () => {
    expect(procedenciaDeLosTipos(tipos("2026-11-04", "2026-11-04"))).toBe("Banco Central Europeo · a 04/11/2026");
  });

  test("sin ninguna observación no se inventa nada", () => {
    expect(procedenciaDeLosTipos(tipos(null, null))).toBe(
      "Banco Central Europeo · sin observaciones: no se muestran valores de sustitución"
    );
  });
});

describe("los paneles", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clearSessionCaches();
    localStorage.clear();
    mocks.dividendos.mockReset();
    mocks.resultados.mockReset();
    mocks.calendario.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    host.remove();
    vi.unstubAllGlobals();
  });

  const pintar = async (panel: React.ReactNode, modoCliente = false) => {
    await act(async () => {
      root!.render(<ClientModeProvider initialValue={modoCliente}>{panel}</ClientModeProvider>);
    });
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 0));
    });
  };
  const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);

  const DIVIDENDOS = {
    source: "YAHOO_LIVE",
    from: "2026-11-04",
    to: "2027-02-02",
    count: 2,
    items: [
      { code: "IBE.MC", name: "Iberdrola", ex_date: "2027-01-12", payment_date: null, amount: 0.427, currency: "EUR" },
      { code: "SAB.MC", name: "Banco Sabadell", ex_date: "2026-12-24", payment_date: null, amount: 0.5, currency: "EUR" }
    ]
  };

  test("Dividendos: rotula el importe como pasado y quita lo que decía «pago»", async () => {
    mocks.dividendos.mockResolvedValue(DIVIDENDOS);
    await pintar(<DividendsPanel />);
    const texto = host.textContent ?? "";
    expect(texto).toContain("Próximas fechas ex-dividendo · IBEX 35");
    /* Rediseño: la procedencia dice que son del IBEX 35, y las fechas van con el formato común. */
    expect(texto).toContain("IBEX 35 · Yahoo Finance · del 04/11/2026 al 02/02/2027");
    expect(texto).toContain("Fecha ex");
    expect(texto).toContain("Último dividendo");
    expect(texto).toContain("0,427\u00a0€");
    expect(texto).toContain("0,50\u00a0€");
    expect(texto).toContain("2 valores");
    for (const fuera of ["Próximo pago", "Pagos visibles", "Todas", "pagos", "cotizadas españolas", "EUR"]) {
      expect(texto).not.toContain(fuera);
    }
    expect(host.querySelector('[role="group"][aria-label="Filtro de dividendos"]')).toBeNull();
  });

  test("Dividendos: si el servidor manda la fecha del importe, se escribe", async () => {
    mocks.dividendos.mockResolvedValue({
      ...DIVIDENDOS,
      items: [{ ...DIVIDENDOS.items[0], amount_ex_date: "2026-07-06" }]
    });
    await pintar(<DividendsPanel />);
    expect(host.textContent).toContain("fecha ex 06/07/2026");
    expect(host.textContent).not.toContain("aún no recibe su fecha");
  });

  test("Dividendos: con otra fuente el importe no se llama «último»", async () => {
    mocks.dividendos.mockResolvedValue({ ...DIVIDENDOS, source: "FMP_LIVE" });
    await pintar(<DividendsPanel />);
    expect(host.textContent).toContain("Importe anunciado");
    expect(host.textContent).not.toContain("Último dividendo");
  });

  test("Dividendos: un periodo vacío y un fallo son dos frases, y solo el fallo se reintenta", async () => {
    mocks.dividendos.mockResolvedValue({ source: "YAHOO_LIVE", count: 0, items: [] });
    await pintar(<DividendsPanel />);
    expect(host.textContent).toContain("No hay dividendos previstos en este periodo.");
    expect(host.textContent).not.toContain("No se han podido");
    expect(boton("Reintentar")).toBeUndefined();

    clearSessionCaches();
    mocks.dividendos.mockResolvedValue({ source: "ERROR", note: "Yahoo no respondio", count: 0, items: [] });
    await act(async () => boton("Recargar")!.click());
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 0));
    });
    expect(host.textContent).toContain("No se han podido cargar los dividendos.");
    expect(host.textContent).not.toContain("No hay dividendos previstos");
    /* Un fallo no tiene procedencia: «No disponible» bajo el título no le dice nada a nadie. */
    expect(host.querySelector(".panel__subtitle")?.textContent).toBe("Fecha ex y último dividendo de los valores del IBEX 35.");
    expect(boton("Reintentar")).toBeDefined();

    mocks.dividendos.mockResolvedValue(DIVIDENDOS);
    await act(async () => boton("Reintentar")!.click());
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 0));
    });
    expect(host.textContent).toContain("0,427\u00a0€");
  });

  test("Dividendos: una excepción también es un fallo, con el mismo mensaje", async () => {
    mocks.dividendos.mockRejectedValue(new Error("red caída"));
    await pintar(<DividendsPanel />);
    expect(host.textContent).toContain("No se han podido cargar los dividendos.");
    expect(boton("Reintentar")).toBeDefined();
  });

  test("Modo cliente: el periodo se queda, el proveedor no", async () => {
    mocks.dividendos.mockResolvedValue(DIVIDENDOS);
    await pintar(<DividendsPanel />, true);
    expect(host.textContent).toContain("IBEX 35 · del 04/11/2026 al 02/02/2027");
    expect(host.textContent).not.toContain("Yahoo");
  });

  test("carga sola al abrir y lo conserva al cambiar de pestaña: no repite la lectura", async () => {
    mocks.dividendos.mockResolvedValue(DIVIDENDOS);
    await pintar(<DividendsPanel />);
    expect(mocks.dividendos).toHaveBeenCalledTimes(1);
    await act(async () => root!.unmount());
    root = createRoot(host);
    await pintar(<DividendsPanel />);
    expect(mocks.dividendos).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("0,427\u00a0€");
    await act(async () => boton("Recargar")!.click());
    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 0));
    });
    expect(mocks.dividendos).toHaveBeenCalledTimes(2);
  });

  test("si se vuelve con una carga en vuelo, se engancha a ella", async () => {
    let entregar: (valor: typeof DIVIDENDOS) => void = () => undefined;
    mocks.dividendos.mockReturnValue(new Promise((listo) => (entregar = listo)));
    await pintar(<DividendsPanel />);
    await act(async () => root!.unmount());
    root = createRoot(host);
    await pintar(<DividendsPanel />);
    expect(mocks.dividendos).toHaveBeenCalledTimes(1);
    await act(async () => entregar(DIVIDENDOS));
    expect(host.textContent).toContain("0,427\u00a0€");
  });

  const RESULTADOS = {
    source: "YAHOO_LIVE",
    from: "2026-11-04",
    to: "2026-12-19",
    count: 2,
    items: [
      { code: "AMS.MC", name: "Amadeus", report_date: "2026-11-06", eps_estimate: 0.924, eps_actual: null, eps_surprise_pct: null },
      { code: "CLNX.MC", name: "Cellnex", report_date: "2026-11-05", eps_estimate: null, eps_actual: null, eps_surprise_pct: null }
    ]
  };

  test("Resultados: dice IBEX 35, y sin sorpresas en la fuente no hay columna de sorpresa", async () => {
    mocks.resultados.mockResolvedValue(RESULTADOS);
    await pintar(<EarningsPanel />);
    const texto = host.textContent ?? "";
    expect(texto).toContain("valores del IBEX 35");
    expect(texto).not.toContain("cotizadas españolas");
    expect(texto).not.toContain("sorpresa");
    expect(texto).not.toContain("Sin BPA");
    expect(texto).toContain("Sin estimación");
    /* Rediseño: los resultados son una tabla, con la estimación en su columna y sin la de sorpresa. */
    const cabeceras = [...host.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    expect(cabeceras).toEqual(["Fecha", "Valor", "BPA", "Estimación"]);
    expect(texto).toContain("0,924");
    expect(texto).toContain("Próximos resultados · IBEX 35");
    expect(texto).toContain("IBEX 35 · Yahoo Finance · del 04/11/2026 al 19/12/2026");
    expect(host.querySelector('[aria-label="Filtro de resultados"]')).toBeNull();
  });

  test("Resultados: vuelve sola el día que una fuente la dé", async () => {
    mocks.resultados.mockResolvedValue({
      ...RESULTADOS,
      items: [{ ...RESULTADOS.items[0], eps_actual: 1, eps_surprise_pct: 8.2 }, RESULTADOS.items[1]]
    });
    await pintar(<EarningsPanel />);
    expect(host.textContent).toContain("La sorpresa es la diferencia del BPA con ella.");
    expect([...host.querySelectorAll("thead th")].map((th) => th.textContent?.trim())).toContain("Sorpresa");
    /* Antes «+8,2 %», con un decimal: una diferencia lleva dos, su signo y el color de su signo. */
    const sorpresa = host.querySelector(".cifra.cifra--sube");
    expect(sorpresa?.textContent?.replace(/\s/g, " ")).toBe("+8,20 %");
  });

  test("Resultados y calendario: sus dos frases", async () => {
    mocks.resultados.mockResolvedValue({ source: "YAHOO_LIVE", count: 0, items: [] });
    await pintar(<EarningsPanel />);
    expect(host.textContent).toContain("No hay resultados previstos en este periodo.");

    mocks.calendario.mockResolvedValue({ source: "FOREX_FACTORY", count: 0, events: [] });
    await pintar(<EconomicCalendarPanel />);
    expect(host.textContent).toContain("No hay eventos previstos en este periodo.");
  });

  test("Calendario: un fallo de las fuentes no se lee como una semana sin eventos", async () => {
    mocks.calendario.mockResolvedValue({
      source: "ERROR",
      count: 0,
      events: [],
      note: "Las fuentes del calendario no respondieron."
    });
    await pintar(<EconomicCalendarPanel />);
    expect(host.textContent).toContain("No se ha podido cargar el calendario.");
    expect(host.textContent).toContain("Las fuentes del calendario no respondieron.");
    expect(boton("Reintentar")).toBeDefined();
  });
});
