import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../types/bdbAssets";
import { isInvestableAsset } from "./assetMapping";
import { esAccion } from "./esAccion";
import { computeEquityRegionAllocation } from "./equityRegions";
import { CATEGORIA_DE_UNA_ACCION, categoriaLegible, NO_DECLARADO } from "./etiquetasDeReparto";
import { textoEnPantalla } from "./glosarioDePantalla";
import { esUnaSolaAccion, fueraDeLaMedida, hayCifraDeCartera, idsConPeso, motivoPorPocoPesoEnElPapel } from "./medidaDeLaCartera";
import {
  comparisonAllocations,
  comparisonCoverage,
  comparisonPositions,
  notaDeAmpliacionLegible,
  type CampoDeLaFicha,
  type ComparisonHistory,
  type ComparisonPeriod,
  type ComparisonResult
} from "./portfolioComparison";
import { fraseDeLaParteMedida, motivoParaElCliente, pesoEnElPapel, type ParteMedida } from "./parteMedida";
import { assetPmsShares } from "./portfolio";
import { calculatePortfolioCosts } from "./portfolioCosts";
import { comparisonPositionRows } from "./portfolioComparisonReport";
import { CATEGORIA_DE_LAS_ACCIONES, categoriaDeUnReparto, fraseDeLoQueNoEntra, FUERA_DEL_CATALOGO, FUERA_DEL_REPARTO } from "./repartoDelPapel";
import { notaDeDatosHasta, posicionesParadas } from "./serieParada";
import { tipoDeRespaldo } from "./tipoDeRespaldo";
import { textoDeAusencia } from "./textoDeAusencia";

/**
 * Lo que se le da al PDF de la comparativa de carteras, en un solo sitio.
 *
 * Tiene dos puertas: Comparar carteras, donde ya se ha calculado lo que se ve, e Informes, donde se calcula
 * al pedirlo (decisión 25). Si cada una montara su entrada, un día el mismo documento saldría distinto
 * según por dónde se pida. Aquí no hay ningún cálculo nuevo: es lo que hacía Comparar carteras, movido.
 */

export interface ComparativaCargada {
  period: ComparisonPeriod;
  a: ComparisonHistory;
  b: ComparisonHistory;
  result: ComparisonResult;
}

type Cartera = Pick<BdbSavedLocalPortfolio, "name" | "positions" | "total_capital">;

/**
 * Si lo que mide la simulación de esta cartera es una sola acción, su Sharpe es el de la acción, y eso no se enseña (§9 del método):
 * la regla de la tira de Análisis, y leída igual, sobre lo que de verdad entra en la serie. Con una acción dentro de una cartera con
 * fondos ya no es el Sharpe de una acción, y sale. Lo leen Comparar carteras y el papel: los dos dicen lo mismo de la misma cartera.
 */
export function sharpeDeUnaSolaAccion(
  historia: ComparisonHistory | null | undefined,
  posiciones: readonly BdbManualPortfolioPosition[],
  assets: readonly Pick<BdbAssetDetail, "asset_id" | "instrument_type">[]
): boolean {
  return esUnaSolaAccion(historia ? historia.backtest.asset_ids : idsConPeso(posiciones), assets);
}

/**
 * Por qué esta cartera no da cifras en la comparativa, o null si las da (decisión 59). El corte y las palabras son los de «Rentabilidad y riesgo»
 * en Análisis: la misma función, cartera por cartera. Una diferencia con una cartera que no tiene cifra tampoco la tiene.
 */
export function motivoSinCifraEnLaComparativa(
  historia: ComparisonHistory,
  posiciones: readonly BdbManualPortfolioPosition[],
  assets: readonly Pick<BdbAssetDetail, "asset_id" | "display_name">[]
): string | null {
  const { weight } = comparisonCoverage(historia, posiciones);
  return hayCifraDeCartera(weight) ? null : motivoPorPocoPesoEnElPapel(weight, fueraDeLaMedida(historia, comparisonPositions(posiciones), assets), "detalladas en el anexo", pesoEnElPapel);
}

/**
 * Si ninguna de las dos imprime el Sharpe, las notas no lo explican como si saliera. Lo que dicen de la volatilidad y del mapa sigue
 * siendo cierto y se queda; lo que solo hablaba del Sharpe, se va. Las frases son las de `alignPortfolioComparison`, y
 * `tests/entradaDeComparativa.test.ts` falla si aparece otra que hable de él.
 */
