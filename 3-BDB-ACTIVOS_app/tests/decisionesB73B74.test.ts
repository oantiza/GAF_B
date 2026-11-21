/**
 * Decisiones B-73 y B-74 de Óscar (09-11-2026), en lo que lee la app. Los documentos de la base local aún no traen estos campos (la undécima subida los
 * traerá), así que los casos van con documentos escritos a mano y resultados escritos a mano.
 *
 * B-73: una cifra nuestra fuera del rango de su contrato ya no tumba el documento: se aparta (`computed/metrics.out_of_range`, y en la tarjeta
 * `metrics.windows_out_of_range`) y bloquea solo su ventana, «con el motivo a la vista». Las acciones admiten rentabilidad en [-1, 20]: Moderna a 1 año,
 * 9,8095, pasa, y la app no le pone tope propio.
 *
 * B-74: la rentabilidad del proveedor puede llevar una fecha por ventana (`declared/provider_returns.as_of_by_window`, y en la tarjeta
 * `metrics.provider.returns_as_of_by_window` y, para el titular del proveedor, `metrics.returns_as_of` y `metrics.returns_as_of_by_window`).
 */
import { describe, expect, test } from "vitest";
import { componerFicha } from "../src/adapters/componerFicha";
import {
  apuntesDelPapel,
  cifrasApartadasDeLaComparativa,
  columnasDeActivos,
  fechaYDivisaDeLasCifras,
  filasDeActivos,
  notasDeLaComparativa,
  notasDeLasCifrasApartadas,
  type FuenteDeColumna
} from "../src/adapters/comparativaDeActivos";
import { cifraDeLaTarjeta } from "../src/adapters/componerLista";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { fraseDeLaCifraApartada } from "../src/core/ventanaSinMedir";
import type { BdbAssetSearchResult } from "../src/types/bdbAssets";

function instrumento(partes: {
  tipo?: string;
  metricas?: Record<string, unknown> | null;
  retornos?: Record<string, unknown>;
  tarjeta?: Record<string, unknown>;
}): InstrumentoDeLaBase {
  return {
    isin: "LU0000000001",
    raiz: { identity: { name: "Un activo", currency: "EUR" }, instrument_type: partes.tipo ?? "FUND" },
    tarjeta: { instrument_id: "LU0000000001", identity: { name: "Un activo" }, metrics: partes.tarjeta ?? {} },
    calidad: undefined,
    bloques: {
      ...(partes.metricas === null ? {} : { "computed/metrics": { method: "EXTRACTOR_MONTHLY_V2", as_of: "2026-10-31", computed_at: "2026-11-09", ...(partes.metricas ?? {}) } }),
      ...(partes.retornos ? { "declared/provider_returns": { source: "MORNINGSTAR", return_basis: "TOTAL_RETURN", ...partes.retornos } } : {})
    }
  };
}
const seccion = (f: ReturnType<typeof componerFicha>, id: string) => f.secciones.find((s) => s.id === id);
const textoDe = (trozos: ReadonlyArray<{ texto: string }> | undefined) => trozos?.map((t) => t.texto).join("") ?? "";

const FUERA_INTERNO =
  "Falta el dato de la rentabilidad anualizada a 1 año: calculamos +540,00\u00a0%, por encima del máximo que admitimos, +500,00\u00a0%, y la apartamos.";
const FUERA_SIN_CIFRA = "Falta el dato de la rentabilidad anualizada a 1 año: la cifra calculada se sale del rango que admitimos, y la apartamos.";

describe("B-73. La frase de la cifra apartada", () => {
  test("con su valor y su límite, por arriba y por abajo; sin ellos, solo el motivo", () => {
    expect(fraseDeLaCifraApartada({ ruta: "annualized_return.1y", valor: "+540,00\u00a0%", limite: "+500,00\u00a0%", porEncima: true })).toBe(FUERA_INTERNO);
    expect(fraseDeLaCifraApartada({ ruta: "annualized_return.1y" })).toBe(FUERA_SIN_CIFRA);
    expect(fraseDeLaCifraApartada({ ruta: "ytd_return", valor: "−120,00\u00a0%", limite: "−100,00\u00a0%", porEncima: false })).toBe(
      "Falta el dato de la rentabilidad en lo que va de año: calculamos −120,00\u00a0%, por debajo del mínimo que admitimos, −100,00\u00a0%, y la apartamos."
    );
    expect(fraseDeLaCifraApartada({ ruta: "relative.r2.3y" })).toBe("Falta el dato del R² a 3 años: la cifra calculada se sale del rango que admitimos, y la apartamos.");
  });
});

