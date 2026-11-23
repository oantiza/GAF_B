import { describe, expect, test } from "vitest";
import { columnasDeActivos, filasDeActivos, type FuenteDeColumna } from "../src/adapters/comparativaDeActivos";
import { componerFicha } from "../src/adapters/componerFicha";
import { componerFila } from "../src/adapters/componerLista";
import { rentabilidadesDelResumen } from "../src/components/ficha/mapaDeLaFicha";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import type { BdbAssetSearchResult } from "../src/types/bdbAssets";

/**
 * De dónde sale cada cifra de la ficha y cómo se dice lo que no está.
 *
 * Una magnitud, una fuente (decisión 12 de Óscar): donde hay cifra nuestra no sale la del proveedor.
 * Y el vocabulario de las ausencias (hallazgos 10, 15, 74 y 126): un valor crudo como UNKNOWN parece un
 * fallo, y un 0,00 % sin comprobar afirma algo que no sabemos.
 */

function instrumento(partes: Partial<InstrumentoDeLaBase> = {}, tipo = "FUND"): InstrumentoDeLaBase {
  return {
    isin: "IE00B4L5Y983",
    raiz: { instrument_type: tipo, identity: { name: "Un producto", currency: "USD" }, identifiers: { ticker: "IWDA" } },
    tarjeta: { instrument_id: "IE00B4L5Y983" },
    calidad: undefined,
    bloques: {},
    ...partes
  };
}

const seccion = (ficha: ReturnType<typeof componerFicha>, id: string) => ficha.secciones.find((s) => s.id === id);
const textoDe = (trozos: Array<{ texto: string }> | undefined) => trozos?.map((trozo) => trozo.texto).join("");

describe("el coste dice de dónde sale, cifra a cifra (decisión 43)", () => {
  const procedencia = (costes: Record<string, unknown>) =>
    textoDe(seccion(componerFicha(instrumento({ bloques: { "declared/costs": { source: "x", as_of: "2026-10-31", ...costes } } })), "coste")?.procedencia);

  test("del KID, con la fecha del documento y no la de la ficha", () => {
    expect(procedencia({ ongoing_charge: .0208, ongoing_charge_source: "KID", transaction_costs: .0037, transaction_costs_source: "KID", entry_charge: .045, entry_charge_source: "KID", document_date: "2026-08-19" }))
      .toBe("Del KID · 19/08/2026");
  });
  test("sin fecha legible lo dice, y no se le pone otra", () => {
    expect(procedencia({ ongoing_charge: .0208, ongoing_charge_source: "KID" })).toBe("Del KID, sin fecha");
  });
  test("sin ninguna del KID, del proveedor, con la fecha de su ficha: antes decía «Del KID» igualmente", () => {
    expect(procedencia({ ongoing_charge: .002, ongoing_charge_source: "PROVIDER", transaction_costs: .0000263, transaction_costs_source: "PROVIDER" }))
      .toBe("Del proveedor · 31/10/2026");
  });
  test("mezcla: nombra la que no sale de él (PIMCO, la entrada)", () => {
    expect(procedencia({ ongoing_charge: .0139, ongoing_charge_source: "KID", transaction_costs: .0021, transaction_costs_source: "KID", entry_charge: .05, entry_charge_source: "PROVIDER", document_date: "2026-04-29" }))
      .toBe("Del KID · 29/04/2026 · la entrada, del proveedor");
  });
});

describe("el indicador regulatorio lleva la fecha de su KID, no la de la ficha (decisiones 43 y 92)", () => {
  const procedencia = (regulatorio: Record<string, unknown>) =>
    textoDe(seccion(componerFicha(instrumento({ bloques: { "declared/regulatory": { source: "canonical:fondosdb", as_of: "2026-10-31", ...regulatorio } } })), "regulatorio")?.procedencia);
  const KID_DE_2024 = { document_url: "https://x", sha256: "6".repeat(64), document_date: "2024-02-02", isin_evidence: "NONE" };

  test("GESCONSULT: el SRI sale de un KID del 2 feb 2024, y el SRRI es del proveedor. Antes, «KID de PRIIPs y UCITS · 31 oct 2026»", () => {
    expect(procedencia({ sri: 2, srri: 3, kid_evidence: KID_DE_2024 })).toBe("Del KID · 02/02/2024 · el SRRI, del proveedor");
  });
  test("solo el SRI, con su KID", () => {
    expect(procedencia({ sri: 4, kid_evidence: { ...KID_DE_2024, document_date: "2026-02-16" } })).toBe("Del KID · 16/02/2026");
  });
  test("un ETF sin KID: solo el SRRI del proveedor, con la fecha de su ficha, sin nombrar un KID que no hay", () => {
    expect(procedencia({ srri: 6 })).toBe("Del proveedor · 31/10/2026");
  });
});

const filaDe = (ficha: ReturnType<typeof componerFicha>, id: string, rotulo: string) =>
  seccion(ficha, id)?.filas.find((f) => f.rotulo === rotulo);

