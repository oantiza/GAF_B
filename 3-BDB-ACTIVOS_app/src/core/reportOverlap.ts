import type { AssetDataSource } from "../types/assetDataSource";
import type { BdbAssetDetail, BdbAssetHoldings, BdbIssuerPortfolioOrigin, BdbPortfolioReportPosition } from "../types/bdbAssets";
import { PESO_MINIMO_PUBLICADO_PCT, pesoVistoDelFondo, type CarteraPublicada } from "./carteraPublicada";
import { esAccion } from "./esAccion";
import { cuantos, fecha, oFalta, peso } from "./formato";
import { calculateOverlap, pasaDeCien, sinComunes, situacionDeLaCartera, solapamientoEnUnaFrase, type SituacionDeLaCartera } from "./overlap";

export const REPORT_OVERLAP_LIMIT = 15;
export type OverlapPosition = Pick<BdbPortfolioReportPosition, "asset_id" | "display_name" | "weight_percent" | "instrument_type"> & {
  /** La réplica que da el proveedor (`product_profile.replication`), si llega. Nunca la del emisor (B-53). */
  replica?: string;
};
/**
 * `insufficient` tiene líneas, pero le falta más de la mitad de su cartera; `missing` no tiene ninguna; `failed` es que
 * no se pudo leer; `not_applicable`, una acción, que no tiene subyacentes; `synthetic`, un ETF que replica con una permuta (swap), cuya
 * cartera es ese contrato: no es que no publique, es que no hay títulos que medir.
 */
export type ReportOverlapStatus = "available" | "insufficient" | "missing" | "failed" | "not_applicable" | "synthetic";
export interface ReportOverlap {
  positions: Array<OverlapPosition & {
    asOfDate?: string;
    status: ReportOverlapStatus;
    /** Cuántas líneas y qué peso se han mirado. Sin líneas, no viene. */
    published?: CarteraPublicada | null;
    /** Lo mirado es la cartera completa del emisor de un ETF (B-79). El informe interno lo dice; el de cliente usa la cifra y no lo nombra. */
    issuerPortfolio?: BdbIssuerPortfolioOrigin;
  }>;
  values: Array<Array<number | null>>;
}

/**
 * Las posiciones del informe con la réplica de la ficha de cada una (`product_profile.replication`, del proveedor; nunca la del emisor,
 * B-53). Sin ella, un ETF sintético cuya cartera no llega a la base contaría como que no publica (12-11-2026). Lo que ya la trae se queda.
 */
export function conLaReplica<P extends OverlapPosition>(positions: readonly P[], assets: ReadonlyArray<Pick<BdbAssetDetail, "asset_id" | "product_profile">>): P[] {
  const replicas = new Map(assets.flatMap((asset) => (asset.product_profile?.replication ? [[asset.asset_id, asset.product_profile.replication] as const] : [])));
  return positions.map((position) => (position.replica || !replicas.has(position.asset_id) ? position : { ...position, replica: replicas.get(position.asset_id) }));
}

export function reportOverlapPositions(positions: OverlapPosition[]): OverlapPosition[] {
  return [...positions].filter((position) => Number.isFinite(position.weight_percent) && position.weight_percent > 0)
    .sort((a, b) => b.weight_percent - a.weight_percent || a.asset_id.localeCompare(b.asset_id))
    .slice(0, REPORT_OVERLAP_LIMIT);
}

const ESTADO_DE: Record<SituacionDeLaCartera, ReportOverlapStatus> = {
  medible: "available",
  insuficiente: "insufficient",
  sin_cartera: "missing",
  no_aplica: "not_applicable",
  sintetica: "synthetic"
};

/** El estado de una posición en la matriz, el mismo en pantalla y en papel: sin cartera porque no se pudo leer es `failed`, no `missing`. */
export function estadoDeLaPosicion(situacion: SituacionDeLaCartera, noSePudoLeer = false): ReportOverlapStatus {
  return situacion === "sin_cartera" && noSePudoLeer ? "failed" : ESTADO_DE[situacion];
}

