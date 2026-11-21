import { bloqueadoPorCalidadDelDato, findAssetByIdentifier, isInvestableAsset } from "./assetMapping";
import { oFalta, peso } from "./formato";
import { clampPercent, roundPercent } from "./portfolio";
import { WEIGHT_TOLERANCE_FRACTION } from "./weightTolerance";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbPmsExposure,
  BdbRiskProfileContract,
  EconomicAssetClass,
  InstrumentType
} from "../types/bdbAssets";

export type PortfolioConstraintSeverity = "BLOCKING" | "WARNING" | "INFO";

export type PortfolioConstraintStatus = "FEASIBLE" | "WARNING" | "BLOCKED";

export type PortfolioExposureBucket = "equity" | "fixed_income" | "cash" | "alternative" | "real_asset" | "other";

export interface PortfolioWeightBounds {
  min_weight?: number;
  max_weight?: number;
}

export interface PortfolioConstraintsV1 {
  schema_version: "portfolio-constraints.v1";
  target_weight: number;
  tolerance: number;
  min_position_weight: number;
  max_position_weight: number;
  allow_non_investable_assets: boolean;
  per_asset_bounds?: Record<string, PortfolioWeightBounds>;
  instrument_type_bounds?: Partial<Record<InstrumentType, PortfolioWeightBounds>>;
  exposure_bounds?: Partial<Record<PortfolioExposureBucket, PortfolioWeightBounds>>;
}

export interface ResolvedPositionBounds {
  asset_id: string;
  min_weight: number;
  max_weight: number;
  locked_weight?: number;
  configured_min_weight?: number;
  configured_max_weight?: number;
}

export interface PortfolioConstraintIssue {
  code:
    | "EMPTY_PORTFOLIO"
    | "MISSING_ASSET"
    | "NON_INVESTABLE_ASSET"
    | "INDEX_NOT_INVESTABLE"
    | "INVALID_WEIGHT"
    | "TOTAL_WEIGHT_OFF_TARGET"
    | "POSITION_BELOW_MIN"
    | "POSITION_ABOVE_MAX"
    | "INVALID_BOUNDS"
    | "LOCKED_WEIGHT_INVALID"
    | "LOCKED_WEIGHT_EXCEEDS_TARGET"
    | "LOCKED_PORTFOLIO_OFF_TARGET"
    | "LOCKED_MIN_EXCEEDS_TARGET"
    | "LOCKED_MAX_BELOW_TARGET"
    | "EXPOSURE_BELOW_MIN"
    | "EXPOSURE_ABOVE_MAX"
    | "INSTRUMENT_BELOW_MIN"
    | "INSTRUMENT_ABOVE_MAX"
    | "SUITABILITY_PREVIEW_ONLY";
  severity: PortfolioConstraintSeverity;
  message: string;
  asset_id?: string;
  scope?: string;
  current_weight?: number;
  min_weight?: number;
  max_weight?: number;
}

export interface PortfolioSuitabilityInformativePreview {
  status: "PREVIEW_ONLY";
  selected_profile?: BdbRiskProfileContract;
  suitability_allowed: false;
  recommendation_allowed: false;
  optimization_allowed: false;
  signals: string[];
  disclaimer: string;
}

export interface PortfolioFeasibilityCheck {
  schema_version: "portfolio-feasibility.v1";
  status: PortfolioConstraintStatus;
  constraints: PortfolioConstraintsV1;
  bounds: ResolvedPositionBounds[];
  locked_weight: number;
  unlocked_budget: number;
  total_weight: number;
  blocking_issues: PortfolioConstraintIssue[];
  warnings: PortfolioConstraintIssue[];
  infos: PortfolioConstraintIssue[];
  suitability_preview: PortfolioSuitabilityInformativePreview;
}

/** Pesos en fracción: la tolerancia única de «suma 100 %» (±0,05 puntos) expresada como 0,0005. */
const DEFAULT_TOLERANCE = WEIGHT_TOLERANCE_FRACTION;
const EXPOSURE_BUCKETS: PortfolioExposureBucket[] = ["equity", "fixed_income", "cash", "alternative", "real_asset", "other"];

