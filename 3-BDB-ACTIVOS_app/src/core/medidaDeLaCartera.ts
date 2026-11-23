import type { PortfolioHorizon } from "../adapters/portfolioHorizon";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbOptimizationPreview,
  BdbOptimizationPreviewAsset,
  BdbOptimizationPreviewExcludedAsset,
  BdbPortfolioReportPosition,
  BdbPortfolioWeightedMetrics
} from "../types/bdbAssets";
import { isInvestableAsset } from "./assetMapping";
import { backtestExclusionLabel } from "./backtestCoverage";
import { fecha, oFalta, periodo, peso, porcentaje, ratio, rentabilidad } from "./formato";
import { aniosEnPalabras, ETIQUETAS_DE_METRICA, textoEnPantalla } from "./glosarioDePantalla";
import { motivoDeQueNoAplique, seEnsenaLaMetrica, type MetricaDeInstrumento } from "./metricasPorInstrumento";
import { hayCifraDeCartera, PESO_MINIMO_MEDIDO_PCT, riesgoMedidoDe, type RiesgoMedido } from "./riesgoMedido";
import { textoDeAusencia } from "./textoDeAusencia";

/**
 * Cómo dice la pantalla de dónde salen las cifras de una cartera. Casi todo es solo de pantalla: el papel tiene sus notas en
 * `parteMedida` y en `portfolioHorizon`, que no se tocan de rebote. Lo que comparten es `leerLaTira`: si hay cifra de la cartera y, si
 * no la hay, por qué. Lo lee todo el papel (decisión 59), para que lo que se firma diga lo mismo que la pantalla.
 *
 * Lo que la simulación es, comprobado en `functions_python/portfolio_horizon.py` (`_backtest`): el
 * valor de cada activo se divide por el del primer día y se multiplica por su peso, normalizado sobre
 * la parte con serie. O sea, **los pesos de hoy desde el primer día y sin reequilibrar**. Las series son
 * valores liquidativos y precios en euros, así que van **netas de los gastos de los fondos**; ni el
 * asesoramiento ni los impuestos entran en el cálculo. Es una reconstrucción con lo que hoy se ha
 * elegido, no lo que ha ganado la cartera, y el propio servidor lo escribe: «No es rentabilidad
 * histórica observada».
 */

/** Por debajo de este peso no hay cifra de la cartera, ninguna (decisiones 20 y 36). */
export { hayCifraDeCartera, PESO_MINIMO_MEDIDO_PCT };

/** La referencia de muestra que usa la demo: series sintéticas, no precios. */
const VERSION_DE_MUESTRA = "demo-synthetic.v1";

export interface FueraDeLaMedida {
  assetId: string;
  nombre: string;
  /** Su peso en la cartera, de 0 a 100. Sin posición con que cruzarlo, no se inventa. */
  pesoPct: number | null;
  /** El motivo, en palabras. Es diagnóstico del asesor: en Modo cliente no se enseña. */
  motivo: string;
  /** Lo ha dejado fuera el control de calidad de su serie, no la falta de historia. */
  porCalidad: boolean;
}

/**
 * Un peso, con un decimal: «88,0 %», «87,6 %». Redondear a entero escribiría «80 %» para un 79,6 %, y justo ahí
 * está el umbral de la decisión 20. Y lo que no llega al umbral nunca se escribe como si llegara: un 79,96 % sale
 * «79,96 %», cortado y no redondeado.
 */
export function pesoLegible(pesoPct: number): string {
  if (!hayCifraDeCartera(pesoPct) && Math.round(pesoPct * 10) / 10 >= PESO_MINIMO_MEDIDO_PCT) {
    return oFalta(porcentaje(Math.floor(pesoPct * 100 + 1e-9) / 10000));
  }
  return oFalta(peso(pesoPct / 100));
}

/** Lo que la serie deja fuera, con su nombre y su peso, de mayor a menor. */
export function fueraDeLaMedida(
  horizonte: { backtest: Pick<PortfolioHorizon["backtest"], "excluded_assets"> } | null | undefined,
  positions: readonly Pick<BdbManualPortfolioPosition, "asset_id" | "weight_percent" | "label">[],
  assets: readonly Pick<BdbAssetDetail, "asset_id" | "display_name">[]
): FueraDeLaMedida[] {
  if (!horizonte) return [];
  const total = positions.reduce((suma, p) => suma + Math.max(0, p.weight_percent || 0), 0);
  return (horizonte.backtest.excluded_assets ?? [])
    .map((excluido) => {
      const posicion = positions.find((p) => p.asset_id === excluido.asset_id);
      return {
        assetId: excluido.asset_id,
        nombre: assets.find((a) => a.asset_id === excluido.asset_id)?.display_name ?? posicion?.label ?? excluido.asset_id,
        pesoPct: posicion && total > 0 ? ((posicion.weight_percent || 0) / total) * 100 : null,
        motivo: backtestExclusionLabel(excluido.reason),
        porCalidad: excluido.reason === "QUALITY_BLOCKED"
      };
    })
    .sort((a, b) => (b.pesoPct ?? 0) - (a.pesoPct ?? 0));
}

export function nombreConPeso(fuera: FueraDeLaMedida): string {
  return fuera.pesoPct === null ? fuera.nombre : `${fuera.nombre} (${pesoLegible(fuera.pesoPct)})`;
}