describe("las tres comisiones sin cifra dicen que falta (decisión 74)", () => {
  const NO_APLICA = ["performance_fee", "entry_charge", "exit_charge"].map((campo) => ({ path: `declared/costs.${campo}`, reason: "NOT_APPLICABLE" }));
  const fichaDe = (costes: Record<string, unknown>, opciones: { isin?: string; tipo?: string; modoCliente?: boolean; ausencias?: unknown[] } = {}) =>
    componerFicha(
      {
        ...instrumento({ calidad: { absences: opciones.ausencias ?? NO_APLICA, present_paths: 3, applicable_paths: 6 }, bloques: { "declared/costs": { source: "x", as_of: "2026-10-31", ...costes } } }, opciones.tipo ?? "FUND"),
        ...(opciones.isin ? { isin: opciones.isin } : {})
      },
      undefined,
      { modoCliente: opciones.modoCliente ?? false }
    );
  const NOTA_DE_EXITO = "La de éxito, si la cobra, consta en su KID.";

  test.each(["Comisión de éxito", "Comisión de entrada (suscripción)", "Comisión de salida (reembolso)"])("%s: la razón del contrato no se lee como «No aplica»", (rotulo) => {
    expect(filaDe(fichaDe({}), "coste", rotulo)).toMatchObject({ valor: "Falta el dato", ausencia: "falta" });
  });

  test("con cifra sale la cifra, también un cero: Eleva, 3 % de entrada y 0 de salida del proveedor", () => {
    const ficha = fichaDe({ entry_charge: 0.03, entry_charge_source: "KID", exit_charge: 0 }, { ausencias: [NO_APLICA[0]] });
    expect(filaDe(ficha, "coste", "Comisión de entrada (suscripción)")?.valor).toBe("3,00\u00a0%");
    expect(filaDe(ficha, "coste", "Comisión de salida (reembolso)")?.valor).toBe("0,00\u00a0%");
    expect(filaDe(ficha, "coste", "Comisión de éxito")?.valor).toBe("Falta el dato");
  });

  test("la cifra de éxito, cuando llegue, sale y ya no hace falta la nota", () => {
    const ficha = fichaDe({ performance_fee: 0.2 }, { ausencias: [] });
    expect(filaDe(ficha, "coste", "Comisión de éxito")?.valor).toBe("20,00\u00a0%");
    expect(seccion(ficha, "coste")?.nota).not.toContain(NOTA_DE_EXITO);
  });

  test("sin cifra de éxito lo dice la nota, también en Modo cliente", () => {
    expect(seccion(fichaDe({}), "coste")?.nota).toBe(
      `La comisión de entrada es un máximo, no lo que se paga siempre. La de gestión y la de salida son del proveedor. ${NOTA_DE_EXITO}`
    );
    expect(seccion(fichaDe({}, { modoCliente: true }), "coste")?.nota).toContain(NOTA_DE_EXITO);
  });

  test("un ETF de Estados Unidos no tiene KID: dice que falta y no manda a un documento que no hay", () => {
    const ficha = fichaDe({}, { isin: "US46090E1038", tipo: "ETF" });
    expect(filaDe(ficha, "coste", "Comisión de éxito")?.valor).toBe("Falta el dato");
    expect(seccion(ficha, "coste")?.nota).not.toContain("KID");
  });

  test("no se repite: «No consta comisión de salida» no añade nada a «Falta el dato»", () => {
    expect(filaDe(fichaDe({}), "coste", "Comisión de salida (reembolso)")?.glosa).toBeUndefined();
  });

  test("una razón del contrato en otra ruta sigue mandando: la excepción es solo de estas tres", () => {
    const ficha = fichaDe({}, { ausencias: [...NO_APLICA, { path: "declared/costs.management_fee", reason: "NOT_APPLICABLE" }] });
    expect(filaDe(ficha, "coste", "Comisión de gestión")).toMatchObject({ valor: "No aplica", ausencia: "no-aplica" });
  });

  test("y una razón que no sea «no aplica» no se toca", () => {
    const ficha = fichaDe({}, { ausencias: [{ path: "declared/costs.performance_fee", reason: "NOT_YET_FETCHED" }] });
    expect(filaDe(ficha, "coste", "Comisión de éxito")).toMatchObject({ valor: "Pendiente de incorporar", ausencia: "sin-pedir" });
  });

  test("la cuenta de la calidad dice lo mismo que las filas: esas tres ya no cuentan como «No aplican»", () => {
    const ficha = fichaDe({}, { ausencias: [...NO_APLICA, { path: "declared/size.aum", reason: "NOT_APPLICABLE" }] });
    expect(filaDe(ficha, "calidad", "No aplican")?.valor).toBe("1");
    expect(filaDe(ficha, "calidad", "No facilitados por el proveedor")?.valor).toBe("3");
  });

  test("una acción no tiene la sección", () => {
    expect(seccion(componerFicha(instrumento({ bloques: {} }, "STOCK")), "coste")).toBeUndefined();
  });
});

describe("el sector de una acción, como en el Buscador (decisión 82)", () => {
  const accion = (equity: Record<string, unknown>, modoCliente = false) =>
    componerFicha(
      instrumento(
        {
          tarjeta: {
            instrument_id: "ES0178430E18",
            classification: { sector: equity["sector"] },
            quality: { fitness: { COMPARAR_CON_SU_GRUPO: { apt: true } } }
          },
          bloques: { "declared/equity": { source: "x", as_of: "2026-11-03", ...equity } }
        },
        "STOCK"
      ),
      undefined,
      { modoCliente }
    );
  const pares = (ficha: ReturnType<typeof componerFicha>) => ficha.aptitudes.find((a) => a.rotulo === "Compararlo con sus pares")?.valor;

  test.each([false, true])("Telefónica dice Comunicación las dos veces (Modo cliente: %s)", (modoCliente) => {
    const ficha = accion({ sector: "Communication Services", industry: "Telecom Services" }, modoCliente);
    expect(filaDe(ficha, "equity", "Sector")?.valor).toBe("Comunicación");
    expect(pares(ficha)).toBe("Comunicación");
    expect(JSON.stringify(ficha)).not.toContain("Communication Services");
  });

  test("la Industria se queda en inglés, y lo dice", () => {
    expect(filaDe(accion({ sector: "Healthcare", industry: "Drug Manufacturers - General" }), "equity", "Industria")).toMatchObject({
      valor: "Drug Manufacturers - General",
      glosa: "Texto del proveedor, en inglés."
    });
  });

  test("un sector fuera de la tabla no se inventa: sale tal cual", () => {
    const ficha = accion({ sector: "Space Mining" });
    expect(filaDe(ficha, "equity", "Sector")?.valor).toBe("Space Mining");
    expect(pares(ficha)).toBe("Space Mining");
  });

  test("sin Industria dice que falta, y sin decir que está en inglés", () => {
    const fila = filaDe(accion({ sector: "Energy" }), "equity", "Industria");
    expect(fila).toMatchObject({ valor: "Falta el dato", ausencia: "falta" });
    expect(fila?.glosa).toBeUndefined();
  });

  test("un fondo sigue con su categoría", () => {
    const ficha = componerFicha(instrumento({ tarjeta: { instrument_id: "X", classification: { category: "RV Global" }, quality: { fitness: { COMPARAR_CON_SU_GRUPO: { apt: true } } } } }));
    expect(pares(ficha)).toBe("RV Global");
  });
});

const RENDIMIENTOS_DEL_PROVEEDOR = {
  as_of: "2026-09-30",
  trailing_return: {
    "1y": { fund: 0.1525, category: 0.1211 },
    "3y": { fund: 0.2143 },
    "5y": { fund: 0.1195 },
    "10y": { fund: 0.1288, category: 0.1234 }
  },
  ytd_return: { fund: 0.1175 }
};
const RIESGO_DEL_PROVEEDOR = {
  as_of: "2026-10-31",
  volatility: { "1y": { fund: 0.1219 }, "3y": { fund: 0.1181 } },
  sharpe: { "1y": { fund: 0.55 }, "3y": { fund: 1.14 } }
};
const NUESTRAS = {
  method: "EXTRACTOR_MONTHLY_V2",
  as_of: "2026-10-31",
  annualized_return: { "1y": 0.1596, "3y": 0.2023, "5y": 0.1137, "10y": 0.1279 },
  volatility: { "1y": 0.1113, "3y": 0.1192 },
  sharpe: { "1y": 1.2, "3y": 1.39 },
  ytd_return: 0.1602
};

