import { describe, expect, test } from "vitest";
import { componerEstado } from "../src/adapters/componerEstado";
import { componerFicha } from "../src/adapters/componerFicha";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";

/**
 * Nuestras métricas en la ficha: una tabla de magnitud por ventana.
 *
 * Hasta el 02-11-2026 esta sección eran cinco filas elegidas a mano —volatilidad a uno y
 * a tres, Sharpe a uno, caída a uno—, y eso no era pereza: de la caída máxima solo había
 * UNA ventana por instrumento, porque el extractor publicaba la mejor disponible en un
 * escalar y tiraba las otras. Medido entonces sobre la base: 625 instrumentos la tenían a
 * tres años, 290 a cinco y **ninguno a uno**.
 *
 * Después del arreglo hay cuatro ventanas de caída, cuatro de volatilidad, tres de Sharpe
 * y tres de Sortino, que antes no existía en ningún instrumento. Lo que estas pruebas
 * fijan es lo único que esta sección no puede fallar: que las ventanas salgan de lo que el
 * instrumento TRAE y no de una lista fija, y que una celda sin cifra no se rellene.
 */

function instrumento(metricas: Record<string, unknown>): InstrumentoDeLaBase {
  return {
    isin: "LU0011889846",
    raiz: { identity: { name: "Un fondo", currency: "EUR" }, listing_status: "LISTED" },
    tarjeta: { instrument_id: "LU0011889846", identity: { name: "Un fondo" } },
    calidad: undefined,
    bloques: { "computed/metrics": { method: "EXTRACTOR_MONTHLY_V1", computed_at: "2026-10-31", ...metricas } }
  };
}

const seccion = (ficha: ReturnType<typeof componerFicha>) =>
  ficha.secciones.find((s) => s.id === "metricas");

describe("nuestras métricas, por ventana", () => {
  test("las columnas son las ventanas que el instrumento tiene, no cuatro siempre", () => {
    const corta = seccion(
      componerFicha(instrumento({ volatility: { "1y": 0.1234 }, max_drawdown: { "1y": -0.1416 } }))
    );
    expect(corta?.tabla?.columnas).toEqual(["", "1 año"]);

    const larga = seccion(
      componerFicha(
        instrumento({
          volatility: { "1y": 0.1234, "3y": 0.11, "5y": 0.1, "10y": 0.09 },
          max_drawdown: { "1y": -0.1416, "3y": -0.2664, "5y": -0.32, "10y": -0.32 }
        })
      )
    );
    expect(larga?.tabla?.columnas).toEqual(["", "1 año", "3 años", "5 años", "10 años"]);
  });

  test("una magnitud sin ninguna ventana no tiene fila: no se enseña un hueco entero", () => {
    /* El caso real de las acciones: por el camino diario el Sortino no lo calcula nadie,
       así que una fila «Sortino — — —» sería una afirmación sobre un dato que nadie ha
       intentado producir. */
    const s = seccion(
      componerFicha(instrumento({ volatility: { "1y": 0.1234 }, sharpe: { "1y": 0.42 } }))
    );
    expect(s?.tabla?.filas.map((f) => f[0])).toEqual(["Volatilidad", "Sharpe"]);
    expect(s?.tabla?.filas.map((f) => f[0])).not.toContain("Sortino");
  });

  test("un hueco dentro de una magnitud que sí existe dice por qué, nunca un cero ni una raya", () => {
    const s = seccion(
      componerFicha(
        instrumento({
          volatility: { "1y": 0.1234, "3y": 0.11 },
          sortino: { "1y": 0.31 }
        })
      )
    );
    const sortino = s?.tabla?.filas.find((f) => f[0] === "Sortino");
    expect(sortino?.[2]).toEqual({ texto: "Sin historia", ausencia: "no-aplica" });
  });

  test("la caída máxima conserva su signo y el Sortino no se escribe en por ciento", () => {
    const s = seccion(
      componerFicha(
        instrumento({ max_drawdown: { "3y": -0.266365 }, sortino: { "3y": 0.7723 } })
      )
    );
    expect(s?.tabla?.filas.find((f) => f[0] === "Caída máxima")?.[1]).toContain("26,64");
    expect(s?.tabla?.filas.find((f) => f[0] === "Caída máxima")?.[1]).toContain("%");
    expect(s?.tabla?.filas.find((f) => f[0] === "Sortino")?.[1]).toBe("0,77");
  });

  test("sin ninguna cifra por ventana no hay tabla que pintar", () => {
    const s = seccion(componerFicha(instrumento({ ytd_return: 0.011 })));
    expect(s?.tabla).toBeUndefined();
  });
});


