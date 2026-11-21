import { describe, expect, test } from "vitest";
import {
  assessFundEquivalence, creditBand, exposureDistance, familyKey, findEquivalentCandidates, inferShareClassTraits
} from "../src/core/fundEquivalence";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

function fund(id: string, overrides: Partial<BdbAssetDetail> = {}): BdbAssetDetail {
  return {
    asset_id: id, display_name: id, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR",
    coverage_status: "COMPLETE", is_investable: true, role: "INVESTABLE", quality_flags: [], warnings: [], metrics: {},
    description: "", category: "EAA Fund Global Large-Cap Blend Equity", region: "Global",
    pms_exposure: { equity: 0.98, fixed_income: 0, cash: 0.02, alternative: 0, other: 0 },
    exposure_detail: {
      sectors: { technology: 0.3, healthcare: 0.2, financial_services: 0.2, industrials: 0.3 },
      equity_regions: { united_states: 0.6, europe: 0.3, japan: 0.1 },
      market_caps: { large: 0.9, mid: 0.1 },
      equity_styles: { growth: 0.5, blend: 0.4, value: 0.1 }
    },
    ...overrides
  } as BdbAssetDetail;
}

describe("rasgos de clase inferidos del nombre", () => {
  test("acumulación, reparto y cobertura salen del nombre y se marcan como inferidos", () => {
    expect(inferShareClassTraits("Fidelity Funds World A Acc EUR Hedged")).toEqual({ distribution: "ACC", hedged: true, inferred: true });
    // Sin señal de cobertura en el nombre: el dato interno es desconocido (al comparar cuenta como «sin cobertura»).
    expect(inferShareClassTraits("DPAM B - Bonds Eur Government B Cap")).toMatchObject({ distribution: "ACC", hedged: null });
    expect(inferShareClassTraits("Schroder ISF Euro Credit C Dis")).toMatchObject({ distribution: "DIST" });
    expect(inferShareClassTraits("Amundi Euro Bond I Inc")).toMatchObject({ distribution: "DIST" });
  });
  test("«Small Cap» es tamaño y «Equity Income» es estrategia: no son clases", () => {
    expect(inferShareClassTraits("Global Small Cap Equity I").distribution).toBeNull();
    expect(inferShareClassTraits("Global Equity Income A").distribution).toBeNull();
    expect(inferShareClassTraits(undefined)).toEqual({ distribution: null, hedged: null, inferred: true });
  });
  test("cobertura de divisa: solo con señal clara; la clase «H» no es cobertura (MEDIA-16)", () => {
    const hedged = (name: string) => inferShareClassTraits(name).hedged;
    // Señales claras de clase cubierta.
    expect(hedged("BlackRock GF World Technology A2 EURH")).toBe(true);
    expect(hedged("Nordea 1 Global Climate BP USDH")).toBe(true);
    expect(hedged("Natixis Loomis Sayles US Growth H-EUR Acc")).toBe(true);
    expect(hedged("Robeco Global Credits IH EUR-H")).toBe(true);
    expect(hedged("JPM Global Bond A (acc) - EUR (hedged)")).toBe(true);
    expect(hedged("Invesco Pan European A (EUR Hgd) Acc")).toBe(true);
    expect(hedged("Fondo Renta Fija USD clase cubierta")).toBe(true);
    // «<divisa> H», «H <divisa>» y el sufijo «-H» de la clase (nombres reales de la maestra).
    expect(hedged("Man GLG Japan CoreAlpha Equity D H EUR")).toBe(true);
    expect(hedged("Global Evolution Frontier Markets R EUR H")).toBe(true);
    expect(hedged("M&G (Lux) Optimal Income Fund EUR A-H Acc")).toBe(true);
    expect(hedged("Schroder ISF Global Gold A Accumulation PLN Hedged")).toBe(true);
    // Señal clara de NO cubierta.
    expect(hedged("Vanguard Global Bond Index Unhedged EUR")).toBe(false);
    expect(hedged("Fondo Global clase no cubierta")).toBe(false);
    // Sin señal: desconocido. La «H» suelta es letra de clase; cubrir tipos no es cubrir divisa.
    expect(hedged("Pictet Global Megatrend H Acc")).toBeNull();
    expect(hedged("Carmignac Patrimoine Class H EUR")).toBeNull();
    expect(hedged("iShares Euro Govt Bond Interest Rate Hedged")).toBeNull();
    expect(hedged("Fidelity Funds World A Acc EUR")).toBeNull();
    expect(hedged("USD High Yield Bond A Acc")).toBeNull();
    expect(hedged("")).toBeNull();
  });

  test("al comparar, un nombre sin indicación cuenta como «sin cobertura (inferida)» y se conserva el aviso", () => {
    // Par real de la maestra: se avisa «Sin cobertura → Cubierta».
    const gold = assessFundEquivalence(fund("DPAM", { display_name: "DPAM B Equities NewGems Sustainable B Cap" }),
      fund("BGF", { display_name: "BGF World Gold Fund E2 EUR Hedged" }));
    const goldHedge = gold.criteria.find((c) => c.key === "hedged")!;
    expect(goldHedge).toMatchObject({ status: "DIFFERS", original: "Sin cobertura", candidate: "Cubierta", inferred: true });
    expect(gold.differing).toContain("Cobertura de divisa (inferida): Sin cobertura → Cubierta");
    // Dos fondos sin señal: coinciden (sin cobertura los dos) y el criterio puntúa.
    const plain = assessFundEquivalence(fund("World Equity A Acc EUR"), fund("Global Equity B Acc EUR"));
    expect(plain.criteria.find((c) => c.key === "hedged")).toMatchObject({ status: "MATCH", original: "Sin cobertura", candidate: "Sin cobertura" });
    expect(plain.missing).not.toContain("Cobertura de divisa");
    const covered = assessFundEquivalence(fund("World Equity A Acc EUR Hedged"), fund("Global Equity B Acc EURH"));
    expect(covered.criteria.find((c) => c.key === "hedged")!.status).toBe("MATCH");
    // Solo un nombre vacío deja el criterio sin dato.
    expect(assessFundEquivalence(fund("V", { display_name: "" }), fund("W Acc")).criteria.find((c) => c.key === "hedged")!.status).toBe("UNKNOWN");
  });

  test("la clave de familia reconoce las clases cubiertas y sus divisas (EURH, USDH, PLN Hedged, AUD)", () => {
    expect(familyKey("BlackRock GF World Technology A2 EURH")).toBe(familyKey("BlackRock GF World Technology A2 EUR"));
    expect(familyKey("Nordea 1 Global Climate BP USDH")).toBe(familyKey("Nordea 1 Global Climate BP EUR"));
    expect(familyKey("Schroder ISF Global Gold A Accumulation PLN Hedged")).toBe(familyKey("Schroder ISF Global Gold A Accumulation USD"));
    expect(familyKey("Schroder ISF Global Gold A Acc AUDH")).toBe(familyKey("Schroder ISF Global Gold A Acc HKD"));
  });

  test("la clave de familia quita los sufijos de clase y conserva la estrategia", () => {
    expect(familyKey("Fidelity Funds - World Fund A-ACC-EUR")).toBe(familyKey("Fidelity Funds World Y Acc EUR Hedged"));
    expect(familyKey("Polar Capital Global Technology I Acc")).not.toBe(familyKey("Polar Capital Healthcare Opportunities I Acc"));
  });

  /* 15-11-2026: un año, un vencimiento o un perfil en el nombre distingue productos, no clases. Nombres reales del catálogo
     (1-extractor/config/fondos.csv y la ficha de la base), que antes se emparejaban como «Misma estrategia, otra clase». */
  test("un año, un vencimiento o un perfil distinto en el nombre no es otra clase", () => {
    const horizonte = ["CARTERA RENTA FIJA HORIZONTE 2026 FI", "CARTERA RENTA FIJA HORIZONTE 2027, FI", "CARTERA RENTA FIJA HORIZONTE 2028, FI"];
    expect(new Set(horizonte.map(familyKey)).size).toBe(3);
    expect(familyKey("Fidelity Funds - Fidelity Target™ 2030 Fund A-Acc-EUR")).not.toBe(familyKey("Fidelity Funds - Fidelity Target™ 2035 Fund A-Acc-EUR"));
    expect(familyKey("Allianz Strategy 50 CT EUR")).not.toBe(familyKey("Allianz Strategy 75 CT EUR"));
    expect(familyKey("Allianz Global Investors Fund - Allianz Dynamic Multi Asset Strategy SRI 15 AT EUR"))
      .not.toBe(familyKey("Allianz Global Investors Fund - Allianz Dynamic Multi Asset Strategy SRI 75 AT EUR"));
    expect(familyKey("Fondo Ejemplo II A Acc")).not.toBe(familyKey("Fondo Ejemplo III A Acc"));
  });

  test("la misma denominación con otra letra, divisa, reparto, cobertura o número de clase sigue siendo otra clase", () => {
    const pares: [string, string][] = [
      ["Amundi Funds - Global Equity Responsible A EUR (C)", "Amundi Funds - Global Equity Responsible C EUR (C)"],
      ["Invesco Funds - Invesco Euro Ultra-Short Term Debt Fund A Accumulation EUR", "Invesco Funds - Invesco Euro Ultra-Short Term Debt Fund C Accumulation EUR"],
      ["Schroder International Selection Fund Emerging Asia A1 Accumulation USD", "Schroder International Selection Fund Emerging Asia A1 Accumulation EUR"],
      ["BlackRock Global Funds - World Mining Fund E2 EUR", "BlackRock Global Funds - World Mining Fund E2 EUR Hedged"],
      ["Amundi Funds - Emerging Markets Short Term Bond A2 EUR (C)", "Amundi Funds - Emerging Markets Short Term Bond A2 EUR Hgd (C)"],
      ["M&G (Lux) Emerging Markets Bond Fund EUR A Acc", "M&G (Lux) Emerging Markets Bond Fund EUR A-H Acc"],
      ["Incometric Fund Nartex Equity Fund A Cap EUR Accumulation", "Incometric Fund Nartex Equity Fund R Cap EUR Accumulation"],
      ["Buy & Hold Luxembourg B&H Bond Class 1", "Buy & Hold Luxembourg B&H Bond Class 2"],
      ["Gestora Global Equity A Acc EUR", "Gestora Global Equity Institutional Dist EUR"]
    ];
    for (const [a, b] of pares) expect(familyKey(a), `${a} / ${b}`).toBe(familyKey(b));
  });

  test("los fondos Horizonte de renta fija no salen como otra clase: si entran, es como candidato normal", () => {
    const rf = (id: string, name: string) => fund(id, {
      display_name: name, economic_asset_class: "FIXED_INCOME", category: "Renta fija euro a corto plazo", region: "Europa",
      pms_exposure: { equity: 0, fixed_income: 0.98, cash: 0.02, alternative: 0, other: 0 }, exposure_detail: {}
    });
    const r2026 = rf("ES0116419005", "CARTERA RENTA FIJA HORIZONTE 2026 FI");
    for (const [id, name] of [["ES0162295002", "CARTERA RENTA FIJA HORIZONTE 2027, FI"], ["ES0162296000", "CARTERA RENTA FIJA HORIZONTE 2028, FI"]]) {
      const result = assessFundEquivalence(r2026, rf(id, name));
      expect(result.sameFamily).toBe(false);
      expect(result.verdict).not.toBe("SAME_FUND_CLASS");
    }
  });
});

