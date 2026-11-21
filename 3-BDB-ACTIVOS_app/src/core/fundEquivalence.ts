/**
 * Equivalencia entre dos fondos para «Mejorar cartera» (fase 2 del plan,
 * docs/PLAN_MEJORA_CARTERA_EQUIVALENTES_2026-10-13.md).
 *
 * Capas 1 y 2 del diseño, con las fichas ya cargadas y sin red:
 *  - etiquetas: vehículo, clase económica, categoría, región, política de
 *    distribución y cobertura de divisa (estas dos INFERIDAS del nombre: la
 *    maestra no las trae como campo, auditoría del 13-10-2026);
 *  - exposiciones: mezcla de activos, sectores, regiones RV, tamaños, estilo y,
 *    cuando la ficha lo publique, duración y calidad crediticia.
 *
 * La capa 3 (correlación y tracking error entre series, solapamiento de
 * posiciones) la mide el servidor con las series: aquí no se finge.
 *
 * Reglas: un dato ausente es «sin dato», nunca una coincidencia; cada veredicto
 * lleva lo compartido, lo distinto, lo que falta y un motivo legible.
 */
import type { BdbAssetDetail, BdbPmsExposure } from "../types/bdbAssets";
import { CLASS_LABELS, TYPE_LABELS, readableBackendLabel } from "./labels";
import { numero, oFalta, peso } from "./formato";
import { categoriaLegible } from "./etiquetasDeReparto";

export type EquivalenceStatus = "MATCH" | "DIFFERS" | "UNKNOWN";

export type EquivalenceVerdict =
  /** Misma familia de fondo (otra clase): misma estrategia por construcción. */
  | "SAME_FUND_CLASS"
  | "EQUIVALENT"
  | "COMPARABLE"
  | "NOT_EQUIVALENT";

export interface EquivalenceCriterion {
  key: string;
  label: string;
  status: EquivalenceStatus;
  /** Valor del original y del candidato tal como se muestran; vacío si no hay dato. */
  original?: string;
  candidate?: string;
  /** El dato se dedujo del nombre u otra pista, no de un campo de la fuente. */
  inferred?: boolean;
  /** Texto corto con la medida (distancia, diferencia de duración…). */
  detail?: string;
  /** Un criterio excluyente que difiere hace al candidato no equivalente. */
  blocking?: boolean;
  /** Un criterio que, si difiere, deja el veredicto como mucho en «comparable» (duración, crédito). */
  capping?: boolean;
  weight: number;
}

export interface FundEquivalence {
  verdict: EquivalenceVerdict;
  /** 0..1 sobre los criterios evaluados (los «sin dato» no puntúan ni penalizan). */
  score: number;
  /** Criterios con dato en ambos / criterios totales con peso. */
  evaluated: number;
  total: number;
  shared: string[];
  differing: string[];
  missing: string[];
  reason: string;
  criteria: EquivalenceCriterion[];
  sameFamily: boolean;
}

export type DistributionPolicy = "ACC" | "DIST";

export interface ShareClassTraits {
  distribution: DistributionPolicy | null;
  hedged: boolean | null;
  inferred: true;
}

export interface EquivalenceOptions {
  /** Distancia L1/2 máxima entre dos repartos para contarlos como coincidentes. */
  exposureTolerance?: number;
  /** Diferencia máxima de duración (años) en renta fija. */
  durationToleranceYears?: number;
  /** Con política de distribución distinta o desconocida, el veredicto se queda en «comparable». */
  requireSameDistribution?: boolean;
}

const DEFAULTS: Required<EquivalenceOptions> = {
  exposureTolerance: 0.25,
  durationToleranceYears: 1.5,
  requireSameDistribution: true
};

