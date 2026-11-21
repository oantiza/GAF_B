export function marketCalendarSourceLabel(source: string | null): string | null {
  if (!source) return null;
  const hasForexFactory = source.includes("FOREX_FACTORY");
  const hasReport = source.includes("STRATEGY_REPORT");
  if (hasForexFactory && hasReport) return "Forex Factory + informe fundamentado";
  if (hasReport) return "Informe fundamentado vigente";
  if (source.includes("FOREX_FACTORY_XML")) return "Forex Factory (fuente alternativa)";
  if (hasForexFactory) return source.includes("CACHE") ? "Forex Factory (copia reciente)" : "Forex Factory";
  if (source.startsWith("YAHOO")) return "Yahoo Finance";
  if (source.startsWith("EODHD")) return "EODHD";
  if (source.startsWith("FMP")) return "Financial Modeling Prep";
  if (source === "OUT_OF_SOURCE_RANGE") return "Fuera del alcance de la fuente";
  if (source === "INVALID_REQUEST") return "Solicitud no válida";
  if (source === "NOT_CONFIGURED") return "Fuente no configurada";
  if (source === "ERROR") return "No disponible";
  return source;
}