const ECONOMIC_CLASS_TO_EXPOSURE: Record<EconomicAssetClass, PortfolioExposureBucket> = {
  EQUITY: "equity",
  FIXED_INCOME: "fixed_income",
  MIXED: "other",
  MONEY_MARKET: "cash",
  ALTERNATIVE: "alternative",
  REAL_ASSET: "real_asset",
  COMMODITIES: "other",
  OTHER: "other",
  UNKNOWN: "other"
};

export function createDefaultPortfolioConstraints(
  overrides: Partial<PortfolioConstraintsV1> = {}
): PortfolioConstraintsV1 {
  return {
    schema_version: "portfolio-constraints.v1",
    target_weight: 1,
    tolerance: DEFAULT_TOLERANCE,
    min_position_weight: 0,
    max_position_weight: 1,
    allow_non_investable_assets: false,
    ...overrides
  };
}

function clampWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, 0), 1);
}

function toWeight(position: BdbManualPortfolioPosition): number {
  return clampPercent(position.weight_percent) / 100;
}

function getAssetLabel(asset: BdbAssetDetail | undefined, position: BdbManualPortfolioPosition): string {
  return asset?.display_name ?? position.label ?? position.asset_id;
}

function addIssue(issues: PortfolioConstraintIssue[], issue: PortfolioConstraintIssue): void {
  issues.push({
    ...issue,
    current_weight: issue.current_weight === undefined ? undefined : roundPercent(issue.current_weight),
    min_weight: issue.min_weight === undefined ? undefined : roundPercent(issue.min_weight),
    max_weight: issue.max_weight === undefined ? undefined : roundPercent(issue.max_weight)
  });
}

function mergeBounds(base: PortfolioWeightBounds, next: PortfolioWeightBounds | undefined): PortfolioWeightBounds {
  if (!next) {
    return base;
  }

  return {
    min_weight: Math.max(base.min_weight ?? 0, next.min_weight ?? 0),
    max_weight: Math.min(base.max_weight ?? 1, next.max_weight ?? 1)
  };
}

function getExposureShare(asset: BdbAssetDetail, bucket: PortfolioExposureBucket): number {
  const exposure: Required<Omit<BdbPmsExposure, "source">> = {
    equity: asset.pms_exposure?.equity ?? 0,
    fixed_income: asset.pms_exposure?.fixed_income ?? 0,
    cash: asset.pms_exposure?.cash ?? 0,
    alternative: asset.pms_exposure?.alternative ?? 0,
    real_asset: asset.pms_exposure?.real_asset ?? 0,
    other: asset.pms_exposure?.other ?? 0
  };
  const total = EXPOSURE_BUCKETS.reduce((sum, key) => sum + exposure[key], 0);

  if (total > 0) {
    return exposure[bucket] / total;
  }

  return ECONOMIC_CLASS_TO_EXPOSURE[asset.economic_asset_class] === bucket ? 1 : 0;
}

function issueBucket(issues: PortfolioConstraintIssue[], severity: PortfolioConstraintSeverity): PortfolioConstraintIssue[] {
  return issues.filter((issue) => issue.severity === severity);
}

export function resolvePortfolioBounds(options: {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  lockedWeights?: Record<string, number>;
  constraints?: Partial<PortfolioConstraintsV1>;
}): ResolvedPositionBounds[] {
  const constraints = createDefaultPortfolioConstraints(options.constraints);

  return options.positions.map((position) => {
    const asset = findAssetByIdentifier(options.assets, position.asset_id);
    const lockedWeight = options.lockedWeights?.[position.asset_id];
    let bounds: PortfolioWeightBounds = {
      min_weight: constraints.min_position_weight,
      max_weight: constraints.max_position_weight
    };

    if (asset) {
      bounds = mergeBounds(bounds, constraints.instrument_type_bounds?.[asset.instrument_type]);
    }
    bounds = mergeBounds(bounds, constraints.per_asset_bounds?.[position.asset_id]);
    const configuredMinWeight = clampWeight(bounds.min_weight, 0);
    const configuredMaxWeight = clampWeight(bounds.max_weight, 1);

    if (typeof lockedWeight === "number" && Number.isFinite(lockedWeight)) {
      const locked = clampWeight(lockedWeight, toWeight(position));
      return {
        asset_id: position.asset_id,
        min_weight: locked,
        max_weight: locked,
        locked_weight: locked,
        configured_min_weight: configuredMinWeight,
        configured_max_weight: configuredMaxWeight
      };
    }

    return {
      asset_id: position.asset_id,
      min_weight: configuredMinWeight,
      max_weight: configuredMaxWeight,
      configured_min_weight: configuredMinWeight,
      configured_max_weight: configuredMaxWeight
    };
  });
}