describe("una clase que reparte no tiene cifra propia, y la ficha dice por qué", () => {
  const conPolitica = (politica: string): InstrumentoDeLaBase => ({
    ...instrumento({}),
    bloques: { "declared/profile": { distribution_policy: politica } }
  });

  test("si reparte, lo explica en vez de dejar el hueco", () => {
    const s = seccion(componerFicha(conPolitica("DISTRIBUTING")));
    expect(s?.titulo).toBe("Nuestras métricas");
    expect(s?.nota).toContain("reparte");
    expect(s?.tabla).toBeUndefined();
  });

  test("si no reparte, no se inventa ese motivo", () => {
    expect(seccion(componerFicha(conPolitica("ACCUMULATING")))).toBeUndefined();
  });
});


describe("la tira de aptitudes de una clase que reparte", () => {
  const aptitud = (politica: string) => {
    const base = instrumento({});
    const ficha = componerFicha({
      ...base,
      tarjeta: {
        ...base.tarjeta,
        metrics: { distribution_policy: politica },
        quality: { fitness: { METRICAS_PROPIAS: { apt: false, missing: ["computed/metrics"] } } }
      }
    });
    return ficha.aptitudes.find((a) => a.rotulo === "Métricas nuestras");
  };

  test("no dice que falta el dato: dice que no aplica", () => {
    expect(aptitud("DISTRIBUTING")).toMatchObject({ valor: "No aplica", estado: "no-aplica" });
  });

  test("a una clase que acumula sí le falta", () => {
    expect(aptitud("ACCUMULATING")).toMatchObject({ valor: "Falta el dato", estado: "falta" });
  });
});


describe("la ficha dice por qué no hay métricas nuestras, y las nombra sin jerga", () => {
  const sinMetricas = (code: string, reason: string): InstrumentoDeLaBase => {
    const base = instrumento({});
    return {
      ...base,
      raiz: { ...base.raiz, metrics_absence: { code, reason } },
      tarjeta: {
        ...base.tarjeta,
        quality: { fitness: { METRICAS_PROPIAS: { apt: false, missing: ["computed/metrics"] } } }
      },
      bloques: {}
    };
  };

  test.each([
    ["SERIES_STOPPED", "Su serie está parada"],
    ["NO_PRICES", "No tenemos su serie de precios"],
    ["SHORT_HISTORY", "Su historia es demasiado corta"],
    ["POLICY_UNKNOWN", "No sabemos si esta clase reparte"]
  ])("%s tiene su frase", (code, titular) => {
    const s = seccion(componerFicha(sinMetricas(code, "NOT_PROVIDED")));
    expect(s?.procedencia?.[0]?.texto).toBe(titular);
  });

  test("lo que falta se dice que falta; lo que no aplica, no", () => {
    const aptitud = (reason: string) =>
      componerFicha(sinMetricas("NO_METHOD", reason)).aptitudes.find((a) => a.rotulo === "Métricas nuestras");
    expect(aptitud("NOT_APPLICABLE")?.valor).toBe("No aplica");
    expect(aptitud("NOT_PROVIDED")?.valor).toBe("Falta el dato");
  });

  test("el método sale con su nombre, no con su código", () => {
    const s = seccion(componerFicha(instrumento({ method: "EXTRACTOR_MONTHLY_V2", volatility: { "1y": 0.1 } })));
    const texto = s?.procedencia?.map((t) => t.texto).join("") ?? "";
    expect(texto).toContain("Nuestro método mensual, en euros");
    expect(texto).not.toContain("EXTRACTOR");
  });

  test("las cifras contra su índice se enseñan cuando existen, y dicen contra qué", () => {
    const ficha = componerFicha(
      instrumento({
        relative: {
          benchmark: { name: "MSCI World NR", instrument_id: "IE00B03HD191" },
          jensen_alpha: { "3y": 0.012 },
          tracking_error: { "3y": 0.031 },
          information_ratio: { "3y": 0.4 }
        }
      })
    );
    const s = ficha.secciones.find((x) => x.id === "contra-indice-propio");
    expect(s?.tabla?.filas.map((f) => f[0])).toEqual(["Alfa de Jensen", "Tracking error", "Ratio de información"]);
    expect(s?.procedencia?.map((t) => t.texto).join("")).toContain("MSCI World NR");
    expect(s?.nota).toContain("IE00B03HD191");
  });

  test("sin esas cifras, la sección no sale", () => {
    const ficha = componerFicha(instrumento({ volatility: { "1y": 0.1 } }));
    expect(ficha.secciones.find((x) => x.id === "contra-indice-propio")).toBeUndefined();
  });

  test("la del proveedor sale solo donde no hay la nuestra: nunca dos alfas en una ficha", () => {
    const delProveedor = { beta: { "1y": { vs_benchmark: 0.9 } }, as_of: "2026-10-31" };
    const conAmbas = instrumento({
      relative: { benchmark: { name: "MSCI World NR" }, jensen_alpha: { "3y": 0.012 } }
    });
    conAmbas.bloques["declared/provider_risk"] = delProveedor;
    const ids = componerFicha(conAmbas).secciones.map((s) => s.id);
    expect(ids).toContain("contra-indice-propio");
    expect(ids).not.toContain("contra-indice");

    const soloSuya = instrumento({ volatility: { "1y": 0.1 } });
    soloSuya.bloques["declared/provider_risk"] = delProveedor;
    expect(componerFicha(soloSuya).secciones.map((s) => s.id)).toContain("contra-indice");
  });
});