export function buildReportOverlap(
  positions: OverlapPosition[],
  byId: Map<string, BdbAssetHoldings | null> = new Map(),
  failedIds = new Set<string>()
): ReportOverlap {
  const selected = reportOverlapPositions(positions);
  const carteras = selected.map((position) => {
    const item = byId.get(position.asset_id);
    /* Una respuesta cruzada, de otro activo, es como no haberla recibido. */
    const holdings = item?.asset_id === position.asset_id ? item : null;
    return { holdings, ...situacionDeLaCartera(position.instrument_type, holdings, position.replica) };
  });
  return {
    positions: selected.map((position, i) => {
      const { holdings, situacion, publicada } = carteras[i];
      return {
        ...position,
        asOfDate: holdings?.as_of_date,
        status: estadoDeLaPosicion(situacion, failedIds.has(position.asset_id)),
        published: publicada,
        ...(holdings?.issuer_portfolio ? { issuerPortfolio: holdings.issuer_portfolio } : {})
      };
    }),
    /* La regla de la mitad está en `calculateOverlap`. Una acción va aparte porque no la decide lo publicado: es que no
       tiene subyacentes, aunque una respuesta traiga líneas. */
    values: carteras.map((row) => carteras.map((column) =>
      row.situacion === "no_aplica" || column.situacion === "no_aplica" || row.situacion === "sintetica" || column.situacion === "sintetica"
        ? null
        : calculateOverlap(row.holdings, column.holdings).overlapPercent))
  };
}

/** Si la casilla de este par dice «No aplica»: basta con que uno de los dos sea una acción. Si no hay cifra y no aplica, «N/D». */
export function casillaNoAplica(model: Pick<ReportOverlap, "positions">, i: number, j: number): boolean {
  return model.positions[i]?.status === "not_applicable" || model.positions[j]?.status === "not_applicable";
}

/** Todas las posiciones de la matriz son acciones: no hay nada que medir. La misma frase en pantalla, en el interno y en el de cliente. */
export function fraseDeSoloAcciones(n: number): string {
  return n === 1
    ? "La única posición es una acción, que no tiene subyacentes: el solapamiento no aplica."
    : `Las ${n} mayores posiciones son acciones, que no tienen subyacentes: el solapamiento no aplica.`;
}

/** Lo que va delante de la lista de lo que no entra en la matriz, en pantalla y en el interno. */
export const FUERA_DE_LA_MATRIZ = "Fuera de la matriz:";

/** Lo que se dice de un ETF sintético en la lista de lo que queda fuera de la matriz, en pantalla y en los dos papeles. */
export function fraseDeUnFondoSintetico(nombre: string): string {
  return `${nombre}: replica su índice con una permuta (swap); su cartera es ese contrato, no las acciones, y no se puede medir lo que comparte.`;
}

/** Con más acciones que estas, la línea de las acciones las cuenta y no las nombra. */
const ACCIONES_NOMBRADAS = 3;

/** Lo que decide si una posición entra en la matriz: su estado y, si tiene líneas, cuánto pesan. */
export interface PosicionDeLaMatriz {
  display_name: string;
  status: ReportOverlapStatus;
  published?: Pick<CarteraPublicada, "pesoPct"> | null;
}

export interface CorteDeLaMatriz {
  /** Los índices de las posiciones que entran, en el orden recibido: las que publican al menos la mitad de su cartera. */
  dentro: number[];
  /** Con menos de dos que entren no hay matriz, y esta frase dice por qué. Si la hay, `null`. */
  sinMatriz: string | null;
  /** Lo que no entra y por qué: una línea por fondo y una para las acciones. Sin ningún fondo, vacía: ya lo dice `sinMatriz`. */
  fuera: string[];
}

/**
 * «el 42,3 %» de la cartera, como la tabla de lo mirado del interno. Solo hacia abajo en el borde: un fondo con menos de la mitad no puede
 * leerse «50,0 %». Lo que no llega a una décima, o suma en negativo, «menos del 0,1 %».
 */
function loQuePublica(pesoPct: number): string {
  const visto = pesoVistoDelFondo({ pesoPct });
  const redondeado = Math.round(visto * 10) / 10;
  const cifra = redondeado >= PESO_MINIMO_PUBLICADO_PCT ? Math.floor(visto * 10 + 1e-9) / 10 : redondeado;
  return cifra > 0 ? `el ${oFalta(peso(cifra / 100))}` : `menos del ${oFalta(peso(0.001))}`;
}

