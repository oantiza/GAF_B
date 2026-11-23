export const TYPE_LABELS: Record<string, string> = {
  FUND: "Fondo",
  ETF: "ETF",
  ETC: "ETC",
  ETN: "ETN",
  ETP: "ETP",
  STOCK: "Acción",
  EQUITY: "Acción",
  SHARE: "Acción",
  INDEX: "Índice",
  BENCHMARK: "Índice",
  BOND: "Bono",
  REIT: "REIT",
  OTHER: "Otros",
  UNKNOWN: "Otros"
};

export const CLASS_LABELS: Record<string, string> = {
  EQUITY: "Renta variable",
  FIXED_INCOME: "Renta fija",
  MIXED: "Mixto",
  MONEY_MARKET: "Monetario",
  ALTERNATIVE: "Alternativo",
  REAL_ASSET: "Inmobiliario",
  /* Oro y materias primas, que la base nueva llama REAL_ASSETS. No son «Inmobiliario» (decisión 13). */
  COMMODITIES: "Materias primas",
  OTHER: "Otros",
  UNKNOWN: "Otros"
};

/** Sectores, estilos y tamaños de la renta variable (claves de `equitySectors` y `exposure_detail`). */
export const EQUITY_BREAKDOWN_LABELS: Record<string, string> = {
  basic_materials: "Materiales",
  communication_services: "Comunicación",
  consumer_cyclical: "Consumo cíclico",
  consumer_defensive: "Consumo defensivo",
  energy: "Energía",
  financial_services: "Financieras",
  healthcare: "Salud",
  industrials: "Industriales",
  real_estate: "Inmobiliario",
  technology: "Tecnología",
  utilities: "Utilities",
  value: "Valor",
  blend: "Mixto",
  growth: "Crecimiento",
  large: "Grande",
  mid: "Mediana",
  small: "Pequeña"
};

export const COVERAGE_LABELS: Record<string, string> = {
  COMPLETE: "Cobertura completa",
  PARTIAL: "Cobertura parcial",
  ROOT_ONLY: "Datos básicos",
  MISSING: "Datos faltantes",
  COMPLETE_LATER: "Pendiente de completar",
  /* Estado de los bloques de fundamentales y cartera que entrega el extractor. */
  READY: "Disponible",
  PENDING: "Pendiente",
  UNAVAILABLE: "No disponible"
};

/** Gravedad de un aviso del adaptador (`BdbAdapterWarning.severity`). */
export const WARNING_SEVERITY_LABELS: Record<string, string> = {
  LOW: "Leve",
  MEDIUM: "Moderado",
  HIGH: "Importante"
};

/**
 * Secciones de la ficha que publica el readmodel (`available_sections`,
 * `functions_python/readmodel/mappers.py`).
 */
export const ASSET_SECTION_LABELS: Record<string, string> = {
  summary: "Resumen",
  /* No es una estimación: el readmodel entrega rentabilidades, volatilidad,
     Sharpe y máxima caída medidas (mappers.map_performance_preview). */
  performance_preview: "Métricas de rentabilidad y riesgo",
  risk_snapshot: "Riesgo",
  portfolio_summary: "Resumen de cartera",
  cost_snapshot: "Costes",
  identity: "Identificación",
  listing: "Cotización",
  metrics: "Métricas",
  holdings_summary: "Posiciones subyacentes",
  fundamentals: "Fundamentales",
  proxy_note: "Nota del índice de referencia"
};

/**
 * Tipo de una posición subyacente (`holding_type`: «Equity», «bond», «cash»…).
 * Es UN título, no una clase de activo: «Acción» y «Bono», como TYPE_LABELS.
 */
export const HOLDING_TYPE_LABELS: Record<string, string> = {
  EQUITY: "Acción",
  STOCK: "Acción",
  BOND: "Bono",
  CASH: "Liquidez",
  FUND: "Fondo",
  ETF: "ETF",
  DERIVATIVE: "Derivado",
  OTHER: "Otros"
};

export function holdingTypeLabel(value: string): string {
  return HOLDING_TYPE_LABELS[value.trim().toUpperCase()] ?? readableBackendLabel(value);
}