describe("el Sharpe de una acción no se enseña en su ficha", () => {
  test("sale el resto de la tabla, sin esa fila", () => {
    const base = instrumento({ volatility: { "1y": 0.2 }, sharpe: { "1y": 1.2 } });
    const accion = { ...base, raiz: { ...base.raiz, instrument_type: "STOCK" } };
    const filas = seccion(componerFicha(accion))?.tabla?.filas.map((f) => f[0]);
    expect(filas).toContain("Volatilidad");
    expect(filas).not.toContain("Sharpe");
  });

  test("en un fondo sigue saliendo", () => {
    const filas = seccion(
      componerFicha(instrumento({ volatility: { "1y": 0.2 }, sharpe: { "1y": 1.2 } }))
    )?.tabla?.filas.map((f) => f[0]);
    expect(filas).toContain("Sharpe");
  });
});


describe("el catálogo y las marcas del control", () => {
  const tarjeta = (id: string, metrics: Record<string, unknown>) => ({
    instrument_id: id,
    identity: { name: `Fondo ${id}` },
    computed_at: "2026-11-04",
    metrics
  });

  test("cuenta las fuentes, los cierres y lo que hay que revisar", () => {
    const estado = componerEstado([
      tarjeta("A", { source: "COMPUTED", frequency: "MONTHLY", as_of: "2026-10-31" }),
      tarjeta("B", {
        source: "COMPUTED",
        frequency: "MONTHLY",
        as_of: "2026-09-30",
        control: { as_of: "2026-10-31", mismatch: ["sharpe.3y", "volatility.1y"] }
      }),
      tarjeta("C", { source: "COMPUTED", frequency: "DAILY", as_of: "2026-11-02" }),
      tarjeta("D", { source: "PROVIDER" }),
      tarjeta("E", {})
    ]);
    expect(estado).toMatchObject({ instrumentos: 5, propias: 3, delProveedor: 1, sinCifras: 1 });
    expect(estado.cierres).toEqual([
      { fecha: "2026-10-31", fondos: 1 },
      { fecha: "2026-09-30", fondos: 1 }
    ]);
    expect(estado.paraRevisar).toEqual([
      { isin: "B", nombre: "Fondo B", discrepa: "Sharpe a 3 años, Volatilidad a 1 año", fecha: "2026-10-31" }
    ]);
  });

  test("la ficha señala la marca, y dice por qué no hay Sharpe a 10 años", () => {
    const base = instrumento({ annualized_return: { "10y": 0.1 }, sharpe: { "3y": 1 } });
    const nota = seccion(
      componerFicha({
        ...base,
        tarjeta: { ...base.tarjeta, metrics: { control: { mismatch: ["sharpe.3y"] } } }
      })
    )?.nota;
    expect(nota).toContain("Para revisar: Sharpe a 3 años");
    expect(nota).toContain("€STR empieza en octubre de 2019");
  });

  test("sin marca no dice nada de revisar", () => {
    const nota = seccion(componerFicha(instrumento({ sharpe: { "3y": 1 } })))?.nota;
    expect(nota).not.toContain("Para revisar");
  });
});


