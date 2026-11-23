/**
 * Cobertura real de un backtest: lo que la ventana sostiene de verdad.
 *
 * Auditoría 06-09-2026 (A3/A7): el servicio cruza las fechas comunes a todos los
 * activos, así que un solo histórico corto reduce la ventana de la cartera entera.
 * La pantalla y el informe rotulaban «3A» pasara lo que pasara. Desde aquí sale una
 * sola lectura de la cobertura para las dos, y los avisos del backend se traducen
 * a una frase que dice qué periodo se ha medido y quién lo recorta.
 */
import { fecha, oFalta } from "./formato";
import { ventanaEnPalabras } from "./glosarioDePantalla";

/** Forma mínima que necesita esta lectura; `BacktestResponse` la cumple. */
export interface BacktestCoverageInput {
  window: string;
  coverage?: {
    common_observations: number;
    /** Observaciones con las que se miden las métricas (semanales). */
    measured_observations?: number;
    measurement_frequency?: string;
    required_observations?: number;
    first_date: string | null;
    last_date: string | null;
    window_start_limited_by?: string | null;
    window_end_limited_by?: string | null;
  } | null;
  warnings?: string[];
  excluded_assets?: { asset_id: string; reason: string }[];
}

export interface BacktestWindowCoverage {
  /** Etiqueta española de la ventana pedida: «3A». */
  windowLabel: string;
  /** Años que pide la ventana. */
  requestedYears: number;
  /** Años que cubre de verdad el histórico común. */
  coveredYears: number | null;
  /** Observaciones de la serie dibujada (diaria en pantalla). */
  observations: number;
  /**
   * Observaciones con las que se MIDEN las métricas, y su unidad.
   *
   * 06-09-2026: el aviso decía «320 observaciones semanales» sobre una ventana de año
   * y medio, porque imprimía el recuento DIARIO con la palabra «semanales». El mínimo
   * de la ventana está en semanas, así que hay que comparar y rotular en semanas.
   */
  measuredObservations: number;
  measurementLabel: string;
  requiredObservations: number | null;
  firstDate: string | null;
  lastDate: string | null;
  /** «01/12/2025 a 31/08/2026», o null sin fechas. */
  rangeLabel: string | null;
  /** ¿El histórico común sostiene el rótulo de la ventana? */
  coversWindow: boolean;
  startLimitedBy: string | null;
  endLimitedBy: string | null;
}

const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;
/** Margen de tolerancia: 3 años menos unas semanas siguen siendo «3 años». */
const COVERAGE_TOLERANCE = 0.9;

export function backtestWindowLabel(window: string): string {
  return window.replace(/Y$/i, "A");
}

function requestedYearsOf(window: string): number {
  const years = Number.parseInt(window, 10);
  return Number.isFinite(years) && years > 0 ? years : 0;
}

export function backtestWindowCoverage(data: BacktestCoverageInput | null | undefined): BacktestWindowCoverage | null {
  if (!data) return null;
  const coverage = data.coverage ?? null;
  const requestedYears = requestedYearsOf(data.window);
  const firstDate = coverage?.first_date ?? null;
  const lastDate = coverage?.last_date ?? null;
  const from = firstDate ? Date.parse(firstDate) : Number.NaN;
  const to = lastDate ? Date.parse(lastDate) : Number.NaN;
  const coveredYears = Number.isFinite(from) && Number.isFinite(to) && to >= from
    ? (to - from) / MS_PER_YEAR
    : null;
  return {
    windowLabel: backtestWindowLabel(data.window),
    requestedYears,
    coveredYears,
    observations: coverage?.common_observations ?? 0,
    measuredObservations: typeof coverage?.measured_observations === "number"
      ? coverage.measured_observations
      : coverage?.common_observations ?? 0,
    // Sin frecuencia declarada no se afirma la unidad: «observaciones» a secas.
    measurementLabel: coverage?.measurement_frequency === "WEEKLY"
      ? "observaciones semanales"
      : coverage?.measurement_frequency === "DAILY"
        ? "observaciones diarias"
        : "observaciones",
    requiredObservations: typeof coverage?.required_observations === "number" ? coverage.required_observations : null,
    firstDate,
    lastDate,
    rangeLabel: firstDate && lastDate ? `${oFalta(fecha(firstDate))} a ${oFalta(fecha(lastDate))}` : null,
    // Sin fechas no se puede afirmar que la ventana esté cubierta.
    coversWindow: coveredYears !== null && requestedYears > 0
      ? coveredYears >= requestedYears * COVERAGE_TOLERANCE
      : false,
    startLimitedBy: coverage?.window_start_limited_by ?? null,
    endLimitedBy: coverage?.window_end_limited_by ?? null
  };
}