/* ----------------------------------------------------------------- nombre */

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// «Cap» tras small/mid/large/flex/all/micro es tamaño, no capitalización; «Income»
// solo cuenta como «Inc» aislado (Global Equity Income es estrategia).
const DISTRIBUTION_TOKEN = /(?<!small )(?<!mid )(?<!large )(?<!flex )(?<!all )(?<!micro )\b(acc|accumulation|acum|capitalisation|cap|dis|dist|distribution|inc)\b/i;
// Cobertura de divisa (MEDIA-16, 14-10-2026), señales claras de clase cubierta:
//  - «Hedged»/«Hdg»/«Hgd»/«cubierta» («Interest Rate/Duration Hedged» cubre tipos, no divisa);
//  - la H junto a la divisa: EURH, EUR-H, «EUR H», H-EUR, «H EUR» (no «Class H EUR»);
//  - el sufijo «-H» de la clase: «A-H», «I2-H».
// Una «H» suelta es casi siempre la letra de la clase («Clase H») y no dice nada.
const HEDGE_CURRENCIES = "eur|usd|gbp|chf|jpy|sek|nok|dkk|aud|cad|nzd|hkd|sgd|cnh|czk|pln|huf";
const HEDGED_TOKEN = new RegExp([
  "(?<!rate )(?<!duration )\\b(?:hedged|hdg|hgd|cubiert[ao])\\b",
  `\\b(?:${HEDGE_CURRENCIES})[- ]?h\\b`,
  `(?<!class )(?<!clase )\\bh[- ](?:${HEDGE_CURRENCIES})\\b`,
  "\\b[a-z0-9]{1,3}-h\\b"
].join("|"));
const UNHEDGED_TOKEN = /\b(unhedged|non[- ]hedged|no cubiert[ao]|sin cobertura)\b/;

/**
 * Cobertura de divisa deducida del nombre, como dato interno de tres estados:
 * true / false con señal clara, null si el nombre no dice nada. Para COMPARAR,
 * `hedgeForComparison` trata el null como «sin cobertura (inferida)».
 */
function inferHedged(text: string): boolean | null {
  if (UNHEDGED_TOKEN.test(text)) return false;
  return HEDGED_TOKEN.test(text) ? true : null;
}

/**
 * Cobertura con la que se compara un par (revisión del 14-10-2026): un nombre sin
 * indicación cuenta como «sin cobertura (inferida)» —la clase por defecto no se
 * cubre— para no perder el aviso «Sin cobertura → Cubierta». Solo un nombre vacío
 * deja el criterio sin dato.
 */
function hedgeForComparison(name: string | undefined, hedged: boolean | null): boolean | null {
  return fold(name ?? "").trim() ? (hedged ?? false) : null;
}

/** Política de distribución y cobertura, deducidas del nombre de la clase. */
export function inferShareClassTraits(name: string | undefined): ShareClassTraits {
  const text = fold(name ?? "");
  const match = DISTRIBUTION_TOKEN.exec(text);
  const token = match?.[1];
  const distribution: DistributionPolicy | null = !token
    ? null
    : ["acc", "accumulation", "acum", "capitalisation", "cap"].includes(token) ? "ACC" : "DIST";
  return { distribution, hedged: inferHedged(text), inferred: true };
}

const CLASS_TOKENS = new Set([
  "class", "clase", "cl", "acc", "acum", "accumulation", "accumulating", "cap", "capitalisation", "dis", "dist",
  "inc", "income", "distribution", "distributing",
  "hedged", "hdg", "hgd", "h", "unhedged", "a", "b", "c", "d", "e", "f", "g", "i", "ia", "ic", "id", "ie", "k", "l",
  "m", "n", "p", "q", "r", "s", "t", "u", "w", "x", "y", "z", "z2", "ae", "ad", "ah", "pa", "pb", "pd", "pi",
  "ra", "rd", "re", "ri", "ucits", "etf", "fi", "fund", "fonds", "fondo", "sicav", "plc", "lux", "de", "es",
  "fr", "the", "of", "and", "retail", "institutional", "inst", "clean", "seed", "founder", "share", "shares",
  // Divisas de clase y sus variantes cubiertas (PLN Hedged, AUDH…): la misma lista que la cobertura.
  ...HEDGE_CURRENCIES.split("|").flatMap((currency) => [currency, `${currency}h`])
]);

/** Palabras tras las que un número es el de la clase («Class 2», «Clase 1»), no el del producto. */
const CLASS_NUMBER_PREFIX = new Set(["class", "clase", "cl", "share", "shares"]);

/**
 * Clave de familia: el nombre sin los sufijos de clase. Dos fondos con la misma
 * clave son, casi siempre, clases del mismo fondo. Heurística: tiene falsos
 * positivos (fondos distintos de una gestora con nombres cortos). El servidor no
 * la confirma: pasa el par por las mismas comprobaciones de series que a cualquier
 * candidato, que dicen que se parece, no que sea el mismo fondo.
 *
 * Un número suelto se queda en la clave (15-11-2026): un año, un vencimiento o un
 * perfil («Horizonte 2026» y «2027», «Target 2030» y «2035», «Strategy 50» y «75»)
 * distinguen productos con carteras distintas, no clases. Solo se quita el número
 * que va tras «Class»/«Clase», que sí es el de la clase.
 */
