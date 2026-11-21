import "../styles/analisis.css";
import { useMemo } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { EmptyState, LoadingState } from "../components/ui/AsyncState";
import { Button } from "../components/ui/Button";
import { Esqueleto } from "../components/ui/Esqueleto";
import { PageHeader } from "../components/ui/PageHeader";
import { PortfolioReport } from "../components/PortfolioReport";
import { computeEquityRegionAllocation } from "../core/equityRegions";
import type { PortfolioFeasibilityCheck } from "../core/portfolioConstraints";
import { useReportLookThrough, viabilidadDelInforme } from "../core/reportPipeline";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbPortfolioReport,
  BdbSavedLocalPortfolio
} from "../types/bdbAssets";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { PerfilYHorizonte } from "../core/perfilYHorizonte";
import { useAsyncData } from "../core/useAsyncData";

interface PortfolioReportPageProps {
  positions: BdbManualPortfolioPosition[];
  sourceKind: AssetDataSourceKind;
  lockedWeights?: Record<string, number>;
  totalCapital?: number;
  /** B6: nombre real de la cartera activa; sin él, el de la fuente. */
  portfolioName?: string;
  onPortfolioNameChange?: (name: string) => void;
  /** Las carteras guardadas: la comparativa necesita dos. */
  savedPortfolios?: readonly BdbSavedLocalPortfolio[];
  /** El nivel de perfil y el horizonte de la cartera activa, para la portada del informe de cliente. */
  perfilYHorizonte?: PerfilYHorizonte;
  onBack: () => void;
}

export function PortfolioReportPage({
  positions,
  sourceKind,
  lockedWeights,
  totalCapital,
  portfolioName,
  onPortfolioNameChange,
  savedPortfolios,
  perfilYHorizonte,
  onBack
}: PortfolioReportPageProps) {
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);

  const load = useAsyncData<{
    report: BdbPortfolioReport;
    assets: BdbAssetDetail[];
    feasibility: PortfolioFeasibilityCheck;
  }>(
    async () => {
      const [nextReport, assets] = await Promise.all([
        dataSource.buildManualPortfolioReport(positions, portfolioName),
        dataSource.getComparableAssets(positions.map((position) => position.asset_id))
      ]);
      // S6b (P6): pipeline compartido con XrayPage — antes cada página
      // repetía el perfil RISK_5 incrustado por su cuenta.
      return { report: nextReport, assets, feasibility: viabilidadDelInforme({ positions, assets, lockedWeights }) };
    },
    [dataSource, lockedWeights, portfolioName, positions],
    { enabled: positions.length > 0 }
  );
  const report = load.data?.report ?? null;
  const assets = useMemo(() => load.data?.assets ?? [], [load.data?.assets]);
  const feasibility = load.data?.feasibility ?? null;
  /* En esta pantalla ya no se pinta: es del informe completo, que la imprime. */
  const { lookThroughLoad } = useReportLookThrough({
    dataSource,
    positions,
    assets,
    ready: Boolean(report && assets.length > 0 && positions.length > 0)
  });
  // P3.2: la MISMA distribución canónica de regiones que usan Resumen y X-Ray
  // (XrayPage hace idéntica llamada para su PDF); viaja al generador del informe de cliente.
  const regiones = useMemo(() => computeEquityRegionAllocation(positions, assets), [positions, assets]);

  if (positions.length === 0) {
    return (
      <section className="informes">
        <PageHeader eyebrow="Propuesta" title="Informes" description="Los documentos que se pueden entregar de esta propuesta, y lo que les falta." />
        {/* U-17: sin «Volver a…» dentro del flujo (el menú navega); el estado vacío ofrece su acción de ir a Diseño. */}
        <EmptyState
          action={<Button onClick={onBack} variant="primary">Ir a Diseño</Button>}
          description="Añade posiciones en Diseño para preparar sus documentos."
          nivel={2}
          title="La propuesta todavía está vacía"
        />
      </section>
    );
  }

  if (!report || !feasibility) {
    return (
      /* ANA-08: la cabecera también mientras carga y con el error, para que la pantalla no salte y diga dónde se está; y si la carga
         ha fallado, el error con su «Reintentar» y no un «Preparando…» que ya no va a terminar. */
      <section className="informes">
        <PageHeader eyebrow="Propuesta" title="Informes" description="Los documentos que se pueden entregar de esta propuesta, y lo que les falta." />
        {load.error ? (
          <AsyncErrorBanner error={load.error} onRetry={load.retry} />
        ) : (
          <div className="stack stack--3" aria-busy="true">
            <LoadingState>Preparando los documentos de la propuesta…</LoadingState>
            <Esqueleto alto={240} />
          </div>
        )}
      </section>
    );
  }

  return (
    <PortfolioReport
      originalPositions={positions}
      assets={assets}
      feasibility={feasibility}
      lockedWeights={lockedWeights}
      lookThrough={lookThroughLoad.data}
      onIrADiseno={onBack}
      onPortfolioNameChange={onPortfolioNameChange}
      portfolioName={portfolioName}
      report={report}
      savedPortfolios={savedPortfolios}
      totalCapital={totalCapital}
      regionRows={regiones.rows}
      perfilYHorizonte={perfilYHorizonte}
    />
  );
}
