import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePortfolioHorizon, resolveHorizonMetrics } from "../src/adapters/portfolioHorizon";
import { HorizonMetrics } from "../src/components/PortfolioHorizonPanel";
import { informeDeClienteMetricRows, createInformeDeClientePdfBlob } from "../src/reports/informeDeClientePdf";
import { extractPdfPageTexts } from "./support/pdfText";
import type { PortfolioFeasibilityCheck } from "../src/core/portfolioConstraints";
import { buildMonteCarloProjection } from "../src/core/monteCarloProjection";
import type { BdbPortfolioReport } from "../src/types/bdbAssets";

function raw(years:3|5) {
  const first=Date.UTC(2026-years,8,1);
  const portfolio_series=Array.from({length:years*52+2},(_,i)=>({date:new Date(first+i*7*86400000).toISOString().slice(0,10),value:100*Math.exp(.002*i+.015*Math.sin(i))}));
  const backtest={ schema_version:"backtest.v1",base_currency:"EUR",window:`${years}Y`,units:"decimal",frequency:"WEEKLY",metrics_frequency:"WEEKLY",max_drawdown_frequency:"WEEKLY",
    metrics:{cagr:.1234,volatility:.0812,sharpe:1.18,max_drawdown:-.104,rf_rate:.02},portfolio_series,
    asset_ids:["ETF"],weights_normalized:{ETF:1},correlation_matrix:[[1]],benchmark_series:{},synthetics:[],
    coverage:{requested_assets:1,included_assets:1,common_observations:portfolio_series.length,first_date:portfolio_series[0].date,last_date:portfolio_series.at(-1)!.date},excluded_assets:[],warnings:[] };
  return {schema_version:"portfolio-horizon.v1",window:`${years}Y`,horizon_years:years,reference_version:"test",backtest,equal_weight:backtest,max_sharpe:null,frontier:null,
    coverage_weight_percent:100,extensions:[{asset_id:"ETF",reference:"Referencia EUR",url:"https://stoxx.com/",estimated_from:portfolio_series[0].date,estimated_until:"2025-02-07",observed_from:"2025-02-10",validation_weeks:80,holdout_correlation:.97,residual_volatility:.08}],methodology:"Estimación"};
}

describe("Análisis con periodo común",()=>{
  test.each([3,5] as const)("pantalla y PDF enseñan las mismas cuatro cifras a %i años, cada uno con sus rótulos",(years)=>{
    const analysis=parsePortfolioHorizon(raw(years),`${years}Y`);
    const resolved=resolveHorizonMetrics(analysis);
    const html=renderToStaticMarkup(createElement(HorizonMetrics,{analysis}));
    const rows=informeDeClienteMetricRows({} as BdbPortfolioReport,analysis);
    for (const metric of [resolved.cagr,resolved.volatility,resolved.sharpe,resolved.maxDrawdown]) {
      expect(rows.some((r)=>r.label===metric.label)).toBe(true);
    }
    /* El glosario (decisión 28): en la pantalla y en lo que lee el cliente (decisión 4), sin CAGR. */
    for (const metric of [resolved.cagr,resolved.maxDrawdown]) expect(metric.label).not.toMatch(/CAGR|Máx\./);
    for (const nombre of ["Rentabilidad anualizada","Volatilidad","Sharpe","Caída máxima"]) {
      expect(html).toContain(`${nombre} ${years} años`);
    }
    expect(html).not.toContain("CAGR");
    /* La casilla dice lo mismo que la tabla de al lado (apartado 6 de SISTEMA_DISENO.md): la rentabilidad, con dos decimales y su signo. */
    expect(html).toContain("+12,34\u00a0%"); expect(html).not.toContain("1.234");
    /* Es una simulación con los pesos de hoy, y lo dice: el sello del papel es otro hasta que se decida. */
    expect(html).toContain("Simulación: pesos de hoy");
    expect(html).toContain("sin reequilibrar, netos de gastos de los fondos, antes de asesoramiento e impuestos");
    expect(html).not.toContain("Histórico observado");
    expect(rows[0].value).toContain("12,3");
    const projection=buildMonteCarloProjection(analysis.backtest.portfolio_series,"WEEKLY",years);
    expect(projection?.horizonYears).toBe(years);
    expect(projection?.points.at(-1)?.step).toBe(years*52);
  });
  test("rechaza una respuesta de otro periodo y una ventana reducida",()=>{
    expect(()=>parsePortfolioHorizon(raw(3),"5Y")).toThrow(/periodo/);
    const response=raw(5);response.backtest.coverage.first_date="2025-02-10";
    expect(()=>parsePortfolioHorizon(response,"5Y")).toThrow(/completo/);
  });
  test("rechaza comparativas con distinto universo",()=>{
    const response=raw(3);response.equal_weight={...response.backtest,asset_ids:["OTRO"]};
    expect(()=>parsePortfolioHorizon(response,"3Y")).toThrow(/activos/);
  });
  test.each([3,5] as const)("el PDF generado conserva horizonte, cifras, referencia y numeración a %i años", async (years)=>{
    const analysis=parsePortfolioHorizon(raw(years),`${years}Y`);
    const report={ portfolio_name:"Prueba de periodo",mode:"BBDD_STATIC_EXPORT_SAMPLE",
      summary:{by_instrument_type:[{key:"ETF",weight_percent:100}],by_economic_asset_class:[{key:"EQUITY",weight_percent:100}],weighted_metrics:{}},
      positions:[{asset_id:"ETF",display_name:"Activo con referencia",instrument_type:"ETF",economic_asset_class:"EQUITY",weight_percent:100,
        pms_exposure:{equity:1,fixed_income:0,cash:0,alternative:0,other:0}}],
      warnings:[],xray:{by_region:[]},data_diagnostic:{}
    } as unknown as BdbPortfolioReport;
    const blob=await createInformeDeClientePdfBlob({report,analysis,totalCapital:100000,
      generadoEn:"2026-09-06T12:00:00Z",
      feasibility:{} as PortfolioFeasibilityCheck});
    const pages=extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()));
    const text=pages.join(" ");
    /* Los rótulos de la tira van en mayúsculas al imprimir, y «3 años» no se parte. */
    const plano=text.toUpperCase().replace(/\s+/g," ");
    expect(plano).toContain(`RENTABILIDAD ANUALIZADA ${years} AÑOS`);
    expect(plano).toContain(`CAÍDA MÁXIMA ${years} AÑOS`);
    expect(plano).not.toContain("CAGR");
    expect(text).not.toContain("Monte Carlo");
    expect(text).toContain("Cómo se habría comportado esta composición en crisis pasadas");
    /* Las cifras con el formato común (paso 9): rentabilidad con dos decimales y su signo. */
    expect(text).toContain("+12,34 %");
    expect(text).toContain("Referencia EUR");
    expect(text).toContain("No equivale a una inversión realizable");
    expect(text).not.toContain("estimado por composición");
    expect(text).not.toContain("salen de la composición de la cartera");
    pages.forEach((page,i)=>expect(page).toContain(`Página ${i+1} de ${pages.length}`));
  },15_000);
});