describe("la cotización que no es la principal lo dice junto a la fuente del precio (decisión 46)", () => {
  const conListado = (listing: Record<string, unknown>, moneda: string, modoCliente = false) =>
    componerFicha(
      instrumento(
        {
          raiz: { instrument_type: "STOCK", identity: { name: "X", currency: moneda } },
          bloques: {
            "declared/quote": { as_of: "2026-11-06", price: 33.23, price_class: "MARKET_PRICE", currency: moneda },
            "declared/equity": { as_of: "2026-11-06", listing }
          }
        },
        "STOCK"
      ),
      undefined,
      { modoCliente }
    );

  test.each([false, true])("mercado de origen, con la bolsa y la divisa que se usan (Modo cliente: %s)", (modoCliente) => {
    const nota = seccion(conListado({ exchange: "XETRA", non_primary_reason: "HOME_MARKET_NOT_AVAILABLE" }, "EUR", modoCliente), "precio")?.nota;
    expect(nota).toContain("Cotización de Xetra en EUR: el mercado de origen no está disponible en la fuente.");
  });

  test.each([false, true])("divisa de origen (Modo cliente: %s)", (modoCliente) => {
    const nota = seccion(conListado({ exchange: "LSE", non_primary_reason: "HOME_CURRENCY_NOT_AVAILABLE" }, "USD", modoCliente), "precio")?.nota;
    expect(nota).toContain("Cotización de Londres en USD: la línea en la divisa de origen no está disponible.");
  });

  test("no afirma nada de la bolsa de origen ni de las métricas", () => {
    const nota = seccion(conListado({ exchange: "XETRA", non_primary_reason: "HOME_MARKET_NOT_AVAILABLE" }, "EUR"), "precio")?.nota ?? "";
    expect(nota).not.toMatch(/Mil[aá]n|Italia/);
    expect(nota).not.toMatch(/métrica|volatilidad|rentabilidad/i);
  });

  test("sin motivo, o con uno que no conoce, no dice nada", () => {
    for (const listing of [{ exchange: "XETRA" }, { exchange: "XETRA", non_primary_reason: "OTRO" }]) {
      expect(seccion(conListado(listing, "EUR"), "precio")?.nota).not.toContain("Cotización de");
    }
  });

  test("una bolsa que entró el 08-11 se nombra", () => {
    expect(seccion(conListado({ exchange: "BR", non_primary_reason: "HOME_MARKET_NOT_AVAILABLE" }, "EUR"), "precio")?.nota).toContain("Cotización de Bruselas en EUR");
  });
});

describe("el precio dice su divisa si se sabe", () => {
  const COTIZACION = { source: "x", as_of: "2026-11-03", price: 129.07, price_class: "MARKET_PRICE" };
  const ultimo = (bloque: Record<string, unknown>, tipo = "ETF") =>
    componerFicha(instrumento({ bloques: { "declared/quote": bloque } }, tipo));

  test("la de la cotización, no la de la clase: un ETF en dólares con el precio en euros", () => {
    const ficha = ultimo({ ...COTIZACION, currency: "EUR" });
    expect(filaDe(ficha, "precio", "Último")?.valor).toBe("129,07\u00a0€");
    expect(seccion(ficha, "precio")?.nota).not.toContain("no dice en qué divisa");
  });

  test("sin ella, un ETF no se inventa una: es lo que hay en la nube hasta que se suba el catálogo", () => {
    const ficha = ultimo(COTIZACION);
    expect(filaDe(ficha, "precio", "Último")?.valor).toBe("129,07");
    expect(seccion(ficha, "precio")?.nota).toContain("no dice en qué divisa");
  });

  test("un fondo sigue con la de su clase si el bloque no la trae, y con la del bloque si la trae", () => {
    const vl = { source: "x", as_of: "2026-10-30", price: 18.33, price_class: "NAV" };
    expect(filaDe(ultimo(vl, "FUND"), "precio", "Valor liquidativo")?.valor).toBe("18,33\u00a0USD");
    expect(filaDe(ultimo({ ...vl, currency: "EUR" }, "FUND"), "precio", "Valor liquidativo")?.valor).toBe("18,33\u00a0€");
  });
});

describe("la cartera de la ficha", () => {
  const cartera = (bloque: Record<string, unknown>) => {
    const ficha = componerFicha(instrumento({ bloques: { "declared/holdings": { source: "x", as_of: "2026-09-30", ...bloque } } }));
    const procedencia = seccion(ficha, "cartera")?.procedencia.map((t) => t.texto).join("") ?? "";
    return { procedencia, nota: seccion(ficha, "cartera")?.nota };
  };

  test("«diez mayores» si cuadra con las filas: un ETF con sus diez líneas", () => {
    const { procedencia } = cartera({ positions_count: 1247, top10_weight: 0.2778, top: [{ name: "NVIDIA", weight: 0.1578 }, { name: "Apple", weight: 0.12 }] });
    expect(procedencia).toContain("diez mayores 27,8\u00a0%");
  });

  test("si no cuadra no se dice, y las líneas siguen; la cuenta sale de `securities_count`, no de `positions_count` (Óscar, 20-11-2026)", () => {
    const { procedencia } = cartera({ positions_count: 2376, securities_count: 2376, top10_weight: 0.2371, top: [{ name: "EUROPEAN MONETARY UNION EURO Purchased", weight: 0.3036, holding_type_code: "CU" }] });
    expect(procedencia).toBe("Declarada por el proveedor · 30/09/2026 · 2.376 posiciones");
    expect(procedencia).not.toContain("diez mayores");
    expect(tablaDe([{ name: "EUROPEAN MONETARY UNION EURO Purchased", weight: 0.3036, holding_type_code: "CU" }])?.filas).toHaveLength(1);
  });

  test("los pesos se rotulan brutos cuando el código dice que hay derivados, y sin código no se afirma", () => {
    const conPatas = cartera({ positions_count: 2, top: [{ name: "Forward", weight: 0.3, holding_type_code: "CU", sector: "x" }] });
    expect(conPatas.nota).toBe("Pesos brutos, incluye derivados: son importes nominales, no inversión directa.");
    const sinCodigo = cartera({ positions_count: 2, top: [{ name: "Forward", weight: 0.3, sector: "x" }] });
    expect(sinCodigo.nota).toBeUndefined();
    const soloSinSector = cartera({ positions_count: 2, top: [{ name: "Forward", weight: 0.3, holding_type_code: "CU" }] });
    expect(soloSinSector.nota).toBe("Pesos brutos, incluye derivados: son importes nominales, no inversión directa. El proveedor no declara el sector de sus posiciones.");
  });

  const tablaDe = (top: Array<Record<string, unknown>>) =>
    seccion(componerFicha(instrumento({ bloques: { "declared/holdings": { source: "x", as_of: "2026-09-30", positions_count: 240, top } } })), "cartera")?.tabla;

  test("las líneas de divisa se llaman por su tipo; pesos y orden, los del proveedor (decisión 93)", () => {
    const tabla = tablaDe([
      { name: "EUR/SEK_260904 Purchased", weight: 0.0352, holding_type_code: "CU" },
      { name: "Cash and cash Equilavents", weight: 0.0146, holding_type_code: "C" },
      { name: "Ferrari N V", weight: 0.0125, holding_type_code: "E" },
      { name: "EUR/SEK_261106 Purchased", weight: 0.0109, holding_type_code: "CU" },
      { name: "LCH PAY 204530903_204530902", weight: 0.0099, holding_type_code: "SR" },
      { name: "BOUGHT EUR/SOLD USD Purchased", weight: 0.0098 }
    ]);
    expect(tabla?.filas).toEqual([
      /* Un peso, con un decimal (apartado 6): 3,52 → 3,5; 1,25 → 1,3, medio hacia fuera; 0,99 y 0,98 → 1,0. */
      ["Contrato de divisa EUR/SEK", "3,5\u00a0%"],
      ["Cash and cash Equilavents", "1,5\u00a0%"],
      ["Ferrari N V", "1,3\u00a0%"],
      ["Contrato de divisa EUR/SEK", "1,1\u00a0%"],
      ["LCH PAY 204530903_204530902", "1,0\u00a0%"],
      ["BOUGHT EUR/SOLD USD Purchased", "1,0\u00a0%"]
    ]);
  });

  test("con columna de sector, lo que se llama por su tipo no aplica; lo demás sin sector, falta", () => {
    const tabla = tablaDe([
      { name: "Eur_Es0821008990951300063302", weight: 0.1222, holding_type_code: "C" },
      { name: "CIE Automotive SA", weight: 0.0505, holding_type_code: "E", sector: "consumer_cyclical" },
      { name: "Una acción sin sector", weight: 0.03, holding_type_code: "E" }
    ]);
    expect(tabla?.columnas).toEqual(["Posición", "Sector", "Peso"]);
    expect(tabla?.filas).toEqual([
      ["Efectivo EUR", { texto: "No aplica", ausencia: "no-aplica" }, "12,2\u00a0%"],
      ["CIE Automotive SA", "Consumo cíclico", "5,1\u00a0%"],
      ["Una acción sin sector", { texto: "Falta", ausencia: "falta" }, "3,0\u00a0%"]
    ]);
  });
});

