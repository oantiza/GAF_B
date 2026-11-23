import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { BacktestStressScenario } from "../src/adapters/backtestPortfolioBackend";
import { crisisPasadas, motivoDeUnaCrisisSinCifra, PESO_MINIMO_DE_UNA_CRISIS_PCT, posicionesParaLasCrisis, type PosicionDeLaCartera } from "../src/core/crisisPasadas";

/**
 * Lo que imprime el informe de cliente sobre las crisis (decisión 3). Las entradas tienen la forma que manda el
 * servidor; lo que mide cada cifra lo fija `functions_python/tests/test_lo_que_dice_el_papel_de_las_crisis.py`.
 */
function escenario(parte: Partial<BacktestStressScenario> & Pick<BacktestStressScenario, "id">): BacktestStressScenario {
  return {
    label: parte.id,
    configured_start_date: "2020-02-19",
    configured_end_date: "2020-03-23",
    start_date: "2020-02-19",
    end_date: "2020-03-23",
    trough_date: "2020-03-23",
    common_data_end_date: "2026-10-27",
    drawdown_pct: -10,
    duration_days: 33,
    recovery_date: "2020-11-24",
    recovery_days: 246,
    remaining_to_recover_pct: 0,
    recovery_status: "RECOVERED",
    worst_asset: null,
    coverage: { weight_pct: 100, included_assets: 2, total_assets: 2 },
    representative: true,
    included_assets: ["A", "B"],
    excluded_assets: [],
    reason: null,
    ...parte
  };
}

const sinDato = (id: BacktestStressScenario["id"], reason: BacktestStressScenario["reason"], desde = "2020-02-19"): BacktestStressScenario =>
  escenario({
    id, reason, configured_start_date: desde, start_date: null, end_date: null, trough_date: null, drawdown_pct: null,
    duration_days: null, recovery_status: "NO_DATA", recovery_date: null, recovery_days: null, remaining_to_recover_pct: null,
    coverage: { weight_pct: 0, included_assets: 0, total_assets: 2 }, representative: false, included_assets: [],
    excluded_assets: [{ asset_id: "A", reason: "NO_DATA_AT_WINDOW_START" }, { asset_id: "B", reason: "NO_DATA_AT_WINDOW_START" }]
  });

const CARTERA: Record<string, PosicionDeLaCartera> = {
  IE00B3XXRP09: { nombre: "Vanguard S&P 500 UCITS ETF", pesoPct: 12 },
  FR0013367265: { nombre: "R-co Valor Balanced C EUR", pesoPct: 9 }
};
const posicionDe = (id: string) => CARTERA[id] ?? null;

