import { httpsCallable, type HttpsCallableOptions } from "firebase/functions";
import { AppError, toAppError } from "../core/appError";
import { appCheckReady, functions } from "../firebase";

/** Prefijos de las callables de solo lectura (no mutan nada en el backend).
 *  Todo lo demás (save_*, delete_*, admin_*, analyze_*, optimize_*, backtest_*)
 *  nunca se reintenta: un doble envío podría duplicar trabajo o escrituras. */
const READ_ONLY_PREFIXES = ["get_", "list_", "search_", "compare_", "resolve_"] as const;

/** Códigos con los que Cloud Run aborta la primera llamada tras un despliegue
 *  («no available instance», HTTP 500 → `functions/internal`) o mientras escala. */
const COLD_START_CODES = new Set(["functions/internal", "functions/unavailable"]);

export const COLD_START_RETRY_DELAY_MS = 1500;

export function isReadOnlyOperation(name: string): boolean {
  return READ_ONLY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code).toLowerCase() : "";
}

export function isColdStartError(error: unknown): boolean {
  return COLD_START_CODES.has(errorCode(error));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Reintento de arranque (auditoría 29-09, BAJA): tras un despliegue la primera
 * llamada a Cloud Run puede abortar con «The request was aborted because there
 * was no available instance» y el SDK devuelve `functions/internal`; el 30-09
 * `list_portfolios` falló así y el Constructor mostró «No se pudieron cargar
 * las carteras guardadas». Las llamadas de solo lectura se reintentan UNA vez
 * tras ~1,5 s; las que mutan, nunca.
 */
async function invokeWithColdStartRetry<T>(name: string, data: unknown, options?: HttpsCallableOptions): Promise<T> {
  if (!functions) throw new AppError("BACKEND", "Firebase no configurado para usar esta función.");
  const callable = httpsCallable(functions, name, options);
  try {
    return (await callable(data)).data as T;
  } catch (error) {
    if (!isReadOnlyOperation(name) || !isColdStartError(error)) throw error;
    await sleep(COLD_START_RETRY_DELAY_MS);
    return (await callable(data)).data as T;
  }
}

export async function callBackend<T>(
  name: string,
  data: unknown,
  fallbackMessage?: string,
  options?: HttpsCallableOptions
): Promise<T> {
  if (!functions) {
    // Sin Firebase y en desarrollo, servimos una muestra que respeta el mismo
    // contrato para poder recorrer y revisar todos los módulos sin credenciales.
    if (import.meta.env.DEV) {
      const { hasDemoResponse, demoResponse } = await import("./demoBackend");
      if (hasDemoResponse(name)) {
        return (await demoResponse(name, data)) as T;
      }
    }
    throw new AppError("BACKEND", "Firebase no configurado para usar esta función.");
  }
  try {
    // App Check (01-09): las primeras llamadas de una pantalla densa ganaban
    // la carrera al token de reCAPTCHA y salían sin él. La espera está acotada
    // (4 s máx.) y tras el arranque es inmediata; el guard cubre los tests que
    // mockean ../firebase sin este export.
    if (appCheckReady) await appCheckReady;
    return await invokeWithColdStartRetry<T>(name, data, options);
  } catch (error) {
    throw toAppError(error, fallbackMessage ?? `No se pudo ejecutar ${name}.`);
  }
}