describe("una magnitud, una fuente", () => {
  test("donde hay cifra nuestra no sale la del proveedor", () => {
    const ficha = componerFicha(
      instrumento({
        bloques: {
          "computed/metrics": NUESTRAS,
          "declared/provider_returns": RENDIMIENTOS_DEL_PROVEEDOR,
          "declared/provider_risk": RIESGO_DEL_PROVEEDOR
        }
      })
    );
    expect(seccion(ficha, "rentabilidad")).toBeUndefined();
    expect(seccion(ficha, "riesgo")).toBeUndefined();
    expect(seccion(ficha, "metricas")?.tabla?.filas.map((f) => f[0])).toContain("Sharpe");
  });

  test("«En el año» no se pierde: pasa a ser el nuestro, en su columna de la tabla", () => {
    const ficha = componerFicha(
      instrumento({ bloques: { "computed/metrics": NUESTRAS, "declared/provider_returns": RENDIMIENTOS_DEL_PROVEEDOR } })
    );
    const tabla = seccion(ficha, "metricas")?.tabla;
    /* Como fila suelta sobre la tabla no alineaba con ninguna cifra. */
    expect(filaDe(ficha, "metricas", "En el año")).toBeUndefined();
    expect(tabla?.columnas[1]).toBe("YTD");
    const fila = tabla?.filas.find((f) => /^Rentabilidad/.test(String(f[0])));
    expect(fila?.[1]).toContain("16,02");
    expect(tabla?.cifras?.[0]).toBe(1);
    /* Cada fila tiene tantas celdas como columnas: una de menos descolocaría todas las cifras. */
    for (const f of tabla?.filas ?? []) expect(f).toHaveLength(tabla?.columnas.length ?? 0);
    expect(seccion(ficha, "metricas")?.nota).toContain("no está anualizada");
  });

  /* El 17-11-2026 el adaptador pasó a llamar «YTD» a la columna del año y el Resumen la seguía buscando por «En el
     año»: la perdió sin que fallara nada, porque su prueba montaba la tabla a mano. Esta pasa por el adaptador. */
  test("el Resumen de la ficha compuesta encuentra la columna del año, con la cifra de la tabla de nuestras métricas", () => {
    const ficha = componerFicha(
      instrumento({ bloques: { "computed/metrics": NUESTRAS, "declared/provider_returns": RENDIMIENTOS_DEL_PROVEEDOR } })
    );
    const resumen = rentabilidadesDelResumen(ficha);
    expect(resumen?.columnas).toEqual(["YTD", "1 año", "3 años", "5 años", "10 años"]);
    /* A mano, de NUESTRAS: ytd_return 0,1602 → +16,02 %; annualized_return 0,1596, 0,2023, 0,1137 y 0,1279. Las del
       proveedor (+11,75 % en el año, +15,25 % a un año…) no salen: donde hay cifra nuestra, manda la nuestra. */
    expect(resumen?.celdas).toEqual(["+16,02 %", "+15,96 %", "+20,23 %", "+11,37 %", "+12,79 %"]);
    const tabla = seccion(ficha, "metricas")?.tabla;
    const delAnio = tabla?.columnas.indexOf("YTD") ?? -1;
    expect(delAnio).toBeGreaterThan(0);
    expect(resumen?.celdas[0]).toBe(tabla?.filas.find((f) => /^Rentabilidad/.test(String(f[0])))?.[delAnio]);
  });

  test("lo de su categoría ya no sale: en 730 de 739 fichas era la cifra de su índice (decisión 114)", () => {
    const conNuestras = componerFicha(
      instrumento({ bloques: { "computed/metrics": NUESTRAS, "declared/provider_returns": RENDIMIENTOS_DEL_PROVEEDOR } })
    );
    const soloSuyas = componerFicha(instrumento({ bloques: { "declared/provider_returns": RENDIMIENTOS_DEL_PROVEEDOR } }));
    for (const ficha of [conNuestras, soloSuyas]) {
      const notas = ficha.secciones.map((s) => s.nota ?? "").join(" ");
      expect(notas).not.toContain("categoría hizo");
      expect(notas).not.toContain("12,11");
      expect(notas).not.toContain("12,34");
    }
    /* Ninguna cifra del fondo se pierde: las suyas, en su sección; la nuestra de «En el año», en su tabla. */
    expect(seccion(soloSuyas, "rentabilidad")?.filas.map((f) => [f.rotulo, f.valor])).toEqual([
      ["1 año", "+15,25\u00a0%"],
      ["3 años", "+21,43\u00a0%"],
      ["5 años", "+11,95\u00a0%"],
      ["10 años", "+12,88\u00a0%"],
      ["En el año", "+11,75\u00a0%"]
    ]);
    expect(seccion(conNuestras, "metricas")?.tabla?.filas.find((f) => /^Rentabilidad/.test(String(f[0])))?.[1]).toBe("+16,02\u00a0%");
  });

  test("donde no hay la nuestra, sale la del proveedor: con su fecha en 3, 5 y 10 años, y sin fecha en 1 año y «En el año» (decisión 114)", () => {
    const ficha = componerFicha(
      instrumento({
        bloques: {
          "declared/provider_returns": RENDIMIENTOS_DEL_PROVEEDOR,
          "declared/provider_risk": RIESGO_DEL_PROVEEDOR
        }
      })
    );
    expect(seccion(ficha, "rentabilidad")?.filas.map((f) => f.rotulo)).toEqual(["1 año", "3 años", "5 años", "10 años", "En el año"]);
    /* La clase de este instrumento va en dólares, y se dice (decisión 113). */
    expect(textoDe(seccion(ficha, "rentabilidad")?.procedencia)).toBe("Cifras del proveedor, en USD · 3, 5 y 10 años a 30/09/2026");
    /* El riesgo sí es de la fecha de su bloque, también a 1 año: su volatilidad a 1 año casa con su serie a esa fecha. */
    expect(textoDe(seccion(ficha, "riesgo")?.procedencia)).toBe("Cifras del proveedor, en USD · 31/10/2026");
    expect(seccion(ficha, "riesgo")?.filas.map((f) => f.rotulo)).toEqual([
      "Volatilidad 1 año",
      "Volatilidad 3 años",
      "Sharpe 1 año",
      "Sharpe 3 años"
    ]);
  });

  describe("la fecha del proveedor, solo en las ventanas que la llevan (decisión 114)", () => {
    const rentabilidad = (retornos: Record<string, unknown>, metricas?: Record<string, unknown>) =>
      seccion(
        componerFicha(
          instrumento({
            raiz: { instrument_type: "FUND", identity: { name: "Un fondo", currency: "EUR" } },
            bloques: {
              ...(metricas ? { "computed/metrics": metricas } : {}),
              "declared/provider_returns": { as_of: "2026-09-30", ...retornos }
            }
          })
        ),
        "rentabilidad"
      );

    test("sin 1 año ni «En el año» suyos, como siempre", () => {
      /* Allianz AT2: su 1 año y su «En el año» son nuestros; del proveedor, sus 3, 5 y 10 años. */
      const allianz = rentabilidad(
        { trailing_return: { "1y": { fund: 0.02 }, "3y": { fund: 0.02978901 }, "5y": { fund: 0.02179793 }, "10y": { fund: 0.00954905 } }, ytd_return: { fund: 0.017 } },
        { method: "EXTRACTOR_MONTHLY_V2", as_of: "2026-10-31", annualized_return: { "1y": 0.02 }, ytd_return: 0.016987 }
      );
      expect(allianz?.filas.map((f) => f.rotulo)).toEqual(["3 años", "5 años", "10 años"]);
      expect(textoDe(allianz?.procedencia)).toBe("Cifras del proveedor · 30/09/2026");
    });

    test("con su 1 año, la fecha nombra las ventanas que la llevan; y ninguna cifra se pierde", () => {
      /* Hamco Global Value: nuestro «En el año»; del proveedor, 1, 3 y 5 años. */
      const hamco = rentabilidad(
        { trailing_return: { "1y": { fund: 0.146205 }, "3y": { fund: 0.09670632 }, "5y": { fund: 0.13526445 } }, ytd_return: { fund: 0.1 } },
        { method: "EXTRACTOR_MONTHLY_V2", as_of: "2026-10-31", ytd_return: 0.105115 }
      );
      expect(hamco?.filas.map((f) => [f.rotulo, f.valor])).toEqual([["1 año", "+14,62\u00a0%"], ["3 años", "+9,67\u00a0%"], ["5 años", "+13,53\u00a0%"]]);
      expect(textoDe(hamco?.procedencia)).toBe("Cifras del proveedor · 3 y 5 años a 30/09/2026");
    });

    test("solo con 1 año o «En el año», sin fecha; y una fila que dice que falta no cuenta", () => {
      const soloElAnio = rentabilidad({ trailing_return: {}, ytd_return: { fund: 0.0144085 } });
      expect(soloElAnio?.filas.find((f) => f.rotulo === "3 años")?.ausencia).toBe("falta");
      expect(soloElAnio?.filas.find((f) => f.rotulo === "En el año")?.valor).toBe("+1,44\u00a0%");
      expect(textoDe(soloElAnio?.procedencia)).toBe("Cifras del proveedor, sin fecha");
      expect(soloElAnio?.procedencia.map((t) => t.texto).join("")).not.toMatch(/\d{4}/);
    });
  });

  test("se decide ventana a ventana: lo que solo tiene el proveedor se queda", () => {
    const ficha = componerFicha(
      instrumento({
        bloques: {
          "computed/metrics": { ...NUESTRAS, sharpe: { "1y": 1.2 } },
          "declared/provider_risk": RIESGO_DEL_PROVEEDOR
        }
      })
    );
    expect(seccion(ficha, "riesgo")?.filas.map((f) => f.rotulo)).toEqual(["Sharpe 3 años"]);
  });

  test("con la nuestra delante, una ventana que tampoco da el proveedor no deja un «falta» suelto", () => {
    const ficha = componerFicha(
      instrumento({
        bloques: {
          "computed/metrics": { ...NUESTRAS, annualized_return: { "1y": 0.1 } },
          "declared/provider_returns": { as_of: "2026-09-30", trailing_return: { "1y": { fund: 0.2 } } }
        }
      })
    );
    expect(seccion(ficha, "rentabilidad")).toBeUndefined();
  });

  test("la caída máxima del proveedor no sale nunca: no la da en ningún instrumento", () => {
    const ficha = componerFicha(instrumento({ bloques: { "declared/provider_risk": RIESGO_DEL_PROVEEDOR } }));
    expect(seccion(ficha, "riesgo")?.filas.map((f) => f.rotulo)).not.toContain("Caída máxima 3 años");
  });

  test("la marca «Para revisar» sigue avisando si se separan", () => {
    const ficha = componerFicha(
      instrumento({
        tarjeta: { instrument_id: "X", metrics: { control: { mismatch: ["sharpe.1y"] } } },
        bloques: { "computed/metrics": NUESTRAS, "declared/provider_risk": RIESGO_DEL_PROVEEDOR }
      })
    );
    expect(seccion(ficha, "metricas")?.nota).toContain("Para revisar: Sharpe a 1 año");
  });
});

