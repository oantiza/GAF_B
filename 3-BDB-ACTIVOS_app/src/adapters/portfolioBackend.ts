/** Persistencia app-owned de carteras, aislada por UID en el backend. */
import { auth, functions } from "../firebase";
import { AppError } from "../core/appError";
import { appLogger } from "../core/appLogger";
import { errorDelHorizonte, errorDelNivelDePerfil } from "../core/perfilYHorizonte";
import { registerSessionCache, sessionCacheEpoch } from "../core/sessionCaches";
import type { BdbAssetDataSourceKind, BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../types/bdbAssets";
import { callBackend } from "./callableBackend";
import { conflictoDelGuardado } from "./conflictoAlGuardar";
import {
  isObject,
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  requireOptionalBoolean,
  requireOptionalNumber,
  requireOptionalString,
  requireString
} from "./contractGuards";

const PORTFOLIO_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ASSET_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_POSITIONS = 200;
const MAX_TOTAL_CAPITAL = 1_000_000_000_000;

export interface PortfolioWarning {
  code: string;
  severity: string;
  message: string;
}

export interface SavePortfolioResult {
  schema_version?: string;
  portfolio_id: string;
  portfolio?: BdbSavedLocalPortfolio;
  warnings: PortfolioWarning[];
}

export interface DeletePortfolioResult {
  schema_version?: string;
  ok: boolean;
}

export function usesBackendPersistence(sourceKind: BdbAssetDataSourceKind): boolean {
  return sourceKind === "BBDD_LIVE_API" && Boolean(functions) && Boolean(auth?.currentUser);
}

function contractError(field: string, message: string): never {
  throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: ${message}.`);
}

function requireIdentifier(value: unknown, field: string, pattern: RegExp): string {
  const parsed = requireString(value, field).trim();
  if (!pattern.test(parsed)) contractError(field, "identificador inesperado");
  return parsed;
}

function requireTimestamp(value: unknown, field: string): string {
  const parsed = requireString(value, field);
  if (!parsed || Number.isNaN(Date.parse(parsed))) contractError(field, "fecha no valida");
  return parsed;
}

function checkedNumber(value: unknown, field: string, maximum = MAX_TOTAL_CAPITAL): number {
  const parsed = requireNumber(value, field);
  if (parsed < 0 || parsed > maximum) contractError(field, "número fuera de rango");
  return parsed;
}

function optionalCheckedNumber(value: unknown, field: string, maximum = MAX_TOTAL_CAPITAL): number | undefined {
  const parsed = requireOptionalNumber(value, field);
  if (parsed !== undefined && (parsed < 0 || parsed > maximum)) {
    contractError(field, "número fuera de rango");
  }
  return parsed;
}

/** Decisión 59: el valor si cumple la regla, nada si no viene; si viene y no la cumple, el contrato está roto. */
function optionalChecked(value: unknown, field: string, error: (valor: unknown) => string | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  const motivo = error(value);
  if (motivo) contractError(field, motivo);
  return value as number;
}

function parsePosition(raw: unknown, index: number): BdbManualPortfolioPosition {
  const row = requireObject(raw, `positions[${index}]`);
  const assetId = requireIdentifier(row.asset_id, `positions[${index}].asset_id`, ASSET_ID_RE);
  const weightRaw = row.weight_percent === undefined ? row.weight : row.weight_percent;
  const weight = checkedNumber(weightRaw, `positions[${index}].weight_percent`, 100);
  const keepRaw = row.keep_euros === undefined ? row.keepEuros : row.keep_euros;
  const targetRaw = row.target_euros === undefined ? row.targetEuros : row.target_euros;
  const keepEuros = requireOptionalBoolean(keepRaw, `positions[${index}].keep_euros`);
  const targetEuros = optionalCheckedNumber(targetRaw, `positions[${index}].target_euros`);
  const label = requireOptionalString(row.label, `positions[${index}].label`);
  return {
    asset_id: assetId,
    weight_percent: weight,
    label,
    keepEuros,
    targetEuros
  };
}

export function parseSavedPortfolio(raw: unknown, field = "portfolio"): BdbSavedLocalPortfolio {
  const doc = requireObject(raw, field);
  const rawPositions = requireArray(doc.positions, `${field}.positions`);
  if (rawPositions.length > MAX_POSITIONS) contractError(`${field}.positions`, "demasiadas posiciones");
  const positions = rawPositions.map((position, index) => parsePosition(position, index));
  const assetIds = positions.map((position) => position.asset_id);
  if (new Set(assetIds).size !== assetIds.length) contractError(`${field}.positions`, "activos duplicados");
  const name = requireString(doc.name, `${field}.name`).trim();
  if (!name) contractError(`${field}.name`, "nombre vacío");
  const riskProfileLevel = optionalChecked(doc.risk_profile_level, `${field}.risk_profile_level`, errorDelNivelDePerfil);
  const horizonYears = optionalChecked(doc.horizon_years, `${field}.horizon_years`, errorDelHorizonte);
  return {
    portfolio_id: requireIdentifier(doc.portfolio_id, `${field}.portfolio_id`, PORTFOLIO_ID_RE),
    name,
    created_at: requireTimestamp(doc.created_at, `${field}.created_at`),
    updated_at: requireTimestamp(doc.updated_at, `${field}.updated_at`),
    sourceKind: "BBDD_LIVE_API",
    positions,
    total_capital: optionalCheckedNumber(doc.total_capital, `${field}.total_capital`),
    /* Ausente es ausente: sin la clave, la cartera no la lleva (ni siquiera como `undefined`). */
    ...(riskProfileLevel !== undefined ? { risk_profile_level: riskProfileLevel } : {}),
    ...(horizonYears !== undefined ? { horizon_years: horizonYears } : {})
  };
}

export interface DiscardedSavedPortfolio {
  /** Posición del documento en la respuesta. */
  index: number;
  /** Identificador del documento, si se puede leer. */
  portfolio_id?: string;
  reason: string;
}

export interface PortfolioListParseResult {
  portfolios: BdbSavedLocalPortfolio[];
  discarded: DiscardedSavedPortfolio[];
}

/**
 * H04 (auditoría 14-10-2026): un documento que no cumple el contrato (p. ej. un
 * `created_at` ilegible) se descarta él solo, con aviso; antes tumbaba la lista
 * entera y el asesor se quedaba sin ninguna de sus carteras guardadas. La forma
 * de la respuesta (objeto, `portfolios` como lista, `count`) sigue siendo
 * obligatoria: si falla, no hay lista en la que confiar.
 */
export function parsePortfolioListResult(raw: unknown): PortfolioListParseResult {
  const data = requireObject(raw, "list_portfolios response");
  const rawPortfolios = requireArray(data.portfolios, "portfolios");
  const count = requireOptionalNumber(data.count, "count") ?? rawPortfolios.length;
  if (!Number.isInteger(count) || count !== rawPortfolios.length) {
    contractError("count", "no coincide con portfolios");
  }
  requireOptionalString(data.schema_version, "schema_version");

  const portfolios: BdbSavedLocalPortfolio[] = [];
  const discarded: DiscardedSavedPortfolio[] = [];
  rawPortfolios.forEach((item, index) => {
    try {
      portfolios.push(parseSavedPortfolio(item, `portfolios[${index}]`));
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      const rawId = isObject(item) && typeof item.portfolio_id === "string" ? item.portfolio_id : undefined;
      discarded.push({ index, portfolio_id: rawId, reason: error.message });
    }
  });
  portfolios.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  return { portfolios, discarded };
}

function logDiscarded(discarded: DiscardedSavedPortfolio[]): void {
  if (discarded.length === 0) return;
  appLogger.warn(
    `carteras guardadas: ${discarded.length === 1 ? "1 documento descartado" : `${discarded.length} documentos descartados`} por no cumplir el contrato; el resto se carga`,
    discarded
  );
}

export function parsePortfolioListResponse(raw: unknown): BdbSavedLocalPortfolio[] {
  const result = parsePortfolioListResult(raw);
  logDiscarded(result.discarded);
  return result.portfolios;
}

export function parseSavePortfolioResponse(raw: unknown): SavePortfolioResult {
  const data = requireObject(raw, "save_portfolio response");
  const portfolioId = requireIdentifier(data.portfolio_id, "portfolio_id", PORTFOLIO_ID_RE);
  const portfolio = data.portfolio === undefined ? undefined : parseSavedPortfolio(data.portfolio);
  if (portfolio && portfolio.portfolio_id !== portfolioId) {
    contractError("portfolio.portfolio_id", "no coincide con portfolio_id");
  }
  const warnings = data.warnings === undefined
    ? []
    : requireArray(data.warnings, "warnings").map((item, index) => {
        const warning = requireObject(item, `warnings[${index}]`);
        return {
          code: requireString(warning.code, `warnings[${index}].code`),
          severity: requireString(warning.severity, `warnings[${index}].severity`),
          message: requireString(warning.message, `warnings[${index}].message`)
        };
      });
  return {
    schema_version: requireOptionalString(data.schema_version, "schema_version"),
    portfolio_id: portfolioId,
    portfolio,
    warnings
  };
}

export function parseDeletePortfolioResponse(raw: unknown): DeletePortfolioResult {
  const data = requireObject(raw, "delete_portfolio response");
  return {
    schema_version: requireOptionalString(data.schema_version, "schema_version"),
    ok: requireBoolean(data.ok, "ok")
  };
}

let portfolioListCache: { key: string; expires: number; promise: Promise<PortfolioListParseResult> } | undefined;
function invalidatePortfolioList(): void { portfolioListCache = undefined; }
registerSessionCache(invalidatePortfolioList);

/** A short account-scoped cache avoids a new cold request on every route mount.
 * Writes invalidate it both before and after completion, including uncertain errors. */
export function backendListPortfolioResult(): Promise<PortfolioListParseResult> {
  const uid = auth?.currentUser?.uid;
  const epoch = sessionCacheEpoch();
  const key = JSON.stringify([uid, epoch]);
  if (uid && portfolioListCache?.key === key && portfolioListCache.expires > Date.now()) {
    return portfolioListCache.promise;
  }
  const promise = callBackend<unknown>("list_portfolios", {}, "No se pudieron cargar las carteras guardadas.")
    .then((raw) => {
      if (uid && (auth?.currentUser?.uid !== uid || epoch !== sessionCacheEpoch())) {
        throw new AppError("BACKEND", "La sesión ha cambiado.");
      }
      const result = parsePortfolioListResult(raw);
      logDiscarded(result.discarded);
      if (portfolioListCache?.promise === promise) portfolioListCache.expires = Date.now() + 30_000;
      return result;
    }).catch((error: unknown) => {
      if (portfolioListCache?.promise === promise) invalidatePortfolioList();
      throw error;
    });
  if (uid) portfolioListCache = { key, expires: Infinity, promise };
  return promise;
}

export async function backendListPortfolios(): Promise<BdbSavedLocalPortfolio[]> {
  return (await backendListPortfolioResult()).portfolios;
}

/**
 * DIS-03: con `expectedUpdatedAt` (la fecha de modificación de la guardada tal como se abrió), el servidor solo
 * escribe si sigue siendo esa; si no, lanza `ConflictoAlGuardar`. Sin ella guarda como siempre. Un servidor
 * anterior a este control ignora el campo y guarda: por eso `comprobarLaGuardada` sigue mirando antes.
 */
export async function backendSavePortfolio(
  portfolio: BdbSavedLocalPortfolio,
  condicion: { expectedUpdatedAt?: string } = {}
): Promise<SavePortfolioResult> {
  /* Decisión 59: lo que no valida no sale. El servidor lo rechazaría igual, pero aquí el asesor lo lee antes. */
  const motivo = errorDelNivelDePerfil(portfolio.risk_profile_level) ?? errorDelHorizonte(portfolio.horizon_years);
  if (motivo) throw new AppError("BACKEND", motivo);
  const { expectedUpdatedAt } = condicion;
  invalidatePortfolioList();
  const raw = await callBackend<unknown>(
    "save_portfolio",
    {
      portfolio_id: portfolio.portfolio_id,
      name: portfolio.name,
      created_at: portfolio.created_at,
      total_capital: portfolio.total_capital,
      /* Siempre con la clave: `null` quita el valor guardado. Sin la clave, el servidor conserva el que hubiera,
         que es lo que necesita una pantalla anterior a la decisión 59. */
      risk_profile_level: portfolio.risk_profile_level ?? null,
      horizon_years: portfolio.horizon_years ?? null,
      positions: portfolio.positions.map((position) => ({
        asset_id: position.asset_id,
        weight_percent: position.weight_percent,
        // Alias legacy hasta retirar clientes anteriores.
        weight: position.weight_percent,
        label: position.label,
        keep_euros: position.keepEuros,
        target_euros: position.targetEuros
      })),
      ...(typeof expectedUpdatedAt === "string" && expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {})
    },
    "No se pudo guardar la cartera."
  )
    .catch((error: unknown) => {
      throw conflictoDelGuardado(error) ?? error;
    })
    .finally(invalidatePortfolioList);
  return parseSavePortfolioResponse(raw);
}

export async function backendDeletePortfolio(portfolioId: string): Promise<DeletePortfolioResult> {
  invalidatePortfolioList();
  const raw = await callBackend<unknown>(
    "delete_portfolio",
    { portfolio_id: portfolioId },
    "No se pudo eliminar la cartera."
  ).finally(invalidatePortfolioList);
  return parseDeletePortfolioResponse(raw);
}