describe("distancia entre exposiciones", () => {
  test("0 con repartos iguales aunque cambie la escala, 1 con repartos disjuntos y null sin dato", () => {
    expect(exposureDistance({ a: 0.5, b: 0.5 }, { a: 50, b: 50 })).toBe(0);
    expect(exposureDistance({ a: 1 }, { b: 1 })).toBe(1);
    expect(exposureDistance({ a: 0.5, b: 0.5 }, { a: 1 })).toBeCloseTo(0.5, 12);
    expect(exposureDistance({ a: 0, b: 0 }, { a: 1 })).toBeNull();
    expect(exposureDistance(undefined, { a: 1 })).toBeNull();
  });
  test("la banda crediticia sale del rating medio o del % IG/HY", () => {
    expect(creditBand({ avg_credit_quality: "AA-" })).toBe("IG");
    expect(creditBand({ avg_credit_quality: "BBB" })).toBe("IG");
    expect(creditBand({ avg_credit_quality: "BB+" })).toBe("HY");
    expect(creditBand({ avg_credit_quality: "B" })).toBe("HY");
    expect(creditBand({ investment_grade_pct: 0.2, high_yield_pct: 0.8 })).toBe("HY");
    expect(creditBand({})).toBeNull();
    expect(creditBand(undefined)).toBeNull();
  });
});