describe("una acción frente a su referencia", () => {
  const accion = (metricas: Record<string, unknown>) => {
    const base = instrumento(metricas);
    return { ...base, raiz: { ...base.raiz, instrument_type: "STOCK" } };
  };
  const relative = (reference: string) => ({
    relative: {
      reference,
      frequency: "MONTHLY",
      benchmark: { name: "MSCI Europe", instrument_id: "IE0007987708" },
      beta: { "3y": 0.82, "5y": 0.91 },
      r2: { "3y": 0.3, "5y": 0.35 }
    }
  });
  const seccionDelIndice = (m: Record<string, unknown>) =>
    componerFicha(accion({ volatility: { "1y": 0.2 }, ...m })).secciones.find((s) => s.id === "contra-indice-propio");

  test("solo beta y R², y dice que lo elegimos nosotros y que es de su área", () => {
    const s = seccionDelIndice(relative("ASSIGNED_AREA_INDEX"));
    expect(s?.tabla?.filas.map((f) => f[0])).toEqual(["Beta", "R²"]);
    expect(s?.nota).toContain("lo elegimos nosotros");
    expect(s?.nota).toContain("de su área");
    expect(s?.nota).toContain("±0,35");
    expect(s?.nota).not.toContain("alfa");
  });

  test("si es de su plaza, no dice que sea de su área", () => {
    const s = seccionDelIndice(relative("ASSIGNED_MARKET_INDEX"));
    expect(s?.nota).toContain("lo elegimos nosotros");
    expect(s?.nota).not.toContain("de su área");
  });

  test("sin referencia decidida lo dice, y sin nada no sale la sección", () => {
    const s = seccionDelIndice({ relative_absence: "NO_REFERENCE_FOR_MARKET" });
    expect(s?.procedencia?.[0]?.texto).toBe("Sin referencia");
    expect(seccionDelIndice({})).toBeUndefined();
  });

  test("una bolsa sin fila dice que es una decisión pendiente, no que falte un dato (decisión 46)", () => {
    const s = seccionDelIndice({ relative_absence: "NO_REFERENCE_DECIDED_FOR_MARKET" });
    expect(s?.procedencia?.[0]?.texto).toBe("Sin referencia");
    expect(s?.nota).toContain("No hemos decidido todavía");
    expect(s?.nota).toContain("no la medimos contra el de otra plaza");
  });
});