/**
 * Qué posiciones entran en la matriz de solapamiento y qué se dice de las demás (Óscar, 11-11-2026). La regla de la mitad no cambia, sigue en
 * `calculateOverlap`: lo que cambia es que un fondo que no se puede medir no llena su fila y su columna de «N/D», ni una acción de «No aplica».
 * Entra el fondo que publica al menos la mitad de su cartera; los demás van debajo, cada uno con su motivo, y las acciones en una línea.
 * No cambia ninguna cifra: los pares que se miden son los mismos, y la lectura sigue contando los que no.
 */
export function corteDeLaMatriz(posiciones: readonly PosicionDeLaMatriz[]): CorteDeLaMatriz {
  const n = posiciones.length;
  const dentro = posiciones.flatMap((posicion, i) => (posicion.status === "available" ? [i] : []));
  const acciones = posiciones.filter((posicion) => posicion.status === "not_applicable").map((posicion) => posicion.display_name);
  const fondos = n - acciones.length;
  if (fondos === 0) return { dentro, sinMatriz: n === 0 ? "Sin posiciones para calcular el solapamiento." : fraseDeSoloAcciones(n), fuera: [] };
  const fuera = posiciones.flatMap(({ display_name, status, published }) => {
    if (status === "insufficient") {
      return [published ? `${display_name}: publica ${loQuePublica(published.pesoPct)} de su cartera.` : `${display_name}: no publica al menos la mitad de su cartera.`];
    }
    if (status === "synthetic") return [fraseDeUnFondoSintetico(display_name)];
    if (status === "missing") return [`${display_name}: no publica su cartera.`];
    if (status === "failed") return [`${display_name}: no se ha podido leer su cartera.`];
    return [];
  });
  if (acciones.length === 1) fuera.push(`Acción en directo, que no tiene cartera propia: ${acciones[0]}.`);
  else if (acciones.length > ACCIONES_NOMBRADAS) fuera.push(`${acciones.length} acciones en directo, que no tienen cartera propia.`);
  else if (acciones.length > 1) fuera.push(`Acciones en directo, que no tienen cartera propia: ${enumerarNombres(acciones)}.`);
  const sinMatriz = dentro.length >= 2
    ? null
    : fondos === 1
      ? "No hay matriz de solapamiento: hacen falta dos fondos, y solo hay uno."
      : `No hay matriz de solapamiento: hacen falta dos fondos con al menos la mitad de su cartera publicada, y ${dentro.length === 1 ? "solo hay uno" : "no hay ninguno"}.`;
  return { dentro, sinMatriz, fuera };
}

/** Las filas y columnas de una matriz que entran, en el orden de `dentro`. */
export function recortarLaMatriz<V>(values: readonly (readonly V[])[], dentro: readonly number[]): V[][] {
  return dentro.map((i) => dentro.map((j) => values[i][j]));
}

/** One bounded batch, using the same source and holdings cache as X-Ray. Una acción no tiene cartera que pedir. */
export async function loadReportOverlap(
  positions: OverlapPosition[],
  source: Pick<AssetDataSource, "getAssetHoldings" | "getAssetHoldingsMany">
): Promise<ReportOverlap> {
  const selected = reportOverlapPositions(positions);
  const ids = selected.filter((position) => !esAccion(position.instrument_type)).map((position) => position.asset_id);
  if (!ids.length) return buildReportOverlap(selected);
  if (source.getAssetHoldingsMany) {
    try {
      return buildReportOverlap(selected, await source.getAssetHoldingsMany(ids));
    } catch (error) {
      if (!source.getAssetHoldings) throw error;
    }
  }
  if (!source.getAssetHoldings) return buildReportOverlap(selected);
  const failed = new Set<string>();
  const rows = await Promise.all(ids.map(async (id) => {
    try { return [id, await source.getAssetHoldings!(id)] as const; }
    catch { failed.add(id); return [id, null] as const; }
  }));
  if (failed.size === ids.length) throw new Error("No se pudieron cargar los subyacentes para la matriz de solapamiento.");
  return buildReportOverlap(selected, new Map(rows), failed);
}

/**
 * Desde qué cifra un par de fondos «comparte mucho»: la misma que el informe interno usa para «Pares con solapamiento alto (40 % o
 * más)» y para sus puntos a revisar, y la que usa el informe de cliente para las frases y su matriz.
 */