describe("veredicto de equivalencia", () => {
  const original = fund("ORIGINAL", { display_name: "Gestora Global Equity A Acc EUR" });

  test("misma categoría y exposiciones coincidentes: equivalente, con la ficha explicada", () => {
    const candidate = fund("CAND", {
      display_name: "Otra Gestora World Fund I Acc",
      exposure_detail: {
        sectors: { technology: 0.35, healthcare: 0.2, financial_services: 0.15, industrials: 0.3 },
        equity_regions: { united_states: 0.65, europe: 0.25, japan: 0.1 },
        market_caps: { large: 0.85, mid: 0.15 },
        equity_styles: { growth: 0.45, blend: 0.45, value: 0.1 }
      }
    });
    const result = assessFundEquivalence(original, candidate);
    expect(result.verdict).toBe("EQUIVALENT");
    expect(result.score).toBeGreaterThanOrEqual(0.75);
    /* Con el nombre que se enseña (decisión 101). */
    expect(result.shared).toContain("Categoría: RV Global Cap. Grande Blend");
    expect(result.shared.some((text) => text.startsWith("Política de distribución (inferida)"))).toBe(true);
    expect(result.differing).toEqual([]);
    expect(result.sameFamily).toBe(false);
  });

  test("otro vehículo u otra clase de activo es excluyente aunque todo lo demás coincida", () => {
    expect(assessFundEquivalence(original, fund("ETF", { instrument_type: "ETF", display_name: "X Acc" })).verdict).toBe("NOT_EQUIVALENT");
    const bond = assessFundEquivalence(original, fund("BOND", { economic_asset_class: "FIXED_INCOME", display_name: "X Acc" }));
    expect(bond.verdict).toBe("NOT_EQUIVALENT");
    expect(bond.reason).toBe("Distinto clase de activo: Renta variable → Renta fija.");
  });

  test("un dato ausente no es una coincidencia: cuenta como «sin dato» y no puntúa", () => {
    const candidate = fund("SIN_EXPO", { display_name: "Sin Datos Fund B Acc", exposure_detail: undefined });
    const result = assessFundEquivalence(original, candidate);
    expect(result.missing).toEqual(["Sectores", "Regiones de la renta variable", "Tamaño de las empresas", "Estilo"]);
    expect(result.evaluated).toBe(result.total - 4);
    expect(result.verdict).toBe("EQUIVALENT");
    expect(result.reason).toContain("4 criterios sin dato");
  });

  test("distinta política de distribución (inferida) deja el veredicto en comparable y lo explica", () => {
    const result = assessFundEquivalence(original, fund("DIST", { display_name: "Otra Gestora World I Dis" }));
    expect(result.verdict).toBe("COMPARABLE");
    expect(result.reason).toContain("NAV");
    expect(assessFundEquivalence(original, fund("DIST2", { display_name: "Otra Gestora World I Dis" }), { requireSameDistribution: false }).verdict).toBe("EQUIVALENT");
  });

  test("otra clase del mismo fondo se reconoce por la familia, antes que cualquier otro criterio", () => {
    const result = assessFundEquivalence(original, fund("CLASE_I", { display_name: "Gestora Global Equity I Dis USD Hedged", currency: "USD" }));
    expect(result.verdict).toBe("SAME_FUND_CLASS");
    expect(result.sameFamily).toBe(true);
    expect(result.differing).toEqual(expect.arrayContaining([
      "Política de distribución (inferida): Acumulación → Reparto",
      "Cobertura de divisa (inferida): Sin cobertura → Cubierta",
      "Divisa de la clase: EUR → USD"
    ]));
  });

  test("ni categoría ni región, o mezcla de activos distinta: no equivalente", () => {
    const far = fund("FAR", { display_name: "Asia Fund A Acc", category: "EAA Fund Asia ex-Japan Equity", region: "Asia" });
    expect(assessFundEquivalence(original, far).verdict).toBe("NOT_EQUIVALENT");
    const mixed = fund("MIX", { display_name: "Half Bonds A Acc", pms_exposure: { equity: 0.5, fixed_income: 0.5, cash: 0, alternative: 0, other: 0 } });
    expect(assessFundEquivalence(original, mixed).verdict).toBe("NOT_EQUIVALENT");
    expect(assessFundEquivalence(original, mixed).reason).toMatch(/mezcla de activos/i);
  });

  test("renta fija: duración y calidad crediticia entran cuando la ficha las trae", () => {
    const bond = fund("RF", {
      display_name: "Euro Corporate Bond A Acc", economic_asset_class: "FIXED_INCOME", category: "EAA Fund EUR Corporate Bond",
      region: "Eurozona", pms_exposure: { equity: 0, fixed_income: 0.95, cash: 0.05, alternative: 0, other: 0 }, exposure_detail: undefined,
      fixed_income_profile: { effective_duration: 4.5, avg_credit_quality: "BBB+", bond_types: { corporate: 0.9, cash: 0.1 } }
    });
    const near = fund("RF2", {
      ...bond, asset_id: "RF2", display_name: "Other Euro Credit I Acc",
      fixed_income_profile: { modified_duration: 5.6, avg_credit_quality: "A-", bond_types: { corporate: 0.85, government: 0.1, cash: 0.05 } }
    });
    const nearResult = assessFundEquivalence(bond, near);
    expect(nearResult.verdict).toBe("EQUIVALENT");
    expect(nearResult.shared).toContain("Duración: 4,5 años → 5,6 años");
    const highYield = fund("HY", {
      ...bond, asset_id: "HY", display_name: "Euro High Yield I Acc",
      fixed_income_profile: { effective_duration: 7, avg_credit_quality: "BB", bond_types: { corporate: 0.9, cash: 0.1 } }
    });
    const hyResult = assessFundEquivalence(bond, highYield);
    expect(hyResult.verdict).toBe("COMPARABLE");
    expect(hyResult.differing).toEqual(expect.arrayContaining([
      "Duración: 4,5 años → 7,0 años",
      "Calidad crediticia: Grado de inversión → Alto rendimiento"
    ]));
    const noProfile = assessFundEquivalence(bond, fund("RF3", { ...bond, asset_id: "RF3", display_name: "Plain Bond R Acc", fixed_income_profile: undefined }));
    expect(noProfile.missing).toEqual(["Duración", "Calidad crediticia", "Tipo de emisor"]);
  });
});