/** Rótulo honesto para un título: «3 años» solo si el histórico da para tanto. */
export function backtestPeriodTitle(coverage: BacktestWindowCoverage | null): string {
  if (!coverage) return "histórico no disponible";
  if (coverage.coversWindow) {
    return `${coverage.requestedYears} ${coverage.requestedYears === 1 ? "año" : "años"}`;
  }
  return coverage.firstDate ? `desde ${oFalta(fecha(coverage.firstDate))}` : "ventana no disponible";
}

const EXCLUSION_REASONS: Record<string, string> = {
  ASSET_CAP_EXCEEDED: "fuera del máximo de activos por cálculo",
  PRICE_SERIES_MISSING: "sin serie de precios",
  INSUFFICIENT_HISTORY: "histórico insuficiente",
  REFERENCE_LINK_FAILED: "su historia no se pudo completar con su referencia",
  /* A-161: tiene historia, pero no precios recientes. El periodo acaba en el dato más reciente y no se recorta por ella. */
  SERIES_ENDS_EARLY: "sus precios acaban antes del final del periodo",
  /* Dos casos que el servidor separa desde la decisión 58. El primero no afirma que falte la serie de cambio: un servidor
     anterior manda este código también para la cuarentena, y ahí la serie de cambio existe. */
  FX_SERIES_MISSING: "sin conversión a euros",
  FX_QUARANTINE: "sin conversión a euros fiable",
  NON_INVESTABLE: "no invertible",
  QUALITY_BLOCKED: "bloqueado por calidad del dato",
  DISTRIBUTES_WITHOUT_PAYMENTS: "reparte y no tenemos todos los pagos"
};

export function backtestExclusionLabel(reason: string): string {
  return EXCLUSION_REASONS[reason] ?? reason.toLowerCase().replace(/_/g, " ");
}

/**
 * Por qué se queda fuera una posición, en palabras para el cliente (decisión 19): «Bloqueado por calidad de datos» es
 * la cocina, y el asesor sigue viendo el motivo de verdad. Cada frase es cierta para su motivo: «incidencia» solo lo es
 * para una serie que no pasó el control. Un fondo nuevo no tiene una incidencia, tiene poca historia, y a un fondo que
 * reparte no le pasa nada: es su serie la que no recoge lo que paga. Un motivo que no se conoce no se enseña.
 */
const MOTIVOS_PARA_EL_CLIENTE: Record<string, string> = {
  QUALITY_BLOCKED: "incidencia en su serie de precios",
  NO_SERIES: "sin serie de precios",
  PRICE_SERIES_MISSING: "sin serie de precios",
  NO_DATA_AT_WINDOW_START: "sin precios en esas fechas",
  YOUNGEST_TO_REACH_THREE_YEARS: "tiene menos historia que el resto",
  INSUFFICIENT_HISTORY: "sin historia suficiente",
  REFERENCE_LINK_FAILED: "sin historia suficiente, y su referencia no se pudo enlazar",
  SERIES_ENDS_EARLY: "sin precios recientes",
  /* N03: solo en una crisis, la posición que dejó de cotizar durante parte de ella. */
  GAP_IN_WINDOW: "sin cotizaciones durante parte de la crisis",
  FX_SERIES_MISSING: "sin conversión a euros",
  FX_QUARANTINE: "sin conversión a euros fiable",
  NON_INVESTABLE: "no es invertible",
  DISTRIBUTES_WITHOUT_PAYMENTS: "reparte, y su serie no recoge lo que paga"
};

export function motivoDeFueraParaElCliente(reason: string): string {
  const motivo = MOTIVOS_PARA_EL_CLIENTE[reason];
  return motivo ? `Fuera del cálculo: ${motivo}` : "Fuera del cálculo";
}

/**
 * Un activo elegido que el servidor no ha dibujado. Sin decirlo, la línea falta y parece un fallo. `NON_INVESTABLE` no se traduce
 * tal cual porque un servidor anterior lo manda también de lo que se puede comprar: el oro y las tres acciones de la decisión 75.
 */
const NO_SE_DIBUJA_PORQUE: Record<string, string> = {
  NON_INVESTABLE: "este activo está fuera del análisis histórico"
};

export function fraseDeLoQueNoSeDibuja(nombre: string, reason: string, { modoCliente = false }: { modoCliente?: boolean } = {}): string {
  const motivo = NO_SE_DIBUJA_PORQUE[reason] ?? (modoCliente ? MOTIVOS_PARA_EL_CLIENTE[reason] : backtestExclusionLabel(reason));
  return motivo ? `${nombre} no se dibuja: ${motivo}.` : `${nombre} no se dibuja.`;
}

/**
 * Lo que dice la gráfica de una ficha sin serie. Un código del servidor no se traduce tal cual, porque aquí sería falso.
 *
 * `NON_INVESTABLE` lo trae hoy, de las 1.104 fichas de la base nueva, solo NH Hoteles, que dejó de cotizar y no tiene serie. Con un
 * servidor anterior a las decisiones 75 y 76 lo traen también iShares Physical Gold, que se compra y ya se mide, y Deoleo, Duro
 * Felguera y Squirrel, que cotizan y tienen un defecto en su serie. Por eso no se lee «no invertible» aquí: la frase vale para los cinco.
 *
 * Un código que no se conoce no se enseña.
 */