describe("B-73. Un hueco fuera de rango en la ficha", () => {
  const fondo = instrumento({
    metricas: {
      annualized_return: { "3y": 0.12 },
      volatility: { "1y": 0.31, "3y": 0.22 },
      sharpe: { "3y": 0.5 },
      out_of_range: { annualized_return: { "1y": { value: 5.4, limit: 5 } } }
    },
    retornos: { as_of: "2026-09-30" },
    tarjeta: { windows_out_of_range: ["annualized_return.1y"] }
  });

  test("con computed/metrics: la celda dice «Falta el dato», solo en su cifra, y la nota dice por qué con lo calculado y el límite", () => {
    const f = componerFicha(fondo);
    const tabla = seccion(f, "metricas")?.tabla;
    expect(tabla?.columnas).toEqual(["", "1 año", "3 años"]);
    const fila = (rotulo: string) => tabla?.filas.find((x) => x[0] === rotulo);
    expect(fila("Rentabilidad anualizada")?.[1]).toEqual({ texto: "Falta el dato", ausencia: "falta" });
    expect(fila("Rentabilidad anualizada")?.[2]).toBe("+12,00\u00a0%");
    /* El resto de la ventana se enseña: la cifra apartada bloquea solo la suya. */
    expect(fila("Volatilidad")?.[1]).toBe("31,00\u00a0%");
    /* Y el Sharpe a 1 año, que falta, no dice «Sin historia»: la serie llega, la rentabilidad se calculó. */
    expect(fila("Sharpe")?.[1]).toEqual({ texto: "No calculado", ausencia: "no-aplica" });
    expect(seccion(f, "metricas")?.nota).toContain(FUERA_INTERNO);
    expect(seccion(f, "metricas")?.nota).not.toContain("Sin historia");
  });

  test("en Modo cliente, el motivo se dice y la cifra apartada no se enseña", () => {
    const f = componerFicha(fondo, undefined, { modoCliente: true });
    expect(seccion(f, "metricas")?.nota).toContain(FUERA_SIN_CIFRA);
    expect(JSON.stringify(f)).not.toContain("540");
    expect(JSON.stringify(f)).not.toContain("500,00");
  });

  test("lo que anota computed/metrics basta aunque la tarjeta no lo liste, y lo contrario también", () => {
    const soloDocumento = instrumento({ metricas: { volatility: { "1y": 0.3 }, out_of_range: { annualized_return: { "1y": { value: 5.4, limit: 5 } } } } });
    expect(seccion(componerFicha(soloDocumento), "metricas")?.nota).toContain(FUERA_INTERNO);
    const soloTarjeta = instrumento({ metricas: { volatility: { "1y": 0.3 } }, tarjeta: { windows_out_of_range: ["annualized_return.1y"] } });
    expect(seccion(componerFicha(soloTarjeta), "metricas")?.nota).toContain(FUERA_SIN_CIFRA);
  });

  test("sin computed/metrics: la tarjeta basta para decir el motivo, sin la cifra", () => {
    const f = componerFicha(instrumento({ metricas: null, tarjeta: { windows_out_of_range: ["annualized_return.1y"] } }));
    const metricas = seccion(f, "metricas");
    expect(textoDe(metricas?.procedencia)).toBe("Calculadas por nosotros");
    expect(metricas?.nota).toBe(FUERA_SIN_CIFRA);
    expect(metricas?.tabla).toBeUndefined();
  });

  test("lo que va «En el año» y lo que se mide contra el índice, cada uno en su sección", () => {
    const f = componerFicha(
      instrumento({
        metricas: {
          annualized_return: { "1y": 0.1 },
          relative: { benchmark: { name: "MSCI World NR" }, beta: { "3y": 1.1 }, r2: { "1y": 0.9 } },
          out_of_range: { ytd_return: { value: 5.2, limit: 5 }, relative: { r2: { "3y": { value: 1.02, limit: 1 } } } }
        }
      })
    );
    expect(seccion(f, "metricas")?.nota).toContain(
      "Falta el dato de la rentabilidad en lo que va de año: calculamos +520,00\u00a0%, por encima del máximo que admitimos, +500,00\u00a0%, y la apartamos."
    );
    expect(seccion(f, "metricas")?.nota).not.toContain("R²");
    const indice = seccion(f, "contra-indice-propio");
    expect(indice?.tabla?.columnas).toEqual(["", "1 año", "3 años"]);
    expect(indice?.tabla?.filas.find((x) => x[0] === "R²")?.slice(1)).toEqual(["90,00\u00a0%", { texto: "Falta el dato", ausencia: "falta" }]);
    expect(indice?.nota).toContain("Falta el dato del R² a 3 años: calculamos 102,00\u00a0%, por encima del máximo que admitimos, 100,00\u00a0%, y la apartamos.");
  });

  test("donde nuestra cifra se apartó y el proveedor publica la ventana, sale la suya con su nombre (decisión 110)", () => {
    const f = componerFicha(
      instrumento({
        metricas: { annualized_return: { "3y": 0.12 }, out_of_range: { annualized_return: { "1y": { value: 5.4, limit: 5 } } } },
        retornos: { as_of: "2026-09-30", trailing_return: { "1y": { fund: 0.31 } } }
      })
    );
    expect(seccion(f, "rentabilidad")?.filas.map((x) => [x.rotulo, x.valor])).toEqual([["1 año", "+31,00\u00a0%"]]);
  });
});