describe("una celda sin cifra dice por qué", () => {
  const tablaDe = (metricas: Record<string, unknown>) =>
    seccion(componerFicha(instrumento({ bloques: { "computed/metrics": { method: "EXTRACTOR_MONTHLY_V2", ...metricas } } })), "metricas");

  test("el Sharpe a 10 años no es falta de historia: la serie llega y lo que falta es el €STR", () => {
    const s = tablaDe({ annualized_return: { "3y": 0.1, "10y": 0.12 }, sharpe: { "3y": 1 } });
    const sharpe = s?.tabla?.filas.find((f) => f[0] === "Sharpe");
    expect(s?.tabla?.columnas).toEqual(["", "3 años", "10 años"]);
    expect(sharpe?.[2]).toEqual({ texto: "No calculado", ausencia: "no-aplica" });
    expect(s?.nota).toContain("€STR empieza en octubre de 2019");
    expect(s?.nota).not.toContain("Sin historia");
    expect(s?.nota).not.toContain("No calculado:");
  });

  test("si tampoco hay rentabilidad en esa ventana, es que la serie no llega", () => {
    const s = tablaDe({ annualized_return: { "1y": 0.12 }, volatility: { "1y": 0.1, "5y": 0.2 }, sharpe: { "1y": 1 } });
    const sharpe = s?.tabla?.filas.find((f) => f[0] === "Sharpe");
    expect(sharpe?.[2]).toEqual({ texto: "Sin historia", ausencia: "no-aplica" });
    expect(s?.nota).toContain("Sin historia: la serie de este activo no llega a esa ventana.");
  });

  test("nunca una raya, que se lee como un cero", () => {
    const s = tablaDe({ annualized_return: { "10y": 0.12 }, sharpe: { "3y": 1 } });
    expect(JSON.stringify(s?.tabla?.filas)).not.toContain("—");
  });
});