/** La señal de datos de lo que se queda fuera, o nada si no se queda nada. */
export function senalDeLoQueQuedaFuera(fuera: readonly FueraDeLaMedida[]): string | null {
  if (fuera.length === 0) return null;
  const nombres = fuera.map(nombreConPeso).join(", ");
  if (fuera.every((item) => item.porCalidad)) {
    return `${fuera.length} ${fuera.length === 1 ? "posición" : "posiciones"} fuera del cálculo por calidad del dato: ${nombres}.`;
  }
  return `${fuera.length} ${fuera.length === 1 ? "posición" : "posiciones"} fuera del cálculo: ${nombres}.`;
}

const periodoDe = (horizonte: PortfolioHorizon): string | null => {
  const { first_date: desde, last_date: hasta } = horizonte.backtest.coverage ?? {};
  return periodo(desde, hasta);
};

/** La línea bajo el título: quién lo dice, desde cuándo, sobre cuánto y qué se queda fuera. */
export function procedenciaDeLaMedida(horizonte: PortfolioHorizon, fuera: readonly FueraDeLaMedida[]): string {
  const origen =
    horizonte.referenceVersion === VERSION_DE_MUESTRA
      ? "Datos de muestra, series sintéticas"
      : (horizonte.extensions ?? []).length > 0
        ? "Simulación con los pesos de hoy, ampliada con referencias"
        : "Simulación con los pesos de hoy";
  return [
    origen,
    periodoDe(horizonte),
    `${pesoLegible(horizonte.coverageWeightPercent)} del peso`,
    fuera.length > 0 ? `fuera: ${fuera.map(nombreConPeso).join(", ")}` : null
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * El sello de las cifras medidas. No pierde lo que distinguía el anterior: precios observados frente a
 * histórico ampliado.
 */
export function selloDeLaMedida(horizonte: Pick<PortfolioHorizon, "referenceVersion" | "extensions">): string {
  if (horizonte.referenceVersion === VERSION_DE_MUESTRA) return "Datos de muestra · series sintéticas";
  return (horizonte.extensions ?? []).length > 0
    ? "Simulación con los pesos de hoy · histórico ampliado"
    : "Simulación con los pesos de hoy · precios observados";
}

/** Cuánta cartera mide la simulación: «7 de 8 activos · 88,0 % del peso». La misma frase donde se diga. */
export function coberturaDeLaSimulacion(horizonte: Pick<PortfolioHorizon, "backtest" | "coverageWeightPercent">): string {
  const { asset_ids: dentro, excluded_assets: fuera, coverage } = horizonte.backtest;
  const total = coverage?.requested_assets ?? dentro.length + (fuera?.length ?? 0);
  /* `peso` pone el espacio duro: a media línea, la cifra y su «%» se separaban. */
  return `${dentro.length} de ${total} ${total === 1 ? "activo" : "activos"} · ${oFalta(peso(horizonte.coverageWeightPercent / 100))} del peso`;
}

/** La línea bajo el título de la simulación: qué es, de cuándo a cuándo y sobre cuánto. */
export function procedenciaDeLaSimulacion(
  horizonte: Pick<PortfolioHorizon, "referenceVersion" | "extensions" | "backtest" | "coverageWeightPercent">
): string {
  const sello =
    horizonte.referenceVersion === VERSION_DE_MUESTRA
      ? "Datos de muestra · series sintéticas"
      : (horizonte.extensions ?? []).length > 0
        ? "Simulación con los pesos de hoy · histórico ampliado"
        : "Simulación con los pesos de hoy";
  const { first_date: desde, last_date: hasta } = horizonte.backtest.coverage ?? {};
  return [sello, periodo(desde, hasta), coberturaDeLaSimulacion(horizonte)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * La nota fija bajo la franja. Cada palabra está comprobada en el servidor: ver arriba. Con `sinCobertura`,
 * para un panel que ya la dice bajo el título: la misma cifra no se escribe dos veces.
 */
export function notaDeLaSimulacion(
  horizonte: Pick<PortfolioHorizon, "backtest" | "coverageWeightPercent">,
  opciones: { sinCobertura?: boolean; sinFondos?: boolean } = {}
): string {
  const desde = horizonte.backtest.coverage?.first_date;
  /* Sin ningún fondo dentro, no hay gastos de los fondos que decir. */
  const gastos = opciones.sinFondos ? "" : ", netos de gastos de los fondos";
  const base = `Simulación: pesos de hoy${desde ? ` desde ${fecha(desde)}` : ""}, sin reequilibrar${gastos}, antes de asesoramiento e impuestos.`;
  return opciones.sinCobertura ? base : `${base} Peso medido: ${pesoLegible(horizonte.coverageWeightPercent)}.`;
}

const CAUTELA = "No constituyen recomendación personalizada ni evalúan idoneidad.";

/**
 * El método, para donde va seguido de la procedencia en el mismo párrafo (la línea bajo la respuesta de Análisis). La
 * procedencia ya dice que es una simulación con los pesos de hoy, entre qué fechas y qué parte del peso mide: con la
 * nota entera detrás, todo eso se leía dos veces. Aquí solo va lo que la procedencia no dice.
 */
export function metodoTrasLaProcedencia(opciones: { sinFondos?: boolean } = {}): string {
  const gastos = opciones.sinFondos ? "" : ", netas de gastos de los fondos";
  return `Cifras sin reequilibrar los pesos${gastos} y antes de asesoramiento e impuestos. ${CAUTELA}`;
}

/** Lo que acompaña a las cifras medidas: el cálculo ya lo dice la nota de la simulación. */
export const NOTA_CON_MEDIDA = CAUTELA;

type EstadoDeVolatilidad = "ok" | "sin_dato" | "metodos_distintos";

/** Por qué hay o no hay volatilidad estimada. Con todos los pesos a 0 no hay métodos que difieran. */
export function estadoDeLaVolatilidad(
  metricas: Pick<BdbPortfolioWeightedMetrics, "volatility_comparable" | "volatility_detail"> | undefined,
  ventana: "1Y" | "3Y" | "5Y" = "3Y"
): EstadoDeVolatilidad {
  return metricas?.volatility_detail?.[ventana]?.status ?? (metricas?.volatility_comparable === false ? "metodos_distintos" : "ok");
}

/**
 * Los avisos de la cartera, en palabras de la pantalla. Salen de `core/portfolio`, que también lee el
 * papel, y hay dos que con una simulación delante no dicen lo que parecen:
 *
 * - «Metricas parciales (0% de la cartera)». Con métodos distintos, la cobertura cae a 0 porque las
 *   volatilidades no se suman, no porque falte el dato. Entonces lo que se enseña es la cobertura medida.
 * - «Mezcla de divisas sin convertir». La simulación se mide en euros. Lo único que puede quedar sin convertir
 *   son cifras del proveedor en otra divisa, y eso pasa con simulación o sin ella: «Volatilidad sola» sigue
 *   leyéndolas en la tabla de composición.
 */
export function avisosDePantalla(
  avisos: readonly string[],
  metricas: Pick<BdbPortfolioWeightedMetrics, "volatility_comparable" | "volatility_detail"> | undefined,
  pesoMedidoPct: number | undefined,
  enOtraDivisa?: readonly CifraEnOtraDivisa[]
): string[] {
  const hayMedida = typeof pesoMedidoPct === "number";
  return avisos.flatMap((aviso) => {
    if (aviso.startsWith("Mezcla de divisas")) {
      if (!enOtraDivisa) return hayMedida ? [] : [aviso];
      const divisas = avisoDeDivisas(enOtraDivisa);
      return divisas ? [divisas] : [];
    }
    if (!aviso.startsWith("Metricas parciales")) return [textoEnPantalla(aviso)];
    if (estadoDeLaVolatilidad(metricas) === "metodos_distintos") {
      return hayMedida ? [`Métricas medidas sobre el ${pesoLegible(pesoMedidoPct)} de la cartera.`] : [];
    }
    return [textoEnPantalla(aviso)];
  });
}

/** Una posición cuya cifra viene del proveedor en otra divisa: lo único que de verdad queda sin convertir. */
export interface CifraEnOtraDivisa {
  assetId: string;
  nombre: string;
  divisa: string;
}

/**
 * Lo que queda sin convertir. Las series y las métricas propias ya están en euros (§5 del método): lo que
 * puede ir en otra divisa es la cifra que copiamos del proveedor. Tener una clase en dólares no basta.
 */
export function cifrasDelProveedorEnOtraDivisa(
  positions: readonly Pick<BdbManualPortfolioPosition, "asset_id" | "weight_percent">[],
  assets: readonly BdbAssetDetail[]
): CifraEnOtraDivisa[] {
  return positions.flatMap((posicion) => {
    const activo = assets.find((a) => a.asset_id === posicion.asset_id);
    if (!activo || !((posicion.weight_percent || 0) > 0) || !isInvestableAsset(activo)) return [];
    const divisa = activo.currency || "EUR";
    /* Un activo mezclado también (decisión 110): su cifra a 10 años puede ser la del proveedor, y la cartera suma esa ventana. */
    const delProveedor = activo.metrics.metrics_method === "TRAILING_PROVIDER" || Object.values(activo.metrics.metrics_by_window ?? {}).some((rotulo) => rotulo.method === "TRAILING_PROVIDER");
    return divisa !== "EUR" && delProveedor
      ? [{ assetId: activo.asset_id, nombre: activo.display_name, divisa }]
      : [];
  });
}

/** El aviso de divisas que queda, o ninguno. */
export function avisoDeDivisas(enOtraDivisa: readonly CifraEnOtraDivisa[]): string | null {
  if (enOtraDivisa.length === 0) return null;
  return `Cifras del proveedor en otra divisa, sin convertir: ${enOtraDivisa.map((cifra) => `${cifra.nombre} (${cifra.divisa})`).join(", ")}.`;
}

const METODOS_DISTINTOS = "Las posiciones usan métodos distintos: el riesgo de la cartera se mide en la simulación.";

/** Los avisos que se escriben igual en Optimizar y en Comprobar, donde aún no se conoce la cobertura medida. */
function avisosSinMedida(avisos: readonly string[], metodosDistintos: boolean, enOtraDivisa: readonly CifraEnOtraDivisa[]): string[] {
  return avisos.flatMap((aviso) => {
    if (aviso.startsWith("Mezcla de divisas")) {
      const divisas = avisoDeDivisas(enOtraDivisa);
      return divisas ? [divisas] : [];
    }
    if (!aviso.startsWith("Metricas parciales")) return [textoEnPantalla(aviso)];
    return [metodosDistintos && /\(0\s?%/.test(aviso) ? METODOS_DISTINTOS : textoEnPantalla(aviso)];
  });
}

/**
 * Los avisos de cartera de Optimizar. Si hay rentabilidad y volatilidad en las fichas y la cobertura sale
 * 0 %, no es que falte el dato: los métodos no se pueden sumar. Allí no se conoce aún la cobertura medida.
 */
export function avisosDeLaVistaPrevia(
  avisos: readonly string[],
  disponibles: readonly string[],
  enOtraDivisa: readonly CifraEnOtraDivisa[] = []
): string[] {
  return avisosSinMedida(avisos, disponibles.includes("annualized_return_3y") && disponibles.includes("volatility_3y"), enOtraDivisa);
}

/** Los mismos avisos en Comprobar, que conoce el motivo directamente: la cartera dice si sus métodos se suman. */
export function avisosDeComprobar(
  avisos: readonly string[],
  metricas: Pick<BdbPortfolioWeightedMetrics, "volatility_comparable" | "volatility_detail"> | undefined,
  enOtraDivisa: readonly CifraEnOtraDivisa[] = []
): string[] {
  return avisosSinMedida(avisos, estadoDeLaVolatilidad(metricas) === "metodos_distintos", enOtraDivisa);
}

/** Cuántas posiciones tienen cada métrica. El orden es el de la lectura: rentabilidad, riesgo, caídas. */
const METRICAS_DE_LA_LISTA = ["annualized_return_3y", "volatility_3y", "sharpe_3y", "max_drawdown_5y", "max_drawdown_hist", "risk_score"] as const;

/** De la lista, las que a un tipo pueden no aplicarle. */
const QUIEN_DECIDE_SI_APLICA: Partial<Record<(typeof METRICAS_DE_LA_LISTA)[number], MetricaDeInstrumento>> = {
  sharpe_3y: "sharpe",
  risk_score: "indicadorDeRiesgo"
};

export interface MetricaPorPosicion {
  clave: string;
  etiqueta: string;
  /** Las posiciones que la tienen. */
  con: number;
  /** Las posiciones a las que les aplica. */
  de: number;
}

/**
 * Una sola lista: «Caída máxima 5 años 7/8». `metrics_available` y `metrics_missing` son uniones sobre los activos, así
 * que una cifra que unos tenían y otros no salía a la vez en «disponibles» y en «faltan». El Sharpe no cuenta para
 * una acción, ni arriba ni abajo: no se enseña (§9 del método), así que no le falta. El indicador de riesgo, tampoco: una acción
 * no tiene KID ni KIID (decisión 83).
 */
export function metricasPorPosicion(
  activos: readonly Pick<BdbOptimizationPreviewAsset, "instrument_type" | "metrics_available">[]
): MetricaPorPosicion[] {
  return METRICAS_DE_LA_LISTA.map((clave) => {
    const metrica = QUIEN_DECIDE_SI_APLICA[clave];
    const aplican = activos.filter((activo) => !metrica || seEnsenaLaMetrica(metrica, activo.instrument_type));
    return {
      clave,
      etiqueta: ETIQUETAS_DE_METRICA[clave],
      con: aplican.filter((activo) => activo.metrics_available.includes(clave)).length,
      de: aplican.length
    };
  }).filter((metrica) => metrica.de > 0);
}

export interface UniversoDeLaComprobacion {
  elegibles: BdbOptimizationPreviewAsset[];
  /** `diagnostico` es por qué se queda fuera de la simulación: del asesor, en Modo cliente no se enseña. */
  excluidos: Array<{ asset_id: string; display_name: string; motivo: string; diagnostico?: string }>;
}

/**
 * Lo que entra de verdad, en lo que se sabe. La comprobación previa solo mira que el activo exista, pese y sea
 * invertible, así que decía «Elegibles 8» de una cartera cuya simulación deja uno fuera. Si la simulación ha
 * llegado, lo que deja fuera deja de ser elegible y dice por qué; si no, no se inventa.
 */
export function universoDeLaComprobacion(
  preview: Pick<BdbOptimizationPreview, "eligible_assets" | "excluded_assets">,
  horizonte: Pick<PortfolioHorizon, "backtest" | "years"> | null | undefined,
  motivoDelPeso: (motivo: BdbOptimizationPreviewExcludedAsset["reason"]) => string
): UniversoDeLaComprobacion {
  const fueraDeLaSimulacion = new Map((horizonte?.backtest.excluded_assets ?? []).map((fuera) => [fuera.asset_id, fuera.reason]));
  const elegibles = preview.eligible_assets.filter((activo) => !fueraDeLaSimulacion.has(activo.asset_id));
  const descontados = preview.eligible_assets.flatMap((activo) => {
    const motivo = fueraDeLaSimulacion.get(activo.asset_id);
    return motivo === undefined
      ? []
      : [{ asset_id: activo.asset_id, display_name: activo.display_name, motivo: `Fuera de la simulación a ${horizonte?.years} años`, diagnostico: backtestExclusionLabel(motivo) }];
  });
  return {
    elegibles,
    excluidos: [
      ...preview.excluded_assets.map((activo) => ({ asset_id: activo.asset_id, display_name: activo.display_name, motivo: motivoDelPeso(activo.reason) })),
      ...descontados
    ]
  };
}

export interface CifraDeLaTira {
  label: string;
  value: string;
  note?: string;
}

type ActivoConTipo = Pick<BdbAssetDetail, "asset_id" | "instrument_type">;

/** Lo que entra en la cifra es una sola acción: su Sharpe no se enseña (§9 del método), aunque se llame cartera. */
export function esUnaSolaAccion(ids: readonly string[], assets: readonly ActivoConTipo[]): boolean {
  return ids.length === 1 && soloAcciones(ids, assets);
}

/** Dentro no hay ningún fondo ni ETF: no hay gastos de los fondos que descontar. */
export function soloAcciones(ids: readonly string[], assets: readonly ActivoConTipo[]): boolean {
  return ids.length > 0 && ids.every((id) => assets.find((asset) => asset.asset_id === id)?.instrument_type === "STOCK");
}

/** Las posiciones que pesan: las que se simulan. */
export const idsConPeso = (positions: readonly Pick<BdbManualPortfolioPosition, "asset_id" | "weight_percent">[]): string[] =>
  positions.filter((posicion) => (posicion.weight_percent || 0) > 0).map((posicion) => posicion.asset_id);

/**
 * Cómo se llama lo que dibuja una simulación. «Tu cartera» es lo que la pantalla llamaba a la reconstrucción con
 * los pesos de hoy, también cuando solo cubría parte: la frontera ya decía «Parte medida», y la curva de al lado no.
 */
export function rotuloDeLaSerie(horizonte: Pick<PortfolioHorizon, "coverageWeightPercent">): string {
  return horizonte.coverageWeightPercent < 99.95 ? `Parte medida (${pesoLegible(horizonte.coverageWeightPercent)})` : "Cartera";
}

/** La aportación al riesgo de la simulación: la que viaja aparte cuando no hay frontera (más de 40 activos medidos,
 *  10-11-2026), o la de la frontera. Hasta 40 activos es siempre la de la frontera, como antes. */
export function aportacionAlRiesgo(horizonte: Pick<PortfolioHorizon, "frontier" | "riskContributions"> | null | undefined) {
  return horizonte?.riskContributions ?? horizonte?.frontier?.riskContributions;
}

/**
 * La nota de lo que se mide y no entra en la frontera, porque no se puede comprar (decisión de Óscar, 15-11-2026). La misma
 * frase en la pantalla y en el informe completo. Sin ninguno, `null`. Con `hayFrontera`, dice además por qué el punto de la
 * cartera puede quedar fuera de la curva: lleva un activo que la frontera no admite.
 */
export function notaDeLoQueNoEntraEnLaFrontera(
  horizonte: Pick<PortfolioHorizon, "frontierNotSelectable">,
  nombreDe: (assetId: string) => string,
  opciones: { hayFrontera: boolean }
): string | null {
  const lista = horizonte.frontierNotSelectable ?? [];
  if (lista.length === 0) return null;
  const uno = lista.length === 1;
  const quienes = lista.map((a) => `${nombreDe(a.assetId)} (${a.reasonLabel}, ${oFalta(peso(a.weight))} de la cartera)`).join("; ");
  const cabeza = uno ? "No entra en la frontera porque no se puede comprar" : "No entran en la frontera porque no se pueden comprar";
  const cifras = `Las cifras de la cartera sí ${uno ? "lo" : "los"} incluyen`;
  return `${cabeza}: ${quienes}. ${cifras}${opciones.hayFrontera ? ", y por eso su punto puede quedar fuera de la curva." : "."}`;
}

/** Junto a la simulación de Máximo Sharpe: qué no lleva, porque no se puede comprar, y que la cartera actual sí. Sin ninguno, `null`. */
export function fraseDelMaximoSinLoQueNoSePuedeComprar(
  horizonte: Pick<PortfolioHorizon, "frontierNotSelectable">,
  nombreDe: (assetId: string) => string
): string | null {
  return fraseSinLoQueNoSePuedeComprar("La de Máximo Sharpe", horizonte, nombreDe);
}

/** Lo mismo para la equiponderada, que reparte a partes iguales solo entre lo que se puede comprar (la regla de la frontera). */
export function fraseDeLaEquiponderadaSinLoQueNoSePuedeComprar(
  horizonte: Pick<PortfolioHorizon, "frontierNotSelectable">,
  nombreDe: (assetId: string) => string
): string | null {
  return fraseSinLoQueNoSePuedeComprar("La equiponderada", horizonte, nombreDe);
}

function fraseSinLoQueNoSePuedeComprar(
  quien: string,
  horizonte: Pick<PortfolioHorizon, "frontierNotSelectable">,
  nombreDe: (assetId: string) => string
): string | null {
  const lista = horizonte.frontierNotSelectable ?? [];
  if (lista.length === 0) return null;
  const uno = lista.length === 1;
  const quienes = lista.map((a) => `${nombreDe(a.assetId)} (${a.reasonLabel})`).join(", ");
  return `${quien} no lleva ${quienes}: ${uno ? "no se puede" : "no se pueden"} comprar. La cartera actual sí ${uno ? "lo" : "los"} lleva.`;
}

/** Tope de activos de la frontera eficiente: `MAX_ACTIVOS_FRONTERA` de `functions_python/portfolio_horizon.py`, y
 *  `tests/topeDeLaSimulacion.test.ts` falla si dejan de ser el mismo número. Con más activos medidos no hay frontera con
 *  series y, desde la decisión A-129, con más posiciones tampoco se dibuja la estimada por composición. */
export const TOPE_DE_LA_FRONTERA = 40;

/** A-130: lo que se escribe donde iría la frontera estimada cuando ninguna posición tiene peso y la cartera pasa del
 *  tope. Sin pesos no hay simulación ni aportación al riesgo a la que llevar, así que la segunda frase dice qué hacer;
 *  con pesos sobra, porque el panel que la sustituye ya enseña las cifras o su motivo. */
export function avisoDelTopeDeLaEstimada(posiciones: number, hayPeso: boolean): string {
  const tope = `La frontera estimada se dibuja con ${TOPE_DE_LA_FRONTERA} posiciones como máximo y esta cartera tiene ${posiciones}.`;
  return hayPeso ? tope : `${tope} Reparte los pesos para ver las cifras de la cartera.`;
}

/**
 * La simulación lleva tramos anteriores al lanzamiento de alguna posición, reconstruidos desde una referencia. Lo que se mida con
 * ella es en parte una estimación, y se rotula donde se enseñe (decisión 58).
 */
export function conTramosEstimados(horizonte: Pick<PortfolioHorizon, "extensions"> | null | undefined): boolean {
  return (horizonte?.extensions ?? []).length > 0;
}

/**
 * «Rentabilidad anualizada 3 años», y si el histórico está ampliado, que lo diga. El papel lleva los suyos. Por
 * debajo del 80 % del peso, Visión general dice que el riesgo no está medido: la cifra de la misma simulación
 * dice de qué es.
 */
export function rotuloDeLaMedida(nombre: string, anos: number, ampliado?: boolean, pesoPct?: number): string {
  const parte = typeof pesoPct === "number" && !hayCifraDeCartera(pesoPct) ? ` · parte medida (${pesoLegible(pesoPct)})` : "";
  return `${nombre} ${aniosEnPalabras(anos)}${ampliado ? " · estimado" : ""}${parte}`;
}

/**
 * La diferencia final con la cartera de referencia, en puntos de base 100. Por debajo del 80 % del peso no hay cifra de la
 * cartera: la parte medida se puede dibujar junto a la referencia, pero su diferencia con una cartera entera no dice nada
 * de la cartera (decisión 36).
 */
export function diferencialConLaReferencia(finalDeLaCartera: number, finalDeLaReferencia: number, pesoMedidoPct: number): number | null {
  return hayCifraDeCartera(pesoMedidoPct) ? finalDeLaCartera - finalDeLaReferencia : null;
}

const NO_APLICA = textoDeAusencia("no-aplica");

/** Lo que dice una cifra mientras la simulación va de camino. */
export const MIDIENDO = "Midiendo…";

/** El Sharpe de una acción no se enseña, se esté midiendo o no. */
const sharpeQueNoAplica = (label: string): CifraDeLaTira => ({ label, value: NO_APLICA, note: motivoDeQueNoAplique("sharpe", "STOCK") });

/**
 * Las cuatro cifras de la serie, en el periodo elegido: la rentabilidad con signo, la volatilidad y la caída máxima
 * como porcentajes, y el Sharpe como ratio, todas con dos decimales.
 */
export function cifrasMedidas(
  medido: RiesgoMedido,
  opciones: { anos: number; ampliado?: boolean; tipoSinRiesgo?: number; unaSolaAccion?: boolean }
): CifraDeLaTira[] {
  const rotulo = (nombre: string) => rotuloDeLaMedida(nombre, opciones.anos, opciones.ampliado);
  return [
    { label: rotulo("Rentabilidad anualizada"), value: oFalta(rentabilidad(medido.cagr)) },
    { label: rotulo("Volatilidad"), value: oFalta(porcentaje(medido.volatility)) },
    opciones.unaSolaAccion
      ? sharpeQueNoAplica(rotulo("Sharpe"))
      : {
          label: rotulo("Sharpe"),
          value: oFalta(ratio(medido.sharpe)),
          note: typeof opciones.tipoSinRiesgo === "number" ? `Tipo sin riesgo ${oFalta(porcentaje(opciones.tipoSinRiesgo))}` : undefined
        },
    { label: rotulo("Caída máxima"), value: oFalta(porcentaje(medido.maxDrawdown)) }
  ];
}

/** Las cuatro casillas mientras la simulación va de camino: lo que va a salir, sin una cifra que luego cambie. */
export function cifrasMidiendo(anos: number, opciones: { unaSolaAccion?: boolean } = {}): CifraDeLaTira[] {
  const rotulo = (nombre: string) => rotuloDeLaMedida(nombre, anos);
  return [
    { label: rotulo("Rentabilidad anualizada"), value: MIDIENDO },
    { label: rotulo("Volatilidad"), value: MIDIENDO },
    opciones.unaSolaAccion ? sharpeQueNoAplica(rotulo("Sharpe")) : { label: rotulo("Sharpe"), value: MIDIENDO },
    { label: rotulo("Caída máxima"), value: MIDIENDO }
  ];
}

const loQueQuedaFuera = (fuera: readonly FueraDeLaMedida[]): string | null =>
  fuera.length === 0 ? null : `Se ${fuera.length === 1 ? "queda" : "quedan"} fuera: ${fuera.map(nombreConPeso).join(", ")}.`;

const HACE_FALTA = `para dar una cifra de la cartera hace falta al menos el ${PESO_MINIMO_MEDIDO_PCT} % del peso`;

/** Por qué no hay cifra de la cartera cuando la simulación mide poco: cuánto mide y cuánto hace falta. */
export const motivoPorPocoPeso = (pesoPct: number): string => `La simulación mide el ${pesoLegible(pesoPct)} del peso, y ${HACE_FALTA}.`;

/** Por qué no hay cifra cuando el servidor dice que con estos datos no se puede simular: no mide nada. */
export const MOTIVO_SIN_SERIE = `Con los datos de hoy, la simulación no mide ninguna posición, y ${HACE_FALTA}. Se queda fuera toda la cartera.`;

/** Lo mismo, y qué se queda fuera: las palabras de «Rentabilidad y riesgo». */
export const motivoPorPocoPesoYFuera = (pesoPct: number, fuera: readonly FueraDeLaMedida[]): string =>
  [motivoPorPocoPeso(pesoPct), loQueQuedaFuera(fuera)].filter(Boolean).join(" ");

/** Lo que cabe bajo las cifras sin apretar una hoja: es el mismo tope que la frase de `parteMedida`. */
const NOMBRES_QUE_CABEN_EN_EL_PAPEL = 3;
const CARACTERES_QUE_CABEN_EN_EL_PAPEL = 330;

/**
 * El mismo motivo en el papel, donde una hoja no se estira: con más de tres nombres, o muy largos, cuenta cuántas posiciones
 * son y cuánto pesan, y dice dónde se detallan. `escribirPeso`: como escribe el peso el documento que lo imprime, para que la misma cifra
 * no salga «40 %» arriba y «40,0 %» abajo (decisión 80).
 */
export function motivoPorPocoPesoEnElPapel(pesoPct: number, fuera: readonly FueraDeLaMedida[], dondeSeDetallan: string, escribirPeso: (pesoPct: number) => string = pesoLegible): string {
  const mide = `La simulación mide el ${escribirPeso(pesoPct)} del peso, y ${HACE_FALTA}.`;
  const nombres = fuera.map((item) => (item.pesoPct === null ? item.nombre : `${item.nombre} (${escribirPeso(item.pesoPct)})`));
  const entero = fuera.length === 0 ? mide : `${mide} Se ${fuera.length === 1 ? "queda" : "quedan"} fuera: ${nombres.join(", ")}.`;
  if (fuera.length <= NOMBRES_QUE_CABEN_EN_EL_PAPEL && entero.length <= CARACTERES_QUE_CABEN_EN_EL_PAPEL) return entero;
  return `${mide} Se quedan fuera ${fuera.length} posiciones (${escribirPeso(100 - pesoPct)} del peso), ${dondeSeDetallan}.`;
}

const SIN_RESULTADO = "Simulación con los pesos de hoy · sin resultado";

export interface EntradaDeLaTira {
  /** La simulación del periodo elegido; `null` si aún no ha llegado o no se ha podido hacer. */
  horizonte: PortfolioHorizon | null | undefined;
  fuera: readonly FueraDeLaMedida[];
  midiendo: boolean;
  /** Ha fallado al calcularla: reintentándola puede volver. */
  medicionFallida?: boolean;
  /** Los datos no dan para simular: el servidor lo ha dicho, y reintentar no lo arregla. */
  sinSerie?: boolean;
  /** La cartera pasa de un tope del cálculo: la frase de `limiteDelCalculo`, que dice el límite y cuántas tiene. */
  limite?: string | null;
  /** Alguna posición pesa. Con todos los pesos a 0 no se llega a pedir la simulación. */
  hayPeso: boolean;
  /** Los años del periodo elegido: mientras se mide, la simulación aún no los ha dicho. */
  anos: number;
  unaSolaAccion?: boolean;
  /** Dentro de lo medido no hay ningún fondo: no hay gastos de los fondos que decir. */
  sinFondos?: boolean;
}

export type LecturaDeLaTira =
  | { estado: "medida"; procedencia: string; sello: string; cifras: CifraDeLaTira[]; nota: string; /** La nota, para escribirla detrás de la procedencia sin repetirla. */ notaTrasLaProcedencia: string }
  | { estado: "midiendo"; procedencia: string; cifras: CifraDeLaTira[] }
  | { estado: "falta"; procedencia: string; motivo: string };

/**
 * Lo que dice «Rentabilidad y riesgo» en Análisis. Decisión 36 de Óscar (05-11-2026): sin serie que cubra al menos el 80 %
 * del peso no hay cifra de cartera, ninguna. Por debajo, también con 0 %, «Falta el dato» y su motivo: cuánto mide la
 * simulación y qué se queda fuera. Mientras se mide, «Midiendo…». Las palabras son las mismas para el asesor y para el cliente.
 *
 * Hasta aquí esa casilla enseñaba una suma ponderada de las cifras de cada activo, rotulada «Rentabilidad ponderada» y
 * «Volatilidad estimada». Una media de volatilidades no es el riesgo de una cartera, porque ignora las correlaciones, y una
 * media de caídas no es una caída de cartera: cada activo cae cuando cae.
 */
export function leerLaTira(entrada: EntradaDeLaTira): LecturaDeLaTira {
  const { horizonte, fuera, midiendo, medicionFallida, sinSerie, hayPeso, anos, unaSolaAccion, sinFondos } = entrada;
  const medido = riesgoMedidoDe(horizonte);
  if (medido && horizonte) {
    return {
      estado: "medida",
      procedencia: procedenciaDeLaMedida(horizonte, fuera),
      sello: selloDeLaMedida(horizonte),
      cifras: cifrasMedidas(medido, {
        anos: horizonte.years,
        ampliado: (horizonte.extensions ?? []).length > 0,
        tipoSinRiesgo: horizonte.backtest.metrics.rf_rate,
        unaSolaAccion
      }),
      nota: `${notaDeLaSimulacion(horizonte, { sinFondos })} ${NOTA_CON_MEDIDA}`,
      notaTrasLaProcedencia: metodoTrasLaProcedencia({ sinFondos })
    };
  }
  if (horizonte) {
    const peso = horizonte.coverageWeightPercent;
    /* Lo que se queda fuera lo dice el motivo, justo debajo: no se repite en la línea de arriba. */
    const procedencia = procedenciaDeLaMedida(horizonte, []);
    return hayCifraDeCartera(peso)
      ? { estado: "falta", procedencia, motivo: `La simulación mide el ${pesoLegible(peso)} del peso, pero no ha podido calcular todas sus cifras.` }
      : {
          estado: "falta",
          procedencia,
          motivo: motivoPorPocoPesoYFuera(peso, fuera)
        };
  }
  if (midiendo) {
    return { estado: "midiendo", procedencia: "Simulación con los pesos de hoy · midiendo…", cifras: cifrasMidiendo(anos, { unaSolaAccion }) };
  }
  if (!hayPeso) return { estado: "falta", procedencia: SIN_RESULTADO, motivo: "Ninguna posición tiene peso: sin pesos no hay cartera que simular." };
  if (sinSerie) {
    return { estado: "falta", procedencia: SIN_RESULTADO, motivo: MOTIVO_SIN_SERIE };
  }
  if (entrada.limite) {
    return { estado: "falta", procedencia: SIN_RESULTADO, motivo: entrada.limite };
  }
  return {
    estado: "falta",
    procedencia: SIN_RESULTADO,
    motivo: medicionFallida
      ? "La simulación ha fallado al calcularse, no por los datos: se puede reintentar. Sin ella no hay cifra de la cartera."
      : "No se ha podido simular la cartera, y sin simulación no hay cifra de la cartera."
  };
}

/**
 * Por qué no hay cifra de la cartera en esta simulación, o null si la hay: lo que escribe «Rentabilidad y riesgo», leído por el papel
 * (decisión 59). Un solo sitio para el 80 % y para las palabras: el corte es el de `leerLaTira`, y también dice «Falta el dato» si la
 * simulación llega al 80 % y no da una de sus cifras, o si no hay simulación.
 */
export function motivoSinCifraDeCartera(
  horizonte: PortfolioHorizon | null | undefined,
  fuera: readonly FueraDeLaMedida[],
  opciones: { hayPeso?: boolean; dondeSeDetallan?: string; escribirPeso?: (pesoPct: number) => string } = {}
): string | null {
  const lectura = leerLaTira({ horizonte, fuera, midiendo: false, hayPeso: opciones.hayPeso ?? true, anos: horizonte?.years ?? 3 });
  if (lectura.estado !== "falta") return null;
  return horizonte && !hayCifraDeCartera(horizonte.coverageWeightPercent)
    ? motivoPorPocoPesoEnElPapel(horizonte.coverageWeightPercent, fuera, opciones.dondeSeDetallan ?? "detalladas en el anexo", opciones.escribirPeso)
    : lectura.motivo;
}

/**
 * Lo que «Análisis IA» puede saber del riesgo de la cartera: lo que mide la simulación, o que no está medido. Un modelo lee
 * lo que se le da como un dato de la cartera y lo repite: la suma ponderada que se le mandaba salía de su boca como «la
 * volatilidad de la cartera» (decisión 36). El Sharpe de una sola acción tampoco se le da (§9 del método).
 */
export function riesgoParaElAnalisisIA(
  horizonte: PortfolioHorizon | null | undefined,
  opciones: { unaSolaAccion?: boolean } = {}
): Record<string, unknown> {
  const medido = riesgoMedidoDe(horizonte);
  if (medido && horizonte) {
    return {
      riesgo_de_la_cartera: {
        origen: `simulación con los pesos de hoy, sin reequilibrar${conTramosEstimados(horizonte) ? "; en parte estimada: incluye tramos anteriores al lanzamiento de alguna posición, reconstruidos desde una referencia" : ""}`,
        anos: horizonte.years,
        peso_medido_pct: medido.pesoPct,
        rentabilidad_anualizada: medido.cagr,
        volatilidad: medido.volatility,
        ...(opciones.unaSolaAccion ? {} : { sharpe: medido.sharpe }),
        caida_maxima: medido.maxDrawdown
      }
    };
  }
  return {
    riesgo_de_la_cartera: horizonte ? `Sin medir. ${motivoPorPocoPeso(horizonte.coverageWeightPercent)}` : "Sin medir: no hay simulación de la cartera."
  };
}

/** Cuántas posiciones tienen avisos o se quedan fuera. Lo que escribe el núcleo también lo lee el papel: se cuenta aquí. */
export function recuentoEnPantalla(
  posiciones: readonly BdbPortfolioReportPosition[],
  fuera: readonly FueraDeLaMedida[]
): { conAvisos: number; completas: number; conMetricas: number } {
  const fueraDe = new Set(fuera.map((item) => item.assetId));
  const invertibles = posiciones.filter((posicion) => posicion.is_investable);
  const dentro = invertibles.filter((posicion) => !fueraDe.has(posicion.asset_id));
  const tieneAvisos = ({ data_quality_summary: resumen, quality_flags: marcas }: BdbPortfolioReportPosition) =>
    marcas.some((marca) => marca !== "MOCK_DATA") ||
    (typeof resumen === "object" && resumen !== null ? resumen.warnings_count > 0 : /parcial|aviso/i.test(resumen ?? ""));
  return {
    conAvisos: invertibles.filter((posicion) => fueraDe.has(posicion.asset_id) || tieneAvisos(posicion)).length,
    completas: dentro.filter((posicion) => posicion.coverage_status === "COMPLETE").length,
    conMetricas: dentro.filter((posicion) => posicion.performance_preview?.available === true).length
  };
}
