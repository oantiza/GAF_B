import type { AssetDataSourceKind } from "../types/assetDataSource";

const FIREBASE_RUNTIME_CONFIGURED = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID
);

export const PUBLIC_DATA_SOURCE_KINDS: AssetDataSourceKind[] = [
  "LOCAL_MOCK",
  "BBDD_STATIC_EXPORT_SAMPLE",
  "BBDD_LIVE_API"
];

export const SAFE_DEFAULT_DATA_SOURCE_KIND: AssetDataSourceKind = "BBDD_STATIC_EXPORT_SAMPLE";
export const PRODUCTION_DEFAULT_DATA_SOURCE_KIND: AssetDataSourceKind = "BBDD_LIVE_API";

function parseDataSourceKind(value: string | undefined): AssetDataSourceKind | null {
  if (!value) {
    return null;
  }
  return PUBLIC_DATA_SOURCE_KINDS.includes(value as AssetDataSourceKind)
    ? (value as AssetDataSourceKind)
    : null;
}

function parseBooleanFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return value === "true" || value === "1" || value === "yes";
}

const requestedDefaultDataSource = parseDataSourceKind(import.meta.env.VITE_BDB_DEFAULT_SOURCE);

export function resolveDefaultDataSourceKind(options: {
  requestedDefaultDataSource: AssetDataSourceKind | null;
  firebaseConfigured: boolean;
  isProduction: boolean;
}): AssetDataSourceKind {
  if (options.isProduction) {
    if (options.requestedDefaultDataSource && options.requestedDefaultDataSource !== PRODUCTION_DEFAULT_DATA_SOURCE_KIND) {
      throw new Error("Producción requiere BBDD_LIVE_API como fuente de datos.");
    }
    if (!options.firebaseConfigured) {
      throw new Error("BBDD_LIVE_API requiere Firebase configurado en producción.");
    }
    return PRODUCTION_DEFAULT_DATA_SOURCE_KIND;
  }
  if (options.requestedDefaultDataSource === "BBDD_LIVE_API" && !options.firebaseConfigured) {
    return SAFE_DEFAULT_DATA_SOURCE_KIND;
  }
  if (options.requestedDefaultDataSource) {
    return options.requestedDefaultDataSource;
  }
  return SAFE_DEFAULT_DATA_SOURCE_KIND;
}

export const DEFAULT_DATA_SOURCE_KIND = resolveDefaultDataSourceKind({
  requestedDefaultDataSource,
  firebaseConfigured: FIREBASE_RUNTIME_CONFIGURED,
  isProduction: import.meta.env.PROD
});

export const ENABLE_REAL_FRONTIER = parseBooleanFlag(import.meta.env.VITE_BDB_ENABLE_REAL_FRONTIER);

/**
 * Bandera de seguridad activa salvo apagado EXPLÍCITO: solo `false`, `0`, `no`
 * u `off` (sin distinguir mayúsculas ni espacios) la apagan; cualquier otro
 * valor, incluido uno mal escrito, la deja activa (R-06).
 */
export function parseEnabledUnlessOff(value: string | undefined): boolean {
  return !/^(false|0|no|off)$/.test((value ?? "").trim().toLowerCase());
}

/**
 * MEDIA-07 (auditoría 16-10-2026): la puerta de acceso exige correo verificado,
 * como el backend (`BDB_REQUIRE_EMAIL_VERIFIED`, activo por defecto). Es su
 * espejo: si alguna vez se apaga allí como interruptor de emergencia, se apaga
 * aquí con VITE_BDB_REQUIRE_EMAIL_VERIFIED=false para no dejar fuera a nadie.
 */
export const REQUIRE_EMAIL_VERIFIED = parseEnabledUnlessOff(import.meta.env.VITE_BDB_REQUIRE_EMAIL_VERIFIED);

/**
 * Avisos "PREVIEW_ONLY / métricas locales aproximadas / vista previa local":
 * se muestran salvo cuando la fuente es la maestra oficial en vivo.
 */
export function showPreviewDisclaimers(kind: AssetDataSourceKind = DEFAULT_DATA_SOURCE_KIND): boolean {
  return kind !== "BBDD_LIVE_API";
}
