import type { BdbAssetDetail } from "../types/bdbAssets";
import { maxDrawdownMetric } from "../core/assetMetrics";
import { caidaEnPantalla } from "../core/glosarioDePantalla";
import { COSTE_DE_LOS_FUNDAMENTALES, costeCorrienteDeLaFicha } from "../core/costeCorrienteDeLaFicha";
import { fecha, oFalta, porcentaje } from "../core/formato";
import { seEnsenaLaMetrica, type MetricaDeInstrumento } from "../core/metricasPorInstrumento";
import { Ausencia } from "./ui/Ausencia";
import { Cifra, type TipoDeCifra } from "./ui/Cifra";

interface AssetDetailMetricsProps {
  asset: BdbAssetDetail;
}

export function AssetDetailMetrics({ asset }: AssetDetailMetricsProps) {
  const m = asset.metrics;
  const dd = maxDrawdownMetric(m);
  const coste = costeCorrienteDeLaFicha(asset);
  /* Cada cifra con lo que es (apartado 6 de SISTEMA_DISENO.md): la rentabilidad con signo y color; la volatilidad, la caída y
     los costes con dos decimales y en tinta; el Sharpe, un ratio; el indicador de riesgo, un número entero. */
  const items: { label: string; value: number | undefined; tipo: TipoDeCifra; metrica?: MetricaDeInstrumento; nota?: string }[] = [
    { label: "Rentabilidad anualizada 3 años", value: m.annualized_return_3y, tipo: "rentabilidad" },
    { label: "Volatilidad 3 años", value: m.volatility_3y, tipo: "porcentaje" },
    { label: "Sharpe 3 años", value: m.sharpe_3y, tipo: "ratio", metrica: "sharpe" },
    { label: caidaEnPantalla(dd.label), value: dd.value, tipo: "porcentaje" },
    { label: m.risk_score_source === "SRI_KID" ? "Indicador de riesgo (SRI del KID)"
        : m.risk_score_source === "SRRI" ? "Indicador de riesgo (SRRI)"
        : m.risk_score_source === "VOL_BUCKET" ? "Riesgo estimado por volatilidad"
        : "Indicador de riesgo", value: m.risk_score, tipo: "numero" },
    {
      label: "Coste corriente",
      value: coste?.valor,
      tipo: "porcentaje",
      metrica: "costeCorriente",
      nota: coste?.deLosFundamentales ? COSTE_DE_LOS_FUNDAMENTALES : undefined
    },
    /* Una acción no tiene gestora: su comisión de gestión no aplica, como su coste corriente (decisión 17). */
    { label: "Comisión de gestión", value: asset.costs?.management_fee, tipo: "porcentaje", metrica: "costeCorriente" }
  ];

  const histNote = dd.date ? `${caidaEnPantalla(dd.label)}: ${oFalta(porcentaje(dd.value))} · ${oFalta(fecha(dd.date))}` : "";

  return (
    <section className="asset-detail-section asset-detail-kpis" aria-labelledby="asset-detail-metrics-title">
      <h2 className="asset-detail-titulo" id="asset-detail-metrics-title">Métricas</h2>
      <dl className="asset-detail-grid">
        {items.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>
              {metric.metrica && !seEnsenaLaMetrica(metric.metrica, asset.instrument_type) ? (
                <Ausencia clase="no-aplica" />
              ) : (
                <>
                  <Cifra tipo={metric.tipo} valor={metric.value} />
                  {metric.nota ?? null}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {histNote && (
        <p className="asset-detail-hist-note" title="Peor caída desde 2011; fuera de la ventana de 5 años por ser un evento excepcional">
          {histNote}
        </p>
      )}
    </section>
  );
}
