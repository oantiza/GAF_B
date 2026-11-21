import type { BdbAssetDataSourceKind, BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../types/bdbAssets";
import type { CarteraAbierta } from "./carteraActiva";
import { perfilYHorizonteDe, type PerfilYHorizonte } from "./perfilYHorizonte";

export const LOCAL_PORTFOLIOS_STORAGE_KEY = "bdb-activos.local-portfolios.v1";
export const CURRENT_PORTFOLIO_STORAGE_KEY = "bdb-activos.current-portfolio.v1";
/** Qué cartera guardada está abierta en Diseño de cartera (hallazgo 47). Va junto al borrador. */
export const OPEN_PORTFOLIO_STORAGE_KEY = "bdb-activos.open-portfolio.v1";
/** Nivel de perfil y horizonte de lo que hay en Diseño (decisión 59). Clave aparte: las escrituras del
    borrador, una por campo, rehacen su documento y lo borrarían. */
export const CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY = "bdb-activos.current-portfolio-profile.v1";
export const LOCAL_PORTFOLIO_STORAGE_SCHEMA_VERSION = "local-portfolios.v1";
export const CURRENT_PORTFOLIO_STORAGE_SCHEMA_VERSION = "current-portfolio.v1";

/** Auditoría 11-08 (F2.7): capital ILUSTRATIVO del Constructor (100.000 €).
    Auditoría 29-09 (F-04): ya NO se hidrata como capital real. El capital del
    borrador es `undefined` hasta que el usuario lo teclea, lo trae un extracto
    o una cartera guardada; así el informe imprime N/D y base 100 en vez de
    una «valoración» de 100.000 € que nadie ha dado. El Constructor sigue
    enseñando esta cifra para repartir importes, marcada como ilustrativa. */
export const DEFAULT_DRAFT_TOTAL_CAPITAL = 100000;

const localOnlyNotice =
  "Guardado local en este navegador/dispositivo. No contiene datos maestros ni métricas oficiales.";

export interface LocalPortfolioStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface LocalPortfolioStorageSnapshot {
  schema_version: typeof LOCAL_PORTFOLIO_STORAGE_SCHEMA_VERSION;
  updated_at: string;
  local_only_notice: string;
  saved_portfolios: BdbSavedLocalPortfolio[];
}

interface CurrentPortfolioStorageSnapshot {
  schema_version: typeof CURRENT_PORTFOLIO_STORAGE_SCHEMA_VERSION;
  updated_at: string;
  local_only_notice: string;
  sourceKind: BdbAssetDataSourceKind;
  positions: BdbManualPortfolioPosition[];
  /** Auditoría 11-08 (F2.7): campo opcional retrocompatible; si falta se hidrata el default. */
  total_capital?: number;
  /** Ola 1 (E1, 03-09): nombre de la cartera activa (cliente · propuesta). Opcional y retrocompatible. */
  name?: string;
}

/* Es `clampPercent` de `portfolio.ts`, repetido a propósito: este fichero lo lee el marco al arrancar, y
   importar aquel arrastraba a la carga inicial el motor de métricas entero para una sola línea. */
function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizePosition(value: unknown): BdbManualPortfolioPosition | null {
  if (!isRecord(value) || typeof value.asset_id !== "string" || typeof value.weight_percent !== "number") {
    return null;
  }

  return {
    asset_id: value.asset_id,
    weight_percent: clampPercent(value.weight_percent),
    label: typeof value.label === "string" ? value.label : undefined,
    keepEuros: typeof value.keepEuros === "boolean" ? value.keepEuros : undefined,
    targetEuros:
      typeof value.targetEuros === "number" && Number.isFinite(value.targetEuros) && value.targetEuros >= 0
        ? value.targetEuros
        : undefined
  };
}

function sanitizePositions(values: unknown): BdbManualPortfolioPosition[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map(sanitizePosition)
    .filter((position): position is BdbManualPortfolioPosition => Boolean(position));
}

/** Auditoría 11-08 (F2.7): capital inválido (negativo, NaN, no numérico) → undefined,
    de modo que al hidratar se aplica el default actual (100.000 €). */
export const DRAFT_NAME_MAX_LENGTH = 80;

/** Nombre de la cartera activa: texto plano, recortado, sin saltos de línea. */
export function sanitizeDraftName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, DRAFT_NAME_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeDraftTotalCapital(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function sanitizeSourceKind(value: unknown): BdbAssetDataSourceKind | null {
  if (
    value === "LOCAL_MOCK" ||
    value === "BBDD_STATIC_EXPORT_SAMPLE" ||
    value === "BBDD_LIVE_API"
  ) {
    return value;
  }

  return null;
}

function sanitizeSavedPortfolio(value: unknown): BdbSavedLocalPortfolio | null {
  if (
    !isRecord(value) ||
    typeof value.portfolio_id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }

  const sourceKind = sanitizeSourceKind(value.sourceKind);

  if (!sourceKind) {
    return null;
  }

  return {
    portfolio_id: value.portfolio_id,
    name: value.name,
    created_at: value.created_at,
    updated_at: value.updated_at,
    sourceKind,
    positions: sanitizePositions(value.positions),
    total_capital: typeof value.total_capital === "number" && value.total_capital >= 0 ? value.total_capital : undefined,
    /* Decisión 59: lo que no valida se queda fuera, sin sustituirlo por nada. */
    ...perfilYHorizonteDe(value)
  };
}

export function serializeLocalPortfolios(
  savedPortfolios: BdbSavedLocalPortfolio[],
  now = new Date().toISOString()
): string {
  const snapshot: LocalPortfolioStorageSnapshot = {
    schema_version: LOCAL_PORTFOLIO_STORAGE_SCHEMA_VERSION,
    updated_at: now,
    local_only_notice: localOnlyNotice,
    saved_portfolios: savedPortfolios
      .map(sanitizeSavedPortfolio)
      .filter((portfolio): portfolio is BdbSavedLocalPortfolio => Boolean(portfolio))
  };

  return JSON.stringify(snapshot);
}

export function parseLocalPortfolios(value: string | null): BdbSavedLocalPortfolio[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!isRecord(parsed) || parsed.schema_version !== LOCAL_PORTFOLIO_STORAGE_SCHEMA_VERSION) {
      return [];
    }

    return Array.isArray(parsed.saved_portfolios)
      ? parsed.saved_portfolios
          .map(sanitizeSavedPortfolio)
          .filter((portfolio): portfolio is BdbSavedLocalPortfolio => Boolean(portfolio))
      : [];
  } catch {
    return [];
  }
}

