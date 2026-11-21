import { bloqueadoPorCalidadDelDato, isInvestableAsset } from "./assetMapping";
import { maxDrawdownMetric } from "./assetMetrics";
import { caidaEnPantalla, ETIQUETAS_DE_CALIDAD } from "./glosarioDePantalla";
import { oFalta, peso } from "./formato";
import { CLASS_LABELS, readableBackendLabel } from "./labels";
import { avisosDeComprobar, cifrasDelProveedorEnOtraDivisa, estadoDeLaVolatilidad } from "./medidaDeLaCartera";
import { seEnsenaLaMetrica } from "./metricasPorInstrumento";
import { clampPercent, roundPercent } from "./portfolio";
import { clonePreviewMetricsBoundary } from "./previewMetricsBoundary";
import type {
  BdbAssetDataSourceKind,
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbManualPortfolioSummary,
  BdbRiskProfileContract,
  BdbRiskProfileId,
  BdbRiskProfilePreview,
  BdbRiskProfilePreviewExcludedAsset
} from "../types/bdbAssets";

export const RISK_PROFILE_CONTRACTS: BdbRiskProfileContract[] = [
  {
    risk_profile_id: "RISK_1",
    risk_profile_label: "Nivel 1 - Preservación",
    level: 1,
    indicative_time_horizon: "Muy corto plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia muy baja a volatilidad y caídas",
    informative_constraints: ["Prioriza estabilidad informativa", "No implica bloqueo de cartera"],
    status: "PREVIEW_ONLY"
  },
  {
    risk_profile_id: "RISK_2",
    risk_profile_label: "Nivel 2 - Prudente",
    level: 2,
    indicative_time_horizon: "Corto plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia baja a volatilidad y caídas",
    informative_constraints: ["Lectura prudente de riesgo", "No implica cambio operativo"],
    status: "PREVIEW_ONLY"
  },
  {
    risk_profile_id: "RISK_3",
    risk_profile_label: "Nivel 3 - Moderado bajo",
    level: 3,
    indicative_time_horizon: "Corto/medio plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia baja-media a volatilidad y caídas",
    informative_constraints: ["Lectura informativa de oscilaciones", "No implica filtro regulatorio"],
    status: "PREVIEW_ONLY"
  },
  {
    risk_profile_id: "RISK_4",
    risk_profile_label: "Nivel 4 - Moderado",
    level: 4,
    indicative_time_horizon: "Medio plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia media a volatilidad y caídas",
    informative_constraints: ["Contraste de métricas disponibles", "No implica dictamen"],
    status: "PREVIEW_ONLY"
  },
  {
    risk_profile_id: "RISK_5",
    risk_profile_label: "Nivel 5 - Equilibrado",
    level: 5,
    indicative_time_horizon: "Medio plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia media a volatilidad y caídas",
    informative_constraints: ["Lectura equilibrada de señales", "No implica recomendación personalizada"],
    status: "PREVIEW_ONLY"
  },
  {
    risk_profile_id: "RISK_6",
    risk_profile_label: "Nivel 6 - Equilibrado dinámico",
    level: 6,
    indicative_time_horizon: "Medio/largo plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia media-alta a volatilidad y caídas",
    informative_constraints: ["Puede admitir mayor oscilación informativa", "No implica optimización real"],
    status: "PREVIEW_ONLY"
  },
  {
    risk_profile_id: "RISK_7",
    risk_profile_label: "Nivel 7 - Dinámico",
    level: 7,
    indicative_time_horizon: "Largo plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia alta a volatilidad y caídas",
    informative_constraints: ["Lectura dinámica de riesgo", "No implica propuesta de pesos"],
    status: "PREVIEW_ONLY"
  },
  {
    risk_profile_id: "RISK_8",
    risk_profile_label: "Nivel 8 - Crecimiento",
    level: 8,
    indicative_time_horizon: "Largo plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia alta a oscilaciones relevantes",
    informative_constraints: ["Mayor sensibilidad a concentración", "No implica decisión regulatoria"],
    status: "PREVIEW_ONLY"
  },
  {
    risk_profile_id: "RISK_9",
    risk_profile_label: "Nivel 9 - Agresivo",
    level: 9,
    indicative_time_horizon: "Muy largo plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia muy alta a volatilidad y caídas",
    informative_constraints: ["Lectura agresiva solo informativa", "No implica orden ni asesoramiento"],
    status: "PREVIEW_ONLY"
  },
  {
    risk_profile_id: "RISK_10",
    risk_profile_label: "Nivel 10 - Muy agresivo",
    level: 10,
    indicative_time_horizon: "Muy largo plazo orientativo",
    indicative_volatility_tolerance: "Tolerancia extrema a volatilidad y caídas",
    informative_constraints: ["Máxima sensibilidad a datos incompletos", "No implica idoneidad real"],
    status: "PREVIEW_ONLY"
  }
];