export function serieNoDisponible(reason: string | null | undefined, { modoCliente = false }: { modoCliente?: boolean } = {}): string {
  const motivo = !reason
    ? undefined
    : reason === "NON_INVESTABLE"
      ? "este activo está fuera del análisis histórico"
      : modoCliente
        ? MOTIVOS_PARA_EL_CLIENTE[reason]
        : EXCLUSION_REASONS[reason];
  return motivo ? `Serie no disponible: ${motivo}.` : "Serie no disponible para este periodo.";
}

/**
 * Avisos en español, listos para pintar. Incluye el de ventana colapsada aunque el
 * backend no lo emita: su umbral va por observaciones y aquí se mira el calendario.
 */
export function backtestCoverageNotices(
  data: BacktestCoverageInput | null | undefined,
  nameById: Record<string, string> = {}
): string[] {
  const coverage = backtestWindowCoverage(data);
  if (!data || !coverage) return [];
  const avisos: string[] = [];
  const codes = new Set(data.warnings ?? []);
  const nombre = (assetId: string) => nameById[assetId] ?? assetId;

  if (codes.has("WINDOW_COLLAPSED") || (!coverage.coversWindow && coverage.rangeLabel)) {
    const partes = [
      `El histórico común de esta cartera va de ${coverage.rangeLabel}`,
      `${coverage.measuredObservations} ${coverage.measurementLabel}`
    ];
    if (coverage.requiredObservations !== null) {
      partes.push(`el mínimo para ${ventanaEnPalabras(data.window)} son ${coverage.requiredObservations}`);
    }
    let aviso = `${partes.join(" · ")}. Las métricas describen ese periodo, no ${coverage.requestedYears} años.`;
    /* Un nombre puede acabar en punto, como «Duro Felguera, S.A.», y la frase no lleva dos (decisión 80, en el papel). */
    const conPunto = (frase: string) => `${frase}${frase.endsWith(".") ? "" : "."}`;
    const { startLimitedBy: porElPrincipio, endLimitedBy: porElFinal } = coverage;
    /* OPT-5 (auditoría del 16-11-2026): el servidor dice quién recorta por cada lado, y aquí solo se nombraba al del
       principio; una ventana acortada por el final salía sin culpable. Con uno solo por el principio, la frase de siempre. */
    if (porElPrincipio && porElFinal && porElPrincipio !== porElFinal) {
      aviso += conPunto(` Lo recorta por el principio ${nombre(porElPrincipio)} y por el final ${nombre(porElFinal)}`);
    } else if (porElPrincipio && porElFinal) {
      aviso += ` Lo recorta ${nombre(porElPrincipio)}, por el principio y por el final.`;
    } else if (porElPrincipio) {
      aviso += conPunto(` Lo recorta ${nombre(porElPrincipio)}`);
    } else if (porElFinal) {
      aviso += conPunto(` Lo recorta por el final ${nombre(porElFinal)}`);
    }
    avisos.push(aviso);
  }
  if (codes.has("PERIOD_END_STALE")) {
    /* OPT-2 (auditoría del 16-11-2026) y decisión A-161: el fin del periodo lo fija el dato más reciente de la cartera. Si
       ni ese es de este mes, se dice; la serie que se quedó atrás sale aparte, con su motivo (`SERIES_ENDS_EARLY`). */
    const hasta = coverage.lastDate ? `el ${oFalta(fecha(coverage.lastDate))}` : "hace más de un mes";
    avisos.push(`El periodo medido acaba ${hasta}: ninguna serie de la cartera llega más allá, y las cifras no recogen lo ocurrido desde entonces.`);
  }
  if (codes.has("RISK_FREE_RATE_PARTIAL_COVERAGE")) {
    avisos.push("El tipo sin riesgo €STR solo cubre parte de la ventana: el Sharpe es aproximado.");
  }
  if (codes.has("RISK_FREE_RATE_STATIC_FALLBACK")) {
    avisos.push("No se pudo leer el €STR de la ventana: el Sharpe usa un tipo fijo de respaldo.");
  }
  const excluidos = data.excluded_assets ?? [];
  if (excluidos.length > 0) {
    const detalle = excluidos
      .slice(0, 6)
      .map((item) => `${nombre(item.asset_id)} (${backtestExclusionLabel(item.reason)})`)
      .join(", ");
    const resto = excluidos.length > 6 ? ` y ${excluidos.length - 6} más` : "";
    avisos.push(`Fuera del cálculo: ${detalle}${resto}.`);
  }
  return avisos;
}