describe("un fondo frente a su índice, según su KID (decisiones 20 y 21 del 07-11-2026)", () => {
  const TEXTO =
    "encia temático que está compuesto en un 50 % por el Wilderhill Clean Energy Index (ECO) y en un 50 % por el Wilderhill New Energy Global Innovation Index (NEX) y que se utiliza para comparar la rentab";
  const fondo = (metricas: Record<string, unknown>) => instrumento({ volatility: { "1y": 0.38 }, ...metricas });
  const seccionDelIndice = (m: Record<string, unknown>, modoCliente = false) =>
    componerFicha(fondo(m), undefined, { modoCliente }).secciones.find((s) => s.id === "contra-indice-propio");
  const COMPUESTO = {
    relative_absence: "KID_DECLARES_COMPOSITE",
    relative_absence_evidence: { kid_excerpt: TEXTO, checked_on: "2026-11-07" },
    relative_withdrawal: {
      withdrawn_on: "2026-11-07",
      decision: "DECISIONES_DATOS_2026-11-07.md, punto 20",
      benchmark_name: "MSCI ACWI",
      benchmark_instrument_id: "IE00B6R52259",
      last_as_of: "2026-10-31"
    }
  };

  test("compuesto: lo dice con la frase del KID, sin palabras partidas", () => {
    const s = seccionDelIndice(COMPUESTO);
    expect(s?.titulo).toBe("Frente a su índice");
    expect(s?.procedencia?.[0]?.texto).toBe("Según su KID");
    expect(s?.tabla).toBeUndefined();
    expect(s?.nota).toMatch(
      /^Su KID declara un índice compuesto \(«…temático que está compuesto en un 50 % por el Wilderhill Clean Energy Index \(ECO\).*para comparar la…»\); no medimos contra una sola de sus piezas\./
    );
    expect(s?.nota).not.toContain("encia temático");
    expect(s?.nota).not.toContain("rentab…");
  });

  test("lo retirado consta en modo interno, y delante del cliente queda el motivo", () => {
    const interno = seccionDelIndice(COMPUESTO)?.nota ?? "";
    expect(interno).toContain("publicábamos sus cifras contra MSCI ACWI");
    expect(interno).toContain("un informe anterior puede llevarlas");
    const cliente = seccionDelIndice(COMPUESTO, true)?.nota ?? "";
    expect(cliente).toMatch(/^Su KID declara un índice compuesto/);
    expect(cliente).not.toContain("publicábamos");
  });

  test("sin índice: lo dice, con su frase", () => {
    const s = seccionDelIndice({
      relative_absence: "KID_DECLARES_NO_BENCHMARK",
      relative_absence_evidence: { kid_excerpt: "No se gestiona en relación con un valor de referencia." }
    });
    expect(s?.nota).toBe(
      "Su KID declara que no tiene índice de referencia («No se gestiona en relación con un valor de referencia.»)."
    );
  });

  test("sin frase, el motivo se dice igual", () => {
    expect(seccionDelIndice({ relative_absence: "KID_DECLARES_NO_BENCHMARK" })?.nota).toBe(
      "Su KID declara que no tiene índice de referencia."
    );
  });

  test("con el motivo del KID no sale la sección del proveedor contra su categoría", () => {
    const base = fondo(COMPUESTO);
    const conProveedor = {
      ...base,
      bloques: {
        ...base.bloques,
        "declared/provider_risk": { as_of: "2026-10-31", beta: { "1y": { vs_benchmark: 2.1 } }, provider_alpha: { "1y": { vs_benchmark: -0.5 } } }
      }
    };
    const ids = componerFicha(conProveedor).secciones.map((s) => s.id);
    expect(ids).toContain("contra-indice-propio");
    expect(ids).not.toContain("contra-indice");
  });

  const marcado = (kid_confirmation?: string) => ({
    relative: {
      benchmark: { name: "MSCI EM Latin America 10/40", instrument_id: "IE00B4L5Y983", ...(kid_confirmation ? { kid_confirmation } : {}) },
      beta: { "3y": 1.01 },
      r2: { "3y": 0.95 },
      jensen_alpha: { "3y": -0.01 }
    }
  });

  test.each([
    ["NOT_CONFIRMED", "El KID no confirma el índice que le atribuye el proveedor."],
    ["BRAND_ONLY", "El KID no confirma el índice que le atribuye el proveedor: solo nombra su familia."]
  ])("la marca de la 21 (%s) sale en modo interno, y no delante del cliente", (valor, frase) => {
    expect(seccionDelIndice(marcado(valor))?.nota).toContain(frase);
    expect(seccionDelIndice(marcado(valor), true)?.nota).not.toContain("no confirma");
  });

  test("sin marca no dice nada del KID", () => {
    expect(seccionDelIndice(marcado())?.nota).not.toContain("KID");
  });

  const equivalente = {
    relative: {
      benchmark: { name: "Bloomberg Euro Corp", equivalent_of: "ICE BofA Euro Corporate", instrument_id: "IE00B3T9LM79" },
      beta: { "3y": 1.03 },
      r2: { "3y": 0.94 },
      jensen_alpha: { "3y": 0.007 }
    }
  };

  test.each([false, true])("medido contra un equivalente, lo dice en los dos modos (cliente: %s)", (modoCliente) => {
    const s = seccionDelIndice(equivalente, modoCliente);
    expect(s?.nota).toContain("Declara ICE BofA Euro Corporate, del que no tenemos serie.");
    expect(s?.nota).toContain("Lo medimos contra Bloomberg Euro Corp, un índice equivalente pero no el mismo");
    expect(s?.procedencia?.map((p) => p.texto).join("")).toContain("contra Bloomberg Euro Corp, equivalente al que declara");
  });

  test("en modo interno, la réplica dice de cuál de los dos índices habla", () => {
    expect(seccionDelIndice(equivalente)?.nota).toContain("Tampoco tenemos la serie de Bloomberg Euro Corp: lo replica el activo IE00B3T9LM79.");
    expect(seccionDelIndice(equivalente, true)?.nota).not.toContain("IE00B3T9LM79");
  });

  test("medido contra el que declara, no habla de equivalencias", () => {
    const s = seccionDelIndice(marcado());
    expect(s?.nota).not.toContain("equivalente");
    expect(s?.procedencia?.map((p) => p.texto).join("")).not.toContain("equivalente");
  });
});