/**
 * Las siete marcas de la revisión del histórico (`functions_python/fund_history_policies.json`, que el servidor añade a `quality_flags`
 * con `fund_history_quality.public_flags`): una por cada uno de los 85 fondos revisados, y el servidor cuenta cada una como un aviso.
 * **Sus nombres viven aquí y solo aquí** (decisión 120): los lee Sistema › Calidad y, por `QUALITY_FLAG_LABELS`, Análisis, Diseño, la ficha
 * de respaldo y el informe interno.
 *
 * Cinco limitan la historia del fondo y son avisos. Las dos de `MARCAS_QUE_NO_SON_AVISO` son buenas noticias y no se cuentan como aviso.
 * Ninguna cambia una cifra: el servidor ya recorta esa historia en el cálculo, y en la aplicación nada decide por ellas qué entra, qué se
 * propone o qué se mide. El orden es el del filtro de Sistema › Calidad.
 */
export const MARCAS_DE_LA_REVISION_DEL_HISTORICO = {
  HISTORY_CONTINUITY_UNVERIFIED: "Continuidad de la clase pendiente",
  HISTORY_RESTRICTED_AFTER_REVIEW: "Histórico limitado a tramos revisados",
  TOTAL_RETURN_UNVERIFIED: "Rentabilidad total pendiente de conciliar",
  HISTORY_SPLICED_SISTER_CLASS: "Histórico empalmado con una clase hermana",
  PREDECESSOR_CONTINUITY_DOCUMENTED: "Continuidad con el fondo predecesor documentada",
  TOTAL_RETURN_RECONCILED: "Rentabilidad total conciliada con el proveedor",
  PRICE_FROZEN_DELISTED: "Excluido de cotización: último precio prolongado plano hasta hoy"
} as const;

/**
 * Las dos buenas noticias de la revisión del histórico: la rentabilidad total, conciliada con el proveedor, y la continuidad con el fondo
 * predecesor, documentada. El servidor las cuenta como aviso, y no lo son: el adaptador las quita de la lista y de la cuenta (decisión 120).
 */
export const MARCAS_QUE_NO_SON_AVISO: ReadonlySet<string> = new Set(["TOTAL_RETURN_RECONCILED", "PREDECESSOR_CONTINUITY_DOCUMENTED"]);

export const QUALITY_FLAG_LABELS: Record<string, string> = {
  /* Las de la revisión del histórico, con su nombre de siempre: así ninguna llega a la pantalla ni al papel en inglés. */
  ...MARCAS_DE_LA_REVISION_DEL_HISTORICO,
  NON_INVESTABLE_DELISTED: "Excluido de cotización: no admite nuevas selecciones",
  /* Faltaba, y una cartera con lo suspendido (Levantina-Cleop) rompía su resumen en Diseño al leer esta etiqueta (lote T7). */
  NON_INVESTABLE_SUSPENDED: "Suspendido de cotización: no admite nuevas selecciones",
  NON_INVESTABLE_CLOSED_SUBSCRIPTIONS: "Clase cerrada a nuevas suscripciones",
  NON_INVESTABLE_NEVER_RESOLVED: "Sin precio ni métricas: no admite nuevas selecciones",
  NON_INVESTABLE_CORPORATE_ACTION: "Baja por fusión: no admite nuevas selecciones",
  QUALITY_BLOCKED: "Bloqueado por calidad del dato",
  MISSING_HOLDINGS: "Sin cartera publicada",
  MISSING_METRICS: "Sin métricas",
  MISSING_QUANT_METRICS: "Métricas cuantitativas incompletas",
  MISSING_HISTORY: "Sin histórico suficiente",
  MOCK_DATA: "Datos de prueba",
  PARTIAL_COVERAGE: "Cobertura parcial",
  NON_INVESTABLE_BENCHMARK: "Índice no invertible",
  SUITABILITY_REVIEW_REQUIRED: "Requiere revisión de idoneidad",
  UNSUPPORTED_INSTRUMENT_TYPE: "Tipo de instrumento no admitido",
  MISSING_ASSET: "Activo no encontrado"
};

