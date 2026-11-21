import type { BdbAssetDetail } from "../types/bdbAssets";
import type { FrontierPointView, FrontierViewModel, PortfolioFrontierMeasure } from "../types/portfolioFrontier";
import { oFalta, peso, porcentaje, ratio, rentabilidad } from "./formato";
import { isPartialFrontier } from "./frontierPortfolioCoverage";
import { ventanaEnPalabras } from "./glosarioDePantalla";
import { topeDelModelo } from "./internalPortfolioReport";
import { esUnaSolaAccion } from "./medidaDeLaCartera";

/**
 * De dónde salen las carteras de una propuesta de Optimizar. Decisiones 40 y 61 de Óscar (05-11-2026): todos los objetivos salen del
 * motor regularizado, y lo que en Simular se llama igual es la misma cartera.
 *
 * El método lo declara el servidor en `methodology.optimizer`: `CLA` y `QP` son el motor regularizado. Si no lo declara, no se afirma nada.
 */
const OPTIMIZADORES_DEL_MOTOR = new Set(["CLA", "QP"]);

/** Cómo se llama la cartera de ese objetivo en la tarjeta, en el gráfico y en la revisión. */
export const RENTABILIDAD_OBJETIVO = "Rentabilidad objetivo";
export const MAXIMO_SHARPE = "Máx. Sharpe";
/* DIS-14: un solo nombre por objetivo en toda la sección, el que ya lleva el papel: «Máx. Sharpe», «Mín. volatilidad». */
export const MIN_VOLATILIDAD = "Mín. volatilidad";
/** La cartera del objetivo «Posición en la frontera»: así la llaman su tarjeta, el gráfico y la revisión. */
export const TU_OBJETIVO = "Tu objetivo";

const esDelMotor = (model: Pick<FrontierViewModel, "methodologyV2">) => OPTIMIZADORES_DEL_MOTOR.has(model.methodologyV2?.optimizer ?? "");

const topeEscrito = (model: FrontierViewModel) => {
  const tope = topeDelModelo({ frontier: model });
  return tope === null ? "tope por posición no informado" : `tope del ${oFalta(peso(tope))} por posición`;
};

type ActivoConClase = Pick<BdbAssetDetail, "asset_id" | "economic_asset_class">;

/**
 * Decisión 95: el modelo encoge lo que espera de cada activo hacia la media de los de la propia cartera, y eso mueve Máximo Sharpe hacia la renta
 * fija. Solo se dice donde es cierto, y se decide con la clase de los activos: hace falta renta fija y bolsa a la vez, porque en una cartera solo de
 * una de las dos no hay nada que acercar a nada, y más de tres activos, porque con tres o menos el motor no encoge (`estimate_returns`). Un mixto o
 * un monetario no cuentan: son otra clase y la frase no habla de ellos, y callarla es más barato que afirmarla de más. Dice «suele» porque no
 * siempre: a 5 años, con la muestra, sale la misma cartera con encogimiento y sin él. Medido en `DECISIONES_AUDITORIA_2026-11-04.md`, decisión 95.
 */
export function fraseDelEncogimiento(model: Pick<FrontierViewModel, "maxSharpe"> | null | undefined, assets: readonly ActivoConClase[]): string | null {
  /* Los pesos completos llevan todos los activos del cálculo, también los que se quedan a cero. */
  const medidos = Object.keys(model?.maxSharpe.pesosCompletos ?? {});
  if (medidos.length <= 3) return null;
  const clases = new Set(medidos.map((id) => assets.find((asset) => asset.asset_id === id)?.economic_asset_class));
  return clases.has("EQUITY") && clases.has("FIXED_INCOME")
    ? "El modelo acerca lo que espera de la renta fija a lo que espera de la bolsa, y por eso esta cartera suele llevar más renta fija de lo que sugiere la serie."
    : null;
}

/**
 * Lo que hay que leer antes de aplicar una propuesta, escrito del dato. La misma frase que `notaDelMaximoSharpe`, la del informe
 * interno, sin lo medido: en Optimizar no hay serie, y eso lo enseña la Comparativa de Simular. La prueba impide que se separen. Con las
 * clases de los activos, también lo que hace el encogimiento: el informe interno lo añade aparte, detrás de su nota.
 */
export function notaDeLaPropuesta(model: FrontierViewModel, assets: readonly ActivoConClase[] = []): string | null {
  if (!esDelMotor(model)) return null;
  const base = `Máximo Sharpe del modelo: rentabilidades y covarianza regularizadas, ${topeEscrito(model)}. Medida luego con la serie real puede quedar por debajo de la cartera actual.`;
  const encogimiento = fraseDelEncogimiento(model, assets);
  return encogimiento ? `${base} ${encogimiento}` : base;
}

