import type { BdbOfficialBenchmark } from "../types/bdbAssets";

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

export function normalizeOfficialBenchmark(
  value: unknown,
  fallbackSource?: string
): BdbOfficialBenchmark | undefined {
  const name = asNonEmptyString(value);
  if (name) {
    return fallbackSource ? { name, source: fallbackSource } : { name };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const objectName = firstString(
    value.name,
    value.display_name,
    value.label,
    value.benchmark,
    value.reference_index,
    value.index_name
  );
  if (!objectName) {
    return undefined;
  }

  return {
    name: objectName,
    asset_id: firstString(value.asset_id, value.id, value.index_id),
    isin: firstString(value.isin),
    ticker: firstString(value.ticker),
    source: firstString(value.source, fallbackSource)
  };
}

/**
 * La línea que la ficha imprime bajo «Benchmark oficial», o cadena vacía si no hay nada que
 * imprimir. Vive aquí y no dentro del componente para que la regla se pueda probar: a diferencia
 * de las demás filas de Datos clave, que ponen «N/D» cuando falta el dato, esta **no se dibuja**.
 * Un índice es la referencia contra la que se mide el alpha que ve un cliente; un hueco se puede
 * explicar y un marcador no.
 */
export function officialBenchmarkLine(benchmark: BdbOfficialBenchmark | undefined): string {
  if (!benchmark) {
    return "";
  }
  return [benchmark.name, benchmark.ticker, benchmark.isin]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" · ");
}

export function cloneOfficialBenchmark(
  benchmark: BdbOfficialBenchmark | undefined
): BdbOfficialBenchmark | undefined {
  return benchmark ? { ...benchmark } : undefined;
}
