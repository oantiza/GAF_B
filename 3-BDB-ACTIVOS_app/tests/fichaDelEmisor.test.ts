/**
 * Decisiones 51 y 52: lo que publica el emisor de un ETF se lee junto a lo declarado, sin sustituirlo. El VL del emisor no toca
 * ninguna métrica y la ficha lo dice; la comisión de swap va aparte del coste corriente; y donde no hay prima, se dice por qué.
 */
import { describe, expect, test } from "vitest";
import type { Documento, InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";

const ISIN = "IE00B3YCGJ38";
const DE_INVESCO: Documento = {
  source: "issuer:invesco",
  as_of: "2026-11-08",
  issuer_product_id: "SPXS",
  name: "Invesco S&P 500 UCITS ETF Acc",
  costs: { ongoing_charge: 0.0005, swap_fee: 0.000718 },
  distribution_policy: { value: "ACCUMULATING", text: "Accumulating" },
  replication: { type: "SYNTHETIC", method: "Synthetic" },
  index: { name: "S&P 500® Total Return (Net) Index", ticker: "SPTR500N" },
  size: { fund: { aum: 55740283413.19, currency: "USD", as_of: "2026-11-05" } },
  nav: {
    series_class: "ISSUER_NAV_DERIVED",
    currency: "USD",
    source: "invesco:vl_historico",
    first_date: "2010-05-20",
    last_date: "2026-11-05",
    observations: 4114,
    last_value: 14.7862,
    derived: true,
    anchor: { value: 14.7862, date: "2026-11-05", growth: 88346.5 }
  },
  holdings: { as_of: "2026-11-04", positions_count: 629, top10_weight: 0.424, nature: "SUBSTITUTE_BASKET" }
};
const PRIMA: Documento = {
  status: "PUBLISHED",
  method: "PREMIUM_DISCOUNT_V1",
  window: "1y",
  as_of: "2026-11-03",
  observations: 247,
  mean: 0.000277,
  latest: -0.00066,
  nav_adjustment: "NONE",
  fx_source: "ECB_REFERENCE"
};

function ficha(bloques: InstrumentoDeLaBase["bloques"], tipo = "ETF") {
  return componerFicha({
    isin: ISIN,
    raiz: {
      instrument_type: tipo,
      identity: { name: "Invesco S&P 500 UCITS ETF", currency: "USD" },
      classification: { official_benchmark: { name: "S&P 500 NR USD" } }
    },
    tarjeta: { instrument_id: ISIN },
    calidad: undefined,
    bloques
  } as InstrumentoDeLaBase);
}

const COSTES: Documento = { as_of: "2026-10-31", ongoing_charge: 0.0005, ongoing_charge_source: "KID", document_date: "2026-08-21" };
const seccion = (compuesta: ReturnType<typeof ficha>, id: string) => compuesta.secciones.find((s) => s.id === id);
const filaDe = (compuesta: ReturnType<typeof ficha>, id: string, rotulo: string) =>
  seccion(compuesta, id)?.filas.find((fila) => fila.rotulo === rotulo);

describe("sin bloque del emisor", () => {
  test("no aparece nada de esto", () => {
    const compuesta = ficha({ "declared/costs": COSTES });
    expect(seccion(compuesta, "vl-emisor")).toBeUndefined();
    expect(seccion(compuesta, "datos-emisor")).toBeUndefined();
    expect(filaDe(compuesta, "coste", "Comisión de swap")).toBeUndefined();
  });
});

describe("el valor liquidativo del emisor", () => {
  test("se enseña con su fecha y su divisa, y el deducido dice que lo es", () => {
    const compuesta = ficha({ "declared/issuer_data": DE_INVESCO, "computed/premium_discount": PRIMA });
    const vl = seccion(compuesta, "vl-emisor");
    expect(vl?.procedencia.map((t) => t.texto).join("")).toContain("Deducido de lo que publica Invesco");
    expect(filaDe(compuesta, "vl-emisor", "Valor liquidativo")).toMatchObject({ valor: "14,7862\u00a0USD", destacada: true });
    expect(filaDe(compuesta, "vl-emisor", "Valor liquidativo")?.glosa).toContain("Deducido");
  });

  test("el declarado se llama declarado", () => {
    const datos = { ...DE_INVESCO, source: "issuer:ishares", nav: { ...(DE_INVESCO.nav as Documento), series_class: "ISSUER_NAV", last_value: 140.99 } };
    const compuesta = ficha({ "declared/issuer_data": datos, "computed/premium_discount": PRIMA });
    expect(seccion(compuesta, "vl-emisor")?.procedencia.map((t) => t.texto).join("")).toContain("Declarado por iShares");
    expect(filaDe(compuesta, "vl-emisor", "Valor liquidativo")?.glosa).toBeUndefined();
  });

  test("la nota dice que las métricas van sobre precio y qué significa un día suelto", () => {
    const compuesta = ficha({ "declared/issuer_data": DE_INVESCO, "computed/premium_discount": PRIMA });
    const nota = seccion(compuesta, "vl-emisor")?.nota ?? "";
    expect(nota).toContain("sobre el precio de mercado");
    expect(nota).toContain("horas distintas");
    expect(nota).toContain("BCE");
  });

  test("en una clase de reparto, la nota dice que el VL va ajustado", () => {
    const compuesta = ficha({ "declared/issuer_data": DE_INVESCO, "computed/premium_discount": { ...PRIMA, nav_adjustment: "DISTRIBUTIONS_BACK_ADJUSTED", fx_source: undefined } });
    expect(seccion(compuesta, "vl-emisor")?.nota).toContain("ajustado por sus repartos");
    expect(seccion(compuesta, "vl-emisor")?.nota).not.toContain("BCE");
  });

  test("la prima lleva signo, y la última su fecha", () => {
    const compuesta = ficha({ "declared/issuer_data": DE_INVESCO, "computed/premium_discount": PRIMA });
    expect(filaDe(compuesta, "vl-emisor", "Prima o descuento, media 12 meses")).toMatchObject({ valor: "+0,03\u00a0%", glosa: "247 sesiones." });
    const ultima = filaDe(compuesta, "vl-emisor", "Prima o descuento, última");
    expect(ultima?.valor).toBe("−0,07\u00a0%");
    expect(ultima?.glosa).toContain("/11/2026");
  });

  test.each([
    ["ISSUER_SERIES_IS_CUMULATIVE_RETURN", "rentabilidad acumulada"],
    ["DERIVED_WITHOUT_ANCHOR", "valor declarado del que colgar"],
    ["NO_MARKET_SERIES", "precio de mercado"],
    ["DISTRIBUTIONS_UNAVAILABLE", "faltan los pagos"],
    ["SCALE_MISMATCH", "no cuadran"]
  ])("sin prima (%s) dice por qué", (motivo, frase) => {
    const compuesta = ficha({ "declared/issuer_data": DE_INVESCO, "computed/premium_discount": { status: "NOT_PUBLISHED", absence_reason: motivo } });
    const fila = filaDe(compuesta, "vl-emisor", "Prima o descuento");
    expect(fila).toMatchObject({ valor: "Falta el dato", ausencia: "falta" });
    expect(fila?.glosa).toContain(frase);
  });

  test("la rentabilidad acumulada no se escribe como precio", () => {
    const datos = { ...DE_INVESCO, nav: { series_class: "ISSUER_CUMULATIVE_RETURN", source: "invesco:vl_historico", last_date: "2026-11-05", first_date: "2010-05-20", observations: 4114 } };
    const compuesta = ficha({ "declared/issuer_data": datos, "computed/premium_discount": { status: "NOT_PUBLISHED", absence_reason: "ISSUER_SERIES_IS_CUMULATIVE_RETURN" } });
    expect(filaDe(compuesta, "vl-emisor", "Valor liquidativo")).toMatchObject({ valor: "Falta el dato", ausencia: "falta" });
  });

  test("un fondo sin prima no lleva ni fila ni nota de prima", () => {
    const compuesta = ficha({ "declared/issuer_data": DE_INVESCO }, "FUND");
    expect(filaDe(compuesta, "vl-emisor", "Valor liquidativo")).toBeDefined();
    expect(seccion(compuesta, "vl-emisor")?.filas).toHaveLength(1);
    expect(seccion(compuesta, "vl-emisor")?.nota).toBeUndefined();
  });
});

describe("la comisión de swap", () => {
  test("va en la sección de coste, aparte del coste corriente y sin sumarse", () => {
    const compuesta = ficha({ "declared/issuer_data": DE_INVESCO, "declared/costs": COSTES });
    const fila = filaDe(compuesta, "coste", "Comisión de swap");
    expect(fila?.valor).toBe("0,0718\u00a0%");
    expect(fila?.glosa).toContain("Invesco");
    expect(fila?.glosa).toContain("aparte del coste corriente");
    expect(filaDe(compuesta, "coste", "Coste corriente")?.valor).toBe("0,05\u00a0%");
  });

  test("cero es un dato, y no sale con cuatro decimales", () => {
    const datos = { ...DE_INVESCO, costs: { ongoing_charge: 0.003, swap_fee: 0 } };
    expect(filaDe(ficha({ "declared/issuer_data": datos, "declared/costs": COSTES }), "coste", "Comisión de swap")?.valor).toBe("0,00\u00a0%");
  });

  test("sin sección de coste no se pierde: va en la tabla del emisor", () => {
    const tabla = seccion(ficha({ "declared/issuer_data": DE_INVESCO }), "datos-emisor")?.tabla;
    expect(tabla?.filas.find((f) => f[0] === "Comisión de swap")?.[1]).toBe("0,0718\u00a0%");
  });
});

/** Los casos de la decisión 55, con las cifras de la base local a 08-11-2026. */
describe("las posiciones del emisor y las del proveedor (decisión 55)", () => {
  const emisor = (fuente: string, holdings: Documento): Documento => ({ source: `issuer:${fuente}`, as_of: "2026-11-08", holdings });
  const delProveedor = (titulos: number, as_of: string): Documento => ({ source: "canonical:fondosdb", as_of, positions_count: titulos, securities_count: titulos, top: [] });
  const tablaDe = (datos: Documento, cartera?: Documento) => {
    const c = ficha({ "declared/issuer_data": datos, ...(cartera ? { "declared/holdings": cartera } : {}) });
    return seccion(c, "datos-emisor")?.tabla?.filas ?? [];
  };
  const filaDeTabla = (filas: ReturnType<typeof tablaDe>, dato: string) => filas.find((f) => f[0] === dato);
  const LINEAS = "Líneas de la cartera, con liquidez y derivados";
  const TITULOS = "Títulos en cartera";

  test("IE00B4L5Y983, iShares Core MSCI World: 1.247 títulos en las dos fuentes, y coincide con las dos fechas", () => {
    const filas = tablaDe(emisor("ishares", { as_of: "2026-11-05", positions_count: 1280, declared_positions_count: 1247 }), delProveedor(1247, "2026-10-29"));
    expect(filaDeTabla(filas, TITULOS)?.[1]).toMatch(/^1\.247 · 05\/11\/2026/);
    expect(filaDeTabla(filas, TITULOS)?.[2]).toMatch(/^Coincide, proveedor, 29\/10\/2026/);
  });

  test("IE00B0M62Q58, iShares MSCI World Dist: 1.248 frente a 1.247, las dos cifras sin veredicto", () => {
    const filas = tablaDe(emisor("ishares", { as_of: "2026-11-05", positions_count: 1281, declared_positions_count: 1248 }), delProveedor(1247, "2026-10-29"));
    const fila = filaDeTabla(filas, TITULOS);
    expect(fila?.[1]).toMatch(/^1\.248 · 05\/11\/2026/);
    expect(fila?.[2]).toMatch(/^1\.247, proveedor, 29\/10\/2026/);
    expect(JSON.stringify(filas)).not.toMatch(/difiere|Coincide/i);
  });

  test("IE00B3XXRP09, Vanguard S&P 500: sus 513 son líneas, y los títulos del proveedor van aparte y sin enfrentarse", () => {
    const filas = tablaDe(emisor("vanguard", { as_of: "2026-09-30", positions_count: 513, declared_positions_count: 513 }), delProveedor(504, "2026-09-30"));
    expect(filaDeTabla(filas, LINEAS)?.slice(1)).toEqual([expect.stringMatching(/^513 · 30\/09\/2026/), { texto: "No se compara", ausencia: "no-aplica" }]);
    expect(filaDeTabla(filas, TITULOS)?.slice(1)).toEqual([{ texto: "No lo declara", ausencia: "no-aplica" }, expect.stringMatching(/^504, proveedor, 30\/09\/2026/)]);
    expect(JSON.stringify(filas)).not.toMatch(/difiere|Coincide/i);
  });

  test("LU0908500753, Amundi: 613 son sus 612 líneas más la de efectivo, y no es un recuento de títulos", () => {
    const filas = tablaDe(emisor("amundi", { as_of: "2026-11-04", positions_count: 612, declared_positions_count: 613 }), delProveedor(610, "2026-11-02"));
    expect(filaDeTabla(filas, LINEAS)?.[1]).toMatch(/^612 · 04\/11\/2026/);
    expect(filaDeTabla(filas, TITULOS)?.[2]).toMatch(/^610, proveedor, 02\/11\/2026/);
  });

  test("US78462F1030, SPDR S&P 500 Trust: sin recuento y sin cartera del proveedor, solo las líneas", () => {
    const filas = tablaDe(emisor("spdr", { as_of: "2026-11-05", positions_count: 505 }));
    expect(filas).toEqual([[LINEAS, expect.stringMatching(/^505 · 05\/11\/2026/), "Solo lo da el emisor"]]);
  });

  test("IE00B3YCGJ38, Invesco: solo la cesta de 629, con su nota, y no se mira el swap del proveedor aunque lo haya", () => {
    const conSwap = ficha({ "declared/issuer_data": DE_INVESCO, "declared/holdings": delProveedor(1, "2026-09-30") });
    const tabla = seccion(conSwap, "datos-emisor")?.tabla;
    expect(tabla?.filas.find((f) => f[0] === "Posiciones de la cesta")).toEqual(["Posiciones de la cesta", expect.stringMatching(/^629 · 04\/11\/2026/), "Solo lo da el emisor"]);
    expect(tabla?.filas.some((f) => f[0] === TITULOS || f[0] === "Contraparte del swap")).toBe(false);
    expect(seccion(conSwap, "datos-emisor")?.nota).toContain("cesta de sustitución");
    expect(seccion(conSwap, "datos-emisor")?.nota).not.toContain("El proveedor cuenta como títulos");
  });

  test("LU1900068161, Amundi sintético: lo que declara no cambia que sea una cesta", () => {
    const filas = tablaDe(emisor("amundi", { as_of: "2026-11-04", positions_count: 40, declared_positions_count: 41, nature: "SUBSTITUTE_BASKET" }));
    expect(filaDeTabla(filas, "Posiciones de la cesta")?.[1]).toMatch(/^40 · 04\/11\/2026/);
    expect(filaDeTabla(filas, TITULOS)).toBeUndefined();
  });

  test("LU0290358497, Xtrackers: la contraparte del swap se dice si está", () => {
    const filas = tablaDe(emisor("xtrackers", { as_of: "2026-11-05", positions_count: 862, nature: "SUBSTITUTE_BASKET", counterparties: [{ name: "Deutsche Bank AG", gross_exposure: 1.000006 }] }));
    expect(filaDeTabla(filas, "Contraparte del swap")).toEqual(["Contraparte del swap", "Deutsche Bank AG", "Solo lo da el emisor"]);
  });

  test("la nota define los títulos del proveedor solo si la tabla los enseña", () => {
    const con = ficha({ "declared/issuer_data": emisor("spdr", { as_of: "2026-11-05", positions_count: 2953 }), "declared/holdings": delProveedor(2992, "2026-09-30") });
    expect(seccion(con, "datos-emisor")?.nota).toContain("El proveedor cuenta como títulos las acciones y los bonos, sin liquidez ni derivados.");
    const sin = ficha({ "declared/issuer_data": emisor("spdr", { as_of: "2026-11-05", positions_count: 505 }) });
    expect(seccion(sin, "datos-emisor")?.nota).not.toContain("títulos");
  });
});

describe("la política de reparto cuando el proveedor no la sabe (decisión 55)", () => {
  const perfil = (politica: string): Documento => ({ as_of: "2026-10-31", distribution_policy: politica });
  const pagos: Documento = { as_of: "2026-10-31", payments: [], yield_12m: 0 };

  test("IE00B4L5Y983: enseña la del emisor con su etiqueta de fuente, en las dos secciones", () => {
    const datos = { ...DE_INVESCO, source: "issuer:ishares" };
    const c = ficha({ "declared/issuer_data": datos, "declared/profile": perfil("UNKNOWN"), "declared/distributions": pagos });
    for (const [id, rotulo] of [["perfil", "Política de reparto"], ["rentas", "Política declarada"]] as const) {
      const fila = filaDe(c, id, rotulo);
      expect(fila).toMatchObject({ valor: "Acumulación" });
      expect(fila?.ausencia).toBeUndefined();
      expect(fila?.glosa).toContain("Del emisor (iShares)");
      expect(fila?.glosa).toContain("El proveedor no la declara");
    }
  });

  test("si el proveedor la declara, manda la suya y la del emisor no aparece en esa fila", () => {
    const c = ficha({ "declared/issuer_data": DE_INVESCO, "declared/profile": perfil("DISTRIBUTING") });
    const fila = filaDe(c, "perfil", "Política de reparto");
    expect(fila?.valor).toBe("Reparto");
    expect(fila?.glosa ?? "").not.toContain("Del emisor");
  });

  test("sin declarar por nadie, sigue faltando el dato", () => {
    const c = ficha({ "declared/issuer_data": { ...DE_INVESCO, distribution_policy: undefined }, "declared/profile": perfil("UNKNOWN") });
    expect(filaDe(c, "perfil", "Política de reparto")).toMatchObject({ valor: "Falta el dato", ausencia: "falta" });
  });

  test("un instrumento sin bloque del emisor sigue igual", () => {
    expect(filaDe(ficha({ "declared/profile": perfil("UNKNOWN") }), "perfil", "Política de reparto")).toMatchObject({ valor: "Falta el dato", ausencia: "falta" });
  });

  test("la columna de la otra fuente dice que el proveedor no la declara", () => {
    const c = ficha({ "declared/issuer_data": DE_INVESCO, "declared/profile": perfil("UNKNOWN") });
    const fila = seccion(c, "datos-emisor")?.tabla?.filas.find((f) => f[0] === "Reparto");
    expect(fila?.[2]).toEqual({ texto: "Sin declarar por el proveedor", ausencia: "falta" });
  });
});

describe("lo que dice el emisor junto a lo declarado", () => {
  const compuesta = (costes: Documento = COSTES, perfil: Documento = { distribution_policy: "UNKNOWN" }) =>
    ficha({
      "declared/issuer_data": DE_INVESCO,
      "declared/costs": costes,
      "declared/profile": perfil,
      "declared/size": { as_of: "2026-10-29", aum: 38050800000, currency: "EUR" }
    });
  const filaDeLaTabla = (c: ReturnType<typeof ficha>, dato: string) => seccion(c, "datos-emisor")?.tabla?.filas.find((f) => f[0] === dato);

  test("lo que coincide lo dice, y lo que difiere enseña las dos cifras con su fuente", () => {
    expect(filaDeLaTabla(compuesta(), "Coste corriente")).toEqual(["Coste corriente", "0,05\u00a0%", "Coincide"]);
    const difiere = compuesta({ ...COSTES, ongoing_charge: 0.0007 });
    expect(filaDeLaTabla(difiere, "Coste corriente")?.[2]).toMatch(/^0,07\u00a0%, KID de /);
  });

  test("el coste del proveedor dice que es del proveedor, con su fecha", () => {
    const c = compuesta({ as_of: "2026-10-31", ongoing_charge: 0.0007, ongoing_charge_source: "PROVIDER" });
    expect(filaDeLaTabla(c, "Coste corriente")?.[2]).toMatch(/^0,07\u00a0%, proveedor, /);
  });

  test("una política sin declarar en la ficha no se da por buena", () => {
    expect(filaDeLaTabla(compuesta(), "Reparto")?.[1]).toBe("Acumula");
    expect(filaDeLaTabla(compuesta(), "Reparto")?.[2]).toEqual({ texto: "Sin declarar por el proveedor", ausencia: "falta" });
  });

  test("el índice se compara sin distinguir mayúsculas, y si difiere se ven los dos", () => {
    expect(filaDeLaTabla(compuesta(), "Índice de referencia")?.[2]).toBe("S&P 500 NR USD, proveedor");
  });

  test("el patrimonio enseña clase y fondo y nunca dice que coincide", () => {
    const fila = filaDeLaTabla(compuesta(), "Patrimonio");
    expect(fila?.[1]).toContain("55.740,3\u00a0M\u00a0USD el fondo");
    expect(fila?.[2]).toContain("proveedor");
  });

  test("las posiciones de un sintético se llaman cesta, y la nota lo explica", () => {
    expect(filaDeLaTabla(compuesta(), "Posiciones de la cesta")?.[1]).toContain("629");
    expect(seccion(compuesta(), "datos-emisor")?.nota).toContain("cesta de sustitución");
  });

  test("la nota dice que no sustituye a nada", () => {
    expect(seccion(compuesta(), "datos-emisor")?.nota).toContain("No sustituye");
  });

  test("no se llama TER en pantalla", () => {
    const texto = JSON.stringify(seccion(compuesta(), "datos-emisor"));
    expect(texto).not.toContain("TER");
    expect(texto).toContain("Coste corriente");
  });
});
