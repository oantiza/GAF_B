/**
 * «Mejorar cartera»: del Constructor al servidor y vuelta.
 *
 * Aquí vive lo que no es ni pantalla ni red: construir el conjunto de candidatos
 * por posición (capas 1 y 2 de la equivalencia, con las fichas), traducir los
 * estados de la respuesta y convertir una propuesta en posiciones del Constructor.
 * El servidor mide (capa 3, puertas, ventanas); este módulo no calcula métricas.
 */
import type { BdbAssetDetail, BdbAssetSearchResult, BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { ImprovementProposal, ImprovementResponse, ImprovementStatus } from "../adapters/improvePortfolioBackend";
import { assessFundEquivalence, findEquivalentCandidates, type EquivalenceOptions, type FundEquivalence } from "./fundEquivalence";
import { textoEnPantalla } from "./glosarioDePantalla";
import { candidateRanking } from "./metricsFrequency";
import { isSwapCandidate } from "./fundSwapper";
import { categoriaLegible } from "./etiquetasDeReparto";
import { fecha, peso, porcentaje } from "./formato";

export const DEFAULT_CANDIDATES_PER_POSITION = 5;
/** Preselección por etiquetas antes de pedir fichas: acota las lecturas de detalle. */
export const PRESELECTION_PER_POSITION = 12;

export interface ImprovementCandidateSet {
  /** Posición → ids de candidatos, de más a menos afines. */
  candidates: Record<string, string[]>;
  /** Posición → candidatos que son otra clase del mismo fondo (bloque aparte, no consumen sustitución). */
  sameFundClass: Record<string, string[]>;
  /** Fichas de los candidatos (y de las posiciones), para la revisión y el guardado. */
  assetsById: Map<string, BdbAssetDetail>;
  /** Equivalencia posición→candidato, con la clave `${posición}:${candidato}`. */
  equivalence: Map<string, FundEquivalence>;
  /** Posiciones sin candidatos y por qué. */
  skipped: { asset_id: string; reason: string }[];
}

function norm(value: string | undefined): string {
  return (value ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Capa 1 sobre el catálogo (sin fichas): mismo vehículo, misma clase económica,
 * invertible, no en cartera, y categoría o región coincidentes. Orden: categoría
 * igual primero, después el criterio único de `candidateRanking`.
 */
export function preselectCandidates(
  original: BdbAssetDetail,
  universe: readonly BdbAssetSearchResult[],
  heldIds: readonly string[],
  limit = PRESELECTION_PER_POSITION
): BdbAssetSearchResult[] {
  const held = new Set([original.asset_id, ...heldIds]);
  /* Por el nombre que se enseña: la misma categoría en dos idiomas es la misma (decisión 101). */
  const category = norm(categoriaLegible(original.category));
  const region = norm(original.region);
  const seen = new Set<string>();
  const pool = universe.filter((asset) => {
    if (held.has(asset.asset_id) || seen.has(asset.asset_id) || !isSwapCandidate(asset)) return false;
    seen.add(asset.asset_id);
    if (asset.instrument_type !== original.instrument_type || asset.economic_asset_class !== original.economic_asset_class) return false;
    const sameCategory = Boolean(category) && norm(categoriaLegible(asset.category)) === category;
    const sameRegion = Boolean(region) && norm(asset.region) === region;
    return sameCategory || sameRegion;
  });
  const ranking = candidateRanking(pool);
  return pool
    .sort((a, b) => {
      const catA = norm(categoriaLegible(a.category)) === category ? 0 : 1;
      const catB = norm(categoriaLegible(b.category)) === category ? 0 : 1;
      return catA - catB || ranking.compare(a, b);
    })
    .slice(0, limit);
}

export interface BuildCandidatesInput {
  positions: readonly BdbManualPortfolioPosition[];
  assets: readonly BdbAssetDetail[];
  universe: readonly BdbAssetSearchResult[];
  /** Fichas completas de los ids pedidos (lotes de hasta 25 en la fuente en vivo). */
  loadDetails: (assetIds: string[]) => Promise<BdbAssetDetail[]>;
  perPosition?: number;
  equivalence?: EquivalenceOptions;
}

/** Candidatos equivalentes por posición: etiquetas sobre el catálogo, después fichas. */
export async function buildImprovementCandidates(input: BuildCandidatesInput): Promise<ImprovementCandidateSet> {
  const perPosition = input.perPosition ?? DEFAULT_CANDIDATES_PER_POSITION;
  const byId = new Map(input.assets.map((asset) => [asset.asset_id, asset]));
  const heldIds = input.positions.map((position) => position.asset_id);
  const skipped: ImprovementCandidateSet["skipped"] = [];
  const preselected = new Map<string, BdbAssetSearchResult[]>();
  for (const position of input.positions) {
    if (!(position.weight_percent > 0)) continue;
    const original = byId.get(position.asset_id);
    if (!original) {
      skipped.push({ asset_id: position.asset_id, reason: "Sin ficha cargada en la fuente activa." });
      continue;
    }
    if (original.instrument_type !== "FUND") {
      skipped.push({ asset_id: position.asset_id, reason: "Solo se sustituyen fondos por fondos." });
      continue;
    }
    const shortlist = preselectCandidates(original, input.universe, heldIds);
    if (shortlist.length === 0) {
      skipped.push({ asset_id: position.asset_id, reason: "Sin fondos de la misma categoría o región en el catálogo." });
      continue;
    }
    preselected.set(position.asset_id, shortlist);
  }

  const detailIds = [...new Set([...preselected.values()].flat().map((asset) => asset.asset_id))];
  const assetsById = new Map(byId);
  for (let start = 0; start < detailIds.length; start += 25) {
    const details = await input.loadDetails(detailIds.slice(start, start + 25));
    for (const detail of details) assetsById.set(detail.asset_id, detail);
  }

  const candidates: Record<string, string[]> = {};
  const sameFundClass: Record<string, string[]> = {};
  const equivalence = new Map<string, FundEquivalence>();
  for (const [positionId, shortlist] of preselected) {
    const original = byId.get(positionId)!;
    const details = shortlist.map((asset) => assetsById.get(asset.asset_id)).filter((asset): asset is BdbAssetDetail => Boolean(asset));
    const ranked = findEquivalentCandidates(original, details, heldIds, input.equivalence).slice(0, perPosition);
    if (ranked.length === 0) {
      const reasons = details.map((detail) => assessFundEquivalence(original, detail, input.equivalence).reason);
      skipped.push({ asset_id: positionId, reason: reasons[0] ? `Ningún candidato equivalente: ${reasons[0]}` : "Ningún candidato equivalente." });
      continue;
    }
    candidates[positionId] = ranked.map(({ asset }) => asset.asset_id);
    const classes = ranked.filter((item) => item.equivalence.verdict === "SAME_FUND_CLASS").map(({ asset }) => asset.asset_id);
    if (classes.length) sameFundClass[positionId] = classes;
    for (const item of ranked) equivalence.set(`${positionId}:${item.asset.asset_id}`, item.equivalence);
  }
  return { candidates, sameFundClass, assetsById, equivalence, skipped };
}

export const IMPROVEMENT_STATUS_LABELS: Record<ImprovementStatus, string> = {
  PROPOSAL: "Propuesta que cumple las condiciones",
  NO_IMPROVEMENT: "Sin mejora entre las alternativas evaluadas",
  INSUFFICIENT_DATA: "Datos insuficientes para concluir",
  INFEASIBLE: "Restricciones incompatibles o sin candidatos",
  WINDOW_TOO_SHORT: "Tramo demasiado corto para anualizar"
};

const REJECTION_LABELS: Record<string, string> = {
  LOW_CORRELATION: "Se comporta distinto al original (correlación baja)",
  CORRELATION_UNAVAILABLE: "No se puede medir si se parece al original: una de las dos series no varía (correlación no calculable)",
  REFERENCE_LINK_FAILED: "Su historia no se pudo completar con su referencia",
  SERIES_ENDS_EARLY: "Sus precios acaban antes del final del periodo",
  HIGH_TRACKING_ERROR: "Se desvía demasiado del original (tracking error alto)",
  INSUFFICIENT_HISTORY: "Histórico insuficiente para la ventana",
  PRICE_SERIES_MISSING: "Sin serie de precios en la maestra",
  QUALITY_BLOCKED: "Serie bloqueada por calidad",
  FX_SERIES_MISSING: "Serie sin conversión a euros",
  FX_QUARANTINE: "Serie sin conversión a euros fiable",
  DISTRIBUTES_WITHOUT_PAYMENTS: "Reparte y no tenemos todos los pagos",
  NON_INVESTABLE: "No invertible",
  NON_INVESTABLE_CORPORATE_ACTION: "Baja por fusión: no admite nuevas selecciones",
  ASSET_CAP_EXCEEDED: "Fuera por el tope de activos",
  POSITION_HISTORY_EXTENDED: "La posición tiene un tramo estimado con su referencia: no se le buscan sustitutos"
};

export function rejectionLabel(reason: string): string {
  return REJECTION_LABELS[reason] ?? reason;
}

/** Un criterio dentro de la frase: la inicial en minúscula, salvo un nombre propio. «Sharpe» se queda, como en la pantalla (revisión final, V3-7). */
const enLaFrase = (rotulo: string) =>
  /^(Sharpe|Sortino|Calmar)\b/.test(rotulo) ? rotulo : `${rotulo.charAt(0).toLocaleLowerCase("es")}${rotulo.slice(1)}`;

/** Frase única para la cabecera del resultado. */
export function improvementSummary(response: ImprovementResponse): string {
  if (response.status === "PROPOSAL") {
    const best = response.proposals[0];
    const classes = best?.substitutions.filter((sub) => sub.same_fund_class).length ?? 0;
    const changes = (best?.substitutions.length ?? 0) - classes;
    const improved = best?.improvements.map((item) => enLaFrase(item.label)).join(", ") || "al menos un criterio";
    const classText = classes === 0 ? "" : classes === 1 ? " y un cambio de clase del mismo fondo" : ` y ${classes} cambios de clase del mismo fondo`;
    if (changes === 0) {
      return `${classes === 1 ? "Un cambio de clase del mismo fondo" : `${classes} cambios de clase del mismo fondo`} que no empeora${classes === 1 ? "" : "n"} ningún criterio obligatorio y mejora${classes === 1 ? "" : "n"} ${improved}.`;
    }
    return changes === 1
      ? `Una sustitución${classText} que no empeora ningún criterio obligatorio y mejora ${improved}.`
      : `${changes} sustituciones${classText} que no empeoran ningún criterio obligatorio y mejoran ${improved}.`;
  }
  if (response.status === "INSUFFICIENT_DATA") {
    const missing = response.missing_assets?.length ?? 0;
    return missing > 0
      ? `${missing === 1 ? "Una posición" : `${missing} posiciones`} de la cartera no tiene${missing === 1 ? "" : "n"} serie que cubra la ventana.`
      : "La cartera no tiene histórico común suficiente en la ventana.";
  }
  return response.reason ?? IMPROVEMENT_STATUS_LABELS[response.status];
}

/**
 * Decisión 97: quien no tiene precios para la ventana, y qué se puede hacer. La pantalla ofrece 3 y 5 años, así que a 3 no hay ventana más corta a la
 * que ir, y a 5 solo se aconseja la de 3 si el servidor dice que la cubre: aconsejarla a quien tampoco llega sería la frase falsa de antes.
 */
function fraseDeLaVentanaQueFalta(nombre: string, ventana: ImprovementResponse["window"], cubreOtra: string | undefined, soloQuedaEsa: boolean): string {
  /* Desde el 15-11-2026 el servidor aparta a quien no cubre la ventana y mide el resto, como Simular: si aun así no hay
     cartera que evaluar es porque no queda ninguna, y «quítalo para evaluar el resto» ya no es verdad. */
  const hazAlgo = soloQuedaEsa ? "sustitúyelo para poder evaluar la cartera." : "sustitúyelo o quítalo para evaluar el resto.";
  if (ventana === "3Y") return `${nombre} no tiene precios para los 3 años, la ventana más corta aquí: ${hazAlgo}`;
  if (ventana === "5Y") {
    return cubreOtra === "3Y"
      ? `${nombre} no tiene precios para los 5 años. Prueba a 3 años o sustitúyelo.`
      : `${nombre} no tiene precios para los 5 años, ni para los 3, la ventana más corta aquí: ${hazAlgo}`;
  }
  return `${nombre} no tiene precios para toda la ventana: ${hazAlgo}`;
}

/** Qué le pasa a una posición que deja la cartera sin evaluar. El motivo lo trae el servidor, y no siempre es falta de precios. */
function fraseDeLaPosicionQueFalta(nombre: string, motivo: string | undefined, ventana: ImprovementResponse["window"], cubreOtra: string | undefined, soloQuedaEsa: boolean): string {
  if (motivo === "QUALITY_BLOCKED") return `${nombre}: su serie de precios no pasó el control de calidad. Sustitúyelo para poder evaluar la cartera.`;
  if (motivo === "INSUFFICIENT_HISTORY") return fraseDeLaVentanaQueFalta(nombre, ventana, cubreOtra, soloQuedaEsa);
  /* Un fondo que reparte no tiene nada malo: lo que falta es nuestro dato, y no se empuja a venderlo por eso. */
  if (motivo === "DISTRIBUTES_WITHOUT_PAYMENTS") return `${nombre}. Este fondo reparte y no tenemos todos sus pagos: mientras esté en la cartera no se puede evaluar.`;
  const etiqueta = motivo ? REJECTION_LABELS[motivo] : undefined;
  return etiqueta
    ? `${nombre}: ${textoEnPantalla(etiqueta).toLocaleLowerCase("es")}. Sustitúyelo para poder evaluar la cartera.`
    : `${nombre} no se ha podido medir en esta ventana.`;
}

/**
 * La frase de la cabecera en pantalla: con datos insuficientes dice qué posición es y por qué, que es lo único que
 * permite hacer algo. `improvementSummary` se queda como está porque la imprimen los PDF.
 */
export function resumenDeLaMejoraEnPantalla(response: ImprovementResponse, nombreDe: (assetId: string) => string): string {
  const faltan = response.status === "INSUFFICIENT_DATA" ? response.missing_assets ?? [] : [];
  if (faltan.length === 0) return textoEnPantalla(improvementSummary(response));
  const fuera = new Map(response.excluded_assets.map((item) => [item.asset_id, item]));
  const midePorSimular = response.excluded_positions !== undefined;
  return faltan.map((assetId) => fraseDeLaPosicionQueFalta(nombreDe(assetId), fuera.get(assetId)?.reason, response.window, fuera.get(assetId)?.covers_window, midePorSimular)).join(" ");
}

/** Lo que dice cada tramo de una ventana en palabras. */
const NOMBRE_DEL_TRAMO = { selection: "selección", confirmation: "confirmación", full: "ventana completa" } as const;

export interface NotasDelPeriodo {
  /** De qué fecha a qué fecha se ha medido, y que es el periodo de Simular. */
  periodo: string | null;
  /** Las posiciones que se quedan fuera de la medición, con su peso y su motivo. */
  apartadas: string | null;
  /** Las posiciones completadas con una referencia antes de su inicio real. */
  completadas: string | null;
  /** Si hubo que recortar candidatos para caber en el cálculo. */
  recorte: string | null;
  /** El €STR de cada tramo. */
  tipoLibre: string | null;
}

/**
 * Las notas que acompañan a un resultado medido con el periodo de Simular (15-11-2026). Las comparten la pantalla y el
 * PDF de la propuesta, para que digan lo mismo. Con un servidor anterior todo sale `null` y cada una dice lo de antes.
 */
export function notasDelPeriodo(response: ImprovementResponse, nombreDe: (assetId: string) => string): NotasDelPeriodo {
  const ventana = response.window ? response.window.replace("Y", " años") : null;
  const full = response.windows?.full;
  const periodo = response.excluded_positions !== undefined && full
    ? `Medido del ${fecha(full.first_date) ?? ""} al ${fecha(full.last_date) ?? ""}, el mismo periodo que la simulación${ventana ? ` a ${ventana}` : ""}.`
    : null;
  const fuera = response.excluded_positions ?? [];
  const apartadas = fuera.length > 0
    ? `Fuera de la medición, como en la simulación: ${fuera.map((item) => {
      const otra = item.covers_window ? `; a ${item.covers_window.replace("Y", " años")} sí se mide` : "";
      return `${nombreDe(item.asset_id)} (${peso(item.weight) ?? ""}), ${textoEnPantalla(rejectionLabel(item.reason)).toLocaleLowerCase("es")}${otra}`;
    }).join("; ")}. ${typeof response.coverage_weight_percent === "number" ? `Se mide el resto, el ${peso(response.coverage_weight_percent / 100) ?? ""} del peso, ` : "Se mide el resto, "}y para ${fuera.length === 1 ? "esa posición" : "esas posiciones"} no se buscan sustitutos.`
    : null;
  const extensiones = response.extensions ?? [];
  const completadas = extensiones.length > 0
    ? `Completada${extensiones.length === 1 ? "" : "s"} con una referencia antes de su inicio real, como en la simulación: ${extensiones
      .map((item) => `${nombreDe(item.asset_id)}, con ${item.reference} hasta el ${fecha(item.observed_from) ?? ""}`).join("; ")}. Ese tramo es estimado, no historia observada, y por eso a ${extensiones.length === 1 ? "esa posición" : "esas posiciones"} no se le${extensiones.length === 1 ? "" : "s"} buscan sustitutos.`
    : null;
  const tope = response.candidates_per_position;
  const recorte = tope?.trimmed
    ? `La cartera y sus candidatos pasaban de ${tope.max_assets} activos: se ${tope.evaluated === 1 ? "ha evaluado el primer candidato" : `han evaluado los ${tope.evaluated} primeros candidatos`} de cada posición, de los ${tope.requested} que podía tener.`
    : null;
  const porTramo = response.risk_free_by_window;
  const tramos = porTramo ? (["selection", "confirmation", "full"] as const).filter((key) => porTramo[key]) : [];
  const tipoLibre = tramos.length > 0
    ? `€STR medio de cada tramo: ${tramos.map((key) => `${NOMBRE_DEL_TRAMO[key]} ${porcentaje(porTramo![key]!.risk_free_rate) ?? ""}`).join(", ")}`
    : null;
  return { periodo, apartadas, completadas, recorte, tipoLibre };
}

/**
 * Lo que `excluded_assets` añade a lo que ya se dice en otro sitio. Desde el 15-11-2026 repite las posiciones apartadas
 * (que tienen su nota) y los candidatos sin medir (que salen, con su motivo, entre los descartes de su posición).
 */
export function excluidosSinRepetir(response: ImprovementResponse): ImprovementResponse["excluded_assets"] {
  const dichos = new Set([
    ...(response.excluded_positions ?? []).map((item) => item.asset_id),
    ...Object.values(response.rejected_candidates).flatMap((items) => items.map((item) => item.asset_id))
  ]);
  return response.excluded_assets.filter((item) => !dichos.has(item.asset_id));
}

/** Ids con candado que están entre las posiciones invertidas, en orden estable: lo que la huella del cálculo recuerda. */
export function improvementLockKey(
  positions: readonly Pick<BdbManualPortfolioPosition, "asset_id" | "weight_percent">[],
  lockedIds: readonly string[] = []
): string {
  const held = new Set(positions.filter((position) => position.weight_percent > 0).map((position) => position.asset_id));
  return [...new Set(lockedIds)].filter((id) => held.has(id)).sort().join(",");
}

/**
 * Posiciones del Constructor con las sustituciones aplicadas y los pesos intactos.
 * Una posición con candado no se sustituye nunca, aunque la propuesta la nombre (H1-12):
 * el candado puede haberse puesto después del cálculo.
 */
export function proposalPositions(
  positions: readonly BdbManualPortfolioPosition[],
  proposal: ImprovementProposal,
  lockedIds: readonly string[] = []
): BdbManualPortfolioPosition[] {
  const locked = new Set(lockedIds);
  const replacement = new Map(proposal.substitutions.filter((s) => !locked.has(s.from_asset_id)).map((s) => [s.from_asset_id, s]));
  return positions.map((position) => {
    const sub = replacement.get(position.asset_id);
    return sub
      ? { ...position, asset_id: sub.to_asset_id, label: sub.to_name, keepEuros: undefined, targetEuros: undefined }
      : { ...position };
  });
}