export function buildSuitabilityInformativePreview(options: {
  selectedProfile?: BdbRiskProfileContract;
  blockingIssueCount?: number;
  warningCount?: number;
}): PortfolioSuitabilityInformativePreview {
  const signals = [
    "Lectura de idoneidad meramente informativa.",
    "No genera recomendación personalizada ni dictamen regulatorio."
  ];

  if (options.selectedProfile) {
    signals.push(`Perfil seleccionado: ${options.selectedProfile.risk_profile_label}.`);
  }
  if ((options.blockingIssueCount ?? 0) > 0) {
    signals.push("Hay bloqueos técnicos que impiden una optimización real.");
  } else if ((options.warningCount ?? 0) > 0) {
    signals.push("Hay avisos que requieren revisión antes de usar datos reales.");
  }

  return {
    status: "PREVIEW_ONLY",
    selected_profile: options.selectedProfile,
    suitability_allowed: false,
    recommendation_allowed: false,
    optimization_allowed: false,
    signals,
    disclaimer: "Comprobación local: no evalúa idoneidad, no constituye asesoramiento ni decisión regulatoria."
  };
}

export function checkPortfolioFeasibility(options: {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  lockedWeights?: Record<string, number>;
  constraints?: Partial<PortfolioConstraintsV1>;
  selectedRiskProfile?: BdbRiskProfileContract;
}): PortfolioFeasibilityCheck {
  const constraints = createDefaultPortfolioConstraints(options.constraints);
  const bounds = resolvePortfolioBounds({
    positions: options.positions,
    assets: options.assets,
    lockedWeights: options.lockedWeights,
    constraints
  });
  const issues: PortfolioConstraintIssue[] = [];
  const exposureWeights: Record<PortfolioExposureBucket, number> = {
    equity: 0,
    fixed_income: 0,
    cash: 0,
    alternative: 0,
    real_asset: 0,
    other: 0
  };
  const instrumentWeights = new Map<InstrumentType, number>();
  let totalWeight = 0;
  let lockedWeight = 0;
  let unlockedMin = 0;
  let unlockedMax = 0;
  let lockedCount = 0;

  if (options.positions.length === 0) {
    addIssue(issues, {
      code: "EMPTY_PORTFOLIO",
      severity: "INFO",
      message: "La cartera no contiene posiciones."
    });
  }

  for (const [index, position] of options.positions.entries()) {
    const weight = toWeight(position);
    const asset = findAssetByIdentifier(options.assets, position.asset_id);
    const positionBounds = bounds[index];
    const locked = typeof positionBounds.locked_weight === "number";

    totalWeight += weight;
    if (locked) {
      lockedCount += 1;
      lockedWeight += positionBounds.locked_weight ?? 0;
    } else {
      unlockedMin += positionBounds.min_weight;
      unlockedMax += positionBounds.max_weight;
    }

    if (weight <= 0) {
      addIssue(issues, {
        code: "INVALID_WEIGHT",
        severity: "WARNING",
        message: `${getAssetLabel(asset, position)} tiene peso cero o negativo y no entra en la optimización.`,
        asset_id: position.asset_id,
        current_weight: weight
      });
    }

    if (!asset) {
      addIssue(issues, {
        code: "MISSING_ASSET",
        severity: "BLOCKING",
        message: `${position.asset_id} no existe en la fuente de datos activa.`,
        asset_id: position.asset_id
      });
      continue;
    }

    if (asset.instrument_type === "INDEX") {
      addIssue(issues, {
        code: "INDEX_NOT_INVESTABLE",
        severity: "BLOCKING",
        message: `${asset.display_name} es INDEX/benchmark y no puede optimizarse como posición invertible.`,
        asset_id: asset.asset_id
      });
    } else if (!constraints.allow_non_investable_assets && !isInvestableAsset(asset)) {
      addIssue(issues, {
        code: "NON_INVESTABLE_ASSET",
        severity: "BLOCKING",
        /* Deoleo cotiza: lo que no se puede es proponerla (decisión 75). Lo imprime también el informe interno. */
        message: bloqueadoPorCalidadDelDato(asset)
          ? `${asset.display_name} no se puede proponer.`
          : `${asset.display_name} no es invertible según el contrato local.`,
        asset_id: asset.asset_id
      });
    }

    if (positionBounds.min_weight > positionBounds.max_weight + constraints.tolerance) {
      addIssue(issues, {
        code: "INVALID_BOUNDS",
        severity: "BLOCKING",
        message: `${asset.display_name} tiene limites incompatibles.`,
        asset_id: asset.asset_id,
        min_weight: positionBounds.min_weight,
        max_weight: positionBounds.max_weight
      });
    }

    if (weight + constraints.tolerance < positionBounds.min_weight) {
      addIssue(issues, {
        code: "POSITION_BELOW_MIN",
        severity: "BLOCKING",
        message: `${asset.display_name} queda por debajo del mínimo configurado.`,
        asset_id: asset.asset_id,
        current_weight: weight,
        min_weight: positionBounds.min_weight
      });
    }
    if (weight - constraints.tolerance > positionBounds.max_weight) {
      addIssue(issues, {
        code: "POSITION_ABOVE_MAX",
        severity: "BLOCKING",
        message: `${asset.display_name} supera el máximo configurado.`,
        asset_id: asset.asset_id,
        current_weight: weight,
        max_weight: positionBounds.max_weight
      });
    }

    if (typeof positionBounds.locked_weight === "number" && (positionBounds.locked_weight < 0 || positionBounds.locked_weight > 1)) {
      addIssue(issues, {
        code: "LOCKED_WEIGHT_INVALID",
        severity: "BLOCKING",
        message: `${asset.display_name} tiene un candado fuera de rango.`,
        asset_id: asset.asset_id,
        current_weight: positionBounds.locked_weight
      });
    }
    if (
      typeof positionBounds.locked_weight === "number" &&
      typeof positionBounds.configured_min_weight === "number" &&
      positionBounds.locked_weight + constraints.tolerance < positionBounds.configured_min_weight
    ) {
      addIssue(issues, {
        code: "POSITION_BELOW_MIN",
        severity: "BLOCKING",
        message: `${asset.display_name} está fijado por debajo del mínimo configurado.`,
        asset_id: asset.asset_id,
        current_weight: positionBounds.locked_weight,
        min_weight: positionBounds.configured_min_weight
      });
    }
    if (
      typeof positionBounds.locked_weight === "number" &&
      typeof positionBounds.configured_max_weight === "number" &&
      positionBounds.locked_weight - constraints.tolerance > positionBounds.configured_max_weight
    ) {
      addIssue(issues, {
        code: "POSITION_ABOVE_MAX",
        severity: "BLOCKING",
        message: `${asset.display_name} está fijado por encima del máximo configurado.`,
        asset_id: asset.asset_id,
        current_weight: positionBounds.locked_weight,
        max_weight: positionBounds.configured_max_weight
      });
    }

    instrumentWeights.set(asset.instrument_type, (instrumentWeights.get(asset.instrument_type) ?? 0) + weight);
    for (const bucket of EXPOSURE_BUCKETS) {
      exposureWeights[bucket] += weight * getExposureShare(asset, bucket);
    }
  }

  if (Math.abs(totalWeight - constraints.target_weight) > constraints.tolerance) {
    addIssue(issues, {
      code: "TOTAL_WEIGHT_OFF_TARGET",
      severity: "WARNING",
      message: `La suma actual es ${oFalta(peso(totalWeight))}; la normalización puede ajustar posiciones libres.`,
      current_weight: totalWeight,
      min_weight: constraints.target_weight,
      max_weight: constraints.target_weight
    });
  }

  if (lockedWeight > constraints.target_weight + constraints.tolerance) {
    addIssue(issues, {
      code: "LOCKED_WEIGHT_EXCEEDS_TARGET",
      severity: "BLOCKING",
      message: "Los pesos fijados superan el 100% disponible.",
      current_weight: lockedWeight,
      max_weight: constraints.target_weight
    });
  }

  if (lockedCount === options.positions.length && options.positions.length > 0 && Math.abs(lockedWeight - constraints.target_weight) > constraints.tolerance) {
    addIssue(issues, {
      code: "LOCKED_PORTFOLIO_OFF_TARGET",
      severity: "BLOCKING",
      message: "Todas las posiciones estan fijadas y la suma no llega al objetivo.",
      current_weight: lockedWeight,
      min_weight: constraints.target_weight,
      max_weight: constraints.target_weight
    });
  }

  if (lockedWeight + unlockedMin > constraints.target_weight + constraints.tolerance) {
    addIssue(issues, {
      code: "LOCKED_MIN_EXCEEDS_TARGET",
      severity: "BLOCKING",
      message: "Candados y minimos dejan la cartera por encima del 100%.",
      current_weight: lockedWeight + unlockedMin,
      max_weight: constraints.target_weight
    });
  }

  if (lockedWeight + unlockedMax < constraints.target_weight - constraints.tolerance) {
    addIssue(issues, {
      code: "LOCKED_MAX_BELOW_TARGET",
      severity: "BLOCKING",
      message: "Candados y maximos no permiten alcanzar el 100%.",
      current_weight: lockedWeight + unlockedMax,
      min_weight: constraints.target_weight
    });
  }

  for (const [instrumentType, weight] of instrumentWeights.entries()) {
    const limit = constraints.instrument_type_bounds?.[instrumentType];
    if (!limit) {
      continue;
    }
    if (typeof limit.min_weight === "number" && weight + constraints.tolerance < limit.min_weight) {
      addIssue(issues, {
        code: "INSTRUMENT_BELOW_MIN",
        severity: "BLOCKING",
        message: `${instrumentType} queda por debajo del mínimo configurado.`,
        scope: instrumentType,
        current_weight: weight,
        min_weight: limit.min_weight
      });
    }
    if (typeof limit.max_weight === "number" && weight - constraints.tolerance > limit.max_weight) {
      addIssue(issues, {
        code: "INSTRUMENT_ABOVE_MAX",
        severity: "BLOCKING",
        message: `${instrumentType} supera el máximo configurado.`,
        scope: instrumentType,
        current_weight: weight,
        max_weight: limit.max_weight
      });
    }
  }

  for (const bucket of EXPOSURE_BUCKETS) {
    const limit = constraints.exposure_bounds?.[bucket];
    if (!limit) {
      continue;
    }
    const weight = exposureWeights[bucket];
    if (typeof limit.min_weight === "number" && weight + constraints.tolerance < limit.min_weight) {
      addIssue(issues, {
        code: "EXPOSURE_BELOW_MIN",
        severity: "BLOCKING",
        message: `${bucket} queda por debajo del mínimo configurado.`,
        scope: bucket,
        current_weight: weight,
        min_weight: limit.min_weight
      });
    }
    if (typeof limit.max_weight === "number" && weight - constraints.tolerance > limit.max_weight) {
      addIssue(issues, {
        code: "EXPOSURE_ABOVE_MAX",
        severity: "BLOCKING",
        message: `${bucket} supera el máximo configurado.`,
        scope: bucket,
        current_weight: weight,
        max_weight: limit.max_weight
      });
    }
  }

  if (options.selectedRiskProfile) {
    addIssue(issues, {
      code: "SUITABILITY_PREVIEW_ONLY",
      severity: "INFO",
      message: `${options.selectedRiskProfile.risk_profile_label}: idoneidad solo informativa.`
    });
  }

  const blockingIssues = issueBucket(issues, "BLOCKING");
  const warnings = issueBucket(issues, "WARNING");
  const infos = issueBucket(issues, "INFO");
  const status: PortfolioConstraintStatus =
    blockingIssues.length > 0 ? "BLOCKED" : warnings.length > 0 ? "WARNING" : "FEASIBLE";

  return {
    schema_version: "portfolio-feasibility.v1",
    status,
    constraints,
    bounds,
    locked_weight: roundPercent(lockedWeight),
    unlocked_budget: roundPercent(Math.max(0, constraints.target_weight - lockedWeight)),
    total_weight: roundPercent(totalWeight),
    blocking_issues: blockingIssues,
    warnings,
    infos,
    suitability_preview: buildSuitabilityInformativePreview({
      selectedProfile: options.selectedRiskProfile,
      blockingIssueCount: blockingIssues.length,
      warningCount: warnings.length
    })
  };
}