const activo = (asset_id: string, instrument_type = "FUND") => ({ asset_id, display_name: asset_id, instrument_type, currency: "EUR", metrics: {} }) as unknown as BdbAssetSearchResult;
const conTarjeta = (asset_id: string, metrics: Record<string, unknown>, instrument_type = "FUND"): FuenteDeColumna => ({
  activo: activo(asset_id, instrument_type),
  tarjeta: { instrument_id: asset_id, instrument_type, identity: { currency: "EUR" }, metrics: { method: "EXTRACTOR_MONTHLY_V2", frequency: "MONTHLY", as_of: "2026-10-31", ...metrics } }
});

describe("B-73. Un hueco fuera de rango en la comparativa", () => {
  const apartado = conTarjeta("FONDO-A", { annualized_return: { "3y": 0.12 }, volatility: { "1y": 0.3 }, windows_out_of_range: ["annualized_return.1y", "ytd_return"] });
  const otro = conTarjeta("FONDO-B", { annualized_return: { "1y": 0.05, "3y": 0.04 } });

  test("la celda dice «Falta el dato» y la nota de la tabla dice por qué, con el nombre del activo y sin la cifra", () => {
    const fuentes = [apartado, otro];
    const [columna] = columnasDeActivos(fuentes);
    const filas = filasDeActivos(fuentes, { modoCliente: false });
    expect(filas.find((f) => f.id === "annualized_return-1y")!.celda(columna!)).toMatchObject({ texto: "Falta el dato", ausencia: "falta" });
    expect(filas.find((f) => f.id === "volatility-1y")!.celda(columna!).texto).toBe("30,00\u00a0%");
    /* El año en curso no tiene fila en esta tabla: no hay hueco que explicar. */
    expect(notasDeLasCifrasApartadas(fuentes)).toEqual([`FONDO-A. ${FUERA_SIN_CIFRA}`]);
  });

  test("la nota de la serie sigue siendo solo la de la serie; la de la cifra apartada va aparte, con su fila (decisión A-125)", () => {
    expect(notasDeLaComparativa([apartado, otro])).toEqual([]);
    expect(cifrasApartadasDeLaComparativa([apartado, otro])).toEqual([{ fila: "annualized_return-1y", nota: `FONDO-A. ${FUERA_SIN_CIFRA}` }]);
  });

  test("si la celda la ocupa la cifra del proveedor, con su nombre, no falta nada", () => {
    const conLaSuya = conTarjeta("FONDO-C", {
      windows_out_of_range: ["annualized_return.1y"],
      provider: { as_of: "2026-10-31", annualized_return: { "1y": 0.31 } }
    });
    expect(notasDeLasCifrasApartadas([conLaSuya])).toEqual([]);
  });
});