export function notaSinElSharpe(nota: string): string | null {
  if (nota.startsWith("La tasa sin riesgo utiliza")) return null;
  const limpia = nota
    .replace(/\s*Falta el Sharpe: [^.]*\./, "")
    .replace("La volatilidad, el Sharpe y el mapa quedan sin dato", "La volatilidad y el mapa quedan sin dato")
    .replace("la volatilidad y el Sharpe se calculan solo", "la volatilidad se calcula solo")
    .trim();
  return limpia || null;
}

const posicionesEnPlural = (n: number) => `${n} ${n === 1 ? "posición" : "posiciones"}`;

/**
 * Lo que se mide de una cartera, con las palabras del informe de cliente (`fraseDeLaParteMedida`): «Mide el 88,0 % de la cartera (7 de 8
 * posiciones); queda fuera X (12,0 %), por …». Con todo medido, la misma frase sin lo que queda fuera. Con más de tres fuera, o nombres
 * muy largos, las cuenta y manda al anexo, que en este papel va al final de la hoja de método.
 */
export function loQueSeMideDe(historia: ComparisonHistory, posiciones: Cartera["positions"], nombreDe: (id: string) => string): string {
  const cobertura = comparisonCoverage(historia, posiciones);
  const pesos = new Map(comparisonPositions(posiciones).map((p) => [p.asset_id, p.weight_percent]));
  const parte: ParteMedida = {
    requested: cobertura.total,
    included: cobertura.included,
    weightPercent: cobertura.weight,
    excluded: cobertura.fuera.map(({ assetId, reason }) => ({ assetId, reason, weightPercent: pesos.get(assetId) ?? 0, reasonLabel: motivoParaElCliente(reason) }))
  };
  return fraseDeLaParteMedida(parte, nombreDe) ?? `Mide el ${pesoEnElPapel(cobertura.weight)} de la cartera (${cobertura.included} de ${posicionesEnPlural(cobertura.total)}).`;
}

/**
 * La renta variable de una cartera por región, mirando dentro de los fondos: la misma cuenta que el informe de cliente y la radiografía
 * (`computeEquityRegionAllocation`), y cuánto pesa esa renta variable en la cartera, con el peso canónico de cada activo (`assetPmsShares`).
 * Lo que no tiene ficha cuenta en el total y no en la renta variable: no se sabe qué es.
 */
export function rentaVariablePorRegionDe(posiciones: Cartera["positions"], assets: readonly BdbAssetDetail[]) {
  const porId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const conPeso = posiciones.filter((p) => Number.isFinite(p.weight_percent) && p.weight_percent > 0);
  const total = conPeso.reduce((suma, p) => suma + p.weight_percent, 0);
  const deRentaVariable = conPeso.reduce((suma, p) => { const asset = porId.get(p.asset_id); return suma + (asset ? p.weight_percent * assetPmsShares(asset).shares.equity : 0); }, 0);
  const reparto = computeEquityRegionAllocation(conPeso, [...assets]);
  return { filas: reparto.rows, pesoPct: total > 0 ? (deRentaVariable / total) * 100 : 0 };
}

/**
 * Las notas de cobertura y método: las mismas en pantalla y en el anexo del PDF, salvo el motivo de lo que queda fuera. Este papel se entrega, y va con
 * la frase de cliente del informe de cliente; la pantalla es del asesor, y sigue con la suya (decisiones 19 y 80).
 */
export function notasDeLaComparativa(a: Cartera, b: Cartera, cargada: ComparativaCargada, assets: readonly Pick<BdbAssetDetail, "asset_id" | "display_name">[] = [], opciones: { paraElPapel?: boolean } = {}): string[] {
  const nombreDe = (id: string, posiciones: Cartera["positions"]) =>
    assets.find((asset) => asset.asset_id === id)?.display_name || posiciones.find((posicion) => posicion.asset_id === id)?.label || id;
  return [
    ...cargada.result.notes,
    ...[
      { name: a.name, positions: a.positions, data: cargada.a, coverage: comparisonCoverage(cargada.a, a.positions) },
      { name: b.name, positions: b.positions, data: cargada.b, coverage: comparisonCoverage(cargada.b, b.positions) }
    ].flatMap(({ name, data, coverage, positions }) => [
      /* En papel, con las palabras del informe de cliente, y no «peso representado» ni «se normalizan» (10-11-2026). */
      opciones.paraElPapel
        ? `${name}: Mide el ${pesoEnElPapel(coverage.weight)} de la cartera (${coverage.included} de ${posicionesEnPlural(coverage.total)}).${coverage.fuera.length ? " Los pesos de las posiciones medidas se llevan al 100 % para calcular su serie." : ""}`
        : `${name}: ${coverage.note}`,
      ...(opciones.paraElPapel
        ? coverage.fuera.map(({ assetId, reason }) => `${name} · Fuera del cálculo: ${nombreDe(assetId, positions)}, por ${motivoParaElCliente(reason)}.`)
        : coverage.excluded.map((text) => `${name} · Fuera del cálculo: ${text}.`)),
      ...data.extensionNotes.map((text) => `${name} · ${notaDeAmpliacionLegible(text, (id) => nombreDe(id, positions))}`)
    ])
  ];
}