export function normalizeUnlockedPositions(options: {
  positions: BdbManualPortfolioPosition[];
  lockedWeights?: Record<string, number>;
  targetWeight?: number;
}): BdbManualPortfolioPosition[] {
  const targetWeight = clampWeight(options.targetWeight, 1);
  const lockedWeights = options.lockedWeights ?? {};
  const lockedWeight = options.positions.reduce((sum, position) => sum + (lockedWeights[position.asset_id] ?? 0), 0);

  if (lockedWeight > targetWeight) {
    return options.positions.map((position) => ({ ...position }));
  }

  const unlocked = options.positions.filter((position) => typeof lockedWeights[position.asset_id] !== "number");
  const unlockedCurrentWeight = unlocked.reduce((sum, position) => sum + toWeight(position), 0);
  const unlockedTargetWeight = targetWeight - lockedWeight;

  if (unlocked.length === 0 || unlockedCurrentWeight <= 0) {
    return options.positions.map((position) => ({ ...position }));
  }

  return options.positions.map((position) => {
    if (typeof lockedWeights[position.asset_id] === "number") {
      return { ...position, weight_percent: roundPercent((lockedWeights[position.asset_id] ?? 0) * 100) };
    }

    const normalizedWeight = (toWeight(position) / unlockedCurrentWeight) * unlockedTargetWeight;
    return { ...position, weight_percent: roundPercent(normalizedWeight * 100) };
  });
}