export const WARNING_CODE_LABELS: Record<string, string> = {
  NON_INVESTABLE_DELISTED: "Excluido de cotización: no admite nuevas selecciones",
  NON_INVESTABLE_SUSPENDED: "Suspendido de cotización: no admite nuevas selecciones",
  NON_INVESTABLE_CLOSED_SUBSCRIPTIONS: "Clase cerrada a nuevas suscripciones",
  NON_INVESTABLE_NEVER_RESOLVED: "Sin precio ni métricas: no admite nuevas selecciones",
  NON_INVESTABLE_CORPORATE_ACTION: "Baja por fusión: no admite nuevas selecciones",
  MISSING_HOLDINGS: "Cartera no disponible",
  MISSING_METRICS: "Métricas no disponibles",
  MISSING_QUANT_METRICS: "Métricas cuantitativas incompletas",
  MISSING_HISTORY: "Histórico insuficiente",
  PARTIAL_COVERAGE: "Cobertura parcial",
  NON_INVESTABLE_BENCHMARK: "Índice no invertible",
  ASSET_NOT_IN_MASTER: "Activo no incluido en la base maestra",
  NON_EUR_ASSET: "Activo en una divisa distinta de EUR",
  MISSING_PRICE_HISTORY: "Sin histórico de precios",
  REQUIRES_REVIEW: "Requiere revisión",
  REQUIERE_REVISION: "Requiere revisión",
  FETCH_PRICE_HISTORY: "Cargar histórico de precios",
  REVIEW_ASSET_MAPPING: "Revisar la identificación del activo",
  // Activos históricos del bróker (decisión B-71): sin rótulo, la pantalla leía el código en inglés.
  HISTORICAL_ASSET_NEEDS_AUTHORITATIVE_MAPPING: "Sin identificación confirmada del activo",
  HISTORICAL_ASSET_AMBIGUOUS_IN_CATALOG: "Varios instrumentos del catálogo con este nombre: no se elige ninguno",
  // Auditoria de divisas (06-09-2026): sin etiqueta, la pantalla leia «Fx quarantine».
  FX_QUARANTINE: "Precios en cuarentena por divisa",
  PRICE_ADJUSTMENT_QUARANTINE: "Precios pendientes de ajuste histórico",
  EXCLUDED_DECLARED: "Exclusión declarada por el titular",
  // 13-11-2026: un activo ya vendido sin serie en el catálogo se valora con el precio de sus operaciones en el banco.
  OPERATION_PRICES: "Sin serie: valorado con sus propias operaciones",
  PRICE_SERIES_MISSING: "Sin serie de precios en la maestra",
  PRICE_SERIES_READ_FAILED: "No se pudo leer la serie de precios",
  PRICE_COVERAGE_NOT_CHECKED: "Cobertura de precios sin comprobar",
  NON_EUR_PRICE_SERIES: "Serie de precios en una divisa distinta de EUR"
};

/** Anomalías de cobertura que devuelve la inspección de la base maestra. */
export const HISTORY_FLAG_LABELS: Record<string, string> = {
  SIN_HISTORICO: "Sin histórico",
  NO_LLEGA_2011: "No llega a 2011",
  DESACTUALIZADO: "Desactualizado",
  HUECOS: "Con huecos",
  POCOS_PUNTOS: "Pocos puntos"
};

export function readableBackendLabel(value: string): string {
  const known =
    QUALITY_FLAG_LABELS[value] ?? WARNING_CODE_LABELS[value] ?? COVERAGE_LABELS[value] ?? HISTORY_FLAG_LABELS[value];
  if (known) return known;

  const trimmed = value.trim();
  // Un acronimo corto sin guion bajo es un codigo que ya se lee: EUR, USD,
  // ETF, SRI. Humanizarlo lo estropeaba («Eur»).
  if (/^[A-Z0-9]{1,4}$/.test(trimmed)) {
    return trimmed;
  }
  const isBackendCode = /^[A-Z0-9]+(?:[_ ][A-Z0-9]+)*$/.test(trimmed);
  if (!isBackendCode) {
    // Un código en minúsculas («accion», «renta_fija») sí se humaniza; un
    // texto ya escrito para leerse se respeta letra a letra («EAA Fund
    // Europe Large-Cap Value Equity» no debe volverse «Eaa fund europe...»).
    if (/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(trimmed)) {
      const words = trimmed.replace(/_/g, " ");
      return words.charAt(0).toLocaleUpperCase("es") + words.slice(1);
    }
    return trimmed || value;
  }

  const normalized = value.replace(/_/g, " ").trim().toLocaleLowerCase("es");
  return normalized ? normalized.charAt(0).toLocaleUpperCase("es") + normalized.slice(1) : value;
}

