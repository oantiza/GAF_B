import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { HistoricalStressCards } from "../src/components/HistoricalStressCards";
import { motivoDeFueraParaElCliente } from "../src/core/backtestCoverage";
import { RiskContributionChart } from "../src/components/RiskContributionChart";
import type { BacktestStressScenario } from "../src/adapters/backtestPortfolioBackend";

describe("RiskContributionChart", () => {
  test("renderiza barras dobles accesibles, labels y contribución negativa", () => {
    const html = renderToStaticMarkup(
      <RiskContributionChart
        items={[
          { asset_id: "A", weight_pct: 55, risk_pct: 35 },
          { asset_id: "B", weight_pct: 45, risk_pct: -12.5 }
        ]}
        covModel="LEDOIT_WOLF"
        assetLabels={{ A: "Fondo Alfa", B: "Cobertura Beta" }}
      />
    );

    expect(html).toContain("Contribución al riesgo");
    expect(html).toContain("Fondo Alfa");
    expect(html).toContain("Covarianza: Ledoit-Wolf");
    expect(html).toContain("peso 55,0\u00a0%; contribución al riesgo 35,0\u00a0%");
    expect(html).toContain("contribución al riesgo −12,5\u00a0%");
    expect(html).toContain("f5-risk-bar-negative");
    expect(html).not.toContain('role="alert"');
  });

  test("alerta únicamente por contribuciones positivas superiores al 40 %", () => {
    const html = renderToStaticMarkup(
      <RiskContributionChart
        items={[
          { asset_id: "POS", weight_pct: 30, risk_pct: 40.1 },
          { asset_id: "EDGE", weight_pct: 30, risk_pct: 40 },
          { asset_id: "NEG", weight_pct: 40, risk_pct: -75 }
        ]}
      />
    );

    /* ANA-27: es contenido fijo, no un aviso que llega: una nota, no una alerta que el lector de pantalla interrumpe para leer. */
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("Concentración de riesgo superior al 40 %");
    expect(html).toContain("POS: 40,1\u00a0%");
    expect(html).not.toContain("EDGE: 40,0 %");
    expect(html).not.toContain("NEG: -75,0 %");
  });

  test("con volatilidad nula dice «No aplica», y no «N/D» ni «Falta el dato»: la medida no está definida", () => {
    const html = renderToStaticMarkup(
      <RiskContributionChart items={null} reason="ZERO_VOLATILITY" />
    );

    expect(html).toContain("No aplica");
    expect(html).not.toContain("Falta el dato");
    expect(html).not.toContain("N/D");
    expect(html).toContain("Volatilidad de cartera nula");
    expect(html).not.toContain("f5-risk-list");
  });

  test("genera ids accesibles únicos cuando hay más de un gráfico", () => {
    const html = renderToStaticMarkup(
      <>
        <RiskContributionChart items={[{ asset_id: "A", weight_pct: 100, risk_pct: 100 }]} />
        <RiskContributionChart items={[{ asset_id: "B", weight_pct: 100, risk_pct: 100 }]} />
      </>
    );
    const ids = [...html.matchAll(/<h2[^>]*id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    ids.forEach((id) => expect(html).toContain(`aria-labelledby="${id}"`));
  });
});

const REASONS = ["NO_SERIES", "NO_DATA_AT_WINDOW_START", "YOUNGEST_TO_REACH_THREE_YEARS", "SERIES_ENDS_EARLY", "GAP_IN_WINDOW", "PRICE_SERIES_MISSING", "INSUFFICIENT_HISTORY", "FX_SERIES_MISSING", "FX_QUARANTINE", "NON_INVESTABLE", "QUALITY_BLOCKED", "DISTRIBUTES_WITHOUT_PAYMENTS"];

describe("HistoricalStressCards", () => {
  const scenarios: BacktestStressScenario[] = [
    {
      id: "COVID",
      label: "Crisis COVID-19",
      configured_start_date: "2020-02-19",
      configured_end_date: "2020-03-23",
      start_date: "2020-02-19",
      end_date: "2020-03-23",
      trough_date: "2020-03-23",
      common_data_end_date: "2026-07-10",
      drawdown_pct: -27.4,
      duration_days: 33,
      recovery_date: "2020-08-10",
      recovery_days: 140,
      remaining_to_recover_pct: 0,
      recovery_status: "RECOVERED",
      coverage: { weight_pct: 92, included_assets: 2, total_assets: 3 },
      representative: true,
      included_assets: ["EQ", "BOND"],
      worst_asset: { asset_id: "EQ", weight_pct: 55, return_pct: -34.2, contribution_pct: -18.81 },
      excluded_assets: [],
      reason: null
    },
    {
      id: "RATES_2022",
      label: "Subida de tipos 2022",
      configured_start_date: "2022-01-01",
      configured_end_date: "2022-10-31",
      start_date: "2022-01-03",
      end_date: "2022-10-14",
      trough_date: "2022-10-14",
      common_data_end_date: "2026-07-10",
      drawdown_pct: -18,
      duration_days: 284,
      recovery_date: null,
      recovery_days: null,
      remaining_to_recover_pct: 3.2,
      recovery_status: "NOT_RECOVERED",
      coverage: { weight_pct: 59.9, included_assets: 1, total_assets: 2 },
      representative: false,
      included_assets: ["BOND"],
      worst_asset: { asset_id: "BOND", weight_pct: 100, return_pct: -22.1, contribution_pct: -22.1 },
      excluded_assets: [{ asset_id: "NEW", reason: "NO_SERIES" }],
      reason: null
    },
    {
      id: "COMMON_HISTORY",
      label: "Historia común",
      configured_start_date: null,
      configured_end_date: null,
      start_date: "2020-01-01",
      end_date: "2026-07-10",
      trough_date: "2023-03-24",
      common_data_end_date: "2026-07-10",
      drawdown_pct: -6.5,
      duration_days: 1178,
      recovery_date: "2023-04-18",
      recovery_days: 25,
      remaining_to_recover_pct: 0,
      recovery_status: "RECOVERED",
      coverage: { weight_pct: 60, included_assets: 2, total_assets: 3 },
      representative: true,
      included_assets: ["EQ", "BOND"],
      worst_asset: null,
      excluded_assets: [],
      reason: null
    }
  ];

  test("renderiza tres tarjetas con caída, duración, recuperación, cobertura y detalle", () => {
    const html = renderToStaticMarkup(
      <HistoricalStressCards scenarios={scenarios} assetLabels={{ EQ: "Renta variable global", NEW: "Fondo reciente" }} />
    );

    expect((html.match(/class="f5-stress-card"/g) ?? [])).toHaveLength(3);
    expect(html).toContain("Crisis COVID-19");
    /* Rediseño (14-11-2026): la caída, con dos decimales como toda cifra de riesgo (ANA-10), y la fecha como en el resto de la
       pantalla, «10/08/2020» (ANA-26); antes «−27,4 %» y «10 ago 2020». El peso medido sigue con uno. */
    expect(html).toMatch(/−27,40\s%/);
    expect(html).toContain("33 días");
    expect(html).toContain("10/08/2020");
    expect(html).toMatch(/92,0\s%/);
    expect(html).toContain("Renta variable global");
    expect(html).toContain("Fondo reciente");
    expect(html).toContain("Sin serie EUR de 10 años");
  });

  test("por debajo del 60 % no da cifra: dice que falta, cuánto mide y quién queda fuera (decisión 103)", () => {
    const html = renderToStaticMarkup(
      <HistoricalStressCards scenarios={scenarios} assetLabels={{ NEW: "Fondo reciente" }} positions={[{ asset_id: "BOND", weight_percent: 59.9 }, { asset_id: "NEW", weight_percent: 40.1 }]} />
    );

    /* El sello es ahora la pieza `Distintivo`: «No representativo» en el tono de aviso. */
    expect((html.match(/distintivo--aviso">No representativo/g) ?? [])).toHaveLength(1);
    expect((html.match(/distintivo--neutro">Representativo/g) ?? [])).toHaveLength(2);
    /* Un solo episodio sin cifra. «Falta el dato» sale además donde antes ponía «N/D» (el activo que más restó, sin dato): ANA-11.
       Desde el 19-11-2026 ese párrafo lleva además `f5-stress-sin-cifra`, con la que la hoja lo pone en el sitio de las
       cifras (apartado 14.8 del sistema); el motivo de que no haya datos, que aquí no sale, lleva solo la primera. */
    expect((html.match(/class="f5-stress-no-data f5-stress-sin-cifra"/g) ?? [])).toHaveLength(1);
    expect((html.match(/class="f5-stress-no-data[ "]/g) ?? [])).toHaveLength(1);
    expect(html).toContain("Mide el 59,9\u00a0% de la cartera, y hace falta al menos el 60\u00a0%. Fuera: Fondo reciente (40,1\u00a0%).");
    /* Ni la cifra ni nada de lo que sale de ella: duración, recuperación y quién más restó. */
    expect(html).not.toMatch(/−18,00\s%/);
    expect(html).not.toContain("Sin recuperar");
    expect(html).not.toMatch(/−22,10\s%/);
    expect(html).not.toContain("poco representativa");
    expect(html).not.toContain("No representativo (peso medido");
    /* Las otras dos, con el 92 % y el 60 %, siguen con su cifra. */
    expect(html).toMatch(/−27,40\s%/);
    expect(html).toMatch(/−6,50\s%/);
  });

  test("en Modo cliente dice lo mismo (decisión 103)", () => {
    const html = renderToStaticMarkup(
      <ClientModeProvider initialValue={true}><HistoricalStressCards scenarios={scenarios} positions={[{ asset_id: "BOND", weight_percent: 59.9 }, { asset_id: "NEW", weight_percent: 40.1 }]} /></ClientModeProvider>
    );
    expect(html).toContain("Falta el dato");
    expect(html).toContain("Mide el 59,9\u00a0% de la cartera, y hace falta al menos el 60\u00a0%. Fuera: NEW (40,1\u00a0%).");
    expect(html).not.toMatch(/−18,00\s%/);
    expect(html).not.toContain("poco representativa");
  });

  describe("por qué se queda fuera (decisión 19)", () => {
    const conExcluidos = (...razones: string[]): BacktestStressScenario[] => [{
      ...scenarios[0],
      excluded_assets: razones.map((reason, indice) => ({ asset_id: `A${indice}`, reason })) as BacktestStressScenario["excluded_assets"]
    }];
    const pinta = (modoCliente: boolean, ...razones: string[]) => renderToStaticMarkup(
      <ClientModeProvider initialValue={modoCliente}><HistoricalStressCards scenarios={conExcluidos(...razones)} /></ClientModeProvider>
    );

    test("el cliente lee una incidencia, y el asesor sigue viendo el motivo de verdad", () => {
      expect(pinta(true, "QUALITY_BLOCKED")).toContain("Fuera del cálculo: incidencia en su serie de precios");
      expect(pinta(true, "QUALITY_BLOCKED")).not.toContain("calidad");
      expect(pinta(false, "QUALITY_BLOCKED")).toContain("Bloqueado por calidad de datos");
      expect(pinta(false, "QUALITY_BLOCKED")).not.toContain("incidencia");
    });

    /* «Incidencia» solo es cierta para una serie que no pasó el control. */
    test.each([
      ["NO_SERIES", "sin serie de precios"],
      ["PRICE_SERIES_MISSING", "sin serie de precios"],
      ["NO_DATA_AT_WINDOW_START", "sin precios en esas fechas"],
      ["YOUNGEST_TO_REACH_THREE_YEARS", "tiene menos historia que el resto"],
      ["INSUFFICIENT_HISTORY", "sin historia suficiente"],
      ["FX_SERIES_MISSING", "sin conversión a euros"],
      ["FX_QUARANTINE", "sin conversión a euros fiable"],
      ["NON_INVESTABLE", "no es invertible"],
      ["DISTRIBUTES_WITHOUT_PAYMENTS", "reparte, y su serie no recoge lo que paga"]
    ])("%s dice lo suyo, y no una incidencia que no ha habido", (razon, frase) => {
      expect(motivoDeFueraParaElCliente(razon)).toBe(`Fuera del cálculo: ${frase}`);
      expect(frase).not.toContain("incidencia");
    });

    test("una serie parada (P1-06) se nombra con las palabras de la simulación", () => {
      expect(pinta(false, "SERIES_ENDS_EARLY")).toContain("Sus precios acaban antes del final del periodo");
      expect(pinta(true, "SERIES_ENDS_EARLY")).toContain("Fuera del cálculo: sin precios recientes");
    });

    test("una serie con un hueco dentro de la crisis (N03) dice que no cotizó durante parte de ella", () => {
      expect(pinta(false, "GAP_IN_WINDOW")).toContain("Sin cotizaciones durante parte de la crisis");
      expect(pinta(true, "GAP_IN_WINDOW")).toContain("Fuera del cálculo: sin cotizaciones durante parte de la crisis");
    });

    test("a un cliente no se le enseña un código que no se conoce", () => {
      expect(motivoDeFueraParaElCliente("ALGO_NUEVO")).toBe("Fuera del cálculo");
      expect(pinta(true, "ALGO_NUEVO")).not.toContain("ALGO_NUEVO");
      expect(pinta(false, "ALGO_NUEVO")).toContain("ALGO_NUEVO");
    });

    test("cada motivo que manda el servidor tiene su frase", () => {
      for (const razon of REASONS) expect(motivoDeFueraParaElCliente(razon)).not.toBe("Fuera del cálculo");
    });
  });

  test("sin escenarios dice que falta el dato, y no «N/D» (ANA-11)", () => {
    const html = renderToStaticMarkup(<HistoricalStressCards scenarios={null} />);
    expect(html).toContain("Falta el dato");
    expect(html).not.toContain("N/D");
    expect(html).toContain("Sin escenarios históricos disponibles");
  });

  test("explica un escenario sin datos con texto es-ES", () => {
    const noData = scenarios.map((scenario) => ({
      ...scenario,
      start_date: null,
      end_date: null,
      trough_date: null,
      drawdown_pct: null,
      duration_days: null,
      recovery_date: null,
      recovery_days: null,
      remaining_to_recover_pct: null,
      recovery_status: "NO_DATA" as const,
      worst_asset: null,
      reason: "INSUFFICIENT_COMMON_DATA" as const
    }));
    const html = renderToStaticMarkup(<HistoricalStressCards scenarios={noData} />);
    expect(html).toContain("No hay fechas comunes suficientes para calcular el escenario.");
  });

  /* 20-11-2026. En una tarjeta sin datos, «Falta el dato» salía de dos maneras: la duración y el activo que más restó, con la
     pieza de la ausencia, en ocre; la caída, la recuperación y las dos fechas del tramo, con el texto suelto, en la tinta de
     una cifra —la caída, además, al tamaño de una cifra grande—. Ahora lo escribe siempre la pieza. */
  describe("lo que falta lo escribe siempre la pieza, en ocre (ANA-11)", () => {
    const PIEZA = '<span class="ausencia ausencia--falta">Falta el dato</span>';
    const sinDatos: BacktestStressScenario[] = scenarios.map((scenario) => ({
      ...scenario, start_date: null, end_date: null, trough_date: null, drawdown_pct: null, duration_days: null, recovery_date: null,
      recovery_days: null, remaining_to_recover_pct: null, recovery_status: "NO_DATA" as const, worst_asset: null, reason: "INSUFFICIENT_COMMON_DATA" as const
    }));
    const pinta = (escenarios: BacktestStressScenario[] | null, modoCliente = false) => renderToStaticMarkup(
      <ClientModeProvider initialValue={modoCliente}><HistoricalStressCards scenarios={escenarios} positions={[{ asset_id: "BOND", weight_percent: 59.9 }, { asset_id: "NEW", weight_percent: 40.1 }]} /></ClientModeProvider>
    );
    const tarjetas = (html: string) => html.split('<article class="f5-stress-card"').slice(1);
    /** Lo que queda de «Falta el dato» fuera de la pieza: no puede quedar nada. */
    const sueltas = (html: string) => html.split(PIEZA).join("").match(/Falta el dato/g) ?? [];

    test("en una tarjeta sin datos: el tramo, la caída, la duración, la recuperación y el activo que más restó, las cinco con la pieza", () => {
      for (const tarjeta of tarjetas(pinta(sinDatos))) {
        expect(tarjeta.split(PIEZA).length - 1).toBe(5);
        expect(sueltas(tarjeta)).toEqual([]);
        /* El tramo se dice una vez, no «Falta el dato – Falta el dato». */
        expect(tarjeta).toContain(`<p>${PIEZA}</p></div>`);
        expect(tarjeta).toMatch(new RegExp(`<dt>Caída</dt><dd>${PIEZA}</dd>`));
        expect(tarjeta).toMatch(new RegExp(`<dt>Duración</dt><dd>${PIEZA}</dd>`));
        expect(tarjeta).toMatch(new RegExp(`<dt>Recuperación</dt><dd>${PIEZA}</dd>`));
        expect(tarjeta).toContain(`<h4>Activo que más restó</h4><p>${PIEZA}</p>`);
      }
    });

    test("en Modo cliente, lo mismo sin el activo que más restó: cuatro", () => {
      for (const tarjeta of tarjetas(pinta(sinDatos, true))) {
        expect(tarjeta.split(PIEZA).length - 1).toBe(4);
        expect(sueltas(tarjeta)).toEqual([]);
      }
    });

    test("con sus cifras, con una que no llega al 60 % y sin escenarios, tampoco queda ninguno suelto", () => {
      for (const html of [pinta(scenarios), pinta(scenarios, true), pinta(null)]) expect(sueltas(html)).toEqual([]);
      /* La historia común de la muestra no trae el activo que más restó: es su único hueco, y la que no llega al 60 % lleva el suyo. */
      expect(pinta(scenarios).split(PIEZA).length - 1).toBe(2);
    });

    test("una cifra que sí está se sigue escribiendo igual: fechas, días y lo que falta por recuperar", () => {
      const html = pinta(scenarios.map((scenario) => (scenario.id === "RATES_2022" ? { ...scenario, coverage: { ...scenario.coverage, weight_pct: 80 }, representative: true } : scenario)));
      expect(html).toContain("<p>03/01/2022 – 14/10/2022</p>");
      expect(html).toContain("<dd>284 días · mínimo 14/10/2022</dd>");
      expect(html).toMatch(/<dd>Sin recuperar · falta 3,20\s%<\/dd>/);
      expect(html).toContain("<dd>25 días · 18/04/2023</dd>");
      /* Y con la fecha del máximo, la historia común la dice delante del mínimo, en la misma frase. */
      const conMaximo = pinta(scenarios.map((scenario) => (scenario.id === "COMMON_HISTORY" ? { ...scenario, peak_date: "2020-02-19" } : scenario)));
      expect(conMaximo).toContain("<dd>1.178 días · máximo 19/02/2020 · mínimo 24/03/2023</dd>");
    });

    /* El servidor manda las dos fechas del tramo juntas, el mínimo con la duración y la fecha con la recuperación
       (`stress_analytics.py`); pero el adaptador admite cada campo vacío por separado, y entonces la parte que falta de una
       frase también la escribe la pieza, sin llevarse por delante la que sí está. */
    test.each([
      ["el tramo con una sola fecha", { end_date: null }, `<p>03/01/2022 – ${PIEZA}</p>`],
      ["el tramo sin su primera fecha", { start_date: null }, `<p>${PIEZA} – 14/10/2022</p>`],
      ["la duración sin la fecha del mínimo", { trough_date: null }, `<dd>284 días · mínimo ${PIEZA}</dd>`],
      ["la recuperación con días y sin fecha", { recovery_status: "RECOVERED" as const, recovery_days: 25, recovery_date: null, remaining_to_recover_pct: 0 }, `<dd>25 días · ${PIEZA}</dd>`]
    ])("si falta solo una parte de una frase, %s, esa parte la escribe la pieza y lo demás se queda", (_caso, cambio, esperado) => {
      const html = pinta(scenarios.map((scenario) => (scenario.id === "RATES_2022" ? { ...scenario, coverage: { ...scenario.coverage, weight_pct: 80 }, representative: true, ...cambio } : scenario)));
      expect(html).toContain(esperado);
      expect(sueltas(html)).toEqual([]);
      expect(html).not.toMatch(/null|undefined/);
    });

    test("si faltara lo que queda por recuperar, no se escribe media frase", () => {
      const html = pinta(scenarios.map((scenario) => (scenario.id === "RATES_2022" ? { ...scenario, coverage: { ...scenario.coverage, weight_pct: 80 }, representative: true, remaining_to_recover_pct: null } : scenario)));
      expect(html).toContain("<dd>Sin recuperar</dd>");
      expect(html).not.toContain("falta Falta");
    });

    /* P1-06 (21-11-2026): una crisis en la que la cartera no bajó de su primer día salía «recuperada» en 1 día, con un
       activo que restaba un 0,00 %. Ahora el servidor dice NO_DRAWDOWN, y lo que no aplica no se pinta como si faltara. */
    test("sin caída: la caída es un cero de verdad, y la duración, la recuperación y el activo que más restó no aplican", () => {
      const NO_APLICA = '<span class="ausencia ausencia--no-aplica">No aplica</span>';
      const sinCaida = scenarios.map((scenario) => (scenario.id === "COVID" ? {
        ...scenario, trough_date: "2020-02-19", drawdown_pct: 0, duration_days: 0, recovery_date: null, recovery_days: null,
        remaining_to_recover_pct: 0, recovery_status: "NO_DRAWDOWN" as const, worst_asset: null
      } : scenario));
      const covid = tarjetas(pinta(sinCaida))[0];
      expect(covid).toMatch(/<dt>Caída<\/dt><dd>0,00\s%<\/dd>/);
      expect(covid).toContain(`<dt>Duración</dt><dd>${NO_APLICA}</dd>`);
      expect(covid).toContain('<dt>Recuperación</dt><dd><span class="ausencia ausencia--no-aplica">Sin caída</span></dd>');
      expect(covid).toContain(`<h4>Activo que más restó</h4><p>${NO_APLICA}</p>`);
      expect(covid).not.toContain("Falta el dato");
      expect(covid).not.toContain("1 día");
    });
  });

  test("cada tarjeta lleva sus piezas en el orden del que depende la hoja para alinearlas (apartado 14.8 del sistema)", () => {
    /* La hoja reparte las piezas de una tarjeta, por lo que cada una es, en filas comunes a las tres: la cabecera; el
       motivo de que no haya datos; las cifras, o el párrafo que va en su lugar (`f5-stress-sin-cifra`); el activo que
       más restó; y, lo último, los excluidos. Sus reglas llevan `>`: valen para los hijos directos de la tarjeta, así
       que aquí se miran esos, no cualquier pieza de dentro. Si esto cambia, cambian con él las reglas de
       `.f5-stress-card` (`tests/hojasDelMarco.test.ts`). */
    const tarjetas = (html: string) => html.split('<article class="f5-stress-card"').slice(1).map((trozo) => trozo.slice(trozo.indexOf(">") + 1, trozo.indexOf("</article>")));
    /** Los hijos directos de un trozo de marcado: su etiqueta y sus clases, y el texto de su primer título si lo lleva. */
    const hijosDirectos = (marcado: string) => {
      const hijos: string[] = [];
      let hondo = 0;
      for (const hallada of marcado.matchAll(/<(\/?)([a-z][a-z0-9]*)((?:\s[^>]*)?)>/g)) {
        const [entera, cierra, etiqueta, atributos] = hallada;
        if (cierra) { hondo -= 1; continue; }
        if (hondo === 0) {
          const clases = atributos.match(/\sclass="([^"]*)"/)?.[1].split(" ").map((clase) => clase.replace(/^f5-stress-/, "")).join(".") ?? "";
          const titulo = marcado.slice(hallada.index + entera.length).match(/^<h4>([^<(]+)/)?.[1].trim();
          hijos.push(`${etiqueta}${clases ? "." + clases : ""}${titulo ? " «" + titulo + "»" : ""}`);
        }
        if (!atributos.endsWith("/")) hondo += 1;
      }
      expect(hondo).toBe(0);
      return hijos;
    };
    const sinDatos = scenarios.map((scenario) => ({
      ...scenario, start_date: null, end_date: null, trough_date: null, drawdown_pct: null, duration_days: null, recovery_date: null,
      recovery_days: null, remaining_to_recover_pct: null, recovery_status: "NO_DATA" as const, worst_asset: null, reason: "INSUFFICIENT_COMMON_DATA" as const
    }));
    const posiciones = [{ asset_id: "BOND", weight_percent: 59.9 }, { asset_id: "NEW", weight_percent: 40.1 }];
    const pinta = (escenarios: BacktestStressScenario[], modoCliente: boolean) => tarjetas(renderToStaticMarkup(
      <ClientModeProvider initialValue={modoCliente}><HistoricalStressCards scenarios={escenarios} positions={posiciones} /></ClientModeProvider>
    )).map(hijosDirectos);
    const conCifra = ["header", "dl.metrics", "div.detail «Activo que más restó»", "div.detail «Excluidos»"];

    /* Como llega: dos con su cifra y, en medio, la que no llega al 60 %, con su párrafo —y su clase— en el sitio de las
       cifras y sin el activo que más restó. */
    expect(pinta(scenarios, false)).toEqual([conCifra, ["header", "p.no-data.sin-cifra", "div.detail «Excluidos»"], conCifra]);
    /* En Modo cliente no está el activo que más restó. */
    expect(pinta(scenarios, true)).toEqual([
      ["header", "dl.metrics", "div.detail «Excluidos»"],
      ["header", "p.no-data.sin-cifra", "div.detail «Excluidos»"],
      ["header", "dl.metrics", "div.detail «Excluidos»"]
    ]);
    /* Sin datos: el motivo, sin la clase del otro párrafo, delante de las cifras. */
    expect(pinta(sinDatos, false)).toEqual(Array.from({ length: 3 }, () => ["header", "p.no-data", ...conCifra.slice(1)]));
    expect(pinta(sinDatos, true)).toEqual(Array.from({ length: 3 }, () => ["header", "p.no-data", "dl.metrics", "div.detail «Excluidos»"]));

    /* Y dentro de las cifras, las cuatro piezas en su orden: la hoja da su margen a la cuarta, que es la de la segunda
       fila. La historia común dice «Caída máxima» cuando trae la fecha de su máximo, y en Modo cliente la cuarta se
       llama «Calculado sobre». La de en medio, sin cifra, no lleva ninguna. */
    const rotulosDeLasCifras = (escenarios: BacktestStressScenario[], modoCliente: boolean) => renderToStaticMarkup(
      <ClientModeProvider initialValue={modoCliente}><HistoricalStressCards scenarios={escenarios} positions={posiciones} /></ClientModeProvider>
    ).split('<article class="f5-stress-card"').slice(1).map((trozo) => [...trozo.matchAll(/<dt>([^<]*)<\/dt>/g)].map((hallado) => hallado[1]));
    const conMaximo = scenarios.map((scenario) => (scenario.id === "COMMON_HISTORY" ? { ...scenario, peak_date: "2020-02-19" } : scenario));
    expect(rotulosDeLasCifras(conMaximo, false)).toEqual([["Caída", "Duración", "Recuperación", "Peso medido"], [], ["Caída máxima", "Duración", "Recuperación", "Peso medido"]]);
    expect(rotulosDeLasCifras(conMaximo, true)).toEqual([["Caída", "Duración", "Recuperación", "Calculado sobre"], [], ["Caída máxima", "Duración", "Recuperación", "Calculado sobre"]]);
  });
});