export const SOLAPAMIENTO_ALTO = 40;
/** Cuántos pares altos se nombran, como los puntos a revisar del interno. Si hay más, se cuentan. */
export const PARES_ALTOS_EN_FRASES = 5;
/** Sin ningún par alto, cuántos de los que más comparten se nombran. */
export const PARES_MAYORES_EN_FRASES = 3;
/** Con más fondos sin medir que estos, se cuentan y no se nombran. */
const NOMBRES_DE_FONDOS_SIN_MEDIR = 3;

export function enumerarNombres(nombres: readonly string[]): string {
  return nombres.length <= 1 ? (nombres[0] ?? "") : `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}

/** Desde cuántos días de separación entre las fechas de dos carteras se avisa. «Más de un mes»: 31 días son un mes y no avisa; 32, sí. */
export const DIAS_QUE_SEPARAN_DOS_CARTERAS = 31;

/** Una cartera publicada que entra en la matriz, con el día al que está hecha. */
export interface CarteraConSuFecha {
  display_name: string;
  /** El `as_of_date` de la cartera del fondo, como llega: «AAAA-MM-DD» o un instante. Sin él, no consta. */
  asOfDate?: string | null;
}

const MS_POR_DIA = 86_400_000;

/** El día de una fecha publicada, en días desde 1970, o `null` si no es una fecha. Se lee el texto: sin huso. */
function diaDeLaCartera(asOfDate: string | null | undefined): number | null {
  const texto = typeof asOfDate === "string" ? asOfDate.trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || fecha(texto) === null) return null;
  return Math.round(Date.parse(`${texto}T00:00:00Z`) / MS_POR_DIA);
}

/**
 * IMP-7 (17-11-2026): el solapamiento compara la cartera de un fondo con la de otro, y cada una es de un día. Si se separan más de un mes
 * (`DIAS_QUE_SEPARAN_DOS_CARTERAS`) lo que se compara son dos momentos, y se escribe con las dos fechas. Si de alguna no consta la fecha, no se
 * sabe si son del mismo momento, y se escribe que no consta. Solo cuentan los fondos que entran en la matriz: los demás no se comparan.
 * Ninguna cifra cambia: es una nota. Pantalla y los dos papeles dicen lo mismo con estas frases.
 */
export function notasDeLasFechasDelSolapamiento(carteras: readonly CarteraConSuFecha[]): string[] {
  if (carteras.length < 2) return [];
  const conDia = carteras.map((cartera) => ({ nombre: cartera.display_name, dia: diaDeLaCartera(cartera.asOfDate), fecha: fecha(cartera.asOfDate?.trim().slice(0, 10)) }));
  const notas: string[] = [];
  const sinFecha = conDia.filter((cartera) => cartera.dia === null).map((cartera) => cartera.nombre);
  if (sinFecha.length > 0) {
    notas.push(sinFecha.length <= NOMBRES_DE_FONDOS_SIN_MEDIR
      ? `No consta la fecha de la cartera de ${enumerarNombres(sinFecha)}: no se sabe si se compara con carteras del mismo momento.`
      : `No consta la fecha de la cartera de ${sinFecha.length} fondos: no se sabe si se comparan con carteras del mismo momento.`);
  }
  const fechadas = conDia.flatMap((cartera) => (cartera.dia === null ? [] : [{ ...cartera, dia: cartera.dia }]));
  const lejanas: Array<{ antes: (typeof fechadas)[number]; despues: (typeof fechadas)[number] }> = [];
  for (const [i, uno] of fechadas.entries()) {
    for (const otro of fechadas.slice(i + 1)) {
      if (Math.abs(uno.dia - otro.dia) > DIAS_QUE_SEPARAN_DOS_CARTERAS) lejanas.push(uno.dia <= otro.dia ? { antes: uno, despues: otro } : { antes: otro, despues: uno });
    }
  }
  if (lejanas.length === 0) return notas;
  const dias = (par: (typeof lejanas)[number]) => cuantos(par.despues.dia - par.antes.dia, "día", "días");
  if (lejanas.length === 1) {
    const [par] = lejanas;
    notas.push(`Las carteras de ${par.antes.nombre} y ${par.despues.nombre} son de fechas separadas por más de un mes: la de ${par.antes.nombre}, del ${par.antes.fecha}, y la de ${par.despues.nombre}, del ${par.despues.fecha} (${dias(par)}). El solapamiento de ese par compara fondos en momentos distintos.`);
  } else {
    const extremo = lejanas.reduce((mayor, par) => (par.despues.dia - par.antes.dia > mayor.despues.dia - mayor.antes.dia ? par : mayor));
    const pares = (carteras.length * (carteras.length - 1)) / 2;
    notas.push(`${lejanas.length} de los ${pares} pares de fondos comparan carteras de fechas separadas por más de un mes. La más antigua es la de ${extremo.antes.nombre}, del ${extremo.antes.fecha}, y la más reciente, la de ${extremo.despues.nombre}, del ${extremo.despues.fecha} (${dias(extremo)}). El solapamiento de esos pares compara fondos en momentos distintos.`);
  }
  return notas;
}

/** Las notas de las fechas de lo que el modelo del informe mide: las posiciones que entran en la matriz. */
export function notasDeLasFechasDelModelo(model: Pick<ReportOverlap, "positions">): string[] {
  return notasDeLasFechasDelSolapamiento(model.positions.filter((posicion) => posicion.status === "available").map((posicion) => ({ display_name: posicion.display_name, asOfDate: posicion.asOfDate })));
}

/** Pares medidos de mayor a menor, con el orden de las posiciones como desempate. */
export function paresDeSolapamiento(values: ReportOverlap["values"], indices: readonly number[]) {
  const pares: Array<{ a: number; b: number; valor: number }> = [];
  for (const [i, a] of indices.entries()) {
    for (let j = i + 1; j < indices.length; j++) {
      const b = indices[j];
      const valor = values[a]?.[b];
      if (typeof valor === "number" && Number.isFinite(valor)) pares.push({ a, b, valor });
    }
  }
  return pares.sort((p, q) => q.valor - p.valor);
}

/**
 * La lectura en frases del solapamiento del informe de cliente: los pares de
 * fondos que más comparten, con su cifra, y cuántos fondos no publican lo bastante para medirlo. La cifra de cada par es la de la matriz
 * (`buildReportOverlap`) y se escribe con `solapamientoEnUnaFrase`: «al menos el 3,2 %», «más del 100 %», «menos del 0,1 %».
 *
 * Primero, los pares de `SOLAPAMIENTO_ALTO` o más, como el interno; si no hay ninguno, los que más comparten. Un par sin cifra no se
 * nombra como si no se solapara: se cuentan los fondos de los que no se ha recibido al menos la mitad de la cartera. Una acción no
 * tiene subyacentes y no entra. `masDeCien` dice si algún par nombrado pasa de 100, para que el papel ponga su nota.
 */
export function solapamientoEnFrases(model: Pick<ReportOverlap, "positions" | "values">): { frases: string[]; masDeCien: boolean } {
  const n = model.positions.length;
  if (n === 0) return { frases: ["Sin posiciones para calcular el solapamiento."], masDeCien: false };
  const fondos = model.positions.map((posicion, i) => ({ posicion, i })).filter(({ posicion }) => posicion.status !== "not_applicable");
  const acciones = n - fondos.length;
  if (fondos.length === 0) {
    return { frases: [fraseDeSoloAcciones(n)], masDeCien: false };
  }
  const frases: string[] = [];
  let masDeCien = false;
  const sinPublicar = fondos.filter(({ posicion }) => posicion.status === "insufficient" || posicion.status === "missing").map(({ posicion }) => posicion.display_name);
  const sinteticos = fondos.filter(({ posicion }) => posicion.status === "synthetic").map(({ posicion }) => posicion.display_name);
  const ningunoPublica = fondos.length > 1 && sinPublicar.length === fondos.length;
  if (fondos.length === 1) {
    frases.push(n === 1 ? "La cartera tiene un solo fondo: no hay dos fondos que comparar." : "Entre ellas hay un solo fondo: no hay dos fondos que comparar.");
  } else {
    const pares = paresDeSolapamiento(model.values, fondos.map(({ i }) => i));
    const frase = ({ a, b, valor }: (typeof pares)[number]) => `${model.positions[a].display_name} y ${model.positions[b].display_name} comparten ${solapamientoEnUnaFrase(valor)} de su cartera publicada.`;
    const altos = pares.filter((par) => par.valor >= SOLAPAMIENTO_ALTO);
    if (altos.length > 0) {
      frases.push(altos.length === 1
        ? `Un par de fondos comparte el ${SOLAPAMIENTO_ALTO} % o más de lo que publica:`
        : `${altos.length} pares de fondos comparten el ${SOLAPAMIENTO_ALTO} % o más de lo que publican:`);
      const nombrados = altos.slice(0, PARES_ALTOS_EN_FRASES);
      frases.push(...nombrados.map(frase));
      masDeCien = nombrados.some((par) => pasaDeCien(par.valor));
      const resto = altos.length - nombrados.length;
      if (resto > 0) frases.push(resto === 1 ? `Y un par más por encima del ${SOLAPAMIENTO_ALTO} %.` : `Y ${resto} pares más por encima del ${SOLAPAMIENTO_ALTO} %.`);
    } else {
      const conAlgo = pares.filter((par) => !sinComunes(par.valor));
      if (conAlgo.length > 0) {
        frases.push(`Ningún par de fondos llega al ${SOLAPAMIENTO_ALTO} % de lo que publican. ${conAlgo.length === 1 ? "El que más comparte:" : "Los que más comparten:"}`);
        frases.push(...conAlgo.slice(0, PARES_MAYORES_EN_FRASES).map(frase));
      } else if (pares.length > 0) {
        frases.push("En lo que publican, ningún título coincide entre dos fondos; no prueba que no compartan nada.");
      }
    }
    if (pares.length === 0 && !ningunoPublica) frases.push("No se puede medir el solapamiento de ningún par de fondos.");
  }
  /* Los que replican con una permuta no «no publican»: se cuentan aparte, en la misma frase si también hay fondos que publican menos de la mitad. */
  const sinMedirPorSwap = (empieza: string) => {
    const nombres = sinteticos.length <= NOMBRES_DE_FONDOS_SIN_MEDIR ? `: ${enumerarNombres(sinteticos)}` : "";
    return sinteticos.length === 1
      ? `${empieza} replica su índice con una permuta, y no se puede medir lo que comparte${nombres}.`
      : `${empieza} replican su índice con una permuta, y no se puede medir lo que comparten${nombres}.`;
  };
  let fraseDeSinPublicar: string | null = null;
  if (ningunoPublica) {
    fraseDeSinPublicar = `Ninguno de los ${fondos.length} fondos publica al menos la mitad de su cartera: no se puede medir lo que comparten.`;
  } else if (sinPublicar.length > 0) {
    const nombres = sinPublicar.length <= NOMBRES_DE_FONDOS_SIN_MEDIR ? `: ${enumerarNombres(sinPublicar)}` : "";
    fraseDeSinPublicar = sinPublicar.length === 1
      ? `${fondos.length === 1 ? "El fondo" : `1 de los ${fondos.length} fondos`} no publica al menos la mitad de su cartera, y no se puede medir lo que comparte${nombres}.`
      : `${sinPublicar.length} de los ${fondos.length} fondos no publican al menos la mitad de su cartera, y no se puede medir lo que comparten${nombres}.`;
  }
  if (sinteticos.length > 0) {
    const empieza = fraseDeSinPublicar
      ? `Y ${sinteticos.length}`
      : fondos.length === 1 ? "El fondo" : sinteticos.length === fondos.length ? `Los ${fondos.length} fondos` : `${sinteticos.length} de los ${fondos.length} fondos`;
    const fraseDeSwap = sinMedirPorSwap(empieza);
    frases.push(fraseDeSinPublicar ? `${fraseDeSinPublicar} ${fraseDeSwap}` : fraseDeSwap);
  } else if (fraseDeSinPublicar) {
    frases.push(fraseDeSinPublicar);
  }
  const sinLeer = fondos.filter(({ posicion }) => posicion.status === "failed").map(({ posicion }) => posicion.display_name);
  if (sinLeer.length > 0) {
    const nombres = sinLeer.length <= NOMBRES_DE_FONDOS_SIN_MEDIR ? `: ${enumerarNombres(sinLeer)}` : "";
    frases.push(sinLeer.length === 1 ? `De 1 fondo no se ha podido leer la cartera${nombres}.` : `De ${sinLeer.length} fondos no se ha podido leer la cartera${nombres}.`);
  }
  /* IMP-7: las carteras de fechas muy separadas, o sin fecha, se dicen aquí con las mismas frases que en pantalla y en el interno. */
  frases.push(...notasDeLasFechasDelModelo(model));
  if (acciones > 0) frases.push(acciones === 1 ? "La acción no entra: no tiene subyacentes." : `Las ${acciones} acciones no entran: no tienen subyacentes.`);
  return { frases, masDeCien };
}