describe("el vocabulario de lo que no está", () => {
  const conPolitica = (politica: string, distribuciones: Record<string, unknown>) =>
    componerFicha(
      instrumento({
        bloques: {
          "declared/profile": { as_of: "2026-10-31", distribution_policy: politica },
          "declared/distributions": { as_of: "2026-10-31", ...distribuciones }
        }
      })
    );

  test("UNKNOWN en Perfil y en Rentas es «Falta el dato», y no se deduce del nombre", () => {
    const ficha = conPolitica("UNKNOWN", { records_checked: false, yield_12m: 0 });
    for (const [id, rotulo] of [["perfil", "Política de reparto"], ["rentas", "Política declarada"]]) {
      expect(filaDe(ficha, id, rotulo)).toMatchObject({ valor: "Falta el dato", ausencia: "falta" });
    }
    expect(JSON.stringify(ficha)).not.toContain("UNKNOWN");
  });

  test("un 0,00 % con los pagos sin comprobar no es un cero", () => {
    const ficha = conPolitica("UNKNOWN", { records_checked: false, yield_12m: 0 });
    expect(filaDe(ficha, "rentas", "Rentabilidad por reparto, 12 meses")).toMatchObject({ valor: "Sin comprobar", ausencia: "falta" });
    expect(filaDe(ficha, "rentas", "Último pago")).toMatchObject({ valor: "Sin pagos registrados", ausencia: "falta" });
  });

  test("política sin confirmar, pagos comprobados y ninguno: «Sin pagos registrados»", () => {
    const ficha = conPolitica("UNKNOWN", { records_checked: true, yield_12m: 0 });
    expect(filaDe(ficha, "rentas", "Rentabilidad por reparto, 12 meses")).toMatchObject({ valor: "Sin pagos registrados", ausencia: "falta" });
  });

  test("el cero de una clase que acumula sí es un cero, y no tiene último pago que faltar", () => {
    const ficha = conPolitica("ACCUMULATING", { records_checked: true, yield_12m: 0 });
    expect(filaDe(ficha, "rentas", "Rentabilidad por reparto, 12 meses")?.valor).toBe("0,00\u00a0%");
    expect(filaDe(ficha, "rentas", "Último pago")).toMatchObject({ valor: "No aplica", ausencia: "no-aplica" });
  });

  describe("una clase que acumula porque lo dice su KID, y a la que el proveedor le lista pagos (decisión 78)", () => {
    const delKid = (distribuciones: Record<string, unknown>, opciones?: { modoCliente?: boolean }) =>
      componerFicha(
        instrumento({
          bloques: {
            "declared/profile": { as_of: "2026-10-31", distribution_policy: "ACCUMULATING", distribution_policy_resolution: "OFFICIAL_KID" },
            "declared/distributions": { as_of: "2026-10-31", ...distribuciones }
          }
        }),
        undefined,
        opciones
      );
    const PAGO = { date: "2026-10-01", amount_per_share: 0.0627 };

    test("BNY H Acc: «Acumulación» no va con un rendimiento ni con un último pago, y al asesor se le dice por qué", () => {
      const ficha = delKid({ yield_12m: 0.049654, payments: [PAGO] });
      const rentas = ficha.secciones.find((seccion) => seccion.id === "rentas");
      expect(filaDe(ficha, "rentas", "Política declarada")?.valor).toBe("Acumulación");
      expect(filaDe(ficha, "rentas", "Rentabilidad por reparto, 12 meses")).toMatchObject({ valor: "No aplica", ausencia: "no-aplica" });
      expect(filaDe(ficha, "rentas", "Último pago")).toMatchObject({ valor: "No aplica", ausencia: "no-aplica" });
      expect(rentas?.contradiccion).toBe("Su KID dice que esta clase reinvierte, y manda el KID. El proveedor le registra pagos, el último de 01/10/2026.");
      expect(JSON.stringify(ficha)).not.toContain("4,97");
    });

    test("sin dato de rendimiento tampoco falta nada: a quien acumula no le aplica", () => {
      const ficha = delKid({ payments: [PAGO] });
      expect(filaDe(ficha, "rentas", "Rentabilidad por reparto, 12 meses")).toMatchObject({ valor: "No aplica", ausencia: "no-aplica" });
    });

    test("en Modo cliente no se cuenta lo del proveedor: es cocina", () => {
      const ficha = delKid({ yield_12m: 0.049654, payments: [PAGO] }, { modoCliente: true });
      expect(filaDe(ficha, "rentas", "Último pago")?.valor).toBe("No aplica");
      expect(ficha.secciones.find((seccion) => seccion.id === "rentas")?.contradiccion).toBeUndefined();
    });

    test("con rendimiento cero el cero se queda, y sin pagos listados no hay nada que aclarar", () => {
      const conPago = delKid({ yield_12m: 0, payments: [PAGO] });
      expect(filaDe(conPago, "rentas", "Rentabilidad por reparto, 12 meses")?.valor).toBe("0,00\u00a0%");
      expect(filaDe(conPago, "rentas", "Último pago")?.valor).toBe("No aplica");
      const sinPago = delKid({ yield_12m: 0, payments: [] });
      expect(sinPago.secciones.find((seccion) => seccion.id === "rentas")?.contradiccion).toBeUndefined();
    });

    test("quien acumula por otra evidencia y tiene un pago registrado lo sigue enseñando: solo el KID lo desmiente", () => {
      const ficha = componerFicha(
        instrumento({
          bloques: {
            "declared/profile": { as_of: "2026-10-31", distribution_policy: "ACCUMULATING", distribution_policy_resolution: "OFFICIAL_REGISTER" },
            "declared/distributions": { as_of: "2026-10-31", yield_12m: 0, payments: [PAGO] }
          }
        })
      );
      expect(filaDe(ficha, "rentas", "Último pago")?.valor).toBe("01/10/2026");
    });

    test("y quien reparte según sus registros sigue diciendo lo que decía", () => {
      const ficha = componerFicha(
        instrumento({
          bloques: {
            "declared/profile": { as_of: "2026-10-31", distribution_policy: "DISTRIBUTING", distribution_policy_resolution: "PROVIDER_DISTRIBUTION_RECORDS" },
            "declared/distributions": { as_of: "2026-10-31", yield_12m: 0.0277, payments: [PAGO] }
          }
        })
      );
      expect(filaDe(ficha, "rentas", "Política declarada")?.valor).toBe("Reparto");
      expect(filaDe(ficha, "rentas", "Rentabilidad por reparto, 12 meses")?.valor).toBe("2,77\u00a0%");
      expect(filaDe(ficha, "rentas", "Último pago")?.valor).toBe("01/10/2026");
    });

    test("FMT-13: el bloque «Rentas» no dice «rendimiento» en ninguna fila", () => {
      const ficha = componerFicha(
        instrumento({
          bloques: {
            "declared/profile": { as_of: "2026-10-31", distribution_policy: "DISTRIBUTING", distribution_policy_resolution: "PROVIDER_DISTRIBUTION_RECORDS" },
            "declared/distributions": { as_of: "2026-10-31", yield_12m: 0.0277, payments: [PAGO] }
          }
        })
      );
      const rentas = ficha.secciones.find((seccion) => seccion.id === "rentas");
      expect(rentas?.filas.map((fila) => fila.rotulo)).toContain("Rentabilidad por reparto, 12 meses");
      expect(JSON.stringify(rentas)).not.toMatch(/rendimiento/i);
    });
  });

  test("la tira no dice que falta la rentabilidad cuando lo que falta es saber si reparte", () => {
    const ficha = componerFicha(
      instrumento({
        tarjeta: {
          instrument_id: "X",
          metrics: { annualized_return: { "1y": 0.1596 } },
          quality: {
            fitness: { COMPARAR_RENTABILIDAD: { apt: false, missing: ["declared/profile.distribution_policy (es UNKNOWN)"] } }
          }
        },
        bloques: { "declared/profile": { distribution_policy: "UNKNOWN" } }
      })
    );
    expect(ficha.aptitudes.find((a) => a.rotulo === "Comparar su rentabilidad")).toEqual({
      rotulo: "Comparar su rentabilidad",
      valor: "+15,96\u00a0% a 1 año · reparto sin confirmar",
      estado: "reserva"
    });
  });

  test("lo que falta de un fundamental se pinta como lo que falta, no como una cifra", () => {
    const ficha = componerFicha(instrumento(), { source: "yahoo", currency: "EUR", valuation: { market_cap: 1_772_700_000 } });
    expect(filaDe(ficha, "valoracion", "PEG")).toMatchObject({ valor: "Falta el dato", ausencia: "falta" });
    expect(seccion(ficha, "valoracion")?.procedencia.map((t) => t.texto).join("")).toBe("Datos del emisor · Yahoo Finance · sin fecha");
  });

  test("los fundamentales dicen de cuándo son", () => {
    const ficha = componerFicha(instrumento(), { source: "yahoo", as_of_date: "2026-03-31", valuation: { market_cap: 1 } });
    expect(seccion(ficha, "valoracion")?.procedencia.map((t) => t.texto).join("")).toBe("Datos del emisor · Yahoo Finance · a 31/03/2026");
  });

  test("un ETF enseña un solo Patrimonio: el declarado por el proveedor, si lo hay", () => {
    const sinProveedor = componerFicha(instrumento(), { source: "yahoo", as_of_date: "2026-07-11", fund_metrics: { total_assets: 101_700_000_000 } });
    expect(filaDe(sinProveedor, "etf", "Patrimonio")).toBeDefined();
    const conProveedor = componerFicha(instrumento({ bloques: { "declared/size": { aum: 131_370_700_000, currency: "EUR", as_of: "2026-10-30" } } }), {
      source: "yahoo",
      as_of_date: "2026-07-11",
      fund_metrics: { total_assets: 101_700_000_000, yield_pct: 1 }
    });
    expect(filaDe(conProveedor, "etf", "Patrimonio")).toBeUndefined();
    expect(filaDe(conProveedor, "patrimonio", "Patrimonio")).toBeDefined();
  });

  test("una cartera sin sectores no pinta la columna vacía: lo dice una vez", () => {
    const sinSector = componerFicha(
      instrumento({ bloques: { "declared/holdings": { top: [{ name: "NVIDIA", weight: 0.0579 }] } } })
    );
    expect(seccion(sinSector, "cartera")?.tabla?.columnas).toEqual(["Posición", "Peso"]);
    expect(seccion(sinSector, "cartera")?.nota).toBe("El proveedor no declara el sector de sus posiciones.");

    const conAlguno = componerFicha(
      instrumento({
        bloques: {
          "declared/holdings": {
            top: [
              { name: "NVIDIA", sector: "technology", weight: 0.0579 },
              { name: "Otra", weight: 0.01 }
            ]
          }
        }
      })
    );
    expect(seccion(conAlguno, "cartera")?.tabla?.columnas).toEqual(["Posición", "Sector", "Peso"]);
    expect(seccion(conAlguno, "cartera")?.tabla?.filas[1][1]).toEqual({ texto: "Falta", ausencia: "falta" });
  });
});