describe("un fondo frente al nivel del propio índice (decisiones 23 y 24 del 07-11-2026)", () => {
  const seccionDelIndice = (relative: Record<string, unknown>, modoCliente = false) =>
    componerFicha(instrumento({ volatility: { "1y": 0.12 }, relative }), undefined, { modoCliente }).secciones.find(
      (s) => s.id === "contra-indice-propio"
    );
  const NIVEL = {
    benchmark: {
      name: "S&P 500",
      source_series_id: "EODHD:SP500TR.INDX",
      currency: "EUR",
      variant: "TR",
      return_basis: "TOTAL_RETURN",
      series_class: "INDEX_LEVEL"
    },
    beta: { "3y": 0.93 },
    r2: { "3y": 0.97 },
    jensen_alpha: { "3y": -0.004 },
    tracking_error: { "3y": 0.024 }
  };

  test("dice en los dos modos que se mide contra el propio índice, sin coste de réplica", () => {
    const interno = seccionDelIndice(NIVEL);
    expect(interno?.titulo).toBe("Frente a su índice");
    expect(interno?.procedencia?.map((t) => t.texto).join("")).toContain("contra S&P 500");
    expect(interno?.nota).toMatch(/^Medido contra la serie del propio índice, sin coste de réplica\./);
    expect(interno?.nota).toContain("Fuente EODHD:SP500TR.INDX");
    expect(interno?.nota).toContain("no se compara con el de un fondo medido contra un ETF");
    expect(interno?.nota).not.toContain("lo replica el activo");
    const cliente = seccionDelIndice(NIVEL, true)?.nota ?? "";
    expect(cliente).toMatch(/^Medido contra la serie del propio índice, sin coste de réplica\./);
    expect(cliente).not.toContain("EODHD");
    expect(cliente).not.toContain("ETF");
  });

  test("contra un índice de precio, la tabla no lleva alfa y la nota dice por qué, también delante del cliente", () => {
    const precio = {
      benchmark: {
        name: "EURO STOXX 50",
        source_series_id: "EODHD:SX5E.INDX",
        currency: "EUR",
        variant: "PR",
        return_basis: "PRICE_RETURN",
        series_class: "INDEX_LEVEL"
      },
      beta: { "1y": 1.0, "3y": 0.95 },
      r2: { "1y": 0.98, "3y": 0.97 },
      tracking_error: { "1y": 0.019, "3y": 0.021 }
    };
    for (const modoCliente of [false, true]) {
      const s = seccionDelIndice(precio, modoCliente);
      expect(s?.tabla?.filas.map((f) => f[0])).toEqual(["Beta", "R²", "Tracking error"]);
      expect(s?.nota).toContain("Su índice es de precio: excluye los dividendos");
      expect(s?.nota).toContain("no publicamos alfa ni rentabilidad activa");
      expect(s?.nota).not.toContain("medias mensuales anualizadas");
      /* Sin alfa no hay alfa que comparar con el de un ETF: esa frase sobra, también en modo interno. */
      expect(s?.nota).not.toContain("Su alfa no se compara");
    }
    expect(seccionDelIndice(precio)?.nota).toContain("Fuente EODHD:SX5E.INDX");
  });

  test("contra un fondo índice o un ETF, la nota sigue siendo la de antes", () => {
    const s = seccionDelIndice({
      benchmark: { name: "MSCI World NR", instrument_id: "IE00B03HD191", series_class: "NAV", return_basis: "TOTAL_RETURN" },
      jensen_alpha: { "3y": 0.012 }
    });
    expect(s?.nota).toContain("lo replica el activo IE00B03HD191");
    expect(s?.nota).not.toContain("propio índice");
    expect(s?.nota).not.toContain("índice es de precio");
  });
});