export function readLocalPortfoliosFromStorage(storage: LocalPortfolioStorageLike | undefined): BdbSavedLocalPortfolio[] {
  try {
    return parseLocalPortfolios(storage?.getItem(LOCAL_PORTFOLIOS_STORAGE_KEY) ?? null);
  } catch {
    return [];
  }
}

/**
 * Las carteras guardadas que no se pueden leer (IMP-9, auditoría del 16-11-2026): las que están en el almacén y no validan
 * —de una versión anterior, o con un campo que ya no se admite—. No se enseñan, pero tampoco se tiran: antes, guardar otra
 * cartera reescribía la lista con las que se leían, y esta desaparecía para siempre sin que nadie lo supiera.
 */
export function carterasQueNoSeLeen(storage: LocalPortfolioStorageLike | undefined): unknown[] {
  try {
    const crudo = storage?.getItem(LOCAL_PORTFOLIOS_STORAGE_KEY) ?? null;
    if (!crudo) return [];
    const parsed = JSON.parse(crudo) as unknown;
    if (!isRecord(parsed) || parsed.schema_version !== LOCAL_PORTFOLIO_STORAGE_SCHEMA_VERSION || !Array.isArray(parsed.saved_portfolios)) return [];
    return parsed.saved_portfolios.filter((entrada) => sanitizeSavedPortfolio(entrada) === null);
  } catch {
    return [];
  }
}

export function writeLocalPortfoliosToStorage(
  storage: LocalPortfolioStorageLike | undefined,
  savedPortfolios: BdbSavedLocalPortfolio[]
): void {
  try {
    /* Las que no se leen se conservan tal cual, detrás de las que sí (`carterasQueNoSeLeen`). Solo las del mismo esquema:
       un almacén de otra versión entera no se mezcla con este. */
    const apartadas = carterasQueNoSeLeen(storage);
    const snapshot = JSON.parse(serializeLocalPortfolios(savedPortfolios)) as Omit<LocalPortfolioStorageSnapshot, "saved_portfolios"> & { saved_portfolios: unknown[] };
    if (apartadas.length > 0) snapshot.saved_portfolios = [...snapshot.saved_portfolios, ...apartadas];
    storage?.setItem(LOCAL_PORTFOLIOS_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    return;
  }
}

export function serializeCurrentPortfolioDraft(options: {
  sourceKind: BdbAssetDataSourceKind;
  positions: BdbManualPortfolioPosition[];
  totalCapital?: number;
  name?: string;
  now?: string;
}): string {
  const totalCapital = sanitizeDraftTotalCapital(options.totalCapital);
  const name = sanitizeDraftName(options.name);
  const snapshot: CurrentPortfolioStorageSnapshot = {
    schema_version: CURRENT_PORTFOLIO_STORAGE_SCHEMA_VERSION,
    updated_at: options.now ?? new Date().toISOString(),
    local_only_notice: localOnlyNotice,
    sourceKind: options.sourceKind,
    positions: sanitizePositions(options.positions),
    ...(totalCapital !== undefined ? { total_capital: totalCapital } : {}),
    ...(name !== undefined ? { name } : {})
  };

  return JSON.stringify(snapshot);
}

export function parseCurrentPortfolioDraft(
  value: string | null
): Pick<CurrentPortfolioStorageSnapshot, "sourceKind" | "positions" | "total_capital" | "name"> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!isRecord(parsed) || parsed.schema_version !== CURRENT_PORTFOLIO_STORAGE_SCHEMA_VERSION) {
      return null;
    }

    const sourceKind = sanitizeSourceKind(parsed.sourceKind);

    if (!sourceKind) {
      return null;
    }

    return {
      sourceKind,
      positions: sanitizePositions(parsed.positions),
      total_capital: sanitizeDraftTotalCapital(parsed.total_capital),
      name: sanitizeDraftName(parsed.name)
    };
  } catch {
    return null;
  }
}

export function readCurrentPortfolioDraftFromStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind
): BdbManualPortfolioPosition[] {
  try {
    const draft = parseCurrentPortfolioDraft(storage?.getItem(CURRENT_PORTFOLIO_STORAGE_KEY) ?? null);

    return draft?.sourceKind === sourceKind ? draft.positions : [];
  } catch {
    return [];
  }
}

export function writeCurrentPortfolioDraftToStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind,
  positions: BdbManualPortfolioPosition[]
): void {
  try {
    const currentDraft = parseCurrentPortfolioDraft(storage?.getItem(CURRENT_PORTFOLIO_STORAGE_KEY) ?? null);
    // Auditoría 11-08 (F2.7): las escrituras de posiciones (BdbActivosApp) no
    // conocen el capital; se conserva el ya persistido de la misma fuente para
    // que cada cambio de posiciones no borre el capital del borrador.
    const preservedCapital = currentDraft?.sourceKind === sourceKind ? currentDraft.total_capital : undefined;
    const preservedName = currentDraft?.sourceKind === sourceKind ? currentDraft.name : undefined;

    if (positions.length === 0) {
      if (currentDraft?.sourceKind !== sourceKind) {
        return;
      }

      if (preservedCapital === undefined && preservedName === undefined) {
        storage?.removeItem(CURRENT_PORTFOLIO_STORAGE_KEY);
        return;
      }

      // Con capital o nombre persistidos se conserva un borrador sin posiciones:
      // vaciar la cartera no debe devolver el capital a 100.000 € tras un F5 (F2.7).
      storage?.setItem(
        CURRENT_PORTFOLIO_STORAGE_KEY,
        serializeCurrentPortfolioDraft({ sourceKind, positions: [], totalCapital: preservedCapital, name: preservedName })
      );
      return;
    }

    storage?.setItem(
      CURRENT_PORTFOLIO_STORAGE_KEY,
      serializeCurrentPortfolioDraft({ sourceKind, positions, totalCapital: preservedCapital, name: preservedName })
    );
  } catch {
    return;
  }
}

/** Auditoría 11-08 (F2.7): hidrata el capital del borrador activo. F-04: si
    falta, es inválido o pertenece a otra fuente devuelve `undefined` (capital
    sin fijar), nunca el ilustrativo de 100.000 €. */
export function readCurrentPortfolioDraftCapitalFromStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind
): number | undefined {
  try {
    const draft = parseCurrentPortfolioDraft(storage?.getItem(CURRENT_PORTFOLIO_STORAGE_KEY) ?? null);

    return draft?.sourceKind === sourceKind && draft.total_capital !== undefined
      ? draft.total_capital
      : undefined;
  } catch {
    return undefined;
  }
}

/** Auditoría 11-08 (F2.7): persiste el capital del borrador activo conservando
    las posiciones ya guardadas. Valores inválidos se ignoran y, como las
    escrituras vacías de posiciones, nunca pisa el borrador de otra fuente.
    F-04: `undefined` significa «capital sin fijar» y borra el capital del
    borrador existente (vaciar el Constructor); sin borrador no escribe nada. */
