import type {
  BdbAssetProductProfile,
  BdbAssetSustainabilityProfile
} from "../types/bdbAssets";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text ? text : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asNonEmptyString(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
    const text = asNonEmptyString(value)?.toLowerCase();
    if (text === "true" || text === "yes" || text === "si" || text === "sí") {
      return true;
    }
    if (text === "false" || text === "no") {
      return false;
    }
  }
  return undefined;
}

function firstStringOrNumber(...values: unknown[]): string | number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const text = asNonEmptyString(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function hasDefinedValue(value: object): boolean {
  return Object.values(value as Record<string, unknown>).some((item) => item !== undefined && item !== null && item !== "");
}

export function normalizeProductProfile(...sources: unknown[]): BdbAssetProductProfile | undefined {
  const records = sources.filter(isRecord);
  if (records.length === 0) {
    return undefined;
  }

  const profile: BdbAssetProductProfile = {
    product_type: firstString(...records.map((record) => record.product_type)),
    domicile: firstString(...records.map((record) => record.domicile)),
    share_class: firstString(...records.map((record) => record.share_class)),
    distribution_policy: firstString(
      ...records.map((record) => record.distribution_policy),
      ...records.map((record) => record.distribution),
      ...records.map((record) => record.acc_dist)
    ),
    inception_date: firstString(...records.map((record) => record.inception_date)),
    ucits: firstBoolean(...records.map((record) => record.ucits)),
    replication: firstString(...records.map((record) => record.replication)),
    legal_structure: firstString(...records.map((record) => record.legal_structure))
  };

  return hasDefinedValue(profile) ? profile : undefined;
}

export function normalizeSustainabilityProfile(...sources: unknown[]): BdbAssetSustainabilityProfile | undefined {
  const records = sources.filter(isRecord);
  if (records.length === 0) {
    return undefined;
  }

  const profile: BdbAssetSustainabilityProfile = {
    sfdr: firstString(...records.map((record) => record.sfdr)),
    esg_rating: firstStringOrNumber(...records.map((record) => record.esg_rating)),
    sustainability_rating: firstStringOrNumber(...records.map((record) => record.sustainability_rating))
  };

  return hasDefinedValue(profile) ? profile : undefined;
}