describe("una clase con cobertura de divisa frente a su índice (decisión 30 del 07-11-2026)", () => {
  const fondo = (metricas: Record<string, unknown>) => instrumento({ volatility: { "1y": 0.14 }, ...metricas });
  const seccionDelIndice = (m: Record<string, unknown>, modoCliente = false) =>
    componerFicha(fondo(m), undefined, { modoCliente }).secciones.find((s) => s.id === "contra-indice-propio");
  const CUBIERTA = { relative_absence: "HEDGED_SHARE_CLASS" };

  test("lo dice según su clase, sin tabla y sin frase del KID, en los dos modos", () => {
    for (const modoCliente of [false, true]) {
      const s = seccionDelIndice(CUBIERTA, modoCliente);
      expect(s?.titulo).toBe("Frente a su índice");
      expect(s?.procedencia?.[0]?.texto).toBe("Según su clase");
      expect(s?.procedencia).toHaveLength(1);
      expect(s?.tabla).toBeUndefined();
      expect(s?.nota).toBe(
        "Es una clase con cobertura de divisa y su índice no la lleva: no la medimos contra él, porque la diferencia sería la cobertura y no la gestión."
      );
    }
  });

  test("ocupa el sitio de la sección del proveedor, como los motivos del KID", () => {
    const base = fondo(CUBIERTA);
    const conProveedor = {
      ...base,
      bloques: {
        ...base.bloques,
        "declared/provider_risk": { as_of: "2026-10-31", beta: { "1y": { vs_benchmark: 1.3 } }, provider_alpha: { "1y": { vs_benchmark: -0.2 } } }
      }
    };
    const ids = componerFicha(conProveedor).secciones.map((s) => s.id);
    expect(ids).toContain("contra-indice-propio");
    expect(ids).not.toContain("contra-indice");
  });
});

describe("una referencia que es otra clase del mismo fondo (decisión C-28 del 21-11-2026)", () => {
  const MISMO_FONDO = { relative_absence: "SAME_FUND_REFERENCE" };
  const conProveedor = (m: Record<string, unknown>) => {
    const base = instrumento({ volatility: { "1y": 0.14 }, ...m });
    return {
      ...base,
      bloques: {
        ...base.bloques,
        "declared/provider_risk": { as_of: "2026-10-31", beta: { "1y": { vs_benchmark: 0.97 } }, provider_alpha: { "1y": { vs_benchmark: 0.005 } } }
      }
    };
  };

  test("con cifra del proveedor, su sección se queda y el motivo va en su nota, solo en modo interno", () => {
    const interna = componerFicha(conProveedor(MISMO_FONDO)).secciones;
    expect(interna.map((s) => s.id)).not.toContain("contra-indice-propio");
    const delProveedor = interna.find((s) => s.id === "contra-indice");
    expect(delProveedor?.nota).toContain("otra clase de este mismo fondo");
    expect(delProveedor?.nota).not.toContain("SAME_FUND_REFERENCE");
    const cliente = componerFicha(conProveedor(MISMO_FONDO), undefined, { modoCliente: true }).secciones;
    expect(cliente.map((s) => s.id)).toContain("contra-indice");
    expect(cliente.find((s) => s.id === "contra-indice")?.nota ?? "").not.toContain("mismo fondo");
  });

  test("sin cifra del proveedor, el motivo ocupa la sección en modo interno, con la retirada si consta", () => {
    const retirada = {
      ...MISMO_FONDO,
      relative_withdrawal: { withdrawn_on: "2026-11-21", decision: "C-28", benchmark_name: "MSCI World", last_as_of: "2026-10-31" }
    };
    const s = componerFicha(instrumento({ volatility: { "1y": 0.14 }, ...retirada })).secciones.find((x) => x.id === "contra-indice-propio");
    expect(s?.procedencia?.[0]?.texto).toBe("Sin referencia");
    expect(s?.nota).toContain("otra clase de este mismo fondo");
    expect(s?.nota).toContain("publicábamos sus cifras contra MSCI World");
    expect(s?.nota).not.toContain("SAME_FUND_REFERENCE");
    const cliente = componerFicha(instrumento({ volatility: { "1y": 0.14 }, ...retirada }), undefined, { modoCliente: true }).secciones;
    expect(cliente.map((x) => x.id)).not.toContain("contra-indice-propio");
  });
});