describe("B-73. Moderna a 1 año, +980,95\u00a0%, sin tope de la app", () => {
  const MODERNA = "US60770K1079";

  test("la ficha la enseña, y su año en curso también", () => {
    const f = componerFicha({
      ...instrumento({ tipo: "STOCK", metricas: { method: "EXTRACTOR_DAILY_V1", annualized_return: { "1y": 9.8095 }, volatility: { "1y": 0.95 }, ytd_return: 7.62 } }),
      isin: MODERNA
    });
    const tabla = seccion(f, "metricas")?.tabla;
    expect(tabla?.filas.find((x) => /^Rentabilidad/.test(String(x[0])))).toEqual(["Rentabilidad anualizada", "+762,00\u00a0%", "+980,95\u00a0%"]);
    expect(JSON.stringify(f)).not.toContain("Falta el dato de la rentabilidad");
  });

  test("la comparativa y la lista la leen tal cual", () => {
    const moderna = conTarjeta(MODERNA, { method: "EXTRACTOR_DAILY_V1", frequency: "DAILY", annualized_return: { "1y": 9.8095 } }, "STOCK");
    expect(cifraDeLaTarjeta(moderna.tarjeta, "annualized_return", "1y")).toEqual({ valor: 9.8095, delProveedor: false });
    const [columna] = columnasDeActivos([moderna]);
    const fila = filasDeActivos([moderna], { modoCliente: false }).find((f) => f.id === "annualized_return-1y")!;
    expect(fila.valor?.(columna!)).toBe(9.8095);
    expect(fila.celda(columna!).texto).toBe("+980,95\u00a0%");
  });
});

describe("B-74. La fecha de cada cifra del proveedor, en la ficha", () => {
  /* LU1295551144, Capital Group New Perspective: 1 año y «En el año» a 31 oct; 3, 5 y 10 años a 30 sept. Sin cifras nuestras. */
  const TODAS = { "1y": { fund: 0.18 }, "3y": { fund: 0.14 }, "5y": { fund: 0.11 }, "10y": { fund: 0.1 } };
  const rentabilidad = (retornos: Record<string, unknown>) => seccion(componerFicha(instrumento({ metricas: null, retornos })), "rentabilidad");

  test("con el mapa, cada grupo de ventanas con su fecha, en el orden de las filas", () => {
    const s = rentabilidad({
      as_of: "2026-10-31",
      as_of_by_window: { "1y": "2026-10-31", "3y": "2026-09-30", "5y": "2026-09-30", "10y": "2026-09-30", ytd: "2026-10-31" },
      trailing_return: TODAS,
      ytd_return: { fund: 0.15 }
    });
    expect(s?.filas.map((f) => f.rotulo)).toEqual(["1 año", "3 años", "5 años", "10 años", "En el año"]);
    expect(textoDe(s?.procedencia)).toBe("Cifras del proveedor · 1 año y en el año a 31/10/2026 · 3, 5 y 10 años a 30/09/2026");
  });

  test("con el mapa y solo las ventanas de una fecha a la vista, esa fecha, y no la del bloque", () => {
    const s = rentabilidad({
      as_of: "2026-10-31",
      as_of_by_window: { "1y": "2026-10-31", "3y": "2026-09-30" },
      trailing_return: { "3y": { fund: 0.14 } }
    });
    expect(textoDe(s?.procedencia)).toBe("Cifras del proveedor · 30/09/2026");
  });

  test("sin el mapa, como hasta ahora (decisión 114)", () => {
    const s = rentabilidad({ as_of: "2026-09-30", trailing_return: TODAS, ytd_return: { fund: 0.15 } });
    expect(textoDe(s?.procedencia)).toBe("Cifras del proveedor · 3, 5 y 10 años a 30/09/2026");
  });
});