const PORTFOLIO_METRIC_LABELS = {
  annualized_return_3y: "rentabilidad anualizada 3 años",
  volatility_3y: "volatilidad 3 años",
  sharpe_3y: "Sharpe 3 años",
  max_drawdown_hist: "caída máxima histórica",
  risk_score: "indicador de riesgo de los activos"
} as const;

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

/**
 * El Sharpe que se lista es el de la rentabilidad y la volatilidad a 3 años de lo invertible, así que si lo que entra en la rentabilidad es una sola
 * acción, es el de esa acción. Y el de una acción no se enseña (§9 del método): la regla vive en `seEnsenaLaMetrica` y Perfil la lee, como la
 * Comprobación previa. Entonces ni está ni falta. Dos acciones siguen siendo una cartera (decisión 83).
 */
function esElSharpeDeUnaSolaAccion(invertibles: readonly BdbAssetDetail[]): boolean {
  const conRentabilidad = invertibles.filter((asset) => typeof asset.metrics.annualized_return_3y === "number" && Number.isFinite(asset.metrics.annualized_return_3y));
  const loQueEntra = new Map((conRentabilidad.length > 0 ? conRentabilidad : invertibles).map((asset) => [asset.asset_id, asset.instrument_type]));
  return loQueEntra.size === 1 && !seEnsenaLaMetrica("sharpe", [...loQueEntra.values()][0]);
}

function getRiskProfile(profileId: BdbRiskProfileId): BdbRiskProfileContract {
  return RISK_PROFILE_CONTRACTS.find((profile) => profile.risk_profile_id === profileId) ?? RISK_PROFILE_CONTRACTS[4];
}

function getExcludedAsset(options: {
  asset: BdbAssetDetail | undefined;
  position: BdbManualPortfolioPosition;
  weight: number;
}): BdbRiskProfilePreviewExcludedAsset | null {
  if (!options.asset) {
    return {
      asset_id: options.position.asset_id,
      display_name: options.position.label ?? options.position.asset_id,
      weight_percent: options.weight,
      reason: "MISSING_ASSET"
    };
  }

  if (options.weight <= 0) {
    return {
      asset_id: options.asset.asset_id,
      display_name: options.asset.display_name,
      weight_percent: options.weight,
      reason: "INVALID_WEIGHT"
    };
  }

  if (!isInvestableAsset(options.asset)) {
    return {
      asset_id: options.asset.asset_id,
      display_name: options.asset.display_name,
      weight_percent: options.weight,
      reason: bloqueadoPorCalidadDelDato(options.asset) ? "QUALITY_BLOCKED" : "NON_INVESTABLE_BENCHMARK"
    };
  }

  return null;
}

