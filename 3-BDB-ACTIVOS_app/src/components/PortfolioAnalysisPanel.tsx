import { useState } from "react";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbManualPortfolioSummary } from "../types/bdbAssets";
import { fetchPortfolioAnalysis, type PortfolioAnalysisResult } from "../adapters/analyzePortfolioBackend";
import { esUnaSolaAccion, idsConPeso, riesgoParaElAnalisisIA } from "../core/medidaDeLaCartera";
import { computePmsExposureDistribution } from "../core/portfolio";
import { usePortfolioHorizon } from "../core/usePortfolioHorizon";
import { useClientMode } from "../app/ClientModeContext";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { Button } from "./ui/Button";
import { MarkdownView } from "./MarkdownView";
import { Panel } from "./ui/Panel";

/** El backend solo lee las 30 primeras posiciones del payload (analyze_portfolio.py). */
const BACKEND_ANALYSIS_MAX_POSITIONS = 30;

interface PortfolioAnalysisPanelProps {
  positions: BdbManualPortfolioPosition[];
  summary: BdbManualPortfolioSummary | null;
  /** Con los detalles, el análisis viaja con agregados reales (S6a, P8/D6). */
  assets?: BdbAssetDetail[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function PortfolioAnalysisPanel({ positions, summary, assets }: PortfolioAnalysisPanelProps) {
  const [result, setResult] = useState<PortfolioAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { enabled: clientMode } = useClientMode();
  const hasWeights = positions.some((p) => (p.weight_percent ?? 0) > 0);
  const activeCount = positions.filter((p) => (p.weight_percent ?? 0) > 0).length;
  const truncated = activeCount > BACKEND_ANALYSIS_MAX_POSITIONS;
  const { data: horizonte } = usePortfolioHorizon(positions);

  async function run() {
    // Auditoría 27-07 (D6/P8): antes el modelo veía solo nombre+peso y el
    // diagnóstico salía genérico. Ahora viaja con los agregados que la app ya
    // calcula (reparto canónico por clases, regiones y el riesgo que mide la
    // simulación), y las posiciones van ordenadas por peso para que, si el
    // backend corta en 30, corte por las MENORES.
    const reqPositions = positions
      .filter((p) => (p.weight_percent ?? 0) > 0)
      .sort((a, b) => (b.weight_percent ?? 0) - (a.weight_percent ?? 0) || a.asset_id.localeCompare(b.asset_id))
      .map((p) => ({ asset_id: p.asset_id, weight: (p.weight_percent ?? 0) / 100, label: p.label }));
    if (reqPositions.length === 0) {
      return;
    }
    setLoading(true);
    setAttempted(true);
    setError(null);

    const assetById = new Map((assets ?? []).map((asset) => [asset.asset_id, asset]));
    const distribution = computePmsExposureDistribution(
      positions.flatMap((p) => {
        const asset = assetById.get(p.asset_id);
        return asset
          ? [{
              weight_percent: p.weight_percent || 0,
              pms_exposure: asset.pms_exposure,
              economic_asset_class: asset.economic_asset_class
            }]
          : [];
      })
    );
    const regionWeights = new Map<string, number>();
    positions.forEach((p) => {
      const weight = p.weight_percent ?? 0;
      if (weight <= 0) return;
      const region = assetById.get(p.asset_id)?.region;
      if (!region) return;
      regionWeights.set(region, (regionWeights.get(region) ?? 0) + weight);
    });
    const byRegionTop = Array.from(regionWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([region, weight]) => ({ region, weight_percent: round1(weight) }));

    const context: Record<string, unknown> = {
      position_count: reqPositions.length,
      ...(truncated
        ? { note: `El backend analiza las ${BACKEND_ANALYSIS_MAX_POSITIONS} mayores de ${reqPositions.length} posiciones.` }
        : {}),
      ...(summary ? { by_economic_asset_class: summary.by_economic_asset_class } : {}),
      ...riesgoParaElAnalisisIA(horizonte, { unaSolaAccion: esUnaSolaAccion(horizonte?.backtest.asset_ids ?? idsConPeso(positions), assets ?? []) }),
      ...(distribution
        ? {
            pms_exposure_percent: {
              equity: round1(distribution.percent.equity),
              fixed_income: round1(distribution.percent.fixed_income),
              cash: round1(distribution.percent.cash),
              alternative: round1(distribution.percent.alternative),
              real_asset: round1(distribution.percent.real_asset),
              other: round1(distribution.percent.other)
            },
            pms_exposure_coverage_percent: round1(distribution.covered_weight_percent)
          }
        : {}),
      ...(byRegionTop.length > 0 ? { by_region_top: byRegionTop } : {})
    };

    try {
      const res = await fetchPortfolioAnalysis(reqPositions, context);
      setResult(res);
    } catch (err) {
      setResult(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      acciones={
        <Button variant="primary" onClick={run} busy={loading} disabled={loading || !hasWeights}>
          {loading ? "Analizando…" : "Analizar con IA"}
        </Button>
      }
      className="simulation-panel portfolio-analysis-panel"
      estado={<span className="badge is-info">IA generativa</span>}
      subtitulo="Diagnóstico breve de la cartera generado por IA."
      titulo="Análisis IA"
    >

      {!hasWeights ? (
        <p className="portfolio-analysis-empty">Asigna pesos a la cartera para analizarla.</p>
      ) : error ? (
        <AsyncErrorBanner error={error} onRetry={run} />
      ) : loading ? (
        <p className="portfolio-analysis-empty">Generando análisis…</p>
      ) : result?.analysis ? (
        <div className="portfolio-analysis-result" aria-label="Texto generado por IA">
          <span>Lectura IA</span>
          {/* El backend devuelve markdown: renderizarlo como texto plano
              llenaba la lectura de asteriscos. Va dentro de un bloque, cuyo título es `h2`: sus títulos, desde `h3`. */}
          <MarkdownView nivel={3}>{result.analysis}</MarkdownView>
          {truncated ? (
            <p className="cmp-note">
              Análisis sobre las {BACKEND_ANALYSIS_MAX_POSITIONS} mayores posiciones (de {activeCount}); los
              agregados de contexto son de la cartera completa.
            </p>
          ) : null}
          {result.contextOmitted?.length ? (
            <p className="cmp-note">
              No cupieron en la petición a la IA estos datos de contexto: {result.contextOmitted.join(", ")}.
            </p>
          ) : null}
        </div>
      ) : attempted ? (
        <>
          {/* Una frase para quien mira la pantalla, que no dice «inténtalo más tarde» porque una clave que falta
              no se arregla sola. Qué ha pasado de verdad, solo para el asesor y a la vista. */}
          <p className="portfolio-analysis-warning">El análisis con IA no está disponible.</p>
          {!clientMode ? (
            <p className="asset-detail-muted">
              Detalle técnico:{" "}
              {result?.source === "NOT_CONFIGURED"
                ? "falta configurar GEMINI_API_KEY en Functions."
                : result?.note
                  ? `${result.source}: ${result.note}`
                  : "no hubo respuesta de analyze_portfolio; revisa su despliegue."}
            </p>
          ) : null}
        </>
      ) : (
        <p className="portfolio-analysis-empty">Pulsa «Analizar con IA» para un diagnóstico de la cartera.</p>
      )}
    </Panel>
  );
}
