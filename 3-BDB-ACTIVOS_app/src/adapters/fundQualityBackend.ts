import { oFalta, titulos } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { callBackend } from "./callableBackend";
import { requireArray, requireBoolean, requireNullableString, requireNumber, requireObject, requireString, requireStringArray } from "./contractGuards";

export interface FundQualityRow {
  isin: string; name: string; history_last_date: string | null; history_first_date: string | null;
  history_observations: number; holdings_date: string | null; holdings_count: number;
  reference_history_observations?: number; reference_history_first_date?: string | null; reference_history_last_date?: string | null;
  has_profile: boolean; has_kid: boolean; flags: string[]; history_blocked: boolean; report_date: string | null;
}
export interface FundQualityReport {
  generated_at: string; total_funds: number; with_profile: number; with_history: number;
  history_blocked: number; with_kid: number; rows: FundQualityRow[];
  with_monthly_reference?: number;
}
export async function fetchFundProfile(isin: string): Promise<Record<string, string> | null> {
  const result = requireObject(await callBackend("admin_fund_quality", { isin }), "ficha");
  if (result.profile == null) return null;
  const profile = requireObject(result.profile, "ficha");
  const identity = requireObject(profile.identity, "identificación");
  const regulatory = requireObject(profile.regulatory, "datos regulatorios");
  const kid = regulatory.kid ? requireObject(regulatory.kid, "KID") : {};
  const size = requireObject(profile.fund_size, "patrimonio");
  /* Un número con los decimales que tenga, hasta seis (los de `titulos`); lo que no viene, «Falta el dato». */
  const display = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" ? oFalta(titulos(value)) : textoDeAusencia("falta");
  const documentary = profile.documentary_portfolio_reference ? requireObject(profile.documentary_portfolio_reference, "composición documental") : {};
  const documentaryFields: Record<string, string> = documentary.status === "ACCOUNTING_RECONCILED_NOT_LOOKTHROUGH" && documentary.verified_isin === isin ? {
    "Composición documental · fecha": display(documentary.as_of_date),
    "Valores en el informe": display(documentary.securities_count),
    "Registros de derivados en el informe": display(documentary.derivatives_count),
    "Coberturas de otras clases (incluidas en el recuento)": display(documentary.other_share_class_hedges_count),
    "Conciliación documental": "Importes conciliados con el balance del compartimento. Los nominales, valores contables y liquidaciones se conservan por separado.",
    "Uso de la composición documental": "Referencia complementaria. No sustituye la composición usada en la radiografía ni representa la exposición económica completa de esta clase."
  } : {};
  return {
    "ISIN": isin, "Gestora": display(regulatory.management_company_legal ?? identity.gestora),
    "Benchmark": display(identity.indice_benchmark_oficial),
    "Inversión mínima (divisa de la clase)": display(identity.inversion_minima_inicial),
    "Lanzamiento de la clase": display(regulatory.launch_date_class),
    "Patrimonio del fondo (millones EUR)": display(size.patrimonio_fondo_meur),
    "Fecha del patrimonio": display(size.patrimonio_fecha), "Domicilio": display(regulatory.domicile),
    "SRI del KID (1–7)": display(regulatory.sri), "SRRI (1–7)": display(regulatory.srri),
    "Artículo SFDR": display(regulatory.sfdr_article), "Fecha del KID": display(kid.date),
    "Plazo recomendado (años)": display(kid.recommended_holding_years),
    "Fuente": display(profile.source), "Fecha de la ficha": display(profile.report_date),
    "Contratación": "Pendiente de confirmar con el distribuidor",
    "Estrategia": display(identity.estrategia_inversion_texto),
    ...documentaryFields
  };
}
export async function fetchFundQuality(): Promise<FundQualityReport> {
  const value = requireObject(await callBackend("admin_fund_quality", {}), "calidad");
  return {
    generated_at: requireString(value.generated_at, "fecha"),
    total_funds: requireNumber(value.total_funds, "fondos"), with_profile: requireNumber(value.with_profile, "fichas"),
    with_history: requireNumber(value.with_history, "históricos"), history_blocked: requireNumber(value.history_blocked, "revisión"),
    with_kid: requireNumber(value.with_kid, "documentos"),
    with_monthly_reference: requireNumber(value.with_monthly_reference ?? 0, "referencias mensuales"),
    rows: requireArray(value.rows, "filas").map((raw, i) => {
      const row = requireObject(raw, `fila ${i}`);
      return { isin: requireString(row.isin, "ISIN"), name: requireString(row.name, "nombre"),
        history_last_date: requireNullableString(row.history_last_date, "último precio"),
        history_first_date: requireNullableString(row.history_first_date, "primer precio"),
        history_observations: requireNumber(row.history_observations, "observaciones"),
        reference_history_observations: requireNumber(row.reference_history_observations ?? 0, "observaciones mensuales"),
        reference_history_first_date: requireNullableString(row.reference_history_first_date ?? null, "primera referencia mensual"),
        reference_history_last_date: requireNullableString(row.reference_history_last_date ?? null, "última referencia mensual"),
        holdings_date: requireNullableString(row.holdings_date, "fecha de posiciones"), holdings_count: requireNumber(row.holdings_count, "posiciones"),
        has_profile: requireBoolean(row.has_profile, "ficha"), has_kid: requireBoolean(row.has_kid, "KID"),
        flags: requireStringArray(row.flags, "avisos"), history_blocked: requireBoolean(row.history_blocked, "histórico en revisión"),
        report_date: requireNullableString(row.report_date, "fecha ficha") };
    })
  };
}
