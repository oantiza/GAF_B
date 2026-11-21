/**
 * Cableado a la callable `analyze_portfolio`.
 * Devuelve un analisis IA breve de la cartera, o null si no hay backend configurado.
 * Requiere deploy + GEMINI_API_KEY en Functions (si no, source NOT_CONFIGURED).
 */
import { functions } from "../firebase";
import { callBackend } from "./callableBackend";
import {
  requireNullableString,
  requireObject,
  requireOptionalString,
  requireString,
  requireStringArray
} from "./contractGuards";

export interface PortfolioAnalysisResult {
  analysis: string | null;
  model?: string;
  source: string;
  note?: string;
  /** Campos del contexto agregado que no cupieron en la petición al modelo (aditivo). */
  contextOmitted?: string[];
}

export interface AnalyzePosition {
  asset_id: string;
  weight: number;
  label?: string;
}

export function parsePortfolioAnalysisResult(raw: unknown): PortfolioAnalysisResult {
  const data = requireObject(raw, "analyze_portfolio response");
  return {
    analysis: requireNullableString(data.analysis, "analysis"),
    model: requireOptionalString(data.model, "model"),
    source: requireString(data.source, "source"),
    note: requireOptionalString(data.note, "note"),
    contextOmitted:
      data.context_omitted === undefined ? undefined : requireStringArray(data.context_omitted, "context_omitted")
  };
}

export async function fetchPortfolioAnalysis(
  positions: AnalyzePosition[],
  context?: Record<string, unknown>
): Promise<PortfolioAnalysisResult | null> {
  if (!functions || positions.length === 0) {
    return null;
  }
  const raw = await callBackend<unknown>(
    "analyze_portfolio",
    { positions, context },
    "No se pudo invocar analyze_portfolio."
  );
  return parsePortfolioAnalysisResult(raw);
}