export function buildLocalRiskProfilePreview(options: {
  sourceKind: BdbAssetDataSourceKind;
  selectedProfileId: BdbRiskProfileId;
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  summary: BdbManualPortfolioSummary;
}): BdbRiskProfilePreview {
  const assetsById = new Map(options.assets.map((asset) => [asset.asset_id, asset]));
  const selectedProfile = getRiskProfile(options.selectedProfileId);
  const excludedAssets: BdbRiskProfilePreviewExcludedAsset[] = [];
  const investableAssets: BdbAssetDetail[] = [];
  const riskSignals: string[] = [
    `Perfil seleccionado: ${selectedProfile.risk_profile_label}.`,
    `Horizonte orientativo: ${selectedProfile.indicative_time_horizon}.`,
    `Tolerancia orientativa: ${selectedProfile.indicative_volatility_tolerance}.`
  ];

  for (const position of options.positions) {
    const asset = assetsById.get(position.asset_id);
    const weight = clampPercent(position.weight_percent);
    const excludedAsset = getExcludedAsset({ asset, position, weight });

    if (excludedAsset) {
      excludedAssets.push(excludedAsset);
      continue;
    }

    if (asset) {
      investableAssets.push(asset);
    }
  }

  const weightedMetrics = options.summary.weighted_metrics;
  const portfolioMetricsAvailable: string[] = [];
  const portfolioMetricsMissing: string[] = [];

  const sinSharpe = esElSharpeDeUnaSolaAccion(investableAssets);
  /* Con métodos distintos (mensual y diario, por ejemplo) las volatilidades de cada activo no se suman, y sin ellas tampoco hay Sharpe: no
     falta ningún dato, y el riesgo de la cartera se mide en la simulación. Es lo que dice Validación en la misma pestaña, con el aviso de abajo. */
  const metodosDistintos = estadoDeLaVolatilidad(weightedMetrics) === "metodos_distintos";
  for (const key of ["annualized_return_3y", "volatility_3y", "sharpe_3y"] as const) {
    if (key === "sharpe_3y" && sinSharpe) continue;
    if (typeof weightedMetrics[key] === "number") {
      portfolioMetricsAvailable.push(PORTFOLIO_METRIC_LABELS[key]);
    } else if (!(metodosDistintos && key !== "annualized_return_3y")) {
      portfolioMetricsMissing.push(PORTFOLIO_METRIC_LABELS[key]);
    }
  }
  const dd = maxDrawdownMetric(weightedMetrics);
  if (typeof dd.value === "number") {
    portfolioMetricsAvailable.push(caidaEnPantalla(dd.label));
  } else {
    portfolioMetricsMissing.push(PORTFOLIO_METRIC_LABELS.max_drawdown_hist);
  }

  /* A una acción no le falta: no tiene KID ni KIID (decisión 83). Sin nadie a quien le aplique, ni está ni falta. */
  const conIndicador = investableAssets.filter((asset) => seEnsenaLaMetrica("indicadorDeRiesgo", asset.instrument_type));
  if (conIndicador.length > 0 && conIndicador.every((asset) => typeof asset.metrics.risk_score === "number")) {
    portfolioMetricsAvailable.push(PORTFOLIO_METRIC_LABELS.risk_score);
  } else if (conIndicador.length > 0 || investableAssets.length === 0) {
    portfolioMetricsMissing.push(PORTFOLIO_METRIC_LABELS.risk_score);
  }

  /* Aquí no se escribe ninguna cifra de la cartera: esta suma de las cifras de cada activo no lo es, y una media de
     caídas tampoco es una caída de cartera (decisión 36). */
  const topBucket = options.summary.by_economic_asset_class[0];
  if (topBucket) {
    riskSignals.push(
      `Mayor clase de activo invertible: ${CLASS_LABELS[topBucket.key] ?? readableBackendLabel(topBucket.key)} (${oFalta(peso(topBucket.weight_percent / 100))}).`
    );
  }
  if (excludedAssets.some((asset) => asset.reason === "NON_INVESTABLE_BENCHMARK")) {
    riskSignals.push("Índices y activos no invertibles excluidos de las señales de riesgo.");
  }
  if (excludedAssets.some((asset) => asset.reason === "QUALITY_BLOCKED")) {
    riskSignals.push("Lo que tiene una incidencia en su serie de precios queda fuera de las señales de riesgo.");
  }
  if (portfolioMetricsMissing.length > 0) {
    riskSignals.push("Faltan métricas para una evaluación seria con datos completos.");
  }
  if (options.summary.validation_status !== "VALID") {
    riskSignals.push("La suma de pesos no está validada al 100 %.");
  }

  /* Los avisos de la cartera, con las palabras de Comprobar: «Metricas parciales (0%)» con métodos distintos no es que falte el dato, y la
     «Mezcla de divisas» solo queda donde una cifra del proveedor sigue en otra divisa. */
  const dataWarnings = unique([
    ...avisosDeComprobar(options.summary.warnings, weightedMetrics, cifrasDelProveedorEnOtraDivisa(options.positions, options.assets)),
    ...investableAssets.flatMap((asset) =>
      asset.quality_flags
        .filter((flag) => flag !== "MOCK_DATA")
        .map((flag) => `${asset.asset_id}: ${ETIQUETAS_DE_CALIDAD[flag] ?? readableBackendLabel(flag)}`)
    ),
    ...investableAssets.flatMap((asset) => asset.warnings.map((warning) => warning.message))
  ]);
  const seriousEvaluationNotice =
    portfolioMetricsMissing.length > 0 || dataWarnings.length > 0 || excludedAssets.length > 0
      ? "Faltan datos o existen exclusiones o avisos; cualquier evaluación seria requeriría datos completos, contexto del cliente y validaciones externas."
      : "Aunque las métricas básicas estén disponibles, esta lectura no basta para una evaluación seria ni para una decisión regulatoria.";

  return {
    status: "PREVIEW_ONLY",
    sourceKind: options.sourceKind,
    metrics_boundary: clonePreviewMetricsBoundary(),
    selected_profile: selectedProfile,
    total_weight_percent: roundPercent(options.summary.total_weight_percent),
    validation_status: options.summary.validation_status,
    investable_position_count: investableAssets.length,
    excluded_assets: excludedAssets,
    portfolio_metrics_available: unique(portfolioMetricsAvailable),
    portfolio_metrics_missing: unique(portfolioMetricsMissing),
    data_warnings: dataWarnings,
    risk_signals: unique(riskSignals),
    serious_evaluation_notice: seriousEvaluationNotice,
    disclaimer:
      "Orientativo: no evalúa idoneidad ni es una recomendación personalizada."
  };
}