export function familyKey(name: string | undefined): string {
  const tokens = fold(name ?? "").split(/[^a-z0-9]+/).filter(Boolean);
  return tokens
    .filter((token, index) => {
      if (CLASS_TOKENS.has(token)) return false;
      return !(/^\d+$/.test(token) && CLASS_NUMBER_PREFIX.has(tokens[index - 1] ?? ""));
    })
    .join(" ");
}

/* ------------------------------------------------------------ exposiciones */

function positiveEntries(map: Record<string, number> | undefined | null): [string, number][] {
  if (!map) return [];
  return Object.entries(map).filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0);
}

/**
 * Distancia entre dos repartos (fracciones): mitad de la norma L1 sobre la unión
 * de claves, cada reparto normalizado a 1. Va de 0 (iguales) a 1 (disjuntos).
 * `null` si alguno no tiene dato.
 */
export function exposureDistance(
  a: Record<string, number> | undefined | null,
  b: Record<string, number> | undefined | null
): number | null {
  const ea = positiveEntries(a);
  const eb = positiveEntries(b);
  if (ea.length === 0 || eb.length === 0) return null;
  const sumA = ea.reduce((sum, [, v]) => sum + v, 0);
  const sumB = eb.reduce((sum, [, v]) => sum + v, 0);
  const keys = new Set([...ea.map(([k]) => k), ...eb.map(([k]) => k)]);
  const mapA = new Map(ea);
  const mapB = new Map(eb);
  let total = 0;
  for (const key of keys) total += Math.abs((mapA.get(key) ?? 0) / sumA - (mapB.get(key) ?? 0) / sumB);
  return total / 2;
}