/** Estado de validación de pesos de una cartera. */
export const VALIDATION_STATUS_LABELS: Record<string, string> = {
  VALID: "Correcto",
  UNDER_ALLOCATED: "Por debajo del 100 %",
  OVER_ALLOCATED: "Por encima del 100 %",
  EMPTY: "Sin posiciones"
};

/** Claves de métrica del backend. */
export const METRIC_KEY_LABELS: Record<string, string> = {
  annualized_return_3y: "Rentabilidad 3A",
  annualized_return_5y: "Rentabilidad 5A",
  volatility_3y: "Volatilidad 3A",
  volatility_1y: "Volatilidad 1A",
  sharpe_3y: "Sharpe 3A",
  max_drawdown_5y: "Máx. caída 5A",
  max_drawdown_hist: "Máx. caída histórica",
  risk_score: "Indicador de riesgo",
  ytd_return: "Rentabilidad YTD",
  ter: "Gastos corrientes (TER)"
};

/** Traduce una lista de claves técnicas a etiquetas legibles. */
export function humanizeKeys(keys: readonly string[], labels: Record<string, string> = METRIC_KEY_LABELS): string {
  return keys.map((key) => labels[key] ?? readableBackendLabel(key)).join(" · ");
}

/**
 * Con qué metodología se calculó una ventana de métricas (`metrics.v1.2`).
 * En pantalla nunca se enseña el código: un asesor delante del cliente no lee
 * `TRAILING_PROVIDER`.
 */
export const METRICS_METHOD_LABELS: Record<string, string> = {
  GEOMETRIC_CAGR: "calculada por nosotros con rentabilidad geométrica",
  TRAILING_PROVIDER: "cifra del proveedor",
  /* Los dos de la base nueva (02-11-2026). Son métodos NUESTROS y distintos entre sí:
     uno toma rentabilidades mensuales y meses cerrados, el otro rentabilidades diarias
     y la ventana desde el último día de la serie. Cambiar un parámetro cambia la
     versión del método, así que el nombre lleva la versión dentro. */
  EXTRACTOR_MONTHLY_V1: "calculada por nosotros, mensual",
  EXTRACTOR_DAILY_V1: "calculada por nosotros, diaria",
  EXTRACTOR_MONTHLY_V2: "calculada por nosotros en euros, mensual",
  EXTRACTOR_DAILY_V2: "calculada por nosotros en euros, diaria",
  /* Versión 3 (A-158 y A-166, 16-11-2026): mismo método para quien lee, con el tipo sin riesgo y la anualización afinados. */
  EXTRACTOR_MONTHLY_V3: "calculada por nosotros en euros, mensual",
  EXTRACTOR_DAILY_V3: "calculada por nosotros en euros, diaria",
  /* Versión 4 (MET-6 y MET-7, 17-11-2026): mismo método para quien lee, con los cierres de mes y las relativas afinados. */
  EXTRACTOR_MONTHLY_V4: "calculada por nosotros en euros, mensual",
  EXTRACTOR_DAILY_V4: "calculada por nosotros en euros, diaria",
  /* Un activo con cifras nuestras y, en las ventanas a las que nuestra serie no llega, las del proveedor (decisión 110). */
  PROPIA_Y_PROVEEDOR: "calculada por nosotros y, donde no llega, cifra del proveedor"
};

export function metricsMethodLabel(method: string | undefined): string {
  if (!method) return "metodología no declarada";
  return METRICS_METHOD_LABELS[method] ?? readableBackendLabel(method);
}
