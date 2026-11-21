import { useState, type ReactNode } from "react";
import { useModoCliente } from "../app/ClientModeContext";
import type { BdbAssetDetail, BdbAssetHoldings, BdbAssetSearchResult } from "../types/bdbAssets";
import { seEnsenaLaMetrica } from "../core/metricasPorInstrumento";
import { AssetDetailMetrics } from "./AssetDetailMetrics";
import { COSTE_DE_LOS_FUNDAMENTALES, costeCorrienteDeLaFicha } from "../core/costeCorrienteDeLaFicha";
import { AssetHistoryChart } from "./AssetHistoryChart";
import { AssetHoldingsSection } from "./AssetHoldingsSection";
import { AssetDetailWarnings } from "./AssetDetailWarnings";
import { importeGrande } from "../core/cifrasDeFicha";
import {
  ASSET_SECTION_LABELS,
  CLASS_LABELS,
  TYPE_LABELS,
  readableBackendLabel
} from "../core/labels";
import { etiquetaDeCodigo, estadoDeLosDatos, nombreDeLaReplica } from "../core/glosarioDePantalla";
import { coverageBadgeFor } from "../core/coverageBadge";
import { officialBenchmarkLine } from "../core/officialBenchmark";
import { SegmentedTabs } from "./ui/SegmentedTabs";
import { Cifra } from "./ui/Cifra";
import { PageHeader } from "./ui/PageHeader";
import { Respuesta } from "./ui/Respuesta";
import { fecha as fechaComun, oFalta, porcentaje, ratio, rentabilidad } from "../core/formato";
import { Ausencia } from "./ui/Ausencia";
import { Button } from "./ui/Button";
import { accionDeCarteraBloqueada, avisoDeAccionDeCartera, etiquetaDeAccionDeCartera, NO_SE_ANADE_SIN_MEDIR, nombreDeAccionDeCartera, sinPrecioNiMetricas } from "../core/accionDeCartera";
import { iconoDeAccionDeCartera } from "./ui/iconoDeAccionDeCartera";
import { sectorLegible } from "../core/fundSwapper";
import { categoriaLegible } from "../core/etiquetasDeReparto";

const HIDDEN_FLAGS = new Set(["PARTIAL_COVERAGE", "NON_INVESTABLE_BENCHMARK"]);

type AssetDetailTab = "summary" | "fundamentals" | "history" | "portfolio" | "costs" | "quality";

const ASSET_DETAIL_TABS: Array<{ id: AssetDetailTab; label: string }> = [
  { id: "summary", label: "Resumen" },
  { id: "fundamentals", label: "Fundamentales" },
  { id: "history", label: "Evolución histórica" },
  { id: "portfolio", label: "Cartera" },
  { id: "costs", label: "Costes" },
  { id: "quality", label: "Calidad" }
];

interface AssetDetailProps {
  asset: BdbAssetDetail;
  loadHoldings?: (assetId: string) => Promise<BdbAssetHoldings | null>;
  // Auditoría 11-08 (F1.2): la ficha era un callejón. Recibe por props los
  // manejadores de la cartera y la comparación para no tener que volver a la lista.
  onAddToPortfolio?: (asset: BdbAssetSearchResult) => void;
  onToggleCompare?: (assetId: string) => void;
  isInPortfolio?: boolean;
  isSelectedForComparison?: boolean;
  isCompareDisabled?: boolean;
}

function formatAvailability(asset: BdbAssetDetail): string {
  if (asset.role === "BENCHMARK" || !asset.is_investable) {
    return "Índice o no invertible";
  }

  return "Invertible";
}

function dataQualitySummaryText(summary: BdbAssetDetail["data_quality_summary"]): string {
  if (!summary) {
    return "";
  }
  if (typeof summary === "string") {
    return summary;
  }
  return `${etiquetaDeCodigo(summary.coverage_status)}; métricas ${summary.has_metrics ? "disponibles" : "no disponibles"}; ${summary.warnings_count} aviso(s).`;
}

/** Lo que falta se dice con la pieza común, nunca con «N/D». */
const FALTA = <Ausencia clase="falta" />;