describe("crisis pasadas: lo que se imprime", () => {
  test("con la forma que manda el servidor para la muestra, cada crisis lleva su cifra, sus fechas y la parte que mide", () => {
    const { crisis, sinNinguna } = crisisPasadas([
      escenario({
        id: "COVID", drawdown_pct: -20.567835, coverage: { weight_pct: 79, included_assets: 6, total_assets: 8 },
        excluded_assets: [{ asset_id: "FR0013367265", reason: "NO_DATA_AT_WINDOW_START" }, { asset_id: "IE00B3XXRP09", reason: "QUALITY_BLOCKED" }]
      }),
      escenario({
        id: "RATES_2022", configured_start_date: "2022-01-01", configured_end_date: "2022-10-31", start_date: "2022-01-04",
        end_date: "2022-10-31", trough_date: "2022-10-12", drawdown_pct: -14.865142, coverage: { weight_pct: 88, included_assets: 7, total_assets: 8 },
        excluded_assets: [{ asset_id: "IE00B3XXRP09", reason: "QUALITY_BLOCKED" }]
      }),
      escenario({ id: "COMMON_HISTORY", drawdown_pct: -11.198444 })
    ], posicionDe);
    expect(sinNinguna).toBeNull();
    expect(crisis.map((c) => c.id)).toEqual(["COVID", "RATES_2022"]);
    expect(crisis[0]).toMatchObject({
      nombre: "COVID-19",
      cifra: "−20,57\u00a0%",
      tramo: "Del 19/02/2020 al 23/03/2020",
      parteMedida: "Mide el 79,0\u00a0% de la cartera (6 de 8 posiciones)",
      fuera: "Fuera: Vanguard S&P 500 UCITS ETF (12,0\u00a0%) y R-co Valor Balanced C EUR (9,0\u00a0%)",
      ausencia: null,
      sinDato: null
    });
    /* Las dos fechas son las que la cifra compara: el primer día con dato y el punto más bajo, no el final del tramo. */
    expect(crisis[1]).toMatchObject({
      nombre: "Tipos 2022",
      cifra: "−14,87\u00a0%",
      tramo: "Del 04/01/2022 al 12/10/2022",
      parteMedida: "Mide el 88,0\u00a0% de la cartera (7 de 8 posiciones)",
      fuera: "Fuera: Vanguard S&P 500 UCITS ETF (12,0\u00a0%)"
    });
  });

  test("decisión 103: por debajo del 60 % no hay cifra; dice «Falta el dato», lo que mide y quién queda fuera", () => {
    const [justo] = crisisPasadas([escenario({ id: "COVID", coverage: { weight_pct: 60, included_assets: 1, total_assets: 2 }, representative: true })], posicionDe).crisis;
    expect(justo).toMatchObject({ cifra: "−10,00\u00a0%", ausencia: null, sinDato: null });
    expect(justo.parteMedida).toContain("60,0\u00a0%");
    /* 59,96 % redondeado sería «60,0 %» justo al lado de «hace falta al menos el 60 %». */
    const [debajo] = crisisPasadas([escenario({
      id: "COVID", coverage: { weight_pct: 59.96, included_assets: 1, total_assets: 2 }, representative: false,
      excluded_assets: [{ asset_id: "IE00B3XXRP09", reason: "QUALITY_BLOCKED" }]
    })], posicionDe).crisis;
    expect(debajo).toEqual({
      id: "COVID", nombre: "COVID-19", contexto: "Inicio de la pandemia", cifra: null, tramo: null, parteMedida: null,
      fuera: "Fuera: Vanguard S&P 500 UCITS ETF (12,0\u00a0%)", ausencia: "Falta el dato", sinDato: "Mide el 59,9\u00a0% de la cartera, y hace falta al menos el 60\u00a0%."
    });
    /* El umbral no está copiado aquí: decide `representative`, y de que cuadre con el peso responde el adaptador. */
    const [segunElCampo] = crisisPasadas([escenario({ id: "COVID", coverage: { weight_pct: 30, included_assets: 1, total_assets: 2 }, representative: true })], posicionDe).crisis;
    expect(segunElCampo.cifra).toBe("−10,00\u00a0%");
  });

  test("decisión 103, el caso de la decisión: Vanguard 60 y JPMorgan 40, y una crisis por debajo y otra por encima dicen cada una lo suyo", () => {
    const pesos = posicionesParaLasCrisis(
      [{ asset_id: "IE00B3XXRP09", weight_percent: 60 }, { asset_id: "LU0430492750", weight_percent: 40 }],
      (id) => ({ IE00B3XXRP09: "Vanguard S&P 500 UCITS ETF", LU0430492750: "JPMorgan Euro Aggregate Bond" })[id]
    );
    const covid = escenario({
      id: "COVID", drawdown_pct: -6.38689, coverage: { weight_pct: 40, included_assets: 1, total_assets: 2 }, representative: false,
      excluded_assets: [{ asset_id: "IE00B3XXRP09", reason: "QUALITY_BLOCKED" }]
    });
    expect(motivoDeUnaCrisisSinCifra(covid, pesos)).toBe("Mide el 40,0\u00a0% de la cartera, y hace falta al menos el 60\u00a0%. Fuera: Vanguard S&P 500 UCITS ETF (60,0\u00a0%).");
    const tipos = escenario({ id: "RATES_2022", drawdown_pct: -15.13, coverage: { weight_pct: 100, included_assets: 2, total_assets: 2 } });
    expect(motivoDeUnaCrisisSinCifra(tipos, pesos)).toBeNull();
    const [enCovid, enTipos] = crisisPasadas([covid, tipos], pesos).crisis;
    expect(enCovid).toMatchObject({ cifra: null, ausencia: "Falta el dato", sinDato: "Mide el 40,0\u00a0% de la cartera, y hace falta al menos el 60\u00a0%.", fuera: "Fuera: Vanguard S&P 500 UCITS ETF (60,0\u00a0%)" });
    expect(enTipos).toMatchObject({ cifra: "−15,13\u00a0%", ausencia: null, parteMedida: "Mide el 100,0\u00a0% de la cartera (2 de 2 posiciones)" });
    /* Sin ninguna cifra que dar, no es «Sin datos»: se ha medido una parte, y las fichas lo dicen. */
    const lasDos = crisisPasadas([covid, { ...covid, id: "RATES_2022" }], pesos);
    expect(lasDos.sinNinguna).toBeNull();
    expect(lasDos.crisis.map((c) => c.ausencia)).toEqual(["Falta el dato", "Falta el dato"]);
  });

  test("decisión 103: lo que no se sabe no se inventa, y sin cifra calculada sigue siendo «Sin datos»", () => {
    /* Sin pesos, el código del que queda fuera; sin nadie fuera, solo lo que mide. */
    const covid = escenario({ id: "COVID", coverage: { weight_pct: 40, included_assets: 1, total_assets: 2 }, representative: false, excluded_assets: [{ asset_id: "XS000", reason: "NO_SERIES" }] });
    expect(motivoDeUnaCrisisSinCifra(covid, () => null)).toBe("Mide el 40,0\u00a0% de la cartera, y hace falta al menos el 60\u00a0%. Fuera: XS000.");
    expect(motivoDeUnaCrisisSinCifra({ ...covid, excluded_assets: [] }, () => null)).toBe("Mide el 40,0\u00a0% de la cartera, y hace falta al menos el 60\u00a0%.");
    expect(motivoDeUnaCrisisSinCifra(sinDato("COVID", "NO_ELIGIBLE_ASSETS"), () => null)).toBeNull();
  });

  test("el 60 % de la frase es el corte del servidor", () => {
    const servidor = readFileSync(new URL("../functions_python/optimization/stress_analytics.py", import.meta.url), "utf8");
    const corte = Number(/^REPRESENTATIVE_WEIGHT_THRESHOLD = ([\d.]+)$/m.exec(servidor)?.[1]);
    expect(corte * 100).toBeCloseTo(PESO_MINIMO_DE_UNA_CRISIS_PCT, 10);
  });

  test("los pesos de las crisis son sobre lo que pesa toda la cartera, como en el papel", () => {
    const pesos = posicionesParaLasCrisis([{ asset_id: "A", weight_percent: 30 }, { asset_id: "B", weight_percent: 10 }, { asset_id: "C", weight_percent: 0 }], (id) => (id === "A" ? "Fondo A" : undefined));
    expect(pesos("A")).toEqual({ nombre: "Fondo A", pesoPct: 75 });
    expect(pesos("B")).toEqual({ nombre: "B", pesoPct: 25 });
    expect(pesos("Z")).toBeNull();
    expect(posicionesParaLasCrisis([], () => undefined)("A")).toBeNull();
  });

  test("una crisis sin datos lo dice y no enseña un cero; la otra sigue con su cifra", () => {
    const { crisis, sinNinguna } = crisisPasadas([sinDato("COVID", "NO_ELIGIBLE_ASSETS"), escenario({ id: "RATES_2022", drawdown_pct: -5 })], posicionDe);
    expect(sinNinguna).toBeNull();
    expect(crisis[0]).toMatchObject({ cifra: null, tramo: null, parteMedida: null, fuera: null, ausencia: "Sin datos" });
    expect(crisis[0].sinDato).toBe("Ninguna posición tenía precios al inicio de esta crisis (19/02/2020).");
    expect(crisis[1].cifra).toBe("−5,00\u00a0%");
  });

  /* N03 (Óscar, 22-11-2026): una posición con un hueco de más de catorce días entre dos precios dentro de la crisis se aparta
     (`GAP_IN_WINDOW`). Sí tenía precio al inicio, así que no se dice eso: se dice lo que le falta. */
  describe("la posición que no cotizó durante parte de la crisis (N03)", () => {
    const conHueco = (motivos: BacktestStressScenario["excluded_assets"]) =>
      crisisPasadas([{ ...sinDato("COVID", "NO_ELIGIBLE_ASSETS"), excluded_assets: motivos }, escenario({ id: "RATES_2022", drawdown_pct: -5 })], posicionDe).crisis[0];

    test("sola en la cartera: «Sin datos», y por qué", () => {
      const crisis = conHueco([{ asset_id: "A", reason: "GAP_IN_WINDOW" }]);
      expect(crisis).toMatchObject({ cifra: null, tramo: null, ausencia: "Sin datos" });
      expect(crisis.sinDato).toBe("La posición no tiene cotizaciones durante parte de esta crisis (del 19/02/2020 al 23/03/2020), y sin ellas no se puede medir su caída.");
      expect(crisis.sinDato).not.toContain("al inicio");
    });

    test("todas con hueco, en plural", () => {
      expect(conHueco([{ asset_id: "A", reason: "GAP_IN_WINDOW" }, { asset_id: "B", reason: "GAP_IN_WINDOW" }]).sinDato)
        .toBe("Las posiciones no tienen cotizaciones durante parte de esta crisis (del 19/02/2020 al 23/03/2020), y sin ellas no se puede medir su caída.");
    });

    test("con una sin precio al inicio y otra con hueco, ninguna de las dos frases sería cierta para las dos", () => {
      expect(conHueco([{ asset_id: "A", reason: "NO_DATA_AT_WINDOW_START" }, { asset_id: "B", reason: "GAP_IN_WINDOW" }]).sinDato)
        .toBe("Ninguna posición tenía precios válidos durante toda esta crisis (del 19/02/2020 al 23/03/2020).");
    });

    test("la mitad con hueco: no llega al 60 % y se nombra lo que queda fuera", () => {
      const [crisis] = crisisPasadas([escenario({
        id: "COVID", drawdown_pct: -30, representative: false, coverage: { weight_pct: 50, included_assets: 1, total_assets: 2 },
        included_assets: ["B"], excluded_assets: [{ asset_id: "IE00B3XXRP09", reason: "GAP_IN_WINDOW" }]
      })], posicionDe).crisis;
      expect(crisis.cifra).toBeNull();
      expect(crisis.ausencia).toBe("Falta el dato");
      expect(crisis.sinDato).toBe("Mide el 50,0 % de la cartera, y hace falta al menos el 60 %.");
      expect(crisis.fuera).toBe("Fuera: Vanguard S&P 500 UCITS ETF (12,0 %)");
    });
  });

  test("cada motivo sin datos dice lo suyo", () => {
    const motivo = (reason: BacktestStressScenario["reason"]) =>
      crisisPasadas([sinDato("COVID", reason), escenario({ id: "RATES_2022" })], posicionDe).crisis[0].sinDato;
    expect(motivo("INSUFFICIENT_COMMON_DATA")).toContain("no coinciden en fechas suficientes");
    expect(motivo("NO_POSITIVE_WEIGHTS")).toContain("pesos positivos");
    expect(motivo(null)).toBe("No hay datos para esta crisis.");
  });

  test("sin datos para ninguna crisis, se dice y no hay fichas que finjan", () => {
    const { crisis, sinNinguna } = crisisPasadas([sinDato("COVID", "NO_ELIGIBLE_ASSETS"), sinDato("RATES_2022", "NO_ELIGIBLE_ASSETS", "2022-01-01"), sinDato("COMMON_HISTORY", "NO_ELIGIBLE_ASSETS")], posicionDe);
    expect(crisis).toEqual([]);
    expect(sinNinguna).toContain("no tiene datos para medir estas crisis");
    expect(sinNinguna).toContain("COVID-19 (desde 19/02/2020)");
    expect(sinNinguna).toContain("Tipos 2022 (desde 01/01/2022)");
    expect(sinNinguna).not.toMatch(/\d %/);
  });

  test.each([[[]], [null], [undefined]])("sin escenarios en la respuesta (%j), también se dice", (escenarios) => {
    const { crisis, sinNinguna } = crisisPasadas(escenarios as BacktestStressScenario[] | null | undefined, posicionDe);
    expect(crisis).toEqual([]);
    expect(sinNinguna).toContain("no tiene datos de crisis pasadas");
  });

  test("la historia común no es una crisis: sola, no imprime ninguna ficha", () => {
    const { crisis, sinNinguna } = crisisPasadas([escenario({ id: "COMMON_HISTORY", drawdown_pct: -30 })], posicionDe);
    expect(crisis).toEqual([]);
    expect(sinNinguna).not.toContain("30");
  });

  test("si nunca bajó del primer día, el cero es de verdad y se dice", () => {
    const [crisis] = crisisPasadas([escenario({ id: "COVID", drawdown_pct: 0, trough_date: "2020-02-19" })], posicionDe).crisis;
    expect(crisis.cifra).toBe("0,00\u00a0%");
    expect(crisis.tramo).toBe("Del 19/02/2020 al 23/03/2020: no bajó de su valor del primer día");
  });

  test("un cero redondeado no lleva signo", () => {
    const [crisis] = crisisPasadas([escenario({ id: "COVID", drawdown_pct: -0.004 })], posicionDe).crisis;
    expect(crisis.cifra).toBe("0,00\u00a0%");
    expect(crisis.tramo).toBe("Del 19/02/2020 al 23/03/2020");
  });

  test("toda la cartera medida: nada fuera, y una sola posición en singular", () => {
    const [crisis] = crisisPasadas([escenario({ id: "COVID", coverage: { weight_pct: 100, included_assets: 1, total_assets: 1 } })], posicionDe).crisis;
    expect(crisis.fuera).toBeNull();
    expect(crisis.parteMedida).toBe("Mide el 100,0\u00a0% de la cartera (1 de 1 posición)");
  });

  test("con muchas fuera se nombran las tres mayores, y lo que no se conoce se nombra por su código", () => {
    const pesos: Record<string, PosicionDeLaCartera> = {
      A: { nombre: "Fondo A", pesoPct: 5 }, B: { nombre: "Fondo B", pesoPct: 25 }, C: { nombre: "Fondo C", pesoPct: 15 }, D: { nombre: "Fondo D", pesoPct: 1 }
    };
    const fuera = (ids: string[]) => ids.map((asset_id) => ({ asset_id, reason: "NO_DATA_AT_WINDOW_START" as const }));
    const [varias] = crisisPasadas([escenario({ id: "COVID", excluded_assets: fuera(["A", "B", "C", "D", "E"]) })], (id) => pesos[id] ?? null).crisis;
    expect(varias.fuera).toBe("Fuera: Fondo B (25,0\u00a0%), Fondo C (15,0\u00a0%), Fondo A (5,0\u00a0%) y 2 más");
    const [sinNombre] = crisisPasadas([escenario({ id: "COVID", excluded_assets: fuera(["XS000"]) })], () => null).crisis;
    expect(sinNombre.fuera).toBe("Fuera: XS000");
  });
});