/*
 * Decisión 117 (B): el relleno por clase sigue contando igual en el criterio, y ninguna propuesta cambia; lo que cambia es lo que se escribe. PIMCO GIS Global
 * Bond y PIMCO GIS Low Duration Opportunities no declaran mezcla: el servidor les pone renta fija 100 % a los dos (`CLASSIFICATION_FALLBACK`), y la hoja 3
 * de la Propuesta de mejora decía «Mezcla de activos: distancia 0 %», como si se hubiera medido.
 */
describe("la mezcla de activos que es el relleno por su clase (decisión 117)", () => {
  type Mezcla = BdbAssetDetail["pms_exposure"];
  const RELLENO_RF: Mezcla = { equity: 0, fixed_income: 1, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "CLASSIFICATION_FALLBACK" };
  /* Las mismas cifras sin la marca: lo que el criterio veía antes de saber de dónde salían. */
  const RF_SIN_MARCA: Mezcla = { equity: 0, fixed_income: 1, cash: 0, alternative: 0, real_asset: 0, other: 0 };
  const rf = (id: string, nombre: string, duracion: number, pms: Mezcla = RELLENO_RF): BdbAssetDetail =>
    fund(id, {
      display_name: nombre, economic_asset_class: "FIXED_INCOME", category: "EAA Fund Global Diversified Bond - EUR Hedged", region: "Global",
      pms_exposure: pms, exposure_detail: undefined, fixed_income_profile: { effective_duration: duracion, avg_credit_quality: "A" }
    });
  const globalBond = rf("IE00B11XZ103", "PIMCO GIS Global Bond Fund E Class EUR (Hedged) Accumulation", 6.6);
  const lowDuration = rf("IE00BF2FJG67", "PIMCO GIS Low Duration Opportunities Fund E Class EUR (Hedged) Accumulation", 3.4);

  test("dos rellenos: se lee «por su clase, sin dato declarado» y no «distancia 0 %»; el veredicto y la puntuación, los mismos", () => {
    const con = assessFundEquivalence(globalBond, lowDuration);
    const antes = assessFundEquivalence(rf("A", globalBond.display_name, 6.6, RF_SIN_MARCA), rf("B", lowDuration.display_name, 3.4, RF_SIN_MARCA));
    expect(con.criteria.find((c) => c.key === "asset_mix")).toMatchObject({ status: "MATCH", weight: 2, detail: "por su clase, sin dato declarado" });
    expect(con.shared).toContain("Mezcla de activos: por su clase, sin dato declarado");
    expect(con.shared.join("; ")).not.toContain("distancia");
    /* Lo de antes: la misma cuenta, con el texto de una coincidencia medida. */
    expect(antes.shared).toContain("Mezcla de activos: distancia 0,0\u00a0%");
    expect([con.verdict, con.score, con.reason]).toEqual([antes.verdict, antes.score, antes.reason]);
    expect(con.verdict).toBe("COMPARABLE");
    expect(con.reason).toBe("Difieren duración: Duración: 6,6 años → 3,4 años.");
  });

  test("con uno declarado y el otro por su clase, también; y si difiere, el motivo no da una distancia", () => {
    const declarado = rf("DECL", "Bond Fund Declared Acc", 6.6, { equity: 0, fixed_income: 0.95, cash: 0.05, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" });
    expect(assessFundEquivalence(declarado, lowDuration).shared).toContain("Mezcla de activos: por su clase, sin dato declarado");
    const mixto = rf("MIXTO", "Balanced Fund Acc", 6.6, { equity: 0.5, fixed_income: 0.5, cash: 0, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" });
    const difiere = assessFundEquivalence(mixto, lowDuration);
    expect(difiere.verdict).toBe("NOT_EQUIVALENT");
    expect(difiere.reason).toBe("La mezcla de activos difiere (por su clase, sin dato declarado).");
  });

  test("dos declaradas siguen dando su distancia", () => {
    const a = rf("A", "Bond A Acc", 6.6, { equity: 0, fixed_income: 0.95, cash: 0.05, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" });
    const b = rf("B", "Bond B Acc", 6.0, { equity: 0, fixed_income: 0.9, cash: 0.1, alternative: 0, real_asset: 0, other: 0, source: "PORTFOLIO_EXPOSURE" });
    expect(assessFundEquivalence(a, b).shared).toContain("Mezcla de activos: distancia 5,0\u00a0%");
  });
});

describe("candidatos equivalentes para una posición", () => {
  test("ordena por veredicto y afinidad; excluye el propio, los de cartera, benchmarks y no invertibles", () => {
    const original = fund("ORIGINAL", { display_name: "Gestora Global Equity A Acc EUR" });
    const universe = [
      original,
      fund("HELD", { display_name: "Held World Fund I Acc" }),
      fund("BENCH", { display_name: "MSCI World Acc", role: "BENCHMARK" }),
      fund("BLOCKED", { display_name: "Blocked World Acc", is_investable: false }),
      fund("CLASE_I", { display_name: "Gestora Global Equity I Acc EUR" }),
      fund("DIST", { display_name: "Other World I Dis" }),
      fund("EQ", { display_name: "Other World I Acc" }),
      fund("FAR", { display_name: "Asia I Acc", category: "EAA Fund Asia ex-Japan Equity", region: "Asia" })
    ];
    const result = findEquivalentCandidates(original, universe, ["HELD"]);
    expect(result.map(({ asset, equivalence }) => [asset.asset_id, equivalence.verdict])).toEqual([
      ["CLASE_I", "SAME_FUND_CLASS"], ["EQ", "EQUIVALENT"], ["DIST", "COMPARABLE"]
    ]);
  });
});