/**
 * Cómo se llama en el papel lo que la ficha de un activo no trae (decisión 66). «No declarado» solo donde es cierto: en la base nueva
 * ninguna acción trae categoría (305 de 305), y no es que no la declare, es que no tiene categoría de fondo. A una acción sin región y a
 * una posición sin ficha no les falta declarar nada: el dato no ha llegado.
 */
export function clasificacionQueFalta(asset: Pick<BdbAssetDetail, "instrument_type"> | undefined, campo: CampoDeLaFicha): string {
  if (!asset) return textoDeAusencia("falta");
  if (!esAccion(asset.instrument_type)) return NO_DECLARADO;
  return campo === "category" ? CATEGORIA_DE_LAS_ACCIONES : textoDeAusencia("falta");
}

/** Lo que no entra en los repartos del papel: lo que no se puede proponer y lo que la fuente no conoce. La misma cuenta que `repartoDeLaCartera` (decisión 85). */
const noEntraEnElReparto = (asset: BdbAssetDetail | undefined) => !asset || !isInvestableAsset(asset);

/** La frase de una cartera: con su nombre y su peso, porque en la fila solo cabe la suma. Null si entra todo. */
function loQueNoEntraDe(cartera: Cartera, assets: readonly BdbAssetDetail[]): string | null {
  const fuera = comparisonPositions(cartera.positions).flatMap((posicion) => {
    const asset = assets.find((ficha) => ficha.asset_id === posicion.asset_id);
    return noEntraEnElReparto(asset)
      ? [{ assetId: posicion.asset_id, nombre: asset?.display_name || cartera.positions.find((p) => p.asset_id === posicion.asset_id)?.label || posicion.asset_id, pesoPct: posicion.weight_percent }]
      : [];
  });
  const pesoPct = fuera.reduce((suma, posicion) => suma + posicion.pesoPct, 0);
  return fraseDeLoQueNoEntra({ parteInvertible: 1 - pesoPct / 100, posiciones: fuera, peso: pesoPct, pesoPct });
}