describe("B-74. La fecha de cada cifra del proveedor, en la comparativa", () => {
  const jpm = conTarjeta("LU0430492750", { annualized_return: { "1y": -0.028, "3y": 0.028, "5y": -0.017, "10y": -0.001 } });

  test("en una tarjeta mezclada, con el mapa, su 1 año lleva su fecha; sin él, «sin fecha», como hasta ahora", () => {
    const provider = { as_of: "2026-10-31", returns_as_of: "2026-10-31", annualized_return: { "1y": 0.146, "3y": 0.0967 } };
    const conMapa = conTarjeta("LU3038481936", { ytd_return: 0.1, provider: { ...provider, returns_as_of_by_window: { "1y": "2026-10-31", "3y": "2026-09-30" } } });
    const sinMapa = conTarjeta("LU3038481936", { ytd_return: 0.1, provider: { ...provider, returns_as_of: "2026-09-30" } });
    const celdas = (fuente: FuenteDeColumna) => {
      const fuentes = [fuente, jpm];
      const [columna] = columnasDeActivos(fuentes);
      const filas = filasDeActivos(fuentes, { modoCliente: false });
      return ["annualized_return-1y", "annualized_return-3y"].map((id) => filas.find((f) => f.id === id)!.celda(columna!).apunte);
    };
    expect(celdas(conMapa)).toEqual(["Del proveedor · a 31/10/2026", "Del proveedor · a 30/09/2026"]);
    expect(celdas(sinMapa)).toEqual(["Del proveedor, sin fecha", "Del proveedor · a 30/09/2026"]);
    /* Desde la decisión A-125 el papel sigue la misma regla: con el mapa, su 3 años va a 30 sept y su 1 año, a la fecha de las demás cifras. Sin el
       mapa, como antes. */
    expect(fechaYDivisaDeLasCifras([conMapa, jpm]).get("LU3038481936")).toEqual({ cierre: "2026-10-31", delProveedor: [{ columnas: ["3A"], fecha: "2026-09-30" }] });
    const igualSinMapa = conTarjeta("LU3038481936", { ytd_return: 0.1, provider });
    expect(fechaYDivisaDeLasCifras([igualSinMapa, jpm]).get("LU3038481936")).toEqual({});
  });

  const titular = (metrics: Record<string, unknown>) =>
    conTarjeta("LU1295551144", {
      method: "TRAILING_PROVIDER",
      frequency: "PROVIDER",
      as_of: "2026-10-31",
      annualized_return: { "1y": 0.18, "3y": 0.14, "5y": 0.11, "10y": 0.1 },
      volatility: { "3y": 0.13 },
      ...metrics
    });
  const apuntes = (fuente: FuenteDeColumna, otra: FuenteDeColumna) => {
    const fuentes = [fuente, otra];
    const [columna] = columnasDeActivos(fuentes);
    const filas = filasDeActivos(fuentes, { modoCliente: false });
    return ["annualized_return-1y", "annualized_return-3y", "annualized_return-5y", "annualized_return-10y", "volatility-3y"].map(
      (id) => filas.find((f) => f.id === id)!.celda(columna!).apunte
    );
  };
  const otraFecha = { ...jpm, tarjeta: { ...jpm.tarjeta, metrics: { ...(jpm.tarjeta!.metrics as object), as_of: "2026-09-30" } } } as FuenteDeColumna;

  test("titular del proveedor con fecha por ventana: la que no es la de su columna se dice en su celda", () => {
    const conMapa = titular({ returns_as_of: "2026-10-31", returns_as_of_by_window: { "1y": "2026-10-31", "3y": "2026-09-30", "5y": "2026-09-30", "10y": "2026-09-30" } });
    expect(apuntes(conMapa, otraFecha)).toEqual([undefined, "A 30/09/2026", "A 30/09/2026", "A 30/09/2026", undefined]);
    /* También cuando la cabecera no dice fecha: la de sus rentabilidades no es la de las demás cifras de la tabla. */
    expect(apuntes(conMapa, jpm)).toEqual([undefined, "A 30/09/2026", "A 30/09/2026", "A 30/09/2026", undefined]);
  });

  test("titular del proveedor con una sola fecha de rentabilidad, distinta de la de su riesgo", () => {
    expect(apuntes(titular({ returns_as_of: "2026-09-30" }), jpm)).toEqual(["A 30/09/2026", "A 30/09/2026", "A 30/09/2026", "A 30/09/2026", undefined]);
  });

  test("el papel recibe de cada celda el mismo apunte que la pantalla, y la nota de fechas sigue la misma regla (decisión A-125)", () => {
    const conMapa = titular({ returns_as_of: "2026-10-31", returns_as_of_by_window: { "1y": "2026-10-31", "3y": "2026-09-30", "5y": "2026-09-30", "10y": "2026-09-30" } });
    const fuentes = [conMapa, otraFecha];
    const apuntes = apuntesDelPapel(columnasDeActivos(fuentes), filasDeActivos(fuentes, { modoCliente: false }));
    expect(apuntes.get("LU1295551144")).toEqual({ "annualized_return-3y": "A 30/09/2026", "annualized_return-5y": "A 30/09/2026", "annualized_return-10y": "A 30/09/2026" });
    expect(apuntes.get("LU0430492750")).toEqual({});
    /* La nota del papel ya no dice «sin fecha»: dice la de cada una, la misma que su celda. */
    expect(fechaYDivisaDeLasCifras(fuentes).get("LU1295551144")).toEqual({ cierre: "2026-10-31", delProveedor: [{ columnas: ["3A", "5A", "10A"], fecha: "2026-09-30" }] });
  });

  test("titular del proveedor sin fechas de rentabilidad: como hasta ahora (decisión 119)", () => {
    expect(apuntes(titular({}), otraFecha)).toEqual(["Sin fecha", "Sin fecha", "Sin fecha", "Sin fecha", undefined]);
    expect(apuntes(titular({}), jpm)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