describe("una acción", () => {
  const accion = (exchange: string, country?: string) =>
    componerFicha(
      instrumento(
        { bloques: { "declared/equity": { as_of: "2026-11-03", listing: { exchange, country } } } },
        "STOCK"
      )
    );

  test.each([
    ["MC", "Madrid"],
    ["MCE", "Madrid"],
    ["US", "Estados Unidos"],
    ["PA", "París"],
    ["XETRA", "Xetra"],
    ["LSE", "Londres"],
    ["AS", "Ámsterdam"],
    ["SW", "Suiza"],
    ["F", "Fráncfort"],
    ["TO", "Toronto"],
    ["HE", "Helsinki"]
  ])("la bolsa %s se llama %s", (codigo, nombre) => {
    expect(filaDe(accion(codigo), "equity", "Bolsa")?.valor).toBe(nombre);
  });

  test("un código que no conocemos se enseña crudo, sin adivinarle el nombre", () => {
    expect(filaDe(accion("ZZ"), "equity", "Bolsa")?.valor).toBe("ZZ");
  });

  test("el país es el del listado, que es lo decidido", () => {
    const ficha = accion("F", "DE");
    expect(filaDe(ficha, "equity", "País del listado")?.valor).toBe("Alemania");
    expect(filaDe(ficha, "equity", "País")).toBeUndefined();
  });

  test("no enseña ni Sharpe ni Sortino, aunque estén guardados", () => {
    const ficha = componerFicha(
      instrumento(
        { bloques: { "computed/metrics": { method: "EXTRACTOR_DAILY_V2", volatility: { "1y": 0.3 }, sharpe: { "1y": 1 }, sortino: { "1y": 1 } } } },
        "STOCK"
      )
    );
    expect(seccion(ficha, "metricas")?.tabla?.filas.map((f) => f[0])).toEqual(["Volatilidad"]);
  });
});