export function entradaDeLaComparativa({ a, b, cargada, assets, identidad, seriesParadas }: {
  a: Cartera;
  b: Cartera;
  cargada: ComparativaCargada;
  assets: readonly BdbAssetDetail[];
  /** El cliente y quien lo elabora, si la puerta los tiene (Informes); desde Comparar carteras no llegan, y la portada no los pinta. */
  identidad?: { cliente?: string; responsable?: { name?: string; email?: string } };
  /** Las posiciones cuyos datos se quedaron en una fecha, con esa fecha (decisión B-78). Va entre las notas generales de la base de cálculo. */
  seriesParadas?: ReadonlyMap<string, string>;
}) {
  const { result } = cargada;
  const periodLabel = result.periodLabel;
  const sharpeNoAplica = { a: sharpeDeUnaSolaAccion(cargada.a, a.positions, assets), b: sharpeDeUnaSolaAccion(cargada.b, b.positions, assets) };
  const notas = notasDeLaComparativa(a, b, cargada, assets, { paraElPapel: true });
  const deUnaCartera = (nota: string) => [a.name, b.name].some((nombre) => nota.startsWith(`${nombre}: `) || nota.startsWith(`${nombre} · `));
  const fichaDe = (id: string) => assets.find((asset) => asset.asset_id === id);
  /* Lo que no entra lleva su propia fila, y no se cuenta por su clase: la misma cifra que en la hoja 5 del interno (decisión 85). */
  const filaDeFuera = (asset: BdbAssetDetail | undefined) => (noEntraEnElReparto(asset) ? FUERA_DEL_REPARTO : null);
  const nombreEn = (cartera: Cartera) => (id: string) => fichaDe(id)?.display_name || cartera.positions.find((p) => p.asset_id === id)?.label || id;
  const metricas = (cartera: Cartera, cifras: ComparisonResult["metricsA"]) => ({
    posiciones: cartera.positions.length,
    ret: cifras.cagr ?? undefined,
    vol: cifras.volatility ?? undefined,
    sharpe: cifras.sharpe ?? undefined,
    maxdd: cifras.maxDrawdown
  });
  const idsDeLasDos = [...new Set([...a.positions, ...b.positions].map((p) => p.asset_id))];
  const notaDeLasParadas = notaDeDatosHasta(posicionesParadas(idsDeLasDos, seriesParadas ?? new Map<string, string>(), (id) => id, (id) => nombreEn(a.positions.some((p) => p.asset_id === id) ? a : b)(id)));
  return {
    nameA: a.name,
    nameB: b.name,
    a: metricas(a, result.metricsA),
    b: metricas(b, result.metricsB),
    periodLabel,
    /* «Caída máxima», la palabra del sistema, en la pantalla y en el papel (INF-18). */
    maxddLabel: `Caída máxima · ${periodLabel}`,
    /* Las notas generales dicen «tipo sin riesgo», como el resto del documento (decisión 80). Las de cada cartera siguen con «peso representado», que es la palabra de este papel. */
    methodology: [
      ...(sharpeNoAplica.a && sharpeNoAplica.b ? notas.flatMap((nota) => notaSinElSharpe(nota) ?? []) : notas).map((nota) => (deUnaCartera(nota) ? nota : textoEnPantalla(nota))),
      ...(notaDeLasParadas ? [notaDeLasParadas] : [])
    ],
    sharpeNoAplica,
    sinCifra: { a: motivoSinCifraEnLaComparativa(cargada.a, a.positions, assets), b: motivoSinCifraEnLaComparativa(cargada.b, b.positions, assets) },
    /* El de cada una, tal como se guardó: una cartera sin capital no toma prestado el de la otra. */
    capitalA: a.total_capital,
    capitalB: b.total_capital,
    history: { a: result.seriesA, b: result.seriesB, rangeLabel: result.rangeLabel },
    riskFree: result.riskFree,
    coverage: { a: comparisonCoverage(cargada.a, a.positions), b: comparisonCoverage(cargada.b, b.positions) },
    extendedHistory: cargada.a.extensionNotes.length > 0 || cargada.b.extensionNotes.length > 0,
    /* Las palabras de la pantalla: «accion» y las regiones en inglés son códigos de la base, no lo que se le entrega a un cliente. La línea de una acción dice lo que
       es, también en la base nueva, donde no trae categoría y saldría por su clase. La divisa solo la lee un reparto: el de la hoja de diversificación. */
    positions: comparisonPositionRows(a.positions, b.positions, [...assets], FUERA_DEL_CATALOGO).map((fila) => {
      const ficha = fichaDe(fila.id);
      return { ...fila, category: ficha && esAccion(ficha.instrument_type) ? CATEGORIA_DE_UNA_ACCION : categoriaLegible(fila.category) ?? fila.category, currency: filaDeFuera(ficha) ?? fila.currency };
    }),
    categoryRows: comparisonAllocations(a.positions, b.positions, [...assets], "category", clasificacionQueFalta, filaDeFuera).map((fila) => ({ ...fila, label: categoriaDeUnReparto(categoriaLegible(fila.label) ?? fila.label) })),
    /* La renta variable por región mirando dentro de los fondos, como el informe de cliente, y no la región de la etiqueta de la ficha (10-11-2026). */
    rentaVariable: { a: rentaVariablePorRegionDe(a.positions, assets), b: rentaVariablePorRegionDe(b.positions, assets) },
    /* El coste corriente de la ficha, con la cuenta del informe de costes y del informe de cliente, cartera por cartera. */
    costes: { a: calculatePortfolioCosts(a.positions, [...assets], a.total_capital ?? 0), b: calculatePortfolioCosts(b.positions, [...assets], b.total_capital ?? 0) },
    hayFondos: [...a.positions, ...b.positions].some((p) => p.weight_percent > 0 && !esAccion(fichaDe(p.asset_id)?.instrument_type)),
    queSeMide: { a: loQueSeMideDe(cargada.a, a.positions, nombreEn(a)), b: loQueSeMideDe(cargada.b, b.positions, nombreEn(b)) },
    clientName: identidad?.cliente?.trim() || undefined,
    banker: identidad?.responsable,
    classRows: comparisonAllocations(a.positions, b.positions, [...assets], "economic_asset_class", clasificacionQueFalta, filaDeFuera),
    fueraDelReparto: { a: loQueNoEntraDe(a, assets), b: loQueNoEntraDe(b, assets) },
    /* Con uno de respaldo y otro leído no hay tipo común, y el Sharpe de las dos falta: la marca es de la cifra que se imprime (decisión 89). */
    tipoDeRespaldo: result.riskFree === null ? null : tipoDeRespaldo(cargada.a.backtest) ?? tipoDeRespaldo(cargada.b.backtest)
  };
}