function assetMixMap(exposure: BdbPmsExposure | undefined): Record<string, number> | null {
  if (!exposure) return null;
  const out: Record<string, number> = {};
  for (const key of ["equity", "fixed_income", "cash", "alternative", "real_asset", "other"] as const) {
    const value = exposure[key];
    if (typeof value === "number" && value > 0) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** El servidor rellena por su clase la mezcla del activo que no la trae (`CLASSIFICATION_FALLBACK`): la misma marca que no cubre en la cobertura (V3-1). */
const MEZCLA_POR_SU_CLASE = "por su clase, sin dato declarado";

/**
 * La mezcla de activos, con el mismo criterio de siempre (decisión 117, B): ninguna propuesta cambia. Pero si alguna de las dos es el relleno por su clase,
 * su distancia compara dos clases y no dos repartos declarados, y no se escribe como una coincidencia medida: PIMCO GIS Global Bond y PIMCO GIS Low
 * Duration Opportunities no declaran mezcla, y «distancia 0 %» era renta fija 100 % contra renta fija 100 %.
 */
function compareAssetMix(original: BdbAssetDetail, candidate: BdbAssetDetail): EquivalenceCriterion {
  const criterion = compareExposure("asset_mix", "Mezcla de activos", assetMixMap(original.pms_exposure), assetMixMap(candidate.pms_exposure), 0.10, 2);
  const porSuClase = [original, candidate].some((asset) => asset.pms_exposure?.source === "CLASSIFICATION_FALLBACK");
  return criterion.status !== "UNKNOWN" && porSuClase ? { ...criterion, detail: MEZCLA_POR_SU_CLASE } : criterion;
}

/* ------------------------------------------------------------- renta fija */

export type CreditBand = "IG" | "HY";

/** Banda crediticia a partir del rating medio del proveedor o del % IG/HY. */
export function creditBand(profile: BdbAssetDetail["fixed_income_profile"]): CreditBand | null {
  if (!profile) return null;
  const quality = fold(profile.avg_credit_quality ?? "").replace(/\s+/g, "");
  if (quality) {
    if (quality.startsWith("bbb") || (quality.startsWith("a") && !quality.startsWith("ab"))) return "IG";
    if (/^(bb|b|ccc|cc|c|belowb|nr|notrated)/.test(quality)) return "HY";
  }
  const ig = profile.investment_grade_pct;
  const hy = profile.high_yield_pct;
  if (typeof ig === "number" && typeof hy === "number" && ig + hy > 0) return ig >= hy ? "IG" : "HY";
  return null;
}

function duration(profile: BdbAssetDetail["fixed_income_profile"]): number | null {
  const value = profile?.effective_duration ?? profile?.modified_duration;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* --------------------------------------------------------------- criterios */

function label(value: string | undefined, table?: Record<string, string>): string | undefined {
  if (!value) return undefined;
  return table?.[value] ?? readableBackendLabel(value);
}

function compareLabels(
  key: string,
  text: string,
  original: string | undefined,
  candidate: string | undefined,
  weight: number,
  options: { blocking?: boolean; table?: Record<string, string>; inferred?: boolean; yaLegible?: boolean } = {}
): EquivalenceCriterion {
  const a = original?.trim();
  const b = candidate?.trim();
  const status: EquivalenceStatus = !a || !b ? "UNKNOWN" : fold(a) === fold(b) ? "MATCH" : "DIFFERS";
  return {
    key, label: text, status, weight,
    original: options.yaLegible ? a : label(a, options.table), candidate: options.yaLegible ? b : label(b, options.table),
    blocking: options.blocking, inferred: options.inferred
  };
}

function compareExposure(
  key: string,
  text: string,
  original: Record<string, number> | null | undefined,
  candidate: Record<string, number> | null | undefined,
  tolerance: number,
  weight: number
): EquivalenceCriterion {
  const distance = exposureDistance(original, candidate);
  if (distance === null) return { key, label: text, status: "UNKNOWN", weight };
  return {
    key, label: text, weight,
    status: distance <= tolerance ? "MATCH" : "DIFFERS",
    detail: `distancia ${oFalta(peso(distance))}`
  };
}

function isFixedIncomeLike(asset: BdbAssetDetail): boolean {
  return asset.economic_asset_class === "FIXED_INCOME" || asset.economic_asset_class === "MONEY_MARKET";
}

function hasEquityExposure(asset: BdbAssetDetail): boolean {
  return asset.economic_asset_class === "EQUITY" || asset.economic_asset_class === "MIXED";
}

function buildCriteria(original: BdbAssetDetail, candidate: BdbAssetDetail, options: Required<EquivalenceOptions>): EquivalenceCriterion[] {
  const traitsA = inferShareClassTraits(original.display_name);
  const traitsB = inferShareClassTraits(candidate.display_name);
  const hedgeA = hedgeForComparison(original.display_name, traitsA.hedged);
  const hedgeB = hedgeForComparison(candidate.display_name, traitsB.hedged);
  const criteria: EquivalenceCriterion[] = [
    compareLabels("vehicle", "Vehículo", original.instrument_type, candidate.instrument_type, 3, { blocking: true, table: TYPE_LABELS }),
    compareLabels("asset_class", "Clase de activo", original.economic_asset_class, candidate.economic_asset_class, 3, { blocking: true, table: CLASS_LABELS }),
    /* Por el nombre que se enseña: la misma categoría en dos idiomas coincide, y nunca sale «Categoría distinta (X → X)» (decisión 101). */
    compareLabels("category", "Categoría", categoriaLegible(original.category), categoriaLegible(candidate.category), 3, { yaLegible: true }),
    compareLabels("region", "Región", original.region, candidate.region, 2),
    compareLabels("distribution", "Política de distribución", traitsA.distribution ?? undefined, traitsB.distribution ?? undefined, 1,
      { inferred: true, table: { ACC: "Acumulación", DIST: "Reparto" } }),
    {
      key: "hedged", label: "Cobertura de divisa", weight: 1, inferred: true,
      status: hedgeA === null || hedgeB === null ? "UNKNOWN" : hedgeA === hedgeB ? "MATCH" : "DIFFERS",
      original: hedgeA === null ? undefined : hedgeA ? "Cubierta" : "Sin cobertura",
      candidate: hedgeB === null ? undefined : hedgeB ? "Cubierta" : "Sin cobertura"
    },
    compareLabels("currency", "Divisa de la clase", original.currency, candidate.currency, 0.5),
    compareAssetMix(original, candidate)
  ];
  if (hasEquityExposure(original)) {
    const a = original.exposure_detail ?? {};
    const b = candidate.exposure_detail ?? {};
    criteria.push(
      compareExposure("sectors", "Sectores", a.sectors, b.sectors, options.exposureTolerance, 1.5),
      compareExposure("equity_regions", "Regiones de la renta variable", a.equity_regions, b.equity_regions, options.exposureTolerance, 1.5),
      compareExposure("market_caps", "Tamaño de las empresas", a.market_caps, b.market_caps, options.exposureTolerance, 1),
      compareExposure("equity_styles", "Estilo", a.equity_styles, b.equity_styles, options.exposureTolerance, 1)
    );
  }
  if (isFixedIncomeLike(original)) {
    const a = original.fixed_income_profile;
    const b = candidate.fixed_income_profile;
    const durationA = duration(a);
    const durationB = duration(b);
    criteria.push({
      key: "duration", label: "Duración", weight: 2, capping: true,
      status: durationA === null || durationB === null ? "UNKNOWN"
        : Math.abs(durationA - durationB) <= options.durationToleranceYears ? "MATCH" : "DIFFERS",
      original: durationA === null ? undefined : `${oFalta(numero(durationA, { decimales: 1 }))} años`,
      candidate: durationB === null ? undefined : `${oFalta(numero(durationB, { decimales: 1 }))} años`,
      detail: durationA !== null && durationB !== null ? `diferencia ${oFalta(numero(Math.abs(durationA - durationB), { decimales: 1 }))} años` : undefined
    });
    const bandA = creditBand(a);
    const bandB = creditBand(b);
    criteria.push({
      key: "credit", label: "Calidad crediticia", weight: 2, capping: true,
      status: !bandA || !bandB ? "UNKNOWN" : bandA === bandB ? "MATCH" : "DIFFERS",
      original: bandA === "IG" ? "Grado de inversión" : bandA === "HY" ? "Alto rendimiento" : undefined,
      candidate: bandB === "IG" ? "Grado de inversión" : bandB === "HY" ? "Alto rendimiento" : undefined
    });
    criteria.push(compareExposure("bond_types", "Tipo de emisor", a?.bond_types, b?.bond_types, options.exposureTolerance, 1.5));
  }
  return criteria;
}

/* --------------------------------------------------------------- veredicto */

function describe(criterion: EquivalenceCriterion): string {
  if (criterion.status === "UNKNOWN") return criterion.label;
  const values = criterion.original && criterion.candidate && criterion.original !== criterion.candidate
    ? `${criterion.original} → ${criterion.candidate}`
    : criterion.detail ?? criterion.original ?? "";
  const inferred = criterion.inferred ? " (inferida)" : "";
  return values ? `${criterion.label}${inferred}: ${values}` : `${criterion.label}${inferred}`;
}

/** Evalúa cuánto se parece `candidate` a `original` con las fichas cargadas. */
export function assessFundEquivalence(
  original: BdbAssetDetail,
  candidate: BdbAssetDetail,
  overrides: EquivalenceOptions = {}
): FundEquivalence {
  const options = { ...DEFAULTS, ...overrides };
  const criteria = buildCriteria(original, candidate, options);
  const evaluatedCriteria = criteria.filter((c) => c.status !== "UNKNOWN");
  const weightTotal = evaluatedCriteria.reduce((sum, c) => sum + c.weight, 0);
  const weightMatched = evaluatedCriteria.filter((c) => c.status === "MATCH").reduce((sum, c) => sum + c.weight, 0);
  const score = weightTotal > 0 ? Math.round((weightMatched / weightTotal) * 1000) / 1000 : 0;
  const shared = criteria.filter((c) => c.status === "MATCH").map(describe);
  const differing = criteria.filter((c) => c.status === "DIFFERS").map(describe);
  const missing = criteria.filter((c) => c.status === "UNKNOWN").map(describe);
  const sameFamily = original.asset_id !== candidate.asset_id
    && familyKey(original.display_name) !== "" && familyKey(original.display_name) === familyKey(candidate.display_name);

  const byKey = new Map(criteria.map((c) => [c.key, c]));
  const blocking = criteria.find((c) => c.blocking && c.status === "DIFFERS");
  const capped = criteria.filter((c) => c.capping && c.status === "DIFFERS");
  const category = byKey.get("category")!;
  const region = byKey.get("region")!;
  const distribution = byKey.get("distribution")!;
  const assetMix = byKey.get("asset_mix")!;

  let verdict: EquivalenceVerdict;
  let reason: string;
  if (blocking) {
    verdict = "NOT_EQUIVALENT";
    reason = `Distinto ${blocking.label.toLocaleLowerCase("es")}: ${blocking.original} → ${blocking.candidate}.`;
  } else if (sameFamily) {
    verdict = "SAME_FUND_CLASS";
    reason = "Otra clase del mismo fondo: misma estrategia, cambian costes, divisa o distribución.";
  } else if (category.status === "DIFFERS" && region.status === "DIFFERS") {
    verdict = "NOT_EQUIVALENT";
    reason = "Ni la categoría ni la región coinciden.";
  } else if (assetMix.status === "DIFFERS") {
    verdict = "NOT_EQUIVALENT";
    reason = `La mezcla de activos difiere (${assetMix.detail}).`;
  } else if (options.requireSameDistribution && distribution.status !== "MATCH") {
    verdict = "COMPARABLE";
    reason = distribution.status === "DIFFERS"
      ? "Distinta política de distribución (inferida del nombre): las series en NAV no son comparables sin reinvertir el reparto."
      : "Política de distribución sin dato: no se puede confirmar que las series sean comparables.";
  } else if (capped.length > 0 && score >= 0.5) {
    verdict = "COMPARABLE";
    reason = `Difieren ${capped.map((c) => c.label.toLocaleLowerCase("es")).join(" y ")}: ${capped.map(describe).join("; ")}.`;
  } else if (category.status === "MATCH" && score >= 0.75) {
    verdict = "EQUIVALENT";
    reason = evaluatedCriteria.length === criteria.length
      ? "Misma categoría y exposiciones coincidentes."
      : `Misma categoría y exposiciones coincidentes; ${missing.length} ${missing.length === 1 ? "criterio" : "criterios"} sin dato.`;
  } else if (score >= 0.5) {
    verdict = "COMPARABLE";
    reason = category.status === "MATCH"
      ? `Misma categoría, pero difieren: ${differing.join("; ")}.`
      : `Categoría distinta (${category.original} → ${category.candidate}) con exposiciones parecidas.`;
  } else {
    verdict = "NOT_EQUIVALENT";
    reason = differing.length ? `Difieren: ${differing.join("; ")}.` : "Faltan datos para establecer la equivalencia.";
  }

  return {
    verdict, score, evaluated: evaluatedCriteria.length, total: criteria.length,
    shared, differing, missing, reason, criteria, sameFamily
  };
}

const VERDICT_ORDER: Record<EquivalenceVerdict, number> = { SAME_FUND_CLASS: 0, EQUIVALENT: 1, COMPARABLE: 2, NOT_EQUIVALENT: 3 };

export const VERDICT_LABELS: Record<EquivalenceVerdict, string> = {
  SAME_FUND_CLASS: "Misma estrategia, otra clase",
  EQUIVALENT: "Equivalente",
  COMPARABLE: "Comparable",
  NOT_EQUIVALENT: "No equivalente"
};

export interface EquivalentCandidate {
  asset: BdbAssetDetail;
  equivalence: FundEquivalence;
}

/**
 * Candidatos de sustitución para una posición, de más a menos afines. Excluye el
 * propio activo, los no invertibles, los benchmarks y los que ya están en cartera.
 * Los «no equivalentes» no se devuelven: el motivo de descarte se obtiene con
 * `assessFundEquivalence` cuando la pantalla quiera enseñarlo.
 */
export function findEquivalentCandidates(
  original: BdbAssetDetail,
  universe: readonly BdbAssetDetail[],
  excludeIds: readonly string[] = [],
  options: EquivalenceOptions = {}
): EquivalentCandidate[] {
  const excluded = new Set([original.asset_id, ...excludeIds]);
  const seen = new Set<string>();
  const out: EquivalentCandidate[] = [];
  for (const asset of universe) {
    if (excluded.has(asset.asset_id) || seen.has(asset.asset_id)) continue;
    if (!asset.is_investable || asset.role === "BENCHMARK") continue;
    seen.add(asset.asset_id);
    const equivalence = assessFundEquivalence(original, asset, options);
    if (equivalence.verdict === "NOT_EQUIVALENT") continue;
    out.push({ asset, equivalence });
  }
  return out.sort((x, y) =>
    VERDICT_ORDER[x.equivalence.verdict] - VERDICT_ORDER[y.equivalence.verdict]
    || y.equivalence.score - x.equivalence.score
    || x.asset.display_name.localeCompare(y.asset.display_name, "es")
  );
}