function yesNo(value: boolean | undefined): ReactNode {
  if (value === undefined) {
    return FALTA;
  }
  return value ? "Sí" : "No";
}

/** Un múltiplo de valoración (PER, EV/EBITDA): un ratio, con su «x». */
function multiple(value: number | undefined): ReactNode {
  const escrito = ratio(value);
  return escrito === null ? FALTA : `${escrito}x`;
}

/**
 * Un importe grande en la divisa del activo, como el patrimonio de la ficha nueva (`importeGrande`): en millones,
 * «2.304,3 M€», y en billones por encima del billón, para que la ficha no desborde con capitalizaciones de doce cifras.
 */
function money(value: number | undefined, currency = "EUR"): ReactNode {
  if (typeof value !== "number" || !Number.isFinite(value)) return FALTA;
  return importeGrande(value, currency);
}

/** Un texto o, si no está, la pieza que dice que falta. */
const oAusencia = (texto: string | null | undefined): ReactNode => texto ?? FALTA;

export function AssetDetail({
  asset,
  loadHoldings,
  onAddToPortfolio,
  onToggleCompare,
  isInPortfolio = false,
  isSelectedForComparison = false,
  isCompareDisabled = false
}: AssetDetailProps) {
  const [pestana, setActiveTab] = useState<AssetDetailTab>("summary");
  /* Decisión 19: la calidad interna y de dónde viene cada dato no se enseñan delante del cliente. */
  const { seEnsena } = useModoCliente();
  const conCalidad = seEnsena("calidadInterna");
  const activeTab = (pestana === "quality" && !conCalidad) || (pestana === "costs" && !seEnsenaLaMetrica("costeCorriente", asset.instrument_type)) ? "summary" : pestana;
  const exposureItems = [
    { label: "RV", value: asset.pms_exposure.equity },
    { label: "RF", value: asset.pms_exposure.fixed_income },
    { label: "Liquidez", value: asset.pms_exposure.cash },
    { label: CLASS_LABELS.ALTERNATIVE, value: asset.pms_exposure.alternative },
    { label: "Otros/No clasificado", value: asset.pms_exposure.other }
  ];
  const visibleExposure = exposureItems.reduce((sum, item) => sum + (item.value || 0), 0);
  const hasHoldings = Boolean(asset.holdings_summary?.has_holdings);
  const fundamentals = asset.fundamentals_summary;
  /* ACT-07: un solo coste corriente, con su fuente (el mismo en Resumen y en Costes). */
  const coste = costeCorrienteDeLaFicha(asset);
  /* ACT-07: a una acción no le aplican los costes (decisión 17): no tiene pestaña de Costes. */
  const conCostes = seEnsenaLaMetrica("costeCorriente", asset.instrument_type);
  const detailTabs = ASSET_DETAIL_TABS.filter(
    (tab) =>
      (tab.id !== "fundamentals" || Boolean(fundamentals)) &&
      (tab.id !== "quality" || conCalidad) &&
      (tab.id !== "costs" || conCostes)
  );

  const coverageBadge = coverageBadgeFor(asset.coverage_status);
  const qualityChips = asset.quality_flags.filter((flag) => !HIDDEN_FLAGS.has(flag));
  const identityCode = asset.isin ?? asset.ticker ?? asset.asset_id;
  const identityLine = [identityCode, asset.provider, asset.region ?? categoriaLegible(asset.category)].filter(Boolean).join(" · ");
  const benchmarkLine = officialBenchmarkLine(asset.official_benchmark);
  const hasProductProfile = Boolean(
    asset.product_profile &&
      Object.values(asset.product_profile).some((value) => value !== undefined && value !== null && value !== "")
  );
  const hasSustainabilityProfile = Boolean(
    asset.sustainability_profile &&
      Object.values(asset.sustainability_profile).some((value) => value !== undefined && value !== null && value !== "")
  );
  const latestValue = asset.performance_preview?.latest_value;
  const rotuloDelUltimoValor = asset.instrument_type === "FUND" ? "Último valor liquidativo" : "Último precio";
  const latestDate =
    asset.performance_preview?.latest_value_date ??
    asset.official_metrics_envelope?.as_of_date ??
    asset.updated_at;

  return (
    <article className="asset-detail-panel">
      <div className="asset-detail-hero">
        {/* La misma cabecera y la misma banda que la ficha nueva (rediseño, paso 4), sin rehacer lo de dentro. */}
        <PageHeader
          actions={
            onAddToPortfolio || onToggleCompare ? (
              <>
                {onToggleCompare ? (
                  <Button disabled={isCompareDisabled} onClick={() => onToggleCompare(asset.asset_id)} variant="secondary">
                    {isSelectedForComparison ? "Quitar de la comparación" : "Comparar"}
                  </Button>
                ) : null}
                {/* Auditoría 11-08 (F1.2): el botón deshabilitado o «Añadido» cuando el activo ya está añadido. */}
                {onAddToPortfolio ? (
                  <Button
                    aria-label={`${nombreDeAccionDeCartera(asset, Boolean(isInPortfolio))}: ${asset.display_name}`}
                    disabled={accionDeCarteraBloqueada(asset, Boolean(isInPortfolio))}
                    icon={iconoDeAccionDeCartera(etiquetaDeAccionDeCartera(asset, Boolean(isInPortfolio)))}
                    onClick={() => onAddToPortfolio(asset)}
                    title={nombreDeAccionDeCartera(asset, Boolean(isInPortfolio))}
                    variant="primary"
                  >
                    {etiquetaDeAccionDeCartera(asset, Boolean(isInPortfolio))}
                  </Button>
                ) : null}
                {/* ACT-01 (14-11-2026): lo bloqueado por calidad del dato se puede añadir, y se avisa. */}
                {onAddToPortfolio && avisoDeAccionDeCartera(asset) ? <Ausencia clase="falta" motivo={avisoDeAccionDeCartera(asset)} /> : null}
              </>
            ) : undefined
          }
          actionsClassName="asset-card-actions"
          className="asset-detail-header"
          description={
            <>
              <span className="asset-detail-identity-line">{identityLine}</span>
              {" · "}
              {formatAvailability(asset)}
              {seEnsenaLaMetrica("morningstar", asset.instrument_type) && typeof asset.morningstar_rating === "number" && asset.morningstar_rating > 0 ? (
                <>
                  {" · "}
                  <span className="asset-detail-stars" aria-label={`Morningstar ${Math.round(asset.morningstar_rating)} de 5 estrellas`}>
                    {Array.from({ length: Math.min(5, Math.round(asset.morningstar_rating)) }).map((_, index) => (
                      <svg key={index} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" />
                      </svg>
                    ))}
                  </span>
                </>
              ) : null}
              {/* «(datos en vivo de BBDD-ACTIVOS)» lo escribe el adaptador: es cocina y no dice nada del activo. */}
              {asset.description ? <> · {asset.description.replace(/\s*\(datos en vivo de BBDD-ACTIVOS\)\.?$/, "")}</> : null}
            </>
          }
          eyebrow={[
            TYPE_LABELS[asset.instrument_type] ?? readableBackendLabel(asset.instrument_type),
            CLASS_LABELS[asset.economic_asset_class] ?? readableBackendLabel(asset.economic_asset_class),
            categoriaLegible(asset.category)
          ]
            .filter(Boolean)
            .join(" · ")}
          title={asset.display_name}
        />

        {/* ACT-07: el rótulo dice qué cifra es; sin precio, la rentabilidad en el año, y lo dice. */}
        <Respuesta
          datos={[
            typeof latestValue === "number"
              ? {
                  rotulo: rotuloDelUltimoValor,
                  /* Hallazgo 17: con la divisa de ESTE precio, que el servidor manda desde el 15-11-2026; en 15 de los 32 ETF la clase va en
                     dólares y el precio en euros. Un servidor anterior no la manda, y se queda la de la clase, como antes. */
                  cifra: <Cifra divisa={asset.performance_preview?.latest_value_currency || asset.currency || undefined} tipo="precio" valor={latestValue} />,
                  apunte: latestDate ? fechaComun(latestDate) ?? undefined : undefined
                }
              : asset.metrics.ytd_return !== undefined
                ? { rotulo: "Rentabilidad en el año", cifra: <Cifra tipo="rentabilidad" valor={asset.metrics.ytd_return} /> }
                : { rotulo: "Último dato", cifra: <Cifra tipo="precio" valor={null} /> },
            { rotulo: "Rentabilidad 1 año", cifra: <Cifra tipo="rentabilidad" valor={asset.metrics.annualized_return_1y} /> },
            { rotulo: "Rentabilidad anualizada 3 años", cifra: <Cifra tipo="rentabilidad" valor={asset.metrics.annualized_return_3y} /> },
            { rotulo: "Volatilidad 3 años", cifra: <Cifra tipo="porcentaje" valor={asset.metrics.volatility_3y} /> }
          ]}
          etiqueta={`Lo esencial de ${asset.display_name}`}
        />

        {asset.role === "BENCHMARK" || !asset.is_investable ? (
          <div className="benchmark-notice">
            {sinPrecioNiMetricas(asset) ? NO_SE_ANADE_SIN_MEDIR : "Activo de referencia: no se trata como posición invertible."}
          </div>
        ) : null}

        {conCalidad ? (
          <div className="asset-quality" aria-label="Calidad de datos">
            <span className={coverageBadge.cls ? `quality-badge ${coverageBadge.cls}` : "quality-badge"}>{coverageBadge.label}</span>
            {qualityChips.map((flag) => (
              <span key={flag} className="quality-chip">
                {etiquetaDeCodigo(flag)}
              </span>
            ))}
          </div>
        ) : null}

        <SegmentedTabs
          tabs={detailTabs}
          value={activeTab}
          onChange={setActiveTab}
          label="Secciones de la ficha"
          idPrefix="asset-detail"
        />
      </div>

      <div
        className="asset-detail-body"
        id={`asset-detail-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`asset-detail-tab-${activeTab}`}
      >
        {activeTab === "summary" ? (
          <>
            <AssetDetailMetrics asset={asset} />
            <div className="asset-detail-content-grid">
              <aside className="asset-detail-side-column asset-detail-summary-column" aria-label="Datos clave del activo">
                <section className="asset-detail-section" aria-labelledby="asset-detail-identity-title">
                  <h2 className="asset-detail-titulo" id="asset-detail-identity-title">Datos clave</h2>
                  <dl className="asset-detail-grid">
                    <div>
                      <dt>Identificador</dt>
                      <dd>{asset.asset_id}</dd>
                    </div>
                    <div>
                      <dt>Producto</dt>
                      <dd>{TYPE_LABELS[asset.instrument_type] ?? readableBackendLabel(asset.instrument_type)}</dd>
                    </div>
                    <div>
                      <dt>Clase de activo</dt>
                      <dd>{CLASS_LABELS[asset.economic_asset_class] ?? readableBackendLabel(asset.economic_asset_class)}</dd>
                    </div>
                    <div>
                      <dt>Divisa</dt>
                      <dd>{asset.currency}</dd>
                    </div>
                    {conCalidad ? (
                      <div>
                        <dt>Datos disponibles</dt>
                        <dd>{etiquetaDeCodigo(asset.coverage_status)}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Gestora / fuente</dt>
                      <dd>{asset.provider ?? FALTA}</dd>
                    </div>
                    <div>
                      <dt>Región</dt>
                      <dd>{asset.region ?? FALTA}</dd>
                    </div>
                    <div>
                      <dt>Categoría</dt>
                      <dd>{categoriaLegible(asset.category) ?? FALTA}</dd>
                    </div>
                    <div>
                      <dt>Sector</dt>
                      <dd>{sectorLegible(asset) ?? FALTA}</dd>
                    </div>
                    <div>
                      <dt>Estrategia</dt>
                      <dd>{asset.strategy ?? FALTA}</dd>
                    </div>
                    {benchmarkLine ? (
                      <div className="u-span-full">
                        <dt>Índice de referencia</dt>
                        <dd>{benchmarkLine}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>

                {hasProductProfile || hasSustainabilityProfile ? (
                  <section className="asset-detail-section" aria-labelledby="asset-detail-product-profile-title">
                    <h2 className="asset-detail-titulo" id="asset-detail-product-profile-title">Perfil del producto</h2>
                    <dl className="asset-detail-grid">
                      {hasProductProfile ? (
                        <>
                          <div>
                            {/* ACT-14: «Producto» es la palabra para fondo, ETF o acción; aquí, el producto como lo nombra el proveedor. */}
                            <dt>Producto</dt>
                            <dd>{asset.product_profile?.product_type ?? FALTA}</dd>
                          </div>
                          <div>
                            <dt>Domicilio</dt>
                            <dd>{asset.product_profile?.domicile ?? FALTA}</dd>
                          </div>
                          <div>
                            <dt>Clase</dt>
                            <dd>{asset.product_profile?.share_class ?? FALTA}</dd>
                          </div>
                          <div>
                            <dt>Política</dt>
                            <dd>{asset.product_profile?.distribution_policy ?? FALTA}</dd>
                          </div>
                          <div>
                            <dt>UCITS</dt>
                            <dd>{yesNo(asset.product_profile?.ucits)}</dd>
                          </div>
                          <div>
                            <dt>Inicio</dt>
                            <dd>{oAusencia(fechaComun(asset.product_profile?.inception_date))}</dd>
                          </div>
                          <div>
                            <dt>Réplica</dt>
                            <dd>{asset.product_profile?.replication ? nombreDeLaReplica(asset.product_profile.replication) : FALTA}</dd>
                          </div>
                          <div>
                            <dt>Estructura</dt>
                            <dd>{asset.product_profile?.legal_structure ?? FALTA}</dd>
                          </div>
                        </>
                      ) : null}
                      {hasSustainabilityProfile ? (
                        <>
                          <div>
                            <dt>SFDR</dt>
                            <dd>{asset.sustainability_profile?.sfdr ?? FALTA}</dd>
                          </div>
                          <div>
                            <dt>ESG</dt>
                            <dd>{asset.sustainability_profile?.esg_rating ?? FALTA}</dd>
                          </div>
                          <div>
                            <dt>Sostenibilidad</dt>
                            <dd>{asset.sustainability_profile?.sustainability_rating ?? FALTA}</dd>
                          </div>
                        </>
                      ) : null}
                    </dl>
                  </section>
                ) : null}
              </aside>
            </div>
          </>
        ) : null}

        {activeTab === "fundamentals" && fundamentals ? (
          <div className="asset-detail-content-grid">
            <div className="asset-detail-main-column">
              {fundamentals.valuation ? (
                <section className="asset-detail-section" aria-labelledby="asset-detail-fundamentals-valuation-title">
                  <h2 className="asset-detail-titulo" id="asset-detail-fundamentals-valuation-title">Valoración</h2>
                  <dl className="asset-detail-grid">
                    <div><dt>Capitalización</dt><dd>{money(fundamentals.valuation.market_cap, fundamentals.currency ?? asset.currency)}</dd></div>
                    <div><dt>Valor de empresa</dt><dd>{money(fundamentals.valuation.enterprise_value, fundamentals.currency ?? asset.currency)}</dd></div>
                    <div><dt>PER</dt><dd>{multiple(fundamentals.valuation.pe_trailing)}</dd></div>
                    <div><dt>PER adelantado</dt><dd>{multiple(fundamentals.valuation.pe_forward)}</dd></div>
                    <div><dt>PEG</dt><dd>{multiple(fundamentals.valuation.peg)}</dd></div>
                    <div><dt>Precio / ventas</dt><dd>{multiple(fundamentals.valuation.price_sales_ttm)}</dd></div>
                    <div><dt>Precio / valor contable</dt><dd>{multiple(fundamentals.valuation.price_book_mrq)}</dd></div>
                    <div><dt>EV / EBITDA</dt><dd>{multiple(fundamentals.valuation.ev_ebitda)}</dd></div>
                  </dl>
                </section>
              ) : null}

              {fundamentals.profitability || fundamentals.growth ? (
                <section className="asset-detail-section" aria-labelledby="asset-detail-fundamentals-quality-title">
                  <h2 className="asset-detail-titulo" id="asset-detail-fundamentals-quality-title">Rentabilidad y crecimiento</h2>
                  <dl className="asset-detail-grid">
                    {/* Márgenes y rendimientos contables, dos decimales y en tinta; el crecimiento es la variación de un periodo, con su signo. */}
                    <div><dt>Margen neto</dt><dd><Cifra tipo="porcentaje" valor={fundamentals.profitability?.profit_margin} /></dd></div>
                    <div><dt>Margen operativo</dt><dd><Cifra tipo="porcentaje" valor={fundamentals.profitability?.operating_margin_ttm} /></dd></div>
                    <div><dt>ROA</dt><dd><Cifra tipo="porcentaje" valor={fundamentals.profitability?.return_on_assets_ttm} /></dd></div>
                    <div><dt>ROE</dt><dd><Cifra tipo="porcentaje" valor={fundamentals.profitability?.return_on_equity_ttm} /></dd></div>
                    <div><dt>Crecimiento de ingresos</dt><dd><Cifra tipo="rentabilidad" valor={fundamentals.growth?.quarterly_revenue_yoy} /></dd></div>
                    <div><dt>Crecimiento de beneficios</dt><dd><Cifra tipo="rentabilidad" valor={fundamentals.growth?.quarterly_earnings_yoy} /></dd></div>
                  </dl>
                </section>
              ) : null}

              {fundamentals.fund_metrics ? (
                <section className="asset-detail-section" aria-labelledby="asset-detail-etf-fundamentals-title">
                  <h2 className="asset-detail-titulo" id="asset-detail-etf-fundamentals-title">Datos del ETF</h2>
                  <dl className="asset-detail-grid">
                    <div><dt>Patrimonio</dt><dd>{money(fundamentals.fund_metrics.total_assets, fundamentals.currency ?? asset.currency)}</dd></div>
                    {/* En puntos (2,5 = 2,5 %): se pasan a fracción. */}
                    <div><dt>Rentabilidad por dividendo</dt><dd><Cifra tipo="porcentaje" valor={typeof fundamentals.fund_metrics.yield_pct === "number" ? fundamentals.fund_metrics.yield_pct / 100 : null} /></dd></div>
                    <div><dt>Rotación</dt><dd><Cifra tipo="porcentaje" valor={typeof fundamentals.fund_metrics.turnover_pct === "number" ? fundamentals.fund_metrics.turnover_pct / 100 : null} /></dd></div>
                    <div><dt>Número de posiciones</dt><dd>{typeof fundamentals.holdings_summary?.positions_count === "number" ? <Cifra tipo="numero" valor={fundamentals.holdings_summary.positions_count} /> : (fundamentals.holdings_summary?.positions_count ?? null) === null ? FALTA : String(fundamentals.holdings_summary?.positions_count)}</dd></div>
                    <div><dt>Datos de posiciones</dt><dd>{estadoDeLosDatos(fundamentals.holdings_summary?.coverage_status) ?? FALTA}</dd></div>
                  </dl>
                </section>
              ) : null}
            </div>
            <aside className="asset-detail-side-column" aria-label="Procedencia de fundamentales">
              <section className="asset-detail-section">
                <h2 className="asset-detail-titulo">Procedencia</h2>
                <dl className="asset-detail-grid">
                  {seEnsena("fuenteDeDatos") ? <div><dt>Fuente</dt><dd>{fundamentals.source.toUpperCase()}</dd></div> : null}
                  <div><dt>Fecha de referencia</dt><dd>{oAusencia(fechaComun(fundamentals.as_of_date))}</dd></div>
                  {conCalidad ? <div><dt>Datos disponibles</dt><dd>{estadoDeLosDatos(fundamentals.coverage_status) ?? FALTA}</dd></div> : null}
                  <div><dt>Divisa</dt><dd>{fundamentals.currency ?? asset.currency}</dd></div>
                </dl>
              </section>
            </aside>
          </div>
        ) : null}

        {activeTab === "history" ? <AssetHistoryChart asset={asset} /> : null}

        {activeTab === "portfolio" ? (
          <div className="asset-detail-content-grid">
            <div className="asset-detail-main-column">
              {hasHoldings ? (
                <AssetHoldingsSection asset={asset} loadHoldings={loadHoldings} />
              ) : (
                <section className="asset-detail-section" aria-labelledby="asset-detail-holdings-empty-title">
                  <h2 className="asset-detail-titulo" id="asset-detail-holdings-empty-title">Cartera</h2>
                  <p className="asset-detail-muted">Posiciones subyacentes completas no disponibles para esta ficha.</p>
                </section>
              )}
            </div>
            <aside className="asset-detail-side-column" aria-label="Exposición del activo">
              <section className="asset-detail-section" aria-labelledby="asset-detail-exposure-title">
                <h2 className="asset-detail-titulo" id="asset-detail-exposure-title">Exposición por clase</h2>
                <dl className="asset-detail-grid">
                  {exposureItems.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd><Cifra tipo="peso" valor={item.value} /></dd>
                    </div>
                  ))}
                </dl>
                {visibleExposure < 0.95 ? <span className="quality-chip">Exposición incompleta</span> : null}
              </section>
            </aside>
          </div>
        ) : null}

        {activeTab === "costs" ? (
          <section className="asset-detail-section" aria-labelledby="asset-detail-costs-title">
            <h2 className="asset-detail-titulo" id="asset-detail-costs-title">Costes</h2>
            <dl className="asset-detail-grid">
              <div>
                <dt>Coste corriente</dt>
                <dd>{coste && porcentaje(coste.valor) ? `${porcentaje(coste.valor)}${coste.deLosFundamentales ? COSTE_DE_LOS_FUNDAMENTALES : ""}` : FALTA}</dd>
              </div>
              <div>
                <dt>Comisión de gestión</dt>
                <dd><Cifra tipo="porcentaje" valor={asset.costs?.management_fee} /></dd>
              </div>
            </dl>
          </section>
        ) : null}

        {activeTab === "quality" ? (
          <div className="asset-detail-content-grid">
            <div className="asset-detail-main-column">
              <section className="asset-detail-section" aria-labelledby="asset-detail-enriched-title">
                <h2 className="asset-detail-titulo" id="asset-detail-enriched-title">Datos enriquecidos</h2>
                <dl className="asset-detail-grid">
                  {asset.data_quality_summary && (
                    <div className="u-span-full">
                      <dt>Calidad de datos</dt>
                      <dd>{dataQualitySummaryText(asset.data_quality_summary)}</dd>
                    </div>
                  )}
                  {asset.available_sections && asset.available_sections.length > 0 && (
                    <div className="u-span-full">
                      <dt>Secciones disponibles</dt>
                      <dd>{asset.available_sections.map((section) => ASSET_SECTION_LABELS[section] ?? readableBackendLabel(section)).join(", ")}</dd>
                    </div>
                  )}
                  {asset.performance_preview?.available && (
                    <div className="u-span-full">
                      <dt>Métricas de rentabilidad y riesgo</dt>
                      <dd>
                        Volatilidad: {oFalta(porcentaje(asset.performance_preview.volatility_3y))} ·{" "}
                        Rentabilidad anualizada: {oFalta(rentabilidad(asset.performance_preview.annualized_return_3y))}
                      </dd>
                    </div>
                  )}
                  {!asset.data_quality_summary && (!asset.available_sections || asset.available_sections.length === 0) && !asset.performance_preview?.available && (
                    <div className="u-span-full">
                      <dt>Sin datos enriquecidos</dt>
                      <dd>{FALTA}</dd>
                    </div>
                  )}
                </dl>
              </section>
            </div>
            <aside className="asset-detail-side-column" aria-label="Avisos del activo">
              <AssetDetailWarnings asset={asset} />
            </aside>
          </div>
        ) : null}
      </div>
    </article>
  );
}