export interface LecturaDelObjetivo {
  /** Lo que se ha pedido, tal como lo devuelve el servidor: la media de la serie. */
  pedido: number;
  /** Lo que da esa cartera en el modelo: la cifra de la tarjeta, que no es lo pedido. */
  delModelo: number;
  /** La media de la serie de la cartera de menor riesgo, si el servidor la manda. Por debajo de ella se propone esa. */
  suelo: number | null;
  /** Lo pedido queda por debajo de la cartera de menor riesgo, y se propone esa. La misma cuenta que el servidor, sin redondear. */
  laDeMenorRiesgo: boolean;
  /** Lo que mide la serie. Si no se ha podido medir, `null`, y no se compara con nada. */
  medida: PortfolioFrontierMeasure | null;
  actual: PortfolioFrontierMeasure | null;
  frenteALoPedido: "por-debajo" | "lo-pedido" | "por-encima" | null;
}

/** Se compara lo que se lee, con dos decimales: un 8,00 % medido es lo que se ha pedido aunque le falte una milésima. */
const enCentesimasDePunto = (decimal: number) => Math.round(decimal * 10000);

/**
 * Decisiones 61 y 94: lo que se escribe es la media de la serie, y lo que mide la serie es una rentabilidad anualizada con los pesos derivando: otra
 * cifra, pero cercana. Con la muestra, un 8 % da un 8,82 % a 3 años y un 8,35 % a 5. La tarjeta da una tercera, la del modelo, con esa media encogida
 * hacia la de los demás activos: un 9,79 % a 3 años. Esto es lo que hay que comparar para no dar a entender que se cumple ni que algo no cuadra. Se
 * enseñan juntas y se dice si lo medido llega a lo pedido, que es una pregunta del asesor, pero no se restan.
 */
export function lecturaDelObjetivo(model: FrontierViewModel): LecturaDelObjetivo | null {
  const pedido = model.methodologyV2?.targetReturn;
  if (!model.targetReturn || typeof pedido !== "number") return null;
  const medida = model.medidaDelObjetivo?.propuesta ?? null;
  const delModelo = model.targetReturn.expectedReturn;
  const suelo = model.methodologyV2?.targetReturnFloor ?? null;
  const frente = medida === null ? null : Math.sign(enCentesimasDePunto(medida.cagr) - enCentesimasDePunto(pedido));
  return {
    pedido,
    delModelo,
    suelo,
    laDeMenorRiesgo: suelo !== null && pedido <= suelo,
    medida,
    actual: model.medidaDelObjetivo?.actual ?? null,
    frenteALoPedido: frente === null ? null : frente < 0 ? "por-debajo" : frente > 0 ? "por-encima" : "lo-pedido"
  };
}

const FRENTE_A_LO_PEDIDO = {
  "por-debajo": ", por debajo de lo que pides",
  "lo-pedido": ", lo que pides",
  "por-encima": ", por encima de lo que pides"
} as const;

type ActivoConTipo = Pick<BdbAssetDetail, "asset_id" | "instrument_type">;

const idsConPeso = (punto: FrontierPointView | undefined) =>
  Object.entries(punto?.pesosCompletos ?? {}).filter(([, peso]) => peso > 0).map(([id]) => id);

/** De cuál de las dos no se enseña el Sharpe, porque lo que se mide es una sola acción: «actual», «propuesta» o ninguna. */
export function sharpeQueNoAplica(model: FrontierViewModel, assets: readonly ActivoConTipo[]): "actual" | "propuesta" | null {
  if (esUnaSolaAccion(idsConPeso(model.current), assets)) return "actual";
  return esUnaSolaAccion(idsConPeso(model.targetReturn), assets) ? "propuesta" : null;
}

/** Lo mismo, en una frase: es lo que se lee en la revisión, donde no está la tabla. */
export function notaDeLaRentabilidadObjetivo(model: FrontierViewModel, assets: readonly ActivoConTipo[] = []): string | null {
  const lectura = lecturaDelObjetivo(model);
  if (!lectura) return null;
  const { pedido, delModelo, suelo, laDeMenorRiesgo, medida, actual, frenteALoPedido } = lectura;
  const metodo = esDelMotor(model) ? `, con covarianza regularizada y ${topeEscrito(model)}` : "";
  const mediaDeLaCartera = laDeMenorRiesgo && suelo !== null ? suelo : pedido;
  const queEs = laDeMenorRiesgo
    ? `Pides un ${oFalta(rentabilidad(pedido))}, y con tus límites la cartera de menor riesgo ya tiene una media de la serie del ${oFalta(rentabilidad(mediaDeLaCartera))}${metodo}: se propone esa.`
    : `El ${oFalta(rentabilidad(pedido))} que pides es la media de la serie${metodo}.`;
  /* La tarjeta dice otra cifra, y hay que decir por qué antes de que parezca que no cuadra. Si coinciden, porque con tres activos o menos el motor no
     encoge, no hay nada que aclarar. */
  const laDeLaTarjeta = esDelMotor(model) && enCentesimasDePunto(delModelo) !== enCentesimasDePunto(mediaDeLaCartera)
    ? ` El modelo le da un ${oFalta(rentabilidad(delModelo))}, porque acerca lo que espera de cada activo a la media de todos: es la cifra de la tarjeta, no lo que se pide.`
    : "";
  if (!medida || !frenteALoPedido) return `${queEs}${laDeLaTarjeta} La medida con la serie no está: falta el dato.`;
  const noAplica = sharpeQueNoAplica(model, assets);
  const riesgo = (cartera: PortfolioFrontierMeasure, suya: "actual" | "propuesta") =>
    noAplica === suya
      ? `una volatilidad del ${oFalta(porcentaje(cartera.volatility))}`
      : `una volatilidad del ${oFalta(porcentaje(cartera.volatility))} y un Sharpe de ${oFalta(ratio(cartera.sharpe))}`;
  const conActual = actual
    ? ` ${isPartialFrontier(model) ? "La parte incluida de la cartera actual" : "La cartera actual"}, medida igual, da un ${oFalta(rentabilidad(actual.cagr))} con ${riesgo(actual, "actual")}.`
    : "";
  /* Un tramo estimado entra en la medida, igual que en la simulación: entonces no es toda ella serie real. */
  const conLaSerie = model.extensions?.length ? "con la serie, con tramos estimados," : "con la serie real";
  return `${queEs} Medida ${conLaSerie} a ${ventanaEnPalabras(model.window)}, con los pesos fijos desde el primer día, esta cartera da un ${oFalta(rentabilidad(medida.cagr))} anualizado${FRENTE_A_LO_PEDIDO[frenteALoPedido]}, con ${riesgo(medida, "propuesta")}.${laDeLaTarjeta}${conActual} Es retrospectiva: los pesos se eligen con este mismo periodo, y no dice lo que rendirá.`;
}