describe("la divisa", () => {
  const conPrecio = (tipo: string, moneda: string, clase: string) =>
    componerFicha(
      instrumento(
        {
          raiz: { instrument_type: tipo, identity: { name: "X", currency: moneda }, identifiers: { ticker: "IWDA" } },
          bloques: { "declared/quote": { as_of: "2026-11-03", price: 129.07, price_class: clase } }
        },
        tipo
      )
    );

  test("el precio de un ETF no lleva divisa: su clase no dice en cuál cotiza, y la fuente tampoco", () => {
    const ficha = conPrecio("ETF", "USD", "MARKET_PRICE");
    expect(filaDe(ficha, "precio", "Último")?.valor).toBe("129,07");
    expect(seccion(ficha, "precio")?.nota).toContain("no dice en qué divisa está");
  });

  test("el valor liquidativo de un fondo sí: va en la de su clase", () => {
    expect(filaDe(conPrecio("FUND", "USD", "NAV"), "precio", "Valor liquidativo")?.valor).toBe("129,07\u00a0USD");
  });

  test("y el precio de una acción, en la de su bolsa", () => {
    const ficha = conPrecio("STOCK", "EUR", "MARKET_PRICE");
    expect(filaDe(ficha, "precio", "Último")?.valor).toBe("129,07\u00a0€");
    expect(seccion(ficha, "precio")?.nota).not.toContain("divisa");
  });

  test("la cabecera dice que es la de la clase", () => {
    expect(conPrecio("ETF", "USD", "MARKET_PRICE").identificacion).toBe("IE00B4L5Y983 · IWDA · Clase en USD");
    expect(conPrecio("STOCK", "EUR", "MARKET_PRICE").identificacion).toBe("IE00B4L5Y983 · IWDA · EUR");
  });

  test("y es la de la clase aunque cotice en otra: iShares Core MSCI World es una clase en USD con su precio en euros (decisión 113)", () => {
    const ficha = componerFicha(
      instrumento(
        {
          raiz: { instrument_type: "ETF", identity: { name: "X", currency: "USD" }, identifiers: { ticker: "IWDA" } },
          bloques: { "declared/quote": { as_of: "2026-11-03", price: 129.07, price_class: "MARKET_PRICE", currency: "EUR" } }
        },
        "ETF"
      )
    );
    expect(ficha.identificacion).toBe("IE00B4L5Y983 · IWDA · Clase en USD");
    expect(filaDe(ficha, "precio", "Último")?.valor).toBe("129,07\u00a0€");
  });

  describe("las cifras del proveedor van en la divisa de la clase, y la gráfica de debajo, en euros: se dice (decisión 113)", () => {
    const RENDIMIENTOS = { as_of: "2026-10-31", trailing_return: { "1y": { fund: -0.0220448, category: -0.0416031 }, "3y": { fund: 0.24974619 }, "10y": { category: 0.0941742 } } };
    const RIESGO = { as_of: "2026-10-31", volatility: { "3y": { fund: 0.1966739 } }, sharpe: { "3y": { fund: 0.84683 } } };
    const conDivisa = (moneda: string, tarjeta: Record<string, unknown> = {}) =>
      componerFicha(
        instrumento({
          raiz: { instrument_type: "OTHER", identity: { name: "Oro", currency: moneda } },
          tarjeta: { instrument_id: "IE00B4ND3602", quality: { fitness: { COMPARAR_RENTABILIDAD: { apt: true } } }, ...tarjeta },
          bloques: { "declared/provider_returns": RENDIMIENTOS, "declared/provider_risk": RIESGO }
        })
      );
    const tira = (ficha: ReturnType<typeof componerFicha>) => ficha.aptitudes.find((a) => a.rotulo === "Comparar su rentabilidad")?.valor;

    /* Con cifra a 1 año y a 3 años, la fecha solo acompaña a los 3 años (decisión 114). */
    test("en otra divisa, rentabilidad y riesgo lo dicen junto a la fecha", () => {
      const ficha = conDivisa("USD");
      expect(textoDe(seccion(ficha, "rentabilidad")?.procedencia)).toBe("Cifras del proveedor, en USD · 3 años a 31/10/2026");
      expect(textoDe(seccion(ficha, "riesgo")?.procedencia)).toBe("Cifras del proveedor, en USD · 31/10/2026");
      expect(filaDe(ficha, "rentabilidad", "3 años")?.valor).toBe("+24,97\u00a0%");
      expect(filaDe(ficha, "rentabilidad", "1 año")?.valor).toBe("−2,20\u00a0%");
    });

    test("en euros no se dice nada", () => {
      const ficha = conDivisa("EUR");
      expect(textoDe(seccion(ficha, "rentabilidad")?.procedencia)).toBe("Cifras del proveedor · 3 años a 31/10/2026");
      expect(textoDe(seccion(ficha, "riesgo")?.procedencia)).toBe("Cifras del proveedor · 31/10/2026");
    });

    test("la tira, si la cifra es del proveedor; si es nuestra va en euros y no lo dice", () => {
      const proveedor = { metrics: { source: "PROVIDER", annualized_return: { "1y": -0.0220448 } } };
      expect(tira(conDivisa("USD", proveedor))).toBe("−2,20\u00a0% a 1 año, en USD");
      expect(tira(conDivisa("EUR", proveedor))).toBe("−2,20\u00a0% a 1 año");
      expect(tira(conDivisa("USD", { metrics: { source: "COMPUTED", annualized_return: { "1y": 0.01 } } }))).toBe("+1,00\u00a0% a 1 año");
    });

    /* Lo de su categoría ya no sale (decisión 114): era la cifra de su índice. «Contra su índice» sí dice que es el índice. */
    test("contra su índice también, en una clase con cifras nuestras", () => {
      const ficha = componerFicha(
        instrumento({
          bloques: {
            "computed/metrics": { method: "EXTRACTOR_MONTHLY_V2", as_of: "2026-10-31", annualized_return: { "1y": 0.1 } },
            "declared/provider_returns": RENDIMIENTOS,
            "declared/provider_risk": { as_of: "2026-10-31", beta: { "1y": { vs_benchmark: 1.1 } } }
          }
        })
      );
      expect(seccion(ficha, "metricas")?.nota ?? "").not.toContain("categoría");
      expect(textoDe(seccion(ficha, "contra-indice")?.procedencia)).toBe("Contra el índice de categoría del proveedor, en USD · 31/10/2026");
    });
  });
});

describe("con Modo cliente, lo que nos falta a nosotros no se cuenta", () => {
  test("sin métricas nuestras por un motivo de cocina, «Falta el dato» y nada más", () => {
    const sinMetricas = instrumento({
      raiz: { instrument_type: "FUND", identity: { name: "X", currency: "EUR" }, metrics_absence: { code: "NEEDS_FX", reason: "NOT_PROVIDED" } }
    });
    const asesor = seccion(componerFicha(sinMetricas), "metricas");
    expect(asesor?.procedencia[0].texto).toBe("Falta llevar su serie a euros");
    const cliente = seccion(componerFicha(sinMetricas, undefined, { modoCliente: true }), "metricas");
    expect(cliente?.procedencia[0].texto).toBe("Falta el dato");
    expect(cliente?.nota).toBeUndefined();
  });

  test("si el motivo explica el producto, se queda", () => {
    const reparte = instrumento({
      raiz: { instrument_type: "FUND", identity: { name: "X", currency: "EUR" }, metrics_absence: { code: "DISTRIBUTES", reason: "NOT_APPLICABLE" } }
    });
    const cliente = seccion(componerFicha(reparte, undefined, { modoCliente: true }), "metricas");
    expect(cliente?.procedencia[0].texto).toBe("No las calculamos para esta clase");
  });

  test("sin el nombre del proveedor de los fundamentales, y sin «Procedencia y calidad»", () => {
    const ficha = componerFicha(instrumento(), { source: "yahoo", valuation: {} }, { modoCliente: true });
    expect(seccion(ficha, "valoracion")?.procedencia.map((t) => t.texto).join("")).toBe("Datos del emisor · sin fecha");
    expect(seccion(ficha, "calidad")).toBeUndefined();
  });
});

describe("la fila de la comparativa", () => {
  const activo = (category?: string) =>
    ({ asset_id: "AU000000CBA7", display_name: "Commonwealth", category, metrics: {} }) as unknown as BdbAssetSearchResult;
  const categoria = (fuente: FuenteDeColumna) => {
    const [columna] = columnasDeActivos([fuente]);
    return filasDeActivos([fuente], { modoCliente: false }).find((f) => f.id === "categoria")?.celda(columna).texto;
  };

  test("una acción enseña su sector, como el Buscador", () => {
    expect(categoria({ activo: activo(), tarjeta: { classification: { sector: "Financial Services" } } })).toBe(
      componerFila({ classification: { sector: "Financial Services" } }).clasificacion
    );
  });

  test("«accion», que es como lo guarda la base anterior, se escribe bien: «Acciones», como manda la decisión 83", () => {
    expect(categoria({ activo: activo("accion") })).toBe("Acciones");
  });

  test("la divisa dice que es la de la clase, y una columna del proveedor se marca", () => {
    const fuente: FuenteDeColumna = {
      activo: activo(),
      tarjeta: { identity: { currency: "USD" }, metrics: { method: "TRAILING_PROVIDER" } }
    };
    const [columna] = columnasDeActivos([fuente]);
    expect(filasDeActivos([fuente], { modoCliente: false }).find((f) => f.id === "divisa")?.titulo).toBe("Divisa de la clase");
    expect(columna.apunte).toContain("proveedor");
    expect(columna.enlaceAFicha).toBe("AU000000CBA7");
  });
});