export function writeCurrentPortfolioDraftCapitalToStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind,
  totalCapital: number | undefined
): void {
  try {
    const currentDraft = parseCurrentPortfolioDraft(storage?.getItem(CURRENT_PORTFOLIO_STORAGE_KEY) ?? null);
    if (currentDraft && currentDraft.sourceKind !== sourceKind) {
      return;
    }

    if (totalCapital === undefined) {
      if (currentDraft && currentDraft.total_capital !== undefined) {
        storage?.setItem(
          CURRENT_PORTFOLIO_STORAGE_KEY,
          serializeCurrentPortfolioDraft({ sourceKind, positions: currentDraft.positions, name: currentDraft.name })
        );
      }
      return;
    }

    const safeCapital = sanitizeDraftTotalCapital(totalCapital);
    if (safeCapital === undefined) {
      return;
    }

    storage?.setItem(
      CURRENT_PORTFOLIO_STORAGE_KEY,
      serializeCurrentPortfolioDraft({
        sourceKind,
        positions: currentDraft?.positions ?? [],
        totalCapital: safeCapital,
        name: currentDraft?.name
      })
    );
  } catch {
    return;
  }
}

/** Ola 1 (E1): hidrata el nombre de la cartera activa; vacío si falta o es de otra fuente. */
export function readCurrentPortfolioDraftNameFromStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind
): string {
  try {
    const draft = parseCurrentPortfolioDraft(storage?.getItem(CURRENT_PORTFOLIO_STORAGE_KEY) ?? null);
    return draft?.sourceKind === sourceKind ? (draft.name ?? "") : "";
  } catch {
    return "";
  }
}

/** Ola 1 (E1): persiste el nombre conservando posiciones y capital. Nunca pisa el borrador de otra fuente. */
export function writeCurrentPortfolioDraftNameToStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind,
  name: string
): void {
  try {
    const safeName = sanitizeDraftName(name);
    const currentDraft = parseCurrentPortfolioDraft(storage?.getItem(CURRENT_PORTFOLIO_STORAGE_KEY) ?? null);
    if (currentDraft && currentDraft.sourceKind !== sourceKind) {
      return;
    }
    if (!currentDraft && safeName === undefined) {
      return;
    }
    if (currentDraft && (currentDraft.name ?? undefined) === safeName) {
      return;
    }
    storage?.setItem(
      CURRENT_PORTFOLIO_STORAGE_KEY,
      serializeCurrentPortfolioDraft({
        sourceKind,
        positions: currentDraft?.positions ?? [],
        totalCapital: currentDraft?.total_capital,
        name: safeName
      })
    );
  } catch {
    return;
  }
}

/** Qué cartera guardada está abierta; `null` si no consta, es de otra fuente o no se puede leer. */
export function readCarteraAbiertaFromStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind
): CarteraAbierta | null {
  try {
    const parsed = JSON.parse(storage?.getItem(OPEN_PORTFOLIO_STORAGE_KEY) ?? "null") as unknown;
    const valida =
      isRecord(parsed) &&
      parsed.sourceKind === sourceKind &&
      [parsed.portfolio_id, parsed.created_at, parsed.updated_at, parsed.huella].every((campo) => typeof campo === "string");
    return valida ? (parsed as unknown as CarteraAbierta) : null;
  } catch {
    return null;
  }
}

export function writeCarteraAbiertaToStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind,
  abierta: CarteraAbierta | null
): void {
  try {
    if (abierta) {
      storage?.setItem(OPEN_PORTFOLIO_STORAGE_KEY, JSON.stringify({ sourceKind, ...abierta }));
    } else {
      storage?.removeItem(OPEN_PORTFOLIO_STORAGE_KEY);
    }
  } catch {
    return;
  }
}

/** Nivel de perfil y horizonte de lo que hay en Diseño; vacío si no consta, es de otra fuente o no valida. */
export function readPerfilYHorizonteFromStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind
): PerfilYHorizonte {
  try {
    const parsed = JSON.parse(storage?.getItem(CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY) ?? "null") as unknown;
    return isRecord(parsed) && parsed.sourceKind === sourceKind ? perfilYHorizonteDe(parsed) : {};
  } catch {
    return {};
  }
}

export function writePerfilYHorizonteToStorage(
  storage: LocalPortfolioStorageLike | undefined,
  sourceKind: BdbAssetDataSourceKind,
  valor: PerfilYHorizonte
): void {
  try {
    const limpio = perfilYHorizonteDe(valor);
    if (limpio.risk_profile_level === undefined && limpio.horizon_years === undefined) {
      storage?.removeItem(CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY);
    } else {
      storage?.setItem(CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY, JSON.stringify({ sourceKind, ...limpio }));
    }
  } catch {
    return;
  }
}

export function clearPortfolioStorage(storage: LocalPortfolioStorageLike | undefined): void {
  try {
    storage?.removeItem(LOCAL_PORTFOLIOS_STORAGE_KEY);
    storage?.removeItem(CURRENT_PORTFOLIO_STORAGE_KEY);
    storage?.removeItem(OPEN_PORTFOLIO_STORAGE_KEY);
    storage?.removeItem(CURRENT_PORTFOLIO_PROFILE_STORAGE_KEY);
  } catch {
    return;
  }
}