/**
 * De qué sale cada una de las otras dos carteras del modelo que se pueden revisar, leído en `functions_python/optimization/robust_engine.py`.
 * A la de mínima volatilidad la deciden la covarianza y las restricciones activas —el mínimo y el tope por activo, los candados, los límites por
 * grupo y, si se pide, la rotación máxima—, no lo que se espera de cada activo (`min_volatility`). La posición en la frontera sí depende de ello:
 * es un punto de la curva, y la curva es la que dan las medias de la serie y la covarianza. El encogimiento de las rentabilidades es afín y no
 * mueve esa curva (§13 del método, decisiones A-94 y A-95): cambia la rentabilidad que enseña la tarjeta y casi nunca los pesos —los mismos en 67
 * de 80 casos medidos, según la §13—. Por eso la nota dice «las medias de la serie» y no «rentabilidades regularizadas», como la de Máximo Sharpe,
 * a la que el encogimiento sí mueve; con tres activos o menos, además, no sería cierto, porque el motor no las encoge. Callar las medias dejaría
 * esta nota igual que la de mínima volatilidad, y daría a entender que la cartera no depende de lo que rindió cada activo, que es lo contrario.
 * Las dos llevan el mismo tope por posición que Máximo Sharpe.
 */
const DE_QUE_SALE = new Map<string, string>([
  [MIN_VOLATILIDAD, "Mínima volatilidad del modelo: covarianza regularizada"],
  [TU_OBJETIVO, "Posición en la frontera del modelo: un punto de la curva que dan las medias de la serie y la covarianza regularizada"]
]);

/**
 * Lo que vale para cualquier cartera del modelo: la rentabilidad, la volatilidad y el Sharpe de su tarjeta y de su revisión son los del modelo, no
 * los que luego mide la serie (decisión 6.3, del 17-10-2026). Dice «de rentabilidad y riesgo» porque la revisión enseña además el coste corriente
 * medio, que no sale del modelo. Que pueda quedar por debajo de la cartera actual no se dice de estas dos carteras, porque con ellas no se ha
 * medido: se midió con Máximo Sharpe (decisión A-40), y la de «Rentabilidad objetivo» se mide en cada cálculo y lo dice su propia nota (A-94).
 */
const SUS_CIFRAS_SON_DEL_MODELO = "Sus cifras de rentabilidad y riesgo son las del modelo, no una medida con la serie real.";

/**
 * La nota de la cartera que se va a revisar: cada tarjeta, la suya. `origen` es el nombre con que la revisión la llama. Lo del encogimiento va solo
 * con la de Máximo Sharpe: Mínima volatilidad no depende de lo que se espera de cada activo, y «esta cartera» sería otra.
 *
 * Hasta el 20-11-2026, Mínima volatilidad y la posición en la frontera llevaban la nota de Máximo Sharpe, que empieza por su nombre y es otra cartera.
 * Ahora cada una dice de qué sale la suya, y de una cartera que no se sabe cuál es no se afirma nada.
 */
export function notaDeLaCartera(model: FrontierViewModel, origen: string | undefined, assets: readonly (ActivoConTipo & ActivoConClase)[] = []): string | null {
  if (origen === RENTABILIDAD_OBJETIVO) return notaDeLaRentabilidadObjetivo(model, assets);
  if (origen === MAXIMO_SHARPE) return notaDeLaPropuesta(model, assets);
  const deQueSale = origen === undefined ? undefined : DE_QUE_SALE.get(origen);
  return deQueSale && esDelMotor(model) ? `${deQueSale}, ${topeEscrito(model)}. ${SUS_CIFRAS_SON_DEL_MODELO}` : null;
}
