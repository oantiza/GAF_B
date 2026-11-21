/**
 * Decisión B-78: una posición con la serie parada más de 90 días avisa donde se enseñan sus cifras. Aquí, la regla y de dónde sale la fecha;
 * cada papel y Análisis tienen su prueba al lado de las suyas.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { leerAnioDeLaSerie } from "../src/adapters/baseNuevaLectura";
import { ANIOS_HACIA_ATRAS, finesDeSerie, leerFinDeLaSerie, olvidarFinesDeSerieLeidos } from "../src/adapters/finDeLaSerie";
import {
  avisoDeSerieParada,
  DIAS_PARA_SERIE_PARADA,
  datosHasta,
  diasSinDato,
  estaParada,
  notaDeDatosHasta,
  posicionesParadas,
  puntoDeSeriesParadas,
  rotuloDeSerieParada,
  soloLasParadas,
  textoSiCongelado
} from "../src/core/serieParada";

/* Una de las tres clases C de Amundi que se convirtieron en A: su serie para el 28-11-2025. */
const ULTIMO_DATO = "2025-11-28";

describe("la regla: más de 90 días sin dato", () => {
  test("el umbral tiene nombre y es 90", () => {
    expect(DIAS_PARA_SERIE_PARADA).toBe(90);
  });

  test("90 días exactos no avisan; 91, sí", () => {
    expect(diasSinDato(ULTIMO_DATO, "2026-02-26")).toBe(90);
    expect(estaParada(ULTIMO_DATO, "2026-02-26")).toBe(false);
    expect(diasSinDato(ULTIMO_DATO, "2026-02-27")).toBe(91);
    expect(estaParada(ULTIMO_DATO, "2026-02-27")).toBe(true);
  });

  test("cuenta en días de calendario, y con un año bisiesto por medio también", () => {
    expect(diasSinDato("2024-01-31", "2024-04-30")).toBe(90);
    expect(estaParada("2024-01-31", "2024-04-30")).toBe(false);
    expect(estaParada("2024-01-31", "2024-05-01")).toBe(true);
  });

  test("sin fecha, o con una que no lo es, no se afirma nada", () => {
    for (const fecha of [null, undefined, "", "28/11/2025", "2025-02-31", "2025-11"]) {
      expect(diasSinDato(fecha, "2026-11-11")).toBeNull();
      expect(estaParada(fecha, "2026-11-11")).toBe(false);
    }
    expect(estaParada(ULTIMO_DATO, "no es una fecha")).toBe(false);
  });

  test("un último dato posterior al día del documento no está parado", () => {
    expect(estaParada("2026-11-12", "2026-11-11")).toBe(false);
  });

  test("de las fechas conocidas, solo quedan las paradas", () => {
    const fines = new Map([["PARADA", ULTIMO_DATO], ["AL_DIA", "2026-11-07"], ["JUSTA", "2026-08-13"]]);
    expect([...soloLasParadas(fines, "2026-11-11")]).toEqual([["PARADA", ULTIMO_DATO]]);
  });
});

describe("los textos", () => {
  const una = [{ nombre: "Amundi Funds Global Equity C", desde: ULTIMO_DATO }];
  const dos = [...una, { nombre: "Fondo Ñandú", desde: "2026-01-08" }];

  test("para el asesor, el texto de la decisión con la fecha real", () => {
    expect(avisoDeSerieParada(una[0])).toBe("Amundi Funds Global Equity C · Serie parada desde el 28/11/2025: sus cifras son de esa fecha o anteriores.");
    expect(puntoDeSeriesParadas(una)).toBe(avisoDeSerieParada(una[0]));
    expect(puntoDeSeriesParadas(dos)).toBe("Series paradas, y sus cifras son de esa fecha o anteriores: Amundi Funds Global Equity C, desde el 28/11/2025; Fondo Ñandú, desde el 08/01/2026.");
    expect(puntoDeSeriesParadas([])).toBeNull();
  });

  test("para el cliente, sin «serie parada»", () => {
    expect(datosHasta(ULTIMO_DATO)).toBe("Sus datos llegan hasta el 28/11/2025.");
    expect(notaDeDatosHasta(una)).toBe("Amundi Funds Global Equity C: sus datos llegan hasta el 28/11/2025.");
    expect(notaDeDatosHasta(dos)).toBe("Sus datos llegan hasta la fecha indicada: Amundi Funds Global Equity C (28/11/2025); Fondo Ñandú (08/01/2026).");
    expect(notaDeDatosHasta([])).toBeNull();
    for (const texto of [datosHasta(ULTIMO_DATO), notaDeDatosHasta(dos)]) expect(texto).not.toMatch(/serie|parad/i);
  });

  test("las paradas de una lista, en su orden y con su nombre", () => {
    const paradas = new Map([["B", "2026-01-08"], ["A", ULTIMO_DATO]]);
    const lista = [{ id: "A", n: "Primero" }, { id: "C", n: "Al día" }, { id: "B", n: "Tercero" }];
    expect(posicionesParadas(lista, paradas, (p) => p.id, (p) => p.n)).toEqual([{ nombre: "Primero", desde: ULTIMO_DATO, id: "A" }, { nombre: "Tercero", desde: "2026-01-08", id: "B" }]);
  });
});