/**
 * Pesos a dos decimales que suman exactamente `objetivo`: el que la pantalla escribe y el que se guarda. Redondeando
 * cada uno por su cuenta, siete posiciones podían quedarse en 99,99 % con el rótulo «Correcto» al lado. Método del mayor
 * resto: cada peso baja a la centésima y las que faltan van a los que más perdieron; si empatan, al primero. Ninguno se
 * mueve más de una centésima de su valor exacto, y un peso cero se queda en cero.
 */
export function redondearQueSume(pesos: readonly number[], objetivo: number): number[] {
  /* `toPrecision` quita el ruido de la coma flotante: 14,29 × 100 no debe bajar a 1.428. */
  const exactos = pesos.map((peso) => Number((peso * 100).toPrecision(12)));
  const salida = exactos.map(Math.floor);
  const faltan = Math.round(objetivo * 100) - salida.reduce((suma, centesimas) => suma + centesimas, 0);
  exactos
    .map((exacto, indice) => ({ indice, exacto, resto: exacto - salida[indice] }))
    .filter(({ exacto }) => exacto > 0)
    .sort((a, b) => b.resto - a.resto || a.indice - b.indice)
    .slice(0, Math.max(0, faltan))
    .forEach(({ indice }) => {
      salida[indice] += 1;
    });
  return salida.map((centesimas) => centesimas / 100);
}

