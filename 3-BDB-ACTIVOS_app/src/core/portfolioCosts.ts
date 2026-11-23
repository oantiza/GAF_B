import type { BdbAssetDetail, BdbManualPortfolioPosition, FuenteDeCoste } from "../types/bdbAssets";
import { summarizeCoveredRate } from "./coveredFinancialMetrics";
import { esAccion } from "./esAccion";
import { importe, importeTitular, oFalta, peso, porcentaje } from "./formato";
import { textoDeAusencia } from "./textoDeAusencia";
import { isWeightBalanced } from "./weightTolerance";

function validRate(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** TER (gastos corrientes, fracción) de la ficha; `null` si falta o no es válido. Un dato ausente no es un cero. */
export function assetOngoingCharge(asset: BdbAssetDetail | undefined | null): number | null {
  return validRate(asset?.costs?.ongoing_charge);
}

/**
 * Lo que un activo aporta a una media ponderada de coste: su coste corriente, cero si es una acción y `null` si falta.
 *
 * **El cero es solo para una acción** (decisión 10 de Óscar, 04-11-2026): no tiene gestora ni coste corriente, y tratarla
 * como un dato que falta dejaba en N/D la media de cualquier cartera con un 1 % en Iberdrola, a la espera de un dato que
 * no va a existir. Un fondo o un ETF sin coste sigue siendo un dato que falta. Y el cero no quiere decir que no cueste
 * nada: la media no incluye custodia ni corretaje, y quien la enseña lo dice (`NOTA_DE_LAS_ACCIONES`).
 */
export function assetRateForAverage(asset: BdbAssetDetail | undefined | null): number | null {
  return esAccion(asset?.instrument_type) ? 0 : assetOngoingCharge(asset);
}

/** Lo que acompaña a una media de coste que lleva acciones a cero. La leen pantalla y papel. */
export const NOTA_DE_LAS_ACCIONES = "No incluye custodia ni corretaje.";

/**
 * De qué es la media del coste corriente de Posiciones cuando hay acciones (Óscar, 21-11-2026): de toda la cartera, con las acciones a cero
 * —una acción no tiene coste corriente—, o, si a algún fondo le falta el dato, de la parte que lo tiene. Sin decirlo, un 0,70 % de una cartera
 * con un 30 % en acciones se lee como el coste de sus fondos, que es el 1,00 %. `cobertura` es la fracción del importe con dato (de 0 a 1).
 */
export function apunteDeLaMediaConAcciones(cobertura: number): string {
  const sobre = cobertura >= 1 ? "Sobre toda la cartera" : `Sobre el ${oFalta(peso(cobertura))} de la cartera con dato`;
  return `${sobre}, con las acciones a cero. ${NOTA_DE_LAS_ACCIONES}`;
}

/*
 * Lo que dice el papel bajo el coste corriente: la línea que dictó Óscar, con las comisiones de entrada y salida (decisión A-65), porque en la
 * muestra hay entradas máximas del 3 al 5,5 %. Para una acción ya cubre custodia y corretaje. Una sola redacción para el mismo hecho: la leen
 * el informe de costes, en sus dos sitios, la Propuesta de cambio, el informe de cliente, la comparativa de carteras y el informe interno.
 *
 * Las dos comisiones se nombran «entrada (suscripción)» y «salida (reembolso)» (Óscar, 11-11-2026): una sola denominación en toda la
 * aplicación, con el nombre del folleto entre paréntesis la primera vez. Los tres últimos términos van con espacios duros para que
 * «impuestos.» no se quede sola en la línea siguiente en ningún papel (decisión 80): antes solo lo hacía el informe de costes.
 */
export const LO_QUE_NO_INCLUYE_EL_COSTE = "No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos.";

/** Lo que se dice cuando todas son acciones. La leen el cuadro de costes y el papel. */
export const SIN_MEDIA_QUE_DAR = "Una acción no tiene coste corriente, así que no hay media que dar.";

/** Si todo son acciones, no hay coste corriente que medir: su media vale cero, y no se escribe como una cifra. Pantalla y papel preguntan aquí. */
export function esSoloDeAcciones(costs: { rows: readonly unknown[]; acciones: number }): boolean {
  return costs.rows.length > 0 && costs.acciones === costs.rows.length;
}

/** Costs use the relative allocation of the declared capital, without changing saved weights. */
export function calculatePortfolioCosts(
  positions: BdbManualPortfolioPosition[],
  assets: BdbAssetDetail[],
  totalCapital: number
) {
  const active = positions.filter((p) => Number.isFinite(p.weight_percent) && p.weight_percent > 0);
  const inputWeight = active.reduce((sum, p) => sum + p.weight_percent, 0);
  const capital = Number.isFinite(totalCapital) && totalCapital > 0 && active.length > 0 ? totalCapital : null;
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const rows = active.map((p) => {
    const asset = byId.get(p.asset_id);
    const fraction = p.weight_percent / inputWeight;
    const rowCapital = capital != null ? fraction * capital : null;
    const aplicaCoste = !esAccion(asset?.instrument_type);
    /* Si un dato trae un coste en una acción, no se cree: un campo presente donde no aplica es un error. */
    const ongoingPct = aplicaCoste ? assetOngoingCharge(asset) : null;
    /* Una cifra sin fuente no se enseña como si la tuviera: esta dos no existían sin ella. */
    const costes = aplicaCoste ? asset?.costs : undefined;
    const operacionPct = costes?.transaction_costs_source ? validRate(costes.transaction_costs) : null;
    const entradaPct = costes?.entry_charge_source ? validRate(costes.entry_charge) : null;
    return {
      assetId: p.asset_id,
      asset,
      name: asset?.display_name ?? p.asset_id,
      weight: fraction * 100,
      capital: rowCapital,
      /** `false` en una acción: en su fila no se escribe un 0 %, se escribe «No aplica». */
      aplicaCoste,
      ongoingPct,
      /** Costes de operación del fondo, al año. No están dentro de `ongoingPct`. */
      operacionPct,
      /** Entrada máxima: un pago único, que no se suma a nada. */
      entradaPct,
      /** De dónde sale cada cifra, y el KID del activo. */
      fuentes: {
        corriente: ongoingPct != null ? costes?.ongoing_charge_source ?? null : null,
        operacion: operacionPct != null ? costes?.transaction_costs_source ?? null : null,
        entrada: entradaPct != null ? costes?.entry_charge_source ?? null : null,
        hayKid: Boolean(costes?.document_url),
        fechaDelKid: costes?.document_date ?? null
      },
      mgmtPct: aplicaCoste ? validRate(asset?.costs?.management_fee) : null,
      costEur: ongoingPct != null && rowCapital != null ? ongoingPct * rowCapital : null
    };
  });
  const covered = rows.filter((row) => row.ongoingPct != null);
  const missing = rows.filter((row) => row.aplicaCoste && row.ongoingPct == null).length;
  // TER medio sobre el peso con dato (definición única, `summarizeCoveredRate`). Una acción cuenta a cero y como conocida.
  const ter = summarizeCoveredRate(rows.map((row) => ({ amount: row.weight / 100, rate: row.aplicaCoste ? row.ongoingPct : 0 })));
  const avgCostPct = rows.length > 0 && missing === 0 ? ter.weightedAverage : null;
  const operacion = resumenDeLaOperacion(rows);
  return {
    rows,
    inputWeight,
    totalWeight: rows.length > 0 ? 100 : 0,
    totalCapital: capital,
    // Misma tolerancia de «suma 100 %» que el constructor: si allí está cuadrada, aquí no se avisa.
    normalized: rows.length > 0 && !isWeightBalanced(inputWeight),
    missing,
    /** Cuántas filas son acciones: lo que obliga a decir que la media no incluye custodia ni corretaje. */
    acciones: rows.filter((row) => !row.aplicaCoste).length,
    coveragePct: ter.coverageRatio,
    // A missing rate is not a zero. Only publish the full portfolio rate with full coverage.
    avgCostPct,
    operacion,
    /* Las dos son anuales y sobre el valor de la inversión, y por eso se pueden sumar. Con una de las dos sin dato, no hay total. */
    corrienteMasOperacionPct: avgCostPct != null && operacion.tasa != null ? avgCostPct + operacion.tasa : null,
    /* Solo con acciones son 0 €, porque no falta nada. Una acción y un fondo sin dato no suman 0 €: se desconoce. */
    totalCostEur: capital != null && (covered.length > 0 || (rows.length > 0 && missing === 0))
      ? covered.reduce((sum, row) => sum + row.costEur!, 0)
      : null
  };
}

/**
 * Lo que los costes de operación de los fondos aportan a la cartera, por fuente (decisión 43 de Óscar).
 *
 * Todo en fracción de la cartera entera: `delKid` es la suma de peso × coste de las posiciones que lo dicen en su KID, sobre
 * `pesoKid` del peso. Una acción no entra: no tiene operación de fondo, y en su fila dice «No aplica».
 *
 * `tasa` solo existe si todos los fondos tienen la cifra: con una que falte, sumar lo demás sería tratarla como un cero. Las dos
 * fuentes sí se suman: las dos dicen lo mismo, el coste anual de operar sobre el valor de la inversión. Pero no miden igual, y
 * por eso quien la enseña dice cuánto sale de cada una.
 */
export function resumenDeLaOperacion(rows: ReadonlyArray<{ weight: number; aplicaCoste: boolean; operacionPct: number | null; fuentes: { operacion: FuenteDeCoste | null } }>) {
  const suma = (filas: typeof rows) => filas.reduce((total, fila) => total + (fila.weight / 100) * (fila.operacionPct ?? 0), 0);
  const peso = (filas: typeof rows) => filas.reduce((total, fila) => total + fila.weight / 100, 0);
  const fondos = rows.filter((fila) => fila.aplicaCoste);
  const delKid = fondos.filter((fila) => fila.operacionPct != null && fila.fuentes.operacion === "KID");
  const delProveedor = fondos.filter((fila) => fila.operacionPct != null && fila.fuentes.operacion === "PROVIDER");
  const sinDato = fondos.filter((fila) => fila.operacionPct == null);
  const medido = suma(delKid) + suma(delProveedor);
  return {
    delKid: suma(delKid),
    pesoKid: peso(delKid),
    delProveedor: suma(delProveedor),
    pesoProveedor: peso(delProveedor),
    /** Fondos y ETF sin la cifra: un dato que falta, no un cero. */
    sinDato: sinDato.length,
    pesoSinDato: peso(sinDato),
    pesoAcciones: peso(rows.filter((fila) => !fila.aplicaCoste)),
    fondos: fondos.length,
    /** Lo que se ha podido medir, aunque sea una parte. */
    medido,
    tasa: fondos.length > 0 && sinDato.length === 0 ? medido : null
  };
}

export type ResumenDeLaOperacion = ReturnType<typeof resumenDeLaOperacion>;

const DD_MM_AAAA = /^(\d{4})-(\d{2})-(\d{2})/;

/** La fecha de un documento como se cita: 19/08/2026. Sin fecha legible no se escribe ninguna otra. */
function fechaDeUnKid(iso: string | null): string | null {
  const partes = iso ? DD_MM_AAAA.exec(iso) : null;
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : null;
}

type FuentesDeUnaFila = ReturnType<typeof calculatePortfolioCosts>["rows"][number]["fuentes"];

/**
 * Lo que dice la columna «Fuente» de una fila: de dónde sale cada cifra, y no de dónde sale el fondo. Solo se escribe «KID» junto
 * a una cifra que salga de ese documento, y la fecha es la suya: «KID 19/08/2026» o «KID, sin fecha». Si una cifra sale de otro
 * sitio, se nombra; una que falta ya lo dice su columna.
 *
 * «Proveedor, sin KID» es solo para quien no tiene KID. El que lo tiene y no da esa cifra (PIMCO da la entrada en euros) dice
 * «Proveedor» y nada más: no se afirma que no haya documento.
 */
export function fuenteDeLaFila(fuentes: FuentesDeUnaFila): string {
  const cifras: Array<[string, FuenteDeCoste | null]> = [["corriente", fuentes.corriente], ["operación", fuentes.operacion], ["entrada", fuentes.entrada]];
  const conFuente = cifras.filter(([, fuente]) => fuente != null);
  if (conFuente.length === 0) return textoDeAusencia("falta");
  const delKid = conFuente.filter(([, fuente]) => fuente === "KID");
  const proveedor = fuentes.hayKid ? "Proveedor" : "Proveedor, sin KID";
  if (delKid.length === 0) return proveedor;
  const fecha = fechaDeUnKid(fuentes.fechaDelKid);
  const kid = fecha ? `KID ${fecha}` : "KID, sin fecha";
  if (delKid.length === conFuente.length) return kid;
  const delProveedor = conFuente.filter(([, fuente]) => fuente === "PROVIDER").map(([nombre]) => nombre);
  return `${kid}; ${delProveedor.join(" y ")}: proveedor`;
}

/** Un peso de la cartera, con un decimal: «64,0 %», «63,5 %». */
function pesoEscrito(fraccion: number): string {
  return oFalta(peso(fraccion));
}

/** Una tasa pequeña no se redondea a un cero: los dos ETF de la muestra suman menos de una centésima, y no es lo mismo. */
function tasaEscrita(tasa: number): string {
  return tasa > 0 && tasa < 0.5 / 10_000 ? `menos de ${oFalta(porcentaje(1 / 10_000))}` : oFalta(porcentaje(tasa));
}

/** Un coste de operación en una casilla: «< 0,01 %» y no un «0,00 %» que no es cierto. Un cero que dice el documento sigue siendo un cero. */
export function operacionEnUnaCasilla(tasa: number | null | undefined): string {
  return typeof tasa === "number" && tasa > 0 && tasa < 0.5 / 10_000 ? `< ${oFalta(porcentaje(1 / 10_000))}` : oFalta(porcentaje(tasa));
}

/**
 * Lo que explica la fila de los costes de operación: cuánto sale de cada fuente, sobre qué parte del peso, y lo que falta. Con
 * `conFuente: false`, sin nombrarlas: en pantalla, en Modo cliente, la fuente no sale (decisión 19).
 */
export function detalleDeLaOperacion(operacion: ResumenDeLaOperacion, opciones: { conFuente?: boolean } = {}): string {
  const conFuente = opciones.conFuente ?? true;
  if (operacion.fondos === 0) return "A una acción no le aplica: no tiene costes de operación de fondo.";
  /* El porcentaje es de la cartera entera, y lo dice: 0,14 % es lo que aporta ese 64 % del peso, no su coste medio. Si no, el total no se puede rehacer. */
  const tramos = [
    { fuente: "del KID, ", suma: operacion.delKid, peso: operacion.pesoKid },
    { fuente: "del proveedor, ", suma: operacion.delProveedor, peso: operacion.pesoProveedor }
  ].filter((tramo) => tramo.peso > 0);
  const partes = tramos.map((tramo, i) => {
    const cuanto = `${conFuente ? tramo.fuente : ""}${tasaEscrita(tramo.suma)}`;
    return i === 0 ? `${cuanto} de la cartera, medido sobre el ${pesoEscrito(tramo.peso)} del peso` : `${cuanto}, sobre el ${pesoEscrito(tramo.peso)}`;
  });
  const frases: string[] = [];
  if (partes.length > 0) {
    const junto = partes.join("; ");
    frases.push(`${junto.charAt(0).toUpperCase()}${junto.slice(1)}.`);
  }
  if (operacion.sinDato > 0) {
    frases.push(operacion.medido > 0 || operacion.pesoKid + operacion.pesoProveedor > 0
      ? `El ${pesoEscrito(operacion.pesoSinDato)} del peso no tiene el dato: la cifra solo cuenta lo medido, y por eso no se da un total.`
      : "Ningún fondo tiene el dato.");
  }
  if (operacion.pesoAcciones > 0) frases.push(`El ${pesoEscrito(operacion.pesoAcciones)} son acciones, y a una acción no le aplica.`);
  return frases.join(" ");
}

/** Para leer un porcentaje en euros sin inventarse un capital: es una escala redonda, no el dinero de nadie. */
export const BASE_DE_LECTURA_EUR = 10_000;

/**
 * La cifra principal cuando nadie ha declarado un capital (decisión 5 de Óscar, 04-11-2026): «0,95 % al año, unos 95 €
 * por cada 10.000 €».
 *
 * Las dos cifras salen de la misma tasa y del mismo redondeo: una centésima de punto sobre esa base es justo un euro, así
 * que no pueden contradecirse, y el porcentaje es el que `porcentaje` escribe en el resto del papel. `tasa` es lo que se cuenta:
 * la media de los productos, o esa media más la comisión de gestión.
 *
 * - Si falta el coste de un fondo o un ETF no hay cifra que dar, y se dice cuánto falta: un dato ausente no es un cero.
 * - Una acción no tiene coste corriente y en la media cuenta como cero (decisión 10). Pero «unos 0 € por cada 10.000 €»
 *   sonaría a que la cartera no cuesta nada, así que un cero se escribe sin traducirlo a euros, y si son solo acciones dice
 *   «No aplica», como la pantalla (decisión A-65): quien lo enseña dice al lado por qué.
 */
export function fraseDelCoste(
  costs: Pick<ReturnType<typeof calculatePortfolioCosts>, "rows" | "missing" | "acciones" | "avgCostPct">,
  tasa: number | null = costs.avgCostPct
): string {
  const posiciones = costs.rows.length;
  if (costs.missing > 0) {
    return posiciones === 1
      ? "No disponible: falta el coste de la única posición"
      : `No disponible: falta el coste de ${costs.missing} de las ${posiciones} posiciones`;
  }
  if (tasa == null || !Number.isFinite(tasa) || tasa < 0) return "No disponible";
  if (tasa === 0) {
    return esSoloDeAcciones(costs) ? textoDeAusencia("no-aplica") : `${oFalta(porcentaje(0))} al año`;
  }
  const base = oFalta(importeTitular(BASE_DE_LECTURA_EUR));
  const escrito = oFalta(porcentaje(tasa));
  /* Los euros son las cifras del porcentaje que se escribe, no otro redondeo de la tasa: 0,95 % son 95 centésimas de punto. */
  const euros = (Number(escrito.replace(/\D/g, "")) * BASE_DE_LECTURA_EUR) / 10_000;
  if (euros === 0) return `Menos de ${oFalta(porcentaje(1 / 10_000))} al año, menos de ${oFalta(importeTitular(BASE_DE_LECTURA_EUR / 10_000))} por cada ${base}`;
  return `${escrito} al año, unos ${oFalta(importeTitular(euros))} por cada ${base}`;
}

export type PortfolioManagementFeeUnit = "percent" | "euros";

/**
 * La comisión de gestión de la cartera tal como se ha indicado, en palabras del cliente (decisión A-65): «Comisión indicada: 0,50 % anual».
 * Sin decimales de más y sin redondear lo que ha escrito el asesor: un 0,125 % no es un 0,13 %. El campo admite cuatro decimales.
 */
export function comisionIndicada(fee: { rate: number | null; annualEur: number | null }, unidad: PortfolioManagementFeeUnit): string {
  if (unidad === "euros") return `Comisión indicada: ${oFalta(importe(fee.annualEur))} anual.`;
  const puntos = (fee.rate ?? 0) * 100;
  const decimales = [2, 3].find((digitos) => Math.abs(Number(puntos.toFixed(digitos)) - puntos) < 1e-9) ?? 4;
  return `Comisión indicada: ${oFalta(porcentaje(fee.rate, { decimales }))} anual.`;
}

/** A portfolio-level fee is additional to the assets' ongoing charges, never part of their weighted rate. */
export function calculatePortfolioManagementFee(
  costs: ReturnType<typeof calculatePortfolioCosts>,
  amount: number | null,
  unit: PortfolioManagementFeeUnit
) {
  const valid = amount != null && Number.isFinite(amount) && amount >= 0 && (unit !== "percent" || amount <= 100);
  const rate = valid ? (unit === "percent" ? amount / 100 : costs.totalCapital != null ? amount / costs.totalCapital : null) : null;
  const annualEur = valid ? (unit === "euros" ? amount : costs.totalCapital != null ? costs.totalCapital * amount / 100 : null) : null;
  return {
    valid,
    rate,
    annualEur,
    combinedRate: costs.avgCostPct != null && rate != null ? costs.avgCostPct + rate : null,
    combinedAnnualEur: costs.avgCostPct != null && costs.totalCostEur != null && annualEur != null
      ? costs.totalCostEur + annualEur : null
  };
}