describe("de dónde sale la fecha: el último año de su serie en la base nueva, leído por id", () => {
  beforeEach(() => olvidarFinesDeSerieLeidos());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /* Una base de prueba con los años que se le den: lo demás, 404. */
  const conAnios = (anios: Record<number, string>) => vi.fn(async (_id: string, anio: number) => (anios[anio] ? { last_date: anios[anio] } : undefined));

  test("REST: un GET del documento del año, con solo `last_date` y la credencial del emulador; un 404 es que ese año no existe", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("/price_series/2025?")
        ? new Response(JSON.stringify({ fields: { last_date: { stringValue: ULTIMO_DATO } } }), { status: 200 })
        : new Response("{}", { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);
    expect(await leerAnioDeLaSerie("LU1882457739", 2025)).toEqual({ last_date: ULTIMO_DATO });
    expect(await leerAnioDeLaSerie("LU1882457739", 2026)).toBeUndefined();
    const [url, opciones] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/projects\/bdb-gestor-de-activos\/databases\/\(default\)\/documents\/instruments\/LU1882457739\/price_series\/2025\?mask\.fieldPaths=last_date$/);
    expect(opciones).toEqual({ headers: { Authorization: "Bearer owner" } });
    expect(opciones.method).toBeUndefined();
  });

  test("REST: otro error de la base no es «no existe»: lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    await expect(leerAnioDeLaSerie("LU1882457739", 2026)).rejects.toThrow("400");
  });

  test("una serie viva: existe el año del documento, y es una sola lectura", async () => {
    const leer = conAnios({ 2026: "2026-11-07", 2025: "2025-12-31" });
    expect(await leerFinDeLaSerie("VIVA", 2026, leer)).toBe("2026-11-07");
    expect(leer.mock.calls).toEqual([["VIVA", 2026]]);
  });

  test("en enero, antes del primer dato del año: el año no existe y sí el anterior", async () => {
    const leer = conAnios({ 2025: "2025-12-31" });
    expect(await leerFinDeLaSerie("ENERO", 2026, leer)).toBe("2025-12-31");
    expect(leer.mock.calls).toEqual([["ENERO", 2026], ["ENERO", 2025]]);
  });

  test("parada en 2022: cinco lecturas en 2026, de 2026 a 2022", async () => {
    const leer = conAnios({ 2022: "2022-02-25", 2021: "2021-12-31" });
    expect(await leerFinDeLaSerie("LU0133716950", 2026, leer)).toBe("2022-02-25");
    expect(leer.mock.calls.map(([, anio]) => anio)).toEqual([2026, 2025, 2024, 2023, 2022]);
  });

  test("ningún año dentro del tope: sin fecha, y no se lee más allá", async () => {
    expect(ANIOS_HACIA_ATRAS).toBe(15);
    const leer = conAnios({ 2011: "2011-12-30" });
    expect(await leerFinDeLaSerie("ANTIGUA", 2026, leer)).toBeNull();
    expect(leer.mock.calls.map(([, anio]) => anio)).toEqual(Array.from({ length: 15 }, (_, i) => 2026 - i));
  });

  test("un año sin `last_date` no se da por fecha", async () => {
    expect(await leerFinDeLaSerie("RARA", 2026, vi.fn(async () => ({})))).toBeNull();
  });

  test("un identificador que no es de la base no se lee", async () => {
    const leer = vi.fn();
    expect(await leerFinDeLaSerie("CASH/EUR", 2026, leer)).toBeNull();
    expect(leer).not.toHaveBeenCalled();
  });

  test("un fallo de red deja la posición sin fecha y se vuelve a intentar; lo leído no se repite", async () => {
    let falla = true;
    const leer = vi.fn(async (id: string, anio: number) => {
      if (id === "ROTA" && falla) throw new Error("sin red");
      return id === "SIN_SERIE" || anio !== 2025 ? undefined : { last_date: ULTIMO_DATO };
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect([...(await finesDeSerie(["A", "ROTA", "SIN_SERIE", "A"], "2026-11-11", leer, true))]).toEqual([["A", ULTIMO_DATO]]);
    falla = false;
    expect([...(await finesDeSerie(["A", "ROTA"], "2026-11-11", leer, true))]).toEqual([["A", ULTIMO_DATO], ["ROTA", ULTIMO_DATO]]);
    /* «A»: 2026 y 2025, una sola vez. «ROTA»: falla en 2026 y luego se lee entera. */
    expect(leer.mock.calls.filter(([id]) => id === "A")).toHaveLength(2);
    expect(leer.mock.calls.filter(([id]) => id === "ROTA")).toHaveLength(3);
  });

  test("empieza por el año del día en que se genera", async () => {
    const leer = conAnios({ 2024: "2024-12-31" });
    await finesDeSerie(["X"], "2024-06-01", leer, true);
    expect(leer.mock.calls[0]).toEqual(["X", 2024]);
  });

  test("sin camino a la base nueva no se lee nada", async () => {
    const leer = vi.fn();
    expect((await finesDeSerie(["A"], "2026-11-11", leer, false)).size).toBe(0);
    expect(leer).not.toHaveBeenCalled();
  });
});