/**
 * «Normalizar al 100 %»: lo que hay que escribir en cada posición. Las fijadas conservan su peso, a dos decimales como
 * todas, y las libres se reparten el resto en proporción y sumando justo lo que queda.
 */
export function pesosNormalizadosAlCien(options: {
  positions: BdbManualPortfolioPosition[];
  lockedWeights?: Record<string, number>;
}): Record<string, number> {
  const fijadas = options.lockedWeights ?? {};
  const normalizadas = normalizeUnlockedPositions(options);
  const esFija = (position: BdbManualPortfolioPosition) => typeof fijadas[position.asset_id] === "number";
  const aDosDecimales = (peso: number | undefined) => Math.round((peso || 0) * 100) / 100;
  const pesos: Record<string, number> = {};
  normalizadas.filter(esFija).forEach((position) => {
    pesos[position.asset_id] = aDosDecimales(position.weight_percent);
  });
  const fijado = Object.values(pesos).reduce((suma, peso) => suma + peso, 0);
  const libres = normalizadas.filter((position) => !esFija(position));
  const pesosLibres = libres.map((position) => position.weight_percent || 0);
  /* Si no había nada que reescalar (fijadas por encima del 100 % o libres a cero), cada una se queda con lo suyo. */
  const seReparte = fijado <= 100 && pesosLibres.some((peso) => peso > 0);
  const redondeados = seReparte ? redondearQueSume(pesosLibres, 100 - fijado) : pesosLibres.map(aDosDecimales);
  libres.forEach((position, indice) => {
    pesos[position.asset_id] = redondeados[indice];
  });
  return pesos;
}

export function canOptimizePortfolioWithConstraints(
  feasibility: PortfolioFeasibilityCheck | null | undefined,
  assetCount: number
): boolean {
  return assetCount >= 2 && feasibility?.status !== "BLOCKED";
}
