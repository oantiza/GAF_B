import type { BdbAssetHoldings, BdbHoldingPosition, BdbHoldingsStorageMode } from "../types/bdbAssets";
import { AppError } from "../core/appError";
import { codigoFinoDeLaBaseVieja } from "../core/lineaDeCartera";
import { parseAlcanceDeLasPosiciones } from "./bdbLiveApiContracts";

type RawObject = Record<string, unknown>;

function asObject(value: unknown): RawObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawObject) : null;
}

function contractError(field: string, expected: string): never {
  throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: se esperaba ${expected}.`);
}

export function requireArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function requireNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNestedString(source: RawObject, field: string, nestedField: string): string | undefined {
  const nested = asObject(source[field]);
  return nested ? readString(nested[nestedField]) : undefined;
}

function isOrphanedLegacy(source: RawObject): boolean {
  const quality = asObject(source.quality);
  return quality?.status === "ORPHANED_LEGACY";
}

function normalizeStorageMode(value: unknown): BdbHoldingsStorageMode {
  if (value === undefined || value === null || value === "SINGLE_DOCUMENT") {
    return "SINGLE_DOCUMENT";
  }
  if (value === "CHUNKED" || value === "CHUNKED_DOCUMENTS") {
    return "CHUNKED";
  }
  return contractError("asset_holdings.storage_mode", "SINGLE_DOCUMENT o CHUNKED");
}

function readHoldingWeightPct(source: RawObject): number | undefined {
  const directPercent =
    requireNumber(source.weight_pct) ??
    requireNumber(source.weight_percent) ??
    requireNumber(source.percentage);
  if (directPercent !== undefined) {
    return directPercent;
  }

  const holdingWeight = requireNumber(source.holding_weight);
  if (holdingWeight !== undefined) {
    const holdingUnit = (
      readString(source.holding_weight_unit) ?? readString(source.weight_unit)
    )?.toLocaleLowerCase("es-ES");
    if (holdingUnit === "decimal" || holdingUnit === "fraction") {
      return holdingWeight * 100;
    }
    return holdingWeight;
  }

  const weight = requireNumber(source.weight);
  if (weight === undefined) {
    return undefined;
  }
  const unit = readString(source.weight_unit)?.toLocaleLowerCase("es-ES");
  if (unit === "decimal" || unit === "fraction") {
    return weight * 100;
  }
  if (unit === "pct" || unit === "percent" || unit === "percentage") {
    return weight;
  }
  return Math.abs(weight) <= 1 ? weight * 100 : weight;
}

function mapHolding(value: unknown, index: number): BdbHoldingPosition | null {
  const source = asObject(value);
  if (!source) {
    return contractError(`asset_holdings.holdings[${index}]`, "object");
  }
  if (isOrphanedLegacy(source)) {
    return null;
  }

  const weightPct = readHoldingWeightPct(source);
  if (weightPct === undefined || !Number.isFinite(weightPct)) {
    return contractError(`asset_holdings.holdings[${index}].weight`, "peso numérico finito");
  }
  if (weightPct === 0) {
    return null;
  }

  const isin = readString(source.isin) ?? readNestedString(source, "identifiers", "isin");
  const ticker = readString(source.ticker) ?? readNestedString(source, "identifiers", "ticker");
  const holdingId = readString(source.holding_id);
  const name =
    readString(source.name) ??
    readString(source.holding_name) ??
    readString(source.security_name) ??
    readString(source.instrument_name) ??
    isin ??
    ticker ??
    holdingId;

  if (!name) {
    return contractError(`asset_holdings.holdings[${index}].name`, "nombre o identificador");
  }

  return {
    holding_id: holdingId,
    name,
    isin,
    ticker,
    weight_pct: weightPct,
    holding_type: readString(source.holding_type) ?? readString(source.instrument_type) ?? readString(source.asset_type),
    holding_type_code: readString(source.holding_type_code) ?? codigoFinoDeLaBaseVieja(readString(source.instrument_type)),
    currency: readString(source.currency),
    sector: readString(source.sector),
    country: readString(source.country)
  };
}

export function mapAssetHoldingsPayload(assetId: string, payload: unknown): BdbAssetHoldings | null {
  if (payload === null || payload === undefined) {
    return null;
  }
  const source = asObject(payload);
  if (!source) {
    return contractError("asset_holdings", "object");
  }
  if (isOrphanedLegacy(source)) {
    return null;
  }

  if (!Array.isArray(source.holdings)) {
    return contractError("asset_holdings.holdings", "array");
  }
  const responseAssetId = source.asset_id === undefined || source.asset_id === null
    ? assetId
    : readString(source.asset_id);
  if (!responseAssetId) {
    return contractError("asset_holdings.asset_id", "string no vacío");
  }
  // Un ISIN sustituido (fusión) devuelve la cartera del sucesor: el backend lo declara con
  // `resolved_from` (o `requested_asset_id`) igual al id pedido. Sin esa declaración, un id
  // distinto sigue siendo un cruce de respuestas y se rechaza.
  const declaredRequest = readString(source.resolved_from) ?? readString(source.requested_asset_id);
  const resolvedByAlias = responseAssetId !== assetId && declaredRequest === assetId;
  if (responseAssetId !== assetId && !resolvedByAlias) {
    throw new AppError(
      "BACKEND",
      `Contrato de backend inválido en asset_holdings.asset_id: se solicitó ${assetId} y se recibió ${responseAssetId}.`
    );
  }

  const holdings = source.holdings
    .map(mapHolding)
    .filter((row): row is BdbHoldingPosition => Boolean(row));
  if (holdings.length === 0) {
    return null;
  }

  const top10Weight = source.top10_weight === undefined || source.top10_weight === null
    ? undefined
    : requireNumber(source.top10_weight);
  if (source.top10_weight !== undefined && source.top10_weight !== null && top10Weight === undefined) {
    return contractError("asset_holdings.top10_weight", "número finito");
  }
  const asOfDate = source.as_of_date === undefined || source.as_of_date === null
    ? undefined
    : readString(source.as_of_date);
  if (source.as_of_date !== undefined && source.as_of_date !== null && asOfDate === undefined) {
    return contractError("asset_holdings.as_of_date", "string no vacío");
  }

  return {
    // Siempre el id pedido: quien llama casa la cartera con su posición por ese id.
    asset_id: assetId,
    ...(resolvedByAlias ? { resolved_to: responseAssetId } : {}),
    storage_mode: normalizeStorageMode(source.storage_mode),
    holdings_count: holdings.length,
    top10_weight: top10Weight,
    as_of_date: asOfDate,
    /* Hallazgo 20: cuántos títulos tiene de verdad, cuánto patrimonio cubren y si la lista es entera. Un servidor anterior no lo
       manda, y entonces no consta. */
    ...parseAlcanceDeLasPosiciones(source, "asset_holdings"),
    holdings
  };
}