/* B-80: NH Hotel Group se para por decisión, no por falta de datos, y no lleva el aviso de B-78 sino la frase de su ficha. */
describe("el instrumento valorado a su último precio por decisión", () => {
  const NH = "ES0161560018";
  const FRASE = "Sin negociación desde el 15/09/2025 · valorado a 6,50 € por decisión";
  /* El euro va tras un espacio duro, como en toda la app: se compara sin él. */
  const llano = (texto: string | null) => texto?.replace(/[\u00a0\u202f]/g, " ") ?? null;
  const nh = { nombre: "NH Hoteles", desde: "2025-09-24", id: NH };
  const otra = { nombre: "Amundi Funds Global Equity C", desde: "2025-11-28", id: "LU0000000001" };

  test("posicionesParadas lleva el instrumento", () => {
    expect(posicionesParadas([NH], new Map([[NH, "2025-09-24"]]), (id) => id, () => "NH Hoteles")).toEqual([nh]);
  });

  test("para el asesor, la frase de la ficha y no «serie parada»", () => {
    expect(llano(avisoDeSerieParada(nh))).toBe(`NH Hoteles · ${FRASE}.`);
    expect(llano(rotuloDeSerieParada("2025-09-24", NH))).toBe(FRASE);
    expect(llano(rotuloDeSerieParada("2025-11-28", "LU0000000001"))).toBe("Serie parada desde el 28/11/2025");
    expect(llano(puntoDeSeriesParadas([nh]))).toBe(`NH Hoteles · ${FRASE}.`);
  });

  test("junto a series paradas de verdad, cada una con lo suyo", () => {
    expect(llano(puntoDeSeriesParadas([otra, nh]))).toBe(
      `Amundi Funds Global Equity C · Serie parada desde el 28/11/2025: sus cifras son de esa fecha o anteriores. NH Hoteles · ${FRASE}.`
    );
    expect(llano(notaDeDatosHasta([otra, nh]))).toBe(`Amundi Funds Global Equity C: sus datos llegan hasta el 28/11/2025. NH Hoteles: ${FRASE}.`);
  });

  test("para el cliente, tampoco «sus datos llegan hasta»", () => {
    expect(llano(datosHasta("2025-09-24", NH))).toBe(`${FRASE}.`);
    expect(llano(datosHasta("2025-11-28"))).toBe("Sus datos llegan hasta el 28/11/2025.");
    expect(llano(notaDeDatosHasta([nh]))).toBe(`NH Hoteles: ${FRASE}.`);
  });

  test("solo NH: textoSiCongelado no reconoce otro", () => {
    expect(llano(textoSiCongelado(NH))).toBe(FRASE);
    expect(textoSiCongelado("ES0125140A14")).toBeNull();
    expect(textoSiCongelado(undefined)).toBeNull();
  });
});
